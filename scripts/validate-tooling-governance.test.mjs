/**
 * FILE: validate-tooling-governance.test.mjs
 *
 * WHAT THIS DOES (plain language):
 *   Proves the tooling validator catches missing metadata, broken paths, trigger collisions, and
 *   unsafe permissions. The fixtures are created in a temporary folder and contain no real secrets.
 *
 * DEPENDS ON:
 *   Packages:  Node.js built-ins only
 *   Internal:  scripts/validate-tooling-governance.mjs
 *
 * NOTES / GOTCHAS:
 *   - Tests use an expired date for waiver checks so results never depend on today's date.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  extractLocalReferences,
  parseFrontmatter,
  validateInventoryCounts,
  validatePermissionObject,
  validateRepository,
  validateTriggerRegistry,
} from './validate-tooling-governance.mjs';

function makeRepository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upr-tooling-governance-'));
  fs.mkdirSync(path.join(root, '.claude', 'skills', 'safe-skill'), { recursive: true });
  fs.mkdirSync(path.join(root, '.claude', 'agents'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.claude', 'skills', 'safe-skill', 'SKILL.md'),
    '---\nname: safe-skill\ndescription: Handles one bounded task.\n---\n\nRead `references/missing.md`.\n',
  );
  fs.writeFileSync(
    path.join(root, '.claude', 'agents', 'safe-agent.md'),
    '---\nname: safe-agent\ndescription: Read-only review.\ntools: Read\nmodel: inherit\n---\n',
  );
  fs.writeFileSync(path.join(root, '.claude', 'settings.json'), '{"permissions":{"allow":[]}}');
  return root;
}

const basePolicy = {
  requiredFrontmatter: {
    skill: ['name', 'description'],
    agent: ['name', 'description'],
  },
  governedEntrypoints: [
    {
      path: '.claude/skills/safe-skill/SKILL.md',
      owner: 'test',
      provenance: 'test',
      status: 'active',
      riskTier: 'green',
      reviewPolicy: 'advisory',
      triggerDomain: 'test',
      triggerRole: 'dispatcher',
    },
  ],
  knownFindings: [],
};

test('parses frontmatter and finds local references', () => {
  const raw = '---\nname: sample\ndescription: bounded\n---\n[Guide](references/guide.md) and `docs/law.md`.';
  assert.equal(parseFrontmatter(raw).name, 'sample');
  assert.deepEqual(extractLocalReferences(raw).sort(), ['docs/law.md', 'references/guide.md']);
});

test('blocks missing references in governed entrypoints', () => {
  const root = makeRepository();
  const issues = validateRepository(root, basePolicy, new Date('2026-07-23T00:00:00Z'));
  assert.ok(issues.some((issue) => issue.rule === 'missing-local-reference' && issue.level === 'error'));
});

test('detects duplicate dispatchers for one trigger domain', () => {
  const issues = validateTriggerRegistry([
    { path: 'one', triggerDomain: 'database', triggerRole: 'dispatcher' },
    { path: 'two', triggerDomain: 'database', triggerRole: 'dispatcher' },
  ]);
  assert.equal(issues[0].rule, 'duplicate-broad-trigger');
});

test('detects stale tracked inventory counts', () => {
  const issues = validateInventoryCounts(
    { skills: 55, agents: 34, rules: 23, hooks: 2 },
    { skills: 55, agents: 33, rules: 23, hooks: 2 },
  );
  assert.equal(issues.length, 1);
  assert.equal(issues[0].rule, 'inventory-count-mismatch');
});

test('blocks mutation and secret-bearing shared permissions without printing content', () => {
  const token = ['fixture', 'bearer', 'token', '12345678901234567890'].join('_');
  const settings = {
    permissions: {
      allow: [
        'mcp__Supabase__apply_migration',
        `Bash(curl -H "Authorization: Bearer ${token}" https://example.invalid:*)`,
      ],
    },
  };
  const issues = validatePermissionObject(
    settings,
    '.claude/settings.json',
    { knownFindings: [] },
    new Date('2026-07-23T00:00:00Z'),
  );
  assert.deepEqual(
    issues.map((issue) => issue.rule).sort(),
    ['mutation-permission', 'secret-bearing-permission'],
  );
  assert.ok(issues.every((issue) => !issue.message.includes(token)));
});

test('expired findings stop waiving unsafe permissions', () => {
  const issues = validatePermissionObject(
    { permissions: { allow: ['mcp__Supabase__execute_sql'] } },
    '.claude/settings.local.json',
    {
      knownFindings: [
        {
          rule: 'mutation-permission',
          path: '.claude/settings.local.json',
          finding: 'TEST',
          expires: '2026-07-01',
        },
      ],
    },
    new Date('2026-07-23T00:00:00Z'),
  );
  assert.equal(issues[0].level, 'error');
});

test('secret hook blocks literal authorization credentials and allows placeholders when bash exists', (t) => {
  const bash = spawnSync('bash', ['--version'], { encoding: 'utf8', windowsHide: true });
  if (bash.error || bash.status !== 0) {
    t.skip('bash is unavailable in this local environment; CI exercises this fixture on Ubuntu');
    return;
  }

  const hook = path.resolve('.claude/hooks/block-secrets.sh');
  const token = ['fixture', 'authorization', 'credential', '12345678901234567890'].join('_');
  const blocked = spawnSync('bash', [hook], {
    input: JSON.stringify({
      tool_input: {
        file_path: 'example.txt',
        new_string: `Authorization: Bearer ${token}`,
      },
    }),
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(blocked.status, 2);
  assert.ok(!blocked.stderr.includes(token));

  const allowed = spawnSync('bash', [hook], {
    input: JSON.stringify({
      tool_input: {
        file_path: 'example.txt',
        new_string: 'Authorization: Bearer ${AUTH_TOKEN}',
      },
    }),
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(allowed.status, 0);
});
