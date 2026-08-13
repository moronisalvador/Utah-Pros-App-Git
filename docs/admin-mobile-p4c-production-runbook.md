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

**Last verified:** 2026-08-12
**Status:** D1 local and unpushed; D2 must be reconstructed; no P4c migration is applied.

## Release facts

- Last fetched topology: `origin/dev == origin/main == 1a3d8d11`.
- D1 is the local clean branch `codex/admin-mobile-p4c-foundation-release`.
- D1 is schema-free. It preserves existing invoice and receipt behavior on the current database,
  introduces the fail-closed provider-maintenance boundary, and temporarily source-disables
  estimate-to-QuickBooks save/update/send/delete. Local estimate editing remains available.
- D1 does **not** contain `feature:qbo_document_command_v2`, P4c command/binding-generation
  behavior, or dependencies on the six P4c migrations.
- The former final candidate was stale. Reconstruct D2 from released D1/current `main`; do not
  promote stale topology directly.

## D1: foundation and containment

1. Finish local tests, source-contract proof, lint/build, review, and fresh provenance.
2. Seed/read back only `integration_config.qbo_provider_traffic_enabled = 'true'` under explicit
   configuration authority. Missing or non-exact values must remain fail-closed.
3. Publish D1 to `dev`, verify exact Preview Pages and separately deployed UPR MCP revisions,
   confirm the UI exposes no contained attachment/card/externally-managed-payment-delete/Xactimate-import/Stripe mutation control,
   that attachment metadata and prior Xactimate recaps are read-only, and
   prove a safe closed-gate refusal before restoring the exact true value. No provider or money
   canary is required or authorized by this runbook.
4. Promote the reviewed `dev → main` release and verify exact Production Pages/MCP revisions.

## D2: application and schema

1. Reconstruct the final P4c application candidate on D1/current `main`, restoring estimate
   provider actions only through the durable command boundary. Keep
   `feature:qbo_document_command_v2` missing or disabled through Preview and Production deployment.
2. Before the window, re-read migration ledger/catalog, global gate, active command/receipt work,
   worker error/residue, and deployment identities. Any active/unknown outcome stops the window.
3. Close the global provider gate, observe a quiet interval, deploy D2 while closed, and verify
   Pages/MCP exact revisions.
4. Apply, postflight, and record these six committed migrations one at a time:
   `20260810010000_invoice_line_edit_lock_boundary`,
   `20260810020000_qbo_invoice_command_reservation`,
   `20260810030000_qbo_payment_allocation_lock_fence`,
   `20260810182847_invoice_document_line_operations`,
   `20260810182855_estimate_qbo_command_boundary`, and
   `20260810182905_qbo_single_company_binding`.
5. Enable the strict document capability only after all postflights succeed, then reopen the global
   traffic gate. Do not run a provider/money canary without separate authorization.

Each configuration mutation, push, deployment, merge, migration apply/rollback, provider request,
and money action is a separate production action. This runbook records ordering and evidence; it is
not proof that any live action occurred.
