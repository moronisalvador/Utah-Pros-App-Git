# Native iOS Experience & Release Readiness — remediation status

**Audit:** `UPR_Native_iOS_Experience_and_Release_Readiness_Audit_2026-07-27.docx`
(extracted verbatim to [`audit-2026-07-27.md`](audit-2026-07-27.md))
**Remediation session:** 2026-07-27 → 2026-07-28, branch `codex/native-ios-remediation`,
merged to `dev` as 48 commits ending `7f075d7`.
**Last updated:** 2026-07-28

The audit records **37 findings — 7 P0, 24 P1, 6 P2**. This file records what was
actually done against them. It exists because the session's working copy of the
audit lived in a temp directory and was destroyed by a machine restart with no
status recorded anywhere; the source `.docx` is not in the repository either.

Status is derived from the commit history, not from memory. Every "closed" row
names the commit that closed it. Where a finding is only partly addressed the row
says so and states what is left — a finding is not marked closed because the
easily-fixed half of it was fixed.

**Read the verification caveat before trusting any row.** See
[Verification honesty](#verification-honesty) at the bottom.

---

## Summary

| Status | P0 | P1 | P2 | Total |
|---|---:|---:|---:|---:|
| Closed | 5 | 12 | 3 | **20** |
| Partly done | 1 | 4 | 1 | **6** |
| Not started | 1 | 8 | 2 | **11** |
| | **7** | **24** | **6** | **37** |

Plus **11 defects found during remediation that the audit did not contain** — see
[Found in flight](#found-in-flight). One of them, NATIVE-API-01, was breaking
every Cloudflare Worker call in the installed app.

### 2026-07-28 follow-up

The later `codex/mobile-readiness-native-usability` wave fixed three usability/release gaps that are
not included in the original 37-finding or 11-found-in-flight counts:

- Face ID moved from the retained-session launch path to the manual native password sign-in
  boundary. Cold/warm reopen no longer prompts on every app open; cancellation still blocks a new
  sign-in before Supabase publishes the session.
- `ios/App/Version.xcconfig` now owns marketing version `1.0.0`, the release workflow assigns a
  unique build from its run number/attempt, artifact verification pins both values, and native
  Settings shows the installed `App.getInfo()` version/build.
- the native notification bell preserves populated rows during silent refresh and uses one
  accessible scale/fade enter/exit lifecycle with reduced-motion, focus, Escape, route, and
  persistent-pane handling.

An authenticated iPhone 17 Pro simulator build was installed and exercised from the exact wave
source: retained-session terminate/relaunch opened the dashboard without a biometric gate, Settings
showed `Version 1.0.0 (1)`, and a frame recording showed multi-frame bell enter/exit. That is
simulator evidence, not distribution-signed archive, TestFlight, VoiceOver, or complete
physical-device qualification.

---

## P0 — release blockers

| ID | Finding | Status | Commit / note |
|---|---|---|---|
| REL-01 | Apple team identifiers and Associated Domains are stale | **Closed** | `d63a3f8`. Entitlements confirmed on a real device — simulator builds strip them, so this could not have been verified any other way. |
| REL-02 | Promoted source is not a reproducible iOS release input | **Closed** | `a04f133`. Deep link `upr://app/tech/tools/demo-sheet` verified opening the Scope Sheet on device. |
| PUSH-01 | Native push dormant; appointment destinations not mobile | **Partly done** | `cfcd558` fixed the live deep-link defect (`notify.js` wrote a path no reader could use). Enrollment stays dormant: it needs an **APNs Auth Key**, which only the owner can generate. Steps written up in [`docs/mobile/push-activation-owner-gate.md`](../../../mobile/push-activation-owner-gate.md). |
| AUTH-01 | Native field shell authenticated but not role-restricted | **Closed** | `f694582`. `FIELD_SHELL_ROLES` + `FieldShellRoute`; renders a recoverable screen rather than `<Navigate>`, because native `*` → `/tech` would loop. |
| QUAL-01 | Physical-device and iPad qualification remain release gates | **Not started** | Owner/external gate. The app was installed and exercised on the owner's iPhone 17 Pro Max repeatedly, but **no iPad pass and no formal qualification record exists**. |
| KB-01 | Capacitor has competing keyboard layout owners | **Closed** | `2d6c131`, `d18d01e`, `161f0c0`, `8bdf6be`. Took four commits; the first three looked complete and were not — see the caveat below. |
| PRIV-01 | Durable drafts are not consistently account-owned | **Closed** | `1b09482`. Drafts swept on logout and on account switch. |

---

## P1

| ID | Finding | Status | Commit / note |
|---|---|---|---|
| SET-01 | Native settings expose PWA-centric push controls | **Closed** | `e80e017` |
| DATA-01 | Claims defaults and privileged menu gates need least-privilege | **Not started** | — |
| STAT-01 | Status-bar style semantics reversed | **Closed** | `35533ea`. Capacitor's `Style.Dark` means "light text", which is what was inverted. |
| SAFE-01 | Messages consumes the Dynamic Island inset multiple times | **Closed** | `c2f5cad` |
| SAFE-02 | Public/native routes lack a safe-area contract | **Closed** | `84b3ee4` |
| RES-01 | Abrupt privacy-shield-to-WebView cut on foreground | **Closed** | `c75640b`. Dissolve with a hard timeout backstop and a Reduce Motion bypass. |
| RES-02 | Resume refresh and native route restoration uncoordinated | **Not started** | — |
| JOB-01 | Job note/photo save replaces the page and clamps scroll | **Closed** | `7a259ff` |
| MSG-01 | The native app advertises installing the PWA | **Closed** | `b2ed1ce` |
| MSG-02 | Conversation-row actions feel web-first | **Not started** | — |
| MSG-03 | Thread back and collapsed composer actions lack native contracts | **Not started** | — |
| MSG-05 | Job/appointment Message actions lose customer context | **Closed** | `f66e284`. Resolves the contact via `get_job_contacts` on tap; refuses to guess when a job has two unflagged contacts, and never infers from a phone number. **The Job Hub half is untested** — it sits behind `page:tech_job_hub`, which is off. |
| ESIGN-01 | Native Copy link exports a device-local signing URL | **Closed** | `815fc24`. `window.location.origin` is `capacitor://localhost` in the app, so the copied link was unopenable. |
| MOTION-01 | Detail routes lack scroll restoration; stacked motion systems | **Partly done** | `38ae7c9` added the `location.key` scroll registry. **Retiring the competing route-motion systems is not done** — the finding gates that on qualifying a single route-motion owner, and nothing has. ⚠️ This commit also shipped the crash fixed in `7f075d7`. |
| MOTION-02 | Reduced Motion not honored across core interactions | **Closed** | `c7ee3f6`. Global CSS floor + a JS preference hook, because `scrollIntoView({behavior:'smooth'})` overrides CSS per spec. Two PWA-owned scroll sites (`Conversations.jsx`, `Help.jsx`) deliberately left — frozen surface. |
| MODAL-01 | Tech sheets bypass the approved dialog lifecycle | **Partly done** | `b6712ee` added `aria-modal`, focus trap, focus return and Escape to all five sheets. **The exit-animation phase is not done** (needs `--closing` markup per sheet). |
| GEST-01 | Pull-to-refresh and task swipe miss the gesture contract | **Not started** | Constrained by `motion-standard.md` §9 — one sanctioned approach, absolute library ban, and it must reconcile the existing CrmLeads touch-drag and `react-grid-layout` rather than start fresh. |
| A11Y-01 | Several native controls lack semantic and focus contracts | **Not started** | Partly overlapped by MODAL-01 and TOAST-01, but **not addressed as its own finding**. |
| PICK-01 | No native date/time picker boundary | **Partly done** | `d90d0c8` localized the calendar and unstripped the date input. The native picker boundary itself is not built. |
| PICK-02 | Date defaults and Today can select the wrong calendar date | **Closed** | `53a7d18` (Today selects today) + `b42a720` (`America/Denver` "today"; `toISOString()` returned tomorrow after ~6pm Mountain). |
| PICK-03 | Appointment ranges and time controls inconsistent | **Closed** | `cc3779c` |
| PICK-04 | Schedule Today state goes stale across midnight/resume | **Not started** | — |
| NAV-01 | Native route outcomes dead, unguarded, or role-misaligned | **Partly done** | `fe7da1b` guarded the room route and un-deadened "Admin view"; removed a phantom `manager` role. **Four other `manager` gates remain** — changing them *grants* access, so it is an authorization decision, not a rename. One is `BILLING_EDIT_ROLES`. |
| PERF-01 | Persistent panes front-load work, can refetch while hidden | **Not started** | — |

---

## P2

| ID | Finding | Status | Commit / note |
|---|---|---|---|
| MSG-04 | Messages separators reference an undefined design token | **Closed** | `b64daae`. The separators were never drawn at all — an unresolvable `var()` resets the whole declaration. |
| TOAST-01 | Tech toasts not motion-, focus-, or resume-safe | **Closed** | `a55d77f`. All four defects. **Tech shell only** — `src/components/Layout.jsx` (office) carries the same four and is frozen. |
| PICK-05 | Picker accessibility and distant-date navigation | **Closed** | `9d19889` |
| PROD-01 | Navigation labels and native feature scope inconsistent | **Not started** | — |
| PERF-02 | Native bundle carries web/PWA bootstrap and remote fonts | **Partly done** | `a7038de` prunes 9 web-only assets (50,863 bytes). **Remote fonts not addressed.** |
| PERF-03 | Persistent schedule data and DOM grow without bound | **Not started** | — |

---

## Found in flight

Not in the audit. Found while remediating, and mostly worse than what was.

| ID | What | Commit |
|---|---|---|
| **NATIVE-API-01** | **Every Cloudflare Worker call failed in the installed app.** No `server.url`/`iosScheme` is set, so Capacitor serves from `capacitor://localhost` and a relative `fetch('/api/…')` was answered from the app bundle with **HTTP 200 and index.html** — so callers believed they had succeeded. Broke messaging, consent, Scope Sheet submit, e-sign, Encircle sync, media. | `92de820`, `5eaba75`, `92f5f12`, `0de7d1c` |
| KB-02 | Message composer sat under the keyboard — unusable | `89b055b` |
| KB-03 | Four field sheets opened behind the keyboard; then a double-subtraction of my own that hid Save on iPhone 17 and smaller | `c2dc530`, `1d7eb97`, `16c11b9` |
| ESIGN-02 | A provider rejection reported "Signing link texted to the customer" | `5a64e9a` |
| ENCIRCLE-02 | Green "Posted to Encircle" for a note never created | `2e5baa3` |
| ESIGN-03 | "Reminder sent" for an email nobody sent | `6daa10a` |
| COMPOSER-01 | Tab bar survived an open thread ~1 run in 3 — a WebKit `:has()` invalidation race | `2ec57f2` |
| MSG-06 | Keyboard flashed on every send; `keepKeyboard` was missing from the Send button only | `64cc0f3` |
| Xcode Cloud CI | Every build failed — no `ci_scripts/` existed, so `node_modules` never installed before SPM resolution | `9c07eb0` |
| Geolocation | Already fully built; had no test | `d80d8a1` |
| **Regression** | **A TDZ `ReferenceError` in `TechLayout` crashed every `/tech` route.** Shipped in MOTION-01, reached `dev` and the owner's phone. | `7f075d7` |

---

## Owner decisions still open

- **APNs Auth Key** — blocks all push (PUSH-01).
- **App Store build high-water mark** — the local project baseline remains
  `CURRENT_PROJECT_VERSION = 1`, but the governed release workflow now replaces it with a unique
  run-number/attempt build and verifies marketing/build identity. Native Settings surfaces the
  installed values. Before the first upload, the owner still must confirm the workflow build is
  above any existing App Store Connect/TestFlight build for version `1.0.0`.
- **Xcode Cloud** needs `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` in its workflow environment.
- **`RESEND_API_KEY` on the Cloudflare *Preview* set** — the app targets `dev.utahpros.app`, which uses Preview variables, not Production.
- Four dead `manager` role gates + `BILLING_EDIT_ROLES` (NAV-01 remainder) — granting access is a decision.
- `Layout.jsx` office toast (TOAST-01) and `SendEsignModal.jsx` (ESIGN-02 shape) both sit in the frozen PWA.
- PWA `ThreadView` collapses in landscape after rotation — pre-existing, frozen surface.
- Whether to keep both Xcode Cloud and the GitHub Actions iOS workflow.

---

## Verification honesty

Most of this was verified by **source-contract tests and a clean build, not by running the app**. That distinction is not pedantic — it is why a crash reached production:

- This repo's vitest environment is `node` with **no jsdom**. Nothing renders a component. A green suite says the source contains what was intended; it says nothing about whether the screen works.
- Simulator tap injection crashed partway through the session and stayed down for five consecutive commits. Those went out source-verified only. One was the `TechLayout` TDZ crash.
- ESLint does not have `no-use-before-define` enabled for variables, which is what would have caught that crash. **Enabling it is the highest-value follow-up in this document.**

Where something *was* verified on hardware, the row says so. Two rows worth
re-reading: KB-01 took four commits because the first three passed every test and
still left the field invisible, and COMPOSER-01 was a 1-in-3 race that survived
two single-screenshot "verifications" before being caught by running it twelve
times.
