# Loading, Error & Empty States Standard

Linked from `CLAUDE.md`. **The law for what a page shows while loading, on failure, and when empty.**
Resolves the contradiction the audit found (CLAUDE.md blessed `TabLoading` while pages hand-rolled 6
loading primitives, and a failed load rendered the *success* empty-state on the highest-traffic screens).
Audited by `page-behavior-checker` + `design-consistency-checker`.

## 1. A failed load NEVER renders the success empty-state or a blank page

This is the highest-impact rule. The audit found a failed `get_dispatch_board` renders "No jobs in
production" (a dispatcher reads an outage as an empty schedule — `Schedule.jsx:529→769`), a `JobPage`
load failure renders a blank white page (`:84→130`), and 5+ lists show "No X yet. Create one" after a
failed fetch.

- Every `load()` catch either sets a `loadError` state **or** toasts via `lib/toast` — it must not fall
  through to the empty-state render. `db.select`/`db.rpc` THROW on non-OK, so the catch always fires.
- Render the shared **`<ErrorState message onRetry>`** (F-S2; pattern copied from `Jobs.jsx:159-168` /
  `TechJobDetail.jsx:330`). Keep already-loaded stale rows visible with a banner where possible, rather
  than replacing them.

## 2. Three distinct states — never conflate them

| State | When | What renders |
|---|---|---|
| **loading** | cold load, no data yet | a loading primitive (§3) |
| **error** | a load threw | `<ErrorState message onRetry>` (+ stale rows if any) |
| **empty** | load SUCCEEDED, zero rows | `<EmptyState icon title sub action?>` |

`<EmptyState>` renders **only** after a successful load. Tech empty states show *upcoming work* per
`tech-mobile-ux.md` (e.g. next 7 days when today is empty), not a dead end.

## 3. Loading vocabulary (one per context — no bare "Loading…" text)

- **`<TabLoading/>`** — tab/panel bodies (import from `@/components/TabLoading`).
- **Skeleton** — tech + tech-v2 + Overview widgets (matches the shipped react-query surfaces).
- **`.loading-page` spinner** — route-level cold loads ONLY.
- Bare `Loading…` text and per-page bespoke spinners are banned (the audit found ~37 files with bare
  text and 6 competing primitives).

## 4. Toast — one entry point

- `src/lib/toast.js` (`toast` / `ok` / `err`) is the **only** way to raise a toast. Raw
  `window.dispatchEvent(new CustomEvent('upr:toast', …))` and local `errToast` copies are banned
  (eslint-enforced; the audit found 125 raw dispatches + 22 local copies). `err()`/`ok()` are thin
  wrappers to add — see the migration in `W3`.
- Both toast containers carry `role="status" aria-live="polite"` (errors `role="alert"`) so the mandated
  feedback channel is announced to screen readers (`Layout.jsx`, `TechLayout.jsx`).
- Never `alert()` / `confirm()` (CLAUDE.md Rule 2; eslint-enforced). Destructive actions use inline
  two-click confirm via `useTwoClickConfirm`.

## 5. Truncation always pairs with a way to reach the rest

Any hard row limit (top-N) pairs with server-side search or a load-more control — never a silent
dead-end (the audit found a 300-job picker that silently caps). See `perf-budget.md` for unbounded-list
rules.

## 6. Pull-to-refresh

`onRefresh` is always the **silent** `load` (no loading-flag flip — see `page-lifecycle.md` §1); PTR must
never unmount the page. `PullToRefresh` wraps content BELOW the fixed header, not the header
(`tech-mobile-ux.md`).
