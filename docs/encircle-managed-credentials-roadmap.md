<!--
FILE: docs/encircle-managed-credentials-roadmap.md

WHAT THIS DOES (plain language):
  Records the evidence, rollout order, safety decisions, and remaining gates for moving Encircle's
  company key into UPR's owner-managed Connections page without interrupting technicians.

DEPENDS ON:
  Internal: CLAUDE.md, AGENTS.md, ENCIRCLE_API_REFERENCE.md, docs/integrations.md,
            docs/auth-and-authorization.md, docs/testing-and-deployment.md
  Data:     reads → repository and read-only platform evidence
            writes → documentation only

NOTES / GOTCHAS:
  - The existing Encircle key must not be rotated or revoked until every surviving runtime is proven.
  - The shared Supabase migration in this plan is authored but not applied.
-->

# Encircle Managed Integration and Safe Credential Rotation

Status: implementation authored locally; migration, deployments, flag changes, candidate entry, and
old-key rotation/revocation are not performed.

Owner decision: build and verify the permanent owner/admin interface first. Keep the existing
Encircle token as a temporary zero-downtime fallback and rotate through the completed system.

## Evidence snapshot — 2026-07-23

| Capability | Verdict | Evidence |
|---|---|---|
| Locked secret store | HAVE | Live `integration_credentials` has RLS enabled and zero policies; no token values were read. |
| Existing admin write/status pattern | HAVE | P9 RPCs and Connections cards manage Stripe/Twilio/Resend write-only. |
| Pages Encircle consumers | PARTIAL | Seven workers used `ENCIRCLE_API_KEY` directly before this initiative. |
| Technician Scope Sheet | HAVE | Search, room lookup, note upload, PDF/email fan-out, autosave and snapshot schemas already work through Pages Functions. |
| Managed Encircle row/lifecycle | MISSING | No Encircle row, active/disabled state, or verification timestamps existed live. |
| Candidate validation | MISSING | No pre-activation provider check existed. |
| Pages/MCP shared managed source | MISSING | Pages and `upr-mcp` held separate environment-secret bindings. |
| Production + Preview fallback | HAVE, externally verified | Cloudflare Pages project `utah-pros-app-git` lists `ENCIRCLE_API_KEY` in both Production and Preview. Values were not read. |
| `upr-mcp` fallback | HAVE, externally verified | Deployed Worker `upr-mcp` lists an `ENCIRCLE_API_KEY` secret binding. Value was not read. |
| Legacy Netlify deployment | RETIRE | A read-only request returned HTTP 200, but the owner confirmed on 2026-07-23 that this deployment is obsolete and unsupported. Remove it and any remaining secret binding as a separate cleanup action. |

Live database facts were recaptured read-only. `integration_credentials` had no Encircle row; the P9
status/write functions still covered only Stripe/Twilio/Resend. Table privileges were broad even
though zero-policy RLS blocked ordinary rows; the authored migration revokes unnecessary browser
table privileges as defense in depth.

## Consumer and workflow inventory

Pages consumers:

- `encircle-search`, `encircle-rooms`, `encircle-upload` — technician Scope Sheet claim/room/note work.
- `encircle-import` — selective desktop import and CLM write-back.
- `encircle-backfill` — historical preview/import/repair.
- `sync-claim-to-encircle` — idempotent UPR claim creation/linking.
- `sync-encircle` — recent-claim import.

Separate runtime:

- `upr-mcp/src/encircle.js` — owner-only read/write tools behind OAuth, owner allowlist, previews and
  confirmation.

Technician paths are deliberately unchanged. The credential seam moves behind their existing worker
contracts, so no Scope Sheet state, route, payload or response shape changes.

## Design decisions

1. `integration_credentials` remains the one managed source. Encircle adds lifecycle states:
   `fallback`, `active`, and `disabled`.
2. `fallback` uses the existing environment binding. `active` uses only the validated database key.
   `disabled` explicitly suppresses fallback.
3. A candidate is sent once to an active-admin Pages Function, checked with read-only
   `GET /v1/organizations?limit=1`, and stored only after success.
4. Browser status contains booleans, lifecycle state, organization label, and verification
   timestamps—never the key.
5. Encircle resolution is intentionally uncached. An emergency disable must affect the next request
   in every warm isolate.
6. The rollout flag is fail-closed in both UI and Worker. Missing flag row means OFF.
7. Pages and `upr-mcp` use the same database row and the same state precedence. Their code is
   duplicated only at the separate-runtime adapter boundary and covered by parity tests.

## Rollout order

1. Deploy compatible resolver code while no Encircle row exists; every consumer continues using the
   current environment key.
2. After reviewed source is reachable from the release branch, apply
   `20260723_encircle_managed_credentials.sql` in an approved low-traffic window. It creates an inert
   `fallback` row and default-OFF flag; no credential changes.
3. Deploy the updated standalone `upr-mcp` Worker. Verify it still reads through fallback.
4. Set only the owner's `dev_only_user_id` on the flag. Do not globally enable it.
5. Browser-check Connections at desktop and 390px, including missing/error/status states.
6. Browser-check the technician Scope Sheet search, room import, autosave, and submit seams without
   changing its payload contract.
7. Owner enters the candidate through the UI. A failed check must leave fallback untouched; a
   successful check atomically activates the managed key.
8. Smoke Pages Preview, Pages Production, and `upr-mcp`; observe sanitized errors and verification
   timestamps.
9. Retire the obsolete Netlify deployment and remove any remaining secret binding. Do not migrate
   or preserve it as a supported Encircle consumer.
10. Only with separate owner approval: revoke the old Encircle token, verify old-key rejection and
    managed-key success, then remove fallback bindings in a later cleanup release.

## Hard stops and owner input

No design decision currently blocks safe repository implementation.

Owner/external input is required before:

- applying the shared production migration;
- choosing the dev-only owner employee for the flag;
- entering a candidate credential;
- deploying Pages or `upr-mcp`;
- retiring the owner-confirmed obsolete Netlify deployment and any remaining secret binding;
- rotating/revoking the provider key or removing any fallback binding.

## Acceptance criteria

- Active admin succeeds; missing session, inactive admin, and wrong role fail before provider access.
- Failed validation never writes the candidate.
- Managed active beats environment; fallback remains zero-downtime; disabled suppresses fallback.
- Pages and MCP resolver parity is tested; Encircle bypasses cache.
- Status and responses never echo the secret.
- Existing technician worker response contracts remain unchanged.
- Manual import is limited to active admin/office/project-manager employees; backfill and legacy
  bulk sync repeat the owner-only Dev Tools gate. Automatic new-claim sync and Scope Sheet
  Encircle calls retain active field-technician access.
- Migration stays additive/dark, has rollback instructions, and is not applied by this implementation.
- The apply-window RPC contract test requires short-lived admin and non-admin access tokens; these
  are owner-provided verification inputs, not repository credentials.
- Build, tests, changed-file lint, reviewer checks, and browser verification are recorded honestly.
