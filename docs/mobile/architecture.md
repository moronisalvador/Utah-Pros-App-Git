<!--
FILE: docs/mobile/architecture.md

WHAT THIS DOES (plain language):
  Describes the current supported architecture of UPR's field-mobile browser/PWA and Capacitor
  surfaces. It documents real boundaries, not the folder names or a future rewrite.

DEPENDS ON:
  Internal: src/main.jsx, src/App.jsx, src/components/TechLayout.jsx,
            src/components/NativeNavigationBridge.jsx, src/contexts/AuthContext.jsx,
            src/routes/buildTargetPages.*, src/lib/pwaAccountState.js,
            src/lib/techQuery.js, src/lib/offlineDb.js, capacitor.config.json,
            ios/, docs/architecture.md
  Data:     reads → authenticated Supabase/worker contracts described in data-contracts.md
            writes → documentation only

NOTES / GOTCHAS:
  - Web/PWA and native share routes and one Supabase project.
  - Feature flags and React role gates control presentation, not trusted authorization.
-->

# Mobile Architecture

## Supported architecture

UPR is one React/Vite application with a shared field route tree and two build targets:

```text
src/main.jsx
└─ persisted TanStack Query provider
   └─ Theme → Language → BrowserRouter → Auth
      └─ account-owned route restoration + native navigation bridge
      ├─ web build: office routes plus TechRoutes
      └─ native build: login/recovery/legal/public signing plus field TechRoutes
         └─ bundled Vite assets inside Capacitor iOS
```

The native app is not a separate backend or domain model. Browser/PWA and Capacitor use the same
Supabase Auth/PostgREST/RPC/Storage/Realtime project, Pages Functions, providers, feature flags, and
business records. `dev` and production also share the Supabase project; a migration is immediately a
production change.

This chapter describes the current reviewed source checkpoint. It does not assert that the source
is deployed, that its unapplied database contracts exist live, or that installed PWA/native clients
have passed release qualification; those states are recorded separately.

## Entry points and build selection

- `src/main.jsx` creates the shared query client/persister, reconciles the push-only service worker,
  configures the native keyboard wrapper, and mounts `App`.
- `src/App.jsx` selects `WebRoutes` or `NativeRoutes` from a build-target page registry.
- `vite.config.js` aliases that registry to `buildTargetPages.web.jsx` or
  `buildTargetPages.native.jsx`. The native registry has no import path to office, CRM, billing/QBO,
  desktop settings, or admin-mobile pages, and a completed-module-graph guard independently fails
  the native build if a denied page/subtree becomes transitive.
- `npm run build:native` forces `VITE_BUILD_TARGET=native`; an arbitrary caller cannot accidentally
  package the full browser target in the native shell.
- `capacitor.config.json` packages `dist` for app ID `com.utahprosrestoration.upr` and has no remote
  `server.url`.
- `ios/App/` is the only checked-in native platform. No Android project is currently supported by
  repository evidence.

## Routing

`TechRoutes` is defined once in `src/App.jsx` and used by both builds. Its principal field routes
are:

- `/tech`, `/tech/schedule`, `/tech/tasks`, `/tech/claims`;
- claim/job/appointment/photo/document/room detail routes;
- customer, job, appointment, and event creation;
- `/tech/conversations`, `/tech/more`, `/tech/settings`, `/tech/help`, `/tech/feedback`;
- `/tech/tools/oop-pricing` and `/tech/tools/demo-sheet`.

The native tree additionally contains `/login`, `/set-password`, `/privacy`, `/terms`, `/support`,
`/sign/:token`, and the compatible short signing route `/s/:code`; root/unknown paths redirect to
`/tech`.

The web tree retains `/tech/admin/*`, office, desktop settings, CRM, billing/QBO, and all existing
browser routes. Native explicitly omits `/tech/admin/*`; React role gates on the web still do not
replace RLS or worker authorization.

## Layout and navigation

`src/components/TechLayout.jsx` owns:

- the five primary destinations: Dashboard, Claims, Schedule, Messages, More;
- safe-area-aware bottom navigation and the mobile scroll container;
- install guidance, offline/sync status, toast rendering, and assigned-task refresh;
- three persistent v2 panes—Dashboard, Schedule, Messages—shown/hidden by current route;
- an `<Outlet>` for all other field/admin routes.

Persistent panes preserve scroll/interaction state. Some query/background work and DOM remain while
hidden; several expensive listeners are correctly active-gated. New work must not assume hidden
means unmounted.

`RouteRestorer` resumes an eligible recent route only in standalone display mode. It is a continuity
feature, not an authentication/authorization mechanism, and its persisted key must follow the
account-lifecycle policy.

## Provider and state boundaries

### Authentication

`AuthContext`:

1. restores the Supabase Auth session;
2. resolves the caller through selector-free `get_my_employee_profile()` rather than trusting an
   email or browser-selected employee row;
3. creates an identity-stable authenticated REST client;
4. loads navigation permissions, feature flags, and employee overrides;
5. reconciles account-owned device state and publishes an opaque owner/login-epoch lease;
6. supplies `db`, employee, role/feature helpers, gated Push registration, login, and logout.

Web Push and APNs detachment write an opaque owner-bound pending journal before server/local
cleanup. The journal survives reload/crash and contains only the opaque owner fingerprint,
endpoint/token, and local-cleanup proof—no employee/Auth identity. It cannot be consumed or
relabeled by a different account and clears only after the owner-scoped void delete plus local
unsubscribe/unregister/storage cleanup is verified. Direct A→B transition retains A's token-bound
client and blocks B profile, owner lease, and Push publication until A cleanup. If a reloaded B
session encounters A's journal, B is locally signed out without using B credentials against A's
RPC; A must reauthenticate to complete cleanup.

Rejected authenticated bootstrap now exposes Login only after account-device cleanup returns ready
and local Supabase sign-out returns a strictly valid success or a nested `SIGNED_OUT` observer
proves session loss. A sign-out error or malformed response retains the token-bound client and
principal behind the retry hard lock. Bootstrap rejects malformed employee profiles, role/
navigation permissions, personal page-access rows, and feature flags before publishing UI
authority. `PASSWORD_RECOVERY` preserves the recovery session but reaches SetPassword only after
cleanup; failure/reload stays locked and retries cleanup. This closes the identified source
residuals. The Supabase `onAuthStateChange` callback records each event and returns synchronously;
a serialized next-macrotask queue processes events in callback order, so nested cleanup/sign-out
cannot wait on the SDK's observer lock. The independent final spot-check found no P0/P1 and its
45 race tests passed. Browser/native device proof remains separate.

Components normally obtain `db` from `useAuth()`. The Supabase JS singleton in
`src/lib/realtime.js` owns Auth/Realtime bootstrapping and worker bearer headers; it is not the
general data client.

React permissions and feature flags determine visible navigation/rollout only. Every non-public
worker/RPC/table/Storage action must independently authenticate and enforce employee role, tenant,
assignment, and object authority at the trusted boundary.

### Server state

`src/lib/techQuery.js` defines the shared query client, key factory, invalidation map, and default
stale/retry/focus/reconnect behavior. `techQueryPersister.js` persists eligible query results in
IndexedDB under the exact current opaque owner plus epoch; raw message thread bodies are excluded.
Pre-auth persistence is inert, a stale tab cannot relabel a late write, and Auth restores only
after the owner lease is current.

Durable query, route, draft, queue/blob, and push state must be namespaced to the authenticated
principal and have explicit logout/account-switch semantics. A new cache key must include identity
when returned data differs by viewer.

### Local and offline state

Screen-local React state handles forms/sheets. Some forms mirror drafts to localStorage. The offline
foundation in `offlineDb.js`, `syncRunner*.js`, and `useOfflineQueue.js` now admits zero production
commands. The hook exposes no enqueue/retry API, the runner imports no dispatchers, and photo,
reading, equipment placement/removal, room, note, and task writes are all online-only. Existing
dispatcher files and stable-ID server contracts are not shipped offline workflows.

The retained historical-state boundary implements:

- immutable opaque owner plus login epoch;
- owner-bound queue, photo/blob, room/cache, and temporary-ID stores;
- synchronous maintenance suspension before account cleanup;
- preservation/quarantine of legacy, foreign-owner, malformed, and unsupported durable rows;
- IndexedDB v3 owner, owner/status, and owner/status/type indexes; count-only quarantine inspection;
  and no foreign/legacy payload or photo-blob scans;
- durable success cleanup, 24-hour retention, and bounded pruning of at most 50 cleaned successes
  per pass;
- bounded typed open/blocked/version-change states with operator guidance and automatic connection
  close when another tab upgrades;
- a blocking legacy/unsupported rollout gate that never adopts unknown rows and exposes only an
  exact-confirmation all-store discard action;
- lease/epoch revalidation around asynchronous transaction writes.

Automatic production admission/replay is deliberately empty. Historical owner rows in every
offline store are surfaced as counts only and block rollout without payload/blob inspection or
adoption. The accessible escape is a two-click, exact-confirmation discard of every local offline
store on the device. Existing completed-photo residues are cleanup-only, retry-limited, selected by
a time-rotating key-only window, and never sent. Do not enable replay or add a queued caller without
satisfying the full contract and documenting its dispatcher in `data-contracts.md`. The value-free
catalog evidence for future idempotency decisions is
[`../audit/2026-07/evidence/mobile-offline-replay-live-contract-2026-07-26.md`](../audit/2026-07/evidence/mobile-offline-replay-live-contract-2026-07-26.md);
it does not authorize replay and records that authorization inside the three definer RPCs remains a
separate live database boundary.

At the 2026-07-27 offline-remediation checkpoint (`3da70e5`), the focused zero-replay/
legacy-maintenance lane passed 58/58, the complete unit lane passed 90 files/1079 tests, Worker
passed 99 files/1476 tests, QA passed 25 files/206 tests, and web/native builds passed. Full lint
reported 310 findings, and preflight reported 0 errors/2 expected warnings (dirty integration tree and optional GitHub delivery
unavailable). Independent review found no actionable offline P0/P1. Real multi-tab and
representative browser/PWA/native device proof remain separate, as do the live definer-RPC
authorization gap and the changed-file lint ratchet.

## Data-access architecture

Mobile routes use four access modes:

1. authenticated PostgREST direct table operations through `db`;
2. authenticated Postgres RPCs through `db.rpc`;
3. direct Storage REST for selected media;
4. Pages Functions for secrets, providers, privileged aggregation/side effects.

Realtime supplies message changes. Direct access is acceptable only when RLS/constraints enforce the
complete rule and the operation does not require transaction/idempotency beyond one row. Composite,
money, company-message, provider, public-token, and privileged actions belong at a trusted boundary
with server authorization.

The important workflow contracts and current caveats are in [`data-contracts.md`](data-contracts.md).
Never infer live behavior only from client call shapes; inspect migrations/functions/policies/grants,
callers, and read-only live catalog evidence.

## Shared and mobile-specific components

Shared:

- Auth/theme/language, toast, ErrorBoundary, Modal, public signing;
- Supabase REST/Realtime, worker headers, media compression/URL helpers;
- job/customer/claim domain and provider/database contracts.

Mobile-specific:

- `TechLayout`, v2 Dashboard/Schedule/Messages/Job Hub;
- field sheets, albums, room/read/equipment/time components;
- tech query/persistence/offline layers;
- native capability wrappers in `src/lib/native*.js` and `pushNotifications.js`.

The web product additionally owns the `admin-mobile` implementation. It is intentionally outside
the native module graph.

Use shared domain logic and trusted contracts; avoid importing a desktop presentation component into
mobile merely to reuse its business rule. Conversely, do not duplicate a business rule in mobile
when it belongs in an RPC/worker/database constraint.

## PWA boundary

The PWA uses `public/manifest.json`, a push-only `public/sw.js`, service-worker registration/removal,
route restoration, query persistence, and reset/stale-chunk recovery. It does not provide a cached
cold-start shell. The supported statement is:

> Network is required for reliable startup and every field write. A previously loaded build may
> show cached data, but no field mutation queues.

See [`pwa-and-capacitor.md`](pwa-and-capacitor.md).

## Capacitor boundary and native capability ports

Native-specific calls stay behind wrappers:

| Capability | Boundary |
|---|---|
| Camera/media | `nativeCamera.js` plus shared compression/upload |
| Location | `nativeGeolocation.js` |
| Haptics | `nativeHaptics.js` |
| Keyboard/status/splash/appearance | `nativeKeyboard.js`, native appearance helpers/plugins |
| Biometric sign-in verification | `nativeLoginVerification.js` plus `nativeBiometric.js`; invoked only before a native password sign-in |
| Native URL/push navigation | `nativeAppLinks.js`, `nativeNavigationCoordinator.js`, and `NativeNavigationBridge` |
| OTA | Official app exact-default-off in `nativeUpdater.js`; isolated UPR Dev canary uses `NativeUpdateHealthGate.jsx`, generated dev-only config, encrypted manual publish, signed-artifact verification, stop and rollback |
| Push registration | `pushNotifications.js`; exact-default-off enrollment plus mounted event listeners |
| Background privacy | native `AppDelegate.swift` opaque app-switcher shield |

Callers must degrade explicitly on web and surface permission denial/retry. A wrapper's existence is
not device or release proof. Native cold/warm URLs and Push actions now use one App port and an
allowlisted resolver; system-back/overlay policy and real-device lifecycle remain qualification
work rather than permission to scatter new platform checks.

## Incremental target architecture

Do not rewrite the application. Migrate in this order:

1. harden server authorization and private Storage without changing UI contracts;
2. introduce one account-scoped device-state lifecycle;
3. keep offline command admission disabled unless a future approved command is independently
   idempotent/recoverable;
4. define one release/compatibility identity and observable recovery boundary;
5. centralize mobile navigation/sheet/native lifecycle ports;
6. consolidate high-reuse design/motion/state primitives route by route;
7. generate the mobile data contract catalog and enforce it in tests/CI;
8. build-time include only the native capabilities/routes the product supports.

Every step preserves deployed response shapes until a reviewed compatibility migration explicitly
changes them.
