/**
 * FILE: render-tooling-adapters.node-test.mjs
 *
 * WHAT THIS DOES (plain language):
 *   Proves neutral capability sources generate repeatable Claude Code and Codex adapter files and
 *   that a manual adapter edit is detected as drift. It also preserves deliberately different
 *   runtime model, effort, turn-cap, and sandbox settings without putting them in shared prose.
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
  loadCapabilityManifest,
  writeAdapterFiles,
} from './render-tooling-adapters.mjs';

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upr-tooling-render-'));
  fs.mkdirSync(path.join(root, 'tooling', 'skills', 'sample'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tooling', 'agents'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'tooling', 'skills', 'sample', 'SKILL.md'),
    '---\nname: sample\ndescription: Use for a sample task.\n---\n\n# Sample\n\nRead `AGENTS.md` and [details](references/details.md).\n',
  );
  fs.mkdirSync(path.join(root, 'tooling', 'skills', 'sample', 'references'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'tooling', 'skills', 'sample', 'references', 'details.md'),
    '# Details\n\nShared resource.\n',
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
          resources: ['references/details.md'],
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
          claude: {
            tools: 'Read',
            model: 'inherit',
            effort: 'medium',
            maxTurns: 12,
          },
          codex: {
            model: 'fixture-model',
            modelReasoningEffort: 'high',
            sandboxMode: 'read-only',
          },
        },
      ],
    }),
  );
  return root;
}

test('renders equivalent discoverable adapters and Codex UI metadata', () => {
  const root = makeFixture();
  const expected = expectedAdapterFiles(root);
  assert.equal(expected.size, 7);
  writeAdapterFiles(root, expected);
  assert.deepEqual(compareAdapterFiles(root, expected), []);

  const claude = fs.readFileSync(path.join(root, '.claude', 'skills', 'sample', 'SKILL.md'), 'utf8');
  const codex = fs.readFileSync(path.join(root, '.agents', 'skills', 'sample', 'SKILL.md'), 'utf8');
  assert.equal(claude, codex);
  assert.match(claude, /GENERATED from tooling\/skills\/sample\/SKILL\.md/);
  const claudeResource = fs.readFileSync(
    path.join(root, '.claude', 'skills', 'sample', 'references', 'details.md'),
    'utf8',
  );
  const codexResource = fs.readFileSync(
    path.join(root, '.agents', 'skills', 'sample', 'references', 'details.md'),
    'utf8',
  );
  assert.equal(claudeResource, '# Details\n\nShared resource.\n');
  assert.equal(codexResource, claudeResource);

  const ui = fs.readFileSync(
    path.join(root, '.agents', 'skills', 'sample', 'agents', 'openai.yaml'),
    'utf8',
  );
  assert.match(ui, /default_prompt: "Use \$sample/);

  const claudeAgent = fs.readFileSync(
    path.join(root, '.claude', 'agents', 'reviewer.md'),
    'utf8',
  );
  assert.match(claudeAgent, /^effort: medium$/m);
  assert.match(claudeAgent, /^maxTurns: 12$/m);

  const codexAgent = fs.readFileSync(
    path.join(root, '.codex', 'agents', 'reviewer.toml'),
    'utf8',
  );
  assert.match(codexAgent, /^model = "fixture-model"$/m);
  assert.match(codexAgent, /^model_reasoning_effort = "high"$/m);
  assert.match(codexAgent, /^sandbox_mode = "read-only"$/m);
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

// ── modelInvocable: the human-only gate must fire in BOTH runtimes, and must be
// OFF by default. Added 2026-07-26 with the riskTier/modelInvocable schema.
// An unexercised gate is not a verified gate: the first version of this feature
// passed `entry` to renderOpenAiYaml but NOT to renderSkill, so the Claude half
// was a silent no-op that no drift check could have caught.
test('modelInvocable: false emits the human-only gate in both runtimes; default emits neither', () => {
  const root = makeFixture();
  const manifest = loadCapabilityManifest(root);

  // Default (field absent) — neither gate present, both runtimes invocable.
  const openByDefault = expectedAdapterFiles(root, manifest);
  const CLAUDE_SKILL = '.claude/skills/sample/SKILL.md';
  const CODEX_SKILL = '.agents/skills/sample/SKILL.md';
  const CODEX_YAML = '.agents/skills/sample/agents/openai.yaml';
  const claudeDefault = openByDefault.get(CLAUDE_SKILL);
  const yamlDefault = openByDefault.get(CODEX_YAML);
  assert.doesNotMatch(claudeDefault, /disable-model-invocation/, 'default must stay model-invocable');
  assert.match(yamlDefault, /allow_implicit_invocation: true/);

  // modelInvocable: false — BOTH gates appear.
  manifest.skills[0].modelInvocable = false;
  const gated = expectedAdapterFiles(root, manifest);
  const claudeGated = gated.get(CLAUDE_SKILL);
  const yamlGated = gated.get(CODEX_YAML);
  assert.match(claudeGated, /^disable-model-invocation: true$/m, 'Claude gate missing');
  assert.match(yamlGated, /allow_implicit_invocation: false/, 'Codex gate missing');

  // The gate belongs INSIDE the frontmatter block, or Claude Code ignores it.
  const fm = claudeGated.split('\n---\n')[0];
  assert.match(fm, /disable-model-invocation: true/, 'gate must sit inside the YAML frontmatter');

  // The two runtimes' skill bodies stay byte-identical — the gate lives in
  // frontmatter/policy, never in the instruction text.
  assert.equal(
    claudeGated.split('\n---\n').slice(1).join('\n---\n'),
    gated.get(CODEX_SKILL).split('\n---\n').slice(1).join('\n---\n'),
  );
});

test('rejects a non-positive Claude turn cap instead of generating ambiguous metadata', () => {
  const root = makeFixture();
  const manifest = loadCapabilityManifest(root);
  manifest.agents[0].claude.maxTurns = 0;
  assert.throws(
    () => expectedAdapterFiles(root, manifest),
    /claude\.maxTurns must be a positive integer/,
  );
});

test('rejects skill resources that escape or overwrite generated adapter metadata', () => {
  const root = makeFixture();
  const manifest = loadCapabilityManifest(root);
  for (const resource of ['../outside.md', 'SKILL.md', 'agents/openai.yaml']) {
    manifest.skills[0].resources = [resource];
    assert.throws(
      () => expectedAdapterFiles(root, manifest),
      /unsafe or reserved resource path/,
    );
  }
});

test('mobile readiness uses the neutral pipeline with preserved models, effort, and sandboxes', () => {
  const root = path.resolve('.');
  const manifest = loadCapabilityManifest(root);
  const expected = expectedAdapterFiles(root, manifest);
  const skill = manifest.skills.find((entry) => entry.name === 'mobile-readiness-wave');
  const agents = new Map(
    manifest.agents
      .filter((entry) => entry.name.startsWith('mobile-readiness-'))
      .map((entry) => [entry.name, entry]),
  );

  assert.equal(skill.source, 'tooling/skills/mobile-readiness-wave/SKILL.md');
  assert.equal(skill.riskTier, 'red');
  assert.equal(skill.modelInvocable, true);
  assert.equal(agents.size, 4);
  assert.equal(agents.get('mobile-readiness-mapper').riskTier, 'green');
  assert.equal(agents.get('mobile-readiness-security-reviewer').riskTier, 'green');
  assert.equal(agents.get('mobile-readiness-contract-tester').riskTier, 'amber');
  assert.equal(agents.get('mobile-readiness-release-auditor').riskTier, 'green');

  const mapperClaude = expected.get('.claude/agents/mobile-readiness-mapper.md');
  const mapperCodex = expected.get('.codex/agents/mobile-readiness-mapper.toml');
  const securityCodex = expected.get(
    '.codex/agents/mobile-readiness-security-reviewer.toml',
  );
  const testerCodex = expected.get('.codex/agents/mobile-readiness-contract-tester.toml');
  const releaseCodex = expected.get('.codex/agents/mobile-readiness-release-auditor.toml');
  const skillUi = expected.get(
    '.agents/skills/mobile-readiness-wave/agents/openai.yaml',
  );

  assert.match(mapperClaude, /^model: haiku$/m);
  assert.match(mapperClaude, /^effort: medium$/m);
  assert.match(mapperClaude, /^maxTurns: 14$/m);
  assert.match(mapperCodex, /^model = "gpt-5\.6-terra"$/m);
  assert.match(mapperCodex, /^model_reasoning_effort = "medium"$/m);
  assert.match(mapperCodex, /^sandbox_mode = "read-only"$/m);
  assert.match(securityCodex, /^model = "gpt-5\.6-sol"$/m);
  assert.match(securityCodex, /^sandbox_mode = "read-only"$/m);
  assert.match(testerCodex, /^model = "gpt-5\.6-terra"$/m);
  assert.match(testerCodex, /^sandbox_mode = "workspace-write"$/m);
  assert.match(releaseCodex, /^model = "gpt-5\.6-sol"$/m);
  assert.match(releaseCodex, /^sandbox_mode = "read-only"$/m);
  assert.match(releaseCodex, /Never edit, deploy, apply/);
  assert.match(skillUi, /allow_implicit_invocation: true/);

  for (const entry of agents.values()) {
    const claude = expected.get(entry.claudeOutput);
    const codex = expected.get(entry.codexOutput);
    assert.match(claude, new RegExp(`^maxTurns: ${entry.claude.maxTurns}$`, 'm'));
    assert.doesNotMatch(codex, /^max_turns\s*=/m);
    assert.match(claude, /GENERATED from tooling\/agents\/mobile-readiness-/);
    assert.match(codex, /GENERATED from tooling\/agents\/mobile-readiness-/);
  }
});
