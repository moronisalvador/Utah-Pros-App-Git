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
 *   Internal:  ./google-drive.js (getValidAccessToken — the writer's per-user
 *              token + refresh), ./supabase.js (service-role client, passed in)
 *   Data:      reads  → appointments, appointment_crew, jobs, user_google_accounts,
 *                       integration_config (writer)
 *              writes → google_calendar_links (event-id mapping per person)
 *   External:  www.googleapis.com/calendar/v3 (Google Calendar API)
 *
 * NOTES / GOTCHAS:
 *   - WRITES VIA A SHARED "WRITER" ACCOUNT. One connected account (whose Google
 *     login has "make changes to events" access to other staff calendars) writes
 *     each person's event to THEIR calendar — by calendarId = their email, or
 *     'primary' for the writer's own. Only the writer connects; everyone else just
 *     needs to have shared their calendar with the writer. If the writer lacks
 *     access to someone's calendar, that person errors (logged) — others still sync.
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
import { sendEmail } from './email.js';

// ── appointment.assigned email dedupe seam (Notification Center, Session B) ──
// The legacy "assigned"/"rescheduled" employee email below IS the email channel
// for the appointment.assigned notification type (finding 5 in
// docs/notify-roadmap.md). It fires from THIS calendar-sync worker, so the new
// Notification Center delivers appointment.assigned as bell + push only and lets
// this path own the email — deduped per-recipient by the employee's EFFECTIVE
// appointment.assigned email preference. Default is silent (the type seeds
// email_default=false), so this legacy email no longer fires ungated; an employee
// (or admin) turns it back on via the prefs UI. Keeping the notify email channel
// off + gating this one path here is what guarantees "no double email".

// The pure email-kind decision (unchanged legacy logic), extracted for testing.
export function decideEmailKind({ notify, email, firstCreate, link, timeSig }) {
  if (!notify || !email) return null;
  if (firstCreate) return 'assigned';
  if (link?.time_sig && link.time_sig !== timeSig) return 'rescheduled';
  return null;
}

// Is the recipient employee's EFFECTIVE appointment.assigned email channel on?
// Default-silent: any missing row / lookup error → false (suppress the email).
// prefsImpl is injectable for tests; prod resolves via get_effective_notification_prefs.
export async function assignedEmailAllowed(db, employeeId, prefsImpl) {
  if (!employeeId) return false;
  try {
    const rows = prefsImpl
      ? await prefsImpl(employeeId)
      : await db.rpc('get_effective_notification_prefs', { p_employee_id: employeeId });
    const row = (rows || []).find((p) => p.type_key === 'appointment.assigned' && p.channel === 'email');
    return !!(row && row.enabled);
  } catch {
    return false;
  }
}

const CAL_API   = 'https://www.googleapis.com/calendar/v3/calendars';
const TIMEZONE  = 'America/Denver';   // UPR ops timezone (appointments have no TZ of their own)
const SOURCE    = 'appointment';
const DEFAULT_DURATION_HOURS = 2;     // when an appointment has a start but no end
// Sender display name for assignment emails (verified utahpros.app address kept).
const NOTIFY_FROM = 'UPR - Notifications <restoration@utahpros.app>';

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

// ─── SECTION: Notification helpers ──────────────
const DAYS   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// A signature of just the WHEN — lets us detect a reschedule (vs a title/notes edit).
function timeSignature(appt) {
  return djb2(`${appt.date}|${appt.time_start || ''}|${appt.time_end || ''}|${appt.duration_days || 1}`);
}

function formatApptDate(dateStr) {
  const dt = new Date(`${dateStr}T12:00:00Z`);   // noon UTC avoids DST/offset edges
  return `${DAYS[dt.getUTCDay()]}, ${MONTHS[dt.getUTCMonth()]} ${dt.getUTCDate()}`;
}

function to12h(t) {
  const [h, m] = normTime(t).split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, '0')} ${ampm}`;
}

function formatTimeRange(appt) {
  if (!appt.time_start) return 'All day';
  const end = appt.time_end || addHoursToTime(appt.time_start, DEFAULT_DURATION_HOURS);
  return `${to12h(appt.time_start)} – ${to12h(end)}`;
}

// Client-facing arrival window: a standard 2-hour span from the scheduled start
// (we give customers a window, not an exact minute).
const CLIENT_ARRIVAL_WINDOW_HOURS = 2;
function formatArrivalWindow(timeStart) {
  if (!timeStart) return 'All day';
  return `${to12h(timeStart)} – ${to12h(addHoursToTime(timeStart, CLIENT_ARRIVAL_WINDOW_HOURS))}`;
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Division → accent color (matches the app's division palette).
function divisionColor(division) {
  return {
    water: '#0d9488', fire: '#ea580c', contents: '#d97706',
    mold: '#db2777', reconstruction: '#7c3aed', remodeling: '#ea580c',
  }[division] || '#2563eb';
}

// Builds the assignment / reschedule email. `kind` ∈ {'assigned','rescheduled'}.
// Branded, card-style HTML (table layout for email-client safety) + plain text.
function buildNotificationEmail({ summary, appt, job, recipientName, kind, base }) {
  const rescheduled = kind === 'rescheduled';
  const dateLine = `${formatApptDate(appt.date)} · ${formatTimeRange(appt)}`;
  const where    = job ? [job.address, [job.city, job.state, job.zip].filter(Boolean).join(' ').trim()].filter(Boolean).join(', ') : '';
  const link     = appt.job_id ? `${base}/jobs/${appt.job_id}` : `${base}/schedule`;
  const accent   = divisionColor(job?.division);
  const subject  = `${rescheduled ? 'Rescheduled' : "You're assigned"}: ${summary} (${dateLine})`;

  const badge = rescheduled
    ? { text: 'Rescheduled',    bg: '#fffbeb', fg: '#b45309', bd: '#fde68a' }
    : { text: 'New assignment', bg: '#eff6ff', fg: '#2563eb', bd: '#bfdbfe' };

  const rows = [
    ['When', dateLine],
    where ? ['Where', where] : null,
    job?.job_number ? ['Job', `#${job.job_number}`] : null,
    appt.notes && appt.notes.trim() ? ['Notes', appt.notes.trim()] : null,
  ].filter(Boolean);

  const rowHtml = rows.map(([k, v]) => `
            <tr>
              <td style="padding:7px 0;font-size:11px;color:#8b929e;text-transform:uppercase;letter-spacing:.05em;vertical-align:top;width:62px">${k}</td>
              <td style="padding:7px 0;font-size:14px;color:#111318;line-height:1.45;vertical-align:top">${esc(v)}</td>
            </tr>`).join('');

  const intro = rescheduled
    ? 'An appointment you’re assigned to was rescheduled.'
    : 'You’ve been assigned to an appointment.';

  const html = `
  <div style="background:#f4f5f7;padding:24px 12px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto">
      <tr><td style="padding:2px 4px 16px">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="width:34px;height:34px;background:#2563eb;border-radius:9px;color:#ffffff;font-weight:700;font-size:18px;text-align:center;vertical-align:middle;font-family:-apple-system,'Segoe UI',Roboto,sans-serif">U</td>
          <td style="padding-left:10px;font-size:15px;font-weight:600;color:#111318">Utah Pros Restoration</td>
        </tr></table>
      </td></tr>
      <tr><td style="background:#ffffff;border:1px solid #e2e5e9;border-radius:14px;overflow:hidden">
        <div style="height:4px;background:${accent};line-height:4px;font-size:0">&nbsp;</div>
        <div style="padding:24px">
          <span style="display:inline-block;font-size:11px;font-weight:600;letter-spacing:.03em;padding:4px 11px;border-radius:999px;background:${badge.bg};color:${badge.fg};border:1px solid ${badge.bd}">${badge.text.toUpperCase()}</span>
          <p style="font-size:15px;color:#5f6672;margin:16px 0 2px">Hi ${esc(recipientName || 'there')},</p>
          <p style="font-size:15px;color:#111318;margin:0 0 18px">${intro}</p>
          <div style="font-size:18px;font-weight:600;color:#111318;margin-bottom:10px;line-height:1.3">${esc(summary)}</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rowHtml}</table>
          <div style="margin-top:22px">
            <a href="${link}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 22px;border-radius:10px">Open in UPR &rarr;</a>
          </div>
        </div>
      </td></tr>
      <tr><td style="padding:16px 10px 4px;text-align:center;font-size:12px;color:#8b929e;line-height:1.5">
        Added to your Google Calendar · You’re receiving this because you’re assigned to this appointment.<br>
        <span style="color:#b6bcc6">Utah Pros Restoration</span>
      </td></tr>
    </table>
  </div>`;

  const text = `Hi ${recipientName || 'there'},\n\n${intro}\n\n${summary}\n` +
    rows.map(([k, v]) => `${k}: ${v}`).join('\n') +
    `\n\nAdded to your Google Calendar.\nOpen in UPR: ${link}`;

  return { subject, html, text };
}

// ─── SECTION: Client email ──────────────
// Customer-facing confirmation / reschedule / cancellation. Branded "Utah Pros
// Restoration", no internal details (crew, claim #), no app link.
export function buildClientEmail({ kind, clientName, date, timeStart, where }) {
  const dateLabel = formatApptDate(date);
  const arrival   = formatArrivalWindow(timeStart);   // 2-hour client arrival window

  const cfg = {
    confirmed:   { accent: '#16a34a', heading: 'Appointment confirmed',  lead: 'Your appointment with Utah Pros Restoration is confirmed.', subject: `Your Utah Pros appointment is confirmed — ${dateLabel}` },
    rescheduled: { accent: '#d97706', heading: 'Appointment rescheduled', lead: 'Your appointment with Utah Pros Restoration has been rescheduled.', subject: `Your Utah Pros appointment was rescheduled — ${dateLabel}` },
    cancelled:   { accent: '#dc2626', heading: 'Appointment cancelled',   lead: 'Your appointment with Utah Pros Restoration has been cancelled.', subject: `Your Utah Pros appointment on ${dateLabel} was cancelled` },
  }[kind] || {};

  const rows = [
    ['Date', dateLabel],
    timeStart ? ['Arrival window', arrival] : null,
    where && kind !== 'cancelled' ? ['Where', where] : null,
  ].filter(Boolean);

  const rowHtml = rows.map(([k, v]) => `
            <tr>
              <td style="padding:7px 0;font-size:11px;color:#8b929e;text-transform:uppercase;letter-spacing:.05em;vertical-align:top;width:110px">${k}</td>
              <td style="padding:7px 0;font-size:14px;color:#111318;line-height:1.45;vertical-align:top">${esc(v)}</td>
            </tr>`).join('');

  const closing = kind === 'cancelled'
    ? 'If you’d like to reschedule, just reply to this email and we’ll get you set up.'
    : 'Need to make a change? Just reply to this email and we’ll take care of it.';

  const html = `
  <div style="background:#f4f5f7;padding:24px 12px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto">
      <tr><td style="padding:2px 4px 16px">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="width:34px;height:34px;background:#2563eb;border-radius:9px;color:#ffffff;font-weight:700;font-size:18px;text-align:center;vertical-align:middle">U</td>
          <td style="padding-left:10px;font-size:15px;font-weight:600;color:#111318">Utah Pros Restoration</td>
        </tr></table>
      </td></tr>
      <tr><td style="background:#ffffff;border:1px solid #e2e5e9;border-radius:14px;overflow:hidden">
        <div style="height:4px;background:${cfg.accent};line-height:4px;font-size:0">&nbsp;</div>
        <div style="padding:24px">
          <div style="font-size:18px;font-weight:600;color:#111318;margin:0 0 4px">${cfg.heading}</div>
          <p style="font-size:15px;color:#5f6672;margin:14px 0 2px">Hi ${esc(clientName || 'there')},</p>
          <p style="font-size:15px;color:#111318;margin:0 0 16px">${cfg.lead}</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rowHtml}</table>
          <p style="font-size:14px;color:#5f6672;margin:20px 0 0;line-height:1.5">${closing}</p>
        </div>
      </td></tr>
      <tr><td style="padding:16px 10px 4px;text-align:center;font-size:12px;color:#8b929e;line-height:1.5">
        <span style="color:#b6bcc6">Utah Pros Restoration</span>
      </td></tr>
    </table>
  </div>`;

  const text = `Hi ${clientName || 'there'},\n\n${cfg.lead}\n\n` +
    rows.map(([k, v]) => `${k}: ${v}`).join('\n') +
    `\n\n${closing}\n\nUtah Pros Restoration`;

  return { subject: cfg.subject, html, text };
}

// Sends the client a cancellation email from a trigger payload (the appointment
// row is already gone by delete time, so the details ride along in `cancel`).
export async function sendClientCancellation(env, cancel, base) {
  if (!cancel?.email) return;
  const mail = buildClientEmail({
    kind: 'cancelled', clientName: cancel.name, date: cancel.date,
    timeStart: cancel.time_start, timeEnd: cancel.time_end, where: '', base,
  });
  try { await sendEmail(env, { to: cancel.email, subject: mail.subject, html: mail.html, text: mail.text }); }
  catch { /* never let a client email failure surface */ }
}

// ─── SECTION: Event body ──────────────
// Translates an appointment (+ its job, if any) into a Google Calendar event.
export function buildEventBody(appt, job) {
  // Google event title = UPR appointment title + customer name (the job's insured),
  // e.g. "Mold inspection — Jennifer Hansen". Calendar events with no job (PTO,
  // meetings) just use the appointment title.
  const baseTitle =
    (appt.title && appt.title.trim()) ||
    (job ? (titleCase(job.division) || 'Job') : 'UPR Appointment');
  const customer = job?.insured_name?.trim();
  const summary = customer ? `${baseTitle} — ${customer}` : baseTitle;

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

// ─── SECTION: Google Calendar API ──────────────
// Every call carries a delegated access token that acts AS one employee, so the
// event lands on THAT person's 'primary' calendar. The token is minted once per
// employee in the orchestrator and threaded through here.
async function calFetch(accessToken, path, method, body) {
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

function updateEvent(accessToken, calendarId, eventId, body) {
  return calFetch(accessToken, `/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, 'PATCH', body);
}
function deleteEvent(accessToken, calendarId, eventId) {
  return calFetch(accessToken, `/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, 'DELETE');
}

// Google event ids must be base32hex (chars 0-9a-v, length 5–1024). UUID hex
// (0-9a-f) is a valid subset, so a deterministic id per (source, employee) lets
// concurrent trigger fires (appointment INSERT + appointment_crew INSERT) collapse
// onto ONE event instead of racing to create duplicates.
function deterministicEventId(sourceId, employeeId) {
  return `${sourceId}${employeeId}`.replace(/-/g, '').toLowerCase();
}

// Create an event with an explicit deterministic id. If that id already exists
// (a concurrent fire or a prior sync created it), Google returns 409 → we PATCH
// it instead. This makes initial creation idempotent and duplicate-proof.
async function insertOrPatchEvent(accessToken, calendarId, eventId, body) {
  const auth = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
  const collection = `${CAL_API}/${encodeURIComponent(calendarId)}/events`;

  const ins = await fetch(collection, { method: 'POST', headers: auth, body: JSON.stringify({ ...body, id: eventId }) });
  if (ins.ok) return 'created';
  if (ins.status !== 409) throw new Error(`Calendar insert ${ins.status}: ${(await ins.text()).slice(0, 200)}`);

  const pat = await fetch(`${collection}/${encodeURIComponent(eventId)}`, { method: 'PATCH', headers: auth, body: JSON.stringify(body) });
  if (!pat.ok) throw new Error(`Calendar patch ${pat.status}: ${(await pat.text()).slice(0, 200)}`);
  return 'updated';
}

// ─── SECTION: Link persistence ──────────────
async function getLinks(db, sourceId) {
  return db.select(
    'google_calendar_links',
    `source_type=eq.${SOURCE}&source_id=eq.${sourceId}&select=*`,
  );
}

// The "writer": the connected account whose Google login can edit other staff
// calendars. Configurable via integration_config.gcal_writer_employee_id, else
// the single connected account. Returns { writerId, token } or null.
async function getWriter(env, db) {
  const cfg = await db.select('integration_config', `key=eq.gcal_writer_employee_id&limit=1`);
  let writerId = cfg?.[0]?.value || null;
  if (!writerId) {
    const accts = await db.select(
      'user_google_accounts',
      `refresh_token=not.is.null&scopes=ilike.*calendar*&select=employee_id&order=connected_at.asc&limit=1`,
    );
    writerId = accts?.[0]?.employee_id || null;
  }
  if (!writerId) return null;
  const { accessToken } = await getValidAccessToken(env, writerId);
  return { writerId, token: accessToken };
}

async function writeLink(db, existing, fields) {
  const now = new Date().toISOString();
  if (existing) {
    await db.update('google_calendar_links', `id=eq.${existing.id}`, { ...fields, updated_at: now });
    return;
  }
  try {
    await db.insert('google_calendar_links', { ...fields, updated_at: now });
  } catch (e) {
    // A concurrent fire already inserted this (source,employee) row (unique
    // constraint) — update it in place instead of failing.
    if (fields.source_id && fields.employee_id) {
      await db.update('google_calendar_links',
        `source_type=eq.${fields.source_type}&source_id=eq.${fields.source_id}&employee_id=eq.${fields.employee_id}`,
        { ...fields, updated_at: now });
    } else {
      throw e;
    }
  }
}

// Removes every Google event mapped to a source (delete / cancel) and marks the
// link rows deleted. Keeps the rows so we never re-create a removed event.
export async function removeSourceEvents(env, db, sourceId) {
  const links = await getLinks(db, sourceId);
  const writer = await getWriter(env, db);
  for (const link of links) {
    if (link.status === 'deleted') continue;
    if (link.google_event_id && writer) {
      try { await deleteEvent(writer.token, link.calendar_id || 'primary', link.google_event_id); }
      catch { /* best-effort: mark deleted regardless */ }
    }
    await writeLink(db, link, { status: 'deleted', google_event_id: null, last_error: null, synced_at: new Date().toISOString() });
  }
  return { removed: links.length };
}

// ─── SECTION: Orchestrator ──────────────
// Syncs ONE appointment to EVERY assigned crew member's Google calendar, written
// by the shared "writer" account (calendarId = each person's email, or 'primary'
// for the writer). Idempotent — used by the trigger worker and the manual backfill.
export async function syncAppointment(env, db, appointmentId, opts = {}) {
  const notify = opts.notify !== false;   // email on real changes; pass false for silent backfills
  const base = env.APP_BASE_URL || 'https://utahpros.app';

  const rows = await db.select(
    'appointments',
    `id=eq.${appointmentId}&select=id,job_id,title,date,time_start,time_end,status,notes,duration_days,kind,is_private,` +
    `notify_client,client_notified_at,client_time_sig,` +
    `appointment_crew(employee_id,role,employees(id,email,full_name)),` +
    `jobs(job_number,insured_name,address,city,state,zip,division,claim_number,client_email)`,
  );
  const appt = rows?.[0];

  // Gone or cancelled → remove all its events.
  if (!appt || appt.status === 'cancelled') {
    return removeSourceEvents(env, db, appointmentId);
  }

  const writer = await getWriter(env, db);
  if (!writer) return { created: 0, updated: 0, removed: 0, skipped: 0, errored: 0, emailed: 0, crew: 0, note: 'no writer connected' };

  const job = appt.jobs || null;
  // Each assigned crew member → the calendar we write to (their email).
  const crew = [];
  const seen = new Set();
  for (const c of appt.appointment_crew || []) {
    if (seen.has(c.employee_id)) continue;
    seen.add(c.employee_id);
    crew.push({ employeeId: c.employee_id, email: c.employees?.email || null, name: c.employees?.full_name || null });
  }
  const targetIds = new Set(crew.map((c) => c.employeeId));

  const body = buildEventBody(appt, job);
  const hash = eventHash(body);
  const timeSig = timeSignature(appt);
  const links = await getLinks(db, appointmentId);
  const linkByEmp = new Map(links.map((l) => [l.employee_id, l]));

  let created = 0, updated = 0, removed = 0, skipped = 0, errored = 0, emailed = 0;

  for (const { employeeId, email, name } of crew) {
    const link = linkByEmp.get(employeeId) || null;
    // The writer writes to its OWN primary; everyone else by their email (a
    // calendar the writer has been granted edit access to).
    const calId = employeeId === writer.writerId ? 'primary' : email;
    try {
      if (!calId) throw new Error('Employee has no email — cannot target their calendar');
      if (link?.google_event_id && link.sync_hash === hash && link.status === 'synced') {
        skipped++;
        continue;
      }
      let eventId = link?.google_event_id || null;
      let didCreate = false;
      if (eventId) {
        // Existing event — update on the calendar it was created on.
        await updateEvent(writer.token, link.calendar_id || calId, eventId, body);
        updated++;
      } else {
        // First sync for this person — deterministic id makes concurrent
        // trigger fires collapse onto one event instead of duplicating.
        eventId = deterministicEventId(appointmentId, employeeId);
        const mode = await insertOrPatchEvent(writer.token, calId, eventId, body);
        if (mode === 'created') { created++; didCreate = true; } else updated++;
      }

      // ── Email decision (idempotent) ──
      // firstCreate = the single run that actually created the event (others 409),
      // and we've never emailed this person about this appointment.
      const firstCreate = didCreate && !link?.assigned_notified_at;
      let emailKind = decideEmailKind({ notify, email, firstCreate, link, timeSig });
      // Notification-Center dedupe: this legacy email is the appointment.assigned
      // EMAIL channel — suppress it unless the recipient's effective pref has it on
      // (default-silent). Bell + push are delivered separately by the notify path.
      if (emailKind && !(await assignedEmailAllowed(db, employeeId))) {
        emailKind = null;
      }

      const fields = {
        source_type: SOURCE, source_id: appointmentId, employee_id: employeeId,
        google_event_id: eventId, calendar_id: calId, sync_hash: hash, time_sig: timeSig,
        status: 'synced', last_error: null, synced_at: new Date().toISOString(),
      };
      // Mark "assigned-notified" on first create even for a silent backfill, so a
      // later crew re-save can never re-fire the assigned email.
      if (firstCreate) fields.assigned_notified_at = new Date().toISOString();

      await writeLink(db, link, fields);

      if (emailKind) {
        try {
          const mail = buildNotificationEmail({ summary: body.summary, appt, job, recipientName: name, kind: emailKind, base });
          await sendEmail(env, { from: NOTIFY_FROM, to: email, subject: mail.subject, html: mail.html, text: mail.text });
          emailed++;
        } catch { /* email failure must never break the sync */ }
      }
    } catch (e) {
      errored++;
      await writeLink(db, link, {
        source_type: SOURCE, source_id: appointmentId, employee_id: employeeId,
        status: 'error', last_error: String(e.message || e).slice(0, 400),
      });
    }
  }

  // ── Client confirmation / reschedule (job appointments, opted in) ──
  // Deduped with an atomic compare-and-set on the appointment row, so concurrent
  // trigger fires can never double-email the customer.
  let clientEmailed = 0;
  if (notify && job && job.client_email && appt.notify_client) {
    const now = new Date().toISOString();
    const where = [job.address, [job.city, job.state, job.zip].filter(Boolean).join(' ').trim()].filter(Boolean).join(', ');
    const sendClient = async (kind) => {
      const mail = buildClientEmail({ kind, clientName: job.insured_name, date: appt.date, timeStart: appt.time_start, timeEnd: appt.time_end, where, base });
      try { await sendEmail(env, { to: job.client_email, subject: mail.subject, html: mail.html, text: mail.text }); clientEmailed++; }
      catch { /* client email must never break the sync */ }
    };
    try {
      if (!appt.client_notified_at) {
        // Claim the "confirmed" send: only one fire wins (WHERE client_notified_at IS NULL).
        const claimed = await db.update('appointments',
          `id=eq.${appointmentId}&client_notified_at=is.null`,
          { client_notified_at: now, client_time_sig: timeSig });
        if (claimed && claimed.length) await sendClient('confirmed');
      } else if (appt.client_time_sig && appt.client_time_sig !== timeSig) {
        // Compare-and-set the time signature: only the fire that flips it sends.
        const claimed = await db.update('appointments',
          `id=eq.${appointmentId}&client_time_sig=eq.${appt.client_time_sig}`,
          { client_time_sig: timeSig });
        if (claimed && claimed.length) await sendClient('rescheduled');
      }
    } catch { /* never break the sync on a client-email hiccup */ }
  }

  // Remove events for people no longer on the crew.
  for (const link of links) {
    if (targetIds.has(link.employee_id)) continue;
    if (link.status === 'deleted') continue;
    if (link.google_event_id) {
      try { await deleteEvent(writer.token, link.calendar_id || 'primary', link.google_event_id); }
      catch { /* best-effort */ }
    }
    await writeLink(db, link, { status: 'deleted', google_event_id: null, synced_at: new Date().toISOString() });
    removed++;
  }

  return { created, updated, removed, skipped, errored, emailed, clientEmailed, crew: crew.length };
}
