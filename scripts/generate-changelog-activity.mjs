/**
 * ════════════════════════════════════════════════
 * FILE: generate-changelog-activity.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Reads the project's own commit history and turns it into a simple,
 *   week-by-week list of what changed, which the "What's New" page shows to
 *   the team. It only keeps the commits that describe a new feature, a bug
 *   fix, or a speed improvement — the bookkeeping ones (docs, tests, chores)
 *   are left out because nobody outside the dev work needs to read them.
 *   Nothing here is written by hand: run the script and the file rebuilds.
 *
 * WHERE IT LIVES:
 *   Run via:  npm run generate:changelog
 *   Writes:   src/data/changelog-activity.json  (GENERATED — never hand-edit)
 *
 * DEPENDS ON:
 *   Packages:  node:child_process, node:fs, node:path, node:url
 *   Internal:  none (git is the only input)
 *   Data:      reads  → git log
 *              writes → src/data/changelog-activity.json
 *
 * NOTES / GOTCHAS:
 *   - Weeks bucket on America/Denver Mondays, matching the house timezone rule
 *     in .claude/rules/database-standard.md §7. Never UTC, never server-local.
 *   - This is the AUTOMATIC tier of the What's New page. It needs no session
 *     discipline: if nobody writes a curated highlight, this still renders.
 *     That is deliberate — the page degrades to less detail, never to blank.
 *   - Merge commits are excluded (--no-merges); they duplicate work already
 *     counted on the branch that did it.
 *   - Output is sorted newest-week-first and is fully deterministic for a
 *     given commit range, so re-running with no new commits produces no diff.
 * ════════════════════════════════════════════════
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'src/data/changelog-activity.json');

/** Earliest week the team page shows. Owner decision 2026-07-31: July onward. */
const SINCE = '2026-07-01';

/** Commit types that represent user-visible change. Everything else is noise. */
const KINDS = { feat: 'New', fix: 'Fixed', perf: 'Faster' };

/**
 * Conventional-commit scope → the name a non-developer would recognise.
 *
 * Ordered prefix rules, first match wins. Prefixes rather than exact keys
 * because scopes in this repo carry initiative/phase suffixes that are
 * meaningless to the team — `crm 4d`, `admin mobile·P4a`, `notify f2` all
 * need to collapse into their parent area. An exact-key map produced 80
 * "areas" including `Css`, `Devtools` and `Crm 6b`, which is noise, not
 * navigation.
 *
 * Anything unmatched lands in Platform (internal plumbing) rather than being
 * title-cased into a fake category. A genuinely new product area shows up as
 * Platform until someone adds a rule — under-classifying is recoverable,
 * inventing categories is not.
 */
const AREA_RULES = [
  [/^(billing|qbo|collections?|estimates?|invoices?|payments?|stripe|job.?costing)/, 'Billing'],
  [/^(notif|notify|web.?push|push)/, 'Notifications'],
  [/^crm/, 'CRM'],
  [/^(messag|sms|esign|e-?mail|twilio|callrail|conversations?|consent|omni)/, 'Messaging'],
  [/^(schedul|sched|appointments?|dispatch|timesheet|time|status.?board|crons?)/, 'Scheduling'],
  [/^(tech|demo.?sheet|scope.?sheet|oop|feedback|pickers?)/, 'Field App'],
  [/^(ios|native|pwa|mobile|admin.?mobile|capacitor)/, 'Mobile App'],
  [/^(dashboard|overview|reports?)/, 'Dashboard'],
  [/^(claims?|jobs?|customers?|encircle|homebuilding)/, 'Claims & Jobs'],
  [/^(nav|ux|ui|design|layout|css|motion|a11y|keyboard|states?|lifecycle|interface|templates?|roadmap|figma)/, 'Interface'],
  [/^i18n/, 'Translations'],
  [/^(settings?|permissions?|team|privacy|auth|access|roles?)/, 'Settings & Access'],
];

const areaFor = scope => {
  if (!scope) return 'General';
  // Normalise the phase decorations this repo puts in scopes: `crm-partner`,
  // `admin mobile·P4a`, `tech-v2 sched` all reduce to plain lowercase words.
  const key = scope.trim().toLowerCase().replace(/[·_/-]+/g, ' ').replace(/\s+/g, ' ');
  for (const [pattern, area] of AREA_RULES) {
    if (pattern.test(key)) return area;
  }
  return 'Platform';
};

/** Denver-local YYYY-MM-DD for an ISO instant. */
const denverDay = iso =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Denver',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso));

/** The Monday (Denver) that owns a given YYYY-MM-DD. */
const weekStart = day => {
  const [y, m, d] = day.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  const shift = (utc.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  utc.setUTCDate(utc.getUTCDate() - shift);
  return utc.toISOString().slice(0, 10);
};

const addDays = (day, n) => {
  const [y, m, d] = day.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + n);
  return utc.toISOString().slice(0, 10);
};

/**
 * Turn "fix(qbo): contain receipt service grants" into
 * "Contain receipt service grants". Commit subjects stay developer-shorthand;
 * this only makes them presentable, it does not pretend to translate them.
 * That is what the curated highlight tier is for.
 */
const cleanSubject = subject => {
  const body = subject.replace(/^[a-z]+(\([^)]*\))?!?:\s*/, '').trim();
  return body.charAt(0).toUpperCase() + body.slice(1);
};

/**
 * Every commit reachable from origin/main — i.e. everything actually deployed
 * to utahpros.app. Used to mark each change live-in-production versus still on
 * dev behind the promotion hold.
 *
 * This exists because the page's whole purpose is credibility with the team: a
 * feature listed as shipped that they cannot actually use costs more trust than
 * it buys.
 *
 * Returns null when origin/main cannot be resolved (shallow CI clone, fresh
 * checkout). Callers then omit the flag entirely rather than guessing — an
 * absent badge is honest, a wrong one is not.
 */
function productionCommits() {
  try {
    const raw = execFileSync('git', ['rev-list', 'origin/main'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const set = new Set(raw.split('\n').filter(Boolean).map(s => s.slice(0, 7)));
    return set.size > 0 ? set : null;
  } catch {
    console.warn('changelog activity: origin/main unavailable — omitting live badges');
    return null;
  }
}

function readCommits() {
  const shipped = productionCommits();
  const SEP = '\u001f'; // ASCII unit separator; cannot occur in a subject
  const raw = execFileSync(
    'git',
    ['log', '--no-merges', `--since=${SINCE}`, `--format=%H${SEP}%aI${SEP}%s`],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );

  const pattern = /^(feat|fix|perf)(\(([^)]*)\))?!?:\s+/;
  const out = [];

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const [sha, authored, ...rest] = line.split(SEP);
    const subject = rest.join(SEP);
    const match = pattern.exec(subject);
    if (!match) continue;

    const short = sha.slice(0, 7);
    const item = {
      sha: short,
      day: denverDay(authored),
      kind: KINDS[match[1]],
      area: areaFor(match[3]),
      text: cleanSubject(subject),
    };
    // Omitted entirely when origin/main is unresolvable, so the UI can tell
    // "not yet in production" apart from "we could not determine it".
    if (shipped) item.live = shipped.has(short);
    out.push(item);
  }
  return out;
}

function build(commits) {
  const weeks = new Map();

  for (const c of commits) {
    const start = weekStart(c.day);
    if (!weeks.has(start)) {
      weeks.set(start, { start, end: addDays(start, 6), items: [] });
    }
    weeks.get(start).items.push(c);
  }

  const ordered = [...weeks.values()].sort((a, b) => b.start.localeCompare(a.start));

  for (const week of ordered) {
    // Newest first inside the week, then by sha so ties are deterministic.
    week.items.sort((a, b) => b.day.localeCompare(a.day) || a.sha.localeCompare(b.sha));
    week.count = week.items.length;
    week.areas = [...new Set(week.items.map(i => i.area))].sort();
    week.testing = week.items.filter(i => i.live === false).length;
  }

  return {
    _generated: 'npm run generate:changelog — do not hand-edit',
    since: SINCE,
    totals: {
      changes: commits.length,
      weeks: ordered.length,
      areas: [...new Set(commits.map(c => c.area))].sort().length,
      testing: commits.filter(c => c.live === false).length,
    },
    weeks: ordered,
  };
}

const data = build(readCommits());
const next = `${JSON.stringify(data, null, 2)}\n`;
const prev = existsSync(OUT) ? readFileSync(OUT, 'utf8') : null;

if (prev === next) {
  console.log(`changelog activity: already current (${data.totals.changes} changes, ${data.totals.weeks} weeks)`);
} else {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, next);
  console.log(`changelog activity: wrote ${data.totals.changes} changes across ${data.totals.weeks} weeks -> src/data/changelog-activity.json`);
}
