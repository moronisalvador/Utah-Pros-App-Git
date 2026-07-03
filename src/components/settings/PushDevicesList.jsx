/**
 * ════════════════════════════════════════════════
 * FILE: PushDevicesList.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Lists the devices (phones, computers) that have turned on push notifications
 *   for this person, showing a friendly name and when each was added. The device
 *   you're on right now is marked "This device" and can be removed here with a
 *   two-tap confirm — which fully unsubscribes it (both in the browser and in our
 *   database). Other devices are shown for awareness only; a stale one drops off
 *   by itself once it stops responding.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (rendered inside /settings → Notifications)
 *   Rendered by:  src/pages/Settings.jsx (NotificationsPanel)
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/lib/toast (toast), @/lib/webPushClient
 *              (getExistingSubscription/disablePush)
 *   Data:      reads  → get_my_push_subscriptions RPC (label + created_at +
 *                       endpoint hash ONLY — never the send secrets)
 *              writes → delete_push_subscription (indirectly, via disablePush)
 *
 * NOTES / GOTCHAS:
 *   - The listing never returns the raw endpoint/p256dh/auth (those are
 *     send-capability secrets). To recognise "this device" we SHA-256 the current
 *     browser subscription's endpoint locally and match the truncated hash the
 *     server sends — no secret ever leaves the browser or the RPC.
 *   - Only the current device is removable here: unsubscribing another browser's
 *     push registration isn't possible from this one, and we deliberately don't
 *     expose the endpoint that delete_push_subscription needs. Dead endpoints
 *     self-prune server-side (the sender drops 404/410 subscriptions).
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback } from 'react';
import { toast } from '@/lib/toast';
import { getExistingSubscription, disablePush } from '@/lib/webPushClient';

// SHA-256 → hex, first 16 chars — matches get_my_push_subscriptions' endpoint_hash.
async function endpointHash(endpoint) {
  try {
    const bytes = new TextEncoder().encode(endpoint);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    return hex.slice(0, 16);
  } catch { return null; }
}

// Turn a stored user-agent into something readable at a glance.
function prettyDevice(ua) {
  if (!ua) return 'Unknown device';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android device';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows PC';
  if (/CrOS/i.test(ua)) return 'Chromebook';
  return 'Browser';
}

function fmtDate(iso) {
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return ''; }
}

export default function PushDevicesList({ db, employeeId }) {
  const [loading, setLoading] = useState(true);
  const [devices, setDevices] = useState([]);
  const [currentHash, setCurrentHash] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!employeeId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [rows, sub] = await Promise.all([
        db.rpc('get_my_push_subscriptions', { p_employee_id: employeeId }),
        getExistingSubscription(),
      ]);
      setDevices(rows || []);
      setCurrentHash(sub?.endpoint ? await endpointHash(sub.endpoint) : null);
    } catch {
      setDevices([]);
    } finally { setLoading(false); }
  }, [db, employeeId]);
  useEffect(() => { load(); }, [load]);

  const removeCurrent = async (id) => {
    if (confirmId !== id) { setConfirmId(id); setTimeout(() => setConfirmId(null), 3000); return; }
    setConfirmId(null);
    setBusy(true);
    try {
      const res = await disablePush(db);      // real pushManager.unsubscribe + delete_push_subscription
      if (res.ok) { toast('Removed this device', 'success'); await load(); }
      else toast('Could not remove this device — please try again.', 'error');
    } finally { setBusy(false); }
  };

  if (loading) return <div className="notif-devices-loading">Loading devices…</div>;
  if (!devices.length) return null; // nothing registered yet — the enable row above covers it

  // ─── Render ──────────────
  return (
    <div className="notif-devices">
      <div className="notif-devices-title">Your devices</div>
      {devices.map(d => {
        const isCurrent = currentHash && d.endpoint_hash === currentHash;
        const confirming = confirmId === d.id;
        return (
          <div key={d.id} className="notif-device-row">
            <div className="notif-device-main">
              <div className="notif-device-name">
                {prettyDevice(d.label)}
                {isCurrent && <span className="notif-device-badge">This device</span>}
              </div>
              <div className="notif-device-sub">
                Added {fmtDate(d.created_at)}
                {!isCurrent && ' · removed automatically when it stops responding'}
              </div>
            </div>
            {isCurrent && (
              <button
                type="button"
                className="btn btn-sm notif-device-remove"
                data-confirm={confirming ? 'true' : 'false'}
                onClick={() => removeCurrent(d.id)}
                onBlur={() => setConfirmId(null)}
                disabled={busy}
              >
                {confirming ? 'Confirm remove' : busy ? 'Removing…' : 'Remove'}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
