# UPR Mobile PWA and Capacitor Audit — Production-Readiness Scorecard

**Scale:** 0 missing/fundamentally unsafe; 1 early or severely incomplete; 2 partially implemented
with major gaps; 3 functional but inconsistent; 4 production-ready with limited gaps; 5 mature,
verified, documented, and operationally robust.

These scores describe the audited product snapshot **before remediation**. The audit and canonical
documents improve handoff quality but do not retroactively make application behavior production-ready.

| # | Category | Score | Evidence-based explanation |
|---:|---|---:|---|
| 1 | Mobile architecture | 3/5 | One shared route tree, lazy loading, stable auth DB client, v2 primitives, offline/native abstractions, and clear web/native build split exist. Mixed generations, device-global state, native admin scope, and boundary leaks remain. |
| 2 | Core workflow completeness | 2/5 | Field coverage is broad—dashboard, schedule, tasks, jobs, claims, media, clocks, messages, forms, scope sheets, and admin. Authorization, partial writes, offline guarantees, discoverability, and device proof prevent reliable end-to-end completion. |
| 3 | Navigation | 2/5 | Five-tab shell, nested routes, link helpers, route restoration, and visible back flows are substantial. Native deep links/system back/edge gesture, overlay history, unsaved work, and authenticated resume remain absent or unverified. |
| 4 | Visual consistency | 2/5 | Tokens and v2/admin primitives exist, but legacy/v2/admin styles, approximately 1,388 inline style objects, duplicated components, and inconsistent states/actions prevent one coherent system. |
| 5 | Motion and interaction quality | 2/5 | Motion tokens, View Transitions, haptics, native scrolling, and some reduced-motion rules exist. Raw durations, missing exits, fragmented sheets/toasts/gestures, partial reduced-motion, and a confirmed transform bug remain. |
| 6 | Responsive behavior | 2/5 | Safe-area variables, `100dvh`, 16px inputs, horizontal strips, and touch-sized controls show deliberate work. Authenticated routes at 320/360/375/390/412/430/768, keyboard, landscape, split view, notches, and real devices are unverified. |
| 7 | Accessibility | 2/5 | Many labels/dialog roles and a passing fixture axe scan exist. Core clickable task divs, removed nav focus, inconsistent sheet focus/return, missing authenticated scans, screen-reader/zoom/announcement proof are major gaps. |
| 8 | PWA installability | 2/5 | HTTPS/manifest fields, install prompt handling, installed detection, and route restoration make a credible install candidate. Stable ID/scope/assets and actual iOS/Android install/upgrade lifecycle are not verified. |
| 9 | Offline and update reliability | 1/5 | Warm query persistence, partial queueing, push-only SW, reset, and stale-chunk recovery exist. No cold shell, cross-account state, stranded/duplicate commands, fixed buster, and untested partial deploy/rollback dominate. |
| 10 | Capacitor/native readiness | 1/5 | A real iOS project and multiple plugins/wrappers exist. Release automation, privacy target, token protection, snapshot privacy, push, deep links, OTA readiness, signing, TestFlight, and device evidence are incomplete. |
| 11 | Authentication and authorization | 1/5 | Session restoration and employee mapping are centralized, but broad RLS and service-role QBO/notify/CallRail worker bypasses create a P0 server authorization boundary. Native session handling adds P1 risk. |
| 12 | Supabase and RPC contracts | 1/5 | The 68-RPC/17-table surface is purposeful and provenance tooling passes. Broad policies, public Storage, heterogeneous errors/shapes, unbounded sets, and multi-call mutations lack reliable authorization/contract guarantees. |
| 13 | Mutation reliability and data preservation | 1/5 | Submit states, toasts, queue/backoff, temp IDs, and some operation IDs exist. Cross-owner queueing, crash-stranded work, non-atomic media, cross-tab replay, and partial appointment/event writes are production blockers. |
| 14 | Performance | 2/5 | Builds pass, code splitting is extensive, native tree is smaller, and largest observed route is under budget. CSS exceeds budget, entry JS is above guide, hidden work/unbounded data remain, and no real-app Web Vitals/device profile exists. |
| 15 | Testing | 2/5 | 1,871 tests and 12 fixture browser checks pass, with tooling/provenance governance. They do not cover authenticated UPR journeys, negative live contracts, installed PWA, signed native, devices, offline/update, or assistive technology. |
| 16 | Observability | 1/5 | Toasts, some ErrorBoundaries, worker runs, queue counts, and provider details exist. Primary panes lack local containment; client/native crash, release/source-map, installed version, performance, and queue-fleet telemetry are absent or unverified. |
| 17 | Deployment and rollback | 1/5 | Cloudflare hashed-asset/no-cache strategy and reset recovery are useful; native workflows are deliberately paused. CI budgets/lint are non-blocking, env validation is weak, OTA/native automation is broken/unproven, and shared-DB rollback is not unified. |
| 18 | Documentation | 2/5 | Repository law, architecture/database/auth/testing documents, mobile design standards, and dated evidence are strong foundations. Before this audit there was no complete canonical mobile architecture/data/PWA/native/release set; some source comments overstate UI authorization. |
| 19 | Maintainability | 2/5 | Shared primitives, query keys, native wrappers, tests, and rich file headers help. Large global CSS/context/screens, duplicated routes/patterns, 68 heterogeneous RPCs, and separate release lanes create high change radius. |
| 20 | Overall production readiness | **1/5** | Active P0 authorization and media boundaries plus P1 data-preservation, session, native, observability, and release gates dominate otherwise substantial feature implementation. |

## Overall verdict

The mobile PWA and Capacitor application are **not production-ready as a primary daily field
interface**. A tightly controlled, online-only internal evaluation may continue only if it does not
depend on unsupported offline/native behavior and if the P0 boundaries are contained first. Broader
field adoption is not advisable at this snapshot.

This result is not a mechanical average. Security and authorization, confidential media, data
preservation, and recoverable release operations are veto dimensions: a polished route or passing
unit test cannot compensate for an authenticated worker bypass or a non-recoverable field mutation.

## Minimum requirements before expanded production usage

1. Close `MOB-SEC-014` and `MOB-SEC-015` with independent negative verification.
2. Account-scope every persisted state store and queued command.
3. Make queue claim/recovery/idempotency and photo/appointment mutations deterministic.
4. Remove or explicitly govern the `sms:` compliance escape paths.
5. Make flags fail safe and retain usable primary-route rollback.
6. Add primary-pane recovery plus release-correlated, privacy-safe web/native diagnostics.
7. Enforce environment, test, provenance, dependency, lint, bundle, and security gates before
   deployment.
8. If PWA install/offline is promised, pass the real iOS/Android install/update/offline matrix.
9. If native is released, fix session/privacy/push/OTA/deep-link/release paths and pass a clean
   archive/TestFlight physical-device gate.
10. Record an owner-approved supported capability matrix: web browser, installed PWA, iOS native,
    Android PWA/native, offline modes, admin-mobile, notifications, and account lifecycle.

## What can be deferred safely

After P0/P1 gates close, the following can be sequenced rather than block a constrained online
release:

- full visual-system consolidation (`MOB-UX-031`);
- systemic motion standardization after the localized CreatePicker defect;
- manifest screenshots/shortcuts/categories beyond stable identity/assets;
- adaptive tablet information architecture if tablets are not supported;
- broader performance optimization beyond measured budgets and unbounded-result containment;
- Android Capacitor support if the product explicitly remains iOS-native plus Android PWA.

Deferral requires documenting the supported scope and preventing UI/release material from promising
the excluded capability.

## Recommended re-audit criteria

Re-audit from a new clean snapshot only after:

- P0 and all unconditional P1 findings have reviewed remediation evidence;
- conditional P1 product decisions are signed and reflected in UI/docs/tests;
- source/live Supabase and worker authorization are recaptured read-only;
- safe synthetic authenticated browser tests and the seven-width matrix pass;
- installed iOS/Android PWA lifecycle evidence exists;
- if native is in scope, a signed TestFlight build passes the device matrix and OTA rollback drill;
- CI/deployment required checks and release manifest are independently inspected;
- the full diff contains only intended application/test/canonical documentation changes and rollback
  instructions.
