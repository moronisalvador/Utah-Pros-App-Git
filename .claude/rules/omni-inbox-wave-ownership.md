# Omnichannel Inbox — File & RPC Ownership Manifest

**Committed by the `omni-inbox` plan of record (2026-07-04). Binding for every wave session.**
Linked from `docs/omni-inbox-roadmap.md` and `docs/omni-inbox-dispatch.md`.
Each session's read scope = `CLAUDE.md` + its phase block in `docs/omni-inbox-roadmap.md`
+ **this file** (+ `.claude/rules/tech-mobile-ux.md` only if it touches tech surfaces).
Where the roadmap prose and this manifest disagree on a name or path, **this manifest is
authoritative** (it reflects what Foundation actually shipped).

Isolation in this wave is **not** the branch — it is (a) the `feature:email_inbox` flag
(`enabled:false` + `dev_only_user_id`) keeping the email UI invisible until the owner opens
it, and (b) this ownership split. Stay inside your files and your frozen stubs and no two
sessions collide.

The initiative adds **inbound + outbound email** to the existing SMS-only conversation
system, unified into ONE per-contact thread (owner decision 2026-07-04), with a
channel-safe composer. Inbound arrives via a standalone **Cloudflare Email Worker**; email
replies are **reply-only, channel-locked, transactional** (owner decisions 2026-07-04).

---

## 1. Frozen in-wave — NOBODY edits these except the noted owner (they are the seams)

- `functions/lib/email.js` — Foundation adds an additive threading-header path
  (`In-Reply-To`/`References`), backward-compat test committed. **Import only after F.**
- `functions/lib/automated-send.js`, `functions/lib/email-consent.js`,
  `functions/lib/email-template.js`, `functions/lib/twilio.js`, `functions/lib/cors.js`,
  `functions/lib/supabase.js`, `functions/lib/phone.js`, `src/lib/phone.js` — import only.
- `functions/api/twilio-webhook.js`, `functions/api/twilio-status.js`,
  `functions/api/process-scheduled.js` — the SMS inbound/status/scheduled workers. Do NOT
  edit; they must keep writing `channel:'sms'` (the new DB default backs them up).
- `functions/api/process-sequences.js` — **Foundation is the SOLE in-wave editor**, for the
  one-line reply-detection widen only (`gatherExitSignals`, see §3). Nobody else touches it.
- `src/lib/realtime.js` — type-agnostic; email rows flow through unchanged. Phase U is the
  only permitted editor if a tweak is truly needed; no other phase touches it.
- The Foundation artifacts each wave phase consumes as frozen contracts:
  `functions/lib/email-threading.js`, `functions/lib/conversation-email.js`, the
  `claim_inbound_email` RPC, the `messages`/`conversations`/`conversation_participants`
  schema additions, and the `feature:email_inbox` flag. **Consume, never redefine.**

**Shared append-only tables** (`email_suppressions`, `email_inbound_events`, `worker_runs`,
`system_events`, `sms_consent_log`) are DATA writes only — insert rows, never change schema.
**Zero schema migrations outside Foundation** (see §4).

---

## 2. Ownership matrix

| Session | Phase | Owns exclusively (edit only these) | Schema / RPC |
|---|---|---|---|
| F | Foundation | migrations (all); `functions/lib/email-threading.js` (new); `functions/lib/conversation-email.js` (new); additive edit to `functions/lib/email.js`; `functions/api/resend-webhook.js` (new); one-line widen of `functions/api/process-sequences.js` (`gatherExitSignals`); `feature:email_inbox` flag seed; this manifest; `index.css` reserved-marker scaffold; contract docs | **ALL** (schema below + `claim_inbound_email`) |
| I | Inbound | `email-worker/**` (new top-level Cloudflare Worker dir, own `wrangler.toml`+`package.json`+`postal-mime`); `functions/api/inbound-email.js` (new); the unmatched-email **triage** surface (RPC body + minimal admin view, see phase block); their tests | none (calls `claim_inbound_email`) |
| O | Outbound send | `functions/api/send-message.js` (add `channel` param + email branch); `functions/api/send-message.test.js` (new) | none (calls `sendConversationEmail`) |
| U | Unified UI | `src/pages/Conversations.jsx`; new `src/components/conversations/**`; `src/lib/realtime.js` (only if required); `index.css` inside its reserved marker | none |

`feature:email_inbox` opening to staff is the **owner's** call in DevTools → Flags, after U
merges and the owner has created the Cloudflare `reply@` route + `INBOUND_EMAIL_SECRET`.

---

## 3. Foundation-shipped contracts (change the BODY within F only; wave phases consume)

**Schema (additive-only, one migration group, applied via Supabase MCP):**
- `messages`: add `direction text` (`'inbound'|'outbound'|'note'`, backfilled); add
  `channel text DEFAULT 'sms'` widen — **the CHECK becomes `sms|mms|rcs|email`** and existing
  rows are backfilled to `'sms'`; widen `messages_type_check` to add `email_inbound`,
  `email_outbound`; add nullable `email_message_id text UNIQUE`, `in_reply_to text`,
  `email_references text`, `email_from text`, `email_to text`, `subject text`,
  `email_html text`, `sender_email text`.
- `conversation_participants`: add `email text`.
- `conversations`: add `email_reply_token text UNIQUE` (≥128-bit random). *(No `contact_id`
  — token→conversation plus the existing participant link already thread per-contact; the
  live `twilio-webhook.js` already resolves a conversation by participant `contact_id`.)*
- `email_suppressions`: confirm/lean on the existing `reason` column
  (`hard_bounce`/`complaint`/`unsubscribed`/`global`); no schema change expected.
- New `email_inbound_events` table (idempotency ledger, RLS + policy at creation) +
  `claim_inbound_email(p_message_key text) → boolean` RPC (SECURITY DEFINER, GRANT EXECUTE,
  mirrors `claim_stripe_event`; a duplicate no-ops).

**Helper contracts (frozen signatures):**
- `email-threading.js`: `buildReplyAddress(token) → string`, `parseReplyToken(toAddress) → string|null`,
  `sanitizeInboundHtml(html) → text`, `buildThreadHeaders({inReplyTo, references}) → object`.
- `conversation-email.js`: `sendConversationEmail(env, { conversation, participant, subject, body, inReplyToMessageId }) → { ok, skipped, reason, resendId }`.
  Runs the **reason-aware** suppression gate (block `hard_bounce`/`complaint`/`global`; allow
  a 1:1 transactional reply to a `unsubscribed`-only address) BEFORE any Resend call.
- `email.js`: `sendEmail(env, { …, headers })` — F ensures `In-Reply-To`/`References` pass
  through untouched (they already do via the `headers` passthrough); backward-compat test.

**Cross-cutting widen (F, disclosed rule-amendment — see §5):**
- `process-sequences.js` `gatherExitSignals`: reply query becomes
  `type=in.(sms_inbound,email_inbound)` so an email reply also exits a drip. Committed test.

**Cloudflare routing spec (F documents; owner executes — external gate for I):**
- Base custom address **`reply@utahpros.app` → Email Worker**; enable **Subaddressing** in
  Email Routing → Settings. Every `reply+<token>@utahpros.app` then falls through to the
  `reply@` rule and the token is preserved in `message.to`. **Do NOT** use a catch-all —
  `restoration@utahpros.app` keeps its own human-forward rule (no straddle).
- Secret `INBOUND_EMAIL_SECRET` in BOTH Cloudflare env sets (Production + Preview).

---

## 4. Migration rule (this wave)

Foundation owns **100% of SCHEMA** (tables, columns, widened CHECKs, policies, indexes) +
the only new RPC (`claim_inbound_email`). A wave session (I/O/U) ships **zero schema
migrations**. The `email-worker/` dir is a standalone Cloudflare Worker (precedent:
`upr-mcp/`) with its OWN `package.json`; it does **not** touch the root `package.json` or the
Pages build, and must live **top-level, never under `functions/`**. Every new table is
RLS-enabled with an explicit policy in the same migration; the widened `channel`/`type`
CHECKs are **widen-only** (all existing values still validate — committed test).

## 5. Rule-amendment transparency

- **`process-sequences.js` edit.** The CRM-wave manifest froze this file to Phase 8
  ("import helpers only, never edit"). That manifest binds the CRM wave; this is a separate,
  owner-authorized initiative. The amendment: a **single additive line** widening reply
  detection to include `email_inbound`, with a committed test. Rationale: without it, a
  client who replies by email keeps receiving drip messages — a complaint/deliverability
  risk. Assigned to Foundation (it defines the `email_inbound` vocabulary in the same breath)
  and to nobody in-wave.
- **Channel/type CHECK widen.** `CLAUDE.md` forbids `ALTER`/`DROP` of a live table inside a
  wave *phase*; Foundation (which owns 100% of schema) performs the widen-only constraint
  swap, additive and test-guarded — not a destructive ALTER.

## 6. index.css rule

Write CSS ONLY inside the reserved marker
`/* ─── OMNI-INBOX RESERVED — Phase U (unified inbox UI) ─── */` that Foundation appends near
the end of the conversation styles. Never edit another block. Mobile-only rules use
`@media (max-width: 768px)`.

## 7. Wrong-channel safety invariants (binding on O and U; the reviewer weights these)

1. The **worker is the sole writer** of any `sms_*`/`email_*` message row (the client may
   insert only `internal_note`, which touches no transport).
2. Stored `channel` reflects the **transport actually dispatched**, never a client-supplied
   value.
3. **No cross-channel fallback, ever** — the requested channel with no valid destination is
   **refused**, never silently retargeted to the other channel.
4. `internal_note` is `channel = null` and physically unsendable (short-circuits before any
   transport, as today).
5. The **consent gate is selected by channel** — SMS → the TCPA gate (dnd/opt-in +
   `sms_consent_log`); email → the reason-aware suppression gate in `conversation-email.js`.
6. The reply token sets the **thread only** — never the recipient or the channel.
