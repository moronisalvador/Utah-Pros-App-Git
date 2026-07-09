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
