<!--
FILE: docs/native-ios/templates/vertical-slice-checklist.md

WHAT THIS DOES (plain language):
  Provides a reusable completion checklist for one end-to-end native-iOS workflow slice.

DEPENDS ON:
  Internal: docs/native-ios/09-testing-and-quality.md,
            docs/native-ios/12-agent-execution-and-ownership.md
  Data:     reads → slice requirements, contracts, tests, and review evidence
            writes → a copied, dated evidence record

NOTES / GOTCHAS:
  - Copy this template into a dated initiative/evidence location.
  - Unchecked or unavailable evidence remains open; it is never promoted to a pass.
-->

# Native iOS Vertical Slice Checklist

## Identity

- Slice:
- Owner:
- Reviewer:
- Date:
- Branch:
- Base commit:
- Candidate commit:
- Working-tree status:
- App version/build:
- Xcode/Swift:
- Scheme/configuration:
- Bundle ID:
- Backend environment/project:

## Scope and evidence

- [ ] `NIOS-H: READY` evidence path, exact supported scope, source/deployment boundary, owner
      acceptance, and material-drift review are recorded.
- [ ] Phase 0, current-base reconciliation, fresh implementation worktree, and separate
      implementation authority are recorded.
- [ ] Goal and user role are stated.
- [ ] Entry, success, cancellation, and exit paths are named.
- [ ] Non-goals and intentionally deferred behavior are named.
- [ ] Evidence uses only `Verified`, `Source-confirmed`, `Inferred`, `Blocked`, `Owner gate`, or
      `Not tested`; provenance and proposed/approved/deferred/superseded decision state are separate.
- [ ] Owned files and contract IDs are recorded.
- [ ] No ownership overlap or unexpected user change exists.

## Contract and authorization

- Contracts/RPCs:
- Tables/views:
- Storage buckets/paths:
- Workers/providers:
- Realtime topics:
- Allowed roles/ownership/assignment:

- [ ] Request and response shapes are documented and decoded strictly.
- [ ] Nullability, enums, dates/time zones, precision, and pagination are covered.
- [ ] Authentication and server/database authorization are traced independently of UI gating.
- [ ] Allowed role succeeds in isolated QA.
- [ ] Wrong role, wrong owner/assignment, unauthenticated, revoked, stale, and malformed cases fail safely.
- [ ] No service-role/provider secret or privileged credential is present in the client.
- [ ] No production mutation or provider side effect was used as test setup.

## UI and state

- [ ] Loading.
- [ ] Content.
- [ ] Empty.
- [ ] Stale/cached.
- [ ] Offline.
- [ ] Validation error.
- [ ] Forbidden.
- [ ] Not found.
- [ ] Conflict/concurrent edit.
- [ ] Rate limited.
- [ ] Server/provider failure.
- [ ] Retry/reconciliation.
- [ ] Cancel/dismiss and state restoration.

## Mutation and offline safety

- [ ] Stable operation/idempotency ID is defined, or the documented exception is approved.
- [ ] Repeated taps/callbacks do not duplicate effects.
- [ ] Ambiguous response reconciles before retry.
- [ ] Draft retention, encryption, migration, expiration, and deletion rules are documented.
- [ ] App background, termination, restart, upgrade, logout, and account switch are tested.
- [ ] Offline ordering/conflict behavior is deterministic and user-visible.
- [ ] Pending/failed/completed status matches server truth.

## Platform capabilities

- [ ] Required permission is requested in context.
- [ ] Denied, restricted, unavailable, interrupted, and Settings-changed states work.
- [ ] Manual/non-capability fallback exists.
- [ ] Purpose strings, entitlements, privacy manifest, labels, retention, and energy impact were reviewed.
- [ ] Physical-device evidence exists where Simulator cannot prove behavior.
- [ ] Background work has expiration/cancellation and is not required for correctness.

## Accessibility and visual quality

- [ ] VoiceOver labels, values, actions, headings, order, and focus.
- [ ] All Dynamic Type accessibility sizes.
- [ ] Contrast, dark mode, bold text, Reduce Transparency, and color-independent meaning.
- [ ] Reduce Motion and non-gesture alternatives.
- [ ] Touch targets, safe areas, rotation policy, and compact/regular widths.
- [ ] Software/external keyboard, dictation, focus, autofill, and composition field.
- [ ] Loading/error changes are announced appropriately.

## Tests and evidence

- [ ] Swift unit tests.
- [ ] Adapter/module tests.
- [ ] Isolated-QA contract and negative authorization tests.
- [ ] Snapshot/visual states.
- [ ] XCUITest journey.
- [ ] Oldest-supported and current-device checks.
- [ ] Performance/memory/energy measurement where material.
- [ ] TestFlight check when release-scoped.
- [ ] Commands had a timeout of five minutes or less.
- [ ] Spawned child processes were cleaned in guaranteed cleanup.
- [ ] Logs/artifacts are secret-scrubbed and linked below.

### Evidence links

- Test log:
- Screenshots/video:
- Contract fixture/result:
- Device matrix:
- Performance/energy:
- Accessibility:
- Blocked gates:

## Documentation and close-out

- [ ] Architecture/contract/authorization/business-rule/integration/testing docs updated where required.
- [ ] Full diff and `git diff --check` reviewed.
- [ ] Every changed file is intentional.
- [ ] No unrelated application-code change outside this slice.
- [ ] No commit/push/deploy/migration/provider/App Store action occurred without explicit authority.
- [ ] Independent reviewer disposition is recorded.

## Disposition

- [ ] Accepted for next phase.
- [ ] Accepted with named nonblocking limitations.
- [ ] Blocked by owner/external gate.
- [ ] Rejected; remediation required.

Decision, limitations, owner gates, and next step:
