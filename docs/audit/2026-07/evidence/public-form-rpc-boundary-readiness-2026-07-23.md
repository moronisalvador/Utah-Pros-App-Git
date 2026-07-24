<!--
FILE: docs/audit/2026-07/evidence/public-form-rpc-boundary-readiness-2026-07-23.md

WHAT THIS DOES (plain language):
  Records the live catalog and repository evidence for making the privileged public-form writer
  callable only by its service-role Workers.

DEPENDS ON:
  Internal: supabase/migrations/20260723235900_public_form_rpc_boundary.sql,
            supabase/rollbacks/20260723235900_public_form_rpc_boundary.rollback.sql,
            supabase/tests/public_form_rpc_boundary.test.js,
            functions/api/form-submit.js, functions/api/webflow-form-webhook.js
  Data:     reads → live PostgreSQL catalog and migration ledger
            writes → documentation only

NOTES / GOTCHAS:
  - This is pre-apply evidence. The shared-production migration remains unapplied.
  - No form submission, identity, business row, secret, or provider payload was read or changed.
-->

# Public Form RPC Boundary — Pre-Apply Evidence

**Captured:** 2026-07-23 23:58:59 UTC

**Repository base:** `dev` at `bf3b0b9` before this phase commit

**Project:** `glsmljpabrwonfiltiqm` (shared by staging and production)

**Migration:** `20260723235900_public_form_rpc_boundary.sql`

**Apply state:** not applied; no live write authorized or performed

## Live catalog finding

The exact live function is:

`public.upsert_lead_from_form(uuid,text,jsonb,jsonb,boolean,text,text,uuid)`

| Property | Read-only result |
|---|---|
| Overloads | one |
| Security | `SECURITY DEFINER` |
| Search path | `search_path=public` |
| Return type | `inbound_leads` |
| Definition MD5 | `478628b9d18c5c178c0e83b7268b7100` |
| ACL | `PUBLIC`, `postgres`, `anon`, `authenticated`, `service_role` execute |
| Browser-role result | `PUBLIC=true`, `anon=true`, `authenticated=true` |
| Trusted Worker result | `service_role=true` |
| Ledger row `20260723235900` | absent |

The migration changes only the ACL. It does not replace the function body, change the signature or
return type, touch a table, or submit a form.

## Caller inventory

Repository search found two runtime callers:

1. `functions/api/form-submit.js` — public embeddable form endpoint; loads the published schema,
   applies honeypot/minimum-time/rate/optional-Turnstile gates, validates server-side, derives
   consent, then calls the RPC with `functions/lib/supabase.js`.
2. `functions/api/webflow-form-webhook.js` — shared-secret-authenticated Webflow adapter; missing
   server secret configuration now fails closed, and a matching request secret is required before
   it maps into the same form contract and calls the RPC with the service-role client.

No `src/`, hosted-form page, embed script, or other browser caller invokes the RPC directly. The
hosted form posts to `/api/form-submit`.

## Repository contract

- Forward migration revokes `PUBLIC`, `anon`, and `authenticated`, then explicitly grants only
  `service_role`.
- Preflight refuses a missing/overloaded function, signature drift, loss of `SECURITY DEFINER`,
  changed return type/search path, or missing trusted service-role execution.
- Static tests prove the migration is ACL-only and both Workers retain the service-role client.
- Webflow negative tests prove missing configuration, a missing request credential, and a wrong
  secret all deny before any business read/write/RPC or notification. A missing request credential
  causes zero database access; mismatch/missing configuration permits only the exact deny-all
  `integration_config.webflow_webhook_secret` lookup needed to authenticate the request.
- The post-apply SQL reads catalog privileges only and requires all browser paths denied while
  `service_role` remains executable.
- The rollback restores the exact legacy grants but is labelled emergency-only because it re-opens
  the bypass.

## Serialized apply plan

After this migration is committed, reviewed, and reachable from `dev`, a separate owner instruction
must open the exact shared-production apply window:

1. refresh the function signature/body fingerprint, caller inventory, ACL, and migration ledger;
2. verify no competing database apply and no newly deployed direct browser caller;
3. apply `20260723235900_public_form_rpc_boundary.sql`;
4. run `public_form_rpc_boundary_post_apply.sql`;
5. make one controlled public form submission only if separately authorized, then verify the Worker
   path and no duplicate lead/consent event;
6. refresh migration-provenance evidence, advisors, canonical docs, and the registry.

Until that window completes, the live direct RPC bypass remains open and PUB-001 is implementation
ready with an owner/apply gate—not shipped or verified.

## Independent review and verification

- Migration safety checker: **PASS** after reviewing preflight, ACL-only change, frozen signature,
  rollback risk, tests, and apply-window plan.
- Anonymous-grant/secret auditor: **PASS** after the anon drift allowlist, isolated service-role
  integration guard, exact non-owner grantee check, and Webflow fail-closed fixes.
- Worker security review: **PASS** after handler-level denial tests and the minimal
  authentication-secret lookup rule.
- Focused public-boundary tests: 3 primary-tree files passed, one isolated integration suite
  intentionally skipped without an authorized isolated target; 22 passed, 11 skipped at the review
  checkpoint. Subsequent Webflow/boundary focused run: 20 passed.
- Safe unit/Worker lane: 127 files, 1,554 tests passed.
- Production build: passed.
- Migration provenance validation and its 8 fixture tests: passed; the known comment-only
  `set_lead_caller_name` warning remained non-blocking.
- Changed JavaScript lint and `git diff --check`: passed.
