# Omnichannel Inbox — Roadmap (v1, 2026-07-04)

**Initiative:** add **inbound + outbound email** to the existing SMS-only conversation
inbox (`Conversations.jsx`), unified into ONE per-contact thread, channel-badged, with a
**structurally channel-safe** composer — UPR's answer to GoHighLevel's multi-channel
conversation, with room to grow into iMessage/Messenger/WhatsApp later.

**Slug:** `omni-inbox` · **Docs:** this file + `docs/omni-inbox-dispatch.md` +
`.claude/rules/omni-inbox-wave-ownership.md` (authoritative on names/paths).

**Owner decisions (2026-07-04):** ① **unified per-contact thread** (SMS + email interleaved,
not per-channel); ② inbound via a **Cloudflare Email Worker** (not Resend Inbound);
③ **reply-only, channel-locked, transactional** email send posture.

**Progress tracking:** this is a non-CRM initiative, so there is no `crm_build_phases`
seed — track via the phase checklists in this doc (do NOT bolt onto the CRM tracker).

---

## 1. Verified current state (live, 2026-07-04 — not from memory)

| Area | Reality | Evidence |
|---|---|---|
| Inbox UI | ONE component `src/pages/Conversations.jsx` (~941 lines, thread/bubble/composer inlined), reused verbatim by staff, CRM (`CrmConversations.jsx`), tech (`/tech/conversations`) | file reads |
| Conversation model | `conversations` bound to `twilio_number`, **no channel column, no contact_id**; threads already resolved by participant `contact_id`, not by number | `twilio-webhook.js:232-241`, live schema |
| Participants | `conversation_participants` **phone-keyed**, `contact_id` FK, **no email** | live schema |
| Message model | `messages.type` folds channel+direction into `sms_inbound\|sms_outbound\|internal_note`; `channel` col exists but CHECK `sms\|mms\|rcs`, **mostly null, no DEFAULT**; `twilio_sid` UNIQUE | live schema + `messages_*_check` |
| Inbound email | **Does not exist anywhere** in `functions/` | grep-confirmed ×3 |
| Outbound email | Resend via `functions/lib/email.js`; sets **no** Message-ID/In-Reply-To; response `id` ≠ RFC Message-ID | `email.js:88-146` |
| Consent feed | `email_suppressions` fed **only** by unsubscribe clicks; **no bounce/complaint webhook**; table empty | grep + live query (0 rows) |
| Volume | 1 message / 5 conversations | live query |

**Challenge-CONFIRMED claims** (survived refute-first re-verification): the SMS inbox is a
dual-shell shared component; `messages.type`/`channel` CHECK-widening is inert to existing
readers (the render ternary at `Conversations.jsx:694` has a catch-all `else`); PostgREST is
key-based so nullable-column adds are safe; the system is already de-facto per-contact.

## 2. Findings (with exposure + interim guidance)

- **F-1 · Silent client-side send fallback (footgun).** `Conversations.jsx:452-466` — on any
  `/api/send-message` error, `handleSend` falls back to a direct
  `db.insert('messages', {type:'sms_outbound'…})`. This bypasses the only place channel→
  destination is resolved; post-email it can fabricate a "sent" row or (with a naive email
  UI) emit the wrong channel. **Exposure:** live today for SMS (produces ghost rows on worker
  failure). **Interim:** unchanged for SMS. **Fix:** Phase U removes it for external sends
  (keeps it for `internal_note`); invariants §7 of the manifest.
- **F-2 · `messages.channel` has no DEFAULT.** Three writers bypass any new worker param
  (`process-scheduled.js:143`, `Conversations.jsx:464` fallback, `send-message.js:212`).
  **Fix:** Foundation sets `channel text DEFAULT 'sms'` + backfills.
- **F-3 · Sequence-exit blind to email.** `process-sequences.js:191-195` detects a client
  reply via `type=eq.sms_inbound` only → an email reply won't stop a drip. **Exposure:**
  emerges once email inbound lands. **Fix:** Foundation one-line widen to
  `type=in.(sms_inbound,email_inbound)` + test (rule-amendment, manifest §5).
- **F-4 · Inbound email un-notified.** `message.inbound` notifications fire only from
  `twilio-webhook.js`. **Fix:** Phase I fires the same dispatch on email inbound.
- **F-5 · No bounce/complaint suppression feed.** `email_suppressions` never learns of hard
  bounces/complaints — a deliverability risk on a young look-alike domain regardless of this
  feature, and a prerequisite for the transactional-reply gate. **Fix:** Foundation adds
  `functions/api/resend-webhook.js` (Svix-verified; Permanent bounce → `hard_bounce`,
  complaint → `complaint`).

## 3. External verifications (challenge pass, 2026-07-04)

- **Cloudflare Email Routing** runs SPF/DKIM/DMARC and **rejects DMARC-failing mail before
  the Worker** (free anti-spoof for strict-DMARC senders); catch-all→Worker supported;
  **Subaddressing** (RFC 5233, since Jul 2025) preserves `+token` in `message.to` — so a base
  `reply@` rule + the Subaddressing toggle captures every `reply+<token>@` with **no
  catch-all** and no straddle of `restoration@`. Workers can `fetch()` subrequests.
- **Resend:** `headers` accepts `In-Reply-To`/`References` (set for visual threading). The
  send response `id` is an object UUID, **not** the RFC Message-ID, and the Message-ID is not
  returned — so **`In-Reply-To → our stored id` correlation is impossible** and is dropped;
  the **plus-addressed reply token is the sole authoritative correlator**. Bounce/complaint
  webhooks are `email.bounced`/`email.complained`, **Svix-signed** (HMAC-SHA256 over
  `${id}.${ts}.${body}`, secret base64 after stripping `whsec_`) — verifiable with Web Crypto,
  same fail-closed shape as the Twilio/Stripe webhooks. Suppress on bounce only when
  `data.bounce.type==="Permanent"`; key on `data.to[0]`; dedup on `svix-id`. *(Sourced via
  indexed docs — proxy blocked direct fetch; Foundation confirms the "does Resend honor a
  caller-supplied Message-ID" question empirically — a flagged fork nothing depends on.)*

## 4. Phase blocks

### Phase F — Foundation

> ✅ **SHIPPED (#309, merged to `dev`).** Verified live 2026-07-09 by the sms-experience F-core session
> (disclosed cross-doc tick, per that roadmap §1): the `messages`/`conversations`/`conversation_participants`
> schema additions + widened `channel`/`type` CHECKs are live; `functions/lib/email-threading.js`,
> `functions/lib/conversation-email.js`, `functions/api/resend-webhook.js` and their tests are on disk;
> `email.js` passes `In-Reply-To`/`References` via its generic `headers` passthrough; `process-sequences.js`
> `gatherExitSignals` includes `email_inbound`; the `claim_inbound_email` RPC and the `feature:email_inbox`
> flag exist. The unchecked boxes below are retained as the historical build checklist. Phases I/O/U remain
> per the omni manifest supersession note (O/U were absorbed by the sms-experience initiative).

> **Branch:** session-assigned (illustrative `omni-inbox/phase-f`), cut from `origin/dev`
> **Prerequisite:** this roadmap merged to `dev`
> **Model · effort:** Opus 4.8 · High (schema + consent gate + widen of a live table)
> **Read scope:** `CLAUDE.md` + this Phase F block + `.claude/rules/omni-inbox-wave-ownership.md`

Foundation owns 100% of schema, the shared libs, and every seam the wave consumes.

- [ ] **Migration (additive, one group; Rule 7; apply via Supabase MCP):** `messages` gains
      `direction` + email columns; `channel` gets `DEFAULT 'sms'` and CHECK widened to add
      `email`; `type` CHECK widened to add `email_inbound`/`email_outbound`; backfill
      existing rows' `channel`/`direction`; `conversation_participants.email`;
      `conversations.email_reply_token` (UNIQUE); new `email_inbound_events` (RLS + policy) +
      `claim_inbound_email` RPC (SECURITY DEFINER, GRANT EXECUTE). Manifest §3 is the spec.
- [ ] **Test-first (named):** `messages_check_widen.test` — every existing `type`/`channel`
      value still validates + the new values insert; `claim_inbound_email` idempotency (2nd
      claim of a key returns false).
- [ ] `functions/lib/email-threading.js` (+tests): `buildReplyAddress`, `parseReplyToken`,
      `sanitizeInboundHtml` (XSS-safe, scheme-whitelisted links), `buildThreadHeaders`.
- [ ] `functions/lib/conversation-email.js` → `sendConversationEmail` (+tests): **reason-aware**
      suppression gate (block `hard_bounce`/`complaint`/`global`; allow 1:1 reply to
      `unsubscribed`-only) BEFORE Resend; sets thread headers; returns `{ok,skipped,reason}`.
- [ ] `functions/lib/email.js` additive `In-Reply-To`/`References` passthrough + backward-compat
      test (existing sends unchanged).
- [ ] `functions/api/resend-webhook.js` (+test): Svix HMAC-SHA256 verify (Web Crypto, raw
      body, ±5min, dedup on `svix-id`, fail-closed); `email.bounced`+Permanent→suppress
      `hard_bounce`; `email.complained`→suppress `complaint`; key `data.to[0]`;
      `worker_runs` row. (Owner adds the Resend webhook endpoint + `RESEND_WEBHOOK_SECRET`.)
- [ ] `process-sequences.js` `gatherExitSignals` one-line widen to
      `type=in.(sms_inbound,email_inbound)` + test (rule-amendment, manifest §5).
- [ ] `feature:email_inbox` flag seed (`enabled:false` + `dev_only_user_id`); commit
      `.claude/rules/omni-inbox-wave-ownership.md`; append the `index.css` reserved marker;
      document the Cloudflare routing spec (manifest §3) for the owner.
- [ ] **Close-out:** `npm run test` + `npm run build` + eslint (changed files) green;
      `migration-safety-checker` + `consent-path-auditor` + `upr-pattern-checker` clean;
      update `UPR-Web-Context.md`; PR into `dev` as a handoff, then stop.

### Phase I — Inbound email ingestion
> **Branch:** session-assigned · **Prerequisite:** Phase F merged **and** owner Cloudflare
> route + `INBOUND_EMAIL_SECRET` live (external hard gate — build against a simulated POST;
> do NOT verify the live email path until the route is confirmed)
> **Model · effort:** Opus 4.8 · High (public/untrusted surface, anti-spoof, triage)
> **Read scope:** `CLAUDE.md` + this block + the ownership manifest

- [ ] `email-worker/**` — standalone top-level Cloudflare Worker (own `wrangler.toml` +
      `package.json` + `postal-mime`; precedent `upr-mcp/`; **never under `functions/`**):
      `email()` handler parses `.from`, `.to` (extract `+token`), headers (Message-ID,
      In-Reply-To, References, Subject), raw MIME body → `fetch()` POST to
      `/api/inbound-email` with `Authorization: Bearer INBOUND_EMAIL_SECRET`.
- [ ] `functions/api/inbound-email.js` (+tests): verify shared secret (fail-closed) →
      `claim_inbound_email` idempotency → **correlate token→conversation** (authoritative);
      unmatched → **triage queue** (never auto-thread on sender-email — spoofable); insert
      `email_inbound` message (channel `email`, store inbound Message-ID); email-keyed
      find-or-create contact with **email-appropriate consent** (NOT the SMS implied opt-in);
      bump conversation; fire `message.inbound` notification (parity with SMS); `worker_runs`.
- [ ] **Triage surface:** an "unmatched inbound email" list an admin can assign to a contact
      (RPC body + minimal view). Log what was dropped/queued — no silent loss.
- [ ] **Test-first (named):** `inbound_email_thread.test` (token match → correct
      conversation), `inbound_email_idempotency.test` (dup Message-ID no-ops),
      `inbound_email_unmatched.test` (no token + unknown sender → triage, not mis-thread).
- [ ] **Close-out:** as Phase F. Live end-to-end (real client email → thread) is a
      verification tail after the owner route is live — say so in the PR.

### Phase O — Channel-safe outbound send
> **Branch:** session-assigned · **Prerequisite:** Phase F merged
> **Model · effort:** Opus 4.8 · High (consent/compliance + the wrong-channel guarantee)
> **Read scope:** `CLAUDE.md` + this block + the ownership manifest (esp. §7 invariants)

- [ ] `functions/api/send-message.js`: add optional `channel` param (**default `'sms'`**);
      email branch calls `sendConversationEmail`; **channel-correct consent gate**
      (SMS→TCPA, email→suppression); **refuse** a channel with no valid destination (never
      cross-channel retarget); worker writes `channel` from the transport actually used;
      deterministic `role='primary'` participant selection for SMS; `internal_note`
      unsendable.
- [ ] **Test-first (named):** `send_message_sms_backcompat.test` (no `channel` → SMS exactly
      as today), `send_email_refuses_no_address.test`, `send_channel_stored_matches_transport.test`,
      `internal_note_never_sent.test`.
- [ ] **Close-out:** as Phase F; `consent-path-auditor` must be clean.

### Phase U — Unified inbox UI
> **Branch:** session-assigned · **Prerequisite:** **Phase O merged** (hard — no UI send
> button before the channel-safe worker exists); Phase I is a soft tail (real inbound rows
> for E2E render — a manually inserted `email_inbound` row suffices to build against)
> **Model · effort:** Opus 4.8 · High (owns the wrong-channel composer + removes the footgun)
> **Read scope:** `CLAUDE.md` + this block + the ownership manifest + `.claude/rules/tech-mobile-ux.md`

- [ ] `src/pages/Conversations.jsx` + new `src/components/conversations/**`: render branches
      for `email_inbound`/`email_outbound` (inbound on the correct side, sanitized); per-message
      channel badge; the **channel-safe composer** — defaults to the last-inbound channel, the
      send button always names it (**"Send Email" / "Send SMS"**), passes `channel` explicitly.
- [ ] **Remove the silent client-side `db.insert` fallback for external sends** (keep it only
      for `internal_note`) — finding F-1, invariant §1. Stop hardcoding `channel:'sms'` in the
      reply-assist context.
- [ ] Email UI **flag-gated** on `feature:email_inbox`; **SMS behavior preserved identically**
      for everyone else (this is the live shared inbox — do not regress it).
- [ ] `index.css` styles inside the reserved marker only; mobile via `@media (max-width:768px)`.
- [ ] **Visual check** on preview: SMS thread unchanged; email inbound/outbound render + badge;
      composer channel default + explicit button; no wrong-channel path.
- [ ] **Close-out:** as Phase F; `upr-pattern-checker` clean.

## 5. Dependency graph (edge types named)

```
                     F (Foundation)
        ┌──────────────┼───────────────┬──────────────┐
   hard │         hard │          hard │         hard  │ (schema/flag/css marker)
        ▼              ▼               │              ▼
        I              O              (─)             U
  [ext-gated:        (channel-safe    hard: O ──────▶ (send button needs O)
   CF route+secret]   send path)
        └────────── soft E2E tail ─────────────────▶ U (inbound render verified post-I)
```
- **hard artifact edges:** F→I (RPC + email-threading + schema), F→O (conversation-email +
  schema), F→U (schema + flag + css marker), **O→U** (safe send before UI send).
- **externally-gated:** I on the owner's Cloudflare `reply@` route + `INBOUND_EMAIL_SECRET`.
- **soft verification tail:** I⟶U (real inbound rows for end-to-end render).
- **future/unscheduled:** iMessage/Messenger/WhatsApp channels; group email; attachment
  ingest-to-storage; a full inbound Message-ID secondary match (only if Resend is confirmed to
  honor a caller-supplied Message-ID).

## 6. Dispatch model (waves)

| Wave | Sessions | Launch after |
|---|---|---|
| 0 | **F** | this roadmap merged to `dev` |
| 1 | **I ∥ O** | F's PR merged to `dev` (may run simultaneously — proven disjoint) |
| 2 | **U** | O's PR merged to `dev` (I may still be finishing; its render check is U's tail) |

Merge order **within** a wave is preference, not a gate; throttle to review bandwidth. Each
wave session opens a PR into `dev` as a handoff and stops — the owner merges; sessions do not
click-merge, subscribe, or babysit. Full copy-paste blocks: `docs/omni-inbox-dispatch.md`.

**Owner pre-decisions / actions due:**
- Create Cloudflare Email Routing base rule `reply@utahpros.app` → the Email Worker + enable
  **Subaddressing**; keep `restoration@` forwarding intact; set `INBOUND_EMAIL_SECRET` (both
  env sets). *(Gates Phase I's live path only.)*
- Add the Resend webhook endpoint (`/api/resend-webhook`) + `RESEND_WEBHOOK_SECRET`. *(Feeds
  the F suppression worker.)*
- Flip `feature:email_inbox` after U merges (owner-only, DevTools → Flags).

## 7. What resisted maximum parallelism (honest ledger)

- **O→U is a genuine serial edge** — the owner's #1 concern (wrong channel) forbids shipping a
  channel-tagged send UI before the worker that resolves/refuses the channel. Not softened.
- **index.css F→U seam** — reserved-marker convention; F lands the marker, U writes inside it.
- **Phase I externally gated** — CF route + secret are the owner's; I builds against a
  simulated POST and defers the live-path test (disclosed in its PR). "Do not launch on hope."
- **`process-sequences.js` cross-initiative edit** — a CRM-frozen file; resolved by a
  disclosed, additive, test-guarded one-line Foundation widen (manifest §5), not a wave-session
  edit.
- **Foundation single point of failure** — priced in via `migration-safety-checker` +
  `consent-path-auditor` + `upr-pattern-checker` + reviewer sign-off before F merges.

## 8. Out of scope (v1)

Group/broadcast email; attachment→storage ingest (note that attachments exist, don't store);
iMessage/Messenger/WhatsApp (data model built channel-generic for later); staff-**initiated**
(non-reply) or marketing-gated email from the inbox; a secondary In-Reply-To match path
(blocked on the Resend Message-ID question).

## 9. Options-on-record

- **Inbound transport — Cloudflare Email Worker (chosen) vs Resend Inbound.** CF wins: the
  zone's MX is already Cloudflare Email Routing (no new vendor/MX contention), it does
  SPF/DKIM/DMARC + rejects spoofed mail pre-Worker for free, and keeps all DB logic in the
  Pages codebase via a shared-secret POST. Resend Inbound would add a product/cost and
  contend for the MX. Resend wins only if the owner later wants a single-vendor email stack
  and accepts the MX migration.
- **Threading key — plus-token (chosen) vs RFC Message-ID.** Forced by Resend not returning
  the generated Message-ID; the token is unspoofable and provider-independent. Message-ID
  headers are still set outbound for client-side visual threading.
- **Unified per-contact thread (chosen) vs per-channel.** Unified formalizes existing
  behavior (threads already key on participant `contact_id`) and matches the owner's GHL
  vision; per-channel would fork a customer's existing SMS thread — the higher-risk deviation
  despite the tiny row count.

## 10. Owner setup runbook (Cloudflare + Resend) — external gates

*Shipped by Phase F; executed by the owner. These are the two external prerequisites the
wave can't do itself. Nothing here is required to MERGE Phase F — they gate the live paths of
later phases and the suppression feed.*

**A. Resend bounce/complaint webhook — feeds the F suppression worker (`/api/resend-webhook`).**
1. Resend dashboard → **Webhooks → Add Endpoint** → URL `https://utahpros.app/api/resend-webhook`
   (and, if desired, the dev preview URL for testing). Subscribe to **`email.bounced`** and
   **`email.complained`**.
2. Copy the endpoint's **Signing Secret** (`whsec_…`) and set it as **`RESEND_WEBHOOK_SECRET`**
   in **both** Cloudflare Pages env sets (Production `main` + Preview `dev`/branches), then
   redeploy. Until it is set the worker returns **503 (fails closed)** — safe, just inert.
3. Verify: Resend's "Send test event" should return 200; a `worker_runs` row `resend-webhook`
   appears. A permanent bounce writes an `email_suppressions` row `reason='hard_bounce'`; a
   complaint writes `reason='complaint'`.

**B. Inbound email routing — gates Phase I's LIVE path (build against a simulated POST first).**
1. Cloudflare **Email Routing → Settings → enable Subaddressing** (RFC 5233; preserves
   `+token` in `message.to`).
2. Add a custom address rule **`reply@utahpros.app` → the Email Worker** (Phase I's
   `email-worker/`). With Subaddressing on, every `reply+<token>@utahpros.app` falls through to
   this one rule with the token intact. **Do NOT** use a catch-all, and leave
   `restoration@utahpros.app`'s existing human-forward rule untouched (no straddle).
3. Set **`INBOUND_EMAIL_SECRET`** in **both** Cloudflare env sets — the shared bearer secret
   the Email Worker uses to POST `/api/inbound-email`.

**C. Flip the feature flag — after Phase U merges.** DevTools → Flags → `feature:email_inbox`.
It ships **owner-only** (`enabled:false` + `dev_only_user_id`); opening it to staff is the
owner's call once the UI is verified.
