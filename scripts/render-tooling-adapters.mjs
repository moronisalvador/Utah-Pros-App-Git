#!/usr/bin/env node
/**
 * FILE: render-tooling-adapters.mjs
 *
 * WHAT THIS DOES (plain language):
 *   Turns the neutral UPR skill and reviewer sources into the small files Claude Code and Codex
 *   discover in their own repository folders. It can write those files or check that committed
 *   outputs still exactly match their source.
 *
 * DEPENDS ON:
 *   Packages:  Node.js built-ins only
 *   Internal:  tooling/capabilities.json and the neutral sources listed there
 *
 * NOTES / GOTCHAS:
 *   - The default mode is check-only. Pass --write to update generated adapters.
 *   - Generated files must never be edited directly; change their neutral source or manifest.
 *   - Runtime-only model, effort, turn-cap, and sandbox settings live in the manifest rather than
 *     the neutral instruction body. Unsupported settings are not invented for the other runtime.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const GENERATED_NOTICE =
  'GENERATED from {source} by scripts/render-tooling-adapters.mjs. Do not edit this adapter directly.';

function normalize(value) {
  return value.replaceAll('\\', '/');
}

function quotedYaml(value) {
  return JSON.stringify(String(value));
}

function tomlString(value) {
  return JSON.stringify(String(value));
}

function sourceHash(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

export function parseNeutralMarkdown(raw, sourcePath) {
  if (!raw.startsWith('---\n')) throw new Error(`${sourcePath} must start with YAML frontmatter.`);
  const end = raw.indexOf('\n---\n', 4);
  if (end < 0) throw new Error(`${sourcePath} has unterminated YAML frontmatter.`);
  const metadata = {};
  for (const line of raw.slice(4, end).split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.+)$/);
    if (match) metadata[match[1]] = match[2].trim().replace(/^"(.*)"$/, '$1');
  }
  if (!metadata.name || !metadata.description) {
    throw new Error(`${sourcePath} requires name and description frontmatter.`);
  }
  return {
    metadata,
    body: raw.slice(end + 5).trim(),
  };
}

function generatedMarkdownNotice(source, hash) {
  return `<!-- ${GENERATED_NOTICE.replace('{source}', source)} Source SHA-256: ${hash}. -->`;
}

// `modelInvocable: false` in the manifest emits BOTH tools' human-only gates:
// `disable-model-invocation: true` here and `allow_implicit_invocation: false`
// in renderOpenAiYaml. Default is invocable — per owner direction (2026-07-26)
// UPR gates the MUTATION, not the dispatcher, so a red-tier planner like
// db-migration stays model-invocable and the apply is gated by
// .claude/hooks/block-destructive-sql.sh instead.
function renderSkill(source, raw, entry = {}) {
  const { metadata, body } = parseNeutralMarkdown(raw, source);
  const hash = sourceHash(raw);
  return [
    '---',
    `name: ${metadata.name}`,
    `description: ${metadata.description}`,
    ...(entry.modelInvocable === false ? ['disable-model-invocation: true'] : []),
    '---',
    '',
    generatedMarkdownNotice(source, hash),
    '',
    body,
    '',
  ].join('\n');
}

function renderClaudeAgent(entry, raw) {
  const { metadata, body } = parseNeutralMarkdown(raw, entry.source);
  const hash = sourceHash(raw);
  if (
    entry.claude.maxTurns !== undefined &&
    (!Number.isInteger(entry.claude.maxTurns) || entry.claude.maxTurns < 1)
  ) {
    throw new Error(`${entry.source} claude.maxTurns must be a positive integer.`);
  }
  return [
    '---',
    `name: ${metadata.name}`,
    `description: ${metadata.description}`,
    `tools: ${entry.claude.tools}`,
    `model: ${entry.claude.model}`,
    ...(entry.claude.effort ? [`effort: ${entry.claude.effort}`] : []),
    ...(entry.claude.maxTurns ? [`maxTurns: ${entry.claude.maxTurns}`] : []),
    '---',
    '',
    generatedMarkdownNotice(entry.source, hash),
    '',
    body,
    '',
  ].join('\n');
}

function renderCodexAgent(entry, raw) {
  const { metadata, body } = parseNeutralMarkdown(raw, entry.source);
  const hash = sourceHash(raw);
  const instructions = [
    `<!-- ${GENERATED_NOTICE.replace('{source}', entry.source)} Source SHA-256: ${hash}. -->`,
    '',
    body,
  ].join('\n');
  if (instructions.includes('"""')) {
    throw new Error(`${entry.source} contains a TOML multiline-string delimiter.`);
  }
  // A Codex agent file is a full config LAYER, not a manifest: when it OMITS
  // sandbox_mode it INHERITS the parent's, and subagents also inherit the
  // composer's permission mode. So a read-only reviewer spawned from a
  // write-enabled session is write-enabled unless it pins otherwise. Presence is
  // not proof of effect (a user-layer `sandbox = "elevated"` exists on this
  // machine) — but an explicit pin is the only thing that can win at all.
  const model = entry.codex?.model;
  const modelReasoningEffort = entry.codex?.modelReasoningEffort;
  const sandboxMode = entry.codex?.sandboxMode;
  return [
    `name = ${tomlString(metadata.name)}`,
    `description = ${tomlString(metadata.description)}`,
    ...(model ? [`model = ${tomlString(model)}`] : []),
    ...(modelReasoningEffort
      ? [`model_reasoning_effort = ${tomlString(modelReasoningEffort)}`]
      : []),
    ...(sandboxMode ? [`sandbox_mode = ${tomlString(sandboxMode)}`] : []),
    'developer_instructions = """',
    instructions,
    '"""',
    '',
  ].join('\n');
}

function renderOpenAiYaml(entry) {
  const ui = entry.codexInterface;
  return [
    'interface:',
    `  display_name: ${quotedYaml(ui.displayName)}`,
    `  short_description: ${quotedYaml(ui.shortDescription)}`,
    `  default_prompt: ${quotedYaml(ui.defaultPrompt)}`,
    'policy:',
    `  allow_implicit_invocation: ${entry.modelInvocable === false ? 'false' : 'true'}`,
    '',
  ].join('\n');
}

export function loadCapabilityManifest(root, manifestRepoPath = 'tooling/capabilities.json') {
  const manifestPath = path.join(root, manifestRepoPath);
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

export function expectedAdapterFiles(root, manifest = loadCapabilityManifest(root)) {
  const outputs = new Map();
  for (const entry of manifest.skills || []) {
    const sourcePath = path.join(root, entry.source);
    const raw = fs.readFileSync(sourcePath, 'utf8').replaceAll('\r\n', '\n');
    const parsed = parseNeutralMarkdown(raw, entry.source);
    if (parsed.metadata.name !== entry.name) {
      throw new Error(`${entry.source} name does not match manifest entry ${entry.name}.`);
    }
    const rendered = renderSkill(entry.source, raw, entry);
    for (const output of entry.outputs || []) outputs.set(normalize(output), rendered);
    const codexSkillRoot = (entry.outputs || []).find((output) => output.startsWith('.agents/skills/'));
    if (codexSkillRoot) {
      outputs.set(
        normalize(path.join(path.dirname(codexSkillRoot), 'agents', 'openai.yaml')),
        renderOpenAiYaml(entry),
      );
    }
  }

  for (const entry of manifest.agents || []) {
    const sourcePath = path.join(root, entry.source);
    const raw = fs.readFileSync(sourcePath, 'utf8').replaceAll('\r\n', '\n');
    const parsed = parseNeutralMarkdown(raw, entry.source);
    if (parsed.metadata.name !== entry.name) {
      throw new Error(`${entry.source} name does not match manifest entry ${entry.name}.`);
    }
    outputs.set(normalize(entry.claudeOutput), renderClaudeAgent(entry, raw));
    outputs.set(normalize(entry.codexOutput), renderCodexAgent(entry, raw));
  }
  return outputs;
}

export function compareAdapterFiles(root, expected = expectedAdapterFiles(root)) {
  const issues = [];
  for (const [repoPath, content] of expected) {
    const absolute = path.join(root, repoPath);
    if (!fs.existsSync(absolute)) {
      issues.push({ path: repoPath, reason: 'missing' });
      continue;
    }
    const actual = fs.readFileSync(absolute, 'utf8').replaceAll('\r\n', '\n');
    if (actual !== content) issues.push({ path: repoPath, reason: 'drift' });
  }
  return issues;
}

export function writeAdapterFiles(root, expected = expectedAdapterFiles(root)) {
  for (const [repoPath, content] of expected) {
    const absolute = path.join(root, repoPath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content);
  }
}

function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(scriptDir, '..');
  const write = process.argv.includes('--write');
  const expected = expectedAdapterFiles(root);
  if (write) writeAdapterFiles(root, expected);
  const issues = compareAdapterFiles(root, expected);
  if (issues.length) {
    for (const issue of issues) process.stderr.write(`${issue.reason.toUpperCase()} ${issue.path}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`Tooling adapters: ${expected.size} generated file(s) current.\n`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
