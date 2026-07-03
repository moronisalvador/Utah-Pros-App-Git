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
 * IMPORTED BY:
 *   the Settings "Notifications" panel (and, later, the tech notifications screen).
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
 *   - applicationServerKey must be the RAW VAPID public key as a Uint8Array. The
 *     key is fetched at RUNTIME from GET /api/vapid-public-key (which reads it
 *     from Cloudflare env OR Supabase) — no build-time env var needed, so the
 *     owner can configure VAPID entirely in the database.
 *   - main.jsx registers the SW flag-gated at page-load, but the flag mirror is
 *     written only AFTER login, so a first-time user's worker may not be up when
 *     they click Enable. enablePush therefore registers /sw.js on-demand
 *     (idempotent); reads use getRegistration() (never the hang-prone
 *     serviceWorker.ready) so the panel never gets stuck on "Checking…".
 * ════════════════════════════════════════════════
 */

// Cached across calls: undefined = not fetched, '' = unconfigured, string = key.
let _vapidPublicKey;

/**
 * Fetch (and memoize) the VAPID public key from the server. Returns '' when push
 * isn't configured yet. Never throws — a network hiccup reads as unconfigured.
 */
export async function getVapidPublicKey() {
  if (_vapidPublicKey !== undefined) return _vapidPublicKey;
  try {
    const res = await fetch('/api/vapid-public-key');
    const data = await res.json().catch(() => ({}));
    _vapidPublicKey = data && data.publicKey ? data.publicKey : '';
  } catch {
    _vapidPublicKey = '';
  }
  return _vapidPublicKey;
}

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

/** True when the server has a VAPID public key configured (async — fetches once). */
export async function isPushConfigured() {
  return !!(await getVapidPublicKey());
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
    // getRegistration() resolves IMMEDIATELY (null if none) — unlike
    // serviceWorker.ready, which hangs forever when no worker is registered.
    const reg = await navigator.serviceWorker.getRegistration('/');
    if (!reg) return null;
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

// ─── SECTION: helpers ───

/**
 * Ensure a push service worker is registered AND active, then return it.
 * Registers /sw.js on-demand: main.jsx registers it flag-gated at page-load, but
 * the flag mirror is written only AFTER login, so a first-time user's worker may
 * not be up yet when they click Enable. register() is idempotent (returns the
 * existing registration if any), and serviceWorker.ready then resolves because a
 * registration now exists — avoiding the "Enabling…" hang on the first try.
 */
async function ensureRegistration() {
  await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  return navigator.serviceWorker.ready;
}

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
  const publicKey = await getVapidPublicKey();
  if (!publicKey) return { ok: false, reason: 'unconfigured' };

  // Ask for permission (idempotent — a prior grant resolves immediately).
  let permission;
  try {
    permission = await Notification.requestPermission();
  } catch {
    return { ok: false, reason: 'error' };
  }
  if (permission !== 'granted') return { ok: false, reason: 'denied' };

  try {
    const reg = await ensureRegistration();
    // Reuse an existing subscription if present, else create one.
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
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
