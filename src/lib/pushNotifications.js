// Push notifications (APNs on iOS). No-op on web builds.
// Called after login in AuthContext once we have an employee.id to bind to.

import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';

export function canRegisterPush() {
  return Capacitor.isNativePlatform();
}

// Registers this device for push and upserts the token into Supabase.
// Idempotent — safe to call on every login. Silently no-ops on web.
// Returns { ok: true, token } on success, { ok: false, reason } otherwise.
export async function registerPushForEmployee(db, employeeId) {
  if (!canRegisterPush()) return { ok: false, reason: 'not_native' };
  if (!employeeId) return { ok: false, reason: 'no_employee' };

  try {
    // Check current permission; ask if undetermined
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive !== 'granted') {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== 'granted') {
      return { ok: false, reason: 'permission_denied' };
    }

    // Register — triggers APNs registration. Token arrives via 'registration' event.
    const token = await new Promise((resolve, reject) => {
      let done = false;
      const finish = (val, err) => {
        if (done) return;
        done = true;
        try { regListener?.remove(); } catch {}
        try { errListener?.remove(); } catch {}
        if (err) reject(err); else resolve(val);
      };
      let regListener, errListener;
      Promise.all([
        PushNotifications.addListener('registration', (t) => finish(t?.value || null)),
        PushNotifications.addListener('registrationError', (e) => finish(null, new Error(e?.error || 'APNs registration failed'))),
      ]).then(([r, e]) => { regListener = r; errListener = e; });

      // Kick off registration; if it rejects immediately (e.g. missing entitlement),
      // surface that as the error.
      PushNotifications.register().catch((e) => finish(null, e));

      // Safety timeout — APNs normally responds in <2s, but don't hang forever
      setTimeout(() => finish(null, new Error('APNs registration timed out')), 15000);
    });

    if (!token) return { ok: false, reason: 'no_token' };

    await db.rpc('upsert_device_token', {
      p_employee_id: employeeId,
      p_token: token,
      p_platform: 'ios',
    });

    return { ok: true, token };
  } catch (err) {
    // Don't throw — push is additive; login still succeeds without it.
    // Common reasons the .p8 isn't set up yet: "no valid aps-environment entitlement string found"
    console.warn('Push registration skipped:', err?.message || err);
    return { ok: false, reason: err?.message || 'unknown' };
  }
}
