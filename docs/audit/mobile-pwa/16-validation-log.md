# UPR Mobile PWA and Capacitor Audit — Validation Log

## Snapshot and safety record

| Field | Recorded value |
|---|---|
| Audit worktree | `C:\Users\moronisalvador\.codex\worktrees\be23\Utah-Pros-App-Git` |
| Base branch | fetched clean `origin/dev` |
| Base/audited commit | `ef305f6d6afab4d846eab92fc1b04038d70221f0` |
| Audit branch | `audit/mobile-pwa-production-readiness` |
| Audit start | `2026-07-24T23:39:24.492-06:00` |
| Start status | clean isolated worktree; no pre-existing uncommitted changes |
| Ordinary checkout | unrelated 584-file change set observed and explicitly excluded |
| Supabase project | `glsmljpabrwonfiltiqm`, `ACTIVE_HEALTHY`, PostgreSQL 17.6; URL identity matched expected UPR project; no secret displayed |
| Production policy | Supabase/services/data read-only; no row/object content, mutation, migration, deploy, provider send, or money movement |
| Snapshot drift | `origin/dev` was 11 commits ahead at recovery and 17 commits ahead at documentation closeout; audited SHA intentionally not rebased |

## Stalled preview recovery

The prior run stalled around a Vite preview/browser-control attempt on port 4173. Recovery checks
were performed before audit work resumed:

```powershell
git status --short --branch
netstat -ano | Select-String ':4173'
Get-Process node,chrome,msedge -ErrorAction SilentlyContinue
Get-Content $env:TEMP\upr-audit-vite-preview.out.log
Get-Content $env:TEMP\upr-audit-vite-preview.err.log
```

Observed result:

- Git branch/HEAD remained intact at the audited SHA. Status contained only intended in-progress
  audit documentation, with no application-code change or foreign-checkout content.
- No listener remained on port 4173 and no still-running process could be uniquely attributed to the
  audit; therefore **nothing was terminated**. Unrelated Node/Chrome/Edge processes were not touched.
- stdout log was 159 bytes, last written `2026-07-25 00:11:05`, and showed Vite ready at
  `http://127.0.0.1:4173/`.
- stderr was empty.
- Browser control had not produced authenticated-route evidence.

Most likely cause: the command/tool lifecycle waited on or lost ownership of a detached child
process after Vite became ready; the log does not indicate an application compile/runtime failure.
The optional authenticated runtime check was closed as a human/device gate.

For the remainder of this audit, every subprocess/runtime attempt was bounded to five minutes or
less. No development server was started again. Future runtime scripts must create children inside
`try/finally`, terminate the entire child tree, verify the port is free, and record auth/device/
environment limitations as blocked without stopping documentation or other audit passes.

## Environment and dependency boundary

```text
node --version
npm --version
git rev-parse HEAD
git status --short --branch
Get-FileHash package-lock.json -Algorithm SHA256
```

Results:

- Node `24.14.0`; npm `11.9`; repository CI declares Node 22.
- The isolated worktree had no `node_modules`.
- Its `package-lock.json` SHA-256 matched the ordinary checkout
  (`a404a8...`; full hash was compared locally).
- To avoid installing/upgrading dependencies, the audit temporarily reused the matching checkout's
  packages through local junctions while keeping a worktree-local writable Vite cache. That setup
  also exposed undeclared extras in the source dependency tree and is not release-reproducibility
  evidence.
- No dependency version or lockfile was changed.
- The audit-created worktree-local `node_modules` junction/cache tree, generated `dist` output,
  and the ignored browser-run marker `test-results/qa-browser/.last-run.json` (plus its empty
  directories) were removed before final diff inspection; the ordinary checkout's dependencies
  were untouched.

## Build validation

| Command/result | Outcome |
|---|---|
| `npx vite build` with an initial root dependency junction | Failed: Windows `EPERM` at the linked `node_modules/.vite-temp` write boundary. Environment/layout failure. |
| `npx vite build --configLoader runner` | Failed: ESM config used `__dirname`, unavailable under that loader. Diagnostic attempt only. |
| `npx vite build` after using individual package junctions and a local writable `.vite` | **Passed**: Vite 8.0.1, 664 modules. Web initial raw/gzip 1,235,097/297,918 B; JS 812,645/235,569 B; CSS 422,452/62,220 B. |
| PowerShell-set `VITE_BUILD_TARGET=native`; `npx vite build` | **Passed** build-only. Native initial raw/gzip 1,203,280/291,438 B; JS 780,828/229,089 B; same CSS. No `cap sync`. |

Largest observed lazy route chunk was Schedule at 162.79 KB raw. Web main was
339.22 KB/98.76 KB gzip; native main was 307.95 KB/92.32 KB gzip. The source
`src/index.css` was 583,875 bytes/12,575 lines. These results are artifact measurements, not device
performance proof.

## Test and static validation

| Command | Result |
|---|---|
| `npm test` | **PASS** — 155 files, 1,871 tests: unit 62/762; worker 89/1,093; QA 4/16; 0 unexpected skips |
| `npm run lint` | **FAIL** — 328 problems: 209 errors, 119 warnings |
| `npx eslint` over the enumerated mobile page/component/lib source set (137 files) | **FAIL** — 20 files with findings: 13 errors, 14 warnings |
| `npm run test:browser:list` | **PASS** — deterministic browser lane enumerated |
| `npm run test:browser` | **PASS** — 12/12 at 1440 desktop and 390 mobile fixture; no skips |
| `npm run test:artifacts` | **PASS** — generated test-artifact safety scan |
| `npm run test:tooling` | **PASS with environment skip** — 6 passed, 1 skipped because Bash unavailable |
| `npm run validate:tooling` | **PASS** — 0 errors, 2 approved waivers expiring 2026-08-06 |
| `npm run test:figma-governance` | **PASS** — 7 tests |
| `npm run validate:figma-governance` | Validator disconnected; 0 errors reported; not product/render proof |
| `npm run test:provenance` | **PASS** — 13 tests |
| `npm run validate:provenance` | **PASS** — 22 ledger entries, 21 functions, 5 policies; 4 comment/whitespace-only warnings |
| `npm audit --omit=dev` | **Advisories** — 14 total: 1 critical, 8 high, 5 moderate |
| Type check | Not available: no typecheck script or TypeScript project; JavaScript + `jsconfig.json` |
| `npx cap doctor` | **Exit 1** after observing Capacitor core/iOS/CLI 8.3.1 because Xcode is not installed |

The browser lane is a credential-free deterministic fixture, not the UPR application. It supplies
harness/axe evidence only and is not counted as authenticated route, iOS Safari, installed PWA,
WebView, native, or database-contract proof.

## PWA inspection

Read-only/static checks covered:

```text
public/manifest.json
public/sw.js
src/lib/registerSW.js
src/lib/staleChunkReload.js
src/components/RouteRestorer.jsx
public/_headers
public/reset.html
index.html
web/native production build artifacts
```

Verified:

- manifest core fields and two SVG icon declarations;
- install prompt/iOS instruction and standalone detection source paths;
- push-only worker with no fetch/cache handler;
- feature-flag unregister/cache-clear/reset behavior;
- immutable hashed asset and non-cached HTML/SW header intent;
- fixed persisted-query buster;
- stale-chunk/reset and installed route-restoration logic.

Not verified:

- actual `beforeinstallprompt`, launcher/icon rendering, install/repeat launch, standalone scope,
  Web Push delivery/tap, storage eviction, cold/warm offline, update/partial deploy/rollback, or
  production device/browser behavior.

Read-only HTTP endpoint/header comparisons were used during the initial pass as deployment
orientation. They are not elevated to install/update proof, and no readiness conclusion depends on
an endpoint response alone.

## Supabase and security inspection

Tools/commands:

- connected Supabase project listing/identity/health read;
- repository migration/function/policy/grant/caller searches with `rg`;
- maintained migration provenance test/validator;
- existing dated aggregate/catalog evidence at
  `docs/audit/2026-07/evidence/live-supabase.md`;
- current containment evidence at
  `docs/audit/2026-07/evidence/exec-read-sql-containment-2026-07-23.md`;
- one coordinated data/security specialist, avoiding concurrent broad discovery.

Results:

- correct UPR project confirmed without displaying credentials;
- mobile static inventory: 68 distinct RPC identifiers, 17 direct tables/views, Storage/workers/
  Realtime;
- broad authenticated RLS plus service-role worker authorization bypasses confirmed in source;
- `job-files` live metadata confirmed public/listable with broad insert/delete and aggregate-only
  counts; no path/content inspected;
- `exec_read_sql` current evidence confirms `PUBLIC`, `anon`, and `authenticated` revoked and
  `service_role` preserved; historical exposure was not resurrected;
- no migration, SQL mutation, RPC business invocation, object read/write, policy/grant/config change,
  or production row/log inspection occurred.

## Specialist and cross-check record

Eight bounded workstreams were used:

1. orientation and mobile census;
2. design/responsive/accessibility;
3. motion/gestures/interactions;
4. PWA/install/offline/update;
5. Capacitor/native/release;
6. one coordinated Supabase/RPC/RLS/Storage review;
7. performance/reliability/tests/operations/observability;
8. independent adversarial cross-check after draft findings existed.

The orchestrator reconciled duplicate IDs, corrected routes/config/app ID/RPC scope, narrowed
inference language, and calibrated final counts to 37 findings: P0=2, P1=21, P2=14.

## Documentation consistency validation

A final read-only checker passed with:

- exactly 17 required audit files and 7 required canonical mobile files;
- 37 unique finding IDs with P0=2, P1=21, P2=14, and no P3/P4 promotions;
- every finding containing the required impact, evidence, location, cause, remediation,
  verification, dependency, confidence, effort, and production-blocking fields;
- all 37 findings represented in the prioritized backlog;
- 20 scorecard categories and 24 explicit executive questions;
- no broken relative Markdown links across the root README and the 24 new documents;
- a nonignored untracked set consisting only of the intended 24 documentation artifacts.

## Final Git diff and adversarial review

Final read-only checks included:

```text
git status --short --branch
git diff --name-only
git diff -- README.md
git diff --check
git ls-files --others --exclude-standard
```

Results:

- branch and HEAD remained `audit/mobile-pwa-production-readiness` at
  `ef305f6d6afab4d846eab92fc1b04038d70221f0`;
- the only tracked change was the intended root `README.md` mobile-documentation link;
- the only nonignored untracked files were the 17 required audit documents and 7 required
  canonical mobile documents;
- no application, migration, generated native, `.agents`, `.codex`, dependency, build, browser,
  or test-result artifact was present in the final status;
- the secret-like-value scan found zero matches, the final relative-link scan found zero broken
  links, and the independent reviewer validated 128 parsed source line references within bounds;
- the independent adversarial closeout returned PASS with no remaining actionable documentation
  issue or unsupported/contradictory material claim.

## Checks not completed

| Check | Why blocked / disposition |
|---|---|
| Authenticated UPR field screens in a browser | No safe audit credential/synthetic session supplied; browser runtime had already stalled. Human/staging gate; audit continued. |
| Required 320/360/375/390/412/430/768 app widths | Credential-free fixture only covered 390; every app width remains a named gate. |
| iOS Safari/installed PWA | No physical iPhone/iPad/device session. |
| Android Chrome/installed PWA | No physical/emulated authenticated app session. |
| Xcode compile/archive/sign/export/TestFlight | Audit host is Windows; Xcode/signing/Apple account unavailable. |
| Camera, photo library, location, keyboard, safe areas, background/termination, biometrics, privacy snapshot | Require signed physical-device execution. |
| Native/Web Push/APNs delivery and tap | Would require configured providers, controlled subscriptions/devices, and potential outbound side effects; not authorized. |
| Deep/universal links and AASA | Native configuration is incomplete and device/domain proof unavailable. |
| Capgo upload/channel/rollback | External plan/workflow is paused; upload/deploy prohibited. |
| Production Web Vitals/slow-network/memory/battery | No safe authenticated runtime/telemetry access; source/bundle findings labeled accordingly. |
| Provider-side QBO/CallRail/notification reachability | Production actions/data are read-only; source bypass confirmed and live enablement left unknown. |
| Live object/content sensitivity | Deliberately not inspected; aggregate/catalog metadata only. |
| Branch protection, Cloudflare required checks, external monitoring/retention | External configuration access not established; recorded as unknown, not absent. |

## Final validation policy

No optional runtime check may block audit closure. Any remediation re-audit must use a harness that:

1. enforces a maximum five-minute attempt;
2. starts child processes under owned process groups/jobs;
3. cleans ports, browser contexts, and child trees in `finally`;
4. uses only synthetic authorized identities/data;
5. records blocked auth/device/provider conditions without converting them to pass;
6. preserves build, database, provider, deployment, browser, and real-device evidence as separate
   claims.
