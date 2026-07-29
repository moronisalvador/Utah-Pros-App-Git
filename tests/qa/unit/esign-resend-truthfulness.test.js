/**
 * ESIGN-03 — the resend button must not claim an email nobody sent.
 *
 * Third and last of the false-successes the flow audit found. The pattern in all
 * three was the same: infer success from an HTTP status instead of from the
 * worker's own answer. `res.json().catch(() => ({}))` turns any non-JSON body
 * into an empty object, so a 200 carrying something that is not this worker's
 * reply produced `{}`, `res.ok` was true, `json.email_error` was undefined, and
 * the tech saw "Reminder sent to <email>".
 *
 * That is precisely what the native app did while it answered /api from its own
 * bundle — and the failure is invisible, because a reminder that was never sent
 * looks exactly like one the customer ignored.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const page = read('src/pages/tech/TechJobDocuments.jsx');
const worker = read('functions/api/resend-esign.js');

describe('ESIGN-03 — the client requires the worker to say it succeeded', () => {
  it('rejects a 200 that does not carry success: true', () => {
    expect(page).toContain("if (json.success !== true) throw new Error(json.error || 'Resend did not complete');");
  });

  it('still rejects a non-2xx first', () => {
    expect(page).toContain("if (!res.ok) throw new Error(json.error || 'Failed to resend');");
  });

  it('orders the checks so a real worker error message wins', () => {
    // The !res.ok branch carries the worker's own `error`; reversing these would
    // replace a useful message with the generic one.
    const okAt = page.indexOf("if (!res.ok) throw new Error(json.error");
    const successAt = page.indexOf('if (json.success !== true)');
    expect(okAt).toBeGreaterThan(-1);
    expect(successAt).toBeGreaterThan(okAt);
  });

  it('keeps surfacing a real email failure rather than a generic one', () => {
    // The worker answers 200 { success: true, email_error: true } when Resend
    // rejects. That must stay a specific message, not become "did not complete".
    expect(page).toContain('json.email_error ? `Email failed:');
  });
});

describe('ESIGN-03 — the worker contract relied on', () => {
  it('returns success: true on the happy path', () => {
    expect(worker).toContain('{ success: true, signing_url: signingUrl }');
  });

  it('also returns success: true alongside email_error', () => {
    // Why the client cannot simply treat any success:true as "email delivered".
    expect(worker).toContain('success:            true,');
    expect(worker).toContain('email_error:        true,');
  });

  it('fails closed with a non-2xx when it cannot send at all', () => {
    for (const shape of [
      "{ error: 'RESEND_API_KEY missing' }",
      "{ error: 'Sign request not found' }",
      "{ error: 'Document already signed — cannot resend' }",
    ]) {
      expect(worker, shape).toContain(shape);
    }
  });
});

describe('all three false-successes are closed', () => {
  it('send-esign catches a provider rejection inside a 201', () => {
    expect(read('functions/api/send-esign.js')).toContain('const providerRejected = Boolean(');
  });

  it('the Scope Sheet requires the Encircle worker ok flag', () => {
    expect(read('src/pages/tech/TechDemoSheet.jsx')).toContain('encircleOk = r.ok && d?.ok === true;');
  });

  it('resend requires success: true', () => {
    expect(page).toContain('json.success !== true');
  });
});
