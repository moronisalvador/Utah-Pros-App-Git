<!--
FILE: docs/mobile/architecture.md

WHAT THIS DOES (plain language):
  Describes the current supported architecture of UPR's field-mobile browser/PWA and Capacitor
  surfaces. It documents real boundaries, not the folder names or a future rewrite.

DEPENDS ON:
  Internal: src/main.jsx, src/App.jsx, src/components/TechLayout.jsx,
            src/contexts/AuthContext.jsx, src/lib/techQuery.js, src/lib/offlineDb.js,
            capacitor.config.json, ios/, docs/architecture.md
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
   └─ Theme → Language → BrowserRouter → route restoration → biometric UI gate → Auth
      ├─ web build: office routes plus TechRoutes
      └─ native build: login/recovery/public signing plus TechRoutes
         └─ bundled Vite assets inside Capacitor iOS
```

The native app is not a separate backend or domain model. Browser/PWA and Capacitor use the same
Supabase Auth/PostgREST/RPC/Storage/Realtime project, Pages Functions, providers, feature flags, and
business records. `dev` and production also share the Supabase project; a migration is immediately a
production change.

## Entry points and build selection

- `src/main.jsx` creates the shared query client/persister, registers or removes the push service
  worker for web, performs native updater bootstrap, and mounts `App`.
- `src/App.jsx` selects `WebRoutes` or `NativeRoutes` from `VITE_BUILD_TARGET`.
- `vite.config.js` compiles both targets; normal web build includes office and field chunks, while
  the native route tree excludes office routes at build time.
- `capacitor.config.json` packages `dist` for app ID `com.utahprosrestoration.upr` and has no remote
  `server.url`.
- `ios/App/` is the only checked-in native platform. No Android project is currently supported by
  repository evidence.

## Routing

`TechRoutes` is defined once in `src/App.jsx` and used by both builds. Its principal routes are:

- `/tech`, `/tech/schedule`, `/tech/tasks`, `/tech/claims`;
- claim/job/appointment/photo/document/room detail routes;
- customer, job, appointment, and event creation;
- `/tech/conversations`, `/tech/more`, `/tech/settings`, `/tech/help`, `/tech/feedback`;
- `/tech/tools/oop-pricing` and `/tech/tools/demo-sheet`;
- `/tech/admin/*`.

The native tree additionally contains `/login`, `/set-password`, and `/sign/:token`; root/unknown
paths redirect to `/tech`.

The admin subtree exposes Dashboard, Collections, invoice detail, estimate new/detail/edit, and lead
center routes. It is guarded in React by admin role plus `page:admin_mobile`; that guard does not
replace RLS or worker authorization. Product ownership must explicitly include or build-exclude this
subtree from native.

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
2. resolves an `employees` row;
3. creates an identity-stable authenticated REST client;
4. loads navigation permissions, feature flags, and employee overrides;
5. supplies `db`, employee, role/feature helpers, push registration, login, and logout.

Components normally obtain `db` from `useAuth()`. The Supabase JS singleton in
`src/lib/realtime.js` owns Auth/Realtime bootstrapping and worker bearer headers; it is not the
general data client.

React permissions and feature flags determine visible navigation/rollout only. Every non-public
worker/RPC/table/Storage action must independently authenticate and enforce employee role, tenant,
assignment, and object authority at the trusted boundary.

### Server state

`src/lib/techQuery.js` defines the shared query client, key factory, invalidation map, and default
stale/retry/focus/reconnect behavior. `techQueryPersister.js` persists eligible query results in
IndexedDB; raw message thread bodies are excluded.

Durable query, route, draft, queue/blob, and push state must be namespaced to the authenticated
principal and have explicit logout/account-switch semantics. A new cache key must include identity
when returned data differs by viewer.

### Local and offline state

Screen-local React state handles forms/sheets. Some forms mirror drafts to localStorage. The offline
foundation in `offlineDb.js`, `syncRunner*.js`, `dispatchers/`, and `useOfflineQueue.js` queues
selected room/photo/reading/equipment/note/task commands.

Canonical queue contract (required even where current implementation is incomplete):

- immutable authenticated owner and tenant;
- stable client operation ID and desired-state payload;
- atomic claim/lease with expiry and startup reconciliation;
- bounded timeout and classified retry;
- server idempotency or deterministic reconciliation;
- user-visible pending/syncing/error/recover/cancel state;
- explicit logout/account-switch quarantine/purge rule.

Do not add a new queued caller without satisfying that contract and documenting its dispatcher in
`data-contracts.md`.

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
- `admin-mobile` primitives/routes;
- native capability wrappers in `src/lib/native*.js` and `pushNotifications.js`.

Use shared domain logic and trusted contracts; avoid importing a desktop presentation component into
mobile merely to reuse its business rule. Conversely, do not duplicate a business rule in mobile
when it belongs in an RPC/worker/database constraint.

## PWA boundary

The PWA uses `public/manifest.json`, a push-only `public/sw.js`, service-worker registration/removal,
route restoration, query persistence, and reset/stale-chunk recovery. It does not provide a cached
cold-start shell. The supported statement is:

> Network is required for reliable startup. A previously loaded build may show cached data, and
> selected field mutations may queue; neither cold startup nor every workflow is offline-safe.

See [`pwa-and-capacitor.md`](pwa-and-capacitor.md).

## Capacitor boundary and native capability ports

Native-specific calls stay behind wrappers:

| Capability | Boundary |
|---|---|
| Camera/media | `nativeCamera.js` plus shared compression/upload |
| Location | `nativeGeolocation.js` |
| Haptics | `nativeHaptics.js` |
| Keyboard/status/splash/appearance | `nativeKeyboard.js`, native appearance helpers/plugins |
| Biometric preference | `nativeBiometric.js` and `BiometricGate` |
| OTA | `nativeUpdater.js`, main/App lifecycle |
| Push registration | `pushNotifications.js` |

Callers must degrade explicitly on web and surface permission denial/retry. A wrapper's existence is
not device or release proof. Deep links/system back/app lifecycle should be added through one App
port and an allowlisted route resolver rather than scattered platform checks.

## Incremental target architecture

Do not rewrite the application. Migrate in this order:

1. harden server authorization and private Storage without changing UI contracts;
2. introduce one account-scoped device-state lifecycle;
3. make offline commands and composite writes idempotent/recoverable;
4. define one release/compatibility identity and observable recovery boundary;
5. centralize mobile navigation/sheet/native lifecycle ports;
6. consolidate high-reuse design/motion/state primitives route by route;
7. generate the mobile data contract catalog and enforce it in tests/CI;
8. build-time include only the native capabilities/routes the product supports.

Every step preserves deployed response shapes until a reviewed compatibility migration explicitly
changes them.
