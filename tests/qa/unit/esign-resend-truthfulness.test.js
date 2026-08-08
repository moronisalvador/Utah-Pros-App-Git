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
    expect(worker).toContain('success: true,');
    expect(worker).toContain('signing_url: signingUrl,');
  });

  it('reports per-channel truth so success: true can never mean "delivered"', () => {
    // This is the whole point of ESIGN-03. `success` says the REQUEST was handled;
    // it has never meant a message went out. Since 2026-08-08 the worker can send
    // on two channels, so one boolean cannot carry the answer: `delivered` says
    // whether ANY channel landed and `results` carries each channel's own verdict.
    expect(worker).toContain('const anyDelivered = Object.values(results).some((r) => r.ok);');
    expect(worker).toContain('delivered: anyDelivered,');
    expect(worker).toContain('results,');
    // The pre-2026-08-08 email_error shape is still emitted, because the tech page
    // reads it to show "Email failed: …" rather than a generic message.
    expect(worker).toContain('email_error: true');
  });

  it('fails closed with a non-2xx when the REQUEST cannot proceed', () => {
    for (const shape of [
      "{ error: 'Sign request not found' }",
      "{ error: 'Document already signed — cannot resend' }",
      "{ error: 'Sign request is cancelled' }",
    ]) {
      expect(worker, shape).toContain(shape);
    }
  });

  it('no longer refuses the whole request when only the EMAIL credential is missing', () => {
    // Deliberate contract change, 2026-08-08. A missing RESEND_API_KEY used to 500
    // the endpoint outright. Once SMS resend existed that became wrong: it refused
    // a text this worker could send perfectly well, on the grounds that an unrelated
    // email credential was absent. The condition now degrades that ONE channel.
    expect(worker).not.toContain("{ error: 'RESEND_API_KEY missing' }");
    expect(worker).toContain("results.email = { ok: false, reason: 'email_not_configured' };");
  });
});

describe('ESIGN-03b — the SMS resend cannot become a second send door', () => {
  it('texts through the staff chokepoint, never a provider directly', () => {
    // AGENTS.md §14: consent, DND, opt-out, provider selection and the conversation
    // row all live in /api/send-message. A direct Twilio call here would bypass the
    // consent gate AND leave the customer thread with no record of the reminder.
    expect(worker).toContain("/api/send-message");
    expect(worker).not.toMatch(/api\.twilio\.com|TWILIO_ACCOUNT_SID|sendGatedSms/);
  });

  it('catches a provider rejection that rides inside a 201', () => {
    // The same false-success send-esign.js already had to fix: send-message answers
    // 201 even when the carrier refuses, with the failure in the body.
    expect(worker).toContain('const providerRejected = Boolean(');
    expect(worker).toContain('sendJson?.error_code');
  });

  it('refuses an email channel with no address instead of emailing null', () => {
    // A link originally TEXTED to a contact with no email leaves signer_email null;
    // the old code handed sendEmail `to: { email: null }`.
    expect(worker).toContain("results.email = { ok: false, reason: 'no_email_on_file' };");
  });

  it('only resets email open tracking when an email actually went out', () => {
    // Resetting it after an SMS-only resend would report the customer never opened
    // an email that was never sent.
    expect(worker).toContain('if (emailSent) { patch.email_opened_at = null; patch.email_open_count = 0; }');
  });

  it('defaults to email so existing { sign_request_id } callers are unchanged', () => {
    expect(worker).toContain("if (raw === undefined || raw === null) return ['email'];");
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
