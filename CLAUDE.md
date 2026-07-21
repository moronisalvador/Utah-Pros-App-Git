# UPR Platform — Claude Code Project Context
**Last updated:** July 2, 2026 · **Project:** Utah Pros Restoration — Internal Business Management Platform
**Developer:** Moroni Salvador · **Repo:** moronisalvador/Utah-Pros-App-Git

## ⚠️ NON-NEGOTIABLE RULES

1. **Read files from disk before editing.** Never assume file contents from memory.
2. **No `alert()`/`confirm()`** (eslint-enforced, error-level). Feedback goes through **`src/lib/toast.js`** (`toast`/`ok`/`err`) — the ONLY toast entry point; never dispatch `upr:toast` raw or copy a local `errToast` (eslint-`warn`, ratcheting to error). Destructive actions use inline two-click confirm, never a modal. Patterns: `UPR-Design-System.md`; states law: [`.claude/rules/loading-error-states.md`](.claude/rules/loading-error-states.md).
3. **`const { db } = useAuth()`** in components — never import `db` directly from `@/lib/supabase` (that also exports an unauthenticated singleton for bootstrapping only).
4. **Routine work commits directly to `dev`; never push `main` directly.** Default flow: verify locally (build+test) → commit straight to `dev` → it auto-deploys to dev.utahpros.app. **No feature branch, no PR for routine changes** — that step was retired 2026-07-02 (owner decision: it exploded GitHub API usage and added a manual merge click for no benefit on a solo-owned repo). Production still goes via a reviewed **`dev → main` PR** — that's the one place a PR earns its keep (CI build+test gate before prod). **Exception:** the CRM parallel wave keeps feature-branch → PR-into-`dev` (see [CRM Phase Workflow](#crm-phase-workflow)) — concurrent sessions genuinely need the isolation + reviewer gauntlet. See [Deployment](#deployment--release-workflow).
5. **Mobile CSS: `@media (max-width: 768px)` only.** Never touch desktop layout/colors/spacing unintentionally. `dvh` and `env(safe-area-inset-bottom)` are safe globally.
6. **Commit after every 2–3 files.** Small commits, clear messages.
7. **New tables/columns → write a migration in `supabase/migrations/` first** (66+ tracked, real schema-as-code), apply via Supabase MCP `apply_migration`, then query via `db.rpc()` (PostgREST schema cache lags on new tables; `SECURITY DEFINER` RPCs don't). **Check real column names** via `information_schema.columns` first — tables routinely have 20-60+ columns, never assume from a short doc list. **Grant/policy posture is least-privilege by default** — `GRANT EXECUTE TO authenticated, service_role` + policies scoped `TO authenticated`; `anon` only via the named public allowlist. Full standard: [`.claude/rules/database-standard.md`](.claude/rules/database-standard.md) (supersedes the pre-2026-07-08 blanket-`anon` template).
8. **Don't break existing pages.** Every page is live and in use. Read the file first if unsure.
9. **Update `UPR-Web-Context.md`** after any session touching tables/RPCs/components/pages/workers, `*-TASK.md` or not. It's the source of truth this file deliberately does not duplicate (hand-copied schema lists are exactly how this file went stale before).
10. **`viewport-fit=cover` required in `index.html`** — without it, `env(safe-area-inset-bottom)` evaluates to `0px` everywhere. Never remove.
11. **`.tech-nav` bottom padding:** `padding-bottom: max(12px, env(safe-area-inset-bottom, 12px))`.
12. **New/substantially-edited files get a Documentation Standard header.** Template: `.claude/rules/documentation-standard.md`. Guideline, not hook-enforced.

## How we work

1. **Understand before acting.** Read the real file (Rule 1); reuse existing patterns ([Patterns](#patterns-to-follow)) over inventing.
2. **Verify before shipping.** Run `npm run lint`, `npm run build`, `npm test` (vitest). CI runs **build+test on PRs to `main` AND `dev`** (staging no longer ships unchecked); lint is non-blocking (pre-existing baseline) but don't add new ones — the changed-files ratchet surfaces them. Any change touching `src/pages`|`src/components` runs the **3-agent gauntlet** (`upr-pattern-checker` + `design-consistency-checker` + `page-behavior-checker`) and the [close-out standard](.claude/rules/close-out-standard.md) — including the **minimize/resume test** and a 390px mobile check. Behavior law: [`page-lifecycle.md`](.claude/rules/page-lifecycle.md); perf budget: [`perf-budget.md`](.claude/rules/perf-budget.md). Report the real result — never claim "done" unverified.
3. **Ship the sanctioned way (Rule 4).** Routine work: commit direct to `dev`, it auto-deploys to staging — no branch, no PR. Production: reviewed `dev → main` PR → merge commit (not squash) → fast-forward `dev`. CRM wave: feature branch → PR into `dev`. Wait for the Cloudflare Pages check on any prod release.
4. **Report honestly.** State outcomes and discrepancies out loud. Ask when a request is genuinely ambiguous.
5. **Keep context lean.** Delegate broad searches to subagents — file/pattern/caller *finding* goes to the cheap read-only **`upr-scout`** agent (Haiku); judgment work (review, money, consent, migrations, architecture) stays on the sonnet/opus checkers and reviewers. Right doc for the job: `BILLING-CONTEXT.md` (QBO/invoicing), `UPR-Web-Context.md` (schema/RPCs/iOS), `UPR-Design-System.md` (CSS/components). `/clear` between unrelated tasks; `/btw` for side questions that shouldn't enter history.

## Compact instructions

When compacting, always preserve: the current objective + acceptance criteria; owner decisions (and rejected alternatives); the current branch and the exact list of modified files; **which migrations were already applied to the shared Supabase** (forgetting or re-applying one hits production); tests/builds run and their REAL results; unresolved reviewer-agent findings; and the next action. Discard: raw passing-test output, repeated doc excerpts, abandoned searches, superseded approaches, and large code excerpts that remain on disk.

## Stack

React 19 + Vite 8, all JSX, no TypeScript · React Router **v7** · Supabase Postgres + PostgREST — **no Supabase JS SDK for data** (`supabase-js` used only in `src/lib/realtime.js`) · Cloudflare Pages Functions (`functions/api/*.js`, no `wrangler.toml` — dashboard-configured; local: `wrangler pages dev dist`) · CSS custom properties only, no Tailwind/CSS-modules · Capacitor 8 iOS app (`ios/`, see `UPR-Web-Context.md`) · Also: `pdf-lib` (PDF gen), `idb` (tech offline storage), `react-grid-layout` (dashboard widgets), `@googlemaps/js-api-loader` (address autocomplete, optional — falls back to plain text without `VITE_GOOGLE_MAPS_API_KEY`).

**Env vars:** see `.env.example` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_GOOGLE_MAPS_API_KEY`). Supabase project ref: `glsmljpabrwonfiltiqm`.

## DB Client API

```js
const { db } = useAuth();
await db.select(table, queryString)   // GET — throws on any non-OK response (400/404/500); does NOT return [] on 404 — always try/catch
await db.insert(table, data)          // POST — returns inserted row(s)
await db.update(table, filter, data)  // PATCH — null on 204, else updated row(s)
await db.delete(table, filter)        // DELETE — null on 204
await db.rpc(fn, params)              // POST /rpc/{fn} — null on 204; default for anything complex or tables added after initial deploy
```

**PostgREST/RLS (least-privilege default — supersedes the pre-2026-07-08 `anon, authenticated` + `USING (true)` template):** new tables need a `SECURITY DEFINER` RPC + `GRANT EXECUTE TO authenticated, service_role` (**not `anon`**), plus `ENABLE ROW LEVEL SECURITY` + an explicit policy scoped to the authenticated role — floor is `FOR ALL TO authenticated USING (true) WITH CHECK (true)`; tighten to an ownership/org predicate wherever the data is per-user or per-org (`USING (true)` is the floor, not the goal). **`anon` enters a GRANT or a policy ONLY for a deliberately-public endpoint**, via the named allowlist in [`.claude/rules/database-standard.md`](.claude/rules/database-standard.md) §2 (login bootstrap, `/status`, public form submit, public e-sign pages, public job-file reads) — no new `anon` grant ships without an allowlist entry + a `-- public: <reason>` comment. Logged-in users already carry a real Supabase Auth JWT (`role=authenticated` — Rule 3), so authenticated-scoped policies do **not** break the app; the old blanket-`anon` template exposed every `USING(true)` table to unauthenticated reads. Unprotected (RLS-off) tables are invisible to PostgREST either way. After adding a table: `bust_postgrest_cache()` RPC or redeploy.

## AuthContext — What's Exposed

```js
const {
  user, employee, permissions,
  employeePageAccess,  // per-employee page-access override map, backs canAccess()
  featureFlags,         // { 'page:marketing': { key, enabled, dev_only_user_id, ... } }
  loading, error,
  db,                   // authenticated client — USE THIS (Rule 3)
  login, logout, devLogin,  // devLogin = DEV builds only
  canAccess, isFeatureEnabled, isAuthenticated, isDev,
} = useAuth();
```

## Local Dev & UI Verification

A local `.env.local` (gitignored — Vite auto-loads it) with `VITE_SUPABASE_URL` + the **anon** key (safe — it's already shipped in every browser bundle) unlocks real local dev + UI verification: `preview_start({name: "Vite Dev Server"})` (config in `.claude/launch.json`) → Login screen's **"Dev Mode: Select Employee"** button → click any employee, no password, ever. Good for screenshots, click-throughs, layout/navigation/component work. If `.env.local` doesn't exist yet, get the URL + anon key via the Supabase MCP (`get_project_url` / `get_publishable_keys`) rather than asking the user to paste secrets in chat — but never create the file directly (`.claude/hooks/block-secrets.sh` blocks any `Write`/`Edit` to `.env*` by filename, on purpose); hand the two lines to a human to paste in.

**Limitation (expected, not a bug — don't waste time re-diagnosing it):** Dev Mode authenticates the *employee* row but the client still runs as Supabase's `anon` role, not a real JWT. Any RPC scoped `TO authenticated` (most of them, per `database-standard.md` §1) returns `42501 permission denied for function ...`, so dashboard/list data shows "Couldn't load" even though the UI itself is fine.

**`functions/api/*.js` workers don't run on `localhost:5173` at all.** Vite Dev Server only serves the frontend; `/api/*` calls proxy to `localhost:8788` (`vite.config.js`), which is nothing unless the separate **"Cloudflare Pages Functions"** launch config (`wrangler pages dev dist`, needs a fresh `npm run build` first) is also running — otherwise a worker call just silently network-errors, easy to mistake for the feature being broken. And even with both running locally, any worker needing the Supabase **service-role** key (most write-side workers) still can't complete end-to-end — that key is Cloudflare-only by design, never in a local file. For verifying anything that hits a `functions/api/*` worker, use the real deployed site (`dev.utahpros.app` / `utahpros.app`), not localhost.

**Three ways to get UI access locally — pick whichever fits what you're actually verifying, none of these is "the" way:**
- **Anon-role Dev Mode** (employee picker, above) — any employee, instant, no data.
- **Real-data Dev Mode** — Login screen's **"Dev Mode: Real Data (test admin)"** button (`src/pages/Login.jsx`), shown only when `VITE_DEV_TEST_EMAIL`/`VITE_DEV_TEST_PASSWORD` are set in `.env.local`. Runs a real `signInWithPassword()` against a dedicated `[Local Dev Test Account]` employee (`admin` role, `is_external: true`, its own Supabase Auth user — never a real employee's credentials), so it's a genuine `authenticated` session with real RLS-scoped data.
- **Human-authenticated tab** — a human logs into `dev.utahpros.app` themselves in the Browser pane, then hand off that already-authenticated tab — the only option that reflects a specific real employee's actual account/permissions rather than the test account's.

Use judgment on which one answers the question at hand (pure UI/layout vs. real data vs. a specific employee's actual view) — this list is scope, not a decision tree to follow in order. Whichever is used, never enter credentials directly yourself, even ones handed over in chat, even for the throwaway test account — if `.env.local` needs updating, hand the lines to a human to paste in.

## File Structure (key files)

Not exhaustive — `src/pages/` has 41 files, `src/pages/tech/` has 22. `Glob src/pages/**/*.jsx` before assuming a page doesn't exist.

```
src/App.jsx        route wrappers: AdminRoute, FeatureRoute, DevRoute, AccessRoute
src/index.css      ALL styles — tokens/patterns documented in UPR-Design-System.md
src/contexts/AuthContext.jsx
src/lib/supabase.js  REST client (Rule 3)     src/lib/realtime.js  auth + realtime
src/pages/           Admin*, Settings, DevTools (9 tabs), Help/Legal/Login/SetPassword/SignPage,
                     ClaimsList/ClaimPage/ClaimCollectionPage, Jobs/JobPage/Production,
                     Schedule/ScheduleTemplates, Customers/CustomerPage/Leads/Marketing/Conversations,
                     Estimates/EstimateEditor/InvoiceEditor/Collections/PaymentSettings/TimeTracking/
                     OOPPricing (billing/QBO, see BILLING-CONTEXT.md),
                     HomebuildingAnalysis/NewBuildSimulator (Moroni-only), EncircleImport
src/pages/tech/      TechDash/TechSchedule/TechTasks/TechClaims/TechAppointment (UX rules:
                     .claude/rules/tech-mobile-ux.md), TechNew*/TechEdit* (create/edit sheets),
                     TechJob*/TechClaim*/TechRoomDetail (detail+album+docs), TechDemoSheet/
                     TechOOPPricing (field tools), TechMore/TechHelp/TechFeedback
src/components/      Layout (app shell), TechLayout (tech shell), Sidebar, ErrorBoundary,
                     collections/ tech/ overview/ (feature-scoped subfolders)
functions/api/       Cloudflare Pages Functions (workers) — see below
functions/lib/       supabase.js (worker-side client), cors.js, email.js
supabase/migrations/ tracked SQL migrations — schema-as-code (Rule 7). Count drifts; derive it: `ls supabase/migrations/*.sql | wc -l` (163 as of 2026-07; live DB has more — some pre-2026 migrations are untracked)
.claude/rules/       tech-mobile-ux.md, documentation-standard.md, scope-sheet-rollback.md,
                     database-standard.md, and the UX-Quality laws: page-lifecycle.md,
                     loading-error-states.md, perf-budget.md, workers-standard.md,
                     close-out-standard.md, motion-standard.md. Wave-ownership manifests live here while their
                     initiative is active; when its LAST phase merges, `git mv` the manifest to
                     `docs/archive/rules/` with a one-line tombstone (keeps the active set honest).
.claude/commands/    custom slash commands (e.g. /invoice)
```

## Workers (Cloudflare Pages Functions)

Each worker exports `onRequest`. Client: `import { createClient } from '../lib/supabase.js'`. CORS: `import { jsonResponse } from '../lib/cors.js'`. Standard: [`.claude/rules/workers-standard.md`](.claude/rules/workers-standard.md) (auth-via-lib, outbound timeouts, idempotency, `worker_runs`). Count drifts — derive: `ls functions/api/*.js | wc -l` (~95 as of 2026-07). **Representative set:**
- **SMS:** `send-message`, `twilio-webhook`, `twilio-status`, `process-scheduled` (cron)
- **Encircle:** `sync-encircle`, `sync-claim-to-encircle`, `encircle-import/search/upload/rooms/backfill`
- **E-sign:** `send-esign`, `submit-esign`, `resend-esign`, `track-open`
- **QuickBooks** (`BILLING-CONTEXT.md`): `quickbooks-connect/callback`, `qbo-query/invoice/estimate/payment/charge/sync-customer/webhook/payments-sync`
- **Stripe:** `stripe-pay-link/webhook/accounts/payout`
- **Google:** `google-drive-connect/callback/token/disconnect/import` (`GOOGLE-INTEGRATIONS-HANDOFF.md`), `google-calendar-sync/resync`
- **Homebuilding AI:** `homebuilding-chat/estimate/plan-tune/build-plan-pdf`
- **Docs/reports:** `demo-sheet-pdf`, `send-demo-sheet`, `generate-water-loss-report`, `analyze-xactimate`
- **Admin/misc:** `admin-users`, `billing-2fa`, `send-push`, `collections-chat`

All transactional email → **Resend** via `functions/lib/email.js` (`EMAIL-DELIVERABILITY.md`). Invoice emails come from QuickBooks; auth emails from Supabase.

## Patterns to Follow

Visual/component patterns (buttons, badges, cards, layouts, two-click delete) live in `UPR-Design-System.md` — use those, don't recreate. Two logic patterns worth inlining:

```jsx
const [loading, setLoading] = useState(true);
if (loading) return <TabLoading />;  // shared: import from '@/components/TabLoading' (DevTools keeps a local copy)

const load = useCallback(async () => {
  setLoading(true);
  try {
    const rows = await db.rpc('some_rpc', { p_param: value });
    setData(rows || []);
  } catch (e) { err('Failed to load data'); }
  finally { setLoading(false); }
}, [db]);
useEffect(() => { load(); }, [load]);
```

## Specialist skills & precedence

Installed skills auto-load by description when a task matches; you rarely invoke them by hand (name one explicitly — `/impeccable audit …` — only when you need to force it). **Jurisdiction (one authority per concern):**
- **Design/UX:** `impeccable` decides *where* design & motion belong (`/impeccable audit|critique|polish|animate`); the **Emil pack** (`emil-design-eng`, `apple-design`, `improve-animations`, `review-animations`, `animation-vocabulary`) decides *how motion feels* + reviews it.
- **React:** `vercel-react-best-practices`, `vercel-composition-patterns` — framework-neutral (we're Vite; **reject Next.js-only advice**).
- **Data/SQL:** `supabase`, `supabase-postgres-best-practices` — patterns only, **subordinate to `.claude/rules/database-standard.md`** (least-privilege, anon-allowlist, one shared prod DB).
- **Tests:** `playwright-core`. **UPR-native workflows** (`new-feature`, `db-migration`, `new-crm-module`, `masterplan`) orchestrate the actual work and outrank vendor skills.
- **Content & marketing / SEO — website surface, NOT the internal app:** SEO via the **claude-seo** suite (`seo` orchestrator + `seo-*` specialists + `seo-*` subagents); content/marketing via `product-marketing`, `copywriting`, `cro`, `content-strategy`, `email-sequence`, `campaign-plan`, `competitive-brief`, `performance-report`, `brand-review`. These serve the **public marketing site & content** and auto-fire only on SEO/content tasks, never internal-app dev. `impeccable` still owns *product-UI* design; these own *SEO, copy & brand voice* — a separate lane. **Design authority stays with `impeccable` + the Emil pack — do NOT add a second broad UI/UX design skill: it fragments the design lane and tends to inject wrong-stack advice (Tailwind/shadcn — we are CSS custom properties, no Tailwind).**

**Precedence when guidance conflicts:** (1) CLAUDE.md non-negotiables + `.claude/rules/` standards are **law** — always win; (2) UPR-native skills drive the flow; (3) vendor skills advise within their lane only. A vendor skill **never** overrides a standard: no `framer-motion`/`gsap` (`perf-budget.md` — motion is CSS tokens + View Transitions, see `motion-standard.md §8`), no Next.js APIs, no loosening `database-standard.md`. The **impeccable PostToolUse hook** is the one *deterministic* layer — it runs on every UI edit; fix its findings or consciously waive them (never silence a real one).

## What NOT to Touch

`src/lib/supabase.js`, `src/lib/realtime.js` — stable. `src/contexts/AuthContext.jsx`, `src/components/Layout.jsx` — only if a feature needs it. `src/App.jsx` — only add routes. Any existing page — don't touch unless instructed. `main` — never push directly (Rule 4).

## Deployment & Release Workflow

**Branches:** routine work commits **directly to `dev`** (staging, dev.utahpros.app, auto-deploys on push, independent — not force-synced from `main`); production is a reviewed **PR `dev → main`** (utahpros.app; Capacitor iOS also loads `/tech/*` from this build). Feature branches + PRs-into-`dev` are reserved for the CRM parallel wave (concurrent sessions). **Retired 2026-07-02:** per-change feature-branch+PR for routine work — it burned GitHub API quota (mostly the PR-activity *watch/babysit* polling + the per-PR Cloudflare/claude[bot] bots, not the merge itself) and added a manual click. Sessions should **not** subscribe to / babysit PRs unless explicitly asked, and should **not** open a PR for routine `dev` work.

**Env vars:** Cloudflare keeps separate Production (`main`) / Preview (`dev`+branches) sets — new secrets need both + a redeploy.

**One shared Supabase across `dev`/`main` (critical):** migrations/data changes hit both immediately — sequence so consuming code deploys first. Runbook: `.claude/rules/scope-sheet-rollback.md`.

## Task File Protocol

A `*-TASK.md` in repo root = an active one-shot build task: read first, follow its build order, then on completion update `UPR-Web-Context.md` and `git rm` it. Does **not** apply to running punch lists that happen to match the naming (e.g. an ongoing reconciliation to-do) — those stay and update in place, never auto-deleted.

## CRM Phase Workflow

The new CRM side ships in phases, each its own branch/PR. **Per-phase specifics (exact branch, prerequisite, close-out checklist, acceptance criteria) live in `docs/crm-roadmap.md`** — a session builds one phase, reading that phase's block + this section, not the whole doc.

**Roadmap v3 (2026-07-02) — foundation-then-parallel-wave model** (full spec: `docs/crm-roadmap.md` → "Roadmap v3" section). **Phase F (Foundation) owns 100% of the wave's SCHEMA** — every table/column/policy, the only shared-RPC REPLACEs, ~31 signature-frozen RPC stubs, shared helpers/slot components, all route/nav/icon/css wiring, and the file-ownership manifest `.claude/rules/crm-wave-ownership.md` (committed BY Phase F). After F merges, the remaining phases (4d, 6a, 6b, 7, 8, 9, 10 — plus 4b on carrier approval) run as **one parallel wave**:
- A wave session ships **zero schema migrations**; it may ship **function-body-only** `CREATE OR REPLACE` migrations for its OWN frozen stubs — **signature changes are forbidden** (`migration-safety-checker` enforces).
- A wave session edits ONLY the files the ownership manifest assigns it; the manifest's frozen list (App.jsx, automated-send.js, send-message.js, …) is edited by nobody in-wave; index.css writes stay inside the session's reserved section marker.
- **Backward-compatible-REPLACE rule:** any `CREATE OR REPLACE` of a live RPC keeps the existing signature callable (new params take `DEFAULT`) with a committed test that the shipped caller still succeeds — one shared Supabase means a replace is live in production the moment it applies.
- The sequential rule below is **superseded by the v3 dependency graph** for the wave phases; it still governs any pair the graph marks serial.
- **Branch per phase:** cut from `dev` (not `main`), then PR into `dev`. **Use the session's assigned branch as-is** — Claude Code web sessions are handed a harness-assigned `claude/…` branch and should not fight it. A `crm/phase-N-short-desc` name is nice but **not required**: the branch name is cosmetic (isolation is the `page:crm` flag, not the branch), so the `crm/…` names and `crm-phase-N-*.pages.dev` preview URLs in `docs/crm-roadmap.md` are illustrative — use whatever branch/preview the session actually has.
- **Phase ordering follows the roadmap's dependency graph** (v3 section). Pre-v3 history: "never start phase N+1 until phase N merged" — retained only for pairs the graph marks serial (e.g. anything vs its own foundation).
- **Migrations in a CRM phase are additive-only:** new tables/columns only, each RLS-enabled at creation (Rule 7). **No `ALTER`/`DROP`/rename of a live table inside a phase** — destructive changes to shared data need their own separate reviewed change. Apply + verify on `dev` before the `dev → main` PR (one shared Supabase — see Deployment).
- **Isolation is the `page:crm` flag + `dev_only_user_id`** (not a branch) — `/crm/*` stays invisible to other employees on `dev` and `main` until the flag opens.
- **End of phase:** commit → set that phase's status to `'shipped'` in `crm_build_phases` → update `UPR-Web-Context.md` (Rule 9) — all before opening the PR. **Open the `dev` PR as a handoff and stop** — mark it ready to merge (not left as a draft); the owner/orchestrator merges it. Wave sessions do **not** click-merge, subscribe to, babysit, or wait for a review on their PR (per Rule 4 — the PR is only how a finished branch lands; branches exist so the parallel sessions don't collide).
- **Reconcile the checkboxes before the PR — both directions.** The `/crm/roadmap` (and public `/status`) page reads `crm_build_stages`; a session must leave that state honest, not drift. Every stage you flip to `done` must reflect real, verified work (no marking-done-to-look-finished), and every stage that genuinely landed must actually be flipped (no leaving finished work as `todo` — that under-reports progress and reads as "skipped"). A stage that's genuinely blocked on the owner (a live account, a real test call, a credential) stays open, but the phase's PR/`UPR-Web-Context.md` must say *why* — so an owner-gated box is never mistaken for a forgotten one. (There is no `blocked` status value yet — planned enhancement; until then, disclose in prose.) The `crm-phase-reviewer` audits this as part of its sign-off.

ℹ️ `crm_build_phases` / `crm_build_stages` now exist (Phase 0 shipped — `phase_key, title, status, shipped_at, sort_order` + per-phase sub-steps), backing the read-only `/crm/roadmap` progress page and the public `/status` mirror. Status is set via `set_crm_phase_status` / `set_crm_stage_status`; progress rolls up via `get_crm_build_progress()`.

---
*Full DB schema/RPCs/iOS build → `UPR-Web-Context.md` (not duplicated here — verify columns live via MCP schema tools or `information_schema.columns`, not memory). UI/design tokens → `UPR-Design-System.md`. Billing/QBO/Xactimate → `BILLING-CONTEXT.md`. Encircle API → `ENCIRCLE_API_REFERENCE.md`. Email deliverability → `EMAIL-DELIVERABILITY.md`. QBO sync internals → `UPR-QBO-SYNC-PROTOCOL.md`.*
