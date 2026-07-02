# UPR Platform — Claude Code Project Context
**Last updated:** July 1, 2026 · **Project:** Utah Pros Restoration — Internal Business Management Platform
**Developer:** Moroni Salvador · **Repo:** moronisalvador/Utah-Pros-App-Git

## ⚠️ NON-NEGOTIABLE RULES

1. **Read files from disk before editing.** Never assume file contents from memory.
2. **No `alert()`/`confirm()`.** Feedback via `window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type } }))`. Destructive actions use inline two-click confirm, never a modal. Pattern: `UPR-Design-System.md`.
3. **`const { db } = useAuth()`** in components — never import `db` directly from `@/lib/supabase` (that also exports an unauthenticated singleton for bootstrapping only).
4. **Ship via PR, never push `main` directly.** Feature branch → `dev` (staging) → reviewed `dev → main` PR → merge. See [Deployment](#deployment--release-workflow).
5. **Mobile CSS: `@media (max-width: 768px)` only.** Never touch desktop layout/colors/spacing unintentionally. `dvh` and `env(safe-area-inset-bottom)` are safe globally.
6. **Commit after every 2–3 files.** Small commits, clear messages.
7. **New tables/columns → write a migration in `supabase/migrations/` first** (66+ tracked, real schema-as-code), apply via Supabase MCP `apply_migration`, then query via `db.rpc()` (PostgREST schema cache lags on new tables; `SECURITY DEFINER` RPCs don't). **Check real column names** via `information_schema.columns` first — tables routinely have 20-60+ columns, never assume from a short doc list.
8. **Don't break existing pages.** Every page is live and in use. Read the file first if unsure.
9. **Update `UPR-Web-Context.md`** after any session touching tables/RPCs/components/pages/workers, `*-TASK.md` or not. It's the source of truth this file deliberately does not duplicate (hand-copied schema lists are exactly how this file went stale before).
10. **`viewport-fit=cover` required in `index.html`** — without it, `env(safe-area-inset-bottom)` evaluates to `0px` everywhere. Never remove.
11. **`.tech-nav` bottom padding:** `padding-bottom: max(12px, env(safe-area-inset-bottom, 12px))`.
12. **New/substantially-edited files get a Documentation Standard header.** Template: `.claude/rules/documentation-standard.md`. Guideline, not hook-enforced.

## How we work

1. **Understand before acting.** Read the real file (Rule 1); reuse existing patterns ([Patterns](#patterns-to-follow)) over inventing.
2. **Verify before shipping.** Run `npm run lint`, `npm run build`, `npm test` (vitest). CI blocks PRs to `main` on **build+test**; lint is non-blocking there (175 pre-existing errors) but don't add new ones. Report the real result — never claim "done" unverified.
3. **Ship the sanctioned way.** Feature branch → `dev` → `dev → main` PR → merge commit (not squash) → fast-forward `dev`. Wait for the Cloudflare Pages check.
4. **Report honestly.** State outcomes and discrepancies out loud. Ask when a request is genuinely ambiguous.
5. **Keep context lean.** Delegate broad searches to subagents. Right doc for the job: `BILLING-CONTEXT.md` (QBO/invoicing), `UPR-Web-Context.md` (schema/RPCs/iOS), `UPR-Design-System.md` (CSS/components).

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

**PostgREST/RLS:** new tables need `SECURITY DEFINER` RPC + `GRANT EXECUTE TO anon, authenticated`, plus `ENABLE ROW LEVEL SECURITY` + explicit policy (e.g. `FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)`) — unprotected tables are invisible to PostgREST either way. After adding a table: `bust_postgrest_cache()` RPC or redeploy.

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
supabase/migrations/ 66+ tracked SQL migrations — schema-as-code (Rule 7)
.claude/rules/       tech-mobile-ux.md, documentation-standard.md, scope-sheet-rollback.md
.claude/commands/    custom slash commands (e.g. /invoice)
```

## Workers (Cloudflare Pages Functions)

Each worker exports `onRequest`. Client: `import { createClient } from '../lib/supabase.js'`. CORS: `import { jsonResponse } from '../lib/cors.js'`. **58 files:**
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
if (loading) return <TabLoading />;  // defined in DevTools.jsx

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

## What NOT to Touch

`src/lib/supabase.js`, `src/lib/realtime.js` — stable. `src/contexts/AuthContext.jsx`, `src/components/Layout.jsx` — only if a feature needs it. `src/App.jsx` — only add routes. Any existing page — don't touch unless instructed. `main` — never push directly (Rule 4).

## Deployment & Release Workflow

**Branches:** feature branch (Cloudflare preview) → `dev` (staging, dev.utahpros.app, auto-deploys on push, independent — not force-synced from `main`) → PR to `main` (production, utahpros.app; Capacitor iOS also loads `/tech/*` from this build).

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
- **End of phase:** commit → set that phase's status to `'shipped'` in `crm_build_phases` → update `UPR-Web-Context.md` (Rule 9) — all before opening the PR. **Open the `dev` PR as a draft (per the harness default), then immediately mark it ready for review** — every CRM phase's PR should end the session ready for review, not sitting as a draft.
- **Reconcile the checkboxes before the PR — both directions.** The `/crm/roadmap` (and public `/status`) page reads `crm_build_stages`; a session must leave that state honest, not drift. Every stage you flip to `done` must reflect real, verified work (no marking-done-to-look-finished), and every stage that genuinely landed must actually be flipped (no leaving finished work as `todo` — that under-reports progress and reads as "skipped"). A stage that's genuinely blocked on the owner (a live account, a real test call, a credential) stays open, but the phase's PR/`UPR-Web-Context.md` must say *why* — so an owner-gated box is never mistaken for a forgotten one. (There is no `blocked` status value yet — planned enhancement; until then, disclose in prose.) The `crm-phase-reviewer` audits this as part of its sign-off.

ℹ️ `crm_build_phases` / `crm_build_stages` now exist (Phase 0 shipped — `phase_key, title, status, shipped_at, sort_order` + per-phase sub-steps), backing the read-only `/crm/roadmap` progress page and the public `/status` mirror. Status is set via `set_crm_phase_status` / `set_crm_stage_status`; progress rolls up via `get_crm_build_progress()`.

---
*Full DB schema/RPCs/iOS build → `UPR-Web-Context.md` (not duplicated here — verify columns live via MCP schema tools or `information_schema.columns`, not memory). UI/design tokens → `UPR-Design-System.md`. Billing/QBO/Xactimate → `BILLING-CONTEXT.md`. Encircle API → `ENCIRCLE_API_REFERENCE.md`. Email deliverability → `EMAIL-DELIVERABILITY.md`. QBO sync internals → `UPR-QBO-SYNC-PROTOCOL.md`.*
