#!/usr/bin/env node
// ════════════════════════════════════════════════
// FILE: scripts/check-l0-bridge.mjs
// ════════════════════════════════════════════════
//
// WHAT THIS DOES (plain language):
//   Checks that the shared rules layer is still wired up correctly. AGENTS.md
//   holds the rules both Claude Code and Codex work from, and CLAUDE.md pulls it
//   in with an import on its first line. Several ways that wiring can break are
//   completely silent -- the rules just stop applying and nothing complains.
//   This script makes those failures loud.
//
//   Run it before and after any edit to AGENTS.md, CLAUDE.md, .gitattributes or
//   .codex/config.toml, and especially around L0/L1 phase P3, which deletes the
//   duplicated rules out of CLAUDE.md.
//
// USAGE:
//   node scripts/check-l0-bridge.mjs          # exits 1 on any failure
//   node scripts/check-l0-bridge.mjs --quiet  # only print failures
//
// DEPENDS ON:
//   Internal: AGENTS.md, CLAUDE.md, .gitattributes, .codex/config.toml
//   Data:     reads → repository files and `git` metadata. Writes nothing.
//
// NOTES / GOTCHAS:
//   - This is a CLI check, not a hook, so exit 1 is the right failure signal.
//     (In a Claude Code or Codex HOOK, exit 1 is NON-blocking -- only exit 2
//     blocks. Do not copy this exit code into a hook.)
//   - It deliberately never contains the canary token literal. It extracts the
//     token from AGENTS.md by pattern, because a session reading this file must
//     not learn the value -- that would invalidate the post-compact load test.
//   - It passes both BEFORE P3 (rules duplicated in CLAUDE.md) and AFTER P3
//     (rules only in AGENTS.md). It checks consistency, not a fixed shape.
// ════════════════════════════════════════════════

import { readFileSync, lstatSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const QUIET = process.argv.includes('--quiet');
const results = [];

function check(name, fn) {
  try {
    const detail = fn();
    results.push({ name, ok: true, detail: detail ?? '' });
  } catch (e) {
    results.push({ name, ok: false, detail: e.message });
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

const agents = readFileSync('AGENTS.md', 'utf8');
const claude = readFileSync('CLAUDE.md', 'utf8');

// ─── SECTION: the bridge itself ──────────────

check('CLAUDE.md line 1 is exactly the @AGENTS.md import, with no CR and no BOM', () => {
  const first = claude.split('\n')[0];
  assert(!first.startsWith('﻿'), 'line 1 begins with a UTF-8 BOM, which breaks the import path');
  assert(!first.endsWith('\r'), 'line 1 ends with CR. core.autocrlf wrote CRLF into the working copy, '
    + 'and the working copy is what Claude Code parses -- "@AGENTS.md\\r" resolves to nothing. '
    + 'Fix: confirm .gitattributes pins CLAUDE.md to eol=lf, then re-checkout.');
  assert(first === '@AGENTS.md', `line 1 is ${JSON.stringify(first)}, expected "@AGENTS.md"`);
  return 'clean LF';
});

check('neither instruction file is a symlink', () => {
  for (const f of ['CLAUDE.md', 'AGENTS.md']) {
    assert(!lstatSync(f).isSymbolicLink(), `${f} is a symlink. Git for Windows sets core.symlinks=false, `
      + 'so it checks out as a text file whose entire content is the literal string "AGENTS.md".');
  }
  return 'both regular files';
});

check('git index records regular files (100644), not symlinks (120000)', () => {
  const out = git(['ls-files', '-s', 'CLAUDE.md', 'AGENTS.md']);
  for (const line of out.trim().split('\n')) {
    const mode = line.split(/\s+/)[0];
    assert(mode === '100644', `wrong index mode ${mode} on: ${line.trim()}`);
  }
  return '100644 both';
});

check('.gitattributes pins both instruction files to LF', () => {
  assert(existsSync('.gitattributes'), '.gitattributes is missing');
  const out = git(['ls-files', '--eol', 'CLAUDE.md', 'AGENTS.md']);
  for (const line of out.trim().split('\n')) {
    assert(/attr\/text eol=lf/.test(line), `not pinned to eol=lf: ${line.trim()}`);
    assert(/w\/lf/.test(line), `working copy is not LF: ${line.trim()}`);
  }
  return 'index and working copy both LF';
});

// ─── SECTION: the non-negotiable rules ──────────────

function extractRules(text) {
  const start = text.search(/^1\. \*\*Read files from disk before editing\.\*\*/m);
  if (start === -1) return null;
  const lines = text.slice(start).split('\n');
  const out = [];
  for (const line of lines) {
    if (/^\d+\. /.test(line)) out.push(line);
    else break;
  }
  return out;
}

const agentsRules = extractRules(agents);

check('AGENTS.md carries rules 1-12, numbered with no gaps', () => {
  assert(agentsRules, 'the rules block was not found in AGENTS.md at all');
  const nums = agentsRules.map((l) => Number(l.match(/^(\d+)\./)[1]));
  assert(nums.length === 12, `found ${nums.length} rules, expected 12`);
  nums.forEach((n, i) => assert(n === i + 1, `numbering breaks at position ${i + 1}: saw ${n}`));
  return '12 rules, 1..12';
});

check('CLAUDE.md rules, if still present, are byte-identical to the AGENTS.md copy', () => {
  const claudeRules = extractRules(claude);
  if (!claudeRules) return 'absent -- P3 has run, AGENTS.md is now sole carrier';
  assert(agentsRules, 'cannot compare: AGENTS.md has no rules block');
  assert(claudeRules.length === agentsRules.length,
    `CLAUDE.md has ${claudeRules.length} rules, AGENTS.md has ${agentsRules.length}`);
  claudeRules.forEach((line, i) => assert(line === agentsRules[i],
    `rule ${i + 1} has DRIFTED between the two files. They must stay identical while both exist.\n`
    + `  CLAUDE.md: ${line.slice(0, 90)}...\n  AGENTS.md: ${agentsRules[i].slice(0, 90)}...`));
  return 'present and identical (pre-P3 duplicate state)';
});

// ─── SECTION: the canary ──────────────

check('canary token appears in exactly one tracked file (AGENTS.md)', () => {
  // Extracted by pattern on purpose: this script must never contain the literal
  // value, or a session reading it could quote the token without the import
  // loading -- which silently turns a failing load test into a passing one.
  const m = agents.match(/UPR-L0-CANARY-[A-Z0-9]{4,}/);
  assert(m, 'no canary token found in AGENTS.md -- the post-compact load test has nothing to check');
  const token = m[0];
  let hits;
  try {
    hits = git(['grep', '-l', '--fixed-strings', token, '--', '*.md']).trim().split('\n');
  } catch {
    hits = [];
  }
  assert(hits.length === 1 && hits[0] === 'AGENTS.md',
    `token leaked into ${hits.length} files: ${hits.join(', ')}. `
    + 'Only AGENTS.md may contain it -- a session told to read a handoff would otherwise be able to '
    + 'quote it with the import broken. Refer to it indirectly everywhere else.');
  return 'unique to AGENTS.md';
});

// ─── SECTION: Code Review Rules ──────────────

check('Code Review Rules section exists with the exact heading Codex keys on', () => {
  assert(/^## Code Review Rules$/m.test(agents),
    'heading missing or altered. Codex\'s PR reviewer matches "## Code Review Rules" literally.');
  return 'exact heading present';
});

check('Code Review Rules stays free of style-lint rules', () => {
  const start = agents.indexOf('## Code Review Rules');
  const rest = agents.slice(start + 1);
  const end = rest.indexOf('\n## ');
  const section = end === -1 ? rest : rest.slice(0, end);
  // Codex surfaces P0/P1 only from this section, so a lint-shaped rule placed
  // here silently never fires. eslint already covers these at true parity.
  const banned = ['alert(', 'confirm(', 'toast.js', '390px', 'motion-', 'max-width: 768px'];
  const found = banned.filter((p) => section.toLowerCase().includes(p.toLowerCase()));
  assert(found.length === 0, `style-lint rules found in the P0/P1 section: ${found.join(', ')}. `
    + 'They would never surface there. Move them to eslint.');
  return `clean (${banned.length} patterns checked)`;
});

check('heading order: Code Review Rules precedes Depth map and Repository model', () => {
  const idx = (h) => agents.indexOf(`\n## ${h}`);
  const crr = idx('Code Review Rules');
  const depth = agents.search(/\n## Depth map/);
  const repo = agents.search(/\n## Repository model/);
  assert(crr !== -1 && depth !== -1 && repo !== -1, 'one of the three headings is missing');
  assert(crr < depth, 'Code Review Rules must come before Depth map');
  assert(crr < repo, 'Code Review Rules must come before Repository model');
  return 'ordered correctly';
});

// ─── SECTION: what P3 must NOT delete ──────────────

check('CLAUDE.md still carries its Claude-only routing (P3 over-deletion guard)', () => {
  // These are Claude-only mechanisms or reference material that AGENTS.md
  // deliberately does not carry. See docs/agent-alignment-l0-coverage.md section 5.
  const mustKeep = {
    'the @AGENTS.md redirect note': /Rule numbering is frozen/,
    'Claude-only mechanisms block': /### Claude-only mechanisms/,
    'DB Client API': /## DB Client API/,
    'AuthContext reference': /## AuthContext/,
    'Local Dev & UI Verification': /## Local Dev & UI Verification/,
    'File Structure': /## File Structure/,
    'Workers inventory': /## Workers/,
    'Patterns to Follow': /## Patterns to Follow/,
    'Specialist skills & precedence': /## Specialist skills/,
    'Task File Protocol': /## Task File Protocol/,
    'CRM Phase Workflow': /## CRM Phase Workflow/,
  };
  const missing = Object.entries(mustKeep)
    .filter(([, re]) => !re.test(claude))
    .map(([name]) => name);
  assert(missing.length === 0,
    `P3 deleted too much. These are Claude-only and must stay in CLAUDE.md: ${missing.join('; ')}. `
    + 'See docs/agent-alignment-l0-coverage.md section 5.');
  return `all ${Object.keys(mustKeep).length} present`;
});

check("Rule 4's in-page anchors still resolve inside CLAUDE.md", () => {
  // Rule 4 is verbatim and links to #crm-phase-workflow and
  // #deployment--release-workflow. Those anchors only resolve in CLAUDE.md.
  const anchors = { '#crm-phase-workflow': /## CRM Phase Workflow/, '#deployment--release-workflow': /## Deployment & Release Workflow/ };
  const broken = Object.entries(anchors).filter(([, re]) => !re.test(claude)).map(([a]) => a);
  assert(broken.length === 0, `Rule 4 links to ${broken.join(', ')} but the target section is gone from CLAUDE.md`);
  return 'both targets present';
});

// ─── SECTION: the Codex byte cap ──────────────

check('.codex/config.toml raises project_doc_max_bytes above the real AGENTS.md size', () => {
  const p = '.codex/config.toml';
  assert(existsSync(p), `${p} is missing. Codex would fall back to a 32768-byte cap and drop the `
    + 'TAIL of AGENTS.md silently.');
  const toml = readFileSync(p, 'utf8');
  const m = toml.match(/^project_doc_max_bytes\s*=\s*(\d+)/m);
  assert(m, 'project_doc_max_bytes is not set');
  const cap = Number(m[1]);
  // Top-level keys must precede the first [table] or TOML fails to parse.
  const keyAt = toml.indexOf('project_doc_max_bytes');
  const tableAt = toml.search(/^\s*\[/m);
  assert(tableAt === -1 || keyAt < tableAt,
    'project_doc_max_bytes appears AFTER a [table] header, so TOML parses it into that table, not the root');
  const size = Buffer.byteLength(agents, 'utf8');
  assert(cap > size, `cap ${cap} is not above AGENTS.md's ${size} bytes -- the tail would be dropped silently`);
  const headroomPct = Math.round(((cap - size) / cap) * 100);
  assert(cap >= size * 1.25, `only ${headroomPct}% headroom; raise the cap before AGENTS.md grows into it`);
  return `cap ${cap}, file ${size}, ${headroomPct}% headroom`;
});

check('no Codex layer overrides the instructions path', () => {
  const p = '.codex/config.toml';
  if (!existsSync(p)) return 'n/a';
  assert(!/^\s*model_instructions_file/m.test(readFileSync(p, 'utf8')),
    'model_instructions_file REPLACES the AGENTS.md path rather than layering, silently bypassing all '
    + 'shared law. AGENTS.md forbids it.');
  return 'absent, as required';
});

// ─── SECTION: report ──────────────

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  if (r.ok && QUIET) continue;
  const mark = r.ok ? 'PASS' : 'FAIL';
  console.log(`${mark}  ${r.name}${r.detail ? `\n        ${r.detail.replace(/\n/g, '\n        ')}` : ''}`);
}
console.log(`\nL0 bridge: ${results.length - failed.length}/${results.length} passed.`);
if (failed.length) {
  console.log('\nThe shared law layer is not wired correctly. Every failure above is a mode where the '
    + 'rules stop applying WITHOUT any error being raised.');
  process.exit(1);
}
