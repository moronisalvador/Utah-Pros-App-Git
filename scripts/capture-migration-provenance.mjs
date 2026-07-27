#!/usr/bin/env node
/**
 * FILE: capture-migration-provenance.mjs
 *
 * WHAT THIS DOES (plain language):
 *   Builds the read-only database query that collects the live facts the migration
 *   provenance gate needs, then turns that query's answer into the evidence file the
 *   gate reads. Before this existed the evidence was assembled by hand, which is why
 *   it kept going stale: it expires six hours after capture, and a stale file turns
 *   the whole release check red.
 *
 * DEPENDS ON:
 *   Packages:  Node.js built-ins only
 *   Internal:  scripts/migration-provenance-manifest.json (names what to capture),
 *              scripts/check-migration-provenance.mjs (consumes the output)
 *   Data:      reads  → nothing directly; it only PRINTS SQL for a human/tool to run
 *              writes → the evidence JSON passed to --out
 *
 * NOTES / GOTCHAS:
 *   - This never connects to Supabase. It prints SQL and it assembles JSON; that is
 *     deliberate, so capturing evidence never needs a write-capable database path.
 *   - The SQL is SELECT-only and safe to run in a read-only transaction.
 *   - The fingerprint formulas MUST stay identical to normalizeFunctionBody() in
 *     check-migration-provenance.mjs, or every hash silently mismatches. rawMd5 is
 *     md5 of the untouched function body; semanticMd5 strips `--` comments, collapses
 *     whitespace and trims.
 *   - capturedAt starts the six-hour clock, so capture close to when CI will run.
 *
 * USAGE:
 *   node scripts/capture-migration-provenance.mjs --print-sql
 *   node scripts/capture-migration-provenance.mjs --assemble live.json --out docs/audit/2026-07/evidence/<file>.json
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_MANIFEST = 'scripts/migration-provenance-manifest.json';
const METHOD = 'Supabase migration ledger plus read-only pg_proc/pg_policies catalog queries';

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function inList(values) {
  return values.map(sqlLiteral).join(',\n      ');
}

/**
 * The single read-only query. Column aliases are quoted so Postgres preserves the
 * camelCase the gate expects, which lets to_jsonb(row) emit the final shape directly.
 */
export function buildSql(manifest) {
  const functionIds = manifest.selectedFunctions.map((entry) => entry.identity);
  const policyIds = (manifest.selectedPolicies || []).map((entry) => entry.identity);

  return `-- Read-only provenance capture. SELECT only; safe in a read-only transaction.
WITH funcs AS (
  SELECT
    -- Build the identity from proargtypes, NOT pg_get_function_identity_arguments():
    -- that function includes parameter NAMES ("p_lead_id uuid, p_body text"), so the
    -- manifest's type-only identities would match zero-argument functions and nothing
    -- else. proargtypes holds exactly the IN/INOUT/VARIADIC types the identity needs.
    p.proname || '(' || coalesce((
      SELECT string_agg(format_type(a.t, NULL), ',' ORDER BY a.ord)
      FROM unnest(p.proargtypes) WITH ORDINALITY AS a(t, ord)
    ), '') || ')'
      AS "identity",
    md5(p.prosrc) AS "rawMd5",
    md5(btrim(regexp_replace(regexp_replace(p.prosrc, '--[^\\r\\n]*', '', 'g'), '\\s+', ' ', 'g')))
      AS "semanticMd5",
    l.lanname AS "language",
    p.prosecdef AS "securityDefiner",
    p.provolatile::text AS "volatility",
    p.proconfig AS "config",
    has_function_privilege('anon', p.oid, 'EXECUTE') AS "anonExecute",
    has_function_privilege('authenticated', p.oid, 'EXECUTE') AS "authenticatedExecute",
    has_function_privilege('service_role', p.oid, 'EXECUTE') AS "serviceRoleExecute",
    CASE
      WHEN p.proacl IS NULL THEN true
      ELSE EXISTS (
        SELECT 1 FROM aclexplode(p.proacl) a
        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
      )
    END AS "publicExecute"
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_language l ON l.oid = p.prolang
  WHERE n.nspname = 'public'
),
pols AS (
  SELECT
    schemaname || '.' || tablename || ':' || policyname AS "identity",
    cmd AS "command",
    roles::text[] AS "roles",
    md5(coalesce(qual, '')) AS "usingMd5",
    md5(coalesce(with_check, '')) AS "withCheckMd5"
  FROM pg_policies
)
SELECT jsonb_build_object(
  'ledgerTail', (
    SELECT coalesce(
             jsonb_agg(jsonb_build_object('version', version, 'name', name) ORDER BY version),
             '[]'::jsonb
           )
    FROM supabase_migrations.schema_migrations
    WHERE version >= ${sqlLiteral(manifest.ledgerFloorVersion)}
  ),
  'functions', (
    SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY f."identity"), '[]'::jsonb)
    FROM funcs f
    WHERE f."identity" IN (
      ${inList(functionIds)}
    )
  ),
  'policies', (
    SELECT coalesce(jsonb_agg(to_jsonb(pp) ORDER BY pp."identity"), '[]'::jsonb)
    FROM pols pp
    WHERE pp."identity" IN (
      ${inList(policyIds)}
    )
  )
) AS evidence;`;
}

/**
 * Accepts what a SQL tool actually hands back, which varies: the bare object, a
 * single-row array, or a row wrapping it under an `evidence` column.
 */
export function unwrapLive(raw) {
  let value = raw;
  if (Array.isArray(value)) {
    if (value.length !== 1) {
      throw new Error(`Expected exactly 1 result row, got ${value.length}`);
    }
    value = value[0];
  }
  if (value && typeof value === 'object' && value.evidence) value = value.evidence;
  if (typeof value === 'string') value = JSON.parse(value);

  for (const key of ['ledgerTail', 'functions', 'policies']) {
    if (!Array.isArray(value?.[key])) {
      throw new Error(`Live capture is missing the ${key} array`);
    }
  }
  return value;
}

function gitHead(ref) {
  const result = spawnSync('git', ['rev-parse', ref], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`Cannot resolve ${ref}`);
  return result.stdout.trim();
}

export function assemble({ live, manifest, captureBaseCommit, capturedAt }) {
  const unwrapped = unwrapLive(live);
  return {
    capturedAt,
    projectRef: manifest.projectRef,
    captureBaseCommit,
    method: METHOD,
    ledgerTail: unwrapped.ledgerTail,
    functions: unwrapped.functions,
    policies: unwrapped.policies,
  };
}

function parseArgs(argv) {
  const options = { mode: null, input: null, out: null, base: 'HEAD', manifest: DEFAULT_MANIFEST };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--print-sql') options.mode = 'print-sql';
    else if (value === '--assemble') {
      options.mode = 'assemble';
      options.input = argv[++index];
    } else if (value === '--out') options.out = argv[++index];
    else if (value === '--base') options.base = argv[++index];
    else if (value === '--manifest') options.manifest = argv[++index];
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!options.mode) throw new Error('Pass --print-sql or --assemble <file>');
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, options.manifest), 'utf8'));

  if (options.mode === 'print-sql') {
    process.stdout.write(`${buildSql(manifest)}\n`);
    return;
  }

  const live = JSON.parse(fs.readFileSync(path.resolve(options.input), 'utf8'));
  const evidence = assemble({
    live,
    manifest,
    captureBaseCommit: gitHead(options.base),
    capturedAt: `${new Date().toISOString().replace(/\.\d+Z$/, '')}Z`,
  });

  const target = options.out
    ? path.resolve(options.out)
    : path.join(ROOT, 'docs/audit/2026-07/evidence/migration-provenance-latest.json');
  fs.writeFileSync(target, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(
    `Wrote ${path.relative(ROOT, target)}; capturedAt=${evidence.capturedAt}; ` +
      `ledger=${evidence.ledgerTail.length}; functions=${evidence.functions.length}; ` +
      `policies=${evidence.policies.length}.\n`,
  );
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
