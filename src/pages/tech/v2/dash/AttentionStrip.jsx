/**
 * ════════════════════════════════════════════════
 * FILE: AttentionStrip.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The row of "hey, look at this" banners under the dashboard header. It warns a
 *   tech when they've walked away from a jobsite while a job is still running
 *   (using their phone's location), reminds them after 5 PM if they're still
 *   clocked in so a job doesn't quietly run till midnight, and shows the shared
 *   "stalled materials" widget. Each banner is additive — if there's nothing to
 *   flag, the strip shows nothing.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (section of the dashboard)
 *   Rendered by:  src/pages/tech/v2/TechDashV2.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  @/components/tech/StalledWidget, @/lib/nativeGeolocation,
 *              @/lib/nativeHaptics, @/lib/toast
 *   Data:      reads  → get_active_appointment_geo (jobsite arrival coords)
 *              writes → clock_appointment_action (pause / finish from the away
 *                        banner), clock_finish_entry (finish from the 5 PM banner)
 *
 * NOTES / GOTCHAS:
 *   - Geolocation runs FOREGROUND-ONLY and is gated on the `active` prop (this
 *     pane being the visible tab) — a hidden persistent pane must not poll GPS.
 *     It is also debounced to once per 20s and fails silently.
 *   - The 5 PM "still clocked in" banner reads the open entry straight from the
 *     get_tech_dashboard payload (no extra query). The midnight auto-split is the
 *     backend safety net; this is the proactive nudge.
 *   - Resolving a banner calls onResolved() so the dashboard cache invalidates
 *     via techQuery's map instead of a full refetch.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import StalledWidget from '@/components/tech/StalledWidget';
import { getCurrentCoords, distanceMeters } from '@/lib/nativeGeolocation';
import { notify, impact } from '@/lib/nativeHaptics';
import { toast } from '@/lib/toast';

const AWAY_THRESHOLD_M = 200;

// Current hour (0-23) in America/Denver — the company timezone of record.
function denverHour() {
  try {
    const h = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', hour: 'numeric', hour12: false }).format(new Date());
    return parseInt(h, 10) % 24;
  } catch {
    return new Date().getHours();
  }
}

/**
 * @param {{ employee: object, db: object, active?: boolean, openEntry: object|null,
 *           onResolved?: () => void }} props
 */
export default function AttentionStrip({ employee, db, active = true, openEntry, onResolved }) {
  const navigate = useNavigate();
  const [away, setAway] = useState(null);
  const [awayActing, setAwayActing] = useState(false);
  const [awayConfirmFinish, setAwayConfirmFinish] = useState(false);
  const awayConfirmTimer = useRef(null);
  const lastAwayCheck = useRef(0);

  // ── Away-from-jobsite check (foreground + active only, debounced 20s) ──
  const checkAway = useCallback(async () => {
    const now = Date.now();
    if (now - lastAwayCheck.current < 20_000) return;
    lastAwayCheck.current = now;
    try {
      const act = await db.rpc('get_active_appointment_geo', { p_employee_id: employee.id });
      if (!act || act.clock_in_lat == null || act.clock_in_lng == null) { setAway(null); return; }
      const here = await getCurrentCoords({ timeoutMs: 6000 });
      if (!here) return;
      const meters = distanceMeters(here, { lat: act.clock_in_lat, lng: act.clock_in_lng });
      if (!Number.isFinite(meters) || meters < AWAY_THRESHOLD_M) { setAway(null); return; }
      setAway({
        appointment_id: act.appointment_id,
        title: act.title || 'Active appointment',
        address: [act.address, act.city].filter(Boolean).join(', '),
        status: act.status,
        distance: Math.round(meters),
      });
    } catch { /* silent — the nudge is additive, never blocks the dashboard */ }
  }, [db, employee.id]);

  useEffect(() => {
    if (!active) return undefined;
    checkAway();
    const onVis = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') checkAway();
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVis);
      return () => document.removeEventListener('visibilitychange', onVis);
    }
    return undefined;
  }, [active, checkAway]);

  useEffect(() => () => { if (awayConfirmTimer.current) clearTimeout(awayConfirmTimer.current); }, []);

  const resolveAway = useCallback(async (action) => {
    if (!away) return;
    if (action === 'finish' && !awayConfirmFinish) {
      setAwayConfirmFinish(true);
      impact('light');
      awayConfirmTimer.current = setTimeout(() => setAwayConfirmFinish(false), 3000);
      return;
    }
    setAwayConfirmFinish(false);
    if (awayConfirmTimer.current) clearTimeout(awayConfirmTimer.current);
    setAwayActing(true);
    try {
      const coords = await getCurrentCoords({ timeoutMs: 4000 }).catch(() => null);
      await db.rpc('clock_appointment_action', {
        p_appointment_id: away.appointment_id,
        p_employee_id: employee.id,
        p_action: action,
        p_lat: coords?.lat ?? null, p_lng: coords?.lng ?? null, p_accuracy: coords?.accuracy ?? null,
      });
      setAway(null);
      lastAwayCheck.current = 0;
      notify('success');
      if (onResolved) onResolved();
    } catch (e) {
      toast('Action failed: ' + e.message, 'error');
    } finally {
      setAwayActing(false);
    }
  }, [away, awayConfirmFinish, db, employee.id, onResolved]);

  // ── 5 PM "still clocked in" nudge (reads openEntry from the payload) ──
  const finishOpenClock = useCallback(async () => {
    if (!openEntry) return;
    if (openEntry.appointment_id) { navigate(`/tech/appointment/${openEntry.appointment_id}`); return; }
    try {
      await db.rpc('clock_finish_entry', { p_entry_id: openEntry.id, p_employee_id: employee.id });
      notify('success');
      toast('Clocked out', 'success');
      if (onResolved) onResolved();
    } catch (e) {
      toast('Could not clock out: ' + e.message, 'error');
    }
  }, [openEntry, db, employee.id, navigate, onResolved]);

  const showOvertime = openEntry && openEntry.clock_out == null && denverHour() >= 17;

  return (
    <div className="tv2-dash-attention">
      <StalledWidget />

      {away && (
        <div className="tv2-dash-banner tv2-dash-banner--warn">
          <div className="tv2-dash-banner__row">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="tv2-dash-banner__icon">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><line x1="12" y1="7" x2="12" y2="13" /><circle cx="12" cy="16" r="1" />
            </svg>
            <div className="tv2-dash-banner__text">
              <div className="tv2-dash-banner__title">You're ~{away.distance}m from the jobsite</div>
              <div className="tv2-dash-banner__body">
                {away.title}{away.address ? ` · ${away.address}` : ''} is still {away.status === 'paused' ? 'paused' : 'running'}. Pause it or mark it finished.
              </div>
            </div>
          </div>
          <div className="tv2-dash-banner__actions">
            {away.status !== 'paused' && (
              <button type="button" className="tv2-dash-banner__btn" disabled={awayActing} onClick={() => resolveAway('pause')} onBlur={() => setAwayConfirmFinish(false)}>
                Pause
              </button>
            )}
            <button type="button" className="tv2-dash-banner__btn tv2-dash-banner__btn--primary" disabled={awayActing} onClick={() => resolveAway('finish')} onBlur={() => setAwayConfirmFinish(false)}>
              {awayConfirmFinish ? 'Tap again to Finish' : 'Finish'}
            </button>
          </div>
        </div>
      )}

      {showOvertime && (
        <div className="tv2-dash-banner tv2-dash-banner--alert">
          <div className="tv2-dash-banner__row">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="tv2-dash-banner__icon">
              <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
            </svg>
            <div className="tv2-dash-banner__text">
              <div className="tv2-dash-banner__title">You're still clocked in</div>
              <div className="tv2-dash-banner__body">It's past 5 PM and a job is still running. Finish it before you head home — otherwise it auto-closes at midnight.</div>
            </div>
          </div>
          <button type="button" className="tv2-dash-banner__btn tv2-dash-banner__btn--alert tv2-dash-banner__btn--full" onClick={finishOpenClock}>
            {openEntry.appointment_id ? 'Finish my day' : 'Clock out now'}
          </button>
        </div>
      )}
    </div>
  );
}
