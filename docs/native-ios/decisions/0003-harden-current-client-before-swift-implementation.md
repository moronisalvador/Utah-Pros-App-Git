<!--
FILE: docs/native-ios/decisions/0003-harden-current-client-before-swift-implementation.md

WHAT THIS DOES (plain language):
  Records the owner decision to finish a supportable PWA/Capacitor hardening baseline before
  committed native Swift implementation begins.

DEPENDS ON:
  Internal: docs/native-ios/00-product-charter.md,
            docs/native-ios/17-current-client-hardening-gate.md,
            docs/native-ios/11-roadmap.md
  Data:     reads → owner decision in the 2026-07-26 planning conversation
            writes → documentation only

NOTES / GOTCHAS:
  - This decision does not authorize remediation, deployment, database, Apple, or provider work.
  - The gate is a supportable baseline, not a demand to eliminate all technical debt.
  - This decision can be superseded only by a new decision record.
-->

# ADR 0003: Harden the Current Client Before Swift Implementation

- **Status:** accepted by owner
- **Decision date:** 2026-07-26
- **Implementation status:** current-client evidence remains to be completed
- **Decision owner:** Moroni Salvador

## Context

The PWA works well enough to remain useful, and the Capacitor app is the practical iOS client while
a full native app is designed and built. The mobile production-readiness audit also identified
security, data-preservation, offline, release, and device-evidence work that cannot be ignored while
the current client serves as the fallback.

Beginning a multi-year-quality native foundation before the current client is supportable would
divide attention and leave the business dependent on a fallback with known blocking gaps. Requiring
every cosmetic or low-risk improvement first would create the opposite failure: an indefinite
perfection gate that prevents the native program from starting.

## Options considered

### Start Swift implementation immediately

This creates visible momentum, but forces two active stabilization programs and accepts avoidable
business-continuity risk.

### Finish every current-client backlog item first

This maximizes cleanup, but treats polish and long-term refactors as release blockers and can delay
the native product without improving the supported operational scope.

### Reach a supportable maintenance baseline, then start Swift

This closes or contains the security, data, release, and device risks that matter to the fallback,
records intentional deferrals, and then moves the current client into critical-fix maintenance
while native work proceeds.

## Decision

Use the third option.

- Complete and independently verify the current-client hardening gate in
  `17-current-client-hardening-gate.md` before creating or committing a Swift project or native
  implementation branch.
- Require closure of every audit P0, current-client/shared-contract Critical, and unconditional P1
  blocker.
- Require conditional P1 findings to be closed or explicitly excluded from the supported product
  promise in UI, support, tests, and release evidence.
- Allow P2/Medium/Low debt to remain only when its aggregate risk is safe, it has an owner and
  rationale, and it does not undermine the fallback or a shared backend contract.
- Keep the current client operational, releasable, backward compatible, and owned for critical
  maintenance through native cutover.
- Permit planning-only document review and disposable design artifacts before the gate only when
  the owner explicitly wants them; they confer no Swift implementation authority.
- After the gate is `READY`, still require Discovery Sessions A/B, Phase 0 closure, current
  `origin/dev` reconciliation, a fresh isolated implementation worktree, and separate authority to
  implement.

## Consequences

Positive:

- The business retains a known, supportable fallback during the native build.
- Native design can learn from a stabilized current experience and verified field behavior.
- Shared authorization, Storage, mutation, and release weaknesses are not duplicated or treated as
  Swift UI problems.
- Lower-risk debt does not become an unbounded prerequisite.

Costs and risks:

- Native implementation begins later than an immediate scaffold.
- The hardening closeout needs current browser, Mac/Xcode, physical-device, release, and
  authorization evidence.
- Material drift after the closeout can reopen part of the gate.
- A named owner must maintain the current client while the native program is active.

## Revisit conditions

Create a superseding decision record if:

- the current client is retired before native work for a separately approved business reason;
- a material incident makes the recorded baseline invalid;
- the owner changes the supported PWA/Capacitor capability matrix;
- an external Apple/provider constraint makes a required proof impossible and the owner reviews a
  narrower safe fallback scope;
- the gate is being used to require unrelated polish rather than the supportable baseline defined
  in the canonical gate document.
