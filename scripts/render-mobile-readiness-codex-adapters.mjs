#!/usr/bin/env node
/**
 * FILE: render-mobile-readiness-codex-adapters.mjs
 *
 * WHAT THIS DOES (plain language):
 *   Builds the Codex-specific mobile skill and agent files from UPR's canonical .claude sources.
 *   It can also check that checked-in generated files still match those sources.
 *
 * DEPENDS ON:
 *   Packages:  Node.js built-ins only
 *   Internal:  .claude/mobile-readiness-codex-adapters.json and its declared sources
 *
 * NOTES / GOTCHAS:
 *   - .claude remains the authority. Never hand-edit the generated .agents or .codex agent files.
 *   - This intentionally ports only the mobile-readiness pilot, not the whole tooling inventory.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const manifestPath = path.join(
  repositoryRoot,
  '.claude',
  'mobile-readiness-codex-adapters.json',
);

function readUtf8(repoPath) {
  return fs.readFileSync(path.join(repositoryRoot, repoPath), 'utf8').replaceAll('\r\n', '\n');
}

function parseFrontmatter(raw, sourcePath) {
  if (!raw.startsWith('---\n')) {
    throw new Error(`${sourcePath} is missing YAML frontmatter`);
  }
  const closingIndex = raw.indexOf('\n---\n', 4);
  if (closingIndex < 0) {
    throw new Error(`${sourcePath} has unterminated YAML frontmatter`);
  }

  const fields = {};
  for (const line of raw.slice(4, closingIndex).split('\n')) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (match) fields[match[1]] = match[2].trim();
  }
  if (!fields.name || !fields.description) {
    throw new Error(`${sourcePath} must declare name and description`);
  }

  return {
    fields,
    body: raw.slice(closingIndex + 5).trim(),
  };
}

function tomlString(value) {
  return JSON.stringify(value);
}

function renderAgent(entry) {
  const canonical = readUtf8(entry.source);
  const { fields, body } = parseFrontmatter(canonical, entry.source);
  const instructions = [
    `Generated from ${entry.source}. Treat that file as canonical; do not edit this adapter by hand.`,
    '',
    body,
  ].join('\n');

  return [
    '# GENERATED FILE — run npm run generate:mobile-codex',
    `# Canonical source: ${entry.source}`,
    '',
    `name = ${tomlString(fields.name)}`,
    `description = ${tomlString(fields.description)}`,
    `model = ${tomlString(entry.model)}`,
    `model_reasoning_effort = ${tomlString(entry.modelReasoningEffort)}`,
    `sandbox_mode = ${tomlString(entry.sandboxMode)}`,
    `developer_instructions = ${tomlString(instructions)}`,
    '',
  ].join('\n');
}

function renderSkillMarkdown(manifest) {
  const sourcePath = `${manifest.skill.sourceDirectory}/SKILL.md`;
  const raw = readUtf8(sourcePath);
  const closingIndex = raw.indexOf('\n---\n', 4);
  if (!raw.startsWith('---\n') || closingIndex < 0) {
    throw new Error(`${sourcePath} has invalid YAML frontmatter`);
  }
  const header = raw.slice(0, closingIndex + 5);
  const body = raw.slice(closingIndex + 5);
  return `${header}\n<!-- GENERATED from ${sourcePath}; do not edit this adapter by hand. -->\n${body}`;
}

function renderSkillInterface(manifest) {
  const sourcePath = `${manifest.skill.sourceDirectory}/agents/openai.yaml`;
  return `# GENERATED from ${sourcePath}; do not edit this adapter by hand.\n${readUtf8(sourcePath)}`;
}

export function expectedAdapters(root = repositoryRoot) {
  if (root !== repositoryRoot) {
    throw new Error('Custom roots are not supported; run the renderer from this repository.');
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const expected = new Map();

  for (const entry of manifest.agents) {
    expected.set(entry.target, renderAgent(entry));
  }
  expected.set(
    `${manifest.skill.targetDirectory}/SKILL.md`,
    renderSkillMarkdown(manifest),
  );
  expected.set(
    `${manifest.skill.targetDirectory}/agents/openai.yaml`,
    renderSkillInterface(manifest),
  );
  return expected;
}

export function checkAdapters() {
  const mismatches = [];
  for (const [repoPath, expected] of expectedAdapters()) {
    const absolute = path.join(repositoryRoot, repoPath);
    if (!fs.existsSync(absolute)) {
      mismatches.push(`${repoPath}: missing`);
      continue;
    }
    const actual = fs.readFileSync(absolute, 'utf8').replaceAll('\r\n', '\n');
    if (actual !== expected) mismatches.push(`${repoPath}: stale`);
  }
  return mismatches;
}

export function writeAdapters() {
  for (const [repoPath, content] of expectedAdapters()) {
    const absolute = path.join(repositoryRoot, repoPath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content);
  }
}

function main() {
  const checkOnly = process.argv.includes('--check');
  if (checkOnly) {
    const mismatches = checkAdapters();
    if (mismatches.length > 0) {
      console.error('Mobile Codex adapters are not current:');
      for (const mismatch of mismatches) console.error(`- ${mismatch}`);
      console.error('Run: npm run generate:mobile-codex');
      process.exitCode = 1;
      return;
    }
    console.log('Mobile Codex adapters match their canonical .claude sources.');
    return;
  }

  writeAdapters();
  console.log('Generated mobile Codex adapters from canonical .claude sources.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
