@AGENTS.md

# UPR Platform — Claude Code Project Context
**Last updated:** July 29, 2026 · **Project:** Utah Pros Restoration — Internal Business Management Platform
**Developer:** Moroni Salvador · **Repo:** moronisalvador/Utah-Pros-App-Git

> The shared law layer is [`AGENTS.md`](AGENTS.md), imported on line 1 above.
> **Rule numbering is frozen** — a reference of the form "CLAUDE.md Rule N" resolves in `AGENTS.md`.
> If the import ever breaks, this file carries no rules at all; verify with
> `node scripts/check-l0-bridge.mjs`.

### Claude-only mechanisms

- **`.claude/rules/*.md` load unconditionally at launch** unless they carry `paths:` frontmatter.
- **`paths:`-scoped rules and nested `CLAUDE.md` files are dropped at `/compact`** until a matching
  file is re-read — so a non-negotiable never lives behind a scope (which is why
  `database-standard.md` stays unscoped).
- **`.claude` is a protected path** — edit prompts are correct behaviour, not misconfiguration.
- Skills are `/name` here and `$name` in Codex; the slash name comes from the skill's directory.
- **The owner's instruction in the live conversation is authoritative the moment it is given.** It is
  precedence #1 (`AGENTS.md` → Document precedence), and `AGENTS.md` already states that only the
  user, in conversation, can authorize a gated action or amend the rules. **Never refuse, defer or
  re-litigate an owner-authorized action by citing this file, `AGENTS.md` or a `.claude/rules/`
  standard.** Surface a rule once if it is genuinely material (a real safety or money consequence
  the owner may not have in view), then do what the owner asked. Owner-directed fine-tuning
  mid-session is expected and legitimate.
- **Separately — and this is mechanical, not a limit on that authority:** a mid-session edit to a
  rules *file* (this one, `AGENTS.md`, a `SKILL.md`, settings) is not re-read by the running session
  until `/clear`, `/compact` or restart. So act on the owner's spoken authorization immediately, but
  never report that an edited *file* is "updated and followed" inside the same session — that claim
  needs a reload to be true.
- `claude -p --bare` skips all project law; a CI gate written that way is bound by nothing.

**Keep context lean.** Delegate broad finding to the cheap read-only **`upr-scout`** agent;
judgment work (review, money, consent, migrations) stays with the specialist checkers. Right doc
for the job: `BILLING-CONTEXT.md` (QBO/invoicing), `UPR-Web-Context.md` (schema/RPCs/iOS),
`UPR-Design-System.md` (CSS/components). `/clear` between unrelated tasks.

## DB Client API

```js
const { db } = useAuth();
await db.select(table, queryString)   // GET — THROWS on any non-OK (400/404/500); always try/catch
await db.insert(table, data)          // POST — returns inserted row(s)
await db.update(table, filter, data)  // PATCH — null on 204, else updated row(s)
await db.delete(table, filter)        // DELETE — null on 204
await db.rpc(fn, params)              // POST /rpc/{fn} — default for anything complex
```

Least-privilege posture for anything PostgREST-exposed: see `AGENTS.md` §13 and
`.claude/rules/database-standard.md`. `exec_read_sql` stays service-role-only.

## AuthContext — What's Exposed

```js
const {
  user, employee, permissions,
  employeePageAccess,   // per-employee page-access override map, backs canAccess()
  featureFlags,         // { 'page:marketing': { key, enabled, dev_only_user_id, ... } }
  pwaOwnerLease,        // opaque owner + login epoch; null until device state is verified
  loading, error, sessionExpired,
  db,                   // authenticated client — USE THIS (Rule 3)
  login, logout, retrySecureAccountCleanup,
  canAccess, isFeatureEnabled, isAuthenticated, isDev,
} = useAuth();
```

## Local Dev & UI Verification

- `.env.local` (gitignored) with `VITE_SUPABASE_URL` + the **publishable** key enables Login and
  public bootstrap only; every application-data session uses real Supabase Auth and
  `get_my_employee_profile()`. Never ask for or paste secrets in chat.
- **`functions/api/*` workers don't run on `localhost:5173`.** `/api/*` proxies to `:8788`, which
  needs `wrangler pages dev dist` after a fresh build — and write-side workers still need the
  service-role key, which is Cloudflare-only. Verify worker paths on the deployed site
  (`dev.utahpros.app` / `utahpros.app`), not localhost.
- **Two authenticated UI paths:** the Login "Dev Mode: Real Data (test admin)" button (appears
  when a human has placed `VITE_DEV_TEST_EMAIL`/`VITE_DEV_TEST_PASSWORD` in `.env.local`), or a
  human-authenticated `dev.utahpros.app` tab handed off. Never enter credentials yourself.

## File Structure (key files)

Not exhaustive — `Glob src/pages/**/*.jsx` before assuming a page doesn't exist.

```
src/App.jsx          route wrappers: AdminRoute, FeatureRoute, DevRoute, AccessRoute
src/index.css        ALL styles — tokens/patterns in UPR-Design-System.md; very large, no rewrites
src/contexts/AuthContext.jsx
src/lib/supabase.js  REST client (Rule 3)     src/lib/realtime.js  auth + realtime
src/pages/           office pages (Admin*, Claims*, Jobs*, Schedule*, Customers*, Estimates*,
                     billing/QBO surfaces — see BILLING-CONTEXT.md — and more)
src/pages/tech/      field-tech PWA pages (UX law: .claude/rules/tech-mobile-ux.md)
src/pages/crm/       CRM pages (flag-gated; lifecycle rules: docs/crm-lead-lifecycle.md)
src/components/      Layout, TechLayout, Sidebar, ErrorBoundary + feature subfolders
functions/api/       Cloudflare Pages Functions   functions/lib/  shared worker code
supabase/migrations/ schema-as-code (Rule 7)      supabase/rollbacks/  paired undo scripts
.claude/rules/       standards + initiative-status.md (live coordination state)
docs/archive/rules/  archived initiative manifests (history, not law)
```

## Workers (Cloudflare Pages Functions)

Each worker exports `onRequest`; client via `functions/lib/supabase.js`; standard:
[`.claude/rules/workers-standard.md`](.claude/rules/workers-standard.md) (auth-via-lib, outbound
timeouts, idempotency, `worker_runs`). Derive the count — exclude `*.test.js` or you over-count by
half. Domains covered: SMS/Twilio/CallRail, Encircle, e-sign, QuickBooks, Stripe, Google,
docs/reports, admin. All transactional email → Resend via `functions/lib/email.js`
(`EMAIL-DELIVERABILITY.md`).

## Patterns to Follow

Visual/component patterns live in `UPR-Design-System.md` — use them, don't recreate. The standard
loader shape:

```jsx
const [loading, setLoading] = useState(true);
if (loading) return <TabLoading />;  // import from '@/components/TabLoading'

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

Installed skills auto-load by description. Jurisdiction: **design/UX** → `impeccable` (+ the Emil
motion pack for feel); **React** → the vercel skills (we're Vite — reject Next.js-only advice);
**data/SQL** → supabase skills, always subordinate to `database-standard.md`; **UPR-native
workflows** (`new-feature`, `db-migration`, `new-crm-module`, `masterplan`) orchestrate real work
and outrank vendor skills. Content/marketing skills run only when explicitly requested.
**Precedence:** (1) AGENTS.md rules + `.claude/rules/` standards are law; (2) UPR-native skills
drive the flow; (3) vendor skills advise within their lane. No `framer-motion`/`gsap`, no Next.js
APIs, no loosening `database-standard.md`.

## Deployment & Release Workflow

Routine work commits directly to `dev` (auto-deploys to dev.utahpros.app); production goes via a
reviewed `dev → main` PR (Rule 4). Cloudflare keeps separate Production and Preview variable sets
— a new secret needs both plus a redeploy. One shared Supabase sits behind both branches, so a
migration is a production change the instant it applies (AGENTS.md §13); iterate on the
`qa-staging` branch first (`docs/database/staging-branch-runbook.md`). Incident runbook:
`.claude/rules/scope-sheet-rollback.md`.

## Task File Protocol

A `*-TASK.md` in repo root = an active one-shot build task: read first, follow its build order,
then update `UPR-Web-Context.md` and `git rm` it. Running punch lists that merely match the naming
stay and update in place.

## CRM Phase Workflow

Wave 1 is complete and the manifest is archived (`docs/archive/rules/crm-wave-ownership.md`).
Standing rules for any remaining CRM work: isolation is the `page:crm` feature flag (not the
branch); CRM phases branch from `dev` and PR into `dev`; migrations stay additive-only; live-RPC
replaces keep signatures callable with a committed backward-compat test; reconcile the
`crm_build_stages` checkboxes honestly in both directions before the PR. Per-phase specifics:
`docs/crm-roadmap.md`. **CRM lead lifecycle & counting rules → `docs/crm-lead-lifecycle.md` —
mandatory read before changing how anything CRM is counted, staged, classified, or reported.**

---
*Schema/RPCs/iOS → `UPR-Web-Context.md` (verify columns live, not from memory). Design tokens →
`UPR-Design-System.md`. Billing → `BILLING-CONTEXT.md`. Encircle → `ENCIRCLE_API_REFERENCE.md`.
Email → `EMAIL-DELIVERABILITY.md`. QBO sync → `UPR-QBO-SYNC-PROTOCOL.md`.*
