<!--
FILE: docs/admin-mobile-p4c-production-runbook.md

WHAT THIS DOES (plain language):
  Records the safe two-stage release of Admin Mobile P4c without confusing local source with live
  configuration, deployment, migration, provider, or money evidence.

DEPENDS ON:
  Internal: docs/admin-mobile-roadmap.md, UPR-Web-Context.md, BILLING-CONTEXT.md,
            UPR-QBO-SYNC-PROTOCOL.md, docs/testing-and-deployment.md
  Data:     reads → release topology, configuration and migration evidence recorded by operators
            writes → none by itself

NOTES / GOTCHAS:
  - This document authorizes nothing. Every Git, configuration, deployment, provider and database
    action still needs the owner authority described below.
  - Repository source is not live evidence; every rollout phase records its own readback.
-->

# Admin Mobile P4c Production Runbook

**Last verified:** 2026-08-13
**Status:** D2 is live on Production `main` at
`68b153957db43b28ae6695a40926779a199ac680`. All six P4c migrations applied and passed postflight;
the strict document capability and provider-traffic gate are exact-on.

## Release facts

- Historical D1 topology was `origin/dev = 2dbfeadd` and `main = eabc817d`; it is superseded by the
  D2 Production merge above.
- The reopening readback found one binding/credential, zero active queues, and no recent QBO errors.
- `feature:qbo_document_command_v2` and `qbo_provider_traffic_enabled` are exact-on.
- D1 is schema-free. It preserves existing invoice and receipt behavior on the current database,
  introduces the fail-closed provider-maintenance boundary, and temporarily source-disables
  estimate-to-QuickBooks save/update/send/delete. Local estimate editing remains available.
- D1 does **not** contain `feature:qbo_document_command_v2`, P4c command/binding-generation
  behavior, or dependencies on the six P4c migrations.
- Signed-in Production UI reload verified estimate **Update QuickBooks** and **Resend**, and invoice
  **Save invoice**, are enabled. No provider mutation canary was run.

## D1: foundation and containment

1. Local tests, source-contract proof, lint/build, review, provenance, and dev/main promotion passed
   for the D1 release above.
2. The last recorded provider-traffic value was exact `'true'`. Missing or non-exact values remain
   fail-closed; a fresh readback precedes D2.
3. Verified Preview and Production Pages plus the separately deployed UPR MCP revision;
   confirm the UI exposes no contained attachment/card/externally-managed-payment-delete/Xactimate-import/Stripe mutation control,
   that attachment metadata and prior Xactimate recaps are read-only, and
   no provider or money canary was run or is authorized by this runbook.

## D2: application and schema — completed

1. D2 restored only durable invoice/estimate document paths in Production `main`
   `68b153957db43b28ae6695a40926779a199ac680`.
2. Gate/ledger, active-work, worker-residue, deployment, and postflight checks passed before reopening.
3. The global provider gate was reopened only after the quiet-window checks.
4. These six committed migrations applied and passed postflight:
   `20260810010000_invoice_line_edit_lock_boundary`,
   `20260810020000_qbo_invoice_command_reservation`,
   `20260810030000_qbo_payment_allocation_lock_fence`,
   `20260810182847_invoice_document_line_operations`,
   `20260810182855_estimate_qbo_command_boundary`, and
   `20260810182905_qbo_single_company_binding`.
5. The strict document capability was enabled after postflight, then provider traffic was reopened.
   No provider mutation canary was run.

Reopening observed one binding/credential, zero active queues, and no recent QBO errors. A signed-in
Production reload verified estimate Update QuickBooks/Resend and invoice Save invoice. D1 containment
remains for Stripe, attachments, card charges, payment-delete, and Xactimate. This completed runbook
does not authorize future configuration, rollback, provider, or money actions.
