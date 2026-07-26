<!--
FILE: docs/native-ios/templates/decision-record.md

WHAT THIS DOES (plain language):
  Provides a reusable architecture, product, security, and release decision record for native iOS.

DEPENDS ON:
  Internal: docs/native-ios/12-agent-execution-and-ownership.md
  Data:     reads → repository, official, owner, and test evidence
            writes → an explicit proposed or accepted decision

NOTES / GOTCHAS:
  - A proposal is not approved until the named owner records acceptance.
  - A decision record does not authorize production, provider, signing, or release actions.
-->

# Decision Record: [Short title]

- **ID:** NIOS-ADR-000
- **Status:** proposed | accepted | superseded | rejected | deferred
- **Date:**
- **Decision owner:**
- **Authors/reviewers:**
- **Applies to phases/slices:**
- **Supersedes:**
- **Related contracts/files/issues:**

## Decision

State the decision in one or two precise sentences. If status is `proposed`, say what cannot proceed until acceptance.

## Context

Describe the user/business need, current behavior, constraints, and why a decision is required now.

### Evidence

Use only the canonical evidence labels and add provenance separately:

- **Verified** — provenance:
- **Source-confirmed** — provenance:
- **Inferred** — provenance:
- **Blocked** — missing dependency:
- **Owner gate** — decision/access/authority needed:
- **Not tested** — reason:

Decision state is separately `proposed`, `approved`, `deferred`, or `superseded`.

Repository declarations, live/provider state, and implementation/device proof must remain separate.

## Constraints and invariants

- Security/authorization:
- Privacy/retention:
- Offline/reliability:
- Accessibility:
- Performance/energy:
- Compatibility/PWA/Capacitor:
- App Store/provider:
- Production and database authority:

## Options considered

### Option A — [Name]

- Benefits:
- Costs/risks:
- Dependencies:
- Reversibility:
- Evidence:

### Option B — [Name]

- Benefits:
- Costs/risks:
- Dependencies:
- Reversibility:
- Evidence:

### Option C — [Name, if needed]

- Benefits:
- Costs/risks:
- Dependencies:
- Reversibility:
- Evidence:

## Rationale

Explain why the selected option best satisfies the constraints. Identify material uncertainty rather than converting it into confidence.

## Consequences

### Positive

-

### Negative/tradeoffs

-

### New obligations

-

## Implementation boundary

- Owned paths/contracts:
- Required canonical-document updates:
- Required tests/evidence:
- Migration/compatibility behavior:
- Rollback/disable path:
- Explicitly out of scope:

This record does not itself authorize production writes, database/provider changes, signing, upload, submission, release, or destructive cleanup.

## Owner and external gates

| Gate | Owner | Evidence required | Status |
|---|---|---|---|
|  |  |  | open |

## Validation and revisit

- Success measures:
- Stop conditions:
- Revisit trigger/date:
- Superseding record when changed:

## Approval

- [ ] Decision owner accepted the decision.
- [ ] Security/privacy review completed where applicable.
- [ ] Platform/provider feasibility verified where applicable.
- [ ] Canonical documents updated.

Approval evidence:
