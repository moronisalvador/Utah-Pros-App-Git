<!--
FILE: docs/audit/2026-07/evidence/prior-sms-consent-live-apply-2026-07-23.md

WHAT THIS DOES (plain language):
  Records exactly what was reviewed, applied and checked when UPR added a safe way to document
  previously verified one-to-one service-text permission. It separates repository checks, live
  database proof and the application release boundary.

DEPENDS ON:
  Internal: commit e71e759, supabase/migrations/20260724014423_attest_prior_sms_consent.sql,
            docs/generated/schema-overview.md, docs/generated/rpc-inventory.md
  Data:     reads → sanitized Supabase catalog, migration ledger and rollback-only synthetic results
            writes → documentation only

NOTES / GOTCHAS:
  - This is dated evidence, not current project law.
  - It records no secrets, full phone numbers, message content, employee identities or durable
    synthetic records.
  - Last verified 2026-07-23.
-->

# Prior SMS consent live apply evidence — 2026-07-23

## Scope and outcome

The owner authorized the reviewed prior-consent implementation, release to `dev`, and shared
Supabase migration apply. The implementation was committed at
`e71e759b27b1da1fad713413c257b7059bd5905d` and pushed to `origin/dev`.

The exact committed SQL from
`supabase/migrations/20260724014423_attest_prior_sms_consent.sql` applied successfully to Supabase
project `glsmljpabrwonfiltiqm`. The live migration ledger recorded
`20260724035913_attest_prior_sms_consent`.

The database apply was additive. It did not activate a provider, change messaging deployment mode,
send a message or move money.

## Repository verification

The exact release commit passed:

- full credential-free Vitest: 717 unit, 968 Worker and 16 QA tests;
- production Vite build: 659 modules;
- changed-file ESLint: zero findings;
- `git diff --check`;
- retained-artifact safety check: zero unsafe artifacts;
- migration provenance fixtures: 8 of 8;
- targeted consent Worker tests: 108 of 108; and
- targeted consent modal tests: 2 of 2.

Independent review results for the exact commit:

- consent-path audit: pass;
- anonymous-grant and secret-exposure audit: pass; and
- migration-safety review: pass for apply eligibility.

An isolated local PostgreSQL compile was unavailable because this Windows environment did not have
a governed local Supabase/PostgreSQL runtime. The live apply itself completed transactionally, and
the checks below verified the created catalog and behavior.

## Live catalog verification

Read-only queries after apply confirmed:

- `service_sms_consents` and `service_sms_consent_attestations` exist;
- RLS is enabled and forced on both tables;
- the current-state table has one explicit `service_role` manage policy;
- the evidence table has separate explicit `service_role` insert and select policies;
- the application grants are limited to `service_role`:
  - current state: `INSERT`, `SELECT`, `UPDATE`;
  - evidence history: `INSERT`, `SELECT`;
- neither `anon` nor `authenticated` has a table grant;
- both RPCs exist with the committed signatures;
- both RPCs are `SECURITY INVOKER` and pin an empty `search_path`; and
- neither `anon` nor `authenticated` can execute the RPCs; `service_role` can.

The generated catalog reports were refreshed from the same read-only live-catalog query. They show
135 public tables and 376 public function names, including the two new tables and two new RPCs.

## Rollback-only behavioral verification

A synthetic transaction used `SET LOCAL ROLE service_role` and an existing active internal
admin/office actor. All synthetic identifiers and data were scoped to the transaction, which was
rolled back.

The transaction proved:

- a first prior-consent attestation succeeded for the current normalized contact phone;
- the contact's general `opt_in_status` remained false;
- status returned `SERVICE_CONSENT` only for the matching direct-service destination;
- a second attestation reported `already_recorded = true`;
- current state remained one row while append-only evidence reached two rows;
- the legacy `sms_consent_log` received two redacted events;
- neither the evidence note nor request IP appeared in the legacy log, and its `ip_address`
  remained null;
- a duplicate contact with the same phone and DND returned `CONTACT_DND_ACTIVE`; and
- a durable pending CallRail STOP returned `CONTACT_PENDING_STOP`.

After rollback, read-only cleanup verification returned zero matching synthetic contacts, current
consents, evidence attestations and provider events.

## Application and release boundary

The database boundary is live because staging and production share Supabase. The compatible
Worker/UI code was deployed to `dev` at commit `01f59ce` through Cloudflare Pages deployment
`f87179a0-2b87-422f-9e77-0520d99497e9`. GitHub CI and the Cloudflare Pages check both passed for
that commit. Production code on `main` remains unchanged until the normal release pull request is
approved and merged.

An authenticated no-send browser smoke was completed against `https://dev.utahpros.app` with the
existing test-admin session and a QA-labeled direct contact:

- the deployed Conversations route loaded its real authenticated data without a page error;
- the scoped status check rendered the no-consent banner for the active contact and phone;
- the message Send button remained disabled;
- the record-only action opened the evidence modal;
- source, date, evidence note and explicit verification controls were present;
- the Record permission button remained disabled with the form untouched; and
- the modal was closed without submitting an attestation or sending a provider message.

One non-blocking browser console entry (`AbortError: Transition was skipped`) occurred during
thread navigation. The target thread rendered normally and the consent workflow completed; no
consent API or provider send was triggered by the observation.

General contact-table policy debt that predates this scoped phase is not represented as fixed by
this migration.
