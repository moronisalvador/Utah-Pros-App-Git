/**
 * ════════════════════════════════════════════════
 * FILE: webPushClient.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The browser side of push notifications. When someone taps "Enable push on
 *   this device", this asks the browser for permission, registers the device
 *   with the browser's push service, and saves the resulting subscription (the
 *   secret address the server pushes to) into our database. It also handles
 *   turning push OFF again. It only reports what actually happened — it never
 *   pretends success.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (browser helper)
 *   Rendered by:  n/a — imported by the Settings "Notifications" panel (and,
 *                 later, the tech notifications screen)
 *
 * DEPENDS ON:
 *   Packages:  none (browser Push API + Notification API)
 *   Internal:  none directly — the caller passes in `db` (useAuth().db)
 *   Data:      writes → push_subscriptions (via upsert_push_subscription /
 *              delete_push_subscription RPCs)
 *
 * NOTES / GOTCHAS:
 *   - iOS only exposes the Push API in an INSTALLED PWA (Add to Home Screen).
 *     In mobile Safari (not installed) `PushManager`/`Notification` are absent —
 *     isPushSupported() returns false and the UI must show install guidance.
 *   - applicationServerKey must be the RAW VAPID public key as a Uint8Array;
 *     VITE_VAPID_PUBLIC_KEY holds it base64url. Missing env = push unconfigured.
 *   - The SW is registered by main.jsx (flag-gated). Here we wait for
 *     navigator.serviceWorker.ready rather than registering again.
 * ════════════════════════════════════════════════
 */

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || '';

// ─── SECTION: capability + state ───

/** True only where real Web Push works (SW + PushManager + Notification). */
export function isPushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** True when the VAPID public key is configured in this build. */
export function isPushConfigured() {
  return !!VAPID_PUBLIC_KEY;
}

/** Current Notification permission ('default' | 'granted' | 'denied' | 'unsupported'). */
export function pushPermission() {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

/** Whether this device already has an active push subscription. */
export async function getExistingSubscription() {
  if (!isPushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

// ─── SECTION: helpers ───

// base64url VAPID public key → Uint8Array for applicationServerKey.
function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// A PushSubscription's keys are ArrayBuffers — encode them base64url for the RPC.
function subscriptionKeys(sub) {
  const json = sub.toJSON();
  return {
    endpoint: sub.endpoint,
    p256dh: json.keys?.p256dh || '',
    auth: json.keys?.auth || '',
  };
}

// ─── SECTION: subscribe / unsubscribe ───

/**
 * Subscribe THIS device to push and persist it. Returns
 * { ok, reason?, subscription? }. `reason` is a short machine code the UI maps
 * to a message: 'unsupported' | 'unconfigured' | 'denied' | 'error'.
 */
export async function enablePush(db) {
  if (!isPushSupported()) return { ok: false, reason: 'unsupported' };
  if (!isPushConfigured()) return { ok: false, reason: 'unconfigured' };

  // Ask for permission (idempotent — a prior grant resolves immediately).
  let permission;
  try {
    permission = await Notification.requestPermission();
  } catch {
    return { ok: false, reason: 'error' };
  }
  if (permission !== 'granted') return { ok: false, reason: 'denied' };

  try {
    const reg = await navigator.serviceWorker.ready;
    // Reuse an existing subscription if present, else create one.
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    const keys = subscriptionKeys(sub);
    await db.rpc('upsert_push_subscription', {
      p_endpoint: keys.endpoint,
      p_p256dh: keys.p256dh,
      p_auth: keys.auth,
      p_user_agent: (typeof navigator !== 'undefined' && navigator.userAgent) || null,
    });
    return { ok: true, subscription: sub };
  } catch (err) {
    console.warn('[push] enable failed', err);
    return { ok: false, reason: 'error' };
  }
}

/**
 * Unsubscribe THIS device and remove its stored row. Returns { ok }.
 * Best-effort: we delete the DB row even if the browser unsubscribe hiccups.
 */
export async function disablePush(db) {
  try {
    const sub = await getExistingSubscription();
    if (sub) {
      const { endpoint } = subscriptionKeys(sub);
      try { await db.rpc('delete_push_subscription', { p_endpoint: endpoint }); } catch { /* row may already be gone */ }
      await sub.unsubscribe();
    }
    return { ok: true };
  } catch (err) {
    console.warn('[push] disable failed', err);
    return { ok: false };
  }
}
