<!--
FILE: docs/native-ios/17-current-client-hardening-gate.md

WHAT THIS DOES (plain language):
  Defines the evidence required to make the current PWA/Capacitor client a safe, supportable
  operational fallback before committed Swift implementation begins.

DEPENDS ON:
  Internal: docs/native-ios/README.md, docs/native-ios/11-roadmap.md,
            docs/native-ios/decisions/0003-harden-current-client-before-swift-implementation.md,
            docs/app-store-readiness-roadmap.md,
            audit/mobile-pwa-production-readiness branch documentation when reconciled
  Data:     reads → current-client audit, remediation, release, device, and owner evidence
            writes → documentation status only

NOTES / GOTCHAS:
  - This is a readiness contract, not evidence that the current client is already ready.
  - It does not authorize remediation, database changes, deployment, signing, or release.
  - Ready means a supportable maintenance baseline, not elimination of every backlog item.
-->

# Current PWA/Capacitor Hardening Gate

**Gate ID:** `NIOS-H`
**Status at this planning snapshot:** **OPEN — evidence must be completed in the current-client
hardening initiative**
**Decision date:** 2026-07-26
**First blocking gate:** creation of a committed Swift project or implementation branch

## Purpose

The PWA/Capacitor client is the business-continuity client while the native application is built.
Starting a long rewrite while that fallback has unresolved security, data-preservation, release, or
device-support failures would increase operational risk and split attention across two unstable
clients.

The owner therefore requires a recorded **supportable maintenance baseline** before committed Swift
implementation. This is deliberately narrower than “make the current app perfect”:

- every audit P0, current-client/shared-contract Critical, and unconditional P1 blocker must be
  closed with evidence;
- every conditional P1 must be closed or explicitly removed from the supported product promise;
- no High risk affecting the supported current-client operational fallback or shared contracts may
  remain without bounded containment, an accountable owner, an accepted residual risk, and proof
  that it cannot compromise those boundaries;
- P2/Medium/Low polish and maintainability debt may remain when it is inventoried, owned, and safe
  to defer.

## Sequencing rule

1. Adopt the completed mobile PWA/Capacitor audit and harden the current client using its existing
   normalized finding IDs and evidence.
2. Record `NIOS-H: READY` against a current source and deployment boundary.
3. Complete or refresh native Discovery Sessions A and B and the Phase 0 decisions.
4. Obtain separate implementation authority and create a fresh Swift implementation worktree from
   the explicitly approved current `origin/dev`.

Planning-only review, contract orientation, Apple Field Pro evidence organization, and disposable
design artifacts may technically proceed while `NIOS-H` is open if the owner explicitly asks.
They do not authorize a Swift project, production target, feature implementation, backend change,
or release. The copy-ready Mac prompt in `14-mac-handoff.md` intentionally waits for `READY` so the
owner can finish the current client without running two major programs at once.

## Required evidence

### 1. Current audit and snapshot boundary

- The completed mobile audit, canonical mobile documents, finding ledger, prioritized backlog,
  scorecard, and validation log are adopted from `audit/mobile-pwa-production-readiness` without
  restarting orientation, census, specialist review, or finding numbering.
- Existing and subsequent Mac/Xcode/Simulator/device addenda are reconciled into the hardening
  record without promoting repository or Simulator evidence to device/release proof.
- The baseline record names the audited commit, remediation commit, current `origin/dev`, merge
  base, ahead/behind drift, deployed web/native build identity, and timestamp.
- Each reused artifact records its source branch/commit, capture time, scope, evidence layer,
  freshness/material-drift result, and `current`, `stale`, or `superseded` disposition. Current
  evidence is reused; stale evidence is refreshed only at the affected layer.
- Drift since the audit is traced to affected findings; old counts are not treated as current.
- An independent reviewer performs a targeted closure and drift challenge from a new clean
  snapshot, reusing completed audit work rather than rerunning the full investigation.

### 2. Security, authorization, privacy, and shared contracts

- No audit P0 or Critical finding affecting the supported current client or shared contracts
  remains open.
- Worker, RPC, RLS, Storage, Realtime, object/assignment, active-employee, and role boundaries used
  by supported mobile workflows have direct negative evidence.
- Confidential job media is private and least-privilege; public/listable or broad-write behavior is
  removed or safely migrated with rollback evidence.
- The application, tests, logs, and artifacts contain no service-role/provider/signing secret or
  real private fixture data.
- Shared backend changes remain compatible with supported PWA/Capacitor callers and are deployed
  only through their separately authorized production process.

### 3. Account, session, device-state, push, and privacy lifecycle

- Query caches, restored routes, drafts, queues, files, preferences, notification tokens, and other
  durable state are account-scoped with explicit retention and logout/account-switch behavior.
- Expiry, failed logout, shared/reassigned devices, reinstall, upgrade, and offline account change
  cannot expose or execute prior-user work.
- Biometric/unlock and app-switcher privacy behavior fail safely for the supported Capacitor scope.
- Push attach/detach, invalid-token, reinstall, account-switch, foreground, tap, and privacy
  behavior are either verified end to end or explicitly excluded from the supported release.

### 4. Mutation, media, offline, and recovery safety

- Supported queued commands have immutable ownership, recoverable leases, bounded retries, stable
  operation IDs, ambiguous-result handling, and deterministic reconciliation.
- Supported media and composite appointment/event workflows cannot silently lose, duplicate,
  orphan, or partially commit user intent.
- The product states exactly what works online, warm-offline, and cold-offline; UI, support copy,
  tests, and release claims match that contract.
- Termination, resume, multi-tab/process, network-loss, storage-pressure, and retry fault matrices
  pass for every supported critical field mutation.

### 5. PWA installation, caching, update, and rollback

- Supported browser and installed-PWA modes are explicitly named.
- Manifest identity/assets, install/relaunch, stale-asset recovery, partial deployment, old-cache to
  new-bundle compatibility, reset, rollback, and update behavior pass on the promised platforms.
- Service-worker/cache behavior is tied to a release compatibility identity rather than an
  undocumented manual assumption.
- Conditional offline/install capabilities not proven on real devices are visibly excluded rather
  than marketed or silently assumed.

### 6. Capacitor and Apple release baseline

- The checked-in Capacitor project, plugins, permissions, privacy manifest membership, lifecycle,
  keyboard/safe areas, deep links, push, OTA policy, signing interface, archive/export path, and
  account-deletion applicability are resolved for the supported release.
- A clean Mac checkout produces the intended build/archive evidence.
- Simulator evidence is kept distinct from a development-signed device and TestFlight evidence.
- Critical authenticated field workflows pass on a representative physical iPhone. Any capability
  that lacks device/provider evidence is excluded from the supported promise or remains a blocker.

### 7. Quality, observability, and field support

- Relevant build, targeted/full tests, changed-file lint, governance, dependency, provenance,
  browser, accessibility, and release checks have recorded results and zero unexplained skips.
- Authenticated critical workflows pass at the supported mobile widths and with the applicable
  assistive-technology, keyboard, orientation, and field-condition matrix.
- Crash/hang, primary-pane failure, release/build identity, sync/queue health, and support
  diagnostics are recoverable and observable without leaking private data.
- Performance, memory, thermal, network, and battery behavior are measured on the minimum supported
  scope; unmeasured capabilities are not claimed.

### 8. Operational maintenance baseline

- A known-good current-client release candidate and deployed build identity are recorded.
- Rollback, stale-client recovery, incident/support owners, stop conditions, and user fallback are
  rehearsed or explicitly owner-gated.
- One named current-client owner remains responsible for critical security, compatibility, and
  release fixes throughout native construction.
- The owner approves a supported-capability matrix covering browser, installed PWA, Capacitor,
  platform/device, offline, push, deep links, admin-mobile, and account lifecycle.
- Feature expansion in the current client is frozen by default after `READY`; critical fixes and
  separately approved urgent business needs continue.

## Required finding disposition

| Finding class | Required before `READY` |
|---|---|
| Audit P0 / current-client or shared-contract Critical | Closed with implementation, negative verification, deployment evidence where applicable, and rollback; no residual open item |
| Unconditional audit P1 | Closed and independently verified |
| Conditional audit P1 | Closed, or the capability is explicitly excluded in product scope, UI/support language, tests, and release gates |
| Current-client operational-fallback or shared-contract High outside the audit priority model | Closed, or safely contained with named owner, due gate, explicit residual-risk acceptance, and no fallback/shared-contract compromise |
| P2 / Medium / Low | Close when required for the supported scope; otherwise record owner, reason, dependency, and revisit trigger |

Aggregate risk matters. Several individually deferrable findings become blocking when they share one
systemic cause or together undermine a critical workflow.

## Evidence record

The current-client initiative should create a canonical closeout such as
`docs/mobile/current-client-hardening-baseline.md` plus any dated audit evidence required by project
law. At minimum it records:

```text
Gate: NIOS-H
Status: OPEN | READY | BLOCKED | SUPERSEDED
Decision date and owner:
Audit branch and audited commit:
Remediation branch and commit:
Current origin/dev and merge base/drift:
Reused evidence matrix (artifact, source, date, scope, layer, freshness/drift, disposition):
Deployed web build/release identity:
Capacitor build/archive/TestFlight identity:
Open audit P0/current-client or shared-contract Critical:
Open unconditional P1:
Conditional P1 dispositions:
Open High and containment/acceptance:
Deferred P2/Medium/Low ledger:
Supported capability matrix:
Build/test/lint/governance/dependency results:
PWA install/offline/update/rollback evidence:
Auth/session/account-switch/mutation/media evidence:
Mac/Xcode/Simulator/device/TestFlight evidence:
Accessibility/performance/energy/observability evidence:
Release candidate, rollback, support and maintenance owner:
Independent reviewer and disposition:
Production/database/provider actions and exact authorization:
```

`READY` is valid only for the named source, deployed build, supported scope, and evidence date.
Material drift in authentication, Storage, offline queues, service worker/update behavior,
Capacitor plugins, signing, release configuration, or critical workflows reopens the affected part
of the gate.

## Hard stop

Until the owner records `NIOS-H: READY`:

- do not create or commit any Swift scaffold/project;
- do not create the native implementation branch;
- do not begin feature UI, contract callers, local persistence, capabilities, or release setup;
- do not treat planning artifacts, a green web build, Simulator output, or repository configuration
  as proof that the current operational fallback is ready.

Closing this gate still does not authorize Swift implementation. Sessions A/B, Phase 0, current
`origin/dev` reconciliation, a fresh implementation worktree, and explicit implementation authority
remain separate requirements.
