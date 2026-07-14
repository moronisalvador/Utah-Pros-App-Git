#!/usr/bin/env node
/**
 * ════════════════════════════════════════════════
 * FILE: build-index.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Scans the UPR repository and writes a small "map" of where each feature
 *   lives — which pages, components, background workers, database functions
 *   (RPCs), tables, tests, and coding-standard docs relate to it. The map is
 *   saved as a plain data file (src/codeIndex.js) that the upr_code_context MCP
 *   tool reads at runtime. Run it with `npm run build-index` whenever the repo
 *   changes enough that the map is stale.
 *
 * WHERE IT LIVES:
 *   Run from:     upr-mcp/  (via `npm run build-index`)
 *   Reads:        the repo checkout two levels up (src/, functions/api/,
 *                 supabase/migrations/, .claude/rules/, UPR-Web-Context.md, CLAUDE.md)
 *   Writes:       upr-mcp/src/codeIndex.js  (checked in, imported by codeContext.js)
 *
 * DEPENDS ON:
 *   Packages:  node:fs, node:path, node:url (Node built-ins only — no deps)
 *   Internal:  none (deliberately standalone; the worker never runs this)
 *
 * NOTES / GOTCHAS:
 *   - Build-time ONLY. This never runs inside the Cloudflare Worker (no fs there).
 *   - No embeddings / semantic index by design — this is a curated keyword map.
 *   - RPC names come from supabase/migrations (the authoritative schema-as-code);
 *     table + topic keywords come from UPR-Web-Context.md; page/component/worker
 *     names come from the filesystem; gold-standards are grep'd out of the
 *     .claude/rules/ docs. Keep those doc sources current (Rule 9) for a good map.
 * ════════════════════════════════════════════════
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..'); // upr-mcp/scripts → repo root
const OUT = path.resolve(__dirname, '..', 'src', 'codeIndex.js');

// ─── SECTION: Helpers ──────────────
const read = (rel) => {
  try { return fs.readFileSync(path.join(REPO, rel), 'utf8'); } catch { return ''; }
};

// Recursively list files under a dir matching a predicate, returned repo-relative.
function walk(relDir, matcher) {
  const abs = path.join(REPO, relDir);
  const out = [];
  let entries;
  try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const rel = path.join(relDir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      out.push(...walk(rel, matcher));
    } else if (matcher(e.name, rel)) {
      out.push(rel);
    }
  }
  return out;
}

// Split an identifier / path into lowercase keyword tokens.
// Handles camelCase, snake_case, kebab-case, and path separators.
function tokenize(str) {
  if (!str) return [];
  return String(str)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')     // camelCase → camel Case
    .replace(/[^A-Za-z0-9]+/g, ' ')              // punctuation / separators → space
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t && t.length > 1 && !STOP.has(t));
}

const STOP = new Set([
  'the', 'and', 'for', 'src', 'jsx', 'js', 'sql', 'api', 'md', 'get', 'set', 'new',
  'index', 'page', 'pages', 'row', 'rows', 'add', 'via', 'use', 'all', 'per', 'not',
]);

const uniq = (arr) => [...new Set(arr)];

// ─── SECTION: Scanners ──────────────

// Pages: src/pages/**/*.jsx — the area (tech/crm/settings) becomes a token too.
function scanPages() {
  return walk('src/pages', (n) => n.endsWith('.jsx')).map((rel) => ({
    path: rel,
    tokens: uniq(tokenize(rel)),
  }));
}

// Components: src/components/**/*.jsx
function scanComponents() {
  return walk('src/components', (n) => n.endsWith('.jsx')).map((rel) => ({
    path: rel,
    tokens: uniq(tokenize(rel)),
  }));
}

// Workers: functions/api/*.js (Cloudflare Pages Functions). Skip test files.
function scanWorkers() {
  return walk('functions/api', (n) => n.endsWith('.js') && !n.endsWith('.test.js')).map((rel) => ({
    path: rel,
    tokens: uniq(tokenize(rel)),
  }));
}

// RPCs: every CREATE [OR REPLACE] FUNCTION name across the tracked migrations.
// The migration filenames feed nothing but the name is authoritative schema-as-code.
function scanRpcs() {
  const files = walk('supabase/migrations', (n) => n.endsWith('.sql'));
  const names = new Set();
  const re = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi;
  for (const rel of files) {
    const sql = read(rel);
    let m;
    while ((m = re.exec(sql))) names.add(m[1].toLowerCase());
  }
  // Enrich tokens with the one-line description from UPR-Web-Context.md if present.
  const ctx = read('UPR-Web-Context.md');
  return [...names].sort().map((name) => {
    const descLine = matchDocLine(ctx, name);
    return { name, tokens: uniq([...tokenize(name), ...(descLine ? tokenize(descLine) : [])]) };
  });
}

// Find a UPR-Web-Context.md line that documents `name(` and return its description
// (text after the em-dash), for token enrichment only.
function matchDocLine(ctx, name) {
  const re = new RegExp('^\\s*' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\(.*?—\\s*(.*)$', 'mi');
  const m = ctx.match(re);
  return m ? m[1].slice(0, 160) : null;
}

// Tables: parse the "## Database — All Tables" section of UPR-Web-Context.md.
// Inside it, ### sub-headers are domains and fenced `name — desc` lines are tables.
function scanTables(ctx) {
  const start = ctx.search(/^##\s+Database\s+—\s+All\s+Tables/mi);
  if (start < 0) return [];
  // End at the next top-level (## ) header after the section start.
  const rest = ctx.slice(start + 3);
  const endRel = rest.search(/^##\s+/m);
  const section = endRel < 0 ? ctx.slice(start) : ctx.slice(start, start + 3 + endRel);
  const lines = section.split('\n');
  const out = [];
  let domain = '';
  let inFence = false;
  for (const line of lines) {
    const h = line.match(/^###\s+(.*)$/);
    if (h) { domain = h[1].trim(); continue; }
    if (/^```/.test(line)) { inFence = !inFence; continue; }
    if (!inFence) continue;
    // `table_name              — description` (also handles indented continuation lines: skip those)
    const m = line.match(/^([a-z][a-z0-9_]*)\s+—\s*(.*)$/i);
    if (!m) continue;
    const name = m[1];
    const desc = m[2].slice(0, 120);
    out.push({ name, domain, tokens: uniq([...tokenize(name), ...tokenize(domain), ...tokenize(desc)]) });
  }
  return out;
}

// Doc topics: every ##/### header in UPR-Web-Context.md — a feature-area pointer.
function scanTopics(ctx) {
  const out = [];
  for (const line of ctx.split('\n')) {
    const hm = line.match(/^(#{2,3})\s+(.*)$/);
    if (!hm) continue;
    const title = hm[2].replace(/[`*]/g, '').trim();
    // Drop noisy dated/administrative headers with almost no feature signal.
    const tokens = uniq(tokenize(title));
    if (tokens.length === 0) continue;
    out.push({ title: title.slice(0, 80), tokens });
  }
  return out;
}

// Tests: unit tests (*.test.js) anywhere in the repo + SQL suites in supabase/tests.
function scanTests() {
  const js = walk('src', (n) => n.endsWith('.test.js'))
    .concat(walk('functions', (n) => n.endsWith('.test.js')))
    .concat(walk('upr-mcp/src', (n) => n.endsWith('.test.js')));
  const sql = walk('supabase/tests', (n) => n.endsWith('.sql') || n.endsWith('.test.sql'));
  return uniq([...js, ...sql]).map((rel) => ({ path: rel, tokens: uniq(tokenize(rel)) }));
}

// Rules: .claude/rules/*.md — title (first # heading) + a short "what it governs" summary.
function scanRules() {
  return walk('.claude/rules', (n) => n.endsWith('.md')).map((rel) => {
    const body = read(rel);
    const titleM = body.match(/^#\s+(.*)$/m);
    const title = (titleM ? titleM[1] : path.basename(rel, '.md')).replace(/[`*]/g, '').trim();
    // First bolded "The law for …" clause or first non-empty prose line as a summary.
    let summary = '';
    const law = body.match(/\*\*The law for ([^*]+)\*\*/i);
    if (law) summary = 'The law for ' + law[1].trim();
    if (!summary) {
      const lines = body.split('\n').map((l) => l.trim());
      const firstProse = lines.find((l, i) => i > 0 && l && !l.startsWith('#') && !l.startsWith('**Last'));
      summary = (firstProse || '').replace(/[`*]/g, '').slice(0, 140);
    }
    return {
      path: rel,
      title: title.slice(0, 80),
      summary: summary.slice(0, 140),
      tokens: uniq([...tokenize(rel), ...tokenize(title), ...tokenize(summary)]),
    };
  });
}

// Gold-standards: implementations the rules docs name as the reference "correct" one.
// Grep lines mentioning gold/reference-correct, then pull the backtick'd file paths.
// `resolve` maps a bare filename (TechTasks.jsx) to its full repo path where known.
function scanGoldStandards(resolve) {
  const files = walk('.claude/rules', (n) => n.endsWith('.md'));
  const out = [];
  const seen = new Set();
  for (const rel of files) {
    const lines = read(rel).split('\n');
    for (const line of lines) {
      if (!/\b(gold|reference "correct"|gold standard|the reference)\b/i.test(line)) continue;
      // backtick-wrapped paths ending in a source file, optional :lines suffix
      const pathRe = /`([^`]*?(?:src\/[^`]*?|[A-Za-z0-9_]+)\.(?:jsx|js))(?::[\d-]+)?`/g;
      let pm;
      while ((pm = pathRe.exec(line))) {
        const raw = pm[1];
        // keep real-looking source references (a filename or a src/ path)
        if (!/[A-Za-z]/.test(raw)) continue;
        const p = raw.includes('/') ? raw : (resolve(raw) || raw);
        const key = p + '|' + rel;
        if (seen.has(key)) continue;
        seen.add(key);
        // short reason = the line stripped of markdown emphasis (keep line-range hyphens)
        const reason = line.replace(/[`*_>#]/g, '').replace(/\s+/g, ' ').trim().slice(0, 110);
        out.push({ path: p, source: path.basename(rel), reason, tokens: uniq(tokenize(p)) });
      }
    }
  }
  return out;
}

// ─── SECTION: Build ──────────────
const ctx = read('UPR-Web-Context.md');

const pages = scanPages();
const components = scanComponents();
const workers = scanWorkers();
// Resolve a bare filename to a full repo path (pages > components > workers).
const byBasename = new Map();
for (const e of [...pages, ...components, ...workers]) {
  const base = path.basename(e.path);
  if (!byBasename.has(base)) byBasename.set(base, e.path);
}
const resolveBasename = (name) => byBasename.get(name) || null;

const index = {
  // NOTE: generated_at is stamped by the build (Node) — never read at runtime.
  generated_at: new Date().toISOString().slice(0, 10),
  pages,
  components,
  workers,
  rpcs: scanRpcs(),
  tables: scanTables(ctx),
  topics: scanTopics(ctx),
  tests: scanTests(),
  rules: scanRules(),
  gold: scanGoldStandards(resolveBasename),
};

const stats = Object.fromEntries(
  Object.entries(index).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length]),
);

const banner = `// AUTO-GENERATED by \`npm run build-index\` (scripts/build-index.js). DO NOT EDIT BY HAND.
// A curated keyword map of where UPR features live. Regenerate after repo changes.
// Generated: ${index.generated_at} — ${JSON.stringify(stats)}
`;

fs.writeFileSync(OUT, banner + '\nexport const INDEX = ' + JSON.stringify(index, null, 1) + ';\n');
console.log('build-index: wrote', path.relative(REPO, OUT));
console.log('build-index: stats', stats);
