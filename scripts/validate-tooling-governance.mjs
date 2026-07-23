#!/usr/bin/env node
/**
 * FILE: validate-tooling-governance.mjs
 *
 * WHAT THIS DOES (plain language):
 *   Checks repository-local skills, agents, references, trigger ownership, and shared permissions
 *   for governance mistakes. It reports optional bundle debt without silently activating it.
 *
 * DEPENDS ON:
 *   Packages:  Node.js built-ins only
 *   Internal:  .claude/tooling-governance.json and tracked .claude entrypoints/settings
 *
 * NOTES / GOTCHAS:
 *   - This validates the tracked .claude authority only. It intentionally ignores candidate ports.
 *   - Known findings are temporary, dated waivers; their matched content is never printed.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const LOCAL_ROOT_PREFIXES = [
  '.claude/',
  '.github/',
  'docs/',
  'functions/',
  'src/',
  'supabase/',
];

const BROAD_TRIGGER_PATTERN = /\b(any task|any non-trivial|anything involving|use for any|any schema|any feature)\b/i;
const SECRET_PERMISSION_PATTERN =
  /authorization\s*:\s*bearer\s+(?!\$\{|<|\[|example|placeholder)[^\s"'\\]{12,}|(?:sk|rk)_live_[0-9a-z]{10,}|xox[baprs]-[0-9a-z-]{10,}/i;
const MUTATION_PERMISSION_PATTERN =
  /apply_migration|execute_sql|git (?:add|commit|push|checkout|switch|restore|rm)(?::|\s)|create_pull_request|update_pull_request|create_branch|merge_pull_request|qbo_(?:delete|create|update)|run_payroll/i;

function normalizeRepoPath(value) {
  return value.replaceAll('\\', '/').replace(/^\.\//, '');
}

export function parseFrontmatter(raw) {
  if (!raw.startsWith('---')) return {};
  const end = raw.indexOf('\n---', 3);
  if (end < 0) return {};
  const fields = {};
  const lines = raw.slice(3, end).split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trimEnd();
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (!value || value === '>' || value === '|') {
      const continuation = [];
      while (index + 1 < lines.length && /^\s+/.test(lines[index + 1])) {
        continuation.push(lines[index + 1].trim());
        index += 1;
      }
      value = continuation.join(' ').trim();
    }
    fields[match[1]] = value;
  }
  return fields;
}

function walkEntrypoints(root, extraPaths = []) {
  const tracked = spawnSync(
    'git',
    ['ls-files', '.claude/skills/*/SKILL.md', '.claude/agents/*.md'],
    { cwd: root, encoding: 'utf8', windowsHide: true },
  );
  if (tracked.status === 0 && tracked.stdout.trim()) {
    const paths = tracked.stdout
      .trim()
      .split(/\r?\n/);
    for (const extraPath of extraPaths) {
      if (!paths.includes(extraPath) && fs.existsSync(path.join(root, extraPath))) paths.push(extraPath);
    }
    return paths
      .map((repoPath) => ({
        type: repoPath.includes('/skills/') ? 'skill' : 'agent',
        absolute: path.join(root, repoPath),
      }));
  }

  // Fixture/fresh-source fallback. The real repository path above is Git-index scoped.
  const results = [];
  const skillRoot = path.join(root, '.claude', 'skills');
  const agentRoot = path.join(root, '.claude', 'agents');

  if (fs.existsSync(skillRoot)) {
    for (const entry of fs.readdirSync(skillRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(skillRoot, entry.name, 'SKILL.md');
      if (fs.existsSync(candidate)) results.push({ type: 'skill', absolute: candidate });
    }
  }

  if (fs.existsSync(agentRoot)) {
    for (const entry of fs.readdirSync(agentRoot, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push({ type: 'agent', absolute: path.join(agentRoot, entry.name) });
      }
    }
  }

  return results;
}

export function extractLocalReferences(raw) {
  const refs = new Set();
  const markdown = /\[[^\]]+\]\(([^)\s#]+)(?:#[^)]*)?\)/g;
  const code = /`([^`\r\n]+)`/g;
  let match;

  while ((match = markdown.exec(raw))) refs.add(match[1]);
  while ((match = code.exec(raw))) {
    const value = match[1].trim();
    if (
      LOCAL_ROOT_PREFIXES.some((prefix) => value.startsWith(prefix)) ||
      /^(?:references|scripts|assets|templates)\//.test(value) ||
      /^(?:AGENTS|CLAUDE)\.md(?:$|[:#])/.test(value)
    ) {
      refs.add(value);
    }
  }

  return [...refs];
}

function cleanReference(reference) {
  return reference
    .replace(/[),.;]+$/, '')
    .replace(/:\d+(?:-\d+)?$/, '')
    .replace(/#.*$/, '');
}

function resolveReference(root, entrypoint, reference) {
  const cleaned = cleanReference(reference);
  if (
    !cleaned ||
    /^[a-z]+:\/\//i.test(cleaned) ||
    (!cleaned.includes('/') && !/^(?:AGENTS|CLAUDE)\.md$/.test(cleaned)) ||
    /[<>{}*]/.test(cleaned) ||
    cleaned.includes('…')
  ) {
    return null;
  }

  const fromRoot =
    LOCAL_ROOT_PREFIXES.some((prefix) => cleaned.startsWith(prefix)) ||
    /^(?:AGENTS|CLAUDE)\.md$/.test(cleaned);
  return path.resolve(fromRoot ? root : path.dirname(entrypoint), cleaned);
}

function knownFinding(policy, rule, repoPath, now) {
  return (policy.knownFindings || []).find((finding) => {
    if (finding.rule !== rule || normalizeRepoPath(finding.path) !== repoPath) return false;
    const expiry = Date.parse(`${finding.expires}T23:59:59Z`);
    return Number.isFinite(expiry) && expiry >= now.getTime();
  });
}

function addIssue(collection, level, rule, repoPath, message, details = {}) {
  collection.push({ level, rule, path: repoPath, message, ...details });
}

export function validatePermissionObject(permissionObject, repoPath, policy, now = new Date()) {
  const issues = [];
  const emittedWaivers = new Set();
  const allowed = permissionObject?.permissions?.allow;
  if (!Array.isArray(allowed)) return issues;

  for (const permission of allowed) {
    if (typeof permission !== 'string') continue;
    for (const [rule, pattern] of [
      ['secret-bearing-permission', SECRET_PERMISSION_PATTERN],
      ['mutation-permission', MUTATION_PERMISSION_PATTERN],
    ]) {
      if (!pattern.test(permission)) continue;
      const waiver = knownFinding(policy, rule, repoPath, now);
      if (waiver && emittedWaivers.has(rule)) continue;
      if (waiver) emittedWaivers.add(rule);
      addIssue(
        issues,
        waiver ? 'warning' : 'error',
        rule,
        repoPath,
        waiver
          ? `${waiver.finding} is temporarily waived until ${waiver.expires}; owner action remains required.`
          : rule === 'secret-bearing-permission'
            ? 'A permission appears to contain secret-bearing authorization material.'
            : 'A shared permission pre-authorizes a mutation that requires task-specific approval.',
      );
    }
  }

  return issues;
}

export function validateTriggerRegistry(governedEntrypoints) {
  const issues = [];
  const dispatchers = new Map();

  for (const entry of governedEntrypoints) {
    if (entry.triggerRole !== 'dispatcher') continue;
    const existing = dispatchers.get(entry.triggerDomain);
    if (existing) {
      addIssue(
        issues,
        'error',
        'duplicate-broad-trigger',
        entry.path,
        `Trigger domain "${entry.triggerDomain}" has multiple dispatchers: ${existing} and ${entry.path}.`,
      );
    } else {
      dispatchers.set(entry.triggerDomain, entry.path);
    }
  }

  return issues;
}

export function validateInventoryCounts(actual, expected) {
  const issues = [];
  if (!expected) return issues;
  for (const key of ['skills', 'agents', 'rules', 'hooks']) {
    if (actual[key] !== expected[key]) {
      addIssue(
        issues,
        'error',
        'inventory-count-mismatch',
        '.claude/tooling-governance.json',
        `Tracked ${key} count is ${actual[key]}; governance metadata expects ${expected[key]}.`,
      );
    }
  }
  return issues;
}

function readTrackedInventory(root) {
  const patterns = {
    skills: '.claude/skills/*/SKILL.md',
    agents: '.claude/agents/*.md',
    rules: '.claude/rules/*.md',
    hooks: '.claude/hooks/*',
  };
  const counts = {};
  for (const [key, pattern] of Object.entries(patterns)) {
    const tracked = spawnSync('git', ['ls-files', pattern], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    });
    counts[key] =
      tracked.status === 0 && tracked.stdout.trim()
        ? tracked.stdout.trim().split(/\r?\n/).length
        : 0;
  }
  return counts;
}

export function validateRepository(root, policy, now = new Date()) {
  const issues = [];
  const seenNames = new Map();
  const governed = new Map(
    (policy.governedEntrypoints || []).map((entry) => [normalizeRepoPath(entry.path), entry]),
  );

  for (const entry of policy.governedEntrypoints || []) {
    for (const field of [
      'path',
      'owner',
      'provenance',
      'status',
      'riskTier',
      'reviewPolicy',
      'triggerDomain',
      'triggerRole',
    ]) {
      if (!entry[field]) {
        addIssue(issues, 'error', 'missing-governance-metadata', entry.path || '(unknown)', `Missing ${field}.`);
      }
    }
  }

  issues.push(...validateTriggerRegistry(policy.governedEntrypoints || []));
  issues.push(...validateInventoryCounts(readTrackedInventory(root), policy.trackedInventory));

  for (const entrypoint of walkEntrypoints(root, [...governed.keys()])) {
    const repoPath = normalizeRepoPath(path.relative(root, entrypoint.absolute));
    const raw = fs.readFileSync(entrypoint.absolute, 'utf8');
    const metadata = parseFrontmatter(raw);
    const required = policy.requiredFrontmatter?.[entrypoint.type] || [];

    for (const field of required) {
      if (!metadata[field]) {
        addIssue(issues, 'error', 'missing-entrypoint-metadata', repoPath, `Missing frontmatter field "${field}".`);
      }
    }

    if (metadata.name) {
      const expectedName =
        entrypoint.type === 'skill'
          ? path.basename(path.dirname(entrypoint.absolute))
          : path.basename(entrypoint.absolute, '.md');
      if (metadata.name !== expectedName) {
        addIssue(
          issues,
          'error',
          'entrypoint-name-mismatch',
          repoPath,
          `Frontmatter name "${metadata.name}" does not match "${expectedName}".`,
        );
      }
      const key = `${entrypoint.type}:${metadata.name}`;
      if (seenNames.has(key)) {
        addIssue(
          issues,
          'error',
          'duplicate-entrypoint-name',
          repoPath,
          `Duplicate ${entrypoint.type} name also used by ${seenNames.get(key)}.`,
        );
      } else {
        seenNames.set(key, repoPath);
      }
    }

    const governance = governed.get(repoPath);
    if (governance && governance.triggerRole !== 'dispatcher' && BROAD_TRIGGER_PATTERN.test(metadata.description || '')) {
      addIssue(
        issues,
        'error',
        'duplicate-broad-trigger',
        repoPath,
        `A ${governance.triggerRole} entrypoint uses dispatcher-like broad trigger language.`,
      );
    }

    const strict = governed.has(repoPath);
    for (const reference of extractLocalReferences(raw)) {
      const resolved = resolveReference(root, entrypoint.absolute, reference);
      const optional = (policy.declaredOptionalReferences || []).some(
        (item) => normalizeRepoPath(item.path) === repoPath && item.reference === cleanReference(reference),
      );
      if (resolved && !fs.existsSync(resolved) && !optional) {
        addIssue(
          issues,
          strict ? 'error' : 'warning',
          'missing-local-reference',
          repoPath,
          `Missing local reference: ${cleanReference(reference)}`,
        );
      }
    }
  }

  for (const entry of policy.governedEntrypoints || []) {
    const repoPath = normalizeRepoPath(entry.path);
    if (!fs.existsSync(path.join(root, repoPath))) {
      addIssue(issues, 'error', 'missing-governed-entrypoint', repoPath, 'Governed entrypoint does not exist.');
    }
  }

  for (const settingsName of ['settings.json', 'settings.local.json']) {
    const absolute = path.join(root, '.claude', settingsName);
    if (!fs.existsSync(absolute)) continue;
    const repoPath = `.claude/${settingsName}`;
    try {
      const settings = JSON.parse(fs.readFileSync(absolute, 'utf8'));
      issues.push(...validatePermissionObject(settings, repoPath, policy, now));
    } catch {
      addIssue(issues, 'error', 'invalid-settings-json', repoPath, 'Settings file is not valid JSON.');
    }
  }

  return issues;
}

function printIssues(issues) {
  const errors = issues.filter((issue) => issue.level === 'error');
  const warnings = issues.filter((issue) => issue.level === 'warning');
  for (const issue of errors) {
    process.stderr.write(`ERROR [${issue.rule}] ${issue.path}: ${issue.message}\n`);
  }
  for (const issue of warnings.slice(0, 50)) {
    process.stdout.write(`WARN  [${issue.rule}] ${issue.path}: ${issue.message}\n`);
  }
  if (warnings.length > 50) {
    process.stdout.write(`WARN  ${warnings.length - 50} additional optional findings omitted from console output.\n`);
  }
  process.stdout.write(`Tooling governance: ${errors.length} error(s), ${warnings.length} warning(s).\n`);
  return errors.length;
}

function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(scriptDir, '..');
  const policyPath = path.join(root, '.claude', 'tooling-governance.json');
  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  process.exitCode = printIssues(validateRepository(root, policy)) > 0 ? 1 : 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
