# Cold-session prompt — four office surfaces, built natively

Owner-requested 2026-08-07. Paste the block below into a fresh session. It is
deliberately self-contained: it carries the facts the e-sign session paid for so
the next one does not rediscover them, or repeat its build-target mistake.

Companion handoff: [`session-state-2026-08-07-esign.md`](session-state-2026-08-07-esign.md).

---

```
/masterplan

Build four office surfaces natively inside the UPR iOS app: an admin Dashboard,
Collections, New Estimate, and Lead Center. Restricted to admin / office /
project_manager. Nothing changes for a field tech.

STUDY BEFORE YOU PROPOSE ANYTHING. Do not write code, do not edit files, and do
not propose a design until you can answer, from the real repository and the live
catalog, the questions in "What I need you to establish" below. I want a
masterplan with an evidence ledger, not an implementation that starts on turn
two. Read both sides — the backend RPCs and their grants AND the frontend that
would consume them.

## The decision already made (do not re-litigate)

- Four screens: Dashboard (admin), Collections, New Estimate, Lead Center.
- BUILT NATIVELY, inside the existing tech shell. Do NOT port the desktop pages.
  The office Dashboard chunk alone is ~114 KB raw and drags charting plus
  billing reads with it. Native screens read the same RPCs and stay lean.
- Visible only to admin / office / project_manager. A field tech's app must look
  exactly as it does today. Company revenue, A/R and the sales pipeline do not
  belong on a field device.

## Context you are inheriting (verified 2026-08-07, do not re-derive)

THE BUILD TARGET TRAP — the previous session got caught by this; do not repeat it.
- `npm run build` produces the WEB bundle. `npm run build:ios` produces the
  native one (`build:native` + `sync:ios`).
- A web bundle inside the native shell sets IS_NATIVE_BUILD=false, silently
  kills deep links, and ships the whole office/CRM/admin surface. Nothing
  reports it at runtime — you find out by looking at the screen.
- `scripts/assert-native-dist.mjs` guards this, and it now also runs as a
  `capacitor:copy:before` package.json hook, so bare `npx cap sync ios` is
  blocked too. Known gap: `cap sync` still exits 0 when its copy fails.
- `ios/App/App/public` is gitignored, so nothing downstream catches a bad bundle.

THE NATIVE BOUNDARY — this is what you are modifying, carefully.
- `src/routes/buildTargetPages.native.jsx` is an explicit allowlist. Its header:
  "Office, CRM, desktop settings, QuickBooks, and admin-mobile screens have no
  import path from this file."
- `vite.config.js` → `nativeBundleBoundaryPlugin` + `scripts/native-bundle-boundary.mjs`
  independently reject a forbidden page even via an accidental transitive import.
- `tests/qa/unit/native-bundle-boundary.test.js` pins it (7 tests, currently green).
- Measured: native app = 94 chunks, web = 230. Dashboard / Collections /
  CrmLeads / InvoiceEditor chunks are genuinely ABSENT from the native app.
- Precedent for widening: the QBO receive-payment work took a "bounded registry
  exception" with a named four-module NATIVE_COLLECTIONS_ALLOWLIST carve-out.
  Follow that shape rather than opening the allowlist generally.

WHAT ALREADY EXISTS — finish these rather than building parallel paths.
- `src/pages/tech/TechMore.jsx` already renders Collections, Time Tracking,
  Checklists and Scope Sheet Tool as `comingSoon: true` non-tappable rows. The
  Collections affordance has a designed home waiting for a screen.
- `NativeOopEstimateReview` and `TechOOPPricingConfigured` are already in the
  native registry. "New Estimate" is probably an extension of that path, not a
  cold start. Establish this before designing.
- Lead Center is CRM: gated behind the `page:crm` feature flag, and
  `docs/crm-lead-lifecycle.md` is a MANDATORY read before anything CRM is
  counted, staged, classified or reported.

ROLE GATING — copy the pattern shipped 2026-08-07.
- `src/lib/claimUtils.js` exports `CUSTOM_DOC_ROLES` + `canSendCustomDoc`,
  mirrored in `functions/lib/esign-custom-doc.js`, pinned together by
  `tests/qa/unit/esign-custom-doc-surface-parity.test.js`. functions/ is a
  separate Cloudflare bundle and cannot import from src/, so the list is
  duplicated on purpose and must be pinned.
- Its own constant, never an alias of `BILLING_EDIT_ROLES` — the repo already
  learned that lesson when payout authority had to be split back out of billing.
- BE HONEST about what a UI gate is. `sign_requests` carries always-true RLS
  policies, so the accurate sentence there is "the worker refuses; the database
  does not." Collections touches money: AGENTS.md §16 requires the same role
  predicate enforced SERVER-side, not just hidden in the shell. Trace the whole
  path; do not infer it.

## What I need you to establish before proposing a design

For each of the four screens, from the real code and the live catalog:
1. Which RPCs/tables it needs, what those are GRANTED to today, and whether an
   office-role session can actually read them — or whether the data only reaches
   the web app because something broader is open. Name the gap if there is one.
2. Whether a lean native screen can reuse existing RPCs, or whether new
   purpose-built ones are required. Prefer reusing; say so if you cannot.
3. What the field-tech-facing surface looks like with the feature present but the
   role absent — prove nothing new appears.
4. Bundle cost: what each screen adds to the NATIVE bundle, measured against
   `.claude/rules/perf-budget.md`. Note that web entry-graph JS is already over
   target, so do not spend headroom.
5. Whether the boundary change is a bounded carve-out or a general widening, and
   what `native-bundle-boundary.test.js` has to say about it afterwards.

Then give me: the evidence ledger (HAVE / PARTIAL / MISSING / UNKNOWN), the
dependency order, which screens are independent and which are not, the honest
bundle number, and what you would ship first. I would rather land one screen
that is genuinely right than four that are approximately right.

## Verification you are expected to do

- `npm run build && npm test && npx eslint <changed files>` — the three
  credential-free lanes were 5,298 green at handoff.
- The native boundary test, and a real simulator run on the CORRECT bundle
  (`npm run build:ios`, then build/launch).
- Two accounts exist for this: "Moroni Salvador" (admin) and "Moroni Tech"
  (field_tech). Verify BOTH — the tech session is what proves nothing leaked.
- Practical note: the simulator MCP screenshot service crashes repeatedly.
  `xcrun simctl io <udid> screenshot --type=png out.png` works reliably; taps
  through the MCP control tool are fine.

## Separately authorized, not implied by this prompt

Migration apply, commit, push, PR, deployment, a signed native build, TestFlight
upload, feature-flag flips, and any provider call. One Supabase sits behind both
dev and production, so a migration is a production change the instant it applies.
```
