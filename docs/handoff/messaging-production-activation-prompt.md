# Codex handoff — activate staff↔client messaging in production

Paste everything below the line into ChatGPT Codex. It assumes Codex has Cloudflare dashboard
and CallRail console access, which this Claude Code session did not.

Verified state as of **2026-07-25 00:40 UTC** by the session that wrote this.

---

You are completing the production activation of staff→client SMS/MMS messaging for the UPR
Platform (repo `moronisalvador/Utah-Pros-App-Git`). You have Cloudflare and CallRail access; the
session that prepared this did not, which is the only reason this is being handed to you.

**Business goal:** Utah Pros Restoration office/admin staff must be able to text clients from
`/conversations` (desktop) and `/tech/conversations` (field PWA) starting **Monday**.

## 1. Current verified state — do not re-derive, but do re-verify before acting

- `origin/main` = `origin/dev` = `46fd16b`, zero divergence. PR #514 merged 2026-07-25 00:38:48Z.
- Production CI green: Cloudflare Pages ✅, Workers Builds (upr-mcp) ✅, `verify` ✅ ×2.
- `npm run validate:provenance --ref origin/main` → **PASS**, ledger=21 / functions=21 / policies=5.
  Every recent live migration is reachable from the release ref. Keep it that way.
- Supabase project ref `glsmljpabrwonfiltiqm` backs **both** `dev` and production. One database.
- All messaging code is deployed. Nothing is missing in the repo. The only thing standing between
  today and staff messaging is **configuration + consent coverage**.
- `MESSAGING_SEND_MODE` is currently **unset**, which `functions/lib/messaging-transport.js`
  resolves to `disabled`. Sends short-circuit before any provider call.

## 2. Read these first

- `CLAUDE.md` (esp. Rule 4 deployment, Rule 7 database)
- `.claude/rules/database-standard.md` §0 (authoring ≠ applying) and §5 (apply windows)
- `.claude/rules/messaging-transport-wave-ownership.md` — §1 binding boundaries, §9 activation
- `.claude/rules/sms-experience-wave-ownership.md` §6 (consent), §12 (prior-consent attestation)
- `docs/messaging-transport-roadmap.md`, `docs/messaging-provider-cutover-runbook.md`
- `docs/testing-and-deployment.md` — release-evidence checklist

## 3. 🚨 Hard prohibitions — violating any of these causes real harm

1. **DO NOT set `automation_settings.sms_sending_enabled = true` as part of the staff-messaging
   activation.** It does **not** gate staff person-to-person sends — verified:
   `functions/api/send-message.js` never reads it. It gates **automated** sends, and
   `missed_call_textback_enabled` is already `true` in one of the two `automation_settings` rows,
   so flipping it immediately arms automated missed-call texting.
   The owner **does want missed-call textback on** — but it is a **separate, sequenced piece of
   work with two real blockers** (see §4a). Ship staff messaging first, verify it, then do §4a.
   Flipping this switch before §4a's blockers are closed produces duplicate texts and silent
   terminal no-consent skips.
2. **DO NOT bulk-record consent.** Do not write to `contacts.opt_in_status`,
   `service_sms_consents`, or `sms_consent_log` directly, and do not script the attestation
   endpoint across many contacts. Each record must reflect *genuine, verified prior permission
   from that specific person*. TCPA penalties are **per message**. Mass-marking consent is the
   single most expensive mistake available here.
3. **DO NOT bypass `POST /api/send-message`.** It is the sole staff send path and the final
   consent/DND authority. No direct Twilio/CallRail calls. `skip_compliance` does not exist and
   must never be reintroduced.
4. **DO NOT put secrets in chat, commits, files, or PR descriptions.** Secrets go only into the
   Cloudflare dashboard. `.claude/hooks/block-secrets.sh` blocks writes to `.env*` by design.
5. **DO NOT enable automated/campaign SMS.** PR #514 explicitly left it off: there is a
   pre-existing fixed-automation post-send event-persistence gap outside this activation.
6. **DO NOT apply `20260723_encircle_managed_credentials.sql`** or any other pending migration.
   Unrelated to this task and separately gated.
7. **CallRail is forbidden** for scheduled, automated, group, broadcast, bulk, and campaign
   sends. Person-to-person only.

## 4. ⚠️ The actual blocker is consent, not the switch

Measured live 2026-07-25:

| Metric | Value |
|---|---|
| contacts total | 199 |
| contacts with a phone number | 198 |
| **contacts with `opt_in_status = true`** | **8** |
| `service_sms_consents` rows | 1 |
| `sms_consent_log` rows | 27 |

The send path **fails closed**: `send-message.js` allows a staff send only when the consent
status is `GLOBAL_OPT_IN`, or `SERVICE_CONSENT` when the staff-only `allowServiceConsent` flag is
set. `DND_ACTIVE` and `NO_CONSENT` are refused, and missing/unknown status is treated as
`NO_CONSENT`.

**Consequence: flipping the switch alone means staff hit a refusal on ~96% of clients.**

Do not "fix" this by loosening the gate. The sanctioned paths to consent coverage are:
- **Inbound-first** — anyone who texts UPR first establishes consent through the normal inbound
  path. Zero effort, legally clean.
- **Per-contact prior-consent attestation** — an admin/office employee opens the contact's thread
  in `/conversations`, and where they have genuine verified prior permission, records it through
  the existing attestation modal (`SmsConsentAttestationModal`, backed by
  `POST /api/attest-sms-consent`). One contact at a time, by a human who knows that client.

**Report the consent-coverage reality to the owner and let them decide scope.** The realistic
Monday plan is: activate, start with the ~8 consented contacts plus inbound, and let coverage
build. Do not attempt a weekend backfill.

## 4a. Missed-call auto-textback — owner wants this ON, but it is not a switch flip

Business rationale (owner, 2026-07-25): *"we miss a lot of calls that are worth a lot of money.
If the CallRail webhook and API tell us for sure a call was missed, we want to trigger that SMS."*
That is a sound goal — speed-to-lead on missed calls is high value. The wiring already exists
(`functions/api/run-automations.js` → `runMissedCallTextback` → `fireAutomation` →
`sendAutomatedMessage`). But there are **two blockers, both verified in code**, and enabling the
flag without closing them makes things worse rather than better.

### Blocker 1 — as built, it will send almost nothing, and will do so permanently

`functions/lib/automated-send.js:514` blocks any automated send unless the consent status is
exactly `GLOBAL_OPT_IN`. Staff-only `SERVICE_CONSENT` is deliberately never consumed by automated
senders. Only **8 of 198** contacts currently have `opt_in_status = true`.

Worse, `run-automations.js:204` defines `DEFERRABLE_SKIP_REASONS = {quiet_hours, sms_disabled}`.
`no_consent` is **not** deferrable, so it is treated as **terminal**: a `system_events` row is
written and `alreadyFired()` will return true forever. **That missed-call event can never fire
again, even after consent is later obtained.**

Net effect of flipping the flag today: for the exact new/unknown high-value callers the owner
cares about, the automation records a terminal `no_consent` skip and sends nothing — while
appearing to be "on."

**This is a consent-policy decision, not an engineering one, and it needs the owner plus ideally
counsel.** The question is whether an inbound caller to a business constitutes consent to an
automated SMS reply. Do **not** answer it yourself and do **not** loosen the gate unilaterally.
Options to present, with tradeoffs, and let the owner choose:
- (a) leave the gate as-is → textback fires only for already-consented contacts (low value, zero new risk);
- (b) treat a verified inbound call as establishing consent for a *directly responsive* reply,
  implemented as an explicit, logged consent record written at missed-call time (medium value,
  requires an owner/counsel policy decision and an `sms_consent_log` entry with source and evidence);
- (c) make `no_consent` deferrable rather than terminal so the event re-fires if consent arrives
  later (small, safe improvement worth doing regardless of (a)/(b)).

### Blocker 2 — a real duplicate-send window (the gap PR #514 referenced)

`fireAutomation` checks `alreadyFired()` at line 213, **sends** at line 215, and only writes the
dedup marker to `system_events` at line 233. That is check-then-act with the marker written
**after** the send. If the worker dies or the insert throws in between, the text went out with no
marker, and the next cron tick re-sends it. This is the "pre-existing fixed-automation post-send
event persistence gap" PR #514 cited when it left automated SMS off. For missed-call textback —
cron-driven, and aimed at strangers — a duplicate automated text is both unprofessional and
per-message TCPA exposure.

**Fix it with the pattern this repo already uses everywhere else** (claim-before-send), do not
invent a new one:
- `claim_scheduled_message(p_id)` — atomic compare-and-set, `process-scheduled.js`
- `claim_qbo_event` / `claim_stripe_event` / `claim_inbound_email` / `claim_callrail_provider_event`
- CRM Phase 5's `UNIQUE(automation_id, triggering_event_id)` — the same problem solved by a constraint

Shape: an additive migration giving the fixed automations a unique claim key, then reorder
`fireAutomation` to **claim → send → finalize**, releasing the claim on deferrable outcomes
(`quiet_hours`, `sms_disabled`) exactly as `process-scheduled.js` already does. Requires unit tests
covering: duplicate suppression, deferrable release-and-retry, and terminal non-repeat.

### Sequencing

Do **not** bundle this with the staff-messaging activation. Ship and verify staff messaging first
(§6–§8). Then close Blocker 2, get the owner's decision on Blocker 1, and only then set
`sms_sending_enabled = true`. When you do, verify with a **real missed call to a number the owner
controls** — never a client.

## 5. Owner decision required before you configure anything

The owner recorded a standing directive on 2026-07-22:

> UPR will eventually replace CallRail with its own Twilio-based phone management side… Anything
> built now must not deepen CallRail coupling. Quality bar: S+ tier schema, S+ tier code.

Setting `MESSAGING_SEND_MODE=callrail` makes CallRail the live send path for all staff messaging,
which arguably deepens exactly that coupling. `twilio` mode is code-complete, but **A2P
registration was pending approval as of 2026-07** and may not be usable Monday.

**Ask the owner to choose `callrail` or `twilio` before you set anything.** If Twilio: first
verify A2P/10DLC campaign approval and an active Messaging Service in the Twilio console. Note
Twilio credentials resolve from the database (`integration_credentials`, the P9 managed-credential
pattern) rather than Cloudflare env — check `functions/lib/credentials.js` before assuming env vars.

## 6. Configuration steps (Cloudflare — dashboard only)

Cloudflare Pages → the UPR project → Settings → Environment variables. Set in **both** the
**Production** and **Preview** sets — Cloudflare keeps them separate and new secrets need both
plus a redeploy.

| Variable | Value |
|---|---|
| `MESSAGING_SEND_MODE` | `callrail` or `twilio` (per §5). Any other value resolves to `disabled`. |
| `MESSAGING_SCHEMA_MODE` | `foundation`. Defaults to `legacy` if unset — confirm which the deployed writers expect before changing it; do not change it casually. |

If CallRail mode, also set (values from the CallRail console — never echo them):

`CALLRAIL_API_KEY`, `CALLRAIL_ACCOUNT_ID`, `CALLRAIL_COMPANY_ID`, `CALLRAIL_TRACKING_NUMBER`,
`CALLRAIL_SIGNING_KEY`

Then **redeploy** — env changes do not take effect until a new deployment.

## 7. Configuration steps (CallRail console — if CallRail mode)

1. Bind the inbound **text** webhook to `https://utahpros.app/api/callrail-text-webhook`
   (Preview: the `dev.utahpros.app` equivalent). This is a **different** route from the existing
   voice/form webhook `/api/callrail-webhook` — do not repoint that one.
2. Ensure the signing key in CallRail matches `CALLRAIL_SIGNING_KEY` exactly. Signature
   verification fails closed; a mismatch silently drops all inbound messages.
3. Confirm the tracking number is SMS-enabled and that write permission is enabled on the API key
   (a previously observed 403 was caused by write permission being disabled on the key).

## 8. Verification sequence — do not skip or reorder

1. **Readiness endpoint.** `GET /api/messaging-setup` as an **admin** employee (it is admin-only,
   GET-only, no-store, redacted). `?action=callrail-options` does read-only provider discovery.
   Use this instead of poking the database. Confirm it reports the expected mode and configuration.
2. **Preview first.** Verify on `dev.utahpros.app` before Production. Send one message to a phone
   **you control**, from a contact record that genuinely has consent.
3. **Inbound proof.** Reply from that handset. Confirm the message lands in the correct thread, the
   provider event reaches `processed`, exactly one canonical message row exists, and any image is
   stored in the **private** `message-attachments` bucket and renders via a signed URL.
4. **Then Production**, same two proofs, same owner-controlled handset.
5. **Never send to a real client as a test.**
6. **On-device check.** Confirm push deep-link and MMS rendering on a real installed iPhone —
   Playwright/Chromium cannot verify this.
7. **Provenance.** Re-run `npm run validate:provenance` and confirm still PASS. Configuration
   changes should not affect it; if it fails, stop and report.

## 9. If something is wrong — rollback

Set `MESSAGING_SEND_MODE=disabled` in both Cloudflare env sets and redeploy. That is the kill
switch: sends short-circuit before any provider call. It requires no database change and no code
revert. Do this first, diagnose second.

## 10. Reporting requirements

Report **actual observed results**, never expected ones. Separate clearly:
- repository proof (tests/build/lint) — should be untouched by this task;
- database proof;
- Cloudflare configuration performed;
- CallRail provider configuration performed;
- device proof.

State explicitly: which mode is live, how many contacts can currently be messaged, what you
verified yourself vs. what remains unverified, and any step you skipped and why. If you cannot
complete a step, say so plainly rather than describing the system as fully working.

## 11. Explicitly out of scope

Do not take these on; they are tracked separately:
- missed-call textback beyond what §4a authorizes (staff messaging ships first)
- the QBO `retry` re-drive (registry `COR-002`, blocked on Intuit sandbox access);
- applying the Encircle migration;
- rebasing `chore/tooling-governance-pilot`;
- auditing `claude/upr-crm-dashboard-gap-e0e8ba` or `origin/claude/upr-tech-redesign-continued`;
- enabling automated/campaign SMS or RCS. RCS remains channel-locked with automatic
  RCS→SMS/MMS fallback prohibited.
