# UPR Mobile PWA and Capacitor Audit — PWA Readiness

## Verdict

UPR's manifest and HTTPS deployment make it an **installation candidate with warm-cache
continuity**, not a runtime-verified or offline-capable field PWA. Its update-recovery design is
stronger than its offline design. Expanded field reliance is blocked until the installed lifecycle
is observed on required devices, the product explicitly defines supported offline modes, and
persistent state is safe across accounts.

## Manifest assessment

`public/manifest.json:1-14` declares:

- name, short name, and description;
- `start_url: "/tech"`;
- `display: "standalone"`;
- background/theme colors;
- portrait orientation;
- 192px and 512px SVG icons with `any maskable`.

These are the core fields expected by current Chromium installation heuristics. The audit does **not**
classify the manifest as inherently un-installable merely because it lacks optional enrichment.
Current Chromium guidance is documented at
[web.dev install criteria](https://web.dev/articles/install-criteria) and
[Chrome's install-criteria update](https://developer.chrome.com/blog/update-install-criteria).

Production-quality gaps remain (`MOB-PWA-018`):

- no explicit manifest `id`, which weakens durable app identity if the start URL changes;
- no explicit `scope`, screenshots, shortcuts, categories, or display override;
- the two SVG files each declare `purpose: "any maskable"`, without evidenced safe-zone/icon
  rendering for either purpose;
- `index.html:20` supplies the SVG as `apple-touch-icon`; the repository has no dedicated PNG Apple
  touch icon;
- icon/branding assets are placeholder-grade and were not rendered across launchers.

Chrome documents the role of stable identity at
[PWA manifest `id`](https://developer.chrome.com/docs/capabilities/pwa-manifest-id).

## Installation behavior

`src/components/TechLayout.jsx:162-235` implements:

- a field-tech-only install banner;
- `beforeinstallprompt` capture and explicit Android/Chromium prompt;
- iOS Add-to-Home-Screen guidance;
- standalone detection and session-scoped dismissal.

This is useful product behavior. It is still runtime-dependent:

- `beforeinstallprompt` is browser-controlled and was not observed on production Android;
- iOS installation has no programmatic prompt;
- HTTPS, manifest/icon fetches, start URL, scope, launcher appearance, and repeat launch were not
  validated on the required devices;
- no `appinstalled` telemetry or fleet/version visibility exists.

Missing production installation/runtime proof is part of the broader `MOB-TEST-025` device gate and
is not treated as a second defect.

## Service worker

`public/sw.js` is intentionally **push only**:

- install calls `skipWaiting`;
- activate claims clients;
- push displays a notification;
- notification click focuses/navigates an existing client or opens a window;
- there is no `fetch` handler and no Cache API population.

Registration is feature-flag-mirrored through localStorage in `src/lib/registerSW.js` and
`src/main.jsx`. When the flag mirror is off, the app unregisters service workers, clears Cache API
entries, and performs a guarded reset bounce if a registration existed.

The persisted TanStack Query cache uses the fixed source literal
`BUILD_ID = "2026-07-03-web-push-f1"` as its compatibility buster
(`src/main.jsx:28,48,76-84`). It is not derived from the web/native release or source SHA, so a later
bundle can restore data produced by an incompatible prior shape unless a maintainer remembers to
edit the literal. `MOB-PWA-037` records this release-identity defect.

The lack of fetch interception is deliberate and defensible. It prevents recurrence of the prior
failure where an HTML response was cached at a hashed JavaScript URL and permanently blanked
installed clients. This is a significant strength.

It also has a direct consequence: the service worker cannot supply the application shell,
fonts, route chunks, or data on a cold offline launch.

## Caching and offline behavior

### HTTP/update caching

`public/_headers` defines:

- no-store/no-cache for `/`, HTML, and `sw.js`;
- one-year immutable caching for hashed `/assets/*`;
- `Clear-Site-Data: "cache"` and no-store on `/reset` and `/reset.html`.

`ErrorBoundary` and stale-chunk helpers expose a cache-clear/reload path without intentionally
clearing login cookies/storage. Hashed assets plus non-cached HTML are a sound web deployment pattern.

The root `_headers` file and `public/_headers` are duplicated and not identical. The built output uses
the public copy; the duplication is a low-level drift risk that should be removed or generated from
one source.

### Warm cached reads

TanStack Query data is persisted for 24 hours in IndexedDB. Installed-mode route restoration resumes a
recent eligible route. This can make a restart *look* offline-capable when the browser already has
both the current assets and cached query data.

The same behavior creates a privacy risk because the cache and restore state are device-global and
not cleared/namespaced on account change (`MOB-STATE-001`).

### Offline mutations

An IndexedDB queue and dispatchers exist for selected photos, rooms, readings, equipment, notes, and
task operations. Coverage is partial; many active screens still call RPCs/tables/Storage directly.
Queue ownership, crash recovery, atomic claim, and idempotency are unsafe (`MOB-DATA-002`,
`MOB-OFFLINE-011`, `MOB-DATA-012`, `MOB-DATA-013`).

### Cold offline

With no service-worker fetch/cache strategy, a fresh or evicted installed client cannot load the shell
offline. Google Fonts are also render-time network dependencies. `MOB-OFFLINE-010` is therefore a
confirmed P1 capability/reliability blocker if technicians are expected to open UPR in no-signal
basements or after OS eviction.

The honest supported-mode statement today is:

> UPR requires network to start reliably. A previously loaded build may show cached data, and a
> subset of field mutations may queue, but neither cold startup nor every workflow is offline-safe.

## Update lifecycle

### Strengths

- HTML and the service worker are not long-cached.
- assets are content hashed and immutable.
- lazy-chunk failure has a bounded one-time reload/reset recovery path.
- installed users can reach cache-clear recovery from ErrorBoundary.
- the service worker cannot poison application fetches.

### Risks

- the persisted-query buster is a fixed literal (`BUILD_ID` in `src/main.jsx:44-48`), not a generated
  source/release/database compatibility identity;
- long-lived installed sessions have no release telemetry or explicit “new version ready” contract;
- an application release, Capgo bundle, and shared database change are not recorded as one compatible
  version tuple;
- reset preserves device storage, which is desirable for login continuity but does not solve
  cross-account query/draft/queue privacy;
- update/rollback behavior was not tested under offline, partial asset failure, or a database-contract
  incompatibility.

## Installed-mode behavior

`RouteRestorer` runs once in standalone mode, filters auth/public/stale routes, and remembers the
latest route on navigation/background. This is a strong mobile-continuity feature.

Its state is not employee-scoped. A shared device can restore a route selected by the prior user,
and query persistence can briefly populate it with prior-user data (`MOB-STATE-001`).

## iOS limitations

- Web Push is available only to installed Home Screen web apps on supported iOS/iPadOS versions; see
  [WebKit's iOS Web Push announcement](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).
- there is no programmatic install prompt;
- browser and installed PWA storage eviction remains platform controlled;
- file/camera, background termination, keyboard, safe area, and notification behavior require real
  device proof;
- SVG Apple touch-icon behavior is not an adequate production icon strategy;
- a push subscription can survive logout unless explicitly detached (`MOB-PUSH-017`).

## Android behavior

The source has a Chromium install-prompt path and a manifest suitable for an install candidate.
There is no verified Android launcher, system-back, camera/file, notification, offline, or update
matrix. The lack of an Android Capacitor project does not prevent Android PWA support, but the two
capabilities must not be conflated.

## Security and privacy concerns

- persisted data, drafts, and route state are not account-scoped (`MOB-STATE-001`);
- queued writes can cross account sessions (`MOB-DATA-002`);
- web/native push bindings are not comprehensively removed on logout (`MOB-PUSH-017`);
- notifications can display while the application is logged out if the server still targets the
  subscription;
- job media rendered by the PWA remains in a public/listable Storage bucket (`MOB-SEC-015`);
- service-worker notification target URLs should be restricted to an approved same-origin internal
  route allowlist.

## Missing production requirements

1. owner-approved statement of online-required, warm-cache, and offline-supported workflows;
2. account-scoped cache/draft/route/queue/push lifecycle;
3. recoverable, idempotent mutation queue with complete caller coverage;
4. stable manifest identity and production icon suite;
5. real iOS and Android install/update/offline/notification matrix;
6. release/version telemetry and compatible database-contract record;
7. tests for cold offline, warm offline, cache eviction, partial deployment, reset recovery, account
   switch, and service-worker flag transitions.

## PWA conclusion

UPR's install scaffolding and stale-asset recovery are thoughtful. Its service-worker design correctly
prioritizes avoiding a known blank-screen failure. The product must therefore be described accurately:
it is not a cold-offline PWA. Until session state and offline mutations are hardened and installed
devices are tested, it should not be the sole interface a technician relies on in unreliable
connectivity.
