# UPR Mobile PWA and Capacitor Audit — Executive Summary

**Audited source:** `audit/mobile-pwa-production-readiness` at
`ef305f6d6afab4d846eab92fc1b04038d70221f0`

**Overall readiness:** **1/5 — not production-ready as a primary daily field interface**

**Findings:** **2 P0, 21 P1, 14 P2**

**Audit boundary:** documentation and read-only evidence only; no application, production database,
provider, deployment, or customer-data change

## Verdict

UPR mobile is a substantial engineered product, not a mock-up. It has a purpose-built field shell,
broad workflow coverage, a credible install-candidate manifest, thoughtful stale-asset recovery,
partial offline mutation infrastructure, many native capability wrappers, and a large passing test
suite.

It is nevertheless **not safe for broader field reliance or as a technician's sole UPR interface**.
Two current security boundaries dominate the result:

1. authenticated mobile users can bypass React roles through broad database policies and
   service-role QBO/notification/CallRail workers (`MOB-SEC-014`);
2. `job-files` is public/listable with broad authenticated insert/delete
   (`MOB-SEC-015`).

P1 session-state, offline-queue, media, multi-write, native privacy/security, OTA, observability,
release, and device-validation failures mean a user can also lose, duplicate, strand, or misattribute
field work under account changes, retries, termination, and partial failure.

A narrowly controlled **online-only internal evaluation** can continue only after P0 containment,
with synthetic/authorized data, named users/devices, explicit unsupported capabilities, and a
desktop/support fallback. That is not a production-readiness verdict.

## Strongest parts of the current implementation

1. **Mobile workflow breadth:** Dashboard, schedule, tasks, claims/jobs, rooms/readings/equipment,
   media, clocks, messages, creation forms, scope sheets, settings, and admin-mobile routes are real.
2. **Stale-asset safety:** hashed assets, non-cached HTML/SW, push-only worker, reset endpoints, and
   bounded stale-chunk recovery preserve a hard-won incident lesson.
3. **Warm continuity:** persisted queries, route restoration, stable authenticated REST client,
   reconnect/focus refresh, and persistent tabs support fast resume.
4. **Offline/native foundations:** typed IndexedDB dispatchers, retries/backoff/temp IDs, Camera/
   Location/Haptics/Keyboard/Biometric/Updater/Push wrappers, and a checked-in iOS project.
5. **Automated evidence:** 1,871 tests and 12 safe browser-fixture checks passed; tooling and
   migration-provenance governance also passed.

## Most serious risks

- trusted-worker and database authorization does not match the mobile UI;
- confidential-by-design field media uses a public/listable bucket;
- query/draft/route/queue/push state is not one coherent account lifecycle;
- queue rows can cross users, strand after termination, or run more than once;
- photo object upload and database metadata are not atomic/idempotent;
- appointment/event composite writes can partially commit;
- `sms:` handoff can bypass company consent/DND/STOP/audit controls;
- PWA cold-offline launch is absent; warm cache can make the product appear more offline-capable
  than it is;
- native bearer sessions, privacy snapshots, push, deep links, OTA, and release automation are not
  production-safe;
- authenticated device, installed-PWA, signed-native, accessibility, and release proof is missing.

## P0 findings

| ID | Finding | Immediate action |
|---|---|---|
| MOB-SEC-014 | Mobile authorization relies on bypassable UI gates | Restrict/disable affected QBO/notify/CallRail bearer paths; enforce active employee role/object/assignment server-side; replace broad high-impact RLS; run negative tests and inspect deployment reachability read-only. |
| MOB-SEC-015 | `job-files` is public and anonymously listable | Contain listing/write exposure, inventory public-URL consumers, and execute a reviewed private/signed least-privilege cutover with rollback and negative tests. |

No current object path/content was inspected and no breach is asserted. The media boundary is P0
because the workflow is designed for claim/job photos, signed PDFs, and feedback media.

## P1 findings

| ID | Production-readiness effect |
|---|---|
| MOB-STATE-001 | persisted reads/routes can cross accounts |
| MOB-DATA-002 | queued side effects have no immutable account owner |
| MOB-COMP-003 | completed device-composer SMS bypasses UPR controls |
| MOB-ROLLOUT-004 | flag-off rollback can blank Dashboard/Schedule |
| MOB-ROLLOUT-005 | generic flag failure exposes incomplete capabilities |
| MOB-PRIV-009 | native app-switcher privacy protection is absent |
| MOB-OFFLINE-010 | cold/evicted PWA cannot load offline; conditional on promised use |
| MOB-OFFLINE-011 | terminated process can strand `syncing` queue work |
| MOB-DATA-012 | photo object/metadata creation is non-atomic |
| MOB-DATA-013 | cross-process queue claim/idempotency is incomplete |
| MOB-SEC-016 | native biometric gate is UI-only; exception path can fail open |
| MOB-PUSH-017 | APNs token remains associated/targetable after logout |
| MOB-OTA-019 | OTA is accepted too early; channel/rollback compatibility unproven |
| MOB-NATIVE-020 | iOS/TestFlight automation cannot produce the intended archive |
| MOB-NATIVE-021 | app privacy manifest is absent from the checked-in target |
| MOB-NATIVE-023 | native push is registration scaffolding, not an end-to-end channel |
| MOB-OBS-024 | primary-pane errors lack containment/release-correlated telemetry |
| MOB-TEST-025 | installed-device and signed-native release gate is absent |
| MOB-REL-034 | appointment/event workflows can partially commit |
| MOB-OPS-035 | release controls do not enforce the full readiness contract |
| MOB-NATIVE-036 | native account-deletion applicability/path is unresolved |

Conditional findings must be closed or explicitly excluded from the supported release promise by an
owner decision, UI/docs, and tests; “conditional” does not mean silently ignored.

## Top missing capabilities

- server-authoritative mobile/worker authorization and private media delivery;
- account-scoped durable device data and push lifecycle;
- crash-recoverable, cross-process, idempotent offline command processing;
- transactional/compensating media and composite business mutations;
- honest online/warm/cold offline product contract;
- release-derived app/cache/database compatibility identity;
- privacy-safe client/native errors, queue health, installed-version, update, and push telemetry;
- enforced web/PWA/OTA/native release manifest and rollback;
- real installed iOS/Android PWA and signed TestFlight device/a11y matrix;
- resolved native product scope, account lifecycle, deep links, notifications, and store obligations.

## Recommended immediate action and sequence

1. **Contain P0 boundaries** without broad cleanup: QBO/notify/CallRail/server roles and `job-files`.
2. **Define supported product scope:** browser versus installed PWA/native, admin-mobile, offline
   modes, push, Android, tablets, and account lifecycle.
3. **Make device state safe:** account namespace, logout/account switch, queue ownership, leases,
   idempotency, photo reconciliation.
4. **Harden business mutations:** appointment/event and other multi-step/provider operations.
5. **Stabilize rollout/recovery/telemetry:** fail-safe flags, primary boundaries, version and support
   diagnostics.
6. **Repair release systems:** blocking configuration/security/provenance/budget gates, reproducible
   iOS archive/privacy target, OTA health/rollback.
7. **Complete synthetic authenticated and device validation:** seven widths, accessibility,
   installed PWA, signed native, offline/update/push/deep-link/account switch.
8. **Then** consolidate UX/motion/performance and re-audit from a new clean snapshot.

The smallest credible production-readiness scope is not “fix the two P0s and ship.” It is P0
containment plus account-safe persistence/queueing, deterministic critical mutations, supported-mode
truth, observable recovery, blocking release gates, and installed-device proof for every capability
the release promises.

## Explicit answers to the 24 required questions

| # | Question | Answer |
|---:|---|---|
| 1 | Is the mobile PWA safe for daily field use today? | **No.** P0 authorization/media and P1 data-preservation/release gates prevent that conclusion. |
| 2 | Is it safe as users' primary UPR interface? | **No.** It cannot be the sole interface, especially under unreliable connectivity or shared devices. |
| 3 | Is it genuinely installable and maintainable as a PWA? | It is a **manifest/HTTPS installation candidate** with install UI; actual iOS/Android installed lifecycle and maintainability are unverified. |
| 4 | Is offline behavior real, partial, misleading, or absent? | **Partial:** warm cached reads and selected queued writes are real; cold launch and many mutations are absent/unsafe. Marketing it as offline-capable would mislead. |
| 5 | Can an update break or strand installed clients? | **Yes, plausibly.** Recovery is strong for stale chunks, but fixed query buster, no compatibility manifest, untested partial deploy, and unsafe OTA leave gaps. |
| 6 | Is Capacitor production-ready or mostly scaffolding? | It is **meaningful pre-release integration**, not empty scaffolding, but not production-ready. |
| 7 | Are PWA and Capacitor likely to drift? | **Yes.** Push, deep links, storage, lifecycle, release channel, plugins, and update paths differ without one compatibility record. |
| 8 | Are mobile routes/workflows complete? | Broad but **not complete as reliable journeys**; states, authorization, offline/recovery, native lifecycle, and some discoverability are incomplete. |
| 9 | Which desktop workflows are unavailable/degraded? | Mobile omits Production boards, Property Meld/Homebuilding, full customer/CRM/marketing/campaign/report/automation/form surfaces, Encircle import, schedule templates, and most team/role/page-access/integration/template/commission/payment/account settings including deletion. Billing/collections/estimate editing is a limited admin subtree, scope sheet is hidden as Soon, and native deep-link/signing/recovery/provider flows are degraded or unproven. |
| 10 | Are navigation and back behavior reliable? | Source shows a coherent shell/history for common flows, but **native/system/edge/overlay/keyboard/deep-link back is not proven or unified**. |
| 11 | Can users lose unsaved work? | **Yes.** Partial offline coverage, termination, unowned drafts/queue, non-atomic media, and multi-write forms create loss/ambiguity paths. |
| 12 | Can duplicate submissions occur? | **Yes.** Cross-process queue claims, missing operation IDs, ambiguous media/task/provider retries, and composite writes allow duplication. |
| 13 | Can a failed request appear successful? | **Yes or ambiguous.** Swallowed subloads can appear empty; earlier steps can commit before a later failure; notification channels can skip inside a successful summary. |
| 14 | Are Supabase RPCs/direct queries appropriate and secure? | Some are appropriate and well structured, but the full surface is **not secure/reliable as a whole** due broad RLS, privileged workers, inconsistent errors, and non-transactional contracts. |
| 15 | Are RLS and RPC authorization aligned? | **No.** UI roles and intended worker roles are not consistently reconstructed at trusted boundaries. |
| 16 | Are mobile queries scalable? | **Not proven.** Messages have bounds/cursors, but claims/tasks/documents and retained schedule months have growth risks requiring plans/cardinality evidence. |
| 17 | Are design/interaction patterns consistent? | **Partially.** Strong v2/admin primitives coexist with extensive legacy/inline/duplicated systems. |
| 18 | Is there a coherent motion system? | A documented foundation exists, but implementation is **not coherently standardized** and reduced-motion/exit/gesture behavior is incomplete. |
| 19 | Are accessibility/touch usability adequate? | Touch ergonomics are often deliberate, but **accessibility is not adequate for release proof** due semantic/focus defects and missing authenticated/device AT tests. |
| 20 | What are exact P0/P1 blockers? | The 2 P0 and 21 P1 IDs are listed above and fully specified in `13-findings-ledger.md`. |
| 21 | What is the smallest credible scope to readiness? | P0 containment; account-safe state/queue; deterministic critical writes; supported-mode truth; observable recovery; enforced release gates; and device proof for promised platforms. |
| 22 | What can be deferred safely? | Full UI/motion consolidation, optional manifest enrichment, adaptive tablet IA, non-measured optimization, and Android native—only after explicit scope limits and P0/P1 closure. |
| 23 | What canonical documentation was missing? | A mobile index plus current architecture, design, motion, data contracts, PWA/Capacitor, and testing/release authority. This audit creates them. |
| 24 | What must future agents read before changing mobile code? | Root `AGENTS.md`, `CLAUDE.md`, applicable `.claude/rules/`, canonical `docs/mobile/*`, relevant core `docs/*.md`, current initiative/ownership files, `UPR-Web-Context.md`, and latest dated live evidence when data/auth/Storage is involved. |

## Documentation outcome

The audit creates the complete `docs/audit/mobile-pwa/00`–`16` evidence set and a new canonical
`docs/mobile/` documentation set. Audit files are a dated snapshot; canonical files describe the
supported current boundaries and explicitly label proposed standards/required gates. Creating those
documents does not close any product finding.
