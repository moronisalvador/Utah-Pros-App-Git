/**
 * ════════════════════════════════════════════════
 * FILE: check-baseline-age.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The local practice database is built from saved copies of the real
 *   database's structure. Those copies go stale as the real one changes, and a
 *   stale copy is worse than a known gap — it gives a false sense of safety.
 *   This reports how old each saved copy is and warns loudly past a threshold.
 *   It only reads; it changes nothing and needs no credentials.
 *
 * WHERE IT LIVES:
 *   Triggered by:  `npm run db:baseline:age`, a warning-only CI step, and
 *                  scripts/db-local-bootstrap.mjs (imported).
 *
 * DEPENDS ON:
 *   Internal:  db/baseline/captured.json (the capture dates)
 *   Data:      reads → that file; writes → nothing
 *
 * NOTES / GOTCHAS:
 *   - ALWAYS EXITS 0 when the metadata is readable — it is a warning, not a
 *     gate, by design (the prompt for this work: "wire it into CI as a
 *     warning"). It exits 1 only when captured.json is missing or unreadable,
 *     because that means the staleness signal itself has been lost.
 *   - Emits GitHub `::warning::` annotations when run in CI so the warning is
 *     visible on the run without `continue-on-error` (a pattern this repo has
 *     been burned by — a green check that executed nothing).
 *   - The threshold is deliberately generous. The point is that a 3-month-old
 *     baseline gets NOTICED, not that a 5-week-old one blocks anyone. Live
 *     drift MEASUREMENT (object diffs) still needs live-catalog access:
 *     scripts/db-drift-check.sql + db-drift-check.mjs own that path; this
 *     covers the credential-free lanes where that path cannot run.
 * ════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CAPTURED = path.join(ROOT, 'db/baseline/captured.json');

export const STALE_AFTER_DAYS = 45;

/** @returns {{label: string, capturedAt: string, ageDays: number, stale: boolean}[]} */
export function baselineAges(now = new Date()) {
  const meta = JSON.parse(readFileSync(CAPTURED, 'utf8'));
  return ['schema', 'non_public'].map((key) => {
    const entry = meta[key];
    if (!entry?.captured_at) throw new Error(`captured.json is missing ${key}.captured_at`);
    const captured = new Date(`${entry.captured_at}T00:00:00-06:00`);
    if (Number.isNaN(captured.getTime())) throw new Error(`captured.json has an unreadable date for ${key}`);
    // Clamped: a same-day capture can read as "-1 days" from an earlier timezone.
    const ageDays = Math.max(0, Math.floor((now - captured) / 86_400_000));
    return { label: entry.file || key, capturedAt: entry.captured_at, ageDays, stale: ageDays > STALE_AFTER_DAYS, refresh: entry.refresh || '' };
  });
}

export function report({ ci = Boolean(process.env.GITHUB_ACTIONS) } = {}) {
  const ages = baselineAges();
  for (const a of ages) {
    const line = `${a.label}: captured ${a.capturedAt} (${a.ageDays} day${a.ageDays === 1 ? '' : 's'} ago)`;
    if (a.stale) {
      const warning = `${line} — STALE (>${STALE_AFTER_DAYS}d). Local proofs run against an old copy of production. Refresh: ${a.refresh}`;
      if (ci) console.log(`::warning title=db baseline is stale::${warning}`);
      console.warn(`  ⚠ ${warning}`);
    } else {
      console.log(`  ${line}`);
    }
  }
  return ages;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log('db baseline age:');
    report();
  } catch (error) {
    console.error(`check-baseline-age: ${error.message}`);
    process.exit(1);
  }
}
