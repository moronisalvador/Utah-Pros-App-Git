/**
 * ════════════════════════════════════════════════
 * FILE: forms.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the pure helpers behind CRM Forms are safe and strict. Three things
 *   are checked: (1) the little link-markup formatter can never be tricked into
 *   injecting a <script> or a javascript: link (XSS), (2) the submission
 *   validator rejects a form that is missing a required field or has a badly
 *   typed value, and (3) the spam gate catches the two cheapest bot tells — a
 *   filled honeypot and a form submitted impossibly fast.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  functions/lib/forms.js (the module under test)
 *
 * NOTES / GOTCHAS:
 *   - Pure unit tests, no DB — committed before functions/lib/forms.js existed
 *     (Phase 10 test-first requirement). The public-endpoint + consent + XSS
 *     surface is exactly what the Phase 10 reviewer weights, so these are the
 *     load-bearing tests.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import {
  sanitizeLinkMarkup,
  escapeHtml,
  validateSubmission,
  checkSpam,
  consentValue,
  MIN_FILL_MS,
} from './forms.js';

describe('sanitizeLinkMarkup — XSS resistance', () => {
  it('escapes raw HTML instead of rendering it', () => {
    const out = sanitizeLinkMarkup('<script>alert(1)</script>');
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('escapes an <img onerror> injection', () => {
    const out = sanitizeLinkMarkup('<img src=x onerror=alert(1)>');
    expect(out).not.toContain('<img');       // never a live tag
    expect(out).toContain('&lt;img');        // neutralized to inert escaped text
  });

  it('converts a safe [text](https://…) link into a rel-protected anchor', () => {
    const out = sanitizeLinkMarkup('See our [privacy policy](https://utahpros.app/privacy) here.');
    expect(out).toContain('<a href="https://utahpros.app/privacy"');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
    expect(out).toContain('>privacy policy</a>');
  });

  it('allows mailto: links', () => {
    const out = sanitizeLinkMarkup('Email [us](mailto:hi@utahpros.app).');
    expect(out).toContain('href="mailto:hi@utahpros.app"');
  });

  it('REFUSES a javascript: URL — no anchor, no executable href', () => {
    const out = sanitizeLinkMarkup('[click](javascript:alert(document.cookie))');
    expect(out.toLowerCase()).not.toContain('href="javascript:');
    expect(out).not.toContain('<a ');
  });

  it('REFUSES a data: URL', () => {
    const out = sanitizeLinkMarkup('[x](data:text/html,<script>alert(1)</script>)');
    expect(out.toLowerCase()).not.toContain('href="data:');
    expect(out).not.toContain('<script>');
  });

  it('escapes quotes/brackets inside the link label so the anchor cannot be broken out of', () => {
    const out = sanitizeLinkMarkup('[a"><script>x](https://ok.com)');
    expect(out).not.toContain('<script>');
    expect(out).toContain('href="https://ok.com"');
  });

  it('escapeHtml handles &, <, >, ", \'', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});

// Minimal schema helper for validation tests.
const schema = {
  fields: [
    { key: 'name',    type: 'text',     label: 'Name',    required: true },
    { key: 'phone',   type: 'phone',    label: 'Phone',   required: true },
    { key: 'email',   type: 'email',    label: 'Email',   required: false },
    { key: 'service', type: 'select',   label: 'Service', required: false, options: ['Water', 'Fire'] },
    { key: 'when',    type: 'date',     label: 'When',    required: false },
    { key: 'consent', type: 'consent',  label: 'I agree', required: true },
  ],
};

describe('validateSubmission — server-side schema validation', () => {
  it('accepts a well-formed submission', () => {
    const r = validateSubmission(schema, {
      name: 'Jane', phone: '801-447-1917', email: 'jane@x.com',
      service: 'Water', when: '2026-07-02', consent: true,
    });
    expect(r.valid).toBe(true);
    expect(Object.keys(r.errors)).toHaveLength(0);
  });

  it('rejects a missing required field (name)', () => {
    const r = validateSubmission(schema, { phone: '8014471917', consent: true });
    expect(r.valid).toBe(false);
    expect(r.errors.name).toBeTruthy();
  });

  it('rejects a required consent that is not checked', () => {
    const r = validateSubmission(schema, { name: 'Jane', phone: '8014471917', consent: false });
    expect(r.valid).toBe(false);
    expect(r.errors.consent).toBeTruthy();
  });

  it('rejects a bad email type', () => {
    const r = validateSubmission(schema, { name: 'Jane', phone: '8014471917', email: 'not-an-email', consent: true });
    expect(r.valid).toBe(false);
    expect(r.errors.email).toBeTruthy();
  });

  it('rejects a phone with too few digits', () => {
    const r = validateSubmission(schema, { name: 'Jane', phone: '123', consent: true });
    expect(r.valid).toBe(false);
    expect(r.errors.phone).toBeTruthy();
  });

  it('rejects a select value that is not one of the options', () => {
    const r = validateSubmission(schema, { name: 'Jane', phone: '8014471917', service: 'Nope', consent: true });
    expect(r.valid).toBe(false);
    expect(r.errors.service).toBeTruthy();
  });

  it('rejects an unparseable date', () => {
    const r = validateSubmission(schema, { name: 'Jane', phone: '8014471917', when: 'yesterday', consent: true });
    expect(r.valid).toBe(false);
    expect(r.errors.when).toBeTruthy();
  });
});

describe('checkSpam — honeypot + minimum fill time', () => {
  it('flags a filled honeypot', () => {
    const r = checkSpam({ honeypot: 'http://bot.example', elapsedMs: 99999 });
    expect(r.spam).toBe(true);
    expect(r.reason).toBe('honeypot');
  });

  it('flags an impossibly fast fill', () => {
    const r = checkSpam({ honeypot: '', elapsedMs: 200 });
    expect(r.spam).toBe(true);
    expect(r.reason).toBe('too_fast');
  });

  it('passes a real human submission', () => {
    const r = checkSpam({ honeypot: '', elapsedMs: MIN_FILL_MS + 5000 });
    expect(r.spam).toBe(false);
    expect(r.reason).toBe(null);
  });
});

describe('validateSubmission — checkbox multi-select group', () => {
  const groupSchema = {
    fields: [
      { key: 'services', type: 'checkbox', label: 'Which services?', required: true, options: ['Water', 'Fire', 'Mold'] },
    ],
  };
  const optionalGroup = {
    fields: [{ key: 'extras', type: 'checkbox', label: 'Extras', required: false, options: ['A', 'B'] }],
  };

  it('accepts one or more chosen options (array value)', () => {
    expect(validateSubmission(groupSchema, { services: ['Water'] }).valid).toBe(true);
    expect(validateSubmission(groupSchema, { services: ['Water', 'Mold'] }).valid).toBe(true);
  });

  it('rejects a required group with nothing selected (empty array / missing)', () => {
    expect(validateSubmission(groupSchema, { services: [] }).errors.services).toBeTruthy();
    expect(validateSubmission(groupSchema, {}).errors.services).toBeTruthy();
  });

  it('rejects a chosen value that is not one of the options', () => {
    const r = validateSubmission(groupSchema, { services: ['Water', 'Nope'] });
    expect(r.valid).toBe(false);
    expect(r.errors.services).toBeTruthy();
  });

  it('an optional group with nothing selected is valid', () => {
    expect(validateSubmission(optionalGroup, { extras: [] }).valid).toBe(true);
    expect(validateSubmission(optionalGroup, {}).valid).toBe(true);
  });

  it('legacy single checkbox (no options) keeps boolean semantics', () => {
    const legacy = { fields: [{ key: 'agree', type: 'checkbox', label: 'Agree', required: true }] };
    expect(validateSubmission(legacy, { agree: false }).errors.agree).toBeTruthy();
    expect(validateSubmission(legacy, { agree: true }).valid).toBe(true);
  });
});

describe('consentValue', () => {
  it('reads the consent field truthiness', () => {
    expect(consentValue(schema, { consent: true })).toBe(true);
    expect(consentValue(schema, { consent: 'on' })).toBe(true);
    expect(consentValue(schema, { consent: false })).toBe(false);
    expect(consentValue(schema, {})).toBe(false);
  });

  it('returns false when the form has no consent field', () => {
    expect(consentValue({ fields: [{ key: 'name', type: 'text' }] }, { name: 'x' })).toBe(false);
  });
});
