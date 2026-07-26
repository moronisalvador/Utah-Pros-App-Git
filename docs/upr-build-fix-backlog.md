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

---

## 1. Do next — small, high value, no external gate

These are the ones worth taking first. All are S, all unblocked.

| # | Work | Why it matters | Size | Evidence |
|---|---|---|---|---|
| 1.1 | **`notification_types` write policy** | Single `ALL` policy, `authenticated`, `qual=true/with_check=true`. **Any logged-in employee can disable any notification type**, including the ops-health alerting that just went live. A privilege hole in the thing that's supposed to warn you. | S | 🟢 `pg_policies` read this session |
| 1.2 | **CallRail `preferredApiAccountId`** | Prefers the masked `ACC…` id; `/v3/` needs numeric. Blocks 5 recoverable MMS **and** is the sole cause of the daily alert nag (1.3). Reverses a documented SSRF boundary → needs its own review, not a quick patch. | S–M | 🟡 migration-verify session |
| 1.3 | **`provider_events_failed` has no time bound** | Query matches any row sitting in `failed`. Those 5 MMS stay failed forever ⇒ **this alert fires every single day, indefinitely.** Daily noise is how alerting dies. Fixed for free by 1.2, or bound the window. | S | 🟡 same session, confirmed against 2 days of markers |
| 1.4 | **Alert-body truncation** | Parse `.error` before slicing, so a JSON-array error isn't eaten by a UUID. Pure polish. | S | 🟡 same session |
| 1.5 | **Registry staleness pass** | §0 above. | S | 🟢 |

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
| 2.1 | **Flip `automation_settings.sms_sending_enabled`** | Missed-call textback, which you said is worth real money. Both blockers cleared: claim fence shipped (`42a7501`), STOP handler verified wired + P0 fixed (`f81bef7`), your live STOP/START test passed. | 🟢 **`missed_call_textback_enabled` is already `true` in one of the two org rows** — flipping the global switch arms textback *immediately*. Verify with a real missed call to your own number, never a client. |
| 2.2 | **ops-health worker URL: `dev` or production** | Correctness of the alerting that's now live. Currently points at `dev`; harmless (one shared Supabase) but probably not intended. Hand-edit of one `integration_config` row. | Low |
| 2.3 | **Alert channel** | Whether ops-health stays bell-only or also emails/texts. Carried unanswered from the messaging handoff. | Low |
| 2.4 | **Local Supabase for SQL tests** | QA-002 / the whole executable-DB-test lane (§6.1). Needs your budget/approval. | Blocks a P0 lane |
| 2.5 | **Encircle rollout** | ENC-001 tail: migration unapplied, flag OFF, credentials unchanged. | 🔵 Owner + external |
| 2.6 | **Worktree/branch retirement** | 8 Codex worktrees, ~48 stale branches. Only `codex/messaging-transport-build` is dirty (61 files on the SMS chokepoint). Registry rule: never blind-delete; never merge `3841056` or `d3fd17a`. | 🟢 dirty count checked this session |

---

## 3. Security & database — the real P0 body of work

This is the largest genuine risk cluster and the least glamorous.

| # | Work | Registry ID | Why | Size |
|---|---|---|---|---|
| 3.1 | **Broad grant/policy classification** | `SEC-002` / `UPRF-SEC-002` | 146 advisor-flagged always-true policies. `authenticated` proves identity, not permission. Needs a role matrix, staged closes, negative tests — not a sweep. 1.1 is one instance of this class. | **L** |
| 3.2 | **Privileged RPC contract registry** | `DBF-003` | 342 authenticated-executable `SECURITY DEFINER` overloads, each needing a caller/data/grant/negative-test owner. | **L** |
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
| 4.1 | **Conversation participant scoping** | *(new — no registry row)* | **Never started.** Handoff prompt recovered to [`docs/handoff/conversation-participant-scoping-prompt.md`](handoff/conversation-participant-scoping-prompt.md). 🟢 Verified: `conversation_participants` has no employee column — needs its own additive table. **Insist on its diagnosis step first**: if technicians already get no inbound notifications, the real complaint is the conversation *list*, which is a different fix. | **M** |
| 4.2 | **A2P + on-device verification** | `MSG-002` | 🔵 Provider approval, live smoke, owner device. | external |
| 4.3 | **Text campaigns 4b** | `CRM-001` | Blocked on 4.2, or explicitly supersede it. | M, blocked |
| 4.4 | **Inbound email Phase I** | `OMNI-001` | Foundation exists; `email-worker/` and `inbound-email.js` absent. Needs a Cloudflare route + secret first. | M, external gate |
| 4.5 | **Web Push owner-device proof** | `NOTIFY-001` | 🔵 Tap the corrected `/tech/conversations?c=<id>` push on the field PWA, retain evidence. Deep link itself is done (§0). | XS, owner |
| 4.6 | **CallRail query-secret placeholder** | `CALL-001` | Verify provider auth; signature/replay/rotation tests. | S |

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
| 6.1 | **Isolated QA Supabase** | `QA-002` / `UPRF-QA-001` | P1 foundation delivered; **P2a blocked** on a governed local runtime, P2b on a hosted project. Shared prod DB is forbidden as a write-test target. Gates every executable DB test. | M, needs 2.4 |
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

## 7. Suggested sequencing

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
