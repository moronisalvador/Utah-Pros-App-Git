# UPR Mobile PWA and Capacitor Audit — Mobile Architecture

**Evidence basis:** audited source commit `ef305f6d6afab4d846eab92fc1b04038d70221f0`, recorded
build/test results, and read-only Supabase metadata. Runtime-only claims are marked as gates.

## Current architecture

UPR is one React/Vite application with two build-time route surfaces:

```text
Vite entry
└─ persisted TanStack Query client (IndexedDB)
   └─ App providers
      ├─ web build: office routes + /tech routes
      └─ native build: auth/public-signing + /tech routes only
         └─ Capacitor iOS WebView and native plugins
```

Cloudflare Pages serves the PWA and Pages Functions. Mobile data calls use the authenticated
PostgREST/RPC client supplied by `useAuth()`, direct Storage REST requests, and selected
`/api/*` workers. The Capacitor app packages a native-target Vite bundle but connects to the same
Supabase project and business services as web. `dev` and `main` do not create separate databases.

## Route and layout architecture

`src/App.jsx` defines `TechRoutes` once and mounts it in both build targets. Web users reach it under
the full office router; native users receive only the auth/public-signing routes plus `TechRoutes`.

`TechLayout` combines two navigation models:

- Dashboard, Schedule, and Messages are persistent panes that are hidden rather than unmounted.
- Claims, tasks, details, create flows, settings, help, pricing, scope sheet, and admin screens render
  through an outlet.

This preserves scroll/state for primary tabs, but also keeps their effects, polling, and cached
queries alive while hidden. The layout performs its own assigned-task refresh in addition to
screen/query loaders, creating avoidable overlap (`MOB-PERF-007`).

Feature flags control the v2 dashboard/schedule/messages and v2 job hub. The legacy dashboard and
schedule fallbacks have been removed, so disabling certain rows can render an empty outlet rather
than a usable fallback (`MOB-ROLLOUT-004`). Flag-load failure stores an empty map, and the generic
flag helper interprets a missing row as enabled; this makes several incomplete capabilities fail
open (`MOB-ROLLOUT-005`).

## State and provider architecture

### Authentication and permissions

`AuthContext` owns the Supabase session-to-employee mapping, an identity-stable REST client, role
navigation permissions, page overrides, feature flags, push registration, and logout. This stable
client avoids refetching every `[db]`-keyed loader on token refresh, which is a sound mobile-resume
choice.

The context's role/feature checks are UI navigation controls, not a trusted authorization boundary.
Several mobile mutations rely on direct table access or privileged RPCs whose live RLS/grant model
allows broader authenticated access. Administrative and high-impact actions therefore require
server/database enforcement independent of React (`MOB-SEC-014`).

### Server-state cache

One TanStack Query client is created in `src/lib/techQuery.js` and persisted for 24 hours through
`src/lib/techQueryPersister.js`. The persistence buster is a fixed source literal in `src/main.jsx`,
not a release-derived identity. The persisted database and key are device-global; multiple important
query keys omit employee identity. Logout clears auth state but not the persisted query database,
route restoration, or all draft stores (`MOB-STATE-001`).

### Local drafts and route restoration

Installed-mode route restoration is a useful resume feature and is limited by age and route
classification. Demo/scope-sheet and conversation composer drafts use browser storage. These stores
need an explicit ownership, expiry, encryption/sensitivity, and logout-clearing policy.

### Offline mutation queue

The offline foundation uses one `upr-offline` IndexedDB database, a queue store, typed dispatchers,
blob/object stores, and a singleton background runner. It includes retry counters, exponential
backoff, temp-to-server ID swaps, and user-facing counts.

The current queue is not a safe multi-user transaction log:

- queued rows contain no authenticated user/employee owner;
- logout does not purge, quarantine, or rebind pending work;
- a later session can initialize a runner over the same rows (`MOB-DATA-002`);
- rows are marked `syncing` before dispatch, but startup only reads `pending`; a terminated app can
  strand work permanently (`MOB-OFFLINE-011`);
- multiple tabs/processes have no atomic claim/lease, and some mutations are not idempotent
  (`MOB-DATA-013`);
- photo upload writes Storage first and metadata second with a new timestamped path on retry, so an
  ambiguous failure can create orphaned objects or duplicates (`MOB-DATA-012`).

## Shared versus mobile-specific boundaries

### Healthy boundaries

- native plugin calls are mostly isolated in `src/lib/native*.js`;
- route components obtain the authenticated database client from `useAuth()`;
- v2 query helpers and route-link helpers provide some centralization;
- messaging uses the shared worker path for in-app sends;
- ErrorBoundary and stale-chunk reset behavior are shared across route trees.

### Boundary leaks

- global `src/index.css` carries the mobile system and the full office system in one large sheet;
- mobile screens mix legacy inline styles, global CSS classes, and v2 primitives;
- direct Storage URL construction/upload logic is duplicated across mobile screens;
- direct table mutations sit beside RPC-based workflows, so return/error/idempotency semantics vary;
- mobile `sms:` links bypass the governed company messaging path (`MOB-COMP-003`);
- native routes package the admin subtree even when UI guards hide it (`MOB-ARCH-006`);
- authentication, permissions, push registration, feature rollout, and native biometric behavior are
  concentrated in one large context/root path.

## Native capability abstractions

| Capability | Abstraction | Current boundary |
|---|---|---|
| Camera | `src/lib/nativeCamera.js` | Native plugin with web file-input fallback |
| Geolocation | `src/lib/nativeGeolocation.js` | Native/web capability wrapper |
| Haptics | `src/lib/nativeHaptics.js` | Best-effort, non-blocking |
| Keyboard | `src/lib/nativeKeyboard.js` | One-time native configuration |
| Appearance/splash | `src/lib/nativeAppearance.js` | Native startup behavior |
| Biometrics | `src/lib/nativeBiometric.js`, `BiometricGate` | UI gate over persisted Supabase tokens |
| OTA updater | `src/lib/nativeUpdater.js`, `src/main.jsx` | Capgo readiness notification/check helpers |
| Native push | `src/lib/pushNotifications.js` | Permission, registration, and token upsert only |
| Privacy screen | `src/lib/nativeBiometric.js` | No-op placeholder in audited source |

The wrappers are a good seam, but a wrapper is not proof of native readiness. Deep-link routing,
notification taps, foreground delivery, token removal, privacy protection, secure token storage,
release signing, and device validation remain incomplete or unverified.

## Architectural risks

1. **Trust boundary mismatch:** role/feature checks are concentrated in React while broad authenticated
   RLS/RPC contracts remain authoritative at the database (`MOB-SEC-014`).
2. **Device-global sensitive state:** caches, drafts, route restoration, push endpoints, and offline
   work lack a single session-transition policy (`MOB-STATE-001`, `MOB-DATA-002`, `MOB-PUSH-017`).
3. **Mutation semantics are fragmented:** direct REST, RPC, Storage-plus-RPC, worker calls, and offline
   dispatchers do not share idempotency, optimistic-update, or recovery contracts.
4. **Partial-offline architecture is presented as a foundation:** cached warm data and a few queue
   dispatchers exist, but the application shell cannot cold-start offline and queue recovery is unsafe.
5. **Release identity is fragmented:** web assets, persisted cache buster, Capacitor binary, Capgo bundle,
   database contract, and source commit are not recorded as one compatibility tuple.
6. **Persistent panes trade UX continuity for hidden work:** primary-tab state survives, but hidden
   effects and duplicate refreshes increase data, battery, and debugging cost.
7. **Shared CSS and mixed generations increase drift:** legacy and v2 routes must be maintained until
   a deliberate cutover retires duplicates.

## Practical target architecture

The recommended target is incremental, not a rewrite:

```text
Authenticated mobile shell
├─ explicit session-transition coordinator
│  ├─ namespaced/cleared query cache and drafts
│  ├─ owned offline queues with leases
│  └─ push-token/subscription detach
├─ mobile workflow contracts
│  ├─ server-authorized query/RPC boundary
│  ├─ idempotency key for every retryable mutation
│  ├─ typed success/error semantics
│  └─ pagination and invalidation rules
├─ stable mobile component/motion primitives
├─ PWA lifecycle
│  ├─ install/update identity and recovery
│  └─ explicitly documented online/warm-cache/offline modes
└─ native lifecycle
   ├─ secure token storage and privacy screen
   ├─ deep links and notification routing
   ├─ signed binary + OTA compatibility policy
   └─ device/release telemetry and rollback
```

The trusted authorization boundary belongs in RLS, security-invoker functions, or tightly reviewed
security-definer functions that resolve the caller and enforce role/assignment internally. The UI can
still hide actions, but it must not be the only control.

## Incremental migration approach

1. **Contain trust and privacy risks:** enforce role/assignment at the database/worker layer; make
   internal job media private; disable or hide incomplete fail-open capabilities.
2. **Make session transitions safe:** namespace or purge persisted queries, drafts, routes, push
   bindings, and offline work on login/logout/account switch.
3. **Harden mutations:** add owner, lease, idempotency key, deterministic Storage path, startup
   recovery, and explicit reconciliation for every retryable operation.
4. **Define supported offline modes:** choose cold-offline shell versus online-required startup, then
   make UI language and tests match that decision.
5. **Consolidate workflow seams:** centralize media, messaging, mobile data contracts, and query keys;
   retire legacy/v2 duplicates only after parity tests.
6. **Make native release repeatable:** repair project paths/secrets, bundle the privacy manifest,
   implement lifecycle routing and secure storage, then prove archive/TestFlight/OTA rollback on real
   devices.
7. **Raise gates:** authenticated mobile E2E, device matrix, blocking changed-file lint, actual entry
   graph/CSS budgets, client crash telemetry, and a release compatibility record.

## Architecture conclusion

The repository has credible mobile structure and meaningful field workflows, but its safety model is
still web-application-centric. Expanded production use should wait until the database authorization,
device/session state, mutation recovery, and native release boundaries become explicit, enforced,
and verified.
