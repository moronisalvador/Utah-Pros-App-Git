/**
 * ════════════════════════════════════════════════
 * FILE: functions/lib/google-calendar.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Copies a UPR appointment into the personal Google Calendar of every crew
 *   member assigned to it. When an appointment is created, changed, or deleted,
 *   this figures out who is on it, who has connected their Google Calendar, and
 *   then creates / updates / removes the matching event on each of their
 *   calendars. It remembers which Google event belongs to which appointment-and-
 *   person so later edits land on the right event.
 *
 * WHERE IT LIVES:
 *   Worker library — imported by functions/api/google-calendar-sync.js and
 *   functions/api/google-calendar-resync.js. Not a route.
 *
 * DEPENDS ON:
 *   Packages:  none (pure fetch, runs in Cloudflare V8 isolates)
 *   Internal:  ./google-drive.js (getValidAccessToken — shared per-employee token
 *              refresh), ./supabase.js (service-role REST client, passed in)
 *   Data:      reads  → appointments, appointment_crew, jobs, user_google_accounts
 *              writes → google_calendar_links (event-id mapping per person)
 *   External:  www.googleapis.com/calendar/v3 (Google Calendar API)
 *
 * NOTES / GOTCHAS:
 *   - SOURCE-AGNOSTIC BY DESIGN. The mapping is keyed by (source_type, source_id,
 *     employee_id). Today source_type='appointment'; when scheduling moves to
 *     job_schedules this layer is unchanged — only the caller passes a different
 *     source. Keep it that way so the appointment→job refactor can't break sync.
 *   - Appointments store local date + TIME with NO timezone. We send Google an
 *     explicit timeZone ('America/Denver') with the wall-clock time so Google
 *     handles DST — we never hand-convert to UTC.
 *   - Idempotent: a sync_hash of the synced fields skips no-op Google calls.
 *   - status='cancelled' (or a deleted appointment) removes the events; the link
 *     rows retain the mapping so deletes work even after the source row is gone.
 * ════════════════════════════════════════════════
 */

import { getValidAccessToken } from './google-drive.js';

const CAL_API   = 'https://www.googleapis.com/calendar/v3/calendars';
const TIMEZONE  = 'America/Denver';   // UPR ops timezone (appointments have no TZ of their own)
const SOURCE    = 'appointment';
const DEFAULT_DURATION_HOURS = 2;     // when an appointment has a start but no end

// ─── SECTION: Helpers — time + formatting ──────────────
function normTime(t) {
  // '07:00' → '07:00:00'; '07:00:00' stays. Defensive against nulls handled by caller.
  const parts = String(t).split(':');
  while (parts.length < 3) parts.push('00');
  return parts.slice(0, 3).map((p) => p.padStart(2, '0')).join(':');
}

function addHoursToTime(t, hours) {
  const [h, m, s] = normTime(t).split(':').map(Number);
  let total = h * 3600 + m * 60 + (s || 0) + hours * 3600;
  const dayCap = 24 * 3600 - 1;
  if (total > dayCap) total = dayCap;            // clamp into the same day
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  return [hh, mm, ss].map((n) => String(n).padStart(2, '0')).join(':');
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

function titleCase(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// ─── SECTION: Event body ──────────────
// Translates an appointment (+ its job, if any) into a Google Calendar event.
export function buildEventBody(appt, job) {
  const summary =
    (appt.title && appt.title.trim()) ||
    (job ? `${titleCase(job.division) || 'Job'} — ${job.insured_name || job.job_number || 'Appointment'}` : 'UPR Appointment');

  let location;
  if (job) {
    const cityState = [job.city, [job.state, job.zip].filter(Boolean).join(' ').trim()].filter(Boolean).join(', ');
    location = [job.address, cityState].filter(Boolean).join(', ') || undefined;
  }

  const descLines = [];
  if (appt.notes && appt.notes.trim()) descLines.push(appt.notes.trim());
  if (job?.job_number) descLines.push(`Job #${job.job_number}`);
  if (job?.claim_number) descLines.push(`Claim #${job.claim_number}`);
  descLines.push('— synced from UPR');
  const description = descLines.join('\n');

  // Timing: all-day when there's no start time, else a timed event with explicit TZ.
  let start, end;
  if (appt.time_start) {
    const endTime = appt.time_end || addHoursToTime(appt.time_start, DEFAULT_DURATION_HOURS);
    const endDate = appt.duration_days > 1 ? addDays(appt.date, appt.duration_days - 1) : appt.date;
    start = { dateTime: `${appt.date}T${normTime(appt.time_start)}`, timeZone: TIMEZONE };
    end   = { dateTime: `${endDate}T${normTime(endTime)}`,          timeZone: TIMEZONE };
  } else {
    // All-day. Google treats the all-day end date as EXCLUSIVE, so add at least 1.
    start = { date: appt.date };
    end   = { date: addDays(appt.date, Math.max(1, appt.duration_days || 1)) };
  }

  return {
    summary,
    location,
    description,
    start,
    end,
    extendedProperties: { private: { uprSourceType: SOURCE, uprSourceId: appt.id } },
  };
}

export function eventHash(body) {
  return djb2(JSON.stringify({ s: body.summary, l: body.location, d: body.description, st: body.start, en: body.end }));
}

// ─── SECTION: Google Calendar API (per employee) ──────────────
async function calFetch(env, employeeId, path, method, body) {
  const { accessToken } = await getValidAccessToken(env, employeeId);
  const res = await fetch(`${CAL_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  // Already-gone on delete is a success for our purposes.
  if (method === 'DELETE' && (res.status === 404 || res.status === 410)) return null;
  if (!res.ok) throw new Error(`Calendar ${method} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? null : res.json();
}

export function createEvent(env, employeeId, calendarId, body) {
  return calFetch(env, employeeId, `/${encodeURIComponent(calendarId)}/events`, 'POST', body);
}
export function updateEvent(env, employeeId, calendarId, eventId, body) {
  return calFetch(env, employeeId, `/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, 'PATCH', body);
}
export function deleteEvent(env, employeeId, calendarId, eventId) {
  return calFetch(env, employeeId, `/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, 'DELETE');
}

// ─── SECTION: Link persistence ──────────────
async function getLinks(db, sourceId) {
  return db.select(
    'google_calendar_links',
    `source_type=eq.${SOURCE}&source_id=eq.${sourceId}&select=*`,
  );
}

async function writeLink(db, existing, fields) {
  const now = new Date().toISOString();
  if (existing) {
    await db.update('google_calendar_links', `id=eq.${existing.id}`, { ...fields, updated_at: now });
  } else {
    await db.insert('google_calendar_links', { ...fields, updated_at: now });
  }
}

// Removes every Google event mapped to a source (delete / cancel) and marks the
// link rows deleted. Keeps the rows so we never re-create a removed event.
export async function removeSourceEvents(env, db, sourceId) {
  const links = await getLinks(db, sourceId);
  for (const link of links) {
    if (link.status === 'deleted') continue;
    if (link.google_event_id) {
      try { await deleteEvent(env, link.employee_id, link.calendar_id || 'primary', link.google_event_id); }
      catch { /* best-effort: mark deleted regardless */ }
    }
    await writeLink(db, link, { status: 'deleted', google_event_id: null, last_error: null, synced_at: new Date().toISOString() });
  }
  return { removed: links.length };
}

// ─── SECTION: Orchestrator ──────────────
// Syncs ONE appointment to every assigned crew member who has connected Google
// Calendar. Idempotent — safe to call repeatedly (used by the trigger worker and
// the manual "sync my calendar" backfill).
export async function syncAppointment(env, db, appointmentId) {
  const rows = await db.select(
    'appointments',
    `id=eq.${appointmentId}&select=id,job_id,title,date,time_start,time_end,status,notes,duration_days,kind,is_private,` +
    `appointment_crew(employee_id,role),` +
    `jobs(job_number,insured_name,address,city,state,zip,division,claim_number)`,
  );
  const appt = rows?.[0];

  // Gone or cancelled → remove all its events.
  if (!appt || appt.status === 'cancelled') {
    return removeSourceEvents(env, db, appointmentId);
  }

  const job = appt.jobs || null;
  const crewIds = [...new Set((appt.appointment_crew || []).map((c) => c.employee_id))];

  // Which of those crew members have a usable Google Calendar connection?
  let connectedIds = [];
  if (crewIds.length) {
    const accts = await db.select(
      'user_google_accounts',
      `employee_id=in.(${crewIds.join(',')})&refresh_token=not.is.null&scopes=ilike.*calendar*&select=employee_id`,
    );
    connectedIds = accts.map((a) => a.employee_id);
  }

  const body = buildEventBody(appt, job);
  const hash = eventHash(body);
  const links = await getLinks(db, appointmentId);
  const linkByEmp = new Map(links.map((l) => [l.employee_id, l]));

  let created = 0, updated = 0, removed = 0, skipped = 0, errored = 0;

  // Upsert events for currently-connected crew.
  for (const employeeId of connectedIds) {
    const link = linkByEmp.get(employeeId) || null;
    const calId = link?.calendar_id || 'primary';
    try {
      if (link?.google_event_id && link.sync_hash === hash && link.status === 'synced') {
        skipped++;
        continue;
      }
      let eventId = link?.google_event_id || null;
      if (eventId) {
        await updateEvent(env, employeeId, calId, eventId, body);
        updated++;
      } else {
        const ev = await createEvent(env, employeeId, calId, body);
        eventId = ev?.id || null;
        created++;
      }
      await writeLink(db, link, {
        source_type: SOURCE, source_id: appointmentId, employee_id: employeeId,
        google_event_id: eventId, calendar_id: calId, sync_hash: hash,
        status: 'synced', last_error: null, synced_at: new Date().toISOString(),
      });
    } catch (e) {
      errored++;
      await writeLink(db, link, {
        source_type: SOURCE, source_id: appointmentId, employee_id: employeeId,
        status: 'error', last_error: String(e.message || e).slice(0, 400),
      });
    }
  }

  // Remove events for people no longer connected or no longer on the crew.
  const connectedSet = new Set(connectedIds);
  for (const link of links) {
    if (connectedSet.has(link.employee_id)) continue;
    if (link.status === 'deleted') continue;
    if (link.google_event_id) {
      try { await deleteEvent(env, link.employee_id, link.calendar_id || 'primary', link.google_event_id); }
      catch { /* best-effort */ }
    }
    await writeLink(db, link, { status: 'deleted', google_event_id: null, synced_at: new Date().toISOString() });
    removed++;
  }

  return { created, updated, removed, skipped, errored, connected: connectedIds.length };
}
