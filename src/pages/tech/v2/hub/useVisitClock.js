/**
 * ════════════════════════════════════════════════
 * FILE: useVisitClock.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Works out, for one visit and one tech, exactly where that tech is in the
 *   visit — not started, on the way, working, paused, or done — and how long the
 *   clock has been running. The Job Hub's big "Stage" uses this to decide what to
 *   make BIG on screen. It only reads the tech's own time entries; it never
 *   clocks anyone in or out (all the buttons live in TimeTracker, untouched).
 *
 * WHERE IT LIVES:
 *   Exports: deriveVisitClock (pure), useVisitClock (React Query hook),
 *            FORGOT_CLOCKOUT_MIN
 *   Used by: src/pages/tech/v2/hub/StageClock.jsx + HubStage.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, @tanstack/react-query
 *   Internal:  @/lib/techQuery (techKeys — the hub cache prefix)
 *   Data:      reads → job_time_entries (this tech's entries for the appointment).
 *              writes → none.
 *
 * NOTES / GOTCHAS:
 *   - deriveVisitClock is a DISCLOSED COPY-IN of TimeTracker.jsx's entry
 *     derivation (its lines 231-243): the same scheduled/omw/on_site/paused/
 *     completed ladder and the same Visit-N numbering, so the Stage can never
 *     disagree with the tracker beneath it. TimeTracker is NOT edited (frozen).
 *   - "Elapsed" is one continuous number measured from travel_start (On My Way),
 *     matching the tech-mobile-ux rule that the tech sees a single timer from OMW.
 *     It freezes at paused_at while paused, and at clock_out once done.
 *   - Stale hint mirrors the overview dashboard's FORGOT_CLOCKOUT_MIN (10h) — an
 *     entry still open that long very likely means a forgotten clock-out.
 *   - The hook caches under the ['tech','hub',jobId,'clock',…] prefix so a clock
 *     mutation (which invalidates the whole 'hub' kind) repaints it.
 * ════════════════════════════════════════════════
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { techKeys } from '@/lib/techQuery';

// ≥10h on the clock ⇒ probably forgot to clock out (parity with
// src/components/overview/hooks/useEmployeeStatus.js).
export const FORGOT_CLOCKOUT_MIN = 10 * 60;

const ms = (iso) => (iso ? new Date(iso).getTime() : null);
const asNum = (v) => (v == null ? null : Number(v));

/**
 * Derive the visit's clock state from this tech's time entries.
 * PURE — no I/O — so it is fully unit-testable.
 *
 * @param {Array<object>} entries - job_time_entries rows for one appt + tech,
 *   ordered created_at ASC (as TimeTracker loads them).
 * @param {number} nowMs - the current epoch ms (injected for testability).
 * @returns {{
 *   status: 'scheduled'|'omw'|'on_site'|'paused'|'completed',
 *   entries: Array<object>, activeEntry: object|null, currentEntry: object|null,
 *   priorVisits: Array<object>, visitNumber: number|null, running: boolean,
 *   elapsedMs: number, isStale: boolean,
 *   travelMinutes: number|null, onSiteMinutes: number|null,
 *   totalTravelMinutes: number, totalOnSiteMinutes: number, totalMinutes: number,
 * }}
 */
export function deriveVisitClock(entries, nowMs = Date.now()) {
  const list = Array.isArray(entries) ? entries : [];

  // ── The same derivation TimeTracker uses (frozen semantics, copied in) ──
  const activeEntry = list.find((e) => !e.clock_out) || null;
  const allCompleted = list.length > 0 && !activeEntry;
  const currentEntry = activeEntry || (allCompleted ? list[list.length - 1] : null);
  const priorVisits = allCompleted ? list.slice(0, -1) : list.filter((e) => e.clock_out);

  const status = !currentEntry ? 'scheduled'
    : allCompleted ? 'completed'
    : currentEntry.paused_at ? 'paused'
    : currentEntry.clock_in ? 'on_site'
    : currentEntry.travel_start ? 'omw'
    : 'scheduled';

  const visitNumber = list.length > 1 ? list.indexOf(currentEntry) + 1 : null;
  const running = status === 'omw' || status === 'on_site';

  // ── Live elapsed: one continuous span from travel_start (fallback clock_in) ──
  const startMs = currentEntry ? (ms(currentEntry.travel_start) ?? ms(currentEntry.clock_in)) : null;
  let elapsedMs = 0;
  if (startMs != null) {
    let endMs = nowMs;
    if (status === 'paused') endMs = ms(currentEntry.paused_at) ?? nowMs;
    else if (status === 'completed') endMs = ms(currentEntry.clock_out) ?? nowMs;
    elapsedMs = Math.max(0, endMs - startMs);
  }

  // ── Stale hint: an OPEN entry running ≥10h ──
  const openSinceMs = activeEntry ? (ms(activeEntry.travel_start) ?? ms(activeEntry.clock_in)) : null;
  const isStale = openSinceMs != null && (nowMs - openSinceMs) >= FORGOT_CLOCKOUT_MIN * 60 * 1000;

  // ── Breakdown numbers (WRAPPED shows travel/on-site/total, never a bare one) ──
  const travelMinutes = asNum(currentEntry?.travel_minutes);
  const onSiteMinutes = currentEntry?.hours != null ? Number(currentEntry.hours) * 60 : null;
  const totalTravelMinutes = list.reduce((s, e) => s + (asNum(e.travel_minutes) || 0), 0);
  const totalOnSiteMinutes = list.reduce((s, e) => s + (e.hours != null ? Number(e.hours) * 60 : 0), 0);

  return {
    status, entries: list, activeEntry, currentEntry, priorVisits, visitNumber,
    running, elapsedMs, isStale,
    travelMinutes, onSiteMinutes,
    totalTravelMinutes, totalOnSiteMinutes, totalMinutes: totalTravelMinutes + totalOnSiteMinutes,
  };
}

/**
 * React hook: read-only live clock state for a visit + tech.
 * Fetches the tech's own entries (cache-first via the hub persister) and ticks a
 * local "now" once a second so the elapsed time stays live while running.
 *
 * @param {object} db - authenticated client from useAuth()
 * @param {string|null} appointmentId
 * @param {string|null} employeeId
 * @param {string|null} jobId - the hub's job id (for the cache prefix)
 * @returns {ReturnType<typeof deriveVisitClock> & { loading: boolean }}
 */
export function useVisitClock(db, appointmentId, employeeId, jobId) {
  const enabled = !!(db && appointmentId && employeeId);

  const { data, isPending } = useQuery({
    // Under the hub prefix so an invalidateTech('clock') (which hits the whole
    // 'hub' kind) refreshes it; distinct id tail so different visits cache apart.
    queryKey: [...techKeys.hub(jobId || 'none'), 'clock', appointmentId, employeeId],
    queryFn: () => db.select(
      'job_time_entries',
      `appointment_id=eq.${appointmentId}&employee_id=eq.${employeeId}&select=*&order=created_at.asc`,
    ),
    enabled,
  });

  // Tick once a second only while an entry is actually running.
  const [nowMs, setNowMs] = useState(() => Date.now());
  const running = deriveVisitClock(data || [], nowMs).running;
  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  return { ...deriveVisitClock(data || [], nowMs), loading: enabled && isPending };
}
