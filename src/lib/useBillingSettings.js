/**
 * ════════════════════════════════════════════════
 * FILE: useBillingSettings.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Loads the company's payment/billing settings from the database and gives
 *   the Payment Settings screen one tidy way to change them. The important
 *   part: when you flip a setting it updates on screen instantly, but if the
 *   save to the server fails it puts the old value back — so the screen never
 *   lies about what was actually saved. This matters because these are
 *   real-money settings (surcharges, payout accounts, invoice terms).
 *
 * WHERE IT LIVES:
 *   Route:        n/a (custom hook)
 *   Rendered by:  src/pages/settings/Payments.jsx
 *
 * DEPENDS ON:
 *   Packages:  react (hooks)
 *   Internal:  none — receives the authenticated `db` client from the caller
 *              (Rule 3: components pass in `const { db } = useAuth()`).
 *   Data:      reads  → billing settings via get_billing_settings RPC
 *              writes → billing settings via set_billing_setting RPC
 *
 * NOTES / GOTCHAS:
 *   - REVERT-ON-ERROR: the old page wrote optimistic state and never rolled
 *     back on a failed RPC, so a failed save left the UI showing a value that
 *     was never persisted. `makeBillingSave` snapshots the prior value, applies
 *     the optimistic update, and restores exactly that one key if the RPC
 *     throws. Extracted as a pure factory so it can be unit-tested without a DOM
 *     (vitest runs in plain node here — no jsdom).
 *   - Values are stored as strings (set_billing_setting takes text); booleans
 *     are coerced with String(), and `on(key)` reads them back as === 'true'.
 *   - setSettings is also exposed raw: some server-side changes (the email-2FA
 *     payout-destination commit, the Stripe "Load from Stripe" probe) mutate
 *     settings through OTHER endpoints and only need the local mirror updated —
 *     they must NOT round-trip through set_billing_setting.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';

const toast = (m, t = 'error') => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: m, type: t } }));
  }
};

// ─── SECTION: Helpers ──────────────
/**
 * Pure, DOM-free factory for the revert-on-error save.
 * @param {object} deps
 * @param {(fn:string, params:object)=>Promise} deps.rpc  — the db.rpc caller
 * @param {()=>object}   deps.getSettings  — reads the current settings snapshot
 * @param {(next:object|((cur:object)=>object))=>void} deps.setSettings — React-style setter
 * @param {(err:Error)=>void} [deps.onError] — surfaces a failure (toast, log)
 * @returns {(key:string, value:*)=>Promise<boolean>} save — resolves true on success, false on revert
 */
export function makeBillingSave({ rpc, getSettings, setSettings, onError }) {
  return async function save(key, value) {
    const v = String(value);
    const prevValue = getSettings()[key];      // snapshot the exact prior value
    setSettings((cur) => ({ ...cur, [key]: v })); // optimistic
    try {
      await rpc('set_billing_setting', { p_key: key, p_value: v });
      return true;
    } catch (e) {
      // Restore ONLY the key we touched (functional update → concurrency-safe),
      // so a failed save can never leave the UI showing an unsaved value.
      setSettings((cur) => ({ ...cur, [key]: prevValue }));
      onError?.(e);
      return false;
    }
  };
}

// ─── SECTION: Hook ──────────────
export function useBillingSettings(db) {
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);

  // Ref mirror so `getSettings()` inside the save closure always reads fresh
  // state without re-creating the closure on every keystroke.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSettings((await db.rpc('get_billing_settings')) || {});
    } catch {
      toast('Failed to load settings', 'error');
    } finally {
      setLoading(false);
    }
  }, [db]);
  useEffect(() => { load(); }, [load]);

  const save = useMemo(
    () => makeBillingSave({
      rpc: (fn, params) => db.rpc(fn, params),
      getSettings: () => settingsRef.current,
      setSettings,
      onError: (e) => toast('Failed to save: ' + (e.message || e), 'error'),
    }),
    [db],
  );

  const on = useCallback((key) => settings[key] === 'true', [settings]);

  return { settings, setSettings, save, on, loading, reload: load };
}
