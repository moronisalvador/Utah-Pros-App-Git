/**
 * ════════════════════════════════════════════════
 * FILE: sign-request-token-pii-redaction.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A link we text or email to a customer carries a secret code. This checks the
 *   database change that stops that code from handing out the customer's name,
 *   address, claim number and policy number after the document has already been
 *   signed or has expired — while keeping it working normally while it can still
 *   be signed. It also checks that the two programs which read that link still
 *   look at the document's status BEFORE they use any of the withheld details,
 *   because if they didn't, this change would break signing.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path
 *   Internal:  supabase/migrations/20260808040000_sign_request_token_pii_redaction.sql
 *              and its rollback; src/pages/SignPage.jsx; functions/api/submit-esign.js
 *   Data:      reads  → migration, rollback and caller source text
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This proves INTENT, not EFFECT (close-out-standard.md §2b). It reads the
 *     migration as text; it cannot prove the function is applied or that
 *     PostgREST resolves it. The behavioural proof belongs in the apply window.
 *   - The caller-ordering assertions are the ones that would actually catch a
 *     break. If someone reorders SignPage or submit-esign so `.job` is read
 *     before the status check, redaction turns a signed document into a crash —
 *     and these fail first.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const MIGRATION_PATH = 'supabase/migrations/20260808040000_sign_request_token_pii_redaction.sql';
const ROLLBACK_PATH  = 'supabase/rollbacks/20260808040000_sign_request_token_pii_redaction.rollback.sql';

const MIGRATION = read(MIGRATION_PATH);
const ROLLBACK  = read(ROLLBACK_PATH);
const SIGN_PAGE = read('src/pages/SignPage.jsx');
const SUBMIT    = read('functions/api/submit-esign.js');

/** Strip `--` comment lines so an assertion reads executable SQL, not prose. */
const sqlOnly = (sql) => sql
  .split('\n')
  .filter(line => !line.trimStart().startsWith('--'))
  .join('\n');

/** Everything the token must stop handing out once the link is spent. */
const WITHHELD_JOB_FIELDS = [
  'insured_name', 'address', 'city', 'state', 'zip',
  'date_of_loss', 'insurance_company', 'claim_number',
  'policy_number', 'adjuster_name',
];

/** Everything the status screens still read, which must NEVER be gated. */
const ALWAYS_RETURNED = ['id', 'token', 'doc_type', 'divisions', 'status', 'expires_at', 'signed_at'];

describe('migration shape', () => {
  it('ships a paired rollback', () => {
    expect(existsSync(join(ROOT, ROLLBACK_PATH))).toBe(true);
  });

  it('replaces a body only — no table, policy, grant-widening or data change', () => {
    expect(MIGRATION).not.toMatch(/\bALTER TABLE\b/i);
    expect(MIGRATION).not.toMatch(/\bDROP\b/i);
    expect(MIGRATION).not.toMatch(/\bCREATE POLICY\b/i);
    expect(MIGRATION).not.toMatch(/\b(INSERT INTO|UPDATE |DELETE FROM)\b/i);
  });

  it('keeps the signature and return type callable by the deployed frontend', () => {
    // database-standard.md §3 frontend-contract freeze: a deployed SignPage is
    // already calling this exact signature.
    expect(MIGRATION).toContain('FUNCTION public.get_sign_request_by_token(p_token text)');
    expect(MIGRATION).toContain('RETURNS jsonb');
    expect(ROLLBACK).toContain('FUNCTION public.get_sign_request_by_token(p_token text)');
    expect(ROLLBACK).toContain('RETURNS jsonb');
  });

  it('keeps the definer hardening: pinned search_path, REVOKE before GRANT', () => {
    for (const [label, sql] of [['migration', MIGRATION], ['rollback', ROLLBACK]]) {
      expect(sql, label).toContain('SECURITY DEFINER');
      expect(sql, label).toContain("SET search_path TO 'public', 'extensions', 'pg_temp'");
      const revoke = sql.indexOf('REVOKE EXECUTE ON FUNCTION public.get_sign_request_by_token');
      const grant  = sql.indexOf('GRANT  EXECUTE ON FUNCTION public.get_sign_request_by_token');
      expect(revoke, label).toBeGreaterThan(-1);
      expect(grant,  label).toBeGreaterThan(revoke);
    }
  });

  it('carries the -- public: marker its anon grant requires', () => {
    // database-standard.md §2 condition (b). The allowlist entry (condition (a))
    // already exists under "public e-sign — signing-page bootstrap".
    expect(MIGRATION).toMatch(/--\s*public:/);
    expect(MIGRATION).toContain('database-standard.md §2');
  });

  it('does not widen the grant beyond what is already live', () => {
    expect(MIGRATION).toContain('TO anon, authenticated, service_role');
    expect(MIGRATION).not.toMatch(/GRANT[\s\S]{0,80}TO\s+PUBLIC/i);
  });
});

describe('the redaction itself', () => {
  it('gates every PII field behind the actionable check', () => {
    expect(MIGRATION).toContain("SELECT (sr.status = 'pending' AND sr.expires_at > now()) AS actionable");
    for (const field of ['signer_name', 'signer_email', 'signed_file_path']) {
      expect(MIGRATION, field).toMatch(
        new RegExp(`'${field}',\\s*CASE WHEN a\\.actionable THEN sr\\.${field}\\s+ELSE NULL END`),
      );
    }
    expect(MIGRATION).toMatch(/'job',\s*CASE WHEN a\.actionable THEN jsonb_build_object/);
    expect(MIGRATION).toMatch(/\)\s*ELSE NULL END/);
  });

  it('still returns the row for a spent link, so the three screens stay distinct', () => {
    // The whole reason this is a redaction and not a WHERE clause. If someone
    // "simplifies" it, "Already Signed" and "Link Expired" both become
    // "This link was not found."
    expect(MIGRATION).not.toMatch(/WHERE[\s\S]{0,120}sr\.status\s*=\s*'pending'/);
    expect(MIGRATION).not.toMatch(/WHERE[\s\S]{0,120}sr\.expires_at\s*>\s*now\(\)/);
    expect(MIGRATION).toContain('WHERE sr.token = p_token::uuid');
  });

  it('leaves every field the status screens read ungated', () => {
    for (const field of ALWAYS_RETURNED) {
      const line = MIGRATION.split('\n').find(l => l.includes(`'${field}',`));
      expect(line, `${field} must be returned`).toBeTruthy();
      expect(line, `${field} must NOT be gated`).not.toContain('actionable');
    }
  });

  it('the rollback restores the ungated body', () => {
    // Comments stripped first: the rollback header legitimately explains that it
    // REMOVES the actionable lateral, and matching that sentence would be the
    // test failing on its own documentation.
    expect(sqlOnly(ROLLBACK)).not.toContain('actionable');
    expect(sqlOnly(ROLLBACK)).not.toContain('CASE WHEN');
    for (const field of WITHHELD_JOB_FIELDS) {
      expect(ROLLBACK, field).toContain(`j.${field}`);
    }
  });

  it('forward and rollback return the same key set — only the gating differs', () => {
    const keys = (sql) => [...sql.matchAll(/^\s*'([a-z_]+)',/gm)].map(m => m[1]).sort();
    expect(keys(MIGRATION)).toEqual(keys(ROLLBACK));
  });
});

describe('both callers survive a null job — verified by reading them, not assuming', () => {
  /* Return the character offset of the first match, or -1. */
  const at = (src, needle) => src.indexOf(needle);

  it('SignPage checks status and expiry BEFORE it touches the payload', () => {
    const signedCheck  = at(SIGN_PAGE, "d.status === 'signed'");
    const pendingCheck = at(SIGN_PAGE, "d.status !== 'pending'");
    const expiryCheck  = at(SIGN_PAGE, 'new Date(d.expires_at) < new Date()');
    const firstUse     = at(SIGN_PAGE, 'setSignerName(d.signer_name');

    for (const [label, idx] of [['signed', signedCheck], ['pending', pendingCheck], ['expiry', expiryCheck]]) {
      expect(idx, `${label} check must exist`).toBeGreaterThan(-1);
      expect(idx, `${label} check must precede the first payload read`).toBeLessThan(firstUse);
    }
  });

  it('submit-esign checks status and expiry BEFORE it reads .job', () => {
    const signedCheck = at(SUBMIT, "signReq.status === 'signed'");
    const validCheck  = at(SUBMIT, "signReq.status !== 'pending'");
    const expiryCheck = at(SUBMIT, 'new Date(signReq.expires_at) < new Date()');
    const jobRead     = at(SUBMIT, 'const job      = signReq.job');

    expect(jobRead).toBeGreaterThan(-1);
    for (const [label, idx] of [['signed', signedCheck], ['valid', validCheck], ['expiry', expiryCheck]]) {
      expect(idx, `${label} check must exist`).toBeGreaterThan(-1);
      expect(idx, `${label} check must precede the .job read`).toBeLessThan(jobRead);
    }
  });

  it('SignPage reads job defensively even on paths that cannot reach a null', () => {
    expect(SIGN_PAGE).toContain('data?.job || {}');
    expect(SIGN_PAGE).toContain('data?.job?.division');
  });
});
