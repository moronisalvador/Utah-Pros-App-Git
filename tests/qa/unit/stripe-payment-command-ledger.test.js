/**
 * ════════════════════════════════════════════════
 * FILE: stripe-payment-command-ledger.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Reads the new Stripe accounting-record migration as text and checks it says
 *   what it claims to: service-role only, nothing reachable by a logged-out or
 *   ordinary logged-in visitor, the off switch really ships off, and the paired
 *   undo file exists.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs
 *   Internal:  the migration and rollback files themselves
 *   Data:      reads  → none (source text only)
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This proves INTENT, not EFFECT. It runs in the credential-free `qa` lane,
 *     so it can only read source. The behavioural proof that the guard actually
 *     refuses a non-service caller belongs to the database-standard.md §5b
 *     disposable-stack run in the apply window. Do not present this as coverage
 *     of live behaviour.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const MIGRATION = 'supabase/migrations/20260820020000_stripe_payment_command_ledger.sql';
const ROLLBACK = 'supabase/rollbacks/20260820020000_stripe_payment_command_ledger.rollback.sql';

/**
 * Strip `--` line comments so a "must NOT appear" assertion tests the executable
 * SQL rather than the prose explaining why it is absent. Without this, a header
 * that says "no DROP/RENAME here" fails the very check it is describing — which
 * is exactly what happened on the first run of this file.
 */
const codeOnly = (sql) => sql.split('\n')
  .map((line) => {
    // Naive but correct here: this migration has no `--` inside a string literal.
    const idx = line.indexOf('--');
    return idx === -1 ? line : line.slice(0, idx);
  })
  .join('\n');

const ROUTINES = [
  'stripe_command_guard',
  'reserve_stripe_payment_command',
  'start_stripe_payment_command',
  'finalize_stripe_payment_command',
  'get_stripe_payment_command',
];

describe('Stripe payment command ledger — migration source contract', () => {
  const sql = read(MIGRATION);
  const code = codeOnly(sql);

  it('ships a paired rollback (database-standard.md §6)', () => {
    expect(existsSync(join(ROOT, ROLLBACK))).toBe(true);
  });

  it('locks the table to the service role and forces RLS', () => {
    expect(sql).toMatch(/ALTER TABLE public\.stripe_payment_commands ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/ALTER TABLE public\.stripe_payment_commands FORCE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.stripe_payment_commands FROM PUBLIC, anon, authenticated/);
    // No browser role may touch the table directly.
    expect(code).not.toMatch(/GRANT[^;]*ON TABLE public\.stripe_payment_commands[^;]*TO[^;]*\b(anon|authenticated)\b/);
  });

  it('grants no routine to anon or authenticated', () => {
    // The whole ledger is webhook-side. A browser has no business calling any of it.
    const grants = code.match(/GRANT EXECUTE ON FUNCTION[\s\S]*?;/g) || [];
    expect(grants.length).toBeGreaterThan(0);
    for (const grant of grants) {
      expect(grant).toMatch(/TO service_role;/);
      expect(grant).not.toMatch(/\banon\b/);
      expect(grant).not.toMatch(/\bauthenticated\b/);
    }
  });

  it('revokes from PUBLIC before granting, on every routine', () => {
    // This managed project re-applies EXECUTE TO PUBLIC at ddl_command_end, so
    // ALTER DEFAULT PRIVILEGES does not cover functions (database-standard.md §1).
    for (const fn of ROUTINES) {
      const revoke = new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${fn}\\(`);
      expect(sql, `${fn} must be revoked from PUBLIC`).toMatch(revoke);
    }
    const revokeIdx = sql.indexOf('REVOKE EXECUTE ON FUNCTION');
    const grantIdx = sql.indexOf('GRANT EXECUTE ON FUNCTION');
    expect(revokeIdx).toBeGreaterThan(-1);
    expect(revokeIdx).toBeLessThan(grantIdx);
  });

  it('pins every routine to SECURITY DEFINER with an explicit search_path', () => {
    for (const fn of ROUTINES) {
      const body = sql.slice(sql.indexOf(`FUNCTION public.${fn}(`));
      const head = body.slice(0, 600);
      expect(head, `${fn} must be SECURITY DEFINER`).toMatch(/SECURITY DEFINER/);
      expect(head, `${fn} must pin search_path`).toMatch(/SET search_path TO 'public'/);
    }
  });

  it('guards on auth.role() with IS DISTINCT FROM, never the legacy GUC and never <>', () => {
    // The legacy flattened GUC is not populated by modern PostgREST — gating on it
    // is what made all eight QBO receipt routines throw 42501 for every caller
    // until 20260806034004.
    expect(code).not.toMatch(/request\.jwt\.claim\.role/);
    // current_user inside a SECURITY DEFINER function is the owner, not the caller.
    expect(code).not.toMatch(/current_user/);
    expect(code).toMatch(/auth\.role\(\) IS DISTINCT FROM 'service_role'/);
    // `<>` would evaluate to NULL outside a PostgREST request, and PL/pgSQL's IF
    // treats NULL as false — silently skipping the guard.
    expect(code).not.toMatch(/auth\.role\(\)\s*<>/);
    expect(code).toMatch(/ERRCODE = '42501'/);
  });

  it('ships the feature flag DISABLED, so applying it changes no behaviour', () => {
    const insert = sql.slice(sql.indexOf('INSERT INTO public.feature_flags'));
    expect(insert).toMatch(/'feature:stripe_payment_command_v1'/);
    // enabled=false, force_disabled=false
    expect(insert).toMatch(/false,\s*\n?\s*false\s*\n?\s*\)/);
    expect(insert).toMatch(/ON CONFLICT \(key\) DO NOTHING/);
    // `label` is NOT NULL and `category` defaults to 'page' — both must be explicit.
    expect(insert).toMatch(/'feature'/);
  });

  it('is additive only — no DROP, RENAME or tightening ALTER on a live object', () => {
    expect(code).not.toMatch(/DROP TABLE/i);
    expect(code).not.toMatch(/DROP COLUMN/i);
    expect(code).not.toMatch(/RENAME/i);
    expect(code).not.toMatch(/ALTER COLUMN/i);
    // The only ALTER TABLE statements are RLS toggles on the brand-new table.
    const alters = code.match(/ALTER TABLE [^\n;]*/g) || [];
    for (const alter of alters) {
      expect(alter).toMatch(/public\.stripe_payment_commands/);
    }
  });

  it('makes a redelivered Stripe event find the existing command, not start a second', () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX stripe_payment_commands_object_action_uniq/);
    expect(sql).toMatch(/ON public\.stripe_payment_commands \(stripe_object_id, action\)/);
    expect(sql).toMatch(/ON CONFLICT \(stripe_object_id, action\) DO NOTHING/);
  });

  it('freezes a provider request id that a retry can reuse', () => {
    // This is the entire reason the table exists: Intuit dedups on requestid, so a
    // retry MUST present the original one or it creates a second QuickBooks Payment.
    expect(sql).toMatch(/provider_request_id text NOT NULL/);
    expect(sql).toMatch(/length\(provider_request_id\) BETWEEN 1 AND 50/);
  });

  it('models ACH settlement as its own state, distinct from succeeded', () => {
    // An ACH debit submitted to the network is not money. Collapsing it into
    // succeeded is what books revenue that never arrives.
    expect(sql).toMatch(/'pending_settlement'/);
    expect(sql).toMatch(/'ambiguous'/);
    expect(sql).toMatch(/'needs_reconciliation'/);
  });

  it('lets a payout command exist with no invoice', () => {
    // payout.paid produces a clearing→bank transfer that belongs to no single invoice.
    expect(code).toMatch(/invoice_id uuid REFERENCES public\.invoices\(id\)/);
    expect(code).not.toMatch(/invoice_id uuid NOT NULL/);
  });
});

describe('Stripe payment command ledger — rollback source contract', () => {
  const sql = read(ROLLBACK);

  it('drops every routine and the table', () => {
    for (const fn of ROUTINES) {
      expect(sql, `${fn} must be dropped`).toMatch(new RegExp(`DROP FUNCTION IF EXISTS public\\.${fn}\\(`));
    }
    expect(sql).toMatch(/DROP TABLE IF EXISTS public\.stripe_payment_commands/);
    expect(sql).toMatch(/DELETE FROM public\.feature_flags WHERE key = 'feature:stripe_payment_command_v1'/);
  });

  it('drops the shared guard AFTER its callers', () => {
    // Dropping the guard first would leave four routines referencing a missing
    // function for the length of the script.
    const guardIdx = sql.indexOf('DROP FUNCTION IF EXISTS public.stripe_command_guard');
    const callerIdx = sql.indexOf('DROP FUNCTION IF EXISTS public.reserve_stripe_payment_command');
    expect(guardIdx).toBeGreaterThan(callerIdx);
  });

  it('warns that dropping an in-flight command discards the safe retry identity', () => {
    // A row in provider_started means a QuickBooks call may have landed whose
    // response was never seen. That warning is the point of the file's header.
    expect(sql).toMatch(/provider_started/);
    expect(sql).toMatch(/double-post/i);
  });
});
