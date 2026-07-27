# UPR Mobile PWA and Capacitor Audit — Prioritized Backlog

This is an execution backlog, not authorization to remediate. Each item preserves deployed contracts
until a reviewed change explicitly replaces them. Shared Supabase work requires a serialized
production change window because `dev` and `main` use the same project.

## Immediate containment

| Finding IDs / priority | Outcome | Scope | Dependencies | Effort | Risk if deferred | Verification requirement |
|---|---|---|---|---:|---|---|
| MOB-SEC-014 / P0-1 | Every privileged mobile database/worker action enforces active employee, role, object, assignment, and tenant policy server-side | QBO invoice/estimate/payment/query; notify recipients/content/link; CallRail recordings; direct jobs/claims/admin writes; relevant RLS/RPCs | inventory current production endpoints/types read-only; provider owners; response compatibility | XL | authenticated staff can bypass UI and cause/read high-impact operations | negative tests for every role/direct bearer; provider no-op/synthetic fixtures; live read-only config; reviewed rollout/rollback |
| MOB-SEC-015 / P0-2 | Job media is confidential-by-design and writable only within documented role/path scope | `job-files`, object policies, URL helper/callers, signed/private delivery, MIME/size policy | consumer inventory; compatibility plan; Storage production window | L | continued anonymous listing/public delivery and broad insert/delete exposure | anonymous/unrelated denial; assigned/admin allow; upload/download/delete/expiry; legacy URL migration and rollback; no customer content in evidence |

## Production blockers

| Finding IDs / priority | Outcome | Scope | Dependencies | Effort | Risk if deferred | Verification requirement |
|---|---|---|---|---:|---|---|
| MOB-STATE-001, MOB-DATA-002 / P1-A | All durable device state has an owner, classification, retention, and logout/account-switch action | query cache, route state, drafts, queue/blobs, preferences, push | canonical device-data policy; stable auth/employee identity | L | cross-account reads or side effects on shared/reassigned devices | two-account matrix online/offline, token expiry, failed logout, reinstall/update, quota/eviction |
| MOB-OFFLINE-011, MOB-DATA-013 / P1-B | Queue commands use recoverable leases and end-to-end idempotency | atomic IndexedDB claim, stale-sync reconciliation, desired-state commands, server operation IDs | owner model above; RPC compatibility | L | stranded or duplicate field actions | process kill at every transition; two tabs; replay/lost response; exactly-once or explicit reconciliation |
| MOB-DATA-012 / P1-C | Photo bytes and metadata reconcile deterministically | stable object path/operation ID, bounded upload, metadata upsert, orphan repair | private Storage boundary; queue idempotency | L | missing/duplicate/orphaned restoration evidence | upload/metadata failure matrix, termination, retry, offline resume, orphan scanner/compensation |
| MOB-REL-034 / P1-D | Appointment/event intents are atomic or explicitly compensating | create/edit/delete, crew rebuild, task assignment, expected version and idempotency | authorization contracts; preserve return shapes | L | partial appointments, lost crew/tasks, ambiguous retries | inject failure after every step; concurrent edit; duplicate request; rollback/reconciliation |
| MOB-COMP-003 / P1-E | Customer messaging cannot bypass company compliance unintentionally | ActionBar/appointment/job-hub `sms:` actions, governed composer/policy | owner compliance decision; controlled synthetic recipient | M | ungoverned personal SMS, consent/audit/sender failures | DND/STOP/consent/quiet-hour/sender/audit/device-handoff tests |
| MOB-ROLLOUT-004, MOB-ROLLOUT-005 / P1-F | Flags have typed fail-safe semantics and a usable rollback path | primary panes, FeatureRoute, flag load/missing/stale/offline behavior | feature owner and legacy-retirement decision | M | blank core routes or unintended preview exposure | per-flag on/off/missing/error tests and production rollback drill |

## Stabilization

| Finding IDs / priority | Outcome | Scope | Dependencies | Effort | Risk if deferred | Verification requirement |
|---|---|---|---|---:|---|---|
| MOB-OBS-024 / P1-G | Client failures are locally recoverable and release-correlated without leaking PII | root/primary-pane boundaries, source maps, web/native error reporting, support diagnostics | privacy/retention policy; release ID | L | blank screens and slow incident diagnosis | injected render/chunk/async/native failures; redaction and release correlation |
| MOB-OPS-035 / P1-H | One blocking release manifest governs web, database compatibility, PWA, OTA, and native lanes | environment validation, required checks, branch/deploy gates, artifact provenance, rollback | owner/GitHub/Cloudflare access; P0/P1 gate definitions | L | “green build” releases without production guarantees | independent dry run, missing-secret fail-closed test, required-check inspection, rollback rehearsal |
| MOB-DEP-027 / P2-A | Every advisory is patched or explicitly time-bounded based on reachability | dependency graph and upgrade compatibility | separate remediation branch; owner risk acceptance | M | reachable known vulnerability or brittle future upgrade | reachability table, patched builds/tests, CI allowlist with expiry |

## Mobile UX and consistency

| Finding IDs / priority | Outcome | Scope | Dependencies | Effort | Risk if deferred | Verification requirement |
|---|---|---|---|---:|---|---|
| MOB-A11Y-028 / P2-B | Core tasks, tabs, sheets, and errors are semantic and focus-safe | task rows, nav focus, shared dialog/sheet focus/back, announcements | canonical components | M | assistive users cannot reliably complete work | authenticated axe, keyboard/switch, VoiceOver/TalkBack, zoom/Dynamic Type |
| MOB-UX-031 / P2-C | Highest-reuse mobile primitives replace divergent local patterns incrementally | headers, action bars, buttons, status, sheets, loader/error/empty, destructive actions | design owner; visual baselines | L | ongoing inconsistency and expensive fixes | rendered regression at 320/360/375/390/412/430/768, light/dark/reduced motion |
| MOB-UX-008 / P2-D | Scope-sheet navigation truth matches product support | More row, help, permissions, route | owner ship/hide decision; backend/provider gate | XS | technicians miss an implemented workflow or enter an unsupported one | discoverability plus save/draft/PDF/email/error/device test |
| MOB-MOTION-029, MOB-MOTION-038 / P2-E | One causal, reduced-motion-safe interaction system | route/sheet/toast/press/gesture patterns; fix CreatePicker keyframe first | design-system primitive plan | L | jank, abrupt feedback, motion accessibility debt | reduced-motion screenshots/video, perf profile, background/resume, owner-device feel check |
| MOB-NAV-032 / P2-F | Back, overlay, keyboard, unsaved-change, and system-gesture priority is documented and shared | web history, sheets, native App/back/deep-link events | deep-link plan; platform scope | M | navigation traps or accidental loss | nested route/sheet/form matrix on browsers and devices |

## Performance and reliability

| Finding IDs / priority | Outcome | Scope | Dependencies | Effort | Risk if deferred | Verification requirement |
|---|---|---|---|---:|---|---|
| MOB-PERF-007 / P2-G | Hidden tabs retain continuity without unnecessary active work | query enabling, shared badge, DOM/state retention, month cache | measurement harness | M | radio/battery/memory cost grows | request/memory/profile comparison and minimize/resume behavior |
| MOB-DATA-033 / P2-H | Growing lists have stable bounded contracts | claims, tasks, documents, schedule retention, admin ledgers | read-only query/cardinality evidence; compatible RPCs | M | increasing payload/latency/memory | query plan, cursor/order tests, last-page/concurrent-insert/slow-network |
| MOB-PERF-026 / P2-I | CSS and entry/route budgets are under binding ratchets | global CSS ownership/splitting, entry graph, CI budgets | visual regression and UI consolidation | M | slower parse/style and unchecked growth | artifact byte report plus device LCP/INP/style profile |

## PWA maturity

| Finding IDs / priority | Outcome | Scope | Dependencies | Effort | Risk if deferred | Verification requirement |
|---|---|---|---|---:|---|---|
| MOB-OFFLINE-010 / P1 conditional | Product states exactly what works online, warm-offline, and cold-offline; implementation matches | shell/cache strategy or explicit online requirement, install copy, fonts/assets | owner field-connectivity decision; Storage/state threat model | L | users rely on unavailable no-signal launch | fresh/evicted/warm install offline matrix, partial deploy, reset/rollback |
| MOB-PWA-037 / P2-J | Cache compatibility is generated from a release manifest | buster, source/binary/Capgo/database compatibility | release manifest/telemetry | S | stale incompatible query data after update | old-cache/new-bundle/rollback/account-switch tests |
| MOB-PWA-018 / P2-K | Stable install identity and verified launcher assets | manifest ID/scope, maskable/Apple PNGs, brand | product/brand approval | S | duplicate identity or poor launcher presentation | iOS/Android install/upgrade/crop/repeat-launch matrix |

## Capacitor maturity

| Finding IDs / priority | Outcome | Scope | Dependencies | Effort | Risk if deferred | Verification requirement |
|---|---|---|---|---:|---|---|
| MOB-SEC-016, MOB-PRIV-009 / P1-I | Signed native app has an approved credential/unlock/privacy lifecycle | secure storage/session, biometric policy, pause/resume snapshot protection | security/product policy; plugin review | L | session/snapshot exposure on lost/shared device | signed-device cancel/error/unavailable/background/switcher/extraction tests |
| MOB-PUSH-017, MOB-NATIVE-023 / P1-J | Native push is a governed end-to-end channel | attach/detach, APNs environment, dispatch, retry/expiry, foreground/tap/privacy | notification auth containment; deep links | XL | missing/misdirected notifications and stale devices | sandbox/TestFlight delivery, account switch, reinstall, invalid-token, tap/foreground |
| MOB-OTA-019 / P1-K | OTA only accepts healthy, compatible bundles and has proven isolation/rollback | readiness checkpoint, channel/binary/plugin/database manifest, Capgo | working pipeline/plan; telemetry | M | bad bundle strands devices | beta/prod isolation, interruption, offline boot, bad-bundle rollback/downgrade |
| MOB-NATIVE-020, MOB-NATIVE-021 / P1-L | Clean macOS checkout produces an inspectable signed TestFlight artifact | project paths, Ruby lock, signing interface, privacy target membership, archive/export | Apple account/secrets; reviewed native changes | L | no reproducible or compliant native release | clean CI archive, codesign/entitlement/privacy inspection, internal TestFlight install |
| MOB-NATIVE-022 / P2-L | Recovery/signing/push URLs enter only allowlisted native routes | schemes/domains/AASA/App plugin/auth-ready resolver | URL ownership/entitlements; push plan | L | browser fallback, lost context, unsafe navigation | cold/warm/logged-out/expired/malicious/back tests |
| MOB-NATIVE-036 / P1 conditional | Account-deletion product/store obligation is resolved | native discoverability or documented non-applicability; backend lifecycle | owner/legal/App Review | M | App Review rejection or incomplete user lifecycle | policy record, end-to-end request/deletion/retention verification |
| MOB-ARCH-006 / P2-M | Native product scope explicitly includes or excludes admin-mobile | build-time route boundary or full admin release contract | owner product decision; SEC-014 closure | M | untested financial/PII surface in field binary | bundle/route inspection and role-negative/signed-device workflow tests |

## Testing and operations

| Finding IDs / priority | Outcome | Scope | Dependencies | Effort | Risk if deferred | Verification requirement |
|---|---|---|---|---:|---|---|
| MOB-TEST-025 / P1-M | A sanitized installed-device release matrix is repeatable and blocks promotion | authenticated browser E2E, seven widths, iOS/Android PWA, signed iPhone/iPad, a11y, offline/update/push/deep-link | P0/P1-safe QA environment and identities | XL | production-only failures remain invisible | named SHA/database/channel/device/OS, observed evidence, failure disposition |

## Longer-term architecture

| Finding IDs / priority | Outcome | Scope | Dependencies | Effort | Risk if deferred | Verification requirement |
|---|---|---|---|---:|---|---|
| MOB-ARCH-006, MOB-UX-031, MOB-DATA-033 / P2-N | Mobile architecture has explicit route/capability/data ownership without a rewrite | feature modules, shared domain services, native capability ports, generated contract catalog | stabilization complete; ownership map | XL | continued cross-layer drift and broad change radius | incremental module acceptance, contract generation, unchanged behavior/device regressions |

## Optional enhancements

After all release blockers and measured P2 deficits are closed, consider manifest screenshots/
shortcuts/categories, richer install education, additional native sharing/file-preview integrations,
and adaptive tablet information architecture. These are opportunities, not substitutes for security,
data preservation, accessibility, or release proof.
