/**
 * ════════════════════════════════════════════════
 * FILE: esign-custom-authorization-contract.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Guards the one-off "Custom Authorization" document. It checks that the
 *   database change only ADDS things, that it never touches the function every
 *   existing signature request depends on, that the public lookup it adds can
 *   only be used while a document is still waiting to be signed, and that a
 *   document with no text is refused rather than quietly replaced with
 *   completion-certificate boilerplate. Reads files as text; no database needed.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path
 *   Internal:  supabase/migrations/20260807201000_esign_custom_authorization_snapshot.sql
 *              and its rollback, functions/lib/esign-custom-doc.js,
 *              functions/api/{send,submit}-esign.js, src/lib/claimUtils.js,
 *              src/pages/SignPage.jsx
 *   Data:      reads  → migration, rollback and application source text
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This proves INTENT, not EFFECT. It CANNOT prove PostgREST still resolves
 *     create_sign_request after the migration — that is the single
 *     highest-consequence question here, and only a disposable local stack with
 *     real PostgREST answers it (the scripts/qa/qualify-*-local.mjs pattern).
 *     Do not present a green run here as evidence the send path works.
 *   - The create_sign_request guard below is the most important assertion in
 *     this file. Adding parameters to that function via CREATE OR REPLACE does
 *     not replace it — it creates a second overload, both match the worker's
 *     seven-key call, and EVERY e-sign send fails with PGRST203 on dev and
 *     production simultaneously.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const MIGRATION = read('supabase/migrations/20260807201000_esign_custom_authorization_snapshot.sql');
const ROLLBACK  = read('supabase/rollbacks/20260807201000_esign_custom_authorization_snapshot.rollback.sql');
const LIB       = read('functions/lib/esign-custom-doc.js');
const SEND      = read('functions/api/send-esign.js');
const SUBMIT    = read('functions/api/submit-esign.js');
const CLAIM     = read('src/lib/claimUtils.js');
const SIGNPAGE  = read('src/pages/SignPage.jsx');

const stripSqlComments = (sql) =>
  sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const CODE = stripSqlComments(MIGRATION);

describe('migration — the overload trap', () => {
  it('NEVER creates or replaces create_sign_request', () => {
    // The whole design turns on this. Postgres identifies a function by
    // (name, argtypes), so CREATE OR REPLACE with extra params adds a SECOND
    // function. send-esign.js posts exactly seven named keys; two candidates
    // would then match and PostgREST answers PGRST203 — breaking every CoC,
    // Work Auth, Direction of Pay, Change Order and Recon Agreement send, on
    // dev AND production, because one Supabase sits behind both.
    expect(CODE).not.toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.create_sign_request/i);
    expect(CODE).not.toMatch(/DROP\s+FUNCTION[^;]*create_sign_request/i);
    expect(CODE).not.toContain('create_sign_request');
  });

  it('does not touch the other live signing functions either', () => {
    for (const fn of ['get_sign_request_by_token', 'complete_sign_request', 'get_sign_document_templates', 'upsert_document_template']) {
      expect(CODE, `must not modify ${fn}`).not.toContain(fn);
    }
  });

  it('the worker still calls create_sign_request with the original seven keys', () => {
    const call = SEND.match(/rpc\('create_sign_request',\s*\{([\s\S]*?)\}\)/);
    expect(call, 'create_sign_request call not found').toBeTruthy();
    const keys = [...call[1].matchAll(/(p_[a-z_]+):/g)].map((m) => m[1]).sort();
    expect(keys).toEqual([
      'p_contact_id', 'p_divisions', 'p_doc_type', 'p_job_id',
      'p_sent_by', 'p_signer_email', 'p_signer_name',
    ]);
  });

  it('snapshots the text with a follow-up PATCH instead', () => {
    expect(SEND).toMatch(/method:\s*'PATCH'/);
    expect(SEND).toContain('/rest/v1/sign_requests?id=eq.');
  });
});

describe('migration — additive only', () => {
  it('adds three nullable columns and nothing else to the table', () => {
    expect(CODE).toContain('ADD COLUMN IF NOT EXISTS custom_heading     text');
    expect(CODE).toContain('ADD COLUMN IF NOT EXISTS custom_body        text');
    expect(CODE).toContain('ADD COLUMN IF NOT EXISTS custom_snippet_key text');
    for (const forbidden of ['DROP TABLE', 'DROP COLUMN', 'SET NOT NULL', 'RENAME', 'DROP POLICY', 'CREATE POLICY']) {
      expect(CODE, `must not contain ${forbidden}`).not.toContain(forbidden);
    }
    expect(CODE).not.toMatch(/ALTER\s+COLUMN[^;]*TYPE/i);
  });

  it('creates exactly one new function', () => {
    const created = [...CODE.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.([a-z_]+)/gi)].map((m) => m[1]);
    expect(created).toEqual(['get_sign_request_custom_text']);
  });
});

describe('migration — the public lookup is narrow', () => {
  it('is constrained by token, doc type, pending status AND expiry', () => {
    // get_sign_request_by_token is granted anon with NO status or expiry
    // predicate. Free-form staff text must not inherit that: it would stay
    // anonymously readable forever by anyone who ever held the link.
    const body = CODE.slice(CODE.indexOf('CREATE OR REPLACE FUNCTION public.get_sign_request_custom_text'));
    expect(body).toContain('sr.token = p_token::uuid');
    expect(body).toContain("sr.doc_type = 'other'");
    expect(body).toContain("sr.status = 'pending'");
    expect(body).toContain('sr.expires_at > now()');
  });

  it('returns only the two text columns — no signer, job or contact data', () => {
    expect(CODE).toMatch(/RETURNS TABLE \(custom_heading text, custom_body text\)/);
    const body = CODE.slice(CODE.indexOf('AS $function$'), CODE.indexOf('$function$;'));
    expect(body).not.toMatch(/signer_email|signer_name|signer_ip|contact_id|job_id/);
  });

  it('pins search_path and revokes PUBLIC before granting', () => {
    expect(CODE).toMatch(/SET search_path TO 'public', 'extensions', 'pg_temp'/);
    const revoke = CODE.indexOf('REVOKE EXECUTE ON FUNCTION public.get_sign_request_custom_text(text) FROM PUBLIC;');
    const grant  = CODE.indexOf('GRANT  EXECUTE ON FUNCTION public.get_sign_request_custom_text(text) TO anon');
    expect(revoke).toBeGreaterThan(-1);
    expect(grant).toBeGreaterThan(revoke);
  });

  it('carries the -- public: reason the hygiene checker and §2 allowlist require', () => {
    expect(MIGRATION).toMatch(/--\s*public:\s*\S+/);
  });

  it('flags the database-standard §2 allowlist entry as an owner action', () => {
    // Only the owner may amend .claude/rules/, so the migration must say so
    // rather than silently granting anon without the allowlist line.
    expect(MIGRATION).toMatch(/OWNER ACTION REQUIRED/i);
    expect(MIGRATION).toContain('database-standard.md');
  });

  it('ships a rollback that drops the function before the columns', () => {
    const fn = ROLLBACK.indexOf('DROP FUNCTION IF EXISTS public.get_sign_request_custom_text');
    const col = ROLLBACK.indexOf('DROP COLUMN IF EXISTS custom_body');
    expect(fn).toBeGreaterThan(-1);
    expect(col).toBeGreaterThan(fn);
    expect(ROLLBACK).toMatch(/--\s*destructive-approved:/);
    expect(ROLLBACK).toMatch(/READ THIS BEFORE RUNNING IT/);
  });
});

describe('an empty custom document is refused, never replaced with boilerplate', () => {
  it('the worker refuses to complete a blank custom authorization', () => {
    expect(SUBMIT).toContain('ESIGN_CUSTOM_TEXT_MISSING');
    // The refusal must come BEFORE the PDF is built and uploaded.
    const refusal = SUBMIT.indexOf('ESIGN_CUSTOM_TEXT_MISSING');
    const upload  = SUBMIT.indexOf('uploadStorage');
    expect(refusal).toBeLessThan(upload);
  });

  it('the signing page shows an error instead of a signable form', () => {
    expect(SIGNPAGE).toContain("rpc('get_sign_request_custom_text'");
    const block = SIGNPAGE.slice(SIGNPAGE.indexOf("get_sign_request_custom_text"));
    expect(block).toContain("setStatus('error')");
  });

  it('the send worker cancels the request if the snapshot cannot be stored', () => {
    // Otherwise a pending doc_type='other' with no body is a dead link.
    expect(SEND).toContain('ESIGN_CUSTOM_TEXT_NOT_STORED');
    expect(SEND).toMatch(/status:\s*'cancelled'/);
  });

  it('the snapshot is preferred ONLY for doc_type=other', () => {
    // Scoping this matters: sign_requests carries always-true RLS policies, so
    // any employee can PATCH the table directly. If the readers preferred a
    // snapshot on ANY doc type, an employee could rewrite the text of a pending
    // Work Authorization out from under the homeowner.
    expect(SUBMIT).toContain("if (signReq.doc_type === 'other')");
    expect(SIGNPAGE).toContain("data?.doc_type === 'other'");
  });
});

describe('custom-doc role list agrees across both bundles', () => {
  const list = (src, name) => {
    const m = src.match(new RegExp(`${name}\\s*=\\s*\\[([^\\]]*)\\]`));
    expect(m, `${name} not found`).toBeTruthy();
    return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  };

  it('claimUtils and the worker lib state the same roles', () => {
    // functions/ is a separate Cloudflare bundle and cannot import from src/,
    // so the list is duplicated on purpose — and must not drift.
    expect(list(LIB, 'CUSTOM_DOC_ROLES')).toEqual(['admin', 'office', 'project_manager']);
    expect(list(CLAIM, 'CUSTOM_DOC_ROLES')).toEqual(list(LIB, 'CUSTOM_DOC_ROLES'));
  });

  it('is its own constant, never an alias of the billing list', () => {
    // Comment-stripped: both files DISCUSS BILLING_EDIT_ROLES at length in prose
    // explaining why they deliberately do not reuse it. Prose is not a reuse.
    const stripJs = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
      .map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    expect(CLAIM).not.toMatch(/CUSTOM_DOC_ROLES\s*=\s*BILLING_EDIT_ROLES/);
    expect(stripJs(LIB)).not.toContain('BILLING_EDIT_ROLES');
  });

  it('gates only doc_type=other, leaving the other types on requireUser', () => {
    // Anchor on the CALL, not the import at the top of the file.
    const call = SEND.indexOf('await authorizeCustomDocRequest');
    expect(call, 'authorizeCustomDocRequest is never called').toBeGreaterThan(-1);
    const guardAt = SEND.lastIndexOf("if (doc_type === 'other')", call);
    expect(guardAt, 'the gate is not inside a doc_type==="other" guard').toBeGreaterThan(-1);
    // Nothing but the guard and a comment may sit between them.
    expect(SEND.slice(guardAt, call)).not.toMatch(/\breturn\b|\bawait\b/);
    // The other ten types keep the deployed behaviour.
    expect(SEND).toContain('requireUser');
  });

  it('refuses external employees regardless of role', () => {
    expect(LIB).toContain('auth.employee.is_external');
  });

  it('states honestly that this is not a database boundary', () => {
    // AGENTS.md §17: never present a UI/worker gate as server-enforced when the
    // database does not enforce it.
    expect(LIB).toMatch(/the worker refuses; the database does not/i);
    expect(CLAIM).toMatch(/the worker refuses; the database does not/i);
  });
});

describe('custom text validation', () => {
  it('bans {{insurance_section}} explicitly', () => {
    expect(LIB).toContain("token === 'insurance_section'");
    expect(LIB).not.toMatch(/CUSTOM_DOC_ALLOWED_TOKENS[\s\S]{0,400}'insurance_section'/);
  });

  it('rejects unknown tokens rather than printing them literally', () => {
    expect(LIB).toContain('is not a recognized field');
  });

  it('caps the heading so the PDF title cannot overflow', () => {
    expect(LIB).toContain('CUSTOM_DOC_HEADING_MAX = 80');
    expect(LIB).toMatch(/\[\\r\\n\]/);
  });
});
