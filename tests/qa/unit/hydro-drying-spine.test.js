/**
 * ════════════════════════════════════════════════
 * FILE: hydro-drying-spine.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Reads the two migrations that build UPR's new drying-record system and
 *   checks they really do what their headers claim: the new tables cannot be
 *   written straight from a browser, every write function checks who is calling,
 *   a reading always records the air pressure used to calculate it, the old
 *   "anyone can delete anything" rules are actually removed, and each undo file
 *   puts things back the way they were.
 *
 * DEPENDS ON:
 *   Packages:  node:fs, node:path, node:url, vitest
 *   Internal:  supabase/migrations/20260817010000_hydro_drying_spine.sql
 *              supabase/migrations/20260817020000_hydro_legacy_access_hardening.sql
 *              + both paired rollbacks
 *   Data:      reads → repository source only · writes → none
 *
 * NOTES / GOTCHAS:
 *   - This proves INTENT, not EFFECT. It runs in the credential-free `qa` lane
 *     and never touches a database. The behavioural proof required by
 *     database-standard.md §5b — per-role ALLOW *and* DENY on a disposable local
 *     stack, including the roles the change is not "about" — is a separate and
 *     still-open gate before either migration may be applied.
 *   - Counting assertions run against EXECUTABLE SQL only. Both migrations
 *     document their reasoning at length and those comments quote the exact
 *     strings under test ("SECURITY DEFINER", "USING (true)", "NOT_AUTHORIZED"),
 *     so matching the raw file would count the prose and make the test lie.
 * ════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (relative) => readFileSync(path.join(repositoryRoot, relative), 'utf8');

const SPINE = '20260817010000_hydro_drying_spine';
const HARDEN = '20260817020000_hydro_legacy_access_hardening';

const spine = read(`supabase/migrations/${SPINE}.sql`);
const spineRollback = read(`supabase/rollbacks/${SPINE}.rollback.sql`);
const harden = read(`supabase/migrations/${HARDEN}.sql`);
const hardenRollback = read(`supabase/rollbacks/${HARDEN}.rollback.sql`);

const stripComments = (sql) => sql.replace(/^\s*--.*$/gm, '');
const spineSql = stripComments(spine);
const spineRollbackSql = stripComments(spineRollback);
const hardenSql = stripComments(harden);
const hardenRollbackSql = stripComments(hardenRollback);

const HYDRO_TABLES = [
  'hydro_drying_chambers',
  'hydro_chamber_rooms',
  'hydro_monitoring_points',
  'hydro_readings',
];

const WRITE_RPCS = ['hydro_upsert_chamber', 'hydro_upsert_point', 'hydro_insert_reading'];

describe('Hydro F1 — the drying spine', () => {
  it('creates all four tables with row-level security enabled', () => {
    for (const table of HYDRO_TABLES) {
      expect(spineSql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}\\b`));
      expect(spineSql).toMatch(new RegExp(`ALTER TABLE public\\.${table}\\s+ENABLE ROW LEVEL SECURITY`));
    }
  });

  it('gives the browser NO write path to any hydro table', () => {
    // The whole posture: authenticated reads, definers write. A single stray
    // INSERT/UPDATE/DELETE grant to `authenticated` would let the browser skip
    // every caller check in the RPCs — which is precisely the hole that makes
    // the legacy `insert_reading` bypassable today.
    for (const table of HYDRO_TABLES) {
      expect(spineSql).toMatch(new RegExp(`GRANT SELECT ON TABLE public\\.${table}\\s+TO authenticated`));
    }
    const authenticatedWriteGrant = new RegExp(
      String.raw`GRANT[^;]*\b(INSERT|UPDATE|DELETE)\b[^;]*ON TABLE public\.hydro_[^;]*TO[^;]*\bauthenticated\b`,
      'i',
    );
    expect(authenticatedWriteGrant.test(spineSql)).toBe(false);
  });

  it('never grants anon anything, and revokes it explicitly', () => {
    expect(/GRANT[^;]*\bTO\b[^;]*\banon\b/i.test(spineSql)).toBe(false);
    for (const table of HYDRO_TABLES) {
      expect(spineSql).toMatch(new RegExp(`REVOKE ALL ON TABLE public\\.${table}\\s+FROM PUBLIC, anon`));
    }
  });

  it('gates every write RPC on hydro_access() with a NULL-safe bypass check', () => {
    for (const rpc of WRITE_RPCS) {
      expect(spineSql).toMatch(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${rpc}\\b`));
    }
    // One gate per write RPC plus the read RPC = 4.
    const gates = spineSql.match(/auth\.role\(\) IS DISTINCT FROM 'service_role'/g) || [];
    expect(gates).toHaveLength(4);

    // `<>` instead of `IS DISTINCT FROM` evaluates to NULL outside a PostgREST
    // request, and PL/pgSQL's IF treats NULL as false — silently skipping the
    // gate. Recorded against 20260805020000; pinned here so it cannot come back.
    expect(/auth\.role\(\)\s*<>/.test(spineSql)).toBe(false);

    const raises = spineSql.match(/RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501'/g) || [];
    expect(raises).toHaveLength(4);
  });

  it('revokes PUBLIC and anon before every function grant', () => {
    const definers = spineSql.match(/SECURITY DEFINER/g) || [];
    expect(definers.length).toBeGreaterThanOrEqual(5); // helper + 3 writers + reader

    const revokes = spineSql.match(/REVOKE EXECUTE ON FUNCTION[\s\S]*?FROM PUBLIC, anon/g) || [];
    expect(revokes).toHaveLength(5);

    // This managed project re-applies EXECUTE TO PUBLIC to every new function,
    // so the revoke must precede the grant for each one.
    const helperRevoke = spineSql.indexOf('REVOKE EXECUTE ON FUNCTION public.hydro_access()');
    const helperGrant = spineSql.indexOf('GRANT EXECUTE ON FUNCTION public.hydro_access()');
    expect(helperRevoke).toBeGreaterThan(-1);
    expect(helperGrant).toBeGreaterThan(helperRevoke);
  });

  it('pins search_path on every function it defines', () => {
    const functions = spineSql.match(/CREATE OR REPLACE FUNCTION/g) || [];
    const pinned = spineSql.match(/SET search_path = ''/g) || [];
    expect(pinned).toHaveLength(functions.length);
  });

  it('requires the atmospheric pressure that produced each reading', () => {
    // The whole point of the elevation fix: a reading must re-derive to the
    // same GPP years later even after the site elevation or the formula is
    // corrected. Nullable pressure would let a row exist that cannot be checked.
    expect(spineSql).toMatch(/atmospheric_pressure_inhg\s+numeric NOT NULL/);
    expect(spineSql).toMatch(/psychrometric_version\s+smallint NOT NULL/);
    expect(spineSql).toMatch(/CHECK \(atmospheric_pressure_inhg BETWEEN 15 AND 32\)/);
    // And the chamber must carry the elevation it was derived from.
    expect(spineSql).toMatch(/site_elevation_ft\s+integer NOT NULL DEFAULT 4500/);
  });

  it('constrains every reading kind so one table cannot rot into loose columns', () => {
    expect(spineSql).toMatch(/CONSTRAINT hydro_reading_shape CHECK/);
    for (const kind of ['material', 'affected_air', 'control_air', 'dehumidifier']) {
      expect(spineSql).toMatch(new RegExp(`WHEN '${kind}' THEN`));
    }
  });

  it('models the control reading as a three-way source, never a boolean', () => {
    // `is_affected BOOLEAN` is exactly what the legacy table got wrong: exterior
    // air, unaffected interior air and HVAC supply are different references and
    // are not interchangeable.
    expect(spineSql).toMatch(
      /CREATE TYPE public\.hydro_control_source AS ENUM \(\s*'exterior', 'interior_unaffected', 'interior_hvac'\s*\)/,
    );
  });

  it('carries the IICRC S500 classification on the chamber', () => {
    expect(spineSql).toMatch(/'category1', 'category2', 'category3', 'special_situation'/);
    expect(spineSql).toMatch(/'class1', 'class2', 'class3', 'class4'/);
    expect(spineSql).toMatch(/'in_drying', 'in_stabilization', 'dry'/);
  });

  it('leaves the deployed frontend contract completely alone', () => {
    // get_job_readings, insert_reading, place_equipment and moisture_readings
    // back the shipped Dry Logs card. F1 is additive; touching them is F2's job.
    expect(/CREATE OR REPLACE FUNCTION public\.get_job_readings/.test(spineSql)).toBe(false);
    expect(/CREATE OR REPLACE FUNCTION public\.insert_reading/.test(spineSql)).toBe(false);
    expect(/ALTER TABLE public\.moisture_readings/.test(spineSql)).toBe(false);
    expect(/DROP POLICY[^;]*ON public\.moisture_readings/.test(spineSql)).toBe(false);
  });

  it('carries no destructive DDL at all', () => {
    expect(/\bDROP TABLE\b/i.test(spineSql)).toBe(false);
    expect(/\bDROP COLUMN\b/i.test(spineSql)).toBe(false);
    expect(/\bALTER COLUMN\b/i.test(spineSql)).toBe(false);
  });

  it('verifies its own work before the apply is allowed to succeed', () => {
    expect(spineSql).toMatch(/POSTCONDITION: missing table/);
    expect(spineSql).toMatch(/POSTCONDITION: anon holds a grant on a hydro table/);
    expect(spineSql).toMatch(/POSTCONDITION: authenticated holds a write grant/);
  });
});

describe('Hydro F1 — rollback', () => {
  it('drops everything the migration created, in dependency order', () => {
    const readingsAt = spineRollbackSql.indexOf('DROP TABLE IF EXISTS public.hydro_readings');
    const pointsAt = spineRollbackSql.indexOf('DROP TABLE IF EXISTS public.hydro_monitoring_points');
    const chambersAt = spineRollbackSql.indexOf('DROP TABLE IF EXISTS public.hydro_drying_chambers');
    expect(readingsAt).toBeGreaterThan(-1);
    expect(pointsAt).toBeGreaterThan(readingsAt);
    expect(chambersAt).toBeGreaterThan(pointsAt);

    for (const rpc of [...WRITE_RPCS, 'get_hydro_log', 'hydro_access']) {
      expect(spineRollbackSql).toMatch(new RegExp(`DROP FUNCTION IF EXISTS public\\.${rpc}\\b`));
    }
  });

  it('refuses to run once real drying data exists', () => {
    // database-standard.md §6: an undo that destroys data must say so and must
    // not be reachable by pasting the file.
    expect(spineRollbackSql).toMatch(/REFUSING ROLLBACK/);
    expect(spineRollbackSql).toMatch(/upr\.confirm_hydro_data_loss/);
    expect(spineRollback).toMatch(/DATA LOSS/);
  });

  it('proves it did not touch the legacy path on the way out', () => {
    expect(spineRollbackSql).toMatch(/ROLLBACK POSTCONDITION: moisture_readings is missing/);
    expect(spineRollbackSql).toMatch(/ROLLBACK POSTCONDITION: get_job_readings is missing/);
  });
});

describe('Hydro F2 — legacy access hardening', () => {
  it('removes both always-true policies and replaces them with a scoped read', () => {
    expect(hardenSql).toMatch(/DROP POLICY IF EXISTS moisture_authenticated_all ON public\.moisture_readings/);
    expect(hardenSql).toMatch(/DROP POLICY IF EXISTS equip_authenticated_all ON public\.equipment_placements/);
    expect(hardenSql).toMatch(/CREATE POLICY moisture_internal_read[\s\S]*?FOR SELECT TO authenticated USING \(public\.hydro_access\(\)\)/);
    expect(hardenSql).toMatch(/CREATE POLICY equip_internal_read[\s\S]*?FOR SELECT TO authenticated USING \(public\.hydro_access\(\)\)/);

    // No new always-true policy may sneak in.
    expect(/CREATE POLICY[^;]*USING \(true\)/i.test(hardenSql)).toBe(false);
  });

  it('withdraws the anon table grants', () => {
    expect(hardenSql).toMatch(/REVOKE ALL ON TABLE public\.moisture_readings\s+FROM anon/);
    expect(hardenSql).toMatch(/REVOKE ALL ON TABLE public\.equipment_placements FROM anon/);
    expect(/GRANT[^;]*\bTO\b[^;]*\banon\b/i.test(hardenSql)).toBe(false);
  });

  it('leaves authenticated with SELECT and nothing more', () => {
    expect(hardenSql).toMatch(/REVOKE ALL ON TABLE public\.moisture_readings\s+FROM authenticated/);
    expect(hardenSql).toMatch(/GRANT SELECT ON TABLE public\.moisture_readings\s+TO authenticated/);
    const writeGrant = /GRANT[^;]*\b(INSERT|UPDATE|DELETE|ALL)\b[^;]*ON TABLE public\.(moisture_readings|equipment_placements)[^;]*TO[^;]*authenticated/i;
    expect(writeGrant.test(hardenSql)).toBe(false);
  });

  it('gates both live writers without changing their signatures', () => {
    const gates = hardenSql.match(/auth\.role\(\) IS DISTINCT FROM 'service_role'/g) || [];
    expect(gates).toHaveLength(2);
    expect(/auth\.role\(\)\s*<>/.test(hardenSql)).toBe(false);

    // The shipped dispatchers call these by name with these exact parameters.
    // A changed signature would break readingDispatcher.js / equipmentDispatcher.js.
    expect(hardenSql).toMatch(/RETURNS public\.moisture_readings/);
    expect(hardenSql).toMatch(/RETURNS public\.equipment_placements/);
    expect(hardenSql).toMatch(/p_taken_at\s+timestamptz DEFAULT now\(\)/);
  });

  it('preserves insert_reading’s dry-standard logic through the body replace', () => {
    // Replacing a body is where behaviour quietly disappears. The carry-forward
    // and the backfill are the parts a careless rewrite would drop.
    expect(hardenSql).toMatch(/v_dry_standard := p_mc;/);
    expect(hardenSql).toMatch(/v_drying_goal\s+:= p_mc \+ 2;/);
    expect(hardenSql).toMatch(/UPDATE moisture_readings\s+SET dry_standard_pct = v_dry_standard/);
  });

  it('refuses to apply against a drifted or already-hardened body', () => {
    expect(hardenSql).toMatch(/PREFLIGHT: insert_reading body has drifted/);
    expect(hardenSql).toMatch(/PREFLIGHT: a caller gate is already present/);
    expect(hardenSql).toMatch(/PREFLIGHT: public\.hydro_access\(\) is missing/);
  });

  it('depends on F1 and says so', () => {
    expect(harden).toMatch(/20260817010000_hydro_drying_spine/);
  });
});

describe('Hydro F2 — rollback', () => {
  it('restores both always-true policies and the prior grants', () => {
    expect(hardenRollbackSql).toMatch(/CREATE POLICY moisture_authenticated_all[\s\S]*?USING \(true\) WITH CHECK \(true\)/);
    expect(hardenRollbackSql).toMatch(/CREATE POLICY equip_authenticated_all[\s\S]*?USING \(true\) WITH CHECK \(true\)/);
    expect(hardenRollbackSql).toMatch(/GRANT ALL ON TABLE public\.moisture_readings\s+TO anon/);
  });

  it('carries the `-- public:` justification its anon grant requires', () => {
    // migration-hygiene enforces this on migrations; the rollback re-grants anon
    // too, and the reasoning belongs beside it either way.
    expect(hardenRollback).toMatch(/--\s*public:/);
  });

  it('says plainly that it re-opens a hole', () => {
    expect(hardenRollback).toMatch(/RE-OPENS A REAL HOLE/);
  });

  it('restores ungated bodies and proves no gate survived', () => {
    expect(/NOT_AUTHORIZED' USING ERRCODE/.test(hardenRollbackSql.split('ROLLBACK POSTCONDITION')[0])).toBe(false);
    expect(hardenRollbackSql).toMatch(/ROLLBACK POSTCONDITION: a caller gate survived/);
  });

  it('does not remove hydro_access(), which F1 owns', () => {
    expect(/DROP FUNCTION IF EXISTS public\.hydro_access/.test(hardenRollbackSql)).toBe(false);
    expect(hardenRollbackSql).toMatch(/ROLLBACK POSTCONDITION: hydro_access\(\) was removed/);
  });
});
