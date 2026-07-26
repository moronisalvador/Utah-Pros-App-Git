# UPR Mobile PWA and Capacitor Audit — Performance and Reliability

## Build and bundle results

Both build targets compiled successfully from the audited snapshot without syncing native projects:

| Build | Initial raw | Initial gzip | JavaScript raw/gzip | CSS raw/gzip | Main chunk raw/gzip |
|---|---:|---:|---:|---:|---:|
| Web/PWA | 1,235,097 B | 297,918 B | 812,645 B / 235,569 B | 422,452 B / 62,220 B | 339.22 KB / 98.76 KB |
| Native target | 1,203,280 B | 291,438 B | 780,828 B / 229,089 B | 422,452 B / 62,220 B | 307.95 KB / 92.32 KB |

The web entry JavaScript is slightly above the repository's approximately 232 KB gzip guide but
below its stated 255 KB fail intent. The largest observed lazy route chunk was Schedule at
162.79 KB raw, under the 175 KB route guide. `src/index.css` is 422,452 output bytes; the source is
583,875 bytes/12,575 lines, and the output exceeds the 400 KB raw CSS budget. The build itself does
not enforce those budgets (`MOB-PERF-026`).

These byte measurements are verified command results. They do not establish LCP, INP, CLS,
memory, resume time, or slow-network usability.

## Route splitting and rendering behavior

Route-level lazy loading is extensive and prevents the entire office application from entering the
mobile initial graph. The native build removes the office route tree at build time, producing a
smaller main chunk. Images generally pass through mobile compression/thumbnail helpers, and the
v2 surfaces use skeletons and query caching.

Material concerns:

- Dashboard, Schedule, and Messages stay mounted while hidden inside `TechLayout`; some query
  observers/background work and their DOM remain active. GPS, countdown/now-line, and thread
  listeners are correctly active-gated, and conversations share one ref-counted Realtime channel.
- `TechLayout` independently polls assigned tasks every 60 seconds
  (`src/components/TechLayout.jsx:282-292`) while task/dashboard screens have their own loaders.
- one global stylesheet ships office, legacy mobile, v2 mobile, and admin-mobile rules together;
- several lists select all matching documents/tasks or broad shapes without a cursor;
- inline style objects and large legacy screens increase render/maintenance cost, though this audit
  did not prove measurable frame drops.

`MOB-PERF-007` covers hidden-pane/background duplication; `MOB-DATA-033` covers unbounded
document/task retrieval. Both are P2 until production cardinality/trace evidence shows a higher
impact.

## Query, cache, and resume behavior

TanStack Query uses a 30-second stale time, one retry, focus/reconnect refetch, 24-hour GC, and
IndexedDB persistence (`src/lib/techQuery.js:140-160`). That supports fast warm paint and mobile
resume.

The same design creates cross-session and compatibility hazards:

- several keys omit employee identity (`techQuery.js:69-83`);
- persistence uses one device-global database/key (`techQueryPersister.js:35-46,83-87`);
- logout does not clear that cache (`AuthContext.jsx:272-283`);
- the persisted-cache buster is a fixed manual literal rather than a release identifier
  (`src/main.jsx:28,48,76-84`).

These are `MOB-STATE-001` (P1) and `MOB-PWA-037` (P2). Thread bodies are deliberately excluded from
persistence, a useful privacy/performance tradeoff.

## Offline and slow-network behavior

The service worker does not intercept fetches, so a cold offline PWA launch cannot load the shell
(`MOB-OFFLINE-010`, conditional on product promise). Warm sessions may retain already loaded UI and
cached queries, but network-backed routes can fail or display stale data.

The offline mutation subsystem has real foundations: IndexedDB queue/blob stores, typed
dispatchers, status counts, retries, backoff, temp IDs, online/visibility triggers, and a
user-visible status pill. Its recovery model is not production-safe:

- queue records have no authenticated owner (`src/lib/offlineDb.js:65-79`);
- the singleton runner is bound to whichever employee initialized it, while a later session can
  drain device-global rows (`MOB-DATA-002`);
- dispatch marks a row `syncing`, but startup reads only `pending`
  (`src/lib/syncRunner.js:69-88`); termination between those steps strands it
  (`MOB-OFFLINE-011`);
- only page-local `draining` prevents overlap; no cross-tab/process atomic lease exists
  (`syncRunner.js:26-29,69-77`) (`MOB-DATA-013`);
- max-retry rows become `error`, while automatic start/tick only considers pending rows
  (`syncRunner.js:93-105,120-142`).

No safe authenticated slow-network/offline runtime exercise was possible. The conclusions above
are source-proven failure paths, not observed production data loss.

## Photo and media preservation

Online and queued photo paths both perform a Storage upload followed by
`insert_job_document`. The two systems are not one transaction:

1. generate a timestamped/object path;
2. upload raw object bytes;
3. insert metadata with a separate RPC.

The online path is visible in `src/hooks/usePhotoUpload.js:73-119`; the queued dispatcher repeats the
pair in `src/lib/dispatchers/photoDispatcher.js:15-55`. There is no stable client operation ID,
bounded request timeout, compensating delete, or server-side object/metadata idempotency. An
ambiguous response or app termination can orphan an object, omit metadata, or duplicate a retry
(`MOB-DATA-012`, P1).

The public Storage configuration is a separate P0 confidentiality/authorization issue
(`MOB-SEC-015`).

## Multi-step mutation reliability

### Appointment create/edit

New appointment creation inserts an appointment, loops over crew inserts, then links tasks
(`src/pages/tech/TechNewAppointment.jsx:222-256`). Editing first updates the appointment, deletes all
crew rows, rebuilds them, and then links tasks
(`src/pages/tech/TechEditAppointment.jsx:229-269`). A failure after an earlier step commits leaves a
partially changed workflow. Retrying can repeat non-idempotent work.

The appointment task toggle sends a new request from the current UI state without a version or
operation key. If the first response is lost, retrying the toggle can reverse the intended result.
`MOB-REL-034` groups these transactional/ambiguous-result defects at P1.

### Other mutation classes

- room/reading/equipment/photo-note flows perform several independent calls with local refetch;
- contacts are quick-inserted before job creation in some paths;
- message DND and consent log updates are separate writes;
- admin estimate/payment operations mix direct rows, RPCs, QBO workers, and provider side effects;
- demo-sheet local mirroring preserves some edits well, but account ownership and provider results
  are not standardized.

Not every multi-call sequence is necessarily wrong; high-impact sequences need explicit atomic,
idempotent, retryable, or compensating semantics and tests.

## Errors that can look like empty/success

- several parallel loaders use `.catch(() => [])`, collapsing permission/network errors into empty
  sections;
- setup lookups sometimes ignore failure and keep an empty list;
- notification dispatch intentionally returns success with per-channel skips, which callers must
  inspect;
- a multi-step mutation can throw after earlier steps commit, showing “failed” even though part of
  the action happened;
- queued work can remain `syncing` with no automatic terminal message after process termination.

Conversely, most explicit form mutations set a submitting flag and show a toast on caught failure;
the repository has many purposeful loading/error/empty components. The defect is inconsistency and
ambiguous distributed outcomes, not absence of all feedback.

## Dependency and runtime risk

`npm audit --omit=dev` reported 14 advisories: 1 critical, 8 high, and 5 moderate, involving
`@xmldom/xmldom`, `brace-expansion`, `react-router`, `tar`, and `ws` dependency paths. Package
presence is verified; exploit reachability in the mobile/browser/worker/native release was not
triaged. `MOB-DEP-027` is therefore P2 pending a reachability and upgrade-compatibility assessment,
not a claim of active exploitation.

No TypeScript compiler gate exists; the application is JavaScript with `jsconfig.json`. Lint found
13 errors and 14 warnings in the targeted mobile surface, and the full baseline remains much larger.

## Observability and recovery

Route-level `ErrorBoundary` wrappers cover many outlet routes, and stale-chunk recovery gives users a
reset path. The three always-mounted primary panes are created inside `TechLayout`, outside the
individual route boundaries. Client failures are primarily console/toast based; no repository
evidence established frontend error aggregation, native crash reporting, release/source-map
correlation, offline-queue fleet health, installed-version visibility, or Web Vitals telemetry.

This makes field-only failures hard to detect and reproduce (`MOB-OBS-024`, P1). It does not mean
Cloudflare/Supabase/provider logs do not exist; their current configuration and retention were not
verified.

## Performance and reliability priorities

1. contain authorization/Storage exposure before optimizing;
2. account-scope cache, drafts, queue, route, and push state;
3. recover/lease queued work and make every queued dispatcher idempotent;
4. make photo metadata/object creation and appointment edit/create transactional or compensating;
5. add timeouts, operation IDs, explicit partial-success responses, and actionable error classes;
6. make CI budgets blocking with per-entry/route/CSS measurements;
7. bound/paginate growing lists and measure query plans/latency;
8. reduce hidden-pane work and split/deduplicate the global stylesheet;
9. add release-correlated client/native error, queue, update, and performance telemetry.

## Performance/reliability conclusion

Build output and test breadth show a substantial engineered application. Warm-cache behavior,
code-splitting, media compression, and stale-asset recovery are meaningful strengths. The dominant
risk is data preservation under account changes, retries, termination, and partial failure—not raw
bundle size. Until those P1 paths are hardened, the app should not be the sole interface relied upon
in unstable field connectivity.
