@AGENTS.md

# UPR Platform — Claude Code Project Context
**Last updated:** July 26, 2026 · **Project:** Utah Pros Restoration — Internal Business Management Platform
**Developer:** Moroni Salvador · **Repo:** moronisalvador/Utah-Pros-App-Git

> **The shared law layer is [`AGENTS.md`](AGENTS.md), imported on line 1 above.** Codex reads it
> directly; Claude Code reads it through that import. It carries the numbered non-negotiables, the
> authorization boundary, the document precedence ladder, the depth map and the definition of done.
> **Rule numbering is frozen** — a reference of the form "CLAUDE.md Rule N" resolves in `AGENTS.md`,
> where rules 1–12 are reproduced verbatim (170 such references across 56 tracked files, measured
> 2026-07-26; derive it with `git grep -ohE '\bRules? [0-9]+\b' -- '*.md' | wc -l`). This file adds
> the **Claude-only** routing on top.
>
> **The duplicated `## ⚠️ NON-NEGOTIABLE RULES` block was removed on 2026-07-26**, once the import
> was proven durable rather than assumed. The `InstructionsLoaded` hook recorded `AGENTS.md`
> reloading with `reason=include, parent=CLAUDE.md` across a real `/compact`, alongside all 23
> unscoped `.claude/rules/*.md` — the loader's own record, not a session reporting what it can see.
> Evidence: [`docs/agent-alignment-l2-evidence.md`](docs/agent-alignment-l2-evidence.md). Re-check
> any time with `node scripts/check-l0-bridge.mjs` (14 assertions) and
> `node scripts/instructions-loaded-report.mjs --assert-core`.
>
> **If that bridge ever breaks, this file carries no rules at all.** That is the trade P3 made: one
> copy that is verified on every run, instead of two copies that drift. The guard is the safety net —
> run it before touching either file.

### Claude-only mechanisms (silent divergences from Codex if unstated)

- **`.claude/rules/*.md` load unconditionally at launch**, at the same priority as this file. That is
  why all 23 currently enter every session.
- **`paths:`-scoped rules and nested `CLAUDE.md` files are dropped at `/compact`** until a matching
  file is re-read. Cheap-at-startup and survives-compaction are mutually exclusive, so a
  non-negotiable must never live in either — it stays unscoped at the root.
- An **over-braced `paths:` glob is used unexpanded and matches nothing**, so the rule loads *never*,
  with no error. Prefer several brace-free patterns.
- **`.claude` is a protected path.** Edits prompt for approval and `permissions.allow` cannot
  pre-approve them — the prompts are correct behaviour, not a misconfiguration.
- **Skills are `/name` here and `$name` in Codex**, and the slash command comes from the skill's
  **directory** name, not its frontmatter `name`. `.claude/commands/` and skills share one namespace;
  the skill wins a collision. Skill precedence is managed > user > **project**, so a personal
  `~/.claude/skills/<name>` silently shadows the repo copy.
- **`claude -p --bare` skips `CLAUDE.md`, hooks, skills, plugins, MCP and auto memory.** Any CI gate
  written that way is bound by no project law unless the core is passed via
  `--append-system-prompt-file`.
- **A mid-session edit to this file, `AGENTS.md`, a `SKILL.md` or a settings file does not take effect
  until `/clear`, `/compact` or restart.** Never report "rule updated and followed" from one session.
- On win32 Claude Code **cannot sandbox** (WSL2 required, fails open by default) while Codex sandboxes
  natively. Never list sandboxing as a Claude-side control on this platform.

## How we work

Understanding before acting, verification before shipping, the sanctioned ship path and honest
reporting all live in the shared core (`AGENTS.md` §Starting a task, §Verify before shipping, §17).
What remains here is Claude-only.

**Keep context lean.** Delegate broad searches to subagents — file/pattern/caller *finding* goes to the cheap read-only **`upr-scout`** agent (Haiku); judgment work (review, money, consent, migrations, architecture) stays on the sonnet/opus checkers and reviewers. Right doc for the job: `BILLING-CONTEXT.md` (QBO/invoicing), `UPR-Web-Context.md` (schema/RPCs/iOS), `UPR-Design-System.md` (CSS/components). `/clear` between unrelated tasks; `/btw` for side questions that shouldn't enter history. At a completed-task boundary, if the next request is independent and accumulated unrelated context would reduce reliability, proactively recommend `/clear` or a new conversation and provide a concise handoff; never interrupt in-flight work or switch based on length alone.

## DB Client API

```js
const { db } = useAuth();
await db.select(table, queryString)   // GET — throws on any non-OK response (400/404/500); does NOT return [] on 404 — always try/catch
await db.insert(table, data)          // POST — returns inserted row(s)
await db.update(table, filter, data)  // PATCH — null on 204, else updated row(s)
await db.delete(table, filter)        // DELETE — null on 204
await db.rpc(fn, params)              // POST /rpc/{fn} — null on 204; default for anything complex or tables added after initial deploy
```

**PostgREST/RLS (least privilege):** new exposed tables require `ENABLE ROW LEVEL SECURITY`, but RLS-enabled alone proves nothing about which rows a caller may use. Prefer operation-specific policies using active employee, role, assignment, owner or organization predicates. An always-true authenticated policy is only for explicitly documented company-wide data; it is not a default floor. Prefer `SECURITY INVOKER`; a necessary `SECURITY DEFINER` RPC pins `search_path`, validates the caller/capability inside SQL, revokes `PUBLIC`/`anon`, and is granted only to callers that need that operation. **Never expose free-form SQL to browser roles**; `exec_read_sql` was contained to `service_role` on 2026-07-23 and must remain service-only. **`anon` enters a GRANT or policy only for a deliberately public, minimal boundary** in [`.claude/rules/database-standard.md`](.claude/rules/database-standard.md) §2, with a `-- public: <reason>` comment and abuse/capability tests. After adding an exposed contract, refresh/redeploy the PostgREST schema cache as prescribed by the standard.

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

A local `.env.local` (gitignored — Vite auto-loads it) with `VITE_SUPABASE_URL` + the **anon/publishable** key unlocks real local dev + UI verification: `preview_start({name: "Vite Dev Server"})` (config in `.claude/launch.json`) → Login screen's **"Dev Mode: Select Employee"** button → click an approved test employee. The key is intentionally public, not a secret, but that does **not** make database access safe—RLS/policies must assume every internet caller has it, and the live audit confirms broad anon exposure. Use this mode only for authorized UI verification; never treat it as authentication. If `.env.local` doesn't exist yet, get the URL + publishable key via the Supabase MCP (`get_project_url` / `get_publishable_keys`) rather than asking the user to paste secrets in chat—but never create the file directly (`.claude/hooks/block-secrets.sh` blocks any `Write`/`Edit` to `.env*` by filename, on purpose); hand the two lines to a human to paste in.

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
supabase/migrations/ tracked SQL migrations — schema-as-code (Rule 7). Count drifts; derive it with the current shell. The 2026-07-22 audit found 207 local files versus 375 live ledger entries; four newest live entries were on an unmerged feature branch, so verify provenance rather than comparing counts alone.
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
- **Cross-runtime sources:** `new-feature`, `masterplan`, and the reviewer adapters listed in
  `tooling/capabilities.json` are generated from neutral sources. Edit the neutral source, then run
  `npm run generate:tooling`; never hand-edit one generated `.claude`/`.agents`/`.codex` copy.
- **Content & marketing — explicit tasks only:** this repository owns the internal UPR application,
  not the public website, so the repository-local SEO suite was retired 2026-07-23. Retained
  content/marketing references (`product-marketing`, `copywriting`, `cro`, `content-strategy`,
  `email-sequence`, `campaign-plan`, `competitive-brief`, `performance-report`, `brand-review`) run
  only when explicitly requested and never auto-expand internal-app development. `impeccable` still
  owns product-UI design. Do not add a second broad UI/UX or website/SEO dispatcher to this repo.

**Precedence when guidance conflicts:** (1) CLAUDE.md non-negotiables + `.claude/rules/` standards are **law** — always win; (2) UPR-native skills drive the flow; (3) vendor skills advise within their lane only. A vendor skill **never** overrides a standard: no `framer-motion`/`gsap` (`perf-budget.md` — motion is CSS tokens + View Transitions, see `motion-standard.md §8`), no Next.js APIs, no loosening `database-standard.md`. The **impeccable PostToolUse hook** is the one *deterministic* layer — it runs on every UI edit; fix its findings or consciously waive them (never silence a real one).

## Deployment & Release Workflow

Carried in full by Rule 4 and `AGENTS.md` §13: routine work commits directly to `dev`
(auto-deploys to dev.utahpros.app); production goes via a reviewed `dev → main` PR; the CRM
parallel wave keeps feature-branch → PR-into-`dev`; Cloudflare keeps separate Production and
Preview variable sets, so a new secret needs both plus a redeploy; and one shared Supabase sits
behind both branches, which makes a migration a production change the instant it applies.

> **This heading is load-bearing.** Rule 4's `#deployment--release-workflow` anchor resolves here
> and nowhere else, so the section stays even though its content now lives in the core.
> `scripts/check-l0-bridge.mjs` fails if it is removed.

Incident runbook: `.claude/rules/scope-sheet-rollback.md`.

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
*Full DB schema/RPCs/iOS build → `UPR-Web-Context.md` (not duplicated here — verify columns live via MCP schema tools or `information_schema.columns`, not memory). UI/design tokens → `UPR-Design-System.md`. Billing/QBO/Xactimate → `BILLING-CONTEXT.md`. Encircle API → `ENCIRCLE_API_REFERENCE.md`. Email deliverability → `EMAIL-DELIVERABILITY.md`. QBO sync internals → `UPR-QBO-SYNC-PROTOCOL.md`. **CRM lead lifecycle, canonical counting rules & data invariants → `docs/crm-lead-lifecycle.md` — mandatory read before changing how anything CRM is counted, staged, classified, or reported** (it also carries the Twilio provider-seam constraint).*
