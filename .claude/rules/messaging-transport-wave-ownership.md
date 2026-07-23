# Messaging Transport — File & Contract Ownership Manifest

**Last-verified:** 2026-07-23

**Plan of record:** `docs/messaging-transport-roadmap.md`

This manifest governs the CallRail-first, Twilio-ready messaging transport initiative. Where this
manifest conflicts with an older completed initiative's file freeze, this manifest controls only
the explicit amendments below. `CLAUDE.md`, `database-standard.md`, `workers-standard.md`, and the
standing consent/security rules remain higher authority.

## 1. Binding boundaries

- Staff person-to-person sends use `POST /api/send-message` only.
- The worker remains the sole writer of SMS/MMS message rows.
- Consent and DND fail closed before provider selection or provider calls.
- Clients, conversations, consent, DND, automations, and scheduled messages never choose a provider.
- No adapter fallback and no cross-channel fallback.
- CallRail is forbidden for scheduled, automated, group, broadcast, bulk, campaign, and text-blast
  sends.
- The current production behavior remains Twilio until a later owner-approved activation phase.

## 2. Phase ownership

| Phase | Owns | Must not change |
|---|---|---|
| 1 — Twilio-only seam | new `functions/lib/messaging-transport.js` + test; `functions/api/send-message.js` import/call only; this plan/manifest; named canonical/ownership docs | request/response, DB, auth, clients, provider settings, Twilio helper behavior |
| 2 — auth/idempotency foundation | `send-message.js` + tests; `callrail-connect.js` + tests; both inbox client request-id plumbing; reviewed messaging migration(s); canonical docs | provider activation; CallRail adapter/webhook |
| 3 — CallRail adapter disabled | `messaging-transport.js`; new flat CallRail text adapter + tests; `send-message.js` mode/purpose gate | clients/domain; automated/scheduled/campaign senders |
| 4 — CallRail text ingest | new `callrail-text-webhook.js` + tests; provider-event/reconciliation helpers; worker telemetry; approved private MMS ingestion path | existing voice/form webhook parser; clients; automation |
| 5 — owner activation | configuration/runbook docs and only the code fixes required by sandbox evidence | unapproved live sends, migration applies, number moves |
| 6 — Twilio cutover proof | adapter/config/runbook tests | client/domain rewrites |

Each phase is serial unless a later owner-approved amendment proves file and artifact disjointness.

## 3. Phase 1 exact amendment

Phase 1 may:

- add a flat provider-neutral transport dispatcher;
- import the existing `functions/lib/twilio.js` helper as its only adapter;
- change `functions/api/send-message.js` to import the dispatcher's same-shaped `sendMessage`;
- add focused pure unit/contract tests;
- update documentation and the explicit completed-manifest pointers.

Phase 1 may not:

- edit `functions/lib/twilio.js`;
- add CallRail send logic or a CallRail adapter registration;
- read `MESSAGING_SEND_MODE` or any new environment variable;
- edit `automated-send.js`, `process-scheduled.js`, Twilio webhooks, CallRail workers, clients, or
  migrations;
- change authorization, request/response fields, row shape, callback URL, status mapping, or
  provider configuration;
- send a message or mutate external state.

## 4. Supersession of completed freezes

- `.claude/rules/sms-experience-wave-ownership.md`: its completed Phase-B ownership and shared-lib
  freeze are amended only for the exact Phase-1 seam above and the later phases listed here.
  SMS Experience's consent, frozen public contract, sole-writer, and no-fallback rules remain binding.
- `.claude/rules/tech-messages-v2-wave-ownership.md`: its `send-message.js` / `functions/lib/*`
  call-only freeze is amended only for this server-side initiative. Tech client files remain frozen
  until Phase 2's additive `client_request_id` work.
- `.claude/rules/omni-inbox-wave-ownership.md` and `.claude/rules/crm-wave-ownership.md`: no Phase-1
  amendment. Automation/campaign workers stay Twilio-specific and outside the selectable seam.

## 5. Shared contracts

Preserve throughout:

- `POST /api/send-message` request/response and error shapes unless a phase explicitly adds an
  additive field with compatibility tests;
- `messages.twilio_sid`, current message type/status vocabulary, and realtime behavior;
- `sendAutomatedMessage` / `sendGatedSms` signature and reason vocabulary;
- worker-only SMS row writes and structurally unbypassable consent;
- separate provider webhook routes and provider-authentication schemes.

Generic message identity and attempts/events are additive. No live function, column, policy, grant,
or provider behavior is inferred from a plan or generated type.

## 6. Database and external-state gate

Phase 1 ships no migration. Later database work requires:

- a fresh read-only live catalog/grant/policy/caller capture;
- additive migration source with explicit rollback;
- negative authorization/idempotency tests;
- migration-safety and anon-grant review;
- owner approval for the shared-production apply window.

No phase configures secrets, Cloudflare variables, Supabase, provider webhooks, phone numbers, or
live messaging without explicit owner authorization.

## 7. Close-out

At minimum:

- focused unit/contract tests;
- full `npm test`;
- `npm run build`;
- ESLint on changed JavaScript files;
- `consent-path-auditor` posture for any send-path change;
- `migration-safety-checker` and `anon-grant-auditor` for migration/auth changes;
- update `UPR-Web-Context.md` and canonical docs affected by the phase;
- report repository proof separately from database, deployment, provider, and device proof.

Do not commit, push, open a PR, deploy, apply a migration, configure a provider, or send a message
unless the user explicitly requests that delivery or external action.
