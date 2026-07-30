/**
 * ════════════════════════════════════════════════
 * FILE: crm-lead-value-from-claim.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Keeps the CRM lead-value migration's promises visible in normal CI. The
 *   behavioural SQL suite for this feature lives in supabase/tests/, which is
 *   the `db` lane and does NOT run in CI (there is no isolated database target
 *   yet — close-out-standard.md §2b, backlog 6.1). So this file reads the
 *   migration SOURCE and asserts what it claims: additive-only, no anon grant,
 *   REVOKE before GRANT, a rollback that exists, and — the one that actually
 *   matters here — that the invoice trigger watches EVERY column the value
 *   calculation reads.
 *
 *   That last check is the whole reason this feature had to be rewritten: the
 *   previous attempt fired AFTER INSERT on a column written by a later
 *   statement, so it never ran once in production. This test is the guard that
 *   stops that from silently happening again.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path, node:url
 *   Internal:  the lead-value migration + its rollback
 *   Data:      reads → repository source only; writes → none
 *
 * NOTES / GOTCHAS:
 *   - This proves SOURCE INTENT, not applied database behaviour. Never present
 *     a pass here as proof the live database does any of this.
 * ════════════════════════════════════════════════
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MIGRATION = 'supabase/migrations/20260730120000_crm_lead_value_from_claim.sql';
const ROLLBACK = 'supabase/rollbacks/20260730120000_crm_lead_value_from_claim.rollback.sql';

const migration = readFileSync(join(root, MIGRATION), 'utf8');
const rollback = readFileSync(join(root, ROLLBACK), 'utf8');

/** Strip `--` comments so prose about a keyword never satisfies a check. */
const executable = (sql) => sql
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

const migrationSql = executable(migration);
const rollbackSql = executable(rollback);

describe('CRM lead value — migration source contract', () => {
  it('ships a rollback file', () => {
    expect(existsSync(join(root, ROLLBACK))).toBe(true);
    expect(rollbackSql).toMatch(/DROP TRIGGER IF EXISTS crm_invoice_lead_value_sync/);
    expect(rollbackSql).toMatch(/DROP FUNCTION IF EXISTS public\.set_lead_value/);
  });

  it('restores the prior crm_trg_invoice_created body on rollback', () => {
    // The migration replaces this function's BODY. A rollback that dropped it,
    // or forgot it, would leave the Won auto-advance broken.
    expect(rollbackSql).toMatch(/CREATE OR REPLACE FUNCTION public\.crm_trg_invoice_created/);
    expect(rollbackSql).toMatch(/crm_sync_lead_value\(NEW\.contact_id/);
  });

  it('is additive only — no destructive DDL on live tables', () => {
    expect(migrationSql).not.toMatch(/DROP\s+TABLE/i);
    expect(migrationSql).not.toMatch(/ALTER\s+TABLE\s+\S+\s+DROP\s+COLUMN/i);
    expect(migrationSql).not.toMatch(/ALTER\s+COLUMN\s+\S+\s+SET\s+NOT\s+NULL/i);
    expect(migrationSql).not.toMatch(/\bRENAME\b/i);
    // The only columns it adds are the two new nullable ones.
    expect(migrationSql).toMatch(/ADD COLUMN IF NOT EXISTS claim_id\s+uuid/);
    expect(migrationSql).toMatch(/ADD COLUMN IF NOT EXISTS value_source text/);
  });

  it('adds constraints NOT VALID then validates, to keep the lock short', () => {
    // database-standard.md §5 — inbound_leads is a hot table.
    const notValid = migrationSql.match(/NOT VALID/g) || [];
    const validated = migrationSql.match(/VALIDATE CONSTRAINT/g) || [];
    expect(notValid.length).toBeGreaterThanOrEqual(2);
    expect(validated.length).toBeGreaterThanOrEqual(2);
  });

  it('never grants anon, and revokes before granting on every new function', () => {
    // No anon anywhere outside a comment.
    expect(migrationSql).not.toMatch(/GRANT[^;]*\banon\b/i);

    const fns = [
      'crm_lead_claim_value(uuid)',
      'crm_recompute_lead_value(uuid)',
      'crm_recompute_lead_values_for_claim(uuid)',
      'crm_attach_claim_to_lead(uuid)',
      'set_lead_value(uuid, numeric, uuid)',
      'crm_backfill_lead_values(integer)',
    ];
    for (const fn of fns) {
      const revokeAt = migrationSql.indexOf(`REVOKE EXECUTE ON FUNCTION public.${fn} FROM PUBLIC, anon`);
      const grantAt = migrationSql.indexOf(`GRANT  EXECUTE ON FUNCTION public.${fn} TO authenticated, service_role`);
      expect(revokeAt, `REVOKE present for ${fn}`).toBeGreaterThan(-1);
      expect(grantAt, `GRANT present for ${fn}`).toBeGreaterThan(-1);
      // Managed Supabase re-applies EXECUTE TO PUBLIC on every new function,
      // so the revoke MUST come first or the grant is a no-op over an open door.
      expect(revokeAt, `REVOKE precedes GRANT for ${fn}`).toBeLessThan(grantAt);
    }
  });

  it('pins search_path and uses SECURITY DEFINER on every new function', () => {
    const defs = migrationSql.match(/SECURITY DEFINER/g) || [];
    const paths = migrationSql.match(/SET search_path TO 'public'/g) || [];
    expect(defs.length).toBeGreaterThanOrEqual(9);
    expect(paths.length).toBeGreaterThanOrEqual(defs.length);
  });

  it('validates the caller inside SQL before writing a lead value', () => {
    // A valid session is authentication, not authorization (AGENTS.md §16).
    const body = migrationSql.slice(migrationSql.indexOf('FUNCTION public.set_lead_value'));
    expect(body).toMatch(/auth\.uid\(\)/);
    expect(body).toMatch(/e\.is_active/);
    expect(body).toMatch(/NOT e\.is_external/);
    expect(body).toMatch(/RAISE EXCEPTION 'not authorized to set a lead value'/);
  });

  /**
   * THE load-bearing test.
   *
   * crm_lead_claim_value() decides whether an invoice counts by reading
   * sent_at, qbo_emailed_at, estimate_id, amount_paid, adjusted_total, total
   * and job_id. If the trigger's UPDATE OF list omits any one of them, a change
   * to that column silently fails to re-sum the lead — which is exactly how the
   * previous implementation ended up never firing at all.
   */
  it('the invoice trigger watches every column the value calculation reads', () => {
    const triggerMatch = migrationSql.match(
      /CREATE TRIGGER crm_invoice_lead_value_sync([\s\S]*?)EXECUTE FUNCTION/,
    );
    expect(triggerMatch, 'invoice trigger present').not.toBeNull();
    const trigger = triggerMatch[1];

    for (const col of [
      'total', 'adjusted_total', 'job_id',
      'sent_at', 'qbo_emailed_at', 'amount_paid', 'estimate_id',
    ]) {
      expect(trigger, `UPDATE OF list includes ${col}`).toMatch(new RegExp(`\\b${col}\\b`));
    }
    // DELETE matters too: removing an invoice must shrink the lead's value.
    expect(trigger).toMatch(/AFTER INSERT OR DELETE OR UPDATE OF/);
  });

  it('the eligibility rule excludes drafts and accepts the four committed signals', () => {
    const fn = migrationSql.slice(
      migrationSql.indexOf('FUNCTION public.crm_lead_claim_value'),
      migrationSql.indexOf('REVOKE EXECUTE ON FUNCTION public.crm_lead_claim_value'),
    );
    // Owner rule, 2026-07-30.
    expect(fn).toMatch(/iv\.sent_at\s+IS NOT NULL/);
    expect(fn).toMatch(/iv\.qbo_emailed_at\s+IS NOT NULL/);
    expect(fn).toMatch(/iv\.estimate_id\s+IS NOT NULL/);
    expect(fn).toMatch(/COALESCE\(iv\.amount_paid, 0\) > 0/);
    // A zero-total draft can never qualify.
    expect(fn).toMatch(/COALESCE\(iv\.adjusted_total, iv\.total, 0\) > 0/);
    // Sums across ALL jobs on the claim, not one job.
    expect(fn).toMatch(/FROM jobs j/);
    expect(fn).toMatch(/WHERE j\.claim_id = p_claim_id/);
    expect(fn).toMatch(/SUM\(/);
  });

  it('never overwrites a value a human set', () => {
    const fn = migrationSql.slice(migrationSql.indexOf('FUNCTION public.crm_recompute_lead_value'));
    expect(fn).toMatch(/IF v_lead\.value_source = 'manual' THEN\s*\n\s*RETURN v_lead\.value;/);
  });

  it('is idempotent — recomputes a sum and skips an unchanged write', () => {
    const fn = migrationSql.slice(migrationSql.indexOf('FUNCTION public.crm_recompute_lead_value'));
    expect(fn).toMatch(/IS NOT DISTINCT FROM v_new/);
    // It assigns the recomputed total, never accumulates onto the old value.
    expect(fn).toMatch(/SET value\s+= v_new/);
    expect(fn).not.toMatch(/value\s*=\s*value\s*\+/);
  });

  it('keeps CRM bookkeeping from ever blocking a money write', () => {
    // Every trigger body wraps its work so an invoice/job/claim write survives
    // a CRM failure (AGENTS.md §15 posture, matching the existing crm_trg_*).
    for (const fn of [
      'crm_trg_invoice_lead_value',
      'crm_trg_job_claim_lead_value',
      'crm_trg_claim_created_lead_link',
    ]) {
      const body = migrationSql.slice(migrationSql.indexOf(`FUNCTION public.${fn}`));
      const upTo = body.slice(0, body.indexOf('$function$;'));
      expect(upTo, `${fn} traps its own errors`).toMatch(/EXCEPTION WHEN OTHERS THEN/);
    }
  });

  it('does not touch the three initiative-owned workers', () => {
    // run-automations.js, process-crm-automations.js and process-sequences.js
    // each belong to a different initiative — this feature is DB + UI only.
    for (const worker of ['run-automations', 'process-crm-automations', 'process-sequences']) {
      expect(migrationSql).not.toMatch(new RegExp(worker));
    }
  });

  it('leaves the superseded crm_sync_lead_value in place rather than dropping it', () => {
    // It is granted to authenticated; dropping a live function is the contract
    // removal database-standard.md §3 forbids. It becomes dead code instead.
    expect(migrationSql).not.toMatch(/DROP FUNCTION[^;]*crm_sync_lead_value/i);
  });

  it('does not run the backfill as a side effect of applying', () => {
    // Defined, not invoked — the first run puts real dollar figures on real
    // cards and deserves a deliberate look.
    expect(migrationSql).toMatch(/FUNCTION public\.crm_backfill_lead_values/);
    expect(migrationSql).not.toMatch(/^\s*SELECT\s+.*crm_backfill_lead_values/mi);
    expect(migrationSql).not.toMatch(/PERFORM crm_backfill_lead_values/);
  });
});
