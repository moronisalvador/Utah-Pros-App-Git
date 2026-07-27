<!--
FILE: docs/audit/2026-07/evidence/mobile-readiness-s1h-personal-ownership-2026-07-26.md

WHAT THIS DOES (plain language):
  Records the source-only S1h identity, personal preference, Web Push subscription, and native
  device-token authorization patch, sanitized live catalog metadata, credential-free static
  evidence, exploratory modeled behavior, and every production gate that remains open.

DEPENDS ON:
  Internal: S1h migration/rollback/tests/runbook, permission-write dependency, R0-S1g evidence,
            canonical mobile/security documents
  Data:     reads → repository and database catalog metadata only
            writes → documentation only

NOTES / GOTCHAS:
  - No employee, preference, subscription, token, notification, customer, configuration, provider,
    or secret value was selected.
  - The migration is authored only and is not live.
  - The branch is intentionally mid-merge until a user explicitly authorizes the merge commit.
-->

# Mobile readiness S1h — personal ownership boundary

> Historical-evidence notice: the 2026-07-26 body below records the rejected
> `20260726223610` artifact and must not be read as current source or project law.

## 2026-07-27 source-remediation addendum

The rejected artifact was removed from the migration path and retained only as evidence under
`docs/audit/2026-07/evidence/rejected-sql/`. Revised source separates the boundary into:

1. additive selector-free identity RPCs at `20260726180000`;
2. schema-last employee authority containment at `20260726182000`, after compatible clients deploy;
3. page-access body-provenance reconciliation at `20260727020000`; and
4. personal ownership at `20260727022920`.

Containment removes browser employee self-binding/promotion. The personal migration makes all four
personal/device tables forced-RLS, policy-free and browser-RPC-only; authenticated Web/native token
conflicts are same-owner refresh only and reject cross-owner rebind/delete. The selector-free
`AuthContext` and account/device cleanup source passed independent review, and the zero-admission
offline boundary passed a separate independent review with no P0/P1.

The final review worktree has `HEAD=origin/dev` at `4583f0a65bb7a2ccd99fe0a14c5a3fa47ce414d4`
and `MERGE_HEAD=e2b7585fd0c168f831570c3f15e377e7fef30baa`, preserving both histories without a
commit or rewrite. The four revised migrations remain absent from the live ledger. The exact
checked-in forward/catalog/isolated/rollback sequence has not run in a retained governed local
database, so S1h remains source-hardened, unapplied, not database-behavior-verified, and not
`ready_for_apply`. See `docs/mobile/s1h-database-apply-runbook.md`.

**Catalog capture:** 2026-07-26 UTC
**Evidence assembled:** 2026-07-26 23:48 UTC
**Ledger refreshed read-only:** 2026-07-27 00:08 UTC
**Branch:** `codex/mobile-readiness-s1h-identity-device-preferences`
**Source base:** `f6554ad45d1b75b3677915966654bd1ec74bb005`
**Resolved merge parent pending authorization:** `e9bf8f2fc2d51dae2efe8196837cb1b797723f32`
**Current fetched origin/dev:** `2a763a83b8ff62b712ab0c2532fd0966eaa3ecd7`
**Migration:** `20260726223610_mobile_personal_ownership_boundary.sql` — not applied
**Classification:** **independent security review blocked; do not apply**. Source is authored and
credential-free statically checked, but exact database behavior, integration, and apply readiness
are not claimed.

## Result

S1h authors an intended database authorization boundary while preserving the deployed function
identities and successful authorized response contracts:

- `get_employee_page_access(uuid)` becomes own-active-internal, active-internal-admin foreign, or
  service-role access;
- effective/my notification preferences and personal preference writes become own-active-internal
  or service-role access;
- Web Push list/upsert/delete reconstruct the active internal employee from `auth.uid()`, expose
  only the existing redacted subscription-list shape, and retain endpoint possession-based
  transfer to the verified current employee;
- native token upsert validates the caller-selected employee against the active internal session,
  but its conflict path still mutates a foreign-owned token; delete alone is owner-scoped. That
  cross-owner transfer is a rejected takeover path, not an accepted ownership boundary;
- `employee_page_access`, `notification_prefs`, and `push_subscriptions` become forced-RLS,
  browser-RPC-only tables with no policies;
- authenticated `device_tokens` access becomes SELECT-only and its policy becomes active-internal
  own-or-active-internal-admin/project-manager; and
- authenticated production bootstrap now resolves the employee by `auth_user_id`, requires an
  active mapping, keeps the existing `crm_partner` carve-out, and fails closed if internal
  page-access verification fails; the local-only anonymous `devLogin` uses role permissions with
  an empty override map.

Independent review found that the authored SQL does **not** yet establish that intended boundary.
The current shared database still has the captured foreign-selector, broad table-grant/policy,
inactive/external registration, and arbitrary-token behavior. The authored migration must not be
applied until the blockers below are remediated and independently re-reviewed.

## Independent security review — changes required

Read-only review of the current source and already-sanitized live evidence found:

1. **P0 — employee identity authority is browser-writable.** S1h and the permission-write helper
   trust `employees.auth_user_id`, `is_active`, `is_external`, and `role`, while current evidence
   records all seven authenticated table privileges plus
   `allow_authenticated_employees FOR ALL USING/WITH CHECK (true)`. A normal authenticated caller
   can therefore manufacture the identity/role accepted by the new helpers. The S1h preflight
   currently accepts that unsafe dependency instead of refusing it.
2. **P1 — native token takeover.** The authored policy exposes raw tokens to authenticated
   admin/project-manager users, while `upsert_device_token` transfers any matching token to the
   supplied current employee on conflict. A caller can read another employee's token, supply their
   own employee ID, and claim/delete the victim token. No browser caller requires raw SELECT;
   `send-push` uses service role.
3. **P1 — production bootstrap failed open.** The prior client matched employees by mutable email
   and converted page-access denial/error into an empty override map. Local source now binds by
   `auth_user_id`, requires an active mapping, keeps only the existing `crm_partner` external
   carve-out, delays publishing the employee until internal page access succeeds, and clears
   authorization state on failure. Its executable helper and focused/full local checks pass; it
   still requires post-origin reconciliation reruns and independent integration review.
4. **P2 — dark DB-lane accounting was incomplete.** The counter previously ignored guarded
   `.test.sql` entrypoints and falsely lowered the baseline. Local source now counts both
   `.test.js` and `.test.sql`; exact DB behavior remains dark until a governed target runs it.

Disposition: **changes required**. The current migration, catalog checks, behavior matrix,
rollback, and hashes are rejected-review provenance only. After DB-1 releases, remediation must
close browser writes to the employee authority source, remove raw browser token enumeration,
deny the two exploit paths in exact SQL tests, and pass another independent review. No additional
customer/business-row inspection was needed for this finding.

## Git and drift record

The isolated worktree started from the reviewed S1g apply-runbook tip
`f6554ad45d1b75b3677915966654bd1ec74bb005`. Current `origin/dev` introduced the shared agent/tooling
governance rewrite. Its source through `e9bf8f2` was normally merged without rebasing or rewriting
the mobile chain; all conflicts were resolved by retaining both the neutral governance contracts
and the bounded mobile program. The resulting merge remains staged with `MERGE_HEAD=e9bf8f2`
because the current repository law requires separate explicit authorization before creating a
commit.

After that fetch, `origin/dev` advanced through `d5396a1`, `12dcac2`, `2f9b61b`, and then
`2a763a8`. The
complete post-merge-parent drift adds the shared-law bridge check, agent-alignment/lease
documentation, Encircle credential validation fix/tests, refresh-error handling in three list
pages, main-push/instruction-load hooks, CallRail SMS length enforcement corrections, and their
tests/reference updates. It does not change an S1h migration/test artifact or the reviewed
permission-write migration, but it changes shared governance/settings paths already present in the
resolved merge. No result commit exists yet. After commit authorization, the current resolved
merge must be completed and `2a763a8` merged
normally in a second no-rewrite step. S1h source remains unstaged/untracked above the staged merge;
`stash@{0}` remains a safety copy.

The new ownership register also records an active DB-1 lease over `employee_page_access`,
`notification_types`, `notification_role_defaults`, the permission-write functions/helper, and
the notification-control functions. S1h was authored before that register reached this worktree
and builds on the exact already-reviewed dependency source, but its migration touches
`employee_page_access`. No further overlapping migration edit, S1h integration, or S1i
notification-administration authoring may proceed until DB-1 explicitly hands off/releases the
lease or the owner resolves the collision.

The resolved governance merge was checked before S1h documentation:

- `npm run validate:tooling`: pass, zero errors and zero warnings;
- `npm run check:tooling-generated`: pass, 18 generated files current; and
- `npm run test:tooling`: pass, 20/20.

These are tooling-governance checks, not application or S1h production proof.

## Read-only live metadata

The bounded catalog capture targeted Supabase project reference `glsmljpabrwonfiltiqm`. A
read-only migration-list refresh now ends at
`20260726233416 encircle_managed_credentials`; `20260726220000_permission_write_gates`, S1d, S1e,
S1f, S1g, and S1h remain absent. S1h therefore cannot be `ready_for_apply`: its required
permission-write dependency is not live or applied-verified. The ledger refresh did not read a
business row or execute SQL.

All nine target functions resolve to one reviewed overload. Current and proposed body/definition
fingerprints are:

| Function | Current body / definition MD5 | S1h body / definition MD5 |
|---|---|---|
| `get_employee_page_access(uuid)` | `444353933d6424ef80eef8aff55ff00e` / `534ee514e1cd451eb7443f46cc5b97c4` | `322bce8cdec88d162720747946378420` / `b960beac5110a92a7242acb5d6f1d637` |
| `get_effective_notification_prefs(uuid)` | `26265649c566f96b9609665bdcb9b681` / `58a78cf8e0c6f4fddd6b83c176a6faec` | `4225ce3d9a846bc453b9048dcd944bdf` / `801a88bb22ef698306c35a6fc7482f7b` |
| `get_my_notification_prefs(uuid)` | `74a2cde903e4065bf77a5ee7e91136d3` / `0792021b1cd5aa2bf86a280fd710ede4` | `e5566bb6b37fe209cc800198c20021dd` / `e902db39426544aaf9bb1a73bd664e56` |
| `set_my_notification_pref(uuid,text,text,boolean)` | `ab61d17bdc3ee21db918ba630c84833d` / `4e38e85eaf62d0017c2116ae99132928` | `5e85d4169bf7174182069c3c05e9f257` / `e06ecc49305feb75c9dba70763e69b57` |
| `get_my_push_subscriptions(uuid)` | `259b6a2b5ba6d4fb72685af1401b44d1` / `dc8407414a6b0409b8ca0bd22952d227` | `aa2f4c86229dc668a7058d48fb19c4a5` / `02d9187d640c50b2312a261336cbb14f` |
| `upsert_push_subscription(text,text,text,text)` | `bf001422d95a240b330407c96cc48d62` / `7bdeb04d8b30e3851c0b2345efcf4cb5` | `3eb78aa7463d537da45442f63020a0f7` / `607576abe46c927fc448fad14c971d41` |
| `delete_push_subscription(text)` | `e81203e340b411f246321c47d5d35651` / `29d5b41ceecc5ee2727becce4231ed67` | `c0589d5cf27b7b3c55bc1e78c5b74329` / `98ee780a01c333315bc11ec1e6b799c8` |
| `upsert_device_token(uuid,text,text)` | `5d5a405a4f83b0bceeada7c1e68f9759` / `8b9a354ccfb0c2acbe977fdf032fae12` | `92b882af1172bb915c0eacd1cf4fe88d` / `6eedfa138b6a0889e67413235aae3097` |
| `delete_device_token(text)` | `08f895e2f310f23e1ca131a527a0d358` / `995617e7a443e214f20a4e4cf1d6dc39` | `502eb7a7d59bece423795861c1b90483` / `1725524832610b776146199a737c4fd2` |

The private authored helper `is_current_active_internal_employee(uuid)` has body/definition MD5
`a33191b914c93d730600f7040259090f` /
`a07d747abf3ffbde3dba48b7ae82eadc` and no browser/service EXECUTE grant.

All four current target relation ACLs have MD5 `5af89d01800b50292cd05f0582531d89`.
The proposed three RPC-only relation ACLs have MD5
`b8b0e1bc6d2009f5341cd784a3a7d0e7`; the proposed `device_tokens` ACL has MD5
`fe1b162994874e65f5b84753ae3b0d60`. Exact table shape fingerprints are:

| Table | Columns MD5 | Constraints MD5 | Indexes MD5 |
|---|---|---|---|
| `device_tokens` | `436d8e67577c2494d101e3572da0ed72` | `b404642ee006aac56488662e309e75b4` | `5bea678ca4a85697e308b8728d6cc344` |
| `employee_page_access` | `8153d07e9417a0718e71f769cea622ba` | `83c2d83a6d6ac03dda5a44c8f9d0e1e0` | `5fbbc307824f65aed80ee6fedadb4c40` |
| `notification_prefs` | `8dc6b2e929b8fd5d000c97003b786ba4` | `f7289d520c842200d2960b4f0a5daeed` | `8984b2ab8e2e155309517c448b08a979` |
| `push_subscriptions` | `d827ea97e7ee6cf032080729a12e1253` | `8ee5bdc8ddfa993d319480ab1d1d2d5a` | `f15c2aa376955f574d81d9bb6cf0c662` |

The captured `device_tokens` policy predicate MD5 changes from
`aea87dfe07b22c489c0f8401ae03053b` to
`a735874c068d47d027daebeea5b8657f`. The preflight also pins:

- `is_active_internal_admin()` body MD5 `ef9b97f5a64e030b1b1b9dfb779b1db3`;
- permission-gated page upsert/delete body MD5s
  `79d6b7e2f231cfa2d0038af1d0464ca0` and
  `b108f96a46006185cf2b6ad4b0a147aa`;
- the employee UUID/Auth uniqueness, active/internal fields, authenticated employee read
  dependency, and exact employee policy;
- `postgres` and `service_role` BYPASSRLS; and
- absence of unreviewed target triggers, publications, views, policies, column ACLs, or overloads.

No target business table was selected. No row, endpoint, push key, device token, employee UUID,
email, role assignment, notification, or recording source appears in this evidence.

## Caller and compatibility record

Read-only source capture found:

- Auth bootstrap and the Page Access admin screen call `get_employee_page_access`;
- the settings/technician notification matrix calls get/set-my preferences;
- the Push Devices list calls the redacted subscription-list RPC;
- `webPushClient.js` calls Web Push upsert/delete without a caller-selected employee;
- native registration calls `upsert_device_token` with the employee resolved by AuthContext;
- notification dispatch and Google Calendar call the effective resolver with a service-role client;
- notification dispatch and the APNs worker directly read/prune subscription/token tables as
  service role; and
- CallRail recording and messaging authorization directly inspect page access as service role.

S1h leaves service-role table access and BYPASSRLS compatibility intact. It changes no RPC identity,
parameter default, return type, successful row/JSON field, ordering, notification value, provider
payload, route, Storage object, or native project file.

## Local verification

A temporary, non-retained PGlite experiment modeled the S1h lifecycle and reported a passing
rollback-only behavior matrix. It did **not** execute the exact checked-in isolated, catalog
preflight, or post-apply files, and neither its harness nor a complete log was retained. It is
exploratory feedback, not reproducible verification and not an exit gate. The modeled cases were:

- active employee A/B own and foreign selectors;
- inactive, external, unmapped, anonymous, active admin, active project manager, and service;
- catalog → role → employee override → personal preference precedence;
- role-lock suppression of personal preference and disabled-type filtering;
- own/foreign Web Push and native-token deletion;
- authenticated Web Push endpoint and native-token ownership transfer;
- all nine service-role RPC identities;
- direct table denial, permitted `device_tokens` reads, and service direct-prune compatibility.

No local governed Supabase runtime was available to compile/execute the exact files or prove real
GoTrue/PostgREST/RLS behavior. The repository runner now includes S1h behind its exact
local-origin/ref/sentinel guard, but it was not pointed at a linked or hosted database. Exact local
SQL execution and real authenticated multi-session qualification therefore remain open gates.

Credential-free static tests pin signatures, callers, hashes, ACL/RLS policy intent, value-free
catalog scripts, isolated-runner refusal controls, the unsafe rollback guard, and the anonymous
`devLogin` compromise. Those checks did not detect the security findings above and are not
behavior proof. Before the review corrections, the current resolved worktree reported:

- the focused pre-review S1h/S1g/runner/dependency QA selection passed 45/45; after the
  fail-closed Auth bootstrap and DB-lane accounting corrections, the S1h file passed 10/10 and
  the S1h plus DB-lane selection passed 13/13;
- the initial Node 22 mobile preflight passed with zero errors and the expected dirty
  worktree/GitHub-delivery warnings; the post-review rerun under local Node 26.5.0 also passed with
  zero errors and added the expected Node-22-declaration mismatch warning (three warnings total);
- `npm run build` passed after the isolated worktree reused the primary checkout's existing pinned
  `node_modules` through an ignored temporary symlink;
- after the review corrections, the executable bootstrap helper passed 6/6, build passed, unit
  passed 780/780, Worker passed 1,411/1,411, and QA passed 115/115 with zero unexpected skips;
- targeted ESLint passed for the S1h runner, DB-lane guard, and S1h contract test; and
- full `npm run lint` remains red at 205 errors/119 warnings across the established repository
  baseline. `AuthContext.jsx` reports the same unrelated `no-prototype-builtins`,
  `react-refresh/only-export-components`, and hook-dependency findings outside the S1h edit; the
  S1h edit itself has no reported lint finding.

These checks must be rerun after the pending merge commit and final current-`origin/dev`
reconciliation before an integration close-out is claimed.

## Apply status and open gates

S1h is **security-review-blocked, not database-behavior-verified, not integrated, not applied,
and not `ready_for_apply`**:

1. The active DB-1 writer lease must explicitly release/hand off the overlapping
   `employee_page_access` and notification-control seam, or the owner must resolve the collision.
2. A separate employee identity-authority boundary must revoke authenticated browser DML and
   replace the unconditional `employees` write policy; S1h preflight/tests must prove self-binding
   and self-promotion denial.
3. Authenticated raw native-token SELECT and cross-owner token takeover must be removed, with an
   explicit safe account-switch/device-proof contract and negative test.
4. The locally verified AuthContext and DB-lane corrections need post-origin-reconciliation reruns
   and independent integration review.
5. The resolved non-rewriting origin merge needs explicit commit authorization, followed by a
   normal merge of current `origin/dev`.
6. Revised S1h source must pass independent security/release review and receive an explicitly
   authorized integration commit.
7. `20260726220000_permission_write_gates.sql` needs its own reviewed, authorized apply and live
   proof first.
8. S1h then needs a separate owner apply decision, checksum/drift gate, exact single-migration
   apply, value-free post-check, approved synthetic multi-identity proof, provenance, and advisors
   under `docs/mobile/s1h-database-apply-runbook.md`.
9. Notification defaults/employee overrides and their administrative table/RPC ACLs belong to S1i
   after the same lease releases.
10. Native logout/account switching, APNs fan-out, provider credentials, deployments, signing,
    simulator/real-device checks, S1d-S1g, QBO, private media, public signing, route families, and
    final qualification remain independent work.

The rejected migration remains discoverable under `supabase/migrations/` and its own header does
not yet carry a rejection marker. The active DB-1 lease prevents editing or quarantining that
migration now. Do not stage, commit, or apply it; after explicit DB-1 handoff, add an unmistakable
stop banner or move it outside migration discovery before any other remediation/integration step.

No database mutation, migration apply, deployment, provider request, notification, push delivery,
message, money movement, secret/configuration change, signing, device registration, distribution,
commit, push, or pull request occurred in S1h.
