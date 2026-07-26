<!--
FILE: docs/native-ios/15-completeness-gates.md

WHAT THIS DOES (plain language):
  Provides a single lifecycle ledger showing every major decision and evidence category that must
  be addressed before foundation, vertical-slice, beta, release, cutover, and retirement gates.

DEPENDS ON:
  Internal: every plan and template under docs/native-ios/
  Data:     reads → accepted decisions and implementation/release evidence
            writes → documentation status only

NOTES / GOTCHAS:
  - This ledger prevents silent omissions; it does not replace the linked detailed documents.
  - Plan coverage is not implementation proof.
-->

# Native iOS Completeness Gates

**Current status:** the planning coverage exists; owner discovery and implementation evidence do
not. Every row remains open until its named gate records evidence.

Gate abbreviations:

- **D:** owner discovery/decision
- **F:** architecture and design foundation
- **S:** each vertical slice
- **B:** internal beta/TestFlight
- **R:** production release
- **C:** cutover/retirement
- **O:** ongoing native operations

## Lifecycle ledger

| Area | Questions/evidence that cannot be skipped | First blocking gate | Detailed owner |
|---|---|---:|---|
| Product purpose | users, field context, problem, outcome, non-goals, success measures | D | `00-product-charter.md` |
| Release scope | roles, launch workflows, web-only/future/retired capabilities, parity threshold | D | `04-information-architecture-and-workflow-parity.md` |
| Owner authority | explicit choices, rejected alternatives, deferrals, revisit triggers | D | `02-owner-decisions-and-discovery.md` |
| User evidence | technician/field validation plan, representative content, usability feedback | D/F/S | `02-owner-decisions-and-discovery.md` |
| Device support | minimum iOS, oldest/current iPhone, iPad, orientation, locale, field devices | D | `02-owner-decisions-and-discovery.md`, `09-testing-and-quality.md` |
| Product identity | app name, bundle/listing relationship, branding, public/custom distribution | D/R | `10-release-app-store-cutover.md` |
| Repository/toolchain | repo placement, Xcode/Swift policy, project generation, schemes/configurations | F | `technical-architecture.md`, `14-mac-handoff.md` |
| Architecture | modules, dependency direction, state, navigation, concurrency, composition root | F | `technical-architecture.md` |
| Dependency governance | Apple-first posture, SPM admission, pin/update/removal, license/security/privacy | F/S | `technical-architecture.md` |
| Visual direction | Apple Field Pro product/experience **evolve** decision; exact owner-approved native visual translation | D/F | `02-owner-decisions-and-discovery.md`, `03a-apple-field-pro-adaptation-matrix.md` |
| Design continuity | per-screen Preserve/Translate/Adapt/Reopen/Verify classification; source maturity and justified departures | F/S | `03a-apple-field-pro-adaptation-matrix.md` |
| Design foundations | semantic color/material, Dynamic Type, spacing, safe areas, symbols, motion, content | F | `03-design-system.md` |
| Core components | complete interaction/data/connectivity/auth/permission/mutation/a11y states | F/S | `03-design-system.md` |
| Accessibility | VoiceOver, Voice Control, Switch Control, Dynamic Type, contrast, reduced settings | F/S/B/R | `03-design-system.md`, `09-testing-and-quality.md` |
| Localization/content | languages, long strings, units, dates, time zones, measurements, plain error copy | D/S/B | `03-design-system.md` |
| Workflow architecture | typed routes, entry/exit, tabs/stacks/sheets, deep links, interruption recovery | F/S | `04-information-architecture-and-workflow-parity.md`, `technical-architecture.md` |
| Data inventory | RPC/table/view/Worker/Storage/Realtime/Auth/provider contract for every workflow | S | `05-data-contracts-and-environments.md`, `contracts/` |
| Contract compatibility | DTO/version/error/null/time/pagination semantics; PWA/Capacitor compatibility | S/R/C | `05-data-contracts-and-environments.md` |
| Authentication | restore/refresh/revoke/logout/account switch, Keychain, employee resolution | F/S | `05-data-contracts-and-environments.md`, `06-security-privacy-and-compliance.md` |
| Authorization | direct server/RPC/RLS/Storage/Realtime role/assignment negatives; no UI authority | S/B/R | `06-security-privacy-and-compliance.md` |
| Environment isolation | local/QA/release/prod identity, project sentinels, no QA-to-production fallback | F/S | `05-data-contracts-and-environments.md` |
| Test identities/data | synthetic roles, immutable lineage, seed/cleanup, no production data | S | `05-data-contracts-and-environments.md`, `09-testing-and-quality.md` |
| Secrets | no service/provider/signing secret in binary/repo/log; safe configuration diagnostics | F/S/R | `06-security-privacy-and-compliance.md` |
| Privacy inventory | collected/accessed/transmitted/cached/logged/retained/deleted data and SDK manifests | F/S/B/R | `06-security-privacy-and-compliance.md` |
| Legal/compliance | privacy policy, terms, account deletion, consent/DND, signing, employee location | S/R | `06-security-privacy-and-compliance.md` |
| Threat model | assets, actors, trust boundaries, abuse cases, mitigations, residual risks | F/S/B | `06-security-privacy-and-compliance.md` |
| Local data | cache/draft/outbox/file classes, protection, migration, retention, purge/account switch | F/S | `07-offline-sync-and-reliability.md` |
| Offline semantics | per-workflow read/draft/mutation behavior, truthful sync state, unavailable actions | S | `07-offline-sync-and-reliability.md` |
| Mutation safety | stable intent/idempotency, retry, ambiguous outcome, conflict, reconciliation, receipt | S/B | `07-offline-sync-and-reliability.md` |
| Lifecycle | background/resume/termination/relaunch/memory/low-storage/update/network transitions | S/B | `07-offline-sync-and-reliability.md`, `09-testing-and-quality.md` |
| Camera/media | permission, staging, metadata, compression, upload, private access, orphan cleanup | S/B | `08-platform-capabilities.md` |
| Documents/signing | scan/import/preview/export, Storage, DocuSign sandbox/OAuth/webhook/legal boundary | S/B/R | `08-platform-capabilities.md` |
| Location | purpose, when-in-use/background, precision, retention, battery, denial/fallback | S/B/R | `08-platform-capabilities.md` |
| Notifications | APNs env/token lifecycle, content, categories/actions, foreground/cold link, denial | S/B/R | `08-platform-capabilities.md` |
| Background execution | best-effort limits, uploads/tasks, cancellation, visible recovery, no correctness dependency | S/B | `08-platform-capabilities.md` |
| Apple ecosystem/AI | availability, privacy, evaluation, deterministic fallback, human confirmation | S/B/R | `08-platform-capabilities.md` |
| Unit/component tests | domain/state/mapping/auth/offline/navigation/capability deterministic coverage | S | `09-testing-and-quality.md` |
| Contract/security tests | isolated QA allowed/denied roles, malformed/stale/duplicate/Storage/Realtime cases | S/B | `09-testing-and-quality.md` |
| UI/visual tests | XCUITest, snapshots, state matrix, themes, sizes, locales, accessibility | S/B | `09-testing-and-quality.md` |
| Real-device proof | camera, location, push, background, Keychain, keyboard, performance, field use | S/B/R | `09-testing-and-quality.md` |
| Performance/energy | numeric launch/hitch/memory/disk/network/thermal/battery budgets and regression | S/B/R | `09-testing-and-quality.md` |
| Observability | redacted events, crash/hang/sync metrics, dSYMs, retention/access/alerts | F/S/B/R | `09-testing-and-quality.md` |
| Operational support | tester feedback, support path, incident owners, runbooks, stop conditions | B/R/C/O | `10-release-app-store-cutover.md`, `11-roadmap.md` |
| Platform maintenance | Xcode/Swift/iOS/device/dependency cadence, SDK/privacy/security review | O | `11-roadmap.md` |
| Apple account lifecycle | agreements, membership, certificates, profiles, APNs keys, metadata expiry/rotation | R/O | `11-roadmap.md` |
| Signing/release | team, entitlements, privacy manifest, archive/export, TestFlight, owner approval | B/R | `10-release-app-store-cutover.md` |
| App Store | metadata, screenshots, reviewer account, privacy, encryption, age/category, account deletion | R | `10-release-app-store-cutover.md` |
| Upgrade/cutover | same/new listing decision, web-local-data policy, push/deep-link/Keychain transition | R/C | `10-release-app-store-cutover.md` |
| Rollback | phased stop, feature containment, hotfix, PWA fallback, server compatibility | R/C | `10-release-app-store-cutover.md` |
| Capacitor support/retirement | critical fixes, adoption threshold, pending work, owner retirement and cleanup | C | `10-release-app-store-cutover.md` |
| Ownership | orchestrator, single writers, disjoint paths/contracts, agent briefs, adversarial review | Every gate | `12-agent-execution-and-ownership.md`, ownership manifest |
| Documentation | ADRs, contracts, risks, canonical updates, exact evidence, handoff and recurring review dates | Every gate/O | `README.md`, `13-risk-register.md`, templates |
| Runtime safety | ≤5-minute attempts, bounded logs, guaranteed child cleanup, blocked evidence | Every runtime | `09-testing-and-quality.md`, `12-agent-execution-and-ownership.md` |

## Gate closure rule

A gate closes only when:

1. every applicable ledger row has a linked decision or evidence record;
2. every non-applicable row has a reason and approving owner;
3. every blocked row names the missing dependency and later blocking gate;
4. Critical unresolved risks block the dependent release scope;
5. an independent reviewer challenges the packet;
6. the orchestrator resolves contradictions and inspects the full diff;
7. every first-slice Apple Field Pro surface has a recorded preservation/adaptation disposition;
8. external actions are still performed only under their separate authorization.

This ledger should be copied into each major milestone packet and reduced to the rows applicable to
that milestone. Deleting a row to make a gate look complete is not an acceptable disposition.
