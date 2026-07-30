/**
 * LES-01 — an outage must never render as an empty result.
 *
 * `.claude/rules/loading-error-states.md` §1: "A failed load NEVER renders the
 * success empty-state or a blank page... Every load() catch either sets a
 * loadError state or toasts — it must not fall through to the empty-state
 * render."
 *
 * `db.select` / `db.rpc` THROW on any non-OK response (400/404/500) — they do
 * not resolve to `[]`. So an inline `.catch(() => [])` on a read converts a real
 * outage into a successful-looking EMPTY result. Across 18 files that produced,
 * among others: "No appointments" and "No photos or notes yet" on a tech's job
 * screen, a FALSE "no signed Work Authorization" compliance banner, an
 * all-unchecked permission matrix, a template editor showing built-in defaults
 * as if they were the saved copy, and an emptied email-campaign exclusion list
 * that a subsequent save would have written back as "exclude nobody".
 *
 * Three swallows survive on purpose. They are pinned by name below, with the
 * reason, so that "we decided to keep this" stays distinguishable from "nobody
 * looked" — which is the whole point of the rule.
 *
 * Source-contract assertions — this lane runs `node` with no jsdom, so none of
 * these pages can be rendered. The guards read the shipped source instead.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = join(import.meta.dirname, '../../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/**
 * Strip comment lines before matching. Every fix in this change ships a comment
 * QUOTING the `.catch(() => [])` it removed, so a naive substring match would
 * report the cure as the disease.
 *
 * Line-oriented on purpose: a regex sweep for block-comment delimiters also
 * matches inside string literals — these pages are full of `'image/[star]'` —
 * and one unbalanced match silently eats hundreds of real lines, which is
 * exactly the kind of false pass this file exists to prevent.
 */
const code = (src) => {
  const out = [];
  let inBlock = false;
  for (const raw of src.split('\n')) {
    const l = raw.trim();
    if (inBlock) {
      if (l.includes('*/')) inBlock = false;
      continue;
    }
    if (l.startsWith('//')) continue;
    if (l.startsWith('/*') || l.startsWith('{/*') || l.startsWith('*')) {
      if (!l.includes('*/')) inBlock = true;
      continue;
    }
    out.push(raw);
  }
  return out.join('\n');
};

// ─── The three deliberate survivors ──────────────
// Each is a real decision, not a default. If one of these lines moves or its
// justification stops holding, this list is where that gets renegotiated.
const ALLOWED_SWALLOWS = [
  {
    file: 'src/components/NewEstimateModal.jsx',
    why: 'recovery probe inside the duplicate-phone handler; an empty result falls through to an explicit message and rethrows',
  },
  {
    file: 'src/components/admin-mobile/estimate/EstimateCreateForm.jsx',
    why: 'same duplicate-phone recovery probe as NewEstimateModal',
  },
  {
    file: 'src/pages/DevTools.jsx',
    why: 'per-job read in a developer-only diagnostic tree; one bad job must not blank the whole claim',
  },
];

/**
 * Emits POSIX-separated repo-relative paths on every platform. `relative()`
 * yields `src\components\...` on Windows, so comparing it against the
 * forward-slash ALLOWED_SWALLOWS literals asserted on separators rather than on
 * content: green on CI's Linux, permanently red on the owner's machine. A test
 * that is only green on CI teaches people to ignore local failures, which is
 * worse than the test not existing. Same normalisation as
 * mobile-employee-identity-authority.test.js and field-surface-invariants.test.js.
 */
const jsxFiles = (dir) => {
  const out = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const abs = join(ROOT, dir, name);
    if (statSync(abs).isDirectory()) out.push(...jsxFiles(join(dir, name)));
    else if (name.endsWith('.jsx')) out.push(relative(ROOT, abs).split(sep).join('/'));
  }
  return out;
};

describe('LES-01 — repo-wide swallow inventory', () => {
  it('leaves exactly the three documented swallows and no others', () => {
    const found = jsxFiles('src').filter((f) => code(read(f)).includes('catch(() => [])'));
    expect(found.sort()).toEqual(ALLOWED_SWALLOWS.map((a) => a.file).sort());
  });

  it('keeps a justification beside every surviving swallow', () => {
    for (const { file } of ALLOWED_SWALLOWS) {
      // The marker is what makes the survivor auditable rather than inherited.
      expect(read(file), `${file} keeps a swallow with no LES-01 triage note`).toContain('LES-01 triage — KEEP');
    }
  });
});

describe('LES-01 — TechJobDetail (five swallows in one Promise.all)', () => {
  const src = read('src/pages/tech/TechJobDetail.jsx');
  const body = code(src);

  it('lets all five job reads reject into the outer catch', () => {
    for (const call of [
      "db.rpc('get_job_contacts'",
      "db.select('claims'",
      "db.rpc('get_claim_appointments'",
      "db.select('job_documents'",
      "db.select('sign_requests'",
    ]) {
      const i = body.indexOf(call);
      expect(i, `${call} is gone from TechJobDetail`).toBeGreaterThan(-1);
      // The swallow, if reintroduced, sits on the same statement as the call.
      const stmt = body.slice(i, body.indexOf('\n', i) + 1);
      expect(stmt, `${call} still swallows its failure`).not.toContain('catch(() => [])');
    }
  });

  it('commits `job` only after every read resolves', () => {
    // Committing `setJob` before the Promise.all let a cold-load partial failure
    // slip past the `if (!job)` error gate and render a page of false empties.
    expect(body.indexOf('await Promise.all')).toBeLessThan(body.indexOf('setJob(j)'));
  });

  it('separates "do not re-gate the page" from "do not report the failure"', () => {
    expect(body).toContain('async ({ silent = false, quiet = false } = {})');
    // The failure report is gated on `quiet` ALONE. Gating it on `silent` would
    // silence pull-to-refresh, which is silent by law (loading-error-states §6)
    // and must still tell the tech when a refresh failed.
    expect(body).toContain('if (quiet) return;');
    expect(body).not.toContain('if (silent) return;');
    expect(body).not.toContain('if (!silent) toast');
  });

  it('keeps pull-to-refresh loud and post-mutation reloads quiet', () => {
    // PTR: a gesture the tech chose — silence would leave them pulling against a
    // dead connection with no explanation.
    expect(body).toContain('onRefresh={() => load({ silent: true })}');
    expect(body).not.toContain('onRefresh={() => load({ silent: true, quiet: true })}');
    // Upload and save-note already reported their own outcome.
    expect(body.match(/load\(\{ silent: true, quiet: true \}\)/g) || []).toHaveLength(2);
  });

  it('never shows a tech a raw PostgREST error', () => {
    expect(body).toContain("console.error('TechJobDetail load failed:'");
  });
});

describe('LES-01 — TechJobDocuments (one swallow behind five call sites)', () => {
  const src = read('src/pages/tech/TechJobDocuments.jsx');
  const body = code(src);

  it('lets the sign_requests read reject', () => {
    const i = body.indexOf("db.select('sign_requests'");
    expect(i).toBeGreaterThan(-1);
    expect(body.slice(i, body.indexOf('\n', i) + 1)).not.toContain('catch(() => [])');
  });

  it('routes resume and post-mutation refreshes through a non-blanking wrapper', () => {
    // A bare `loadRequests()` from the resume listener would now be an unhandled
    // rejection; via refreshRequests the already-visible rows survive.
    expect(body).toContain('const refreshRequests = useCallback');
    // The resume path moved from a hand-rolled visibilitychange listener to the
    // shared hook (page-lifecycle.md §2, LIFECYCLE-RESUME). What this test
    // actually guards is unchanged: resume must call the NON-throwing wrapper,
    // never loadRequests directly.
    expect(body).toContain('useResumeRefetch({ onResume: refreshRequests })');
    expect(body).not.toContain("document.addEventListener('visibilitychange'");
    expect(body).toContain('onSent={refreshRequests}');
    // Only the cold load may call the throwing version directly.
    expect(body.match(/\bloadRequests\(\)/g) || []).toHaveLength(2); // refreshRequests + cold load
  });

  it('commits `job` only after the requests read resolves', () => {
    expect(body.indexOf('await loadRequests();')).toBeLessThan(body.indexOf('setJob(j);'));
  });
});

describe('LES-01 — the remaining tech surfaces', () => {
  it('TechAppointment cannot render a false Work Authorization banner', () => {
    const body = code(read('src/pages/tech/TechAppointment.jsx'));
    const i = body.indexOf("db.select('sign_requests'");
    expect(i).toBeGreaterThan(-1);
    expect(body.slice(i, body.indexOf('\n', i) + 1)).not.toContain('catch(() => [])');
    // A failed check must leave the previous value standing, not assert "unsigned".
    expect(body).toContain('setWorkAuthSigned(jobId ? (wa || []).length > 0 : true)');
    // Pull-to-refresh keeps its toast; the four mutation reloads do not.
    expect(body).toContain('onRefresh={() => load()}');
    expect(body.match(/load\(\{ quiet: true \}\)/g) || []).toHaveLength(4);
  });

  it('TechClaimDetail commits the whole claim or none of it', () => {
    const body = code(read('src/pages/tech/TechClaimDetail.jsx'));
    for (const call of [
      "db.rpc('get_claim_appointments'",
      "db.rpc('get_claim_rooms'",
      "db.rpc('get_claim_demo_sheets'",
      "db.select('job_documents'",
    ]) {
      const i = body.indexOf(call);
      expect(i, `${call} is gone`).toBeGreaterThan(-1);
      expect(body.slice(i, body.indexOf('\n', i) + 1), call).not.toContain('catch(() => [])');
    }
    // The per-job task summary keeps its own catch: one bad job degrades to a
    // missing count rather than blanking the claim.
    expect(body).toContain('.catch(() => [id, null])');
    expect(body.indexOf('setDetail(data);')).toBeGreaterThan(body.indexOf("db.select('job_documents'"));
  });

  for (const [file, calls] of [
    ['src/pages/tech/TechJobAlbum.jsx', ["db.select('job_documents'"]],
    ['src/pages/tech/TechClaimAlbum.jsx', ["'job_documents',"]],
    ['src/pages/tech/TechRoomDetail.jsx', ["db.rpc('get_claim_rooms'", "'job_documents'"]],
  ]) {
    it(`${file.split('/').pop()} keeps a loaded grid on a failed reload`, () => {
      const body = code(read(file));
      for (const call of calls) {
        const i = body.indexOf(call);
        expect(i, `${call} is gone from ${file}`).toBeGreaterThan(-1);
        expect(body.slice(i, body.indexOf('\n', i) + 1), call).not.toContain('catch(() => [])');
      }
      expect(body).toContain('async ({ silent = false, quiet = false } = {})');
      expect(body).toContain('if (quiet) return;');
      // The post-upload reload is the one that used to wipe the grid.
      expect(body).toContain('load({ silent: true, quiet: true })');
    });
  }
});

describe('LES-01 — settings surfaces', () => {
  it('Roles never renders an all-unchecked permission matrix over an outage', () => {
    const body = code(read('src/pages/settings/Roles.jsx'));
    const i = body.indexOf("db.select('nav_permissions'");
    expect(i).toBeGreaterThan(-1);
    expect(body.slice(i, body.indexOf('\n', i) + 1)).not.toContain('catch(() => [])');
    expect(body).toContain("setError('Failed to load permissions')");
  });

  it('TemplatesEditor cannot open built-in defaults as if they were saved', () => {
    const body = code(read('src/pages/settings/TemplatesEditor.jsx'));
    const i = body.indexOf("db.rpc('get_document_templates')");
    expect(i).toBeGreaterThan(-1);
    expect(body.slice(i, body.indexOf('\n', i) + 1)).not.toContain('catch(() => [])');
    // `initialSections` must stay null on failure, so the editor cannot save
    // defaults over a template it never read — and the failure must render as an
    // error, not sit on <TabLoading/> forever.
    expect(body).toContain('if (loadError) {');
    expect(body).toContain('setLoadError(');
    // Rule 2: feedback goes through lib/toast, never a raw upr:toast dispatch.
    expect(body).toContain("from '@/lib/toast'");
    expect(body).not.toContain("new CustomEvent('upr:toast'");
  });

  it('Templates reports a failed override read', () => {
    const body = code(read('src/pages/settings/Templates.jsx'));
    const i = body.indexOf("db.rpc('get_document_templates')");
    expect(i).toBeGreaterThan(-1);
    expect(body.slice(i, body.indexOf('\n', i) + 1)).not.toContain('catch(() => [])');
    expect(body).toContain("from '@/lib/toast'");
  });

  it('MyAccount never reports a live Google connection as "Not connected"', () => {
    const body = code(read('src/pages/settings/MyAccount.jsx'));
    for (const call of ["db.rpc('get_google_drive_status')", "db.rpc('get_google_calendar_status')"]) {
      const i = body.indexOf(call);
      expect(i, `${call} is gone`).toBeGreaterThan(-1);
      expect(body.slice(i, body.indexOf('\n', i) + 1), call).not.toContain('catch(() => [])');
    }
    expect(body).toContain('if (loadError) {');
  });

  it('ListsAndValues distinguishes an empty list from an unreadable one', () => {
    const body = code(read('src/pages/settings/ListsAndValues.jsx'));
    const i = body.indexOf('db.rpc(list.getRpc)');
    expect(i).toBeGreaterThan(-1);
    expect(body.slice(i, body.indexOf('\n', i) + 1)).not.toContain('catch(() => [])');
    expect(body).toContain('if (loadError && items.length === 0) {');
    // Rule 2: the local errToast copy is gone.
    expect(body).not.toContain("new CustomEvent('upr:toast'");
  });
});

describe('LES-01 — CRM surfaces', () => {
  it('a failed exclusions read cannot wipe a campaign suppression list', () => {
    const body = code(read('src/pages/crm/CrmCampaigns.jsx'));
    const i = body.indexOf("db.rpc('get_campaign_exclusions'");
    expect(i).toBeGreaterThan(-1);
    expect(body.slice(i, body.indexOf('\n', i) + 1)).not.toContain('catch(() => [])');
    // `saveCampaign` writes exclusions only when `audienceRows !== null`, so the
    // failure path MUST reset to null rather than to an empty audience — an empty
    // audience would let the next save persist "exclude nobody".
    expect(body).toContain('if (audienceRows !== null) {');
    const start = body.indexOf('const startEdit');
    const seg = body.slice(start, body.indexOf('const cancelEdit', start));
    expect(seg).toContain('resetAudience();');
    expect(seg).not.toContain('setAudienceRows([]);');
  });

  for (const [file, rpc, label] of [
    ['src/pages/crm/CrmAutomations.jsx', "db.rpc('get_sequences', {})", 'sequence picker'],
    ['src/pages/crm/CrmSequences.jsx', "db.rpc('get_segments', {})", 'segment picker'],
    ['src/pages/crm/CrmCampaigns.jsx', "db.rpc('get_referral_sources', {})", 'referral filter'],
  ]) {
    it(`${label} stays resilient but no longer fails silently`, () => {
      // These secondary lookups KEEP a catch on purpose — one missing grant must
      // not blank the page's primary list. What §1 requires is that the failure
      // be reported, so an empty picker is never read as "none exist".
      const body = code(read(file));
      const i = body.indexOf(rpc);
      expect(i, `${rpc} is gone from ${file}`).toBeGreaterThan(-1);
      const stmt = body.slice(i, body.indexOf('\n', i) + 1);
      expect(stmt, 'the failure is captured, not discarded').not.toContain('catch(() => [])');
      expect(stmt).toContain('Error = e;');
      expect(body).toContain('could not be loaded');
    });
  }

  it('DevTools tells "empty" apart from "not allowed to look"', () => {
    const body = code(read('src/pages/DevTools.jsx'));
    const i = body.indexOf("db.select(table, 'select=*&order=created_at.desc&limit=5')");
    expect(i).toBeGreaterThan(-1);
    expect(body.slice(i, body.indexOf('\n', i) + 1)).not.toContain('catch(() => [])');
    expect(body).toContain('Could not read rows:');
    // The old copy hedged because the swallow made the two indistinguishable.
    expect(body).not.toContain('Table is empty or not accessible via REST.');
  });
});
