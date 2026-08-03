# Contractor Compliance — Active Ownership Manifest

**Last verified:** 2026-08-03
**Status:** repository planning and implementation authorized; no live/publication action authorized
**Plan:** `docs/contractor-compliance-roadmap.md`
**Dispatch:** `docs/contractor-compliance-dispatch.md`

## Lease

The active Contractor Compliance implementation owns only the new prefixed schema, Workers, pages,
components, tests, and the narrow shared integration edits named below. The lease ends at owner
handback or when the initiative row is removed from `initiative-status.md`.

Other sessions must not edit the owned new files or the reserved compliance blocks in shared files
without explicit coordination. This lease does not reserve unrelated behavior in a shared file.

## Planned owned files and objects

- `docs/contractor-compliance-{roadmap,dispatch}.md`;
- `.claude/rules/contractor-compliance-wave-ownership.md`;
- new `supabase/migrations/*contractor_compliance*` and paired rollback;
- new `supabase/tests/*contractor_compliance*` and
  `tests/qa/unit/*contractor-compliance*`;
- `public.contractor_compliance_*` tables/functions/indexes/policies;
- `public.contractor_w9_provider_*` tables/functions/indexes/policies;
- private Storage bucket `contractor-compliance-private` and its object-access posture;
- new `functions/api/contractor-*` and `functions/lib/contractor-*` files/tests;
- new `src/pages/Contractor*`, `src/components/contractor-compliance/**`,
  and route-lazy compliance stylesheet/tests.

## Narrow shared seams

Edits must remain minimal and preserve all existing contracts:

- `src/App.jsx`;
- `src/contexts/AuthContext.jsx` only for the additive `page:contractors`
  missing-row fail-closed classification;
- `src/routes/buildTargetPages.web.jsx`;
- `src/lib/navItems.jsx`, `src/lib/navKeys.js`;
- `src/components/ui/statusTone.js` only if compliance statuses need shared classification;
- `public/_redirects`;
- `functions/lib/automated-send.js` only for additive provider-idempotency forwarding;
- `functions/lib/supabase.js` only if an existing bounded Storage helper cannot serve the exact
  contractor path;
- canonical documents and `UPR-Web-Context.md`;
- `.claude/rules/initiative-status.md`.

`src/index.css` is not leased. Prefer a route-lazy, component-scoped compliance stylesheet because
the global source budget is near its blocking ceiling.

## Frozen and forbidden areas

- no changes to legacy `contacts.w9_on_file` or `contacts.coi_expiration` write behavior;
- no reuse, revival, drop, or rename of `vendors`, `vendor_invoices`, or `document_requests`;
- no use of `job-files` or `message-attachments` for compliance;
- no CRM route/flag coupling;
- no SMS producer, adapter, template, consent exception, or provider change;
- no scheduling/payment hard block;
- no migration apply, hosted test write, bucket/provider/config mutation, deploy, import, commit,
  push, or PR without fresh owner authorization.

## Shared-seam dependencies and integration order

1. Freeze role/status/RPC/Worker response contracts.
2. Author and review migration/rollback/tests.
3. Add internal Workers.
4. Add public upload and reminder Workers.
5. Add routes/navigation/UI.
6. Add named insurance audit roster/evidence materialization and workspace.
7. Add annual W-9 checklist and QuickBooks/Gusto provider-handoff metadata only.
8. Update canonical docs and run reviewers.

No lane may assume a later lane is deployed or a migration is applied. All source must fail closed
when its schema, feature flag, reminder binding, or provider configuration is absent.

## Collision and stop rules

- Fetch `origin` and compare the exact shared-file diff before every integration batch.
- If another active lease appears for a shared seam, stop and coordinate.
- Do not rewrite or reformat shared files outside the minimum block.
- Do not modify unapplied migrations from another initiative.
- Do not hand-edit generated adapters or generated schema reports.
- A public grant, W-9 projection to PM/field, direct browser Storage access, or send outside
  `sendAutomatedMessage()` is a hard stop.

## Close-out and handback

Run the reviewer/verification contract in the roadmap and dispatch. Handback reports exact changed
files, repository proof, unapplied migrations, external gates, and working-tree state. Remove this
active lease only after implementation is either integrated/handed back or deliberately retired.
