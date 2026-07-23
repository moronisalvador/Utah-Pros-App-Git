<!--
FILE: docs/integrations.md

WHAT THIS DOES (plain language):
  Maps the external systems UPR talks to, what each connection is for, and where credentials and
  safety checks belong. It is an orientation map, not proof that production consoles are configured.

DEPENDS ON:
  Internal: functions/api/, functions/lib/, docs/testing-and-deployment.md,
            docs/auth-and-authorization.md, docs/business-rules.md
  Data:     reads → integration configuration, provider events and domain records
            writes → documentation only

NOTES / GOTCHAS:
  - Cloudflare/provider console state is external and must be verified separately.
  - Never put real credentials or reviewer identities in this file.
-->

# Integrations

## Integration map

| System | Purpose | Primary boundary |
|---|---|---|
| Supabase | Auth, Postgres/PostgREST, RPCs, Storage and Realtime | Browser user JWT; Worker service role; database RLS/RPCs |
| QuickBooks Online | Customers, estimates/invoices, payments and reconciliation | QBO Worker libraries/endpoints plus durable external IDs |
| Intuit Payments | Tokenized keyed-card charges | Browser tokenizer → Intuit; authorized Worker charge/reconciliation |
| Stripe | Checkout payment links and payment webhooks | Authorized Worker, signed/idempotent webhook |
| Twilio | SMS and future communications | Consent-gated shared send path, signed inbound/status webhooks |
| Resend / email routing | Transactional/marketing email and replies | Suppression/unsubscribe/DND gates and signed webhooks |
| CallRail / Deepgram | Call ingest, recording and transcription | Provider webhook/adapter into canonical CRM data |
| Google | Drive, Calendar, Ads and Maps/autocomplete | OAuth callbacks, scoped tokens and server-side provider calls |
| Meta Ads | Advertising integration | OAuth callback and server-side API |
| Encircle | Restoration/job data import and reconciliation | Server-side adapter and external identity mapping |
| Property Meld | Meld ingestion | Authenticated/signed ingestion path and deduplication |
| APNs / Web Push | Native and web notifications | Device subscriptions, provider credentials and recipient targeting |
| Capgo / Apple | OTA/native build and distribution | CI/provider console, signing and release controls |
| GitHub | Repository automation and MCP owner operations | Scoped token/app permissions and explicit write confirmation |
| AI/report providers | Analysis, transcription and document generation | Server-side requests, bounded inputs, structured outputs and review gates |

Exact active providers and configuration must be confirmed against `functions/`, current environment
bindings and provider consoles.

## Shared integration rules

- Credentials remain in Cloudflare/provider secret storage or service-only database objects. Browser
  bundles, migrations, docs and logs never contain real secrets.
- OAuth callbacks validate state, use exact redirect origins and store tokens only in approved
  service-only locations.
- Webhooks verify provider authenticity before parsing side effects and claim/deduplicate a stable
  provider event ID before acting.
- Outbound requests use the shared timeout helper and classify retryable failures.
- Money and company side effects use stable idempotency keys, durable state and reconciliation.
- Workers enforce employee/role authorization before reading private data or calling providers.
- Provider errors returned to clients are sanitized; operational detail goes to controlled logs.
- Every integration has a disabled/unconfigured state that fails safely and explains the next step.
- Production and Preview variables are both inventoried; origin/redirect/CORS values are tested per
  environment.
- Provider-specific raw payloads are normalized at the adapter boundary so business rules consume
  owned canonical fields.

## Verification expectations

For a changed integration, verify:

1. missing configuration and revoked/expired credentials;
2. allowed and denied caller roles;
3. timeout, 429, 5xx and malformed response behavior;
4. duplicate/replayed webhook or request behavior;
5. provider sandbox success plus local durable state;
6. partial failure and reconciliation/recovery;
7. logging without credentials, card data or unnecessary PII;
8. deployed Preview/Production callback, CORS and secret bindings;
9. updated privacy/App Store/retention disclosures when data flow changes.

## Live Supabase-managed integrations (verified 2026-07-22)

- Ten `pg_cron` jobs were active; nine had successful 30-day history and the newly scheduled real-job
  reconciler had not reached a recorded run.
- Realtime published `conversations`, `messages` and `notifications`.
- `job-files` was public/listable; `message-attachments` was private with no object policies.
- Two Edge Functions were deployed: a JWT-protected retired `notify-test-push` returning 410, and
  an unauthenticated wildcard-CORS `sheets-proxy` forwarding to Google Apps Script.

The Edge Function list is an external runtime surface, not implied by `functions/api/`. A release
inventory must compare deployed function slugs/hashes/auth settings with source reachable from the
release branch. `sheets-proxy` has no source in audited `dev` and must be removed or brought under
normal auth, source control and deployment verification. See
`docs/audit/2026-07/evidence/live-supabase.md`.

## Local and external limits

Vite alone does not run Pages Functions; local Worker verification requires a built site plus
Wrangler. Many privileged paths require Cloudflare-held secrets and are therefore verified on an
authorized deployed environment or provider sandbox. Repository tests/mocks are necessary but do
not prove console configuration, provider approval, DNS/email routing, Apple signing or production
webhook delivery.

Update this file in the same commit when adding/removing a provider, changing data exchanged,
moving credential ownership, changing webhook/auth/idempotency behavior, or altering production
configuration requirements.

## Encircle managed credential rollout

The permanent target is the service-only `integration_credentials` row managed from Connections.
All seven Pages Encircle workers and the separate `upr-mcp` adapter resolve that row first. The
existing `ENCIRCLE_API_KEY` remains a temporary fallback only while the row is absent or explicitly
`fallback`; `disabled` suppresses it. Candidate activation is active-admin-only and validates via a
bounded read-only organization request before storage.

Read-only Cloudflare inspection on 2026-07-23 confirmed the fallback binding name exists in both
Pages Production and Preview and on the deployed `upr-mcp` Worker; no values were read. A read-only
request to `demo-sheet.netlify.app` returned HTTP 200 with the Utah Pros Demo Sheet title, so that
legacy runtime is still publicly deployed. The owner confirmed on 2026-07-23 that it is obsolete and
unsupported. Retire the Netlify deployment and any remaining secret binding separately; it is not a
supported Encircle consumer or a credential-rotation dependency.
