# SMS Experience — Session Dispatch Blocks

Copy-paste launch blocks for every sms-experience build session, per the plan of record in
`docs/sms-experience-roadmap.md` (Wave -1 hotfix → Foundation F-core/F-red → Wave 1 A/B/C/D →
Wave 2 G). Each block is fully self-contained for a cold session with **zero conversation history**:
settings header, then the complete prompt. Claude Code web hands each session a harness-assigned
`claude/…` branch — **use it as-is** (CLAUDE.md); the `Branch` line below is the illustrative name for
humans tracking PRs.

**How work lands (per CLAUDE.md Rule 4):** these build sessions are the branch-and-PR exception to
direct-to-`dev`. Each cuts a branch and its close-out opens a **PR into `dev` purely as a handoff, then
stops**. The owner (or orchestrating session) merges each PR; sessions do **not** click-merge,
subscribe to, babysit, or wait for a review on their PR (the bot reviewer is off). Branches exist only
so the parallel sessions don't collide.

**Base-preflight (MANDATORY — first action of every session):** the harness may start your container
from `main` or a stale commit, NOT the `dev` tip that carries this plan. So your FIRST action is:
```
git fetch origin dev && git checkout -B "$(git branch --show-current)" origin/dev
```
Then verify these plan-of-record files are on disk: `docs/sms-experience-roadmap.md`,
`.claude/rules/sms-experience-wave-ownership.md`, `docs/sms-experience-dispatch.md`,
`.claude/agents/sms-experience-phase-reviewer.md`. **If any is missing, your base is wrong — STOP and
re-sync; never recreate them.** Plan docs are CONSUMED, never re-authored by a build session.

**Preconditions & owner decisions due at dispatch:**
- **Wave -1 (H0)** and **Wave 0 (F-core)** launch immediately (disjoint files; both merge before Wave 1).
- **Wave 1 (A/B/C/D)** launches after BOTH H0 and F-core PRs merge into `dev`.
- **Wave 2 (G)** launches after A + C merge (verification tails).
- **F-red** builds anytime; its **apply is owner-gated** (RED prod policy change) — it gates nothing.
- **① A2P 10DLC** — external anytime gate. Owner confirms campaign approval + that
  `TWILIO_MESSAGING_SERVICE_SID` is set in BOTH Cloudflare env sets (else sends use a long code, not the
  A2P sender). No session builds/tests the live A2P send path until the owner confirms approval
  (roadmap §7 fork). The `sms_sending_enabled` flip stays the owner's (CRM 4b).
- **② Cross-manifest absorption** — this plan absorbs unbuilt omni O/U and amends the CRM automated-send
  freeze (roadmap §8), owner-approved 2026-07-09. Sessions cite the amendment; they do not re-litigate it.

Each wave's sessions may launch **simultaneously** (throttle to your review bandwidth — merge order is a
preference, never a gate).

---

## Wave -1 — Session H0 (ships first; may run ∥ with F-core)

```
[Session H0 — Wave -1]
Branch: session-assigned (illustrative: sms/hotfix-compliance-p0), cut from origin/dev
Model: Opus 4.8
Effort: High
Launch after: nothing — ships first

You are shipping the sms-experience COMPLIANCE/INTEGRITY HOTFIX (Wave -1) — one focused session, no
scope creep. Fix ONLY the three live-now P0s + one latent-neutralizer; leave the rest to the wave.
FIRST run the Base-preflight (fetch origin dev, checkout -B onto origin/dev, verify the four plan files
exist — if missing STOP, do not recreate). Read scope: CLAUDE.md + the "Wave -1" phase block in
docs/sms-experience-roadmap.md + .claude/rules/sms-experience-wave-ownership.md (you own send-message.js,
twilio-webhook.js, Conversations.jsx surgical lines, + a new send-message.test.js). These files are
normally omni O/U owned — this hotfix absorbs exactly these lines per roadmap §8 (disclose in the PR).

Order of work (riskiest/test-first):
1. functions/api/send-message.test.js (NEW, committed failing first): assert the consent gate blocks
   DND + non-opted-in; assert there is NO skip_compliance path; assert group/broadcast is refused.
2. functions/api/send-message.js: DELETE the skip_compliance param + its `if (!skip_compliance)` gate
   (zero callers). ADD a 3-line hard refuse when conversation.type in ('group','broadcast') (returns a
   clear error; the full per-participant loop is Phase B, not here).
3. functions/api/twilio-webhook.js: import normalizePhone from ../lib/phone.js; resolve the inbound
   sender by a digits-based OR match (not exact phone=eq.{from}); on STOP/START, update ALL matching
   contact rows, not just one. Store the inbound message row for exact 'Yes'/'info' BEFORE the keyword
   early-return so the reply is never swallowed. Add a committed test for the digits-OR STOP match.
4. src/pages/Conversations.jsx: in handleSend, check res.ok BEFORE res.json(); DELETE the
   catch-fallback db.insert('messages', {status:'queued'}) block entirely; on failure surface the real
   error via window.dispatchEvent(new CustomEvent('upr:toast', {detail:{message,type:'error'}})) (Rule 2)
   and do NOT append a bubble.

Hard constraints: additive/surgical only; do NOT build the per-participant loop, error-code mapping,
optimistic send, or MMS (those are wave phases). Do NOT touch any other file. Do NOT test a live A2P
send. Keep channel:'sms' semantics intact.

Close-out: npm run test + npm run build + npx eslint (changed files) green → run the
sms-experience-phase-reviewer + consent-path-auditor agents and address blocking findings → update
UPR-Web-Context.md → tick this phase's roadmap checkboxes (both directions) → delete any TEST rows →
push -u → open a PR into dev as a handoff → STOP (owner merges; do not subscribe/babysit/click-merge).
```

## Wave 0 — Session F (F-core; may run ∥ with H0)

```
[Session F — Wave 0]
Branch: session-assigned (illustrative: sms/f-core-foundation), cut from origin/dev
Model: Opus 4.8
Effort: High
Launch after: nothing — ships alongside H0 (disjoint files)

You are building sms-experience F-core (Foundation) — one session. You own 100% of the schema + shared
libs + frozen contracts + the ownership manifest; the wave phases ship ZERO schema. FIRST run the
Base-preflight. Read scope: CLAUDE.md + the "Wave 0 — F-core" block in docs/sms-experience-roadmap.md +
.claude/rules/sms-experience-wave-ownership.md + .claude/rules/database-standard.md +
.claude/rules/documentation-standard.md (SQL header).

Order of work (migrations first, Rule 7; verify live column names before writing — the 5 core SMS
tables have NO CREATE TABLE in migrations):
1. Drift-capture migration: capture the LIVE shape of messages, conversations, conversation_participants,
   sms_consent_log, scheduled_messages via information_schema / pg_get_* (no-op baseline; documents, does
   not mutate). Include the SQL doc header (WHAT / ADDITIVE-ONLY / ROLLBACK).
2. Additive columns: messages.num_segments int, messages.price numeric. Track the live
   messages.twilio_sid UNIQUE index + the messages/conversations membership in the supabase_realtime
   publication (fix untracked drift).
3. claim_scheduled_message(p_id) SECURITY DEFINER compare-and-set RPC (returns boolean; claims only a
   still-pending row) — kills the process-scheduled double-send. Plus an atomic conversations.unread_count
   increment RPC/helper. GRANT EXECUTE TO authenticated, service_role (never anon). Test-first: an
   atomicity test proving two concurrent claims yield exactly one winner.
4. functions/lib/twilio-errors.js (new): map 30034/30007/21610/30006 → {label, suppress, contactFlag,
   uiClass}; unit-tested.
5. Write the frozen-contract specs into the manifest (do NOT edit the consumer files): the
   /api/send-message request/response schema; the messages insert column-shape; the sendAutomatedMessage
   /sendGatedSms signature + return {ok,skipped,reason} vocab. Add reserved index.css note (omni-U marker
   already at index.css:623 — C inherits it). Tick omni-inbox roadmap Phase F stale checkboxes / add a
   SHIPPED banner (disclosed cross-doc edit).

Hard constraints: additive-only (no ALTER/DROP/rename of a live table); RLS + explicit TO authenticated
policy on anything new; apply migrations via Supabase MCP in a sequenced low-traffic window and verify
live; one shared prod DB — a migration is live in prod the moment it applies. Do NOT close the anon
policies here (that is F-red, owner-gated). Do NOT edit send-message.js / Conversations.jsx /
automated-send.js (wave phases own them).

Close-out: npm run test + build + eslint green → migration-safety-checker + anon-grant-auditor +
sms-experience-phase-reviewer → apply+verify live via MCP → update UPR-Web-Context.md → reconcile
roadmap checkboxes → delete TEST rows → push -u → PR into dev as handoff → STOP.
```

## Wave 0-RED — Session F-red (build anytime; apply owner-gated)

```
[Session F-red — Wave 0-RED]
Branch: session-assigned (illustrative: sms/f-red-anon-closure), cut from origin/dev
Model: Opus 4.8
Effort: High
Launch after: nothing to BUILD; APPLY waits for explicit owner OK (RED-tier). Gates nothing.

You are building sms-experience F-red — the anon-policy closure on the core SMS tables — one session.
This is a RED-tier change on the ONE shared prod Supabase: STAGE the migration + rollback + tests and
WAIT for the owner's explicit OK before applying. It is behavior-neutral (the app runs as authenticated)
so it GATES NOTHING — do not let any wave phase wait on it. FIRST run the Base-preflight. Read scope:
CLAUDE.md + the "Wave 0-RED" block in docs/sms-experience-roadmap.md +
.claude/rules/sms-experience-wave-ownership.md + .claude/rules/database-standard.md (§2 allowlist, §5
apply-window, §6 rollback).

Order of work:
1. Test-first: a committed backward-compat test proving the service-role workers (twilio-webhook,
   twilio-status, process-scheduled all use the service-role client) AND the authenticated app keep FULL
   access after the policies are recreated. Assert anon can no longer SELECT the SMS archive.
2. Migration: DROP the anon policies and recreate them TO authenticated on messages, conversations,
   conversation_participants, automation_settings (close the db-foundation §8 deferred gap). USING(true)
   floor is acceptable; tighten to org/ownership only if trivially safe. SQL doc header with a concrete
   ROLLBACK (the prior anon policy CREATE statements).
3. Confirm no anon table GRANT remains outside the database-standard.md §2 allowlist; add a
   `-- public: <reason>` comment only if an allowlisted exception genuinely applies (it should not here).

Hard constraints: additive/policy-only (no column changes); serialize the apply window so its strong-lock
DDL does not overlap another migration on the same tables (database-standard.md §5); do NOT apply until
the owner says go — stage and report. Run anon-grant-auditor + migration-safety-checker +
sms-experience-phase-reviewer BEFORE requesting the apply.

Close-out: tests + build green → reviewers green → PR into dev as handoff with a clear "RED — apply
owner-gated" note and the rollback → STOP. Apply live only on the owner's explicit OK, then re-verify
via MCP and note it in the PR.
```

---

## Wave 1 — Sessions A, B, C, D (launch after H0 + F-core merge; may run simultaneously)

```
[Session A — Wave 1]
Branch: session-assigned (illustrative: sms/a-transport-hardening), cut from origin/dev
Model: Opus 4.8
Effort: High
Launch after: H0 + F-core PRs merged into dev

You are building sms-experience Phase A — transport/worker hardening — one session, no scope creep.
FIRST run the Base-preflight. Read scope: CLAUDE.md + the "Phase A" block in
docs/sms-experience-roadmap.md + .claude/rules/sms-experience-wave-ownership.md. You own ONLY
functions/api/twilio-webhook.js, functions/api/twilio-status.js, functions/api/process-scheduled.js +
their tests. F-core shipped: functions/lib/twilio-errors.js, claim_scheduled_message RPC, the atomic
unread_count increment, num_segments/price columns — import/call these, do not redefine them. H0 already
landed the STOP digits-OR match + 'Yes'/'info' storage in twilio-webhook.js — carry them forward, do not
undo them.

Order of work (test-first on each worker):
1. twilio-status.js: validate the Twilio signature using the DB-first resolveCredential auth token (NOT
   env-only); whitelist MessageStatus; guard out-of-order callbacks (don't let a late 'sent' overwrite
   'delivered'); capture NumSegments/Price into messages.num_segments/price; write a worker_runs row;
   return 500 on transient DB error (let Twilio retry), 200 only on the dup-sid no-op. Committed tests.
2. twilio-webhook.js: map ErrorCode via twilio-errors.js (30034/30007/21610/30006) → suppression writes
   + contact flags; surface error_code; add STOPALL + punctuation tolerance to the keyword set; write a
   worker_runs row; stop losing inbound on DB error (500 transient / 200 dup-sid). Keep channel:'sms'.
3. process-scheduled.js: add an auth gate (cron-secret / requireAuth, mirroring run-automations.js);
   replace the non-atomic id-only claim with a call to claim_scheduled_message(p_id); add a quiet-hours
   guard on staff-scheduled sends (reuse automated-send's exported isWithinQuietHours); write worker_runs.

Hard constraints: zero schema migrations (F owns schema); do NOT edit send-message.js / Conversations.jsx
/ automated-send.js / realtime.js; do NOT test a live A2P send. Consume F's frozen contracts unchanged.

Close-out: npm run test + build + eslint green → sms-experience-phase-reviewer + consent-path-auditor →
update UPR-Web-Context.md → reconcile roadmap checkboxes → delete TEST rows → push -u → PR into dev as
handoff → STOP.
```

```
[Session B — Wave 1]
Branch: session-assigned (illustrative: sms/b-send-chokepoint), cut from origin/dev
Model: Opus 4.8
Effort: High
Launch after: H0 + F-core PRs merged into dev

You are building sms-experience Phase B — the staff send chokepoint — one session. This ABSORBS the
unbuilt omni Phase O (send-message.js), SMS-only (roadmap §8) — cite the amendment in the PR; the
channel/email branch is left for a future omni email reconciliation. FIRST run the Base-preflight. Read
scope: CLAUDE.md + the "Phase B" block in docs/sms-experience-roadmap.md +
.claude/rules/sms-experience-wave-ownership.md. You own ONLY functions/api/send-message.js +
send-message.test.js. H0 already removed skip_compliance and added a group/broadcast refuse-guard — build
the full loop on top of that.

Order of work (test-first):
1. Extend send-message.test.js: per-participant consent (a DND/opted-out participant beyond index 0 is
   NOT texted); a per-recipient failure records its own row; the worker is the sole writer.
2. send-message.js: replace the group/broadcast refuse-guard with a full per-participant loop that runs
   the DND + opt-in consent check for EACH participant before sending to them, and inserts a per-recipient
   messages row so per-recipient failures are recorded. Adopt the omni §7 invariant: refuse (never
   cross-channel fallback); the worker is the sole writer of sms_* rows. Surface error_code/error_message
   on the response (additive to F's frozen /api/send-message response contract — never remove/rename a
   field C reads). Keep it segment-aware (F's num_segments).

Hard constraints: zero schema; do NOT reintroduce skip_compliance; do NOT edit any other file; consume
F's frozen /api/send-message contract additively; do NOT test a live A2P send.

Close-out: test + build + eslint green → sms-experience-phase-reviewer + consent-path-auditor → update
UPR-Web-Context.md → reconcile checkboxes → delete TEST rows → push -u → PR into dev as handoff → STOP.
```

```
[Session C — Wave 1]
Branch: session-assigned (illustrative: sms/c-conversation-ux), cut from origin/dev
Model: Opus 4.8
Effort: High
Launch after: H0 + F-core PRs merged into dev

You are building sms-experience Phase C — the conversation UX rebuild (the iMessage/WhatsApp feel) — one
session. This ABSORBS the unbuilt omni Phase U (Conversations.jsx + src/components/conversations/**),
roadmap §8 — cite the amendment; write CSS into omni-U's existing marker at src/index.css:623. FIRST run
the Base-preflight. Read scope: CLAUDE.md + the "Phase C" block in docs/sms-experience-roadmap.md +
.claude/rules/sms-experience-wave-ownership.md + .claude/rules/tech-mobile-ux.md +
.claude/rules/UPR-Design-System.md. You own ONLY src/pages/Conversations.jsx, new
src/components/conversations/**, and src/index.css inside the §623 marker. H0 already removed the
fake-send fallback — keep it gone (the worker is the sole writer; the client inserts only internal_note).

Order of work (highest-value first):
1. Optimistic send: append a pending bubble with a client id immediately, reconcile with the worker's
   returned message; states pending → sent → delivered → failed with per-message affordance (icon/color
   via F's twilio-errors uiClass) + INLINE RETRY on failed. Select error_code/error_message (they exist)
   so failures show a reason.
2. Inbound MMS render (media_urls) + outbound MMS attach (the worker already accepts media_urls).
3. Composer: GSM-7/UCS-2 segment + char counter (account for the server name-prefix); draft persistence
   per thread; multiline pre-wrap; linkify with a scheme whitelist (no raw HTML).
4. List/scroll/perf: pagination (thread + list); scroll anchoring + jump-to-latest pill (don't yank a
   scrolled-up reader); fix the unread-desync on the open thread; fix wrong-thread injection mid-send;
   consolidate the toast to the upr:toast CustomEvent (Rule 2).
5. Deep-link + mobile: add a per-thread deep-link URL so a push tap lands in-thread; apply
   tech-mobile-ux.md to the /tech/conversations mount (≥48px targets, one-tap, status color from 3 feet);
   add Capacitor webview-suspend recovery via a visibilitychange/focus refetch in Conversations.jsx (do
   NOT edit src/lib/realtime.js); keyboard/visualViewport handling so the composer isn't covered.

Hard constraints: zero schema; the client may insert ONLY internal_note (never an sms_* row); consume F's
frozen /api/send-message contract; do NOT edit realtime.js, CrmConversations.jsx, or any worker; CSS only
inside the §623 marker; mobile-only rules use @media (max-width: 768px). Verify on desktop AND mobile,
including /tech/conversations.

Close-out: test + build + eslint green → sms-experience-phase-reviewer + upr-pattern-checker → visual
check desktop + mobile + tech shell → update UPR-Web-Context.md → reconcile checkboxes → push -u → PR
into dev as handoff → STOP.
```

```
[Session D — Wave 1]
Branch: session-assigned (illustrative: sms/d-automated-visibility), cut from origin/dev
Model: Opus 4.8
Effort: High
Launch after: H0 + F-core PRs merged into dev

You are building sms-experience Phase D — automated-send visibility & throughput — one session. This
AMENDS the CRM-wave freeze on automated-send.js (roadmap §8) — additive only; cite the amendment. FIRST
run the Base-preflight. Read scope: CLAUDE.md + the "Phase D" block in docs/sms-experience-roadmap.md +
.claude/rules/sms-experience-wave-ownership.md + .claude/rules/crm-wave-ownership.md (the freeze you are
amending). You own ONLY functions/lib/automated-send.js and functions/api/run-automations.js + their
tests.

Order of work (test-first; protect the frozen contract):
1. Backward-compat tests FIRST: prove process-sequences.js (Phase 8) and process-crm-automations.js
   (Phase 5) still succeed against sendAutomatedMessage's return — the reason strings 'sms_disabled' and
   'quiet_hours' MUST remain (held-retry depends on them). New reason strings are additive-only.
2. automated-send.js: inside sendGatedSms, after a successful gated send, write via the SERVICE-ROLE
   worker path a conversation find/create + a messages row + pass statusCallback, so automated texts are
   visible in the thread and delivery-tracked (worker is the sole writer — never the client). Add
   per-recipient timezone for quiet hours (load contact.timezone). Add MPS pacing/batching + 429 backoff
   + transient-vs-permanent classification via F's twilio-errors.js (stop infinite-retrying invalid
   numbers). Keep the kill-switch/consent/quiet-hours gates VERBATIM.
3. run-automations.js: fix the quiet-hours permanent-drop — do NOT persist a terminal system_events row
   on a quiet_hours/transient defer, AND widen the candidate lookback (or hold + retry) so an overnight
   speed-to-lead/missed-call is delivered when quiet hours lift, not lost.

Hard constraints: zero schema; NEVER rename/reshape the sendAutomatedMessage return; do NOT edit
process-sequences.js / process-crm-automations.js / send workers; additive-only to the frozen lib; do NOT
test a live A2P send; sends stay gated (sms_sending_enabled default OFF — do not flip it).

Close-out: test (incl. backward-compat) + build + eslint green → sms-experience-phase-reviewer +
consent-path-auditor → update UPR-Web-Context.md → reconcile checkboxes → delete TEST rows → push -u → PR
into dev as handoff → STOP.
```

---

## Wave 2 — Session G (launch after A + C merge)

```
[Session G — Wave 2]
Branch: session-assigned (illustrative: sms/g-deliverability-ops), cut from origin/dev
Model: Sonnet (medium)
Effort: Medium
Launch after: Phase A + Phase C PRs merged into dev (verification tails)

You are building sms-experience Phase G — deliverability ops + verification tails — one session. FIRST
run the Base-preflight. Read scope: CLAUDE.md + the "Wave 2 — Phase G" block in
docs/sms-experience-roadmap.md + .claude/rules/sms-experience-wave-ownership.md. You own a new
deliverability health component and src/components/Layout.jsx (unread badge only).

Order of work:
1. Deliverability/worker_runs health surface (new component): error-code intelligence (from messages
   .error_code + twilio-errors labels), failed-message visibility, A2P/messaging-service health,
   per-message segment/cost (num_segments/price). Read-only admin surface.
2. Unread-badge realtime consolidation: replace Layout.jsx's 30s poll (fetchUnread setInterval) with the
   existing subscribeToConversations realtime channel. Edit ONLY the unread-badge logic in Layout.jsx.
3. Per-thread push deep-link E2E: verify A's webhook link + C's per-thread URL param land a push tap in
   the correct thread (tail of A + C).
4. Tech-PWA on-device verification lane (iOS Capacitor): /tech/conversations tap targets ≥48px, keyboard
   handling, reconnect-after-suspend, push-tap→thread. Report findings; fix only what falls in your owned
   files, file the rest as follow-ups.
5. A2P live-smoke DECISION FORK (roadmap §7): IF the owner has confirmed the campaign is approved at
   session start → run ONE live smoke send (dev tracking number, TEST contact) as the E2E tail and delete
   the TEST rows. ELSE → build against the frozen contracts, DEFER the live send to the anytime gate lane,
   say so in the PR, NEVER fake it.

Hard constraints: zero schema; do NOT edit workers or Conversations.jsx (A/C own them); do NOT flip
sms_sending_enabled; do NOT test a live A2P send unless the owner has confirmed approval.

Close-out: test + build + eslint green → sms-experience-phase-reviewer + upr-pattern-checker → update
UPR-Web-Context.md → reconcile checkboxes → delete TEST rows → push -u → PR into dev as handoff → STOP.
```

---

*Ownership authority: `.claude/rules/sms-experience-wave-ownership.md`. Full findings/evidence:
`docs/sms-experience-roadmap.md`. If a Foundation artifact name drifts, the manifest + roadmap phase
block are authoritative.*
