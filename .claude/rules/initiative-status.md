# Initiative Status — Live Coordination State

**Last verified:** 2026-08-05 · This is the ONE always-loaded file recording what is currently in
flight, leased, or unapplied. Full initiative manifests live in `docs/archive/rules/` — they are
history, not law. When an initiative completes, delete its row here; when one starts, add a row
and a roadmap. Do not let this file grow past ~1 page — that is how the last rulebook died.

## Active leases (check before touching a shared hotspot)

### QBO grouped receipt role-check repair — APPLIED to production 2026-08-06; receipts LIVE

**APPLIED under explicit owner authorization ("fix it all", 2026-08-05 conversation, after the
money-path consequence below was named in the diagnosis report)** — production ledger
`20260806034004_qbo_receipt_service_role_check_repair`, from the exact committed file at
`26637a36` (payload-fidelity hook passed). Preflight drift guard confirmed all 8 legacy bodies
before replacement; postconditions confirmed 8 repaired bodies / 0 legacy, the service-role-only
boundary intact, and both `payments` triggers present.

**Two discoveries from the same incident (2026-08-06, behaviorally proven):**
- `QBO_RECEIVE_PAYMENT_ENABLED` is set in Cloudflare **Production** too — the 2026-08-01 "no key
  in Production" readback below is stale. With the enabled db flag, the receipt claim path was live
  on `utahpros.app`, so **every Payment webhook event was silently swallowed** by the broken role
  check (claim → 42501 → worker logs + skips + acks 200). The repair closed that.
- The Intuit webhook delivery itself had separately died 2026-08-03 20:07 UTC (Developer-console
  endpoint found on the Development tab, Production tab empty; Production restored ~2026-08-06
  01:10 UTC; verifier token verified matching by signed probe). Delivery resumption from Intuit was
  still pending as of 03:40 UTC — config propagation.

**First successful production receipt run 2026-08-06 03:40 UTC:** a synthetic Intuit-signed
delivery of real test payment 5998 ($0.75, allowlisted customer 565, fixture invoice 5986) →
`qbo_events` processed → `payments` row + `payment_receipts` row (status `reconciled`) + 4
`payment.received` admin notifications. The grouped receive-payment machinery works end to end.
Owner retest of the split-payment UI (invoices 5985/5986) is now unblocked.

Original diagnosis (2026-08-05, live $2 split-payment attempt on `dev.utahpros.app`):
`worker_runs qbo-receive-payment` → `error` →
`Supabase RPC reserve_qbo_payment_receipt: 403 {"code":"42501","message":"NOT_AUTHORIZED"}`; zero
receipt rows since the foundation applied 2026-07-31.

Cause: all **eight** of its routines gate on the legacy flattened PostgREST GUC
`current_setting('request.jwt.claim.role', true)`, which modern PostgREST does not populate, so the
gate can never pass for any caller. The eighth object is
`public.guard_payment_receipt_link_write()` — the `SECURITY INVOKER` trigger on `payments` that the
original seven-function diagnosis omitted; it fires inside `finalize`/`reconcile` when they insert
receipt-linked projections, so repairing only the seven RPCs would move the same 42501 one layer
down.

Leases `supabase/migrations/20260805010000_qbo_receipt_service_role_check_repair.sql`, its paired
rollback, `tests/qa/unit/qbo-receipt-service-role-check-repair.test.js`, and the role-context
harness in `supabase/tests/qbo_multi_invoice_payment_receipts.test.sql`. It replaces function
**bodies only** — no table, column, index, policy, trigger, grant, flag or row changes; the
`REVOKE ... FROM PUBLIC, anon, authenticated` before `GRANT ... TO service_role` is re-asserted for
all eight because this managed project re-applies `EXECUTE TO PUBLIC` on every replaced function.

**`current_user` is the trap, not the fix** — `get_service_sms_consent_status` uses it safely only
because it is `SECURITY INVOKER`. The chosen predicate is `auth.role() <> 'service_role'`, the idiom
already carrying the applied `20260731210000` QBO invoice command ledger (production ledger
`20260731205942`): `SECURITY DEFINER` functions reached over the identical
`functions/lib/supabase.js` service-role transport that demonstrably succeed while these return
42501.

**Measured, not inferred (2026-08-05).** An isolated disposable local Supabase stack (Postgres 17 +
real PostgREST, service-role JWT over HTTP, non-colliding ports, destroyed afterwards) showed that
inside a `SECURITY DEFINER` function a real service-role call sees `request.jwt.claim.role` = **NULL**,
`current_user` = **postgres** (the owner), `session_user` = `authenticator`, a populated
`request.jwt.claims`, and `auth.role()` = the service role. Three equivalent gates called over
PostgREST: the legacy-GUC gate returned **HTTP 403 42501** — reproducing the exact production
signature — the `auth.role()` gate returned **HTTP 200**, and the `current_user` gate returned
**HTTP 403 42501**, confirming the trap. Supabase defines `auth.role()` as `COALESCE(legacy GUC,
modern claims role)`. All eight replaced definitions were also parse/compile-checked on that
stack.

**The behavioural proof was itself hollow** and is corrected here: the db-lane test called
`set_config('request.jwt.claim.role', …)`, manufacturing the one signal production never sends. It
now sets only `request.jwt.claims` and asserts the legacy name stays empty. **The same hollow-harness
pattern exists in four other `supabase/tests/*.sql` files** (contractor compliance, device-token
APNs topic, native APNs token boundary, appointment-crew hotfix) — not this lease's to fix, but any
service-role gate they claim to prove should be re-read before it is trusted.

Verified: build clean, `npm test` 4,887/4,887 across all three credential-free lanes, eslint 0
findings on the changed file, migration hygiene 0 failures, provenance PASS, `check-l0-bridge`
14/14 (run against the amended `AGENTS.md` §15 in the main checkout, which was still uncommitted).
Reviewers run: `migration-safety-checker`, `anon-grant-auditor`, `worker-security-reviewer`.

**The money path is now LIVE on BOTH origins** (env gate + db flag open on Preview AND Production,
role check repaired). Any admin/office/project_manager can now complete a real grouped QuickBooks
Payment. Roll back only via the paired rollback (a deliberate correctness revert that re-breaks
the feature) or the `feature:qbo_receive_payment` force-disable kill switch.

**Newly reachable defect, NOT fixed here (out of this lease's frozen-signature scope).**
`fail_qbo_payment_receipt_attempt(uuid, text, text, text)` has no payment-id parameter, so if the
provider call succeeds and `mark_qbo_payment_receipt_created` then fails transiently, the attempt row
never records `qbo_payment_id`; a retry sees none and calls `createAllocatedPayment` again, leaving
Intuit's time-bounded `requestid` dedup as the only guard against a second QuickBooks Payment. This
path has never executed, because the role check always threw first. Schedule an additive
`p_qbo_payment_id DEFAULT NULL` before the flow carries real money.

**Remaining gates:** `qa-staging` has NOT received this migration (staging apply still pending);
the owner UI retest of the grouped flow is open (now unblocked); Intuit webhook delivery
resumption is external — the pending deletes of test payments 5997/5998 double as resumption
probes (a `qbo_events` row for their Delete = Intuit is calling again).

### Billing-editor role boundary — APPLIED to production; merged to `dev`; `main` promotion blocked

Owner-directed 2026-08-04: office and project_manager may record payments and do invoicing; moving
money OUT stays admin-only. Leases `src/lib/claimUtils.js` (`BILLING_EDIT_ROLES`, new
`PAYOUT_MANAGE_ROLES`), `src/lib/navItems.jsx`, `src/pages/JobPage.jsx`,
`src/pages/settings/Payments.jsx`, `functions/api/stripe-payout.js`, and the new
`20260804120100_billing_editor_role_boundary` migration/rollback/tests.

**Estimate-create follow-up — APPLIED to production 2026-08-05**, ledger
`20260805031844_estimate_create_rpc_billing_boundary`, under explicit owner authorization, from
the exact committed file at reviewed commit `41b0bf0e`. The payload passed
`block-destructive-sql.sh`'s fidelity check — it refused a first attempt whose header had been
abbreviated, which is exactly the retyped-payload slip that guard exists to catch.

Preflight immediately before (read-only): predicate still widened, neither function guarded, not
already in the ledger, and both live body md5s still `d2235c15…` / `2bc21dbd…` — byte-identical to
what the rollback restores, so nothing drifted between authoring and apply. Postflight: both
`SECURITY DEFINER`, `search_path=public`, signatures unchanged, `anon`=false /
`authenticated`=true / `service_role`=true, both gated, both NULL-safe, neither inlining a role
list, guard before the INSERT in both. Ledger mapped in the provenance manifest with refreshed
evidence; `validate:provenance` PASS at ledger=82.

**Gate CLOSED 2026-08-06:** PR #587 promoted `dev → main` (merge `cc4d225f`), carrying the
estimate-create UI mitigation to `utahpros.app`. This initiative is finished end to end.

Source record:
`20260805020000_estimate_create_rpc_billing_boundary` (+ rollback,
`tests/qa/unit/estimate-create-rpc-billing-boundary.test.js`, and the `billing: true` gate on
NewMenu's **New Estimate**) extends the predicate to `create_estimate_for_contact` and
`create_estimate_for_job` — the two `SECURITY DEFINER` routines this initiative left as follow-up.
They bypass `oop_estimates_billing_write`, so today any authenticated employee can create draft
estimates. It **consumes** `billing_edit_access()` and must never inline a second role list; a
CI test enforces that. Verified read-only before authoring: 0 internal DB callers, 0 non-`admin`
creators on record, Admin Mobile already admin-only. Apply is a separate owner action.

**Behavioural proof EXECUTED and PASSED 2026-08-05** — `npm run test:db:estimate-create-boundary:local`
(`scripts/qa/qualify-estimate-create-boundary-local.mjs`, modelled on the billing-boundary
qualifier). Disposable loopback-only stack: baseline → the **five** real predecessors in ledger
order (the billing-boundary four, plus `20260804120100` itself, which is what widens the predicate
this guard consumes) → migration → proof → rollback → fail-closed check → re-apply → proof again →
teardown. Commit-bound receipt at `0bee3da1`, manifest SHA-256 `c7f826c0…`; the predecessor
`20260804120100` input hashes to `9695e174…`, byte-identical to what is applied in production.

Proven, both passes: both RPCs still accept admin/office/project_manager and return an
`estimates` row (the shipped `NewEstimateModal` contract); **12 refusals** — 2 RPCs × field_tech,
estimator, supervisor, crm_partner, inactive admin, external admin — all `42501`; those 12
refusals left **zero rows behind**, so the guard genuinely precedes the INSERT; an unmapped auth
user is refused; `service_role` still passes; and a **claimless session is refused**, which is the
NULL-safety case. The rollback check confirms it removes the guard, keeps both functions and their
grants intact, and leaves `billing_edit_access()` and the estimates policies it does not own
untouched.

**The guard uses `IS DISTINCT FROM`, not `<>`** — a deliberate one-token divergence from the live
`20260804120100` precedent, in the fail-closed direction. `auth.role()` is NULL outside a PostgREST
request; with `<>` the whole guard expression evaluates to NULL and PL/pgSQL's `IF` treats NULL as
false, silently skipping the check. Confirmed on the live database: `(NULL <> 'service_role') AND
TRUE` returns NULL. `create_invoice_for_job` and `convert_estimate_to_invoice` still carry the `<>`
form in production; correcting those belongs to that applied migration's owner, not here.

`public.billing_edit_access()` is the single predicate for `payments`, `invoices`,
`invoice_line_items`, `estimates`, `estimate_line_items`, `create_invoice_for_job`,
`convert_estimate_to_invoice` and `qbo_attachments`. It **replaces the body of a live function**
(applied 2026-08-03 as ledger `20260803224628`) and **supersedes the applied payments policies from
ledger `20260731225654`** — do not edit those applied files; the successor owns the boundary.

Two opposite defects close together: JobPage showed payment controls the database refused, and
`invoices`/`invoice_line_items` had **no role predicate at all** (every field_tech/estimator/
supervisor could DELETE an invoice via PostgREST, moving A/R through `update_invoice_paid()`). The
always-true `allow_anon_read_invoices` SELECT policy, which exposed invoices to `crm_partner`, is
dropped in the same migration.

Payout authority is deliberately split out and stays admin-only (`PAYOUT_MANAGE_ROLES`):
`/settings/payments` and `functions/api/stripe-payout.js` (Stripe Instant Payout). Never re-point
that worker at `BILLING_EDIT_ROLES`.

**APPLIED to the shared production project 2026-08-05 under explicit owner authorization** —
ledger `20260805014242_billing_editor_role_boundary`, from the exact committed file (SHA-256
`9695e174…`). The payload passed the new `block-destructive-sql.sh` payload-fidelity check, which
is mechanical proof it was byte-equivalent to the reviewed source rather than a retyped copy —
its first real use, and exactly the class of slip it was built for.

Postflight verified live: `billing_edit_access()` anon=false / authenticated=true /
service_role=false (policy-only helper; service_role bypasses RLS); `create_invoice_for_job` and
`convert_estimate_to_invoice` anon=false, authenticated+service_role=true, both gated on the
helper; `invoices` and `invoice_line_items` now carry `*_internal_read` + `*_billing_write` with
`allow_authenticated_*` and the always-true `allow_anon_read_invoices` **gone**; three
`payments_billing_*` policies keep their `receipt_id IS NULL` + `source='manual'` guards;
`qbo_attachments_select` re-pointed at the helper.

Verified before push: build clean, `npm test` 4,871/4,871 across all three credential-free lanes,
eslint changed-files ratchet 0 regressions (3 pre-existing findings on touched files were cleaned,
not baselined — the baseline is "shrink only; never raise"), migration hygiene 0 failures,
`validate:provenance` PASS.

**QuickBooks worker gate widened 2026-08-05 by explicit owner decision.** The close-out gauntlet
found `QBO_BROWSER_ROLES` still `['admin']` while the UI and database lists had widened, so
office/project_manager saw enabled **Save invoice**, **Send to customer** and **Revert to draft**
and got `403` from `POST /api/qbo-invoice`; `/api/qbo-payment` and `/api/qbo-query` shared the
gate. The owner confirmed the 2026-08-04 widening was meant to cover pushing to QuickBooks, not
only writing invoice rows in UPR.

**This deliberately relaxes part of the 2026-07-31 containment** (`fix(qbo): recover invoice
commands safely`), so the scope is tight and the remaining guarantees are unchanged:

- **Widened** (invoicing/payment recording): `qbo-invoice`, `qbo-receive-payment`, `qbo-estimate`,
  `qbo-payment`, `qbo-query`.
- **Still admin-only**, via an explicit `QBO_ADMIN_ROLES` pass-through so a shared-constant change
  cannot leak into them: `quickbooks-connect` (OAuth credential management — `AGENTS.md` §16 treats
  credentials as their own class), `qbo-payments-sync` (operational sync), and `qbo-sync-customer`
  (reached only from Settings → Integrations; the invoice path uses the `ensureQboCustomer` library
  function, not this worker).
- **Unchanged and still proven per-worker:** an **inactive** or **external** employee is refused
  regardless of role, as are `supervisor`, `field_tech` and `crm_partner` — before any business
  read or provider call (`functions/api/qbo-worker-authorization.test.js`, now carrying positive
  allow cases for office and project_manager alongside the deny-list).

Process note worth keeping: the gauntlet's adversarial verifier asserted that **no test pinned**
the admin-only list. That was wrong — `qbo-worker-authorization.test.js` denied both roles by name,
and running the suite is what surfaced it. A reviewer's "nothing pins this" is a hypothesis, not a
finding; the test run is the evidence.

`tests/qa/unit/billing-role-surface-parity.test.js` now pins all four surfaces together: UI list,
database predicate, widened QBO gate, and the admin-only QBO workers — plus payout staying
admin-only and never equal to billing.

**Behavioural proof EXECUTED and PASSED 2026-08-05** — `npm run test:db:billing-boundary:local`
(`scripts/qa/qualify-billing-boundary-local.mjs`, modelled on the invoice-activity qualifier). A
disposable loopback-only stack: baseline → the four real predecessors in ledger order → migration
→ proof → rollback → fail-closed check → re-apply → proof again → teardown. The receipt is
commit-bound with SHA-256 per input; the migration input hashes to `9695e174…`, byte-identical to
what is applied in production.

**Running it found two defects that made it unrunnable**, neither of which any static check or
reviewer had caught in four days:

- It inserted `public.employees.name` — **a column that does not exist** (`full_name` NOT NULL /
  `display_name`). The roadmap had already recorded that exact trap as a defect found in *other*
  code during P2; the proof itself carried it.
- Its fixture assumed a seeded database and raised `no job available for fixture` on a clean clone
  — the only place its own isolation guard permits it to run.

Two things the qualifier had to get right that a naive port would have hidden: `db/baseline/schema.sql`
predates both `payments.receipt_id` and `billing_edit_access()`, so applying the target on the bare
baseline fails — and would otherwise have "proven" the boundary against a schema shape production
has not had since 2026-07-31; and the fail-closed check asserts the rollback genuinely **re-narrows**
(no `office`/`project_manager` left in `billing_edit_access()`, widened write policies gone, neither
invoice-creation RPC still gated on the widened predicate) rather than asking "are the objects gone",
which is the wrong question for a body-and-policy replacement.

**Released to production 2026-08-05** — PR [#584](https://github.com/moronisalvador/Utah-Pros-App-Git/pull/584)
merged to `main` as `f7cffcfb`; CI green, `utahpros.app` boots (200, 404 route correct), and the
deployed `claimUtils` chunk contains `["admin","office","project_manager"]`, confirming the widened
list is live rather than cached.

**Remaining owner gate:** the end-to-end check — an office-role user recording a payment and
sending one real invoice — still requires an office-role **login**, which an agent cannot perform.
The test-customer allowlist permits driving the QBO endpoints but does not substitute for
authenticating as that role. The end-to-end check (an office-role user
recording a payment and sending one invoice) is an owner action: there is no isolated test client,
because dev, Preview and TestFlight all point at this same production project.

**Provenance blocker for `main`.** `qbo_attachments_select`'s pinned `usingMd5` moved from
`a5f249e5148231d3d74eff49dafd2395` to `1b8ea73af76ce5d2159bb2142358ee9c` when this migration
recreated the policy, and four applied ledger rows are now unmapped:
`20260805003912_money_table_anon_grant_closure`, `20260805005619_invoice_activity`,
`20260805013826_conversation_access_default_open` and `20260805014242_billing_editor_role_boundary`.
Committed evidence (`capturedAt 2026-08-04T22:16:04Z`) predates all four, so `validate:provenance`
still passes — staleness only warns, and drift is measured against that stale file.

**The refresh is unblocked.** `claude/upr-thread-notifications-76ac57` landed in `dev` at
`94eb00fd` while this release was being assembled, so
`20260804230000_conversation_access_default_open.sql` now resolves on the release ref and all four
`ledgerMapping.path`s are satisfiable. What remains before `main`: recapture live evidence, add the
four mappings, and repoint the `qbo_attachments_select` pin at
`supabase/migrations/20260804120100_billing_editor_role_boundary.sql` with its new md5. Do **not**
promote by racing the 6-hour freshness window instead — the gate would pass on evidence blind to
four applied migrations, which is the opposite of what it exists to prove.

**RESOLVED 2026-08-05.** The refresh was done as written, not raced. Live evidence recaptured at
`2026-08-05T01:54:44Z` (81 ledger rows). Drift was measured against live before rewriting rather
than assumed: a SQL comparison of all 32 tracked function bodies reported **0 drift**, and of the
8 tracked policies exactly one had moved — `qbo_attachments_select`, `usingMd5`
`a5f249e5…` → `1b8ea73a…`, recreated by `20260804120100_billing_editor_role_boundary.sql` exactly
as this note predicted. All four ledger rows are mapped (`20260805003912`, `20260805005619`,
`20260805013826`, `20260805014242`) and the pin is repointed to that migration.
`invoice_activity`'s mapping targets `b730c9c4`, the commit whose file content is current — the
add-commit `1d750c51` no longer matches, and the checker caught it. `validate:provenance
--strict-freshness` PASSES on `a1566afa`. The three remaining WARNs (raw body differs, semantic
hash matches) are pre-existing.

### Contractor Compliance — production active; identity-safe import pending

Tier 2 plan: `docs/contractor-compliance-roadmap.md`. Cold-session dispatch:
`docs/contractor-compliance-dispatch.md`. Ownership:
`.claude/rules/contractor-compliance-wave-ownership.md`. The lease covers only new
`contractor_compliance_*` and `contractor_w9_provider_*` database/Worker/UI objects plus narrow route/navigation,
automated-email-idempotency, canonical-doc, and context edits. Planning and repository
implementation and the 2026-08-03 owner-authorized rollout are active. Five additive migrations
were behavior-proven on `qa-staging`, then applied to the shared project under production ledgers
`20260803220653`, `20260803220656`, `20260803220659`, `20260803220704`, and
`20260803220711`. Production postflight found 12 forced-RLS tables, zero browser table grants,
zero anonymous target-RPC grants, a private 6 MiB bucket, the active daily cron, and zero missing
FK indexes. PR [#574](https://github.com/moronisalvador/Utah-Pros-App-Git/pull/574) merged green
CI at `7388faad`; PR [#575](https://github.com/moronisalvador/Utah-Pros-App-Git/pull/575) merged
green CI at `b6cb241`. Production feature/reminder switches and `page:contractors` are enabled;
Preview remains dark. Live admin and unauthenticated-negative smokes passed. One synthetic manual
request was delivered once, then its profile was audited, paused, and made inactive; zero reminder
candidates remain. The reviewed Drive folder contains six insurance/waiver PDFs, but no matching
contractor contacts currently exist; do not fabricate phone/email identity to force an import.

*(Released 2026-08-01: the standalone appointment-reminder containment repair landed in `dev`
through PR #571 at merge `9e723f4a` from reviewed head `72cb52e1`. Its exact files and inert
activation gates remain recorded in
[`.claude/rules/appointment-reminder-wave-ownership.md`](appointment-reminder-wave-ownership.md).
The separate five-producer candidate has since merged that exact `dev` baseline without rewriting
history and does not duplicate the reminder migration.)*

*(Released 2026-07-29: the mobile current-origin reconciliation lease over `.claude/**`,
`AGENTS.md`, `CLAUDE.md`, `tooling/**` and the mobile integration seams — owner accepted the
handback. Its work landed in `dev` via PR #525, merged 2026-07-27; the holder branch
`codex/mobile-readiness-current-origin-review` had zero commits not already in `dev` at
acceptance.)*

The 2026-07-31 `dev → main` promotion hold was superseded by the owner's explicit 2026-08-03
instruction to review and promote PR
[#565](https://github.com/moronisalvador/Utah-Pros-App-Git/pull/565) only after the exact reconciled
candidate passes local, database, native/web compatibility, reviewer, and hosted-CI gates. This is
not blanket authorization for hosted SQL, provider traffic, feature/cron activation, or native
distribution. Re-check the exact remote tips and PR head before publication and again before merge.

## Appointment crew save regression — database + compatible callers live in Production

Production's immutable emergency bridge is ledger
`20260804003152_sync_appointment_crew_enum_authorization_hotfix`. The reviewed
successor is live on QA as
`20260804060640_appointment_crew_atomic_save_and_audit_repair` and on
Production as
`20260804061426_appointment_crew_atomic_save_and_audit_repair`. Exact
two-lineage qualification, QA behavior proof, hosted database lanes, and
Production catalog postflight passed at source head
`b62eee896c67d4058e7eeb6383fa698996d831c9`. Lease the appointment crew
RPCs/policies/audit trigger, appointment create/edit callers, and migration
`20260804000910_appointment_crew_atomic_save_and_audit_repair` to the
crew-regression repair through the adoption-gated Phase B and the required PR
#573 forward reconciliation. PR
[#579](https://github.com/moronisalvador/Utah-Pros-App-Git/pull/579) merged the
qualified caller source to `dev` as
`ce30f2242a34f713c5cb9294cc2ce7513d938e15`; exact-SHA `verify`, `db-lane`,
credential-free native preflight, Cloudflare Pages, and the 30-asset
`dev.utahpros.app` boot smoke passed. PR #580's first Production review held the
merge because three full-form callers attached unchanged appointment fields to
crew-only saves. The changed-field/sparse-RPC correction passed 4,738 tests,
build, lint, mobile preflight, migration hygiene, strict provenance, and both
fresh local predecessor lineages at
`72377476dfc462c09ac51807dd442a35b31882cb`, then passed independent security
re-review and exact-head hosted gates at `89c51c3702679841f9c4b7e72880c49239af2401`.
PR
[#580](https://github.com/moronisalvador/Utah-Pros-App-Git/pull/580) merged that
source to `main` as
`01c66128b1eb6346cd6f0d7d198bf2938ca494c1`. Production CI run `30887474018`
and Cloudflare deployment `06389930-8e7d-4dc8-837c-ffd922f1e204` passed; the
Production alias and immutable deployment expose the identical 30-asset
manifest SHA-256
`f26a58edaeee3b98d169cf20b7afc0394f377d036aedd83387104da615b72bdd`,
and both boot/404 smoke checks passed. Do not edit applied
`20260804000042`. Final
policy is any active authenticated internal UPR employee may change crew with
immutable actor/old/new/time history; deny anonymous, unmapped, disabled,
external, and `crm_partner`. Appointment fields/privacy/tasks retain their
separate existing authorization. Rollback is a deliberate crew-write outage
until reapply. Phase A temporarily retains RLS- and trigger-guarded
authenticated appointment/crew table DML for already-installed native clients;
trusted server writes require an explicit active-internal employee actor and
cannot use raw crew DML or appointment insert/delete. The deployed service
appointment metadata compare-and-set remains a Phase-A column-scoped UPDATE
exception. The successor also preserves the live job-merge caller by hardening
`merge_jobs(uuid,uuid)` to active internal admins, retaining its JSON signature
and atomic FK sweep, attributing the merge event, and allowing only that
definer path to reparent appointments; direct authenticated `job_id` updates
remain excluded by column grants. Phase B revocation is separately
adoption-gated. Before the lower-timestamp PR #573 notification migration is
ever applied to Production, reconcile its replacement
`sync_appointment_crew(uuid,jsonb)` body/grants with this successor; the current
PR #573 source would otherwise overwrite employee-attributed audit and restore
service execution of the browser signature.

## Conversation participant scoping — compatibility live on QA + production; enforcement authored

- `20260731040337_conversation_participant_scoping.sql` and
  `20260731040338_conversation_unread_state_compatibility.sql` are applied to isolated
  `qa-staging` as ledgers `20260731143710` and `20260731181046`, and to production as ledgers
  `20260801145727` and `20260801145753`. Their immutable source hashes and catalog checks remain
  recorded evidence. The exact committed
  `20260731213000_conversation_assignment_authority_containment.sql` source (SHA-256
  `0c7b8769f53bbb45fd7d6127b86b88d53c4fc3101d3b7b72e2b6f51bb5c87f51`) is also applied
  to `qa-staging` as ledger `20260801144448` and production as ledger `20260801145825`.
  Post-apply checks on both targets matched all four reviewed function hashes/owners/search
  paths/volatility settings and ACLs and found no appointment/job/claim/crew authority source.
  Fresh read-only evidence on 2026-08-01 found zero pending scheduled rows on both QA and
  production; the sole legacy production row was previously guard-cancelled without reading its
  body or other PII.
- Appointment, job, claim, and crew rows are browser-writable and are **not conversation
  authorization**. The QA/production-applied correction replaces the four independent
  membership/contact paths with privileged role → explicit per-chat override → default technician
  → deny, after exact employee-identity and QA/production lineage preflights.
  `20260731213100_conversation_participant_policy_enforcement.sql` is also authored and unapplied.
  It must follow `31213000`, narrows the three protected table policies in place, and removes every
  authenticated direct write. Both carry recovery-pause rollbacks that seal browser tables/RPCs;
  they never restore the historical broad policies or derived appointment trust.
- Candidate UI/Worker source uses actor-derived unread changes, canonical notification recipients,
  scoped contact/opening paths, per-ID cache revocation, admin per-chat/default controls,
  technician self-leave, sender labels, and 18px mobile message text. Historical disposable proof
  for the superseded `40339` source remains historical; it is not evidence for `31213000/31213100`.
  Earlier corrected participant and scheduled-delivery sources passed on a disposable local
  Supabase clone with fixture transactions rolled back. The exact current source adds the
  authorized-media RPC, explicit-deny queue policies, legacy-claim no-op, and their assertions;
  the governed full database runner, physical-iPhone proof, and supported-native-release evidence
  remain open gates.
- Scheduled-message hardening is authored and unapplied as
  `20260731220000_scheduled_message_delivery_compatibility.sql` then
  `20260731220100_scheduled_message_delivery_enforcement.sql`. Compatibility requires the exact
  `31213100` policy/ACL ledger before it can run, takes the queue lock, and aborts with SQLSTATE
  `55000` if even one legacy pending row remains; it never quarantines or edits those rows.
  Actor-derived creation stores immutable creator, conversation, body/send time, recipient contact,
  and recipient phone provenance. Token-fenced service RPCs recheck the snapshot/current recipient
  plus creator access. The final reservation transaction share-locks the live automated-SMS switch,
  invokes the canonical phone-locked consent authority, accepts only `GLOBAL_OPT_IN`, and leaves no
  provider-attempt link for a disabled switch, DND, explicit opt-out, pending STOP, or any other
  non-global result. Compatibility changes the three legacy scheduled policies to explicit
  deny predicates and closes browser table ACLs; enforcement reasserts both layers. The frozen
  legacy claim remains callable to historical roles only as a side-effect-free `false` no-op.
  Unknown provider outcomes are never automatically resubmitted. Auth, PostgREST, RPC, credential,
  and provider transports are bounded; a reserved scheduled send requires a fresh managed
  credential lookup and cannot use cached/environment fallback after that lookup times out.
- Fresh read-only catalog evidence on 2026-08-01 found zero legacy `pending` scheduled rows on
  production and QA. The sole legacy production row recorded on 2026-07-31 was previously
  guard-cancelled; this verification read only the aggregate and did not inspect body or other
  PII. The zero-row preflight remains mandatory and must fail closed if the aggregate changes.
  The seeded `qa-staging` catalog remains healthy and usable, but
  its `MIGRATIONS_FAILED` badge reflects the real historical ledger/replay gap documented in the
  runbook; it is not evidence that the current catalog is broken and must not be cleared through
  rebase or ad-hoc ledger writes. `40337/40338/31213000` are ledgered for this train; target the
  exact branch ref and keep every later QA apply serialized.
- Exact release order is foundation/correction → compatible web plus supported native adoption →
  `31213100` participant enforcement → aggregate zero-pending gate → `31220000` →
  `31220100`. Hardened callers deploy immediately before the serialized enforcement/scheduled
  window and intentionally fail closed until the RPCs exist. Reverse recovery is
  `31220100 → 31220000 → 31213100 → 31213000 → 40338 → 40337`; every step preserves evidence and
  browser denial. Focused source/Worker tests and migration hygiene pass; the scheduled behavioral
  proof now includes final kill-switch/DND/consent race cases with zero attempt residue. The
  governed full database runner, supported-native adoption, remaining enforcement applies,
  pending-row decision, and signed-device proof remain explicit release gates. Compatible web
  callers are live on `dev` at merge `745de63c` through successful Cloudflare Preview deployment
  `7249c5de-a24d-4ffe-ba86-6a57168aa776`. The compatibility train is live on QA and production.
  No provider call, production-row mutation, production/main deployment, or device claim followed.
  PR #565's subsequent compatibility hardening is authored locally only: neither scheduled-delivery
  migration was applied in its work, and no flag, cron/scheduler, or provider was enabled or
  exercised. Its missing-schema path defers provider-free, and its unapplied reservation source is
  the authoritative final `America/Denver` quiet-hours boundary.

## QBO invoice/conversion recovery hardening — database applied; deployment gates remain

The owner-authorized production apply used the exact reviewed source at commit `3f61e7fa`:

- `20260731180000_qbo_estimate_conversion_concurrency.sql` → production ledger
  `20260731205928_qbo_estimate_conversion_concurrency`;
- `20260731210000_qbo_invoice_command_ledger.sql` → production ledger
  `20260731205942_qbo_invoice_command_ledger`.

The paired rollbacks remain available. GitHub CI's schema `verify` job passed; the governed
`db-lane` job passed. The later raw hosted receipt at `a513af37` is 163 / 375 assertions passed,
0 failed, 212 skipped, and 46 setup errors across 44 files. Assertions are gated at zero; setup
debt is shrink-only at 44 failed files / 90 recursively failed suite nodes. The compatible
Worker/client source is on `dev` but not yet `main`; it preserves one operation id across ambiguous provider and
post-provider-finalization failures, and
`/api/qbo-invoice` requires an active, non-external admin Bearer session rather than the shared QBO
server secret. Cloudflare deployment, authenticated-browser and Intuit provider/webhook evidence
remain owner/external release gates and must not be inferred from repository state.

## Deliberately deferred database sources — not current apply candidates

- `20260727022920_mobile_personal_ownership_boundary.sql` is **RETIRED / DO NOT APPLY**, not a
  deferred apply candidate. Its exact catalog preflight refused on both `qa-staging` and production
  after the focused native-token and preference lineage superseded its assumptions. Any remaining
  Page Access/Web Push hardening must ship as a new later migration that preserves the live
  notification/native-token contracts.
- Undated `tech_feedback.sql` is grandfathered live history superseded by
  `20260702_feedback_media.sql`; it is not pending and must not be reapplied.

A third QBO money-boundary migration is committed on `dev` and now present in the shared production
ledger. Its database rollout flag changed after the initial disabled apply proof:

- `20260731045407_qbo_multi_invoice_payment_receipts.sql`, merged to `dev` as `c41839b1` from
  `codex/qbo-multi-invoice-payments`, adds the disabled, service-only receipt/attempt/event
  foundation for one QBO Payment allocated across several invoices. The foundation is live in the
  shared ledger as `20260731225654_qbo_multi_invoice_payment_receipts`. Managed-default
  `service_role` grant drift found by the post-apply readback is closed by containment revision
  `52a07d9e`, live as `20260731230907_qbo_receipt_service_grant_containment`.
  `payment_receipts` and `payment_receipt_attempts` are service-role SELECT-only;
  `payment_receipt_events` has no direct service-role table privilege; all writes remain behind
  seven service-only RPCs. Staging repeated the full transaction-rolled-back behavior suite after
  containment with zero residue. A fresh production readback at `2026-07-31 23:43:23Z` shows
  `feature:qbo_receive_payment` enabled and not force-disabled, updated through an active internal
  admin employee identity; this supersedes the earlier disabled readback. Cloudflare Pages readback
  at `2026-08-01 00:14:45Z` showed `QBO_RECEIVE_PAYMENT_ENABLED=true` in **Preview** and no key in
  **Production** — **superseded 2026-08-06:** the Production gate is now behaviorally proven OPEN
  (a signed Payment webhook event on `utahpros.app` routed to `claim_qbo_receipt_event`), so both
  origins run the receipt path; see the role-check repair lease above. PR #565
  additionally authors a local-only exact client gate, `VITE_QBO_RECEIVE_PAYMENT_UI_ENABLED=true`;
  it defaults dark and has no hosted value/deployment proof, so it must not be read as grouped UI
  exposure. Receipt/attempt/event and receipt-linked payment counts remain zero, with no
  `qbo-receive-payment` Worker run or QBO event since the database-flag change. This reconciliation
  did not flip either QBO gate, exercise the provider path, create a QBO Payment, or call the
  sandbox. Authenticated end-to-end proof and `main` promotion remain absent.
  Roadmap: `docs/qbo-multi-invoice-payment-receipts-roadmap.md`.

## Applied and reconciled 2026-07-31

The reversible notification producer containment also applied from exact reviewed source:

- `20260731223000_notification_unsafe_producer_containment.sql` → production ledger
  `20260731225855_notification_unsafe_producer_containment`. All three `appointment.*` and both
  `timesheet.change_*` target catalog rows are disabled. The rollback was rehearsed on
  `qa-staging`, then the forward source was reapplied so QA also ends contained. No CallRail,
  provider, consent, message, appointment, or timesheet row/configuration changed. Re-enable only
  after caller-derived producer authorization and negative tests pass.
- Reviewed repair `20260801215912_notification_producer_authorization.sql` is applied to
  `qa-staging` only as hosted ledger
  `20260803182131_notification_producer_authorization`; it remains unapplied to the shared
  Production project. It binds browser actor IDs to `auth.uid()`, closes anonymous appointment access,
  applies locked crew diffs, makes crew identity immutable and active-internal-only, and
  serializes/idempotently retries timesheet decisions. Timesheet audiences and copy are rebuilt
  from locked database rows, time-request reads are requester-or-management scoped, and durable
  occurrence IDs plus atomic service-only bell/Web Push/email/APNs target claims bind every
  delivery to the exact current recipient, endpoint/email or raw iOS token and APNs environment.
  Exact policy/trigger/signature drift checks fail closed. Its recovery rollback is intentionally
  fail-closed, and both files keep the same five flags disabled. The later
  `20260802040935_preserve_notify_emit_event_id.sql` reminder-containment source is now in `dev`
  through PR #571 and composes with this boundary: it preserves producer-supplied IDs for
  non-guarded types, retains UUID plus occurrence-ledger validation for the five guarded types,
  records the exact validated predecessor, and rolls back to that predecessor rather than
  inferring it from retained evidence tables. QA applied that reviewed compatibility source next
  as hosted ledger `20260803182303_preserve_notify_emit_event_id`; neither migration is applied
  to the shared Production project. QA postflight confirms all five producer flags remain false,
  `appointment.reminder` is absent/fail-closed, the named reminder cron is absent, and both new
  private tables are empty with forced RLS and service-only access. The candidate includes the
  reviewed private-crew compatibility correction: non-manager field users cannot edit private
  crew, and unchanged crew skips the locked diff RPC. Prior reconciliation through `origin/dev`
  `8e51aa92`, build, full unit `1582/1582`, Worker `1945/1945`, QA `1037/1037`, focused
  producer/APNs `195/195`, producer/reminder QA `20/20`, private-crew `4/4`, changed-file lint,
  migration hygiene, and diff integrity pass. On 2026-08-02 the new project-scoped, pinned
  Supabase CLI `2.111.0` harness passed the exact train on two fresh loopback-only disposable
  stacks: baseline + synthetic seed; forward `20260801215912` → `20260802040935`; full negative
  authorization/RLS/deduplication/compatibility and lifecycle proofs; atomic current-target tests
  for APNs/Web Push/email; stale/deleted/reassigned target, inactive/external/removed-assignee,
  duplicate, and release/reclaim tests; reverse rollback; rollback lifecycle proof; and clean
  forward reapply. Runtime qualification exposed and fixed an
  information-schema reserved alias, a cross-table trigger field reference, an RLS proof that
  mistook filtered zero-row updates for SQL errors, and a default-privilege leak that had left
  excess `service_role` table rights. Exact ACL postflights now require no PUBLIC/anon/
  authenticated access, forward least-privilege service rights, and rollback SELECT-only evidence
  access. Every config/seed/proof source is now hash-manifested; the selected Docker engine must be
  a verified local socket/pipe; every Docker/Supabase command receives that exact context; and the
  database container label/network identity is checked before schema replacement. Both stacks,
  networks, and workdirs were removed after success. The final runner now refuses dirty runtime
  inputs and emits commit-bound evidence. The clean two-stack rerun passed on the non-rewriting
  reconciliation merge `1cec9b3beddb755d6c8e7a2fd58818c1f5880f10` with 13 pinned inputs and
  manifest SHA-256 `67a764fc77cfd5db77bc7aebe2ec4b8bc257ce21c1784801a4edd221fd73d149`;
  the full Node 22 gates and independent migration/security/release reviews also pass. Separately
  authorized QA qualification then completed with the exact source-to-ledger mapping above:
  catalog/postflight and governed hosted checks retained zero assertion failures, all five flags
  off, and no reminder cron. The hosted suite's 212 skipped assertions plus 46 setup errors across
  44 files / 90 suite nodes remain tracked baseline debt rather than substitutes for the clean
  two-stack behavior proof. Three
  unindexed foreign keys and pre-existing browser-role grants on three RLS/no-policy secret tables
  remain separate P2 cleanup work; neither was introduced by this candidate. Exact-head PR checks,
  merge, shared Production apply/deploy, activation, and device proof remain later gates. No
  deploy, delivery, flag, provider, Production SQL, or device action is implied.
- Separate live incident, read-only diagnosis on 2026-08-01: the reminder migration is recorded as
  production ledger `20260801232759_technician_quiet_time_and_appointment_reminders`, while
  Cloudflare Production remains main `478330d9`. That older Worker does not classify
  `appointment.reminder` as appointment-scoped, so two legitimate crew-specific reminder events
  for one appointment fell through to the four-admin default audience: eight bell rows total,
  four for non-current crew, between 20:59:00 and 21:00:02 America/Denver. Native delivery claims
  corroborate the two events; generic native copy came from the older Worker's missing reminder
  presentation. The five contained producer flags remain disabled and the repository-only producer
  repair was not involved. `appointment.reminder` is currently observed disabled, and fresh
  read-only evidence confirms the `upr_appointment_reminders` cron has zero rows. Production
  ledgers include the participant foundation/correction/authority containment plus reminder ledger
  `20260801232759`; QA contains only the three participant ledgers and does not contain the
  quiet-time/reminder migration. Keep reminders off and unscheduled until the repaired
  audience/presentation Worker is regression-tested with privacy-safe generic APNs copy, the
  now-live caller-bound appointment-crew authorization remains preserved, and the exact Production
  Worker revision is verified. Durable bell/Web Push/email replay claims are also an
  activation prerequisite. Any re-enable or reschedule remains a separate owner action.
- The production org's separate automated-SMS master switch is now
  `automation_settings.sms_sending_enabled=false`; the test org remains false.
  `missed_call_textback_enabled=true` remains configured for the production org but is inert behind
  that master switch. Staff P2P CallRail SMS/MMS does not read this switch and was untouched.

The owner-authorized release applied the exact reviewed committed sources to the shared
project (verbatim file content, per-file drift-guard preflights). Production ledger names
use their apply timestamps:

- `20260730170000_device_token_apns_topic.sql` → `20260731154315_device_token_apns_topic`;
- `20260730214500_pg_net_worker_url_allowlists.sql` →
  `20260731165215_pg_net_worker_url_allowlists`;
- `20260731100000_transcribe_call_cron_allowlist.sql` →
  `20260731174734_transcribe_call_cron_allowlist`; and
- `20260730150000_oop_pricing_builder.sql` → `20260731175328_oop_pricing_builder`;
- `20260726183409_inbound_lead_recording_source_boundary.sql` →
  `20260731225511_inbound_lead_recording_source_boundary`;
- `20260731045407_qbo_multi_invoice_payment_receipts.sql` →
  `20260731225654_qbo_multi_invoice_payment_receipts`; and
- `20260731231000_qbo_receipt_service_grant_containment.sql` →
  `20260731230907_qbo_receipt_service_grant_containment`.

Live postconditions passed: the four OOP private tables are forced-RLS with no browser table
grants, the exact role/flag boundary is enforced server-side, and published revision 1 plus draft
revision 2 each retain the 13-item legacy configuration. `device_tokens.apns_topic` is live with
one default-preserving enrollment RPC and zero raw-token policies/browser grants. Both pg_net
notifiers are allowlisted, fail closed on a blank secret and are service-role-only — the applied
bodies match the reviewed file md5s exactly (07ee1574… / c72e0f7f…). The two transcribe cron jobs
retain their names/schedules/payloads and now call postgres-owned, zero-grant allowlisted wake
functions. The OOP flag itself remains disabled, not force-disabled, and scoped to the existing
preview user; no global activation occurred. **The dev→main promotion gate carried by the
per-token topic migration is CLEARED** — the worker/client code may now reach production, and
all four ledger rows are mapped in the provenance manifest with fresh evidence.

The later additive `20260803192344_oop_quote_to_estimate.sql` **is applied** — production ledger
`20260803224628_oop_quote_to_estimate`, mapped in `scripts/migration-provenance-manifest.json` and
present in the committed evidence ledger tail. (This passage read "authored and unapplied" until
2026-08-04; it was stale, and the `20260804120100_billing_editor_role_boundary` successor depends
on the opposite being true — `public.billing_edit_access()`, `oop_estimates_billing_write` and
`oop_estimate_lines_billing_write` are live, so that migration replaces a helper body rather than
creating one.) The 2026-08-03 owner-directed source slice adds the compatible browser/PWA handoff
plus one bounded admin-only native OOP estimate review/correction route; it does not import broad
Admin Mobile, invoice/payment code, or a native provider-write path. OOP flag activation,
deployment, QuickBooks call, signed native release and TestFlight delivery all remain separate
gates and are not implied by that apply.

Both formerly-pending migrations applied 2026-07-30 under explicit owner authorization:

- `20260729220000_tech_onboarding_state.sql` → live ledger `20260730115220`. Postconditions and an
  independent check passed (RLS enabled+forced, no browser-role table grant, `anon` EXECUTE false on
  both definer RPCs). The first-run tour is live; verified rendering all three screens.
- `20260728000000_sms_consent_opt_out_only.sql` → live ledger `20260730121811`. Its drift guard
  passed before replacement; live body still carries the DND, explicit-opt-out and pending-STOP
  refusals, and the function stays `service_role`-only. Opt-out-only is live for staff 1:1 only.
  Detail + rollback posture: `.claude/rules/sms-consent-model.md` §13.

The owner-only notification diagnostic ledger is also live:
`20260729181049_notification_delivery_diagnostic_claims.sql` → production ledger
`20260729183731`. During the separately authorized typed sweep, the owner reported receiving all
15 event types in the tested PWA/native presentation surfaces. This closes the synthetic
transport/presentation proof for that installed state, not the timing or activation of every real
producer.

## CRM lead value (2026-07-30, owner-directed standalone) — APPLIED

`20260730133000_crm_lead_value_from_claim.sql` → live ledger **`20260730155213`**. Proven on the
`qa-staging` branch first (all 7 behavioural scenarios PASS, including the multi-job sum), then
applied to production with 13 postconditions verified: 6 functions, `anon` EXECUTE false on every
one, both constraints validated, 3 triggers, the invoice trigger watching all 7 decision columns,
Won auto-advance preserved, and `crm_sync_lead_value` still present but unwired.

**The staging run earned its keep:** it caught `crm_backfill_lead_values` granted to `anon` (a
transcription slip in the apply payload, not in the reviewed file) plus two defects in the
behavioural test's fixtures. Apply the reviewed FILE, not a retyped copy.

Staff can type a lead's value by hand, and it
otherwise fills itself from billing: **the SUM of every committed invoice across ALL jobs under the
lead's claim** (88 of 157 claims have more than one job, so multi-job is the normal case).

- **This replaced a feature that was live but dead.** `20260721_crm_lead_value_sync.sql` had been
  applied for nine days and never ran once — 0 `crm_lead_value_synced` events, 0 of 156 leads valued
  — because its trigger was `AFTER INSERT ON invoices` gated on `total > 0`, while every invoice is
  inserted with no total and gets one later by UPDATE. The new trigger's `UPDATE OF` list names every
  column the calculation reads, and a CI test fails if that list and the calculation drift apart.
- **Owner rules:** a draft never counts; sent / QBO-emailed / converted-from-estimate / has-a-payment
  all do. The payment arm carries the rule (71 invoices have a payment vs 9 emailed, 4 from an
  estimate). A human-set value is never overwritten (`inbound_leads.value_source`).
- **Multi-tenant seam:** `claims`/`jobs`/`invoices`/`contacts` carry no `org_id` (only the CRM tables
  do), so the lead is the org anchor and the whole claim→jobs→invoices join lives in ONE function,
  `crm_lead_claim_value()`. Add the tenant predicate there when billing gains `org_id`.
- **Backfill RUN 2026-07-30 under explicit owner authorization**, 30-day window. Result: 12 leads
  attached to a single unambiguous claim (a 13th was already attached by the live trigger), **2 leads
  valued — $15,626.22 and $10,538.19 = $26,164.41** — matching the read-only dry run to the cent.
  0 failures, 0 manual values touched. Both figures independently reconciled against their claims'
  invoices; the $15,626.22 one sums **2 invoices across 2 jobs**, which is the multi-job case this
  feature exists for. Only 2 of 61 board leads valued because 41 have no claim yet — billing lags the
  call, and the triggers pick those up automatically as invoices are sent or paid.
  - Run as service role, because `crm_backfill_lead_values` gates on an active admin **session** and
    `auth.uid()` is NULL outside one (gate verified to fail closed). Scope was identical to that
    function. Attachments are audited as `crm_lead_claim_attached_backfill` — a distinct event type,
    so a backfill attachment is never mistaken for the claim-created trigger's own.
  - **To undo:** `UPDATE inbound_leads SET value = NULL WHERE value_source = 'auto';` and clear
    `claim_id` for the ids in the `crm_lead_claim_attached_backfill` events.
- Superseded `crm_sync_lead_value` is left in place, unreferenced — it is granted to `authenticated`,
  and dropping a live function is the contract removal `database-standard.md` §3 forbids.
- History for the completed CRM wave stays in `docs/archive/rules/crm-wave-ownership.md`; this entry
  is the live record. Delete it once the feature has baked.

## Standing operational state

- **Consent model:** opt-out-only for staff 1:1 service SMS + named typed transactional notices;
  everything automated/bulk/marketing is global-opt-in-only. Authority:
  `.claude/rules/sms-consent-model.md` §13 (a CI contract test reads it; §§12–13 were extracted
  verbatim 2026-07-31 when the completed sms-experience manifest was archived).
- **UPR Dev internal-TestFlight automation:** the repository source adds an isolated `.upr.dev`
  distribution configuration and a dev-only workflow. Every `dev` push runs credential-free tests
  only; each signed archive and each optional internal-TestFlight upload requires a fresh manual
  dispatch. The artifact embeds and verifies its dev origin, source SHA, Push/retirement mode, and
  production APNs contract. A Push-disabled replacement can retire only the OS-verified `.upr.dev`
  app's remembered owner-scoped token. Authorized dry archive run `30732945226` succeeded from exact
  `dev` source `e0a1ec6f` with `publish_to_testflight:false`, proving the `.upr.dev` distribution
  signature/profile and embedded dev-only native contract without an Apple upload or device
  delivery. The internal TestFlight group upload, install, and signed-device matrix remain owner
  gates. Official UPR remains manual/main-only; no Production or Cloudflare variable change is part
  of this slice.
- **Staging database:** Supabase branch `qa-staging` (ref `uizgwvkvzyldystqrcsk`) — **SEEDED
  2026-07-29; schema-usable and CI db lane LIVE, with initial catalog parity but a historical
  migration ledger that is not replay-compatible** (details:
  `docs/database/staging-branch-runbook.md`). It is the only hosted DB agents may write-test
  against. The fixture-password secret is configured, all three signed-in fixture identities were
  rotated, and the raw hosted receipt at `a513af37` is 163 / 375 assertions passed, 0 failed,
  212 skipped, and 46 setup errors across 44 files. Failed assertions are gated at zero; setup debt
  is shrink-only at 44 failed files / 90 suite nodes. Rebase currently fails at historical
  migration `20260312194505_001_phase_conversion_and_costing.sql` because the seeded schema already
  has dependent objects; do not call this migration-ledger parity or repair it with ad-hoc ledger
  writes. Open tail: convert failed setups/skips with minimal non-production reference rows and run
  the local SQL/pgTAP proofs through the still-missing governed local runtime.
- **A2P / live sends / provider webhooks / feature-flag flips:** owner-gated, always.

## Open initiatives (verdicts pending — see `docs/wip-inventory-2026-07.md`)

| Initiative | State | Archived manifest |
|---|---|---|
| **QBO multi-invoice payment receipts** | **COMPLETE 2026-08-06**: repair ledger `20260806034004`; build gate retired (billing roles + `feature:qbo_receive_payment` everywhere); exposure = + New Payment, Collections, InvoiceEditor, AND native More → Receive payment (bounded registry exception, four-module `NATIVE_COLLECTIONS_ALLOWLIST` carve-out); rows carry job number/type/address/loss date; tap-to-fill fills full open balance. All contract-pinned. Owner end-to-end retest open | `docs/qbo-multi-invoice-payment-receipts-roadmap.md` |
| **Phase-scoped conversations** | **DECISION PENDING — owner has not chosen. See below.** | — |
| Messaging transport | Built, activation owner-gated | `docs/archive/rules/messaging-transport-wave-ownership.md` |
| Tech v2 Job Hub H3 cutover | Open, owner-bake-gated | `docs/archive/rules/tech-v2-wave-ownership.md` |
| Omni-inbox I/O/U | Unbuilt (O/U absorbed by sms-experience) | `docs/archive/rules/omni-inbox-wave-ownership.md` |
| Schedule Desktop A/B/C | Unstarted | — |
| UX alignment W1–W5 | Stalled since 2026-07-18; owner may restart from scratch | `docs/archive/rules/ux-alignment-wave-ownership.md` |
| DB foundation P2–P8 | Partially done (P3 tranches shipped) | `docs/archive/rules/db-foundation-wave-ownership.md` |
| App-store readiness F1/A/B/D | Source phases and historical TestFlight/Push matrix complete; current per-token-source second-account proof open; submission deferred behind the field-documentation plan | `docs/archive/rules/app-store-readiness-wave-ownership.md` |
| Agent QA access P2+ | Hosted branch/rotated fixtures live; zero assertion failures, but setup-suite/skip conversions and P2a local runtime remain | `docs/archive/rules/upr-agent-qa-access-ownership.md` |

## Phase-scoped conversations — OPEN QUESTION, no owner decision yet (raised 2026-07-30)

**Do not build any of this until the owner chooses a direction.**

**The problem (owner-stated, real):** one customer thread mixes three phases of the
relationship, and the wrong people see the wrong things. Sales negotiates pricing with a
lead; technicians then text the same customer about mitigation work and can read the sales
history. A customer asking for another quote pings the technician's phone. Months later
Marcelo/owner/Ben handle reconstruction — and mitigation technicians, long since finished,
still get notified about a project that is no longer theirs.

**Owner's proposal:** three phone numbers and three inboxes (sales / mitigation /
reconstruction), with per-inbox access so technicians only reach mitigation. A variant
considered and set aside: group texting, which needs RCS and cannot express the access
rules anyway.

**Counter-argument recorded (so this is not re-derived from zero):**
- Three numbers move the misrouting onto the customer, who cannot know the org chart. They
  save one number and text it forever.
- **STOP becomes legally ambiguous.** Consent keys on the contact's phone
  (`get_service_sms_consent_status`), not on which UPR number was texted. A STOP to the
  sales number either stops everything (so why three?) or is scoped per number, which is
  real TCPA risk at per-message penalties.
- Triples the A2P registration surface, which is already owner-gated and pending.
- Group chat is strictly worse: it puts access control inside the customer's phone, where
  a technician can never be removed from a thread.
- **The `conversations` table already carries `job_phase_context`, `job_id`, `assigned_to`
  and a per-conversation `twilio_number`** — phase-scoped threads with phase-derived access
  and notification audience are mostly a finishing job, not a rewrite. Notification audience
  by phase mirrors what `appointment_crew` already does for appointment Push.
- Inbound routing is the genuinely hard part either way (which thread does a reply join?),
  and needs a staff "move to…" control regardless of how many numbers exist — which is the
  argument that the extra numbers buy little.
- A second number **is** defensible for marketing-vs-service (different compliance class,
  different carrier treatment), but not for mitigation-vs-reconstruction, which is the same
  compliance class and the same project.

**Status:** the owner has heard the counter-argument and has NOT decided. When they do, this
is `/masterplan` work — it touches consent, notification audience, RLS and the inbox UI.
Fuller narrative: `docs/handoff/session-state-2026-07-30.md`.
