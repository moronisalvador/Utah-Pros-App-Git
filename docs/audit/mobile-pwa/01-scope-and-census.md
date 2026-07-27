# UPR Mobile PWA and Capacitor Audit — Scope and Census

**Audit status:** read-only production-readiness assessment

**Audited source:** `audit/mobile-pwa-production-readiness` at `ef305f6d6afab4d846eab92fc1b04038d70221f0`

**Base captured from:** clean `origin/dev`

**Audit started:** 2026-07-24T23:39:24.492-06:00

**Production-data policy:** metadata and aggregate/catalog evidence only; no business rows, object contents, identities, logs, secrets, or mutations

## Scope boundaries

This audit covers the field-facing React routes under `/tech`, installed-web behavior, the Capacitor
iOS wrapper, mobile-specific state and native abstractions, and the Supabase/Storage contracts those
surfaces call. It also follows critical workflows into shared components, Cloudflare Pages Functions,
SQL migrations, CI/release configuration, tests, and canonical project documentation.

The audit does **not**:

- modify application code, generated native projects, dependencies, migrations, policies, functions,
  grants, buckets, production configuration, or production data;
- deploy, apply migrations, send messages, move money, invoke business mutations, sync Capacitor, or
  create an Xcode archive;
- treat a successful web build or credential-free fixture test as signed-iOS, device, authenticated
  workflow, provider, or production proof;
- import the unrelated 584-file change set visible in the user's ordinary `dev` checkout.

The audited commit was the fetched `origin/dev` head when the branch was created. `origin/dev`
advanced after capture; the audit deliberately preserves the recorded source snapshot instead of
silently changing code underneath the evidence.

## Method and evidence model

The work was divided into eight bounded workstreams:

1. repository orientation and mobile route/workflow census;
2. design system, responsive behavior, accessibility, and device compatibility;
3. motion, animation, gestures, and interaction consistency;
4. manifest, service worker, installation, offline behavior, and web update lifecycle;
5. Capacitor configuration, plugins, lifecycle, deep links, push, and native release readiness;
6. one coordinated Supabase/RPC/RLS/Storage contract review;
7. performance, reliability, mutation safety, testing, observability, and release operations;
8. independent adversarial cross-check after specialist normalization.

Evidence labels used throughout the audit:

- **Verified source fact:** directly observable in the audited commit.
- **Verified command result:** produced by a recorded local or read-only external command.
- **Verified live metadata:** read-only catalog/configuration evidence; never business-row contents.
- **Inference:** a likely runtime consequence derived from source or platform behavior.
- **Unknown / human gate:** requires authenticated use, a real device, signing, provider access, or an
  owner decision.

## Repository areas inspected

| Area | Primary paths | Purpose in this audit |
|---|---|---|
| Application entry and routing | `src/main.jsx`, `src/App.jsx` | Provider order, native/web route split, update and service-worker boot |
| Mobile shell | `src/components/TechLayout.jsx` | Persistent tabs, route restoration, background refresh, offline status |
| Mobile pages | `src/pages/tech/`, `src/pages/tech/v2/` | Screen, workflow, mutation, and state census |
| Mobile components | `src/components/tech/`, `src/components/admin-mobile/` | Sheets, media, time tracking, navigation, touch patterns |
| Shared state and auth | `src/contexts/AuthContext.jsx`, `src/lib/techQuery*`, `src/lib/realtime.js` | Session, flags, cache persistence, authorization assumptions |
| Offline foundation | `src/lib/offlineDb.js`, `src/lib/syncRunner*.js`, `src/lib/dispatchers/`, `src/hooks/useOfflineQueue.js` | Queue ownership, retry, crash recovery, idempotency |
| PWA | `public/manifest.json`, `public/sw.js`, `src/lib/registerSW.js`, `public/reset*`, `_headers` | Install identity, push worker, cold-offline and update behavior |
| Capacitor/iOS | `capacitor.config.*`, `ios/`, `src/lib/native*.js`, `src/lib/pushNotifications.js` | Native bridge, permissions, privacy, lifecycle, push |
| Release automation | `.github/workflows/`, `ios/fastlane/`, `ios/Gemfile` | CI, OTA, TestFlight, signing and rollback |
| Database contracts | mobile call sites, `supabase/migrations/`, `docs/audit/2026-07/evidence/live-supabase.md` | RPC bodies/grants, RLS dependencies, Storage and drift |
| Tests and standards | `tests/`, `src/**/*.test.*`, `functions/**/*.test.*`, `.claude/rules/` | Existing proof and required production gates |

## Entry points and route shells

`src/main.jsx` mounts one persisted TanStack Query client above `App`. `App` then supplies theme,
language, browser routing, route restoration, biometric gating, and authentication. The effective
order is:

`PersistQueryClientProvider → ThemeProvider → LanguageProvider → BrowserRouter → RouteRestorer → BiometricGate → AuthProvider`

The build target controls the route tree:

- **Web/PWA:** the full office application plus `/tech/*`.
- **Native:** login, password recovery, public signing, and the complete `TechRoutes` tree; `/` and
  unknown paths redirect to `/tech`.

`TechLayout` supplies five persistent bottom-tab destinations: Dashboard, Claims, Schedule, Messages,
and More. The v2 Dashboard, Schedule, and Messages panes remain mounted and are shown/hidden inside
the shell; detail and create screens render through an outlet.

## Mobile route census

### Auth/public/fallback routes in the native build

| Route | Screen | Main file | Notes |
|---|---|---|---|
| `/login` | Login | `src/pages/Login.jsx` | Supabase email/password entry |
| `/set-password` | Password recovery | `src/pages/SetPassword.jsx` | Recovery-token flow |
| `/sign/:token` | Public document signing | `src/pages/SignPage.jsx` | Logged-out workflow; shared with web |
| `/` | Native redirect | `src/App.jsx` | Redirects to `/tech` |
| `*` | Native fallback | `src/App.jsx` | Redirects to `/tech` |

### Field routes

| # | Route | Screen/workflow | Primary implementation |
|---:|---|---|---|
| 1 | `/tech` | v2 technician dashboard | `src/pages/tech/v2/TechDashV2.jsx` |
| 2 | `/tech/schedule` | v2 schedule/agenda | `src/pages/tech/v2/TechScheduleV2.jsx` |
| 3 | `/tech/tasks` | assigned task checklist | `src/pages/tech/TechTasks.jsx` |
| 4 | `/tech/claims` | technician/all-claims list | `src/pages/tech/TechClaims.jsx` |
| 5 | `/tech/claims/:claimId` | claim overview and actions | `src/pages/tech/TechClaimDetail.jsx` |
| 6 | `/tech/claims/:claimId/photos` | claim photo album | `src/pages/tech/TechClaimAlbum.jsx` |
| 7 | `/tech/claims/:claimId/rooms/:roomId` | room detail and readings/photos | `src/pages/tech/TechRoomDetail.jsx` |
| 8 | `/tech/jobs/:jobId` | legacy job detail | `src/pages/tech/TechJobDetail.jsx` |
| 9 | `/tech/job/:jobId` | feature-gated v2 job hub | `src/pages/tech/v2/TechJobHub.jsx` |
| 10 | `/tech/jobs/:jobId/photos` | job photo album | `src/pages/tech/TechJobAlbum.jsx` |
| 11 | `/tech/jobs/:jobId/documents` | e-sign/document list | `src/pages/tech/TechJobDocuments.jsx` |
| 12 | `/tech/appointment/:id` | appointment detail/field execution | `src/pages/tech/TechAppointment.jsx` |
| 13 | `/tech/appointment/:id/edit` | edit appointment, crew, tasks | `src/pages/tech/TechEditAppointment.jsx` |
| 14 | `/tech/new-customer` | create customer | `src/pages/tech/TechNewCustomer.jsx` |
| 15 | `/tech/new-job` | create job and optionally customer | `src/pages/tech/TechNewJob.jsx` |
| 16 | `/tech/new-appointment` | create appointment and assign tasks | `src/pages/tech/TechNewAppointment.jsx` |
| 17 | `/tech/new-event` | create private/team event | `src/pages/tech/TechNewEvent.jsx` |
| 18 | `/tech/conversations` | v2 messaging pane | `src/pages/tech/v2/TechMessagesV2.jsx` |
| 19 | `/tech/feedback` | product feedback/media | `src/pages/tech/TechFeedback.jsx` |
| 20 | `/tech/more` | secondary navigation/status | `src/pages/tech/TechMore.jsx` |
| 21 | `/tech/settings` | appearance/language/notifications | `src/pages/tech/TechSettings.jsx` |
| 22 | `/tech/help` | technician help | `src/pages/tech/TechHelp.jsx` |
| 23 | `/tech/tools/oop-pricing` | out-of-pocket quote builder | `src/pages/tech/TechOOPPricing.jsx` |
| 24 | `/tech/tools/demo-sheet` | demolition scope sheet | `src/pages/tech/TechDemoSheet.jsx` |
| 25 | `/tech/admin/*` | mobile admin subtree | `src/pages/tech/admin/AdminMobileRoutes.jsx` |

The admin subtree contains eight effective route patterns: `/tech/admin` and `/tech/admin/dash`
(dashboard), `/tech/admin/collections`, `/tech/admin/invoice/:invoiceId`,
`/tech/admin/estimate/new`, `/tech/admin/estimate/:estimateId/edit`,
`/tech/admin/estimate/:estimateId`, and `/tech/admin/leads`, plus a wildcard redirect. Six screens
are lazy-loaded. The subtree is present in the native route graph and is guarded in React by role
plus a feature flag.

## Layouts and reusable mobile components

The main mobile layout is `TechLayout`. Important reusable primitives include:

- `TechV2Page`, `TechPane`, `Hero`, `ActionBar`, `DetailRow`, `StatusChip`, `MaterialIcon`;
- bottom sheets for rooms, readings, equipment, e-sign, time-clock supersession, photo notes, and
  help;
- `RoomCard`, `RoomChip`, `PhotosGroup`, `Lightbox`, `TimeTracker`, `OfflineStatusPill`;
- v2 schedule rows, timeline, week strip, create picker, crew avatars, and filters;
- v2 dashboard header, now/next, mini-timeline, attention strip, metrics, and create FAB;
- v2 messaging conversation list, thread view, composer, attachments, templates, consent flow;
- admin-mobile access guard, headers, rows, totals, and route helpers.

The system is not a separate mobile application. It shares global CSS, authentication, REST client,
database objects, and many office components. This reduces duplication but means global stylesheet,
auth, feature-flag, Storage, and RLS changes affect both desktop and mobile.

## PWA and Capacitor infrastructure census

### PWA

- manifest: `public/manifest.json`;
- push-only service worker: `public/sw.js`;
- service-worker registration/kill switch: `src/lib/registerSW.js`, `src/main.jsx`;
- stale-asset recovery: `src/lib/staleChunkReload.js`, `public/reset.html`, Cloudflare headers;
- persisted query cache: `src/lib/techQueryPersister.js`;
- installed-mode route restoration: `src/components/RouteRestorer.jsx`.

The service worker intentionally has no `fetch` handler. That design prevents a previous
HTML-as-JavaScript cache-poisoning failure, but it also means there is no service-worker-provided
cold offline shell.

### Capacitor/iOS

- Capacitor config: `capacitor.config.json`;
- checked-in native platform: `ios/App/`;
- native routes: `src/App.jsx`;
- camera, geolocation, haptics, keyboard, appearance, biometric, updater, and push wrappers:
  `src/lib/native*.js` and `src/lib/pushNotifications.js`;
- OTA workflow: `.github/workflows/capgo-deploy.yml`;
- TestFlight scaffold: `.github/workflows/ios-release.yml`, `ios/fastlane/Fastfile`, `ios/Gemfile`.

No Android native project is checked in. Android PWA behavior is in scope; an Android Capacitor
release is not currently an evidenced product capability.

## Mobile data-access census

Static call-site extraction found **68 distinct RPC identifiers** across the complete field and
admin-mobile surface: 67 literal names plus the dynamically selected `get_revenue_by_division`.
The field-only surface accounts for 52 of those contracts; the remaining 16 are added by the
admin-mobile subtree. The complete mobile route graph directly accesses **17 tables/views**, plus
direct `job-files` Storage REST calls and worker-backed messaging, e-sign, PDF, and feedback flows.

The 13 field-surface tables/views are:

`appointment_crew`, `appointments`, `claims`, `contact_jobs`, `contacts`, `conversations`,
`employees`, `estimate_line_items`, `job_documents`, `jobs`, `message_templates`, `sign_requests`,
and `sms_consent_log`. Admin-mobile adds `estimates`, `invoices`, `invoice_line_items`, and
`payments`.

The RPC surface includes dashboard, claims, appointments, tasks, job hub, rooms, readings,
equipment, time-clock, conversations, demo sheet, customer/job creation, insurance carrier,
out-of-pocket quote, feedback, and admin financial contracts. The normalized contract map is in
`08-supabase-and-rpc-contracts.md`; canonical workflow expectations are in
`../../mobile/data-contracts.md`.

## Duplicate, legacy, unreachable, and uncertain surfaces

- The legacy `/tech/jobs/:jobId` and feature-gated `/tech/job/:jobId` coexist and overlap in job,
  appointment, media, room, reading, equipment, and admin behavior.
- Dashboard, Schedule, and Messages are persistent panes, while other routes use the outlet. Their
  data loaders can overlap with shell-level polling.
- `src/pages/Conversations.jsx` remains a legacy/shared implementation while native `/tech/conversations`
  resolves to the v2 pane.
- The route graph contains admin-mobile code in native builds; product policy must confirm whether
  admin/financial workflows are deliberately supported on managed phones.
- Scope-sheet functionality is implemented and routed, but at least one mobile navigation surface
  presents it as unavailable/“Soon.”
- Account deletion exists in the office settings route, not in the native route tree. Whether this is
  an App Store blocker depends on how employee accounts are created and governed.
- The repository contains no evidenced Android native release path.
- Authenticated UPR field screens, real-device safe areas/keyboards/camera, push delivery, background
  resume, deep links, signing, and OTA rollback could not be exercised without crossing the audit's
  safe credential/device boundaries.

## Census conclusion

The route and workflow surface is substantial, not merely a prototype. The principal readiness risk
is not missing screen count; it is the gap between a broad, capable UI and the production guarantees
underneath it: authorization, per-user device state, mutation recovery/idempotency, cold offline
expectations, native release automation, observability, and device-level verification.
