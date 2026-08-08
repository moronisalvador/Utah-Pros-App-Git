/**
 * ════════════════════════════════════════════════
 * FILE: migration-version-uniqueness.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks that no two database migration files start with the same timestamp.
 *   The database records which migrations have run by that timestamp alone, so
 *   two files sharing one means the second is treated as already done and is
 *   silently skipped — a change that looks applied but never ran.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path
 *   Internal:  supabase/migrations/*.sql,
 *              scripts/qa/migration-version-baseline.json
 *   Data:      reads  → migration filenames only
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Nothing else catches this. scripts/check-migration-hygiene.mjs read 298
 *     migrations on 2026-08-07 (grandfathering 257) and did not flag the live
 *     collision that forced
 *     oop_estimate_grouped_lines to be renumbered from 20260807190000 to
 *     20260807210000 — the number had been taken by invoice_qbo_email_mirror
 *     while that work was in progress.
 *   - SHRINK-ONLY, matching the other ratchets. One historical collision is
 *     grandfathered: 20260724180000 carries both crm_lead_notes and
 *     qbo_attachments. Both are long applied, so renaming them now would break
 *     the ledger mapping; the entry documents the debt rather than hiding it.
 *   - Filenames only. This says nothing about whether a migration is correct,
 *     applied, or safe.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const BASELINE = JSON.parse(
  readFileSync(join(ROOT, 'scripts', 'qa', 'migration-version-baseline.json'), 'utf8'),
);

/**
 * The GOVERNED set: 14-digit `YYYYMMDDHHMMSS_` migrations.
 *
 * 211 of the 302 files use a legacy DATE-ONLY 8-digit prefix, where sharing a
 * prefix was the norm — 20260701_ alone covers 23 files. Those are grandfathered
 * wholesale by scripts/check-migration-hygiene.mjs (257 of 298 on 2026-08-07) and
 * are not what this rule is about. Applying a uniqueness rule to them would
 * report ~20 "collisions" that were deliberate and are long applied.
 */
const versioned = readdirSync(MIGRATIONS)
  .filter((f) => /^\d{14}_.*\.sql$/.test(f))
  .sort();

const byVersion = new Map();
for (const file of versioned) {
  const version = file.slice(0, 14);
  byVersion.set(version, [...(byVersion.get(version) ?? []), file]);
}

const collisions = [...byVersion.entries()]
  .filter(([, files]) => files.length > 1)
  .map(([version]) => version)
  .sort();

describe('migration version uniqueness', () => {
  it('finds versioned migrations to check', () => {
    // Guards against the check silently passing because the glob broke — the
    // exact failure mode that let the bundle-size gate do nothing for weeks.
    // 90 governed migrations on 2026-08-07 and only ever growing; a floor of 50
    // catches a broken pattern without failing on ordinary additions.
    expect(versioned.length).toBeGreaterThan(50);
  });

  it('no NEW duplicate migration version', () => {
    const known = new Set(BASELINE.knownCollisions);
    const added = collisions.filter((v) => !known.has(v));
    expect(
      added.map((v) => `${v}: ${byVersion.get(v).join(', ')}`),
      'Two migrations share a version prefix. The Supabase ledger keys on that '
      + 'prefix, so only one of them will ever be recorded as applied and the other '
      + 'is silently skipped. Renumber the UNAPPLIED one — and re-pin any drift '
      + 'guard or qualifier predecessor that names it by path.',
    ).toEqual([]);
  });

  it('the collision baseline has no stale entries', () => {
    const live = new Set(collisions);
    const stale = BASELINE.knownCollisions.filter((v) => !live.has(v));
    expect(
      stale,
      'These versions no longer collide — remove them from '
      + 'scripts/qa/migration-version-baseline.json so the list can only shrink.',
    ).toEqual([]);
  });

  it('the two OOP migrations that replace one function body stay ordered', () => {
    // 20260807220000 is 20260807210000's body with only the gate swapped, and its
    // drift guard pins that body's md5. If they ever invert, the guard aborts
    // rather than silently reverting grouped lines — but the ordering is the
    // intent, so pin it here too.
    const groupedLines = versioned.find((f) => f.endsWith('_oop_estimate_grouped_lines.sql'));
    const boundary = versioned.find((f) => f.endsWith('_oop_convert_estimate_billing_boundary.sql'));
    expect(groupedLines, 'grouped-lines migration not found').toBeTruthy();
    expect(boundary, 'convert-boundary migration not found').toBeTruthy();
    expect(groupedLines.slice(0, 14) < boundary.slice(0, 14)).toBe(true);
  });
});
