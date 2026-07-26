---
name: db-migration
description: Plan or author a safe UPR Supabase migration for schema, RPC, policy, grant, constraint, index, Storage authorization, or bounded data repair. This is the database-change dispatcher. Planning, repository authoring, shared-database apply, cleanup, and publication are separate actions; apply only the exact reviewed migration when the owner explicitly authorizes that live step.
---

<!-- GENERATED from tooling/skills/db-migration/SKILL.md by scripts/render-tooling-adapters.mjs. Do not edit this adapter directly. Source SHA-256: e27b25ae99b4b1c1. -->

# UPR database migration

One Supabase project serves staging and production. A migration becomes a production change when
applied, regardless of the frontend branch or preview.

## 1. Establish authority and current truth

Read `AGENTS.md`, `CLAUDE.md`, `.claude/rules/database-standard.md`,
`docs/database-schema.md`, `docs/auth-and-authorization.md`,
`docs/testing-and-deployment.md`, the latest applicable live-evidence addendum, and any active
roadmap/ownership manifest.

Keep four states separate:

1. **Plan** — inspect repository and authorized read-only evidence.
2. **Author** — create migration, tests, rollback, and documentation when implementation is requested.
3. **Apply** — mutate the shared database only when the owner authorizes the exact reviewed migration.
4. **Publish** — commit, push, PR, deploy, and flag activation are separate delivery actions.

Run `git status --short --branch` and preserve unrelated work. Trace every caller and deployed
contract. When the decision depends on current catalog state and access is available, inspect real
columns, constraints, policies, grants, function definitions/signatures, triggers, Storage policies,
migration ledger, and representative violating rows. Label unavailable live evidence `UNKNOWN`.

Classify the change as additive, backward-compatible replacement, authorization/ACL, constraint/index,
bounded data repair, or destructive/tightening. Destructive or contract-breaking work requires its
own explicitly reviewed change and rollout; do not disguise it as an additive phase migration.

## 2. Define tests and rollback before SQL

Specify the expected behavior and denial cases first:

- intended and denied roles, tenant/owner/assignment scope, and anonymous boundary;
- exact RPC signature and response compatibility for every deployed caller;
- trigger-owned columns and business-rule invariants;
- duplicate/concurrent/retry and idempotency behavior;
- representative existing data for constraints or repairs;
- rollback and post-rollback caller behavior.

Use isolated database fixtures for write-capable SQL tests. Never point mutation-heavy tests at the
shared project. A self-skip without credentials is not evidence that database behavior passed.

Every migration begins with the documentation-standard SQL header and concrete rollback. If rollback
is destructive or cannot be automated safely, say so and define containment instead of inventing a
false one-line undo.

## 3. Author to the database standard

- Prefer additive, backward-compatible changes.
- Enable RLS at object creation and write operation-specific policies scoped to the actual access
  model. `authenticated` proves identity, not row authorization.
- Anonymous/public access requires the documented allowlist, `-- public: <reason>`, minimum surface,
  and abuse/capability tests.
- Prefer `SECURITY INVOKER`. A necessary `SECURITY DEFINER` function validates its trusted caller
  contract internally, pins `search_path`, revokes `PUBLIC` and unintended roles, and grants only the
  roles that actually call it. Do not grant `authenticated` or `service_role` reflexively.
- Preserve deployed RPC signatures and return shapes. New optional parameters take defaults when
  needed for old clients.
- Keep secret/config tables deny-by-default. Never seed a real credential or return secret values.
- Pre-check real data before constraints. Use low-lock patterns such as `NOT VALID` then `VALIDATE`
  when applicable.
- Use `timestamptz`; business-day bucketing follows the documented `America/Denver` rule.
- Do not write trigger-owned billing totals directly.

## 4. Review the authored change

Run targeted SQL/unit tests and inspect the complete migration, callers, and rollback. Run
`migration-safety-checker` and `anon-grant-auditor`; add the applicable phase reviewer for an active
initiative. Worker/auth or public-boundary changes also receive `worker-security-reviewer`.

Update the canonical schema/auth/business/testing documents whose governed facts changed,
`UPR-Web-Context.md`, and any active roadmap/registry/ownership state. An authored migration remains
unapplied in every status report unless live evidence proves otherwise.

## 5. Apply only under a separate explicit gate

Without a current instruction to apply the exact reviewed migration, stop with:

- migration and test paths;
- review findings;
- rollback and lock/apply-window analysis;
- required code-before-schema or schema-before-code ordering;
- commands and read-only queries for post-apply verification.

When apply is explicitly authorized, verify reviewed-commit provenance, correct project identity,
low-traffic window, rollback readiness, conflicting migrations, and the designated release branch.
Use the governed migration mechanism rather than iterative free-form production SQL. Re-query the
catalog and behavior for intended and denied roles, record the live ledger/fingerprint evidence, and
report any partial result immediately.

Cleanup, status writes, feature activation, commit, push, PR, deployment, provider mutation, outbound
communication, and money movement remain separately authorized.
