<!--
FILE: docs/native-ios/13-risk-register.md

WHAT THIS DOES (plain language):
  Tracks the principal product, architecture, data, security, delivery, and cutover risks for the
  native iOS initiative and ties each one to a mitigation and release gate.

DEPENDS ON:
  Internal: docs/native-ios/00-product-charter.md, docs/native-ios/11-roadmap.md,
            docs/upr-unfinished-work-registry.md
  Data:     reads → current source/canonical evidence and owner direction
            writes → documentation only

NOTES / GOTCHAS:
  - Risk status is planning state, not evidence that a mitigation has been implemented.
  - The register must be reviewed at each phase boundary.
-->

# Native iOS Risk Register

Severity expresses credible impact, not implementation priority. `Open` means the mitigation has
not yet been proven. Owners are roles until the project owner assigns people.

## Severity rubric

Severity is impact if the risk/finding occurs. Priority, implementation status, evidence strength,
gate state and release disposition are separate fields.

| Severity | Impact threshold | Default disposition |
|---|---|---|
| **Critical** | Unauthorized cross-user/company data or authority; secret exposure; production-environment confusion; irreversible data loss; uncontrolled money, payroll, messaging, signing, consent/deletion or provider effect; release integrity compromise | Stop the affected lane/release. Require proven containment and accountable owner; residual acceptance must be explicit. |
| **High** | Required workflow cannot be completed safely/accessibly/reliably; systemic architecture/contract/offline/privacy flaw; likely major rework or broken upgrade/cutover; material battery/performance or operational failure | Blocks the dependent phase gate unless corrected or explicitly accepted with bounded containment and follow-up. |
| **Medium** | Material but localized quality, maintainability, evidence or operational gap with a safe workaround; no immediate sensitive-boundary failure | Assign owner and due gate. Safe unrelated work may continue. |
| **Low** | Limited polish, clarity or low-likelihood maintainability issue that does not threaten the required outcome | Track in normal backlog; does not independently block a gate. |

If likelihood materially changes prioritization, record likelihood separately. Never downgrade impact
because evidence is missing; label the evidence `Blocked` or `Not tested`.

| ID | Risk | Severity | Current status | Required mitigation / evidence | Gate / accountable role |
|---|---|---:|---|---|---|
| NIOS-001 | A screen-first rewrite hardens wrong architecture or product assumptions | High | Open | owner workshop, ADRs, representative prototypes, first vertical slice before scale | Phase 0 / product owner |
| NIOS-002 | The approved Apple Field Pro product/experience blueprint is copied literally without native/field adaptation, or is treated as preapproval of the exact native visual system | High | Open | bounded **evolve** decision plus adaptation matrix; native tokens, representative prototypes, owner and technician/device review | Design foundation / design owner |
| NIOS-003 | A speculative “complete” component library delays learning and is later discarded | Medium | Open | complete global foundations and the selected slice's required state matrix; graduate additional workflow-proven components only | Design foundation / design owner |
| NIOS-004 | Direct Swift queries/RPC calls drift from live signatures, grants, RLS, or failure behavior | Critical | Open | versioned contract registry, source/live read-only verification, generated/fixture decoding tests | Every slice / data-contract owner |
| NIOS-005 | Client role checks are mistaken for authorization | Critical | Open | trace Auth→employee→Worker/RPC/RLS/Storage/Realtime; direct negative tests | Every sensitive slice / security owner |
| NIOS-006 | Shared `dev`/production Supabase is used for native write testing | Critical | Open | fail-closed project sentinels; governed local database and dedicated hosted QA before automation | Before write tests / QA + DB owners |
| NIOS-007 | Existing broad RLS/`SECURITY DEFINER` or Storage findings expose new native paths | Critical | Open | classify each consumed boundary; close P0 dependencies separately; no UI workaround | Contract readiness / security + DB owners |
| NIOS-008 | Mobile binary contains service-role/provider secrets or over-privileged tokens | Critical | Open | public client credential only; Keychain session policy; secret scan; server-side provider calls | Foundation and release / security owner |
| NIOS-009 | Dual clients break because backend changes are not backward-compatible | Critical | Open | additive/versioned contracts, compatibility fixtures, coordinated deployment ordering, retirement policy | Every backend change / API owner |
| NIOS-010 | Offline retry duplicates notes, uploads, documents, messages, signatures, or money effects | Critical | Open | durable intent, stable idempotency, operation state machine, failure injection, reconciliation | Before enabling each mutation / reliability owner |
| NIOS-011 | Conflict handling silently overwrites newer server work | High | Open | per-entity merge policy, version/precondition semantics, conflict UI, audit trail | Offline-capable slice / domain owner |
| NIOS-012 | Drafts or queued work leak across users after sign-out/device sharing | Critical | Open | user-scoped encrypted storage, purge/retention policy, account-switch and remote-revocation tests | Auth/offline foundation / security owner |
| NIOS-013 | Photos, documents, signatures, or signed URLs leak through cache/log/artifacts | Critical | Open | classification, file protection, private Storage, expiring access, redacted evidence, purge tests | Media/document slice / privacy owner |
| NIOS-014 | Camera/upload flows lose work under memory pressure, backgrounding, or poor network | High | Open | local durable staging, resumable/observable state, compression budget, lifecycle/device tests | Media slice / reliability owner |
| NIOS-015 | Location drains battery, collects more than needed, or violates user expectation | High | Open | purpose/minimization decision, When-In-Use default, accuracy/duration budgets, visible state, field tests | Location slice / product + privacy owners |
| NIOS-016 | APNs, deep links, notification actions, or token rotation work only in simulator/repository | High | Open | environment-specific entitlements, provider/config evidence, real-device delivery/action tests | Notification beta gate / platform owner |
| NIOS-017 | DocuSign/e-signature integration bypasses identity, consent, audit, or provider sandbox rules | Critical | Open | provider threat model, sandbox, server-side OAuth/webhooks, idempotency, legal/retention review | E-signature phase / integration + legal owners |
| NIOS-018 | Background work is designed beyond iOS scheduling guarantees | High | Open | foreground-safe workflow, queued state, bounded background tasks, system-denial tests | Reliability foundation / platform owner |
| NIOS-019 | Realtime subscriptions overfetch, leak rows, duplicate state, or drain battery | High | Open | channel authorization, lifecycle ownership, bounded subscriptions, reconnect tests, energy profiling | Realtime slice / data + performance owners |
| NIOS-020 | Accessibility is retrofitted after custom UI choices | High | Open | accessibility annotations at design review; component/screen/device matrix from Phase 0 | Every design gate / design + QA owners |
| NIOS-021 | Minimum-device performance, memory, thermal, or battery problems surface late | High | Open | device/OS matrix and budgets before implementation; Instruments/MetricKit evidence by phase | Every beta / performance owner |
| NIOS-022 | Unreleased or device-limited Apple AI capability becomes a core dependency | Medium | Open | optional adapter, availability checks, non-AI fallback, privacy/model evaluation, public SDK only | Capability approval / architecture + product owners |
| NIOS-023 | Third-party SDK supply-chain, privacy-manifest, or API churn creates release risk | High | Open | dependency ADR, minimal SDK set, SPM pin/update policy, license/privacy/security review | Dependency addition / architecture owner |
| NIOS-024 | App Store listing/bundle migration breaks upgrades, Keychain, deep links, push, or user trust | Critical | Open | explicit same-vs-new bundle ADR, upgrade rehearsal, listing/cutover/rollback runbook | Cutover / release owner |
| NIOS-025 | Public App Store review, privacy answers, entitlements, or account deletion blocks release | High | Open | refresh Apple requirements, metadata/privacy inventory, review credentials and rehearsal | Submission / release + owner |
| NIOS-026 | Production telemetry is absent or contains sensitive data | High | Open | redacted schema, consent/retention/access decision, alert tests, release/build correlation | Beta / observability + privacy owners |
| NIOS-027 | A long rewrite produces no usable feedback until late | High | Open | thin end-to-end slice, owner field review, bounded waves, stop/replan criteria | Phase 2 / orchestrator |
| NIOS-028 | Agents edit shared hotspots or independently reinterpret the schema | High | Open | binding ownership manifest, one coordinated data lane, reconciliation review | Every wave / orchestrator |
| NIOS-029 | Capacitor maintenance stops before native replacement is proven | High | Open | named operational owner, critical-fix policy, independent release path until cutover | Whole initiative / product owner |
| NIOS-030 | Documentation and contract catalogs drift from code/live state | High | Open | source SHA, generated checks, owner per entry, freshness rules, phase close-out updates | Every phase / documentation owner |
| NIOS-031 | Owner approval is mistaken for representative technician usability evidence | High | Open | task-based session with at least one representative field technician before first-slice acceptance/foundation freeze; otherwise named human gate | First slice / product + design owners |
| NIOS-032 | Starting native design from a blank page discards owner-locked Apple Field Pro layouts, workflow decisions, and refinements | High | Open | screen-by-screen preservation matrix; source citations; deviation record and owner approval before departure | Discovery and every slice / orchestrator + design owner |
| NIOS-033 | Preserving Apple Field Pro polish without learning from the current PWA produces text, density, reach, or targets that fail gloves, sunlight, older users, or stress | High | Open | same-content PWA/Apple Field Pro/SwiftUI comparison; 48-point field-action floor; large text and representative technician/device validation | Foundation and every field slice / design + QA owners |

## Phase review rule

At each phase close:

1. add newly discovered risks without renumbering existing IDs;
2. attach evidence to mitigations that were actually verified;
3. distinguish accepted residual risk from missing work;
4. escalate any Critical risk that lacks an owner or safe containment;
5. block the dependent release gate, not unrelated progress;
6. update the canonical unfinished-work registry when the risk becomes cross-initiative work.
