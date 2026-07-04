# Omnichannel Inbox — Session Dispatch Blocks

Copy-paste launch blocks for every build session, per `docs/omni-inbox-roadmap.md`
(Foundation first, then a partial-order wave). Each block is fully self-contained for a cold
session with zero conversation history. Claude Code web hands each session a harness-assigned
`claude/…` branch — **use it as-is**; the illustrative `omni-inbox/…` name below is only for
humans tracking PRs. Names/paths: `.claude/rules/omni-inbox-wave-ownership.md` is
authoritative if anything drifts.

**How work lands (CLAUDE.md Rule 4):** these wave sessions are the exception to direct-to-`dev`
— each cuts a branch and its close-out opens a **PR into `dev` as a handoff, then stops**. The
owner merges. Sessions do **not** click-merge, subscribe to, babysit, or wait for a review.

**Preconditions**
- **Wave 0 (F)** launches after the `omni-inbox` roadmap is merged to `dev`.
- **Wave 1 (I ∥ O)** launches after F's PR is merged to `dev`.
- **Wave 2 (U)** launches after O's PR is merged to `dev`.
- **Owner actions due at dispatch:** ① Cloudflare Email Routing base rule
  `reply@utahpros.app` → the Email Worker + enable Subaddressing + `INBOUND_EMAIL_SECRET`
  (both env sets) — **gates Phase I's live path only**; ② Resend webhook endpoint +
  `RESEND_WEBHOOK_SECRET` — feeds F's suppression worker; ③ flip `feature:email_inbox` after U.

---

## Wave 0 — Session F

```
[Session F — Wave 0]
Branch: session-assigned (illustrative: omni-inbox/phase-f), cut from origin/dev
Model: Opus 4.8
Effort: High
Launch after: omni-inbox roadmap merged into dev — nothing else

You are building the Omnichannel Inbox Foundation — all schema, shared libs, and seams for
the wave; ONE phase only, no scope creep. Read scope: CLAUDE.md, the Phase F block in
docs/omni-inbox-roadmap.md, and .claude/rules/omni-inbox-wave-ownership.md (§3 is your build
spec, authoritative on names). Work on your assigned branch cut from origin/dev. Confirm real
column names live via Supabase MCP before writing any query — never from memory.

Order of work (riskiest first):
(1) Migrations FIRST (Rule 7), additive-only, applied via Supabase MCP apply_migration, each
new table RLS-enabled with an explicit policy in the same migration. Test-first: commit a
failing supabase/tests/ check that every EXISTING messages.type and messages.channel value
still validates after the CHECK widen, then apply. Adds: messages.direction
('inbound'/'outbound'/'note', backfilled); messages.channel DEFAULT 'sms' + CHECK widened to
sms|mms|rcs|email + backfill existing rows to 'sms'; messages.type CHECK widened to add
email_inbound/email_outbound; nullable email_message_id (UNIQUE), in_reply_to,
email_references, email_from, email_to, subject, email_html, sender_email;
conversation_participants.email; conversations.email_reply_token (UNIQUE, >=128-bit random);
new email_inbound_events ledger + claim_inbound_email(p_message_key text) RPC (SECURITY
DEFINER, GRANT EXECUTE TO anon, authenticated, duplicate no-ops) with an idempotency test.
Do NOT add conversations.contact_id. Do NOT ALTER/DROP any other live table.
(2) functions/lib/email-threading.js (+unit tests): buildReplyAddress(token),
parseReplyToken(toAddress), sanitizeInboundHtml(html) (XSS-safe, scheme-whitelisted links
only), buildThreadHeaders({inReplyTo, references}).
(3) functions/lib/conversation-email.js -> sendConversationEmail(env, {conversation,
participant, subject, body, inReplyToMessageId}) (+tests): run the REASON-AWARE suppression
gate BEFORE any Resend call — block reason in (hard_bounce, complaint, global); ALLOW a 1:1
transactional reply to an address suppressed only as 'unsubscribed'. Set In-Reply-To/
References via email-threading. Never send to a null/invalid email — return
{ok,skipped,reason}.
(4) functions/lib/email.js: additive In-Reply-To/References passthrough (the headers object
already forwards to Resend) + a backward-compat test proving existing transactional sends are
unchanged.
(5) functions/api/resend-webhook.js (+test): verify the Svix signature with Web Crypto
(read raw body via request.text() BEFORE parse; HMAC-SHA256 over `${svix-id}.${svix-
timestamp}.${rawBody}`; secret = base64-decode of whsec_ minus prefix; match any v1 token;
reject outside +/-5min; dedup on svix-id; FAIL CLOSED if the secret is unset). On
email.bounced with data.bounce.type === 'Permanent' insert an email_suppressions row
reason='hard_bounce'; on email.complained insert reason='complaint'; key on data.to[0];
ignore Transient/Undetermined. Write a worker_runs row. Empirically confirm (or note as
unverified) whether Resend honors a caller-supplied Message-ID — nothing depends on it.
(6) functions/api/process-sequences.js: widen ONLY the gatherExitSignals reply query to
type=in.(sms_inbound,email_inbound) + a committed test. This is the sole authorized edit to
that file (rule-amendment, manifest §5) — change nothing else in it.
(7) Seed the feature:email_inbox flag (enabled:false + dev_only_user_id); commit
.claude/rules/omni-inbox-wave-ownership.md (already authored — verify it is present);
append the index.css reserved marker `/* ─── OMNI-INBOX RESERVED — Phase U (unified inbox
UI) ─── */`; document the Cloudflare routing spec (manifest §3) in the roadmap for the owner.

Hard constraints: additive migrations only; you are the ONLY session that ships schema; do
not build the inbound worker, the send-message email branch, or any UI (those are I/O/U).
Close-out: npm run test + npm run build + npx eslint (changed files) pass; migration-safety-
checker + consent-path-auditor + upr-pattern-checker clean; update UPR-Web-Context.md; push
-u and open a PR into dev using the repo convention, mark it ready, then STOP (handoff — do
not merge/subscribe/babysit).
```

---

## Wave 1 — Sessions I and O may launch simultaneously (proven disjoint)

```
[Session I — Wave 1]
Branch: session-assigned (illustrative: omni-inbox/phase-i-inbound), cut from origin/dev
Model: Opus 4.8
Effort: High
Launch after: Session F PR merged into dev. LIVE email path is additionally gated on the
owner having created the Cloudflare reply@ route + INBOUND_EMAIL_SECRET — build against a
simulated POST; do NOT test the live inbound path until that route is confirmed. Do not
launch on hope.

You are building Omnichannel Inbox Phase I — inbound email ingestion; ONE phase only. Read
scope: CLAUDE.md, the Phase I block in docs/omni-inbox-roadmap.md, and
.claude/rules/omni-inbox-wave-ownership.md. Foundation shipped: the messages/conversations/
conversation_participants schema, claim_inbound_email RPC, email-threading.js, and the
feature flag — CONSUME these, never redefine them. Work on your assigned branch cut from
origin/dev.

Build:
(1) email-worker/ — a NEW standalone top-level Cloudflare Worker dir (own wrangler.toml +
package.json + postal-mime; precedent: upr-mcp/). NEVER place it under functions/ (that would
bundle it into Pages). Its email() handler parses message.from, message.to (extract the
+token via email-threading parseReplyToken semantics — but the worker is standalone, so
re-implement token parsing locally/copy it; do not import from functions/lib), the headers
(Message-ID, In-Reply-To, References, Subject), and the raw MIME body, then fetch()-POSTs a
JSON payload to /api/inbound-email with Authorization: Bearer INBOUND_EMAIL_SECRET.
(2) functions/api/inbound-email.js (+tests): verify the shared secret (FAIL CLOSED if unset);
claim_inbound_email(message_id) for idempotency (dup -> 200 no-op); correlate the +token to a
conversation (AUTHORITATIVE); if no token / unknown, route to an unmatched-email TRIAGE queue
— NEVER auto-thread on sender email (spoofable). Insert an email_inbound message (channel
'email', store the inbound Message-ID, sanitized body). Find-or-create the contact BY EMAIL
with email-appropriate consent — do NOT copy twilio-webhook's SMS implied opt_in_status:true.
Bump the conversation (last_message_at/preview/unread, status needs_response). Fire the same
message.inbound notification twilio-webhook fires. Write a worker_runs row. Always return 200
fast.
(3) The triage surface: an "unmatched inbound email" list an admin can assign to a contact
(the RPC body + a minimal view). Log everything queued/dropped — no silent loss.

Test-first (named, committed failing then green): inbound_email_thread.test (token ->
correct conversation), inbound_email_idempotency.test (dup Message-ID no-ops),
inbound_email_unmatched.test (no token + unknown sender -> triage, not mis-thread).

Hard constraints: zero schema migrations; do not edit send-message.js, Conversations.jsx,
email.js, twilio-webhook.js, or process-sequences.js. Close-out: npm run test + build +
eslint clean; migration-safety-checker (n/a — no migration, say so) + consent-path-auditor +
upr-pattern-checker clean; update UPR-Web-Context.md; note the live end-to-end test as a
verification tail pending the owner's Cloudflare route; open a PR into dev as a handoff, then
STOP.
```

```
[Session O — Wave 1]
Branch: session-assigned (illustrative: omni-inbox/phase-o-send), cut from origin/dev
Model: Opus 4.8
Effort: High
Launch after: Session F PR merged into dev — may run simultaneously with Session I

You are building Omnichannel Inbox Phase O — channel-safe outbound send; ONE phase only. Read
scope: CLAUDE.md, the Phase O block in docs/omni-inbox-roadmap.md, and
.claude/rules/omni-inbox-wave-ownership.md (its §7 wrong-channel invariants BIND you).
Foundation shipped functions/lib/conversation-email.js (sendConversationEmail) and the schema
— consume them. Work on your assigned branch cut from origin/dev.

Build — edit ONLY functions/api/send-message.js (+ new send-message.test.js):
- Add an optional `channel` param, DEFAULT 'sms' (so every existing caller — Conversations.jsx,
  and the untouched process-scheduled.js — keeps working unchanged).
- channel 'sms' -> the existing Twilio path + the existing TCPA gate (dnd/opt_in +
  sms_consent_log), destination from the deterministic role='primary' participant.
- channel 'email' -> call sendConversationEmail with the primary participant's email + the
  reason-aware suppression gate; NEVER call Twilio on this branch.
- REFUSE a channel whose destination is missing (no phone / no email) with a clear error code
  — NEVER fall back to the other channel.
- The worker writes messages.channel from the transport it ACTUALLY dispatched on, never from
  a client-claimed value. internal_note stays channel=null and unsendable (short-circuit
  before any transport, as today).

Test-first (named): send_message_sms_backcompat.test (no channel arg -> byte-identical SMS
behavior), send_email_refuses_no_address.test, send_channel_stored_matches_transport.test,
internal_note_never_sent.test.

Hard constraints: zero schema; do not edit email.js, conversation-email.js, Conversations.jsx,
or the inbound worker. Never pass skip_compliance from any automated path. Close-out: npm run
test + build + eslint clean; consent-path-auditor + upr-pattern-checker clean; update
UPR-Web-Context.md; open a PR into dev as a handoff, then STOP.
```

---

## Wave 2 — Session U

```
[Session U — Wave 2]
Branch: session-assigned (illustrative: omni-inbox/phase-u-ui), cut from origin/dev
Model: Opus 4.8
Effort: High
Launch after: Session O PR merged into dev (HARD — no UI send button before the channel-safe
worker exists). Session I may still be finishing; build the email-inbound render against a
manually inserted email_inbound row and treat the live end-to-end render as a tail after I
merges.

You are building Omnichannel Inbox Phase U — the unified inbox UI; ONE phase only. Read scope:
CLAUDE.md, the Phase U block in docs/omni-inbox-roadmap.md, .claude/rules/omni-inbox-wave-
ownership.md, and .claude/rules/tech-mobile-ux.md (Conversations.jsx is reused by the tech
shell). Foundation shipped the schema + feature:email_inbox flag + the index.css reserved
marker; Phase O shipped the channel param on POST /api/send-message. Consume both. Work on
your assigned branch cut from origin/dev.

Build — src/pages/Conversations.jsx + new src/components/conversations/**:
- Render branches for messages.type email_inbound (inbound side, sanitized body via the
  stored sanitized text) and email_outbound (outbound side); a per-message channel badge
  (SMS vs Email). The existing sms_inbound/sms_outbound/internal_note rendering must stay
  byte-identical.
- The CHANNEL-SAFE composer: it defaults to the channel of the client's LAST INBOUND message;
  the send button ALWAYS names the channel it will use — "Send Email" or "Send SMS"; it POSTs
  channel explicitly to /api/send-message. Switching channel is a deliberate, labeled control.
- REMOVE the silent client-side db.insert('messages', …) fallback for EXTERNAL sends
  (Conversations.jsx ~452-466) — keep the direct insert ONLY for internal_note (which touches
  no transport). Stop hardcoding channel:'sms' in the reply-assist context object.
- Gate ALL email UI behind isFeatureEnabled('email_inbox'); for everyone without the flag the
  inbox behaves exactly as today (this is the LIVE shared SMS inbox — do not regress it).
- index.css: styles ONLY inside the OMNI-INBOX reserved marker; mobile via @media
  (max-width:768px). Never restyle existing .message.* selectors for non-flag users.

Verify visually on the preview deploy: SMS thread unchanged; email inbound/outbound render +
badge; composer channel default + explicit button; refusing a channel with no address; no
path that can send on the wrong channel.

Hard constraints: zero schema; do not edit send-message.js, email.js, the inbound worker, or
process-sequences.js. Close-out: npm run test + build + eslint clean; upr-pattern-checker
clean; update UPR-Web-Context.md; open a PR into dev as a handoff, then STOP. The owner flips
feature:email_inbox after merge.
```
