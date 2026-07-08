#!/usr/bin/env node
/**
 * ════════════════════════════════════════════════
 * FILE: scripts/db-docs-gen.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Turns a live-schema snapshot (produced by scripts/db-docs-gen.sql, run
 *   read-only against the database) into two human-friendly markdown files
 *   under docs/generated/ — a table overview and an RPC inventory. This is a
 *   drift-verification aid ("does live match what we think we have"), never a
 *   second source of truth: UPR-Web-Context.md stays the real schema
 *   reference. Every generated file carries a "regenerate, don't edit" banner.
 *
 * DEPENDS ON:
 *   Packages: node stdlib only (fs, path, url) — no DB driver, no credentials
 *             of any kind. This script never connects to the database itself;
 *             it only transforms a JSON file someone else produced read-only.
 *   Internal: reads the --current snapshot file the caller supplies.
 *
 * NOTES / GOTCHAS:
 *   - Never writes db/baseline/ (that's DB-Foundation Phase F's drift-check
 *     baseline — a fixed comparison target, a different tool for a different
 *     job). This script's output always reflects "right now," not a frozen
 *     comparison point.
 *   - The snapshot file itself must come from a READ-ONLY path (Supabase MCP
 *     execute_sql with a SELECT-only query, or psql with a read-only role) —
 *     never generate it with service-role DDL credentials.
 *
 * USAGE:
 *   1. Run scripts/db-docs-gen.sql against the live DB (Supabase MCP
 *      `execute_sql`, or psql). It returns one JSON value.
 *   2. Save that value to a file, e.g. /tmp/schema-snapshot.json
 *   3. node scripts/db-docs-gen.mjs --current /tmp/schema-snapshot.json
 *   4. Commit the resulting docs/generated/*.md if the diff is meaningful.
 * ════════════════════════════════════════════════
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'docs/generated');

function parseArgs(argv) {
  const idx = argv.indexOf('--current');
  if (idx === -1 || !argv[idx + 1]) {
    console.error('Usage: node scripts/db-docs-gen.mjs --current <snapshot.json>');
    console.error('(produce the snapshot by running scripts/db-docs-gen.sql read-only first)');
    process.exit(1);
  }
  return { currentFile: argv[idx + 1] };
}

function banner(title) {
  return [
    `# ${title}`,
    '',
    '> **Generated file — regenerate, don\'t edit.** Produced by `scripts/db-docs-gen.mjs` from a',
    '> read-only live-schema snapshot (`scripts/db-docs-gen.sql`). This is a drift-verification aid,',
    '> never a second source of truth — the real schema reference is `UPR-Web-Context.md`. If this',
    '> file and `UPR-Web-Context.md` disagree, that disagreement is exactly what this file exists to',
    '> surface; fix the doc, then regenerate. Never hand-edit this file — your edits will be silently',
    '> overwritten the next time someone regenerates it.',
    '',
  ].join('\n');
}

function buildSchemaOverview(snapshot) {
  const tables = snapshot.tables || [];
  const anonPolicyTables = tables.filter((t) => t.has_anon_policy);
  const lines = [
    banner('Database Schema Overview (generated)'),
    `Snapshot: ${tables.length} public tables. Source: ${snapshot.generated_from}.`,
    '',
    '## Tables',
    '',
    '| Table | Columns | RLS enabled | Policies | Has `anon` policy |',
    '|---|---|---|---|---|',
    ...tables.map(
      (t) =>
        `| ${t.name} | ${t.column_count} | ${t.rls_enabled ? 'yes' : '**NO**'} | ${t.policy_count} | ${t.has_anon_policy ? '⚠️ yes' : 'no'} |`
    ),
    '',
    '## Tables granting `anon` a policy (review against `database-standard.md` §2 allowlist)',
    '',
    anonPolicyTables.length
      ? anonPolicyTables.map((t) => `- ${t.name}`).join('\n')
      : '_None — clean._',
    '',
  ];
  return lines.join('\n');
}

function buildRpcInventory(snapshot) {
  const fns = snapshot.functions || [];
  const anonFns = fns.filter((f) => f.anon_can_execute);
  const lines = [
    banner('RPC Inventory (generated)'),
    `Snapshot: ${fns.length} public functions. Source: ${snapshot.generated_from}.`,
    '',
    '## Functions',
    '',
    '| Function | `SECURITY DEFINER` | `anon` EXECUTE | `authenticated` EXECUTE |',
    '|---|---|---|---|',
    ...fns.map(
      (f) =>
        `| ${f.name} | ${f.security_definer ? 'yes' : 'no'} | ${f.anon_can_execute ? '⚠️ yes' : 'no'} | ${f.authenticated_can_execute ? 'yes' : 'no'} |`
    ),
    '',
    '## Functions granting `anon` EXECUTE (review against `database-standard.md` §2 allowlist)',
    '',
    anonFns.length ? anonFns.map((f) => `- ${f.name}`).join('\n') : '_None — clean._',
    '',
  ];
  return lines.join('\n');
}

const { currentFile } = parseArgs(process.argv.slice(2));
const snapshot = JSON.parse(readFileSync(currentFile, 'utf8'));

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'schema-overview.md'), buildSchemaOverview(snapshot));
writeFileSync(join(OUT_DIR, 'rpc-inventory.md'), buildRpcInventory(snapshot));

console.log(`Wrote docs/generated/schema-overview.md (${(snapshot.tables || []).length} tables)`);
console.log(`Wrote docs/generated/rpc-inventory.md (${(snapshot.functions || []).length} functions)`);
