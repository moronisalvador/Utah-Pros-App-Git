/**
 * FILE: render-tooling-adapters.node-test.mjs
 *
 * WHAT THIS DOES (plain language):
 *   Proves neutral capability sources generate repeatable Claude Code and Codex adapter files and
 *   that a manual adapter edit is detected as drift.
 *
 * DEPENDS ON:
 *   Packages:  Node.js built-ins only
 *   Internal:  scripts/render-tooling-adapters.mjs and tooling capability fixtures
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  compareAdapterFiles,
  expectedAdapterFiles,
  writeAdapterFiles,
} from './render-tooling-adapters.mjs';

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upr-tooling-render-'));
  fs.mkdirSync(path.join(root, 'tooling', 'skills', 'sample'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tooling', 'agents'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'tooling', 'skills', 'sample', 'SKILL.md'),
    '---\nname: sample\ndescription: Use for a sample task.\n---\n\n# Sample\n\nRead `AGENTS.md`.\n',
  );
  fs.writeFileSync(
    path.join(root, 'tooling', 'agents', 'reviewer.md'),
    '---\nname: reviewer\ndescription: Read-only sample reviewer.\n---\n\n# Reviewer\n\nReport only.\n',
  );
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Fixture\n');
  fs.writeFileSync(
    path.join(root, 'tooling', 'capabilities.json'),
    JSON.stringify({
      schemaVersion: 1,
      skills: [
        {
          name: 'sample',
          source: 'tooling/skills/sample/SKILL.md',
          outputs: ['.claude/skills/sample/SKILL.md', '.agents/skills/sample/SKILL.md'],
          codexInterface: {
            displayName: 'Sample',
            shortDescription: 'Run the sample workflow',
            defaultPrompt: 'Use $sample to do the sample task.',
          },
        },
      ],
      agents: [
        {
          name: 'reviewer',
          source: 'tooling/agents/reviewer.md',
          claudeOutput: '.claude/agents/reviewer.md',
          codexOutput: '.codex/agents/reviewer.toml',
          claude: { tools: 'Read', model: 'inherit' },
        },
      ],
    }),
  );
  return root;
}

test('renders equivalent discoverable adapters and Codex UI metadata', () => {
  const root = makeFixture();
  const expected = expectedAdapterFiles(root);
  assert.equal(expected.size, 5);
  writeAdapterFiles(root, expected);
  assert.deepEqual(compareAdapterFiles(root, expected), []);

  const claude = fs.readFileSync(path.join(root, '.claude', 'skills', 'sample', 'SKILL.md'), 'utf8');
  const codex = fs.readFileSync(path.join(root, '.agents', 'skills', 'sample', 'SKILL.md'), 'utf8');
  assert.equal(claude, codex);
  assert.match(claude, /GENERATED from tooling\/skills\/sample\/SKILL\.md/);

  const ui = fs.readFileSync(
    path.join(root, '.agents', 'skills', 'sample', 'agents', 'openai.yaml'),
    'utf8',
  );
  assert.match(ui, /default_prompt: "Use \$sample/);
});

test('detects manual adapter drift without rewriting it', () => {
  const root = makeFixture();
  const expected = expectedAdapterFiles(root);
  writeAdapterFiles(root, expected);
  const target = path.join(root, '.agents', 'skills', 'sample', 'SKILL.md');
  fs.appendFileSync(target, '\nmanual edit\n');
  assert.deepEqual(compareAdapterFiles(root, expected), [
    { path: '.agents/skills/sample/SKILL.md', reason: 'drift' },
  ]);
});
