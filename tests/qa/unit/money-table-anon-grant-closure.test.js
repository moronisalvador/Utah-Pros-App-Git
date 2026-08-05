/**
 * ════════════════════════════════════════════════
 * FILE: money-table-anon-grant-closure.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Reads the money-table anon-closure migration and its undo script as plain
 *   text and checks they still say what they are supposed to say. No database
 *   is needed, so this runs in every test lane including the ones that hold no
 *   database password.
 *
 *   It guards three things a future edit could quietly get wrong: that the
 *   logged-out role really is revoked on all four money tables, that the
 *   logged-in role and the background-service role are NOT revoked along with
 *   it (which would break every billing screen), and that the undo script does
 *   not re-open the payments table that a different, already-applied migration
 *   closed a week earlier.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path, node:url
 *   Internal:  supabase/migrations/20260804193000_money_table_anon_grant_closure.sql
 *              supabase/rollbacks/20260804193000_money_table_anon_grant_closure.rollback.sql
 *   Data:      reads  → migration + rollback source text
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This proves INTENT, not EFFECT (close-out-standard.md §2b). It cannot
 *     tell you the revoke applied — only that the source still asks for it.
 *     Effect is the apply-window step against the live catalog.
 *   - The migration is NOT applied to the shared project as of authoring. It is
 *     reviewed repository source awaiting a fresh owner authorization.
 *   - Placed in tests/qa/unit/ so the contract stays visible in the
 *     credential-free lanes; the db lane is not a substitute for it.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Derived from this file's location rather than the working directory, so the
// test resolves the same way however the lane runner is invoked.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const STEM = '20260804193000_money_table_anon_grant_closure';
const MIGRATION = join(ROOT, `supabase/migrations/${STEM}.sql`);
const ROLLBACK = join(ROOT, `supabase/rollbacks/${STEM}.rollback.sql`);

const read = (p) => readFileSync(p, 'utf8');
const norm = (s) => s.replace(/\s+/g, ' ').toLowerCase();

// Both files are mostly prose: the documentation-standard header plus inline
// rationale. Assertions about what the migration DOES must run against the
// executable statements only — otherwise a header sentence like "`authenticated`
// is deliberately NOT named" reads as a GRANT and the guard inverts itself.
// Neither file contains `--` inside a string literal, so line-stripping is safe.
const stripComments = (s) => s.replace(/--[^\n]*/g, ' ');
const ddl = (s) => norm(stripComments(s));

// The mirror image: for the disclosure guards we want the header's ENGLISH, so
// strip the leading `--` marker off each line and let wrapped sentences rejoin.
// Without this, a sentence spanning two comment lines reads as "... grant all
// and is -- not subject to ..." and no honest phrasing could ever match.
const prose = (s) => norm(s.replace(/^[ \t]*--[ \t]?/gm, ''));

// The three tables this migration is actually closing. `payments` is handled
// separately in its own assertions because its rollback treatment differs.
const CLOSED_TABLES = ['invoices', 'invoice_line_items', 'estimates'];

describe('money-table anon closure — migration source contract', () => {
  const raw = read(MIGRATION);
  const sql = prose(raw);      // header English — for the disclosure guards
  const stmts = ddl(raw);      // executable statements only — for behavior guards

  it('exists alongside a rollback (database-standard.md §6)', () => {
    expect(existsSync(MIGRATION)).toBe(true);
    expect(existsSync(ROLLBACK)).toBe(true);
  });

  it('revokes the logged-out browser role on every money table', () => {
    for (const table of [...CLOSED_TABLES, 'payments']) {
      expect(stmts).toContain(`revoke all on table public.${table} from public, anon`);
    }
  });

  it('does NOT revoke authenticated or service_role', () => {
    // The whole application data path runs as `authenticated` (CLAUDE.md Rule 3)
    // and every Worker runs as the privileged server role. Naming either in a
    // REVOKE here would take down billing, not harden it.
    for (const role of ['authenticated', 'service_role']) {
      expect(stmts).not.toMatch(new RegExp(`revoke[^;]*\\b${role}\\b`));
    }
  });

  it('leaves RLS enabled rather than relying on the revoke alone', () => {
    for (const table of CLOSED_TABLES) {
      expect(stmts).toContain(`alter table public.${table} enable row level security`);
    }
    expect(stmts).not.toContain('disable row level security');
  });

  it('changes no policy, table, column or function', () => {
    // This migration's safety case rests on it being a pure privilege change.
    // A policy or DDL edit sneaking in here would invalidate the review.
    for (const forbidden of [
      'create policy',
      'drop policy',
      'alter policy',
      'create table',
      'drop table',
      'alter column',
      'add column',
      'drop column',
      'create or replace function',
      'drop function',
      'truncate ',
      'delete from',
      'update public.',
      'insert into',
    ]) {
      expect(stmts).not.toContain(forbidden);
    }
  });

  it('does NOT touch the database-standard.md §2 public allowlist', () => {
    // Logged-out visitors legitimately need login bootstrap, /status, public
    // e-sign retrieval and public job-file read. Breaking one of those is how
    // this change would take down signing or logins.
    for (const forbidden of [
      'sign_requests',
      'document_templates',
      'job_documents',
      'crm_build_phases',
      'feature_flags',
      'employees',
      'inbound_leads',
    ]) {
      expect(stmts).not.toContain(`public.${forbidden}`);
    }
  });

  it('states the honest exposure rather than implying a live leak', () => {
    // The reviewer must not be told this was an open door. RLS already refused
    // anon; the grant was the standing risk. If someone rewrites the header to
    // overclaim, this fails.
    expect(sql).toContain('rls is enabled on all four');
    expect(sql).toContain('no policy on any of the four admits `anon`');
    expect(sql).toContain('is none');
  });

  it('discloses TRUNCATE as the one privilege RLS does not cover', () => {
    expect(sql).toContain('truncate is part of grant all and is not subject to row-level security');
  });

  it('records the caller inventory that makes the revoke safe', () => {
    expect(sql).toContain('signpage.jsx');
    expect(sql).toContain('status.jsx');
    expect(sql).toContain('get_sign_request_by_token');
  });
});

describe('money-table anon closure — rollback source contract', () => {
  const raw = read(ROLLBACK);
  const sql = prose(raw);
  const stmts = ddl(raw);

  it('re-grants anon on exactly the three tables this migration closed', () => {
    for (const table of CLOSED_TABLES) {
      expect(stmts).toContain(`on table public.${table} to anon`);
    }
  });

  it('does NOT re-grant payments — that closure belongs to 20260731045407', () => {
    // The forward migration revokes payments only as an idempotent safety net.
    // Re-granting it here would undo a DIFFERENT already-applied security
    // migration (production ledger 20260731225654), not this one.
    expect(stmts).not.toContain('public.payments');
  });

  it('does not re-grant PUBLIC, which never held a grant', () => {
    // Restoring a privilege the forward step never removed would ADD exposure.
    expect(stmts).not.toMatch(/grant[^;]*\bto\b[^;]*\bpublic\s*[,;]/);
  });

  it('never disables row-level security', () => {
    // RLS was already on before the migration; turning it off during a rollback
    // would leave the database weaker than the state being restored.
    expect(stmts).not.toContain('disable row level security');
  });

  it('restores no policy and touches no other role', () => {
    expect(stmts).not.toContain('create policy');
    expect(stmts).not.toContain('drop policy');
    expect(stmts).not.toMatch(/grant[^;]*\b(authenticated|service_role)\b/);
  });

  it('re-grants SELECT only — never the verbs that outlive RLS', () => {
    // The forward migration names TRUNCATE as the one privilege whose safety
    // rests on the absence of a SQL path rather than on RLS. An operator using
    // this rollback knows something broke but not which verb it needs; handing
    // back a table-wipe capability to the logged-out role to fix an unknown read
    // is not a trade worth making. Widen deliberately, one named verb at a time.
    expect(stmts).not.toMatch(/grant[^;]*\btruncate\b/);
    expect(stmts).not.toMatch(/grant[^;]*\breferences\b/);
    expect(stmts).not.toMatch(/grant[^;]*\btrigger\b/);
    expect(stmts).not.toMatch(/grant[^;]*\b(insert|update|delete)\b/);
  });

  it('warns that the rollback restores a standing exposure', () => {
    expect(sql).toContain('last resort');
  });
});
