# CRM-in-UPR: CallRail + Ad Attribution Roadmap

## Context

Moroni wants to stop running the business out of five different tools and bring lead
tracking, call tracking, and ad performance (Google Ads + a few Meta ads) into UPR
itself. The trigger is CallRail's open API — it looks like the easiest piece to pull
in first. Three questions are on the table: (1) is this technically doable, (2) is
centralizing everything in UPR actually the right call, or should some pieces stay
external, and (3) which model (Sonnet 5 vs Opus 4.8) should drive this.

This is the **committed roadmap of record** for the CRM build — approved and living in
the repo (on `crm/foundation`, off `dev`) so every future build session reads it from
here. It carries the full rationale and decisions, not just the task list. Phase 1
(CRM shell + CallRail) is the build-ready next step; see the Branching & PR strategy and
per-phase sections below.

---

## Direct answers

**1. Is it doable?** Yes, cleanly. UPR already has ~70% of the data model a CRM needs:
a `contacts`/`claims`/`jobs` hierarchy, a pre-sale `estimates` funnel (contact-owned,
already converts to jobs), a 49-row `referral_sources` attribution lookup already on
the claims form, a `Leads.jsx` page (jobs in `lead` phase), a stubbed `Marketing.jsx`
(campaigns table), and a `system_events` audit trail. There's also a proven pattern for
ingesting exactly this kind of external data: `functions/api/sync-encircle.js` and
`functions/api/twilio-webhook.js` already pull/receive third-party data, match it to
a contact by phone (`contacts.phone=eq.…`), and upsert it — that's the exact shape a
CallRail integration takes. Nothing about this is a stretch for the stack.

- **CallRail**: REST API (API-key auth) returns calls with recording URL, transcript,
  duration, tracking number, source/medium/campaign (UTM passthrough), and lead/value
  tags. It also supports outbound webhooks (call completed, SMS) for real-time push
  instead of polling — same shape as the Twilio webhook already in the repo.
- **Google Ads API**: Doable, but the heaviest lift — OAuth2 + refresh token + a
  developer token, and Google's approval step for production-level API access can take
  days. Reporting is GAQL queries (campaign/cost/conversions). Best run as a daily cron
  worker, same pattern as `process-scheduled.js`.
- **Meta Marketing API**: Lighter than Google — a long-lived System User token from
  Business Manager reads your own ad account's Insights (spend, campaign, results) with
  no app-review step needed for read-only access to your own account. Also a daily cron
  pull.

**2. Is "everything in one app" the right architecture?** Mostly yes, with one
distinction worth being explicit about: **don't rebuild what CallRail/Google/Meta are
actually good at** (dynamic number insertion + call recording infra, ad delivery/
bidding algorithms). Rebuilding telephony or an ad-serving engine would be a multi-year
detour with no payoff. What's actually expensive about running 5 tools today isn't the
specialized engines — it's that **the reporting and attribution lives nowhere
unified**, so there's no single view of spend → lead → call → job → revenue (especially
since UPR is the only system that knows actual job revenue, via the QBO sync).

So the right shape is: keep CallRail/Google Ads/Meta Ads as the specialized engines,
and make UPR the **system of record that ingests their data via API/webhook** and joins
it to the contact/claim/job/estimate pipeline that already exists. That gets you the
stated goal — one app to run the business and see the full picture — without taking on
the (much larger, much riskier) job of replacing telephony or ad platforms outright.
This also directly displaces the standalone attribution tools (Ruler Analytics,
WhatConverts, Improvado-style products) that exist purely to do this joining job, since
UPR can do it natively against data it already owns.

**3. Sonnet 5 or Opus 4.8?** Stay on Sonnet 5 for this. It's the model that built the
existing codebase and is fully capable of both this kind of architecture planning and
the incremental implementation — and the build is mostly iterative (hit a real API,
adjust the mapping, test against real webhook payloads), which favors a fast model you
can loop with quickly over a slower, more expensive one. The one place Opus could
genuinely add value is a single focused pass on the **multi-touch attribution model**
(e.g., first-touch vs. last-touch vs. weighted, and how to reconcile CallRail's own
"converted" flag against UPR's own job/won status) before that logic gets built,
since a wrong call there is expensive to unwind later. That's optional, not required —
flag it if/when that design question comes up rather than switching models now.

---

## Where to build this: same repo, walled off — not a separate site

You raised whether this should be a separate repo/site for the multi-month build (now
scoped at a realistic 3–4 months), then "plugged in" to UPR later, with risk avoidance
as the main driver. Recommendation:
**build it inside the UPR repo, but made invisible and consequence-free via the
feature-flag mechanism that already exists** — not a second codebase. Reasoning:

**A second repo doesn't actually buy you the safety it sounds like it does.** The
whole value of this module is joining ad spend / calls to the contacts, jobs, claims,
estimates, and QBO revenue data that already live in UPR's Supabase project (this is
the entire answer to your "is this the right architecture" question above). A
standalone site either (a) needs its own copy of that data, which means building a
sync pipeline and living with two sources of truth for months, or (b) points at the
same Supabase project anyway, in which case you've gained nothing on the data side and
only added a second auth system, a second copy of the design system, a second
deployment pipeline, and a second domain to maintain — real ongoing cost, not
one-time. Then "plug it in later" becomes its own integration project, with its own
risk, on top of the original build. You'd be paying the separation tax twice: once now
to keep it apart, once later to merge it.

**The repo already has a purpose-built mechanism for exactly this risk-avoidance
need**, used for every feature shipped since Estimates/Collections/Time Tracking:
`feature_flags.dev_only_user_id`. When a flag's `dev_only_user_id` matches your
employee id, `isFeatureEnabled()` returns true **only for you**, regardless of the
flag's `enabled` value (`src/contexts/AuthContext.jsx:259`) — every other employee and
every tech hits `<Navigate to="/" replace />` via `FeatureRoute`
(`src/App.jsx:120-123`), on `dev` and even on `main`, until you flip it. Concretely,
this means:

- New routes/pages (`/crm`, `/calls`, etc.) wrapped in `<FeatureRoute flag="page:crm">`
  are **invisible to literally everyone but you**, the same pattern `Leads`,
  `Marketing`, `Collections`, `Estimates`, and `time_tracking` already use
  (`src/App.jsx:283-315`).
- New tables (`calls`, `ad_spend`, etc.) are purely additive migrations — nothing
  existing is altered, so there's no path for this work to corrupt or break current
  data, even mid-build.
- Every route is already wrapped in `<ErrorBoundary section="…">` — a crash in the new
  CRM page can't take down the rest of the app even for you, let alone anyone else.
- You can ship each phase (CallRail → ad spend → dashboard) through its own small
  `dev → main` PR as it's finished, instead of one giant integration merge at the end —
  smaller, safer, and each phase is real, working, deployed (just invisible) the whole
  time. There is no "later" merge step at all — flipping `enabled: true` (or clearing
  `dev_only_user_id`) on the flag *is* the launch, with zero migration because it was
  never a separate system.
- The dev→main PR review gate plus `npx eslint` + `npm run build` before every merge
  (per `CLAUDE.md`) is the actual safety net here — that discipline already exists and
  applies the same way regardless of repo.

**If what you actually want is just session-level separation** — so a Claude Code
session building the CRM module doesn't collide with other UPR work happening at the
same time — that's a tooling concern, not a repo concern. This build runs on Claude
Code **web** (a GitHub-backed cloud sandbox, not your local machine), so isolation is
**branch-based**, not local git worktrees: each build session works on its own feature
branch cut from `dev`, and if you want two streams of work going at once you run them
as **separate background cloud sessions** on separate branches. Same repo, same
Supabase project, no second codebase or future merge project — just independent
branches that each open their own `dev → main` PR.

**Bottom line:** one repo, one Supabase project, gated behind `dev_only_user_id` scoped
to you, shipped phase-by-phase through the normal `dev → main` review process. This
gets you the actual thing you want (zero risk to the live app, zero risk to other
users, freedom to take the full 3–4 months) without inventing a second product to merge later.

---

## How complete will this be vs. HighLevel?

Your marketing agency pushing GoHighLevel is a reasonable nudge — it's a mature,
dedicated product. Your instinct not to add a 6th tool is also reasonable. Honest,
calibrated answer, scoped to exactly the list you gave (manage leads, sell, run, text
blasts, email campaigns) — not "replicate HighLevel feature-for-feature":

**Where UPR will already be *better* than HighLevel, because it's purpose-built for
restoration work instead of generic:** the job/production pipeline (30-phase Kanban),
claims/insurance data model, and estimate → invoice → **QBO-synced real revenue**.
HighLevel has zero domain knowledge of restoration or insurance claims and no real
field-ops/production tracking — this is a durable advantage no generic CRM will ever
match, and it's already built.

**Where UPR gets to genuine parity, because the infrastructure already exists and
this build reuses it rather than starting from zero:**
- **Manage leads** — Phase 1 (call/form ingestion) + a real Kanban pipeline (see Phase
  4 below, reusing the exact pattern `Production.jsx` already uses for jobs) covers
  HighLevel's "opportunity pipeline" concept directly.
- **Sell** — the `estimates` funnel (contact-owned, already converts to invoices) is
  already live and arguably tighter than HighLevel's generic quoting, since it's
  QBO-synced to real numbers.
- **Run** — job/production management. Not a HighLevel strength at all; UPR already
  wins here outright.
- **Text blasts** — `campaigns`/`campaign_recipients` tables already exist in the
  schema, and `Marketing.jsx` literally has "Bulk messaging coming in phase 11" as a
  placeholder comment — this was already on UPR's own roadmap before this
  conversation. Once Twilio is verified (expected this week), this is a bounded,
  known-shape build.
- **Email campaigns** — Resend is already integrated (currently transactional-only);
  extending to segmented bulk sends is a real but bounded scope: list
  building/segmentation, a template UI, and unsubscribe handling.

**Where UPR will honestly be weaker, and where the "don't add too much" line should
get drawn:**
- **No drag-and-drop visual automation/workflow builder.** Building one would be a
  large, open-ended project for marginal gain. Instead: ship **4 fixed, high-value
  automations** (below) that cover most of the actual ROI a restoration business gets
  from HighLevel's automation layer, without the builder's complexity.
- **No landing-page/funnel builder or self-serve booking widget.** Not on your stated
  list — intentionally out of scope. Revisit only if it turns out to matter later.
- **Deliverability/compliance maturity.** HighLevel has years of built-up sender
  reputation and A2P 10DLC tooling. This repo already has `EMAIL-DELIVERABILITY.md`
  for transactional email, which is a good sign this has been taken seriously before —
  extending to marketing-volume email/SMS needs the same rigor (10DLC campaign
  registration for bulk SMS, proper list hygiene/unsubscribe for email) rather than
  being an afterthought.
- **No third-party integrations marketplace.** Irrelevant to a business that
  explicitly wants one hub, not a hub that connects to everything else.

**Bottom line:** for the specific list you gave, this build realistically gets you to
~85-90% of HighLevel's practical value for a restoration business specifically, and
wins outright on the "sell/run" side because those pieces are purpose-built instead of
generic. The gap is deliberate — a visual automation builder and self-serve funnels —
traded for a leaner, cheaper, more maintainable system that's actually yours. That
matches what you asked for: the important 20%, not all of it.

---

## Design & shell decisions (locked in after reviewing the rendered handoff)

You reviewed the actual rendered screens (Overview, Leads, Call Log, Tasks,
Attribution, Reports) and decided to **keep the new design system rather than
re-skinning it onto the existing UPR tokens** — overriding my earlier
recommendation. That's a legitimate call and it actually fits well with the
resale ambition below: a CRM meant to eventually stand alone benefits from its own
polished identity rather than being visually fused to UPR's internal-tool look.
Here's how to build that cleanly rather than as scattered hardcoded hex values:

- **Scope it like `.tech-layout` already does.** The mobile field-tech app already
  proves this pattern in this exact codebase — its own token set (`--tech-*`)
  scoped under a `.tech-layout` wrapper class, living alongside the main app's
  tokens without conflicting. Do the same for the CRM: wrap everything under `.crm-
  shell` (or similar) and define the handoff's tokens as `--crm-*` custom
  properties scoped to that class — not globally in `:root`, and not hardcoded
  inline hex values repeated across components. `Public Sans` gets loaded and
  applied only within that scope; the rest of the app keeps `Inter` untouched.
- **Swap the Unicode nav glyphs (▦ ▩ ✓) for real SVG icons.** That part of the
  prototype reads as a prototyping shortcut, not an intentional style choice — the
  rest of the design is too polished for it. Follow the exact convention already
  used for every other icon in the app (`src/lib/navItems.jsx`'s `IconXxx(p)`
  functions — 24×24 viewBox, `stroke="currentColor"`, 2px rounded stroke): add a
  handful of new `IconLeads`, `IconCallLog`, `IconTasks`, `IconAttribution`,
  `IconReports`, `IconIntegrations` following that same signature.
- **Nav & shell structure**: the sidebar⇄top-nav toggle in the handoff was a
  compare aid, not a real feature — drop it entirely. The **existing UPR top nav
  stays exactly as it is** (Home/Inbox/Schedule/Claims/Customers/My Money/Time);
  add a **CRM** entry to it (behind the `dev_only_user_id` flag). Inside `/crm/*`
  routes, add a **contextual left sidebar** that only renders there — this isn't a
  new pattern either: `Settings.jsx` already does exactly this ("system pages
  share a left sub-nav on desktop"). The CRM sidebar's final item list: **Overview,
  Leads, Call Log, Tasks, Attribution, Reports, Integrations, Settings** — the last
  two are new, covered below.
- **This shell (routing, sidebar, scoped tokens, icon set) is Phase 1's
  foundational deliverable**, not an afterthought bolted onto `Leads.jsx`. Every
  later phase fills screens into this same shell rather than each phase inventing
  its own container.

## Built for UPR now, cheap to make multi-tenant later

You confirmed: build this for UPR, for real, now — just don't paint it into a
corner where multi-tenancy becomes a rewrite later. The cheapest possible hedge,
scoped to exactly what's new here, not a retrofit of the whole app:

- **Every new CRM-specific table gets an `org_id` column from day one** —
  `inbound_leads`, `ad_spend`, `pipeline_stages`, `automation_settings`, and any
  report definitions added later. A minimal `crm_orgs` table gets exactly one row
  (Utah Pros Restoration) to start. Every RPC touching these tables takes/derives
  `org_id` and filters by it — today that's a no-op (there's only one row), but the
  code path already exists. Flipping on real multi-tenancy later becomes "add RLS
  policies keyed on `org_id`, let people create new org rows" instead of
  retrofitting a column and every query across a live table with real data — that
  retrofit is the actually expensive, risky part, and it's avoided entirely by
  doing this now for ~zero extra cost.
- **Existing UPR tables (`contacts`, `jobs`, `claims`, `estimates`) are explicitly
  NOT touched or retrofitted** — they stay single-tenant, UPR-specific, exactly as
  they are today. A future multi-tenant version of the CRM would need its own
  job/pipeline data per tenant; that's a real, larger decision for if/when this
  actually gets sold, not something to solve now.
- **Keep CRM-specific config as data, not hardcoded values**, so relabeling for a
  different context later is a data change, not a code change: pipeline stage
  names/colors live in `pipeline_stages` (not a hardcoded enum — see Settings
  below), and integration credentials are already provider-agnostic (see
  Integrations below). Division names (Mitigation/Reconstruction/Remodeling/Mold)
  stay as they are in the existing `jobs.division` enum — that's existing UPR
  schema, out of scope to genericize right now.

## Integrations (new CRM sidebar item) — reuses the existing QBO pattern exactly

Good instinct pointing at the QBO integration as precedent — it turns out the app
already has fully generic, provider-agnostic infrastructure for exactly this,
built for QBO but not QBO-specific:
- **`integration_credentials`** (service-role locked, one row per provider):
  `provider`, tokens/API key, environment, `connected_by`, `connected_at`. Already
  provider-agnostic — CallRail/Google Ads/Meta just need new `provider` values
  (`'callrail'`, `'google_ads'`, `'meta_ads'`), no schema change.
- **`integration_config`** (service-role locked, key/value): transient OAuth state,
  worker URLs, per-provider settings.
- **`get_integration_status(p_provider)`** RPC already exists and already returns
  connection status without exposing secrets — reusable as-is.
- **This changes how Phase 1/2 store credentials**, superseding the earlier
  "Cloudflare env vars" framing: the OAuth **app's own** client ID/secret (shared,
  not per-connection) still lives in Cloudflare env vars, exactly like
  `QBO_CLIENT_ID`/`QBO_CLIENT_SECRET` do today — but the **connected** API
  key/tokens now live in `integration_credentials`, entered through the
  Integrations page instead of hand-set as a deploy-time secret. CallRail (API key,
  no OAuth) is the simple case — just a paste-a-key form. Google Ads/Meta (OAuth)
  follow the exact `/api/{provider}-connect` + `/api/{provider}-callback` worker
  pattern already proven by `quickbooks-connect.js`/`quickbooks-callback.js`.
- **UI**: a card per provider (status badge, connect/disconnect, last-synced),
  mirroring the layout already built in `DevTools.jsx`'s `IntegrationsTab` — just
  skinned in the CRM's own design system and living in the CRM sidebar instead of
  the admin-only DevTools page.

## Settings (new CRM sidebar item) — configurable pipeline, not hardcoded

Matches the same "don't overbuild" line drawn for the automation builder earlier:
lay the foundation, don't build the full thing.
- **`pipeline_stages` table** (`id, org_id, name, sort_order, color, is_won,
  is_lost`) replaces the hardcoded New/Contacted/Qualified/Estimate Sent/Won enum —
  a simple CRUD screen (add/reorder/rename/recolor a stage) instead of a code
  change every time a stage needs adjusting. This is the concrete, bounded version
  of "customize pipelines/stages."
- **Reports stay mostly fixed for now** — the same reasoning as the automation
  builder: a full drag-and-drop report builder (the "+ Build report" button in the
  handoff) is real, open-ended scope. For now, ship the handoful of reports already
  designed (Conversion trend, Won revenue by division, Estimator leaderboard,
  Source ROI, Call volume, Speed-to-lead, Estimate aging, Pipeline movement) as
  fixed views, with Settings only controlling which ones are pinned to Reports —
  not a builder. Revisit a real builder using the same signal as the automation
  builder: only once a report need shows up that doesn't fit the fixed set.

---

## Recommended build order (per your answers)

**Realistic timeline: 3–4 months**, not the 1–2 months first floated — that early
figure predated the full scope (a Phase 0, the Phase 4 split into four, ad-platform +
A2P 10DLC lead times, and the test-first / review discipline). Roughly one focused
session per phase below, plus external-dependency waits (Google Ads token, A2P 10DLC
vetting, Twilio verification) that run in parallel but gate specific phases.

**Phase 0 — Progress tracking + shell skeleton** *(build-ready)*
**Phase 1 — CRM shell (full design) + CallRail lead ingestion**
**Phase 2 — Ad spend (Google Ads, then Meta)**
**Phase 3 — Attribution + funnel dashboard**
**Phase 4a — Lead pipeline** *(the "replaces HighLevel" phase, split into four sessions)*
**Phase 4b — Text-blast campaigns** *(gated on Twilio SMS verification + A2P 10DLC)*
**Phase 4c — Email campaigns**
**Phase 4d — Fixed automations**
**Phase 5 — Visual automation builder** *(future, not scheduled)*

**Roadmap v3 (2026-07-02) extends this list — see the "Roadmap v3" section at the end:**
**Phase F — Foundation** *(schema + interfaces + wiring for the parallel wave)*, then in
one parallel wave: **6a — Contacts & segments · 6b — Data quality, roles & audit ·
7 — Daily driver (tasks/timeline/comms) · 8 — Drip sequences · 9 — Intelligence &
reports · 10 — CRM Forms (embeddable lead capture)**, plus 4b joining whenever A2P
carrier approval lands.

`crm/foundation` (this PR) is not a numbered phase — it's the one-time branch carrying
the roadmap + `.claude/` tooling, merged into `dev` before Phase 0 starts.

## Branching & PR strategy

Simple, standard model — **no long-lived integration branch.** `dev` and `main` stay
exactly as they are today; isolation comes from the feature flag, not from git. The
generic rule lives in `CLAUDE.md` (CRM build workflow); the concrete branch strings live
with each phase below.

- **One branch per phase, cut off `dev`.** Claude Code web sessions are handed a
  harness-assigned `claude/…` branch — **use it as-is; don't fight it.** A
  `crm/phase-N-short-desc` name (e.g. `crm/phase-1-shell-callrail`) is a nice at-a-glance
  marker but **not required** — the branch name is cosmetic, since isolation comes from
  the `page:crm` flag, not the branch. Treat the `crm/…` names and the
  `crm-phase-N-*.pages.dev` preview URLs in the per-phase blocks below as illustrative;
  use the branch and preview URL the session actually has. (This build runs on Claude
  Code web — a cloud sandbox — so isolation is branch-based, not local git worktrees.)
- **~~Sequential — never start a phase until the previous phase's PR has merged into
  `dev`.~~** **SUPERSEDED (roadmap v3, 2026-07-02):** phase ordering now follows the
  **dependency graph + dispatch model in the "Roadmap v3" section at the end of this
  doc** — a single Foundation phase (F) ships all schema/interfaces/wiring first, then
  the remaining phases run as ONE parallel wave (disjoint tables + disjoint files,
  ownership per `.claude/rules/crm-wave-ownership.md`). The original sequential rule
  still applies to Phases 0–4 history and to any pair the graph marks serial.
- **Ship path per phase:** phase branch → reviewed **PR into `dev`** (this is "the
  phase's PR merged into `dev`") → verify on `dev.utahpros.app` + the branch's own
  `<branch>.utah-pros-app-git.pages.dev` preview → then the normal **`dev → main`**
  release PR promotes it to production. Never a direct `main` push (per `CLAUDE.md`).
  Cloudflare gives each `crm/*` branch its own preview deploy automatically.
- **Isolation = the `page:crm` flag with `dev_only_user_id`** scoped to the owner —
  every `/crm/*` route and nav entry is invisible to all other employees on both `dev`
  and `main` until the flag is opened. So landing a phase on `main` is consequence-free;
  there is no need for a separate long-lived CRM branch to hide the work.
- **`crm/foundation`** (this PR) is the one exception — a one-time, non-phase branch
  carrying just the roadmap + `.claude/` tooling (agents, skill, `settings.json` hook
  additions). It merges into `dev` once, before Phase 0; it is not an ongoing
  integration branch, and phase branches are cut off `dev`, never off `crm/foundation`.

## Shared database — one Supabase, no environment isolation (hard constraint)

**`dev` and `main` are the same Supabase project — one database. There is no schema
isolation between environments.** A migration runs against production the instant it
runs; a new table appears to both the staging and production frontends immediately.
This is already documented in `CLAUDE.md` ("One shared Supabase across environments")
and is a hard constraint on every CRM phase, not a preference. The operational rules
(enforced per phase, full text in `CLAUDE.md` → CRM build workflow):

- **Additive-only** — new tables/columns only; **no `ALTER` on an existing table**
  without separate review outside the phase.
- **No destructive migrations inside any CRM phase** — no `DROP`, no rename of a live
  table/column.
- **Every new table RLS-enabled at creation** with explicit policies.
- **Run each migration against the `dev` deploy and verify before the `dev → main`
  PR** — code that understands the change must reach `main` safely, since the change is
  already live in the shared DB.

## Test-data isolation (because dev writes hit the production database)

Since `dev` and `main` share one database, **every test write during CRM development
lands in the production DB.** So every CRM test row must be tagged **disposable** at
creation and be trivially removable — never confusable with real customer data:

- **Calls/leads:** use a **dedicated dev CallRail tracking number** (already a
  Pre-Phase-1 action item). Every `inbound_leads` row from it is identifiable by that
  `tracking_number` and is safe to delete.
- **Anything org-scoped:** write test rows under a **dedicated test `org_id`** (a
  second `crm_orgs` row, e.g. `Utah Pros — TEST`), distinct from the real Utah Pros
  org. Real data lives under the real org; test data never mixes in.
- **Cleanup step (part of each phase's close-out where it created test rows):** delete
  by the disposable tag — `DELETE ... WHERE tracking_number = '<dev number>'` and/or
  `WHERE org_id = '<test org>'` — run against `dev`/verified before the `dev → main`
  PR. Document in the phase what tag its test rows carry.

## Cross-cutting foundations (apply across every phase, not just Phase 1)

You asked what else is worth baking in now for cleaner code later, beyond the
automation-specific groundwork above. These are foundational choices that pay off
across every phase, not code to write today:

**Terminology fix (already applied above).** "Lead" was overloaded three ways in this
plan: `Leads.jsx` means "a job in the `lead` phase," Phase 4 proposes its own pipeline
stages (New/Contacted/Qualified/...), and Phase 1's new table was also going to be
called `leads`. Renamed Phase 1's table to **`inbound_leads`** throughout this
document — it's a raw touch (a call or form fill) that may never become anything,
which is a different concept from an already-qualified job in the `lead` phase.
Resolved (see the design-decisions section below): the CRM's pipeline lives entirely
inside the new `/crm` shell, driven by its own `pipeline_stages` table — `Leads.jsx`
and `jobs.phase='lead'` stay exactly what they are today, untouched and unrelated.

**Every external-integration table needs a real upsert, never insert-then-hope.**
Phase 1 already does this right (`callrail_id UNIQUE`). Make it the standing rule for
anything touching CallRail/Google Ads/Meta from here on: a unique constraint tied to
the external system's own ID, and an RPC that's a true upsert-and-merge. Insert-only
breaks the moment a webhook or cron redelivers the same record — and it always
eventually does.

**`updated_at` on anything that gets touched more than once.** `inbound_leads` rows
get updated by later webhook events (recording/transcript arriving after the fact) and
by staff (`update_lead_status`) — needs `updated_at` alongside `created_at`, or
"most recently active" sorting silently breaks.

**Every cron/webhook worker logs to `worker_runs`.** That table already exists for
exactly this. The CallRail backfill, the daily Google Ads/Meta pulls, and the 4
automations should all write a row (`started`/`completed`/`error`, records processed)
so there's one place to check "did last night's ad-spend pull actually run" instead of
digging through Cloudflare logs.

**Consent checks are a hard gate, not a feature.** No code path — automation, text
blast, or campaign — sends an SMS without checking `sms_consent_log` first, or a
marketing email without checking an unsubscribe list. TCPA violations carry statutory
penalties per message, not just reputational risk. Bake the check into the shared
`sendAutomatedMessage()` helper itself (from the automation foundation above) so it's
structurally impossible to bypass, rather than trusting every call site to remember.

**Pick one timezone convention for daily data, once, and write it down.**
`ad_spend.date` and any "days since last contact" logic need an explicit answer: store
timestamps in UTC as usual, but calculate "yesterday" and "N days stale" in Mountain
Time, since that's the business's actual day boundary. Getting this wrong is a classic
silent bug — the cron looks like it's working but is quietly off-by-one on which day
data gets attributed to.

**Guard the external API workers against runaway retries.** A bug causing an infinite
retry loop against CallRail/Google/Meta doesn't just fail loudly — it risks tripping
their rate limits or an account abuse flag. Cap retries and log-and-stop rather than
loop forever.

**Split the feature flag per sub-feature, not one big `page:crm` switch.** Phase 1's
lead log, Phase 4's pipeline, text blasts, email campaigns, and automations will all
finish at different times. Separate flags (`feature:crm_leads`, `feature:crm_pipeline`,
`feature:crm_campaigns`, `feature:crm_automations`) let each ship and get tested
independently instead of being held hostage to whichever piece is slowest.

**Every phase clears the same three gates** — see the "Testing, acceptance & review
model" section below: test-first (committed failing test → implementation), committed
acceptance criteria, and an independent `crm-phase-reviewer` pass — before its
`dev → main` PR. Not just Phase 1.

---

### Phase 0 — Progress tracking + shell skeleton

> **Branch:** `crm/phase-0-scaffold` — cut off `dev`.
> **Prerequisite:** none beyond current `dev` — the roadmap + `.claude/` tooling are already merged into `dev`. Phase 0 is the first build phase.
> **Read scope:** this block + `CLAUDE.md` (generic build & close-out rules).
> **Close-out checklist (all true before the `dev → main` PR):**
> - [ ] Test-first, now green: `set_crm_phase_status` / `set_crm_stage_status` set status + stamp `shipped_at`, and `get_crm_build_progress()` rolls up stage done/total counts correctly — integration test vs the Supabase `dev` branch.
> - [ ] Acceptance: `/crm/roadmap` renders every phase with its status, its **stages as a checklist**, and a **per-phase progress bar** (e.g. `3/7`) + overall progress, gated by `page:crm` (invisible to other employees); `crm_orgs` seeded with the real Utah Pros org **and** a disposable `… — TEST` org.
> - [ ] `npm run test` + `npm run build` + `npx eslint` (changed files) pass.
> - [ ] `upr-pattern-checker` clean; `crm-phase-reviewer` (Opus) sign-off.
> - [ ] Visual: the `/crm/roadmap` progress page at `crm-phase-0-scaffold.utah-pros-app-git.pages.dev`.
> - [ ] Dogfood the close-out: mark phase-0's stages `done` and phase-0 `shipped` via the RPCs.
> - [ ] `UPR-Web-Context.md` updated (`crm_orgs`, `crm_build_phases`, `crm_build_stages` tables; `get_crm_build_progress` / `set_crm_phase_status` / `set_crm_stage_status` RPCs; `/crm/roadmap` page; `page:crm` flag).

Phase 0 is the minimal scaffold everything else plugs into — the first migration and the
first `/crm` route — plus the always-current build tracker that means we never have to
remember where the build stopped:

- **`crm_orgs`** — `id, name, is_test BOOLEAN DEFAULT false, created_at`. Seeded with the
  real **Utah Pros Restoration** org and a disposable **"Utah Pros — TEST"** org
  (`is_test = true`) that all test rows key to (see Test-data isolation above). RLS
  enabled at creation. This is the `org_id` tenancy seam every later CRM table carries.
- **`crm_build_phases`** — `phase_key TEXT PK, title TEXT, status TEXT CHECK (status IN
  ('planned','in_progress','shipped')) DEFAULT 'planned', shipped_at TIMESTAMPTZ,
  sort_order INT`. One row per phase (0, 1, 2, 3, 4a–4d, 5). RLS enabled at creation.
- **`crm_build_stages`** — `id, phase_key TEXT FK→crm_build_phases, title TEXT, status
  TEXT CHECK (status IN ('todo','in_progress','done')) DEFAULT 'todo', sort_order INT`.
  The sub-steps/to-dos inside each phase, seeded from each phase's close-out checklist in
  this roadmap. RLS enabled at creation. This is what makes the page show *stage-level*
  progress, not just a phase checkbox.
- **RPCs** (SECURITY DEFINER, granted anon+authenticated): `get_crm_build_progress()`
  returns phases with their nested stages and a done/total count per phase (+ overall);
  `set_crm_phase_status(p_phase_key, p_status)` and `set_crm_stage_status(p_stage_id,
  p_status)` are the one-call updates every phase runs at its close (`shipped_at = now()`
  on `shipped`).
- **Minimal shell + roadmap page** — the `page:crm` feature flag (with
  `dev_only_user_id`), the `/crm` route tree + `FeatureRoute` gate + a bare `CrmLayout`,
  and the read-only **`/crm/roadmap`** page: every phase with its status, its stages as a
  checklist, and a progress bar per phase + overall. It reads `get_crm_build_progress()`
  and is the **single source of truth for where the build is** — replacing any external
  tracker (no Asana/Trello; the page + git are the record). Phase 1 replaces the bare
  layout with the full designed shell; Phase 0 just establishes the route, flag, and
  progress view.

**Every later phase, at its close, updates this page** via the status RPCs (baked into
each phase's close-out checklist and the `CLAUDE.md` CRM Phase Workflow). Open
`/crm/roadmap` any time to see exactly what's done and what's next.

### Phase 1 — CRM shell + CallRail lead ingestion (calls + form submissions)

> **Branch:** `crm/phase-1-shell-callrail` — cut off `dev`.
> **Prerequisite:** Phase 0 merged into `dev` (`page:crm` flag, `/crm` shell skeleton, `crm_orgs`, `crm_build_phases` + `set_crm_phase_status` present).
> **Read scope:** a session building this phase reads *this* block + `CLAUDE.md` (generic build & close-out rules) — not the whole roadmap. This block holds the concrete specifics; the generic rule lives in `CLAUDE.md`.
> **Close-out checklist (all true before the `dev → main` PR):**
> - [ ] Test-first, now green: **(b)** `upsert_lead_from_callrail` idempotency — integration test vs the Supabase `dev` branch, a redelivered webhook must not duplicate/clobber the row; **(c)** `shouldCreateContact({spam_flag, duration_sec})` filter — vitest unit.
> - [ ] Every Phase 1 acceptance criterion passes (see the "Phase 1 — verification & acceptance" section).
> - [ ] `npm run test` + `npm run build` + `npx eslint` (changed files) pass.
> - [ ] `upr-pattern-checker` clean; `crm-phase-reviewer` (Opus) signs off against the criteria.
> - [ ] Visual check vs the Stitch handoff — **Call Log** + **Integrations** screens at `crm-phase-1-shell-callrail.utah-pros-app-git.pages.dev`.
> - [ ] `UPR-Web-Context.md` updated (`inbound_leads` table + RPCs, the CRM shell / Call Log / Integrations pages, `callrail-webhook.js`).
> - [ ] Set the `phase-1` row to `shipped` via `set_crm_phase_status`; delete test rows by the dev tracking number (Test-data isolation).
> - [ ] Pushed to `dev`, verified on `dev.utahpros.app`, then `dev → main` PR opened.

CallRail's UTM/dynamic-number-insertion is already live on the site (confirmed), and
scope now explicitly includes web-form leads alongside calls, not just calls — CallRail's
own Lead Center / Form Tracking product is the working assumption for capturing forms
under the same attribution model as calls (see open items — needs a one-line
confirmation this is actually how the site's quote form is wired before build starts).

- **CRM shell — the full designed shell** (Phase 0 established the bare `/crm` route +
  `page:crm` flag + `CrmLayout`; Phase 1 builds the real thing): the contextual left
  sidebar (Overview, Leads, Call Log, Tasks, Attribution, Reports, Integrations,
  Settings — see the design-decisions section above), the `--crm-*` scoped token set
  under a `.crm-shell` wrapper (mirroring `.tech-layout`), new SVG icon components
  following the `IconXxx(p)` convention, and a **CRM** entry added to the real UPR top
  nav. Only Call Log and Integrations have real data behind them this phase — the rest
  of the shell's nav items exist but their screens fill in during Phases 2–4d, same
  container throughout.
- **New table** `inbound_leads` (not `calls`, and not `leads` — see the terminology
  note below on why): `id, contact_id
  (FK contacts, nullable until matched), source_type ('call'|'form'), callrail_id
  UNIQUE, tracking_number (nullable for forms), caller_number (nullable for forms),
  duration_sec (nullable for forms), spam_flag BOOLEAN, source, medium, campaign,
  recording_url (nullable), transcription (nullable), form_data JSONB (nullable),
  lead_status, value, direction, occurred_at, raw_payload JSONB, created_at`. RLS
  enabled, writes via RPC only, consistent with every other table added since the
  Estimates module (see `UPR-Web-Context.md` conventions section). Store only the
  CallRail-hosted `recording_url` link rather than re-downloading audio into Supabase
  storage — avoids duplicating storage and compliance surface for a first pass.
  > **Transcripts (resolved post-launch): sourced from Deepgram, NOT CallRail.**
  > Our CallRail plan returns `transcription: null` on every call — CallRail's API only
  > exposes transcripts with its **Premium Conversation Intelligence add-on (~$110/mo)**.
  > Rather than pay that, we transcribe the recording ourselves with **Deepgram**
  > (~a few $/mo at our volume) and write the result into this same `transcription`
  > column via `set_lead_transcription`. See `functions/api/transcribe-call.js` +
  > `functions/lib/deepgram.js`. Columns `transcription_source`, `transcribed_at`
  > (`20260701_crm_call_transcription.sql`) + `transcript_analysis jsonb`
  > (`20260701_crm_call_transcription_analysis.sql`) hold provenance + structure.
  > **v2:** `model=nova-3` + `multichannel` (CallRail records Agent/Customer on
  > separate stereo channels → exact speaker separation, diarize is the mono
  > fallback) + Audio Intelligence (`summarize=v2`, `sentiment`, `topics`,
  > `detect_entities`). The Call Log renders a conversation view (summary,
  > sentiment badge, topic chips, Agent/Customer turns). Strategic upside: the
  > transcripts + entities live in our DB, feeding future lead-name capture /
  > scoring, instead of being locked in CallRail.
  > **Speaker naming (shipped):** a Claude Haiku pass names the Agent vs Customer
  > and each person (best-effort), and auto-captures the caller's name onto the
  > lead (`caller_name`; backfills a blank linked contact, never creates one). The
  > transcript renders as grouped speaker blocks; topics capped to the top 6.
  > **Attribution + qualify (shipped):** each call shows a **campaign label** for the
  > tracking number it was dialed from (CallRail leaves campaign/source empty on
  > direct dials, so the number is the ad-source identity) — labels live in
  > `crm_tracking_numbers`, editable inline on the Call Log. Each lead also has an
  > inline **notes + dollar value** editor (`set_lead_details`).
- **Ingestion RPC**: `upsert_lead_from_callrail(...)` (SECURITY DEFINER) —
  - Matches/creates a contact by **`caller_number`** (never `tracking_number`, which
    is UPR's own number) exactly like `twilio-webhook.js:78` does today
    (`contacts.phone=eq.…`).
  - **Only auto-creates a new contact when `NOT spam_flag AND (duration_sec IS NULL OR
    duration_sec >= 15)`** — filters out spam/robocalls/wrong numbers/hangups so the
    contacts table doesn't get polluted with junk. Below that bar, the lead row still
    gets logged (for visibility) but stays unlinked to a contact.
  - Upserts on `callrail_id` — CallRail fires more than one webhook per call (call
    completed, then recording/transcript ready minutes later), so this needs to be a
    true upsert-and-merge, not an insert-once.
  - Logs a `system_events` row.
- **Follow-up RPC**: `update_lead_status(p_lead_id, p_status, p_notes, p_updated_by)`
  — staff need to work these inside UPR (mark qualified/booked, leave a note), not just
  view a read-only log. Ingestion alone isn't the full Phase 1 job.
- **Worker**: `functions/api/callrail-webhook.js`, built directly off the
  `twilio-webhook.js` / `sync-encircle.js` template — auth check (shared secret or
  signature, confirm exact mechanism against CallRail's webhook docs during build),
  map payload → `upsert_lead_from_callrail`, return 200 on success and on most
  failures (avoid retry storms), log failures for follow-up. **Reads the CallRail API
  key from `integration_credentials` (provider='callrail'), not a Cloudflare env
  var** — connected through the new Integrations page (see design-decisions section
  above), same generic table QBO already uses.
- **One-time backfill**: `functions/api/callrail-backfill.js` (manually triggered, not
  a cron) — pulls CallRail's historical calls + form leads via their list REST API (as
  far back as their plan retains, typically 12-24 months) through the same
  `upsert_lead_from_callrail` RPC, so the Phase 3 dashboard has real trend data on day
  one instead of being empty for weeks.
- **Frontend**: the Call Log screen inside the new `/crm` shell (not bolted onto the
  existing `Leads.jsx`, which stays exactly what it is today — "jobs in lead phase" —
  and is unrelated to the new CRM shell). Also surfaces on the contact detail view via
  a small activity entry.
- **Feature flag**: new `page:crm` flag with `dev_only_user_id` set to Moroni's
  employee id, gating the whole `/crm` shell — invisible to every other employee/tech
  on both `dev` and `main` until explicitly opened up (see the walled-off-build
  section above). Sub-feature flags (`feature:crm_pipeline`, `feature:crm_campaigns`,
  `feature:crm_automations`) layer on top as later phases ship, per the cross-cutting
  foundations above.

### Phase 2 — Ad spend ingestion

> **Branch:** `crm/phase-2-adspend` — cut off `dev`.
> **Prerequisite:** Phase 1 merged into `dev`; **and** the Google Ads developer token approved (long-lead — apply during Phase 1, see Pre-Phase-1 action items).
> **Read scope:** this block + `CLAUDE.md` (generic rules). Concrete specifics below.
> **Close-out checklist (all true before the `dev → main` PR):**
> - [ ] Test-first, now green: **(d)** Mountain-Time date helpers — `mountainYesterday(nowUtc)` + `isStale(lastUtc, nowUtc, days)`, vitest unit (UTC storage, MT day boundary).
> - [ ] Acceptance: daily cron upserts *yesterday's* spend into `ad_spend` idempotently (unique `platform+campaign_id+date`); one-time ~12-month backfill matches each platform's own dashboard within a stated tolerance; Google **and** Meta connect via `integration_credentials` (Integrations page), no hardcoded tokens; a `worker_runs` row per sync run.
> - [ ] `npm run test` + `npm run build` + `npx eslint` (changed files) pass.
> - [ ] `upr-pattern-checker` clean; `crm-phase-reviewer` (Opus) sign-off.
> - [ ] Visual: **n/a** (backend ingestion) — verify rows land via Supabase; the branch preview build stays green.
> - [ ] `UPR-Web-Context.md` updated (`ad_spend` table, `sync-google-ads.js` / `sync-meta-ads.js` workers).
> - [ ] Set the `phase-2` row to `shipped` via `set_crm_phase_status`; delete any test spend rows.
> - [ ] Pushed to `dev`, verified, `dev → main` PR opened.

- **New table** `ad_spend` — `id, platform ('google'|'meta'), campaign_id,
  campaign_name, date, spend, impressions, clicks, platform_conversions, created_at`,
  unique on `(platform, campaign_id, date)` for safe daily upserts.
  `platform_conversions` is deliberately named that (not `conversions`) and treated as
  **informational only** — Google/Meta each track their own conversions and will not
  reconcile with CallRail's numbers. **CallRail leads + actual won jobs in UPR are the
  one source of truth for the funnel**; the ad platforms only ever supply spend
  dollars to the Phase 3 dashboard's cost-per-lead math. This avoids two disagreeing
  "leads generated" numbers showing up on the same dashboard.
- **Workers**: `functions/api/sync-google-ads.js` and `functions/api/sync-meta-ads.js`,
  each a daily cron job (same cron pattern as `process-scheduled.js`), pulling
  yesterday's campaign performance and upserting into `ad_spend`. Each supports a
  one-time backfill run (past 12 months of daily spend, both APIs support historical
  reporting) on first deploy, same rationale as the CallRail backfill above.
- **Connected the same way as CallRail and QBO**: Google Ads and Meta both use real
  OAuth, so they follow the exact `/api/{provider}-connect` + `/api/{provider}-
  callback` worker pattern already proven by `quickbooks-connect.js`/`quickbooks-
  callback.js` — connected tokens land in `integration_credentials`, connected
  through the CRM's Integrations page. Only the OAuth app's own client ID/secret
  (shared, not per-connection) needs a Cloudflare env var, same as
  `QBO_CLIENT_ID`/`QBO_CLIENT_SECRET` today.
- Credentials needed before this phase starts: Google Ads developer token + OAuth
  app credentials, Meta app credentials for a long-lived System User token. **Start
  the Google Ads developer token application now, in parallel with Phase 1** — it's
  the longest lead-time item in the whole roadmap (approval can take days-to-weeks)
  and would otherwise stall Phase 2 the moment it starts.

### Phase 3 — Attribution + funnel dashboard

> **Branch:** `crm/phase-3-attribution` — cut off `dev`.
> **Prerequisite:** Phase 2 merged into `dev` (needs `ad_spend`) — and by extension Phase 1's `inbound_leads`.
> **Read scope:** this block + `CLAUDE.md` (generic rules).
> **Model note:** run the single **Opus 4.8 · High** design pass on the multi-touch attribution model *here, before* writing the metric code (first- vs last- vs weighted touch; reconcile CallRail's "converted" flag against UPR won-job truth).
> **Close-out checklist (all true before the `dev → main` PR):**
> - [ ] Test-first, now green (**a wrong number here misallocates real ad budget — these are not optional**): pure funnel/attribution calc functions, vitest unit — **cost-per-lead** (`spend/leads`), **ROAS** (`won$/spend`), **cost-per-job** (`spend/booked`), the **spend → lead → job → revenue** rollup, and the funnel conversion counts/rates (answered → leads → qualified → estimate sent → won); including the **null (not 0) for zero-spend sources** rule and division-by-zero guards.
> - [ ] Acceptance: dashboard shows spend → leads → estimates → won → revenue with Google Ads split by agency; **CallRail leads + won jobs are the single source of truth for counts**, ad platforms supply spend only; zero-spend sources (Referral/Organic/Insurance) render `—`, not `0`.
> - [ ] `npm run test` + `npm run build` + `npx eslint` (changed files) pass.
> - [ ] `upr-pattern-checker` clean; `crm-phase-reviewer` (Opus) sign-off — weight it on the attribution math (cross-check every displayed number against a hand calc).
> - [ ] Visual: **Attribution**, the **Overview** funnel, and **Reports** screens vs the handoff at `crm-phase-3-attribution.utah-pros-app-git.pages.dev`.
> - [ ] Set the `phase-3` row to `shipped` via `set_crm_phase_status`.
> - [ ] `UPR-Web-Context.md` updated; pushed to `dev`, verified, `dev → main` PR opened.

- Extend `referral_sources` (already 49 rows, already on the claims form) or add a
  lightweight `lead_attribution` join so every contact/lead can carry a source +
  campaign, populated from CallRail call data, ad click params (if captured via
  landing-page UTM), or manual entry.
- New page (reuse the `.coll-*` design system from Collections/Estimates, per the
  documented convention) showing: spend by platform/campaign → calls/leads generated →
  cost per lead → estimates → won jobs → actual revenue (joins to the existing
  QBO-synced job financials). This is the page that actually replaces the "5 different
  software" problem.

Phase 4 (the "replaces HighLevel" phase) is split into four one-session sub-phases —
**4a pipeline · 4b text blasts · 4c email · 4d automations** — each its own branch and
PR, in order.

### Phase 4a — Lead pipeline

> **Branch:** `crm/phase-4a-pipeline` — cut off `dev`.
> **Prerequisite:** Phase 3 merged into `dev` (linear chain). The *hard* dependency is the **Phase 1 shell + `pipeline_stages`**, so if reprioritized this can follow Phase 1 directly.
> **Read scope:** this block + `CLAUDE.md` (generic rules).
> **Close-out checklist (all true before the `dev → main` PR):**
> - [ ] Test-first, now green: any pipeline value math (e.g. weighted-pipeline `$` per stage) as a pure vitest unit; stage ordering respects `pipeline_stages.sort_order`.
> - [ ] Acceptance: Kanban driven by the editable `pipeline_stages` table (not a hardcoded enum); unified contact activity timeline (calls/forms + SMS + notes + estimates); columns reorder/rename from Settings with no code change.
> - [ ] `npm run test` + `npm run build` + `npx eslint` (changed files) pass; `upr-pattern-checker` clean; `crm-phase-reviewer` (Opus) sign-off.
> - [ ] Visual: **Leads** (pipeline board) + the contact timeline vs the handoff at `crm-phase-4a-pipeline.utah-pros-app-git.pages.dev`.
> - [ ] Set the `phase-4a` row to `shipped` via `set_crm_phase_status`; `UPR-Web-Context.md` updated; pushed to `dev`, verified, `dev → main` PR opened.

- **Lead pipeline**: the CRM shell's Leads screen (not `Leads.jsx`, which is a
  separate, existing, unrelated page — see Phase 1) — a real Kanban, reusing
  `Production.jsx`'s existing Kanban pattern instead of building a board from
  scratch, with columns driven by the `pipeline_stages` table from the Settings
  section above (seeded with New → Contacted → Qualified → Estimate Sent →
  Won/Lost, but admin-editable from day one, not hardcoded) sitting in front of the
  existing lead → estimate → job funnel. Contact detail view gets a unified
  activity timeline (calls/forms from Phase 1, SMS from `conversations`, notes,
  estimate history) — this is UPR's answer to HighLevel's "unified inbox."
### Phase 4b — Text-blast campaigns

> **Branch:** `crm/phase-4b-text-blasts` — cut off `dev`.
> **Prerequisite:** Phase 4a merged into `dev`; **and Twilio SMS verification live AND the A2P 10DLC promotional/marketing campaign registered + carrier-approved** (see Pre-Phase-1 action items — this vetting takes days-to-weeks). Do **not** build/test the send path until both are confirmed.
> **Read scope:** this block + `CLAUDE.md` (generic rules).
> **Close-out checklist (all true before the `dev → main` PR):**
> - [ ] Test-first, now green: **(a)** `consentAllows(row)` consent gate — refuses to send on absent/withdrawn consent (vitest unit). The gate ships here first and is reused by 4c/4d.
> - [ ] Acceptance: recipients segmented off `contacts`/`referral_sources`; **every** send routes through `sendAutomatedMessage()` → the consent gate (`sms_consent_log` opt-outs), structurally un-bypassable; sends go via the existing `send-message.js` Twilio worker.
> - [ ] `npm run test` + `npm run build` + `npx eslint` (changed files) pass; `upr-pattern-checker` clean; `crm-phase-reviewer` (Opus) sign-off — weight it on the consent gate.
> - [ ] Visual: the campaign builder/list vs the handoff at `crm-phase-4b-text-blasts.utah-pros-app-git.pages.dev`.
> - [ ] Set the `phase-4b` row to `shipped` via `set_crm_phase_status`; delete test campaign/recipient rows (test `org_id`); `UPR-Web-Context.md` updated; pushed to `dev`, verified, `dev → main` PR opened.

- **Text blast campaigns**: finish out `Marketing.jsx` + the existing
  `campaigns`/`campaign_recipients` tables (already stubbed — "Bulk messaging coming
  in phase 11" was already a placeholder in the code before this project started).
  Segment recipients off `contacts`/`referral_sources`, send via the existing Twilio
  worker pattern (`send-message.js`), respect `sms_consent_log` opt-outs. **Gated on
  Twilio SMS verification + A2P 10DLC promotional-campaign approval** — do not
  build/test the send path until both are confirmed live.
### Phase 4c — Email campaigns

> **Branch:** `crm/phase-4c-email` — cut off `dev`.
> **Prerequisite:** Phase 4b merged into `dev`.
> **Read scope:** this block + `CLAUDE.md` (generic rules).
> **Close-out checklist (all true before the `dev → main` PR):**
> - [ ] Test-first, now green: the unsubscribe-suppression predicate (`emailAllows(row)` / an extension of the consent gate) — refuses to send to an unsubscribed address (vitest unit).
> - [ ] Acceptance: segmented bulk email via `functions/lib/email.js` (Resend); a simple template UI; **unsubscribe handling** wired (compliance requirement, not optional), following `EMAIL-DELIVERABILITY.md` rigor.
> - [ ] `npm run test` + `npm run build` + `npx eslint` (changed files) pass; `upr-pattern-checker` clean; `crm-phase-reviewer` (Opus) sign-off.
> - [ ] Visual: the email campaign builder vs the handoff at `crm-phase-4c-email.utah-pros-app-git.pages.dev`.
> - [ ] Set the `phase-4c` row to `shipped` via `set_crm_phase_status`; `UPR-Web-Context.md` updated; pushed to `dev`, verified, `dev → main` PR opened.

- **Email campaigns**: extend `functions/lib/email.js` (Resend, currently
  transactional-only) to segmented bulk sends — needs list building/segmentation, a
  simple template UI, and unsubscribe handling (real compliance requirement for
  marketing email, not optional). Follow the same rigor already documented in
  `EMAIL-DELIVERABILITY.md` for the transactional side.
### Phase 4d — Fixed automations

> **Branch:** `crm/phase-4d-automations` — cut off `dev`.
> **Prerequisite:** Phase 4c merged into `dev` (needs the SMS + email send helpers + consent gate from 4b/4c).
> **Read scope:** this block + `CLAUDE.md` (generic rules).
> **Close-out checklist (all true before the `dev → main` PR):**
> - [ ] Test-first, now green: reuse **(d)** `isStale()` for the no-response follow-up trigger (vitest unit); each automation's trigger predicate fires the right `system_events` type; **(a)** consent gate reused on every send.
> - [ ] Acceptance: the 4 fixed automations (speed-to-lead, missed-call text-back, no-response follow-up, job-complete review) each route through `sendAutomatedMessage()` → consent gate, fire off `system_events`, and are individually on/off-toggleable via `automation_settings`.
> - [ ] `npm run test` + `npm run build` + `npx eslint` (changed files) pass; `upr-pattern-checker` clean; `crm-phase-reviewer` (Opus) sign-off — weight it on the consent gate + trigger correctness.
> - [ ] Visual: the `automation_settings` toggles in **Settings** at `crm-phase-4d-automations.utah-pros-app-git.pages.dev` (the automations themselves are backend).
> - [ ] Set the `phase-4d` row to `shipped` via `set_crm_phase_status`; delete test automation rows; `UPR-Web-Context.md` updated; pushed to `dev`, verified, `dev → main` PR opened.

- **Four fixed automations** (deliberately not a visual workflow builder — see the
  completeness assessment above): 
  1. **Speed-to-lead** — auto-text within seconds of a new inbound call/form lead
     (Phase 1's `inbound_leads` table gives the trigger). This is one of the highest-ROI
     automations in home-services lead gen and the cheapest to build once SMS is live.
  2. **Missed-call text-back** — auto-text if a tracking-number call goes unanswered.
  3. **No-response follow-up** — auto-text/email N days after a lead goes cold with no
     activity.
  4. **Job-complete review request** — auto-text/email asking for a Google review,
     triggered off `job_phase_history` reaching a completed phase.

**Building the 4 automations so they're forward-compatible with a future visual
builder, without building that builder now:**

The difference between "4 hardcoded automations" and "a visual automation builder" is
just: are triggers/actions generic, reusable primitives, or one-off inline code? If
built the right way now, a future builder becomes an additive UI layered on top later,
not a rewrite. Four cheap choices now, all still in scope for Phase 4:

1. **Every trigger fires through `system_events`** (already exists, already used for
   audit) instead of being buried inline in ingestion RPCs — e.g. a
   `lead_created`/`call_missed`/`lead_stale`/`job_completed` event row. This is exactly
   the substrate a future rule engine would subscribe to.
2. **Each automation is a small, named, independent unit** (one function/case per
   automation in `functions/api/automations.js`, not scattered logic) that reads the
   triggering event and calls one shared helper — `sendAutomatedMessage(channel,
   contact_id, template_key, variables)` — rather than one-off inline SMS/email code.
   That shared helper *is* the "action" primitive a future builder would reuse
   unchanged.
3. **Message bodies go through the existing `message_templates` table** (already
   supports variable substitution) instead of hardcoded strings — so "pick a
   template" as a builder step is already true from day one.
4. **One lightweight `automation_settings` table** (`id, key, enabled BOOLEAN,
   updated_by, updated_at` — 4 rows, mirrors the existing `feature_flags` pattern)
   gives Moroni an on/off toggle per automation in Settings *today*, no deploy needed
   — and doubles as the seed schema a real rule table (`trigger_type`, `conditions
   JSONB`, `actions JSONB`) would grow from later; expanding it is additive columns,
   not a redesign.

**Explicitly not building now** (this is the actual "visual builder" complexity,
deliberately deferred): a conditions builder (branching logic like "if source = Google
Ads AND no response in 48h"), multi-step/delayed sequences, or any UI to define new
automations without a code change. That's real scope — worth its own roadmap, not
smuggled into Phase 4.

### Phase 5 (future, not scheduled) — Visual automation builder

> **Branch:** `crm/phase-5-automation-builder` — cut off `dev` (when scheduled).
> **Prerequisite:** Phase 4d's 4 fixed automations shipped and proven valuable, **and** a real 5th/6th automation need that doesn't fit as fixed code (that need is the go-signal, not a date).
> **Close-out checklist:** defined when this phase is actually scheduled — it inherits the same generic close-out rule (`CLAUDE.md`) as every other phase.

Only worth starting once the 4 fixed automations have proven valuable *and* a 5th/6th
need shows up that doesn't fit neatly as fixed code — that's the actual signal it's
time, not a calendar date. When that happens, because Phase 4 already routes
everything through `system_events` + the shared `sendAutomatedMessage` primitive +
`message_templates`, this phase is genuinely additive:
- Promote `automation_settings` into a real `automation_rules` table (`trigger_type`,
  `conditions JSONB`, `actions JSONB` array, `enabled`, `sort_order`).
- A generic rule-evaluation engine that subscribes to `system_events` and matches
  rules instead of the current one-hardcoded-automation-per-event-type approach.
- A builder UI (trigger picker → condition builder → action sequence), reusing the
  same `.coll-*` design system as everything else.
- An `automation_runs` execution log for debugging/analytics (which rule fired, for
  which contact, when, outcome) — the audit-trail pattern already established via
  `system_events`/`worker_runs` elsewhere in the app.

This is deliberately **not** part of the current build order — flagged here so it's a
known, sized future option rather than a surprise rewrite, and so Phase 4 doesn't
accidentally paint the app into a corner that makes this harder later.

---

## Testing, acceptance & review model (applies to every phase)

Three gates every phase clears before its `dev → main` PR. Specified once here; each
phase inherits it. This is the part of the build most worth getting right.

**1. Test-first (write the failing test, commit it, then make it pass).** Vitest is
already in the repo (verified: `vitest ^4.1.4`, `npm run test` → `vitest run`, precedent
at `src/lib/psychrometric.test.js`) and CI already runs `npm test` — so committed tests
are real, enforced signal, not decoration. For each target below: **write and commit the
test FIRST, watch it fail, then write the implementation until it passes. Do not edit a
committed test to make it go green — fix the code.** The four required targets, with an
honest split (verified against the repo — there is currently **no test harness for
Cloudflare Workers or SQL RPCs**, so pure logic must be authored as importable JS to be
unit-testable, and RPC behavior is inherently an integration test):

| # | What | Phase | Test type & how |
|---|------|-------|-----------------|
| a | `sendAutomatedMessage()` consent gate — refuses to send on absent or withdrawn consent | 4 | **Unit** (vitest). Author the consent decision as a pure JS predicate in `functions/lib/` (e.g. `consentAllows(row)`), imported by both the worker and the test. |
| b | `upsert_lead_from_callrail` idempotency — a redelivered webhook must not duplicate or clobber the existing row | 1 | **Integration** — a SQL RPC can't be a pure unit test. Seed a row, call the RPC twice with the same `callrail_id`, assert one row + no clobbered fields, run against the Supabase **dev branch** via the already-allow-listed `execute_sql` MCP. |
| c | spam / `duration_sec >= 15` contact-creation filter | 1 | **Unit** (vitest) on a pure `shouldCreateContact({spam_flag, duration_sec})` predicate, **plus** an integration assertion the RPC honors it. |
| d | Mountain-Time "yesterday" / "N-days-stale" boundary for `ad_spend` + staleness | 2 (reused 4) | **Unit** (vitest) on pure date helpers (`mountainYesterday(nowUtc)`, `isStale(lastUtc, nowUtc, days)`) — the cleanest test-first target of the four. |

Note the user framed all four as "unit tests"; (b) is reclassified to integration
because it exercises a SQL RPC — the test-first discipline still applies, just against
the dev-branch DB. CI (`ci.yml`) only runs on PRs to `main` / pushes to `main` — **not**
on `dev` or feature branches — so a committed failing test won't visibly gate until the
`dev → main` PR. To make the gate bite earlier, add a `pull_request` → `dev` trigger to
`ci.yml` (task, not a blocker).

**2. Committed acceptance criteria.** Each phase ships an explicit, committed
acceptance-criteria block in `docs/crm-roadmap.md` — binary, checkable "done" conditions
(Phase 1's are below), not vibes.

**3. Independent review pass.** At each phase end, a **separate review subagent**
(`crm-phase-reviewer`, defined in the tooling section) grades the phase against its
committed criteria. It is distinct from `upr-pattern-checker` (a mechanical rules
linter): the reviewer grades the *spec*, the linter checks the *rules*. It runs on
**Opus** — deliberately a stronger, different model than the Sonnet-5 builder, so it's
not the same model grading its own homework — and is most valuable on the money/consent
code.

**Visual verification (the CRM shell, and Phases 3 & 4 screens).** After the phase
deploys, screenshot the real preview deploy and compare against the Stitch handoff — NOT
localhost, and it is not Netlify. Verified preview pattern:
**`<branch>.utah-pros-app-git.pages.dev`** (Cloudflare project slug confirmed as
`utah-pros-app-git`; production `utahpros.app`, staging `dev.utahpros.app`). Drive it
with browser automation — a browser MCP if one is connected, otherwise the Chromium
already present in this environment (the one used to render the handoff earlier). Confirm
the deploy succeeded first via the Cloudflare MCP (`mcp__Cloudflare_Developer_Platform__*`,
connected). Caveat: docs don't mention Cloudflare Access on previews (they read as
public), but if Access is ever enabled, preview URLs must be exempted or the browser
can't reach them.

## Phase 1 — verification & acceptance

**Committed acceptance criteria (Phase 1 is done when ALL are true):**
- A real call through the dedicated dev tracking number lands exactly one `inbound_leads`
  row (`source_type='call'`) and matches/creates the right `contacts` row by
  `caller_number`.
- A test website form (if in scope) lands one `inbound_leads` row (`source_type='form'`).
- A redelivered webhook for the same call updates — does not duplicate — that row (test b).
- A spam / sub-15-second call logs an `inbound_leads` row but creates **no** contact (test c).
- The backfill against `dev` produces a row count matching CallRail's dashboard within a
  stated tolerance.
- Every inbound lead writes a `system_events` row; every worker run writes a `worker_runs` row.
- The CallRail API key is read from `integration_credentials`, never a hardcoded secret.
- `npm run test`, `npm run build`, and `npx eslint` on changed files all pass; the
  `crm-phase-reviewer` agent signs off against these criteria.

**End-to-end:** push the CRM shell + CallRail worker + table to `dev`, fire a real test
call through the dedicated dev number, submit a test form, redeliver a webhook, fire a
spam/short call, run the backfill against `dev` and spot-check counts, then screenshot
the Call Log + Integrations screens at `<branch>.utah-pros-app-git.pages.dev`. Only after
all acceptance criteria pass on `dev` does a `dev → main` PR ship it.

**On shipping to `main`:** never a direct push — but be precise about *why* it's safe,
because the earlier draft overstated it (corrected in the tooling section): the "agent
won't push to main" behavior is a Claude Code safety-classifier heuristic (agent-only,
not a hard guarantee), CLAUDE.md's rule is a **convention**, and the only real gate is
CI's `verify` check being marked Required in GitHub branch protection — unverifiable from
here, so it's a task below.

---

## Open items to confirm before Phase 1 starts

- Exact CallRail webhook auth mechanism (shared-secret query param vs. signature
  header) — confirm against CallRail's current docs at build time, the assumption
  above is a placeholder.
- ~~Whether CallRail is already configured with UTM passthrough~~ — confirmed already
  live, no longer a blocker.
- **Whether the website's lead/quote form is wired through CallRail's own Form
  Tracking / Lead Center product**, or is a separate system entirely (e.g. a
  Webflow/WordPress form emailing a lead somewhere) — this determines whether form
  leads flow through the same `callrail-webhook.js` ingestion as calls (Phase 1's
  working assumption) or need a second, differently-shaped integration. One-line
  answer from CallRail's dashboard settings resolves this before build starts.

## Pre-Phase-1 action items (yours, in parallel — not code)

- Allocate a dedicated CallRail **test/dev tracking number** and point its webhook at
  the `dev` deploy URL, so testing never touches live production call routing. (This is
  also the disposable tag for Test-data isolation.)
- Kick off the **Google Ads developer token application** now — see Phase 2 above,
  one of the two longest lead-time items in the roadmap (approval days-to-weeks).
- Kick off **A2P 10DLC brand + campaign registration** now (gates Phase 4b text
  blasts). Promotional/marketing bulk SMS goes through carrier vetting that also takes
  days-to-weeks, separate from the general Twilio number verification already in
  progress — and the existing `send-message.js` 10DLC setup is sender-level, not a
  registered promotional campaign. **Confirm the exact campaign type (e.g. Low-Volume
  vs Standard Marketing) and its timeline directly with Twilio** so the registration
  matches the text-blast use case.
- Confirm the form-tracking question directly above.

---

## Workflow playbook: using Claude Code more efficiently on this build

You asked how to get more out of subagents/Claude Code so this build (and future ones)
goes faster, cleaner, and cheaper on tokens. Plain-language version, plus two concrete
setup pieces proposed below.

**How subagents actually save context — the mechanism.** A subagent works in its own
side room: it can read a dozen files, run greps, chase down dead ends, and none of
that messy scratch work lands in our conversation — only its final summary does.
That's exactly what happened earlier this session: two Explore agents dug through the
whole repo (CRM code, `UPR-Web-Context.md`) and you only ever saw two clean summaries,
not the 40+ file reads behind them. That's the core trick, and it's automatic
whenever I reach for the Agent tool — you don't have to do anything extra to get it.

- **Use it for**: broad or uncertain searches ("where does X live," "how does Y
  currently work") — anything read-only/investigative.
- **Skip it for**: small, obvious edits. Spinning up an agent for a one-line fix adds
  overhead for no benefit.

**Custom subagents (`.claude/agents/*.md`) — two of them here**, each a saved persona
with a fixed job, the minimum tools, and an explicit `model:` in frontmatter:
- **`upr-pattern-checker`** — a mechanical rules linter that reads changed files and
  flags violations of the `CLAUDE.md` non-negotiables (`useAuth()` only, no
  `alert()`/`confirm()`, CSS tokens not hardcoded hex, two-click delete, RPC-only writes
  on new tables). Frontmatter: **`model: sonnet`** (mechanical pattern-matching, no deep
  reasoning), **`tools: Read, Grep, Glob`** (read-only — it inspects, never edits). Run
  at the end of each phase.
- **`crm-phase-reviewer`** (new) — the independent acceptance-criteria grader from the
  testing model above. Frontmatter: **`model: opus`** — deliberately a stronger,
  different model than the Sonnet-5 builder, because its value is being an independent
  set of eyes on the money/consent code, not the same model checking itself. Runs once
  per phase against that phase's committed criteria. Distinct from
  `upr-pattern-checker`: one grades the spec, the other lints the rules.
- **Explore/recon agents** default to **`model: haiku`** (locating code is cheap),
  bumped to **`model: sonnet`** only when the agent must *synthesize how something works*
  rather than just find where it is — like the QBO-integration trace earlier this session.

**Scaffolding as a skill, not a slash command.** Custom commands were merged into skills
in April 2026 and skills are the current recommended format, so the repeated per-phase
scaffold (new `org_id`-scoped table + RPC + flag + route + nav item + a failing test
stub) lives at **`.claude/skills/new-crm-module/SKILL.md`**, not `.claude/commands/`.
(The repo's existing `.claude/commands/invoice.md` still works — commands weren't
removed — but new work should be a skill.) A skill has no `model:` field; it runs on
whatever model the session is set to.

**Context management day-to-day:**
- `CLAUDE.md` auto-loads every session — that's why I already know your rules without
  you repeating them each time.
- Natural session boundary for this build: **one phase, one session.** Start fresh for
  Phase 2 rather than continuing Phase 1's session, and update `UPR-Web-Context.md` at
  the end of each phase so the next session (mine or a future one) picks up cold with
  full context.
- Inside one long working session, if things get sluggish, `/compact` condenses the
  conversation while keeping `CLAUDE.md` loaded — no need to lose everything and start
  over.
- **Plan mode** (what we're using right now) is a good default for anything
  non-trivial: it blocks me from touching anything until you approve, and it pushes
  exploration into subagents so the actual conversation stays short and readable —
  exactly what you saw happen with the CRM research above.

**The Workflow/orchestration tool** (fan out to many agents at once, with
verification passes) is real and powerful, but it's built for a different shape of
problem — "audit every page in the app," "research this five ways and cross-check" —
not a linear, one-feature-at-a-time build like this CRM roadmap. It spends real tokens
by design (dozens of agents running in parallel). **Skip it for the CRM phases**; it's
worth reaching for later if you ever want a big one-shot sweep, e.g. "audit every page
for a missing feature flag."

**Model & effort strategy (you set this per session in the web UI — written guidance,
not something a config file executes).** Sonnet 5 (released June 30, 2026, available in
Claude Code) is the correct default for this build:
- **Sonnet 5 · Medium effort** — scaffolding: tables, routes, nav, CRUD screens, the
  shell. High-volume, low-ambiguity work.
- **Sonnet 5 · High effort** — logic-dense work where a subtle bug is expensive: the
  RPCs, upsert-and-merge idempotency, the consent gate, the Mountain-Time math, the
  attribution joins.
- **Opus 4.8 · High effort** — reserved for a single focused design pass on the
  multi-touch attribution model (first-touch vs last-touch vs weighted, and reconciling
  CallRail's "converted" flag against UPR's won-job truth), where a wrong call is
  expensive to unwind. Also the model behind `crm-phase-reviewer`.
- **Crossover rule:** if Sonnet 5 at max effort repeatedly stalls on the *same* problem,
  switch to Opus 4.8 rather than pushing Sonnet harder — past that stall point Opus is
  both more accurate and cheaper per unit of quality.

**Enforcement hooks (`.claude/settings.json`) — extend, don't replace.** The file today
holds only a `SessionStart` install hook + two Supabase permissions (verified); the new
hooks are added alongside it, nothing removed. Two hooks:
- **`PreToolUse` on `Write|Edit`** — block writes to `.env*` files and block content
  matching secret patterns (API keys, `SUPABASE_SERVICE_ROLE`, long JWT/base64-looking
  literals); exit non-zero to deny. Real protection: connected credentials belong in
  `integration_credentials` / Cloudflare env, never committed.
- **`PostToolUse` on `Write|Edit` of `.js`/`.jsx`** — `npx eslint --fix` on the **edited
  file** (fast; scoped to one file so it never trips the repo's verified 175-error
  pre-existing lint baseline that `eslint .` would surface). **Honest tradeoff:** the ask
  was to also run `npm run build` here, but a full `vite build` after *every* edit is
  slow (a phase touches dozens of files). Recommendation — run `npm run build` in a
  **`Stop` hook** (once when I finish a turn) instead of per-edit; it honors the intent
  (build must pass before "done") without dozens of redundant builds. Say the word if you
  want it literally per-edit.

**The "can't push to `main`" claim — corrected (this was overstated before).** The
earlier draft said the platform "blocks direct pushes to `main` by design." Fixed: that
is a Claude Code **safety-classifier heuristic** discouraging the *agent* from pushing a
default branch — agent-only, not a hard guarantee, and no substitute for server-side
protection. CLAUDE.md's "never push `main`" is a **convention** (realistically ~70%
adherence for a discipline-dependent rule). The only real gate is GitHub branch
protection marking CI's `verify` check Required — and `ci.yml`'s own header comment says
the workflow "does not enforce anything by itself" without it. Branch-protection state is
not readable from this environment (no MCP/`gh` access to it), so: **task — confirm a
branch-protection rule on `main` exists (Required check = `verify`; restrict direct
pushes); create it if it doesn't.**

**Concrete tooling to create at build start (all small config/doc files, no app risk):**
1. **`docs/crm-roadmap.md`** — commit this plan as the repo's roadmap of record. It does
   **not exist yet** (verified) — the roadmap has lived only in the ephemeral plan file
   so far — so step 0 of the build is writing it into the repo where future sessions read
   it.
2. `.claude/agents/upr-pattern-checker.md` — `model: sonnet`, `tools: Read, Grep, Glob`.
3. `.claude/agents/crm-phase-reviewer.md` — `model: opus`, acceptance-criteria grader.
4. `.claude/skills/new-crm-module/SKILL.md` — per-phase scaffold (skill, no `model:` field).
5. `.claude/settings.json` — add the PreToolUse secret/`.env` block + PostToolUse eslint
   (+ Stop-hook build), **extending** the existing SessionStart hook and permissions.
6. `.github/workflows/ci.yml` — optional `pull_request` → `dev` trigger so the test gate
   bites on the dev PR, not only the `dev → main` PR.

---

# Roadmap v3 — Gap-audit extension, Foundation phase & max-parallel dispatch (2026-07-02)

This section was produced by the roadmap-v3 planning session (gap audit vs the full CRM
capability taxonomy, adversarially reviewed by a 10-agent challenge pass) and is the
**current dispatch model of record**. It supersedes the sequential rule above and the
"one wave at a time" assumption. Statuses below were verified against the live
`crm_build_phases`/`crm_build_stages` tables on 2026-07-02, not assumed from this doc.

## Status reconciliation (live DB, 2026-07-02)

| Phase | Live status | Notes |
|---|---|---|
| 0, 2, 3, 4a, 4c | `shipped` | See stale-todo disclosures below |
| 1 | `in_progress` (4/8 stages) | Open: acceptance-criteria pass, visual check vs Stitch (owner-gated), set-shipped + test-row cleanup, push/verify/PR. **Plus a new stage added by v3: form-capture verification** — the CallRail form path is wired but untested at every layer (no `mapFormPayload` test, no `source_type='form'` ingestion test, payload shape guesswork per the backfill's own comment) |
| 4b | `planned` | **Still blocked on A2P 10DLC carrier approval** (external, not confirmed anywhere in repo). Joins the parallel wave whenever approval lands — Phase F dissolves its code seams |
| 4d, 5 | `planned` | 4d dispatches in the wave; 5 stays future/gated |

**Stale-todo disclosures (honest checkbox reconciliation, not silently flipped):**
Phase 2 "Pushed to dev… PR opened" is still `todo` despite the phase being `shipped`;
Phase 3, 4a, 4c visual-check stages are `todo` (owner-gated Stitch comparisons); 4c's
"Set shipped… PR opened" stage is `todo`. These are disclosed here as owner-gated /
housekeeping items — the phases' code genuinely shipped.

**P0 finding fixed in Phase F (interim guidance until it lands):** the live
`merge_contacts` RPC (never committed as a migration — schema drift) reassigns only 14
legacy FK tables before deleting the losing contact, so a merge today CASCADE-deletes
that contact's `lead_attribution` + `email_campaign_recipients` +
`email_campaign_exclusions` rows and SET-NULLs their `inbound_leads.contact_id`.
Exposure verified zero (8 merges ever, all pre-CRM, last 2026-06-18). **Until Phase F
merges: do not merge contacts that have CRM activity** (anyone who called or received a
campaign email since 2026-07-01).

## Gap-audit appendix (evidence-based; HAVE only from code/schema, never from docs)

| # | Capability | Verdict | Evidence |
|---|---|---|---|
| A | Contact records (rich fields, addresses) | PARTIAL | `contacts` 40+ cols + `contact_addresses`/`contact_jobs`; no CRM contacts page |
| A | Duplicate detection / merge | PARTIAL + P0 bug | `get_duplicate_contacts` (phone-only) + `merge_contacts` RPCs live but drifted (not in migrations); merge UI exists (`MergeModal.jsx` ×5 pages + DevTools); merge destroys CRM history (see P0 above) |
| A | Tags / saved segments | PARTIAL / MISSING | `contacts.tags` + campaign tag filter; no tag mgmt UI, no segments table |
| A | Unified do-not-contact | MISSING | Split across `contacts.dnd`, `opt_in_status` (SMS), `email_suppressions` (email) |
| A | Ownership + lifecycle | MISSING | No owner/lifecycle columns |
| A | CSV import/export | MISSING | — |
| B | Capture: calls | HAVE | `callrail-webhook.js` → `upsert_lead_from_callrail` (unique `callrail_id`), tested |
| B | Capture: forms | **wired, unverified** | Webhook isForm branch + `mapFormPayload` + null-safe UI exist; zero form tests; payload shape guesswork; backfill calls-only |
| B | Lead scoring / assignment / speed-to-lead SLA / win-loss reasons | MISSING | — |
| C | Kanban pipeline | HAVE | `pipeline_stages`-driven (`CrmLeads.jsx`, `get_pipeline_stages`), CRUD in Settings |
| C | Weighted pipeline value | PARTIAL | `stageWeight()` = positional ramp `(pos+1)/(open+1)` off sort_order — NOT probability (`crmPipeline.js:47-56`); no probability column |
| C | Stage-aging alerts / estimate cadence | MISSING | `lead_pipeline_stage` is current-stage-only (UNIQUE lead_id), no history |
| D | Unified timeline | PARTIAL | `get_contact_activity` = leads ∪ SMS ∪ job_notes ∪ estimates; no email/jobs/tasks arms; renders only in Leads detail panel |
| D | Tasks / overdue surfacing | MISSING | `CrmTasks.jsx` is the only stub page |
| E | Two-way SMS in CRM shell / click-to-call | MISSING | `/conversations` exists outside shell; no `tel:` in crm pages |
| E | Email send+reply logging | PARTIAL | Campaign sends logged (`email_campaign_recipients`); no 1:1 send or reply capture (manual-log scope only — no inbound parser, per scope) |
| E | Templates w/ variables | PARTIAL | `message_templates` + `renderTemplate()` exist; no CRM UI |
| F | One-shot email blasts | HAVE | Phase 4c: `CrmCampaigns.jsx` + `send-email-campaign.js` |
| F | One-shot SMS blasts | MISSING | Phase 4b, carrier-blocked |
| F | Drip sequences | MISSING | Biggest HighLevel parity gap → Phase 8 |
| F | Review tracking | MISSING | — |
| F | Unsubscribe on every send path | HAVE (email) | **Challenge-CONFIRMED:** `sendGatedEmail` is the only CRM path to `sendEmail()`; the campaign loop has no bypass branch; RFC 8058 headers + footer. Documented exemptions: transactional e-sign/2FA/calendar emails |
| G | 4 fixed automations / automation_settings | MISSING | Only `isStale()` + the `sendAutomatedMessage()` seam exist (`'sms'` throws); `automation_settings` appears only as checklist text |
| G | Run log | HAVE | `worker_runs` written by every CRM worker (`automation_runs` does not exist) |
| H | Attribution dashboard | HAVE | Real RPC data (`get_attribution_rollup`/`by_campaign`); `attributionData.js` is pure helpers, zero mocks |
| H | Fixed reports | PARTIAL | Live: source ROI, revenue-by-division, funnel conversion (+ROAS, by-campaign). Missing: trend, leaderboard, call volume, speed-to-lead, estimate aging, pipeline movement |
| H | CPL/ROAS with real QBO joins | PARTIAL | Revenue = denormalized `jobs.invoiced_value`, not a live invoice/payment join; math tested in `src/lib/attribution.js` |
| H | LTV / repeat-customer view | MISSING | — |
| I | Per-screen staff roles | PARTIAL | Only the `crm_partner` carve-out; no staff role model behind `page:crm` |
| I | Audit trail (system_events) | PARTIAL | 14 `crm_*` event types via SECURITY DEFINER RPCs. Uncovered: `set_campaign_exclusions`, `upsert_email_campaign` edits, `delete_email_campaign`, per-recipient send-time suppression; `crm_email_campaign_sent` fires with empty payload and can duplicate → Phase 6b audit hardening |
| I | org_id / RLS everywhere | HAVE | 100% of CRM tables RLS+policy at creation; org_id on parents (children scoped via parent; build tracker global by design; `integration_credentials` no-policy = worker-only, intentional) |
| I | Outbound webhooks/API | MISSING | Deferred — flagged future, no concrete need |
| J | Call summaries/sentiment/topics | HAVE | **Challenge-CONFIRMED:** `CrmCallLog.jsx` TranscriptView renders `transcript_analysis` (Deepgram nova-3 + Haiku speaker naming); field names match producer |
| J | Transcript lead-qual score / AI replies / weekly digest | MISSING | → Phase 9 |

## Phase F — Foundation: schema, interfaces & wiring (Wave 0)

> **Branch:** harness-assigned (illustrative: `crm/phase-f-foundation`) — cut off `dev`.
> **Prerequisite:** this roadmap-v3 PR merged into `dev`. Model: **Opus · high** (owns all schema + completes the consent gate).
> **Read scope:** this block + `CLAUDE.md`.
> **Close-out checklist (all true before the `dev → main` PR):**
> - [ ] Test-first, now green: merge_contacts CRM-safety integration test (committed failing against the live version — loser's `lead_attribution`/`email_campaign_recipients`/`inbound_leads` rows must survive on the winner); backward-compat tests for both shared RPC REPLACEs; `consentAllows(row)` unit tests; `normalizePhone` unit tests.
> - [ ] Acceptance: every wave table/column below exists with org_id + RLS + policy; all ~31 stub RPCs callable (raise 'not implemented'); sms branch of `automated-send.js` fully implemented behind `automation_settings.sms_sending_enabled` default OFF; slot skeletons render; all routes/nav/icons/css markers wired; `.claude/rules/crm-wave-ownership.md` committed.
> - [ ] `npm run test` + `npm run build` + `npx eslint` (changed files) pass.
> - [ ] `migration-safety-checker` + `upr-pattern-checker` + `consent-path-auditor` clean; `crm-phase-reviewer` (Opus) sign-off.
> - [ ] Visual: stub routes render CrmStubPage on the branch preview; no live-page regressions (CrmLeads timeline extraction is behavior-identical).
> - [ ] `UPR-Web-Context.md` updated (all new tables, stubs, kill-switch, ownership manifest).
> - [ ] Set `F` to `shipped` via `set_crm_phase_status`; reconcile stages; pushed to `dev`, verified, `dev → main` PR opened.

Scope (everything additive):
- **All schema for the wave** (parallel sessions ship ZERO schema): ① merge_contacts superseding fix + capture both drifted RPC bodies as a real migration; ② `automation_settings`; ③ `crm_tasks`, `lead_stage_history`, `inbound_leads.lost_reason`; ④ `crm_segments`; ⑤ `crm_import_batches`, `contacts.owner_id`, `contacts.lifecycle_status`; ⑥ `crm_sequences`, `crm_sequence_steps`, `crm_sequence_enrollments`; ⑦ `pipeline_stages.win_probability`, `inbound_leads.lead_score` + `lead_score_factors`; ⑧ `form_definitions`, `form_definition_versions`, `form_submissions`.
- **The only two live-RPC REPLACEs, done once here:** `move_lead_to_stage` (+`p_lost_reason DEFAULT NULL` + `lead_stage_history` write — shipped 4a caller keeps working, test proves it) and `get_contact_activity` (+email/jobs/tasks arms, additive shape).
- **~31 signature-frozen stubs** (SECURITY DEFINER + GRANT; body `RAISE EXCEPTION 'not implemented (phase X)'`): tasks ×4+overdue, segments ×3, contacts ×5, import, get_contact_consent, forms ×3, sequences ×4, reports ×8, score_lead, automation settings ×2. **Signatures are contracts — changing one post-F is forbidden** (migration-safety-checker enforces).
- **Consent gate completed:** `consentAllows(row)` pure predicate + tests (needs data, not carrier approval); `automated-send.js` sms branch fully implemented behind the `sms_sending_enabled` kill-switch (default OFF). Result: 4b/4d/8 never edit `automated-send.js` — the old 4b∥8 and 4b∥4d serial constraints dissolve; 4b's remaining scope = external registration + flag flip + `Marketing.jsx` UI.
- **Shared code:** `normalizePhone` helper (src/lib + functions/lib) + tests; `ActivityTimeline` extracted from `CrmLeads.jsx` behavior-identical.
- **Slotification:** `CrmOverview.jsx` renders `<OverdueTasksWidget/>` (Phase 7's file) + `<ForecastWidget/>` (Phase 9's file) stubs; `CrmContacts.jsx` skeleton renders `<ContactsDirectory/>` + `<ContactDetail/>` (6a's files) + `<ImportExportPanel/>` + `<MergeTool/>` (6b's files).
- **Wiring:** App.jsx routes (conversations, contacts, forms, sequences — tasks exists) via CrmStubPage; CrmLayout nav; crmIcons.jsx icons; index.css reserved section markers ×8.
- **Ownership manifest:** `.claude/rules/crm-wave-ownership.md` (matrix below) — every wave session's read scope is `CLAUDE.md` + its phase block + that manifest.

## Phase 6a — Contacts read & segments

> **Branch:** harness-assigned (illustrative: `crm/phase-6a-contacts`).
> **Prerequisite:** Phase F merged into `dev`. Model: **Opus · medium**.
> **Read scope:** this block + `CLAUDE.md` + `.claude/rules/crm-wave-ownership.md`.
> **Close-out checklist:**
> - [ ] Test-first, now green: `get_contact_consent` unified-DNC read (dnd ∪ opt_out ∪ email_suppressions); segment filter round-trip (save → preview count matches direct query); get_duplicate_contacts email-normalized detection.
> - [ ] Acceptance: Contacts directory (search/page) + read detail (tags, unified DNC badge, ActivityTimeline) live inside the F-built skeleton; segments CRUD + reusable in campaign audience; merge safety verified landed (F's migration).
> - [ ] `npm run test` + `npm run build` + `npx eslint` pass; **zero schema migrations** (function-body replaces of own frozen stubs only).
> - [ ] `migration-safety-checker` + `upr-pattern-checker` clean; `crm-phase-reviewer` sign-off.
> - [ ] Visual: /crm/contacts on the branch preview.
> - [ ] `UPR-Web-Context.md` updated.
> - [ ] Set `6a` shipped; reconcile stages; delete TEST-org rows; pushed, verified, PR opened.

Scope: fills bodies of `get_crm_contacts`, `upsert/get/delete_segment`, `get_contact_consent`, `get_duplicate_contacts` (+email); owns `ContactsDirectory.jsx` + `ContactDetail.jsx` only.

## Phase 6b — Ownership, CSV import, staff roles & audit hardening

> **Branch:** harness-assigned (illustrative: `crm/phase-6b-data-quality`).
> **Prerequisite:** Phase F merged. (Runs beside 6a — see fallback note in the matrix.) Model: **Opus · medium**. **Opening `page:crm` to staff gates on this phase.**
> **Read scope:** this block + `CLAUDE.md` + ownership manifest.
> **Close-out checklist:**
> - [ ] Test-first, now green: `import_contacts` dedupe-on-import correctness (normalized phone/email; no duplicate contact created; batch audit row); audit-hardening events fire (exclusions/campaign-edit/delete); `crm_email_campaign_sent` no longer duplicates and carries counts payload.
> - [ ] Acceptance: CSV import wizard + export + MergeTool surfaced in the skeleton slots; owner + lifecycle settable; per-screen staff access via `feature:crm_*` sub-flags + `employeePageAccess`/`canAccess()` enforced in CrmLayout + route guards, roles defined per screen BEFORE the flag opens.
> - [ ] `npm run test` + `npm run build` + `npx eslint` pass; zero schema migrations (body replaces only — incl. backward-compatible audit-hardening REPLACEs of the email-campaign RPCs).
> - [ ] `migration-safety-checker` + `upr-pattern-checker` + `consent-path-auditor` clean; `crm-phase-reviewer` sign-off weighted on the audit/consent surface.
> - [ ] Visual: import wizard + role-gated nav on preview.
> - [ ] `UPR-Web-Context.md` updated.
> - [ ] Set `6b` shipped; reconcile stages; delete TEST-org import rows; pushed, verified, PR opened.

Scope: fills `import_contacts`, `set_contact_owner`, `set_contact_lifecycle` + audit-hardening replaces; owns `ImportExportPanel.jsx`, `MergeTool.jsx`, `Admin.jsx`, `DevTools.jsx`, `src/lib/featureFlags.js`, and is the wave's sole editor of `CrmLayout.jsx` (role gating).

## Phase 7 — Daily driver: tasks, timeline completeness, comms in shell

> **Branch:** harness-assigned (illustrative: `crm/phase-7-daily-driver`).
> **Prerequisite:** Phase F merged. Model: **Opus · high** (SMS UI beside the `skip_compliance` bypass).
> **Read scope:** this block + `CLAUDE.md` + ownership manifest.
> **Close-out checklist:**
> - [ ] Test-first, now green: `get_overdue_tasks` predicate (UTC storage, Mountain-Time boundary via `functions/lib/date-mt.js`); lost-reason required-on-lost via the new UI path (RPC stays backward-compatible — F's test still green).
> - [ ] Acceptance: CrmTasks real (due/assignee/reminder/contact+lead links); OverdueTasksWidget on Overview; CrmLeads win/loss prompt + stage-age badges; CrmConversations two-way staff SMS via existing `/api/send-message` (call-only, never `skip_compliance`); click-to-call `tel:` links logging a system_event.
> - [ ] `npm run test` + `npm run build` + `npx eslint` pass; zero schema migrations (task-RPC body replaces only).
> - [ ] `migration-safety-checker` + `upr-pattern-checker` + `consent-path-auditor` clean; `crm-phase-reviewer` sign-off.
> - [ ] Visual: Tasks, Conversations, Overview widget, lost-reason flow on preview.
> - [ ] `UPR-Web-Context.md` updated.
> - [ ] Set `7` shipped; reconcile stages; delete test task rows; pushed, verified, PR opened.

Scope: fills tasks CRUD + `get_overdue_tasks` bodies; owns `CrmTasks.jsx`, `CrmLeads.jsx`, `OverdueTasksWidget.jsx`, `CrmConversations.jsx`. Send paths frozen (call-only).

## Phase 8 — Drip / nurture sequences

> **Branch:** harness-assigned (illustrative: `crm/phase-8-sequences`).
> **Prerequisite:** Phase F merged. Model: **Opus · high** (consent-critical).
> **Read scope:** this block + `CLAUDE.md` + ownership manifest.
> **Close-out checklist:**
> - [ ] Test-first, now green: enrollment idempotency (UNIQUE sequence+contact); step-advance math (delay_hours vs next_run_at, MT helpers); exit-on-reply/conversion predicates off system_events; every send routes through `sendAutomatedMessage()` and a suppressed/dnd contact is skipped durably.
> - [ ] Acceptance: sequences CRUD (steps with delays, email now / sms held behind the F kill-switch until 4b), enroll a `crm_segments` segment, pause/stop, per-enrollment status; `process-sequences.js` cron with `worker_runs` row per run. **Verification-tail (disclosed):** the segment-UI→enroll E2E check runs after 6a merges — build/tests use directly-inserted TEST-org segment rows against F's frozen `get_segments` signature.
> - [ ] `npm run test` + `npm run build` + `npx eslint` pass; zero schema migrations (sequence-RPC body replaces only); `automated-send.js` untouched (import-only).
> - [ ] `migration-safety-checker` + `upr-pattern-checker` + `consent-path-auditor` clean; `crm-phase-reviewer` (Opus) sign-off weighted on the consent path.
> - [ ] Visual: sequence builder + enrollment list on preview.
> - [ ] `UPR-Web-Context.md` updated.
> - [ ] Set `8` shipped; reconcile stages; delete test sequences/enrollments; pushed, verified, PR opened.

Scope: fills sequence RPC bodies; owns `CrmSequences.jsx` + `functions/api/process-sequences.js`. No visual canvas — Phase 5 stays gated on its own go-signal.

## Phase 9 — Intelligence: scoring, forecasting, fixed reports, AI digest

> **Branch:** harness-assigned (illustrative: `crm/phase-9-intelligence`).
> **Prerequisite:** Phase F merged. Model: **Opus · high** (displayed money math — Phase 3 precedent). Note: pipeline-movement/speed-to-lead reports accrue data only from F's `lead_stage_history` onward — render honestly ("since <date>") rather than implying history.
> **Read scope:** this block + `CLAUDE.md` + ownership manifest.
> **Close-out checklist:**
> - [ ] Test-first, now green: `score_lead` rule math (source, speed-to-first-touch, transcript sentiment/topics; deterministic fixtures); `stageWeight()` prefers `win_probability` with positional fallback (hand-calc updated); report RPC math — conversion trend, speed-to-lead, pipeline movement, LTV (div-by-zero + null-for-zero guards per `attribution.js` conventions).
> - [ ] Acceptance: fixed report set live (trend, estimator leaderboard, call volume, speed-to-lead SLA, estimate aging, pipeline movement, LTV/repeat); weighted forecast on Leads/Overview via `ForecastWidget`; weekly AI digest cron (pipeline movement, stale leads, spend anomalies) sending via `sendGatedEmail` (import-only); AI reply drafts in Conversations are draft-only, human sends.
> - [ ] `npm run test` + `npm run build` + `npx eslint` pass; zero schema migrations (report/score body replaces only).
> - [ ] `migration-safety-checker` + `upr-pattern-checker` + `consent-path-auditor` (digest send) clean; `crm-phase-reviewer` (Opus) sign-off weighted on the money math.
> - [ ] Visual: Reports set + forecast widget on preview.
> - [ ] `UPR-Web-Context.md` updated.
> - [ ] Set `9` shipped; reconcile stages; pushed, verified, PR opened.

Scope: fills reports ×8 + `score_lead` bodies; owns `CrmReports.jsx`, `ForecastWidget.jsx`, `src/lib/crmPipeline.js` + `src/lib/attribution.js` (+tests), `functions/api/weekly-crm-digest.js`.

## Phase 10 — CRM Forms: embeddable lead capture

> **Branch:** harness-assigned (illustrative: `crm/phase-10-forms`).
> **Prerequisite:** Phase F merged. Model: **Opus · high** (public unauthenticated endpoint + consent + XSS surface). Owner pre-decision at dispatch: Cloudflare Turnstile site key (or ship toggle-off).
> **Read scope:** this block + `CLAUDE.md` + ownership manifest.
> **Close-out checklist:**
> - [ ] Test-first, now green: link-markup sanitizer rejects raw HTML/`js:` URLs (XSS); server-side schema validation rejects missing-required/bad-type; `upsert_lead_from_form` idempotency (same submission_token twice → one lead); consent-write correctness (opt_in row with IP + consent-text version; unchecked → no row); spam predicates (honeypot, minimum fill time).
> - [ ] Acceptance: builder (structured editor — fields text/email/phone/select/radio/checkbox/textarea/date/**consent**, required toggles, theme colors, restricted `[text](url)` links in labels/descriptions/thank-you, live preview, draft→publish versioning that never mutates a published row, copy-embed-snippet); hosted form at `functions/f/[public_id].js` + `public/embed.js` iframe snippet forwarding parent-page UTM/gclid/fbclid/referrer/landing URL; submissions land in `inbound_leads` (`source_type='form'`, `callrail_id='form:'||token` per the `create_manual_lead` `'manual:'` precedent) with attribution via `upsert_lead_attribution` + system_events firing so speed-to-lead triggers on form leads.
> - [ ] `npm run test` + `npm run build` + `npx eslint` pass; zero schema migrations (form-RPC body replaces only).
> - [ ] `migration-safety-checker` + `upr-pattern-checker` + `consent-path-auditor` (form consent writes `sms_consent_log`) clean; `crm-phase-reviewer` (Opus) sign-off weighted on the public endpoint + consent.
> - [ ] Visual: builder + a live embedded form on a test page.
> - [ ] `UPR-Web-Context.md` updated.
> - [ ] Set `10` shipped; reconcile stages; delete test forms/submissions; pushed, verified, PR opened.

Scope: fills `upsert_lead_from_form` + form CRUD bodies; owns `CrmForms.jsx`, `functions/f/[public_id].js`, `functions/api/form-submit.js`, `public/embed.js`. Optional stage: thin `webflow-form-webhook.js` adapter → same RPC (existing Webflow-native forms flow in from day one). Deliberately NOT a funnel/landing-page builder.

**CallRail Form Tracking replacement evaluation:** what CallRail form tracking gives that first-party forms wouldn't — ① capture of forms we didn't build; ② form attribution inside CallRail's visitor/number-swap session model; ③ zero hosting surface. Against: our CallRail form payload mapping is unverified guesswork (Phase 1 finding), backfill never covered forms, and CallRail can't capture gclid/fbclid first-party or write `sms_consent_log`. If forms stop flowing through `callrail-webhook.js`: **calls are untouched**; the isForm branch goes dormant (left in place; removal = separate reviewed change); UI/RPCs unchanged; speed-to-lead fires either way. **Decision fork (owner, at Wave-0 dispatch):** if replacing, Phase 1's form-fixture stage closes as "superseded by Phase 10 CRM Forms" (disclosed); default if undecided = verify the CallRail form path anyway.

**Honest comparison vs webhooking Webflow's native forms:** the webhook adapter is ~a day (no hosting/embed/builder/XSS surface) but loses WordPress coverage, still needs per-form hidden-field JS for UTM/gclid, scatters consent wording per-site, and has no draft/publish safety. **Recommendation: build Phase 10**, with the adapter folded in as the optional stage. Caveat on record: Webflow-only + no form-consent needs = the adapter alone would be the cheaper defensible call.

## Dependency graph (v3)

```
roadmap-v3 PR merged ──> F ──> 6a, 6b, 7, 8, 9, 10 (one parallel wave)
Phase 1 close-out ──> (independent; runs beside F in Wave 0 — consumes nothing from F)
4b ──> external A2P carrier approval only (code seams dissolved by F; joins the wave on approval)
6b ──> page:crm opens to staff
8  ──> soft: segment-UI→enroll E2E verification tail after 6a merges (build not blocked)
5  ──> stays future, gated on its own go-signal
```

## Dispatch model: Wave 0 → Wave 1

- **Wave 0** (after this PR merges): **Phase F** (Opus · high) ∥ **Phase 1 close-out** (Sonnet · medium) — safely concurrent, zero overlap. Owner pre-decision due here: CallRail Form Tracking replacement intent (forks Session A's form-fixture stage).
- **Wave 1** (after F merges): **4d · 6a · 6b · 7 · 8 · 9 · 10 — all seven in parallel**, plus **4b** joining whenever carrier approval lands. Merge order is preference (suggested: 7, 6a first), not a gate; each PR independent. Throttle freely — all pairs are safe, so concurrent-session count is purely a review-bandwidth choice.
- **Copy-paste launch blocks for every session live in `docs/crm-dispatch.md`** (settings header + complete cold-session prompt per session); each session's read scope = `CLAUDE.md` + its phase block above + `.claude/rules/crm-wave-ownership.md`. The prompts cite Foundation's artifact names as specified here — if F's implementation drifts, the manifest + phase blocks are authoritative.

### File-ownership matrix (to be committed by Phase F as `.claude/rules/crm-wave-ownership.md`)

| Session | Owns exclusively | Fills RPC bodies (own frozen stubs) |
|---|---|---|
| 1-closeout | callrail.test.js, crm_phase1_callrail.test.js (+fix-only: CrmCallLog, CrmIntegrations, callrail-webhook) | — |
| 4d | functions/api/run-automations.js (new), CrmSettings.jsx | automation settings ×2 |
| 6a | ContactsDirectory.jsx, ContactDetail.jsx (new) | segments ×3, contacts-read ×3, get_contact_consent, get_duplicate_contacts |
| 6b | ImportExportPanel.jsx, MergeTool.jsx (new), Admin.jsx, DevTools.jsx, featureFlags.js, CrmLayout.jsx (sole in-wave editor) | import, owner/lifecycle ×2, audit-hardening replaces |
| 7 | CrmTasks.jsx, CrmLeads.jsx, OverdueTasksWidget.jsx (new), CrmConversations.jsx (new) | tasks ×4, get_overdue_tasks |
| 8 | CrmSequences.jsx (new), functions/api/process-sequences.js (new) | sequences ×4 |
| 9 | CrmReports.jsx, ForecastWidget.jsx (new), crmPipeline.js + attribution.js (+tests), functions/api/weekly-crm-digest.js (new) | reports ×8, score_lead |
| 10 | CrmForms.jsx (new), functions/f/[public_id].js, functions/api/form-submit.js, public/embed.js (new) | forms ×3 |
| 4b | Marketing.jsx, send-text-campaign worker (new), sms_sending_enabled flag flip | — |

**Frozen in-wave (nobody edits):** App.jsx, crmIcons.jsx, CrmOverview.jsx + CrmContacts.jsx (slot skeletons), automated-send.js, email-consent.js, send-message.js, twilio.js, email.js, functions/lib/supabase.js, cors.js, date-mt.js, normalizePhone. index.css: writes only inside your reserved section marker. Shared tables: DATA writes only (system_events / worker_runs / sms_consent_log are insert-only logs); **zero schema changes outside F**.

**Migration rule (amended from "zero migrations in parallel sessions"):** F owns 100% of SCHEMA (tables/columns/constraints/policies/indexes) + both shared RPC REPLACEs + every signature. Wave sessions may ship **function-body-only** `CREATE OR REPLACE` migrations for their OWN frozen stubs — signature changes forbidden (migration-safety-checker enforces), collision-free because each function has exactly one owner. Rationale: literal-zero would force F to implement ~31 RPCs — most of the backend — serially and without per-phase test-first.

**What resisted maximum parallelism (honest record):** ① the literal zero-migration rule (amended as above — the only rule bent); ② Phase 8's consumption of 6a's segments (softened to a disclosed post-6a verification tail); ③ 4b's carrier approval (external, irreducible — but code seams dissolved); ④ 6a∥6b is the most protocol-fragile pair (both inside the Contacts surface; safe only via F's slot components; fallback = serialize 6b after 6a); ⑤ 4d and 8 are two consent-critical builds running concurrently — accepted by owner directive, mitigated by the F-frozen gate (both call-only), SMS dark behind the kill-switch, and mandatory consent-path-auditor on both PRs; ⑥ F itself is the new critical path / single point of failure — priced in via the full reviewer gauntlet before the wave dispatches.
