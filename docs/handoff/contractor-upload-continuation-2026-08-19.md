# Contractor upload portal — continuation handoff (2026-08-19, Phases 1 & 2 COMPLETE)

**Status:** working tree only. Nothing committed, nothing applied, nothing deployed.
Plan: [`contractor-upload-plan-2026-08-19.md`](./contractor-upload-plan-2026-08-19.md) ·
raw findings: [`contractor-upload-gauntlet-findings-2026-08-19.json`](./contractor-upload-gauntlet-findings-2026-08-19.json)

## Why this work exists

Owner-directed. Gusto carries **13 contractors and $163,122 paid YTD 2026**, and UPR holds
insurance certificates for **three** of them. **$118,983 — 73% of contractor spend — has no
general liability certificate on file.** The portal is the intake path, and it was too hard to
use: most of these contractors work from a phone and several do not read English.

## Gates

| | |
|---|---|
| build | clean |
| unit / worker / qa | **1941 / 2461 / 2200** |
| migration hygiene | 322 migrations, 67 checked, **0 failures** |
| eslint (changed files) | **0 errors**; 4 `upr/no-native-date-input` warnings = exactly the recorded baseline (2 per file) |
| `src/index.css` | untouched, 567,609 / 595,000 |

## The feature is now COMPLETE across all layers

The earlier state shipped a migration that relaxed the database while nothing else delivered the
benefit. That is closed. **The plan said four layers; there were five** — `validateDocumentDates`
in `functions/lib/contractor-compliance.js` hard-rejected missing dates, so the Worker would have
returned 400 even after the UI allowed the send.

1. **Migration** `20260819010000` — dates optional at intake, still required to accept. *(unchanged)*
2. **`functions/lib/contractor-compliance.js`** — both dates absent is now valid; one without the
   other is still refused, matching the CHECK constraint. W-9 still requires a tax year.
3. **`ContractorUpload.jsx`** — Send proceeds with no dates; the field is labelled optional.
4. **`functions/api/contractor-compliance-requests.js`** + `api.js` — reviewer dates forwarded to
   the six-argument RPC, shape-checked so a malformed value is a 400 not a 500.
5. **`ContractorDetail.jsx`** — `DatePicker` inputs on the Accept action, pre-filled from the row,
   required for non-W-9, Accept disabled until both are present and ordered.

## Phase 1 findings — all closed

- **Toasts were no-ops (BLOCKER).** `/contractor-upload` is registered bare at `App.jsx:663`;
  the only `upr:toast` listeners are `Layout.jsx:118` and `TechLayout.jsx:430`, so a failed upload
  was silent. Now an in-page `role="status" aria-live="polite"` region.
- **`useLanguage()`** replaces the hand-rolled switcher. `LanguageProvider` wraps the router at
  `App.jsx:1002`, so it was always available — the old file header claimed otherwise and was
  wrong. This also sets `document.documentElement.lang` (WCAG 3.1.1/3.1.2).
- **StatusPill** no longer flips to "Sent" on a mere workers-comp selection.
- **A failed refetch no longer blanks the page** — gated on `isError && !data`.
- **Per-card busy state**, `aria-disabled`/`aria-describedby` on Send, a distinct
  end-before-start message, a `retry` key, and a `needFile` hint.
- **`remaining`** counts the workers-comp pair once.
- **`--accent-soft`** (undefined) → `--accent-light` (50 existing uses).
- The dead `data.closed` branch is gone (`contractor-compliance-public.js:50` hardcodes `false`).

### One gauntlet finding was RIGHT about the bug and WRONG about the fix

It called for `queryKey: ['contractor-upload', token]`. A contract test named *"keeps raw public
token out of URL/cache keys"* pinned the opposite, deliberately: `main.jsx` persists the query
cache for **24 hours**, and `techQuery.js`'s `shouldDehydrateQuery` filtered only messaging keys —
so putting the token in the key would have **written the raw capability token to disk**, undoing
the page's URL-strip, its header-not-URL transport and `no-referrer`, for an audience that
routinely uses a shared or hand-me-down phone.

Fixed both ways instead: the token **is** in the key (so a second link on one phone cannot render
the first request's data) **and** `techQuery.js` now refuses to dehydrate any `contractor-upload`
query. That also closes the separate minor finding that the public projection was persisted 24h
despite the Worker's `Cache-Control: no-store`. The contract test now asserts both halves.

## Still open

- **Applying the migration is a separate owner action, every time** (`AGENTS.md`).
- Not committed. Stage by explicit path — the tree may hold other sessions' work.
- The db-lane behavioural proof is NOT written; the contract test proves intent, not effect
  (`close-out-standard.md` 2b).
- **Not verifiable locally, and not claimed:** the rendered page. `/api/*` needs
  `wrangler pages dev`, so the 390px viewport pass and the minimize/resume test are unrun.
- **Native es/pt review.** The translations are mine, not a native speaker's.
- Owner decision still open: **token in `sessionStorage`?** The mount effect strips the hash, so an
  iOS tab discard loses it permanently. Deliberately NOT done here — it is the same
  secret-to-storage tradeoff as the cache-key finding above.
- `.claude/workflows/close-out-gauntlet.js` returns `verdict: "pass"` when its agents fail to
  launch (`agents_done: 0`). It needs a `reviewersRan === reviewersExpected` assertion.
