# App Surface Map — shells, screens, routes, build targets, deep links

**Last verified:** 2026-08-04

Why this file exists: the app has **two build targets**, **two shells**, and a set of screens that
are **panes, not routes**. None of that is visible from the route table alone, and every one of them
has already cost a real debugging session. Read this before adding a screen, moving a route, or
testing anything on a device.

Companion docs: `UPR-Web-Context.md` (schema/RPCs), `UPR-Design-System.md` (visual patterns),
`.claude/rules/tech-mobile-ux.md` (field UX law).

---

## 1. Build targets — the web bundle and the native bundle are NOT the same app

This is the single highest-cost trap. `npm run build` produces the **web** bundle. Putting it in the
native shell yields an app that looks right and is subtly wrong.

| | Web | Native (iOS) |
|---|---|---|
| Command | `npm run build` | `npm run build:ios` (or `build:ios:dev`) |
| `VITE_BUILD_TARGET` | `web` (default) | `native` (forced by `scripts/build-native.mjs`) |
| Module swapped | `src/routes/buildTargetPages.web.jsx` | `src/routes/buildTargetPages.native.jsx` |
| `IS_NATIVE_BUILD` | `false` | `true` |
| PWA assets (`sw.js`, `manifest.json`) | shipped | **pruned** by `build-native.mjs` |
| Page set | everything | only `NATIVE_PAGE_ALLOWLIST` |

The swap happens in `vite.config.js` (alias on `@/routes/buildTargetPages`, keyed on
`VITE_BUILD_TARGET`). `src/App.jsx` re-exports it as `IS_NATIVE`.

**What breaks if you build the wrong target and run it in the native shell:**

- `NativeNavigationBridge` is mounted `enabled={IS_NATIVE}` (`src/App.jsx:781`) → with a web bundle
  it registers **no** app-link and **no** push listeners, so **every deep link silently does nothing**.
  No error, no log — the URL arrives and is dropped.
- The PWA install banner appears *inside* the native app (it has no native guard; it keys on
  `display-mode: standalone` + `navigator.standalone`, both falsy in a WKWebView).
- `/tech/conversations` renders the office `Conversations` page instead of the tech pane (§4).

**Correct commands:**

```bash
npm run build:ios:dev   # native bundle + cap sync ios, APNs sandbox + native push
npm run build:ios       # native bundle + cap sync ios
```

**This is now guarded.** `build-native.mjs` writes `dist/upr-native-build.json`, and
`npm run sync:ios` runs `scripts/assert-native-dist.mjs` first, which refuses to `cap sync` a dist
that was not produced by the native target. Vite empties `dist/` on every build, so the marker
cannot outlive its own build. The gate is deliberately **build-time, not runtime** — a runtime
refusal could brick a shipped app, while this mistake only ever happens on a developer machine. CI
is unaffected: both iOS workflows run `build-native.mjs` and then call `cap sync ios` directly.
Behaviour is proven in `tests/qa/unit/native-build-target-guard.test.js` (it runs the guard against
both bundle shapes rather than grepping it).

### 1a. The native page allowlist will fail your build

`scripts/native-bundle-boundary.mjs` exports `NATIVE_PAGE_ALLOWLIST`. The native build **refuses**
any module under `src/pages/` that is not listed:

```
Native bundle boundary refused 1 module(s):
- src/pages/tech/Foo.css is not in the native page allowlist
```

The rule matches **every module** under `src/pages/`, not just components — so a **co-located
stylesheet needs its own entry** beside its page (precedent: `WhatsNew.css`, and
`TechEditAppointment.css` added 2026-08-04 after it broke the native build).

> **This is not caught by normal CI.** The `verify` job builds the *web* bundle. The native build
> only runs inside the two iOS workflows, whose IPA jobs are `workflow_dispatch`-only — so a PR can
> merge green to `dev` **and** `main` while the native build is broken, and you only discover it when
> you dispatch a TestFlight build. If you add a page or a page-level CSS file, run
> `npm run build:ios` locally before merging.

### 1b. Building from a git worktree

Worktrees usually have no `node_modules` of their own — `npm`/`npx` walk up to the main checkout, so
`vite build` works. But `scripts/build-native.mjs` resolves vite at `<repoRoot>/node_modules/vite`
and throws *"Vite is not installed"*. Several `tests/qa/unit/*` files read into `node_modules` too
(`@capgo/cli`, `@supabase/supabase-js`) and fail the same way. Either run `npm ci` in the worktree
or symlink its `node_modules` to the main checkout's.

---

## 2. Which shell a user gets

`getAccountLandingPath(role)` in `src/contexts/authBootstrap.js:27`:

| Role | Lands on | Shell |
|---|---|---|
| `field_tech` | `/tech` | **Tech shell** (`TechLayout`) |
| `crm_partner` | `/crm/leads` | CRM |
| everyone else (`admin`, `office`, `supervisor`, `estimator`, `project_manager`) | `/` | **Office / Admin Mobile** (`Layout`) |

Separately, `canUseFieldShell(role)` (`FIELD_SHELL_ROLES`) decides who may *render* `/tech/*`: every
internal role, excluding only `crm_partner`. `FieldShellRoute` redirects a blocked account to its
landing path.

**Consequence when testing:** signing in as an admin lands you in Admin Mobile, whose Messages tab is
the office `Conversations.jsx`. Signing in as a field tech lands you in the tech shell, whose Messages
tab is `TechMessagesV2.jsx`. **These are different components with different code paths.** Verifying
a tech fix from an admin session tests the wrong file. An internal non-tech role can still reach the
tech shell by navigating to `/tech` explicitly.

---

## 3. Office / Admin Mobile shell

Bottom nav: **Dashboard · Messages · Jobs · Schedule · More**. Pages live in `src/pages/`
(`Dashboard.jsx`, `Conversations.jsx`, `Jobs*`, `Schedule.jsx`, …) and render through the normal
route table in `src/App.jsx`.

---

## 4. Tech shell — panes are not routes

Bottom nav (`src/components/TechLayout.jsx:183-187`):

| Nav | Path | Rendered by |
|---|---|---|
| Dash | `/tech` | **pane** `TechDashV2` |
| Claims | `/tech/claims` | route `TechClaims` |
| Schedule | `/tech/schedule` | **pane** `TechScheduleV2` |
| Messages | `/tech/conversations` | **pane** `TechMessagesV2` |
| More | `/tech/more` | route `TechMore` |

**Three v2 surfaces are panes, not routed pages.** They render *outside* the pathname-keyed
`<Outlet/>` in `TechLayout` and switch on `location.pathname`:

```jsx
const dashActive  = location.pathname === '/tech';
const msgsActive  = msgsV2 && location.pathname === '/tech/conversations';
<TechPane active={dashActive}><TechDashV2 active={dashActive} /></TechPane>
```

They stay mounted and are shown/hidden, which is what preserves scroll and in-flight state across
tab switches. So:

- **`grep` for a route will not find them.** `TechMessagesV2` is mounted only at
  `src/components/TechLayout.jsx:563`.
- The matching route entry is deliberately inert on native:
  ```jsx
  // src/App.jsx:350
  <Route path="tech/conversations" element={IS_NATIVE ? null : <Conversations />} />
  ```
  On **web** that path renders the office inbox; on **native** it renders `null` and the pane covers it.
- Changing a pane's path means changing **both** the nav item and the `location.pathname` comparison.

---

## 5. Deep links (app links and push)

Every inbound route is validated by the same pure policy,
`src/lib/nativeNavigationTarget.js` — shared by Capacitor link handling *and* the APNs worker, so an
unsafe route is rejected before it reaches Apple.

**Accepted forms** (all normalize to a relative path):

```
/tech/conversations?c=<id>
com.utahprosrestoration.upr://app/tech/conversations?c=<id>
https://<allowed host>/tech/conversations?c=<id>
```

- A Universal Link must be in the AASA's authenticated/native allowlist (`/tech` or a supported
  `/tech/*` route; `/tech/admin*` is refused). The native URL parser also understands public routes
  for deliberate in-app navigation, but **emailed password setup/recovery and signing links are not
  Universal Links**: `/set-password`, `/sign/:token`, and `/s/:code` stay in the browser so a signer
  or new employee can finish without native credentials.
- **Query is allowlisted per path.** `/tech/conversations` accepts exactly one param, `c`, matching
  `^[A-Za-z0-9_-]{1,128}$`. Anything else → rejected → falls back to `/`.
- Fragments are refused except the `/set-password` recovery hash.

### 5a. The readiness gate that silently holds links

`src/lib/nativeNavigationCoordinator.js` will not navigate until **auth is ready**, which requires
**all three** of `employeeId`, `leaseEpoch`, `leaseOwner` (the last two come from `pwaOwnerLease`,
which is `null` until device state is verified):

- **App link** with auth not ready → held in `pending`, dispatched later when auth becomes ready.
- **Push** with auth not ready → **held in a single in-memory slot** (newest tap wins, at most
  **5 minutes**) inside the push listener lifecycle, and dispatched exactly once when auth becomes
  ready — but **only if its recipient binding matches the employee actually verified at that
  moment**, and only through the **push route policy** (`resolveNativePushRoute` — recovery
  fragments and public signing routes are refused, same as the APNs worker enforces server-side).
  A tap addressed to a different account is discarded at readiness, never navigated. Sign-out
  clears the held tap; it is never persisted or logged. *(Changed 2026-08-06 — before that, a push
  arriving pre-readiness was dropped immediately, which silently killed every tap that cold-started
  the app. The coordinator's own push-before-ready refusal remains as defense-in-depth; the hold
  lives in `src/lib/pushNotifications.js` `startNativePushEventListeners`.)*

A session restored from an old container without a fresh owner lease therefore makes **every deep
link a no-op with no error** (app links held forever, held push taps never released). If deep links
"do nothing", check the lease before suspecting the router. `localStorage` keys
`upr:pwa-account-epoch:v1` / `upr:pwa-account-owner:v1` are the signal.

### 5b. Push payload contract

`resolveNativePushActionTarget` (`src/lib/pushNotifications.js`) accepts a tap only when **all**
hold:

1. `actionId` is a non-empty string and not `dismiss`;
2. exactly **one** distinct url candidate across `data.url` / `data.data.url`;
3. exactly **one** distinct recipient candidate across `data.recipient` / `data.data.recipient`;
4. that recipient equals `nativePushRecipientBinding(employeeId)` — a UUIDv5-style formatting of
   `SHA-256("native-recipient:" + employeeId)`.

Two url candidates, or a recipient for a different employee, is refused — that is what stops one
employee's notification opening on another's device.

### 5c. Testing deep links on the simulator

```bash
xcrun simctl openurl <udid> "com.utahprosrestoration.upr://app/tech/conversations?c=<uuid>"
xcrun simctl push    <udid> com.utahprosrestoration.upr payload.json
```

`simctl push` requires the app to have **notification authorization**; enrollment is default-off, so
an un-enrolled install silently drops the notification. Note that enabling push writes a real
`device_tokens` row for that employee.

Start the test from a screen that is **not** the target, or you cannot tell "navigated" from "did
nothing" — a mistake that produced a false negative on 2026-08-04.

---

## 6. Conversation access lease (why a thread can vanish)

`src/components/conversations/conversationAccessState.js`: `CONVERSATION_ACCESS_LEASE_MS = 30_000`.

A thread renders only behind a **fresh** access lease. On resume, `revalidateActiveAccess`:

| `provenAt` (lease) | Behaviour |
|---|---|
| set and fresh | refetch, keep the thread |
| set and expired | **purge immediately** — thread closes to the list, draft cleared |
| **absent (never proven)** | do **not** purge; let the probe run |

That last row is the 2026-08-04 push deep-link fix. A deep link arrives with a brand-new `activeId`
and no lease; resume fires on the same tick. Treating "not proven yet" as "proof expired" revoked
access and stripped `?c=` from the URL, dropping the user on the conversation list. Nothing leaks by
waiting, because `threadOpen` already requires a fresh lease — with no lease there is nothing on
screen to purge. Regression test: `tests/qa/unit/conversation-access-lease.test.js`.

**Backgrounding a thread for more than 30s and returning to the list is correct behaviour, not a bug.**

---

## 7. Checklist — adding a new screen

1. Decide **shell**: office (`src/pages/`, routed) or tech (`src/pages/tech/`).
2. If tech and it must preserve state across tab switches, it is a **pane** — mount it in
   `TechLayout`, add the nav item, and add the `location.pathname` comparison. Otherwise add a route.
3. If it must exist in the iOS app, add the page **and any co-located CSS** to
   `NATIVE_PAGE_ALLOWLIST` in `scripts/native-bundle-boundary.mjs`.
4. If it is a push or link destination, add the path to `STATIC_PATHS` / `FIELD_PATHS` in
   `src/lib/nativeNavigationTarget.js`, plus a `hasAllowedQuery` branch for any query param.
5. Run **`npm run build:ios`**, not just `npm run build` — CI will not catch a native boundary break.
6. Verify in the shell the target role actually lands in (§2), on a **native** build (§1).
