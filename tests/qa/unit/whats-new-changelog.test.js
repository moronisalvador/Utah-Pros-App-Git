/**
 * ════════════════════════════════════════════════
 * FILE: whats-new-changelog.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Guards the "What's New" page against the two ways it can quietly break:
 *   a malformed highlight file, and a reminder hook that stops reminding.
 *
 *   The page reads plain JSON files that people write by hand, and it renders
 *   them with no validation at runtime — so a typo in a field name shows up as
 *   a blank card on a page the whole team reads. These checks catch that in a
 *   credential-free lane before it ships.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path, node:child_process
 *   Internal:  src/data/changelog/*.json          (hand-written highlights)
 *              src/data/changelog-activity.json   (generated from git)
 *              .githooks/commit-msg               (the reminder)
 *   Data:      reads  → the above, as text
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - The hook cases run under bash and are SKIPPED where bash is absent,
 *     matching scripts/block-main-push.node-test.mjs. They assert exit 0 every
 *     time: this hook must never block a commit, and a crash that blocked one
 *     would be a defect, not a stricter guard.
 *   - Roughly half the hook cases assert SILENCE on purpose. A reminder that
 *     fires on everything gets ignored, and an ignored reminder is worth
 *     nothing — the quiet cases are as load-bearing as the loud one.
 *   - Deliberately does NOT assert a highlight count or a specific entry. The
 *     folder is meant to grow with every release; a test that pinned its size
 *     would fail on the next honest addition.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, mkdtempSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '../../..');
const ENTRY_DIR = path.join(REPO, 'src/data/changelog');
const ACTIVITY = path.join(REPO, 'src/data/changelog-activity.json');
const HOOK = path.join(REPO, '.githooks/commit-msg');

const KINDS = ['New', 'Improved', 'Fixed'];
const STATUSES = ['testing', 'rolling-out'];

/** Areas the generator can produce, so a highlight cannot invent a category
 *  that the activity tier below it will never show. Mirrors AREA_RULES in
 *  scripts/generate-changelog-activity.mjs. */
const AREAS = [
  'Billing', 'CRM', 'Claims & Jobs', 'Dashboard', 'Field App', 'General',
  'Interface', 'Messaging', 'Mobile App', 'Notifications', 'Platform',
  'Scheduling', 'Settings & Access', 'Translations',
];

const entryFiles = existsSync(ENTRY_DIR)
  ? readdirSync(ENTRY_DIR).filter(f => f.endsWith('.json'))
  : [];

describe('What\'s New — highlight entries', () => {
  it('has at least one entry to render', () => {
    expect(entryFiles.length).toBeGreaterThan(0);
  });

  it.each(entryFiles)('%s is valid', file => {
    const raw = readFileSync(path.join(ENTRY_DIR, file), 'utf8');

    let entry;
    expect(() => { entry = JSON.parse(raw); }, `${file} is not valid JSON`).not.toThrow();

    // Required fields. A missing one renders as an empty card, not an error.
    expect(entry.date, `${file}: missing date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(KINDS, `${file}: kind must be one of ${KINDS.join('/')}`).toContain(entry.kind);
    expect(AREAS, `${file}: unknown area "${entry.area}"`).toContain(entry.area);
    expect(typeof entry.title, `${file}: missing title`).toBe('string');
    expect(entry.title.trim().length, `${file}: empty title`).toBeGreaterThan(0);

    // Optional fields, checked only when present.
    if ('body' in entry) expect(typeof entry.body).toBe('string');
    if ('status' in entry) expect(STATUSES).toContain(entry.status);
    if ('sha' in entry) expect(entry.sha).toMatch(/^[0-9a-f]{7,40}$/);

    // The filename carries the date so the folder sorts chronologically.
    expect(file.startsWith(entry.date), `${file}: filename date must match the date field`).toBe(true);
  });

  it('titles are written for a reader, not copied from a commit subject', () => {
    const offenders = [];
    for (const file of entryFiles) {
      const { title } = JSON.parse(readFileSync(path.join(ENTRY_DIR, file), 'utf8'));
      // A conventional-commit prefix means someone pasted the subject line.
      if (/^(feat|fix|perf|chore|docs|refactor|test)(\(|:)/i.test(title)) offenders.push(file);
    }
    expect(offenders, 'these titles look like raw commit subjects').toEqual([]);
  });
});

describe('What\'s New — generated activity', () => {
  const activity = JSON.parse(readFileSync(ACTIVITY, 'utf8'));

  it('carries weeks, newest first', () => {
    expect(activity.weeks.length).toBeGreaterThan(0);
    const starts = activity.weeks.map(w => w.start);
    expect(starts).toEqual([...starts].sort().reverse());
  });

  it('totals match the rows actually present', () => {
    const counted = activity.weeks.reduce((n, w) => n + w.items.length, 0);
    expect(activity.totals.changes).toBe(counted);
    expect(activity.totals.weeks).toBe(activity.weeks.length);
  });

  it('every item has what the page renders', () => {
    for (const week of activity.weeks) {
      expect(week.count).toBe(week.items.length);
      for (const item of week.items) {
        expect(item.sha).toMatch(/^[0-9a-f]{7}$/);
        expect(item.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(['New', 'Fixed', 'Faster']).toContain(item.kind);
        expect(AREAS).toContain(item.area);
        expect(item.text.length).toBeGreaterThan(0);
      }
    }
  });

  it('React keys are unique — a duplicate sha would drop rows silently', () => {
    for (const week of activity.weeks) {
      const shas = week.items.map(i => i.sha);
      expect(new Set(shas).size, `duplicate sha in week ${week.start}`).toBe(shas.length);
    }
  });
});

// ─── The reminder hook ──────────────

const hasBash = spawnSync('bash', ['-c', 'exit 0']).status === 0;

/**
 * Run the hook against a throwaway repo with a chosen set of staged paths.
 * Returns { code, nudged } — nudged is whether it printed anything.
 */
function runHook(message, stagedPaths) {
  const dir = mkdtempSync(path.join(tmpdir(), 'upr-changelog-hook-'));
  spawnSync('git', ['init', '-q', '.'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 't@t.t'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 't'], { cwd: dir });

  for (const rel of stagedPaths) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, 'x');
  }
  if (stagedPaths.length) spawnSync('git', ['add', '-A'], { cwd: dir });

  const msgFile = path.join(dir, 'MSG');
  writeFileSync(msgFile, `${message}\n`);

  const hookCopy = path.join(dir, 'commit-msg');
  writeFileSync(hookCopy, readFileSync(HOOK, 'utf8'));
  chmodSync(hookCopy, 0o755);

  const res = spawnSync('bash', [hookCopy, msgFile], { cwd: dir, encoding: 'utf8' });
  return { code: res.status, nudged: (res.stderr || '').includes("What's New") };
}

describe.skipIf(!hasBash)('What\'s New — commit-msg reminder', () => {
  const UI = ['src/pages/Foo.jsx'];

  it('reminds on a feature that changes a page', () => {
    expect(runHook('feat(ui): add thing', UI).nudged).toBe(true);
  });

  it('reminds on a fix that changes a page', () => {
    expect(runHook('fix: repair thing', UI).nudged).toBe(true);
  });

  it('reminds on a worker change', () => {
    expect(runHook('fix(api): repair endpoint', ['functions/api/thing.js']).nudged).toBe(true);
  });

  // Everything below asserts SILENCE. A reminder that fires constantly is one
  // people learn to scroll past.
  it('stays quiet for docs, tests and chores', () => {
    for (const msg of ['docs: update readme', 'test(db): add coverage', 'chore: bump dep', 'refactor: tidy']) {
      expect(runHook(msg, UI).nudged, msg).toBe(false);
    }
  });

  it('stays quiet when the commit already carries an entry', () => {
    expect(runHook('feat(ui): add thing',
      [...UI, 'src/data/changelog/2026-07-31-x.json']).nudged).toBe(false);
  });

  it('stays quiet for changes with no surface a person sees', () => {
    expect(runHook('feat(db): add table', ['supabase/migrations/x.sql']).nudged).toBe(false);
  });

  it('honours [skip changelog]', () => {
    expect(runHook('feat(ui): add thing\n\n[skip changelog]', UI).nudged).toBe(false);
  });

  it('never blocks a commit, in any case', () => {
    const cases = [
      ['feat(ui): add thing', UI],
      ['docs: whatever', UI],
      ['feat(db): add table', ['supabase/migrations/x.sql']],
      ['fix: thing', []],
    ];
    for (const [msg, staged] of cases) {
      expect(runHook(msg, staged).code, `${msg} must exit 0`).toBe(0);
    }
  });
});
