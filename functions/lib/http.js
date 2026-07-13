/**
 * ════════════════════════════════════════════════
 * FILE: functions/lib/http.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A safer version of fetch() for the workers. A normal fetch to an outside
 *   service (Twilio, QuickBooks, Resend, CallRail) can hang for a very long time
 *   if that service is slow or stuck — and while it hangs, the whole worker is
 *   stuck too. This wrapper puts a time limit on every outside call: if the other
 *   service does not answer within the limit, the call is aborted and the worker
 *   moves on instead of freezing.
 *
 * WHERE IT LIVES:
 *   Worker library — imported by the shared API libs (twilio.js, quickbooks.js,
 *   email.js, callrail.js) so individual workers inherit the timeout. Not a route.
 *
 * DEPENDS ON:
 *   Packages:  none (uses the platform AbortSignal.timeout)
 *   Internal:  none
 *   Data:      none
 *
 * EXPORTS:
 *   fetchWithTimeout(url, options?, timeoutMs = 15000) → Promise<Response>
 *   DEFAULT_TIMEOUT_MS = 15000
 *
 * NOTES / GOTCHAS:
 *   - On timeout the underlying fetch rejects with an AbortError; callers that
 *     already try/catch a failed fetch keep working unchanged (the throw is the
 *     same shape they handle today).
 *   - If a caller passes its own `signal`, we respect it: an explicit signal wins
 *     and the timeout is skipped (don't fight a caller that manages its own
 *     cancellation).
 * ════════════════════════════════════════════════
 */

export const DEFAULT_TIMEOUT_MS = 15000;

/**
 * fetch() with an automatic abort after `timeoutMs`.
 * @param {string|URL|Request} url
 * @param {RequestInit} [options]
 * @param {number} [timeoutMs=15000]
 * @returns {Promise<Response>}
 */
export function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  // A caller-supplied signal takes precedence — never override explicit cancellation.
  if (options.signal) return fetch(url, options);

  // AbortSignal.timeout is available in Cloudflare Workers / modern V8.
  const signal =
    typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(timeoutMs)
      : undefined;

  return fetch(url, signal ? { ...options, signal } : options);
}
