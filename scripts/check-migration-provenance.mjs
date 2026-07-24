#!/usr/bin/env node
/**
 * FILE: check-migration-provenance.mjs
 *
 * WHAT THIS DOES (plain language):
 *   Proves that recent live migration-ledger rows map to reviewed SQL reachable from a release ref,
 *   then compares selected live function and policy fingerprints with that source.
 *
 * DEPENDS ON:
 *   Packages:  Node.js built-ins only
 *   Internal:  scripts/migration-provenance-manifest.json and a fresh read-only evidence JSON file
 *
 * NOTES / GOTCHAS:
 *   - This never connects to Supabase and never executes SQL. Refresh evidence separately with
 *     read-only catalog queries, then pass the JSON with --evidence.
 *   - Raw function drift is a failure unless the manifest explicitly permits comment-only drift
 *     and the comment/whitespace-insensitive fingerprint still matches.
 *   - A reviewed migration that constructs a function body dynamically may pin explicit live raw
 *     and semantic fingerprints. Its migration file still has to equal the reviewed Git blob.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEFAULT_EVIDENCE = 'docs/audit/2026-07/evidence/migration-provenance-2026-07-23.json';
const DEFAULT_MANIFEST = 'scripts/migration-provenance-manifest.json';

function md5(value) {
  return crypto.createHash('md5').update(value).digest('hex');
}

export function normalizeFunctionBody(body) {
  return body.replace(/--[^\r\n]*/g, '').replace(/\s+/g, ' ').trim();
}

export function extractFunctionBodies(sql) {
  const normalized = sql.replace(/\r\n/g, '\n');
  const functions = new Map();
  const pattern =
    /CREATE OR REPLACE FUNCTION\s+public\.([a-z0-9_]+)\s*\(([\s\S]*?)\)\s*\n\s*RETURNS[\s\S]*?\nAS \$function\$\n([\s\S]*?)\n\$function\$;/gi;
  let match;
  while ((match = pattern.exec(normalized))) {
    const body = `\n${match[3]}\n`;
    functions.set(match[1], {
      rawMd5: md5(body),
      semanticMd5: md5(normalizeFunctionBody(body)),
    });
  }
  return functions;
}

function parseArgs(argv) {
  const options = {
    ref: 'HEAD',
    manifest: DEFAULT_MANIFEST,
    evidence: DEFAULT_EVIDENCE,
    worktree: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--worktree') options.worktree = true;
    else if (value === '--ref') options.ref = argv[++index];
    else if (value === '--manifest') options.manifest = argv[++index];
    else if (value === '--evidence') options.evidence = argv[++index];
    else throw new Error(`Unknown argument: ${value}`);
  }
  return options;
}

function readAtRef(root, ref, repoPath, worktree) {
  if (worktree) {
    return fs.readFileSync(path.join(root, repoPath), 'utf8').replace(/\r\n/g, '\n');
  }
  const result = spawnSync('git', ['show', `${ref}:${repoPath}`], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`${repoPath} is not reachable from ${ref}`);
  }
  return result.stdout;
}

function releaseCommit(root, ref, worktree) {
  if (worktree) return 'WORKTREE';
  const result = spawnSync('git', ['rev-parse', ref], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`Cannot resolve release ref ${ref}`);
  return result.stdout.trim();
}

function isAncestor(root, ancestor, ref) {
  const result = spawnSync('git', ['merge-base', '--is-ancestor', ancestor, ref], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  return result.status === 0;
}

function compareFunction(source, live, selected, issues, warnings) {
  if (!live) {
    issues.push(`Live evidence is missing ${selected.identity}`);
    return;
  }

  if (selected.expectedFingerprints) {
    for (const field of ['rawMd5', 'semanticMd5']) {
      if (
        typeof selected.expectedFingerprints[field] !== 'string' ||
        live[field] !== selected.expectedFingerprints[field]
      ) {
        issues.push(`${selected.identity}: unexpected live ${field} fingerprint`);
      }
    }
  } else {
    const name = selected.identity.slice(0, selected.identity.indexOf('('));
    const local = source.get(name);
    if (!local) {
      issues.push(`${selected.path} does not define ${selected.identity}`);
      return;
    }
    if (local.rawMd5 !== live.rawMd5) {
      if (
        selected.allowedRawDrift === 'comments_only' &&
        local.semanticMd5 === live.semanticMd5
      ) {
        warnings.push(`${selected.identity}: raw body differs, comment-only semantic hash matches`);
      } else {
        issues.push(`${selected.identity}: live/source body fingerprint drift`);
      }
    }
    if (local.semanticMd5 !== live.semanticMd5) {
      issues.push(`${selected.identity}: live/source semantic fingerprint drift`);
    }
  }

  const expected = selected.expected || {
    securityDefiner: true,
    config: ['search_path=public'],
    anonExecute: false,
    authenticatedExecute: true,
    serviceRoleExecute: true,
    publicExecute: false,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (JSON.stringify(live[field]) !== JSON.stringify(value)) {
      issues.push(`${selected.identity}: unexpected live ${field}`);
    }
  }
}

function comparePolicy(live, selected, issues) {
  if (!live) {
    issues.push(`Live evidence is missing policy ${selected.identity}`);
    return;
  }
  for (const field of ['command', 'roles', 'usingMd5', 'withCheckMd5']) {
    if (JSON.stringify(live[field]) !== JSON.stringify(selected[field])) {
      issues.push(`${selected.identity}: unexpected live policy ${field}`);
    }
  }
}

export function validateProvenance({
  root,
  ref,
  worktree,
  manifest,
  evidence,
  now = new Date(),
}) {
  const issues = [];
  const warnings = [];
  if (manifest.projectRef !== evidence.projectRef) {
    issues.push('Evidence projectRef does not match the manifest');
  }
  const capturedAt = Date.parse(evidence.capturedAt);
  const maximumAgeMs = manifest.evidenceMaxAgeHours * 60 * 60 * 1000;
  if (
    !Number.isFinite(capturedAt) ||
    capturedAt > now.getTime() + 5 * 60 * 1000 ||
    now.getTime() - capturedAt > maximumAgeMs
  ) {
    issues.push(
      `Live evidence is not within the ${manifest.evidenceMaxAgeHours}-hour release window`,
    );
  }
  if (!worktree && !isAncestor(root, evidence.captureBaseCommit, ref)) {
    issues.push(`Evidence capture base ${evidence.captureBaseCommit} is not an ancestor of ${ref}`);
  }

  const evidenceLedger = new Map(
    evidence.ledgerTail.map((entry) => [`${entry.version}:${entry.name}`, entry]),
  );
  const mappedLedger = new Set();
  const sourceByPath = new Map();

  for (const mapping of manifest.ledgerMappings) {
    const key = `${mapping.version}:${mapping.name}`;
    mappedLedger.add(key);
    if (!evidenceLedger.has(key)) issues.push(`Live evidence is missing ledger row ${key}`);
    try {
      const releaseSource = readAtRef(root, ref, mapping.path, worktree);
      const reviewedSource = readAtRef(
        root,
        mapping.reviewedOriginCommit,
        mapping.path,
        false,
      );
      sourceByPath.set(mapping.path, releaseSource);
      if (releaseSource !== reviewedSource) {
        issues.push(
          `${mapping.path} differs from reviewed origin ${mapping.reviewedOriginCommit}`,
        );
      }
    } catch (error) {
      issues.push(error.message);
    }
  }

  for (const entry of evidence.ledgerTail) {
    if (entry.version >= manifest.ledgerFloorVersion) {
      const key = `${entry.version}:${entry.name}`;
      if (!mappedLedger.has(key)) issues.push(`Unmapped live ledger row ${key}`);
    }
  }

  const liveFunctions = new Map(evidence.functions.map((entry) => [entry.identity, entry]));
  const parsedByPath = new Map();
  for (const selected of manifest.selectedFunctions) {
    if (!parsedByPath.has(selected.path)) {
      const sql = sourceByPath.get(selected.path);
      if (!sql) continue;
      parsedByPath.set(selected.path, extractFunctionBodies(sql));
    }
    compareFunction(
      parsedByPath.get(selected.path),
      liveFunctions.get(selected.identity),
      selected,
      issues,
      warnings,
    );
  }

  const livePolicies = new Map((evidence.policies || []).map((entry) => [entry.identity, entry]));
  const selectedPolicyIds = new Set();
  for (const selected of manifest.selectedPolicies || []) {
    selectedPolicyIds.add(selected.identity);
    comparePolicy(livePolicies.get(selected.identity), selected, issues);
  }
  for (const identity of livePolicies.keys()) {
    if (!selectedPolicyIds.has(identity)) {
      issues.push(`Unmapped selected live policy fingerprint ${identity}`);
    }
  }

  return {
    ok: issues.length === 0,
    releaseCommit: releaseCommit(root, ref, worktree),
    ledgerMappings: manifest.ledgerMappings.length,
    selectedFunctions: manifest.selectedFunctions.length,
    selectedPolicies: manifest.selectedPolicies.length,
    issues,
    warnings,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, options.manifest), 'utf8'));
  const evidence = JSON.parse(fs.readFileSync(path.join(root, options.evidence), 'utf8'));
  const result = validateProvenance({ root, ...options, manifest, evidence });
  for (const warning of result.warnings) process.stdout.write(`WARN ${warning}\n`);
  for (const issue of result.issues) process.stderr.write(`ERROR ${issue}\n`);
  process.stdout.write(
    `Migration provenance: ${result.ok ? 'PASS' : 'FAIL'}; ref=${result.releaseCommit}; ` +
      `ledger=${result.ledgerMappings}; functions=${result.selectedFunctions}; ` +
      `policies=${result.selectedPolicies}.\n`,
  );
  process.exitCode = result.ok ? 0 : 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
