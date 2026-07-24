<!--
FILE: docs/audit/2026-07/evidence/engineering-foundation-documentation-closure-2026-07-23.md

WHAT THIS DOES (plain language):
  Closes the July 23 documentation audit by reconciling Git, live Supabase, provider recovery,
  canonical documents, generated catalog reports, and unfinished owner/external gates.

DEPENDS ON:
  Internal: docs/audit/2026-07/evidence/git-ledger-2026-07-23.md,
            docs/generated/schema-overview.md, docs/generated/rpc-inventory.md,
            docs/upr-unfinished-work-registry.md, UPR-Web-Context.md
  Data:     reads → Git refs/history and read-only live catalog
            writes → documentation only

NOTES / GOTCHAS:
  - This closes documentation for the captured day; it does not close the full finish-first program.
  - Public-form repository readiness is not a live ACL apply.
-->

# Engineering Foundation documentation closure — 2026-07-23

## Evidence boundary

The final recapture followed `git fetch origin --prune`:

- `origin/dev`: `b6d7092a6450440a1971aa99f896abc6615d91c9`
- `origin/main`: `891804a2f35dfe5809893800dcd4a5e6570a9fcb`
- current branch before this documentation commit: `dev` at `b6d7092a`
- full dated commit/branch reachability:
  `docs/audit/2026-07/evidence/git-ledger-2026-07-23.md`
- live catalog capture: 2026-07-24 00:20:26–00:21:19 UTC, read-only, project
  `glsmljpabrwonfiltiqm`

The generated reports were produced by the checked-in SQL and Node generator, not hand-edited.
They report 133 public tables and 372 distinct function-name rows. A separate exact aggregate query
reported 373 overloads, 346 `SECURITY DEFINER` overloads, six `anon`-executable overloads, and 363
`authenticated`-executable overloads.

## Live mutation ledger

| Mutation or attempted mutation | Current evidence | Documentation disposition |
|---|---|---|
| Messaging foundation first apply attempt | Aborted transactionally on the live enum/text mismatch; no partial objects remained | Documented in `messaging-transport-2026-07-23.md` |
| `20260723215926 messaging_transport_foundation` | Present in the live ledger; service-only ledgers and authenticated-read-only `messages` boundary remain | Documented-complete; do not reapply |
| `20260723220207 messaging_transport_foundation_indexes` | Present in the live ledger | Documented-complete; do not reapply |
| `20260723221707 exec_read_sql_containment` | Present; ACL is exactly `postgres` and `service_role`; direct `PUBLIC`/`anon`/`authenticated` checks deny | Documented-complete regression boundary |
| Messaging Preview configuration and two controlled outbound tests | Preview CallRail mode/bindings were configured; Production remained disabled; two owner-phone sends and two replies occurred under explicit windows | Documented-complete as controlled evidence; no resend |
| CallRail outbound reconciliation | Two attempts are `confirmed`; two outbound canonical messages are `sent`; two `text_reconciled` events are processed | Documented-complete |
| Bounded inbound-history recovery | Exact 24-hour-or-less window processed two inbound SMS records and skipped two outbound records; two canonical inbound messages persisted | Documented-complete; temporary code is superseded |
| Temporary recovery infrastructure | Temporary remote branch/alias removed; all five recovery Preview deployments force-deleted; final inventory found none | Documented-complete cleanup |
| F2 CRM migration provenance | Four historically missing source records restored without replacing live function bodies; read-only gate/fingerprints added | Documented-complete; no live mutation during F2 |
| Encircle readiness recapture | Migration unapplied, flag OFF, credentials unchanged | External/owner-gated; no July 23 rollout mutation by this program |
| Public-form containment | Repository commit `b6d7092a`; live function still grants `PUBLIC`, `anon`, and `authenticated`; ledger `20260723235900` absent | Still-in-progress owner apply gate; no live mutation |
| Isolated-QA P0 decision package | Documentation only | Documented-complete P0; hosted target and identities external-gated |

No provider activation beyond the documented Messaging Preview window, production messaging
activation, money movement, credential rotation/revocation, public-form submission, Encircle apply,
or destructive external cleanup beyond the explicitly approved temporary recovery cleanup is
claimed.

## Git and branch reconciliation

The exact 57-object inventory and 21 July 23 branch tips are in the companion Git ledger.
Important dispositions:

- `d3fd17a` is an unreferenced branch-only object containing the bounded CallRail recovery route.
  The live recovery and cleanup are complete. The remote branch and all five deployments are gone.
  This object is **superseded historical evidence and must not be merged**.
- `3841056` is an unreferenced branch-only object from 2026-07-22. Its proposal allowed
  mutation-heavy integration tests against the shared production project; the isolated-QA addendum
  at `bf3b0b9` supersedes it. It **must not be merged**.
- Rebased duplicate tips (`b33220f`, `285467d`, `1566323`, `241915f`, `d974de5`, `b5e4799`,
  `ad2a274`) are provenance, not missing delivery.
- Remaining branch/worktree retirement is an owner cleanup gate. This audit does not delete
  branches, worktrees, or user-owned changes.

## Documentation reconciliation

Current-state updates made during this closure:

- regenerated `docs/generated/schema-overview.md` and `docs/generated/rpc-inventory.md` from a
  fresh timestamped read-only catalog;
- updated `docs/database-schema.md`, `docs/auth-and-authorization.md`, `UPR-Web-Context.md`, the
  Foundation roadmap, and the unfinished-work registry;
- added a dated correction beside the QA roadmap's historical `exec_read_sql` paragraph so it
  cannot be mistaken for current ACL state;
- preserved dated audit snapshots rather than rewriting their original observations;
- retained full public-form finding, review, rollback, post-apply, and apply-window evidence in
  `public-form-rpc-boundary-readiness-2026-07-23.md`.

## Final status ledger

### Documented-complete

- Foundation F1 `exec_read_sql` containment and regression evidence.
- Foundation F2 four-entry migration-provenance restoration and read-only release gate.
- Encircle repository rollout-readiness recapture.
- Messaging transport schema/index applies, contract corrections, controlled Preview evidence,
  outbound reconciliation, bounded inbound recovery, and temporary recovery cleanup.
- Isolated-QA P0 decision package.
- Public-form repository implementation, negative tests, independent reviews, and apply plan.
- Fresh generated schema/RPC catalog and July 23 Git/live documentation audit.

### Still-in-progress

- Public-form live ACL containment and its post-apply/advisor/provenance verification.
- Broad authorization/public-boundary closures, signing/Storage privacy, money-path
  authorization/idempotency, CI/iOS, and remaining finish-first registry phases.
- Messaging direct signed-event replay/dedupe proof and narrow atomic event-write contracts.
- Figma readiness until the bounded checkpoint's owner/internal gates clear.

### External-gated

- Encircle candidate/apply/flag/runtime smoke/credential rotation and fallback cleanup.
- CAP-SEC-001 credential revoke/rotate and repository-history decision.
- CAP-GOV-001 local permission reset and exact plugin permission approval.
- Dedicated isolated QA project, hosted application, synthetic identities, and provider sandboxes.
- Provider approvals/live device checks, App Store signing/TestFlight, production promotion, real
  outbound messages, money movement, and destructive third-party cleanup.

### Superseded

- `3841056` shared-production integration-test proposal.
- `d3fd17a` temporary CallRail recovery implementation.
- Rebased duplicate commit tips listed in the Git ledger.
- Historical pre-containment generated ACL/count reports, while retained as dated evidence.

### Branch-only

- `d3fd17a` and `3841056`: unreferenced objects with explicit superseded dispositions.
- Current local/remote July 23 branch tips not reachable from `dev`/`main` are listed individually
  in the Git ledger; their content is either rebased/integrated or superseded.
- Branch/worktree deletion is not part of this documentation closure.

This ledger closes the requested July 23 documentation audit. It deliberately does **not** claim the
finish-first program or its owner/external gates are complete.

## Final post-closure addendum — 2026-07-24 UTC

The closure was reopened because messaging activation, money hardening and the iOS workflow repair
landed after the original `b6d7092a` capture.

### Current evidence boundary

- final pre-closure Git recapture: `origin/dev=6651392`, `origin/main=891804a`, local
  `dev=449bd6c`; later commits and duplicate branch dispositions are in the Git-ledger addendum;
- fresh read-only live catalog capture: 2026-07-24 01:00:19 UTC, project
  `glsmljpabrwonfiltiqm`;
- generated reports: 133 public tables and 374 distinct public function-name rows;
- exact aggregate: 375 overloads, 348 `SECURITY DEFINER`, six `anon`-executable, and 363
  `authenticated`-executable overloads;
- `exec_read_sql(text)` still denies `PUBLIC`/`anon`/`authenticated` and allows `service_role`;
- `upsert_lead_from_form(...)` still allows `PUBLIC`/`anon`/`authenticated`; the reviewed
  `20260723235900` containment remains unapplied;
- live ledger now includes `20260724003818 message_notification_outbox_scheduler`.

The scheduler's live statement matches the reviewed Git file at `625ccfd` after removing only the
file's final newline (4,548 bytes; MD5 `c6193971d4a27418f5f08c10cbf655a9`). The active provenance
manifest and fresh machine evidence now map that tool-assigned live version to repository file
`20260724001500_message_notification_outbox_scheduler.sql`; no live body was rewritten.

### Final status ledger

#### Documented-complete

- All items in the original documented-complete list.
- Messaging notification scheduler apply, active five-minute cron, statement trigger, drained
  six-row outbox, owner-confirmed mobile-PWA push, and dev deep-link correction/evidence.
- QBO/Stripe server authorization slice: admin/manager gate, provider-never-called negatives,
  QBO whole-cent/balance/actor/stable request ID and Mountain-date contract.
- Paused iOS workflow validity: manual-only, no direct `secrets.*` step condition, regression test,
  green CI, and no automatic iOS run on the repair push.
- Fresh generated schema/RPC reports and eight-row provenance mapping.

#### Still-in-progress

- Public-form live ACL apply plus browser-role denial, service Worker smoke, advisors and provenance.
- QBO durable pre-provider attempt/recovery and Intuit sandbox failure/retry proof (COR-002).
- Stripe stored Checkout-session lifecycle and sandbox concurrency proof (COR-003).
- Messaging corrected field-PWA deep-link tap on the owner device and remaining provider/device
  rollout tails.
- Signing/Storage privacy, account-deletion fulfillment, broad RPC/policy classification, and other
  ready P0/P1 registry rows.

#### External-gated

- All external gates in the original list.
- Apple enrollment/signing secrets, owner Xcode archive/device verification, explicit TestFlight
  dispatch, screenshots, reviewer credentials and App Store Connect entry.
- Intuit/Stripe sandbox access for the remaining money correctness phases.

#### Superseded

- `3841056` shared-production QA proposal and `d3fd17a` temporary recovery implementation.
- `67ab184` duplicate messaging activation evidence and the rebased/squashed notification branch
  commits after their dev equivalents landed.

#### Branch-only

- Notification scheduler/deep-link branch commits are integrated; messaging evidence is integrated
  as `449bd6c`; their remaining branch tips are cleanup candidates, not missing work.
- `d3fd17a` and `3841056` remain unreferenced superseded objects and must not be merged.
- Branch/worktree deletion remains owner-controlled; unrelated `.agents/` and `.codex/` are
  preserved.

The repository-internal Foundation/documentation boundary is complete for this capture. The overall
finish-first program remains open at the explicit live-apply, provider, credential, isolated-QA,
device, legal and owner gates above.
