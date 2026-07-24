<!--
FILE: docs/messaging-rcs-readiness.md

WHAT THIS DOES (plain language):
  Defines how UPR can add Twilio RCS later without rewriting conversations, consent, inboxes, or
  provider-independent messaging history. It records the data vocabulary, compliance boundaries,
  tests, and rollout gates that must exist before RCS is enabled.

DEPENDS ON:
  Internal: docs/messaging-transport-roadmap.md, docs/business-rules.md, docs/integrations.md,
            functions/lib/messaging-capabilities.js
  Data:     reads → documentation and current messaging source
            writes → documentation only

NOTES / GOTCHAS:
  - This is a readiness contract, not approval to configure an RCS Sender or send RCS.
  - UPR's no-cross-channel-fallback rule remains binding even though Twilio offers automatic
    RCS-to-SMS/MMS fallback through a Messaging Service.
-->

# Twilio RCS Readiness

**Created / last verified:** 2026-07-23

**Status:** repository design only; RCS disabled and unconfigured

## Goal

RCS is a message channel, not a new conversation domain. UPR continues to own contacts,
conversations, participants, consent, DND, staff attribution, automation purpose, and message
history. Twilio-specific sender IDs, capabilities, templates, delivery events, and rich-content
rules stay behind the Twilio adapter and webhook normalization boundary.

The current CallRail-first work does not enable RCS. The small capability policy in
`functions/lib/messaging-capabilities.js` only reserves the vocabulary and rejects cross-channel
fallback; no active sender imports it.

## Current source evidence

- `POST /api/send-message` remains the single staff-send chokepoint.
- `functions/lib/twilio.js` sends through the Programmable Messaging Message resource and can use a
  Messaging Service SID, but its present command is SMS/MMS-shaped (`Body`, optional `MediaUrl`).
- The helper currently says Twilio “auto-upgrades” messages to RCS. That provider behavior is not
  equivalent to an owner-approved UPR RCS policy and must not be relied on for activation.
- `messages.channel` currently records `sms` or `mms`; the generic provider migration draft adds
  partial requested/actual channel evidence on service-only send attempts, but not yet on messages
  or normalized Twilio events.
- `twilio-status.js` already accepts a `read` state and records `ButtonText`, but does not yet
  persist normalized `ChannelPrefix`, `EventType`, `ChannelInstallSid`, `ButtonPayload`, template
  identity, or the requested-versus-actual channel decision.
- `parseTwilioWebhook()` exposes `ChannelPrefix`, but canonical inbound projection still writes
  `channel:'sms'`. Existing RCS-adjacent code is therefore partial evidence, not RCS readiness.

## Provider capabilities that shape the design

Twilio's current official [RCS send and receive guide](https://www.twilio.com/docs/rcs/send-an-rcs-message)
states that RCS uses Programmable Messaging, originates from a verified RCS Sender, and can deliver
text or Content Template rich content. An RCS Sender is not a telephone number; successful RCS
delivery reports a sender address such as `rcs:<SenderId>`.

Twilio's [outbound status callback guide](https://www.twilio.com/docs/messaging/guides/track-outbound-message-status)
documents channel-specific callback fields including `ChannelPrefix`, `ChannelInstallSid`,
`ChannelStatusMessage`, and `EventType`; `EventType=READ` represents a read receipt on supporting
channels. Callback properties may grow, so signature validation must cover every received field
without a fixed allowlist.

Twilio [Content Templates](https://www.twilio.com/docs/content/overview) provide stable Content SIDs
and channel-specific rich representations. RCS can use text, media, cards, chip lists, and
carousels; replies/actions may carry `ButtonText` and `ButtonPayload`. UPR must persist its owned
content intent plus the immutable template/version identity used for a send, not reconstruct
history from a later-edited provider template.

Twilio currently offers automatic RCS-to-SMS/MMS fallback when an RCS Sender and phone-number
senders share a Messaging Service. The same RCS guide documents an `rcs:` recipient prefix that
turns off that fallback for a send. UPR does **not** approve automatic fallback merely because the
provider supports it; an RCS-intended submission must use the documented no-fallback form.

Twilio announced [unified opt-outs across RCS, SMS, and MMS](https://www.twilio.com/en-us/changelog/twilio-now-supports-unified-opt-outs-across-rcs--sms--and-mms-ch)
in March 2026. Provider blocking is defense in depth; UPR's canonical consent and DND records remain
the pre-send authority and must be updated from authenticated inbound STOP/START/HELP evidence.

## Provider-neutral message facts

A future additive migration should distinguish intent from observed delivery:

| Field | Meaning |
|---|---|
| `requested_channel` | UPR-approved intent: `sms`, `mms`, or `rcs` |
| `actual_channel` | Channel confirmed by the provider: `sms`, `mms`, or `rcs`; null until known |
| `fallback_applied` | Whether the provider changed channel; outbound authorization requires false, but authenticated contrary evidence is retained as a violation |
| `fallback_from_channel` | Original channel if a future approved fallback occurred; otherwise null |
| `provider` | Transport owner, currently `twilio` or `callrail` |
| `sender_address_type` | `phone` or `rcs_sender` |
| `sender_address` | Exact phone number or `rcs:<SenderId>` used |
| `recipient_address_type` | Normally `phone`; do not infer channel from this alone |
| `recipient_address` | Normalized customer address used at submission |
| `content_kind` | `text`, `media`, `card`, `carousel`, or another reviewed owned vocabulary |
| `provider_template_id` | Twilio Content SID used, when any |
| `provider_template_version` | Immutable provider/version evidence when available |
| `content_snapshot` | Restricted normalized render facts needed to audit what the recipient saw |

The same facts belong on `message_send_attempts` where submission can differ from final message
state. Provider events retain normalized actual-channel, sender, template, action, and receipt
facts and link to the attempt/message by provider identity.

Legacy rows remain valid: `requested_channel` may be backfilled from current `channel`; unknown
`actual_channel` remains null rather than being guessed. Existing `messages.channel` stays
compatible until all readers move to the new fields.

## Address and conversation identity

UPR conversation identity remains customer/contact-owned. Do not use a Twilio RCS Sender ID,
Messaging Service SID, Content SID, or provider thread as the UPR conversation primary key.

Inbound normalization must retain both sides exactly:

- customer address, normally an E.164 mobile number;
- business address type and value (`rcs_sender` plus `rcs:<SenderId>` for RCS, `phone` for SMS/MMS);
- actual channel from authenticated Twilio fields;
- provider message identity and any installed-channel identity;
- quick-reply/action payload separately from visible body text.

Changing from a phone-number thread to a branded RCS Sender can present as a different device-side
thread. UPR may show one owned conversation, but the UI must not imply that the customer's native
messaging app preserves a single thread across sender identities.

## Consent, STOP/START/HELP, and purpose

- RCS requires the same fail-closed canonical consent and DND check before adapter selection.
- Consent evidence must name the approved program/purpose and disclosures. RCS approval does not
  broaden transactional consent into marketing or automation consent.
- Authenticated inbound STOP, START, and HELP update the same canonical state regardless of actual
  channel. Rich quick replies that represent those commands follow the same rule.
- Twilio Advanced Opt-Out and unified cross-channel blocking are provider enforcement, not UPR's
  system of record. Webhook evidence and error `21610` must reconcile into UPR state idempotently.
- Automated, scheduled, campaign, bulk, and group use cases require their own RCS registration,
  content, quiet-hours, consent, template, and rate-limit review. Enabling staff P2P RCS cannot
  silently enable them.

## Rich content and media

The inbox should render an owned neutral model, not raw Twilio template JSON. A reviewed model needs
text, media references copied into UPR-controlled storage where required, cards/carousels, visible
labels, stable action IDs, URLs/phone actions, accessibility text, and the exact template snapshot.

Before activation:

- enforce Twilio's current content-type, size, count, text, and public-URL rules in the adapter;
- keep private Storage canonical. The existing MMS seam may issue a short-lived signed provider
  fetch URL, but neither clients nor canonical rows persist it. RCS-specific media above the
  cross-provider five-megabyte envelope requires a later explicit capability/retention review;
- treat Content SID and variables as provider submission details derived server-side;
- validate action URLs and phone numbers; never execute an inbound action payload as code or URL;
- preserve private customer media handling and retention rules;
- define a plain-text-only first release unless rich rendering, auditing, and fallback semantics
  have passed security and product review.

## No-fallback activation gate

The outbound authorization policy is: `requested_channel === actual_channel`, and
`fallback_applied === false`. Authenticated provider evidence that violates this policy must first
be persisted as observed truth, marked as a policy violation, alerted, and used to disable further
sends; it must not be rejected before durable recording. A Twilio Messaging Service that can automatically downgrade RCS to
SMS/MMS is not an acceptable RCS production configuration today.

Every RCS-intended send must use Twilio's documented no-fallback destination form (`rcs:` prefix)
and prove in provider test-device evidence that an incapable recipient fails rather than switching
to SMS/MMS. No custom retry may resubmit the same action on another channel.

A later owner may approve fallback only after all of these exist:

- the schema facts above and immutable attempt/event evidence;
- per-purpose consent that covers both requested and fallback channels;
- a pre-send policy deciding which fallback is allowed;
- customer-visible content parity and disclosure review;
- idempotent status/reconciliation handling that records the actual channel;
- analytics, cost, quiet-hours, suppression, and sender-registration rules for both channels;
- negative tests proving no other provider/channel fallback can occur.

Provider-managed fallback must never be inferred from a Messaging Service sender pool or enabled as
an undocumented console-only behavior.

Until that adapter exists, no RCS Sender may be added to the active SMS-mode Messaging Service.
Prefer a separate reviewed Messaging Service/sender pool so the legacy ordinary-phone destination
cannot silently select RCS or provider fallback.

## Rollout phases

1. **Vocabulary only (current):** documentation and unused pure capability contract; RCS disabled.
2. **Additive persistence:** reviewed migration for requested/actual channel, address types,
   fallback evidence, content/template identity, and action/read events.
3. **Adapter/webhook normalization:** explicit RCS command, `rcs:` channel-locked submission,
   evolving signed webhook parsing, read receipt and action capture; still disabled.
4. **Plain-text test devices:** owner-approved Twilio sandbox/test-device configuration and
   provider fixtures; prove no fallback and canonical STOP/START/HELP behavior.
5. **Rich content:** only after owned rendering, template snapshot, media, URL/action, accessibility,
   retention, and security tests pass.
6. **Production activation:** owner-approved sender registration, disclosures, consent audit,
   Cloudflare configuration, deployment, single-recipient canary, monitoring, and rollback.
7. **Optional fallback:** separate initiative and owner decision; not part of RCS activation.

Immediate rollback is RCS mode disabled plus removal/disablement of the RCS Sender from the active
Messaging Service if provider routing is unsafe. Existing SMS/MMS/CallRail modes must not be used as
an automatic retry.

## Required test matrix

- Twilio+RCS allowed; CallRail+RCS and unknown channels rejected before provider work.
- Requested RCS / actual SMS or MMS is blocked as an outbound decision; authenticated observation
  is first persisted, then classified as a policy violation and alerts/halts future sending.
- Missing actual channel stays unknown; it is never guessed from recipient address.
- Signed inbound RCS text, media, STOP/START/HELP, quick reply, button payload, malformed action,
  duplicate event, and evolving extra webhook fields.
- Status sequence through delivered/read, late/out-of-order callbacks, channel error, missing
  provider identity, and message-row creation race.
- Content SID/version/snapshot and variables persist without credentials or unrestricted raw PII.
- Capability changes between preflight and send fail safely; no silent SMS/MMS substitution.
- RCS Sender versus phone sender address identity and customer-device thread implications.
- Every staff, scheduled, automated, group, campaign, and bulk purpose allowed/denied explicitly.
- Kill switch, consent, DND, quiet hours, rate limits, idempotency, ambiguous timeout, and rollback.

Repository tests and provider fixtures do not prove carrier approval, device capability, console
sender-pool behavior, carrier delivery, read receipts, or customer-device thread continuity.
