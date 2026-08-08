/**
 * ════════════════════════════════════════════════
 * FILE: oop-estimate-grouped-lines.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks the change that stopped the OOP calculator from printing our internal
 *   price breakdown onto the customer's estimate. It confirms the conversion
 *   writes at most two grouped lines (the service, and equipment) instead of one
 *   line per priced item, that it fills in the QuickBooks Item and Class so
 *   nobody has to pick them by hand, and that the QuickBooks IDs it writes are
 *   the SAME ones the estimate server falls back to. It also confirms the undo
 *   script exists and really puts the old itemized behavior back.
 *
 * DEPENDS ON:
 *   Internal:  supabase/migrations/20260807210000_oop_estimate_grouped_lines.sql,
 *              supabase/rollbacks/20260807210000_oop_estimate_grouped_lines.rollback.sql,
 *              supabase/migrations/20260803192344_oop_quote_to_estimate.sql,
 *              functions/lib/quickbooks.js
 *   Data:      reads  → none (source text only)
 *
 * NOTES / GOTCHAS:
 *   - Sources are read as TEXT. The migration is SQL and functions/ is a separate
 *     Cloudflare bundle, so text comparison is the only way to pin both in one
 *     credential-free lane. Same pattern as billing-role-surface-parity.test.js.
 *   - This proves INTENT, not effect: it shows the reviewed migration says what it
 *     claims. Proving the database actually produces two lines needs a behavioural
 *     run against a disposable stack during the apply window.
 *   - The QuickBooks IDs are duplicated on purpose (SQL cannot import JS). If you
 *     change one, change both — that is what the parity cases below exist to catch.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const MIGRATION = 'supabase/migrations/20260807210000_oop_estimate_grouped_lines.sql';
const ROLLBACK = 'supabase/rollbacks/20260807210000_oop_estimate_grouped_lines.rollback.sql';
const ORIGIN = 'supabase/migrations/20260803192344_oop_quote_to_estimate.sql';
const QBO_LIB = 'functions/lib/quickbooks.js';

// The realm's only non-Reconstruction class. Both water and mold work belongs to it.
const MITIGATION_CLASS_ID = '1000000005';
const WATER_ITEM_ID = '1010000071';
const MOLD_ITEM_ID = '1010000131';

/**
 * Pull one `if (d.includes('x')) return { … };` arm out of divisionToQbo.
 * Lazy across newlines on purpose — the water arm wraps its return onto the
 * next line, and lazy matching still stops at that arm's own return.
 */
const divisionArm = (source, needle) => {
  const match = source.match(
    new RegExp(`d\\.includes\\('${needle}'\\)[\\s\\S]*?return \\{([^}]*)\\}`),
  );
  if (!match) throw new Error(`divisionToQbo arm for '${needle}' not found`);
  const arm = match[1];
  const field = (name) => {
    const hit = arm.match(new RegExp(`${name}:\\s*(?:'([^']*)'|(null))`));
    return hit ? (hit[2] ? null : hit[1]) : undefined;
  };
  return { itemId: field('itemId'), className: field('className') };
};

describe('OOP estimate conversion writes grouped customer lines', () => {
  const sql = read(MIGRATION);

  it('replaces the conversion function body without changing its signature', () => {
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.convert_oop_quote_to_estimate(p_quote_id uuid)',
    );
    expect(sql).toContain('RETURNS jsonb');
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain("SET search_path TO ''");
    // Same return shape the deployed calculator reads (result.estimate_id / .created).
    expect(sql).toContain("jsonb_build_object('ok',true,'estimate_id',v_estimate.id,'created',true)");
    expect(sql).toContain("jsonb_build_object('ok',true,'estimate_id',v_estimate.id,'created',false)");
  });

  it('is body-only — it creates, drops and alters nothing', () => {
    for (const forbidden of [
      /\bDROP\s+TABLE\b/i, /\bDROP\s+POLICY\b/i, /\bDROP\s+TRIGGER\b/i, /\bDROP\s+INDEX\b/i,
      /\bALTER\s+TABLE\b/i, /\bCREATE\s+TABLE\b/i, /\bCREATE\s+POLICY\b/i, /\bCREATE\s+TRIGGER\b/i,
      /\bCREATE\s+(UNIQUE\s+)?INDEX\b/i, /\bDROP\s+FUNCTION\b/i,
    ]) {
      expect(sql, `migration must not contain ${forbidden}`).not.toMatch(forbidden);
    }
  });

  it('buckets priced items by the price list section, not by a hardcoded key list', () => {
    // The rule has to be section-driven so a new equipment item added in the
    // pricing builder lands in the equipment bucket without editing this function.
    expect(sql).toContain("v_section := lower(btrim(COALESCE(v_item->>'section', '')));");
    expect(sql).toContain("IF v_section = 'equipment' THEN");
    expect(sql).toContain('v_equipment_total := v_equipment_total + v_amount;');
    expect(sql).toContain('v_service_total := v_service_total + v_amount;');
  });

  it('emits at most two lines — one service, one equipment', () => {
    const inserts = sql.match(/INSERT INTO public\.estimate_line_items/g) || [];
    expect(inserts).toHaveLength(2);
    expect(sql).toContain('IF v_service_total > 0 THEN');
    expect(sql).toContain('IF v_equipment_total > 0 THEN');
    // Each grouped line is a flat 1 × total, never quantity × rate.
    expect(sql).toContain('v_estimate.id, v_service_description, 1, NULL, v_service_total, 0,');
    expect(sql).toContain('v_estimate.id, v_equipment_description, 1, NULL, v_equipment_total, 1,');
  });

  it('never leaks the internal breakdown onto the customer document', () => {
    // The old body built per-item descriptions like "Air mover (6 units × 3 days)"
    // and copied each priced item across. Neither may survive.
    expect(sql).not.toContain('units × %s days');
    expect(sql).not.toContain("v_description := v_item->>'label'");
    // Internal-only items (PRV, Overhead) stay excluded by the customerVisible gate.
    expect(sql).toContain("NOT COALESCE((v_line->>'customerVisible')::boolean,false)");
  });

  it('keeps the project minimum adjustment with the service, not with equipment', () => {
    expect(sql).toMatch(
      /key' = 'project_minimum_adjustment' THEN[\s\S]{0,320}?v_service_total := v_service_total \+ v_amount;/,
    );
  });

  it('still refuses to create an estimate whose total drifts from the quote', () => {
    expect(sql).toContain('IF v_total <> round(v_quote.quote_total, 2) THEN');
    expect(sql).toContain("RAISE EXCEPTION 'oop_quote_estimate_total_mismatch'");
    expect(sql).toContain("IF v_inserted = 0 THEN RAISE EXCEPTION 'oop_quote_customer_lines_required'");
  });

  it('keeps the billing-role gate and the browser-only grant', () => {
    expect(sql).toContain("IF v_role IS NULL OR v_role NOT IN ('admin','manager') THEN");
    expect(sql).toContain("RAISE EXCEPTION 'not_authorized: billing role required' USING ERRCODE = '42501'");
    // REVOKE must precede GRANT — this managed project re-applies EXECUTE TO PUBLIC
    // to every replaced function.
    const revoke = sql.indexOf('REVOKE EXECUTE ON FUNCTION public.convert_oop_quote_to_estimate(uuid)');
    const grant = sql.indexOf('GRANT EXECUTE ON FUNCTION public.convert_oop_quote_to_estimate(uuid)');
    expect(revoke).toBeGreaterThan(-1);
    expect(grant).toBeGreaterThan(revoke);
    expect(sql).toContain('FROM PUBLIC, anon, authenticated, service_role;');
    expect(sql).toContain('TO authenticated;');
    expect(sql).not.toMatch(/GRANT[^;]*\banon\b/);
  });
});

describe('the grouped lines carry QuickBooks Item and Class', () => {
  const sql = read(MIGRATION);

  it('sets the QuickBooks columns on both inserted lines', () => {
    const columnBlocks = sql.match(
      /qbo_item_id, qbo_item_name, qbo_class_id, qbo_class_name/g,
    ) || [];
    expect(columnBlocks).toHaveLength(2);
    const classValues = sql.match(/'1000000005', 'Mitigation'/g) || [];
    expect(classValues).toHaveLength(2);
  });

  it('classes both water and mold work as Mitigation', () => {
    expect(sql).toContain(`'${MITIGATION_CLASS_ID}', 'Mitigation'`);
    // Reconstruction is the only other class in the realm and must never be chosen here.
    expect(sql).not.toContain("'Reconstruction'");
  });

  it('picks the service item from the quote job type', () => {
    expect(sql).toMatch(
      new RegExp(`v_quote\\.job_type = 'mold'[\\s\\S]*?v_qbo_item_id := '${MOLD_ITEM_ID}'`),
    );
    expect(sql).toContain("v_qbo_item_name := 'Mold Remediation Services'");
    expect(sql).toContain(`v_qbo_item_id := '${WATER_ITEM_ID}'`);
    expect(sql).toContain("v_qbo_item_name := 'Water Damage Mitigation And Drying'");
  });

  it('writes a plain-English scope of work for each job type', () => {
    expect(sql).toContain("v_service_description :=\n      'Mold remediation.");
    expect(sql).toContain("v_service_description :=\n      'Water damage mitigation and structural drying.");
    // The equipment description names the equipment actually quoted.
    expect(sql).toContain("array_to_string(v_equipment_labels, ', ')");
  });
});

describe('the migration and the estimate Worker fallback agree', () => {
  // SQL cannot import divisionToQbo(), so the IDs are duplicated. These cases are
  // what make that duplication safe: change one side and this fails.
  const lib = read(QBO_LIB);

  it('water maps to the same item and class the migration writes', () => {
    const water = divisionArm(lib, 'water');
    expect(water.itemId).toBe(WATER_ITEM_ID);
    expect(water.className).toBe('Mitigation');
  });

  it('mold is classed as Mitigation, not left unclassed', () => {
    // Returned null until 2026-08-07, so every mold estimate and invoice pushed to
    // QuickBooks with no Class and mold revenue was unattributed in reporting.
    const mold = divisionArm(lib, 'mold');
    expect(mold.itemId).toBe(MOLD_ITEM_ID);
    expect(mold.className).toBe('Mitigation');
  });

  it('reconstruction keeps its own class — the widening must not reach it', () => {
    expect(divisionArm(lib, 'recon').className).toBe('Reconstruction');
  });
});

describe('the migration ships a working undo', () => {
  const rollback = read(ROLLBACK);
  const origin = read(ORIGIN);

  it('restores the itemized body from the original migration', () => {
    expect(rollback).toContain(
      'CREATE OR REPLACE FUNCTION public.convert_oop_quote_to_estimate(p_quote_id uuid)',
    );
    // The per-item description format is the fingerprint of the pre-grouping body.
    expect(rollback).toContain('units × %s days');
    expect(rollback).toContain("v_description := v_item->>'label';");
    // And the restored body must be the ORIGINAL one, not a paraphrase of it.
    const bodyOf = (source) => {
      const start = source.indexOf('  v_actor := public.oop_pricing_active_employee(false);');
      const end = source.indexOf("RETURN jsonb_build_object('ok',true,'estimate_id',v_estimate.id,'created',true);", start);
      expect(start, 'function body start not found').toBeGreaterThan(-1);
      expect(end, 'function body end not found').toBeGreaterThan(start);
      return source.slice(start, end);
    };
    expect(bodyOf(rollback)).toBe(bodyOf(origin));
  });

  it('drops nothing and re-asserts the same grant posture', () => {
    expect(rollback).not.toMatch(/\bDROP\s+FUNCTION\b/i);
    expect(rollback).not.toMatch(/\bALTER\s+TABLE\b/i);
    const revoke = rollback.indexOf('REVOKE EXECUTE ON FUNCTION public.convert_oop_quote_to_estimate(uuid)');
    const grant = rollback.indexOf('GRANT EXECUTE ON FUNCTION public.convert_oop_quote_to_estimate(uuid)');
    expect(revoke).toBeGreaterThan(-1);
    expect(grant).toBeGreaterThan(revoke);
    expect(rollback).not.toMatch(/GRANT[^;]*\banon\b/);
  });
});
