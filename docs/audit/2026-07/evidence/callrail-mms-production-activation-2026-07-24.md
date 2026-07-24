# CallRail MMS Production Activation Evidence — 2026-07-24

This record captures the controlled UPR CallRail MMS activation performed on 2026-07-24. It
deliberately excludes phone numbers, message bodies, provider message IDs, object paths, API keys,
webhook secrets, raw payloads, and screenshots containing customer or staff identity.

## Scope and release boundary

- The owner authorized implementation, reviewed shared-database migrations, dev deployment, one
  controlled SMS/MMS exchange with the owner's QA handset, commits, pushes to `dev`, and a
  ready-for-review `dev` to `main` pull request.
- The owner confirmed receipt of the controlled outbound MMS on the physical QA handset.
- The owner sent one harmless inbound image in reply; no additional provider send was used to
  recover or verify that inbound event.
- Unrestricted Production messaging and merging `main` remain owner-gated. This evidence does not
  record either approval.
- RCS and unrelated recipients were out of scope and were not used.

## Provider authorization diagnosis

The initial outbound CallRail requests returned a real provider `403`; this was not a UPR-only
false flag. The existing UPR CallRail API key had write access disabled in CallRail. Write access
was enabled on that existing key. An accidentally created extra unnamed key was immediately
revoked. No API key value was exposed in application output, source control, or this record.

After the permission correction, the controlled outbound MMS returned HTTP `200`, its retained
provider event reconciled to `outbound_confirmed`, exactly one canonical provider identity was
present, and the owner confirmed device receipt.

## Inbound MMS diagnosis and repair

The signed inbound webhook arrived successfully with direction `inbound`, channel `mms`, and one
media item. The failures were therefore downstream retrieval defects, not an inbound carrier or
webhook denial:

1. CallRail's live media link used `app.callrail.com`, while API-token retrieval belongs on the
   documented `api.callrail.com/v3/a/...` endpoint. A controlled probe showed the app host returned
   `401` to the API token.
2. Older UPR configuration could identify the account numerically, while current CallRail media
   paths use the masked `ACC...` identity. Authenticated account discovery now proves the aliases
   and uses the masked identity for credentialed API requests.
3. CallRail redirected the conversation-history request. The old `redirect: "error"` behavior
   surfaced this as a fetch failure. UPR now follows at most one manually inspected redirect on the
   exact API host, masked account, and conversation path.
4. Conversation history did not preserve webhook body text exactly and can expose either `type` or
   `message_type`. UPR now selects candidates by direction, MMS type, media count, and the exact
   verified account/provider-message identity embedded in the media URL; body equality is no
   longer treated as identity.
5. The signed S3 asset required a bounded regional handoff. UPR now follows at most one additional
   signed redirect for the exact CallRail media bucket on an AWS S3 hostname. The CallRail API
   credential is never attached to asset requests.

All stages retain HTTPS-only parsing, exact account/conversation/message/index checks, bounded URL
lengths, short AWS signature expiry, image MIME and magic-byte validation, per-object and aggregate
size limits, private Storage ownership, and redirect limits.

## Shared database changes

The following reviewed migrations were applied to the single shared Supabase project:

- Source `20260724193628_bind_callrail_outbound_mms_identity.sql`; live ledger version
  `20260724195329_bind_callrail_outbound_mms_identity`.
- Source `20260724195802_accept_frozen_callrail_mms_media_shape.sql`; live ledger version
  `20260724200321_accept_frozen_callrail_mms_media_shape`.

Post-apply catalog verification showed the affected routines executable by `service_role` only.
Rollback exercises passed. No new anonymous grant or public data path was introduced.

## End-to-end proof

After the final dev deployment, only the retained inbound event was released with guards on its
exact row ID, retry state, attempt count, and prior error code. The recovery worker does not send a
provider message.

The final live result was:

- processing state `processed`;
- outcome `inbound_persisted`;
- no error code or error message;
- one owned media item;
- one canonical inbound message in the exact existing conversation;
- one canonical media reference using `upr-storage://message-attachments/callrail/...`;
- one matching private Storage object;
- `message-attachments` bucket `public = false`;
- one message for the provider identity, confirming deduplication;
- dev UI image load complete at non-zero natural dimensions through a signed
  `message-attachments/callrail/...` URL.

## Code and verification

Relevant final repair commits on `dev`:

- `7f86aaf` — prefer the verified masked CallRail account identity;
- `cf0cadf` — constrain conversation-history redirects;
- `5f8e00f` — match MMS history by provider media identity;
- `a6c9c9f` — constrain signed asset redirects.

Verification on the final source state:

- focused CallRail MMS suite: `31/31` passed;
- worker lane: `1059/1059` passed, zero unexpected skips;
- targeted ESLint for the changed MMS implementation and tests: passed;
- production build: passed;
- GitHub `verify` checks: passed;
- Cloudflare Pages dev deployment for `a6c9c9f`: passed;
- live database deduplication, private-object, and non-public-bucket checks: passed;
- signed-in browser verification in the exact dev conversation: passed.

The scheduled-send repair also routes scheduled, sequence, automation, and CRM-run sends through
the centralized automated-message consent gate. Its consent and worker-security reviews passed.
Global automated SMS remains disabled because the pre-existing fixed-automation post-send event
persistence gap is not part of this activation.

## Remaining owner gate

The dev implementation and controlled end-to-end proof are complete. Enabling unrestricted
Production messaging or merging the `dev` to `main` release requires the owner's separate explicit
confirmation.
