# SMS Experience — File & RPC Ownership Manifest

**Committed with the plan of record (2026-07-09). Binding for every sms-experience session.**
Linked from `docs/sms-experience-roadmap.md` (plan of record) and `docs/sms-experience-dispatch.md`
(cold-session launch blocks). Each session's read scope = `CLAUDE.md` + its phase block in the
roadmap + `.claude/rules/database-standard.md` (migration phases) + `.claude/rules/tech-mobile-ux.md`
(Phase C) + **this file**. Where the roadmap prose and this manifest disagree on a name or path,
**this manifest is authoritative**.

Isolation in this initiative is **not** the branch — it is (a) this ownership split and (b) F-core's
frozen contracts. There is **no feature flag** for the reorg (the SMS surface is already live to
staff); the insurance is Wave -1's surgical P0 fixes + F-red's behavior-neutral closure + additive
migrations + git-revert. The A2P live path is gated separately (roadmap §7).

---

## 1. Frozen in-wave — NOBODY edits these (they are the seams / other-owned)

**F-core owns and freezes (wave phases consume import-only):**
- All `supabase/migrations/` (F-core + F-red ship 100% of schema; wave phases ship ZERO schema —
  §4 amendment allows function-body-only replaces of a phase's own frozen stubs, none exist here).
- `functions/lib/twilio-errors.js` (new) — the error-code map. Import only.
- The atomic `claim_scheduled_message(p_id)` RPC + the atomic `unread_count` increment RPC/helper.
- The **frozen contracts**: the `/api/send-message` request+response schema; the `messages` insert
  column-shape; the `sendAutomatedMessage`/`sendGatedSms` signature + return `{ok,skipped,reason}`
  vocabulary. Change a contract → F-core owner change, not a wave edit.

**Shared surface (consumed as-is, never edited in-wave):**
- `functions/lib/twilio.js` (F-core is the only permitted editor, and only if segment/price capture
  needs a return-shape widen — otherwise frozen), `functions/lib/supabase.js`, `functions/lib/cors.js`,
  `functions/lib/credentials.js`, `functions/lib/phone.js` (import `normalizePhone`),
  `functions/lib/sms-consent.js`, `functions/lib/date-mt.js`.
- `functions/api/notify.js`, `functions/api/send-push.js`, `functions/lib/webPush.js` — **call-only**
  (notify wave, shipped; APNs dormant/OUT). Emit via the existing `message.inbound` event, do not edit.
- `src/lib/realtime.js` — type-agnostic; **do not edit**. Phase C's Capacitor suspend-recovery is a
  consumer-side `visibilitychange` refetch in `Conversations.jsx`, NOT a `realtime.js` change.
- `src/contexts/AuthContext.jsx`, `src/components/{TechLayout,CrmLayout}.jsx`, `package.json` + lockfile.

**Other-initiative-owned (out of scope — do not touch):**
- `src/pages/Marketing.jsx`, `functions/api/send-text-campaign.js` (unbuilt), the
  `automation_settings.sms_sending_enabled` flip — **CRM 4b + owner**.
- `functions/api/process-crm-automations.js`, `src/pages/crm/CrmAutomations.jsx` — **CRM 5-Ops**.
- `functions/api/process-sequences.js` — **omni/CRM Phase 8** (import its exported helpers only;
  Phase D must keep its `sendAutomatedMessage` return contract intact — §3).
- `src/pages/crm/CrmConversations.jsx` — CRM wrapper (renders the shared `Conversations`; Phase C
  changes flow through automatically, but do not edit the CRM wrapper file).

---

## 2. Ownership matrix

| Session | Phase | Owns exclusively (edit only these) | Schema / RPC |
|---|---|---|---|
| **H0** | Wave -1 hotfix | `functions/api/send-message.js`, `functions/api/twilio-webhook.js`, `src/pages/Conversations.jsx` (surgical P0 lines only) + `functions/api/send-message.test.js` (new) | none |
| **F** | F-core | ALL migrations; `functions/lib/twilio-errors.js` (new); the frozen contracts; this manifest; reserved css markers; omni-F stale-box tick | **ALL schema** + `claim_scheduled_message`, atomic `unread_count` increment |
| **F-red** | anon-closure | policy-recreate migration + backward-compat tests | policies only (messages/conversations/conversation_participants/automation_settings) |
| **A** | Transport hardening | `functions/api/twilio-webhook.js`, `functions/api/twilio-status.js`, `functions/api/process-scheduled.js` + tests | none (calls F's claim RPC + twilio-errors) |
| **B** | Send chokepoint | `functions/api/send-message.js` + `send-message.test.js` | none |
| **C** | Conversation UX | `src/pages/Conversations.jsx`, `src/components/conversations/**` (new), `src/index.css` §623 (omni-U marker) | none |
| **D** | Automated visibility | `functions/lib/automated-send.js`, `functions/api/run-automations.js` + tests | none |
| **G** | Deliverability ops | new deliverability health component, `src/components/Layout.jsx` (unread badge only) | none |

**Serialization:** H0 (Wave -1) and F (F-core) touch disjoint files and may run concurrently; **both
merge before Wave 1.** A/B/C/D launch after both merge. Within Wave 1, H0's edits to `send-message.js`
+ `twilio-webhook.js` are already merged, so B/A build on the hotfixed versions. G launches after A+C.
F-red applies in its own owner-gated window and gates nothing. **Merge order is a preference, never a
gate; throttle to review bandwidth** (suggested: H0 → F-core → then wave).

---

## 3. Frozen contracts (change the BODY within the owner phase, never the shape)

- **`/api/send-message` request/response** (F-core-frozen; B implements, C consumes). B may add
  response fields additively; never remove or rename a field C reads.
- **`messages` insert column-shape** (F-core-frozen). All writers (H0/A/B/D + the service-role
  automated path) insert the same shape; new columns are additive via an F migration only.
- **`sendAutomatedMessage(...)` / `sendGatedSms(...)` signature + return `{ok, skipped, reason}`**
  (F-core-frozen; D fills the body). The reason strings **`'sms_disabled'` and `'quiet_hours'` are
  load-bearing** for held-retry in `process-sequences.js:143` and `process-crm-automations.js` — D may
  ADD new reason strings (additive-safe) but must NEVER rename these or reshape the result, and must
  ship committed backward-compat tests that both non-owned callers still succeed (§8).
- **`claim_scheduled_message(p_id) → boolean`** (F-core). SECURITY DEFINER, `GRANT EXECUTE TO
  authenticated, service_role`. A calls it; never re-defines it.
- **omni §7 wrong-channel invariants** (adopted, not redefined): the worker is the sole writer of any
  `sms_*` message row (the client inserts only `internal_note`); no cross-channel fallback; consent
  gate selected by channel.

---

## 4. Migration rule (this initiative)

F-core + F-red own 100% of schema/RPC. **Every wave phase (A/B/C/D/G) ships ZERO schema migrations.**
Additive-only on the F side: drift-capture (no-op baseline) + `messages.num_segments`/`price` +
tracked-index/publication + the two RPCs; F-red is a policy-recreate (TO authenticated) with a
rollback note. **No `ALTER`/`DROP`/rename of a live table** — the drift-capture migration documents the
live shape, it does not mutate it. Every migration carries the `documentation-standard.md` SQL header
(WHAT / ADDITIVE-ONLY / ROLLBACK) and is apply-window-sequenced (`database-standard.md` §5) — F-red's
policy DDL must not overlap any other strong-lock apply window on the same tables.
`migration-safety-checker` + `anon-grant-auditor` audit every migration-shipping PR.

## 5. index.css rule

Only **Phase C** writes `index.css`, inside the existing omni-U marker
`/* ─── OMNI-INBOX RESERVED — Phase U (unified inbox UI) ─── */` (`src/index.css:623`) — C is literally
occupying omni-U's reserved seam. Existing `.conv-*`/`.message-*`/`.tech-layout .conversations-*`
selectors may be re-used; new classes are C's. Mobile-only rules use `@media (max-width: 768px)`; the
tech-layout variant already lives at `index.css:1298-1304`. No other phase touches `index.css`.

## 6. Consent / call-only seams (the reviewer weights these)

- **Structurally-unbypassable consent** (any phase that sends): automated/marketing sends only through
  `sendAutomatedMessage()`; no direct Twilio, no `skip_compliance` (H0 removes it). Consent writes land
  in `sms_consent_log` with actor/IP. Suppressed/DND contacts excluded at audience build AND durably
  skipped at send time. **TCPA penalties are per message.**
- **Worker is the sole writer** of `sms_*` rows (client inserts only `internal_note`) — C's fake-send
  removal enforces this; D's automated thread-writes use the service-role worker path.
- **A2P live path** is gated (roadmap §7); no session tests the live send until approval confirmed.
- **`process-scheduled` auth** (A): add the cron-secret/requireAuth gate — never leave it public.

## 7. Foundation artifacts the wave consumes (frozen contracts)

`twilio-errors.js`; `claim_scheduled_message`; the atomic `unread_count` increment; the three frozen
contracts (§3); the drift-captured live schema; F-red's authenticated-scoped policies. Consume; never
redefine.

## 8. Close-out (every session)

Commit → `npm run test` + `npm run build` + `npx eslint` (changed files) → reviewer gauntlet
(`sms-experience-phase-reviewer`; `consent-path-auditor` on any send-path change;
`migration-safety-checker` + `anon-grant-auditor` on any migration; `upr-pattern-checker`) → visual
check desktop + mobile incl. `/tech/conversations` (Phase C) → apply + verify migrations live via MCP
within the sequenced window (F only) → update `UPR-Web-Context.md` (Rule 9) → reconcile the roadmap
checkboxes (both directions; owner-gated stages stay open with the reason disclosed) → delete TEST rows
→ push `-u` → **open a PR into `dev` as a handoff and STOP** (the owner merges; do not subscribe to /
babysit / click-merge). F-red's RED apply waits for the owner's explicit OK.

---

## 9. Frozen-contract specifications (F-core — the authoritative shapes)

These are the concrete shapes behind the §3 named contracts. **Shipped + verified live 2026-07-09.**
A wave phase implements the BODY behind these; it never changes the shape. Where a phase adds a field
it does so **additively** (never remove/rename a field a sibling reads). Source of truth for column
names/types is the drift-capture migration `supabase/migrations/20260709_sms_f01_drift_capture.sql`.

### 9.1 `POST /api/send-message` request/response (B implements · C consumes)

**Auth:** `Authorization: Bearer <supabase access_token>` required (`requireAuth`). Missing/invalid → `401 {error}`.

**Request body (JSON):**
```
{
  conversation_id: uuid,        // required
  body:            string,      // required, non-empty (trimmed)
  sent_by:         uuid,        // employee id (nullable in practice, used for prefix + audit)
  media_urls?:     string[],    // MMS attachments
  is_internal_note?: boolean    // true → insert-only internal_note, no Twilio, no consent
  // NOTE: `skip_compliance` is REMOVED by Wave -1/H0 — never reintroduce it (consent invariant §6).
}
```

**Response:**
- Internal note → `201 { success:true, message:<messages row>, type:'internal_note' }`
- Outbound     → `201 { success:true, message:<messages row>, twilio:[<per-recipient result>] }`
  (B adds per-recipient `messages` rows + surfaces `error_code`/`error_message`; new response fields
  are additive — C must tolerate extra fields and must not depend on `twilio[]` ordering beyond index 0
  for a `direct` conversation.)
- Blocked (consent) → `403 { error, code:'DND_ACTIVE'|'NO_CONSENT', contact_id }`
- Validation → `400 { error }` · Not found → `404 { error }` · Auth → `401 { error }` · Server → `500 { error }`

### 9.2 `messages` insert column-shape (all writers: H0/A/B/D + service-role automated path)

Every writer inserts into the SAME live column set (drift-capture §f01). Canonical outbound-SMS insert:
```
{
  conversation_id: uuid,          // required, FK → conversations (ON DELETE CASCADE)
  type:            text,          // 'sms_inbound'|'sms_outbound'|'internal_note'|'email_inbound'|'email_outbound' (CHECK)
  body:            text,
  channel:         text,          // default 'sms'; CHECK null|'sms'|'mms'|'rcs'|'email'
  status:          text,          // default 'queued'; CHECK queued|sent|delivered|read|failed|undelivered|received
  twilio_sid:      text,          // UNIQUE (messages_twilio_sid_key) — one row per Twilio SID; NULL allowed (notes/queued)
  sent_by:         uuid,          // FK → employees
  media_urls:      jsonb,         // array of URLs (writers currently JSON.stringify an array before insert)
  error_code:      text,          // Twilio numeric code as text (A fills from status callback)
  error_message:   text,
  num_segments:    integer,       // NEW (f02) — Twilio segment count; A fills from status callback. Nullable.
  price:           numeric         // NEW (f02) — Twilio price; A fills from status callback. Nullable.
  // also live (omni + misc): direction, sender_phone, sender_contact_id, rcs_content_sid, read_at,
  // clicked_at, email_* / subject / in_reply_to / email_references / sender_email — see f01.
}
```
Invariant (§7.1 adopted from omni): the **worker is the sole writer** of any `sms_*` row; the client
inserts only `type:'internal_note'` (channel is left NULL for notes).

**num_segments / price capture:** Twilio sends `NumSegments` / `Price` / `PriceUnit` as status-callback
form fields. **Phase A reads them directly from the callback `formData`** in `twilio-status.js` and
writes `num_segments`/`price`. `functions/lib/twilio.js` is **NOT widened by F-core** (its
`parseTwilioWebhook` stays frozen); if A finds it must round-trip these through the shared parser, that
is a small F-core follow-up, not an in-phase edit to the frozen file.

### 9.3 `sendAutomatedMessage` / `sendGatedSms` signature + return vocab (D fills · Phase 5/8 depend)

```
sendAutomatedMessage(channel, contactId, templateKey, variables = {}, env, extra = {})
  // channel ∈ 'email'|'sms'; extra: { html, body, subject, orgId, now, ... }
sendGatedSms(env, { contact, body, orgId, now })
```
**Return (frozen):** `{ ok: boolean, skipped: boolean, reason?: string }`
(+ `sid` on a real send, `error` on a thrown send — both additive to the base three).

**`reason` vocabulary (frozen — extend ADDITIVELY, never rename/reshape):**
`'sms_disabled'`, `'no_phone'`, `'dnd'`, `'no_consent'`, `'quiet_hours'`, `'contact_not_found'`.
**Load-bearing (do NOT rename — held-retry keys on them):** **`'sms_disabled'`** and **`'quiet_hours'`**
(consumed by `process-sequences.js` and `process-crm-automations.js`). D ships committed backward-compat
tests that both non-owned callers still succeed (roadmap §8).

### 9.4 New RPCs (A + D consume · never re-`CREATE OR REPLACE`)

```
claim_scheduled_message(p_id uuid) → boolean
  -- SECURITY DEFINER; GRANT EXECUTE TO authenticated, service_role (never anon).
  -- Atomic compare-and-set on scheduled_messages.claimed_at: returns TRUE to exactly ONE caller that
  -- claims a still-'pending' row (unclaimed, or stale-claimed >10 min ago → crash recovery). Does NOT
  -- touch `status` (the status CHECK has no 'processing' value — the old worker's 'processing' write is
  -- retired by A in favour of this RPC + a terminal 'sent'/'failed').
  -- ⚠️ Phase A OBLIGATION (at-least-once semantics): after a successful claim + send, A MUST write the
  --    terminal 'sent' (or 'failed') PROMPTLY. A crash AFTER send but BEFORE the terminal write leaves the
  --    row 'pending'+stale, so the 10-min stale-recovery re-claims and can double-send. The RPC guarantees
  --    exactly-one-winner PER CLAIM WINDOW, not exactly-once end-to-end — closing that residual window
  --    (write terminal status immediately post-send; idempotency/twilio dedup) is Phase A's acceptance line.

increment_conversation_unread(p_conversation_id uuid, p_by integer DEFAULT 1) → integer
  -- SECURITY DEFINER; GRANT EXECUTE TO authenticated, service_role (never anon).
  -- One atomic UPDATE (no read-modify-write race). Clamps at 0. Returns the new unread_count, or NULL
  -- if the conversation does not exist.
```

### 9.5 `functions/lib/twilio-errors.js` (A applies suppression/flags · C uses `uiClass`)

```
classifyTwilioError(code) → { code:number, label:string, suppress:boolean,
                              contactFlag:'opt_out'|'invalid_number'|null, uiClass:string }
TWILIO_ERROR_CODES  // 21610 (opt-out→suppress+opt_out+'blocked'), 30006 (unreachable→suppress+
                    // invalid_number+'unreachable'), 30007 (carrier filter→'carrier', no flag),
                    // 30034 (unregistered A2P→'config', no flag)
DEFAULT_TWILIO_ERROR  // unknown/blank → { suppress:false, contactFlag:null, uiClass:'error' }
```
`uiClass` tokens (C maps to CSS): `'blocked'|'carrier'|'unreachable'|'config'|'error'`. `contactFlag`
is a hint — the consumer decides how to persist it (never write from this pure module). Extend the
table additively; never repurpose a token.

### 9.6 index.css reserved seam

F-core writes **no** `index.css`. The single wave writer is **Phase C**, inside the pre-existing
omni-U marker `/* ─── OMNI-INBOX RESERVED — Phase U (unified inbox UI) ─── */` at `src/index.css:623`
(C literally occupies omni-U's seam — §5). No new SMS-experience marker is created.

---

## 10. tech-messages-v2 addendum (2026-07-09) — dedicated tech pane supersedes the §6 posture for the tech shell

The **tech-messages-v2** initiative (`docs/tech-messages-v2-roadmap.md`) builds a dedicated
keep-alive field-tech messaging pane behind `page:tech_msgs_v2`. Recorded here so §§1–9 stay
truthful:

- **Supersession:** the roadmap §6 "one shared component reaches the tech app automatically"
  posture is superseded FOR THE TECH SHELL once the pane's flag opens. `Conversations.jsx`
  keeps serving `/conversations` + CRM unchanged; the open §6/Phase C/Phase G tech-PWA
  on-device verification lanes retarget to the new pane's bake.
- **Consumed contract (freeze):** `src/components/conversations/{MessageBubble,
  SegmentCounter,messageUtils}` exports are imported by the pane — additive changes only;
  a reshape needs a coordination note to the tech-messages owner.
- **Authorized copy-ins (disclosed, never edits):** Conversations.jsx `dispatchSend`/
  `retryMessage` (:732-870; `handleSend` rewritten), the suspend-merge heuristic (:258-278),
  the unread-desync guard (:316-327), the MMS upload path (:687-700). `:364-399` is
  reference-only.
- **Deep-link coordination:** the Phase G FOUND-BROKEN push deep-link fix
  (`twilio-webhook.js:104`, Session-A-owned) stays sms-owned; the pane ships `?c=` parity so
  a role-aware link can later target `/tech/conversations?c=` without pane changes.
- **Stale-banner disclosure:** roadmap :227 (Phase A "awaiting owner merge") and :249
  (Phase B "not yet merged") are STALE — both merged (8f63ae9, 4a52d99).
- Everything else in §§1–9 binds the new initiative unchanged (worker sole-writer, no
  `skip_compliance`, call-only workers, realtime.js frozen, A2P owner gate).
