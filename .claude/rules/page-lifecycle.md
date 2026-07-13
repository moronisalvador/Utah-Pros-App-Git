# Page Lifecycle Standard

Linked from `CLAUDE.md`. **The law for how every page behaves across mount, refetch, mutation,
resume, poll, and navigation.** Born from the 2026-07 resume-behavior investigation (a page reset its
in-progress state when a tech minimized the app to the calculator and came back) and the full UX audit
that found 8 hand-rolled visibility handlers, 11 surfaces that blank a rendered page, and 6 loading
primitives. **Every fix here already exists in-repo as a gold standard — cite it, don't reinvent.**

Audited by `page-behavior-checker` on every PR that touches `src/pages` or `src/components`. Companion:
`loading-error-states.md` (what a page shows), `perf-budget.md` (data-fetch hygiene).

## The gold standard: Schedule does nothing on resume

`src/pages/Schedule.jsx` is the reference "correct" page: it registers **no** visibilitychange / focus /
pageshow / reload listener. Its loaders key only on stable inputs and run once. On a warm resume nothing
re-fires, so every `useState`, scroll position, and half-typed input is left exactly as the tech left it.
**That is the target behavior for every page.** `EstimateEditor`/`InvoiceEditor` go one better — they
hold the db client in a `dbRef` so a token refresh never re-runs their load (now unnecessary since
`stableDb`, but the pattern is instructive).

## 1. Loading gate — cold-start only

**After the first successful render, a page-level loading gate (`if (loading) return <Spinner/>`) may
fire ONLY on a route/param change — never on a mutation callback, pull-to-refresh, poll, or resume.**

- **Rule of thumb:** `loading` starts `true` and is only ever set `false`. A refetch does NOT set it back
  to `true`. Gold: `src/pages/tech/TechAppointment.jsx:135-160` (load never re-sets loading). Offender
  pattern the audit found: 9 tech pages set `setLoading(true)` inside `load()`, so pull-to-refresh
  unmounts the whole page into a spinner mid-gesture.
- If a refetch genuinely needs a busy indicator, use a **separate** `refreshing` flag that does not gate
  the whole render, or the `{ silent }` param pattern (`src/pages/crm/CrmCallLog.jsx:399-414`).

## 2. Refetch on resume/focus — silent, guarded, through ONE hook

- Resume/focus refetches are **always silent** (never flip a page loading flag, never replace an array
  wholesale, never move scroll) and **request-guarded** (a cancelled-flag closure so a slow response for
  an old param can't overwrite newer state).
- Use the shared **`useResumeRefetch({ onResume, onFocus, pollMs, hiddenEdgeOnly })`** hook (F-S2). Do
  **not** hand-roll `addEventListener('visibilitychange'|'focus')` in a page. Behavior model: the
  hidden→visible edge detection in `Conversations.jsx:475-489` + the hidden-pause in
  `usePolledRpc.js:58-84`.
- Default to `hiddenEdgeOnly` (fire only on a real hidden→visible transition, not every desktop refocus).
- `db` identity is stable (`src/lib/stableDb.js` + `AuthContext.bindAuthDb`) — **never** rebuild the db
  client on token refresh, and never list anything that changes on resume in a loader's dep array.

## 3. Mutations — patch in place, never blank the page

- A single-row mutation **patches state in place** with an optimistic update + rollback + `err()` toast on
  failure. Gold: `TechTasks.jsx:186-199`, `JobPage.jsx:94-124`. Do **not** re-run a spinner-gated `load()`
  from a mutation callback (offenders: `Schedule.jsx` modal saves, `ClaimPage.jsx` add-job/merge — they
  flash the whole page away).
- A collection-shape change (add/remove rows) uses the page's **silent** reload (e.g.
  `Schedule.jsx:532 silentReloadBoard`), never the blanking one.

## 4. Polling — cleanup + hidden-guard + never toast

- Every `setInterval` has a cleanup return AND an `if (document.hidden) return` guard (copy
  `usePolledRpc.js:62`). 4 of 7 polls were missing the guard.
- A background poll **never** toasts (a silent 30s poll must not surface a toast on its own — `StatusBoard`
  did).

## 5. Scroll & navigation

- **"New route = top, back = restored."** Scroll restoration is owned by one primitive (a
  per-`location.key` save on the shell scroller); pages don't hand-roll it.
- Navigation is always `navigate()` (react-router). `window.location.href` / `.replace()` is allowed
  **only** for cross-origin or OAuth redirects (offender: `ClaimsList.jsx:269` full-reloads to a job).
- A list page preserves scroll + filter/search state across a detail-nav-and-back and across resume.

## 6. Async event handlers own their errors

- Every user-triggered async handler wraps its body in `try/catch` ending in an `err()` toast — never a
  bare `await` that can reject unhandled. `db.select` THROWS on any non-OK response (it does not return
  `[]` on 404), so every `load()` needs a catch (see `loading-error-states.md` for what the catch renders).

## Quick self-check (the minimize test — mandatory at close-out)

Background/minimize the PWA (or hide the browser tab) for 30s+, then resume. **Nothing should happen:**
no blank content, no spinner flash, no route loss, no scroll loss, no lost form input. If anything moves,
a rule above is being violated.
