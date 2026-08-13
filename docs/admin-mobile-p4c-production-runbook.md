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
**Status:** D1 is live on `dev` and `main`; D2 is reconstructed but unpublished and unapplied; no
P4c migration is applied.

## Release facts

- Verified Git topology: `origin/dev = 2dbfeadd`; PR #625 merged that D1 head to `main` as
  `eabc817d`.
- Separately recorded UPR MCP Worker revision: `a3a7f90b-c4a1-4c62-abb7-2deaafdeb2db`.
- The last operator-verified shared-production `qbo_provider_traffic_enabled` value was exact text
  `'true'`; re-read it before the D2 window.
- D1 is schema-free. It preserves existing invoice and receipt behavior on the current database,
  introduces the fail-closed provider-maintenance boundary, and temporarily source-disables
  estimate-to-QuickBooks save/update/send/delete. Local estimate editing remains available.
- D1 does **not** contain `feature:qbo_document_command_v2`, P4c command/binding-generation
  behavior, or dependencies on the six P4c migrations.
- The former final candidate topology is superseded. D2 has been reconstructed from released D1/current
  `main`, but is unpublished; do not promote obsolete topology directly.

## D1: foundation and containment

1. Local tests, source-contract proof, lint/build, review, provenance, and dev/main promotion passed
   for the D1 release above.
2. The last recorded provider-traffic value was exact `'true'`. Missing or non-exact values remain
   fail-closed; a fresh readback precedes D2.
3. Verified Preview and Production Pages plus the separately deployed UPR MCP revision;
   confirm the UI exposes no contained attachment/card/externally-managed-payment-delete/Xactimate-import/Stripe mutation control,
   that attachment metadata and prior Xactimate recaps are read-only, and
   no provider or money canary was run or is authorized by this runbook.

## D2: application and schema

1. The D2 candidate has been reconstructed on D1/current `main`, restoring only durable invoice/estimate
   document paths. Keep
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

The six migrations and strict capability remain unapplied/absent; D2 has not been pushed or deployed.
D1 containment remains for Stripe, attachments, card charges, payment-delete, and Xactimate.
Each configuration mutation, push, deployment, merge, migration apply/rollback, provider request,
and money action is a separate production action. This runbook records ordering and evidence; it is
not authorization for the pending D2 actions.
