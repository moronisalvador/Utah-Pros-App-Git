# Contractor upload portal — close the gaps

## Context

Utah Pros pays 13 subcontractors through Gusto ($163,122 YTD 2026) and holds insurance
certificates for three of them. **$118,983 — 73% of contractor spend — has no general liability
certificate on file.** The public upload portal is the intake path, and it was too hard to use:
the audience works from phones and several do not read English.

Work already landed in the working tree (uncommitted): es/pt translation, a workers-comp
either/or choice, staged-file upload, visible date labels, 48px targets, and a migration letting
documents arrive undated. A six-reviewer gauntlet then returned **45 findings**, including two
blockers that were my own errors and are already fixed (a privilege escalation, and a
`CREATE OR REPLACE` that created an overload instead of replacing).

This plan closes what remains. Full detail and raw findings:
- `docs/handoff/contractor-upload-continuation-2026-08-19.md`
- `docs/handoff/contractor-upload-gauntlet-findings-2026-08-19.json`

## The core problem: the feature is half-built

The migration relaxes the database so a coverage document may arrive undated, but nothing else
delivers it. `ContractorUpload.jsx` still gates `canSend` on both dates, and `ContractorDetail.jsx`
sends none on Accept. **Shipping the current state gives the risk of a schema change with none of
the benefit.** Either complete all four layers or drop the migration.

---

## Phase 1 — Blocker + majors on the public page

`src/pages/ContractorUpload.jsx` unless noted.

1. **Toasts are no-ops (BLOCKER).** Verified: the route is bare at `App.jsx:663`; the only
   `upr:toast` listeners are `Layout.jsx:118` and `TechLayout.jsx:430`. A failed upload is
   currently silent, and the rewrite removed the old flow's compensating file-clear.
   → Add an in-page `<p role="status" aria-live="polite">` driven by `upload.isError` /
   `upload.isSuccess`. Keep `ok`/`err` for other surfaces.

2. **Use `useLanguage()` instead of the hand-rolled switcher.** Verified: `LanguageProvider`
   wraps `BrowserRouter` at `App.jsx:1002`, so it IS available here — the file header says
   otherwise and must be corrected. `setLang` (`LanguageContext.jsx:84`) already orders
   `ensureLanguage` before `changeLanguage`, persists the choice, and sets
   `document.documentElement.lang` (fixes WCAG 3.1.1/3.1.2). Delete local `lang` state and
   `pickLanguage`.

3. **StatusPill must stop claiming "Sent"** on a mere workers-comp selection — flagged by four
   reviewers independently. Keep `wcChooseOne` until chosen, then `requestedPill`.

4. **Don't blank the page on a failed refetch.** react-query v5 retains `data`, so
   `request.error` is truthy after a post-upload refetch or reconnect.
   → `if (!token || (request.isError && !request.data))`.

5. **`queryKey: ['contractor-upload', token]`** — queries persist 24h, so a second link on the
   same device currently renders the first request's document list and expiry.

6. **Per-card busy state** — `const busy = upload.isPending && upload.variables?.documentType === type`.

7. **Accessibility on Send** — `aria-disabled` + `aria-describedby` instead of `disabled` (which
   drops it from the tab order), and a distinct message for end-before-start rather than
   "Add both dates".

8. **`retryLabel`** — add a `retry` key to all three locales; it currently reads "Send this document".

9. **Minors:** `remaining` over-counts when the workers-comp pair collapses; `--accent-soft` is
   undefined (use `--accent-light`, 52 existing uses); prefer the translated `uploadFailed` over
   raw English server text; drop the dead `data.closed` branch.

**Deferred deliberately:** swapping the language bar to `.ui-seg`. The primitive defaults to 11px,
this audience needs 44px targets, and the override would fight it. Revisit with a size variant.

## Phase 2 — Complete the reviewer-dates feature

1. `ContractorUpload.jsx` — let Send proceed with no dates (keep them optional, not required).
2. `functions/api/contractor-compliance-requests.js:42` — pass `p_coverage_start_date` /
   `p_coverage_end_date` through to the RPC.
3. `src/pages/ContractorDetail.jsx:45` — two date inputs on the Accept action, required for
   non-W-9 documents (the RPC already refuses otherwise with `22023`).
4. Extend `tests/qa/unit/contractor-compliance-reviewer-supplied-dates.test.js` to cover the
   worker and reviewer call shapes.

The migration itself is already authored and corrected — no further SQL work.

## Verification

```bash
npm run build                      # clean
npm test                           # unit 1941 / worker 2460 / qa 2186+
npx eslint <changed files>         # 0 errors; 2 pre-existing date-input warnings only
node scripts/check-migration-hygiene.mjs
```

Then the close-out items this diff triggers:
- **390px viewport** check of the upload page in both languages.
- **Minimize/resume test** — background 30s, confirm no blank, no lost staged file, no lost dates.
- **Re-run the gauntlet** via
  `/private/tmp/claude-501/-Users-moroni/0b18d00a-7899-4db9-af1e-8d420f810d97/scratchpad/gauntlet-real.js`
  (the committed `close-out-gauntlet.js` returns `pass` when its agents fail to launch — it did
  exactly that here; worth a `reviewersRan === reviewersExpected` assertion as a separate fix).

**Cannot be verified locally:** the rendered page. `/api/*` needs `wrangler pages dev`, and the
live portal runs deployed code. I will not claim visual confirmation without it.

## Gates — unchanged, each a separate owner action

- **Applying the migration** (`AGENTS.md` authority boundary). Nothing has touched a database.
- **Commit/push.** The tree also holds other sessions' work — stage by explicit path.
- The db-lane behavioural proof for the migration is still unwritten; the contract test proves
  intent, not effect.
- **Native es/pt review.** The translations are mine, not a native speaker's — worth two minutes
  from Marcelo, Bispo or Ramos before this reaches nine contractors.

## Open decisions for you

1. **Token in `sessionStorage`?** The mount effect strips the URL hash, so an iOS tab discard
   loses the token permanently and the contractor sees "link unavailable" mid-flow.
2. **Project real `closed` state** from the worker (`contractor-compliance-public.js:50` hardcodes
   `closed: false`), or delete the dead branch? Today a paused request gets the harsher
   "link unavailable" message while a gentler translated one sits unreachable.
