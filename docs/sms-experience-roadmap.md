# SMS Experience — Roadmap & Plan of Record

**Created:** 2026-07-09 · **Slug:** `sms-experience` · **Base:** `origin/dev` @ 07f6142
**Companion docs:** `docs/sms-experience-dispatch.md` (cold-session launch blocks),
`.claude/rules/sms-experience-wave-ownership.md` (file/RPC ownership manifest — authoritative
where prose and manifest disagree on a name/path).

Two objectives:
1. **A2P code-readiness** before the 10DLC campaign approval lands (~2026-07-09, treated
   **pending-but-imminent, not done**).
2. **Make texting feel like iMessage/WhatsApp** — optimistic send, real-time inbound, delivery/read
   affordances, inline retry, clean bubble grouping, a segment-aware composer, zero compliance foot-guns.

This is a live-verified plan of record produced the roadmap-v3 way (evidence audit → gap taxonomy →
Foundation-then-wave phase design → adversarial challenge pass). It was built read-only; the plan
below is what ships. **All evidence is from live code/DB reads on 2026-07-09**, not memory.

---

## 0. Executive summary

**A2P verdict: NOT code-ready.** The automated *gate logic* is strong (kill-switch default-OFF,
TCPA consent, DST-safe 8am–9pm quiet hours, consent-log audit, unit-tested), but there are **four
live P0 compliance/integrity holes** (below) and an A2P-sender wiring crux: `twilio.js` correctly
prefers a Messaging Service SID, but `integration_config.twilio_messaging_service_sid` is **NULL
live**, so the sender resolves entirely from the Cloudflare env var `TWILIO_MESSAGING_SERVICE_SID` —
**if that is unset, every send falls back to `From=<long code>`, not the A2P sender.** Owner must
verify that env var in both Cloudflare env sets (see §7 A2P checklist).

**iMessage-feel verdict: mid-fidelity with real gaps.** Realtime inbound + web push already work
end-to-end. Missing: optimistic send, per-message delivery affordance, inline retry, inbound MMS
rendering (photos show as **empty bubbles**), segment counter, draft persistence, pagination; plus
scroll-jank and unread-desync bugs.

**Structure (post-challenge):** a **Wave -1 compliance hotfix** ships first (the three live-now,
flag-independent P0s), then **Foundation split into F-core** (green, unblocks the wave) and **F-red**
(anon-closure — owner-gated, gates nothing), then **Wave 1 = A/B/C/D in parallel**, then **Wave 2 = G**
(verification tails). The field-tech PWA is covered because `Conversations.jsx` is one shared component
mounted at `/tech/conversations` too (§6).

**Cross-initiative posture:** `send-message.js` and `Conversations.jsx` are owned by the *unbuilt*
omni-inbox Phases O and U; `automated-send.js` is CRM-wave-frozen. **No branch is in flight for any of
them.** This initiative **absorbs omni O+U** and **amends the CRM automated-send freeze** via disclosed
cross-manifest amendments (§8) — superseding unbuilt plans, not colliding with live work. CRM
campaigns/blasts (4b) and the `sms_sending_enabled` flip stay **out of scope / owner's**.

---

## 1. Status reconciliation (in-flight initiatives touching this surface)

Verified from disk + git on `origin/dev` @ 07f6142.

| Initiative | State | Evidence | Contested files → this plan |
|---|---|---|---|
| **omni-inbox F** | **SHIPPED** (PR #309) | `email-threading.js`, `conversation-email.js`, `resend-webhook.js`, `20260704_omni_inbox_*.sql` on disk | consumed, not edited |
| **omni-inbox I / O / U** | **UNBUILT**, no branch | no `email-worker/`, no `inbound-email.js`, `send-message.js` has 0 `channel`, `Conversations.jsx` fallback still live | **O→absorbed (Phase B), U→absorbed (Phase C)** (§8) |
| **CRM 4b** (text blasts) | **UNBUILT**, ext-gated | `Marketing.jsx:33` placeholder, no `send-text-campaign.js` | **OUT** (campaigns + kill-switch flip stay owner's) |
| **CRM 5 / 5-Ops** | 5 shipped; 5-Ops plan-only | `process-crm-automations.js` has 0 `trigger_kind` | **OUT** (5-Ops-owned) |
| **notify** | **SHIPPED** (all boxes [x]) | `notify.js` + `webPush.js` on disk; web push live | **call-only**; delivery = HAVE |
| **db-foundation** | F,P1–P7 shipped to `main` | §8 deferred-hardening keyed to omni I/O/U (never merged) | **F-red closes the deferred anon gap** |

**Stale-checkbox disclosure:** omni-inbox roadmap Phase F checkboxes are **all unticked despite F
shipping (#309)**. F-core ticks them / adds a SHIPPED banner (owner-disclosed cross-doc edit).

---

## 2. Gap audit (capability taxonomy A–H)

Verdicts: **HAVE** (from code/schema only) / **PARTIAL** / **MISSING**. Full evidence table in the
audit appendix (§11). Highlights:

- **A. Delivery & reliability** — outbound send HAVE; status lifecycle PARTIAL (raw passthrough, no
  whitelist/monotonic guard); **error-code mapping MISSING** (30034/30007/21610/30006 stored at best as
  raw text, never mapped to suppression/UI); segments/price MISSING; **throughput/queueing MISSING**.
- **B. Inbound & real-time** — Supabase Realtime INSERT+UPDATE HAVE (live-verified in
  `supabase_realtime` publication); web push HAVE; **reconnect/stale-tab recovery MISSING**
  (acute on Capacitor iOS); per-thread push deep-link MISSING.
- **C. Conversation UX** — day dividers/threading/templates HAVE; **optimistic send MISSING**;
  delivery affordance PARTIAL; **inline retry MISSING**; **inbound MMS render MISSING**; in-thread
  search MISSING; unread/scroll bugs.
- **D. Composer** — multiline+Enter, templates, scheduled-send HAVE; **GSM-7/UCS-2 segment counter
  MISSING**; MMS attach MISSING (disabled); draft persistence MISSING.
- **E. Compliance & consent** — STOP/START/HELP + audit HAVE; gate logic strong but **NOT
  structurally unbypassable** (`skip_compliance`, participant[0]-only group check); quiet-hours HAVE
  but per-recipient tz dead-code; STOPALL/punctuation gap.
- **F. Identity & routing** — sender resolution HAVE (but MG-SID null live → env-only); **inbound
  phone→contact PARTIAL** (exact-string match, 9/148 non-E.164); org scoping MISSING (single-org).
- **G. Mobile & responsive** — dvh/safe-area/panel-swap HAVE; **keyboard/visualViewport MISSING**;
  tap targets sub-48px; `tech-mobile-ux.md` not applied to the `/tech/conversations` mount.
- **H. Observability & ops** — automation engines write `worker_runs` HAVE; **twilio-webhook /
  twilio-status / process-scheduled write NONE**; no delivery/cost visibility surface.

---

## 3. Severity findings (numbered; exposure + interim guidance)

Each was independently **challenge-CONFIRMED** (§10). `P0` = compliance/data-loss; `P1` = broken
core/real exposure; `P2` = quality; `P3` = polish. Live facts pinned 2026-07-09: `sms_sending_enabled
= FALSE` both orgs; anon policies live on messages/conversations/conversation_participants;
`twilio_messaging_service_sid` NULL.

**P0 — live now (kill-switch OFF → flag-INDEPENDENT, exposed today):**
- **F-1 Silent fake-send.** `Conversations.jsx:433` calls `res.json()` *before* `res.ok` (`:435`);
  any worker error → `catch` (`:452`) → `db.insert('messages', {status:'queued'})` ghost row (`:464`)
  + a "sent" bubble. Staff believe a customer was texted; no SMS left. *Interim:* treat outbound as
  unconfirmed until Twilio console shows it; **Fix in Wave -1.**
- **F-2 `skip_compliance` bypass.** `send-message.js:57,101` — any valid JWT can skip the entire DND +
  opt-in chain. Zero legitimate callers. *Interim:* none needed (no caller); **remove in Wave -1.**
- **F-3 STOP misses the real contact.** `twilio-webhook.js:140` exact `phone=eq.{from}`; a non-E.164
  contact (9/148 live) gets a *duplicate* row flagged on STOP while the original stays opted-in →
  **send-after-STOP (TCPA, per-message penalties).** *Interim:* manually reconcile any STOP that
  created a dup contact; **fix in Wave -1** (digits-OR match + update all matching rows).
- **F-4 Group/broadcast consent bug.** `send-message.js:103` checks only `participants[0]`, then loops
  a send to every participant (`:170-198`). **Latent** (no UI creates group convos today). *Interim:*
  do not create group/broadcast conversations; **Wave -1 adds a 3-line refuse-guard; Phase B adds the
  full per-participant loop.**
- **F-5 Anon RLS on core SMS tables.** `messages`/`conversations`/`conversation_participants` carry
  live `anon USING(true)` policies + table GRANTs → the SMS archive is readable (and message rows
  forgeable via INSERT) with the browser anon key. (`messages` has no anon UPDATE/DELETE *policy* →
  read-surface-dominated.) Deferred by db-foundation §8 behind omni. *Interim:* accept (known,
  authenticated app unaffected); **close in F-red** (owner-gated, behavior-neutral).

**P1 — real exposure as volume/flag rises:**
- **F-6** Inbound MMS renders empty bubble (`media_urls` fetched, never rendered) → **Phase C**.
- **F-7** Exact `Yes`/`info` replies swallowed by keyword handling, never stored → **Wave -1 / Phase A**.
- **F-8** `twilio-status.js` has no signature validation → spoofable delivery state → **Phase A**.
- **F-9** Inbound lost on any DB error (returns 200, no `worker_runs`, no retry) → **Phase A**.
- **F-10** `run-automations` **permanently drops** quiet-hours-deferred texts (terminal skip via
  `alreadyFired`; 60-min lookback also expires overnight) → **Phase D** (needs BOTH stop-persist-skip
  AND widen lookback). **Inert today** (kill-switch OFF).
- **F-11** `process-scheduled` unauthenticated + non-atomic claim (id-only, no `status` precondition)
  → remotely-triggerable double-sends → **F-core** (atomic claim RPC) + **Phase A** (auth gate).
- **F-12** Automated SMS invisible in thread + untracked (`sendGatedSms` writes no conversation/
  message row, no statusCallback) → **Phase D**.
- **F-13** Token rotation via Connections page kills inbound (webhook signature is env-only) → **Phase A**.

**P2/P3** (condensed; full list §11): error-code intelligence surface, MPS pacing/429, `worker_runs`
on Twilio workers, wrong-thread injection mid-send, unread desync, scroll yank, pagination, realtime
publication drift, per-thread deep-link, keyboard handling, missing worker tests, segment counter,
`toast`→CustomEvent, STOPALL/punctuation, per-recipient tz, staff-scheduled quiet-hours, tap targets,
`Layout.jsx` 30s unread poll.

---

## 4. Phase design

Model/effort logic: **Opus·high** for consent/TCPA/compliance, live-RPC replaces, public
unauthenticated surfaces, migrations; **Sonnet·medium** for verification/close-out/scaffolding.

Every phase's close-out: named test-first targets → acceptance criteria → `npm run test` + `build` +
eslint (changed files) → reviewer gauntlet (`sms-experience-phase-reviewer` + `consent-path-auditor`
on send paths + `migration-safety-checker`/`anon-grant-auditor` on migrations + `upr-pattern-checker`)
→ visual check (desktop + mobile, incl. `/tech/conversations`) → update `UPR-Web-Context.md` →
reconcile this roadmap's checkboxes (both directions) → delete TEST rows → push → **open a PR into
`dev` as a handoff and STOP** (owner merges; no click-merge/subscribe/babysit).

### Wave -1 — Compliance/Integrity Hotfix (Session H0 · Opus·high · consent-weighted)
> **Prerequisite:** none (ships first). **Read scope:** CLAUDE.md + this block + the manifest.
> Minimal surgical diff; the absorbed omni O/U lines are disclosed here.

Fixes only the three live-now flag-independent P0s + one latent-neutralizer:
- `send-message.js`: delete `skip_compliance` param + gate; add a 3-line refuse when
  `conversations.type in ('group','broadcast')` (neutralizes F-4 until Phase B).
- `twilio-webhook.js`: `normalizePhone` (`phone.js:34-40`) digits-OR STOP lookup, **update ALL
  matching contact rows**; store the inbound row for exact `Yes`/`info` **before** the keyword
  early-return (F-7).
- `Conversations.jsx`: check `res.ok` **before** `res.json()`; **delete the ghost-insert fallback**
  (`452-466`); surface the real error via `upr:toast` (Rule 2).

**Test-first:** `send-message.test.js` (consent gate holds, `skip_compliance` gone),
`twilio-webhook` STOP digits-OR match test. **Close-out checklist:**
- [x] committed failing tests → fixes _(red committed first: send-message.test.js new; twilio-webhook.test.js extended)_
- [x] `skip_compliance` removed; group/broadcast refuse-guard in place _(F-2/F-4 — 400 `MULTI_RECIPIENT_UNSUPPORTED`)_
- [x] STOP matches non-E.164 contacts + updates all rows; `Yes`/`info` stored _(F-3 digits-OR `id=in.(…)`; F-7 persist-before-early-return)_
- [x] fake-send fallback gone; real errors surfaced _(F-1 — ghost insert deleted; `upr:toast` on failure)_
- [x] reviewers green → PR into `dev`

### Wave 0 — F-core (Session F · Opus·high)  [may run ∥ Wave -1, disjoint files]
> ✅ **SHIPPED 2026-07-09** (migrations applied + verified live via MCP; atomicity gate green; unit +
> least-privilege tests green). Delivered: drift-capture of the 5 SMS tables
> (`20260709_sms_f01_drift_capture.sql`); additive `messages.num_segments`/`price` + realtime-publication
> tracking (`…f02…`); `claim_scheduled_message` + `increment_conversation_unread` RPCs +
> `scheduled_messages.claimed_at` (`…f03…`, `authenticated`+`service_role` only); `functions/lib/twilio-errors.js`;
> the frozen-contract specs in manifest §9; omni-F SHIPPED banner. Anon-policy closure is **deferred to
> F-red** (owner-gated), as designed — not done here.
>
> **Prerequisite:** none. **Read scope:** CLAUDE.md + this block + manifest + `database-standard.md`.
> Green additive; unblocks the wave. Owns **100% of schema** + new shared libs + manifest + frozen
> contracts.

- **Drift-capture migration** for the 5 untracked SMS tables (`messages`, `conversations`,
  `conversation_participants`, `sms_consent_log`, `scheduled_messages`) — schema-as-code baseline
  (DBF/tech-v2 precedent), additive/no-op, with the `documentation-standard.md` SQL header.
- Additive columns: `messages.num_segments int`, `messages.price numeric`.
- Track live objects into migrations: `messages.twilio_sid` UNIQUE index; `messages`/`conversations`
  membership in the `supabase_realtime` publication (fixes untracked drift).
- **`claim_scheduled_message(p_id)`** SECURITY DEFINER compare-and-set RPC → kills F-11 double-send.
- **Atomic `conversations.unread_count` increment** RPC/helper (A+D shared-prod concurrency).
- New lib **`functions/lib/twilio-errors.js`**: `30034/30007/21610/30006 → {label, suppress,
  contactFlag, uiClass}`. Tested.
- **Frozen contracts** (specified in the manifest; F does NOT edit the consumer files): the
  `/api/send-message` request+response schema (B implements, C consumes); the `messages` insert
  column-shape; `sendAutomatedMessage`/`sendGatedSms` signature **and** return `{ok, skipped, reason}`
  vocabulary (incl. `'sms_disabled'`/`'quiet_hours'`).
- Ownership manifest + two disclosed cross-manifest amendments (§8). Reserved `index.css` markers
  (note: omni-U's marker already exists at `index.css:623` — C inherits it). Tick omni-F stale boxes.

**Test-first:** claim-RPC atomicity test; drift-capture round-trip; `twilio-errors` mapping table.
**Grants:** SECURITY DEFINER RPCs `GRANT EXECUTE TO authenticated, service_role` (never `anon`).
**Close-out:** migrations applied+verified live via MCP in a sequenced window; `migration-safety-checker`
+ `anon-grant-auditor` green.

### Wave 0-RED — F-red (Session F-red · Opus·high · owner-gated · GATES NOTHING)
> **Prerequisite:** none for build; **apply is owner-gated** (RED-tier prod policy change).
> Own apply window, parallel to the wave, **behavior-neutral** (app runs as `authenticated`).

Recreate `messages` / `conversations` / `conversation_participants` / `automation_settings` policies
**TO authenticated** (close the db-foundation §8 deferred anon gap). Backward-compat tests proving the
service-role workers (twilio-webhook/status/process-scheduled) **and** the authenticated app keep full
access. Stage migration + rollback + tests; wait for owner OK per `database-standard.md` §5.
**Gates nothing** — A/B/C/D never wait on it.

### Wave 1 — A, B, C, D in parallel (after F-core + Wave -1 merge)

**Phase A — Transport/worker hardening** (Opus·high). Owns `twilio-webhook.js`, `twilio-status.js`,
`process-scheduled.js` + tests.
- `twilio-status`: signature validation (**DB-first `resolveCredential`**, not env-only) + status
  whitelist + monotonic/out-of-order guard; capture `num_segments`/`price`.
- Error-code mapping via `twilio-errors.js` → suppression writes + contact flags + surfaced
  `error_code` (F-5-adjacent visibility).
- `worker_runs` row on all three workers; stop losing inbound (500 on transient so Twilio retries; 200
  only on dup-sid 409) — F-9.
- `process-scheduled`: add auth gate (cron-secret/requireAuth, like `run-automations`) + call
  `claim_scheduled_message` + quiet-hours guard on staff-scheduled sends.
- STOPALL + punctuation tolerance. (F-3 STOP-match + F-7 already in Wave -1; A carries them forward.)
- *Note:* larger phase (3 small workers, same hardening flavor, all uncontested) — peel
  `process-scheduled` into a micro-phase only if review bandwidth prefers.

**Phase B — Staff send chokepoint** (Opus·high) **[absorbs omni O, SMS-only]**. Owns
`send-message.js` + `send-message.test.js`.
- Full **per-participant** consent loop (Wave -1 only refuse-guarded) + **per-recipient `messages`
  rows** so group failures are recorded.
- Adopt omni §7 "refuse, never cross-channel fallback / worker is sole writer" invariant.
- Surface `error_code`/`error_message`; segment-aware. `skip_compliance` already gone.
- omni-O's `channel` param + email branch is **left for future** (B is SMS-only) — disclosed (§8).

**Phase C — Conversation UX rebuild** (Opus·high) **[absorbs omni U] — SINGLE SESSION** (decided at
plan time; Wave -1 removed the P0, so no Foundation slot pre-extraction). Owns `Conversations.jsx` +
new `src/components/conversations/**` + `index.css` §623 (omni-U marker).
- Remove the fallback properly; **optimistic send** (client-id reconcile) → sent → delivered → failed
  affordance (F's `uiClass`) + **inline retry**.
- Inbound **MMS render** + outbound MMS attach; **segment/char counter** (GSM-7 vs UCS-2, accounting
  for the server name-prefix); **draft persistence** per thread; **pagination**; scroll anchoring +
  jump-to-latest; unread-desync fix; wrong-thread-injection fix; multiline `pre-wrap`; linkify
  (scheme-whitelisted); per-thread deep-link URL; `toast`→CustomEvent.
- **Tech PWA (§6):** apply `tech-mobile-ux.md` to the `/tech/conversations` mount (≥48px targets,
  one-tap, status-color-from-3-feet); **Capacitor webview-suspend recovery** (`visibilitychange`/focus
  refetch — consumer-side, NO edit to frozen `realtime.js`); keyboard/`visualViewport` handling.

**Phase D — Automated visibility & throughput** (Opus·high) **[disclosed CRM amendment §8]**. Owns
`functions/lib/automated-send.js`, `functions/api/run-automations.js` + tests.
- Automated SMS write conversation + `messages` rows (**service-role, worker-sole-writer**) +
  statusCallback → visible in-thread + delivery-tracked (F-12).
- Held-retry for quiet-hours in `run-automations` — **BOTH** stop persisting a terminal skip **AND**
  widen the candidate lookback (F-10).
- MPS pacing/batching + 429 backoff + transient-vs-permanent classification via `twilio-errors`.
- Per-recipient timezone for quiet hours (load `contact.timezone`).
- **Freeze** signature + return vocabulary; committed **backward-compat tests for `process-sequences`
  (Phase 8) and `process-crm-automations` (Phase 5)**; disclose the thread-row-write behavior change to
  those two workers (§8).

### Wave 2 — Phase G — Deliverability ops + verification tails (Session G · Sonnet·medium)
> **Prerequisite:** A + C merged (verification tails). Owns a new deliverability health component,
> `src/components/Layout.jsx` (unread-badge only), tech-PWA verification.

- Deliverability/`worker_runs` health surface (new component): error-code intelligence, failed-message
  visibility, A2P/messaging-service health.
- Unread-badge realtime consolidation (`Layout.jsx` — drop the 30s poll, use the existing
  `subscribeToConversations`).
- Per-thread push deep-link E2E (tail of A's webhook link + C's URL param).
- **Tech-PWA on-device verification lane** (iOS Capacitor: `/tech/conversations` tap targets,
  keyboard, reconnect-after-suspend, push-tap→thread).
- **A2P live-smoke decision fork** (§7).

---

## 5. Dependency graph (edge types)

```
Wave -1 (H0 hotfix) ─┐  disjoint files → may run ∥
Wave 0   (F-core)    ─┼──────────────► Wave 1 { A ∥ B ∥ C ∥ D } ──► Wave 2 (G: tails of A+C)
Wave 0-RED (F-red) ── owner-gated, own apply window, GATES NOTHING (behavior-neutral) ── anytime
A2P 10DLC ─────────── external anytime gate (shared w/ CRM 4b) ── owner-confirmed; no live-send test until confirmed
```
Edge types: **hard artifact** = Wave 1 depends on F-core's frozen contracts + Wave -1's P0 fixes
(the absorbed lines are rewritten by A/B/C). **independent** = A/B/C/D pairwise-disjoint files (§9).
**externally-gated** = A2P (anytime lane). **soft verification-tail** = G after A+C. **soft merge
preference** = A with-or-before D (D's new statusCallback volume should hit A's hardened status
endpoint) — preference, not a gate. **D→C is explicitly NOT an edge** (D writes plain rows F freezes;
they render on old + new UI alike — challenge-confirmed).

---

## 6. Tech PWA scope (owner Q, 2026-07-09)

`Conversations.jsx` is **one shared component** mounted at `/conversations` (web, `Layout`),
**`/tech/conversations` (Capacitor iOS `TechLayout`, `App.jsx:279`)**, and `/crm/conversations`
(`CrmLayout`) — so Phase C's rebuild + the A/B/D backend fixes reach the field-tech app automatically.
Explicit tech-PWA items are folded into **Phase C** (tech-mobile-ux compliance, Capacitor
suspend-recovery, keyboard) and a **Phase G** on-device verification lane. **Notification delivery =
HAVE** — web push confirmed working on the PWA by the owner; **APNs (`send-push.js`) stays dormant /
OUT** (no revival). Only the per-thread **deep-link** (tap → correct thread) is in scope.

---

## 7. A2P 10DLC — hard gate (do not launch on hope)

**No wave session builds or tests the live A2P send path until approval is confirmed.**

**Decision fork (Phase G tail):** *if the campaign is confirmed approved at the session's start →* run
a single live smoke send (dev tracking number, TEST contact) as the E2E tail; *else →* build against
frozen contracts and defer the live send to the anytime gate lane, said in the PR, **never faked**.

**Owner checklist (config/ops-readiness — not repo-verifiable; Twilio MCP unconfigured here):**
- [ ] **`TWILIO_MESSAGING_SERVICE_SID` set in BOTH Cloudflare env sets** (Production + Preview) — else
  sends fall back to `From=<long code>`, not the A2P sender. *(DB `integration_config` value is NULL.)*
- [ ] Brand + campaign approved; number pool attached to the Messaging Service.
- [ ] Webhook + status-callback URLs registered in Twilio match `/api/twilio-webhook` + `/api/twilio-status`.
- [ ] Registered use-case sample messages still match what the app sends.
- [ ] Opt-in flow evidence on file.

The `sms_sending_enabled` **kill-switch flip stays the owner's** (CRM 4b arming action).

---

## 8. Cross-manifest amendments (rule-amendment transparency)

Both are disclosed supersessions of *unbuilt* plans (no branch in flight — challenge-verified §10).

**(a) Absorb omni-inbox Phases O + U.** `.claude/rules/omni-inbox-wave-ownership.md` §2 assigns
`send-message.js` to O and `Conversations.jsx` + `src/components/conversations/**` to U. **Amendment:**
Phase B absorbs O (SMS-only — the `channel`/email branch is left for a future omni email reconciliation,
which builds on B's hardened file rather than greenfield); Phase C absorbs U (and writes into omni-U's
existing `index.css:623` marker — concrete proof this is absorption, not a parallel build). **Rationale:**
the two P0 fixes (F-1 fake-send, F-2 `skip_compliance`) and the entire iMessage-feel objective are
impossible without owning these two files; omni O/U are unbuilt with no branch. **Compatibility:** omni
§7 wrong-channel invariants are *implemented* by B/C (§7.1 "worker is sole writer" = C's fake-send fix;
§7.3 "refuse, no cross-channel fallback" = B's `skip_compliance` removal + per-recipient consent), not
violated.

**(b) Amend the CRM automated-send freeze.** `.claude/rules/crm-wave-ownership.md` §1 freezes
`automated-send.js` import-only. **Amendment:** Phase D edits `automated-send.js` + `run-automations.js`
**additively**, freezing BOTH the signature AND the return `{ok,skipped,reason}` vocabulary — the strings
`'sms_disabled'`/`'quiet_hours'` are load-bearing for held-retry in `process-sequences.js:143` (Phase 8)
and `process-crm-automations.js` (Phase 5). New reason strings are additive-safe (fall through to the
default skip branch). **Required:** committed backward-compat tests that both non-owned callers still
succeed; disclose that D's thread-row writes change those two workers' observable output (additive).
**Precedents:** omni-F's `process-sequences` widen; settings P9's `functions/lib` exception.

---

## 9. Disjointness (challenge-proven §10)

File ownership across Wave 1 is pairwise-disjoint (verified via imports): A `{twilio-webhook,
twilio-status, process-scheduled}` · B `{send-message}` · C `{Conversations, components/conversations,
index.css §623}` · D `{automated-send, run-automations}`. Shared surfaces are all **F-core-frozen
contracts** consumed import-only: `twilio-errors.js`, the `messages` insert shape, the atomic
`unread_count` increment, the `/api/send-message` request/response schema (the B×C seam — frozen as a
stub so B and C are not serial), and the `sendAutomatedMessage` signature+return vocab. Only C writes
`index.css`. `F×G` collision resolved: G's test backfill was scoped out (A/B ship their own worker
tests; `process-scheduled` tests go with A).

---

## 10. Adversarial challenge pass — what changed

Ran read-only: refute-first re-verification of 6 least-certain load-bearing claims, pairwise +
cross-manifest disjointness proofs, and a counter-ordering skeptic.

- **Refute (6/6 CONFIRMED):** run-automations permanent-drop (fix needs stop-persist **AND** lookback
  widen); process-scheduled unauth + non-atomic; twilio-status no signature (use DB-first cred);
  automated SMS invisible (insert via service-role); anon RLS live (read-surface-dominated; backward-
  compat must cover service-role workers); MG-SID NULL live (env-only A2P sender — the crux).
- **Disjointness:** file-level A/B/C/D disjoint, but **5 hidden shared artifacts** surfaced → moved into
  F-core (send-message contract freeze; return-vocab freeze; atomic unread increment; frozen insert
  shape) + closed the `process-scheduled` ownership gap (→ A) + scoped G's tests out.
- **Counter-ordering (WON):** added **Wave -1 hotfix** (the three live-now P0s were buried behind an
  owner-gated Foundation) and **split Foundation F-core/F-red** (anon-closure is behavior-neutral →
  gates nothing). Rejected the over-broad version (don't sweep the *latent* group loop or the *inert*
  run-automations drop into the hotfix — they stay in B/D). Kept the plan's correct call that **D→C is
  not a hidden edge.**

Every outcome is folded into §§3–9 above. **Challenge-CONFIRMED** markers: F-1…F-13 all survived
adversarial re-verification.

---

## 11. Gap-audit appendix (evidence)

Full HAVE/PARTIAL/MISSING rows with `file:line` evidence and the complete P2/P3 finding list are
preserved from the six-agent live audit (frontend `Conversations.jsx`; inbound/status/transport;
automation senders; realtime/push/mobile; initiative recon; schema/tests). Key untracked-schema note
(Rule 7): the 5 core SMS tables have **no `CREATE TABLE`** in migrations — live shape must be verified
via `information_schema`, and F-core ships the drift-capture baseline before any table is touched.
Tables' live column lists (verified 2026-07-09) are recorded in `UPR-Web-Context.md`.

---

## What resisted maximum parallelism (ledger)

- **Wave -1 is serial-first by necessity** — live P0s can't wait for the wave; the absorbed lines are
  rewritten by A/B/C (accepted ~10 throwaway lines).
- **B×C share the `/api/send-message` contract** → F-core freezes it as a stub (else serial).
- **D edits a CRM-frozen shared lib** → disclosed §8 amendment + return-vocab freeze + backward-compat
  tests for 2 non-owned callers. **Fallback-to-serial** if a 4b/5-Ops branch appears mid-wave.
- **F-red is owner-gated** (RED prod policy) → decoupled so it gates nothing.
- **Foundation single-point-of-failure** priced via the reviewer gauntlet (`migration-safety-checker`
  + `anon-grant-auditor` + `sms-experience-phase-reviewer`).
- **A2P external gate** → anytime lane, live-send deferred, never faked.
- **Phase A is on the larger side** (3 workers) — accepted (small surgical hardening, uncontested).

---

*Companion: `docs/sms-experience-dispatch.md` (launch blocks), `.claude/rules/sms-experience-wave-ownership.md`
(ownership — authoritative on names/paths). Reviewer: new `sms-experience-phase-reviewer` +
reused `consent-path-auditor`, `migration-safety-checker`, `anon-grant-auditor`, `upr-pattern-checker`.*
