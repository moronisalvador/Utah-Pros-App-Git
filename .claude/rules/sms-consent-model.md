# SMS Consent Model — live law

**Last verified:** 2026-08-03

The binding consent rules for every UPR send path. Extracted 2026-07-31 from
`sms-experience-wave-ownership.md` when that completed initiative's manifest was archived to
[`docs/archive/rules/sms-experience-wave-ownership.md`](../../docs/archive/rules/sms-experience-wave-ownership.md);
the two sections below are **verbatim, unchanged law** — only their location moved.

**Section numbers deliberately start at 12.** `AGENTS.md` §14, the depth map, and several docs
and handoffs cite these as "§12" and "§13"; renumbering would silently break every one of
those cross-references.

Compact statement of the same invariants: `AGENTS.md` §14. Where this file and a summary
disagree, **this file is authoritative**.

---

## 12. Verified prior-consent attestation addendum (2026-07-23)

The owner authorized reconciling the standalone historical-consent remediation onto current
`dev`, applying its reviewed service-only migration, and preparing it for the next production
release. This addendum authorizes only:

- `supabase/migrations/20260724014423_attest_prior_sms_consent.sql` and its static contract test;
- the new `functions/api/attest-sms-consent.js` Worker and focused tests;
- the additive prior-consent flow in `src/pages/Conversations.jsx`, the new
  `src/components/conversations/SmsConsentAttestationModal*` files, and `.conv-consent-*` styles
  inside the existing Phase-C conversation seam;
- the narrow `functions/api/send-message.js` / test reinforcement that treats `opt_out_at` as a
  hard block, consumes the service-only consent decision, identifies Utah Pros Restoration, and
  includes STOP instructions on the first accepted outbound thread message;
- the narrow `functions/lib/sms-consent.js` and `functions/lib/automated-send.js` hardening that
  projects and refuses `opt_out_at`, with focused tests, while preserving every exported
  signature and the frozen `{ ok, skipped, reason }` vocabulary; and
- the narrow `functions/api/process-scheduled.js` consent-decision call that preserves the
  existing worker/claim/provider contract, fails closed on duplicate-contact or pending-STOP
  suppression, and accepts only `GLOBAL_OPT_IN` (never staff-only `SERVICE_CONSENT`); and
- matching canonical documentation and dated evidence.

This flow records only verified prior permission for one-to-one service messages. It does not
authorize marketing/bulk consent, infer permission from contact existence or business
relationship, clear DND/STOP/provider opt-out state, bypass the send chokepoint, select a provider,
send a test message, or authorize an automated/marketing sender. The Worker derives the actor from
the verified session; the database operation is service-role-only, rechecks active internal
admin/office authority, serializes on normalized phone identity, refuses duplicate-contact or
pending-provider STOP state, and writes a dedicated service-message consent record plus an
append-only audit row in one transaction. It never changes `contacts.opt_in_status`. Customer
re-subscription after revocation remains the inbound START/affirmative written path.

---

## 13. Opt-out-only consent addendum (2026-07-28) — owner-directed

**The owner directed, in conversation on 2026-07-28, that SMS permission become opt-out-only for
service messaging:**
*"We already have opt out and DND in place, which should be the only thing that matter. If we have
their contact info, they gave it to us and requested our service."* Asked to scope it, the owner
initially chose every send path, then clarified: *"We will not send any bulk marketing text, we're a
restoration company not a window cleaning company."* Staff-written direct 1:1 service SMS uses that
opt-out-only rule. On the same date the owner also approved typed transactional service notices,
initially `appointment_scheduled`, `appointment_canceled`, and `signature_request`, without recorded
opt-in. Generic automation, scheduled free-form messages, group, broadcast, bulk, campaign and
marketing traffic remain global-opt-in-only. Recorded here because §6 and §12 above state the
broader opt-in rule and the exact reviewed exceptions must remain explicit.

**What changed.** `get_service_sms_consent_status(uuid, text)` — signature frozen, body only — now
returns a new `allowed` code **`IMPLIED_CONSENT`** where it previously returned `NO_CONSENT` for a
reachable contact with no recorded permission. Migration
`20260728000000_sms_consent_opt_out_only.sql`, rollback in `supabase/rollbacks/`, CI-visible source
contract in `tests/qa/unit/sms-consent-opt-out-only.test.js`.

**What did NOT change — every one of these still fails closed:**

- **DND**, **explicit `opt_out_at`**, and a **pending STOP** (an inbound STOP not yet projected)
  all still refuse the send, at the same point in the flow, with the same audit rows.
- The **worker remains the sole writer** of `sms_*` rows; the client still inserts only
  `internal_note`.
- **No cross-channel and no adapter fallback.** A refused channel is still refused, never retargeted.
- `skip_compliance` is still gone and must never return.
- The `{ ok, skipped, reason }` vocabulary is unchanged; `sms_disabled` and `quiet_hours` are still
  load-bearing for held-retry.
- **`SERVICE_CONSENT` and `IMPLIED_CONSENT` are not generic automation inputs.** Staff direct 1:1
  may consume them. A dedicated typed transactional-service producer may consume them only for a
  purpose in `TRANSACTIONAL_SERVICE_SMS_PURPOSES`; generic automation, scheduled free-form, group,
  broadcast, bulk, campaign and marketing sends accept `GLOBAL_OPT_IN` only.
- The function is still `service_role`-only; `anon` and `authenticated` are still revoked.
- **A2P live sends, provider binding and flag flips remain owner-gated.**

**The code-side revert switch needs no database window.** Each send path names its accepted codes
in `functions/lib/sms-consent.js`. `STAFF_ACCEPTED_CONSENT_CODES` and the separate
`TRANSACTIONAL_SERVICE_ACCEPTED_CONSENT_CODES` contain `IMPLIED_CONSENT`; generic
`AUTOMATED_ACCEPTED_CONSENT_CODES` and `SCHEDULED_ACCEPTED_CONSENT_CODES` do not. Removing the code
from the first two lists returns those paths to opt-in-only on the next deploy without touching the
shared database. Use the rollback migration only to remove the database return code itself.

**Client pre-flight removed.** `GET /api/attest-sms-consent` is no longer called on thread open in
either shell — that fetch produced the "Checking SMS permission…" delay on every conversation.
Permission is now derived synchronously from the contact row already on screen. **The server is
still the authority:** `POST /api/send-message` runs the real gate and refuses with a reason. The
attestation endpoint itself is unchanged and still serves the attestation flow.

**A pending STOP is enforced silently (owner-directed, same conversation).** It is deliberately not
surfaced in either shell — it is an internal projection window that clears in seconds and that
staff can do nothing about, so a banner about it was noise. The block itself is untouched.

**Typed transactional-service exception.** The approved initial registry entries are
`appointment_scheduled`, `appointment_canceled`, and `signature_request`. They are examples of the
service-notice class, not a caller-controlled label bypass: every additional purpose requires a
reviewed registry change. A producer must derive the event, destination and approved copy from the
server-owned appointment or signature record, use a stable source-record/event delivery identity,
write the mandatory durable `transactional_service_send_allowed` audit before provider selection,
and retain the DND, explicit opt-out, pending STOP, phone mismatch/missing, quiet-hours,
kill-switch, worker-only writer and no-fallback gates. The generic `sendAutomatedMessage()` API has
no `servicePurpose` input and cannot opt itself into this exception. No automated producer for
these notices is live yet; the existing staff-triggered signature request remains a direct
`POST /api/send-message` action.

**APPLIED 2026-07-30** under explicit owner authorization, live ledger version `20260730121811`.
The migration's own drift guard passed, confirming the live body was byte-exact to the reviewed
2026-07-28 definition before replacement. Verified live afterwards: `anon` and `authenticated`
EXECUTE both false, `service_role` true, and the DND / explicit-opt-out / pending-STOP refusals all
still present in the live body. Opt-out-only is therefore **live behaviour now** for the direct
staff 1:1 path, which accepts `IMPLIED_CONSENT`; every automated, scheduled, group, broadcast, bulk,
campaign and marketing path still accepts `GLOBAL_OPT_IN` only. The code-side revert (remove
`IMPLIED_CONSENT` from `STAFF_ACCEPTED_CONSENT_CODES` and redeploy) remains the faster rollback and
needs no database window; the rollback migration reverses the database return code itself.

---

## 14. Scheduled free-form delivery safety amendment (2026-07-31) — owner-directed

Scheduled free-form SMS remains automated traffic and accepts only `GLOBAL_OPT_IN`. It keeps every
§13 refusal, including DND, explicit opt-out, pending STOP, missing or changed destination,
quiet-hours, kill-switch, worker-only writes, and no channel/provider fallback.

The scheduled-delivery hardening may add optional internal reservation controls to the existing
`sendAutomatedMessage(..., extra)` / `sendGatedSms(env, options)` object arguments and additive
delivery-attempt metadata to results. It must preserve the positional signatures, the base
`{ ok, skipped, reason }` contract, and the load-bearing `sms_disabled` and `quiet_hours` reason
strings. This permission does not create a second send door.

Creation is actor-derived and idempotent. The database records immutable provenance for creator,
conversation, canonical body/send time, recipient contact, and recipient phone; a forged
appointment, job, claim, crew, dry-log, or room assignment never grants conversation access or
schedule authority. Browser roles cannot write the raw queue.

Delivery is token-fenced and permits at most one durable provider reservation/submission per
scheduled text. After reservation, an uncertain provider outcome is reconciled without another
provider call; neither a worker retry nor a second claimant may submit again. A managed
credential-store timeout after reservation fails closed before provider fetch, bypasses warm cache,
and never falls back to an environment credential.

Compatibility migration `20260731220000_scheduled_message_delivery_compatibility.sql` locks the
queue and aborts with SQLSTATE `55000` without mutation unless the aggregate pending count is zero.
Enforcement migration `20260731220100_scheduled_message_delivery_enforcement.sql` follows only
after compatible clients/workers are deployed. Authored source and local proofs are not evidence
that either migration, application code, or provider behavior is live. Until the compatibility
schema exists, `process-scheduled` recognizes only PostgREST `PGRST202` errors naming one of the
new delivery RPCs, leaves the queue provider-free, and returns a healthy
`delivery_schema_pending` deferral; timeout, permission, catalog, and other errors do not take
that fallback. The compatibility migration is the authoritative final quiet-hours boundary: it
samples `clock_timestamp()` immediately before the durable reservation and checks
`America/Denver`, so a Worker-side time sample cannot reserve across the 21:00 boundary. The
Worker also samples live time immediately before reservation/provider work; neither source claim
means the migration or a scheduler is applied or enabled.
