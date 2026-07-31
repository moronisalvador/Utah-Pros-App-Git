<!--
FILE: docs/upr-build-fix-backlog.md

WHAT THIS DOES (plain language):
  One planning list of everything UPR still needs built or fixed, sized so it can be
  scoped and sequenced. It is a planning VIEW over docs/upr-unfinished-work-registry.md
  (the evidence ledger) plus findings from the sessions parked on 2026-07-26.

DEPENDS ON:
  Internal: docs/upr-unfinished-work-registry.md (authoritative evidence rows; IDs below
            cross-reference it), docs/handoff/*.md
  Data:     reads → documentation, source, Git metadata, read-only live catalog
            writes → documentation only

NOTES / GOTCHAS:
  - This is a planning view, NOT authorization to implement any row.
  - The registry stays the evidence ledger. Where this file and the registry disagree,
    §0 below says which one is stale and why.
  - Sizes are rough planning sizes, not estimates: S = a session, M = 2-3 sessions,
    L = its own initiative with a roadmap.
-->

# UPR — Build / Fix Backlog

**Compiled:** 2026-07-26 · **Basis:** `docs/upr-unfinished-work-registry.md` (dated 2026-07-23)
reconciled against 60 commits landed 07-23 → 07-26, plus five sessions parked 2026-07-26.

**Revised:** 2026-07-26 after a 31-agent adversarially-verified recon sweep (6 lanes, all live
catalog reads re-run). Corrections are marked **[recon]**. Owner decisions taken the same day are
marked **[owner]**. Item 1.4 shipped in `7cc7504`.

**Verified state at compile time:** `origin/dev = d54b6ba`, `origin/main = 90b265e` (dev 1 ahead,
docs-only). All Claude worktree branches fully pushed. Provenance gate PASS at ledger=27.

**Evidence marking.** Every row is tagged:
- 🟢 **verified** — I checked live catalog, source, or Git this session
- 🟡 **inherited** — carried from the registry or a parked session's report; plausible, not re-checked
- 🔵 **owner/external** — cannot be verified from here at all

---

## 0. Registry rows that are now STALE (fix these first, they mislead)

The registry is 3 days old and predates the 07-24 → 07-26 releases. These rows are wrong today:

| Registry row | Says | Actually | Evidence |
|---|---|---|---|
| `PUB-001` / `UPRF-PUB-001` | "ready_owner_apply", P0 open | **CLOSED 2026-07-24.** `upsert_lead_from_form` is service-role-only; `anon=false, authenticated=false, public=false` | 🟢 `2914cf1`; `database-standard.md` §2 records the closure |
| `MSG-001` | "MISSING", P0 — no thread deep link | **DONE.** Bell → `/conversations?c=<id>`, push → `/tech/conversations?c=<id>` | 🟢 `functions/api/notify.test.js:304,308,352-353` asserts both |
| `MSG-003` | "Production stays disabled pending owner gate" | **LIVE in production.** `MESSAGING_SEND_MODE=callrail`, proven bidirectional SMS+MMS | 🟡 messaging handoff session, 2026-07-25 |
| `REL-001` / `UPRF-REL-001` | ledger=22 | ledger=**27**, gate still PASS | 🟡 migration-verify session, 2026-07-26 |
| `UPRF-DOC-001` | "archived for 2026-07-23 close" | Reopened — 60 commits since, incl. messaging/ops-health | 🟢 `git log` |

**Action:** one small pass to correct these five rows. Until then the registry over-reports open P0s
and under-reports what's live. **Size: S.**

### 0b. Further stale rows found by recon (2026-07-26)

| Row | Says | Actually | Evidence |
|---|---|---|---|
| `TECH-003` / 5.6 | "flag default-off, owner bake pending" | `page:tech_msgs_v2` has been `enabled=true, dev_only=null` since 2026-07-25 — **live to every technician**. Only the shed-scope decision remains | 🟢 live flag read |
| `BRANCH-001` / 2.6 | "8 worktrees, ~48 branches" | **23 worktrees, 349 branch refs** — 4–7× understated | 🟢 |
| `SEC-002` / 3.1 | "146 always-true policies" | **196 literal-true of 227** across 105 tables; advisor reports **144** because its lint skips SELECT-only policies. Effective unscoped ≈ **220** | 🟢 catalog |
| `DBF-003` / 3.2 | "342 definer overloads" | Still **342**, but that's *offsetting churn, not stasis*. The real defect: only **17 of 342** read the caller; **159 write without ever reading it** | 🟢 catalog |
| `TECH-001` / 5.4 | "flag-off blank-screen resilience" | **Mechanism inverted.** Legacy `TechDash`/`TechSchedule` are deleted (`src/App.jsx:259-267`, `element={null}`), so flag-off is now a hard blank with no fallback — and both flags are live-on for everyone | 🟢 source |
| `SCHED-002` / 6.5 | cites `JobPage.jsx:964` | Citation now points at unrelated code (an "Open dispatch board" button). Defect may be real; **citations must be re-derived** or the next session wrongly closes it | 🟢 source |
| `GOV-001` | "planned" | In-flight — untracked `.agents/` and `.codex/` exist in the working tree | 🟢 |

**New rows discovered:**

| # | Finding | Why it matters | Size |
|---|---|---|---|
| **0c** | `page:crm-ops` flag flipped `enabled=true` on 2026-07-25 with **zero references anywhere in the repo** | Orphan live flag — either dead config or a half-shipped surface | XS |
| **0d** | **`upsert_permission` is a `SECURITY DEFINER` granted to `authenticated` with no caller check** | Any logged-in employee — including a field tech — can grant themselves admin page access. The `/settings/roles` page is therefore a UI gate, not a server gate | S |
| **0e** | `crm_partner` has `can_edit = true` on the `crm` and `settings` nav keys, and neither key is exposed as a row in the roles page UI | Contradicts the owner's "CRM partner read-only" intent, and can't be fixed from the UI | XS |
| **0f** | Role drift: `nav_permissions` carries a `manager` role absent from the `employees.role` enum; the enum's `estimator` has no permission rows. Neither is assigned | Cosmetic today, confusing later | XS |

**Correction to an earlier claim in this file:** an earlier revision said "no `office` role exists."
Wrong. `office` **is** in the `employees.role` enum (`admin, office, project_manager, field_tech,
estimator, supervisor, crm_partner`) and has permission rows — it simply has **zero employees
assigned**. The original query only looked at who *holds* a role.

---

## 0A. ⚠️ NEW TOP PRIORITY — anonymous write access [recon]

Recon's refreshed §3.1 numbers surfaced a live, unauthenticated exposure that outranks everything
below. **`anon` holds all 7 table privileges on 123 public tables**, and ~**31 always-true `anon`
policies** sit on 18 of them. The anon key ships in the browser bundle, so `anon` means anyone.

Worst first:

| Table | Anonymous caller can | Consequence |
|---|---|---|
| `automation_settings` | flip `sms_sending_enabled` | **the customer-SMS kill switch is world-writable** |
| `email_suppressions` | delete rows | wipes the opt-out list — CAN-SPAM exposure |
| `email_campaign_*` (3 ALL policies) | read/write campaigns | — |
| `appointments` | DELETE | destructive |
| `contacts`, `claims`, `jobs` | read/write | PII + business records |
| `conversations`, `conversation_participants` | read/write | customer message threads |
| `employees`, `employee_page_access`, `nav_permissions`, `feature_flags` | read/write | privilege escalation |

On `claims` / `contacts` / `jobs` the authenticated side already carries a real predicate, so the
fix is a `DROP POLICY` with nothing to design.

**[owner] Approved 2026-07-26**, staged, with the explicit constraint that nothing may break. Tranche
(a) starts with `automation_settings` + `email_suppressions` — zero legitimate anon use. The
`database-standard.md` §2 allowlist (login/session bootstrap, `/status`, public e-sign retrieval,
public job-file read) is **not touched in tranche (a)**; those are the paths whose breakage would
stop logins or customer signing.

**Sequencing note:** close `automation_settings` **before** deliberately enabling customer SMS
(item 2.1) — otherwise SMS is turned on while its off-switch is world-writable.

Known collateral: three `notify_*` test suites insert via the anon client and will need a
service-role harness.

---

## 1. Do next — small, high value, no external gate

These are the ones worth taking first. All are S, all unblocked.

| # | Work | Why it matters | Size | Evidence |
|---|---|---|---|---|
| 1.1 | **`notification_types` write policy** | Single `ALL` policy, `authenticated`, `qual=true/with_check=true`. **Any logged-in employee can disable any notification type**, including the ops-health alerting that just went live. **[recon]** Cheaper than assumed — no `src/` code touches the table directly and all four SQL readers are `SECURITY DEFINER` (RLS-bypassing), so full RPC-only closure is safe. Slightly worse exposure than assumed: `anon` also holds all 7 table privileges. **[owner]** Close it; no UI. | S | 🟢 `pg_policies` + caller inventory |
| 1.2 | ~~CallRail `preferredApiAccountId`~~ → **CallRail stranded events** | **[recon] The original premise was false on all four counts.** Both id forms return identical 200s; `/v3/` accepts either; no SSRF change is needed; and it is **3 inbound + 2 outbound**, not 5 inbound. The real blocker is *state*: all five sit in terminal `processing_state='failed'`, `next_attempt_at=NULL`, with **no re-arm path anywhere in the codebase**. Needs a guarded service-role re-arm RPC. **Do not touch `functions/lib/callrail-mms.js`.** | S | 🟢 live API probes + event rows |
| 1.3 | **`provider_events_failed` daily nag** | **[recon]** Independent of 1.2, not fixed for free by it. And a naive time bound is the *wrong* fix — it measures a **backlog** but is wired to a **daily alarm**, and `failed` is terminal with no `resolved_at` and no UI, so a window converts unresolved data loss into silence. **[owner]** Acknowledge-and-silence: add `resolved_at`, probe on `resolved_at IS NULL`, **plus escalate severity if the backlog persists past N days** so ignoring it gets louder. | S–M | 🟢 worker source + 2 days of markers |
| ~~1.4~~ | ~~Alert-body truncation~~ | ✅ **Shipped `7cc7504`.** Confirmed byte-for-byte against the live body (cut at `…returned an empt`). **[recon]** also caught an unlisted sibling: the dedupe key was `condition:date`, so a *new* distinct failure later the same day was silently swallowed — fixed with a fingerprint over distinct failure *classes* (never raw error text, which carries UUIDs). | S | ✅ done |
| 1.5 | **Registry + backlog correction pass** | §0 and §0b above. | S | 🟢 |
| 1.6 | **Agent-instruction reconciliation** | Claude ⇄ Codex. Prompt shipped: `docs/handoff/agent-instruction-reconciliation-prompt.md` (`6b5dc80`). Separate session. | S–M | 🟢 |

**Owner-side, costs zero engineering:** make `CALLRAIL_SIGNING_KEY` identical across Cloudflare
**Production** and **Preview**. CallRail delivers every text to both domains; one key doesn't match,
which is the recurring `INVALID_CALLRAIL_SIGNATURE` feeder into the `worker_errors` alert. Matching
the keys turns the second delivery into a benign duplicate. 🔵 **Do not delete either webhook URL** —
there's no way to tell from the database which environment holds the valid key, and deleting the
wrong one breaks inbound texts entirely.

---

## 2. Owner decisions blocking real value

Not engineering work — your call. Each one unblocks something already built and paid for.

| # | Decision | What it unblocks | Risk if wrong |
|---|---|---|---|
| 2.1 | **Keep automated SMS disabled through the CallRail period; re-evaluate at Twilio activation** | Production `automation_settings.sms_sending_enabled` was explicitly set false 2026-07-31. `missed_call_textback_enabled=true` remains configured but inert. Staff P2P CallRail SMS/MMS does not read this switch and remains untouched. | Turning the master switch on arms automated traffic immediately; require the Twilio transition checklist, consent/DND verification, and a separately authorized self-number smoke before activation. |
| 2.2 | **ops-health worker URL: `dev` or production** | Correctness of the alerting that's now live. Currently points at `dev`; harmless (one shared Supabase) but probably not intended. Hand-edit of one `integration_config` row. | Low |
| 2.3 | **Alert channel** | Whether ops-health stays bell-only or also emails/texts. Carried unanswered from the messaging handoff. | Low |
| 2.4 | **Governed local Supabase replay for SQL/pgTAP tests** | Hosted qa-staging discovers the 78 JavaScript files and gates failed assertions at zero, but 46 legacy setup errors across 44 files remain; the gate tracks 44 failed files / 90 failed suite nodes shrink-only. Local bootstrap is still needed for the six SQL proofs and reproducible migration-from-baseline evidence. | Leaves explicit hosted setup/skip and local coverage/DR gaps; it no longer blocks all hosted database execution. |
| 2.5 | **Encircle rollout** | ENC-001 tail: migration unapplied, flag OFF, credentials unchanged. | 🔵 Owner + external |
| 2.6 | **Worktree/branch retirement** | 8 Codex worktrees, ~48 stale branches. Only `codex/messaging-transport-build` is dirty (61 files on the SMS chokepoint). Registry rule: never blind-delete; never merge `3841056` or `d3fd17a`. | 🟢 dirty count checked this session |

---

## 3. Security & database — the real P0 body of work

This is the largest genuine risk cluster and the least glamorous.

| # | Work | Registry ID | Why | Size |
|---|---|---|---|---|
| 3.1 | **Broad grant/policy classification** | `SEC-002` / `UPRF-SEC-002` | **[recon] 196 literal-always-true of 227 policies across 105 tables** (advisor says 144 — its lint skips SELECT-only). The "31 with a predicate" is itself inflated: 23 of them are `(NOT is_crm_partner(auth.uid()))`, a one-role blocklist that is TRUE for everyone else. **~220 effectively unscoped vs ~6 substantive.** Three tranches: **(a)** the ~31 `anon` policies → **promoted to §0A**; **(b)** the 49 always-true SELECT policies the advisor never counts (so 3.1 isn't declared done at 144); **(c)** the ~162 authenticated ones — **blocked** until `docs/auth-and-authorization.md` classifies which tables are legitimately company-wide. Pair every tranche with a table-ACL revoke. **Reconcile with db-foundation P3 first — `messages` is already closed, so someone did part of P3.** | **L** |
| 3.2 | **Privileged RPC contract registry** | `DBF-003` | **[recon]** Still **342** — but that's *churn, not stasis* (two closures offset by two new grants; total definer grew 345→352). The count isn't the defect: only **17 of 342** read the caller, and **159 write without ever reading it**, taking actor identity as a spoofable `p_actor_id`/`p_created_by` parameter. **Do not scope as 342 reviews** — scope as one shared `assert_active_employee()`/`assert_admin()` contract (precedent: `p9_assert_admin`) plus a short RED list: `upsert_permission`, `upsert_employee_page_access`, `upsert_feature_flag`, `delete_feature_flag` (straight privilege escalation), `get_table_stats(text)` (**revoke outright** — an RLS-bypassing row-count oracle over deny-all tables), `set_automation_setting`, and moving the `get_billing_settings`/`get_managed_credentials_status` admin gates from UI into SQL. ⚠️ 7 bodies verified, ~24 regex-classified — triage order, not verdict. | **L** |
| 3.3 | **Signing + Storage privacy contract** | `DBF-001` + `PUB-002` / `UPRF-FILE-001` | `job-files` public read; e-sign writes PDFs into the same bucket. **Must be co-designed** — they share one bucket/document contract — and applied serially. | **M–L** |
| 3.4 | **Atomic provider-event write contracts** | `MSG-004` | `callrail-text-webhook.js` does direct service-role insert/update on new tables; should be a narrow service-role RPC claim. | M |
| 3.5 | **Credential rotation + tracked local permissions** | `CAP-001` / `UPRF-CAP-001` | Exposed Encircle credential; decide git-history disposition. | 🔵 owner + external |
| 3.6 | **Index tail / pg_net / leaked-password** | `DBF-002` | Needs fresh advisors + separate RED review. | S–M, owner gate |

**Sequencing note:** 3.1 and 3.3 both strong-lock hot tables. Per `database-standard.md` §5 their
apply windows must not overlap. Do not run them in parallel sessions.

---

## 4. Messaging & conversations

| # | Work | Registry ID | Status | Size |
|---|---|---|---|---|
| 4.1 | **Conversation participant scoping** | *(new — no registry row)* | **Repository release candidate implemented 2026-07-31; staged foundation only, release gates remain.** Staff visibility, participant/default controls, self-leave, Worker send/notification/contact scoping, unread compatibility, sender labels and mobile readability are implemented. `20260731040337` is applied only to `qa-staging`; `40338` and `40339` are unapplied everywhere. See §4A for the compatibility-sensitive rollout. | **M** |
| 4.2 | **A2P + on-device verification** | `MSG-002` | 🔵 Provider approval, live smoke, owner device. | external |
| 4.3 | **Text campaigns 4b** | `CRM-001` | Blocked on 4.2, or explicitly supersede it. | M, blocked |
| 4.4 | **Inbound email Phase I** | `OMNI-001` | Foundation exists; `email-worker/` and `inbound-email.js` absent. Needs a Cloudflare route + secret first. | M, external gate |
| 4.5 | **Web Push owner-device proof** | `NOTIFY-001` | 🔵 Tap the corrected `/tech/conversations?c=<id>` push on the field PWA, retain evidence. Deep link itself is done (§0). | XS, owner |
| 4.6 | **CallRail query-secret placeholder** | `CALL-001` | Verify provider auth; signature/replay/rotation tests. | S |

---

### 4A. Participant scoping — approved design [owner, 2026-07-26], release candidate 2026-07-31

**Three layers. The third is what stops it rotting.**

1. **Role short-circuit — by role, not by row.** `admin`, `office`, `project_manager`, `supervisor`
   ⇒ always true. Nothing to backfill, nothing to drift, no admin can be accidentally removed.
   `crm_partner` (5 active, external) gets **nothing**.
2. **Derived membership: historical, computed live.** A tech sees a thread if they are on *any*
   appointment for that client, **ever** — not an active-only window. Restoration has long tails
   (follow-ups, warranty, re-opens); losing thread access the moment a job closes is worse than mild
   over-inclusion. Computed inside the predicate at read time — **no materialized table, no nightly
   derivation pass.**
3. **Manual overrides only.** `conversation_member_overrides` holds explicit staff adds/removes and
   `conversation_default_members` holds the technicians admins want included by default. Manual
   per-chat choice wins over derived/default membership.

**Why live-computed matters:** the handoff flagged "admin removes a tech, tomorrow's derivation pass
re-adds them" as the likeliest bug. With no pass, and overrides as the only stored rows, that bug
**cannot exist** — designed out rather than tested for. Adding a tech to an appointment grants access
immediately, with no sync step.

**Join path** (verified): `appointment_crew → appointments → jobs → COALESCE(jobs.primary_contact_id,
claims.contact_id) → conversation_participants.contact_id`. It **must** join through
`conversation_participants.contact_id` — `conversations.job_id` is NULL on all 7 rows.

**Enforce at every boundary:** `get_tech_conversations`, actor-derived unread mutation,
`conversations`/`messages` SELECT policies, send/internal-note Workers, contact
search/find-or-create, inbound recipient resolution, and the desktop/native clients. The UI changes
are additive: admin participant/default controls, technician self-leave, cache/draft purging on
revocation, sender labels, and a readable 18px mobile message token.

**Notifications [owner]:** audience aligns to the same predicate — techs are notified only for threads
they belong to; admins/office/PM/supervisor keep receiving everything. Deep links already land in the
thread (`/conversations?c=` and `/tech/conversations?c=`). **Email for `message.inbound` is removed as
an option entirely — push + bell only.** (The `field_tech` email default is `enabled=true` today: a
latent trap the moment anyone sets `assigned_to`.)

**Accepted outcome [owner]:** 2 of 4 active techs would currently see 0 of 7 conversations; the other
2 would see 3.

**Rule amendments to disclose:** `get_tech_conversations` is F-M-frozen
(`tech-messages-v2-wave-ownership.md` §2); `conversation_participants` is Foundation-owned
(`omni-inbox-wave-ownership.md` §1).

**Release order:** apply `20260731040337` + `20260731040338` before any compatible Worker/UI
deployment; validate dev, then promote the same reviewed web source and a supported native build;
run the isolated SQL and negative device checks; apply `20260731040339` only after older native
direct-unread callers are no longer supported. Every hosted apply/deploy/promotion is a separate
owner-authorized gate.

**Deferred lifecycle context:** when future rooms/dry logs can prove the final appointment marked
the mitigation job dry and equipment picked up, derived mitigation technicians should fall out
automatically unless privileged or manually re-added. Until then, removal stays manual or
technician-initiated.

---

## 5. Frontend, UX & mobile

| # | Work | Registry ID | Why | Size |
|---|---|---|---|---|
| 5.1 | **Failure → empty-state, and blank detail pages** | `UX-002` | Highest-impact rule in `loading-error-states.md`, violated in `Customers`, `Leads`, `Marketing`, `JobPage`, `CustomerPage`. A dispatcher reads an outage as an empty schedule. | M |
| 5.2 | **NotificationBell hygiene debt** | *(new)* | Raw `upr:toast` dispatch; failed load renders "No notifications yet"; 60s poll has no `document.hidden` guard; bare loading text. ⚠️ 🟢 **A stale diff exists in `determined-swartz-162487` — do not merge it**; its base predates the `372a622` rewrite. The `toast.js` half (adding `title`) is salvageable. | S |
| 5.3 | **UX W1–W5 adoption** | `UX-001` | Rebaseline, exact ownership, lifecycle/error/mobile/perf evidence. | **L** |
| 5.4 | **Tech v2 flag-off blank-screen resilience** | `TECH-001` | Test missing/enabled/disabled/force-disabled; explicit fallback. | S–M |
| 5.5 | **Job Hub H3** | `TECH-002` | 🔵 Owner phone bake, then resolver/retarget/cleanup. | M, owner gate |
| 5.6 | **Tech Messages rollout + shed scope** | `TECH-003` | 🔵 Owner bake/flip; decide new-conversation/scheduled-send scope. | M, owner gate |
| 5.7 | **Tech More "Soon" rows** | `TECH-004` | Link, build, or explicitly retire each with role tests. | S |
| 5.8 | **Dead CRM artifacts** | `CRM-003` | Unused `CrmStubPage.jsx`, orphan `ClaimPage_header.jsx`. | XS |
| 5.9 | **Public roadmap staleness** | `ROAD-001` | `src/lib/roadmapData.js` contradicts shipped work — it's customer-visible. | S |

---

## 6. Platform, QA & release

| # | Work | Registry ID | Why | Size |
|---|---|---|---|---|
| 6.1 | **Isolated QA execution — hosted live; local replay open** | `QA-002` / `UPRF-QA-001` | The persistent `qa-staging` branch is seeded, protected by exact-target refusal, and wired to CI with rotated standing identities. Raw receipt at `a513af37`: 78 JavaScript files discovered; 163 / 375 assertions passed, 0 failed, 212 skipped; 46 setup errors across 44 files. Assertions are hard-gated at zero; setup debt is shrink-only at 44 failed files / 90 suite nodes. Remaining: convert failed setups/skips, complete the role/reset matrix, and build the governed local bootstrap needed for six SQL/pgTAP proofs. The shared project remains forbidden for test writes. | M |
| 6.1a | ✅ **Replace the dark-lane alarm with truthful coverage contracts** | — | Shipped: `tests/qa/unit/db-lane-coverage.test.js` proves hosted JavaScript discovery, zero failed assertions, shrink-only setup-suite debt, and the exact six-file local-only SQL inventory. Runtime truth comes from the hosted receipt, not static source. | ✅ done |
| 6.1b | **Migration history cannot rebuild the database** | `REL-001` adjacent | **162-entry gap** (236 local vs 398 live). Previously framed as a test prerequisite; with 6.1 on branches it is not. It remains a **disaster-recovery** exposure in its own right: the project could not be reconstructed from this repo today. Scope on that basis. | **L** |
| 6.2 | **QBO captured-but-unrecorded recovery** | `COR-002` | Money correctness: no durable pre-provider attempt ledger. Blocked on Intuit sandbox semantics. | M, blocked |
| 6.3 | **Stripe Checkout reuse/concurrency** | `COR-003` | Endpoint lacks stored-session lifecycle. | M |
| 6.4 | **Schedule correctness** | `SCHED-001` | Remodeling/month/error behavior. | M |
| 6.5 | **Booking / schedule-from-job** | `SCHED-002` | Depends on 6.4; A→B→C serial. | M |
| 6.6 | **Account deletion fulfillment** | `DEL-001` | Compliance: no request-linked processor. Decide integrate/replace/disable + SLA. | M |
| 6.7 | **App Store completion** | `APP-001` | 🔵 Apple enrollment, signing secrets, Xcode archive, screenshots, demo account. | external |
| 6.8 | **Native privacy screen / Keychain** | `APP-002` | Accept or implement. | S–M |
| 6.9 | **Legacy Cloudflare credential cutover** | `SET-001` | 🔵 Remove old env values, verify managed credentials. | S, owner |
| 6.10 | **Netlify Demo Sheet retirement** | `UPRF-NET-001` | 🔵 Owner-confirmed obsolete; verify URL/binding gone. | S, owner |
| 6.11 | **Feedback purge / device gates** | `FEED-001` | 🔵 APNs + purge scheduling. | S, external |
| 6.12 | **Tooling governance** | `GOV-001/002` | Canonical skills/agents source; read-mostly permission defaults. | M |
| 6.13 | **Design system + Figma operating model** | `DES-001/002` | Adoption/parity metrics; reconcile competing palettes. Figma is owner-blocked on scope/seat. | M, partly owner |

---

## 7. Sequencing — revised after recon [2026-07-26]

**Wave 0 — no gates, safely parallel:** ✅ 1.4 shipped (`7cc7504`) · 1.5 this pass.

**Wave 1 — authored together, applies serialized, one batched owner request:**
1. **§0A tranche (a)** — `automation_settings`, `email_suppressions` first (zero legitimate anon use).
2. **1.1** notification_types closure (tiny cold table, negligible lock).
3. **0d** — gate `upsert_permission` + the page-access/feature-flag RPCs, making `/settings/roles` a
   real gate rather than a UI suggestion. Fix **0e** (`crm_partner` edit on `crm`/`settings`) in the
   same pass.
4. **1.2** re-arm RPC → sequenced drain of the 3 inbound, one at a time, verifying each. Separate
   decision on the 2 outbound (**verify the re-arm path cannot reach a provider send first**).
5. **1.3** `resolved_at` column → **column applies BEFORE the worker probe change**, or `safeSelect`
   swallows a 400 as a silent "healthy".

**Wave 2 — one at a time:** **4.1** (§4A) → **5.1** failure/empty states → **5.2** bell debt
(rewritten from current `dev`; **never merge the stale `determined-swartz-162487` diff**).

**Hard constraints:**
- Every migration apply is its own owner-authorized window (`database-standard.md` §0/§5).
- **3.1 and 3.3 must never share an apply window** — both strong-lock the same hot tables.
- **4.1 must land before 3.1 tranche (c)** — both rewrite `conversations` policies; 3.1 should
  consume 4.1's predicate rather than invent a second one.
- 3.2 is code + grants: it can run alongside 3.1's *authoring*, never its *apply*.

**Owner-desk items are parallel-safe with all of the above** and cost no engineering.

## 7b. Original sequencing (superseded — kept for provenance)

**Now (one session each, no gates):** 1.1 → 1.2 + 1.3 together → 1.5 → 1.4.
Rationale: 1.1 closes a live privilege hole in the alerting you just built; 1.2/1.3 recover the five
MMS *and* stop the daily nag, which is the thing most likely to make you start ignoring alerts.

**Your desk, in parallel, costs no engineering:** the CallRail signing-key match, 2.1, 2.2.

**Then, one at a time:** 4.1 (participant scoping — diagnosis first) → 5.1 (failure/empty states) →
5.2 (bell debt, rewritten from current `dev`).

**Own initiative, don't fold into a feature session:** 3.1, 3.2, 3.3, 5.3. Each needs its own
roadmap + ownership manifest. 3.1 and 3.3 must not share an apply window.

**Blocked, revisit when the gate opens:** 4.2/4.3 (A2P), 4.4 (Cloudflare route), 6.1 (2.4),
6.2 (Intuit sandbox), 6.7 (Apple).

---

## 8. What I did not verify

Honesty about the edges of this list:

- Rows marked 🟡 come from the registry or a parked session's own report. They were written by
  sessions that generally verified their claims, but I did not independently re-check them.
- I did **not** re-run the Supabase advisors, so "146 always-true policies" and "342 definer
  overloads" (3.1, 3.2) are the 2026-07-22 audit's counts, not today's. Re-run advisors before
  scoping either — the numbers have almost certainly moved.
- Everything 🔵 is outside this machine: Cloudflare dashboards, CallRail console, Apple, Intuit.
- I did not attempt to size the Codex worktrees' content (2.6) beyond counting dirty files.
