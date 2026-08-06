/**
 * ════════════════════════════════════════════════
 * FILE: qbo-receipt-service-role-check-repair.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks the repair that makes the grouped QuickBooks "receive payment"
 *   feature usable at all. Every one of its eight database routines asked
 *   whether the caller was the service account using an old setting name this
 *   project's API layer no longer fills in, so every attempt was refused. These
 *   checks read the repair file and prove three things without needing any
 *   database password: the old setting name is gone from all eight, the
 *   replacement is the one already proven to work elsewhere in this project,
 *   and nothing else about those eight routines changed.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path, node:url
 *   Internal:  the repair migration, its rollback, the receipt foundation it
 *              replaces, and the QBO invoice command ledger it borrows from
 *   Data:      reads  → repository SQL files
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - These checks prove SOURCE INTENT, not that the migration was applied and
 *     not that a real payment succeeds. Behavioral proof belongs to the db lane
 *     against an isolated database, which does not run in the credential-free
 *     lanes.
 *   - The trap this guards: the seven receipt RPCs are SECURITY DEFINER, so a
 *     `current_user` test would resolve to the function OWNER, not the caller,
 *     and would break them a second way while looking correct.
 * ════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

const repair = read('supabase/migrations/20260805010000_qbo_receipt_service_role_check_repair.sql');
const rollback = read('supabase/rollbacks/20260805010000_qbo_receipt_service_role_check_repair.rollback.sql');
const foundation = read('supabase/migrations/20260731045407_qbo_multi_invoice_payment_receipts.sql');
const commandLedger = read('supabase/migrations/20260731210000_qbo_invoice_command_ledger.sql');

const LEGACY_GUC = 'request.jwt.claim.role';
const LEGACY_CHECK = "IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN";
const REPAIRED_CHECK = "IF auth.role() <> 'service_role' THEN";

/** The eighth entry is the payments receipt-link trigger function — SECURITY INVOKER, and the
 *  one the original diagnosis list omitted. It fires inside the definer RPCs when they insert
 *  the per-invoice payment projections, so leaving it on the broken check would keep
 *  finalize_qbo_payment_receipt failing even with all seven RPCs repaired. */
const DEFINER_FUNCTIONS = [
  'claim_qbo_receipt_event',
  'reserve_qbo_payment_receipt',
  'mark_qbo_payment_receipt_created',
  'finalize_qbo_payment_receipt',
  'reconcile_qbo_payment_receipt',
  'remove_qbo_payment_receipt',
  'fail_qbo_payment_receipt_attempt',
];
const INVOKER_FUNCTION = 'guard_payment_receipt_link_write';
const ALL_FUNCTIONS = [INVOKER_FUNCTION, ...DEFINER_FUNCTIONS];

const SIGNATURES = {
  guard_payment_receipt_link_write: 'public.guard_payment_receipt_link_write()',
  claim_qbo_receipt_event: 'public.claim_qbo_receipt_event(text, text, text, text, text, timestamptz)',
  reserve_qbo_payment_receipt: 'public.reserve_qbo_payment_receipt(text, text, text, text, jsonb, uuid)',
  mark_qbo_payment_receipt_created: 'public.mark_qbo_payment_receipt_created(uuid, text, jsonb)',
  finalize_qbo_payment_receipt: 'public.finalize_qbo_payment_receipt(uuid, jsonb, jsonb)',
  reconcile_qbo_payment_receipt: 'public.reconcile_qbo_payment_receipt(jsonb, jsonb, text, text)',
  remove_qbo_payment_receipt: 'public.remove_qbo_payment_receipt(text, text, text, text)',
  fail_qbo_payment_receipt_attempt: 'public.fail_qbo_payment_receipt_attempt(uuid, text, text, text)',
};

/** Strips every CREATE OR REPLACE FUNCTION body so the "touches nothing else" checks read only
 *  top-level statements. The restored bodies legitimately contain INSERT/UPDATE/DELETE against the
 *  receipt tables — that is what those routines do — and matching inside them proves nothing. */
function topLevel(sql) {
  return sql.replace(/CREATE OR REPLACE FUNCTION public\.[\s\S]*?\n\$function\$;/g, '');
}

/** Drops `--` comments so "this file contains no statement doing X" assertions read executable SQL
 *  and are not tripped by prose that merely discusses X. */
const executable = (sql) => sql.replace(/--[^\n]*/g, '');

function functionBlock(sql, name, label) {
  const match = sql.match(new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\n\\$function\\$;`,
  ));
  expect(match, `${name} function source in ${label}`).not.toBeNull();
  return match[0];
}

describe('QBO receipt service-role check repair — the broken gate is gone', () => {
  it('removes the legacy flattened GUC from every one of the eight function bodies', () => {
    for (const name of ALL_FUNCTIONS) {
      const block = functionBlock(repair, name, 'repair');
      expect(block, `${name} still carries the legacy GUC`).not.toContain(LEGACY_GUC);
      expect(block, `${name} is missing the repaired check`).toContain(REPAIRED_CHECK);
    }
  });

  it('repairs the trigger function too, not only the seven RPCs', () => {
    // finalize_qbo_payment_receipt inserts into public.payments with receipt_id set, which fires
    // guard_payment_receipt_link_write. Repairing only the RPCs would move the same 42501 one
    // layer down.
    const guard = functionBlock(repair, INVOKER_FUNCTION, 'repair');
    expect(guard).toContain(REPAIRED_CHECK);
    expect(foundation).toContain('CREATE TRIGGER guard_payment_receipt_link_insert');
    expect(functionBlock(foundation, INVOKER_FUNCTION, 'foundation')).toContain(LEGACY_GUC);
  });

  it('never substitutes current_user, which resolves to the owner inside SECURITY DEFINER', () => {
    for (const name of ALL_FUNCTIONS) {
      expect(functionBlock(repair, name, 'repair')).not.toContain('current_user');
    }
  });

  it('uses the idiom already carried by the applied QBO invoice command ledger', () => {
    expect(commandLedger).toContain(REPAIRED_CHECK);
    expect(commandLedger).toContain('SECURITY DEFINER');
  });
});

describe('QBO receipt service-role check repair — nothing else changed', () => {
  it('changes exactly one line per function and preserves every body verbatim', () => {
    for (const name of ALL_FUNCTIONS) {
      const before = functionBlock(foundation, name, 'foundation');
      const after = functionBlock(repair, name, 'repair');
      const normalized = before.split(LEGACY_CHECK).join(REPAIRED_CHECK);
      expect(after, `${name} body drifted beyond its role check`).toBe(normalized);
      expect(before.split(LEGACY_CHECK).length - 1, `${name} legacy check count`).toBe(1);
    }
  });

  it('preserves the SECURITY DEFINER / SECURITY INVOKER split', () => {
    for (const name of DEFINER_FUNCTIONS) {
      expect(functionBlock(repair, name, 'repair'), name).toContain('SECURITY DEFINER');
    }
    const guard = functionBlock(repair, INVOKER_FUNCTION, 'repair');
    expect(guard).toContain('SECURITY INVOKER');
    expect(guard).not.toContain('SECURITY DEFINER');
  });

  it('keeps the pinned search_path on all eight', () => {
    for (const name of ALL_FUNCTIONS) {
      expect(functionBlock(repair, name, 'repair'), name)
        .toContain('SET search_path = pg_catalog, public');
    }
  });

  it('touches no table, column, index, policy, trigger, flag, or row', () => {
    const sql = topLevel(repair);
    expect(sql).not.toMatch(/\bCREATE\s+TABLE\b/i);
    expect(sql).not.toMatch(/\bALTER\s+TABLE\b/i);
    expect(sql).not.toMatch(/\bCREATE\s+(?:UNIQUE\s+)?INDEX\b/i);
    expect(sql).not.toMatch(/\bCREATE\s+POLICY\b/i);
    expect(sql).not.toMatch(/\bCREATE\s+TRIGGER\b/i);
    expect(sql).not.toMatch(/\b(?:DROP|RENAME)\s+(?:TABLE|COLUMN|INDEX|POLICY|TRIGGER|FUNCTION)\b/i);
    expect(sql).not.toMatch(/^\s*(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+/im);
  });
});

describe('QBO receipt service-role check repair — the boundary is re-asserted, not widened', () => {
  it('revokes from PUBLIC, anon and authenticated before granting, for all eight', () => {
    for (const name of ALL_FUNCTIONS) {
      const signature = SIGNATURES[name];
      const revoke = `REVOKE EXECUTE ON FUNCTION ${signature} FROM PUBLIC, anon, authenticated;`;
      const grant = `GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`;
      expect(repair, `${name} revoke`).toContain(revoke);
      expect(repair, `${name} grant`).toContain(grant);
      expect(repair.indexOf(revoke), `${name} must revoke before it grants`)
        .toBeLessThan(repair.indexOf(grant));
      expect(rollback, `${name} rollback revoke`).toContain(revoke);
      expect(rollback, `${name} rollback grant`).toContain(grant);
    }
  });

  it('grants nothing to anon or authenticated and adds no allowlist entry', () => {
    expect(repair).not.toMatch(/GRANT[^;]*\bTO\b[^;]*\banon\b/i);
    expect(repair).not.toMatch(/GRANT[^;]*\bTO\b[^;]*\bauthenticated\b/i);
    expect(repair).not.toContain('-- public:');
  });

  it('refuses to run unless all eight live bodies are still the broken ones', () => {
    expect(repair).toContain("AND proc.prosrc LIKE '%request.jwt.claim.role%'");
    expect(repair).toContain('QBO receipt role-check repair drift guard failed');
  });

  it('asserts the definer/invoker split and the ACLs after replacing', () => {
    expect(repair).toContain('QBO receipt role-check repair incomplete');
    expect(repair).toContain('QBO receipt RPC boundary changed during repair');
    expect(repair).toContain('QBO receipt link guard boundary changed during repair');
    expect(repair).toContain('QBO receipt link triggers changed during repair');
    expect(repair).toContain("NOT has_function_privilege('public', proc.oid, 'EXECUTE')");
  });

  it('writes no feature_flags row, so it cannot flip a rollout gate', () => {
    // Narrow claim, deliberately. Both gates are already OPEN on dev/Preview, so applying this
    // repair does make the money path live — it just does not do so by touching the flags table.
    const sql = executable(repair);
    expect(sql).not.toMatch(/UPDATE\s+public\.feature_flags/i);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+public\.feature_flags/i);
    expect(sql).not.toMatch(/enabled\s*=\s*true/i);
    expect(repair).toContain('repair must not be applied under a kill switch');
  });

  it('states the apply consequence in the migration itself', () => {
    expect(repair).toContain('makes the money path live');
  });
});

describe('QBO receipt service-role check repair — rollback', () => {
  it('restores the exact prior body of all eight functions', () => {
    for (const name of ALL_FUNCTIONS) {
      expect(functionBlock(rollback, name, 'rollback'), name)
        .toBe(functionBlock(foundation, name, 'foundation'));
    }
  });

  it('guards against overwriting a newer successor', () => {
    expect(rollback).toContain("AND proc.prosrc LIKE '%auth.role() <> ''service_role''%'");
    expect(rollback).toContain('QBO receipt role-check rollback refused');
  });

  it('touches no receipt, attempt, event, payment or flag row', () => {
    const sql = topLevel(rollback);
    expect(sql).not.toMatch(/^\s*(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+/im);
    expect(sql).not.toMatch(/\bDROP\s+(?:TABLE|POLICY|TRIGGER|FUNCTION)\b/i);
    expect(sql).not.toMatch(/\bCREATE\s+(?:TABLE|POLICY|TRIGGER|INDEX)\b/i);
  });
});
