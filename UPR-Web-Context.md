# UPR Web Platform — Context Document
Last updated: July 31, 2026 (restructured: this file is now the LEAN CURRENT-STATE REFERENCE
only. All dated session logs, incident write-ups, shipped-phase narratives and plans-of-record
moved to `docs/archive/web-context-changelog-2026-07.md` — history, not current state. Keep it
that way: new sessions append a short dated entry to the ARCHIVE and update the relevant
current-state section HERE. Counts (tables, RPCs, employees, workers) drift — verify live.)

## Project Overview
Internal business management platform for Utah Pros Restoration (UPR).
Owner/developer: Moroni Salvador.

## QBO invoice/conversion recovery hardening (2026-07-31 — database applied; dev source shipped)

Two sequenced migrations and their compatible Worker/client changes close the captured-provider-
result/local-write gap without weakening the human Save-to-QuickBooks gate:

- estimate decisions and conversion are row-locked; a populated target invoice remains a manual
  boundary, combined QBO invoice/estimate matches are never allocated arbitrarily, and durable
  `reconcile:*` event rows carry unresolved cases;
- each invoice save/send/delete command is frozen in a private, forced-RLS
  `qbo_invoice_commands` row before a QBO write. The command binds invoice, action, authenticated
  human actor, realm, local intent, provider request id/payload/result and terminal response; retries
  recover both before and after local CAS without a second provider side effect;
- authenticated browser callers retain one owner-scoped UUIDv4 operation id in `localStorage`
  across a tab restart only while the result is ambiguous. Intuit Accounting writes
  receive a deterministic `requestid`; and
- invoice-link/send metadata uses a service-only CAS plus the database lifecycle trigger. Worker
  code never writes trigger-owned `status`, `amount_paid`, `line_total` or `paid_at`.

The owner-authorized production apply used exact source commit `3f61e7fa`, recorded as
`20260731205928_qbo_estimate_conversion_concurrency` and
`20260731205942_qbo_invoice_command_ledger`. GitHub CI's schema `verify` and governed `db-lane` jobs
are green. Catalog/RLS/ACL postconditions and local static/Worker tests pass. Compatible
Worker/client code ships in the same `dev` release as this documentation; repository state is not
evidence of a Cloudflare deployment, authenticated-browser execution, or Intuit webhook/provider
behavior. Those remain owner/external release gates.

## CRM lead value — manual entry + claim-wide billed total (2026-07-30, owner-directed)

Applied live, ledger **`20260730155213`** (`20260730133000_crm_lead_value_from_claim.sql`), proven on
the `qa-staging` branch first.

**Schema (additive):** `inbound_leads.claim_id uuid` (FK → `claims`, `ON DELETE SET NULL`, partial
index) and `inbound_leads.value_source text` (`'manual'` | `'auto'` | NULL). A `'manual'` value is
never overwritten by automation.

**New RPCs/functions** (all `SECURITY DEFINER`, `search_path` pinned, `REVOKE ... FROM PUBLIC, anon`
then `GRANT ... TO authenticated, service_role`):
- `crm_lead_claim_value(p_claim_id) → numeric` — **the single claim → jobs → invoices join.** Sums
  `COALESCE(adjusted_total, total)` for every invoice under the claim that is sent, QBO-emailed,
  converted from an estimate, or carries a payment. A draft never counts.
  ⚠ **Multi-tenant seam:** `claims`/`jobs`/`invoices`/`contacts` carry no `org_id` (only the CRM
  tables do), so the lead is the org anchor. When billing gains `org_id`, the predicate goes HERE.
- `crm_recompute_lead_value(p_lead_id) → numeric` — recomputes from source (idempotent by
  construction); skips `'manual'` rows and unchanged values.
- `crm_recompute_lead_values_for_claim(p_claim_id)`, `crm_attach_claim_to_lead(p_claim_id) → uuid`.
- `set_lead_value(p_lead_id, p_value, p_updated_by) → inbound_leads` — the Leads panel's write path.
  Validates the caller in SQL (active, non-external employee). `p_value = NULL` returns the lead to
  automatic and recomputes. Deliberately **not** `set_lead_details`, which would blank `notes`.
- `crm_backfill_lead_values(p_days)` — admin-**session**-gated, so it cannot run from the SQL editor.

**Triggers:** `crm_invoice_lead_value_sync` on `invoices`
(`AFTER INSERT OR DELETE OR UPDATE OF total, adjusted_total, job_id, sent_at, qbo_emailed_at,
amount_paid, estimate_id` — the list must name every column `crm_lead_claim_value()` reads);
`crm_job_claim_lead_value_sync` on `jobs`; `crm_claim_created_lead_link` on `claims`. All trap their
own errors so CRM bookkeeping can never block a money write.

**Why it was rewritten:** `20260721_crm_lead_value_sync.sql` had been applied for nine days and never
ran once (0 events, 0 of 156 leads valued) — its `AFTER INSERT ON invoices` trigger tested
`total > 0`, but invoices are inserted with no total and get one later by UPDATE
(`recompute_invoice_from_lines`). `crm_sync_lead_value` is left in place but unwired from
`crm_trg_invoice_created` (dropping a live granted function is forbidden by `database-standard.md`
§3). Won auto-advance is preserved verbatim.

**UI:** `src/pages/crm/CrmLeads.jsx` — inline-editable Value row in the lead detail panel. It was
previously hidden whenever `value` was null, which is why there was no way to enter one.

**Its CSS was dead until 2026-07-30 (structural defect, now guarded).** `src/index.css` carried one
unclosed `{` — the `:root[data-native="true"] … .login-page/.set-pw-page { min-height: 0;` rule at
the very END of the file never closed. Because it was last, it swallowed everything after it to EOF,
and the build re-emitted the remainder as **CSS nesting** inside that selector:
`.crm-lead-value` therefore only matched inside `.set-pw-page` within a native shell — i.e. never on
the CRM Leads page. All 7 swallowed selectors were inert (`.crm-lead-value`, `:focus-visible`,
`-muted`, `-edit`, `-edit .crm-input`, the `@media (max-width: 768px)` block, `-edit .crm-btn`).
**That was the real cause of the Value control rendering with native button chrome**, and it is why
adding `appearance: none` alone could not fix it. Blast radius was exactly those 7 selectors,
precisely because the broken rule sat at end-of-file. It shipped in both `dev` and `main`.
Fixed by restoring the brace; guarded by
**`tests/qa/unit/css-structural-integrity.test.js`**, which fails the build if `index.css` braces
ever go unbalanced again. Verified in the built asset, not just the source: the shipped CSS now
contains `.crm-lead-value{appearance:none;…}` as a top-level rule.

**Reading the diff is not enough here** — an unclosed brace at end-of-file looks like an ordinary
addition in every hunk. Trust the brace-balance guard, not the eye.

## QBO estimate acceptance now syncs back to UPR (2026-07-31)

**Incident:** a customer (Alex Orozco, EST-001018) accepted a QuickBooks estimate and UPR never
found out — the owner had to convert it manually. Root cause: `qbo-webhook.js` processed **Payment
entities only** and the hourly poller was payments-only too; QBO estimate answers had no path into
UPR (a second stale case, EST-001008, sat accepted-in-QBO/`submitted`-in-UPR for 10 days).

**Fix (workers only — no schema, no UI):** new **`functions/lib/qbo-estimate-sync.js`**
(`syncQboEstimateToUpr`) wired into both `qbo-webhook.js` (now routes `Estimate` entities through
the same signature/claim/realm guards) and `qbo-payments-sync.js` (hourly sweep of
Accepted/Rejected/Converted estimates, failure-isolated from payments). Accepted → estimate
`approved` (+`approved_at`/`approved_amount` from QBO) + the same `convert_estimate_to_invoice`
RPC the staff button runs → draft UPR invoice; the status flip fires the pre-existing
`trg_estimate_accepted_notify` trigger → `estimate.accepted` admin push. Rejected → `denied`.
QBO-side conversions adopt via `adoptInvoiceFromQboEstimate` (now exported). Guards: only
pre-decision statuses auto-advance; UPR decisions are never overwritten; conversion echoes no-op;
`needs_confirm` (target invoice already has lines) approves without appending. **The human
Save-to-QBO gate is untouched** — nothing auto-calls `/api/qbo-invoice`. Detail:
`BILLING-CONTEXT.md` §"Estimate answers flowing back from QBO".

**Owner gates:** add the **Estimate** entity to the Intuit Developer webhook subscription
(real-time; the hourly sweep covers the gap meanwhile), and promote `dev → main` (the Intuit
webhook URL + pg_cron both point at `utahpros.app`, so production only picks this up on promotion).

## What's New — the team-facing shipped record, `/whats-new` (2026-07-31)

A signed-in page any employee can open (`crm_partner` excluded, same as `/roadmap` and
`/feedback`) recording everything built, fixed and improved, written for people who use the app
rather than build it. The backward-looking counterpart to `/roadmap`, which is forward-looking.

**Two tiers, and the split is the whole design.**

- **Highlights** — hand-written, one JSON file per entry in `src/data/changelog/` (format:
  the README beside them). 38 seeded for July 2026.
- **Everything else** — generated from git by `npm run generate:changelog` into
  `src/data/changelog-activity.json`: every `feat`/`fix`/`perf` commit since 2026-07-01, bucketed
  into America/Denver weeks, `docs`/`test`/`chore` excluded. Currently 460 changes over 5 weeks
  across 13 areas.

**Why derive the second tier at all:** 1,018 `feat`/`fix`/`perf` commits have landed since
2026-03-12, ~50 per week, so a page that is 1:1 with commits is unreadable *and* an entry-per-commit
rule would manufacture ~50 near-duplicates weekly. Deriving the bulk means a session that forgets a
highlight costs detail, never the record — the page cannot decay into looking abandoned. Precedent
for why that matters: `src/lib/roadmapData.js` carries a "bump this whenever you update" comment and
its `ROADMAP_UPDATED` stamp sat four weeks stale.

**Live vs in-testing is derived, never typed.** The generator marks each commit against
`origin/main` ancestry, so a change still behind the `dev → main` hold cannot be advertised as
available (19 of 460 today). A highlight naming a `sha` inherits that and self-corrects on the next
generate after a promotion; the optional `status` field is only for what git cannot see, such as a
feature still behind a flag.

**No database, no network.** No table, no RPC, no migration, no grant, no fetch — everything is
bundled. So there is no loading gate, no error state, and nothing to refetch on resume; the
minimize test passes because the page has no async lifecycle.

**Files:** `src/pages/WhatsNew.jsx` + co-located `WhatsNew.css` (kept out of `src/index.css`, which
sits ~1.9 KB under its CI-blocking 600,000-byte ceiling — same precedent as
`NotificationPresentation.css`). Registered in `buildTargetPages.web.jsx` (web only; office pages
are absent from the native registry), route in `App.jsx`, nav in `Sidebar.jsx` +
`IconWhatsNew` in `navItems.jsx`, **and a `/whats-new` pair in `public/_redirects`** — without that
the address returns `404.html` in production, which `tests/qa/unit/spa-route-coverage.test.js`
catches. Lazy route chunk: 75.6 KB raw / 21.1 KB gzip, entry graph unchanged.

**Techs get the same page, not a copy** (2026-07-31). `/tech/whats-new`, reached from
**Tech > More > Resources**, renders the *identical* `WhatsNew` component — one record that cannot
drift into two. It works because the page reads no database and every colour is a token, so
`[data-theme="dark"] .tech-layout` re-themes it with no extra CSS (verified: card surfaces drop to
luminance 29, text rises to 243).

Two measured exceptions needed local dark overrides, and the reason is a design-system gap worth
knowing: **the tech dark theme redefines the `-bg`/`-border` tokens but leaves `--info`,
`--success` and `--warning` at their light values.** So `--info` on `--info-bg` scored **3.04**
(below AA) while green and amber passed at 4.59/4.79 — by luck, not design. Fixed inside
`WhatsNew.css` scoped to `[data-theme="dark"] .tech-layout` (badge label → `--text-primary`,
tertiary labels → `--text-secondary`); every element now passes AA, and light mode is untouched.
Re-tuning the shared tokens would be a design-system change this page is not entitled to make —
but the gap is real and affects any surface pairing those tokens.

Native: the page is in `buildTargetPages.native.jsx` **and** `NATIVE_PAGE_ALLOWLIST`, so the iOS
app carries it (+76 KB). Both `WhatsNew.jsx` and `WhatsNew.css` need allowlist entries — the rule
matches every module under `src/pages/`, and the source-contract test passes without the CSS entry
while `npm run build:native` fails, which is exactly the split those two checks exist for.
`/tech/*` already covers the route in `_redirects`. Menu label lives in `more.json` as
`rowWhatsNew` across en/pt/es.

**Upkeep:** `.githooks/commit-msg` (activate per clone with
`git config core.hooksPath .githooks`) reminds on a `feat`/`fix`/`perf` commit touching
`src/pages`, `src/components` or `functions/api` that carries no entry. **Non-blocking by design** —
see `close-out-standard.md` step 8b. It is a git hook rather than a Claude hook because
`git commit` is the only chokepoint Claude, Codex and a human at a terminal all share.
Contract test: `tests/qa/unit/whats-new-changelog.test.js` (52 cases — entry validity, generated-data
shape, and the hook's silence cases, which matter as much as its loud one).

## Workflow & technical-debt restructure (2026-07-29 — owner-directed)

No feature code, schema, or provider behaviour changed. What changed:

- **CI now blocks** on a real bundle budget (`scripts/bundle-size-report.mjs --strict`, which superseded the interim `check-bundle-budget.mjs` +
  `scripts/bundle-budget.json`; the old report read `dist/assets/`, which Vite never emits to) and
  on migration hygiene (`scripts/check-migration-hygiene.mjs`: paired rollback, anon-grant
  justification, `REVOKE FROM PUBLIC` with `SECURITY DEFINER`, destructive-DDL markers; all 257
  pre-existing migrations grandfathered via `scripts/migration-hygiene-baseline.json`).
- **Agent law compacted:** `AGENTS.md`/`CLAUDE.md` rewritten (Rules 1–12 verbatim, numbering
  frozen, `check-l0-bridge` 14/14); 11 completed/dormant wave manifests archived to
  `docs/archive/rules/`; live coordination state consolidated into
  `.claude/rules/initiative-status.md`; six UI/worker standards gained `paths:` frontmatter so
  they load only for matching work. Always-loaded instruction set: ~37k → ~10.5k words.
- **Staging database:** `qa-staging` is seeded and live at the isolated ref recorded in
  `docs/database/staging-branch-runbook.md`. Its public schema matched production at the
  2026-07-29 seed point (141 tables / 400 functions / 219 policies) and now deliberately drifts as
  migrations are qualified; standing QA identities are seeded, and the CI database lane is active.
  The fixture-password GitHub secret is configured and all three standing identities were
  rotated without committing a usable password. The raw hosted receipt at `a513af37` is
  163 / 375 assertions passed, 0 failed, 212 skipped, and 46 setup errors across 44 files. Failed
  assertions are gated at zero; setup debt is shrink-only at 44 failed files / 90 recursively
  failed suite nodes. Six SQL/pgTAP proofs remain local-only. The Supabase dashboard's
  `MIGRATIONS_FAILED` badge reflects a real ledger/replay gap even though the manually restored
  schema is usable: a 2026-07-31 rebase again attempted historical
  `20260312194505_001_phase_conversion_and_costing.sql` and failed because `rv_jobs` depends on
  `jobs.phase`. The schema-only restore did not baseline the migration ledger, so agents must not
  use rebase for parity or mark old entries applied ad hoc. The repository still has no
  `supabase/config.toml`, and migration history alone cannot reconstruct a local stack; use the
  hosted branch only under the branch runner/authorization rules.
- **WIP inventory with recommended verdicts:** `docs/wip-inventory-2026-07.md`.

Deliberately NOT done (deferred with reasons): splitting `src/index.css` (13,003 lines — its own
initiative once current leases close), any destructive schema cleanup (needs the seeded staging
branch first), applying `20260728000000_sms_consent_opt_out_only.sql` (deferred then; **since
applied 2026-07-30**, live ledger `20260730121811` — see
`.claude/rules/sms-consent-model.md` §13).

## Deployment & Release Workflow

**Branches → environments**
- **Feature branch / `dev`** → Cloudflare auto-deploys `dev` to **https://dev.utahpros.app** on every push. Verify here first.
- **`main`** → production **https://utahpros.app** (and the Capacitor iOS app loads `/tech/*` from this build).

**How code reaches production (sanctioned path):**
Never push `main` directly, and never infer commit/push/PR/deploy permission from an implementation
request — those are separate authorizations. **Corrected 2026-07-26:** this line previously claimed
"automated agents *cannot* `git push` to `main` — the Claude Code safety guardrail blocks direct
pushes to the default branch by design." **That is false and was load-bearing false.** Claude Code's
own documentation states that in auto mode, *"pushing to any branch of the repository you're working
in, including the default branch"* is allowed by default; and this repo has no `permissions.deny`
entry for a plain `git push origin main` (only `--force`/`-f` are denied). The prohibition is
**prose, not a mechanism** — treat it as a rule you must follow, not a wall that will stop you.
Closing that gap with a ref-parsing PreToolUse hook is tracked in
`docs/agent-alignment-roadmap.md` (P6). To release:
1. Land the change on **`dev`** (feature branch → `dev`, fast-forward) and test on the dev deploy.
2. **Open a PR `dev → main`** (ask the user first — repo convention is no PRs unless requested). The **user reviews + merges**; Cloudflare deploys `main`. (Or the user merges `dev → main` locally.)
3. The agent's last git step on a finished task is "on `dev` + request the `dev → main` merge," never a direct `main` push.

**Single shared Supabase (dev + main).** One project (`glsmljpabrwonfiltiqm`) backs both environments, so migrations and data changes — e.g. **publishing a new `demo_sheet_schemas` version** — affect staging AND production at once. Sequence so production code is live before the schema it needs: seed new schema versions as a **draft** (`is_active=false`, inert), merge code to `main`, then call the activating RPC (`publish_demo_schema`). This prevents old production code from rendering a schema it can't handle.

**Scope Sheet rollback (≈60s).** Schema and code revert independently — see CLAUDE.md → *Scope Sheet rollback runbook* for full steps. Fast paths: (1) **schema** — `SELECT publish_demo_schema('6b14aefb-4591-47ee-b00f-e12ddb8f956a');` reactivates v1 instantly (new code renders v1 via the hardcoded-sketch fallback); (2) **code** — `git revert -m 1 <merge-sha>` → `dev` → `dev → main` PR → Cloudflare redeploys. Old saved sheets keep their `schema_id` snapshot, so historical sheets are never affected. Prefer new schema *versions* over in-place edits for granular rollback.

---

## Stack
- **Frontend:** React 19 + Vite
- **Database:** Supabase (PostgreSQL + PostgREST REST API — NO Supabase JS SDK)
- **Auth:** Supabase Auth via `@supabase/supabase-js` realtime client
- **Workers:** Cloudflare Pages Functions (`functions/api/`)
- **Email:** Resend (`https://api.resend.com/emails`) via shared `functions/lib/email.js` helper. Omni-inbox (Jul 4 2026) adds `functions/lib/email-threading.js` (reply-token address build/parse, XSS-safe inbound HTML sanitizer, In-Reply-To/References headers) and `functions/lib/conversation-email.js` (`sendConversationEmail` — reason-aware suppression gate before Resend, reply-only/channel-locked). Bounce/complaint feedback → `functions/api/resend-webhook.js`.
- **SMS/MMS:** CallRail is active for staff P2P. Twilio is a future, owner-gated transition; its
  repository parity code is inert, and the app's managed database/Cloudflare credential paths are
  currently unconfigured.
- **Storage:** Supabase Storage (`job-files` bucket, `message-attachments` bucket)

**Supabase project ID:** glsmljpabrwonfiltiqm (us-east-2)
**Cloudflare account ID:** d686ab40c1b3ec7eac2a43df91d4ef3a

---

## Critical Coding Rules
1. Always read files from disk before editing — never rely on memory for current code state
2. Use `write_file` for full rewrites — `edit_file` fails silently on Windows CRLF files
3. Never use `alert()` or `confirm()` — use `src/lib/toast.js` (`toast`, `ok`, or `err`)
4. Always use `const { db } = useAuth()` — never import `db` directly in components
5. Work on `dev` branch only — never touch `main`
6. All CSS changes must use `@media (max-width: 768px)` unless provably safe on desktop (dvh, env(safe-area-inset-bottom)) — never change desktop UI/layout/colors/spacing
7. Commit and deploy after every 2–3 files — test on real iPhone before continuing

---

## Load-failure contract — an outage never renders as "empty" (LES-01, Jul 30 2026)

`db.select` / `db.rpc` **THROW** on any non-OK response (400/404/500). They do not resolve to `[]`.
So an inline `.catch(() => [])` on a read does not "make it resilient" — it converts a real outage
into a successful-looking **empty result**, which `loading-error-states.md` §1 names the
highest-impact defect in the app. 31 of these existed across 18 files; 28 were removed on
2026-07-30 and 3 kept with a `LES-01 triage — KEEP` comment stating why.

**What the pattern looks like now** (reference: `TechJobDetail.jsx`, `TechJobAlbum.jsx`):

- Reads inside a `load()` carry **no inline catch** — they reject into the one outer catch.
- Every setter is **committed together after all reads resolve**, so a partial failure can neither
  half-update the screen nor slip past the page's `if (!job)` / `if (!detail?.claim)` error gate
  into a page of false empty sections.
- The outer catch does `console.error(...)` — **a tech is never shown raw PostgREST JSON** — then
  sets the error state and toasts.
- **Two independent flags, never one.** `load({ silent, quiet })`:
  | caller | flags | why |
  |---|---|---|
  | cold load | `load()` | gate the page, report the failure |
  | pull-to-refresh | `{ silent: true }` | no gate (loading-error-states §6) but **still reports** — the tech chose the gesture, and silence leaves them pulling against a dead connection |
  | post-mutation reload (upload / save) | `{ silent: true, quiet: true }` | no gate, **no second toast** — the mutation already reported itself; already-rendered rows stay put and the failure goes to the console |
  A single boolean cannot express both, which is why `quiet` exists separately from `silent`.
  Precedent for the silence gate: `src/pages/crm/CrmCallLog.jsx`.
- A **secondary lookup** (a picker/filter beside un-swallowed primary content) may keep a catch, but
  captures the error into a local, logs it, and toasts which control is degraded — an empty picker
  must never read as "none exist". See `CrmAutomations` / `CrmSequences` / `CrmCampaigns`.

Notable failures this closed: a FALSE "no signed Work Authorization" compliance banner on
`TechJobDetail` + `TechAppointment`; resume silently erasing visible e-signature rows on
`TechJobDocuments`; an all-unchecked permission matrix on `settings/Roles`; `settings/TemplatesEditor`
opening built-in defaults as if they were the saved template (a save would have overwritten the real
one); and `crm/CrmCampaigns` emptying a campaign's exclusion set, which the next save would have
persisted as "exclude nobody".

Guards: `tests/qa/unit/false-empty-state-swallow.test.js` (25 source-contract assertions, incl. a
repo-wide inventory that fails if a 4th swallow appears) and `tests/qa/unit/job-detail-lifecycle.test.js`.

## Resume / focus / poll refetching — one hook, no exceptions (Jul 30 2026)

`src/hooks/useResumeRefetch.js` is the **single** implementation of "quietly refresh when the user
comes back" (`page-lifecycle.md` §2). It owns the hidden→visible edge detection, the `focus`
listener, and the `document.hidden` poll guard §4 requires:

```js
useResumeRefetch({ onResume, onFocus, pollMs, hiddenEdgeOnly = true, enabled = true })
```

Callbacks are held in refs, so passing a fresh inline function each render does **not** re-subscribe.
`hiddenEdgeOnly` (default) fires `onResume` only on a real hidden→visible transition, not on every
desktop refocus. Note the hook does **not** apply a visibility guard to `onFocus` — a page that also
refreshes on focus keeps its own `document.visibilityState === 'visible'` check inside the callback
(see `CrmCallLog`).

**The last five page-level hand-rolled listeners were migrated Jul 30 2026**, so no page or
component registers `visibilitychange`/`focus` itself any more:

| Surface | Was | Now |
|---|---|---|
| `pages/crm/CrmCallLog.jsx` | visibilitychange + focus + 15s `setInterval` | `{ onResume, onFocus, pollMs: 15000 }` |
| `pages/tech/admin/AdminLeadCenter.jsx` | same shape, 20s interval | `{ onResume, onFocus, pollMs: 20000 }` |
| `pages/JobPage.jsx` (FilesTab) | visibilitychange → sign requests + an unguarded inline `job_documents` select | one generation-guarded `refreshOnResume` |
| `pages/tech/v2/dash/AttentionStrip.jsx` | visibilitychange → `checkAway()` | `{ enabled: active, onResume: checkAway }` |
| `pages/tech/TechJobDocuments.jsx` | visibilitychange → `loadRequests()` | `{ onResume: loadRequests }` |

The two raw `setInterval` polls are gone with them — both now inherit the hook's hidden-guard, so a
backgrounded phone no longer polls CallRail every 15–20s. JobPage's FilesTab additionally gained the
request guard §2 requires (a `resumeGenRef` generation compared before each `setState`); previously
two bare selects could land a stale job's files on the job you had just navigated to.

**Sanctioned exceptions** (allowed to hold a raw listener because each is the one implementation of
its concern): `components/overview/hooks/usePolledRpc.js` (the hidden-guard behavior model),
`components/RouteRestorer.jsx` (the single scroll/route-restoration primitive, §5), and
`lib/nativeKeyboardLayout.js` (keyboard metrics, not a refetch). `useResumeRefetch.js` itself
attaches to **injected** `doc`/`win` params, which is what keeps its `subscribeResume` unit-testable
without a DOM.

**Guard:** `tests/qa/unit/resume-listener-lifecycle.test.js` sweeps all of `src/` and fails on a new
hand-rolled listener anywhere outside that allowlist — it is not a snapshot of these five files.
Hook behavior itself is covered by `src/hooks/hooks.test.jsx`.

---

## File Structure

```
src/
  App.jsx                        — Router, ProtectedRoute, AdminRoute, FeatureRoute, DevRoute wiring
  main.jsx                       — Entry point
  index.css                      — All global styles + CSS variables
  contexts/
    AuthContext.jsx               — Auth state, account cleanup lock, genuine-session login/logout,
                                   featureFlags map, isFeatureEnabled(), canAccess()
  lib/
    supabase.js                   — REST client (baseUrl, apiKey, select/insert/update/delete/rpc)
    realtime.js                   — Supabase realtime + auth client
    api.js                        — Misc API helpers
    techDateUtils.js              — Shared helpers for tech pages: formatTime, relativeDate, photoDateTime, fileUrl, openMap.
    clockPrecheck.js              — Time-Tracking PR-2: runOmwPrecheck(db, apptId, employeeId) (fail-open call to clock_omw_precheck) + jobLabel/fmtElapsed helpers. Used by TimeTracker.jsx + TechDash.jsx before OMW.
    navItems.jsx                  — Single source of truth for office nav: NAV_ITEMS (legacy sidebar list), PRIMARY/OVERFLOW/SYSTEM groupings, nav icon components, isItemVisible() gate. Read by Sidebar + the desktop TopNav/OverflowDrawer/SettingsLayout.
    backNav.js                    — History-aware Back (field-polish Jul 29 2026): canGoBack() reads React Router v7's history.state.idx; goBackOr(navigate, fallback) pops when in-app history exists, else replaces to the fallback. Used by TechJobDetail, v2 HubHeader, TechJobAlbum, TechJobDocuments, Legal, SignPage. Unit-tested (backNav.test.js).
    signSubmit.js                 — Jul 30 2026: the SignPage submit path, split out so its failure shapes are testable. submitEsign(body, fetchImpl?) POSTs /api/submit-esign and THROWS on every failure (worker `{error}` message, else `Submission failed (<status>)`); an unparseable body is a failure, never a silent success (the ESIGN false-success class). submitErrorText(err) turns it into a customer-facing sentence — a rejected fetch ("Failed to fetch"/"Load failed") becomes "We could not reach the server." Unit-tested (SignPage.submitError.test.jsx).
  pages/
    Login.jsx                     — Email/password login + forgot password (no employee selector)
    SetPassword.jsx               — Password reset flow (recovery link handler)
    Dashboard.jsx                 — Owner "Overview" dashboard: 12-col widget grid (replaced the old
                                    stats+jobs view Jun 24 2026). See the "Overview Dashboard" section below.
    components/overview/          — Overview dashboard pieces: tokens.js (dashboard-scoped palette +
                                    placeholder data), Card.jsx (shared card shell + DeltaPill), Widgets.jsx
                                    (the 10 widget components). Styles live under .ovw-* in index.css.
    Jobs.jsx                      — Job list: division tabs, sort, search, detail panel
    JobPage.jsx                   — Full job detail: Overview/Schedule/Files/Financial/Activity tabs
    Production.jsx                — Kanban pipeline (30 phases, 4 macro groups) + list view
    Leads.jsx                     — Jobs in lead phase (feature-flagged: page:leads)
    Collections.jsx               — "My Money" / Collections page (feature-flagged: page:collections), redesigned to
                                    the UPR design system (Jun 2026). FOUR tabs: A/R · Outstanding (ARDashboard —
                                    default-sorts newest CREATED first, client-side, via get_ar_invoices().created_at
                                    added by 20260626_get_ar_invoices_created_at.sql; clickable column headers override —
                                    Client/Sent/Age/Total/Collected/Balance, Client A→Z on first click, numeric/date cols descending-first),
                                    Invoices (InvoicesList, get_ar_invoices(), rows → /invoices/:id editor — also
                                    default-sorted newest CREATED first, client-side),
                                    Estimates (EstimatesList, get_estimates() which already returns created_at DESC,
                                    re-sorted client-side for parity, rows → /estimates/:id — a convenience
                                    view of the standalone /estimates page), Payments (PaymentsLedger,
                                    get_payments_ledger()). Header has Payment-settings + New-invoice/New-estimate
                                    actions; A/R, Invoices, and Estimates carry a period switch (All/MTD/Last 30/
                                    QTD/YTD) that scopes their data by date. **All four tab components load once via a
                                    `dbRef` (load() deps `[]`)** so a token refresh on browser-tab refocus no longer
                                    re-fires load() and flashes the loading state (the old "blink") — the latest client
                                    stays reachable through the ref. A/R + Invoices have wired Filters
                                    (division / QB-sync / amount) and a Columns show/hide editor; footer "Export →"
                                    links download a CSV of the visible rows. Estimates shows 4 KPIs incl a
                                    conversion-rate card. Row status is shown as plain COLORED TEXT (not pills) on
                                    Estimates + Invoices; Payments amounts are neutral ink (green reserved for the
                                    QB-synced ✓). Restraint throughout: color only where it carries meaning. The
                                    active tab is synced to ?tab= (replace) so tabs are deep-linkable and the
                                    browser Back button (and builder "← Back") returns to the tab you were on.
    components/collections/       — Collections redesign pieces: collTokens.js (page-scoped UPR palette + $/date
                                    formatters + period math + invoiceStatusKind + aging bucketKey/AGING_BUCKETS + CSV),
                                    collKit.jsx (shared
                                    primitives: CollCard, Kpi, SegControl, SearchBox, StatusBadge, DivisionSquare,
                                    ProgressBar, Pill, PopoverButton + Filters/Columns, inline SVG icons),
                                    ARDashboard.jsx, InvoicesList.jsx, EstimatesList.jsx, PaymentsLedger.jsx,
                                    ARChatBubble.jsx + arSnapshot.js (AI A/R Copilot — see note below),
                                    SearchSelect.jsx (typeahead dropdown for the QBO Item/Class pickers in the
                                    invoice & estimate builders), ActionMenu.jsx ("Manage ▾" dropdown in the
                                    builder top toolbar — two-click confirm for Revert/Delete). Styles
                                    live under .coll-* in index.css. Palette is page-scoped (like the dashboard's
                                    .ovw-*), NOT the app-wide tokens. COLOR SEMANTICS: a balance is neutral ink,
                                    never red — red is reserved for overdue/escalation; green = collected/current,
                                    amber = aging. A/R TOP is ONE unified summary card — an Outstanding hero + an
                                    Overdue callout (both click-to-filter the table) over the aging bar + 5 buckets —
                                    which replaced the old 4 KPI tiles + a separate aging card (they showed the same
                                    money twice). EACH aging bucket amount is also click-to-filter (Jul 2026): tapping
                                    a band drills the table to the open invoices in that age range (state `bucket`;
                                    `.coll-aging-btn`). A bucket OVERRIDES the Open/Overdue/All `mode` (aging applies
                                    only to open invoices) and picking a mode/Outstanding/Overdue clears the bucket, so
                                    exactly one slice is highlighted at a time; empty bands aren't clickable; the footer
                                    + CSV + Copilot snapshot all follow the active band. The A/R period switch scopes the WHOLE A/R view by invoice date
                                    (summary + aging + table recompute; drafts/undated always shown; default All).
                                    A/R rows are deliberately de-noised: age is plain text (red only when overdue),
                                    QB shows only on a sync error, and there are NO per-row status pills (overdue →
                                    Age, partial → Collected, draft/sent → Sent columns carry it); the Invoices tab
                                    keeps its status badge (no such columns there). Job address under Claim · Job comes
                                    from get_ar_invoices (job_address/job_city added by migration
                                    20260625_get_ar_invoices_address.sql). The Payments "Processing/in-flight" section
                                    from the design is omitted: get_payments_ledger returns cleared payments only.
                                    AI A/R COPILOT (Jun 2026) — a floating, page-aware chat bubble on the A/R tab
                                    (ARChatBubble.jsx, mounted by ARDashboard; worker functions/api/collections-chat.js,
                                    Sonnet 4.6, non-streaming). On each send the browser builds a DETERMINISTIC snapshot
                                    of exactly what's on screen — outstanding/overdue/aging totals, ranked top-debtors,
                                    the filtered+sorted invoice list, and the view state — via buildArSnapshot()
                                    (arSnapshot.js) and injects it into the system prompt, so most questions answer in
                                    ONE call with no DB lookups and the numbers always match the screen (the model never
                                    sums; code does). READ-ONLY drill-down tools map to existing data:
                                    lookup_customer → get_customer_detail / search_contacts_for_job (phone/email +
                                    claims/jobs), get_invoice_detail → invoices + invoice_line_items + payments (+
                                    xactimate_meta), list_payments → get_payments_ledger, list_estimates → get_estimates,
                                    get_job_detail → jobs select + get_job_financials, lookup_claim → claims select,
                                    list_job_labor → get_job_labor_summary. Plus LIVE QuickBooks (read-only via qboFetch,
                                    functions/lib/quickbooks.js — same OAuth as qbo-invoice/qbo-query, no new secrets):
                                    qbo_customer (real-time QBO balance + open QBO invoices for a contact),
                                    qbo_ar_summary (live total A/R + aging across open QBO invoices), and reconcile_qbo
                                    (diffs the FULL UPR open A/R against ALL open QBO invoices in one pass — matched by
                                    qbo_invoice_id ↔ QBO Invoice.Id, fallback qbo_doc_number ↔ DocNumber — and returns
                                    categorized to-do lists: sync_errors, qbo_open_not_in_upr, upr_open_unsynced,
                                    upr_open_not_open_in_qbo, balance_mismatch, with complete counts/$ totals + capped
                                    per-item lists). QBO tools are intent-based — the worker builds the safe /query string
                                    (the model never passes raw QQL). ADVISORY ONLY — it never
                                    drafts/sends a message or creates/modifies any record (the human acts). Ephemeral
                                    (no history tables). Auth: any logged-in session (the page is already access-gated);
                                    reuses ANTHROPIC_API_KEY; logs worker_runs as 'collections-chat'. The shared aging
                                    bucketKey/AGING_BUCKETS were lifted into collTokens.js so the snapshot's buckets can
                                    never drift from ARDashboard's on-screen breakdown. The panel is non-blocking (no
                                    backdrop — the live A/R view it reads stays scrollable) and hides under the
                                    New-invoice/estimate modals (z 80/90 vs 200).
    ClaimsList.jsx                — List of all claims
    ClaimPage.jsx                 — Full claim detail page
    ClaimPage_header.jsx          — Claim page header component (partial/patch file)
    Customers.jsx                 — Contact list, claims-grouped detail panel
    ContactProfile.jsx            — Individual contact detail
    CustomerPage.jsx              — Customer detail page
    Conversations.jsx             — SMS/MMS messaging (GHL-style, TCPA compliant). **Wave -1 hotfix (Jul 9 2026):** `handleSend` now checks `res.ok` BEFORE parsing the body and the worker-failure fallback that inserted a `status:'queued'` ghost `messages` row was DELETED (F-1) — the worker is the sole writer of `sms_*` rows. On send failure it reports through `src/lib/toast.js` and keeps the exact failed optimistic bubble available for an explicit Retry; it never inserts a ghost canonical row. **Prior-consent remediation (applied Jul 23 2026):** admin/office users see a consent banner and `SmsConsentAttestationModal` only for a direct conversation with verified verbal permission, signed work authorization or other evidenced permission. It records method/date/note without sending or automatically retrying; the user must make a separate explicit Retry action after successful recording. Group/broadcast/automated traffic still requires global opt-in, and STOP/DND cannot be cleared.
    Schedule.jsx                  — Calendar dispatch board (Day/3Day/Week/Month) — fully on the UPR design system (shell, Week Calendar, Jobs/Crew/Month views; Jun 2026)
    ScheduleTemplates.jsx         — Schedule template management
    TimeTracking.jsx              — Employee time tracking (feature-flagged: page:time_tracking). Tabs: Status Board (admin/PM/supervisor only, default for those roles) | Timesheet | By Job | Payroll. Status Board renders src/components/StatusBoard.jsx and polls get_tech_status_board() every 30s.
    Marketing.jsx                 — Marketing tools (feature-flagged: page:marketing)
    EncircleImport.jsx            — Selective Encircle claim import with division selection (feature-flagged: page:encircle_import, route: /import/encircle)
    OOPPricing.jsx                — Frozen legacy calculator implementation retained for compatibility reference during the code-first migration; it is no longer the routed desktop calculator.
    OOPPricingConfigured.jsx      — Current /tools/oop-pricing route wrapper for eligible roles:
                                    active internal admin, office, supervisor, estimator (sales rep),
                                    and project_manager. Renders the shared ConfiguredOopPricingCalculator
                                    from a published versioned price list; the preceding OOPPricing.jsx
                                    is retained only as the frozen legacy compatibility implementation.
    settings/OopPricingBuilder.jsx — Admin-only /settings/oop-pricing builder in the dedicated Settings > Pricing & billing group. Draft save and two-click publish; add/reorder/archive/restore line items, rates, internal-cost rules, defaults and project/line minimums.
    Admin.jsx                     — Employee management + roles/permissions matrix + page access overrides
    Settings.jsx / Admin.jsx      — DELETED (Settings Overhaul Phase F, Jul 4 2026). Dissolved into
                                    src/pages/settings/* routed sub-pages (see the "Settings Overhaul
                                    — Phase F Foundation" section below for the full route map).
    settings/                     — SettingsHome (index) + ListsAndValues/Templates/TemplatesEditor/
                                    Commissions/MyAccount/Notifications (from Settings.jsx) + Team/Roles/
                                    PageAccess/NotificationDefaults (from Admin.jsx) + Payments/Integrations/
                                    FeedbackInbox/ScopeSheets (git-mv'd) + templates/{templateData.jsx,TemplateEditor.jsx}
                                    ListsAndValues.jsx (route /settings/lists, Settings Overhaul P10, Jul 7 2026)
                                    replaced the standalone Carriers.jsx + Referrals.jsx pages — both old
                                    routes permanently redirect to /settings/lists. It renders a
                                    registry-driven stack of LookupTable sections read from
                                    src/lib/managedLists.js ([{ key, title, columns, getRpc, upsertRpc,
                                    deleteRpc, toUpsertParams }]) — carriers + referrals are the first two
                                    entries, behavior-identical to the old pages. A future managed list is
                                    one registry entry, not a new page. The two SETTINGS_GROUPS rail
                                    entries collapsed into one "Lists & Values" entry (src/lib/navItems.jsx,
                                    IconListValues).
    Help.jsx                      — In-app Help & Guides centre (route /help — now UNWRAPPED from the settings hub, renders directly in Layout; reached from the TopNav ? button + Sidebar). Landing menu of guide cards → opens a guide; the open guide is kept in the URL hash (#how-it-works / #invoicing, plus an optional #guide/section to deep-link straight to a section) so it deep-links and survives refresh, and the ? button (no hash) always lands on the menu. Two guides today: "How UPR Works" (office orientation — the Customer→Claim→Job→Invoice hierarchy rendered natively + worked example, the cardinality rules, first-call-to-paid job lifecycle, creating a new job (the New Job modal walkthrough + dos/don'ts), a tour of every main screen, the 7 divisions, a "where do I do X" quick-reference, a glossary, and a field-tech mobile note) and "Invoicing & Financials" (build → Save to QBO → get paid → Collections; downloadable PDF). Visible to every logged-in user (not role-gated). Printable hierarchy diagram served from /public/UPR-Hierarchy-Diagram.html. Contextual ? links (HelpLink.jsx) on the New Job modal, invoice builder, Collections, and Claims open the matching guide section in a new tab. Static content only — no DB reads/writes.
    SignPage.jsx                  — Public esign page (no auth) — type or draw signature. Field-polish (Jul 29 2026): when reached by IN-APP navigation (the tech "Collect signature on-site" flow — canGoBack() true) it renders an escape hatch on every state — header Back (disabled while submitting), Back bar on the error/expired/signed cards, and a Done button on the completion card. A customer's cold link open has no in-app history, so the public page is unchanged. Abandoning is safe: nothing is written before the atomic /api/submit-esign POST; the sign request stays pending. **Submit-failure visibility (Jul 30 2026, close-out finding):** the catch used to write `errorMsg`, which only renders in the `status === 'error'` early-return branch — so a failed POST dropped the customer back on an unchanged form with NO error shown. It now sets a separate `submitError` rendered inline by `SubmitErrorNotice` (role="alert") directly above the Submit button, cleared at the start of the next attempt. Inline is required, not stylistic: this page renders outside both app shells, so there is no toast container and a `lib/toast` call here would be swallowed. Request/message logic lives in `lib/signSubmit.js`.
    CreateJob.jsx                 — Full-page job creation flow
    Legal.jsx                     — Public /privacy + /terms + /support pages (required by Intuit's QBO production profile + App Store). Also rendered inside the field shell at /tech/legal/* (App.jsx). Field-polish (Jul 29 2026): LegalLayout carries a Back button — always visible in the tech shell (fallback /tech/settings), history-gated on the public copies so a direct visitor/App Store reviewer keeps the plain document; cross-links (LegalLink) stay on /tech/legal/* when inside the tech shell.
    settings/FeedbackInbox.jsx    — Feedback inbox (route /settings/feedback, admin-only; was /tech-feedback → permanent redirect)
    settings/ScopeSheets.jsx      — Scope-sheet schema builder (route /settings/scope-sheets; was /admin/demo-sheet-builder → redirect)
    settings/Integrations.jsx     — "Connections" hub (route /settings/integrations, admin-only; was /admin/integrations → redirect). Managed-here cards: GitHub (github-connect), QuickBooks (quickbooks-connect), Deepgram (deepgram-connect). Managed-elsewhere status + cross-link cards: CRM Channels → /crm/integrations, Stripe → /settings/payments, Google Drive & Calendar (per-user) → /settings/my-account, Twilio (feature:twilio_live send-mode). See Settings Overhaul → P8.
    ClaimCollectionPage.jsx       — Per-claim A/R view (older sibling of the Collections hub)
    settings/Payments.jsx         — Stripe pay-link + payout settings (route /settings/payments; was /payments/settings → redirect)
  pages/tech/
    ** Dark-theme token migration (Jul 30 2026) — applies across this whole block and components/tech/.
      Raw hex color literals on the field surface were swapped to the semantic design tokens
      (var(--danger|success|warning|info|neutral) + their -bg/-border) so `[data-theme="dark"]
      .tech-layout` re-tones them instead of leaving frozen light patches. 23 files: techConstants.js
      (APPT_STATUS_COLORS + CLAIM_STATUS_COLORS now hold var() strings, same {bg,color,border} shape,
      so consumers were untouched), TechAppointment, TechClaimDetail, TechClaimAlbum, TechRoomDetail,
      TechOOPPricing, TechEditAppointment, TechNewAppointment, TechNewEvent, TechNewJob,
      TechNewCustomer, TechTasks, and components/tech/{StalledWidget, OfflineStatusPill,
      OfflineReconciliationPanel, ClockSupersedeSheet, EsignRequestSheet, GenerateReportButton,
      NowNextTile, TimeTracker, ReadingEntrySheet, Hero, PhotosGroup}, plus src/lib/oopPricing.js
      (TIER_COLORS, the margin-tier badge — it lives in lib/ but renders inside .tech-layout via
      TechOOPPricing; it uses the semantic family and NOT --status-*, because --status-* is
      .tech-layout-scoped and this module is also consumed by the desktop src/pages/OOPPricing.jsx,
      where those tokens resolve to nothing). Verified in-browser at 390px in
      both themes: light mode resolves to the original hex (a visual no-op), dark darkens the tint
      while every foreground keeps its hue. Color-only — no layout, behavior, or index.css change.
      DELIBERATELY still raw hex (all documented in place, none is a defect): the categorical division /
      appointment-type palettes, TechDemoSheet's email-HTML palette (email clients can't resolve CSS
      vars), the `p_phase_color` RPC arguments, #fff on saturated fills, and four armed two-click
      destructive-confirm fills. Rules + the status-vs-categorical split: UPR-Design-System.md →
      Dark-theme contract. NOT covered: TechJobDetail.jsx / TechJobDocuments.jsx (migrated separately).
    TechDash.jsx / TechSchedule.jsx — DELETED (Tech Mobile v2 Phase C, Jul 4 2026 cutover). Both
      v2 flags (page:tech_dash_v2, page:tech_sched_v2) baked and went live for all techs, so the
      legacy pages + their App.jsx swap shims were removed; /tech and /tech/schedule now always
      render the persistent v2 panes in TechLayout.jsx. See pages/tech/v2/TechDashV2.jsx and
      TechScheduleV2.jsx below.
    TechTasks.jsx                 — Field tech tasks: swipe-to-complete, collapsible job groups. Reached via More tab (demoted from primary nav Apr 16 2026).
    TechClaims.jsx                — Field tech claims: 200ms debounced instant search. Scope toggle ("Mine"/"All") defaults to All, sticky per-device via localStorage `upr:tech-claims-scope`.
    TechClaimDetail.jsx           — Field tech claim detail (purpose-built mobile, replaces desktop ClaimPage at /tech/claims/:claimId). Division-gradient hero (loss emoji, insured name, tappable address, loss meta), 3-button action bar (Call/Navigate/Message as native tel:/maps/sms:), context-aware Now-Next appointment tile (4 cases: now_active/today/next/hidden), Jobs-as-tiles with inline task progress + next-appt label, Photos & Notes grouped by job with 3-up thumbnail strips + overflow count + "See all →" (navigates to /photos album), full-screen lightbox pager, Add Photo / Add Note with bottom-sheet job picker on multi-job claims, collapsed Claim details reference block (carrier/policy/insured/adjuster), admin kebab (Merge/Delete via MergeModal + DELETE-to-confirm dialog), slide-in entry animation, pull-to-refresh, pushStatusBarSurface('dark') on mount, restoreStatusBarBase() on unmount.
    TechClaimAlbum.jsx            — Field tech claim photo album at /tech/claims/:claimId/photos. Slim sticky top bar (back + "Photos" + claim#/insured subtitle + count badge), division-tinted accent strip, 2-column thumbnail grid (~160×160) with per-job grouping on multi-job claims, absolute date + time caption under each thumbnail ("Mar 28, 2026" / "9:52 AM"), pinned bottom Add Photo button with multi-job sheet picker. Imports shared Lightbox from components/tech/.
    TechJobDetail.jsx             — Field tech job detail (purpose-built mobile, replaces desktop JobPage at /tech/jobs/:jobId). Division-gradient hero (emoji, mono job number, insured name, tappable address, phase pill, loss meta), 3-button action bar, "Part of CLM-XXXX · View claim →" breadcrumb, context-aware Now-Next tile filtered to this job's appointments, full Appointments list grouped Upcoming / Past with status pills + crew + task counts, Photos & Notes single-group with See all → /tech/jobs/:id/photos, Add Photo / Add Note (no picker — single job), collapsed Job details reference block (phase, status, division, carrier, policy#, claim#, deductible admin-only, insured, adjuster), admin kebab (Merge job via MergeModal type='job' + DELETE-to-confirm soft delete → returns to parent claim), pull-to-refresh, entry animation, pushStatusBarSurface('dark') on mount with restoreStatusBarBase() on unmount. Field-polish (Jul 29 2026): hero Back is origin-aware via lib/backNav — pops to wherever the tech came from (dashboard/schedule/claim/messages); "Back to claim" label + claim-page navigation only as the no-history fallback (deep link / cold start), '/tech' when the job has no claim. Same change in v2 hub HubHeader.jsx; TechJobAlbum/TechJobDocuments "Back to job" buttons pop instead of pushing a duplicate job entry (fallback jobHref()).
    TechJobAlbum.jsx              — Field tech job photo album at /tech/jobs/:jobId/photos. Same structure as TechClaimAlbum but single-group (this IS one job), no job picker. Subtitle = job# · insured.
    TechAppointment.jsx           — Appointment detail: slide-in animation, collapsing hero, photo lightbox. Message button now opens native sms:{phone} (TODO: in-app SMS when available).
    TechMore.jsx                  — Field tech "More" page: list-based home for secondary tools. Sections: Work (Tasks with count badge, OOP Pricing only for the eligible OOP roles when tool:oop_pricing is on, Collections, Time Tracking) + Resources (Help & Guides → /tech/help, Checklists, Demosheet). Regular field technicians never see OOP Pricing. Unbuilt items render as dimmed "Soon" rows; built items are <Link>s with chevron.
    TechHelp.jsx                  — Field tech "Help & Guides" page (route /tech/help). Plain-language, big-tap how-to for the phone app: the timer (On My Way → Start Work → Pause → Finish), snap-first photos, the task checklist, moisture readings, schedule, claims, starting a new job (the + → New Job field flow, incl. new-vs-existing claim), plus a "Stuck?" → Send Feedback footer. Static content only (no DB). Reached from the standalone ? button in the TechDash greeting header (left of the ⋮ menu) and the More → Help & Guides row. Card content now lives in techHelpContent.jsx (shared with the contextual TechHelpSheet).
    techHelpContent.jsx           — Shared field-tech help content: the TOPICS array ({key,Icon,title,lines,accent}) + the TopicCard renderer + topic icons. Imported by both TechHelp.jsx (full page) and TechHelpSheet.jsx (contextual sheet) so the wording never drifts. Static; file-level eslint-disable for react-refresh/only-export-components (intentional data+component module).
    TechOOPPricing.jsx            — Frozen legacy field-tech calculator retained for compatibility reference; it is no longer the routed web/native calculator.
    TechOOPPricingConfigured.jsx  — Current /tech/tools/oop-pricing route wrapper in both web and
                                    native registries, only for eligible OOP roles (not regular field
                                    technicians). Uses the same configured runtime as desktop, with the
                                    tech visual kit, 48px tap targets, live total, bottom breakdown,
                                    pull-to-refresh and silent resume refresh.
    TechDemoSheet.jsx             — Field-tech Demo (scope) Sheet at /tech/tools/demo-sheet (May 8 2026 — port of standalone Netlify demo-sheet-v21.jsx). Captures per-room scope: dimensions, baseboard/trim LF, flooring SF, drywall, flood cuts, insulation, cabinets/countertops, doors, fixtures, appliances, drying equipment, contents move hours, notes. Repalettes original orange theme onto UPR blue/neutral tokens, drops dark mode. Tech dropdown loads from get_active_techs RPC (was hardcoded). Reuses src/components/AddressAutocomplete (Google Places via lib/googleMaps loadPlaces). Encircle 🔗 search modal hits /api/encircle-search; selecting a claim auto-pulls structures+rooms via /api/encircle-rooms (rooms become preset chips). Autosave: every 2s while editing, save_demo_sheet RPC writes to forms.form_data with form_type='demo_sheet'; URL gets ?id=<formId> on first save so refresh restores. Drafts banner lists recent unfinished sheets via get_demo_sheet_drafts. Submit fans out to /api/send-demo-sheet (Resend HTML email) + /api/encircle-upload (general note posted to the linked claim) + /api/demo-sheet-pdf (renders the sheet to a PDF and attaches it to the job's Files via job_documents, category 'demo_sheet' — also surfaces on the customer page Files section) in parallel; ResultScreen shows per-channel success/fail (email, Encircle, PDF); final save_demo_sheet flips status to 'submitted' and stores encircle_note_id. Toasts via upr:toast event; no alert/confirm. Entry point: 'Demo Sheet' button under the Tools section on TechAppointment, prefills jobNumber/address/insuredName from the appointment's job context via query params.
  components/
    TechLayout.jsx                — Field tech app shell: blur nav, active pill indicator, task badge dot. 5-tab order: Dash | Claims | Schedule | Messages | More (Apr 16 2026). Task count red-dot now lives on the More tab icon. Nav tab taps fire impact('light') via lib/nativeHaptics (Jul 29 2026 field-polish — matches the bell/IconButton press haptic; native-only, reduced-motion-suppressed) and carry the standard :active scale(0.97) press on the motion tokens with a prefers-reduced-motion collapse (source contract: tests/qa/unit/tech-nav-haptics.test.js). **Lifecycle (Jul 30 2026):** the More-tab badge counts today's tasks from `get_assigned_tasks` on mount and every 60s **via `useResumeRefetch` — hidden-guarded**, so it no longer polls a backgrounded phone (it also refetches on the hidden→visible edge, so the badge is current the moment a tech looks at it); toast-expiry restoration moved onto the same hook. This shell now registers **no** `visibilitychange` listener and owns **no** `setInterval` of its own (page-lifecycle.md §2/§4; source contract: tests/qa/unit/tech-shell-poll-guard.test.js). The badge fetch is `fetchTodayTaskCount(db, employeeId)`, module-scope and pure — it returns the count, and both callers swallow the throw, because a background poll must never toast.
    tech/Hero.jsx                 — Shared division-gradient hero. Prop-configurable: { division, topLabel, title, address, statusText, statusColors, meta[], onBack, backLabel, showMenu, onMenu }. Used by TechClaimDetail and TechJobDetail.
    tech/ActionBar.jsx            — Shared 3-button action bar: Call (tel:), Navigate (maps), Message (sms:). Disabled state when phone/address missing. Used by TechClaimDetail and TechJobDetail. TechAppointment keeps its own 5-button version.
    tech/NowNextTile.jsx          — Shared context-aware "what's happening" tile + pickNowNext(appointments, employeeId) helper. 4 cases: now_active (en_route/in_progress/paused) / today / next / hidden.
    tech/PhotosGroup.jsx          — Shared photos + notes group (mini-header per job, 3-up thumbnail grid + overflow cell, notes preview). Used by TechClaimDetail (multi-group on multi-job claims) and TechJobDetail (isSingleJob mode).
    tech/Lightbox.jsx             — Shared full-screen photo pager: prev/next, counter, tap-to-close, description caption. Used by TechClaimDetail, TechClaimAlbum, TechJobDetail, TechJobAlbum.
    tech/DetailRow.jsx            — Shared label/value row for collapsed detail panels. Supports href (tel/mailto), mono, capitalize, multiline.
    tech/TimeTracker.jsx          — Static three-station row (OMW · Start · Finish) with timestamps under each. No live ticking. Between-step durations ("Travel: 23m", "On job: 4h") shown only after the right side of the interval is reached. Past stations greyed + non-tappable for techs (admin/PM edits via desktop). Pause is a secondary control; preserves original Start timestamp on Resume. Supports multi-visit via "Return to Job" flow. Time-Tracking PR-2 (Jun 26 2026): before OMW, calls clock_omw_precheck (src/lib/clockPrecheck.js) and shows ClockSupersedeSheet to confirm clocking out of another open job (or hard-block when clock_enforce_explicit_clockout is ON). Same precheck+sheet wired into TechDash ActiveCard's OMW.
    tech/ClockSupersedeSheet.jsx  — Red bottom sheet (PhotoNoteSheet structure) shown before OMW when the tech is clocked in elsewhere: confirm-supersede mode ([Clock out & continue]) or hard-block mode ([Go to {job}]). Pure presentational; parent owns the RPC.
    tech/TechHelpSheet.jsx        — Bottom help sheet (PhotoNoteSheet structure: backdrop + slide-up, tech-fade-in/tech-slide-up, safe-area pad, grabber + ✕). Renders the requested topic's TopicCard first then the rest of TOPICS (from techHelpContent). NO navigation / no target=_blank (Capacitor-safe) — opens over the screen so an in-progress form isn't lost. Props {open,onClose,topicKey}.
    tech/TechHelpButton.jsx       — Self-contained "?" button (dash help-button styling) that owns its open state and renders TechHelpSheet. One-line drop-in: <TechHelpButton topicKey="newjob" />. Used on TechNewJob (newjob), TechAppointment (timer, white-on-hero variant), TechClaims (claims).
    Layout.jsx                    — App shell: sidebar, bottom bar, toasts, offline banner. The four quick-action modals (CreateJob/AddContact/NewInvoice/NewEstimate) are React.lazy + Suspense, loading on first open (perf-budget §4; 2026-07-30, −22 KB gzip entry graph)
    Sidebar.jsx                   — Desktop nav + sign out button
    HelpLink.jsx                  — Reusable contextual "?" that deep-links into a /help guide section in a NEW TAB (so in-progress modals/forms aren't lost). Props: anchor ("guide[/section]"), label, size, variant; reuses IconHelp. Used on CreateJobModal, InvoiceEditor, Collections, ClaimsList.
    AddContactModal.jsx           — Add contact modal (9 roles) + LookupSelect component
    AddRelatedJobModal.jsx        — Add sibling job under same claim
    CalendarView.jsx              — Week-calendar grid for Schedule page (division-tinted event cards via schedule/eventCardStyle.js; UPR design system, Jun 2026)
    schedule/eventCardStyle.js    — Maps an appointment → card colors by division (teal/purple/coral/pink) / appt-blue / task-green / dashed-tentative / gray-done
    CarrierSelect.jsx             — Searchable insurance carrier combobox with OOP sentinel
    CreateAppointmentModal.jsx    — Create appointment on schedule
    CreateCustomerModal.jsx       — Create customer modal
    CreateJobModal.jsx            — Inline job creation modal. New claim / Existing claim toggle (2026-07, mirrors TechNewJob): existing mode lists the contact's claims via get_customer_detail, prefills loss/carrier/claim# and passes p_existing_claim_id to create_job_with_contact (reuses the claim, skips the Encircle re-push)
    CreateMenu.jsx                — FAB / quick create menu
    DatePicker.jsx                — Custom date picker
    DivisionIcons.jsx             — SVG division icons (water/mold/recon/fire/contents)
    EditAppointmentModal.jsx      — Edit existing appointment
    EditContactModal.jsx          — Edit contact details
    EmptyState.jsx                — Reusable empty state component
    ErrorBoundary.jsx             — React error boundary
    Icons.jsx                     — SVG icon components
    JobDetailPanel.jsx            — Job detail slide-out panel
    JobPanel.jsx                  — Job panel component
    ProtectedRoute.jsx            — Auth guard wrapper
    PullToRefresh.jsx             — Mobile pull-to-refresh
    ScheduleWizard.jsx            — Generate schedule from template
    MergeModal.jsx                — Shared merge UI for contacts, claims, jobs (search + compare + two-click confirm)
    SendEsignModal.jsx            — Send/collect esign request modal (5 doc_types inc. recon_agreement)
    ReconAgreementContent.jsx     — Signer-side expandable layout for recon_agreement doc_type (intro, property info, authorizations, scope & estimate, payment, 16 legal sections, 4 attested consents). Rendered inside SignPage when doc_type matches. Amber branding.
    Sidebar.jsx                   — Sidebar navigation (mobile + iPad portrait ≤1023px; reads NAV_ITEMS from lib/navItems.jsx)
    TopNav.jsx                    — Top nav bar (≥1024px — desktop + iPad landscape): logo, primary links, GlobalSearch, NewMenu, NotificationBell, Help link (→/help), settings gear, UserMenu, overflow hamburger
    OverflowDrawer.jsx            — Desktop "More" slide-over (secondary pages: Jobs, Production, Schedule Templates, Encircle Import, OOP Pricing, Leads, Marketing)
    NewMenu.jsx                   — Top-nav "New" dropdown → New Job (job+claim creator; label renamed from "New Claim" 2026-07) / New Estimate (page:estimates) / New Customer / New Invoice (flows via Layout.handleCreateAction)
    UserMenu.jsx                  — Top-nav avatar dropdown (admin-only Tech View + Sign Out)
    GlobalSearch.jsx              — Top-nav global search: 300ms-debounced typeahead over the global_search RPC, grouped results routing to each record
    SettingsLayout.jsx            — Settings hub shell: left sub-rail (≥1024px) wrapping the system pages; display:contents passthrough below 1024px

functions/
  api/                            — 58 files total; only the SMS/Esign/Encircle/demo-sheet workers below are
                                    inventoried here. QBO, Stripe, Google Drive/Calendar, and Homebuilding AI
                                    workers (~41 files) are documented in their own sections further down this
                                    doc instead of duplicated here — see CLAUDE.md's Workers section for the
                                    full grouped list of all 58.
    admin-users.js                — POST/PATCH/PUT/DELETE employee + auth management
    process-scheduled.js          — Cron: process scheduled SMS messages (60s). GET/POST accepts the scheduler `x-webhook-secret` or the exact internal DevTools owner with the Conversations capability; `scheduled()` remains platform-authenticated. **Scheduled-message delivery hardening (Jul 31 2026, authored source only — not applied/deployed/provider- or device-verified):** hardened callers deploy first and fail closed until the compatibility RPCs exist. Compatibility requires exact participant enforcement, locks the queue, and aborts with SQLSTATE `55000` if the aggregate pending count is nonzero; it never edits those rows. It creates FORCE-RLS provenance that snapshots creator, conversation, canonical body/send time, recipient contact, and recipient phone; closes raw browser `scheduled_messages` writes; changes the historical queue policies to explicit deny predicates; preserves the frozen legacy claim as a callable `false` no-op; and adds token-fenced service-only claim/release/fail/reserve/reconcile RPCs. A current worker may reserve exactly one durable delivery attempt only after the worker consent checks and the central `sendAutomatedMessage()` gates; it then makes at most one Twilio submission. Fresh linked `prepared`/`submitting`/`ambiguous` work stays in-flight, while accepted work is materialized into the canonical message and unknown outcomes become owner-review failures with no automatic resend. Reservation repeats creator capability/conversation access and validates the immutable recipient snapshot against the current participant at the pre-provider boundary. Enforcement follows compatibility in the same serialized release window, reasserts fail-closed policies and revoked browser ACLs, and retains the provenance boundary; no native scheduling caller is introduced by this slice. The existing batch quiet-hours guard (America/Denver) defers the queue; central `sms_disabled`/`quiet_hours` results release an unreserved claim. Writes a `worker_runs` row.
    resend-webhook.js             — Omni-inbox (Jul 4 2026): Resend bounce/complaint webhook. Svix
                                    HMAC-SHA256 verify (Web Crypto, raw body, ±5min, svix-id dedup,
                                    fail-closed 503 until RESEND_WEBHOOK_SECRET set). Permanent bounce →
                                    email_suppressions hard_bounce; complaint → complaint. worker_runs row.
    resend-esign.js               — Resend esign email for existing pending request
    send-esign.js                 — Create sign request + send email via Resend (functions/lib/email.js)
    send-message.js               — Outbound SMS chokepoint with TCPA compliance + DND guard. **Wave -1 hotfix (Jul 9 2026):** `skip_compliance` param + gate REMOVED (F-2) — the DND + opt-in chain runs for every outbound message, no bypass. **SMS-experience Phase B (Jul 9 2026):** the Wave -1 group/broadcast refuse-guard is replaced by the real **per-participant consent loop** — every participant is DND+opt-in gated *before* being texted (a DND/opted-out participant beyond index 0 is never sent to), and each recipient gets its OWN `messages` row so a per-recipient send failure is recorded instead of vanishing. Worker is the sole writer of `sms_*` rows; a recipient with no valid phone is refused, never cross-channel-retargeted. **Messaging transport foundation (Jul 23 2026):** shared Worker authorization and the conversations capability run before service-role/provider access; actor identity is server-derived; stable client request IDs, provider adapters, and the live attempt/event/outbox foundation preserve consent, sole-writer, and no-fallback rules. **Prior-consent remediation (applied Jul 23 2026):** explicit `opt_out_at` wins even if stale data says opted in; every staff message identifies Utah Pros Restoration and a conversation's first outbound includes STOP instructions. **Live config reconciliation (Jul 31 2026):** read-only Cloudflare inspection found both Preview and Production in `callrail`/`foundation`; this does not authorize a canary or prove external webhook routing. Plan: `docs/messaging-transport-roadmap.md`.
    attest-sms-consent.js         — GET status + record-only POST for verified prior direct service-SMS permission. GET requires the Conversations capability and returns only a safe decision; POST is internal admin/office, derives actor + trusted Cloudflare IP server-side, requires method/date/evidence, and never sends/retries. Service-only RPCs use browser-inaccessible current + append-only evidence tables, never change general/automated opt-in, serialize with inbound CallRail, refuse duplicate suppression or pending STOP, and place only a redacted evidence reference in `sms_consent_log`. Direct staff sends may consume this scope; group/broadcast/automated/scheduled paths may not. The foundation is live as ledger version `20260724035913_attest_prior_sms_consent`; contact-phone revalidation and strict STOP→later-START hardening are live as ledger version `20260724043000_harden_service_sms_consent`.
    messaging-setup.js            — Admin-only, read-only `/api/messaging-setup` Worker. Default GET reports redacted server-owned mode/configuration presence and deterministic blockers; `action=callrail-options` performs bounded CallRail GET-only discovery of active SMS-enabled/supported trackers. It exposes no API/signing secret, customer thread, destination number, raw provider body, mutation, test send, or Cloudflare/provider control-plane toggle. No migration; the 2026-07-31 dashboard check found both environments in `callrail`, while all mode/provider changes remain owner-gated.
    send-push.js                  — APNs push via ES256 JWT; returns 503 until APNS_* env vars set (Phase 4 code-only). **App Store readiness A (Jul 17 2026):** now server-gated via `functions/lib/auth.js` `requireRole(['admin','project_manager'])` (pushing to an arbitrary `employee_id` is privileged — a valid session alone no longer passes); prunes `device_tokens` on `400 BadDeviceToken` as well as `410 Gone`.
    submit-esign.js               — Process signature, generate PDF, upload to storage; on success notifies office (in-app notification + job_notes activity entry + email to restoration@utah-pros.com). **Work Authorization SMS evidence bridge (source on `main`, schema live as ledger `20260727041645`):** recognizes only the pinned `upr_work_auth_sms_v1` rendered disclosure, completes through an atomic service-only wrapper when available, and records narrow direct-service evidence (including trusted Cloudflare signer IP in the private evidence table, never the legacy log) without global opt-in, suppression changes, send or retry. Missing schema, signer IP, or disclosure drift completes signing but leaves messaging blocked.
    encircle-backfill.js          — Batch 6-month historical importer. Cursor-paginates Encircle, creates contacts+claims+jobs, repairs legacy orphans, gated CLM writeback. GET=dry-run, POST=execute. Idempotent via (encircle_claim_id, division) composite.
    encircle-import.js            — Search/get/patch/import Encircle claims (manual selective import)
    sync-claim-to-encircle.js     — Push UPR-native claim UP to Encircle. POST { claim_id }. Idempotent (skips if claims.encircle_claim_id set). Writes encircle_claim_id back on claims AND all child jobs. On failure stores error on claims.encircle_sync_error for retry. Called automatically from CreateJobModal + TechNewJob post-RPC; manual retry via DevTools → Backfill tab → Unsynced Claims panel.
    sync-houzz.js                 — Push a reconstruction-division job to Houzz Pro. POST { job_id, force? }. Houzz Pro has no public API, so this POSTs the job (customer name/email/phone/address + job_number/claim_number/insurance_company/type_of_loss) to a Zapier webhook (Catch Hook trigger → Houzz Pro "Create Project" action, built in Zapier's UI — not buildable via API). Webhook URL lives in integration_config (key houzz_zapier_webhook_url, service-role-only — RLS enabled, zero policies, invisible to anon/authenticated), NOT a Cloudflare env var — settable live via Supabase without a dashboard step, same pattern as auth.js's checkCronSecret. Idempotent (skips if jobs.houzz_synced_at already set, unless force:true). Writes jobs.houzz_sync_status/houzz_synced_at/houzz_sync_error. No houzz_project_id — Zapier's Zap runs asynchronously so there's no way to read a created project's ID back; "sent" means "handed off successfully," not "confirmed created." Called automatically from CreateJobModal + TechNewJob + AddRelatedJobModal (all three client-side job-creation entry points — confirmed via grep, no others exist) post-RPC when division==='reconstruction'; no backfill/retry UI yet.
    sync-encircle.js              — Pull Encircle claims → jobs + contacts (bulk, legacy)
    track-open.js                 — Email open tracking pixel
    twilio-status.js              — Delivery receipts + RCS read status
    twilio-webhook.js             — Inactive durable Twilio inbound SMS/MMS receiver, deployed on `dev` at commit `8a7fd8e` and smoke-verified without provider activation. It fails closed unless `MESSAGING_SCHEMA_MODE=foundation`, resolves the account/token DB-first, validates `X-Twilio-Signature` against the exact URL and every form parameter before side effects, retains one normalized `message_provider_events` row per MessageSid, privately copies authenticated MMS bytes, and calls the service-only atomic projection. STOP/START/HELP TwiML remains synchronous (and Advanced Opt-Out remains silent); consent is projected even when MMS capture must retry. It no longer writes canonical messages/unread directly and has no `notifyInboundMessage()`/`waitUntil` path: the unique durable notification outbox is the sole `message.inbound` route. Migration `20260729211728_twilio_inbound_notification_parity.sql` is applied and rollback-proof-verified on isolated `qa-staging` (ledger `20260729220202`) and identically applied/catalog-verified on the shared project (ledger `20260729221116`). Twilio/provider bindings remain unchanged and no live Twilio traffic ran.
    encircle-search.js            — GET /api/encircle-search?policyholder_name|contractor_identifier|assignment_identifier=… (TechDemoSheet job picker). Limits to 20 newest property_claims. Uses X-Encircle-Attribution=UtahProsRestoration.
    encircle-rooms.js             — GET /api/encircle-rooms?claim_id=… returns { rooms[], structures[] }. Fetches structures for the claim then rooms per structure in parallel; multi-structure rooms get prefixed with structure name.
    encircle-upload.js            — POST /api/encircle-upload { claim_id, title, text } — posts a general note to the Encircle property claim (v2 /notes). Returns { ok, id } so the page can persist encircle_note_id.
    send-demo-sheet.js            — POST /api/send-demo-sheet { subject, message } — sends the rendered demo-sheet HTML email via Resend (functions/lib/email.js). From/To are env-overridable (DEMO_SHEET_FROM_EMAIL, DEMO_SHEET_TO_EMAILS).
    demo-sheet-pdf.js             — POST /api/demo-sheet-pdf { p_job_id?, job_number?, sheet_id?, requested_by?, model } (Bearer-authed like generate-water-loss-report) — renders a submitted demo sheet to a PDF with pdf-lib (navy header, blue room bars, per-room section label/value rows, Job Totals box, page footers), uploads to job-files/{job_id}/demo-sheets/demo-sheet-{ts}.pdf, and records it in job_documents via insert_job_document (category 'demo_sheet'). Resolves the job from p_job_id, falling back to a jobs.job_number lookup; returns { success:true, attached:false, reason:'no_matching_job' } (non-error) when the sheet isn't linked to a UPR job. The PDF then shows under the job's Files tab AND the customer page Files section (get_customer_detail returns all job_documents, no category filter). The render `model` is built client-side in TechDemoSheet.buildPdfModel() so all schema-walking (collectSectionEntries/computeSummary) stays in one place.
  lib/
    cors.js                       — CORS helpers + jsonResponse(data, status, request, env)
    supabase.js                   — Supabase REST helper for workers
    messaging-transport.js       — Provider-neutral seam used only by staff `/api/send-message`; registers Twilio and P2P-only CallRail behind explicit server mode, with missing/unknown modes disabled and no fallback. Read-only Cloudflare inspection on 2026-07-31 found both Preview and Production configured for CallRail/foundation; no Twilio credential variable names were present. Scheduled/automated/campaign senders remain explicitly Twilio-only.
    messaging-setup.js           — Pure redacted readiness/status builder shared by the admin setup Worker; resolves only server-owned mode/configuration presence, safe health counts, blocker codes, and planned channel capabilities.
    callrail-text-webhook.js      — Separate signed CallRail SMS Received/Sent receiver: verifies raw-body HMAC/timestamp, validates event shape, and deduplicates by required `resource_id` into the provider-event inbox. The documented secondary numeric `id` is optional because the live signed payload omitted it; a malformed non-null value still fails closed. It does not use the voice/form webhook. Signed events project through shared compliance primitives into canonical contacts/conversations/messages; MMS immediately consumes the signed webhook's short-lived media endpoint only after exact CallRail HTTPS/host/account validation, while retained-event retries refresh current endpoints from the documented conversation API. Verified bytes are copied into private `message-attachments`, and only owned references are retained. The account validator accepts a legacy numeric id and current masked `ACC...` media identity only after CallRail's authenticated account inventory proves the pair. No automated CallRail keyword reply is sent. Two outbound attempts were recovered without resend through `text_reconciled` events. A one-time isolated Preview importer later projected the two missing inbound replies from an exact conversation/time window and was fully deleted without merge. Live 2026-07-23 iPhone MMS evidence isolated the numeric-vs-masked account mismatch before Storage; post-deploy recovery and a fresh round trip remain required.
    message-conversations.js     — Conversations-capability-gated bounded contact search and service-only direct-thread creation. Both entry points use timed Auth/database transport before returning the four picker fields or invoking the scoped idempotent creator.
    message-media-upload.js       — Conversations-capability + current per-conversation-membership gated private image upload; checks membership before reading bytes or writing Storage, binds a valid conversation, rejects nonmembers as not found, and bounds Auth/PostgREST/RPC/Storage calls.
    message-media-url.js          — Conversations-capability + current per-conversation-membership gated signer for one private attachment already bound to a canonical message/index; its service-only RPC returns canonical media metadata only after strict membership succeeds, so there is no pre-authorization service-role message read. Rejects arbitrary buckets/paths, bounds outbound calls, and returns a 10-minute URL.
    notify.js                     — Secret-first or active-internal-admin notification dispatcher; Bearer Auth and production Web Push use the shared bounded transport while injectable tests preserve provider isolation.
    twilio-inbound.js             — Normalizes signed Twilio SMS/MMS form facts into the provider-neutral event identity and enforces AccountSid/MessageSid/media-count shape before retention.
    twilio-inbound-auth.js        — Public-webhook pre-authentication resolver limited to the exact Twilio token row and AccountSid key (with only their legacy env fallbacks). It never reads outbound sender/messaging-service configuration and makes no write.
    twilio-inbound-processor.js   — Thin retry-aware adapter for the service-only `project_twilio_inbound_event(uuid,boolean)` atomic projection.
    twilio-mms.js                 — Authenticated Twilio Media fetcher with exact account/message/media URL binding, redirect refusal, bounded time/size/count, JPEG/PNG/GIF byte validation, and deterministic private `message-attachments/twilio/...` ownership. Provider URLs and credentials are never persisted.
    process-callrail-events.js    — Scheduler-secret HTTP recovery worker for retained CallRail text events. Reclaims only due/stale work with bounded backoff and retries atomic canonical projection without making a provider send. Owner-applied migration `20260724002500_callrail_event_recovery_scheduler.sql` is live as ledger version `20260724002500` and supplies the five-minute exact-URL pg_cron/pg_net invoker outside browser execution. Live PATCH response drift then required `20260724051500_claim_callrail_provider_event.sql`, now live as ledger version `20260724051500`: its service-role-only invoker RPC atomically claims and returns one event so a mutation cannot be mistaken for a lost claim. Read-only role and source-fingerprint verification passed; Worker deployment and one stale-event recovery remain open. A separate read-only reconciliation worker polls exact CallRail history matches for accepted/ambiguous sends.
    recover-message-send-attempts.js — Provider-neutral, scheduler-secret recovery of accepted provider attempts whose canonical message insert failed; RPC-only and never imports a provider adapter.
    process-message-notification-outbox.js — Scheduler-secret fenced lease/retry/dead-letter worker for inbound notification jobs atomically committed by message projection. An exact-URL pg_net wake-up runs after outbox insert/commit, backed by a five-minute pg_cron due/stale-work safety net; missing config or an empty queue is inert. The lease prevents concurrent dispatch, while bell/push delivery remains at-least-once across worker crashes. The live claim RPC returns the durable outbox `id` but not `provider_event_id`; that returned `id` is the native Push occurrence identity across retries, preventing the former fail-closed `missing_notification_event_id` skip. Worker telemetry records only aggregate native attempted/sent/skipped counts and allowlisted skip reasons, never recipient/device identifiers or provider details. `message.inbound` bell links select `/conversations?c=<id>`; Web Push and native Push select the same thread inside `/tech/conversations?c=<id>`.
    twilio.js                     — Twilio helpers
```

---

## Overview Dashboard (owner landing — Jun 24 2026)

The owner's home screen at `/` (office/admin/PM/supervisor; field techs go to `/tech`). Replaced the old
stat-cards + two-job-tables `Dashboard.jsx` with the Claude-design **"Overview"** — a responsive 12-column
grid of 10 self-contained widget cards. Header = "Overview" title + date · division legend · period control
(MTD/Last30/QTD/YTD) · "Edit layout". Footer fine print.

**Widgets (default spans):** Revenue recognized `4` · Avg ticket `4` · Open estimates `4` · New claims booked
`6` · Jobs completed `6` · Active drying `7` (signature) · Collections `5` · Action required `6` · Employee
status `6` (live clock-in board) · Production pipeline `12` (future-ready, greyed recon/remodel lanes).

**Files:** `src/pages/Dashboard.jsx` (header + grid assembly + access-gating + kill-switch) ·
`src/components/overview/tokens.js` (palette + placeholder datasets; every widget takes a `data` prop
defaulting to its placeholder) · `src/components/overview/Card.jsx` (shell + DeltaPill + footer +
loading-skeleton / error-retry body states) · `src/components/overview/Widgets.jsx` (the 10 widgets +
`RestrictedCard`; CSS/SVG charts, no chart lib; rows deep-link via `useJobRowNav`; data-heavy list
widgets — Employee status, Action required, Active drying — scroll their rows internally via `.ovw-scroll`
(header + footer stay fixed) so long lists aren't clipped) ·
`src/components/overview/WidgetBoundary.jsx` (per-card React error boundary so one bad RPC can't blank the
grid) · `src/components/overview/hooks/` (one hook per widget, all built on the shared
`usePolledRpc(load, intervalMs, enabled)` — initial load + interval refresh that **pauses while the tab is
hidden and refetches on return**, **cancellation-safe** so a slow prior-period response can't overwrite the
current one, + `{data,loading,error,reload}`;
`dashUtils.js` = period math + money fmt; `useDashboardLayout.js` = layout persistence). Styles are scoped
under `.ovw-*` in `index.css` (grid + responsive 12→2→1-col + hover + LIVE pulse + shimmer skeleton + error).

**⚠ Dashboard-scoped palette (DO NOT confuse with app-wide DIVISION_COLORS):** this dashboard intentionally
uses its OWN division colors — Mitigation teal `#0e9384`, Reconstruction purple `#8a5cf6`, Remodeling coral
`#f2664a`, Mold pink `#ec4899`. **Remodeling is now a real app-wide division** (added Jun 29 2026): the
`job_division` enum includes `remodeling`, new jobs/invoices number as `RM-YYMM-###`, it maps to the same QBO
item/class as reconstruction (`divisionToQbo`), and it appears in the New Job form + all division color/label
maps. This dashboard keeps its own scoped palette (above).

**Roadmap / status:**
- **Phase 1 — DONE:** pixel-faithful visual shell + placeholder data.
- **Phase 2 — DONE (live data):** one data hook per widget (`src/components/overview/hooks/`); the period
  switch re-queries the period-scoped cards (Revenue, Avg ticket, New Jobs Closed). **Live:** Employee status
  (`get_tech_status_board`, 30s poll; each row shows the tech's full name + client + job address), Collections + DSO (`get_ar_invoices` + ARDashboard bucketing), New Jobs Closed
  (`get_jobs_closed` — see the canonical sale rule below), Revenue by division, Avg ticket + avg/claim, Production pipeline, Action required (pending
  `sign_requests`). **Wired but empty until those features are in use** (graceful empty states): Open estimates
  (`estimates` empty), Active drying (Hydro unused), Jobs completed (wired to `get_jobs_completed` in Part A —
  reads ~0 until jobs reach a terminal phase, then lights up automatically). **New RPCs** (migration `20260624_overview_dashboard_rpcs.sql`; all
  SECURITY DEFINER, granted authenticated): `get_revenue_by_division`, `get_avg_ticket`,
  `get_open_estimates_summary`, `get_pipeline_summary`, `get_active_drying_jobs`, `get_dashboard_action_items`,
  + helper `dash_division_bucket`. "View all →" links route to /collections, /claims, /production, /jobs.
- **Phase 3 — DONE (drag/resize/reorder + per-user layouts):** `react-grid-layout` v2 (classic API via its
  `/legacy` entry). "Edit layout" toggles drag (⠿ handle) + resize (bottom-right corner) + reorder; the
  arrangement saves per user via the RLS-locked **`dashboard_layouts`** table + `get_dashboard_layout` /
  `save_dashboard_layout` RPCs (scoped by `auth.uid()`, migration `20260624_dashboard_layouts.sql`) with a
  `localStorage` instant-apply mirror + Reset. RGL CSS is inlined + themed in `index.css`. Responsive: 12-col
  ≥996px, 1-col below.
- **Part A — DONE (interactivity + robustness + access control):** (1) **Clickable rows** — Employee
  status / Active drying / Action required rows deep-link to `/jobs/:id` (keyboard-accessible via
  `useJobRowNav`, guarded on a missing id, suppressed in edit mode); Production-pipeline active stages →
  `/production`. (2) **Loading/error states** — `usePolledRpc` exposes `{loading,error,reload}`; `Card`
  renders a shimmer skeleton while loading and a "Couldn't load · Retry" on failure (no more placeholder
  flash, no silent failures). (3) **Jobs completed wired** to `get_jobs_completed(p_start,p_end)`. (4)
  **Access control** — Revenue / Avg ticket / Collections gated by the **`overview_financials`** permission
  (`canAccess('overview_financials')`): admins always pass; grant it to anyone else **per-employee** (Admin →
  Page Access) or **per-role** (Admin → Permissions) — registered in both `NAV_KEYS` and `PAGE_ACCESS_KEYS`
  in `Admin.jsx`. **View-only and deliberately separate from `canEditBilling`** (billing EDIT), so granting a
  PM the money cards does NOT confer invoice/A-R edit rights anywhere. Non-privileged viewers get a
  `RestrictedCard` AND their hooks run with `enabled=false` so those RPCs aren't even fetched (not just
  UI-hidden). No DB migration — the existing `upsert_employee_page_access` / `upsert_permission` RPCs create
  the key's rows on first toggle. (Initial Part A shipped this as an admin-only `canEditBilling` gate; made
  configurable Jun 25 2026.) (5) **`page:overview`
  feature flag** is a kill-switch handled as **content** inside `Dashboard.jsx` (a placeholder when disabled),
  **NOT** a `FeatureRoute` redirect — the dashboard is the home route `/`, so redirecting to `/` would
  infinite-loop. (6) **`WidgetBoundary`** wraps each card so one failing widget can't blank the grid.
  Migration `20260624_dashboard_interactivity.sql` (adds `job_id` to `get_active_drying_jobs` +
  `get_dashboard_action_items`, creates `get_jobs_completed`, seeds the `page:overview` flag enabled).
  Migration `20260625_action_items_customer.sql` (additive) adds `client` (`jobs.insured_name`) +
  `address` (`street, city, ST ZIP`, same derivation as `get_tech_status_board`) to each
  `get_dashboard_action_items` row; the `ActionRequired` widget now leads with **customer name · job
  number**, then the doc status, then **address · sent date**, so a row is identifiable at a glance.
  Backward-compatible (existing keys unchanged → old code ignores the new ones).
- **"New Jobs Closed" drill-down — DONE (no migration):** the tile is now clickable → deep-links to a new
  page **`/jobs/closed?period=…`** (`src/pages/JobsClosed.jsx`, lazy route in `App.jsx` under `jobs`, before
  `:jobId`) that lists the actual sold jobs behind the number, carrying the SAME period the dashboard shows.
  Click is keyboard-accessible, inert in edit mode (mirrors `useJobRowNav`). **Matches the tile by
  construction:** shared data logic in `src/lib/reportPeriods.js` (`periodRange`/`REPORT_PERIODS`, lifted OUT
  of `useJobsClosed.js` so tile + page share one period-boundary definition) + `src/lib/jobsClosed.js`
  (`fetchJobsClosed(db, period)` — same `get_jobs_closed` RPC + same window, hydrated from `jobs`). Page reuses
  the Jobs-page `.job-list-card` CSS (no new styles); rows deep-link to `/jobs/:id`. **Built as a stepping
  stone to the future reporting tool** — both shared libs are report-agnostic and foldable. No nav link (the
  tile IS the entry point).
- **"New Jobs Closed" card + commission foundation — DONE (migrations `20260630_job_sales_canonical.sql`,
  `_commission_foundation.sql`, superseded by `_commission_on_real_jobs.sql`):**
  The old **"New claims booked"** card (counted raw `claims`) was renamed to **"New Jobs Closed"** and now
  counts **real (sold) jobs**, excluding estimate-only opportunities. Card reads `get_jobs_closed(p_floor)`
  (hook `useJobsClosed.js`, replacing `useNewClaims.js`); grid layout key stays `newClaims` (internal id) so
  saved per-user layouts aren't reset.

  ### ⭐ What counts as a SALE / REAL JOB (THE canonical rule — all reporting must use this)
  **Single source of truth = `jobs.is_real_job`** (migration `20260627_real_job_classification.sql`). A job is
  auto-flagged real when a **work-auth/recon agreement is signed**, a **QBO invoice** is created, or its
  **estimate is approved** (`real_job_source`/`real_job_marked_at` record which & when); the office can force
  it via `set_job_real_job`. **Billing, the "New Jobs Closed" card (`get_jobs_closed`), commissions, AND the
  whole CRM analytics layer all read `is_real_job` — never reinvent it.** *(Reconciliation note: this branch
  first shipped a parallel `job_sales` view; it was **retired** in `_commission_on_real_jobs.sql` so there's
  exactly one definition.)*
  - **⚠️ The CRM violated this rule for its entire life and was fixed 2026-07-22**
    (`20260722_crm_won_jobs_use_canonical_real_job_rule.sql`, owner-caught live). All five CRM reporting
    RPCs — `get_attribution_rollup`, `get_conversion_trend`, `get_crm_revenue_by_division`,
    `get_estimator_leaderboard`, `get_contact_ltv` — counted a won job as **`jobs.phase <> 'lead'`**, i.e.
    "a job row exists that isn't a lead anymore". But `job_received` — the phase a job enters the moment work
    is booked, **including a free inspection** — satisfies that, so booked inspections were reported as sales.
    Live evidence: the CRM Overview showed **12 "won jobs"** in a 7-day window, every one `phase='job_received'`
    with null/$0 `invoiced_value` — which is also why **"Revenue $0" sat directly beside "12 won jobs"**, the two
    numbers silently contradicting each other. Under the canonical rule that window is **1** (a signed
    `work_auth`); all-time CRM-traced **31 → 8**. The same migration also fixed the *dating*: these RPCs dated a
    sale by `jobs.created_at` (when the ROW was created), so the date picker never meant "won in this window" —
    they now use **`COALESCE(claims.created_at, jobs.created_at)`**, byte-identical to `get_jobs_closed`, so the
    CRM and the Home dashboard finally count the same thing the same way. `get_commissions` intentionally keeps
    `jobs.created_at` (see the dating note below) and was NOT touched. Test:
    `supabase/tests/crm_won_jobs_canonical_real_job_rule.test.js` pins the rule — a `job_received` job with
    `is_real_job=false` must not count, and flipping ONLY `is_real_job` to true must make it count.
  - **Sale DATING (which month a sold job counts in) differs by consumer — intentional:**
    - **Card `get_jobs_closed`** dates a sale by **`COALESCE(claims.created_at, jobs.created_at)`** — the
      **claim-created date** (migration `20260704_get_jobs_closed_claim_date_basis.sql`, owner decision
      2026-07-04). Rationale: a spring loss back-entered as a June job record shouldn't count as a June sale.
      Claim-less jobs (estimate→job flow) fall back to `jobs.created_at`. `is_real_job` still gates the *set*;
      this only re-DATES. Verified: June 2026 10 → 7 (three earlier-claim jobs moved to May/Apr/Mar).
    - **`get_commissions`** still dates by **`jobs.created_at`** (unchanged) — claim-date dating would drag a
      sold job's commission into an already-closed prior payroll period. Card = when-sold reporting view;
      commissions = when-the-job-entered-the-system. Aligning them is a separate money-sensitive decision.
- **Commission foundation (lean v1) — DONE:** the base for paying sales commissions (first payroll of each
  month, for everything sold the **previous month**), built on `is_real_job`.
  - **Salesperson = derived** per job (no manual override): the signed work-auth/recon `sign_requests.sent_by`,
    else the approved `estimates.created_by`. So the estimate-create flow now stamps `created_by`
    (**`NewEstimateModal`** passes `p_created_by: employee?.id`; it was previously null — why older sales are
    unattributed).
  - **`employees.commission_percent` / `commission_flat`** (both nullable) — the per-employee rate. A rate set
    ⇒ earns; both null ⇒ none (the rate **is** the "is a salesperson" flag). `commission_flat` (flat $/sale)
    wins over `commission_percent` (% of the job's invoice total) when both set.
  - **`get_commissions(p_month date)`** — SECURITY DEFINER RPC, **the one place commissions are ever computed**.
    One row per real job; period = month of **`jobs.created_at`** (NOT `real_job_marked_at` — the backfill
    stamped that to the migration date). Returns employee, job, division, base = `SUM(COALESCE(adjusted_total,
    total))`, commission, `commission_period`, `is_attributed`. Unattributed sales (no derived person, or no
    rate) are returned with `is_attributed = false` — **visible, not silently dropped**.
  - **Commissions effectively start now:** most historical jobs have no recorded salesperson, so they're
    unattributed; no backfill.
  - **Admin UI — DONE (migration `20260630_employee_commission_rates.sql`):** **Settings → Payroll →
    Commissions** (`CommissionsPanel` in `src/pages/Settings.jsx`) lists every employee with a Type
    (None / Percent / Flat) + Rate, saved per row. Reads `get_employee_commissions()`, writes
    `upsert_employee_commission(p_employee_id, p_percent, p_flat)` (percent XOR flat; both null clears it).
  - **Help guide — DONE:** "Estimates, Jobs, Sales & Commissions" (`src/pages/Help.jsx`) explains the whole
    flow in plain language for staff.
  - **Deferred (Phase 2, when payroll runs in-app):** a monthly commissions **report** reading
    `get_commissions`, and a `commission_payouts` lock table so paid amounts can't shift if an invoice is
    later edited. **Cut from v1 deliberately:** per-employee basis options and an `is_salesperson` flag
    (the rate is the flag).
- **Part B — planned (light up the empty widgets):** upstream features that populate the three
  wired-but-empty cards. **Plan: `DASHBOARD-PARTB-PLAN.md`** (repo root). Confirmed order: **B1 Jobs-completed
  lifecycle + B4 cross-widget polish first → B3 Hydro/drying (its own session)**. **B2 Open estimates is
  owned by a separate effort** — the widget reads `get_open_estimates_summary` and lights up automatically
  once `estimates` rows exist with an open `status` (no dashboard change needed).
- **Phase 4 — first-class "Remodeling" division shipped Jun 29 2026** (enum + `RM-` numbers + app-wide color/label maps + QBO mapping). The app-wide palette overhaul (recolor every division to the dashboard scheme) is still pending.
  **Ready-to-execute plan lives at `DASHBOARD-PHASE4-PLAN.md`** (repo root, dormant — start a session and say
  "execute DASHBOARD-PHASE4-PLAN.md", or rename to `*-TASK.md` to activate the Task File Protocol).

**Plan file (this session):** `/root/.claude/plans/yes-record-it-but-steady-kitten.md`.

---

## Database — All Tables (91 base tables live as of Jul 1 2026 — table count drifts fast with every
migration; verify via `upr_schema`/`upr_describe` MCP tools rather than trusting this number)

> **Fresh full inventory (2026-07-29): `docs/schema-v2/v1-map.md`.** Schema-v2 Phase P0 mapped
> every live object — **141 tables, 1,746 columns, 400 RPCs, 223 policies, 52 triggers** (extracted
> from a schema-snapshot-verified `qa-staging` branch, corroborated with read-only production
> statistics; this does not claim migration-ledger/rebase parity)
> — and classified each as used / dead / duplicated / band-aid from the code that touches it, with
> per-object evidence in `docs/schema-v2/domains/`. The per-table lists below remain the quick
> orientation reference; the map supersedes them for counts and for anything load-bearing. Two
> headline findings: only **37 of 223 policies do real authorization work** (139 are always-true
> band-aids), and **67 tables / 87 functions have no CREATE in any migration**
> (`docs/schema-v2/provenance-drift-2026-07-29.txt`). Classifications survived three passes —
> mapping, adversarial dead-claim verification, and a sweep against four non-app-code surfaces
> (executed runbooks, repair migrations, external-consumer annotations, doc-designated contracts)
> that reclassified 59 claims. Final: **18 dead tables, 268 dead columns, 17 dead RPCs**, plus 92
> uncertain columns and 15 uncertain RPCs awaiting owner answers. Still a **review queue, not a
> kill list**: §8 carries 55 kill-notes naming what a future DROP must carry — above all
> `merge_jobs()`, which sweeps a dozen dead tables by name and breaks at runtime if one is dropped
> without replacing it in the same migration.

### Core Business
```
jobs                    — 65 rows — Core job records
claims                  — 20 rows — Insurance claims (auto CLM-YYMM-XXX numbers)
contacts                — 18 rows — All contacts (homeowner/adjuster/vendor/sub/etc.)
contact_jobs            — Many-to-many contacts ↔ jobs (role + is_primary)
contact_addresses       — Multiple addresses per contact
contact_tags            — Tags on contacts
```

### Jobs & Phases
```
job_phases              — 30 rows — Phase definitions (4 macro groups)
job_phase_history       — Phase transition audit log
job_notes               — Internal job notes (column: body, not content)
job_documents           — Files attached to jobs (has appointment_id UUID nullable, description TEXT nullable — added Mar 28)
job_tasks               — Schedule tasks
job_schedule_phases     — Schedule phase groupings
job_schedules           — Job schedule records
job_assignments         — Job-to-employee assignments
job_checklists          — Checklist instances on jobs
job_costs               — Job cost line items
job_equipment           — Equipment on jobs
equipment_placements    — Equipment placed on a job (replaced the earlier planned job_equipment_costs,
                          which was never shipped — see Encircle Replacement Phase 2 Hydro below)
job_time_entries        — Time entries per job (has travel_minutes NUMERIC column — computed on clock-in from travel_start; Phase 5 added travel_start_lat/lng + clock_in_lat/lng NUMERIC(9,6) captured from iOS Geolocation). Time-Tracking PR-1 (Jun 26 2026) added split/lineage columns auto_continued BOOL, continued_from UUID→self, auto_split_seq INT, source TEXT (for the future midnight-split work), and a partial unique index uq_jte_one_open_clock_per_employee on (employee_id) WHERE clock_out IS NULL AND travel_start IS NOT NULL — enforces ≤1 open LIVE entry per employee (manual rows have travel_start NULL and are excluded).
job_number_sequences    — Auto-increment job number tracking
active_jobs             — View: currently active jobs
```

### Scheduling & Appointments
```
appointments            — Calendar appointments + events. kind TEXT ('job'|'event') added Apr 17 2026; job_id is nullable when kind='event'. CHECK constraint enforces: (kind='job' AND job_id IS NOT NULL) OR (kind='event' AND job_id IS NULL). Partial index idx_appointments_events_date on (date) WHERE kind='event'.
appointment_crew        — Crew assignments per appointment (also used for event tech assignment)
appointment_dependencies — Appointment ordering dependencies
schedule_blocks         — Blocked time on schedule
schedule_templates      — 3 rows — Reusable schedule templates
template_phases         — Phases within a schedule template
template_tasks          — Tasks within a template phase
template_dependencies   — Task dependency chains
checklist_templates     — Reusable checklists
on_call_schedule        — On-call rotation
todays_schedule         — View: today's appointments
dispatch_board_jobs     — View: jobs for dispatch board
```

### Messaging & Conversations
```
conversations           — conversation threads. Omni-inbox (Jul 4 2026) adds email_reply_token
                          (UNIQUE, >=128-bit random, backfilled) — the sole authoritative email-reply
                          correlator (reply+<token>@utahpros.app → this conversation)
messages                — SMS/MMS + EMAIL messages. Omni-inbox (Jul 4 2026) additive: direction
                          ('inbound'|'outbound'|'note', backfilled from type); channel now DEFAULT 'sms'
                          + CHECK widened to sms|mms|rcs|email; type CHECK widened to add email_inbound|
                          email_outbound; nullable email cols: email_message_id (UNIQUE partial),
                          in_reply_to, email_references, email_from, email_to, subject, email_html,
                          sender_email. SMS-experience F-core (Jul 9 2026) additive: num_segments int,
                          price numeric (Twilio metering; Phase A fills from the status callback).
conversation_participants — External customer/contact recipients; Omni-inbox adds nullable `email`.
                          This table is not internal staff membership.
conversation_member_overrides — Per-conversation internal staff include/exclude decisions.
                          Applied only to `qa-staging` on 2026-07-31; forced RLS, RPC-only.
conversation_default_members — Field technicians included by default in every conversation unless
                          a per-conversation override excludes them. Applied only to `qa-staging`
                          on 2026-07-31; forced RLS, RPC-only.
conversation_reads      — Read receipts per participant
conversation_tags       — Tags on conversations
scheduled_messages      — Queued outbound messages. SMS-experience F-core (Jul 9 2026) additive:
                          claimed_at timestamptz (legacy compare-and-set marker). Scheduled-message
                          delivery hardening (Jul 31 2026) is authored only, not applied: adds nullable
                          `claim_token` (current-worker fence) and `delivery_attempt_id` (unique,
                          irreversible message_send_attempt link). `create_scheduled_message` derives
                          the active internal actor and accepts a stable client UUID only for that
                          actor's accessible conversation with exactly one active customer recipient;
                          identical retry returns the existing row and divergent reuse fails.
                          `cancel_scheduled_message` and `get_scheduled_queue` are exact DevTools-owner
                          contracts. Compatibility requires exact participant enforcement, aborts with
                          SQLSTATE `55000` without mutation when any pending row exists, and creates a
                          FORCE-RLS creator/conversation/body/send-time/recipient provenance ledger while
                          closing raw browser queue writes. Enforcement leaves legacy policies inert behind
                          revoked ACLs and revokes legacy execution. No native scheduling caller is introduced.
message_templates       — 10 rows — SMS templates
sms_consent_log         — TCPA opt-in/out audit log
                          Live `attest_prior_sms_consent` RPC (applied Jul 23 2026) atomically
                          records verified verbal/signed-work-authorization/other prior permission
                          with consent date, evidence, employee actor and server timestamp in
                          browser-inaccessible current + append-only tables. The legacy log keeps
                          only a redacted event/opaque evidence reference. Service-role-only;
                          refuses DND, explicit opt-out, duplicate suppression and pending STOP.
-- NOTE (SMS-experience F-core, Jul 9 2026): the 5 SMS tables above (conversations, messages,
-- conversation_participants, sms_consent_log, scheduled_messages) had drifted in with NO CREATE TABLE
-- in migrations; 20260709_sms_f01_drift_capture.sql now captures their exact live shape (schema-as-code
-- baseline, no-op on live). messages/conversations realtime-publication membership + messages.twilio_sid
-- UNIQUE are now tracked too (…f02). Anon-policy closure on messages/conversations/participants is
-- DEFERRED to F-red (owner-gated) — the drift-capture reproduces the live anon surface, does not close it.
email_suppressions      — do-not-email list. Omni-inbox widens reason CHECK: adds hard_bounce|complaint|
                          global (kept legacy unsubscribed|bounced|complained|manual). Fed by unsubscribe
                          clicks + the Resend bounce/complaint webhook (resend-webhook.js)
email_inbound_events    — Omni-inbox (Jul 4 2026): email-event idempotency ledger (message_key UNIQUE).
                          RLS on, authenticated-only policy; anon reaches it only via claim_inbound_email
campaigns               — SMS/marketing campaigns
campaign_recipients     — Recipients per campaign
notification_queue      — Queued notifications
```
**Omni-inbox Foundation (Phase F, Jul 4 2026):** adds inbound+outbound EMAIL to the SMS-only
conversation model, unified per-contact. Docs: `docs/omni-inbox-roadmap.md`,
`.claude/rules/omni-inbox-wave-ownership.md`. Feature-flagged `feature:email_inbox` (owner-only).
Later phases: I (inbound Email Worker), O (send-message.js email branch), U (unified UI).

**Conversation participant controls — RELEASE CANDIDATE; QA AUTHORITY CORRECTION LIVE (2026-08-01):**
`20260731040337_conversation_participant_scoping.sql` is applied only to Supabase branch
`qa-staging` (`uizgwvkvzyldystqrcsk`) as ledger `20260731143710`; production is untouched. Its
original appointment-derived decision is superseded on QA by
`20260731213000_conversation_assignment_authority_containment.sql`, applied from exact committed
source (SHA-256
`0c7b8769f53bbb45fd7d6127b86b88d53c4fc3101d3b7b72e2b6f51bb5c87f51`) as ledger
`20260801144448`. Appointment, job, claim, and
crew records are browser-writable scheduling context and are never conversation authorization.
The correction replaces the four independent access/member/contact bodies with the trusted rule:
privileged role → explicit per-chat choice → default technician → deny, after exact
employee-identity and lineage preflights. Admin RPCs manage per-chat/default membership, a
non-privileged participant may persist their own exclusion, the inbox and message author directory
retain their deployed signatures, and service-only helpers support scoped
creation/search/notification recipients. Post-apply catalog checks for the original foundation proved forced RLS, no
anonymous/authenticated membership-table reads, intended RPC ACLs/signatures, zero membership rows,
and exactly one foundation ledger row. Earlier guarded SQL behavior proof for the superseded
`40337–40339` train passed on a disposable local clone and remains historical evidence only. It
does not prove the corrected sources. Earlier corrected participant and scheduled-delivery
revisions subsequently passed on a disposable local Supabase clone with both fixture transactions
rolled back. The exact current source adds authorized-media, explicit-deny-policy, legacy-no-op,
and matching behavioral assertions; the full governed database runner remains a release gate.

`20260731040338_conversation_unread_state_compatibility.sql` is also applied only to
`qa-staging`, as ledger `20260731181046`, from reconciled candidate `487ec641` (source SHA-256
`727669d58ed55ccac46673c4db3f8ac354406f00b791097ef44d98b1a9e88e3d`). Catalog checks proved
its actor-derived access-snapshot and unread-state RPCs have pinned search paths, deny `anon`, and
retain only the intended `authenticated, service_role` execution. An authorized empty-input,
nonexistent-conversation denial, and unmapped-actor denial proof ran inside a rolled-back
transaction with no retained row change.
`20260731213100_conversation_participant_policy_enforcement.sql` remains authored and unapplied
everywhere. It follows `31213000`, narrows the existing protected-table policies in place, revokes
authenticated direct writes, and requires the exact policy/ACL allowlist.
Candidate code now uses scoped contact search/creation, actor-derived unread changes, canonical
notification recipients, send-time membership checks, a short successful-access lease that
purges warm inbox previews plus thread/draft data when offline authorization cannot be renewed, admin
per-chat/default controls, technician self-leave, sender labels, and 18px mobile message text.
UI close-out keeps participant tabs as an ordinary `aria-pressed` button group, locates all
conversation styling in the global reserved marker, uses shared loading/error primitives, keeps
contact/job navigation inside React Router, and pauses private-media signed-URL refresh while the
WebView is hidden before resuming through the shared lifecycle subscription. Retry haptics fire
only for pointer activation, programmatic scrolling honors Reduce Motion, tech/mobile retry and
attachment actions meet the 48/44px target rules, empty participant tabs are explicit, and async
private-attachment state is politely announced.
Desktop and tech access proof now starts when the actor-scoped request starts, so a response that
arrives after the 30-second boundary is rejected instead of receiving a fresh receipt-time lease.
Desktop inbox probes are also monotonic: an older poll/resume result cannot commit after a newer
proof. Silent refresh retains existing list order and exact row identity when fields are unchanged,
while still removing authoritative omissions and appending genuinely new conversations.
A successful inbox omission clears every removed conversation draft and desktop lease; tech
filtered/capped omissions are never treated as revocation. Tech revalidates omitted or standalone
sensitive cache IDs in batches of at most 200 through the actor-derived
`get_my_conversation_access_snapshot` RPC. Filtered hooks check only their exact prior-page
omissions; the always-mounted unfiltered hook also checks current-generation thread/member/access/
draft IDs outside the capped top 50 every 15 seconds. Allowed IDs renew independent request-start
leases, while omitted snapshot IDs receive an in-place access tombstone and immediately lose
their thread, member cache, inbox row, and draft. Expiry applies per ID and never erases a newer
proof or detaches an active React Query observer; a newer positive proof replaces an older
tombstone before the row can be reopened. Account-generation invalidation makes late responses
and timers from a signed-out account inert. Expiry also leaves an explicit unverified marker, so
neither desktop nor tech can render a successful “No conversations” state while access
revalidation is pending or failed; only a fresh accepted proof clears it. Tech background/resume
refreshes preserve the existing exact-key order and unchanged row identity, append new rows, and
remove rows no longer returned for that view.
Hidden→visible synchronously removes expired desktop and tech inbox
rows/previews before network revalidation starts, including the no-active-thread list state.
The QA-applied 40338 completes the standard `authenticated, service_role` RPC grants without
rewriting the exact 40337 source already staged on QA. The separately gated 31213100 alters the
existing `ALL` policies in place to participant-scoped
`USING` predicates with `WITH CHECK (false)`, revokes direct browser writes, and explicitly
preserves service-role table access.
`npm run build:ios:dev` and the unsigned Xcode iOS Simulator build passed on 2026-07-31. The
compiled app then launched on an iPhone 17 Pro Simulator and visually proved the sender labels,
readable bubbles, title-expanded info panel, and native participant sheet. Its participant RPC
showed the expected load error because that app points at production, where 40337 is deliberately
unapplied; no production data was changed.
QA post-apply verification for `31213000` matched all four reviewed body hashes, owners, pinned
search paths, volatility settings, and ACLs; every body excludes appointment/job/claim/crew
authority and the aggregate pending scheduled count remains zero. Production must still apply
`40337 → 40338 → 31213000` in one exposure-free authorized window. Next deploy compatible web and
supported native callers. Only after older direct-unread writers are unsupported may `31213100` apply in a
separately reviewed window. Hardened scheduled callers deploy immediately before the serialized
scheduled window. Auth/database/provider calls are bounded, and a reserved scheduled send cannot
fall back to a cached/environment Twilio credential after managed credential lookup timeout.
After the aggregate pending count is verified zero, apply
`31220000 → 31220100`. Reverse recovery is
`31220100 → 31220000 → 31213100 → 31213000 → 40338 → 40337`; every step is a browser-sealed
recovery pause and preserves reservation/provenance evidence.
Read-only evidence on 2026-07-31 found exactly one legacy production pending scheduled row, so
production currently stops at the zero-pending gate until a separately authorized owner decision.
The seeded `qa-staging` catalog remains healthy and usable, but its `MIGRATIONS_FAILED` badge
reflects the real historical ledger/replay gap documented in the staging runbook. Do not clear it
through rebase or ad-hoc ledger writes. `40337/40338/31213000` are now ledgered for this train;
target the exact branch ref and keep later QA applies serialized.
Nothing has been applied to production or deployed from this candidate.

### Documents & Esign
```
sign_requests           — Esign requests (token, status, open tracking). Recon agreement adds:
                          consent_terms, consent_commitment, consent_esign, consent_authority BOOLEAN (all nullable),
                          consents_signed_at TIMESTAMPTZ — populated by complete_sign_request when consents are attested.
work_authorization_sms_consents
                        — Repository-only, not applied: immutable service-role-only evidence keyed
                          by a signed UPR Work Authorization, with contact/job/phone/private signer IP/PDF/time and
                          pinned SMS disclosure identity. Consumed only as narrow SERVICE_CONSENT;
                          never global opt-in and never a send/retry.
document_templates      — 24 rows — (CoC×5 divisions, work_auth, direction_pay, change_order,
                          recon_agreement×16 legal sections with sort_order 1–16)
document_requests       — Document request records
forms                   — Multi-form storage (form_type enum: demo_sheet, mold_protocol, fire_scope,
                          contents_inventory, reconstruction_scope, inspection, custom). Columns:
                          id, created_at, updated_at, job_id, submitted_by, form_type, form_version,
                          form_date, technician_name, status (draft|submitted), encircle_claim_id,
                          encircle_note_id, encircle_synced_at, email_sent, email_sent_at,
                          form_data JSONB, summary JSONB. RLS permissive (allow_authenticated_forms).
demo_sheets             — VIEW over forms WHERE form_type='demo_sheet' (legacy flat shape, read-only).
                          The TechDemoSheet page reads/writes `forms` directly via RPCs.
rooms                   — Per-CLAIM physical rooms (water/mold/recon share same structure).
                          Columns: id, claim_id (FK claims, CASCADE), name, area_sqft, ceiling_height_ft,
                          sort_order, client_id UUID UNIQUE (offline idempotency key),
                          created_by (FK employees), created_at, deleted_at (soft),
                          encircle_room_id BIGINT, encircle_structure_id BIGINT (added later, undated —
                          links a room back to its Encircle source when imported).
                          Added Apr 17 2026 as part of Encircle replacement Phase 1.
                          NOTE: Earlier draft had job_id; refactored to claim_id on Apr 17 so jobs
                          under the same claim share rooms.
job_documents           — Extended Apr 17 with `room_id UUID` (FK rooms, ON DELETE SET NULL).
                          Tags photos/notes to a specific room for Encircle-style grouping.
                          `insert_job_document` RPC accepts p_room_id as final optional param.
```

**Supported eSign doc_types:** `coc`, `work_auth`, `direction_pay`, `change_order`, `recon_agreement`.
Only `recon_agreement` uses the four separately-attested consent columns + the expandable ReconAgreementContent signer layout.

### Financial
```
invoices                — Invoice records
invoice_line_items      — Line items per invoice (line_total is a GENERATED column = quantity*unit_price — never write it)
invoice_adjustments     — Invoice adjustment audit log
payments                — Payment records
stripe_events           — Stripe webhook idempotency ledger (RLS-locked, service-role only). Added Jun 20 2026 (Stripe S3)
billing_2fa_codes       — One-time email-2FA codes for editing payout destinations (RLS-locked). Added Jun 20 2026
estimates               — Estimate records. PRE-SALE, line-item, QBO-synced (Jun 25 2026, decoupled same day).
                          Owned by a CONTACT (contact_id) + intended_division + optional property_address/city/
                          state/zip; job_id is NULLABLE and stays NULL until SOLD. amount/subtotal roll up from
                          estimate_line_items. estimate_type initial/supplement/change_order/final. QBO cols
                          qbo_estimate_id/synced_at/sync_error/doc_number/emailed_at/email_status/sent_to_email.
                          converted_invoice_id (FK invoices) set on convert — which silently auto-creates a
                          claim+job then the invoice. status draft/submitted/under_review/approved/denied/
                          revised/paid.
estimate_line_items     — Line items per estimate (Jun 25 2026). Clone of invoice_line_items; line_total is a
                          GENERATED column (quantity*unit_price) — never write it. qbo_item_id/name +
                          qbo_class_id/name per line. Copied into invoice_line_items on convert-to-invoice.
vendor_invoices         — Vendor invoice tracking (also used by Netlify vendor app)
vendors                 — Vendor records
oop_quotes              — OOP Pricing Calculator quotes (Apr 20 2026). Auto-generated
                          quote_number TEXT UNIQUE (format OOP-YYMM-XXX, Denver month,
                          next suffix derived under an advisory transaction lock).
                          job_id UUID nullable FK jobs (ON DELETE SET NULL).
                          job_type TEXT CHECK ('water','mold').
                          Inputs: tech_hours, bill_rate, (count,days) × 5 equipment types
                          (air_mover, lgr, xlgr, air_scrubber, neg_air — neg_air mold only),
                          materials_actual_cost, antimicrobial_sqft, disposal_trips,
                          containment_linear_ft + prv_invoice_cost (mold only).
                          Legacy snapshots: quote_total and net_margin_pct. The live builder
                          migration leaves this table's columns and grants unchanged and replaces
                          its policies with the exact calculator role/flag predicate. Configured
                          quotes keep revision, normalized inputs,
                          full config, evaluated lines, engine version and minimum adjustment in
                          private oop_quote_pricing_snapshots rows keyed by quote_id. Denormalized
                          insured_name + address support standalone quotes without a linked job.
```

### Selections & Subs
```
selection_dispatches    — Material/finish selection dispatches
selection_responses     — Sub/vendor responses to selections
sub_confirmations       — Subcontractor job confirmations
```

### Admin & Config
```
employees               — 15 rows as of Jul 1 2026 (8 auth-linked, 7 unlinked) — Staff. Row count drifts
                          with hiring — see the Employees section below or query live for current roster.
nav_permissions         — 66 rows — Role-based nav access
feature_flags           — 20 rows as of Jul 1 2026 — Feature flag controls (has force_disabled BOOLEAN column — kills page for everyone including admins). Apr 17 additions (all dev-only for Moroni): page:tech_rooms, page:tech_moisture, page:tech_equipment, page:water_loss_report, offline:queue. Time-Tracking PR-2 (Jun 26 2026) added clock_enforce_explicit_clockout (category time_tracking, default OFF) — read BACKEND-side by clock_omw_precheck + clock_appointment_action; when ON, going On-My-Way while clocked in on another job is hard-blocked (OPEN_ENTRY_EXISTS) instead of auto-superseding. NOTE: the client reads its raw `enabled` (not isFeatureEnabled, which fails-open to true).
oop_pricing_revisions   — **LIVE (ledger `20260731175328`, Jul 31 2026)** — one editable draft plus
                          immutable published/superseded calculator price lists.
oop_pricing_audit       — Idempotent admin draft-save/publish audit rows.
oop_quote_save_requests — Stable request ledger for replay-safe configured quote saves.
oop_quote_pricing_snapshots — Private configured-quote revision, inputs, config, evaluated lines,
                          engine version and project-minimum adjustment keyed by quote_id.
                          All four tables are forced-RLS with no direct browser-role grants.
employee_page_access    — Per-employee page overrides (employee_id, nav_key, can_view, updated_by, updated_at)
device_tokens           — Native push tokens (employee_id, token UNIQUE, platform 'ios'|'android'|'web', created_at, updated_at) — used by send-push worker. **RLS (Jul 31 2026):** enabled+forced with zero policies and no direct `anon`/`authenticated` table grants; native registration/deletion use selector-free SECURITY DEFINER RPCs and workers read via service role. **apns_topic (LIVE, ledger `20260731154315`):** nullable text column recording the installed app's bundle id per token (see "Per-token APNs topic" section); legacy rows remain NULL until clients re-enroll and therefore use the environment fallback.
employee_onboarding_state — **LIVE (applied Jul 30 2026, ledger `20260730115220`)** — per-employee versioned first-run
                          onboarding flag (employee_id + surface PK, version_seen, updated_at). Deny-all
                          RLS (enabled+forced, zero browser-role grants); reached only via the two
                          selector-free definer RPCs (see "Tech first-run onboarding" RPC section).
automation_rules        — Workflow automation rules
insurance_carriers      — 29 rows — Carrier lookup table
referral_sources        — 49 rows — Referral source lookup table
```

### Logging & Monitoring
```
system_events           — Entity audit log (event_type, entity_type, entity_id, actor_id, job_id, payload)
worker_runs             — Worker execution log (worker_name, status, records_processed, error_message, started_at, completed_at)
escalation_log          — Escalation audit log
email_sync_log          — Email sync records (vendor invoice app)
upr_mcp_audit           — UPR MCP tool-call audit (actor_email, tool, arguments jsonb, status, result, error, created_at) — written by the upr-mcp worker via service role
```

---

## All RPCs (use `db.rpc()` — SECURITY DEFINER, bypasses PostgREST schema cache)

### Jobs & Claims
```
create_job_with_contact(...)    — Atomic job + contact (+ claim) creation. Optional trailing p_existing_claim_id UUID (added Jun 29 2026): when set, files the new job under that EXISTING claim (reuses it, skips the claims INSERT) instead of always minting a fresh CLM-…; NULL (default) = unchanged behavior. Now a 32-arg signature — DROP+CREATE'd in one migration (20260629_create_job_with_contact_existing_claim.sql) to avoid a second PostgREST overload (PGRST203). Both callers (TechNewJob mobile, CreateJobModal desktop) use named args so they bind unchanged. TechNewJob's existing-claim picker is scoped to the selected contact's claims via get_customer_detail(p_contact_id).data.claims; on save TechNewJob now opens /tech/jobs/:id and only pushes to Encircle for new claims.
add_related_job(...)            — Sibling job under same claim
get_claim_jobs(p_claim_id)      — {claim, jobs[]}
get_claim_detail(p_claim_id)    — Full claim detail
get_claims_list(...)            — Paginated claims list. Sorted by last_activity_at DESC NULLS LAST, then created_at DESC. last_activity_at = GREATEST of MAX(appointments.updated_at), MAX(job_documents.created_at), MAX(system_events.created_at WHERE event_type NOT LIKE '%.created'), MAX(job_time_entries.updated_at), all joined via jobs.claim_id. Frozen bulk-import sources (claims.updated_at, jobs.updated_at, *.created events) are excluded — they set every row to the same import timestamp and would hide real activity.
get_tech_claims(p_employee_id)  — Claims where tech is on appointment_crew. Same last_activity_at computation and tiered sort as get_claims_list.
get_job_contacts(p_job_id)      — Contacts linked to a job
link_contact_to_job(...)        — Link contact with role
search_contacts_for_job(...)    — Typeahead contact search
sync_job_to_claim(...)          — Sync job fields to parent claim
get_ar_jobs(...)                — Accounts receivable jobs view
generate_job_number()           — Next job number
generate_claim_number()         — Next CLM-YYMM-XXX
log_phase_change(...)           — Write to job_phase_history
log_system_event(...)           — Write to system_events
insert_job_document(p_job_id, p_name, p_file_path, p_mime_type, p_category, p_uploaded_by, p_appointment_id DEFAULT NULL, p_description DEFAULT NULL) — Insert job_documents row with optional appointment link and description
```

### Contacts & Customers
```
get_customers_list(...)         — Nested claims → jobs view
get_customer_detail(p_id)       — Full customer detail
get_contact_addresses(p_id)     — Contact's addresses
upsert_contact_address(...)     — Save contact address
delete_contact_address(p_id)    — Delete contact address
```

### Schedule & Appointments
```
get_appointments_range(...)     — Appointments in date range
get_appointment_detail(p_id)    — Full appointment detail
get_appointment_tasks(p_id)     — Tasks on appointment
get_tasks_for_appointment(p_id) — Alternate tasks fetch
update_appointment(...)         — Edit appointment
delete_appointment(p_id)        — Remove appointment
upsert_appointment_task(...)    — Save appointment task
toggle_appointment_task(...)    — Toggle task complete
get_job_schedule(p_job_id)      — Schedule for one job
get_job_schedules(...)          — All job schedules
get_my_appointments_today(...)  — Today's appointments for employee
get_dispatch_board(p_start_date, p_end_date, p_auto_show) — Dispatch board data (kind='job' appointments only — joins to jobs so events naturally excluded). Each job row includes claim_id + date_of_loss (from the linked claim, via j.claim_id; added Jun 18 2026 for the schedule job picker).
get_dispatch_events(p_start_date, p_end_date) — Returns non-job calendar events (kind='event') with assigned crew; shape mirrors per-appointment object in get_dispatch_board. Added Apr 17 2026.
get_dispatch_panel_jobs(...)    — Jobs panel for dispatch. Returns id, insured_name, job_number, division, phase, address, date_of_loss (from linked claim, added Jun 18 2026), on_board, in_production, appointment_count.
get_schedule_templates()        — All schedule templates
get_schedule_template(p_id)     — Single template detail
apply_schedule_plan(...)        — Create tasks/phases from template
preview_schedule(...)           — Preview before applying
```

### Tasks
```
get_job_task_pool(p_job_id)     — Tasks grouped by phase
get_job_task_summary(p_job_id)  — Task progress stats
get_unassigned_tasks(...)       — Tasks not on calendar (returns grouped — must flatten)
assign_tasks_to_appointment(...)
toggle_job_task(p_id)           — Toggle + unassigns if un-completing
add_adhoc_job_task(...)         — Ad-hoc task (auto-links job_schedule_phase_id)
add_custom_schedule_phase(...)  — Add custom phase to job schedule
finish_appointment(...)         — Release incomplete tasks
```

### Employees & Time
```
clock_appointment_action(p_appointment_id, p_employee_id, p_action, p_lat NUMERIC DEFAULT NULL, p_lng NUMERIC DEFAULT NULL, p_accuracy NUMERIC DEFAULT NULL) — Atomic time tracking (omw/start/pause/resume/finish). Coords are optional; on 'omw' they populate travel_start_lat/lng on the new entry, on 'start' they populate clock_in_lat/lng. ONE function only — the legacy 3-arg overload was dropped Jun 9 2026: having both overloads made 3-key RPC calls ambiguous (PostgREST PGRST203, HTTP 300) and blocked all clock actions for techs on older app bundles. 3-key calls now resolve to this function via the DEFAULT NULL geo params. Never re-create a second overload of this function. On 'omw', auto-closes any other open entries for the same employee with hours capped at LEAST(24, ...). Time-Tracking PR-1 (Jun 26 2026) fixed the close loop: it now closes ALL open LIVE entries (clock_out IS NULL AND travel_start IS NOT NULL) — previously it required clock_in IS NOT NULL, so "en-route only" rows orphaned forever; en-route-only rows now close with hours 0 and travel_minutes captured from travel_start, arrived rows also stamp on_site_end. If auto-closed entry was stale (>24h since clock_in), logs a 'time_entry.auto_closed_stale' row to system_events (payload: previous_appointment_id, new_appointment_id, clock_in, auto_closed_at, raw_hours, capped_hours, reason). Time-Tracking PR-2 (Jun 26 2026) added a flag-gated hard-block at the top of the omw branch: if clock_enforce_explicit_clockout is ON and an open live entry exists on a DIFFERENT appointment, RAISE OPEN_ENTRY_EXISTS (P0001) instead of auto-closing; flag OFF (default) → unchanged auto-close. Signature unchanged (still 6-arg). Phase 5 layers a foreground "away from jobsite" nudge on top (see get_active_appointment_geo) — future work can add true geofence-based auto-finish.
clock_omw_precheck(p_appointment_id, p_employee_id) — Time-Tracking PR-2 (Jun 26 2026). READ-ONLY. Returns jsonb { requires_confirmation, enforce_explicit, open_entry } telling the client whether tapping On-My-Way would supersede another open clock. requires_confirmation = open live entry on a DIFFERENT appointment exists AND flag OFF; enforce_explicit = same condition AND clock_enforce_explicit_clockout ON; open_entry = { entry_id, appointment_id, title, job_id, job_number, insured_name, travel_start, clock_in, status (omw|on_site|paused), elapsed_minutes } or null. Client (src/lib/clockPrecheck.js → ClockSupersedeSheet) calls this before omw; fail-open.
apply_midnight_clock_split() — Time-Tracking PR-3 (Jun 26 2026). SECURITY DEFINER, REVOKED from anon/authenticated (cron/admin-SQL only). Runs nightly via pg_cron just after Denver midnight: for every open LIVE entry whose work_date is a prior day, caps clock_out at 23:59:59 Denver of that work_date (arrived → on-site hours via the finish formula; en-route-only → hours 0 + travel_minutes from travel_start) and reopens a continuation at next-day 00:00 (auto_continued=true, continued_from, auto_split_seq+1, source='auto_split'). STOP-LOSS: a row already auto_continued with auto_split_seq>=1 (untouched) is capped but NOT reopened, flagged notes '[abandoned: needs review]', and create_notification fires an admin alert ('time_entry.abandoned_clock'). Logs a worker_runs row. Date-filtered + idempotent (safe to run anytime; today's open clocks untouched). pg_cron is ENABLED (Jun 26 2026); jobs upr_midnight_clock_split_0610 / _0710 (10:6 & 10:7 UTC = ~00:10 Denver across MST/MDT) call it.
clock_finish_entry(p_entry_id, p_employee_id) — Time-Tracking HOTFIX (Jun 26 2026). SECURITY DEFINER, owner-checked (employee_id must match), GRANT to anon/authenticated. Finishes an open entry BY ID (appointment-independent): arrived → on-site hours from clock_in minus pauses (cap 0..24); en-route-only → hours 0 + travel_minutes from travel_start; sets appointment 'completed' only if it still exists. Recovers a clock whose appointment was deleted (stranded, appointment_id null). TechDash 5 PM banner calls this when openClock.appointment_id is null ("Clock out now"), else navigates to the appointment. Prevention: BEFORE DELETE trigger trg_close_open_clocks_before_appt_delete on appointments (fn close_open_clocks_on_appt_delete) auto-closes any open LIVE entry on an appointment before it is deleted, so the ON DELETE SET NULL FK (job_time_entries_appointment_id_fkey) can never strand an open clock again.
get_assigned_tasks(p_employee_id) — Incomplete tasks for employee with job context
get_all_employees()             — All employees with auth status
get_payroll_summary(...)        — Payroll summary
get_timesheet_entries(...)      — Time entries for payroll
get_timesheet_entries_admin(p_start_date, p_end_date, p_employee_id, p_job_id, p_status, p_division) — Time-Tracking PR-5 (Jun 27 2026). Richer admin read for the office Time Tracking page; SECURITY DEFINER, additive (get_timesheet_entries left intact). Returns all get_timesheet_entries columns PLUS travel_start, on_site_end, travel_minutes, total_paused_minutes, auto_continued, and computed duration_minutes (travel+on-site mins), is_open (clock_out null AND travel_start not null), is_overlong (hours + travel/60 > 12). Filters: p_employee_id (null=all), p_job_id, p_division (cast j.division::text — division is the job_division ENUM), p_status ('open'|'approved'|'unapproved'|'overlong'|null). PR-6 added has_pending_change (exists a pending time_entry_change_requests row).
is_time_admin(p_employee_id) — Time-Tracking PR-6 (Jun 27 2026). Boolean: role in {admin,office,project_manager,supervisor} (estimator + field_tech excluded). Used by all admin write RPCs.
admin_upsert_time_entry(p_actor_id, p_id, p_employee_id, p_job_id, p_work_date, p_hours, p_clock_in, p_clock_out, p_travel_start, p_on_site_end, p_travel_minutes, p_total_paused_minutes, p_work_type, p_description, p_notes, p_override_approved) — PR-6. Admin-only add/edit (NULL p_id = insert). Validates chronology (travel_start ≤ clock_in ≤ on_site_end ≤ clock_out), enforces single-open invariant (OPEN_ENTRY_EXISTS), approved-lock (ENTRY_APPROVED_LOCKED unless p_override_approved), sets auto_continued=false, logs system_events. Never sets total_cost (generated); relies on calc_time_entry_cost trigger to fill hourly_rate.
admin_clock_out_entry(p_id, p_actor_id, p_clock_out=now()) — PR-6. Admin-only; closes an open entry (finish formula for arrived, hours 0 + travel for en-route).
delete_time_entry(p_id, p_reason, p_actor_id) — PR-6. Admin-only HARD delete; rejects approved rows (ENTRY_APPROVED_CANNOT_DELETE); snapshots full row → time_entry_deletions + system_events BEFORE delete.
submit_time_entry_change_request(p_entry_id, p_proposed jsonb, p_tech_note, p_actor_id) — PR-6. Owner-only (NOT_OWNER otherwise); creates a pending time_entry_change_requests row, no mutation, notifies office via create_notification. proposed keys: work_date,hours,clock_in,clock_out,travel_minutes,description,notes.
review_time_entry_change_request(p_request_id, p_approve, p_actor_id, p_review_note) — PR-6. Admin-only; approve → applies proposed via admin_upsert_time_entry (override_approved) + marks approved; reject → marks rejected; notifies the tech; logs system_events.
NEW TABLES (PR-6): time_entry_change_requests (entry_id→job_time_entries ON DELETE CASCADE, requested_by, proposed jsonb, tech_note, status pending|approved|rejected, reviewed_by/note/at; partial unique index = one pending per entry; RLS on, SELECT to anon/authenticated, writes via RPC only) · time_entry_deletions (entry_id, snapshot jsonb, reason, deleted_by, deleted_at; audit trail for hard deletes).
TIME-TRACKING PR-7 (Jun 27 2026, client-only) — `src/pages/TimeTracking.jsx` admin UI rebuilt on the PR-5/PR-6 surface. The **Timesheet** tab now reads `get_timesheet_entries_admin` (was `get_timesheet_entries`), defaults to the current **semi-monthly** period (1st–15th / 16th–EOM, + Last Period preset), and adds **division** + **status** (open/unapproved/overlong/approved) filters. Admin-tier (role ∈ {admin,office,project_manager,supervisor}) gets: **inline cell edit** on hours + work_date (optimistic → `admin_upsert_time_entry` partial update → revert+toast on error); per-row **Clock out** (`admin_clock_out_entry`), **Edit** (modal, supports clock_in/out/travel_start/on_site_end/travel_minutes), **Duplicate**, **Backfill** (insert), **Delete** (inline reason → `delete_time_entry`); **bulk** approve/unapprove (`approve_time_entries`), bulk clock-out, bulk delete-with-reason; **Unapprove & edit** one-click on approved rows; row **badges** OPEN/12h+/auto/edit-pending/approved-lock. New **Requests** tab (admin only, with pending-count tab badge) lists pending `time_entry_change_requests`, shows a current→proposed **diff** + tech note, Approve/Reject via `review_time_entry_change_request`. **Field techs** (non-admin) see only their own rows and a **Request a Change** modal → `submit_time_entry_change_request` (no direct add/edit/delete; By Job + Payroll tabs hidden). **Realtime**: subscribes to `job_time_entries` + `time_entry_change_requests` via `realtimeClient` (realtime.js untouched), debounced reload. New components in the same file: `RequestsView`, `RequestModal`; `EntryModal` extended with clock-time fields; helper `useRealtimeReload`. New CSS: `.tt-tab-badge`, `.tt-badge` (open/danger/muted/edit), `.tt-inline-input`, `.tt-req-card/-head/-note/-diff`, `.tt-diff-*`. All writes go through the `admin_*`/`*_time_entry` RPCs only (no direct PostgREST writes — prereq for PR-8 RLS hardening).
TIME-TRACKING PR-8 (Jun 27 2026, DB-only) — **`job_time_entries` RLS hardened.** Dropped the wide-open `allow_authenticated_job_time_entries` (cmd=ALL, USING true) + `allow_anon_read_job_time_entries` policies; replaced with a single `jte_select_all` (FOR SELECT TO anon, authenticated USING true). There is now **no write policy**, so direct PostgREST INSERT/UPDATE/DELETE by anon/authenticated are rejected (insert → RLS violation; update/delete → 0 rows). All writes continue to flow through SECURITY DEFINER functions owned by postgres (which bypass RLS): clock_appointment_action, clock_finish_entry, apply_midnight_clock_split, admin_upsert_time_entry, admin_clock_out_entry, delete_time_entry, approve_time_entries, upsert_time_entry, merge_jobs, and the appointment BEFORE DELETE trigger close_open_clocks_on_appt_delete. Reads stay open (tech app, office page RequestsView diff, MergeModal, realtime all SELECT directly). Migration `supabase/migrations/20260627_pr8_job_time_entries_rls.sql`. Validated on prod's real role config via an isolated throwaway harness (authenticated: direct INSERT denied, UPDATE/DELETE 0 rows, SELECT + definer write OK) before apply; `get_advisors(security)` shows no new findings for the table. Completes the time-tracking plan (PR-1→PR-8). Rollback: re-create the ALL policy `using(true) with check(true)`.
TIME-TRACKING REDESIGN (Jun 27 2026, client-only) — `src/pages/TimeTracking.jsx` restyled to the shared **"My Money / Collections"** design language (`.coll-*` + `src/components/collections/collKit.jsx`/`collTokens.js`) so it matches the Overview dashboard, Collections page, and Invoice builder. Page is now `.coll-page` with a `.coll-header`, a dark-pill **SegControl** tab row (Status Board / Timesheet / Requests[+count badge] / By Job / Payroll) + a small period SegControl (semi-monthly default retained). Each tab uses **KpiGrid/Kpi** tiles (Open clocks + Pending approval are click-to-filter), a `.coll-toolbar` (SearchBox + status SegControl + a Filters PopoverButton with employee select + division ToggleChips), and grid-based `.coll-thead`/`.coll-row` tables with DivisionSquare dots and kit `Pill` badges (OPEN/12h+/AUTO/EDIT/APPROVED). Timesheet keeps employee group sub-header bars (`.tt-group-bar`). **No behavior change** — all PR-7/PR-8 logic preserved (inline edit hours/date → admin_upsert_time_entry, row Clock-out/Edit/Duplicate/Backfill/Delete-with-reason, bulk approve/clock-out/delete, Unapprove&edit, RequestsView diff + review, field-tech Request-a-change, realtime). Modals (EntryModal/RequestModal), inline-edit inputs and the request diff keep their existing `tt-*` classes. New CSS: `.coll-select`, `.coll-datein`, `.coll-check`, `.tt-group-bar` (appended to the `.coll-` block in index.css). The page now imports the page-scoped collections kit/tokens (first reuse outside Collections — sanctioned for this redesign).
STATUS-BOARD CLOCK ACTIONS (Jun 27 2026, client-only) — `src/components/StatusBoard.jsx` gained admin-only per-row actions: **Clock out** (two-click confirm → `admin_clock_out_entry`) and **Edit clock-in** (inline datetime-local → `admin_upsert_time_entry` with p_clock_in only). The board RPC (`get_tech_status_board`) doesn't carry the open entry id, so the board now also fetches open LIVE entries (`job_time_entries` where clock_out IS NULL AND travel_start IS NOT NULL) and maps them by employee_id (one per employee via the single-open invariant) to drive the actions. Actions render only for admin-tier viewers (role ∈ {admin,office,project_manager,supervisor}) and only on rows with an open clock; "Edit in" shows once clock_in is set (on_site/paused), OMW-only rows show just "Clock out". Reads rely on the PR-8 `jte_select_all` SELECT policy; writes go through the SECURITY DEFINER admin RPCs. Refetches board + open clocks after each action. No DB change.
get_job_labor_summary(p_job_id) — Labor cost per job
upsert_time_entry(...)          — Save time entry
approve_time_entries(...)       — Bulk approve
calc_time_entry_cost(...)       — Trigger fn on job_time_entries. NOTE (PR-4, Jun 27 2026): total_cost is a GENERATED column, NOT trigger-written. Expr is now round((coalesce(travel_minutes,0)/60 + coalesce(hours,0)) * coalesce(hourly_rate,0), 2) — i.e. drive time + on-site time × rate (was hours×rate only; changed via ALTER COLUMN ... SET EXPRESSION, which recomputed all rows). The trigger now ONLY fills hourly_rate from the employee when missing + stamps updated_at (its old total_cost assignment was always ignored by the generated column). get_payroll_summary is unaffected (recomputes pay from hours×rate, never reads stored total_cost); get_job_labor_summary + get_timesheet_entries sum stored total_cost so they now include drive time.
get_tech_status_board()         — Live dispatch board: one row per active field_tech/supervisor (plus any employee currently clocked in or **on a crew for an appointment today**) with derived status ('paused'|'on_site'|'omw'|'scheduled'|'idle'), status_since, current/next appointment, job, client_name, address. Sorted by status priority then name. Powers the Status Board tab on Time Tracking + the Overview "Employee status" widget (useEmployeeStatus.js). FIX (Jun 30 2026, migration `20260630_status_board_denver_date_and_field_admins.sql`): (1) **timezone** — "today" was `a.date = CURRENT_DATE` (UTC); after ~6pm Denver it matched the wrong day and dropped today's scheduled crews. Now `(now() AT TIME ZONE 'America/Denver')::date`. (2) **field-working admins** — the old `next_appt` (future-only, role-gated) is replaced by a `today_appt` CTE + a WHERE that includes anyone on a crew for an appointment today regardless of role, so admins who run jobs (Ben/Juani) appear as 'scheduled' until they clock in (office-only staff with no appointment today still don't show; next_appt_time/title still only populate for genuinely-upcoming appointments). Same RETURNS TABLE signature (CREATE OR REPLACE). Also that day: a one-off data cleanup reset 4 appointments stuck en_route/in_progress/paused with no open clock back to 'scheduled'. PIN (Jun 30 2026, migration `20260630_status_board_pinned_employees.sql`): added `employees.show_on_status_board BOOLEAN DEFAULT false` and `OR e.show_on_status_board` to the WHERE, so specific people (owners/admins who occasionally do field work) can be pinned to always appear (read 'idle' until clocked in/scheduled) without including every office admin. Seeded true for the owner login (Moroni Salvador, email moroni@utah-pros.com). NB: a separate loginless test record "Moroni Tech" holds moroni.s@utah-pros.com — the two Moroni rows are distinct employees; the pin is keyed to the real login. TRAVEL/TOTAL TIME (Jul 3 2026, migration `20260703_status_board_expose_travel_and_clock_times.sql`): the RPC now also returns the open entry's `travel_start, clock_in, paused_at, total_paused_minutes` (grew RETURNS TABLE → DROP + CREATE). Timer starts at travel_start (OMW = real labor cost) but status_since only reflected on-site time, so the board/widget were under-reporting. New shared helper `src/lib/clockTime.js` (`liveClockMinutes` → {travel,onSite,total}, `fmtMins`) computes live from those fields. The **Status Board** (StatusBoard.jsx) now shows three time columns — **Travel · On site · Total** (Total bold = travel+on-site); the Overview **Employee status** widget (useEmployeeStatus.js) now shows **Total** (travel+on-site) instead of on-site-only, incl. the ≥10h "check clock-out" escalation. Travel freezes at clock_in; on-site accrues to paused_at while paused; total_paused_minutes = completed pauses only.
```

### Auth & Permissions
```
get_all_permissions()           — Full nav_permissions matrix
upsert_permission(...)          — Save role/nav_key permission
get_employee_page_access(p_employee_id) — All page overrides for an employee
upsert_employee_page_access(p_employee_id, p_nav_key, p_can_view, p_updated_by) — Set override
delete_employee_page_access(p_employee_id, p_nav_key) — Remove override (revert to role default)
```

### Documents & Esign
```
get_document_templates(...)     — Templates by doc_type
upsert_document_template(...)   — Save template
get_sign_request_by_token(p_token) — p_token TEXT (casts to UUID internally)
create_sign_request(...)        — Creates sign_request row
complete_sign_request(p_token, p_signer_name, p_signer_ip, p_signed_file_path,
                      p_consent_terms DEFAULT NULL, p_consent_commitment DEFAULT NULL,
                      p_consent_esign DEFAULT NULL, p_consent_authority DEFAULT NULL)
                                — Mark signed + insert job_document + emit system_events 'esign.signed'.
                                  Derives job_documents.name from doc_type (fixed prior hardcoded-CoC bug).
                                  Consent flags only stored for recon_agreement; other doc types pass NULLs.
record_email_open(p_token)      — Update email_opened_at + open_count
```

**eSign audit trail:** `complete_sign_request` emits a `system_events` row with `event_type='esign.signed'`,
`entity_type='sign_request'`, `entity_id=<sign_request_id>`, and a payload including doc_type, signer info,
signed_at, divisions, and (for recon_agreement) the four consent booleans + consents_signed_at.

### Lookup Tables
```
get_insurance_carriers()        — [{id, name}]
upsert_insurance_carrier(...)   — p_name, p_sort_order
delete_insurance_carrier(p_id)
get_referral_sources()          — [{id, name}]
upsert_referral_source(...)
delete_referral_source(p_id)
```

### Feature Flags (Phase 1A — complete)
```
get_feature_flags()             — Returns all flag rows ordered by category, label
upsert_feature_flag(p_key, p_enabled, p_dev_only_user_id, p_category, p_label, p_description, p_updated_by, p_force_disabled)
  — ⚠️ two overloads exist live (this 8-arg one, plus an older 7-arg version without p_force_disabled) —
  the same PGRST203-ambiguity risk called out elsewhere in this doc for other RPCs. Drop the 7-arg
  overload next time this function is touched.
delete_feature_flag(p_key)
```

### Rooms & Encircle Replacement (Phase 1 + 1.5 — Apr 17 2026)
All claim-scoped. Frontend passes p_job_id where convenient; function resolves claim_id internally.
```
get_job_rooms(p_job_id)         — Resolves job→claim, returns rooms for that claim.
                                  Row shape: id, claim_id, name, area_sqft, ceiling_height_ft,
                                  sort_order, client_id, created_by, created_at, deleted_at,
                                  photo_count INT (job_documents WHERE room_id=r.id AND category='photo'),
                                  reading_count INT (stub 0, wired in Phase 2 Hydro).
get_claim_rooms(p_claim_id)     — Direct claim-level lookup. Same shape as get_job_rooms.
create_room(p_job_id, p_name,
            p_area_sqft, p_ceiling_height_ft, p_sort_order,
            p_client_id, p_created_by)
                                — Resolves claim from job, INSERT … ON CONFLICT (client_id)
                                  DO UPDATE (idempotent for offline retries).
create_room_for_claim(p_claim_id, p_name, …same optional params…)
                                — Direct claim-level variant.
update_room(p_room_id, p_name, p_area_sqft, p_ceiling_height_ft, p_sort_order)
delete_room(p_room_id)          — Soft delete (sets deleted_at=now) + nulls
                                  job_documents.room_id that pointed at it.
move_photo_to_room(p_document_id, p_room_id DEFAULT NULL)
                                — p_room_id NULL untags the photo.
insert_job_document(…, p_room_id UUID DEFAULT NULL)
                                — MODIFIED Apr 17. Older 7-param and 8-param overloads dropped.
                                  Single canonical 9-param version; all existing callers use named
                                  args via db.rpc() so backward compatibility is preserved.
```

### Data Integrity (Phase 4 — complete)
```
get_orphan_jobs_no_claim()      — Jobs with no claim_id
get_orphan_jobs_no_contact()    — Jobs with no primary_contact_id
get_orphan_contacts()           — Contacts with no contact_jobs links
get_orphan_conversations()      — Conversations with no participants
get_orphan_claims()             — Claims with no linked jobs
get_duplicate_contacts()        — Contacts sharing same normalized phone (groups)
```

### Record Merge (complete)
```
merge_contacts(p_keep_id, p_merge_id)  — Atomic merge: fills blanks, re-points 14 FK tables, deletes loser. Logs contact.merged event.
merge_claims(p_keep_id, p_merge_id)    — Atomic merge: fills blanks, re-points jobs, deletes loser. Logs claim.merged event.
merge_jobs(p_keep_id, p_merge_id)      — Atomic merge: fills blanks, sums financials, re-points 28 FK tables, deletes loser. Blocks if both have payments. Logs job.merged event.
```

### Messaging Tools (Phase 5 — complete)
```
get_message_log(p_limit, p_offset, p_direction, p_status) — Paginated message log with contact info (direction inferred from sender_contact_id)
get_scheduled_queue(p_limit)    — Exact DevTools-owner scheduled queue with contact + template info (joins via conversation_participants)
```

Dev Tools now includes an owner-only **Provider Events** subtab, reached directly from ops-health
alerts at `/dev-tools?tab=messaging&sub=events`. Its thin `/api/provider-event-ops` Worker lists only
sanitized unresolved operational metadata and calls the already-live, service-only
`rearm_callrail_provider_event` / `resolve_provider_event` RPCs for one exact row. Retry only places a
retained event back into the existing recovery queue; it never sends or re-sends a customer message
and never calls CallRail. Resolve records the verified owner employee ID and removes the acknowledged
terminal failure from future ops-health backlog alerts.

### Omni-inbox — email (Foundation, Jul 4 2026)
```
claim_inbound_email(p_message_key TEXT) → boolean — SECURITY DEFINER, GRANT anon+authenticated.
                                  Email-event idempotency: TRUE on first claim of a key, FALSE on
                                  every duplicate (blank key → FALSE). Backs inbound-email dedup
                                  (Phase I) + the resend-webhook svix-id dedup (key 'resend:<id>').
record_email_suppression(p_email TEXT, p_reason TEXT, p_source TEXT DEFAULT NULL) → email_suppressions
                                  — SECURITY DEFINER, Foundation-internal (resend-webhook only).
                                  Upserts one row per address (UNIQUE lower(email)) with reason
                                  precedence — never downgrades a hard suppression to 'unsubscribed'.
omni_verify_foundation() → jsonb  — SECURITY DEFINER self-cleaning self-test: proves the messages
                                  type/channel CHECK widen accepts all old+new values, rejects bogus,
                                  and claim idempotency. Backs supabase/tests/omni_messages_check_widen.
                                  Creates+deletes its own throwaway rows (leaves nothing).
```

### SMS-experience — F-core (Foundation, Jul 9 2026)
```
Scheduled-message delivery hardening (Jul 31 2026) — **authored source only; neither migration is
applied, deployed, provider-verified, nor device-verified.** Compatibility requires the exact
`31213100` participant-enforcement posture, locks the queue, and aborts with SQLSTATE `55000` when
the aggregate pending count is nonzero; it never edits those rows. It creates a FORCE-RLS
actor-derived creation-provenance ledger that snapshots creator, conversation, canonical body/send
time, recipient contact, and recipient phone. `create_scheduled_message(p_id,
p_conversation_id,p_body,p_send_at)` derives the active internal actor, validates Conversations
capability/access and exactly one active customer recipient, and treats the stable client UUID as an
idempotency key. `get_scheduled_queue(p_limit)` and `cancel_scheduled_message(p_id)` are exact
DevTools-owner contracts; cancellation only succeeds for an unreserved pending row. Hardened callers
deploy first and fail closed until the compatibility RPCs exist. Compatibility preserves the legacy
`claim_scheduled_message(uuid)` signature and historical grants as a callable `false` no-op,
closes raw browser queue writes and changes all historical policy predicates to `false` in the
same transaction, and adds
service-role-only `claim_scheduled_message_v2`, release/fail, reservation, and reconciliation RPCs
fenced by a random claim token. Reservation rechecks creator capability/access and the immutable
recipient snapshot against the exact-one current recipient, links one irreversible
`message_send_attempt`. Immediately before that link, the same reservation transaction
share-locks the current real-org `sms_sending_enabled` row and invokes the canonical phone-locked
`get_service_sms_consent_status`; scheduled traffic accepts only `GLOBAL_OPT_IN`.
`sms_disabled`, DND, explicit opt-out, pending STOP, or any other non-global consent result
returns without provider-attempt residue. The Worker and central automated-send
consent/DND/kill-switch/quiet-hours gates remain defense in depth. Reconciliation
materializes accepted delivery, preserves fresh in-flight work, and sends an unknown outcome to owner
review without automatic resubmission. Enforcement follows compatibility in the same serialized release
window, reasserts fail-closed policies and revoked browser ACLs, and retains the provenance
boundary. This slice
adds no native scheduling caller. The unresolved browser operation ID is scoped to the current
opaque account owner+epoch, so a still-mounted Capacitor WebView cannot reuse another account's ID;
cancel refreshes also preserve the visible queue instead of replacing it with a loading state.
increment_conversation_unread(p_conversation_id UUID, p_by INT DEFAULT 1) → integer — SECURITY DEFINER,
                                  GRANT authenticated+service_role (never anon). One atomic UPDATE (no
                                  read-modify-write race); clamps at 0; returns new unread_count, NULL if
                                  the conversation is missing. Consumed by Phase A + D.
```
Shared lib: `functions/lib/twilio-errors.js` — `classifyTwilioError(code)` → `{label, suppress,
contactFlag, uiClass}` for 21610/30006/30007/30034 (+ safe DEFAULT). Import-only for the wave (A applies
suppression/contact flags; C maps `uiClass` to CSS). Frozen-contract specs: `docs/archive/rules/sms-experience-wave-ownership.md` §9.

### Tech first-run onboarding (Jul 29 2026 — **applied live Jul 30 2026**)
```
get_my_onboarding_version_seen(p_surface TEXT) → integer — SECURITY DEFINER, search_path '', selector-free
                                  (auth.uid() → active internal employee, same role list as
                                  upsert_my_native_device_token); surface allowlist ('tech'); returns the
                                  caller's version_seen or 0. REVOKE PUBLIC/anon before GRANT
                                  authenticated+service_role.
ack_my_onboarding_seen(p_surface TEXT, p_version INT) → integer — same posture; monotonic upsert
                                  (GREATEST) into employee_onboarding_state so a replay can never re-arm
                                  a finished tour; p_version validated 1..10000.
```
Migration `supabase/migrations/20260729220000_tech_onboarding_state.sql` (+ paired rollback, + CI
contract test `tests/qa/unit/tech-onboarding-state-migration.test.js`) — **APPLIED 2026-07-30 under
explicit owner authorization, live ledger `20260730115220`.** Postconditions plus an independent
check passed (RLS enabled+forced, no browser-role table grant, `anon` EXECUTE false on both definer
RPCs); the first-run tour is live and verified rendering all three screens
(`.claude/rules/initiative-status.md`).

Frontend: `src/components/TechLayout.jsx` mounts the lazy `src/components/tech/onboarding/
TechOnboarding.jsx` (owner spec 2026-07-29: ALWAYS 3 full-screen steps, forward-only, no dismiss —
welcome → day-to-day value → notification priming) when `src/hooks/useTechOnboarding.js` says the
versioned flag is unseen. Show-once = server flag + an employee-scoped localStorage mirror
(`upr:tech-onboarding-seen:v1`, lib `src/lib/techOnboarding.js` — instant offline decision,
offline-ack resync, unit-tested in `tests/qa/unit/tech-onboarding-gate.test.js`). Screen 3 has ONE
button; the system permission prompt fires only from that press, via the existing fail-closed
chokepoints (`enableNativePushForEmployee` native / `enablePush` web via `runDevicePushAction`).
Allow/deny/can't-enroll all continue identically into a two-phase exit that reveals the Dash beneath
(success additionally fires the native success haptic); Settings → Notifications is the recovery
path. Styles ride the lazy chunk (`TechOnboarding.css` — index.css sits at its blocking CI budget).
Strings: `tech.json → onboarding.*` (en/pt/es). **What's New mechanism (owner-confirmed intent):**
the content layer is the `TOUR_STEPS` descriptor list in TechOnboarding.jsx — a future version bumps
`TECH_ONBOARDING_VERSION` in `src/lib/techOnboarding.js` and swaps that list; the shell (gating,
state machine, focus trap, exit) is reused as-is.

### Per-token APNs topic (Jul 31 2026 — **LIVE**, ledger `20260731154315`)
```
upsert_my_native_device_token(p_token TEXT, p_apns_environment TEXT, p_apns_topic TEXT DEFAULT NULL)
                                  → jsonb — replaces the live 2-param definition in one transaction
                                  (DROP + CREATE, never a second overload: two candidates for the same
                                  named-argument call is PostgREST PGRST203 and breaks the deployed
                                  caller; the DEFAULT keeps the shipped {p_token, p_apns_environment}
                                  call resolving). Same definer posture (auth.uid() → active internal
                                  employee, search_path '', REVOKE PUBLIC/anon before GRANT
                                  authenticated+service_role). New: validates p_apns_topic as a bundle
                                  id, stores it, returns it; ON CONFLICT keeps a recorded topic via
                                  COALESCE so an older client's NULL re-upsert can't erase it. Also
                                  removes the obsolete authenticated SELECT policy from the raw-token
                                  table; browser table grants were already revoked and no checked-in
                                  client reads device_tokens directly.
```
Migration `supabase/migrations/20260730170000_device_token_apns_topic.sql` applied through the
governed release path as live ledger row `20260731154315_device_token_apns_topic`. Its post-apply
catalog proof passed: the column/constraint are live, exactly one three-parameter RPC remains, the
two-argument call is preserved by its trailing default, RLS is forced, and browser table access is
absent. The paired rollback restores the prior body under the SAME 3-param signature. The CI
contract test is `tests/qa/unit/device-token-apns-topic.test.js`; the behavioral db-lane test is
`supabase/tests/device_token_apns_topic_isolated.sql` proving the 2-arg call still succeeds and the
COALESCE topic-preservation — db lane runs at the apply window against an isolated DB, it is NOT CI
coverage). **Why:** one env-wide `APNS_TOPIC` per Cloudflare
deployment cannot serve two bundle ids — the 2026-07-30 fleet outage was Preview's topic set for the
side-by-side UPR Dev app (`com.utahprosrestoration.upr.dev`) while dev.utahpros.app hosted the
production outbox (every push 400 DeviceTokenNotForTopic). Now `functions/lib/apns.js` selects
`apns_topic` with each token row and addresses each device with its own topic, falling back to env
`APNS_TOPIC` for legacy/NULL rows (APNS_TOPIC stays mandatory); `src/lib/pushNotifications.js` passes
the installed bundle id (ground truth via `getInstalledAppBundleId()` in `src/lib/nativeAppInfo.js`,
null-safe) on every enrollment re-upsert. **Sequencing: schema FIRST** — the worker selects the new
column and the native client passes the new param, so schema had to land before the compatible code
deploy/rebuild. That database prerequisite is now satisfied; deployment and signed-device proof
remain separate release evidence.

### Workers & Dev
```
get_worker_runs(p_limit INT)    — Last N worker_runs rows (default 10)
bust_postgrest_cache()          — NOTIFY pgrst 'reload schema' — forces schema reload
get_table_stats(p_table TEXT)   — Row count + latest created_at for any table (Phase 6)
upsert_device_token(p_employee_id UUID, p_token TEXT, p_platform TEXT)  — Registers iOS/Android device for push; idempotent (unique on token)
delete_device_token(p_token TEXT)                                        — Removes a device token (logout/uninstall cleanup)
get_active_appointment_geo(p_employee_id UUID)                           — Returns jsonb of the tech's in_progress/paused appointment with clock_in_lat/lng, or NULL. Powers the "away from jobsite" nudge. Fixed Jun 9 2026: ordered by nonexistent a.start_at (errored on every call since creation); now orders by a.date DESC, a.time_start DESC.
get_upr_mcp_audit(p_limit INT)                                           — Recent UPR MCP tool-call audit rows (default 100, max 500)
```

### RPC Data-Flow Reference — tech area (reads / writes)
Derived from each function's SQL body (reads = FROM/JOIN, writes =
INSERT/UPDATE/DELETE), intersected with real `public` tables to drop CTE/alias
noise. Use these directly in the `DEPENDS ON → Data` header field instead of
re-introspecting. Built Jun 23 2026 during the tech-area doc backfill; extend
this table per area as the backfill continues.

| RPC | reads | writes |
|-----|-------|--------|
| add_adhoc_job_task | job_schedule_phases, job_schedules | job_tasks |
| assign_tasks_to_appointment | — | job_tasks |
| clock_appointment_action | appointments, job_time_entries | appointments, job_time_entries, system_events |
| create_job_with_contact | contact_addresses, contacts, jobs | claims, contact_addresses, contact_jobs, contacts, jobs |
| create_room | jobs | rooms |
| create_room_for_claim | — | rooms |
| delete_appointment | appointment_crew, appointments | appointment_crew, appointments, job_tasks |
| delete_oop_quote | oop_quotes | oop_quotes |
| get_active_appointment_geo | appointment_crew, appointments, job_time_entries, jobs | — |
| get_active_demo_schema | demo_sheet_schemas | — |
| get_active_techs | employees | — |
| get_appointment_detail | appointment_crew, appointments, employees, jobs | — |
| get_appointment_tasks | employees, job_tasks | — |
| get_appointments_range | appointment_crew, appointments, employees, jobs | — |
| get_assigned_tasks | appointment_crew, appointments, contacts, job_tasks, jobs | — |
| get_claim_appointments | appointment_crew, appointments, employees, job_tasks, jobs | — |
| get_claim_demo_sheets | forms, jobs | — |
| get_claim_detail | claims, contacts, jobs | — |
| get_claim_jobs | claims, jobs | — |
| get_claim_rooms | job_documents, rooms | — |
| get_claims_list | appointments, claims, contacts, job_documents, job_time_entries, jobs, system_events | — |
| get_demo_schema | demo_sheet_schemas | — |
| get_demo_sheet | forms | — |
| get_demo_sheet_drafts | forms | — |
| get_insurance_carriers | insurance_carriers | — |
| get_job_contacts | contact_jobs, contacts | — |
| get_job_equipment | equipment_placements, rooms | — |
| get_job_readings | moisture_readings, rooms | — |
| get_job_rooms | job_documents, jobs, rooms | — |
| get_job_task_summary | job_tasks | — |
| get_my_appointments_today | appointment_crew, appointments, employees, jobs | — |
| get_oop_quote | oop_quotes | — |
| get_stalled_materials_for_employee | appointment_crew, appointments, jobs | — |
| get_tech_claims | appointment_crew, appointments, claims, contacts, job_documents, job_time_entries, jobs, system_events | — |
| get_unassigned_tasks | job_tasks | — |
| insert_job_document | — | job_documents |
| insert_reading | moisture_readings | moisture_readings |
| insert_tech_feedback | — | tech_feedback |
| move_photo_to_room | — | job_documents |
| place_equipment | — | equipment_placements |
| remove_equipment | equipment_placements | equipment_placements |
| save_demo_sheet | demo_sheet_schemas, employees | forms |
| search_contacts_for_job | contact_jobs, contacts | — |
| toggle_appointment_task | employees, job_tasks | job_tasks |
| update_appointment | — | appointments |
| upsert_insurance_carrier | — | insurance_carriers |
| upsert_oop_quote | — | oop_quotes |

### Dashboard
```
get_dashboard_stats()           — Dashboard stat counts
```

### Global Search (Jun 24 2026)
```
global_search(p_term TEXT, p_limit INT DEFAULT 6)
  — Desktop top-nav search. SECURITY DEFINER, GRANT EXECUTE authenticated,
    service_role (NOT anon — least-privilege per database-standard.md §1).
    Returns a JSONB object of grouped, read-only matches: customers (contacts),
    claims, jobs, invoices, payments — each [{id, title, subtitle}] (payments
    also carry invoice_id + job_id for routing). Invoices match on
    invoice_number, qbo_doc_number, qbo_invoice_id (added 2026-07-09 so a QBO
    invoice id like "4274" finds visualization-only mirror rows), claim_number,
    billed_to and contact name. The 'estimates' key is reserved (always [])
    until an estimates module exists. Enum cols cast to text before NULLIF.
    Migrations: supabase/migrations/20260624_global_search.sql (base),
    20260709_global_search_match_qbo_invoice_id.sql (qbo_invoice_id widen).
    Does NOT modify the MCP-only upr_search. Surfaced only in the desktop TopNav.
```

### OOP Pricing Calculator (Apr 20 2026)
 Under the live builder migration, callable OOP RPCs are SECURITY DEFINER;
 browser execution is granted only on the named
 authenticated surface, while internal helpers remain revoked. Calculator access is exactly active
internal `admin`, `office`, `supervisor`, `estimator` (sales rep), and `project_manager`; each may
access all OOP quotes company-wide. `field_tech`, `crm_partner`/external, inactive, unsupported,
and unauthenticated actors are denied. Access is also gated by `tool:oop_pricing` (initially owner
preview only). DevTools → Feature Flags now shows its rollout state explicitly: **owner preview**,
**available to eligible roles**, **hidden for eligible roles**, or **force disabled**. “Make
available to eligible roles” writes
only `enabled: true` through the existing owner-gated `upsert_feature_flag` RPC and
preserves `dev_only_user_id`, so switching global access off restores the existing
owner preview. A missing flag or `force_disabled` is the absolute AuthContext/FeatureRoute and
server-side kill switch, winning even if `enabled` is true or the viewer owns the preview. The July
31 live readback shows exactly one flag row: disabled, not force-disabled, and scoped to the
existing preview user. This release did not activate it for eligible roles.

The builder adds a fully configurable, versioned pricing surface at
**Settings > Pricing & billing > OOP Pricing** (admin-only, web-only). Administrators can set
standard/internal rates, quantity and charge minimums, project minimums, defaults, formulas,
visibility and water/mold applicability; add/reorder/archive/restore items; save a draft; and
two-click publish it. Desktop and tech routes render one shared pricing engine while retaining
their main-app and field-tech visual kits. Saved v2 quotes keep their revision, normalized inputs,
config snapshot and evaluated lines in a private forced-RLS companion row; the database recalculates
the persisted total and margin.
`20260730150000_oop_pricing_builder.sql` is live as reconciled ledger row
`20260731175328_oop_pricing_builder`; its paired rollback remains an owner-gated emergency action.
Live postconditions confirm all four private tables, 18 functions, eight OOP policies, the exact
role matrix and the published/draft legacy configuration. The flag remains owner-preview only.
```
generate_oop_quote_number()     — Returns the next OOP-YYMM-XXX number from the maximum existing
                                   suffix for the Denver month, serialized by an advisory lock.
upsert_oop_quote(p_id UUID,     — Insert (p_id NULL → auto-generates quote_number) or
  p_job_id, p_job_type,           update through the unchanged legacy signature. The authored
  p_insured_name, p_address,      migration validates bounded inputs and recomputes the stored
  p_tech_hours, p_bill_rate,      total and margin server-side instead of trusting browser totals.
  p_air_mover_count/days, ...     Returns the full oop_quotes row; NULL numeric inputs default
                                   to 0.
  p_lgr_count/days, ...
  p_xlgr_count/days, ...
  p_air_scrubber_count/days, ...
  p_neg_air_count/days,
  p_materials_actual_cost,
  p_antimicrobial_sqft,
  p_disposal_trips,
  p_containment_linear_ft,
  p_prv_invoice_cost,
  p_quote_total, p_net_margin_pct,
  p_notes, p_created_by)
get_oop_quotes(p_limit, p_job_id) — Paginated list. When p_job_id set, scoped to that job.
                                     Eligible roles can list all company OOP quotes. Summary columns only (id, quote_number, job_id,
                                     job_type, insured_name, address, quote_total,
                                     net_margin_pct, created_at, created_by).
get_oop_quote(p_id)             — Returns single full oop_quotes row for the calculator
                                   to hydrate on load.
get_oop_quote_v2(p_id)          — Eligible-role JSON read that merges the legacy oop_quotes row
                                   with its uncleared private pricing snapshot when one exists.
delete_oop_quote(p_id)          — Hard delete; returns BOOLEAN (FOUND).
get_oop_pricing_config(p_revision_id) — Eligible-role read of the current published or an exact
                                        published/superseded revision; never exposes the draft.
get_oop_pricing_admin_state() — Admin-only published + draft envelope for Settings.
save_oop_pricing_draft(expected_lock, config, request_id) — Admin-only validation, optimistic lock,
                                                            idempotent audit and draft update.
publish_oop_pricing_draft(expected_lock, request_id) — Admin-only two-state publish transaction;
                                                       supersedes current and creates next draft.
upsert_oop_quote_v2(id, job, type, customer, address, notes, revision, inputs,
  expected_updated_at, request_id) — Eligible-role, idempotent, optimistic-concurrency save.
                                     Chooses/pins a published revision, rejects unknown/unbounded
                                     inputs, evaluates ordered visible/internal lines and minimums
                                     server-side, and stores the full snapshot in the private companion table.
```

### Demo Sheet (May 8 2026 — port of standalone Netlify app)
```
save_demo_sheet(p_id, p_data, p_job_date, p_tech_id, p_job_number, p_address,
                p_insured_name, p_encircle_claim_id, p_status, p_encircle_note_id,
                p_job_id, p_summary, p_email_sent, p_schema_id)
                                — Insert/update a forms row with form_type='demo_sheet'.
                                  When p_id is NULL inserts; otherwise updates only rows
                                  where form_type='demo_sheet'. Resolves technician_name
                                  from employees.display_name||full_name based on p_tech_id.
                                  May 8 2026: added p_schema_id (snapshot of the
                                  demo_sheet_schemas row this sheet was filled against —
                                  defaults to the active schema on insert; never changes
                                  on update). p_job_id writes forms.job_id so the sheet
                                  is reachable from a claim via jobs.claim_id; p_summary
                                  JSONB stores rolled-up totals; p_email_sent flips
                                  forms.email_sent + email_sent_at on submit. Sets
                                  encircle_synced_at=now() the first time encircle_note_id
                                  is supplied. Returns the row UUID.
                                  Jun 9 2026 frontend fix: the first save (INSERT, no id)
                                  is now guarded against concurrent saves on the client —
                                  racing autosaves used to create duplicate draft rows on
                                  slow connections (18 orphaned duplicates were purged from
                                  forms that day). Resolved Jun 24 2026: all email moved off
                                  SendGrid (dead since mid-April 2026 — every forms.email_sent
                                  and sign_requests.email_opened_at since then was false/null)
                                  onto Resend via functions/lib/email.js. Requires RESEND_API_KEY
                                  + a verified utahpros.app sending domain in Resend.
get_demo_sheet_drafts()         — Recent 20 demo_sheet drafts (id, updated_at, job_date,
                                  job_number, address, insured_name, encircle_claim_id) for
                                  the resume-draft banner. Sorted by updated_at DESC.
get_demo_sheet(p_id)            — Single demo_sheet row including form_data, summary,
                                  job_id, and schema_id. Used to rehydrate state when the
                                  page loads with ?id=…
get_claim_demo_sheets(p_claim_id) — All demo sheets attached to ANY job under the claim
                                  (joins forms.job_id → jobs.claim_id). Returns id, status,
                                  email_sent, job_id, job_number, division, technician_name,
                                  form_date, insured_name, address, room_count, summary.
                                  Sorted by updated_at DESC. Powers the Demo Sheets list
                                  on TechClaimDetail (mobile) and ClaimPage (desktop).
get_job_demo_sheets(p_job_id)   — Same shape but scoped to a single job.
get_active_techs()              — UUID + display_name for all is_active employees with role
                                  in (field_tech, supervisor, project_manager, admin).
                                  Replaces the demo's hardcoded TECHS array.
```

### Demo Sheet Builder (May 8 2026 — Phase 1: DB foundation)
```
demo_sheet_schemas              — Versioned JSONB definitions of the demo sheet's
                                  sections + fields + room presets. One row is is_active
                                  at a time (partial unique index). Each forms row
                                  (form_type='demo_sheet') is FK'd to the schema_id it
                                  was filled against — snapshot semantics, so editing
                                  the schema later doesn't reshape old sheets. Seeded
                                  with v1 mirroring the previously-hardcoded constants
                                  (12 sections, 12 room presets, full field tree).
                                  Inline updated_at trigger via
                                  public.demo_sheet_schemas_touch_updated_at().

get_active_demo_schema()        — Returns id/version/name/definition/updated_at for the
                                  currently-active schema. Used by TechDemoSheet to
                                  render new sheets and by the builder.
get_demo_schema(p_id)           — One row by id (includes is_active + notes).
list_demo_schemas()             — All versions newest-first plus per-version sheet_count
                                  (how many forms are pinned to each).
upsert_demo_schema(p_id, p_name, p_definition, p_notes, p_created_by)
                                — Insert (auto-bumps version) or update an existing row.
                                  Never flips is_active — use publish_demo_schema for that.
publish_demo_schema(p_id)       — Atomically deactivate the current active row and
                                  activate this one. New sheets created after publish
                                  pick up this schema; existing sheets keep their
                                  schema_id snapshot.
```

**Schema definition shape (JSONB):**
```jsonc
{
  "version": 1,
  "name": "v1 — initial port",
  "roomPresets": ["Living Room", "Kitchen", ...],
  "jobSections": [ /* v2+ — JOB-LEVEL sections, asked once per sheet (see below) */ ],
  "sections": [
    {
      "key": "trim", "label": "Baseboard & Trim", "icon": "📏",
      "alwaysOn": true,                    // OR { "gateField": "floodCuts" }
      "doneFlag": "trimDone",              // boolean key set when "Done → Next" is tapped
      "fields": [
        { "key": "baseboardLF", "type": "stepper", "label": "...",
          "unit": "LF", "step": 1, "small": true, "summaryKey": "baseboardLF" },
        // field types: stepper | single-chip | multi-chip | text | textarea |
        //              checkbox | select | list (nested itemFields) | row | computed
        // showWhen: { field, equals } | { field, includes }
        // unitWhen: { field, equals, thenLabel, thenUnit }   (dynamic unit)
        // summaryKey + summaryAggregate: 'sum' | 'tally' (for rollup totals)
        // computed: { type:'computed', formula:{op:'multiply', a:<key>, b:<key>},
        //            unit, summaryKey }  — read-only value = a×b, summed across contexts
      ]
    }
  ]
}
```

`forms.schema_id` (UUID, nullable, FK to demo_sheet_schemas) — every demo_sheet form
points back to its schema. Backfilled to v1 for all pre-existing rows.

**v2 — Scope Sheet (Jun 24 2026):** the demo sheet was extended into a fuller "scope sheet"
for Xactimate estimating (user-facing label renamed Demo → **Scope Sheet**; route/table/RPC/
doc-category keys unchanged). Two new schema capabilities:
- **`jobSections`** — a top-level array of JOB-LEVEL sections (answered once per sheet, not
  per room). Rendered FIRST in the tech page by the new `JobSections` component (shares
  `Section`/`FieldRenderer` with `RoomCard`), guided/sequential like rooms. Job-section
  answers persist in `forms.form_data.jobData`; their `summaryKey` fields roll into the same
  `summary` totals. `computeSummary(rooms, jobData, schema)` now walks jobSections too.
- **`computed` field type** — `formula:{op:'multiply', a, b}` displays a read-only product of
  two sibling fields and aggregates via `summaryKey` (e.g. tension posts × days = post-days).
- v2 seed (`9ff2566c-…`, **draft until published**) adds jobSections: Loss Details
  (category/class/source of loss), Emergency Call (after-hours/business-hours), Floor
  Protection (types + SF), Tests & Itel (asbestos/lead/Itel checkboxes), Scope Notes, and the
  **folded floor-plan/sketch question** (gateField `hasSketchDone`, placed last so it gates
  the room list). Plus a per-room `containment` section (6 mil SF + tension posts + days +
  computed post-days). The tech page keeps the legacy hardcoded sketch card as a fallback for
  v1 schemas (no jobSections), so old drafts render unchanged.
- **Required fields + enforcement** — fields carry an optional `required: true` (toggled per
  question in the builder). A section's "Done → Next" is disabled until its visible required
  fields are answered (`sectionRequiredMet`/`fieldHasValue`: required number > 0, required
  checkbox checked, choice/text non-empty; non-required fields never block). v2 marks
  category/class/source, emergency timing, and floor-protection type required (+ a "None used"
  protection option). Because job sections are sequential and floor-plan is last, this makes the
  required answers mandatory to submit.
- **Autosave safety net** — TechDemoSheet mirrors the live draft to `localStorage`
  (`scopesheet:draft:<id|pending>`) on every change; a header status shows Saving/Saved/Failed;
  failed saves retry (~8s) and the mirror is restored on next load (cleared on confirmed save /
  submit). Prevents field data loss on poor signal.
- **Resume smoothness (2026-07-13)** — two app-wide fixes born from the scope-sheet resume
  investigation (multi-agent diagnosis; Schedule was the "does nothing on resume" gold standard):
  (1) **identity-stable authenticated db client** — `src/lib/stableDb.js` `createTokenBoundClient`
  reads the JWT from a ref per-request; `AuthContext.bindAuthDb()` updates the ref on
  SIGNED_IN/TOKEN_REFRESHED so the `db` object identity NEVER changes on token renewal → no
  `[db]`-keyed loader re-runs → pages no longer visibly refetch/reset when the app resumes near
  the ~1h token boundary (previously TechDemoSheet re-hydrated from the last mirror "saved point"
  on desktop resume; ClaimPage/TechAppointment flashed skeletons). `db.apiKey` is a getter (live
  token for storage uploads). Do NOT revert to per-token clients.
  (1b) **Session recovery / central 401 handling (2026-07-25)** — the identity-stable client above
  fixed the *happy* path (TOKEN_REFRESHED swaps the JWT in place); it had no *failure* path. When a
  renewal never fired or failed, `tokenRef` kept the dead JWT forever, every REST call 401'd, and
  nothing in `src/` handled a 401 — so the app looked normal while every save silently failed.
  Diagnosed from a console with **686 identical 401s** on `get_unread_notification_count`: the bell's
  60s poll was the only recurring call, so it was the only thing that noticed (~11h of an open tab).
  Now: `src/lib/supabase.js` attaches `status`/`body` to every thrown error (message text unchanged —
  callers pattern-match it); `stableDb.js` `createTokenBoundClient(getToken, { onAuthError })` retries
  **exactly once** on a 401 after recovery succeeds; `AuthContext.recoverSession()` is the app's ONE
  401 handler — **single-flight** (`refreshingRef`) so N parallel loaders can't fire N
  `refreshSession()` calls and lose the refresh-token rotation race. Unrecoverable → `sessionExpired`
  → `src/components/SessionExpiredBanner.jsx` (mounted inside `AuthProvider`, so one instance covers
  the office/tech/CRM shells; theme-independent colors because the dark re-tone is scoped to
  `.tech-layout`, which the banner is outside of). **Only 401 recovers** — 403/42501 is a real
  permission denial (what DEV anon mode returns) and must surface unchanged. Retrying a *write* after
  a 401 is safe because PostgREST rejects the JWT before any SQL runs (unlike a timeout, where the
  write may have landed — that rule still stands in `supabase.js`). Contract pinned by 8 tests in
  `src/lib/stableDb.test.js`.
  (2) **home-screen-PWA route restoration** — iOS evicts the standalone PWA in the background and
  relaunches at manifest `start_url` (/tech); `src/lib/resumeRestore.js` (pure, tested) +
  `src/components/RouteRestorer.jsx` (in App.jsx inside BrowserRouter) save the last route on every
  navigation and, standalone-mode only + boot-at-/tech only + <30 min fresh, jump back to the exact
  URL — so the scope sheet's `?id` + keystroke-level mirror rehydrate mid-task work in place.
  Also: TechDemoSheet `resumeDraft()` no longer `window.location.reload()`s — it re-hydrates in
  place (hydrated=false → change `?id` → bootstrap effect).
- **Perf:** page routes are `React.lazy` + `Suspense` code-split (App.jsx) — initial JS dropped
  from one ~1.9 MB chunk to ~335 KB + per-page chunks. Draft load fetches `get_demo_sheet` once
  (deduped between the schema + bootstrap effects); job totals are `useMemo`-ized.

### Other RPC families (documented in their own sections, not duplicated here)
These exist live and are correctly documented elsewhere in this doc — listed here only so this
catalog doesn't read as exhaustive when it isn't:
- **Homebuilding AI** (16 RPCs — chat/estimate/build-project CRUD) — see "Homebuilding Entry Analysis"
  and "New Build simulator" sections below.
- **In-App Notifications** (`create_notification`, `get_notifications`, `get_unread_notification_count`,
  `mark_notification_read`, `mark_all_notifications_read`) — see "In-App Notifications" below.
- **Commissions/payroll** (`get_commissions`, `get_employee_commissions`, `upsert_employee_commission`) —
  live, but genuinely undocumented anywhere in this doc as of this audit; confirm with the owner whether
  this is a shipped-but-undocumented feature or in-progress before relying on it.
- **Billing** (`create_invoice_for_job`, `convert_estimate_to_invoice`, `get_job_financials`,
  `get_ar_invoices`, `get_payments_ledger`, `get_open_estimates_summary`, etc.) — see the QuickBooks
  Online sections below and `BILLING-CONTEXT.md`.

---

## Feature Flags System (Phase 1A complete, 1B wired in AuthContext)

**Table:** `feature_flags` — 20 rows as of Jul 1 2026 (mixed on / off / dev-only; row count drifts as
flags are added via the self-registering registry below — verify live via `upr_select` rather than
trusting this number). Original Phase-1A seed plus everything added since:

| Key | Category | Label | Enabled |
|-----|----------|-------|---------|
| `page:leads` | page | Leads | off |
| `page:marketing` | page | Marketing | off |
| `page:time_tracking` | page | Time Tracking | on |
| `page:collections` | page | Collections | on |
| `page:estimates` | page | Estimates | **on** — no longer dormant, see QBO Estimates section |
| `page:overview` | page | Overview Dashboard | on |
| `page:encircle_import` | pages | Encircle Import | on |
| `page:water_loss_report` | reports | Water Loss Report PDF | off, dev-only |
| `page:tech_rooms` | tech | Tech: Rooms & Photo Organization | off, dev-only |
| `page:tech_moisture` | tech | Tech: Moisture Readings (Hydro) | off, dev-only |
| `page:tech_equipment` | tech | Tech: Equipment Placements | off, dev-only |
| `tool:bulk_sms` | tool | Bulk Messaging | off |
| `tool:search_export` | tool | Search & Export | off |
| `tool:oop_pricing` | tool | OOP Pricing Calculator | owner preview at Jul 30 readback; DevTools global means all eligible roles, never all staff; missing/force-disabled denies |
| `feature:pwa` | feature | PWA | on |
| `feature:twilio_live` | feature | Twilio Live SMS | off |
| `feature:billing` | feature | Billing & Invoicing | on |
| `feature:ai_xactimate` | feature | AI Xactimate Import | on |
| `offline:queue` | infra | Offline Queue + Service Worker | off, dev-only |
| `clock_enforce_explicit_clockout` | time_tracking | Enforce explicit clock-out | off |

**AuthContext integration (Phase 1B — complete, access control updated Mar 27 2026):**
- `featureFlags` — keyed object `{ 'page:marketing': { enabled, dev_only_user_id, force_disabled, ... } }`
- `employeePageAccess` — keyed object `{ dashboard: true, conversations: false, ... }` — empty = no overrides
- `isFeatureEnabled(key)` — no row = `true` (backwards compat), `flag.enabled` = `true`, `dev_only_user_id === employee.id` = `true`, else `false`
- `canAccess(navKey)` — 4-layer priority:
  1. `force_disabled` on feature flag → `false` (no exceptions, even admins)
  2. `employeePageAccess[navKey]` exists → use that value
  3. `employee.role === 'admin'` → `true`
  4. `nav_permissions` by role (existing logic)
- All three (permissions, flags, page access) fetched in parallel at login
- All reset on logout

**Self-registering flag registry (`src/lib/featureFlags.js`, Jun 2026):** Flags no longer need
hand-entry in DevTools. `FEATURE_FLAG_REGISTRY` is the code-side manifest of every flag the app
references — explicit `feature:*` entries plus every `featureFlag` declared on a `navItems.jsx`
entry (auto-derived, reusing the nav label). When DevTools → Feature Flags loads, `FlagsTab.load()`
upserts any registry key **missing** from `feature_flags` — created **ENABLED**, and never touches
an existing row. ENABLED (not OFF) is deliberate: `isFeatureEnabled` treats a missing flag as **ON**
("no row = unrestricted"), so seeding OFF would *hide* a feature that was already live. To
dark-launch a feature OFF, set `enabled: false` on its registry entry. Add a flag going forward by
appending one line to `EXPLICIT_FLAGS`, or just set `featureFlag` on a nav item — it self-registers
on the next DevTools open. (2026-07-29: `FlagsTab.load()` and `WorkersTab.load()` gained a
`{ silent }` option — add-flag, post-sync, and manual-Refresh refetches no longer re-gate the tab
into `TabLoading`, per `page-lifecycle.md` §1.)

**Phases 1C–6C (all complete):** Sidebar guards, DevTools.jsx with 9 tabs (Moroni-only route) —
Flags, Health, Employees, Workers, Integrations, Backfill, Integrity, Messaging, Advanced.

## CRM Partner role (external marketing-agency accounts, Jul 1 2026)

A restricted `employees.role` value (`crm_partner`) for an outside marketing agency running
leads/advertising — sees the **whole CRM** (`/crm/*`) **except Integrations**, nothing outside
`/crm` at all. Reuses the existing employee/auth pipeline rather than a parallel user system;
scoped via migrations in `supabase/migrations/20260701_crm_partner_*.sql` (an initial rollout, then
a `_widen_access` follow-up migration that opened Settings/pipeline-config/revenue back up and
added the Integrations-specific block — the product call landed on "full CRM minus Integrations"
rather than the initial narrower design; read `_widen_access` first if reasoning about current
behavior, the earlier migrations' RLS narrowing on Settings/revenue is superseded by it):

- **Role/marker:** `crm_partner` added to the `employee_role` enum; `employees.is_external boolean`
  (reporting/audit marker only, not an access mechanism).
- **`is_crm_partner(auth_user_id uuid)`** — `SECURITY DEFINER` helper (looks up `employees` by
  `auth_user_id`), used throughout RLS policies and RPC guards below.
- **Access to `/crm/*` itself:** NOT via `nav_permissions` (the CRM nav item isn't in
  `Sidebar.jsx`'s `NAV_ITEMS` yet) — `/crm` is gated by `<FeatureRoute flag="page:crm">`, which is
  `dev_only_user_id`-locked to Moroni during the build. `isFeatureEnabled()` in
  `AuthContext.jsx` has an explicit bypass: `key === 'page:crm' && employee.role === 'crm_partner'`
  always passes, independent of the internal rollout flag.
- **Blocking everything outside `/crm` — the real enforcement layer:** most non-CRM routes in
  `App.jsx` (`/jobs`, `/claims`, `/customers`, etc.) have **no per-route guard at all** — they only
  rely on the sidebar not showing a link, which was fine when every authenticated session was
  trusted staff. `Layout.jsx` has a single choke-point `useEffect` (route-change based) that
  redirects any `crm_partner` whose path isn't under `/crm` or `/help` back to `/crm/leads`.
  `HomeRedirect` in `App.jsx` sends `/` there too (mirrors the existing `field_tech → /tech`
  pattern).
- **RLS tightened on existing (not new) tables** — a `crm_partner` is a real authenticated Supabase
  session and can call PostgREST directly, so frontend hiding alone isn't enough. `NOT
  is_crm_partner(auth.uid())` is on the `authenticated`-role policies for: `jobs`, `claims`,
  `invoices`, `estimates`, `estimate_line_items`, `invoice_line_items`, `job_costs`, `payments`,
  `vendor_invoices`, `job_supplements`, `job_time_entries`, `job_documents`, `crm_build_phases`,
  `crm_build_stages` (the internal build-roadmap tracker stays blocked — engineering artifact, not
  a CRM business feature). `contacts` is split: SELECT is scoped to lead-linked contacts only
  (`id IN (SELECT contact_id FROM inbound_leads ...)`), INSERT/UPDATE/DELETE fully blocked.
  `pipeline_stages` is **fully open** (`USING (true)`) per the widened scope — a partner can
  read/write pipeline stages like any internal role. `anon`-role policies were deliberately left
  untouched (pre-existing, separate permissiveness issue, out of scope here). Regression-tested via
  a simulated authenticated RLS session (SQL, rolled back) both before and after the widen — a
  partner gets 0 rows from `jobs`/`claims`/`invoices`/etc. and full `pipeline_stages` access; an
  `office` role is unaffected throughout.
- **RPCs also guarded** (RLS on a table doesn't stop a `SECURITY DEFINER` RPC that reads/writes it):
  `get_crm_revenue_by_division()` and `get_attribution_rollup()` show **real revenue/ROAS** to a
  partner (the initial masking was reverted in `_widen_access`); `upsert_pipeline_stage()` /
  `delete_pipeline_stage()` also had their partner-block reverted — a partner can fully manage
  pipeline stages. The one RPC still guarded for this role: `get_integration_status()` returns zero
  rows for a `crm_partner` caller (matches the Integrations page being fully off-limits).
- **UI scoping:** `Sidebar.jsx` hides the "New Job"/"Customer" quick-create buttons for this role.
  `CrmLayout.jsx` hides only the **Integrations** nav item and the "Build roadmap" footer link for
  this role — Settings and everything else in the CRM sidebar is visible. `CrmIntegrations.jsx`
  redirects a `crm_partner` straight to `/crm/leads` (full block, not read-only) — the
  CallRail/Google Ads/Meta Ads connect workers themselves are not yet role-gated server-side
  (frontend + RPC block only for now; the workers are a good follow-up hardening target since these
  are shared platform OAuth credentials). `CrmRoadmap.jsx` keeps its own redirect-on-render guard as
  defense-in-depth beneath the layout-level hiding (roadmap is the only other page still blocked).
- **Account creation:** `Admin.jsx` → Employees tab — `crm_partner` added to the role dropdown, an
  `is_external` checkbox added to the create/edit form. `functions/api/admin-users.js` (POST/PATCH)
  forwards `is_external` through to the `employees` insert/update alongside the existing fields.
- **Known gap / explicitly descoped:** `inbound_leads.caller_number` (raw customer phone) is not
  masked for a partner — both `CrmLeads.jsx` and `CrmCallLog.jsx` read `inbound_leads` via a raw
  `db.select`, not an RPC, so masking would need a view or RPC rewrite of an already-live read
  path. Flagged for Moroni to confirm the masking approach before building it — this remains
  unmasked under the wider "whole CRM" scope too.

---

## Employees (15 total as of Jul 1 2026 — headcount changes with hiring, verify live before relying
on this table)

| Name | Role | Auth |
|------|------|------|
| Moroni Salvador | admin | ✅ linked |
| Ben Palmieri | admin | ✅ linked |
| Juani Sajtroch | admin | ✅ linked |
| Marcelo Estefens | project_manager | ✅ linked |
| Matheus Almeida | supervisor | ✅ linked |
| Thiago Tobias | admin | ✅ linked |
| Marcelo Bigheti | field_tech | ✅ linked |
| Nano Suarez | field_tech | ✅ linked |
| Admin User | admin | ❌ unlinked |
| Alan Nobre | field_tech | ❌ no email |
| Amaury Evangelista | supervisor | ❌ no email |
| Diego Henriques | field_tech | ❌ no email |
| Elias Almeida | field_tech | ❌ no email |
| Marcio Silveira | supervisor | ❌ no email |
| Moroni Tech | field_tech | ❌ email set, unlinked |

**Invite flow:** Admin → Send Invite → creates auth → links `auth_user_id` → sends email → `/set-password` → sets password → auto-redirects Dashboard

---

## Auth & Session
- **Auth:** Supabase Auth — `realtimeClient.auth.signInWithPassword()`
- **Session token** used as Bearer for `db` client and admin worker calls
- **TOKEN_REFRESHED** event rebuilds `authDb` so calls don't 401 after ~1 hour
- **Dev mode:** bypasses auth by selecting employee directly (`import.meta.env.DEV` only)
- **Recovery links:** hash with `type=recovery` → redirect `/set-password` before init
- **field_tech routing:** `employee.role === 'field_tech'` → `/` redirects to `/tech` (TechLayout, bottom nav, no sidebar). `/tech/*` routes: Dash, Claims, Schedule, Conversations (Messages tab), More, plus Tasks and Appointment detail (reached via More and from appointment cards respectively). Primary bottom nav is 5 tabs in that order; Tasks was demoted out of the primary bar on Apr 16 2026 because techs almost exclusively interact with tasks inside the appointment detail view.
- **Tech mobile polish (Mar 28 2026 — full UI/UX redesign):**
  - **UX persona:** Design every tech screen as if the user is a 64-year-old field tech, not tech-savvy, standing in a flooded basement or doing drywall repair, wearing work gloves, one hand on phone, possibly in sunlight. One-tap actions, no required inputs blocking workflows, 48px min touch targets.
  - **viewport-fit=cover:** Required in `index.html` meta viewport tag. Without it, `env(safe-area-inset-bottom)` returns 0px on iOS and bottom nav touches the home indicator.
  - **Design tokens:** Tech-specific CSS variables (48px min tap, 16px card radius, status palette, shadow system)
  - **TechLayout:** 26px icons, 11px labels, active pill (44×30), frosted glass nav (0.92 opacity), 8px badge dot. Tab order is Dash | Claims | Schedule | Messages | More. The badge dot lives on the More tab and lights up when today's assigned tasks are incomplete.
  - **TechMore:** Full-page list (not a drawer overlay) at `/tech/more`. Two sections today — Work + Resources — with iconized 56px-min rows. Each row = 38px accent-light icon pill + label + (badge or chevron or "Soon" pill). Built rows are `<Link>` elements; "Soon" rows are non-clickable, 0.55 opacity. Designed to grow as new tools ship; admin-only section reserved for Phase 5.
  - **TimeTracker:** Status-colored background tints (amber=en route, green=working, red=paused). Three stations in a horizontal grid — each shows icon, label, timestamp, and optional between-step duration below. The "next" station is the only tappable/prominent (blue) one; completed stations grey out. No live ticker — all durations are closed-interval only. `travel_minutes` computed on clock-in from `travel_start`, displayed under the OMW station. `hours` (net on-site, excludes pauses) displayed under Start station after Finish. Two-click confirm finish. Pause/Resume preserves original Start timestamp. Multi-visit summary lines shown above the current-visit row.
  - **TechDash:** Sticky greeting header (doesn't move on pull-to-refresh), active cards with client name + task progress bar + Photo/Notes/Clock In actions (two-click confirm with 3s timeout), timeline-style future rows, compact completed rows, upcoming 7-day preview when 0 today, snap-first photo flow (auto-upload, optional caption via toast), shimmer skeleton loading
  - **TechTasks:** SVG completion ring (52px donut), 40px pill tabs, mini progress bars per job group, 56px rows, 26px checkboxes, swipe-to-complete with "Done" text + haptic at 40px threshold, checkbox pop animation, completed tasks at 0.5 opacity
  - **TechSchedule:** Division-colored left borders per row, time+duration left column, today header accent-colored, "You're all clear" empty state, jump-to-today FAB accent-colored with arrow icon, 72px min row height
  - **TechClaims:** Encircle-style rows (16px bold name, accent-colored address, claim number + date header, division/job count/status pills), 48px search bar (16px font prevents iOS zoom, 12px radius), empty state with search query + clear button
  - **TechAppointment:** Division gradient hero (water=blue, mold=pink, recon=amber, fire=red, contents=green), white text hierarchy, action bar (Navigate/Call/Message/Photo, 24px icons, 56px tall), 2-column photo grid (12px radius), pinch-to-zoom lightbox, relative timestamps on notes ("2h ago"), task progress bar
  - **TechClaimDetail:** Same division-gradient hero playbook as TechAppointment, applied to claim level. Kills the 5-accordion desktop layout in favor of: hero + 3-button action bar + context-aware Now-Next tile + large Jobs tiles + grouped Photos/Notes with lightbox album + collapsed reference details. Reusable component patterns (Hero, ActionBar, NowNextTile, PhotosGroup, Lightbox, DetailRow) are intentionally local to the file for now — will be promoted to `src/components/tech/` once TechJobDetail also uses them (planned follow-up task).
  - **Transitions:** Fade-up (translateY 8px) for tab switches, slide-from-right for drill-down, button scale(0.97) press feedback, checkbox pop animation
  - **Status colors:** Scheduled=blue, En Route=amber, Working=green, Paused=red, Completed=gray — visible from 3 feet away

---

## PWA (installable; service worker DISABLED — corrected Jul 3 2026)
- **Manifest:** `public/manifest.json` — standalone display, portrait orientation
- **Service worker: KILLED (Apr 18 2026 incident; doc corrected Jul 3 2026 — this section
  previously described the old CacheFirst SW as live, which was wrong and dangerous).** The old
  CacheFirst SW served an edge-poisoned `text/html` under a hashed `/assets/*.js` URL (SPA
  fallback race) → iOS Safari blank page. Today `public/sw.js` is a self-destructing kill-switch
  no-op AND `src/main.jsx:44-72` unregisters every SW + wipes caches + bounces once through
  `/reset` on every load. **Do NOT re-add any fetch-caching SW.** A push-only SW re-enable
  (no fetch handler) is planned — see `docs/notify-roadmap.md` Phase F1.
- **Installability does NOT need a SW** (Chromium ≥117; iOS never required one) — Add to Home
  Screen works today.
- **Icons:** SVG icons at `/icon-192.svg` and `/icon-512.svg` (PNG fallback advisable for iOS)
- **Install prompt:** TechLayout shows banner for field_tech when not in standalone mode (iOS: share instructions, Android: beforeinstallprompt)
- **Feature flag:** `feature:pwa` — enabled (legacy; does not control the SW)

### ⚠️ iOS PWA meta tags — DO NOT CHANGE without understanding this
- **`apple-mobile-web-app-status-bar-style` MUST stay `default`** in `index.html`. Do not change to `black-translucent`.
- **Why it matters:** iOS bakes the status-bar-style into the home-screen icon at install time. The service worker updates CSS/JS but **never** updates this meta — so a change affects only *future* installs, and old installs keep their original value forever.
- **The bug it causes (Apr 16 2026, fixed in commit `39c63c7`):** with `black-translucent` + `viewport-fit=cover`, iOS Safari PWAs report `100dvh` as screen-minus-safe-areas (e.g. 812 on iPhone 17 Pro, vs 874 screen height) while `env(safe-area-inset-bottom)` still returns 34px. The `.tech-layout` uses `100dvh`, so it stops 62px above the bottom of the screen, and `.tech-nav` adds its own 34px safe-area padding on top of that — resulting in ~96px of empty space below the bottom nav icons. With `default`, iOS places content below the status bar and `100dvh` covers the full usable viewport — both insets behave as expected.
- **Capacitor is unaffected** because its WKWebView doesn't apply the same viewport shortening — `100dvh` equals the full screen there.
- **Recovery for broken installs:** existing PWAs installed under the broken config cannot self-heal — users must remove the home-screen icon and re-add from Safari to pick up the new meta.
- **Debug recipe:** attach Safari Web Inspector to the iOS simulator's installed PWA (not Safari tab) and run in Console: `JSON.stringify({padBottom: getComputedStyle(document.querySelector('.tech-nav')).paddingBottom, height: getComputedStyle(document.querySelector('.tech-nav')).height, innerHeight: window.innerHeight, screenHeight: screen.height, standalone: matchMedia('(display-mode: standalone)').matches})`. If `innerHeight < screen.height` by more than ~34px, the viewport is being double-subtracted.

---

## Internationalization / Language (Phase 0 foundation — Jul 3 2026)
Per-device language preference for the **field-tech PWA** (English default / Português / Español).
Client-only, mirrors the ThemeContext pattern — **no DB, no server** (localStorage only). Engine is
**`react-i18next` + `i18next`** (v17 / v26).
- **Engine init:** `src/i18n/index.js` — bundles the locale JSON (static imports, synchronous init so
  `t()` works on first render → `react.useSuspense:false`), `fallbackLng:'en'`, `supportedLngs:['en','pt','es']`,
  namespaces `['common','nav','more','settings','tech','tasks','dash','schedule','claims','appointment','tracker','job','claimDetail','apptForm','newCustomer','newEvent','newJob']`,
  `interpolation.escapeValue:false`. **`fallbackLng:'en'`
  is what makes the phased rollout safe — a missing pt/es key renders the English source, never a blank.**
- **Prefs helper:** `src/i18n/langPrefs.js` (pure, React-free, testable) — `LANG_STORAGE_KEY='upr_lang_pref'`,
  `LANGS=['en','pt','es']`, `LANG_LABELS` (endonyms), `DEFAULT_LANG='en'`, `readStoredLang()` / `writeStoredLang()` /
  `resolveLang()` (allow-list + try/catch, exactly like `readStoredThemeMode`).
- **Provider:** `src/contexts/LanguageContext.jsx` — `LanguageProvider` (mounted in `App.jsx` beside
  `ThemeProvider`, outside AuthProvider) + `useLanguage()` → `{ lang, setLang }`. Syncs `i18n.changeLanguage`,
  localStorage, and `document.documentElement.lang`. Screens read strings with react-i18next's
  `useTranslation(ns)`; only the picker needs `useLanguage()`.
- **Picker UI:** `src/components/tech/settings/LanguageSection.jsx` — segmented-control card in
  `/tech/settings` (reuses `tech-settings-seg` classes, **zero new CSS**), dropped into the slot that
  `TechSettings.jsx` had reserved.
- **Locales:** `src/i18n/locales/{en,pt,es}/{common,nav,more,settings}.json`. EN is the source of truth;
  **each translation batch ships all three languages** (a committed parity test fails on a missing/extra key).
  Embedded bold uses named `<b>` tags rendered via react-i18next `<Trans components={{ b: … }}>`.
- **Shared `tech` namespace + locale-aware dates (Phase 0.5):** `src/i18n/locales/{en,pt,es}/tech.json`
  holds cross-screen strings — appointment/claim **status** + **division** + appointment-**type** label maps
  (rendered as `t('tech:apptStatus.'+s, { defaultValue: mungedEnum })` so an unknown enum still shows),
  common buttons, shared photo/note **toasts** (with `{{message}}` interpolation), and **date words**
  (Today/Tomorrow/Yesterday/ago with plurals). `src/lib/techDateUtils.js` is now **locale-aware**:
  `currentLocaleTag()` maps the active lang → BCP-47 (`en-US`/`pt-BR`/`es`), and `formatTime`/`relativeDate`/
  `relativeTime`/`formatLossDate`/`photoDateTime` follow it. It also **centralizes** the `relativeTime` ("ago")
  + `formatLossDate` helpers that were copy-pasted across tech files. The billing-adjacent duration formatter
  (`clockPrecheck.fmtElapsed`, "1h 5m") is deliberately left alone (language-neutral).
- **Screens translated so far:** the always-visible chrome (`TechLayout` nav + install banner, `TechMore`,
  `/tech/settings`), the **daily-driver** screens — `TechTasks` (`tasks`), `TechClaims` (`claims`), `TechAppointment`
  (`appointment`), `TimeTracker` (`tracker`) — the **live v2** screens `TechDashV2`+`dash/*` and `TechScheduleV2`+`schedule/*`
  (the flag-enabled screens techs actually see; legacy `TechDash`/`TechSchedule` translated too), and the **detail** screens
  `TechJobDetail` (`job` ns) + `TechClaimDetail` (`claimDetail` ns). The **shared detail components** `ActionBar`, `Hero`,
  `NowNextTile`, `PhotosGroup` pull cross-screen strings (`crewPrefix`/`actionBar`/`nowNext`/`hero`/`photos`, pluralized
  counts) from the `tech` ns. Interpolation/plurals handled throughout (greeting name, appointment/task/job/room counts,
  away-jobsite + overtime banners, "Clocked out of {job} ({elapsed})", `<Trans>` for the typed-DELETE bold spans).
  The **create/edit forms** are done too: `TechNewAppointment` + `TechEditAppointment` (shared `apptForm`),
  `TechNewCustomer` (`newCustomer`), `TechNewEvent` (`newEvent`), `TechNewJob` (`newJob`). Their type/division
  pills resolve labels from the namespace (or shared `tech:apptType`/`division`); `syncClaimToEncircle` (a
  module-level helper in `TechNewJob`) uses the `i18n` instance directly since it can't call the hook.
  **Still English (safe via fallback):** the field sheets (demo/readings/equipment/OOP — several owner-flag-gated),
  help prose (`techHelpContent.jsx`), the shared `TIME_OPTIONS` AM/PM time picker (`techFormConstants.js`), and
  the shared office+tech `NotificationBell` chrome — the next batches.
- **PT/ES are Claude drafts pending a native-speaker review pass** (industry terms like Claims→Sinistros/Reclamos).
- **Tests:** `src/i18n/langPrefs.test.js` (pure helpers), `src/i18n/i18n.test.js` (t()/interpolation/fallback/
  **parity across every namespace**), `src/lib/techDateUtils.test.js` (locale-aware helpers),
  `src/components/tech/settings/settingsCards.render.test.jsx` (renderToStaticMarkup smoke).
- **Adding a screen:** create `locales/{en,pt,es}/<ns>.json` (all three — parity test enforces it), register the
  ns in `src/i18n/index.js` (imports + `NAMESPACES` + `resources`), then `useTranslation('<ns>')` in the page.
  Replace hardcoded `'en-US'` date calls with `currentLocaleTag()`. Office/desktop app is out of scope (English).

---

## Esign System (recon_agreement added Apr 16 2026)
- **Flow:** SendEsignModal → `/api/send-esign` → `sign_request` row → email via Resend (functions/lib/email.js)
- **Sign page:** `/sign/:token` — public, no auth — type (cursive/Dancing Script) or draw (canvas)
  - Desktop defaults to Type mode, Mobile defaults to Draw mode
- **PDF generation:** `/api/submit-esign` — pdf-lib, fetches template from DB, substitutes `{{variables}}`, multi-page
- **Open tracking:** `/api/track-open?t=<token>` — 1×1 pixel, updates `email_opened_at` + `email_open_count`
- **Resend:** `/api/resend-esign` — reuses same token, resets open tracking
- **Doc types:** `coc` (per-division ×5), `work_auth`, `direction_pay`, `change_order`, `recon_agreement`
- **Insurance clause:** insured job → direction-to-pay clause; OOP → conditional pre-assignment clause
- **Canvas DPR fix:** retina display handled via `initCanvas` + `setTransform` with `devicePixelRatio`
- **Token note:** `get_sign_request_by_token` takes `p_token TEXT` and casts to UUID internally
- **Template format:** `work_auth`, `direction_pay`, `change_order` use ONE row with inline `## heading` splits; `recon_agreement` uses 16 rows (one per section, sort_order 1–16, heading in `heading` column). `submit-esign.js` branches on `doc_type` to handle both.
- **Recon agreement specifics:**
  - Signer page renders `ReconAgreementContent.jsx` (expandable summary cards + full legal drawer + 4 attested consent checkboxes, amber branding)
  - All 4 consents required; `submit-esign` returns 400 if any missing
  - PDF includes an "ACKNOWLEDGMENTS — ATTESTED AT SIGNING" block with filled-amber checkbox rects
  - `recon_agreement` gets the company pre-authorization block (same as `work_auth` / `change_order`)
- **Audit trail:** `complete_sign_request` emits `system_events` row with `event_type='esign.signed'`, payload includes doc_type, signer info, divisions, and (for recon) the 4 consent booleans
- **Office notifications on signing (Jun 24 2026):** after `complete_sign_request`, `submit-esign.js` fires three best-effort (non-fatal) alerts so the office knows a client signed — see **In-App Notifications** below:
  1. **In-app** — `create_notification('esign_signed', …, p_link='/jobs/<id>')` → sidebar bell badge + live toast.
  2. **Activity timeline** — inserts a system-authored `job_notes` row (`author_name='E-Signature'`, body `✍️ <name> signed the <doc>.`) so it shows on the Job page activity tab (which renders `job_notes` + phase history, not `system_events`).
  3. **Internal email** — `sendEmail` to `restoration@utah-pros.com` (Resend) with the signed PDF attached + an "Open the job in UPR" link.

## In-App Notifications (Jun 24 2026; per-recipient since F2 2026-07-03)
Notification feed surfaced by a **bell** (sidebar/TopNav in the office, top-right in the tech
shell). Originally org-wide shared-read; **F2 made it per-recipient** (see Notification Center
→ F2). Producers: e-signature completion, feedback, time-entry/clock RPCs, and the F2 dispatcher.
> ⚠️ **The bell's poll is the app's canary — keep it quiet.** It was the only recurring authenticated
> call on most screens, so a dead session showed up here as 686 silent 401s and nowhere else
> (2026-07-25). Its poll now runs through `useResumeRefetch` (hidden-guard + resume edge,
> `page-lifecycle.md` §2/§4) with a consecutive-failure backoff (60s doubling → 30 min cap; reset on
> success, on mount/employee change, and when the user opens the bell). Realtime bumps and opening
> the bell call `loadCount()` directly and bypass the backoff on purpose. Do not restore a bare
> `setInterval` here.
- **Table `notifications`:** `id UUID PK, type TEXT, title TEXT, body TEXT, link TEXT (in-app route), entity_type TEXT, entity_id UUID, job_id UUID, payload JSONB, read_at TIMESTAMPTZ (null = unread), created_at TIMESTAMPTZ` **+ `recipient_id UUID NULL` (F2 — NULL = broadcast to all), `type_key TEXT` (catalog key)**. RLS: SELECT to anon/authenticated; **writes only via the SECURITY DEFINER RPC** (plus a narrow `type='__f2test__'` DELETE policy for the F2 test suite). Added to the `supabase_realtime` publication.
- **RPCs (F2 cutover — DROP+CREATE, recipient-aware):** `create_notification(p_type,p_title,p_body,p_link,p_entity_type,p_entity_id,p_job_id,p_payload,p_recipient_id,p_type_key)` (also `service_role`), `get_notifications(p_limit DEFAULT 30, p_employee_id DEFAULT NULL)`, `get_unread_notification_count(p_employee_id DEFAULT NULL)`, `mark_notification_read(p_id)`, `mark_all_notifications_read(p_employee_id DEFAULT NULL)`. Read/unread/mark-all filter `recipient_id IS NULL OR recipient_id = p_employee_id`; old `{}`/`{p_limit}` call shapes still resolve (see F2 note for the overload-trap avoidance).
- **Frontend:** `src/components/NotificationBell.jsx` (office: `Sidebar.jsx`/`TopNav.jsx`; tech: `TechLayout.jsx`) — bell + unread badge + dropdown; passes `employee.id` to the RPCs so each person sees their own feed + read state; polls the count every 60s **via `useResumeRefetch` — hidden-guarded, with a consecutive-failure backoff (see the ⚠️ note above)** — and subscribes to realtime inserts (`subscribeToNotifications` in `lib/realtime.js`), ignoring rows aimed at a different employee, and fires a `upr:toast`. Clicking an item marks it read and navigates to `link`. A failed list load renders an inline "Couldn't load notifications" + Try again rather than the success empty-state (`loading-error-states.md` §1).
- **Migrations:** `20260624_notifications.sql` (original) + `20260703_notify_f2_foundation.sql` (per-recipient cutover, applied).

---

## Schedule System
- **Views:** Day (default on mobile), 3-Day, Week, Month
- **Owner decision (Jul 3 2026):** keep 3-Day (great for iPad) + Week (the daily driver on
  desktop — "pretty much perfect as is", do not redesign) + Month (occasional full picture,
  and the planned foundation for a future Housecall-Pro-style Gantt build). ⚠️ This AMENDS the
  same-day `docs/schedule-roadmap.md` plan, which had "kill … 3-Day span" on record — 3-Day
  stays; see the dated amendment in that doc and in the Schedule Desktop section below.
- **Drag/drop:** appointments draggable + resizable with ghost placement
- **Popover:** click appointment → detail popover (not page nav)
- **Job panel:** overlay + swipe to close (mobile)
- **Auto-scroll:** scrolls to current time on Day view load
- **Tap targets:** 44px minimum
- **Division filter:** All / Mitigation / Recon (role-based default)
- **Task dependency type enum:** `starts_after` | `ends_before` (NOT `finish_to_start`)
- **`get_unassigned_tasks` returns grouped by phase — must flatten before use**
- **`apply_schedule_plan`** creates job_tasks + phases with dates, auto-advances job to `reconstruction_in_progress`
- **Calendar events (kind='event'):** non-job blocks like meetings, PTO, training. Created via the "+ FAB" or empty-cell click which opens a Job-vs-Event picker. Event rows live in the same `appointments` table with `job_id=NULL` and are fetched via `get_dispatch_events`. `CalendarView.jsx` renders them with the Appointment-blue card style (or Task-green when `type='task'`), hiding job-only chrome (address, job #, tasks). Clicking an event opens `EventModal.jsx` (create/edit combined); clicking a job still opens `EditAppointmentModal`. Division filter hides events; crew filter still applies. `hexToTint` helper lives in `src/lib/scheduleUtils.js`.
- **Design-system reskin (Jun 25 2026 — Week Calendar + page shell):** Schedule now wears the shared UPR design system (matches Collections + Dashboard). Page bg `#f4f5f7`, white header/filter bars with `#e7e9ee` borders, 23/800 title. Toolbar uses the shared `collKit` primitives — black-active `SegControl` for the Calendar/Jobs/Crew + Day/3Day/Week/Month toggles, `GhostButton` for This-week/prev/next, `coll-primary` for **+ New**. Division/Crew filters are `ToggleChip`s with a division/crew color swatch (emoji dropped). **Event-card colors now encode DIVISION, not crew** (teal Mitigation = water/fire/contents, purple Reconstruction, coral Remodeling, pink Mold; Appointment blue, Task green, dashed Tentative, gray Completed) via the new helper `src/components/schedule/eventCardStyle.js`; crew stays visible via avatar circles. Cards are soft-tint bg + 3px colored left bar + dark colored title; the week grid sits in a white card shell and the now-line is `#df3b34`. **Reskin only — no behavior/geometry/data changes:** the 7am–10pm grid, pixel time math, drag/resize, overlap-graph, placement mode, mobile swipe, and all `.schedule-*` responsive show/hide are untouched.
- **Follow-up reskin (Jun 25 2026 — Jobs/Crew/Month views + JobPanel):** the remaining Schedule surfaces now match. Jobs-view + Crew-view appointment cards (`ApptCard`/`CrewApptCard`) and the Month-view chips are division-colored via `eventCardStyle`; the left **JobPanel** is on the new palette (white chrome on `#e7e9ee`, blue-tint filter chips, `divisionPill` badges). New export `divisionPill(division)` in `eventCardStyle.js` gives a division-matched label pill in the new palette (teal/purple/coral/pink) — used by the Jobs-view label, the Crew-card job badge, and JobPanel, since the app-wide `DIV_COLORS` (blue water / amber recon) would otherwise clash with the cards. `DIV_COLORS` itself is unchanged (still used by tech pages). Still reskin-only — no behavior/data changes.

---

## Tech Mobile v2 — Phase F Foundation (Jul 3 2026)

The field-tech Dashboard (`/tech`) + Schedule (`/tech/schedule`) rebuild. Full plan:
`docs/tech-v2-roadmap.md`; wave ownership: `.claude/rules/tech-v2-wave-ownership.md`.
Phase F ships **schema/RPC + data layer + wiring only** — the two v2 pages are STUBS the
S/D wave fills in.

- **Feature flags (seeded live, `enabled=false`, `dev_only_user_id`=owner):**
  `page:tech_dash_v2`, `page:tech_sched_v2`. Owner-only during the wave; everyone else gets
  the legacy pages, byte-identical. Registered in `src/lib/featureFlags.js` EXPLICIT_FLAGS
  with `enabled:false` (load-bearing — the DevTools auto-seed would otherwise create them ON).
- **RPCs:**
  - `get_tech_dashboard(p_employee_id uuid) → jsonb` **(NEW)** — one round trip:
    `{ server_now, today, week_start, appointments (Denver day, cancelled excluded),
    upcoming (next 7 days scoped to me), open_entry, hours_today, hours_week (each
    `{ travel, on_site, total }`), photos_today }`. Hours = SUM(stored `hours`) + live term
    for the single open entry; travel = SUM(`travel_minutes`)/60 + live en-route term; week
    = Monday-start America/Denver (payroll parity). Helper `tech_hours_bucket(...)`.
  - `get_appointments_range(date,date)` + `get_my_appointments_today(uuid, p_include_cancelled boolean DEFAULT true)`
    — additive jsonb keys `color/kind/duration_days/is_milestone`, crew `employees` gain
    `color/avatar_url`, plus `task_total`/`task_completed`. Legacy keys unchanged
    (backward-compat tests committed). `get_my_appointments_today` 1-arg legacy call still
    resolves (default). ⚠️ Note: this feed keys "today" off `CURRENT_DATE` (UTC) — legacy
    behavior, left as-is; `get_tech_dashboard` uses the Denver day instead.
  - `clock_appointment_action(...)` — same signature; OMW `work_date` now stamps in
    `America/Denver` (was UTC — misdated evening clock-ins; Finding #3).
  - **Drift capture:** 13 previously migration-less tech RPCs are now captured verbatim in
    `supabase/migrations/20260703_tech_v2_phaseF_drift_capture.sql` (no behavior change).
- **Data layer:** TanStack Query trio pinned `5.101.2`. `src/lib/techQuery.js` is the FROZEN
  query-key + invalidation registry (kinds: dash/sched-month/active-clock/tasks/rooms/docs;
  `techKeys`, `invalidateTech`, `techQueryClient`). Cache persisted to a dedicated IndexedDB
  DB `upr-query-cache` via `src/lib/techQueryPersister.js`; `PersistQueryClientProvider`
  mounted in `src/main.jsx`.
- **Pane host:** `TechLayout` renders the two v2 panes persistently OUTSIDE the keyed
  `<Outlet/>` (no remount storm), hidden via `display:none`, with continuous scrollTop
  tracking + restore and an `active` prop (gates pollers/geo). Flags off → panes not mounted,
  legacy identical.
- **Primitives** (`src/components/tech/v2/`): `StatusChip` (status owns color), `ApptListRow`,
  `TechV2Page`, `TechPane`, skeletons, and `apptHref()/jobHref()` (nav — M2 flips
  `HUB_ENABLED`). CSS = new `tv2-*` classes inside reserved `TECH-V2:` markers in `index.css`.
- **v1 relief patch (legacy, only window before the freeze):** `TechSchedule` fetch window
  anchored to today (day taps no longer refetch the ~61-day range unless they exit the
  window); `TechDash` no longer re-skeletons when data already exists.
- **`--tech-*` / `--status-*` token layer now documented** in `UPR-Design-System.md`.

### Session D — Dashboard v2 (Jul 3 2026)

Fills the `TechDashV2` stub — "mission control for today" behind `page:tech_dash_v2`. **Zero
schema/RPCs.** Owns `src/pages/tech/v2/TechDashV2.jsx` + `src/pages/tech/v2/dash/**` + the
`TECH-V2: DASH` css marker (new `tv2-dash-*` / `tv2-fab-*` classes only).

- **One query:** `useQuery(techKeys.dash(employee.id) → get_tech_dashboard)`. Clock/photo taps
  refresh via `invalidateTech(qc, 'clock'|'photo')` (techQuery's map) — no full refetch.
  Pull-to-refresh and window-focus revalidate in place; the cold skeleton shows only on the
  first load with no cached data (never re-skeletons after).
- **Sections:** Now/Next hero (composes the frozen `TimeTracker` as the single primary action
  when a visit is today/live; countdown when scheduled; next-day preview otherwise; empty state
  → schedule) · attention strip (`StalledWidget` + away-from-jobsite geo, gated on the `active`
  pane prop + 20s debounce, + 5PM "still clocked in" reading `open_entry` from the payload) ·
  today mini-timeline (horizontal, status-color chips) · My numbers (hours today/week as
  labeled travel + on-site + total, tasks done/total, photos today) · completed rows WITH a
  per-visit travel/on-site/total breakdown (a small read-only `job_time_entries` fetch per
  completed row — the payload carries only the open entry) · Coming Up (7 days, me-scoped) ·
  greeting header (sticky, two-click Sign Out — no `confirm()`) · Create FAB.
- **dash helpers** (`src/pages/tech/v2/dash/dashHelpers.js`, unit-tested): `fmtHours`,
  `hoursBreakdown`, `toPickShape` (adapts the payload appt to the frozen `pickNowNext` shape),
  `selectHero`, `splitToday` (cancelled → no bucket, Finding-6 belt-and-suspenders).
- **Nav** through `apptHref()/jobHref()` only. Snap-first photo flow (`PhotoCaptureButton`)
  ported verbatim from v1 (offline-queue + inline paths, `PhotoNoteSheet`, room tagging).
- **Tests:** `src/pages/tech/v2/dash/dashHelpers.test.js` (16, no creds) — pickNowNext edge
  cases (all completed / none today / paused), hours formatting, cancelled-exclusion.

### Session S — Schedule v2 (Jul 3 2026 — shipped)

Fills the `TechScheduleV2` stub behind `page:tech_sched_v2` (owner-only). Legacy
`TechSchedule.jsx` untouched. Owns `src/pages/tech/v2/TechScheduleV2.jsx` +
`src/pages/tech/v2/schedule/**` + CSS in the `TECH-V2: SCHED` marker. Zero schema/RPCs.

- **Views:** **Agenda** (default) — continuous bidirectional list, sticky per-day
  headers, today anchored on first paint via a ref + rect math on the pane scroll
  container (found with `ref.closest('.tv2-pane-scroll')`, re-asserted in a microtask
  to beat the pane host's scroll-restore; no `setTimeout`, no
  `querySelector('.tech-content')`). Prepending past days compensates `scrollTop` so the
  viewport never jumps; scrolling drives the strip highlight + floating Today pill.
  **Day timeline** — hour grid, status-tinted positioned blocks with overlap lanes, an
  all-day strip, and a red now-line that ticks each minute and pauses when the pane is
  inactive (`active` prop). **Month view is deferred** (rides with Phase C) — not built.
- **Week strip:** infinite scroll-snap pager (one week per page), haptic tick via
  `lib/nativeHaptics` on week change, grows at whichever edge you swipe toward with
  `scrollLeft` compensation. Day taps are pure client state — never a fetch.
- **Data:** `useScheduleData` runs one `get_appointments_range` query per calendar month
  via the FROZEN `techKeys.schedMonth`, ±1 month prefetch, a GROWING loaded-month set
  (never shrinks → stable agenda scroll), dedupe by id. PTR + focus revalidate through
  `invalidateTech(qc,'appointment')`; skeletons only on true cold start.
- **Rendering:** `color/kind/duration_days/is_milestone` all surfaced — STATUS owns the
  color channel (chip + timeline block tint), division demoted to a small pill, events
  (`kind='event'`/no job) styled distinctly. Nav strictly via `apptHref()/jobHref()`.
- **Filters/search/create:** carried over with legacy parity — me/all/multi-crew +
  division (`MITIGATION_DIVS = water/mold/contents`, matching legacy), persisted under the
  SAME `tech_schedule_filters_{empId}` localStorage key; create picker → existing
  `/tech/new-appointment` & `/tech/new-event`.
- **Pure logic** in `schedule/scheduleSelectors.js` (month-key math, grouping/sorting,
  filter predicates) with 24 committed vitest cases (`scheduleSelectors.test.js`, TEST
  fixtures only — never live rows). `npm test`/`build`/`eslint` green.

### Phase C — Cutover & cleanup (Jul 4 2026 — shipped)

Both `page:tech_dash_v2` and `page:tech_sched_v2` baked and are now `enabled=true`,
`dev_only_user_id=null`, `force_disabled=false` for every tech — verified live against
`feature_flags` immediately before AND after this phase's edits (owner-gated precondition
per `docs/tech-v2-roadmap.md`).

- **Legacy pages deleted:** `src/pages/tech/TechDash.jsx` + `src/pages/tech/TechSchedule.jsx`
  are gone. `src/App.jsx`'s `TechDashSwap`/`TechScheduleSwap` wrapper functions + their two
  lazy imports are removed; the `/tech` and `/tech/schedule` routes now render
  `element={null}` — `TechLayout.jsx`'s persistent v2 pane host (untouched, frozen) already
  covers those paths whenever its flags read true, so nothing else changes there.
  **Consequence:** rolling back the v2 pages is no longer a flag-flip (that now yields a
  blank `/tech`/`/tech/schedule` — the legacy fallback no longer exists) — it is a `git
  revert` of this phase's PR. By design for a post-bake cutover.
- **Dead CSS removed** from `src/index.css` (~300 lines): `.tech-dash-greeting/-date/-name/
  -summary/-greeting-sticky`, `.tech-appt-card` (+ `:active`/`:focus`/`[data-status=...]`),
  `.tech-appt-time`, `.tech-appt-title`, `.tech-appt-address`, `.tech-tasks-toggle`,
  `.tech-appt-actions`, `.tech-skeleton-card`/`-line` (+ variants/keyframe),
  `.tech-future-*` (row/time-col/time/line/content/title/address), `.tech-quick-action*`,
  `.tech-page-header-sticky`, `.tech-jump-today-fab`, `.tech-schedule-row` (+
  `[data-division]` variants), `@keyframes techFabIn` — each verified zero remaining JSX
  consumers before removal. Selectors still shared with live components were left alone:
  `.tech-tracker`/`-btn`/`-btn-secondary` (`TimeTracker.jsx`), `.tech-page-enter` (album/room/
  claim/job detail pages), `.tech-check-pop` (`TechTasks.jsx`), `.tech-section-header-sticky`
  (`TechAppointment.jsx`, `GenerateReportButton.jsx`). No `TECH-V2:` reserved marker touched.
- **Month view stretch stage — deferred again:** no scaffolding exists yet in
  `src/pages/tech/v2/schedule/**`; building one is a net-new UI feature out of scope for this
  session's mechanical-deletion mandate. Left for a future dedicated pass.
- Doc-header "Rendered by: TechDash.jsx" mentions remain in Foundation-frozen shared files
  (`TimeTracker.jsx`, `PhotoNoteSheet.jsx`, `StalledWidget.jsx`, `ClockSupersedeSheet.jsx`,
  `clockPrecheck.js`) — Phase C doesn't own those files, so they were left as-is; a future
  touch of those files should repoint the comment at the v2 dash.
- Could not do a live on-device visual walkthrough from this remote session (no Supabase
  credentials in this container — nothing renders); owner-gated post-deploy pass, same
  convention as Sessions S/D.

### Phase M1 — Job Hub (Jul 4 2026)

Merges the two legacy detail screens (`TechAppointment.jsx` + `TechJobDetail.jsx`) into ONE
job-rooted surface at **`/tech/job/:jobId?appt=<id>`**, behind `page:tech_job_hub` (seeded
`enabled=false` + `dev_only_user_id`=owner on live Supabase; `EXPLICIT_FLAGS` entry
`enabled:false`). Owner-only during M1. **Nav is NOT retargeted** — `apptHref()`/`jobHref()`/
`HUB_ENABLED` stay pointed at the legacy pages until M2; the hub is reachable by its route
(the flag redirects everyone else to `/`). Owns `src/pages/tech/v2/TechJobHub.jsx` +
`src/pages/tech/v2/hub/**` + CSS in the `TECH-V2: HUB` marker.

- **New RPC (own additive migration `20260704_tech_v2_m1_get_job_hub.sql`):**
  `get_job_hub(p_job_id uuid) → jsonb` **(NEW)** — one round trip: `{ job (full row), claim
  {id, claim_number} | null, work_auth_signed boolean, appointments [...] }`. Appointments are
  scoped by `a.job_id` (NOT via the claim), so a job with no claim still lists its visits —
  the per-row shape is byte-identical to `get_claim_appointments`. SECURITY DEFINER + GRANT to
  anon, authenticated; read-only; additive (touches no live function/table).
- **Structure:** shared `Hero` + `ActionBar` carry job identity (TechAppointment's hand-rolled
  hero + 5-button bar retired). `VisitPicker` groups the job's appointments Upcoming/Past and
  selects one → syncs `?appt=`. `VisitContext` (per selected visit): `TimeTracker` consumed
  as-is, tasks + toggle (`get_appointment_tasks`/`toggle_appointment_task`), crew, Scope Sheet
  entry, and moisture/equipment behind their EXISTING flags (`page:tech_moisture`,
  `page:tech_equipment`, `page:tech_rooms`). Job-wide: `JobPhotos` (grouped gallery + Lightbox
  + notes), `ClaimBreadcrumb`, collapsible `JobDetailsPanel`, `AdminJobMenu` (role-gated merge +
  typed-DELETE soft delete). Work-auth logic extracted ONCE (`WorkAuthBanner` + `showWorkAuthBanner`).
  Status bar: `TechJobHub` sets none. The three hero routes that do —
  `TechAppointment`, `TechClaimDetail`, `TechJobDetail` — call
  `pushStatusBarSurface('dark')` on mount and `restoreStatusBarBase()` on unmount
  (corrected 2026-07-27, STAT-01: this line previously claimed exactly one pair,
  in `TechJobHub`, which contains zero status-bar references).
- **Selected-visit detail** via `get_appointment_detail(selectedId)`; **job-wide docs** via
  `job_documents` (`buildDocsQuery` preserves the legacy `or=(appointment_id,job_id)` fallback
  shape). Mutations invalidate the shared dash/schedule caches via `invalidateTech`.
- **Offline fork (owner default):** a photo capture *in a visit context* (a visit selected)
  keeps the offline queue and tags the appointment; a *job-level* capture (no visit) uploads
  directly. Readings/equipment (always per-visit) keep the queue. Notes always insert directly.
- **Pure logic** in `hub/hubHelpers.js` (`selectVisitId` visit-picker, `showWorkAuthBanner`
  predicate parity with both legacy pages, `buildDocsQuery` doc-fallback parity) with 16
  committed vitest cases (`hub/hubHelpers.test.js`, TEST fixtures only). `npm test`/`build`/`eslint`
  green. M2 will flip `HUB_ENABLED`, add the `/tech/appointment/:id` resolver redirect, and
  delete the two legacy pages.

> ⚠️ **UPDATE (Jul 4 2026): M1 was rejected by the owner** ("it just stacked one page onto the
> other") and its surface is **superseded by "Job Hub v2"** (below). M1's flag was reverted to
> `enabled=false, dev_only_user_id=null`. M1's shared-component reuse (`Hero`/`ActionBar`/
> `TimeTracker`/`PhotoNoteSheet`/sheets) and pure `hubHelpers` survive; the stacked page shell +
> hand-rolled section lists are being replaced.

### Job Hub v2 — "the visit is the screen" (plan of record Jul 4 2026, docs-only)

Ground-up redesign replacing M1's surface at the same route/flag. Instead of stacking every
section, the **selected visit's clock state** drives what's prominent (ARRIVING / WORKING /
WRAPPED), everything stays reachable in every state, and capture/comms live in a docked
thumb-zone bar. **6-agent adversarial challenge pass complete** (all MODIFIED, none REFUTED —
fixed 2 parity blockers incl. job-less private appointments + the equipment/Day-N billing list).
Full spec + Z1–Z4 layout + challenge report: `docs/tech-v2-roadmap.md` → "Job Hub v2" section.
Cold-session prompts: `docs/tech-v2-dispatch.md` → H1/H2/H3. Ownership + the one authorized
`techQuery` amendment: `.claude/rules/tech-v2-wave-ownership.md` §7.
- **Phases (strictly serial):** H1 Stage & Dock (Opus·high — migration `get_job_hub` v2 adds
  `contacts[]` only + `get_job_contacts` drift-capture; `useVisitClock` hook + `StageClock`;
  Z1/Z2/Z3; i18n from day one) → H2 Below-fold & polish (Opus·high) → **owner bake (written
  sign-off)** → H3 Cutover (Opus·medium — flag to all techs; `/tech/appointment/:id` resolver
  incl. a **slim job-less-appointment surface** so private-appt payroll clocks keep a home;
  delete the two legacy pages + orphaned `appointment`/`job` i18n namespaces).
- **Nav retarget already shipped** (Jul 4): the per-user runtime `setHubNav`/`isHubNav` switch
  in `src/components/tech/v2/nav.js` (mirrored from `page:tech_job_hub` by `AuthContext`) replaced
  the static `HUB_ENABLED` const — so cutover is the flag opening, not a code flip.

#### Phase H1 — Stage & Dock (SHIPPED Jul 4 2026; flag still OFF)

Replaced M1's guts at `/tech/job/:jobId?appt=` behind the unchanged `page:tech_job_hub` flag
(owner-only; `nav.js` untouched). The surface now reads through **React Query** (cache-first via
the idb persister), not M1's local `useState`.
- **Migration `20260704_tech_v2_h1_job_hub_contacts.sql`:** drift-captures `get_job_contacts`
  verbatim (it had zero migration coverage) + REPLACEs `get_job_hub` adding ONE key —
  `contacts` (= `get_job_contacts(j.id)`, delegated so the shape can't drift). All v1 keys
  byte-identical; backward-compat test `supabase/tests/tech_v2_h1_job_hub.test.js` (static +
  self-skipping live).
- **`techQuery.js` (authorized §7 amendment):** 7th kind `hub(jobId) → ['tech','hub',jobId]`;
  every mutation (`clock/task/photo/room/doc/appointment`) also invalidates `hub`. All hub
  sub-resources (visit detail, clock entries, readings, equipment, "clocked-elsewhere") cache
  under the `['tech','hub',jobId]` prefix, so one hub-invalidation repaints the whole surface.
- **`useVisitClock(db, apptId, employeeId, jobId)`** — new hub-owned, read-only hook; disclosed
  copy-in of TimeTracker's entry derivation (`TimeTracker.jsx:231-243`): scheduled→omw→on_site→
  paused→completed, multi-entry Visit-N, live elapsed from `travel_start`, stale hint at
  FORGOT_CLOCKOUT_MIN (10h). Pure `deriveVisitClock` unit-tested. **TimeTracker NOT edited** and
  receives the `get_appointment_detail` object (never the hub appt row — crew shape differs,
  `.jobs` absent). `StageClock` is a new display-only 40px live timer.
- **Files (all under `src/pages/tech/v2/hub/`):** `TechJobHub.jsx` (orchestrator), `HubHeader`
  (Z1), `HubStage`+`HubChecklist`+`HubTools`+`StageClock` (Z2), `HubDock` (Z3), `HubBelowFold`
  (Z4 — visits switcher live; Job&Claim/photos are compact stubs H2 completes), pure helpers
  `useVisitClock`/`hubChecklistState`/`hubStageState` (+ tests). New i18n namespace `hub`
  (EN/PT/ES, registered in `src/i18n/index.js`, parity-tested). CSS in the §HUB marker
  (`tv2-hub-*`). M1's modules (`VisitContext`/`JobPhotos`/`JobDetailsPanel`/`VisitPicker`/
  `WorkAuthBanner`/`ClaimBreadcrumb`) are now unused — H2 deletes them; `hubHelpers`+`AdminJobMenu`
  retained.

#### Phase H2 — Below-fold & polish (SHIPPED Jul 7 2026; flag still OFF)

Completed Z4 and polished the whole surface. No schema/RPC changes (H2 ships zero migrations);
`page:tech_job_hub` stays owner-only OFF and `nav.js` is untouched. Stacked on H1 (H1 had not yet
merged to `dev`, so this branch carries H1's 3 commits — merge H1 first, or merge this after it).
- **Z4 in binding order** (`HubBelowFold.jsx` now just composes): **Visits switcher** (kept from
  H1) → **`JobClaimSection.jsx`** (new — collapsible Job & Claim, ABOVE photos: every `contacts[]`
  person with one-tap `tel:`/`mailto:`, division pill, carrier/policy/claim, adjuster block,
  deductible admin-only, claim breadcrumb → `/tech/claims/:id`; full legacy `JobDetailsPanel`
  field set) → **`PhotosNotes.jsx`** (new) → `GenerateReportButton` (self-gated, as-is).
- **`PhotosNotes.jsx`:** job-wide `job_documents` via `buildDocsQuery({jobId})`, cached under the
  `['tech','hub',jobId]` prefix (so `photo`/`doc` invalidation repaints it). Photos **selected-visit-
  first then job-wide**, grouped by day, capped 12 + "See all"/"+N more" → `/tech/jobs/:id/photos`.
  Tap → shared `Lightbox` with an **"Add note / room"** sibling-overlay button (Lightbox is a frozen
  shared component with no slot) → `PhotoNoteSheet` (note + room-tag + create-room). Inline add-note
  (`insert_job_document` category `note`, tagged to the selected visit). `sync:item-done`
  `photo.upload` listener (keyed to job) refreshes the gallery on offline-photo sync.
- **Admin kebab** (`AdminJobMenu`, H1-built, verified): merge + typed-`DELETE` archive — the ONLY
  typed-confirm on the surface.
- **Deleted M1 modules:** `JobPhotos`, `JobDetailsPanel`, `VisitContext`, `VisitPicker`,
  `ClaimBreadcrumb`, `WorkAuthBanner`. Retained: `hubHelpers`(+test, incl. the `showWorkAuthBanner`
  predicate), `AdminJobMenu`, and all H1 `Hub*`/`StageClock`/`useVisitClock` modules.
- **i18n:** new `hub.jobClaim.*` + `hub.photos.*` keys (EN/PT/ES real-quality, parity-tested);
  removed the H1 "coming soon" stub keys. **CSS:** appended inside the §HUB marker (`tv2-hub-*`
  only), coherent with the Dash/Schedule v2 language. `npm test` (764 pass) / `build` / `eslint`
  (changed files) clean. **Owner gate opens here** — owner bakes on their phone before H3.

---

## Admin Mobile — Phase F Foundation (Jul 7 2026)

Brings core **admin capabilities into the field-tech PWA** (`/tech/*`, `TechLayout`), reached
from `TechMore.jsx`, gated to `employee.role === 'admin'` behind the dark flag
`page:admin_mobile` (owner-only `dev_only_user_id` until flipped). Plan of record:
`docs/admin-mobile-roadmap.md`; ownership manifest `.claude/rules/admin-mobile-wave-ownership.md`.
**Frontend-only initiative — ZERO new schema, ZERO new RPCs** (the backend already exists; every
future screen consumes existing RPCs/workers). Foundation ships the **seams only** — every screen
is an empty stub.

- **Flag:** `page:admin_mobile` added to `src/lib/featureFlags.js` `EXPLICIT_FLAGS` as
  `enabled:false` (LOAD-BEARING — DevTools auto-seeds missing keys ENABLED; the explicit false
  keeps it dark). Live row also seeded `enabled:false` + owner `dev_only_user_id`.
- **Guard:** `AdminMobileRoute` (`src/components/admin-mobile/AdminMobileRoute.jsx`) allows only
  `role==='admin' && isFeatureEnabled('page:admin_mobile')`, else `<Navigate to="/tech">`. The
  decision is a pure `canAccessAdminMobile({role, flagEnabled})` in `adminMobileAccess.js`
  (8-case allow/deny unit test).
- **Routes:** `src/App.jsx` gains **one** delegating line inside `TechRoutes()` —
  `<Route path="tech/admin/*" element={…}>` → `src/pages/tech/admin/AdminMobileRoutes.jsx`
  (subrouter). All per-screen routes live in the subrouter (frozen route strings; mirrored by the
  href helper). Routes: `dash` (index), `collections`, `invoice/:invoiceId`,
  `estimate/new`, `estimate/:estimateId/edit`, `estimate/:estimateId`, `leads`.
- **Shared primitives (`src/components/admin-mobile/**`, all F-owned/frozen for the wave):**
  `AdminMobilePage` (page frame), `MoneyStatCard`, `AmListRow`, `PeriodSwitch` (+`ADMIN_PERIODS`),
  `AmTabs`, `href.js` (route builders — `adminDashHref`/`adminCollectionsHref`/`adminInvoiceHref`/
  `adminEstimateHref`/`adminEstimateEditorHref`/`adminLeadsHref`), `icons.jsx` (the admin-mobile
  icon set — icons live HERE, never in the frozen `Icons.jsx`/`crmIcons.jsx`), `index.js` barrel.
- **Stub pages (`src/pages/tech/admin/`):** `AdminDash`, `AdminCollections`, `AdminInvoiceDetail`,
  `AdminEstimateDetail`, `AdminEstimateEditor`, `AdminLeadCenter` — each renders `AdminMobilePage`
  + a placeholder. Wave phases P1–P5 fill these.
- **Nav:** `TechMore.jsx` gains an "Admin" group (Dashboard · Collections · New Estimate · Lead
  Center) visible only when `canAccessAdminMobile(...)` is true (mirrors the `tool:oop_pricing`
  conditional-group pattern). Invoice/estimate **detail** pages are id-parameterized (reached from
  the Collections lists in P2), so they are not menu entries.
- **CSS:** six reserved markers near the tech block in `src/index.css` — `ADMIN-MOBILE: SHARED`
  (F-owned base `.am-*` vocabulary) + DASH/COLLECTIONS/INVOICE/ESTIMATE/LEADS (one per wave phase).
  New classes are `.am-*`; no restyle of existing `.tech-*`/`.coll-*`/`.crm-*`.
- **Findings carried to wave phases:** **F-1** (P3 record-payment writes only the safe column set,
  never trigger-owned `amount_paid`/`status`/`paid_at`); **F-2** (P1/P2 reproduce
  `canAccess('overview_financials')` — the financial RPCs are not server-gated).

### Phase P2 — Collections / AR (mobile) (Jul 7 2026)

`AdminCollections.jsx` filled from stub → mobile Collections at `/tech/admin/collections`. Up to
four tabs via `AmTabs` (**AR aging · Invoices · Estimates · Payments**), each a mobile list of the
same data as the desktop "My Money" page. **Read-only, zero new schema/RPCs.**
- **RPCs consumed (call-only, POST rpc via `useAuth().db`):** `get_ar_invoices()` (AR + Invoices
  tabs), `get_estimates()`, `get_payments_ledger({p_limit:1000})`, `get_payments_received({p_start,
  p_end})` (AR "Collected (period)" stat).
- **Financial gate (F-2):** AR aging + Payments ledger tabs are financial. When
  `canAccess('overview_financials')` is false those two tabs are **filtered out of the tab bar** →
  their components never mount → their RPCs are never fetched (skips render AND fetch). Invoices +
  Estimates stay available to any admin. Default tab falls back to the first allowed tab.
- **Period switch** (`PeriodSwitch`/`ADMIN_PERIODS` = mtd/last30/qtd/ytd; no "All" — mobile
  simplification) shows only on AR + Invoices. On AR it scopes the Collected stat
  (`get_payments_received`); on Invoices it filters the list by invoice date. AR aging/outstanding
  are period-independent (snapshot — mirrors desktop).
- **Deep-links** via Foundation's frozen `href` helper (`adminInvoiceHref`/`adminEstimateHref`);
  rows land on `AdminInvoiceDetail`/`AdminEstimateDetail`. **Verification tail:** full landing
  confirmed once P3/P4a fill those stubs — until then rows resolve to F's stubs (route smoke-tested
  via the href-builder unit test).
- **Owned files:** `src/pages/tech/admin/AdminCollections.jsx`;
  `src/components/admin-mobile/collections/**` (`collFormat.js` pure math + row/href builders,
  `collFormat.test.js`, `collUi.jsx`, `ArAgingTab.jsx`, `InvoicesTab.jsx`, `EstimatesTab.jsx`,
  `PaymentsTab.jsx`); `src/index.css` §COLLECTIONS marker (`.am-coll-*`).
- **AGING_BUCKETS** (current/1–30/31–60/61–90/90+) + `bucketKey` + formatters/status/period math are
  **mirrored** (not imported) from desktop `collTokens.js` — the frozen `components/collections/**`
  tree is read-to-mirror, never imported. Tests pin the buckets to the same boundaries so mobile
  can't drift from desktop A/R.
- **Tests:** `collFormat.test.js` — aging-bucket math (boundary cases + `summarizeAr` totals),
  list-render row builders, and the href builder (asserts frozen route strings).

### Phase P3 — Invoice view + send + record payment (Jul 7 2026)

Fills the `AdminInvoiceDetail` stub (`/tech/admin/invoice/:invoiceId`). Zero migrations, zero
new RPCs; everything call-only per the manifest.

- **Screen (`src/pages/tech/admin/AdminInvoiceDetail.jsx`):** header (doc number, status chip,
  bill-to, carrier/claim/job/due/sent/address), money summary (**Balance due** full-width, then
  Invoiced/Collected 2-up via `MoneyStatCard`), read-only line items with subtotal/tax/total,
  read-only payment history (payer · method · date · ref · QBO ✓), `qbo_sync_error` banner.
  `inv.locked` hides both money actions; `feature:billing` off shows the desktop's flag message.
- **Send:** shown ONLY when `qbo_invoice_id` exists (this detail screen never pushes an unsynced
  invoice; QBO save/link remains a separate explicit human action). `POST /api/qbo-invoice
  { invoice_id, action:'send' }` with Bearer; two-click confirm (arms → "Confirm send", disarms on
  blur); toast feedback. This admin-mobile surface is web/PWA-only and is excluded from the
  field-only Capacitor bundle.
- **Record payment (finding F-1, test-first):**
  `src/components/admin-mobile/invoice/recordPayment.js` — `createPaymentRecorder()` inserts
  ONLY `{invoice_id, job_id, contact_id, amount, payment_date, payer_type, payer_name,
  payment_method, reference_number, recorded_by}` (never trigger-owned `amount_paid`/
  `insurance_paid`/`homeowner_paid`/`status`/`paid_at`); in-flight closure latch guards
  double-submit (no insert-level idempotency key exists); `POST /api/qbo-payment {payment_id}`
  (Bearer) fired only when `qbo_invoice_id` present; failed QBO sync is NON-FATAL (row persists,
  error toasted, never rolled back). 11 named tests in `recordPayment.test.js`.
- **Balance math:** `src/components/admin-mobile/invoice/invoiceMath.js` —
  `invoiceTotals()` = `(adjusted_total ?? total ?? live line total) − amount_paid` (desktop
  `InvoiceEditor` calc, tested) + `invoiceStatusKind()` chip logic (mirrors
  `collTokens.invoiceStatusKind`, replicated not imported — collections is frozen).
- **Payment form:** `src/components/admin-mobile/invoice/PaymentSheet.jsx` — inline expandable
  (no modal, tech-mobile-ux), balance pre-filled, payer/method chips, optional payer name +
  reference, 48px targets, two-click confirm ("Confirm — record $X") that disarms on any edit
  or blur. Parent runs the recorder; the sheet itself never touches `db`.
- **CSS:** all inside the reserved `§ADMIN-MOBILE: INVOICE` marker (`.am-inv-*`; plus disclosed
  descendant-scoped fit tweaks for the SHARED `.am-stat-card` inside `.am-inv-stats` only).
- **Dev-login caveat:** `invoice_line_items` RLS grants `authenticated` only — the anon
  dev-login client sees zero lines (same on desktop dev-login); real sessions render them.

### Admin Mobile — Phase P4a: Estimate view + send + convert (Jul 7 2026)

Fills the `AdminEstimateDetail` stub at `/tech/admin/estimate/:estimateId` with the read-only
estimate view + the send and convert actions. **Zero schema/RPCs** (QBO workers +
`convert_estimate_to_invoice` are call-only, per manifest §3).

- **Page:** `src/pages/tech/admin/AdminEstimateDetail.jsx`. Loads `estimates` → `jobs` (via
  `job_id`) → `claims` (via `job.claim_id`) → `contacts` (via `contact_id` or
  `job.primary_contact_id`) → `estimate_line_items` (ordered `sort_order`, then `created_at`).
  Line items are **read-only** here (editing is P4b).
- **View modules (`src/components/admin-mobile/estimate/`, P4a-owned — distinct from P4b's
  builder files):** `estimateActions.js` (pure `buildEstimateSendPayload` /
  `interpretConvertResult` / `deriveEstimateView` + `estimateActions.test.js` — named test for
  the send payload + convert `needs_confirm` handling), `EstimateHeader.jsx` (status pill +
  doc number + prepared-for + field grid + address), `EstimateLines.jsx` (read-only rows +
  totals).
- **Send:** two-click confirm → pushes to QBO first if unsynced (`POST /api/qbo-estimate
  { estimate_id }`), then `POST /api/qbo-estimate { action:'send' }` (worker defaults `send_to`
  to the contact email; the payload includes `send_to` only when a non-empty email is passed).
- **Convert (web/PWA admin-mobile only; excluded from the native bundle):**
  `convert_estimate_to_invoice(p_estimate_id, p_force)` → on `needs_confirm` the
  Convert button arms a two-click "append" (surfaces `existing_line_count`); on success →
  `POST /api/qbo-invoice { invoice_id }` to link in QBO, then navigates to the admin-mobile
  invoice detail via `adminInvoiceHref`.
- **P4b links:** "Edit / add line items" → `adminEstimateEditorHref(estimateId)`; "New estimate"
  → `adminEstimateEditorHref()`. ~~The builder page (P4b) is not yet landed~~ *(stale — P4b
  merged; verified 2026-07-13, see the Q2-RECON live audit of the admin-mobile estimate screens)*.
- **CSS:** `.am-est-*` classes inside the `ADMIN-MOBILE: ESTIMATE` marker (view rules, above any
  P4b builder block); tokens only. Actions are ≥48px touch targets.
- **Gate:** admin-only via `AdminMobileRoute` (no extra financial gate on this screen).

### Admin Mobile — Phase P1: Admin dashboard (Jul 7 2026)

Fills the `AdminDash` stub at `/tech/admin/dash` with the office Overview rebuilt as one tall,
single-column, fixed-order stack of cards. **Zero schema/RPCs** — reuses the 11 existing Overview
widget RPCs; each card fetches its own on mount (+ period change / Retry).

- **Page:** `src/pages/tech/admin/AdminDash.jsx`. Reads `canAccess('overview_financials')`, maps
  `visibleDashWidgets(canFin)` → card components, renders `PeriodSwitch` (MTD/Last 30/QTD/YTD).
- **FINANCIAL GATE (finding F-2 — the binding P1 risk):** the money-card RPCs
  (`get_revenue_by_division`, `get_payments_received`, `get_avg_ticket`, `get_ar_invoices`) are
  NOT server-gated. The gate is reproduced as the desktop `enabled=false` pattern: the pure
  decision `visibleDashWidgets(canFin)` in `dashPlan.js` DROPS the four financial cards when
  `canFin !== true`, so they are never mounted → neither rendered NOR fetched. `plannedRpcs(false)`
  contains none of `FINANCIAL_RPCS`. Named tests: `dash/dashPlan.test.js` (decision + fetch set,
  both directions) and `dash/AdminDash.render.test.jsx` (renders the real page with a mocked
  `canAccess`; asserts the money titles are absent and the `db.rpc` spy is untouched when access
  is off, present when on).
- **Modules (`src/components/admin-mobile/dash/`, all P1-owned):**
  - `dashPlan.js` — `DASH_WIDGETS` (fixed order, `fin` flag, per-card `rpcs`), `FINANCIAL_RPCS`,
    `visibleDashWidgets(canFin)`, `plannedRpcs(canFin)` — the single source of the F-2 gate.
  - `dashFormat.js` — pure shapers MIRRORED from the desktop `overview/hooks/*` (never imported —
    that tree is frozen): `periodBoundsISO` (mirror of `dashUtils.periodBounds`, 4 periods, no
    'Prev mo'/'All'), `fmtK`/`fmtFull`, `computeDelta`, `shapeMoneySplit`/`shapeAvgTicket`/
    `shapeOpenEstimates`+`donutGradient`/`shapeCollections`/`shapeJobsClosed`(+sparkline)/
    `shapeActiveDrying`/`shapeActionItems`/`shapeEmployeeStatus` (uses `@/lib/clockTime`
    `liveClockMinutes`)/`shapePipeline`, and the division-colour palette (data-viz, mirror of
    `overview/tokens.js` DIV). `dash/dashFormat.test.js` pins the math to the desktop numbers.
  - `useDashWidget.js` — per-card loader hook: async IIFE in an effect (no synchronous
    setState-in-effect), `alive` stale-drop, `dbRef` synced in an effect, refetch on loader
    change (period) + `reload()`.
  - `DashCard.jsx` — card shell (title/suffix/LIVE badge/delta pill, loading shimmer, error+Retry,
    footer) + `DeltaPill`/`DashFootLink` (frozen href helper)/`DashEmpty`.
  - `FinancialCards.jsx` (Revenue, Payments via shared MoneySplitCard, AvgTicket, Collections),
    `WorkCards.jsx` (JobsClosed+sparkline, JobsCompleted, OpenEstimates donut),
    `OpsCards.jsx` (ActiveDrying, ActionRequired, EmployeeStatus [live], Pipeline).
- **Deep-links:** money/estimate cards footer-link to the admin-mobile Collections screen via
  `adminCollectionsHref()` (frozen href helper). Job-centric rows (drying/action/employee) have
  no admin-mobile destination this wave → read-only (no hardcoded `/jobs` paths).
- **Charts:** CSS/SVG only, no chart lib — stacked `.am-dash-splitbar`, `conic-gradient` donut,
  inline `<svg>` sparkline, CSS bars. **CSS:** `.am-dash-*` classes inside the `ADMIN-MOBILE: DASH`
  marker (tokens only; division/chart hues are inline data-viz fills). Adapts to the tech dark
  theme (token-based); ≥44px controls.

### Admin Mobile — Phase P4b: Estimate create + line-item builder (Jul 7 2026)

Fills the `AdminEstimateEditor` stub at `/tech/admin/estimate/new` (create mode) and
`/tech/admin/estimate/:estimateId/edit` (builder mode). **Zero schema/RPCs**
(`create_estimate_for_contact` + `/api/qbo-query` are call-only, per manifest §3; line-item
writes go straight to `estimate_line_items`).

- **Page:** `src/pages/tech/admin/AdminEstimateEditor.jsx`. Create mode renders
  `EstimateCreateForm`; on create it navigates (replace) into builder mode. Builder mode loads
  `estimates` → `contacts` → `estimate_line_items` (seeding one blank line on a fresh,
  never-synced draft, mirroring the desktop editor), and bounces a CONVERTED estimate back to
  the P4a view. "Done — review & send" returns to `adminEstimateHref` — the builder
  deliberately has **no QBO write path** (push/send/convert stay on P4a's screen; P4b's only
  QBO call is the read-only `/api/qbo-query` item/class catalog, with the desktop's
  Category-item filter).
- **Builder modules (`src/components/admin-mobile/estimate/`, P4b-owned — distinct from P4a's
  view files):** `estimateBuilder.js` (pure `buildCreateEstimatePayload` /
  `CREATE_ESTIMATE_PARAMS` / `LINE_SAFE_COLUMNS` / `buildLineInsert` / `buildLineUpdate` /
  `parseQboCatalog` / `computeTotals`) + `estimateBuilder.test.js` (the named P4b tests:
  create-shell payload exact-keys; every line write excludes the GENERATED `line_total`),
  `EstimateCreateForm.jsx` (contact search via `search_contacts_for_job`, inline new customer
  via `AddContactModal` + `get_insurance_carriers` with duplicate-phone fallback, division/type
  chips, `AddressAutocomplete` property address prefilled from billing, existing-estimates
  dup guard, double-submit-latched Create), `LineItemCard.jsx` (editable card: item/class
  pickers commit on select, description/qty/rate commit on blur, live amount, two-click remove
  with onBlur disarm), `CatalogPicker.jsx` (inline expandable QBO item/class picker — no
  modal), `builder.render.test.jsx` (static render smoke).
- **Money math:** every `estimate_line_items` write is shaped by
  `buildLineInsert`/`buildLineUpdate` — `line_total` is GENERATED and never written; the
  `trg_estimate_lines_total` DB trigger rolls lines up into `estimates.subtotal/amount`, so the
  builder never writes the `estimates` table at all.
- **CSS:** `.am-estb-*` classes appended BELOW P4a's block inside the `ADMIN-MOBILE: ESTIMATE`
  marker (P4a's lines untouched); tokens only; ≥48px touch targets throughout. Reuses P4a's
  `.am-est-btn`/`.am-est-card`/totals classes without editing them.
- **Not in v1:** line drag-reorder on mobile (gloved hands — lines keep creation order; desktop
  `EstimateEditor` still reorders).
- **Gate:** admin-only via `AdminMobileRoute` (no extra financial gate, matching P4a).

### Admin Mobile — Phase P5: Lead Center (mobile) (Jul 7 2026)

Fills the `AdminLeadCenter` stub at `/tech/admin/leads` with the mobile Lead Center — the
inbound-lead list with call-recording playback and transcripts, mirroring the office
`CrmCallLog`. **Zero schema/RPCs** (all reads/calls are existing RPCs + the recording proxy).

- **Page:** `src/pages/tech/admin/AdminLeadCenter.jsx`. Loads leads via `get_inbound_leads`
  (`p_limit:100`, a POST RPC that embeds `contact` and is never cache-stale). Status/spam filter
  tabs (with per-tab count badges) + a name/number search; auto-refreshes every 20s while visible
  and on focus. Status writes are **call-only** via `update_lead_status(p_lead_id, p_status)`,
  optimistic with reload-on-failure. The CRM-owned REPLACEs `move_lead_to_stage` /
  `get_contact_activity` are **not re-defined** here (manifest §3 #3).
- **Modules (`src/components/admin-mobile/leads/`, P5-owned):**
  - `leadFormat.js` — pure helpers: `STATUS_OPTIONS`, `STATUS_FILTER_TABS`, `statusLabel`,
    `formatDuration`, `formatValue`, `fmtTime`, `isAwaitingRecording(lead, now)`,
    `contactLabelFor`, `groupTurns`, and `filterLeads(leads, {status, search})` (the `'all'` tab
    excludes spam; `'spam'` surfaces `lead_status==='spam'` OR `spam_flag`; else exact status).
  - `LeadRow.jsx` — presentational card (no `useAuth`; db lifted to the page via `onStatusChange`
    so it renders without an AuthContext and stays unit-testable). Plays recordings via
    `GET /api/callrail-recording?lead_id=` with `getAuthHeader()` Bearer → validates
    `Content-Type: audio/*` → `URL.createObjectURL`; blob URL revoked on unmount (an `<audio src>`
    can't carry the header).
  - `RecordingPlayer.jsx` + `TranscriptView.jsx` — **copied in** from `CrmCallLog.jsx` (frozen;
    never edited), classes re-namespaced to `.am-audio-*` / `.am-transcript-*`. `TranscriptView`
    renders `transcript_analysis` (summary/sentiment/topics/grouped speaker turns/entities) with a
    flat-`transcription` fallback for older rows.
  - `leads.render.test.jsx` — named test: lead-list (`LeadRow`) render + transcript-view render
    from a fixture `transcript_analysis`, plus `filterLeads` status/spam/search coverage.
- **CSS:** new `.am-lead-*` / `.am-audio-*` / `.am-transcript-*` / `.am-sentiment-*` /
  `.am-topic-chip` classes inside the `ADMIN-MOBILE: LEADS` marker, tokens only. The copied CRM
  visuals were re-namespaced to `.am-*` (not literal `.crm-*`) because the CRM tokens/selectors
  are scoped to `.crm-shell` and the manifest §5 forbids restyling `.crm-*` in the tech shell.
  Interactive controls are ≥44px touch targets.
- **Gate:** admin-only via `AdminMobileRoute` (no extra financial gate on this screen).

---

## Cloudflare Workers — Environment Variables
```
SUPABASE_URL                    — https://glsmljpabrwonfiltiqm.supabase.co
SUPABASE_SERVICE_ROLE_KEY       — Service role key (Cloudflare Pages secrets)
SUPABASE_ANON_KEY               — Anon key
VITE_SUPABASE_URL               — Same (Vite build)
VITE_SUPABASE_ANON_KEY          — Same (Vite build)
VITE_BUILD_TARGET               — "native" only set inside `npm run build:ios`; default web
RESEND_API_KEY                  — Resend API key (all transactional email; replaced SENDGRID_API_KEY Jun 2026)
EMAIL_FROM                      — optional sender override; default "Utah Pros Restoration <restoration@utahpros.app>" (domain must be verified in Resend)
EMAIL_REPLY_TO                  — optional reply-to override; default restoration@utah-pros.com
ENCIRCLE_API_KEY                — Encircle integration
QBO_CLIENT_ID                   — QuickBooks Online OAuth client id (Intuit Developer app)
QBO_CLIENT_SECRET               — QuickBooks Online OAuth client secret
QBO_ENVIRONMENT                 — "sandbox" | "production" (default production)
QBO_REDIRECT_URI                — https://dev.utahpros.app/api/quickbooks-callback (must match Intuit app exactly)
QBO_WEBHOOK_SECRET              — Shared QBO server capability; accepted on preserved background-safe QBO paths such as estimate customer self-calls and payment scheduling; explicitly rejected by the human-only qbo-invoice endpoint; the legacy contact trigger is inert
APP_BASE_URL                    — Optional; base for the OAuth return redirect (default: origin of QBO_REDIRECT_URI)
DEMO_SHEET_FROM_EMAIL           — Optional override (default restoration@utah-pros.com)
DEMO_SHEET_TO_EMAILS            — Optional CSV override (default moroni.s@utah-pros.com,restoration@utah-pros.com)
TWILIO_*                        — 7 vars (pending go-live)
APNS_P8_KEY                     — AuthKey_XXX.p8 contents (PEM); configured in Cloudflare Preview + Production
APNS_KEY_ID                     — 10-char APNs Auth Key ID
APNS_TEAM_ID                    — 10-char Apple Developer Team ID
APNS_TOPIC                      — fixed legacy/NULL-row fallback `com.utahprosrestoration.upr` in BOTH Preview and Production; never flip it per app. Live `device_tokens.apns_topic` selects each enrolled installation's receiving bundle, including the side-by-side dev app.
APNS_ENV                        — exact "sandbox" (development-signed builds) | "production" (TestFlight/App Store); missing/unknown fails closed
```

**jsonResponse signature:** `jsonResponse(data, status, request, env)`

---

## Google Integration — per-employee Drive + Calendar (Jun 2026)

Each employee connects **their own** Google account once (Settings → Integrations →
"Connect Google"). One consent grants **both** features (non-restricted scopes →
no Google app verification for an Internal Workspace app):
- `drive.file` — pick files from Drive into a job (JobPage Files tab).
- `calendar.events` — push the appointments they're assigned to into their Google Calendar.

**Tokens:** `user_google_accounts` (PK `employee_id`; `access_token`, `refresh_token`,
`token_expires_at`, `google_email`, `scopes`). RLS on, **service-role only**. Refresh
token never leaves the server. Token refresh + OAuth lib: `functions/lib/google-drive.js`
(`getValidAccessToken` is shared by Calendar). OAuth state stashed in `integration_config`
(`gdrive_oauth_state` / `gdrive_oauth_user`).

### Calendar sync (Jun 28 2026)

Pushes appointments → each assigned crew member's Google Calendar (create / update /
delete). **Built source-agnostic** (~~to survive the planned appointments→scheduled-jobs
refactor~~ — that refactor was declared stale and superseded by the Schedule Desktop plan of
record, `docs/schedule-roadmap.md`, 2026-07-03; the mapping stays source-agnostic regardless).

- **`google_calendar_links`** — durable mapping, one row per (synced occurrence × crew
  member). Cols: `id, source_type` (`'appointment'` today, `'job_schedule'` later),
  `source_id, employee_id, google_event_id, calendar_id, sync_hash, status`
  (`pending|synced|deleted|error`), `last_error, synced_at`. UNIQUE
  `(source_type, source_id, employee_id)`. RLS on, service-role only. Retains the
  event-id mapping even after the source row is deleted, so deletes/updates always land.
- **RPC `get_google_calendar_status()`** — per-caller `{connected (has calendar scope),
  google_email, synced_count, error_count}`.
- **Triggers** `trg_appointments_calendar_sync` (appointments I/U/D) +
  `trg_appointment_crew_calendar_sync` (crew add/remove) → `notify_google_calendar_sync()`
  → `net.http_post` to the worker (pg_net, same pattern as QBO customer sync). **Inert
  until ≥1 employee has the calendar scope** (cheap EXISTS guard), so it's a no-op on prod
  until someone connects.
- **Workers:** `functions/api/google-calendar-sync.js` (trigger target, secret-auth via
  `integration_config.gcal_webhook_secret`) and `functions/api/google-calendar-resync.js`
  (authenticated "sync my upcoming appointments now" backfill, today→+60d). Core logic in
  `functions/lib/google-calendar.js` (`syncAppointment`, `removeSourceEvents`,
  `buildEventBody`). Times sent with explicit `timeZone: 'America/Denver'` (appointments
  store local date+TIME, no TZ). `status='cancelled'` or a deleted appointment removes the events.
- **`integration_config`:** `gcal_worker_url` — **already flipped to production**
  (`https://utahpros.app/api/google-calendar-sync`, confirmed live Jul 1 2026) + `gcal_webhook_secret`.
  URL-allowlist hardening for `notify_google_calendar_sync()` is live as
  `20260731165215_pg_net_worker_url_allowlists`; registry + ops audit:
  `docs/database/integration-config-worker-urls.md`.
- **Requires** the same Google Cloud OAuth client + Cloudflare env vars as Drive
  (`GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI`), plus the calendar scope on the OAuth consent screen.

---

## QuickBooks Online Integration (Jun 18 2026 — Phase 1: customer sync)

Customer creation is one-directional UPR→QBO, but it is no longer automatic on contact insert.
When an invoice or estimate needs a paying-party contact
(`homeowner`/`property_manager`/`tenant`, with a non-empty name),
`ensureQboCustomer()` self-posts `{contact_id}` to `/api/qbo-sync-customer` with the existing server
capability. Settings also exposes explicit preview/backfill. The Worker creates or links the QBO
Customer and writes `qbo_customer_id`/`qbo_synced_at` back to the contact.

The attached `trg_qbo_customer_sync`/`notify_qbo_customer_sync()` path is deliberately inert after
`20260701_crm_qbo_phase_b_gate_contact_trigger.sql`; its historical pg_net flow is not a current
caller.

**Tables (RLS-locked — service-role only; NO anon/authenticated policies):**
- `integration_credentials` — `provider PK, access_token, refresh_token, realm_id, environment ('sandbox'|'production'), token_expires_at, company_name, connected_by UUID→employees, connected_at, updated_at`. One row per provider (`'quickbooks'`). Access token auto-refreshes (~1h) inside the worker; refresh token rolls forward.
- `integration_config` — `key PK, value, updated_at`. Keys: `qbo_worker_url`, `qbo_webhook_secret`, plus transient `qbo_oauth_state` / `qbo_oauth_user` during connect.

**Columns added to `contacts`:** `qbo_customer_id TEXT`, `qbo_synced_at TIMESTAMPTZ`, `qbo_sync_error TEXT` (+ partial index `idx_contacts_qbo_unsynced`).

**RPCs (SECURITY DEFINER, granted to authenticated — never return tokens):**
- `get_integration_status(p_provider DEFAULT 'quickbooks')` → provider, connected, environment, company_name, realm_id, token_expires_at, connected_at
- `get_qbo_sync_stats()` → synced, pending, errored (counts over contacts)

**Workers:**
- `quickbooks-connect.js` — GET, active internal-admin Supabase Bearer only. Returns `{ url }` to start Intuit OAuth; stashes a CSRF `state`. The shared QBO server secret is intentionally not an OAuth identity.
- `quickbooks-callback.js` — GET. Intuit redirect target; verifies state, exchanges code→tokens, stores connection + company name, and redirects to `/settings/integrations?qbo=connected|error|badstate`.
- `qbo-sync-customer.js` — POST. Auth via the exact `x-webhook-secret` server capability or an active internal-admin Supabase Bearer. Body `{ contact_id }`, `{ backfill:true, limit }`, or `{ backfill:true, dry_run:true }` (preview — reports would-create vs would-link, writes nothing). Dedup before create: matches an existing QBO customer by **email**, then by **normalized exact DisplayName** (links to it instead of duplicating); QBO 6240 duplicate-name handled by appending the phone's last 4. Backfill capped at 100/call. Logs to `worker_runs` as `qbo-sync-customer`.

**Lib:** `functions/lib/quickbooks.js` — OAuth exchange/refresh, `qboFetch`, `getValidAccessToken` (refreshes within 5 min of expiry), `mapContactToCustomer` (normalizes name whitespace), `queryCustomer`, `findExistingCustomer` (email → display-name dedup), `createCustomer`, `ensureQboCustomer` (on-demand: POSTs to `qbo-sync-customer` so an estimate's billable contact can become a QBO customer at estimate time — see BILLING-CONTEXT.md "on-demand creation"). Captures Intuit's `intuit_tid` from API responses (logged on every call; stored in `contacts.qbo_sync_error` on failures for support troubleshooting).

**On-demand customer creation (Phase A/B, shipped; full detail in BILLING-CONTEXT.md):**
`qbo-estimate.js` calls `ensureQboCustomer(request, env, contactId)` when a billable contact has no
`qbo_customer_id` yet, then re-reads and throws the usual "sync the client first" error only if it
is still missing. The human-only `qbo-invoice.js` path requires the contact to be linked already;
it never substitutes the shared server capability for the signed-in actor. Migration
`20260701_crm_qbo_phase_b_gate_contact_trigger.sql` replaced the still-attached contact-insert
trigger body with `RETURN NEW`, so it is deliberately inert; on-demand estimate sync and explicit
Settings preview/backfill are the active checked-in customer-sync callers.

### Settings Overhaul P9 + Encircle — managed credentials

**Historical source-shape note:** this subsection records the P9/Encircle source as understood on
2026-07-23. Its former “pending/unapplied/flag OFF” live-state claims are superseded by the current
checkpoint at the top of this document. Current source-to-live mapping, apply, catalog, and flag
state are unknown pending read-only provenance recapture.

Migration `20260707_p9_credential_management.sql` moved Stripe/Twilio/Resend secrets into the already-locked `integration_credentials` (secret = `access_token`) + `integration_config` (Twilio's non-secret bits) tables. The reviewed repository source `20260723_encircle_managed_credentials.sql` adds Encircle to the same source with an inert default-OFF rollout. Admins manage these on **`/settings/integrations`** instead of editing environment bindings. **Both tables keep their zero-policy RLS posture — no policy added; secrets are service-role/SECURITY-DEFINER-only and never reach the browser.**
- **Rows:** `integration_credentials` contains `stripe` / `twilio` / `resend`; the reviewed source seeds an Encircle placeholder with no token. Encircle adds `managed_status` (`fallback|active|disabled`), `last_verified_at`, and `last_verification_status`. `integration_config` holds `twilio_account_sid`, `twilio_messaging_service_sid`, `twilio_phone_number` (non-secret identifiers). OAuth *app-registration* client IDs (QBO/Google) deliberately stay env — see the roadmap architecture caveat.
- **RPCs** (SECURITY DEFINER; writes admin-gated via `auth.uid()`→`employees.role='admin' AND is_active`; never return a token):
  - `get_managed_credentials_status()` → SETOF json. The reviewed source shape has four provider rows and preserves legacy fields while adding Encircle-safe `managed_status`, verification timestamps/status, and organization name. It never selects a token and calls `p9_assert_admin()` before reading.
  - `set_integration_secret(p_provider, p_secret)` — write the Stripe/Resend key or Twilio auth token. GRANT `authenticated`.
  - `set_twilio_config(p_account_sid, p_messaging_service_sid, p_phone_number)` — NULL arg = leave unchanged, `''` = clear. GRANT `authenticated`.
  - `disconnect_integration(p_provider)` — clears the secret (+ Twilio config). GRANT `authenticated`.
  - `p9_assert_admin()` — shared admin guard used by the write RPCs.
- **Resolver:** `functions/lib/credentials.js` — `resolveCredential(env, db, provider)` reads **DB-first, env-fallback** (per field), never throws on a DB blip, and skips the DB entirely when no `SUPABASE_URL`. Stripe/Resend/Twilio retain the 60s cache. Encircle is deliberately uncached so `disabled` suppresses the legacy fallback on the next request. Shapes: stripe `{ secretKey }`, resend `{ apiKey }`, twilio `{ accountSid, authToken, messagingServiceSid, phoneNumber }`, Encircle `{ apiKey, source }`.
- **Encircle writer:** `functions/api/encircle-credential.js` is active-admin + fail-closed-flag gated, validates a candidate with a harmless Encircle organization read before persisting, and returns status metadata only. `upr-mcp/src/encircle.js` independently reads the same managed row/state because it is a separate Worker runtime.
- **Swaps (one additive line each, env fallback retained → behavior-identical when the DB row is absent):** `functions/lib/stripe.js` (`stripeFetch` uses the resolved key), `functions/lib/twilio.js` (`sendMessage`), `functions/lib/email.js` (`sendEmail`).
- **Cutover:** owner removes the Cloudflare env secrets only AFTER verifying the DB path on dev. **Follow-up (out of P9's owned files):** the env-based `stripeConfigured(env)` pre-flight gate in the 4 Stripe workers and Twilio's `twilio-webhook.js` signature validation still read env — so Stripe/Twilio env can't be fully removed until those are migrated too (the *send* path is DB-first now).
- **UI:** `src/pages/settings/Integrations.jsx` admin-only paste-key cards use write-only inputs and two-click disconnect/disable. The Encircle card appears only when the explicit dark flag exists and is effective. Tests cover resolver/fallback parity, candidate validation/no-write, negative authorization, token-free UI helpers, and the apply-window authenticated RPC contract.

**UI:** `/settings/integrations` (admin-only) — Connect/Reconnect, connection status, synced/pending/error counts, **Preview sync** (dry-run with per-contact create/link breakdown), and "Sync existing customers" backfill. (P7-lite, 2026-07-04: the DevTools → Integrations tab this was ported from has been deleted.)

**Environments / domains (IMPORTANT):**
- **dev branch → https://dev.utahpros.app** (Cloudflare **Preview** env) — staging; used for sandbox testing.
- **main branch → https://utahpros.app** (Cloudflare **Production** env) — what everyone uses; production QuickBooks runs here.
- `integration_config.qbo_worker_url` is legacy configuration for the now-inert contact trigger; it
  is not an active caller. On-demand estimate sync uses the deployment's own origin. QBO
  bindings must still live in the matching Cloudflare environment (Preview for dev, Production for
  main).
- Public EULA/Privacy pages (required by the Intuit production profile) are served at `https://utahpros.app/terms` and `/privacy` (`src/pages/Legal.jsx`). Connecting your own company needs production keys but **no marketplace review**.

**Production setup checklist:**
1. developer.intuit.com → get **Production** Client ID + Secret. Add redirect URI `https://utahpros.app/api/quickbooks-callback` under the **Production** Redirect URIs tab; set EULA=`/terms`, Privacy=`/privacy`, host domain=`utahpros.app`.
2. Cloudflare **Production** env vars: `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_ENVIRONMENT=production`, `QBO_REDIRECT_URI=https://utahpros.app/api/quickbooks-callback`, `QBO_WEBHOOK_SECRET` (must equal `integration_config.qbo_webhook_secret`). Redeploy.
3. https://utahpros.app/settings/integrations → Connect QuickBooks → authorize your real company.
4. Preview sync → review → "Sync existing customers" to backfill the existing paying-party contacts.

(Sandbox testing used the same flow with `dev.utahpros.app` URLs, `QBO_ENVIRONMENT=sandbox`, and the Development-tab redirect URI. Before the production cutover, clear the sandbox connection (`DELETE FROM integration_credentials WHERE provider='quickbooks'`) and reset `contacts.qbo_customer_id/qbo_synced_at/qbo_sync_error` to NULL so the production backfill processes everything fresh.)

**Scope:** Customers + invoices, one-way (UPR→QBO). Customer dedup matches on email + exact
(normalized, case-insensitive) name; fuzzy/spelling variants are not caught. Contacts become QBO
Customers through estimate on-demand sync or explicit Settings preview/backfill, regardless of
when name/role was populated. Invoice push requires the contact's QBO customer link to exist first.

---

## QuickBooks Online — Invoices (Jun 18 2026 — Phase 2a)

**One invoice per job (= per division)** is the norm — insurance pays each category (mitigation, reconstruction) on separate checks, so each check applies to its own single-class invoice. **A job can have more than one invoice when a supplement is needed** (you can't add lines to an already-paid invoice). The QBO `DocNumber` is unique per invoice: the number QBO already assigned, else `job_number` for the first invoice and `job_number-N` for the Nth (e.g. `R-2604-009`, then `R-2604-009-2`) — see `functions/api/qbo-invoice.js`. UPR's `invoices` / `invoice_line_items` / `invoice_adjustments` tables are the source of truth (draft → push to QBO); QBO gets a clean summary invoice.

**Read endpoint:** `functions/api/qbo-query.js` — POST, SELECT-only QBO query passthrough
(Items/Classes/Invoices); auth via the exact server capability or an active internal-admin Supabase
Bearer; tokens stay server-side.

**Foundation (`migrations/20260618_invoice_qbo_foundation.sql`):** `invoices.qbo_invoice_id/qbo_synced_at/qbo_sync_error`; `generate_invoice_number()` (seq `invoice_number_seq` → `INV-######`); `create_draft_invoice_for_job()` AFTER INSERT trigger on `jobs` (one draft per job), **gated by `integration_config.auto_draft_invoices` (default `'false'` = dormant)**.

**Invoice-number hardening (`migrations/20260707_harden_invoice_number_generation.sql`, 2026-07-07):** the Q2 reconciliation inserted invoices with EXPLICIT numbers (INV-000049–087) that never advanced `invoice_number_seq`, so the app began re-issuing used numbers (a July draft collided at INV-000062 — same class as the 6/30 claim-number bug). Now: **`UNIQUE(invoices.invoice_number)`** + `generate_invoice_number()` rewritten to `max(numeric suffix)+1` from real rows under `pg_advisory_xact_lock` (sequence kept as a synced secondary guard). `qbo_doc_number` is intentionally NOT unique (split/deductible invoices reuse it). Data-integrity health check: `scripts/invoice-integrity-check.sql`. *(Also 2026-07-07: reconciliation line-item backfill + line-amount corrections — see `BILLING-AR-CONSUMER-CHAIN.md` §6b/§6c and `scripts/backfill-recon-invoice-lines.sql` / `fix-recon-invoice-line-amounts.sql`.)*

**Push worker:** `functions/api/qbo-invoice.js` — active, non-external admin Bearer only; the shared QBO server secret is rejected before connection, ledger or provider access. POST `{ invoice_id }` creates or updates the QBO invoice (division→Item+Class via `divisionToQbo`, customer = contact `qbo_customer_id`, claim/job ref in PrivateNote). One owner-scoped UUIDv4 operation id plus the private command ledger makes retry recovery safe across ambiguous provider and local-finalization failures. `{ invoice_id, action:'delete' }` removes it from QBO. `{ invoice_id, action:'send', send_to? }` asks QBO to **email the invoice to the customer** (QBO `/invoice/{id}/send` via `sendInvoice()`; recipient defaults to the invoice contact's email, override with `send_to`); on success the service-only CAS stamps invoice link/send metadata. Surfaced as the "Send invoice to customer" button (two-click confirm) in `InvoiceEditor.jsx`. Logs `worker_runs` as `qbo-invoice`. **UI note:** the editor presents this as a first-party UPR invoice — the primary **Save** button persists line edits and pushes to QBO (create first time, update after) in one step; QuickBooks is not surfaced in the UI labels (status: Draft → Saved → Sent → Partial → Paid).

**On-demand draft RPC (`migrations/20260618_invoice_create_rpc.sql`):** `create_invoice_for_job(p_job_id, p_created_by DEFAULT NULL) RETURNS invoices` — idempotent (returns existing invoice for the job if any), else inserts a `'draft'` `'standard'` invoice with `generate_invoice_number()`. Granted to `authenticated`. Used by the Billing UI's "Create invoice" button (works without the dormant auto-draft trigger).

**Billing UI (`src/components/ClaimBilling.jsx`):** rendered on the Claim page (`ClaimPage.jsx`, desktop SectionCard + mobile CollapsibleSection — relocatable later). Props `{ jobs, db, canEdit }`. One row per job/division: Create invoice → set amount (`db.update invoices subtotal/total`) → **Push to QuickBooks** (`POST /api/qbo-invoice`) with a QBO-synced/Error badge; "Remove from QuickBooks" (delete action) once synced. All edit actions gated behind `canEdit`.

**AR mapping (`migrations/20260618_invoice_to_job_ar_sync.sql`):** trigger `trg_invoices_sync_job_ar` (AFTER INSERT/UPDATE/DELETE on `invoices`) → `sync_job_invoiced_from_invoices(job_id)` keeps `jobs.invoiced_value` / `invoiced_date` in sync from invoices, so the existing **Financials/Collections dashboard** (which reads `jobs.invoiced_value` via `getBalances()`) reflects QBO automatically. "Invoiced" = pushed to QBO (`qbo_invoice_id IS NOT NULL`); billed amount = `SUM(COALESCE(adjusted_total, total))`; `invoiced_date` stamped from `min(qbo_synced_at)` (COALESCE — never overwrites a set date). **Non-destructive**: only writes a job that has ≥1 pushed invoice, so legacy hand-entered values (no invoices / drafts only) are never zeroed. Drafts and "Save amount" don't move AR until pushed. **Collected ($) still hand-logged** (PaymentModal → `jobs.collected_value`); QBO payment sync is phase 2c.

**Read-time repoint (`migrations/20260618_get_job_financials.sql` + `lib/claimUtils.js`):** the `invoices` table is the **source of truth** for the Financials/Collections views. RPC `get_job_financials(p_job_ids uuid[] DEFAULT NULL) RETURNS TABLE(job_id, invoice_count, invoiced, collected, balance_due, deductible, insurance_responsibility, homeowner_responsibility, depreciation_withheld, depreciation_released, invoiced_date)` rolls up **pushed** invoices per job (`qbo_invoice_id IS NOT NULL`; granted `anon, authenticated`). `claimUtils.withJobFinancials(db, jobs)` overlays that rollup onto job objects (attaches `job._fin`, overrides `invoiced_value`; `collected_value` only when invoice `amount_paid > 0`) with **COALESCE fallback** to the legacy `jobs` fields — a job with no pushed invoices renders exactly as before. `getBalances()` prefers `job._fin` (invoiced + deductible) when present, else legacy. Wired into `ClaimCollectionPage`, `ClaimPage`, `Jobs`, `Production`, `JobPage`. `CustomerPage` (`get_customer_detail`) and `MergeModal` still read `jobs.invoiced_value`, kept accurate by the AR-sync trigger. The trigger is **retained** as a denormalized projection (belt-and-suspenders + covers the non-overlaid consumers); read-time and trigger use identical definitions so they always agree. Rollup failures degrade silently to legacy values.

**Division → QBO (`lib/quickbooks.js` `divisionToQbo`):** recon→Item `1010000201` + class Reconstruction; **remodeling→same Item/class as recon** (added Jun 29 2026 — remodeling maps onto Reconstruction, not its own bucket, see the Overview Dashboard section above); water/mit→Item `1010000071` + class Mitigation; mold→Item `1010000131` (no class); contents→Item `38` (no class). Insurance-adjustment item `1010000231`. Class Ids resolved at runtime by name. **Note:** `BILLING-CONTEXT.md` is the current, more detailed source for the QBO/billing architecture — this doc's Phase 1/2a/2b/2c framing below is historical/narrative and the two docs use different organizing schemes for the same subsystem; prefer `BILLING-CONTEXT.md` when they disagree. **Invoice numbering (Jun 20 2026):** the worker sends the **job number as the QBO `DocNumber`** (on create + update; unique since one invoice per job, ≤21 chars). The QBO company has *Custom transaction numbers* ON — so when we sent no DocNumber, QBO left the invoice number **blank**; supplying the job number fixes that and makes the QBO invoice number == the job number. (If that QBO setting is ever OFF, QBO ignores the supplied number and auto-numbers — still safe.) The worker captures `qboInv.DocNumber` back into **`invoices.qbo_doc_number`**, and the UI displays that (UPR's `INV-######` is only the pre-send draft handle). **QBO memo (standard):** `Date of loss: <dol> · Job: <job#> · Claim: <claim#> · Service Address: <full addr>` — written to BOTH `CustomerMemo` (prints on the invoice; needs QBO *Sales → Message to customer*, on by default) and `PrivateNote` (internal). The job's **service address** (`jobs.address/city/state/zip`, claim loss-address fallback — can differ from billing) + date of loss come from the job (claim fallback). The address also goes to the invoice's structured **`ShipAddr` (Ship To)** — full length, no 31-char cap, prints when QBO *Sales → Shipping* is on. We **no longer write the legacy 31-char custom field** — on QBO Advanced the enhanced/named custom fields aren't writable via the v3 API (only the 3 legacy string fields are; Intuit's GraphQL Custom Fields API is Gold/Platinum-partner-gated), so Ship To + CustomerMemo are the right writable homes. `get_ar_invoices` / `get_payments_ledger` return `qbo_doc_number`; linkage is by `qbo_invoice_id` (internal id).

**Status:** foundation + push worker + Billing UI + AR mapping trigger + **read-time repoint** (dashboard reads `invoices` via `get_job_financials`, legacy fallback) live on prod, validated (real QBO invoice created/deleted; AR-sync trigger verified; `get_job_financials` applied + returns clean with the table empty; full Vite build passes). **Remaining 2a:** flip `auto_draft_invoices` → `'true'` once Moroni has tested the Billing UI on prod. **2b:** UPR invoice editing UI (line items, adjustments) + two-way sync — then surface the richer rollup fields the dashboard now has access to (insurance/homeowner split, depreciation). **2c:** payments sync → invoice `amount_paid` (`collected` auto-switches to invoice-sourced once `> 0`). **Future:** once invoicing is steady-state, retire the hand-entered Revenue editor + `jobs.invoiced_value` mirror and drop the trigger.

**Employee guide / in-app tutorial:** `UPR-Invoicing-Financials-Employee-Guide.md` (markdown source) → `public/UPR-Invoicing-Financials-Guide.pdf` (downloadable; generated by `scripts/build-invoicing-guide-pdf.py` via reportlab — keep the two in sync if content changes). **Jun 20 2026: Help page, markdown guide, and PDF all rewritten to the current flow** — line-item builder on the dedicated `/invoices/:id` editor, "+ New invoice" picker, Send/Update to QuickBooks, payment recording that auto-syncs to QBO, and the Stripe card pay-link. In-app tutorial `src/pages/Help.jsx` at route `/help` (App.jsx), with a Download-PDF button. Linked from `Sidebar.jsx` as **Help & Guides** rendered as a **standalone NavLink outside the `canAccess` gate** (canAccess is default-deny for keys without a `nav_permissions` row, so a normal NAV_ITEMS entry would show for admins only) — this makes it visible to every logged-in office user.

**Phase 0.5 shipped (auto-push invoice edits):** `qbo-invoice` worker now creates **or** updates a QBO invoice (was create-only; new `updateInvoice()` in `functions/lib/quickbooks.js` does GET-SyncToken → sparse update). `ClaimBilling.jsx` autosaves the amount on blur and auto-pushes (no manual Save/Push buttons) with a Syncing/QuickBooks #/Error/Draft chip; editing a synced invoice re-syncs it; `$0` drafts stay local. UI-driven (only edit path today) to give immediate feedback and avoid a worker-writeback trigger loop. Employee tutorial (Help page + guide + PDF) updated to match.

**Billing safeguards (Jun 18):** Billing section gated by feature flag `feature:billing` (in `feature_flags`, enabled; OFF = hidden for everyone, or set `dev_only_user_id` to limit to one person — all from Dev Tools). New helper `canEditBilling(role)` in `claimUtils` = **admin + manager only**, used for Billing edit (`ClaimPage` → `canEditBill`) and Collections A/R edits (`ClaimCollectionPage`: Log Payment / A/R status / mark-deductible / Notes hidden or disabled for other roles → read-only A/R). `ClaimBilling`: "Remove from QuickBooks" now needs a two-click confirm; the first push of a new invoice is an explicit **Send to QuickBooks** click (edits to an already-synced invoice still auto-sync). These are UI-level gates — deeper enforcement (RLS / RPC role checks) is future hardening.

**Active initiative status/handoff (start here when resuming): `QBO-BILLING-STATUS.md`.** **Next phases — see `QBO-PHASE-2-PLAN.md`** (repo root): two-way QBO↔UPR sync roadmap. Priority Phases 1–3 = inbound webhook infra (`qbo-webhook` + `qbo_sync_events` queue + CDC reconcile cron) → **payments QBO→UPR** → **invoice changes QBO→UPR**, then customer two-way, invoice-editing depth (2b), and A/R ops. Key planned schema: `qbo_sync_events`, `invoices.qbo_sync_token`, `payments.qbo_payment_id`+`source`; new env `QBO_WEBHOOK_VERIFIER_TOKEN` (distinct from the internal `QBO_WEBHOOK_SECRET`).

**QBO→UPR payment sync — IMPLEMENTED (Jun 24 2026).** When a customer pays a QBO invoice online (card/ACH), the payment now flows back into UPR automatically:
- **`functions/api/qbo-webhook.js`** (`POST /api/qbo-webhook`) — Intuit webhook receiver. Verifies the `intuit-signature` HMAC against `QBO_WEBHOOK_VERIFIER_TOKEN`, claims each event once via `claim_qbo_event` (idempotent), and for `Payment` entities mirrors the payment into UPR (Delete/Void/Merge → removes the imported payment). Inert (acks 200) until the verifier token is set.
- **`functions/api/qbo-payments-sync.js`** (`GET/POST /api/qbo-payments-sync`, + `scheduled()`) — hourly safety-net poller; queries recent QBO Payments and reconciles any the webhook missed. HTTP uses the exact server capability or an active internal-admin Bearer; the direct Cloudflare `scheduled()` entry remains a distinct non-HTTP capability. Logs `worker_runs` as `qbo-payments-sync`.
- **`functions/lib/qbo-payment-sync.js`** — shared `syncQboPaymentToUpr()` / `removeQboPaymentFromUpr()`. With receipt mode off, maps a QBO Payment's linked invoices → UPR invoices (by `qbo_invoice_id`), inserts `payments` rows (`source='qbo'`, method mapped to credit_card/ach/other), and the existing `update_invoice_paid` trigger rolls them up. **Legacy dedup:** the live partial UNIQUE `(qbo_payment_id, invoice_id)` constraint and pre-check prevent a UPR-originated or redelivered payment from double-counting. The authored receipt mode described below replaces this per-row importer only after its separate Worker gate is enabled.
- **`functions/lib/intuit.js`** — `verifyIntuitSignature()` (base64 HMAC-SHA256) + `sha256hex()`.
- **Schema (`supabase/migrations/20260624_qbo_payment_webhook.sql`):** `qbo_events` table (event idempotency, service-role only) + `claim_qbo_event(p_id,p_entity,p_operation)` RPC (mirrors `claim_stripe_event`).
- **Setup:** Intuit Developer → app → Webhooks → endpoint `https://utahpros.app/api/qbo-webhook`, subscribe **Payment**, copy the Verifier Token → Cloudflare `QBO_WEBHOOK_VERIFIER_TOKEN` (Production + Preview).

**QBO→UPR payment sync — HOURLY CRON LIVE (2026-07-24; ledger `20260724190848`, running since 19:17 UTC).** `qbo-payments-sync` had no cron. Migration `supabase/migrations/20260724180100_qbo_payments_sync_cron.sql` schedules it via Supabase **pg_cron + pg_net** (same mechanism as `process-scheduled`/message-outbox): hourly `net.http_post` → `https://utahpros.app/api/qbo-payments-sync` carrying `integration_config.qbo_webhook_secret` as `x-webhook-secret` (already set in Cloudflare as `QBO_WEBHOOK_SECRET`). Wrapped in the locked-down `qbo_payments_sync_poll()` SECURITY DEFINER helper (REVOKEd from all roles; exact URL allowlist; fail-closed). Applied and healthy — four consecutive `succeeded` runs returning HTTP 200 `{"ok":true,"scanned":1,...}`; its source reached `dev` only on 2026-07-24 via PR #516 (see the concurrent-session reconciliation section). Real-time webhook half still needs `QBO_WEBHOOK_VERIFIER_TOKEN` + the Intuit Payment subscription. The companion `20260724200000_payments_qbo_dedup_index.sql` is also live under ledger `20260724230933`.

**QBO multi-invoice receive-payment receipts — DEV SOURCE SHIPPED, LAST EXACT DEPLOYMENT PROOF AT `52a07d9e`, SHARED SCHEMA LIVE, DEV GATES OPEN / PRODUCTION WORKER FAIL-CLOSED (2026-07-31).** Source merged to `dev` as `c41839b1`; the `52a07d9e` grant-containment revision reached `dev` and passed its own Cloudflare Pages check. Each newer reconciled head still requires its own deployment and smoke readback rather than inheriting that proof. The feature adds `/collections/receive-payment` and `POST /api/qbo-receive-payment` for an active internal admin to create one QBO Payment allocated across 1–100 open invoices belonging to one UPR contact/QBO customer. The Worker reserves a durable UUID/fingerprint plus stable Intuit `requestid` before the provider call, writes multiple Invoice `LinkedTxn` lines with explicit date/method/reference/deposit account, verifies the returned Payment and fresh invoice-balance deltas, then finalizes one receipt plus existing-trigger-compatible `payments` projections. Timeout/transport ambiguity remains `unknown_outcome`; retrying unchanged resolves the original provider request.

Schema source `20260731045407_qbo_multi_invoice_payment_receipts.sql` adds private forced-RLS/service-only `payment_receipts`, `payment_receipt_attempts`, `payment_receipt_events`, `payments.receipt_id`, six receipt-state RPCs plus one atomic event-claim RPC, and realm/entity/provider-version/retry metadata on `qbo_events`; its paired containment rollback retains financial audit evidence. It also removes inherited anonymous policies and the broad authenticated payment writer: active internal staff retain SELECT, while manual ungrouped INSERT/UPDATE/DELETE is limited to active non-external admins—the effective `canEditBilling` boundary—and browser inserts must attribute the caller. Provider/grouped rows remain worker-owned. Realm-scoped uniqueness prevents one QBO Payment from binding to multiple attempts. When—and only when—`QBO_RECEIVE_PAYMENT_ENABLED=true`, webhook/CDC reconcile the complete grouped projection, atomically retain retry identity, recover stale processing claims, preserve a UPR receipt's actor/payer, ignore older provider versions, durably retry transient failures, and let QBO Update/Void/Delete update or remove active projections without destroying receipt/event evidence. The money endpoint independently requires the seeded-false `feature:qbo_receive_payment` row to be enabled and not force-disabled as well as the Worker gate; the database flag also gates the admin UI. Neither flag is authorization. The foundation is live on staging (`20260731223150`) and production (`20260731225654`). Managed defaults initially left direct service-role writes; follow-up `20260731231000_qbo_receipt_service_grant_containment.sql` is live on staging (`20260731230543`) and production (`20260731230907`), leaving service SELECT only on receipts/attempts, no direct event-table privilege, browser grants at zero, and every mutation RPC-only. The staging behavior suite and direct-role denial proof rolled back with zero residue. Production readback at `2026-07-31 23:43:23Z` shows the database flag enabled/not force-disabled through an active internal admin update, superseding the earlier disabled readback. Cloudflare Pages readback at `2026-08-01 00:14:45Z` shows `QBO_RECEIVE_PAYMENT_ENABLED=true` in Preview and no key in Production, so `dev` has both rollout gates open while the production Worker fails closed. The database still contains zero receipt/attempt/event/linked-payment rows and recorded no `qbo-receive-payment` Worker run or QBO event after the flag change. This calculator reconciliation did not flip either QBO gate, exercise the provider path, create a provider Payment, or call the sandbox. Named-admin proof, `main` promotion, and production-web promotion remain absent. See `docs/qbo-multi-invoice-payment-receipts-roadmap.md`.

**Invoice/Estimate attachments → QuickBooks — NEW (2026-07-24).** Staff attach a file (photo, scope, PDF) to a synced invoice/estimate; it's pushed to QBO via the **Attachable API** with `IncludeOnSend` so it rides along on the QBO-sent email AND shows on the transaction in QBO.
- **`functions/api/qbo-attach.js`** (`POST {entity_type,id,file_name,content_type,file_base64,include_on_send}` + `Idempotency-Key`; `{action:'delete',attachment_id}`) — `requireRole(['admin','manager'])` plus explicit external-employee denial; requires the entity synced; ≤20 MB; idempotent (pre-check + UNIQUE key); logs `worker_runs` as `qbo-attach`. Uses the already-granted **accounting** scope (no Payments reconnect needed). Direct UI metadata reads still use a role-scoped policy without `is_external=false`; that RLS residual is separately gated.
- **`functions/lib/quickbooks.js`** — `uploadAttachable` (multipart `/upload` via `fetchWithTimeout`), `getAttachable`, `deleteAttachable`, `buildAttachableMetadata` (pure).
- **`src/components/collections/QboAttachments.jsx`** — shared list/upload/remove card in `InvoiceEditor.jsx` + `EstimateEditor.jsx` (rendered for admin/manager; two-click remove).
- **Schema (`supabase/migrations/20260724180000_qbo_attachments.sql`, authored/not-yet-applied):** `qbo_attachments` (metadata only, no bytes; RLS SELECT scoped to active admin/manager; UNIQUE `qbo_attachable_id` + `idempotency_key`; writes are service-role worker only).

---

## "+ New invoice" job picker (Jun 20 2026)

`src/components/NewInvoiceModal.jsx` — shared job-picker that calls the idempotent
`create_invoice_for_job(p_job_id)` RPC and opens `/invoices/:id` (one invoice per job;
opens the existing invoice if the job already has one). Two modes: **customer-scoped**
(pass `{ contact, claims }` — reuses already-loaded `get_customer_detail` data, no extra
query) and **global** (no props — customer typeahead via `search_contacts_for_job`, then
that customer's claims→jobs). Rows badge "Has invoice" vs "New". Entry points: Customer
page header button (gated `feature:billing` + `canEditBilling`) and a global **+ New
invoice** button on the Collections hub header.

---

## QuickBooks Online — Estimates (Jun 25 2026)

A full line-item **estimate builder** that mirrors the invoice tool, syncs to QBO, and
converts to an invoice. Shipped **dormant** behind the `page:estimates` feature flag at first
(seeded **disabled** — a missing flag would read as ON, so the OFF row was required); **the flag is
now `enabled: true` live (confirmed Jul 1 2026) — estimates are live, not dormant.**
Edits gated by `canEditBilling` (admin + manager), same as invoices.

**Estimates are PRE-SALE and decoupled from jobs** (decouple migration
`20260625_estimate_decouple.sql`): an estimate is owned by a **contact** + an **intended_division**
(the job type it would become) + an optional property address — `job_id` stays NULL until it's
**sold**. Multiple estimates per client (initial / supplement / change_order / final). The dashboard
"Open estimates" donut (`get_open_estimates_summary`) buckets on
`COALESCE(intended_division, jobs.division)`.

**DB (`migrations/20260625_estimate_builder.sql`, applied):**
- `estimate_line_items` — clone of `invoice_line_items` (line_total GENERATED; qbo_item/class per line).
- `estimates` extended with `contact_id`, `subtotal`, `expiration_date`, `converted_invoice_id`
  (FK invoices) + the `qbo_*` sync columns.
- `recompute_estimate_from_lines()` trigger → rolls lines into `estimates.subtotal` + `amount`.
  ⚠️ **Estimate screens are line-authoritative** (mobile `AdminEstimateDetail`/desktop `EstimateEditor`
  compute the total from lines, NOT the header `amount`) — so an estimate with no line items shows **$0**
  and can't Convert. (Invoice screens differ: they fall back to the header total.)
- `generate_estimate_number()` → `EST-NNNNNN`. **Hardened 2026-07-07**
  (`migrations/20260707_harden_estimate_number_generation.sql`): `UNIQUE(estimates.estimate_number)` +
  drift-proof `max(EST-suffix)+1` under `pg_advisory_xact_lock` (sequence kept as a synced secondary
  guard), mirroring the invoice/claim number fixes. Also 2026-07-07: the 34 reconciliation-imported
  estimates (header `amount`, no lines → $0 on the line-authoritative screens) had their line items
  backfilled from QBO — `scripts/backfill-recon-estimate-lines.sql`.
- `create_estimate_for_contact(p_contact_id, p_intended_division, p_estimate_type DEFAULT 'initial',
  p_property_address/city/state/zip, p_created_by)` — makes an estimate from a CLIENT, no job.
  (Legacy `create_estimate_for_job` kept but deprecated/unused.)
- `get_estimates()` — one row per estimate; division = `COALESCE(intended_division, jobs.division)`;
  client from `contact_id`; job/claim columns populated only once converted. Granted anon, authenticated.
- `convert_estimate_to_invoice(p_estimate_id, p_force, p_created_by)` — when the estimate has no job
  (pre-sale), **silently auto-creates a claim + job** from contact + intended_division + property
  address (no insurance = OOP) via `create_job_with_contact`, then `create_invoice_for_job`, copies
  lines, links `invoices.estimate_id` + `estimates.converted_invoice_id`, status→'approved'. Legacy
  job-coupled estimates still convert as before; signature unchanged.

**Worker (`functions/api/qbo-estimate.js` + `lib/quickbooks.js`):** itemized push/update/delete/send to
the QBO `/estimate` endpoint (`createEstimate`/`updateEstimate`/`deleteEstimate`/`sendEstimate`,
reusing `divisionToQbo`/`findClassId`). Division (item/class) comes from `estimates.intended_division`,
the customer from `estimates.contact_id`, the service address from `estimates.property_*` — a job is
optional (only once converted). Uses `estimate_number` as the QBO DocNumber, sets `TxnStatus:'Pending'`
+ optional `ExpirationDate`, advances UPR status draft→submitted on first push.

**Convert → invoice in QBO (both requested directions):**
- **UPR-initiated:** the "Convert to invoice" button runs the convert RPC then pushes the invoice;
  `qbo-invoice.js` adds `LinkedTxn:[{TxnType:'Estimate'}]` when the invoice's linked estimate has a
  `qbo_estimate_id`, so QBO marks the estimate converted/Closed.
- **QBO-initiated (deposit auto-convert, dormant):** when a customer pays a deposit on an estimate via
  QBO's online pay link, QBO turns it into a new invoice. The inbound payment sync
  (`lib/qbo-payment-sync.js` → `adoptInvoiceFromQboEstimate`) detects a QBO invoice with no UPR match
  but a `LinkedTxn→Estimate`, finds the UPR estimate by `qbo_estimate_id`, runs
  `convert_estimate_to_invoice` (force), and adopts the QBO invoice id so the payment lands and the
  estimate shows converted in UPR. Activates with the QBO Payment webhook (§4B of QBO-BILLING-STATUS).

**Frontend:** `src/pages/EstimateEditor.jsx` (`/estimates/:id`) · `src/pages/Estimates.jsx`
(`/estimates`, list + KPIs + filters) · `src/components/NewEstimateModal.jsx` (client search/create
via AddContactModal + intended-division picker + optional property address — NO job picker) ·
`src/components/AutoGrowTextarea.jsx` (shared, line-item
description grows down + accepts line breaks for scope of work — also adopted by InvoiceEditor). Nav
entries (`navItems.jsx`: sidebar + desktop overflow) + routes (`App.jsx`) gated by `page:estimates`.

**Builder rebuild (Jun 2026) — `InvoiceEditor.jsx` + `EstimateEditor.jsx`, full builders in the
Collections design:** both editors were rebuilt to feel like a complete invoice/estimate builder
(HouseCall Pro / QuickBooks) and reuse the Collections design system (`collKit` / `collTokens` / `.coll-*`),
not the app-wide tokens.
- **Top action toolbar** (QBO-style, beside "← Back"): Save · Send to customer · Receive payment (invoice
  only) · Create/Copy pay link · Preview · **Manage ▾**. Today Receive payment opens the legacy
  per-invoice form; the authored admin/QBO-linked path opens `/collections/receive-payment` only
  while `feature:qbo_receive_payment` is enabled. The Manage menu is the new
  **`src/components/collections/ActionMenu.jsx`** (self-contained dropdown, outside-click/Esc close, two-click
  confirm) and tucks away Revert to draft / Delete draft. This replaced the old bottom action bar.
- **Single full-width column** (no lateral panels): a header `CollCard` carries the eyebrow
  (INVOICE / ESTIMATE) + status (`StatusBadge` / `Pill`) + **doc-number heading** (on both editors this big
  number is a **link to the job** — `navigate('/jobs/:id')`, with an external-link icon beside it + hover
  underline, shown when the doc has a linked job) + Bill-to / Prepared-for, then a
  responsive details grid (Carrier · Claim · Job · Date of loss · Sent; **invoices add an editable Due
  date** — UPR `invoices.due_date`, does NOT sync back from QBO) + the **service/loss address** (`job.address…`
  → fallback `claim.loss_*`, the same source QBO uses). Estimates also show Type.
- **Line editor:** new **`src/components/collections/SearchSelect.jsx`** (typeahead dropdown, outside-click/
  Esc close) for the QBO Item & Class per line (options from `/api/qbo-query` SELECT … FROM Item/Class —
  the Item query selects `Type` and **filters out `Type='Category'`**, since QBO categories are grouping
  parents that can't go on a transaction line; selecting one would make QBO reject the push with "An item
  in this transaction is set up as a category instead of a product or service." A line still pointing at a
  category, e.g. a pre-existing one, renders a blank Item cell + a warning banner prompting a re-pick);
  HTML5 **drag-to-reorder** persisting `sort_order`; `AutoGrowTextarea` description; qty/rate cells; footer
  **Subtotal → Total** (invoice shows read-only **Tax** only when `invoices.tax` is set — UPR-side, never
  pushed to QBO as a separate line). Line edits save on blur/select without reloading; **Save** flushes +
  pushes to QBO (create first time, update after). A fresh **editable draft auto-opens with one blank line**
  (inserted on load when there are 0 lines) so the builder is ready to type.
- **Invoice payment summary** (full-width `CollCard` below the builder): Invoiced / Collected / Balance KPIs
  + `ProgressBar` + a HouseCall-Pro-style **payment history table** (Date · Type · Amount · Note;
  `payments?invoice_id=eq.…`). **Clicking a row opens a view-first modal** (in-file in `InvoiceEditor`,
  `C`-token styled like the preview overlay, Esc/backdrop close): read-only details + a QBO sync badge,
  then a deliberate **Edit** step loads the form *inside* the modal (guards accidental edits). Saving
  updates a legacy `payments` row and re-syncs QBO by **delete + recreate** (the `/api/qbo-payment` worker has
  create + delete only, no update); **Delete** lives inside the edit step (two-click); **Update** is
  disabled until a field actually changes. **Stripe (card) payments are view-only** (no Edit/Delete) to
  protect the Stripe↔QBO fee reconciliation; authored grouped/QBO receipt rows are also view-only
  and must be corrected as a complete receipt in QBO. The same modal opens in "new" mode from the
  legacy **Receive payment** toolbar button (no inline form, no per-row Delete). Estimates have no payments; instead a
  "→ Convert to invoice" action.
- **Customer preview overlay** → `window.print()` with scoped print CSS (a faithful UPR-rendered preview;
  the *emailed* PDF is still generated by QuickBooks).
- **Back button = `navigate(-1)`** (returns to wherever you came from). For this to land on the right
  Collections tab, `Collections.jsx` syncs its active tab into **`?tab=`** (replace) via `changeTab` —
  so the dashboard "Open estimates" widget deep-links `/collections?tab=estimates`, the `/estimates` route
  redirects there, and Back from a builder restores the exact tab (A/R · Invoices · Estimates · Payments).
- **Deferred:** (a) editable customer memo / terms / PO (Phase 2 — needs schema + QBO worker; until then the
  customer memo is auto-generated on QBO push, shown read-only); (b) a per-invoice **Activity feed**
  (SMS/email/invoice/payment events, HouseCall-Pro-style) — worth building once UPR sends its own invoices
  instead of relying on QBO to email them.

---

## AI — Xactimate estimate → pre-filled invoice draft (Jun 2026)

> **Deep-dive:** for the full billing/QBO/Xactimate engineering context (invoice builder, two-way QBO sync, payments, Stripe, and this AI tool), see **`BILLING-CONTEXT.md`**.

**UPR's first AI/LLM integration.** Upload an Xactimate estimate PDF on the invoice builder and Claude reads
it, determines the amount we bill insurance, and pre-fills the draft. **Human-in-the-loop: it only fills a
DRAFT — nothing posts to QBO until the user reviews and Saves.**

**Worker (`functions/api/analyze-xactimate.js`):** POST `{ invoice_id, file_path }` (Supabase Bearer auth).
Downloads the uploaded PDF from the `job-files` bucket (service role) → base64 (chunked, V8-safe) → calls the
**Anthropic Messages API** (`https://api.anthropic.com/v1/messages`, `x-api-key: env.ANTHROPIC_API_KEY`,
`anthropic-version: 2023-06-01`) with model **`claude-opus-4-8`**, a base64 **document** block, and a **forced
strict tool** (`submit_estimate`, `tool_choice:{type:'tool'}`) whose schema returns `line_items[]`,
`totals{line_item_total,overhead,profit,sales_tax,rcv,depreciation,acv,deductible,net_claim,paid_when_incurred}`, and
`billable{amount,basis(RCV|ACV|net_claim|line_item_total),confidence,rationale}`. Inserts **one summary
line** at the billable amount (RCV by default — restoration bills full replacement cost), replacing any blank
auto-added line, and **pre-fills that line's QBO Item + Class from the job's division** via the shared
`divisionToQbo`/`findClassId` (functions/lib/quickbooks.js) — the same mapping the invoice sync uses, so the
draft shows exactly what will post (e.g. Water → "Water Damage Mitigation And Drying" / Mitigation class).
Logs `worker_runs` as `analyze-xactimate`. **Does not** touch QBO. Returns the recap (billable + totals +
reconciliation + work_type + paid_when_incurred) for the UI banner **and persists the same recap to
`invoices.xactimate_meta` (JSONB, added Jun 2026)** so the banner survives a refresh and stays available after
the invoice is saved (best-effort write — never fails the import).

**Work-type awareness (mitigation vs reconstruction):** the prompt is tailored from the job's division (via
`divisionToQbo` → Mitigation/Reconstruction). For **mitigation** (water/fire/mold cleanup) the model expects
no depreciation/deductible and bills the full RCV (= the total) at high confidence. For **reconstruction** it
watches for **"Paid When Incurred" (PWI)** line items (carriers like Farmers hold back continuous flooring
until the work is completed/photographed), sums them into `totals.paid_when_incurred`, and **keeps the
billable at the full RCV** — the held-back amount is surfaced in the banner (⏳ note) for the human to trim if
billing in stages, never auto-subtracted. The worker returns `work_type` and `paid_when_incurred`.

**Consistency (how we get the same behavior every time):** no fine-tuning. (1) The **strict tool schema**
guarantees an identical output shape every run. (2) A **worked example** in the prompt + a pinned model
anchor the one judgment call ("which total"). (3) A **deterministic arithmetic cross-check** in the worker
(RCV≈line_items+overhead+profit+tax, ACV≈RCV−depreciation, net_claim≈RCV−depreciation−deductible, within
$1/1%) auto-downgrades `high`→`medium` confidence and flags a mismatch, and the human confirms before Save.
Checks reconcile against **RCV** (always printed), never ACV — Xactimate omits the ACV line when no
depreciation is withheld, and the earlier net_claim≈ACV−deductible check then compared against 0 and falsely
flagged clean estimates as not reconciling.

**Keeping it improving (the "training" loop):** there is no fine-tuning — the API is stateless, so the
Anthropic Console (Workbench/Evals) is only for prototyping prompt wording and watching cost; it does **not**
push to UPR. The AI's behavior lives entirely in `analyze-xactimate.js`: the prompt, a `## Worked examples`
section (seeded with one reconstruction + one mitigation example), and the deterministic checks. To teach it
a new rule, add guidance / a worked example / a check there and ship. As the example set grows past the
~4K-token cache minimum (Opus 4.8), move the stable prompt+examples into a `cache_control` prefix to keep
cost/latency flat.

**Frontend (`InvoiceEditor.jsx`):** an **✨ Import Xactimate** toolbar button (gated `canEdit && !synced &&
job?.id && isFeatureEnabled('feature:ai_xactimate')`) → file picker → uploads the PDF to
`job-files/{job_id}/xactimate/{ts}-{name}.pdf` + records it via `insert_job_document` (category `xactimate`)
so the **source estimate is retained on the job automatically** — *skipping the upload and reusing the
existing copy* if a job_document with the same filename + `xactimate` category is already attached (no
duplicates). Then calls the worker and reloads. A **confirmation banner** shows the chosen amount, basis,
confidence, the totals breakdown, a ⏳ "Paid When Incurred" held-back note when present, and a ⚠ warning when the totals don't reconcile. The banner is **hydrated from `inv.xactimate_meta` on every load** (once per mount, so a manual ✕ dismiss isn't undone by line-edit reloads), so it persists across refresh and after QBO save — only the "review before Save" line is gated to drafts. While the AI works, a
**progress modal** shows a spinner, a simulated progress bar, and a status line that rotates through the real
steps (upload → read → extract → identify billable → reconcile → fill).

**Going live requires two ops steps (not code):** add **`ANTHROPIC_API_KEY`** to Cloudflare Pages env (both
**Preview** and **Production**) + redeploy, and enable the **`feature:ai_xactimate`** flag (DevTools →
feature flags). Until the key exists the worker returns `503` and the UI toasts "AI isn't configured." Key
stays server-side only — never the frontend.

**Phase 2 (later):** category/itemized line granularity (one line per room/trade instead of a single summary
line); auto-fill `tax`/`deductible`/depreciation adjustment columns; pick an already-attached job document
instead of uploading; a general "AI document import" surface (estimates, scope sheets).
*(Done: work-type-aware prompt — mitigation vs reconstruction; PWI detection + ⏳ banner note.)*
*(Done Jun 2026: QBO Item/Class auto-fill from division; progress modal; RCV-based reconciliation fix.)*

---

## Stripe — Card Payments & Fee Automation (S3 — Jun 20 2026, DORMANT)

Live card/ACH collection + automated QuickBooks fee reconciliation. **All code is shipped
but inert until the `STRIPE_*` keys exist in Cloudflare** — every Stripe worker returns
`503 {error:'Stripe not configured'}` when unconfigured, and the UI shows "not set up yet"
toasts. One-way UPR→QBO is preserved; **UPR is the only writer to QBO** (do NOT also run
Stripe's QBO connector / Synder — it would double-post).

**Pattern (clearing-account fee automation):** customer pays via a UPR pay-link →
Stripe's webhook records the **gross** as a UPR payment and pushes it to QBO **deposited
to a "Stripe Clearing" bank account** → the exact `balance_transaction.fee` is booked as a
QBO **Purchase** (clearing → Merchant Fees) → on `payout.paid` a QBO **Transfer** moves the
**net** (clearing → real bank). Clearing self-zeroes; the bank reconciles to the Stripe
payout exactly.

**Env to add (Cloudflare Pages — Preview for dev, Production for main):**
`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` (the last from the
registered webhook endpoint). Optional `APP_BASE_URL` for Checkout success/cancel return
URLs (defaults to the request origin).

**Migration `20260620_stripe_s3.sql` (applied):**
- `invoices`: `stripe_payment_link_url`, `stripe_checkout_session_id`, `stripe_payment_link_created_at`.
- `payments`: `source` ('manual'|'stripe', default 'manual'), `stripe_payment_intent_id`, `stripe_charge_id`, `stripe_fee`, `stripe_fee_qbo_purchase_id`; unique index `payments_stripe_charge_uniq` on `stripe_charge_id` (charge-level idempotency).
- `stripe_events` — webhook idempotency ledger (`id` PK = Stripe event id, type, status, payload, error, timestamps). **RLS enabled, NO policies** (service-role only, like `integration_credentials`).
- `claim_stripe_event(p_id, p_type) RETURNS boolean` — race-safe `INSERT … ON CONFLICT DO NOTHING` claim (TRUE = new/process, FALSE = duplicate/skip). Granted to `service_role`.
- `get_billing_settings`/`set_billing_setting` — added keys: `qbo_bank_account_id/name` (QBO deposit bank = Transfer destination), `stripe_payout_bank_id/name` (standard payout checking account), `stripe_instant_card_id/name` (instant-payout debit card). `stripe_connected` stays read-only here (workers set it).

**Lib `functions/lib/stripe.js`** (fetch-only, V8-safe): `stripeConfigured`, `stripeFetch` (form-encoding + idempotency key), `constructEvent` (Web Crypto HMAC-SHA256 signature verify over the raw body + tolerance), `retrieveCharge`/`getBalanceTransaction`/`retrievePaymentIntent`, `createCheckoutSession`, `listExternalAccounts` (banks+cards via `GET /v1/accounts/{id}/external_accounts`), `getInstantAvailable` (`/v1/balance`), `createPayout`.

**Lib `functions/lib/quickbooks.js`** (extended): `createPayment` gains optional
`depositAccountId` → `DepositToAccountRef` (Stripe deposits to clearing; manual payments
unchanged). New `createPurchase` (fee expense, paid-from clearing → Merchant Fees),
`createTransfer` (clearing → bank), `deleteEntity(entity, id)` (S4 reversal helper).

**Workers (`functions/api/`):**
- `stripe-webhook.js` — Stripe signature auth (no Bearer). `payment_intent.succeeded` → record gross UPR payment (source 'stripe') + push to QBO (deposit to clearing) + book fee Purchase. `payout.paid` → Transfer net (clearing → `qbo_bank_account_id`). Event-level idempotency via `claim_stripe_event`; charge-level via the unique index. Returns 200 even on QBO sub-failure (payment still recorded; error stored on the payment + event) so Stripe doesn't retry into the guard. Logs `worker_runs` as `stripe-webhook`.
- `stripe-pay-link.js` — POST `{ invoice_id }` (Supabase Bearer); creates a Checkout session for the balance, stores link/session on the invoice, returns `{ url }`.
- `stripe-payout.js` — POST `{ amount? }` (Supabase Bearer); instant payout to `stripe_instant_card_id` (defaults to full `instant_available`).
- `stripe-accounts.js` — GET (Supabase Bearer); lists external accounts for the payout selectors; flips `stripe_connected=true` on first successful key use.
- `billing-2fa.js` — email-2FA gate for the payout destinations (below). POST `{action:'request'}` emails a 6-digit code to the owner (Resend); `{action:'commit', code, changes}` verifies and writes the protected keys via service role. Admin/manager only.

**Payout-destination email-2FA (`migrations/20260620_payout_2fa.sql`):** changing the
Stripe deposit bank / instant-payout debit card is a money-movement action, so it is NOT a
plain edit field. The four payout keys (`stripe_payout_bank_id/name`,
`stripe_instant_card_id/name`) were **removed from the open `set_billing_setting`
whitelist** — only the `billing-2fa` worker (service role) writes them, after verifying a
one-time code emailed to the owner (`integration_config.billing_2fa_email`, default
`moroni.s@utah-pros.com`). Codes are single-use, 10-min, SHA-256-hashed in the RLS-locked
`billing_2fa_codes` table. **Email now sends via Resend** (functions/lib/email.js, Jun 2026 —
replaced the dead SendGrid path). Requires RESEND_API_KEY + a verified utahpros.app sending
domain in Resend; if email is down, these fields can't be changed until it's restored.

**Frontend:** `InvoiceEditor.jsx` — Create/Copy pay-link action + active-link banner.
`PaymentSettings.jsx` — "Load from Stripe" probe; live Instant Payout button once
connected; the QBO deposit bank-account selector; and a **locked "🔒 Payout destinations"
panel** whose Edit flow emails a verification code (via `billing-2fa`) before saving the
bank/card (manual label, or live dropdown once Stripe is connected).

**S4 — refunds & disputes (`migrations/20260620_stripe_s4.sql`, applied):** `payments`
gains `refunded_amount` / `refunded_at` / `dispute_status`, and `update_invoice_paid` was
rewritten to net `refunded_amount` out of collected (defaults 0 → no change for existing
rows) and to reopen a paid invoice's status when collected drops to 0. The `stripe-webhook`
now handles **`charge.refunded`** (net the refund; on a FULL refund reverse the QBO Payment
+ fee Purchase via `deletePayment`/`deleteEntity`; partial refunds net in UPR and flag QBO
for a manual reduction) and **`charge.dispute.created`** (reopen A/R + reverse the QBO
Payment + stamp `dispute_status`). `ClaimBilling` shows a red **Refunded/Disputed** chip on
the payment. *Follow-ups: dispute fee + won/lost resolution (re-record on win), and
auto-reducing a QBO payment on partial refund.* **Also fixed in S4:** the S3 webhook mapped
ACH to `'eft'`, which violates the `payments_payment_method_check` — now `'ach'`.

**Status:** S3 + S4 built; builds/lints clean; both migrations applied & verified
(columns, RLS-locked ledgers, idempotency true→false, trigger nets refunds). **Activation
pending owner Stripe setup** (keys + QBO "Stripe Clearing"/"Merchant Fees"/deposit-bank
accounts mapped on `/settings/payments` + webhook endpoint registered →
`STRIPE_WEBHOOK_SECRET`, subscribing `payment_intent.succeeded`, `payout.paid`,
`charge.refunded`, `charge.dispute.created`). Then a live test on dev. See
`QBO-BILLING-STATUS.md` §4 for the exact click-path.

---

## UPR MCP Server — owner-only remote MCP for QBO + UPR DB (Jun 23 2026)

Standalone Cloudflare **Worker** (`upr-mcp/`, NOT part of the Pages app) exposing a remote **Model Context Protocol** server, so QuickBooks Online and the UPR database can be driven from any Claude chat (web/desktop/mobile) via a custom connector.

- **URL:** `https://upr-mcp.moroni-s.workers.dev` — MCP endpoint `/mcp`.
- **Deploy:** Cloudflare **Workers Builds** connected to the GitHub repo. Production branch **`main`**, root directory `upr-mcp`, deploy command `npx wrangler deploy`; auto-redeploys on push to `main`. **Mirror every `upr-mcp` change to `dev` too** (policy: dev never behind main). Needs a `package-lock.json` (Cloudflare runs `npm ci`).
- **Auth — two layers:** (1) *Claude → server*: OAuth 2.1 via `@cloudflare/workers-oauth-provider`, federated to **Google**, allowlisted to `ALLOWED_EMAIL` (moroni.s@utah-pros.com); grants/tokens in KV binding `OAUTH_KV`. (2) *server → QBO*: reuses UPR's existing connection (tokens in `integration_credentials`). Supabase via service-role key.
- **Secrets (wrangler):** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `COOKIE_ENCRYPTION_KEY`. Vars: `QBO_ENVIRONMENT`, `ALLOWED_EMAIL`.
- **Safeguards:** every write tool requires `confirm: true` (returns a preview otherwise); every call logged to `upr_mcp_audit`; kill switch `integration_config.upr_mcp_enabled = 'false'`; allowlisted email re-checked on every call.
- **Transport gotcha:** `GET /mcp` MUST return a `text/event-stream` SSE stream — Claude's connector opens it and won't send `POST initialize` until it does (returning 405 breaks the connect). `POST /mcp` handles JSON-RPC (stateless).

**Tools**
- QBO read: `qbo_query`, `qbo_get`, `qbo_list_invoices`, `qbo_list_payments`, `qbo_list_estimates`, `qbo_report`.
- QBO write: `qbo_create_invoice`, `qbo_update_invoice`, `qbo_delete_invoice` (refuses invoices with payments), `qbo_create_payment`, `qbo_relink_payment`, `qbo_delete_payment`, `qbo_create_customer`, `qbo_update_customer`, `qbo_create_item`, `qbo_create_entity` / `qbo_update_entity` / `qbo_delete_entity`, `qbo_send_invoice` (emails the customer), `qbo_create_estimate`.
- UPR DB: `upr_select`, `upr_rpc` (any of the ~150 RPCs — **mutating fns gated**: names not starting get_/list_/search_/preview_/count_/fetch_ require `confirm`), `upr_schema` (tables + functions), `upr_describe` (a table's columns / an RPC's params), `upr_search` (cross-entity find: contacts/jobs/claims), `upr_insert`, `upr_update`, `upr_delete` (filter required).
- **Encircle + Resend (undocumented until this audit — ~22 tools total, `upr-mcp/src/encircle.js` + `resend.js`):** mirrors the Encircle and Resend REST APIs (claims/rooms/notes/media/assignments for Encircle; domains/emails for Resend) the same way the QBO tools mirror QuickBooks — see those source files for the exact tool list rather than duplicating it here.
- **CallRail + Deepgram, Stripe, Twilio, Google Ads, Meta Ads, GitHub (added Jul 2026 — 32 tools, `upr-mcp/src/{callrail,stripe,twilio,googleads,metaads,github}.js`):** each module follows the same generic-power-tool + named-conveniences pattern; reads run immediately, writes preview unless `confirm:true`. Credential model splits two ways — **reuse a stored token** (CallRail=`callrail`, Deepgram=`deepgram`, Google Ads=`google_ads`, Meta Ads=`meta_ads` rows in `integration_credentials`; no worker secret for the token) vs. **static worker secret** (`STRIPE_SECRET_KEY`; `TWILIO_ACCOUNT_SID`+`TWILIO_AUTH_TOKEN`; the ad apps also need their `*_CLIENT_ID/SECRET`/`*_APP_ID/SECRET` + account-id secrets). A tool returns a clear "not configured"/"not connected" error until its credential is present. See the source files for the exact tool list. Highlights: `callrail_list_calls`/`callrail_transcribe`, `stripe_get_balance`/`stripe_create_payout`, `twilio_send_sms`, `google_ads_campaign_spend`, `meta_ads_insights`.
- **GitHub — DB-managed token + full write lifecycle (Jul 2026, `upr-mcp/src/github.js`):** the PAT is now read from `integration_credentials` (provider=`github`) first — set on the **admin Integrations page** (`/settings/integrations`, was `/admin/integrations`) via the `github-connect` worker — with an env `GITHUB_TOKEN` fallback; default repo from `integration_config.github_default_repo` → `GITHUB_DEFAULT_REPO`. Tools cover the full PR/commit lifecycle: reads (`github_list_prs`, `github_get_pr`, `github_get_file`, `github_list_commits`, `github_get_commit`, `github_list_branches`, `github_search_code`) and guarded writes (`github_merge_pr`, `github_create_pr`, `github_update_pr`, `github_create_branch`, `github_commit_file`, `github_add_comment`, `github_create_issue`) + generic `github_get`/`github_request`. A Worker has no git binary, so "push/pull" = the Contents/Git-data API. PAT scopes: Contents R/W, Pull requests R/W, Issues R/W.

**New table:** `upr_mcp_audit` (see Logging & Monitoring). **New RPC:** `get_upr_mcp_audit(p_limit)`.
**Files:** `upr-mcp/{wrangler.toml, package.json, package-lock.json, src/index.js, auth.js, mcp.js, qbo.js, encircle.js, resend.js, callrail.js, stripe.js, twilio.js, googleads.js, metaads.js, github.js, supabase.js, tools.js, audit.js}`; migration `supabase/migrations/20260622_upr_mcp_audit.sql`.

---

## Desktop/Tablet Navigation Shell (≥1024px) — Top Nav + Overflow Drawer + Settings Hub (Jun 24 2026)

A HousecallPro-style **top horizontal nav** replaces the dark vertical sidebar on **desktop and iPad-landscape widths (≥1024px)**. Phones (≤768px) and narrow tablets / iPad portrait (769–1023px) keep the dark `Sidebar` slide-over + mobile bottom bar. (Breakpoint was originally ≥1280px — lowered to **1024px on Jun 25 2026** so regular iPads in landscape get the top nav too; the prior state is preserved on branch `backup/pre-ipad-nav-breakpoint`.) The `/tech/*` field-tech app is untouched.

- **CSS-only shell:** both `<Sidebar>` and `<TopNav>` are always in the DOM; a single `@media (min-width:1024px)` block (end of `index.css`) hides `.sidebar`, shows `.topnav`, flips `.app-layout` to `flex-direction:column`, sets `--topnav-h:56px` (0 elsewhere so mobile math is unchanged), and height-corrects the three full-viewport pages (`.conversations-layout`, `.jobs-page`, `.job-page` → `calc(100dvh - var(--topnav-h))`). The `@media (max-width:768px)` block is byte-for-byte untouched. A companion `@media (min-width:1024px) and (max-width:1279px)` block collapses the `GlobalSearch` box to its icon (expands on focus) so all 7 primary links fit at narrower iPad widths; ≥1280px keeps the full inline 340px search.
- **Single source of truth:** `src/lib/navItems.jsx` — `NAV_ITEMS` (legacy sidebar list, unchanged) + `PRIMARY_ITEMS`/`OVERFLOW_ITEMS` + `SETTINGS_GROUPS` (settings-hub IA, read by SettingsHome + SettingsLayout) + `isItemVisible(item, {canAccess,isFeatureEnabled,employee,isMoroni})` (mirrors legacy gating: adminOnly → role; moroniOnly → email; `always` skips canAccess (Help); `settingsHub` → anySettingsChildVisible; else canAccess(key); then featureFlag).
- **Top bar (`TopNav.jsx`):** logo · primary links [Home `/`, Inbox `/conversations` (unread badge), Schedule, Claims, Customers, My Money `/collections` (`page:collections`), Time `/time-tracking` (`page:time_tracking`)] · `GlobalSearch` · `NewMenu` · `NotificationBell` · Help link (`/help`) · settings gear (`/settings`, gated `canAccess('settings')` since 2026-07-04) · `UserMenu`. **Home/Inbox/My Money/Time are LABEL renames only** — routes + nav_keys unchanged.
- **Overflow drawer (`OverflowDrawer.jsx`):** hamburger-opened left slide-over (dark) — Jobs, Production, Schedule Templates, Encircle Import, OOP Pricing, Leads, Marketing.
- **New menu (`NewMenu.jsx`):** New Job (→ existing job+claim creator `CreateJobModal`; label renamed from "New Claim" 2026-07), New Estimate (global `NewEstimateModal`, gated on `page:estimates` — hidden until the flag is on, in lockstep with the Estimates nav links), New Customer (`AddContactModal`), New Invoice (global `NewInvoiceModal`) — all via `Layout.handleCreateAction`.
- **User menu (`UserMenu.jsx`):** avatar dropdown — admin-only Tech View + Sign Out.
- **Settings hub (`SettingsLayout.jsx`) — rebuilt by Settings Overhaul Phase F (2026-07-04):**
  pathless route wrapping the `/settings/*` sub-page tree + `/dev-tools` (see the "Settings Overhaul
  — Phase F Foundation" section above for the full route map, gates, and dissolved monoliths).
  Desktop (≥1024px) shows a **grouped** left rail (Workspace/Team/Connections/Personal/Owner) read
  from `SETTINGS_GROUPS` + `isSettingsItemVisible`; below 1024px the rail is hidden and `/settings`
  is the tappable index (`SettingsHome`), each sub-page showing a "← Settings" back link. `/help` is
  now UNWRAPPED from the hub (renders directly in Layout). (The old flat `SYSTEM_ITEMS` array was deleted — `SETTINGS_GROUPS` replaces it; `featureFlags.js` no longer iterates it.)
- **Settings Overhaul (plan of record, 2026-07-04):** the entire Settings/System area is being restructured per `docs/settings-overhaul-roadmap.md` + `docs/settings-overhaul-dispatch.md` — grouped hub with routed sub-pages under `/settings/*`, SettingsHome index (the mobile experience), Admin/Settings monolith dissolution, PaymentSettings/API Keys/Feedback Inbox/Scope Sheet Builder relocations with permanent redirects. **Phase 0 shipped 2026-07-04 (`82ca87d`):** `/settings` route wrapped in `AccessRoute('settings')` + TopNav gear gated `canAccess('settings')` — closes the live payroll exposure (any employee could URL-reach the Commissions tab and read/write commission rates; nav already denied it). Wave sessions launch from the dispatch doc; ownership manifest `.claude/rules/settings-overhaul-wave-ownership.md` is committed by its Phase F. New reviewer agent: `settings-phase-reviewer`.
- **Bell single-mount:** `Layout` gates the one `NotificationBell` by `matchMedia('(min-width:1024px)')` (TopNav on desktop/iPad-landscape, Sidebar header otherwise) so there are never two live notification subscriptions (no duplicate toasts). `NotificationBell` gained an optional `align` prop ('left'|'right').

## Settings Overhaul — Phase F Foundation (Jul 4 2026)
Structural, behavior-identical reorganization of the entire Settings area into a grouped hub
with routed sub-pages. Full plan: `docs/settings-overhaul-roadmap.md`; file/RPC ownership:
`.claude/rules/settings-overhaul-wave-ownership.md`.

**Routes (all under `SettingsLayout`, inside the main `Layout`):** `/settings` (SettingsHome
index — GC3 any-visible-child gate) · Workspace: `/settings/{carriers,referrals,templates,
templates/:docType,commissions,payments,scope-sheets}` · Team: `/settings/{team,roles,
page-access,notification-defaults,feedback}` · Connections: `/settings/integrations` ·
Personal: `/settings/{my-account,notifications}` (GC8 — every employee) · Owner: `/dev-tools`.
`/help` unwrapped from the hub shell. **Permanent redirects** (`src/lib/settingsRedirects.js`):
`/admin→/settings/team`, `/admin/integrations→/settings/integrations`,
`/admin/demo-sheet-builder→/settings/scope-sheets`, `/tech-feedback→/settings/feedback`,
`/payments/settings→/settings/payments`.

**Monoliths dissolved:** `Settings.jsx` (1224 lines) → `src/pages/settings/{Carriers,Referrals,
Templates,TemplatesEditor,Commissions,MyAccount,Notifications}.jsx` + `templates/{templateData.jsx,
TemplateEditor.jsx}`. `Admin.jsx` (1297 lines) → `src/pages/settings/{Team,Roles,PageAccess,
NotificationDefaults}.jsx`. git-mv'd content-identical: `PaymentSettings→settings/Payments`,
`admin/AdminIntegrations→settings/Integrations`, `AdminFeedback→settings/FeedbackInbox`,
`AdminDemoSheetBuilder→settings/ScopeSheets`.

**Shared modules (new):** `src/lib/navKeys.js` (NAV_KEYS/PAGE_ACCESS_KEYS/ROLES/roleLabel —
ends Admin.jsx duplicate registry), `src/lib/owner.js` (`isMoroni()` — replaced 5 hardcoded
`moroni@utah-pros.com` checks in App/Sidebar/TopNav/OverflowDrawer/SettingsLayout),
`src/components/TabLoading.jsx` (exported; DevTools keeps its local copy),
`src/components/settings/{SettingsPageHeader,SettingsSection,LookupTable}.jsx`. `navItems.jsx`
gained `SETTINGS_GROUPS` + `isSettingsItemVisible()` + `anySettingsChildVisible()` (the hub IA,
read by SettingsHome + SettingsLayout rail) and settings-hub icons; NAV_ITEMS System section is
now one `settingsHub` Settings entry (GC5, hideForRoles:['crm_partner']); Sidebar migrated to
`isItemVisible()` (GC7).

**Nav shell:** SettingsLayout v2 = grouped rail ≥1024px / mobile home-back (`← Settings`) <1024px.
Real breakpoint is **1024px** (stale "1280" comments fixed). TopNav gear now shows on
`anySettingsChildVisible` (GC3/GC8), crm_partner excluded.

**Migration (`20260704_settings_f_demo_schema_delete.sql`):** drift-captured the live
`demo_sheet_schemas` RPC family (`get_active_demo_schema`, `get_demo_schema`, `list_demo_schemas`,
`upsert_demo_schema`, `publish_demo_schema`) into schema-as-code; added `demo_sheet_schemas.
published_at` (nullable) so an ever-published version is permanently detectable; `publish_demo_schema`
now stamps it. New `delete_demo_schema(p_id) → boolean` RAISEs on active / ever-published /
sheet-referenced versions (protects `.claude/rules/scope-sheet-rollback.md`). Consumed by P6.

**Gates (GC3-GC8):** GC3 SettingsHome any-visible-child · GC4/GC5 System→single Settings entry
(Team/FeedbackInbox adminOnly via SETTINGS_GROUPS) · GC6 Payments nav visible to canEditBilling
roles (page self-guards) · GC7 Sidebar `isItemVisible()` · GC8 (owner-approved) Personal group
(`/settings/my-account`, `/settings/notifications`) visible to every employee. No other effective-
access change.

**Tests:** `supabase/tests/settings_f_demo_schema_delete.test.js` (refusal),
`src/components/settings/settingsPrimitives.render.test.jsx`, `src/lib/settingsNav.test.js`
(any-visible-child incl. override-only supervisor fixture + the 5 redirects + templates section
merge).

### Wave sub-headers (pre-seeded by Phase F — each session fills ONLY its own)
#### P1 — Payments (Session A) — shipped 2026-07-04
- **`src/lib/useBillingSettings.js` (new):** hook wrapping `get_billing_settings`/`set_billing_setting`.
  Exposes `{ settings, setSettings, save, on, loading, reload }`. Its pure `makeBillingSave` factory
  (exported, DOM-free, unit-tested in `useBillingSettings.test.js`) snapshots the prior value, writes
  optimistically, and **reverts only the touched key on RPC failure** — killing the old page's
  optimistic-write drift (a failed save used to leave the UI showing an unsaved value). `setSettings`
  is exposed raw for the two server-side paths that persist through OTHER endpoints (email-2FA payout
  destinations via `/api/billing-2fa`, Stripe probe via `/api/stripe-accounts`) and must NOT round-trip
  through `set_billing_setting`.
- **`settings/Payments.jsx` rebuilt:** all setting saves route through the hook; inline px/hex soup →
  `pay-*` classes + design tokens (`src/index.css` §P1 reserved marker); `SettingsPageHeader`; 44px
  touch targets + `@media(max-width:768px)` stack pass. **Two-click confirm on "Pay out now"** (Stripe
  instant payout) — arm → `Confirm payout?` → confirm, `onBlur` disarms; one tap no longer moves money.
  The in-component `canEditBilling(employee.role)` block (the page's ONLY barrier) and the email-2FA
  payout-destination flow semantics are preserved verbatim. Never calls `/api/qbo-invoice`.
- **`Collections.jsx`:** payment-settings gear link retargeted `/payments/settings` → `/settings/payments`
  (F's permanent redirect still covers old bookmarks).
#### P2 — Integrations (Session B)
`/settings/integrations` (`src/pages/settings/Integrations.jsx`, AdminRoute) now hosts two
sibling provider cards: the existing **GitHub** card and a new **QuickBooks Online** card ported
behavior-identically out of the retired DevTools → Integrations tab. The QBO card reads
`get_integration_status({p_provider:'quickbooks'})` + `get_qbo_sync_stats()` (RPCs, unchanged),
connects/reconnects via `GET /api/quickbooks-connect`, and previews/back-fills customer sync via
`POST /api/qbo-sync-customer` (`{backfill,dry_run,limit}`) — synced/pending/errored stat boxes,
SANDBOX badge, dry-run preview list all preserved. **Worker retarget (atomic, same PR):**
`functions/api/quickbooks-callback.js` now 302-redirects to `/settings/integrations?qbo=…`
(was `/dev-tools?qbo=`) via the exported pure `buildReturnLocation()` / `QBO_RETURN_PATH`; the
page consumes it through the exported pure `qboReturnToast()`. Both halves are unit-tested
(`functions/api/quickbooks-callback.test.js`, `src/pages/settings/Integrations.test.jsx`).
Page **de-CRM'd**: dropped the `crm-*` classes for design-system `.card/.btn/.input` + new
`settings-int-*` polish (index.css §P2, desktop+mobile grid); "API Keys" title retired →
"Integrations". GitHub two-click disconnect preserved. (DevTools' own Integrations tab is left
in place for Session H / P7-lite to delete once this and P3 land.)
#### P3 — Team & Access (Session C) — shipped
Polish-only, zero migrations, all four routes stay `AdminRoute`. Files: `src/pages/settings/{Team,Roles,PageAccess,NotificationDefaults}.jsx` + `index.css` §P3 marker + `src/pages/settings/p3TeamAccess.test.jsx` (new).
- **Team.jsx** — employee hard-delete converted from the confirmation modal to the inline two-click confirm (Rule 2): the Delete button arms → "Confirm delete" → executes, disarms on `onBlur`/row-switch. The **EmployeeModal unsaved-changes guard**: overlay-click / ✕ / Cancel now arm a two-click "Discard unsaved changes?" bar in the footer when the form is dirty (was silently discarding). The **DevTools › Employees auth-link audit + invite** is absorbed as a top-of-page summary strip (total / can-log-in / no-login) + a per-row Login badge + a "Set up login"/"Invite" action — behaviour-identical against `get_all_employees` + `/api/admin-users` (Team's existing working PATCH-then-`resetPasswordForEmail` invite is kept; the broken DevTools `action:'invite'` POST is not carried over). Page feedback moved to `upr:toast`. **Session H may now delete the DevTools Employees tab.**
- **PageAccess.jsx** — the crushed inline fixed grid (`1fr 80px 120px 100px 40px`) replaced with `.pa-*` grid classes + a <768px stacked-card pass (labelled rows via `data-label` `::before`); the override control is now a tri-state switch (dashed = follows role default, green = override ON, red = override OFF) with ≥44px tap targets on the toggle and the clear (×) button. `computeAccess()` pure resolver extracted + unit-tested; data behaviour unchanged.
- **Roles.jsx** — design-system pass: shared `SettingsPageHeader`; matrix/toggle logic unchanged.
- **NotificationDefaults.jsx** — untouched (thin wrapper around the F-owned, self-titled `NotificationDefaultsTab`; a design pass there would require editing a non-owned component).
- **Tests** — `p3TeamAccess.test.jsx`: 12 cases over `nextDeleteConfirm` (arm/execute/re-arm), `employeeFormDirty` (clean/dirty/password/new-form/numeric-string), and `computeAccess` (role default / ON / OFF / missing).
#### P4 — Workspace + Personal polish (Session D)
Shipped 2026-07-04. `/settings/templates/:docType`'s own-mount-fetch + `useBlocker` router guard
(built by F) traced end-to-end and confirmed correct — no changes needed there.

**Blocked item (disclosed, not silently dropped):** Reset-to-defaults in
`templates/TemplateEditor.jsx` still wipes drafts with a single click, no confirm. P4 first
added an inline two-click confirm directly in that file, but `.claude/rules/settings-overhaul-
wave-ownership.md` §1 freezes `templates/{templateData.jsx,TemplateEditor.jsx}` specifically
(not the general shared-primitives clause, which allows a disclosed copy-in) — its wording for
this module is narrower: "a needed change is an F-owner follow-up," full stop, no copy-in
option offered. `settings-phase-reviewer` caught this on the close-out pass; the fix was
reverted rather than shipped on a self-granted exception the manifest doesn't actually give.
**Follow-up needed (F-owner or a future session with F's authority):** either add an
`onReset`-confirm prop to `TemplateEditor.jsx` that P4 can wire up, or bless the copy-in
explicitly. Filed here instead of quietly re-adding it.
**→ CLOSED 2026-07-14** by an owner-directed F-owner follow-up: the confirm now lives directly
in `TemplateEditor.jsx` via the shared `useTwoClickConfirm` hook (arm → "Confirm reset?" with the
`--danger`/`--danger-bg`/`--danger-border` triplet, disarm on blur or 3.5s timeout). Same commit
also migrated the file's local `errToast` copy to the shared `toast(msg,'error')` entry point
(clearing its one eslint baseline warning). Gauntlet: upr-pattern-checker pass ·
page-behavior-checker pass · design-consistency-checker pass after two fixes it requested
(shared hook + `--danger` tokens instead of hand-rolled state + `--status-needs-response`).
P4 is now fully complete; the initiative's only remaining tail is the P9 owner cutover.

`google-drive-callback.js` now 302s to `/settings/my-account?gdrive=…` instead of
`/settings?gdrive=…`; F's SettingsHome forwarder stays as a permanent shim for any old
bookmarked link. Hex→token sweep (exact-value matches only, zero visual diff) across
Templates/TemplatesEditor/Commissions/MyAccount: `#eff6ff→var(--accent-light)`,
`#2563eb→var(--accent)`, `#1d4ed8→var(--accent-hover)`, `#fffbeb→var(--status-waiting-bg)`,
`#fef2f2→var(--status-needs-response-bg)`, `#ef4444→var(--status-needs-response)`; plus a
`fontSize` px→`var(--text-*)` pass for exact 11/13/14/16px matches (non-standard sizes like
10/12/12.5/13.5 left as-is — no token exists for them, and rounding would be a visual change
beyond "identical behavior"). Carriers/Referrals needed no sweep (LookupTable already clean).
Commissions: replaced the fixed 5-column inline grid with `.commissions-header-row`/
`.commissions-row` classes (P4 css marker) so `@media (max-width:768px)` can reflow to a
3-column stack with mobile-only field labels (`.commissions-mlabel`) and full-width name/Save;
bare `<div>No employees.</div>` empty state → `.lookup-empty` (shared class, consistent
copy/wording with Carriers/Referrals). New test: `functions/api/google-drive-callback.test.js`
(4 cases: connected/badstate/missing-code/upstream-error, all assert the new redirect target).
Not added: interactive dirty-guard/click tests for the templates route — this repo's test
convention is `renderToStaticMarkup` smoke tests with no jsdom/`@testing-library`/
router-mocking infra, so the guard was verified by code trace instead of a new test harness;
flagging honestly rather than forcing in inconsistent test infra.
#### P5 — Feedback Inbox (Session E) — shipped 2026-07-04
`feedback-notify.js` no longer mints the retired `/tech-feedback` URL: both the push-payload
`data.route` and the `dispatchEvent(...).body.link` now write `/settings/feedback` (historical
`notifications.link` rows still resolve via `SETTINGS_REDIRECTS`'s permanent `tech-feedback` →
`/settings/feedback` entry). `feedback-notify.test.js` updated to assert the new route/link.
`FeedbackInbox.jsx`: component-local `<style>` (mobile grid collapse) moved into `index.css`
§P5; H1 label → "Feedback Inbox" (matches the `navItems.jsx` `feedback_inbox` entry); the stale
file header (`FILE: AdminFeedback.jsx`, `Route: /tech-feedback`) corrected to match the actual
filename/route. `TYPE_BADGE`/`STATUS_BADGE` inline hex maps replaced with `fb-badge-*` classes
backed by new `--fb-badge-*` CSS custom properties in §P5 (same colors, reuses `--accent`/
`--accent-light`/`--bg-secondary`/`--text-tertiary`/`--border-color` where they already matched
the hex exactly); the "Update Status" buttons use the same classes for their active state
instead of inline `STATUS_BADGE[s].bg/color/border` lookups. Two-click purge, per-row draft
notes, and the lightbox were left functionally untouched (only their badge markup call sites
changed from inline style objects to `className`).
#### P6 — Scope Sheets (Session G) — shipped 2026-07-05
`ScopeSheets.jsx` (`AdminDemoSheetBuilder`) safety + polish, no schema/RPC changes (Foundation
shipped `delete_demo_schema` + `published_at`). **Deletion** now calls the SECURITY-DEFINER
`delete_demo_schema(p_id)` RPC instead of the raw `db.delete('demo_sheet_schemas', …)`; the RPC's
RAISE refusal (active / ever-published / sheet-referenced versions can't be deleted — protects the
`.claude/rules/scope-sheet-rollback.md` runbook) is surfaced verbatim in a toast via a new
`rpcErrorMessage()` helper that unwraps the PostgREST error JSON. **All three `window.confirm`**
(version delete, remove section, remove job section) → inline two-click confirm with `onBlur`
disarm; single-click **field removal** gained an arm state too, via a shared `ConfirmRemoveButton`
(first click arms + fills red/swaps to ✓, blur disarms, second click removes). **Unsaved-changes
guard** added on both version-switch (inline "Discard & switch / Keep editing" bar in the versions
sidebar via `pendingSwitchId`) and the **Back** button (two-click "Discard changes & leave?"), both
of which previously discarded edits silently. **Pure schema helpers extracted** into
`src/lib/demoSchemaUtils.js` (`FIELD_TYPES`, `move`/`removeAt`/`replaceAt`, `twoClickNext`,
`emptySection`/`emptyField`/`emptySchema`, `walkFields`, `validateSchemaShape`, `summarize`) with a
23-case `demoSchemaUtils.test.js` — extracted from THIS page's internals only; `TechDemoSheet` /
`DemoSheetRenderer` keep their own copies (tech surface out of P6 scope). Inline status hexes → new
`--ss-*` tokens in `index.css` §P6 (mirrors P5's `--fb-*` approach); "best on desktop" notice under
768px (the two-column editor is a deliberate desktop power tool — no phone layout). Publish confirm
modal + draft→publish sequencing left **byte-identical** (runbook-critical). Documentation Standard
header added to the substantially-edited `ScopeSheets.jsx`.
#### P7-lite — DevTools dedup (Session H)
Deleted exactly two tabs from `DevTools.jsx` (verified `/settings/integrations` and
`/settings/team` fully cover both capabilities before removing): the **Integrations** tab
(QBO connect/preview/backfill + its `?qbo=connected|error|badstate` return-param handling —
`/settings/integrations`'s QuickBooks card is a behavior-identical port using the same RPCs
and workers, and `quickbooks-callback.js` already redirects to `/settings/integrations`, not
`/dev-tools`) and the **Employees** tab (auth-link audit + invite — absorbed into
`/settings/team` as a summary strip + per-row Login badge/action). Removed their `TABS` and
`TAB_COMPONENTS` entries and the now-dead `IconSend`/`IconLink` icon helpers; every other tab
(Flags, Health, Workers, Backfill, Integrity, Messaging, Advanced) is untouched. DevTools is
now 7 tabs.

#### P8 — Connections hub (Session I · Wave 2)
Turned the P2 Integrations page (`/settings/integrations`, still `AdminRoute`) into the ONE
place every company-wide connection is discoverable — retitled **"Connections"**. Two groups:
- **Managed here** (full connect/status/disconnect cards): GitHub + QuickBooks (from P2) +
  **Deepgram** (new). Deepgram is a pasted API key stored in `integration_credentials`
  (provider=`deepgram`, read by `transcribe-call.js` / `callrail-webhook.js`); the card follows
  the GitHub pattern and is backed by a **new worker `functions/api/deepgram-connect.js`**
  (GET/POST/DELETE, `requireAdmin` role gate, validates the key against Deepgram
  `/v1/projects` — 401 rejected, other errors tolerated; two-click disconnect). *(Worker is a
  new additive file — outside the "Integrations.jsx + css" ownership line but required for the
  Deepgram card to write to the RLS-locked table; disclosed in the PR.)*
- **Managed elsewhere** (read-only status + cross-link, never moves the connection): **CRM
  Channels** (CallRail/Google Ads/Meta Ads via `get_integration_status` per provider →
  `/crm/integrations`), **Stripe** (`get_integration_status('stripe')` → `/settings/payments`),
  **Google Drive & Calendar** (per-user `user_google_accounts` — intentionally NO company pill,
  cross-links to `/settings/my-account`), and **Twilio SMS** (status-only: surfaces the
  `feature:twilio_live` flag as Live vs Dry-run; secret management is P9's job).
CSS: new `index.css` §P8 marker (reuses the §P2 `.settings-int-*` vocabulary; adds group
headings, four provider badges, the amber dry-run pill, and the status-list/cross-link body).
Zero migrations, zero CRM-file edits.

## Mobile Layout
- **Bottom bar:** 4 tabs (Dashboard, Messages, Jobs, Schedule) + More → opens sidebar
- **Sidebar:** slides in from left via `sidebar-open` class
- **Safe area:** footer uses `env(safe-area-inset-bottom)` for iPhone home bar
- **Pull to refresh:** `PullToRefresh` component wraps page content
- **iOS auto-zoom fix:** all inputs must have `font-size: 16px`
- **CSS transforms:** cause content clipping on real iPhones — use display toggle instead

---

## Native iOS App (Capacitor) — source-hardened, release gates remain

Camera, geolocation, native appearance, sign-in-time biometric verification, and the notification
popover are integrated in source. Push enrollment and Capgo OTA remain exact-default-off, and
distribution signing/TestFlight/App Review remain separate owner/external gates.

- **Bundle id:** `com.utahprosrestoration.upr`
- **Source:** `ios/App/App.xcodeproj` (SPM, not CocoaPods — Capacitor 8 default)
- **Config:** `capacitor.config.json` — `ios.contentInset: "never"` (let CSS handle safe areas)
- **Build:** `npm run build:ios` — sets `VITE_BUILD_TARGET=native`, runs Vite + `cap sync ios`
- **Side-by-side dev variant (2026-07-29):** third build configuration `Dev` + shared scheme
  **UPR Dev** in `App.xcodeproj` — bundle id `com.utahprosrestoration.upr.dev`, display name
  "UPR Dev" (`CFBundleDisplayName` is now `$(UPR_APP_DISPLAY_NAME)`, set per configuration;
  Debug/Release still resolve to `UPR`), badged `AppIcon-Dev` asset, automatic signing (team
  `H6ZUT739T9`), development entitlements (`App.entitlements`, `aps-environment: development`).
  Installs alongside the TestFlight app for testing dev-branch native work on-device.
  `npm run build:ios:dev` = `build:ios` with `VITE_APNS_ENV=sandbox VITE_NATIVE_PUSH_ENABLED=true`
  and deliberately no `VITE_NATIVE_API_ORIGIN` (native default is `https://dev.utahpros.app`).
  Debug/Release configs and the TestFlight lane are untouched
  (`scripts/ios-release-workflow.test.js` still passes). **Shared-DB caveat:** same production
  Supabase behind both apps — UI sandbox, not data sandbox. **Push caveat:** never flip Cloudflare
  Preview `APNS_TOPIC`; it stays on the production fallback in both environments. The live
  per-token topic records the dev bundle during enrollment, but a compatible deployed signed build,
  re-enrollment and device proof remain required. Full doc: `docs/mobile/dev-app-variant.md`.
- **Router split:** `src/App.jsx` renders `NativeRoutes` (only `/login` + `/tech/*`) when `VITE_BUILD_TARGET=native`; admin pages are excluded from the native bundle (~40% smaller)
- **Plugins installed:**
  - `@capacitor/camera` — TechDash + TechAppointment use native camera via `src/lib/nativeCamera.js`, fall back to photo library on simulators
  - `@capacitor/push-notifications` — `src/lib/pushNotifications.js` registers + upserts to `device_tokens` on login; APNs delivery via `functions/api/send-push.js`. Production TestFlight APNs delivery was physically proven on 2026-07-29. Source supports exact sandbox/production separation and the focused database boundary plus per-token topic are live; the remaining gates are compatible per-token/dev-app deployment, fresh runtime binding/re-enrollment, account-switch proof, and feature-specific signed-device matrices (including this participant UI). Broad S1h is not an activation prerequisite.
    **Sign-out always completes + ended-session revival guard (2026-07-29, owner-directed +
    security-reviewed, unified):** explicit sign-out runs one bounded best-effort cleanup pass and
    completes regardless of its outcome; unfinished server detach stays in the durable owner-bound
    journal (`residualJournaled`/`enrollmentPending` detach result fields; `deferrable`
    classification through `accountDeviceCleanup.js`/`pwaAccountState.js`; the bounded
    `transientPushRetry` mechanism exists but is unwired). The revival defect (supabase-js
    `signOut()` steals the SDK auth lock from an in-flight token refresh; the orphaned refresh
    re-persists the ended session; the app re-entered without Login) is closed by
    `src/lib/endedSessionGuard.js`: every sign-out path arms the session's JWT `session_id`
    (stable across rotation, never reused by a new login) in `upr:auth-ended-sessions:v1` (bare
    session UUIDs, cap 8, deliberately logout-surviving — never add it to logout sweep prefixes)
    BEFORE its first await, and the two failure paths that retain the session live (failed local
    signOut; logout refused by a recovery-owned block) un-arm it. Boot, SIGNED_IN,
    TOKEN_REFRESHED, and `recoverSession()` refuse a revived armed session; the un-awaited
    post-signOut sweep acts only on a positive SIDE-EFFECT-FREE storage match (never
    `getSession()`, which refreshes); a zombie that clobbered a newer published account's storage
    triggers the full SIGNED_OUT teardown instead of a silent absorb; a SIGNED_OUT reaching an
    already-clean tab is a no-op (cross-tab broadcast safe). Nothing is cleared at login — a
    fresh session id can never match, so same-user re-login and web cross-tab sync are
    structurally safe. Fail-open (undecodable token / blocked storage), observable via
    console.warn + `recordPwaDiagnostic('account-state', …)`. `SetPassword.jsx` skips populating
    `userEmail` from a tombstoned session. Signed-out-reauth/password-recovery/login/
    account-switch keep their hard gates; the bind-time `retryPendingAccountPushDetaches` gate is
    unchanged. Tests: `src/contexts/AuthContext.race.test.jsx` (zombie repro + guard suites) and
    `tests/qa/unit/pwa-source-contract.test.js` (arm/un-arm ordering source contracts). Contract:
    `docs/mobile/push-activation-owner-gate.md`. On-device account-switch verification remains
    the open owner gate.
  - `@capacitor/geolocation` — `src/lib/nativeGeolocation.js` captures coords on OMW + Start Work (saved to `job_time_entries.travel_start_lat/lng` and `clock_in_lat/lng`); TechDash renders an "away from jobsite" banner when current position is >200m from `clock_in_lat/lng` for an in_progress/paused appointment (foreground check on mount + app resume)
  - `@capacitor/haptics` + `@capacitor/status-bar` + `@capacitor/splash-screen` — `src/lib/nativeHaptics.js` (impact/notify) and `src/lib/nativeAppearance.js` (`setStatusBarBase` / `pushStatusBarSurface` / `restoreStatusBarBase`, `hideSplash`). Splash held until React mounts. The status-bar API is keyed on the SURFACE behind the strip, never the text colour: `ThemeContext` owns the base and the three gradient-hero routes push `'dark'` then hand it back. (STAT-01, 2026-07-27: the previous `statusBarLight`/`statusBarDark` pair named the text colour and mapped onto the same-sounding Capacitor enum member, which documents the opposite — both were inverted, so every native route painted the wrong icon colour.)
  - `@aparajita/capacitor-biometric-auth` — `src/lib/nativeLoginVerification.js` + `src/lib/nativeBiometric.js`. Native password login verifies Face ID / Touch ID after prior-account cleanup and before Supabase publishes the new session. Cancel/failure blocks that login. Unavailable or unenrolled biometry preserves password login. Retained authenticated sessions reopen without another prompt. Token storage remains the default WebView store — a Keychain migration is future hardening.
  - `@capgo/capacitor-updater` — OTA React/CSS/HTML support remains exact-default-off. `src/lib/nativeUpdater.js` exposes guarded helpers, but `CapacitorUpdater.autoUpdate` is `false`, `VITE_NATIVE_OTA_ENABLED` must be exactly `true`, and no boot path calls `notifyAppReady()` pending a real health checkpoint.
- **OTA deploy pipeline:** `.github/workflows/capgo-deploy.yml` — **paused since 2026-06-24** (Capgo account hit its plan limit; every automated upload was rejected). Push triggers are commented out; it's `workflow_dispatch` (manual) only until the Capgo plan is upgraded. Requires GitHub repo secrets `CAPGO_TOKEN`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- **TestFlight release pipeline:** `.github/workflows/ios-release.yml` — valid
  `workflow_dispatch`-only scaffold. A 2026-07-23 repair moved the signing-presence condition from
  the forbidden direct `secrets.*` step expression into job `env`; a repository test preserves the
  manual-only and no-direct-secret-condition boundaries. `ios/App/Version.xcconfig` is the single
  marketing-version source (`1.0.0`); the workflow supplies a unique build from its run
  number/attempt, and native Settings displays the installed version/build through
  `App.getInfo()`. Apple enrollment, distribution identity/profile, and a local signing-lane
  archive are now verified; GitHub signing/build secrets, a clean-source final artifact, and an
  explicitly authorized release dispatch remain open.
- **Native notification bell:** preserves populated rows during silent Realtime/resume refresh,
  uses the shared field-tech popover scale/fade enter plus accelerated exit lifecycle, returns
  focus, closes on Escape/click-away/route/inactive-pane changes, and resolves immediately for
  Reduce Motion. Its native surface now uses the field-tech card radius, readable typography,
  non-shrinking wrapped cards, and a bounded scrolling list; the dashboard three-dot menu consumes
  the same tokenized enter/exit motion instead of flashing in and disappearing instantly. The
  2026-07-28 simulator visual checks observed both populated notification cards and the matching
  menu motion, but the recordings contained authenticated data and were deleted; sanitized
  SHA-bound recapture, physical-device feel, and VoiceOver remain release checks.
- **Permission strings in Info.plist:** `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`, `NSPhotoLibraryAddUsageDescription`, `NSLocationWhenInUseUsageDescription`, `NSFaceIDUsageDescription`
- **Privacy shield:** `AppDelegate.swift` installs an opaque native app-switcher shield before
  resign/background and removes it after the app becomes active.
- **Task tracker:** `CAPACITOR-TASK.md` — already removed (all phases shipped), per the Task File Protocol in `CLAUDE.md`.

---

## PostgREST / Supabase Gotchas
- New tables need `SECURITY DEFINER` RPCs — REST API schema cache doesn't update immediately
- RLS anon policies require `TO anon` clause — `USING (true)` alone is insufficient
- `db.select()` **throws** on any non-OK response (400/404/500) — it does NOT silently return `[]`. (Corrected Jul 1 2026 — this doc previously repeated a false claim also found in CLAUDE.md; verified against `src/lib/supabase.js:56-58`.) Always wrap in try/catch.
- Always inspect actual column names via `information_schema.columns` before writing queries
- `job_notes` uses column `body`, NOT `content`
- `write_file` for full rewrites — `edit_file` fails silently on CRLF files
- `bust_postgrest_cache()` RPC forces schema reload without redeploying

---

## Dev Tools Roadmap Status (phases below complete as of Mar 27 2026; the Integrations tab — QBO/etc.
connection management, documented in its own sections above — shipped after this table and is the
9th tab, added Jul 1 2026 to fix the doc's stale "8 tabs" count)

| Phase | Item | Status |
|-------|------|--------|
| 1A | `feature_flags` table + RPCs + 8 seed rows | ✅ Done |
| 1B | AuthContext: `featureFlags` + `isFeatureEnabled()` | ✅ Done |
| 1C | Sidebar guards + `FeatureRoute` in App.jsx | ✅ Done |
| 2A | `DevRoute` + `/dev-tools` route in App.jsx | ✅ Done |
| 2B | DevTools.jsx page shell + Flags tab | ✅ Done |
| 3A | Health check dashboard | ✅ Done |
| 3B | Employee auth status tab | ✅ Done |
| 3C | Worker execution log tab + `worker_runs` table + RPC | ✅ Done |
| 4A | Orphan checker (5 parallel checks, expandable results) | ✅ Done |
| 4B | Claim/job tree viewer (typeahead search, contacts + tasks) | ✅ Done |
| 4C | Duplicate contact detector (by normalized phone) | ✅ Done |
| 5A | Template preview/test (variable substitution, SMS segments) | ✅ Done |
| 5B | Message log viewer (direction/status filters, pagination) | ✅ Done |
| 5C | Scheduled message queue (two-click cancel) | ✅ Done |
| 6A | RPC test runner (14 RPCs, dynamic params, JSON output) | ✅ Done |
| 6B | Table inspector (15 tables, row count, recent rows) | ✅ Done |
| 6C | `bust_postgrest_cache()` RPC + button | ✅ Done |

**All DevTools phases complete.** 7 tabs as of P7-lite (2026-07-04): Flags, Health, Workers, Backfill, Integrity, Messaging, Advanced — Employees and Integrations were deleted (moved to `/settings/team` and `/settings/integrations`).

**Backfill tab** (Apr 18 2026) — 6-month Encircle historical importer UI.
- Date-range + `date_field` (`date_of_loss` | `created_at`) picker
- Division strategy: `smart` (by `type_of_loss`) or `fixed` (user picks divisions)
- Behavior toggles: skip already-imported, repair orphans, skip no-phone claims, writeback CLM
- Preview (dry-run GET) renders totals grid + per-claim action table (new/repair/skip)
- Run (POST) executes with two-click confirm; result card shows counts, errors, 5 random samples with Encircle links
- Calls `/api/encircle-backfill` worker; logs to `worker_runs` as `encircle-backfill`

**Encircle integration patterns (four entry points):**
- `sync-encircle` — automated 15-newest sync, hardcoded `division='reconstruction'`, jobs only. Scheduled worker. Legacy. Fixed Jun 9 2026: upsert now targets `on_conflict=encircle_claim_id,division` (was `encircle_claim_id` alone, which has no matching unique index → 42P10 → "Supabase upsert failed").
- `encircle-import` — manual UI at `/import/encircle`, one claim at a time, full contact→claim→jobs chain + CLM writeback. Fixed Jun 9 2026: `loss_type` is now normalized via `normalizeLossType()` before the claims insert (Encircle sends free text / `type_of_loss_*` prefixed values which violated `claims_loss_type_check`; unmappable values fall back to `'other'`).
- `encircle-backfill` — batch worker, date-range + cursor pagination, full chain + orphan repair + gated writeback (only when Encircle `contractor_identifier` is empty).
- `sync-claim-to-encircle` (Apr 18 2026) — pushes UPR-native claims UP to Encircle. Fired automatically from CreateJobModal + TechNewJob after `create_job_with_contact` RPC succeeds — only when a NEW claim was minted; a job filed under an existing claim (`p_existing_claim_id`, both callers as of Jul 2026) skips the push since that claim is already synced. Idempotent via `claims.encircle_claim_id`. Failures stored on `claims.encircle_sync_error` and surfaced in DevTools → Backfill → Unsynced Claims panel with per-row retry **and a bulk "Sync Selected" button** (checkboxes default to all-selected; uncheck test rows before syncing; pushes sequentially with live `done/total` progress; dedup guard makes repeats safe). On success writes Encircle id back to `claims.encircle_claim_id` AND all child `jobs.encircle_claim_id`.
  - **Reliability fix (Jun 18 2026):** the client call in CreateJobModal + TechNewJob was *fire-and-forget* — when the page tore down (mobile app backgrounding, TechNewJob's immediate `navigate(-1)`, tab close) the request was abandoned, leaving the claim unsynced with **no `encircle_sync_error` recorded** (the tell: 17 unsynced claims, 0 errors, while every push that actually ran succeeded). Symptom users reported as "new claim under an existing client doesn't reach Encircle" — but it was not existing-client-specific (existing-client claims synced 9/12; the misdiagnosis led staff to duplicate clients as a workaround). Fix: both callers now **`await syncClaimToEncircle()` (8s AbortController timeout) before navigating/closing**, so the request completes while the page is alive (connectivity is guaranteed — the `create_job_with_contact` RPC just succeeded online). On timeout it proceeds without blocking (claim shows in the Unsynced panel).
  - **Duplicate guard (Jun 18 2026):** before creating, the worker searches Encircle by `contractor_identifier` (our CLM via `findExistingEncircleClaimByClm`); an exact CLM match links to the existing Encircle claim instead of creating a second one. Protects against retries, double-submits, failed write-backs, and any future overlap between the client push and a server-side sweep. Response carries `deduped: true` when it links rather than creates.
  - **Internal trigger auth (Jun 18 2026):** the worker's POST now accepts EITHER a logged-in user (UI) OR a valid `x-webhook-secret` header matching `integration_config.encircle_sweep_secret` (RLS-locked key/value table created by the QuickBooks migration; the worker reads it with its service-role key). This lets the database push claims server-side via `pg_net` without a user session and without any new Cloudflare env var — mirrors the QuickBooks `notify_qbo_customer_sync` trigger pattern (does NOT reuse the QBO secret). Used Jun 18 2026 to backfill the historical unsynced real claims (test/junk rows excluded). The existing user-auth path is unchanged. This same hook can later drive a recurring `pg_cron` sweep if desired.

**Idempotency rules:**
- Jobs: composite unique `(encircle_claim_id, division)` — upsert target for multi-division claims. Made non-partial Jun 9 2026 (was `WHERE encircle_claim_id IS NOT NULL`, which PostgREST `on_conflict` inference can't match); behavior is identical since NULLs never conflict in unique indexes.
- Claims: `encircle_claim_id TEXT` (added Apr 18 2026, non-unique index because one pre-existing dupe on encircle_claim_id 4517466). Linked via backfill from jobs. Populated going forward by sync-claim-to-encircle.
- Contacts: `phone UNIQUE NOT NULL`; email fallback lookup only when matched row has `phone IS NULL`.
- `type_of_loss` values come prefixed (`type_of_loss_water`, `type_of_loss_mold`). Smart mapping: water/sewer/flood → `[water, reconstruction]`; mold → `[mold]`; fire/smoke → `[fire, reconstruction]`; wind/storm/hail → `[reconstruction]`; unknown → `[water, reconstruction]`.

**Claims schema additions (Apr 18 2026):**
- `encircle_claim_id TEXT` — Encircle PropertyClaim id linked to this UPR claim (for bidirectional sync)
- `encircle_synced_at TIMESTAMPTZ` — when the link was established
- `encircle_sync_error TEXT` — last sync error message (cleared on success)

**DevRoute access:** `employee?.email === 'moroni@utah-pros.com'` — hardcoded, not role-based. **Note:**
the UPR MCP Server's `ALLOWED_EMAIL` uses `moroni.s@utah-pros.com` (with a dot) instead — two different
owner-only gates use two different email strings for the same person. Not a bug (both work), just worth
knowing before assuming they're interchangeable.

---

## Property Meld — restoration meld intake (Jul 7 2026)
We are a **vendor** in our property-manager client's Property Meld (no API for vendors), but we get
an email for every "Meld" (work order). This feature reads those emails and surfaces the
**restoration** ones in UPR. Carpet-cleaning Melds go to a *different business* and are excluded.

- **Classification is by Property Meld vendor account id** (in the email URLs), NOT the job title —
  titles mislead ("Carpet repair" came via cleaning; "Clean Mold Under Stairs" is restoration).
  `83074` = Utah Pros Restoration (**ingest**); `51865` = Utah Pros Carpet Cleaning (**exclude**).
  "A2Z Properties" and "Presidio Property Management" are the SAME company (a rebrand) — brand name
  is ignored on purpose.
- **Parser lib:** `functions/lib/property-meld.js` — `parseMeldEmail()` (assigned/canceled/message/
  appointment/daily-summary), `classifyMeldBusiness()`, `shouldIngestMeld()`, `meldToUpsertParams()`.
  Pure, no I/O; 28 unit tests from real inbox emails (`property-meld.test.js`).
- **Table `property_meld_melds`** (RLS + policy at creation): one row per Meld, de-dup key
  `meld_number` (UNIQUE — present in every email type; the internal numeric id is absent on cancels).
  `state` ∈ open|canceled|imported|archived; `imported_job_id` → jobs(id) for the future import.
- **RPCs:** `upsert_property_meld_meld(...)` (idempotent by meld_number; assign/message/cancel all
  update the same row, later events never wipe earlier fields, cancel closes it, imported never
  reverts) and `get_property_meld_melds(p_include_closed default false)` → SETOF json (emergencies
  first, newest first). Both SECURITY DEFINER + GRANT to anon, authenticated.
- **Page:** `/melds` (`src/pages/Melds.jsx`, owner-only via `MoroniRoute`, no nav link yet) — reads
  `get_property_meld_melds`; cards show type/emergency badge/address/status/due + a Property Meld
  deep link. **Email is lossy:** photos & inspection reports are portal-only, long descriptions
  truncate ("See More") → `description_clipped`; the portal link is how a tech reaches the rest.
- **Backfilled** 3 verified-real restoration melds (Reconstruction TFTBCQP, Mold check TH1BCY1,
  EMERGENCY Active Flooding T3YA1KM — all account 83074).
- **Live ingestion worker:** `POST /api/inbound-meld` (`functions/api/inbound-meld.js`) — a forwarder
  sends Property Meld emails here; it parses, keeps restoration only, upserts idempotently, and on a
  meld's FIRST assignment pushes the owner. **Auth:** shared secret header `x-meld-secret` =
  `INBOUND_MELD_SECRET` (set in BOTH Cloudflare env sets). **Transport setup:**
  `docs/property-meld-ingestion.md` (recommended: a Gmail Apps Script forwarding
  `from:msg.propertymeld.com`; Cloudflare Email Routing is an alternative). Core is node-tested
  (`inbound-meld.test.js`).
- **Push notification:** `notification_types` row `meld.received` (enabled, push+bell default) —
  the worker fires it to the owner (employee `moroni@utah-pros.com`) with a `/melds` deep link and a
  🚨 title for emergencies, via the shared `dispatchEvent` (recipient_ids explicit).
- **Nav:** `/melds` added to `OVERFLOW_ITEMS` in `navItems.jsx` as `moroniOnly` (owner-only, mirrors
  Homebuilding) — matches the `MoroniRoute` guard on the route.
- **NOT built yet (next slices):** (1) "Import to UPR job" (stub toast today — will write a real
  `jobs` row); (2) reply-to-thread (each message email's UUID From address threads back into
  Property Meld — `thread_reply_address` is already captured).

## Known Pending Items
(Jul 1 2026 audit pruned 2 already-resolved items — TECH-UI-TASK.md cleanup and the photo/note
appointment_id-OR-job_id fix are both done — and flagged 3 as unverified rather than asserted true.)

1. **Future Twilio transition (parked)** — CallRail is the active production SMS/MMS provider and
   must remain unchanged during ordinary releases. Twilio is planned weeks out; provider mode,
   credentials, webhook, number routing, A2P/compliance evidence and controlled traffic are a
   separate owner window. Repository parity work is inert and is not authorization to switch.
2. **Auth linking** — some employees have no `auth_user_id` (headcount changes — see Employees section
   for current roster rather than trusting a hardcoded count here); add emails via Admin → Send Invite.
3. **Search + export** — `tool:search_export` feature flag ready, page not built (confirmed still true).
4. **Bulk messaging** — `tool:bulk_sms` flag ready, not built (confirmed still true).
5. **Native app direction — superseded:** the active native client is the Capacitor 8 iOS project
   in this repository (`ios/`), not the historic separate React Native repository. Current release
   gates live in `docs/app-store-readiness-roadmap.md` and
   `docs/mobile/app-store-submission-strategy.md`.
6. **`toggle_appointment_task`** — frontend call sites (`TechAppointment.jsx`, `TechEditAppointment.jsx`,
   `TechTasks.jsx`) look correctly wired to `(p_task_id, p_employee_id)`; RPC exists live but its
   definition wasn't found in a `supabase/migrations/` file, so its exact server-side signature is
   unverified from the repo alone.
7. **Task assignment logic** — tasks belong to appointments, not employees. `get_assigned_tasks` must join through `appointment_crew` to find a tech's tasks. Frontend call sites look correct as of this audit.
8. **~~TechJobDetail follow-up~~ COMPLETE (Apr 16 2026)** — `/tech/jobs/:jobId` now renders the purpose-built `TechJobDetail.jsx`; `/tech/jobs/:jobId/photos` renders `TechJobAlbum.jsx`. Shared primitives (Hero, ActionBar, NowNextTile, PhotosGroup, Lightbox, DetailRow) promoted to `src/components/tech/`; small helpers (formatTime, relativeDate, photoDateTime, fileUrl, openMap) promoted to `src/lib/techDateUtils.js`. Desktop `JobPage` unchanged at `/jobs/:jobId`.
9. **Desktop ClaimPage photo URL bug** — confirmed still present (Jul 1 2026): `ClaimPage.jsx` builds photo URLs as `${db.baseUrl}/storage/v1/object/public/job-files/${doc.file_path}` but `doc.file_path` already starts with `job-files/`, producing a double prefix. TechClaimDetail uses the correct pattern: `${db.baseUrl}/storage/v1/object/public/${doc.file_path}`. Desktop photos may not be loading — still needs a fix.
10. **In-app SMS** — TechClaimDetail + TechAppointment Message buttons open native `sms:` compose; swap to in-app Messages flow when available (confirmed still a live `TODO: switch to in-app SMS` comment in tech files).
11. **Claim-level photo attachments** — TechClaimDetail uploads with `p_appointment_id: null`. On multi-job claims, the tech is prompted to pick which job the photo attaches to. Single-job claims direct-fire to `jobs[0].id`.

---

## Encircle Replacement — Phase 1 + 1.5 (Apr 17 2026)

The Encircle replacement build is scoped as a 6-8 week effort ending with Hydro
(moisture readings, IICRC S500) and a Water Loss Report PDF. Phase 1 + 1.5
landed Apr 17 and covers rooms + offline-first photo capture.

> **Superseded mobile boundary (Jul 27 2026):** the bullets below describe the Apr 17 deployment
> history, not the current release promise. The initial production PWA/Capacitor release admits
> and replays zero automatic offline commands: every field write is online-only,
> `PRODUCTION_QUEUE_TYPES` is empty, the hook exposes no enqueue/retry API, and the runner imports
> no dispatchers. IndexedDB remains only for count-only legacy quarantine and bounded cleanup.

### What's live
- **Rooms** — claim-scoped per `rooms` table. UI: Rooms grid on TechClaimDetail,
  dedicated TechRoomDetail page with Photos/Notes tabs. Add Room sheet with 16
  starter templates + custom name. All feature-gated behind `page:tech_rooms`.
- **PhotoNoteSheet** — shared bottom sheet used post-upload. Two tabs (Note +
  Room). Extracted from duplicated JSX in TechAppointment.jsx and TechDash.jsx.
- **Offline queue** — IDB-backed write queue. All four photo capture surfaces
  (TechAppointment, TechDash ActiveCard, TechClaimDetail, TechRoomDetail) route
  through it when `offline:queue` is enabled. Sync runner drains on online/
  visibilitychange/30s poll with exponential backoff (1s/4s/15s/1m/5m). Max 5
  retries before status=error. OfflineStatusPill in TechLayout shows
  "Syncing N" / "N failed" (tap to retry) / brief "Synced" flash.
- **Service worker** — ⚠️ CORRECTED Jul 3 2026: the CacheFirst `upr-v1` SW this
  bullet used to describe was KILLED Apr 18 2026 (it caused the iOS blank-page
  MIME trap). `public/sw.js` is now a self-destruct kill-switch and
  `src/main.jsx:44-72` unregisters all SWs on every load. Never rebuild
  fetch-caching into a SW here — see the PWA section + `docs/notify-roadmap.md`.
- **5 feature flags** seeded dev-only for Moroni Salvador admin
  (`d1d37f3c-2de5-4d8c-b5a8-f7b87e93d2da`):
  - `page:tech_rooms` — Rooms UI + PhotoNoteSheet Room tab
  - `page:tech_moisture` — Phase 2 Hydro (placeholder)
  - `page:tech_equipment` — Phase 2 equipment placements (placeholder)
  - `page:water_loss_report` — Phase 3 PDF (placeholder)
  - `offline:queue` — Queue kill-switch; on = enqueue path, off = inline path

### New files
```
src/components/tech/
  PhotoNoteSheet.jsx       — shared bottom sheet, Note + Room tabs
  RoomCard.jsx             — cover-photo tile, scrim + name overlay, photo-count chip
  AddRoomSheet.jsx         — template grid + custom name
  OfflineStatusPill.jsx    — mounted in TechLayout header, floating top-right
src/pages/tech/
  TechRoomDetail.jsx       — /tech/claims/:claimId/rooms/:roomId — Photos/Notes tabs
src/lib/
  offlineDb.js             — idb wrapper, 7 stores: queue, photos, rooms, readings,
                             equipment, cacheMeta, idSwaps
  syncRunner.js            — drain/dispatch/backoff/emit
  syncRunnerSingleton.js   — one runner per (db, employee.id)
  registerSW.js            — SW registration helper (DEAD CODE — zero importers; main.jsx
                             UNREGISTERS SWs, it does not register. Corrected Jul 3 2026;
                             its fate is decided by notify Phase F1)
  dispatchers/
    roomDispatcher.js      — create_room RPC + temp→server UUID swap
    photoDispatcher.js     — Storage upload + insert_job_document, resolves roomId swap
src/hooks/
  useOfflineQueue.js       — useSyncExternalStore-based hook, lazy-inits singleton
supabase/migrations/
  20260420_phase1_rooms.sql               — table, RPCs, insert_job_document extension
  20260417_phase1_rooms_claim_scoped.sql  — job_id → claim_id refactor + get_claim_rooms
```
⚠️ **Filename dates contradict this listing order** (0417 sorts before 0420) — both files landed in the
same commit, so true applied order can't be reconstructed from git alone. Content is directionally
correct (0420 has the base `create_room`/`get_job_rooms`; 0417 has the claim-scoped versions +
`get_claim_rooms`) — treat the exact sequencing as unverified rather than trusting the order above.

### Client ID idempotency contract
- Every new table has `client_id UUID UNIQUE`.
- Every write RPC takes `p_client_id` and does `ON CONFLICT (client_id) DO UPDATE`.
- Retries are safe. Photo dispatcher uses `resolveIdSwap` to turn a temp
  room UUID (queued before `room.create` synced) into the real server UUID
  before calling `insert_job_document`.

### Pending follow-ups
- Web admin parity (`ClaimPage.jsx` desktop) — rooms section not yet added
- Photo capture auto-open PhotoNoteSheet after enqueue to allow note + room
  tagging pre-sync (currently only possible after sync completes)
- Rename / delete room UI on TechRoomDetail (currently create-only)
- Offline app-shell bootstrap — SW doesn't cache index.html for cold-offline-launch
- Phase 3: Water Loss Report PDF (extend pdf-lib engine from submit-esign.js)

---

## Encircle Replacement — Phase 2 Hydro (Apr 18 2026)

IICRC S500 drying workflow: moisture readings, equipment placements, stall
detection. All feature-gated (`page:tech_moisture`, `page:tech_equipment`)
to Moroni's admin account — team sees zero change.

### Schema additions
```
material_type enum   — 'drywall','wood_subfloor','wood_framing','wood_hardwood',
                       'wood_engineered','concrete','carpet','carpet_pad',
                       'tile','laminate','vinyl','insulation','other'
equipment_type enum  — 'dehu_lgr','dehu_conventional','dehu_desiccant',
                       'air_mover','air_mover_axial','afd','hepa','heater','other'

moisture_readings    — id UUID, job_id, room_id, equipment_id (FK set after
                       equipment_placements exists), reading_date,
                       material material_type, location_description,
                       mc_pct, rh_pct, temp_f, gpp, dew_point_f,
                       dry_standard_pct, drying_goal_pct,
                       is_affected BOOL DEFAULT true,
                       taken_by, taken_at, edited_at, edited_by, notes,
                       client_id UUID UNIQUE (offline), created_at
                       Indexes: (job_id, reading_date DESC),
                                (room_id, material, reading_date DESC)

equipment_placements — id UUID, job_id, room_id, equipment_type,
                       nickname, serial_number,
                       status TEXT CHECK('active','removed'),
                       placed_at, removed_at, placed_by, removed_by,
                       notes, client_id UUID UNIQUE, created_at
                       Partial index: (job_id) WHERE status='active'
```

### RPCs
```
insert_reading(p_job_id, p_room_id, p_material, p_location, p_mc, p_rh,
               p_temp_f, p_gpp, p_dew_point, p_is_affected, p_equipment_id,
               p_taken_by, p_notes, p_client_id, p_taken_at DEFAULT now())
  — Idempotent upsert on client_id. Establishes dry_standard when the
    first unaffected reading for a (job, material) pair lands; backfills
    prior affected rows in the same pair; copies standard forward for
    future ones. drying_goal defaults to dry_standard + 2.

update_reading(p_reading_id, ...)  — 10-minute edit window; RAISES after
delete_reading(p_reading_id)       — 10-minute delete window; RAISES after

get_job_readings(p_job_id)
  — Joins room_name, computes per-row is_stalled via CTE: latest row for
    each (room, material) is stalled if mc_pct > drying_goal_pct AND a
    prior reading ≥36h older shows (prior.mc − latest.mc) < 1.0.

get_job_equipment(p_job_id, p_include_removed DEFAULT false)
  — Joins room_name + days_onsite.

place_equipment(p_job_id, p_room_id, p_equipment_type, p_nickname,
                p_serial, p_placed_by, p_client_id, p_notes)
  — Idempotent on client_id.

remove_equipment(p_equipment_id, p_removed_by)
  — No-op if already removed.

get_stalled_materials(p_job_id)
  — One row per stalled (room, material) pair on the job.

get_stalled_materials_for_employee(p_employee_id)
  — Aggregates stalled materials across every job the tech has touched via
    appointment_crew in the last 30 days. Joins job_number + latest
    appointment_id per job. Powers the StalledWidget on TechDash.
```

### New files
```
src/lib/
  psychrometric.js              — pure calcs: calcSaturationPressure_inHg,
                                   calcDewPoint, calcVaporPressure, calcGPP.
                                   Magnus-Tetens + ASHRAE humidity-ratio.
                                   Guards NaN on out-of-range input.
  psychrometric.test.js         — 27 vitest assertions covering ASHRAE
                                   checkpoints at ±2% (±5% for 90°F/80%
                                   where fixed-Pa Magnus under-predicts).
  dispatchers/
    readingDispatcher.js        — insert_reading RPC; resolveIdSwap on
                                   room + equipment ids.
    equipmentDispatcher.js      — dispatchEquipmentPlace (resolveIdSwap
                                   on room) + dispatchEquipmentRemove.

src/components/tech/
  MaterialIcon.jsx              — 10 SVG icons (one per material group) +
                                   MATERIAL_LABELS export.
  ReadingEntrySheet.jsx         — 4-step bottom sheet: Room → Material →
                                   MC/RH/Temp with live GPP + dew-point
                                   readout → Affected/location/equipment/
                                   notes. Auto-advance on material tap.
                                   Default-room skips step 1.
  EquipmentPlacementSheet.jsx   — 2-step sheet: type picker → details.
                                   Exports EQUIPMENT_LABELS.
  StalledWidget.jsx             — Red banner on TechDash, polled every
                                   2 min. Tap row → navigate to latest
                                   appointment on that job.

supabase/migrations/
  20260418_phase2_hydro.sql             — tables, enums, 8 RPCs
  20260418_get_stalled_for_employee.sql — employee-scoped aggregator

package.json  — added "test": "vitest run" and vitest devDependency.
```

### TechAppointment integration

> **Current behavior:** the historical queue routing described below is disabled. Moisture and
> equipment writes fail before local persistence when offline; no production caller enqueues or
> retries them.

- New sections between Tasks and Photos: **Moisture** and **Equipment**,
  both flag-gated.
- Moisture rows: material icon, name + (unaffected) marker, room /
  location / relativeTime, mono MC% color-coded (green ≤ goal, amber
  within 2, red above), goal% subline, STALLED chip when flagged.
  "N stalled" red pill in section header.
- Equipment rows: 3-letter type badge, nickname || type, room · Day N,
  inline two-click Remove.
- Save via `handleSaveReading` / `handlePlaceEquipment` / `handleRemoveEquipment`
  — route through offline queue when `offline:queue` is on, else call
  RPC inline + loadHydro(). sync:item-done listener triggers loadHydro
  when a Hydro item for this job finishes draining.

### TechDash integration
- StalledWidget mounted at the top of the scrollable PullToRefresh region.
  Returns null when nothing is stalled (zero footprint on clean days).

### Known dev-server quirk (not blocking, unverified as of Jul 1 2026)
`npm run dev` intermittently hits a Vite deps-cache version-hash mismatch
that manifests as "Invalid hook call" in OfflineStatusPill. Clearing
`node_modules/.vite` and restarting usually fixes it. Production bundle
(`npm run build` / Cloudflare Pages) is unaffected. *Not re-confirmed by this audit (no code
artifact to check statically) — if you haven't hit this recently, it may be stale; drop it next
edit if so.*

---

## Homebuilding Entry Analysis (Moroni-only)

Private planning page at `/homebuilding` (gated to `moroni@utah-pros.com` via `MoroniRoute`
in `App.jsx`; side-nav link in `Sidebar.jsx` + desktop overflow entry in `navItems.jsx`).
Rendered by `src/pages/HomebuildingAnalysis.jsx` (self-contained: inline styles + scoped
`<style>`, inline-SVG icons, hand-built SVG radar — no recharts/lucide/Tailwind). Sections:
three entry paths, per-market profiles, **Build Copilot** (AI chat), **Deal Modeler**,
**AI Build & Value Estimator**, financing ladder, decisions, risk.

### AI workers (Cloudflare Pages Functions)
Both reuse the existing `ANTHROPIC_API_KEY` (Preview + Production) and re-check the logged-in
user's email server-side (`moroni@utah-pros.com`).
- `functions/api/homebuilding-chat.js` — Build Copilot chat. **Sonnet 4.6** + the `web_search`
  server tool (current rates/prices/code editions), handles `pause_turn`. Non-streaming, so it
  must finish inside Cloudflare's ~100s timeout — hence Sonnet + capped `max_uses`(3)/continuations(2);
  the frontend also has a 95s AbortController. Gets the live deal-modeler state as context.
- `functions/api/homebuilding-estimate.js` — AI estimator. **Sonnet 4.6**, single forced-tool
  structured-output call (no web search). Inputs: region, beds, baths, sqft, stories, finish,
  land, features → `{ build_cost{low,expected,high}, cost_per_sf, breakdown[], arv{...},
  feature_notes[], confidence, assumptions[], notes[] }`. ARV anchored to comps, capped at the
  neighborhood ceiling.

### History tables (new) — chat + estimate persistence
RLS enabled, **no public table policies**; access only via SECURITY DEFINER RPCs granted to
`authenticated`. Read/written from the frontend via `db.rpc(...)` (workers do not persist).
- `homebuilding_chats` — `id UUID PK, title TEXT, created_at, updated_at` (renameable conversations)
- `homebuilding_chat_messages` — `id UUID PK, chat_id UUID FK→homebuilding_chats ON DELETE CASCADE, role TEXT('user'|'assistant'), content TEXT, created_at`
- `homebuilding_estimates` — `id UUID PK, label TEXT, region TEXT, spec JSONB, estimate JSONB, created_at`

### History RPCs (new)
```
list_homebuilding_chats()                                  -- ordered by updated_at desc
create_homebuilding_chat(p_title)                          -- returns the new chat row
rename_homebuilding_chat(p_id, p_title)
delete_homebuilding_chat(p_id)                             -- cascades messages
get_homebuilding_chat_messages(p_chat_id)                  -- ordered by created_at
add_homebuilding_chat_message(p_chat_id, p_role, p_content) -- also touches chats.updated_at
save_homebuilding_estimate(p_label, p_region, p_spec, p_estimate) -- returns the saved row
list_homebuilding_estimates()                              -- newest first, limit 100
rename_homebuilding_estimate(p_id, p_label)
delete_homebuilding_estimate(p_id)
```
The Build Copilot loads/saves conversations (switch, rename, new, two-click delete); the AI
Estimator auto-saves every run and shows a Saved-estimates list (view, rename, two-click delete).


---

## New Build simulator (Moroni-only)

Full-page tool at `/homebuilding/build` (Moroni-only via `MoroniRoute`), reached from a "+ New Build"
button in the Homebuilding Analysis title block. Rendered by `src/pages/NewBuildSimulator.jsx`.
Numbers-first build planner: a standard Utah template seeds an editable itemized budget, a
schedule (gantt), a construction-loan draw schedule, financing/returns, save/load projects, optional
AI tuning, AI ARV estimate, and PDF export.

### Engine — `src/lib/buildTemplate.js`
Pure data + math (no UI). `PHASES` (trade line items w/ cost share, duration weeks, draw milestone),
`FEATURES`, `DRAW_STAGES`. Functions: `computeLineItems(spec)` (trade lines total region/finish
$/sf × sqft exactly; finish/story/bath scaling; feature add-ons), `computeSchedule`, `computeDraws`
(sum to hard total), `computeFinancing` (mirrors the deal-modeler formula), `buildPlanFromSpec`,
`defaultSpec`. Hard-cost $/sf already includes GC overhead & profit; soft + contingency are separate %.

### Workers (Cloudflare Pages Functions) — Moroni-gated, reuse ANTHROPIC_API_KEY
- `functions/api/homebuilding-plan-tune.js` — Sonnet 4.6, forced-tool structured output. Tunes the
  template baseline (per-line totals + phase durations + soft/contingency %) to the spec/submarket.
- `functions/api/homebuilding-build-plan-pdf.js` — pdf-lib; renders a multi-section Build Plan PDF
  (cover, spec, budget table, schedule, draws, financing) and returns application/pdf bytes for
  direct browser download (no storage). WinAnsi-sanitized text.

### Table `homebuilding_build_projects` (new)
`id UUID PK, label TEXT, region TEXT, spec JSONB, plan JSONB (lineItems/schedule/arv), created_at,
updated_at`. RLS on, no public table policies; access via SECURITY DEFINER RPCs granted to
`authenticated`:
```
list_homebuilding_build_projects()
get_homebuilding_build_project(p_id)
save_homebuilding_build_project(p_id, p_label, p_region, p_spec, p_plan)  -- null id = insert, else upsert
rename_homebuilding_build_project(p_id, p_label)
duplicate_homebuilding_build_project(p_id)
delete_homebuilding_build_project(p_id)
```
Derived numbers (hard total, draws, months, financing) are recomputed on the page from the stored
lineItems/schedule/arv; only those are persisted in `plan`.

### City/submarket detail (buildTemplate.js `SUBMARKETS`)
Per-city anchors for both regions — `{ name, psfMult (construction-cost nudge), lot (typical $),
arvPsf (resale $/sf) }`. Wasatch: SLC east bench, SLC County, Draper, Lehi/Saratoga Springs, Eagle
Mountain, Provo/Orem, Spanish Fork/Salem, Park City. Southern: St. George, Washington, Hurricane,
Ivins, Santa Clara, Toquerville/LaVerkin. The Spec tab's submarket is a dropdown; picking a city sets
the typical lot and scales the build cost (`submarketMult`). `computeArvBaseline(spec)` gives a quick
comps-based ARV ("City comp ARV" button) from `arvPsf`; the AI estimate (now passed the submarket)
refines it.

### Floor-plan builder (New Build → "Floor Plan" tab)
Drag room tiles from a palette onto a 0.5-ft (6") grid (HTML5 DnD; `GRID_FT = 0.5` in
`NewBuildSimulator.jsx` — corrected Jul 1 2026, was documented as 1-ft), then drag to move / pull the corner to
resize (pointer events; window-level move/up driven by a ref). Room model in `buildTemplate.js`:
`ROOM_TYPES` (each with fill, bed, bath, conditioned, default w/h ft), `roomDef`, and
`floorplanTotals(fp)` → { conditioned sqft, bedrooms, bathrooms, rooms }. Garage + covered patio are
excluded from conditioned sqft. The plan is stored in `plan.floorplan` (persists via the existing
build-project RPC). **Sync to spec** writes sqft/bd/ba into the Spec and regenerates the budget +
schedule from it (`buildPlanFromSpec`), so building a plan auto-costs it.

## Public build-status page — `/status` (Jul 1 2026, off Phase 0/1)

A logged-out, public mirror of `/crm/roadmap` — no auth, no `page:crm` flag, no CRM shell. Built so
anyone with the link (not just Moroni) can see build progress without an account. Deliberately the
**only** public CRM surface; every other `/crm/*` route stays behind `<FeatureRoute flag="page:crm">`
in `src/App.jsx`.

**Route**: `src/pages/Status.jsx`, registered as a top-level public route in `WebRoutes()`
(`src/App.jsx`, alongside `/login`/`/privacy`/`/terms`) — outside `ProtectedRoute`/`Layout` entirely,
so it renders with no employee session. Not registered in `NativeRoutes()` (iOS/Capacitor only ships
`/login` + `/tech/*`, same as `/privacy`/`/terms`).

**Data access**: calls `db.rpc('get_crm_build_progress')` using the **unauthenticated `db` singleton
imported directly from `@/lib/supabase`** — not `useAuth()`'s `db` — since the page must work with no
session under CLAUDE.md Rule 3’s public/bootstrap carve-out. This is a `/status`-specific public
call; the former `Login.jsx` employee picker and `devLogin` path have been removed and are not a
current precedent. No new migration was needed:
`get_crm_build_progress()` was already `GRANT EXECUTE`'d to `anon` (and `authenticated`, `PUBLIC`) in
`supabase/migrations/20260701_crm_phase0_scaffold.sql` — verified live via
`information_schema.routine_privileges` before building, not assumed. The underlying
`crm_build_phases`/`crm_build_stages` RLS policies are also `anon`-permissive, though moot since the
RPC is `SECURITY DEFINER`. The RPC only ever returns phase/stage metadata (key, title, status,
done/total counts) — no contact/lead/financial data — so nothing here needed extra redaction.

**Shared rendering**: the phase/stage card markup was extracted from `CrmRoadmap.jsx` into
`src/components/BuildProgressPhaseCard.jsx` (a plain presentational component, no data fetching) so
`/status` and `/crm/roadmap` render identically from the same code, not two hand-synced copies. CSS
is the same pre-existing `.crm-roadmap-*` block (plain app tokens, not `.crm-shell`'s `--crm-*`
tokens — this card renders outside the CRM shell). New CSS for the page's own outer shell only:
`.status-page`/`.status-page-inner` in `src/index.css`, styled after `.login-page` (dark surround,
centered column) but scrollable-width instead of a fixed-width card, since it holds a full phase
list; a `@media (max-width: 768px)` block adjusts padding only, per CLAUDE.md rule 5.

**Test-first**: `supabase/tests/crm_status_public_access.test.js` — integration test (vitest, same
`describe.skipIf(!hasCreds)` self-skip pattern as the Phase 0/1 suites) asserting
`get_crm_build_progress()` succeeds for an anon-key-only caller and returns the expected
`{ phases, overall_done, overall_total }` shape, plus a guard that the payload never contains
email/token/password-shaped strings — the regression check for "the RPC is still granted to anon."
Committed before `Status.jsx`.

**Verification this session**: `npm test`/`build`/`eslint` (changed files) all pass. Browser-verified
with Playwright — confirmed the route renders with no login redirect and the correct title/subtitle
against the real dev server, and (route-mocked, since this sandbox's network policy blocks direct
browser egress to Supabase — MCP tool calls use a different channel) confirmed the phase/stage cards
render pixel-identical to `/crm/roadmap` at both desktop and mobile (390px) widths. The anon-grant
data path itself was verified separately via direct SQL against the live `dev`/`main` shared Supabase
project (`information_schema.routine_privileges`), not through the browser.


---

## Company Roadmap page — `/roadmap` (in-app) + `/roadmap/public` (no-login) (Jul 3 2026)

A high-level, **read-only "what are we building right now"** board covering every active initiative —
Mobile App, Desktop Schedule improvements, CRM, Settings overhaul, Security & Compliance checks, and
other ongoing work — each with a status badge and a derived progress bar. Distinct from `/crm/roadmap`
+ `/status` (those are the DB-backed *CRM build* tracker); this is a company-wide, **deliberately
DB-free** overview so it can be shared publicly with zero data/permission exposure.

**Content source — no DB, no RPC, no permissions**: all content lives in `src/lib/roadmapData.js`
(`ROADMAP_INITIATIVES`, `ROADMAP_UPDATED`, `roadmapOverall()`). To update the board you edit that one
file — there is no table, RPC, or admin screen. This is what makes the public page safe to share:
it touches no Supabase table at all. Progress % is **derived** from each initiative's `items`
(`done ÷ total`), never hand-typed.

**Two entry points, one renderer**:
- In-app: `src/pages/Roadmap.jsx` at `/roadmap`, inside `Layout` (logged-in). Reached from the side
  menu — added as a hardcoded link in `Sidebar.jsx` (after Help & Guides, `crm_partner` excluded, same
  pattern as the Feedback link) and as an `always: true` entry (`key: 'roadmap'`) in
  `OVERFLOW_ITEMS`/`navItems.jsx` for the ≥1280px overflow drawer. New `IconRoadmap` in `navItems.jsx`.
  Has a local light/dark toggle (reuses `.crm-roadmap-page.dark`) and a "Public view ↗" link.
- Public: `src/pages/PublicRoadmap.jsx` at `/roadmap/public`, a top-level public route in `WebRoutes()`
  (alongside `/status`/`/login`/`/privacy`) — outside `ProtectedRoute`/`Layout`, no `useAuth()`, no db.
  Reuses the `.status-page` shell. Not in `NativeRoutes()`.
- Both render `src/components/RoadmapView.jsx` (pure presentational, takes `initiatives` prop) so the
  logged-in and public views never drift. CSS reuses the existing `.crm-roadmap-*` block — **no new
  CSS added**.

**Verification**: `npm run build` (all three chunks emit + content confirmed in bundle), full `vitest`
suite (414 passed / 77 skipped), `eslint` on changed files clean (the 5 pre-existing
`react-refresh/only-export-components` errors in `navItems.jsx` are unchanged, not new). `/roadmap/public`
serves HTTP 200 with no login against `vite preview`.


---

## Feedback Media (Jul 3 2026) — Phase F foundation shipped

Photos + video on employee feedback, desktop submissions, retention plumbing. Roadmap +
BINDING ownership matrix: `docs/feedback-media-roadmap.md` (Foundation-then-parallel-wave;
Phase F owned 100% of the schema — Sessions B/C ship zero migrations).

**`tech_feedback` new columns** (`20260702_feedback_media.sql`, additive): `attachments jsonb
NOT NULL DEFAULT '[]'` (records `{path,name,mime,size,original_size,width?,height?,duration?}`,
path bucket-LESS), `source text NOT NULL DEFAULT 'tech'` CHECK tech|desktop, `resolved_at
timestamptz`, `attachments_purged_at timestamptz`. ⚠️ Legacy `screenshots` values were
double-encoded jsonb STRING scalars (JSON.stringify through PostgREST) — backfilled to real
arrays; the insert RPC now decodes string-scalar input too.

**RPCs** (all SECURITY DEFINER, anon+authenticated):
- `insert_tech_feedback(p_employee_id, p_type, p_title, p_description, p_screenshots, p_attachments, p_source)` —
  **7-arg via DROP+CREATE** (the old 5-arg signature was dropped in the same transaction; a
  plain OR REPLACE would have created an ambiguous overload and broken every live submit).
  Body mirrors both directions: screenshots→attachments (`{path}`-only, bucket prefix
  stripped) for old callers; image attachments→screenshots (`job-files/` prefix added,
  videos excluded) for new callers. Old 5-arg call verified live through PostgREST.
- `update_tech_feedback(p_id, p_status, p_admin_notes)` — unchanged signature; stamps
  `resolved_at` on first transition into resolved/dismissed, keeps it terminal↔terminal,
  NULLs it on reopen, never touches `attachments_purged_at`.
- `get_tech_feedback()` — RETURNS TABLE gained `attachments, source, resolved_at,
  attachments_purged_at` (appended; existing caller ignores extra keys).
- `get_purgeable_feedback_media(p_days int DEFAULT 90)` — terminal + unpurged + non-empty
  attachments older than `GREATEST(p_days, 30)` days; the ≥30-day clamp lives INSIDE the RPC
  because the future purge endpoint is unauthenticated by cron convention.
- `mark_feedback_attachments_purged(p_id)` — idempotent, first stamp wins.

**Shared code (FROZEN for the wave):** `src/lib/mediaCompress.js` (caps: 5 files / 1 video /
90s / img in ≤25MB / video ≤50MB; compressImage → 1920px 0.8 JPEG, never larger than the
original, HEIC fallback ≤10MB; probeVideo never rejects, 5s→nulls; 33 unit tests) and
`src/components/FeedbackAttachments.jsx` (snap-first immediate upload to
`job-files/feedback/{employeeId}/{ts}-{sanitized}`, per-tile state machine with Retry —
retry re-validates the caps, best-effort storage DELETE on remove behind a busy `removing`
state — fixes the old orphaned-upload bug without opening a submit race, duration chip,
≥48px targets; contract `value/onChange/onBusyChange/disabled/caps`, calls useAuth()
itself). ⚠️ Composer reset contract: `value` seeds tiles ON MOUNT ONLY — to clear it
(e.g. after submit) remount with a new `key`; it deliberately has no value-watching effect
(a prop-sync effect raced parallel upload completions and dropped fresh tiles — caught by
adversarial review, fixed pre-merge).

**Desktop surface:** `src/pages/Feedback.jsx` at `/feedback` (Layout shell, ungated —
every employee), submits `p_source:'desktop'` + `p_attachments` as a REAL array (never
JSON.stringify). Nav: OVERFLOW_ITEMS entries with `always: true` +
`hideForRoles: ['crm_partner']` (isItemVisible gained the generic `hideForRoles` check —
crm_partner is locked to /crm/*+/help by Layout's choke point, so the link would dead-end
for them). The legacy mobile Sidebar link is hardcoded after the NAV_ITEMS loop like Help
(same crm_partner exclusion) — NAV_ITEMS itself stays identical. CSS: `fbm-*` classes in
`index.css` Phase F block, with reserved Session B / Session C blocks appended after it.

### Session B (submit surfaces + notify) — shipped Jul 3 2026

**`src/pages/tech/TechFeedback.jsx` rebuilt** on the shared `FeedbackAttachments` composer:
photos + one short video with free compression/caps, real storage DELETE on remove (fixes the
old orphaned-upload bug), snap-first (no blocking inputs), ≥48px targets (back button now 48px).
`'feature'` is relabeled **"Improvement"** in the UI only (DB CHECK still `'bug'|'feature'`).
Submit passes `p_attachments` as a REAL array (never JSON.stringify) + `p_source:'tech'`, then
navigates back to `/tech`. No dedicated index.css rules needed — the form uses inline tech
tokens and the composer ships its own global `.fbm-*` styles (Phase F block); the Session B
reserved marker carries a note to that effect.

**`src/pages/Feedback.jsx` (desktop)** polished: captures the insert RPC's returned row and
fires the same notify; header DEPENDS-ON updated. Keeps `p_source:'desktop'`.

**New worker `functions/api/feedback-notify.js`** (+ `feedback-notify.test.js`, 12 tests): POST
`{feedback_id}`, `requireAuth` in send-push.js's shape (Bearer required; validated against
`/auth/v1/user` using the **anon key** as apikey — the service-role key is unnecessary for token
validation, and using anon also sidesteps the block-secrets hook's env-var-name literal match).
Service-key client (`supabase(env)`) loads the feedback row + submitter `full_name` + admins
(`employees?role=eq.admin`). Two channels:
1. **In-app bell** — `create_notification` RPC (`p_type:'feedback'`, link `/tech-feedback`,
   entity `tech_feedback`/id). Works today; the notifications feed is **global** (no recipient
   column) so every employee sees the notice — accepted + disclosed per the roadmap. NOTE
   (Settings Overhaul Phase F): `/tech-feedback` now permanently redirects to `/settings/feedback`,
   so existing/new bell links keep working; Settings-Overhaul P5 retargets this worker to write
   `/settings/feedback` directly.
2. **Per-admin push** — one same-origin `POST /api/send-push` per admin **excluding the
   submitter**, forwarding the caller's `Authorization` header, title `New bug report` /
   `New improvement idea`, body `{submitter}: {title}`, data `{feedback_id, route:'/tech-feedback'}`.
   Returns `{notified, attempted, bell, results}`.

Both pages call it **fire-and-forget** via `src/lib/api.js` (`api('feedback-notify', …)` attaches
the user Bearer) with a swallowed `.catch(()=>{})` — the success toast never depends on it.
Pure helpers `selectAdminIds(employees, submitterId)` + `buildPushPayload(feedback, name)` are
node-tested; the handler test injects fake db + fetch to prove 401-without-Bearer,
submitter-excluded fan-out count, and a 503 from send-push reported without failing the request.

**Historical Session B snapshot (2026-07-02; not current state):** APNs env vars were unset and
`device_tokens` had zero rows, so only the in-app bell worked at that boundary. Current APNs,
TestFlight/device, and per-token-topic evidence is recorded in the later native notification
sections and the live `20260731154315_device_token_apns_topic` ledger. This historical note must
not be used as a current release blocker.

### Session C (AdminFeedback rebuild + gallery) — shipped (Jul 3 2026)

Owner's media view + retention purge. Files: `src/pages/AdminFeedback.jsx` (rebuilt),
`functions/api/purge-feedback-media.js` (+ `.test.js`, new), one line in
`src/pages/DevTools.jsx` (`WORKER_NAMES` gains `'purge-feedback-media'`), and the reserved
Session C `index.css` block. Zero schema migrations (consumes Phase F's).

- **AdminFeedback rebuild.** Media gallery reads the `attachments` jsonb (falls back to legacy
  `screenshots` when `attachments` is empty), normalizing both via `stripBucketPrefix` before
  building the `…/storage/v1/object/public/job-files/{path}` URL. Images open in an **own**
  lightbox (not the tech-scoped `src/components/tech/Lightbox.jsx`); videos play inline via
  `<video controls preload="metadata">`. Per-file name + size, and a "10.4 MB → 0.8 MB" note
  when `original_size` is present. Source badge (`via Tech app` / `via Desktop`). Type `feature`
  renders as **"Improvement"** (UI-only; DB keeps `feature`). Purged rows show
  "attachments purged" (persists even after reopen — `attachments_purged_at` is never cleared).
  **Per-row draft notes** (`drafts[id]`) — kills the old shared-`noteText` cross-save bug; adds a
  standalone "Save note" action alongside the status buttons.
- **Manual purge (day-1 trigger).** Two-click inline confirm, per-item and a header
  "purge all eligible" sweep (eligible = terminal + has attachments + not yet purged). Uses the
  anon-key per-object storage DELETE pattern (mirrors `JobPage.jsx`) then
  `db.rpc('mark_feedback_attachments_purged', { p_id })`.
- **`purge-feedback-media` worker.** `GET /api/purge-feedback-media?days=90&dry_run=1` — no auth
  (cron convention; the `get_purgeable_feedback_media` `GREATEST(p_days,30)` clamp is the
  guardrail, live-verified: `days=0/1/90` all return 0 purgeable). Per purgeable row: bulk-delete
  `DELETE /storage/v1/object/job-files {prefixes:[…]}`, then mark **only** on success or
  not-found (a transport error leaves the row un-marked so it retries next run — never mark what
  wasn't cleaned). Orphan sweep deletes `feedback/`-prefix objects unreferenced by any
  `tech_feedback` row and older than 7 days (Finding 1). Always writes a `worker_runs` row.
  Returns `{ok, checked, purged, files_deleted, orphans, errors, dry_run}`. Injectable
  `runPurge(db, storageDelete, opts)` + `collectPaths`/`stripBucketPrefix` unit-tested (12 tests).
- **Owner-gated (disclosed):** auto-scheduling is an owner action — point the external cron that
  drives `process-scheduled` at `/api/purge-feedback-media`. The manual button works from merge,
  day 1.

## Tech Messages v2 — F-M + B1 + B2 SHIPPED (2026-07-09/10; flag OFF/owner-only)

Masterplan for the field-tech messaging rewrite: `/tech/conversations` (today the SHARED
desktop `Conversations.jsx` remounting inside TechLayout's keyed outlet) becomes a dedicated
**keep-alive tech-v2 pane** behind `page:tech_msgs_v2` — the TechScheduleV2 machine (pane
host, React-Query + idb cache-first paint, `tv2-*` css, i18n) applied to messaging. The
shared `Conversations.jsx` is never edited (3 mounts; keeps serving web + CRM). 6-agent live
audit + 6-agent adversarial challenge pass (all MODIFIED, none REFUTED).

- **Docs:** `docs/tech-messages-v2-roadmap.md` (plan of record: findings, gap audit,
  corrected architecture calls, data contracts, adjudicated forks, F-M/B1/B2 phase blocks,
  challenge report) · `docs/tech-messages-v2-dispatch.md` (cold-session blocks) ·
  `.claude/rules/tech-messages-v2-wave-ownership.md` (ownership; authorized amendments) ·
  tech-v2 manifest §8 + sms-experience manifest §10 + sms roadmap §6 pointer (cross-manifest
  transparency).
- **Foundation (F-M) SHIPPED** (branch `claude/tech-msgs-v2-foundation-8gawvm`; PR into `dev`;
  flag stays OFF/owner-only): flag row seeded FIRST via MCP (fail-open trap at
  AuthContext.jsx:294) + `EXPLICIT_FLAGS` entry `enabled:false` · migration
  `supabase/migrations/20260709_tech_msgs_v2_fm_conversation_rpcs.sql` (applied + verified live
  via MCP): `get_tech_conversations(p_limit,p_before,p_before_id,p_search,p_status,p_conversation_id)→jsonb`
  (composite `{conversations, unread_total, status_counts}`, legacy embed incl. `dnd`/`dnd_at`
  + computed `sort_key`, `email_reply_token` STRIPPED; server search/filters; `p_status='unread'`;
  fixed `COALESCE(last_message_at,created_at) DESC, id DESC` keyset cursor — no unreachable NULL
  tail; single-row deep-link mode) + `find_or_create_conversation(p_contact_id)→jsonb`
  (advisory-locked per contact — kills the split-thread hazard; same embed). BOTH SECURITY
  DEFINER, GRANT authenticated,service_role + REVOKE PUBLIC/anon · `src/lib/techQuery.js` kinds
  `convos()`/`thread()` (8th/9th) + `MUTATION_INVALIDATIONS.message=[convos,thread]` +
  `dehydrate.shouldDehydrateQuery` excluding the thread kind (raw SMS bodies never hit IndexedDB;
  the inbox list does) — registry re-frozen after F-M · `useTechConversations` hook (sole
  convos-cache reader/writer: RPC + 60s refetch + ONE ref-counted `subscribeToConversations`
  channel) · TechLayout third flag-gated pane (folded into `paneCovering`; App.jsx UNTOUCHED) +
  **Messages-tab unread badge** (flag-gated, never active-gated) · `TechMsgsPane` two-layer host
  (disclosed TechPane copy-in — list restore vs thread pinned; thread-open nav-hide class only
  while active, scoped `:has` rule) · stub `TechMessagesV2` (cover+fallback proof) · css
  `TECH-V2: MSGS` reserved marker (`tv2-msgs-*`) · `msgs` i18n namespace (en/pt/es parity-green).
  Tests: SQL gate `supabase/tests/tech_msgs_v2_f_conversation_rpcs.sql` (shape/cursor/idempotency,
  fixture IDs) + vitest anon least-privilege gate + `techQuery.test.js` + i18n parity — all green.
- **Key adjudications:** App.jsx untouched (paneCovering suppresses the outlet — verified) ·
  URL-driven thread open (`?c=` push / back) · optimistic overlay + setQueryData
  patch/append (never invalidate-per-event) · Enter=send · techs get one-tap DND **ON**
  only (OFF stays office/admin — TCPA asymmetry) · all-org scoping v1 (assigned_to is 100%
  unpopulated; per-employee param reserved) · realtime verified to survive F-red
  (authenticated JWT socket; genuine signed-in session required).
- **Phase B1 (core experience) SHIPPED** (branch `claude/tech-msgs-v2-b1-core-5gqbi3`; PR into
  `dev`; flag stays OFF/owner-only; ZERO schema). Fills the F-M stub — owned files only
  (`src/pages/tech/v2/TechMessagesV2.jsx` + `src/pages/tech/v2/messages/**` + css inside the
  `TECH-V2: MSGS` marker + the `msgs` locale files); every frozen file untouched.
  - **`useThread(convId,{active})`** (`messages/useThread.js`): `useInfiniteQuery` on
    `techKeys.thread` (newest-30, keyset `created_at<cursor`) + a pane-local **optimistic
    overlay** keyed by `_clientId`. Realtime (active-gated `subscribeToMessages`): UPDATE →
    `patchMessageInPages` (delivery ticks patch in place, never refetch); INSERT →
    `appendMessageToPages` + `reconcileOverlay` (dedupe by id → type+body). Send = copied
    `dispatchSend`/`retryMessage` + rewritten `handleSend` → **POST /api/send-message only**
    (worker sole writer; no `skip_compliance`); 201-with-failed-row preserved; the four 403
    codes (DND_ACTIVE/NO_CONSENT/CONTACT_NOT_FOUND/ALL_RECIPIENTS_BLOCKED) surfaced inline;
    mark-read on open (raw `db.update` — F-red safe) + inbound-while-open desync guard;
    suspend recovery through `useResumeRefetch` → silent newest-page merge that preserves loaded
    history and the visible-message anchor.
  - **`messages/msgsSelectors.js`** — pure page-flatten/cursor, overlay merge+reconcile,
    append/patch/mark-pending/drop-by-clientId, `groupMessagesByDay`, unread math,
    `mergeConvoIntoList` — covered by `msgsSelectors.test.js` (overlay reconcile, page-merge+
    cursor, day-divider, unread math, deep-link miss; 25 cases). `msgDateUtils.js` = localized
    list-time + day-divider labels (reuses `techDateUtils.currentLocaleTag` + `tech:date.*`).
  - **UI:** `ConvoList` (sticky fixed header; All/Unread + server-side search via the RPC's
    `p_status`/`p_search`, cached per filter; PTR below the fixed header; ≥68px rows, status-
    color accents, unread bold+badge, relative dates; cold-start skeleton only) · `ConvoRow` ·
    `ThreadView` (pane-owned pinned-to-bottom scroller via `threadScrollRef`; load-earlier with
    pre-paint scroll anchoring, NO setTimeout; jump-to-latest pill w/ new-count; `DateDivider`;
    `MessageBubble`/`SegmentCounter` imports in a flex-column body) · `Composer` (real
    `<textarea>` autosize capped 5 lines, Enter=send + Shift+Enter, `enterKeyHint="send"`, 16px
    font, 48px send, prefixLen-aware `SegmentCounter`, per-thread drafts via `messageUtils`,
    internal-note toggle + amber path, `[+]` actions-sheet SHELL (MMS/templates are B2), DND
    banner blocking send).
  - **Nav/keyboard:** URL-driven open (`setSearchParams({c})` push) / close (`navigate(-1)` →
    iOS swipe-back); `?c=` deep-link miss → single-row RPC fetch + `mergeConvoIntoList` into the
    convos cache. Keyboard = active-gated `visualViewport` handler writing a **pane-scoped**
    `--tv2-msgs-kb` on `.tv2-msgs-pane` (never documentElement) → consumed as `padding-bottom`
    on `.tv2-msgs-thread-layer`, shrinking the scroller so the sticky composer clears the keyboard.
  - **i18n:** `msgs` namespace EN complete + PT/ES through `t()` (locale-parity green).
- **Phase B2 (capability completion & polish) SHIPPED** (branch `claude/tech-msgs-v2-b2-polish-6yam75`;
  PR into `dev`; flag stays OFF/owner-only; ZERO schema). Owned files only (`TechMessagesV2.jsx` +
  `messages/**` + css inside the `TECH-V2: MSGS` marker + the `msgs` locales); every frozen file
  untouched; consent-path-auditor PASS (send stays worker-only, no `skip_compliance`).
  - **MMS:** `messages/mediaUpload.js` = the ONE media helper (compress via `@/lib/mediaCompress`
    → POST `job-files/conversations/{convId}/{ts}-{name}` → `publicMediaUrl()`; **the named
    db-foundation-P8 signed-URL swap target** — URL construction lives in one function).
    `messages/useComposerAttachments.js` runs the ≤5 tray (instant object-URL preview, per-tile
    upload state, revoke on remove/unmount). Composer sends `media_urls`; inbound render is the
    reused `MessageBubble` (`parseMediaUrls` + broken-image → file-link fallback). Body still
    required even for MMS (worker contract) — parity with legacy.
  - **Status pills:** `ConvoList` filter row is the full 5 (all/unread/needs_response/
    waiting_on_client/resolved), horizontal-scroll, counts from the RPC's `status_counts`;
    read-all is SERVER-count-driven (`useConvoMutations.markAllRead` → `db.update('conversations',
    'unread_count=gt.0', {unread_count:0})` + invalidate), shown only when `status_counts.unread>0`.
  - **Templates:** `messages/useTemplates.js` (lazy-once `message_templates is_active`, grouped by
    category via pure `groupTemplates` in msgsSelectors); Composer `[+]` → picker inserts the body
    **at the caret** (setSelectionRange), not append.
  - **Mark-unread:** `ConvoRow` restructured to a wrap `div` + main tap button + a 48px overflow
    "⋯" → inline 48px Mark read/Mark unread action (no hover/right-click). Routes through
    `useConvoMutations.setUnread` (optimistic `setConvoUnreadInData` cache patch keeping
    `unread_total` honest, then persist; invalidate on failure).
  - **DND fork:** `useConvoMutations.enableDnd` (ON only) writes `contacts.dnd/dnd_at` + a **verbatim
    `sms_consent_log` row** (`event_type:'dnd_on'`, `source:'manual'`, `performed_by=employee.id`,
    copied from Conversations.jsx:646-653) + optimistic cache patch. **No OFF control is rendered
    for techs** — a DND-on thread shows a read-only state (office/admin turn it off). Composer keeps
    the DND banner blocking a real text (note still allowed).
  - **Thread info header:** `ThreadView` title is now a button toggling an inline info panel —
    `tel:` phone, DND state/one-tap enable, and a **linked-job chip via `jobHref(conv.job_id)`**
    (`react-router` `Link`; never a hardcoded `/tech` path — H3-safe). Group/broadcast threads show
    a type badge + recipient count in the bar + info panel.
  - **Group/broadcast:** `isMultiConversation`/`recipientCount`/`summarizeSendResult` (pure, tested);
    `ConvoRow` shows a group icon + recipient pill; `useThread` surfaces a partial-block toast
    ("Sent to X of Y — Z not reached") from the worker's `twilio[]` array on a multi send.
  - **States + polish:** deep-link miss → keyed not-found panel (Back to messages, never a dead end);
    thread + list error states with Retry (`refetch`); dark-theme **pane-scoped** override of the
    internal-note bubble hexes (cannot leak — legacy never renders in `.tv2-msgs-thread`);
    `impact('light')` haptic on a genuinely-accepted send; 200ms thread slide-in (mount, reduced-
    motion guarded; close is instant Back/swipe); blur-on-scroll-up dismisses the keyboard; no
    autofocus on thread open. New css only inside the `TECH-V2: MSGS` marker (B2 block).
  - **Tests:** `msgsSelectors.test.js` extended to 33 cases (adds `setConvoUnreadInData` read/unread/
    badge-delta/clamp, `isMultiConversation`/`recipientCount`, `summarizeSendResult`, `groupTemplates`).
  - **STRETCH shed (honest, open in the roadmap):** new-conversation flow (needs a *server*
    contact-search RPC; the zero-schema all-contacts client load is exactly Finding-2's anti-pattern —
    deferred to a follow-up; `find_or_create_conversation` is live and ready) · scheduled sends (an
    office workflow + a second client-insert send path — kept out to keep the core composer pristine
    for the owner bake).
- **Dispatch:** F-M → B1 → B2 — strictly serial; **all three shipped.** Next = OWNER GATE: owner
  bakes on their phone (flag owner-only), ~0.5 post-bake fix session budgeted; cutover = owner flips
  `page:tech_msgs_v2` in DevTools → Flags. Coordination seams: Job Hub H3 (`src/i18n/index.js` only),
  db-foundation P8 (`messages/mediaUpload.js` `publicMediaUrl` is the swap target), sms deep-link
  follow-up (sms-owned).

## ⭐ Staff messaging LIVE in production (2026-07-25)

Production staff↔client SMS/MMS was activated by an owner-run Codex session with Cloudflare +
CallRail access. That session made **no repository commits**, so this is the record.

**Verified live evidence (read-only catalog check, 2026-07-25):** 4 outbound messages all
`status='sent'`, 3 inbound all `status='received'`, every row `provider='callrail'` with a
`provider_message_id`, **both `sms` and `mms` channels** exercised, zero `error_code`/`error_message`.
Bidirectional and both channels — a genuine end-to-end activation, not a config assertion.

`MESSAGING_SEND_MODE` is a Cloudflare Pages env var (dashboard-only, Production **and** Preview sets
+ redeploy). Rollback is `MESSAGING_SEND_MODE=disabled` + redeploy — sends short-circuit before any
provider call, with no database or code change.

**Guardrail correction (verified live, 2026-07-31):** the production org now has
`automation_settings.sms_sending_enabled=false`; the test org remains false, and the other named
automation toggles remain false. `missed_call_textback_enabled=true` remains configured for the
production org but is inert behind the master switch. This switch does **not** gate
staff P2P CallRail sends—`send-message.js` never reads it. It arms the separate automated SMS path,
which is still Twilio-only and does not consult `MESSAGING_SEND_MODE`. Redacted configuration checks
found no Twilio auth token, account SID, messaging-service SID or phone number in the managed
database path, and the 2026-07-31 Cloudflare check found no Twilio credential variable names, so
that path cannot currently make a provider call successfully. Since 2026-07-27 there are zero
Twilio provider message rows; aggregate consent telemetry shows 78 no-consent refusals and one send
failure. Before any Twilio credential is added, either turn the production automation SMS switch
off or deploy a reviewed explicit-provider gate. Neither action is part of ordinary CallRail
promotion. Consent counts were unchanged by the CallRail activation—nothing was bulk-recorded.

**Twilio transition inventory (do not collapse these surfaces):** (1) staff P2P uses the explicit
`MESSAGING_SEND_MODE` adapter and is CallRail today; (2) automated/scheduled/sequence SMS is
Twilio-only behind `sms_sending_enabled` and currently lacks an explicit provider-mode gate;
(3) Twilio inbound/status endpoints must remain fail-closed but must not be mode-gated, because a
future cutover still needs to process late signed provider events; and (4) `upr-mcp` exposes direct
Twilio write tools with separate MCP credentials and no app consent/conversation chokepoint. Before
Twilio credentials are added, close or explicitly quarantine the MCP write surface, add the
automation provider gate, fail local credential validation before fetch, and give e-sign SMS a
stable `client_request_id`. A positive full-handler CallRail direct-send test and post-signature-only
webhook telemetry are safe pre-cutover repository work. None of these prerequisites authorizes a
provider switch or changes current CallRail routing.

### ⚠️ Consent coverage is the live constraint — and inbound does NOT grant consent

Measured 2026-07-25: **199 contacts, 198 with a phone, but only 8 with `opt_in_status = true`**;
`service_sms_consents` = 1, `sms_consent_log` = 27.

**Correcting a claim made earlier the same day:** inbound messages do **not** establish consent.
There is no `opt_in_status` / `opt_in_at` / `opt_in_source` write anywhere in
`callrail-text-webhook.js`, `callrail-message-processor.js`, or `messaging-inbound.js` — verified by
grep and confirmed empirically (three inbound messages arrived and the opted-in count stayed at 8).
The only inbound consent writer is the affirmative **START/UNSTOP** path, which restores consent
after revocation rather than establishing it.

So **a brand-new person who texts UPR cannot be replied to** — the gate refuses `NO_CONSENT`
(`send-message.js` allows only `GLOBAL_OPT_IN`, or staff-only `SERVICE_CONSENT`). Coverage grows
**only** by per-contact admin/office prior-consent attestation, and **technicians cannot attest**
(`tech-messages-v2-wave-ownership.md` §8) — a blocked tech needs an admin/office colleague.

**Open owner/policy question:** should an inbound text from an unknown number permit a directly
responsive staff reply? Today it does not. Resolving it needs an explicit logged consent record with
source and evidence — not a relaxed gate.

### Missed-call textback — still OFF, one blocker closed

The owner wants it on. `no_consent` is now **deferrable** rather than terminal (below), which was the
prerequisite that stopped it silently burning leads. Still open before `sms_sending_enabled` may be
flipped: the `fireAutomation` duplicate-send window, and the owner's consent-policy decision.
Handoff detail: `docs/handoff/messaging-production-activation-prompt.md` §4a.

## Native Push and TestFlight activation (2026-07-29 current state)

The reviewed continuation on `codex/mobile-readiness-native-usability` was
reconciled by merge with `origin/dev` at
`8e1cf9cceba72f027caf91debded4afb6841b276` without rewriting either history.
It adds no migration or live-database change.

- Settings keeps PWA Web Push and native APNs controls separate. Native Push
  has explicit **Turn on** / **Turn off** controls, owner-bound versioned local
  intent, permission checks on load/resume, exact token cleanup journaling, and
  delivered-notification cleanup during detach.
- APNs banners use an exhaustive typed presentation catalog. This paragraph's
  original generic-only privacy budget was superseded by the owner's 2026-07-29
  decision: native may show the same event-approved variables as PWA. Typed
  server context is required; missing context and unknown types retain generic
  copy, and a server rollback setting can immediately restore generic native
  presentation.
  Data contains an allowlisted route and opaque employee binding; public
  signing bearer routes are reduced to `/`, and tap navigation fails closed
  when the current employee does not match.
- Each trusted occurrence fans out to both exact APNs cohorts: sandbox
  development installs and production TestFlight/App Store installs. Token
  queries, Apple hosts, fingerprints, delivery claims, pruning and the
  five-device bound remain environment-specific; Worker `APNS_ENV` is still a
  required fail-closed activation signal. A thrown cohort is reported as a
  sanitized retryable failure so the inbound-message outbox preserves its
  native-only retry instead of closing the occurrence as a harmless skip.
- Appointment Push resolves the appointment first and is structurally limited
  to currently assigned employees; supplied recipient IDs cannot widen it.
- The main-only iOS workflow pins the production API and release SHA, uses the
  lockfile Bundler, and performs the signed archive/export/App Store Connect
  upload only behind a separate owner-authorized publish dispatch. Dormant
  Capgo OTA publishing is hard-disabled and environment-pinned.
- One recovered physical PWA installation was confirmed with Push **On**. The
  existing development-signed iPhone build previously received one authorized
  sandbox Push while backgrounded.
- CallRail inbound notification projection and Web Push were live, but the
  outbox worker incorrectly read `provider_event_id` from a claim RPC that does
  not return that column. Native dispatch therefore stopped before token lookup
  with `missing_notification_event_id`. Source now uses the returned durable
  outbox `id` as the stable APNs occurrence and exposes privacy-safe aggregate
  native outcomes in protected worker-run telemetry. This is a worker-only fix;
  it adds no migration and does not change CallRail customer-message, consent,
  audience, bell, Web Push, or email behavior.
- Native notification destinations are type-owned. Messages open the exact
  field conversation, appointments the exact field appointment, signed
  documents the native Job Hub, and resolved feedback the field feedback page.
  Office-only admin events safely open native home until a separately approved
  native admin route exists. Field technicians can now configure
  `feedback.resolved` alongside their other self-recipient event types. The
  corresponding sender now repeats the Feedback Inbox's admin-only gate
  server-side with `requireRole(['admin'])` before any service-role read or
  channel dispatch.

Still gated: integration/push to `dev`, hosted PWA verification, reviewed
`dev → main` promotion, TestFlight workflow dispatch/upload, processed
TestFlight installation, production-token registration, and the real-device
foreground/background/terminated/tap/account-switch matrix. Full source,
verification, reviewer challenges, rollback, and release handoff:
`docs/handoff/native-ios-push-and-pwa-session-2026-07-28.md`.

### First TestFlight release shipped (2026-07-29 build night, Path B)

Most of the gates above closed on 2026-07-29 (MT evening). Build **1.0.0 (1)**
was archived locally from clean `main` HEAD
`29cc080aaea0df684cc2c4c7a9a53d8df2f53328` (zero tracked drift before and
after `cap sync ios`) with the workflow invariants baked in as build-time env
(production API origin, push flag exact `true`, `VITE_APNS_ENV=production`,
release SHA = that commit; `VITE_DEV_TEST_*` forced empty and verified empty
in the minified bundle). Signing was **manual, mirroring the CI Fastfile**
(existing local Apple Distribution certificate + "UPR App Store 2026" profile;
command-line overrides only, no project edits) rather than the runbook's
automatic-signing fallback, which assumed no local signing material.
`scripts/qa/verify-ios-release-artifact.mjs` **passed before upload**
(`aps-environment=production`, IPA SHA-256
`432de929decd75db5e7a48310635bf9abed57f4adde0763e4fb9dd07fb9b039a`), and the
owner uploaded via Organizer → TestFlight **Internal Only** at 19:26 MT.
Apple delivered with warning **ITMS-90683** (missing
`NSLocationAlwaysAndWhenInUseUsageDescription`) — non-blocking; the plist key
and a matching verifier guard are committed on `dev` for the next build.
The owner installed from TestFlight on a physical iPhone and the **real
assigned-appointment matrix passed on production**: foreground, background,
and terminated delivery, tap routing, and minimize/resume. Production-token
registration is proven by that delivery. Account-switch refusal remains the
one open matrix item. No workflow dispatch and no App Review submission
occurred; `ios-signing` secrets remain unpopulated (Path A follow-up).
Evidence detail: `docs/mobile/push-activation-owner-gate.md`. Field polish
findings now accumulate in `docs/mobile/field-polish-punchlist.md`.

### Xcode Cloud post-clone hook — ordering guard (2026-07-30)

`ci_scripts/ci_post_clone.sh` now runs `npm ci` **before** it validates the
required `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` workflow variables.
Previously a missing variable exited the hook first, so `node_modules` never
existed, and Xcode's Capacitor SPM resolution then failed with an unrelated
"cannot access `@capacitor/splash-screen`" — burying the real cause. Installing
first makes the readable variable error the only error. Cost of the swap: a
missing variable is now reported after `npm ci` rather than within seconds.

**This hook is Xcode-Cloud-only, and Xcode Cloud is NOT the canonical pipeline.**
`.github/workflows/ios-release.yml` is canonical (owner decision 2026-07-29); the
auto-attached "App | Default" workflow is to be **paused** in App Store Connect —
not deleted — because its builds bypass
`scripts/qa/verify-ios-release-artifact.mjs` entirely and PR-triggered builds
burn the free compute allowance. This change is therefore **dormant** unless
Apple-managed CI is deliberately revisited. The two Supabase variables remain
owner-controlled Xcode Cloud workflow configuration, and a real cloud build is
still required to prove the complete path. Guard:
`scripts/ios-release-workflow.test.js` → "Xcode Cloud post-clone hook".

**Push-enrollment gate added (2026-07-30):** the hook now also hard-fails unless
`VITE_NATIVE_PUSH_ENABLED` is exactly `true` and `VITE_APNS_ENV` is exactly
`sandbox` or `production` — the same fail-closed values
`src/lib/pushNotifications.js` (`isNativePushEnrollmentEnabled`) requires at
build time. Without them an Xcode Cloud build succeeded but shipped with push
enrollment silently disabled (no permission prompt, no token registration);
only `.github/workflows/ios-release.yml` enforced these, and Xcode Cloud
bypasses `scripts/qa/verify-ios-release-artifact.mjs`. The refusal message
names where to set them (App Store Connect → Xcode Cloud → workflow →
Environment variables). Unlike the GitHub workflow, which pins `production`
for TestFlight, the hook accepts `sandbox` because Xcode Cloud may build
dev/sandbox configurations. Both variables are owner-controlled Xcode Cloud
workflow configuration, like the Supabase pair. Guard: same test file,
"fails closed unless the push enrollment gates are baked into the bundle".

### Message-notification outbox host + APNs topic constraint (2026-07-30)

- `integration_config.message_notification_outbox_worker_url` now points at
  **`https://utahpros.app/api/process-message-notification-outbox`** (owner-authorized
  live-config change, 2026-07-30). It previously pointed at `dev.utahpros.app`, which made
  inbound-message native pushes the only dispatch running on Cloudflare **Preview** env
  vars — and a Preview `APNS_TOPIC` change for the UPR Dev app variant silently killed
  them fleet-wide (Apple 400 `DeviceTokenNotForTopic`). Full incident:
  `docs/archive/web-context-changelog-2026-07.md` § 2026-07-30 fleet-wide outage.
- **Standing constraint:** each deployment carries ONE env-level `APNS_TOPIC`, but it is now only
  the fallback for legacy/NULL-topic rows and stays `com.utahprosrestoration.upr` in BOTH
  environments. Never flip Preview to the dev bundle. Production-critical notifiers belong on
  `utahpros.app`; each enrolled token's live `apns_topic` selects its receiving bundle. The durable
  per-token topic fix is live from
  `20260730170000_device_token_apns_topic.sql` under ledger row `20260731154315`;
  legacy NULL-topic rows still use the production fallback until they re-enroll.
- **Diagnostics:** owner-only `POST /api/send-push` returns Apple's per-token `reason`
  verbatim — the only place it is visible; `worker_runs.meta.native` stores counters only.
  Counter fingerprint `attempted>0, sent=0, retryable=0, pruned=0` = non-retryable 4xx
  (`pruned` moves only on 410/`BadDeviceToken`). The DevTools Notifications tester wraps
  `/api/notification-test`, which flattens failures to `delivery_failed`.
- Verified end-to-end 2026-07-30 19:55 MT: real inbound text → `sent:4 / attempted:4` →
  banner on device.
- **Follow-up audit (applied 2026-07-31, ledger `20260731165215`):**
  `supabase/migrations/20260730214500_pg_net_worker_url_allowlists.sql` gives the last two
  unguarded config-driven pg_net callers — `notify_google_calendar_sync()` and
  `notify_emit()` — the same exact two-URL allowlist + fail-closed secret gate the four
  wake functions already have (body replacements, signatures unchanged, md5 drift guards,
  paired rollback). Both become service-role-only: `notify_google_calendar_sync()` has no
  browser caller and is reached only by owner-executed database triggers. CI contract test:
  `tests/qa/unit/pg-net-worker-url-allowlists.test.js`; apply-window check:
  `supabase/tests/pg_net_worker_url_allowlists_post_apply.sql`. The full key registry +
  the read-only "everything points at production" ops query:
  **`docs/database/integration-config-worker-urls.md`**. Separate live readback confirmed the exact
  replacement bodies and service-role-only ACL. The gap it deferred — the two
  `transcribe_call_worker_url` pg_cron command strings inlining their `net.http_post` with
  no allowlist — is closed by the follow-up below.
- **Cron-command allowlist follow-up (applied 2026-07-31, ledger `20260731174734`):**
  `supabase/migrations/20260731100000_transcribe_call_cron_allowlist.sql` moves the two
  transcribe-call safety-net cron commands (`upr_calls_backfill_safety_net`,
  `upr_calls_reclassify_safety_net`) into new zero-grant SECURITY DEFINER functions
  `wake_transcribe_call_backfill()` / `wake_transcribe_call_reclassify()` carrying the
  exact two-URL allowlist + fail-closed blank-secret gate (the wake_ops_health_worker
  pattern). Job names, schedules (`20 */6 * * *` / `40 */6 * * *`), payloads
  (`{"backfill":true,"days":3}` / `{"reclassify":true}`) and the 60s timeout are
  unchanged; pg_cron executes as the postgres job owner, so no role holds EXECUTE. CI
  contract test: `tests/qa/unit/transcribe-call-cron-allowlist.test.js`; apply-window
  check: `supabase/tests/transcribe_call_cron_allowlist_post_apply.sql`. Live readback confirmed
  exactly one active postgres-owned job per name, the expected schedules and wrapped commands,
  postgres-owned zero-grant functions, the production allowlisted URL, and a nonblank secret
  without exposing it. The rollback
  restores the exact 20260722 inlined commands (and reopens the SSRF surface — its
  header says so).

## Admin notification presentation Settings (2026-07-29)

The web build now owns an admin-only `/settings/notification-presentation` page in the Settings
Team group. It edits code-allowlisted bell/PWA/native copy and typed destinations, previews with
synthetic values, and shows bounded audit history. Native uses the same event-approved variables as
PWA by owner decision while retaining a separate field-only route allowlist.
Title and Message each have their own compact variable picker. A picker lists all trusted values
the current event actually provides, shows a synthetic example, and inserts the selected token at
that field's cursor or selection. It cannot create a variable or bypass server validation.
Appointment assigned/updated/canceled events resolve `customer_name` and `job_number` from the
appointment's linked job alongside appointment title/time and four unambiguous job-value snapshots:
estimated, approved, invoiced, and collected. Those values are available on bell, PWA, and native
templates. Payment surfaces include a distinct trusted `invoice_number` variable;
the separate `payment_reference` remains a charge/payment reference and is not relabeled as an
invoice. Native Title and Message expose the same picker for that event.
**payment.received enriched (2026-07-31, owner request):** `notifyPaymentReceived` now resolves
`customer_name` (contacts) and `job_number` (jobs) best-effort at notify time — all three producers
(QBO sync, card charge, Stripe webhook) pass `contact_id` — and the plain bell/email body reads
"$X from <client> · Job #N · Invoice <no> · via <source> (<reference>)". Both variables joined the
`payment.received` template allowlist and the default rich template; context always carries
render-safe fallbacks (`Customer` / `—`) because `renderTemplate` refuses blank variables. A lookup
failure degrades the copy, never the notification, never the payment path.
The page calls `/api/notification-presentation`; the browser never accesses the new storage/RPC.
Its Settings-kit styles are route-scoped in `NotificationPresentation.css`, keeping the global
`src/index.css` source below its blocking budget without changing the page design.

`functions/lib/notificationPresentation.js` remains the single registry shared with the reconciled
native parity work. Runtime consumers in `notify.js` and `apns.js` accept only a validated
event/surface override and otherwise use code defaults. No arbitrary URL/path, caller route
parameters, general template execution, audience/preference/consent/provider change, or office-only
native route expansion is possible. Arbitrary APNs alert/data remains ignored, and missing typed
context or over-budget rendered output falls back to immutable generic native copy. Final APNs
JSON is limited to Apple's 4 KB budget. Saved generic wording is honored exactly; runtime does not
guess legacy provenance from title/body content.

Migration `20260729163127_notification_presentation_settings.sql` adds forced-RLS, service-only
`notification_presentation_overrides`, `notification_presentation_audit`, and the sole atomic
service-role mutation RPC. It has passed migration/anonymous-grant/Worker security review plus
real `qa-staging` denial, replay, conflict, audit, and simultaneous first-write tests; synthetic
rows were removed. The same committed source is applied to the shared production project under
ledger version `20260729171946`: both tables retain forced RLS, only `service_role` can select or
execute the mutation RPC, and production contains zero overrides and zero audit rows.

Production runs reviewed PR `#547` at exact merge
`3f456810162dad8c4407d354b36085778d138ae2`; the live bundle embeds that SHA. The protected API
rejects an unauthenticated request with `401` JSON, the Settings route returns the SPA shell, its
route-specific JavaScript and CSS assets have correct content types, and the deployment smoke
fetched all 34 boot assets successfully. No live override/configuration was saved and no provider
or test notification was sent.

### Owner notification delivery tests

Dev Tools → Advanced → Notifications now pairs the presentation editor's synthetic all-event
preview with fixed owner-self delivery diagnostics. `POST /api/notification-test` requires
`requireOwner()`, derives the recipient from the authenticated employee, and accepts only an
allowlisted channel, a UUID, and an optional code-owned `type_key`. The generic four-channel test
creates one owner bell row, one Web Push fanout, one environment-matched iPhone delivery, and one
transactional email. The typed sweep accepts only the 15 presentation-registry event keys and only
bell, Web Push, and native APNs, producing 45 owner-only type/surface checks. Each Web Push check
fans out to all browser subscriptions enrolled for the owner, so provider delivery count can be
greater than 45. The sweep uses synthetic
server-rendered presentation data, creates no business occurrence, and structurally excludes
email, SMS, and MMS. It requires the catalog row to exist but deliberately ignores the
business-event `enabled` master switch so presentation/transport qualification remains distinct
from producer activation.

The UI fetches the protected catalog, requires exactly 15 entries, and runs three surfaces per type
without combining all provider work into one Worker request. A namespaced UUID derived from the
client request UUID, channel, and type isolates each typed claim/retry. APNs uses that stable
identity for its occurrence; typed Web Push adds a unique tag so separate event types do not
collapse into one displayed notification. The shared email helper optionally places the generic
email test UUID in Resend's HTTP `Idempotency-Key` header without adding it to the message payload.
The service-only `notification_delivery_diagnostic_claims` ledger claims the
employee/channel/request tuple before every side effect and replays the bounded result after a
lost response. Browser-expired subscriptions are pruned; provider errors return only bounded
diagnostic reasons. A 2026-07-31 read-only production ledger check verified the exact migration as
`20260729183731_notification_delivery_diagnostic_claims`. During the 2026-07-29 owner-authorized
typed sweep, the owner reported receiving all 15 event types in the tested PWA/native presentation
surfaces. This closes the synthetic transport/presentation proof for that installed state; it does
not prove that every real producer emits at the correct business moment. Source and fake-provider
tests alone still do not prove live presentation, and every future live send remains separately
owner-authorized.

**Producer/activation reconciliation (verified live, 2026-07-31):** source contains a producer for
all 15 catalog keys. Ten shared-production catalog rows remain enabled; the three `appointment.*`
and two `timesheet.change_*` keys are deliberately disabled by the containment described below.
Treat the older `docs/notify-roadmap.md` disabled-type matrix as release history, not current state.
Real production evidence exists for assigned appointments and inbound texts;
the owner sweep is not real-business evidence for the other types. Two authorization dependencies
remain explicit: `appointments` still exposes anon all-row writes and `appointment_crew` permits
all-row writes to any authenticated session, so the three `appointment.*` trigger paths inherit a
broader producer boundary than their recipient logic; the timesheet change RPCs still rely on
spoofable client-supplied actor identifiers. Do not cite `enabled=true` as security approval—repair
those producer boundaries before treating the affected types as fully qualified. The
`clock.abandoned` scan also writes its once-only `system_events` marker before `notify_emit`; while
the type is enabled today, disabling it during a scan would consume the occurrence without an alert.
Changing that ordering is a reviewed migration/rollback task, not a dashboard toggle.
Applied containment source
`20260731223000_notification_unsafe_producer_containment.sql` disables the three appointment and
two timesheet types without touching their producer tables or any messaging provider; its paired
rollback restores the same five keys. The migration refuses unless all five keys exist and are
enabled immediately before apply, so rollback is an exact restoration rather than a blind toggle.
It is live on `qa-staging` as `20260731225046` and production as `20260731225855`; readback confirms
all five exact keys remain disabled. The rollback was rehearsed on `qa-staging` and the forward
source then reapplied, so QA also ends contained. CallRail configuration and the working staff P2P
send/receive path were untouched. Re-enable only after caller-derived appointment/timesheet
authorization and negative tests pass.
