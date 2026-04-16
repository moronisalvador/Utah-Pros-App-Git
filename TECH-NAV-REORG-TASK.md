# Tech Nav Reorg — TASK

**Goal:** Reorganize the tech mobile app's bottom nav so Claims takes position 2 (right after Dash), Tasks is demoted out of the primary bar, and a new "More" tab opens a full-page list of secondary tools that can grow over time. Also flip the Claims page default from "My Claims" to "All Claims" and persist the user's last-used toggle.

**Branch:** `dev` only. Commit after every 2–3 files. Do not merge to `main` — user will test and approve.

**Files we'll touch:**
- `src/pages/tech/TechClaims.jsx` — default + localStorage persistence
- `src/components/TechLayout.jsx` — tab order, More tab, task-badge relocation
- `src/components/Icons.jsx` — new `IconMoreDots` (horizontal three dots) if not present
- `src/pages/tech/TechMore.jsx` — new page, full-screen list
- `src/App.jsx` — add `/tech/more` route
- `src/index.css` — minor styles for More list rows if not already reusable

**Final tab order:** `Dash | Claims | Schedule | Messages | More`
Tasks stays reachable at `/tech/tasks` via the More page. The task-count red dot moves from the Tasks tab icon to the More tab icon, and the Tasks row inside More shows a count badge.

**UX decisions already made:**
- "More" icon = horizontal three dots (⋯)
- "More" is a full-page route (`/tech/more`), not a drawer overlay — gives real URLs, back-button, and a simple list pattern that matches every other tech page
- Admin section in More is deferred — stubbed in Phase 5 once admin tools are defined
- Claims: keep "Mine/All" toggle, default to "All", remember last choice per device in `localStorage` under key `upr:tech-claims-scope`

---

## Phase 1 — Claims defaults + sticky preference

**What to build:**
1. Change `useState('mine')` → `useState(() => localStorage.getItem('upr:tech-claims-scope') || 'all')` in `TechClaims.jsx`
2. Add a `useEffect` that writes `scope` back to localStorage whenever it changes
3. Verify the existing toggle UI still works (it just reads/writes `scope`)

**Files:** `src/pages/tech/TechClaims.jsx` only.

**Acceptance:**
- Fresh install (empty localStorage) → Claims page opens with "All Claims" selected
- User taps "My Claims" → reloads correctly, next visit still shows "My Claims"
- User taps back to "All Claims" → persists across reloads
- No visual or behavioral change to anything else on the page

**Commit:** `feat(tech-claims): default to all + persist scope toggle`

---

## Phase 2 — Nav reorder + empty "More" tab

**What to build:**
1. Add a `IconMoreDots` component (horizontal three dots SVG) — place inline in `TechLayout.jsx` matching the existing icon pattern, or add to `src/components/Icons.jsx`
2. Update the `TABS` array in `TechLayout.jsx`:
   ```js
   { key: 'dash',     label: 'Dash',     path: '/tech',               Icon: IconHome,     exact: true },
   { key: 'claims',   label: 'Claims',   path: '/tech/claims',        Icon: IconFolder },
   { key: 'schedule', label: 'Schedule', path: '/tech/schedule',      Icon: IconCalendar },
   { key: 'messages', label: 'Messages', path: '/tech/conversations', Icon: IconChat },
   { key: 'more',     label: 'More',     path: '/tech/more',          Icon: IconMoreDots },
   ```
   — note Tasks is removed from primary nav
3. Create `src/pages/tech/TechMore.jsx` — for this phase just render a `.tech-page` header with "More" and an empty state ("Coming soon"). Phase 3 fills it in.
4. Register the route in `src/App.jsx` inside the existing tech routes block (same wrappers as other `/tech/*` routes)
5. Task-count logic in `TechLayout.jsx` still runs — for this phase, don't show the badge yet (we'll reattach it in Phase 4). Or temporarily show it on Tasks-inside-More (skip for now).

**Files:** `TechLayout.jsx`, `TechMore.jsx` (new), `App.jsx`, possibly `Icons.jsx`.

**Acceptance:**
- Bottom nav shows 5 tabs in this order: Dash, Claims, Schedule, Messages, More
- Tapping More navigates to `/tech/more` and shows an empty placeholder
- Tasks page is no longer in the primary nav but `/tech/tasks` still works if typed manually
- All other tabs work exactly as before

**Commit:** `feat(tech-nav): reorder tabs, replace Tasks with More`

---

## Phase 3 — Populate More page

**What to build:**
List of rows with leading icon + label + trailing chevron + optional badge/"Coming soon" pill. Follow existing `.tech-page` patterns.

Sections:
- **Work**
  - Tasks → `/tech/tasks` *(link, shows count badge when `taskCount > 0`)*
  - Collections → `/tech/collections` *(stub, "Coming soon")*
  - Time Tracking → `/tech/time` *(stub, "Coming soon")*
- **Resources**
  - Training Docs *(stub, "Coming soon")*
  - Checklists *(stub, "Coming soon")*
  - Demosheet Tool *(stub, "Coming soon")*

Each row is a tappable element with 56px min height. "Coming soon" rows render as non-clickable with a subtle pill on the right. Real links use `<Link to=...>`.

Reuse the `taskCount` loading pattern from TechLayout (already polling every 60s) — expose it via prop, context, or duplicate the small query inside `TechMore`. Duplicating is simplest for now; we can lift to context later.

**Files:** `TechMore.jsx`, possibly icon imports.

**Acceptance:**
- More page shows 2 section headers and 6 rows
- Tasks row shows correct count when incomplete tasks exist today
- "Coming soon" rows visually distinct and non-interactive
- 48px minimum tap targets on real rows

**Commit:** `feat(tech-more): add section list with tasks + future-tool stubs`

---

## Phase 4 — Task badge on More tab icon

**What to build:**
- Move the existing red-dot badge from the Tasks tab (no longer exists in nav) to the More tab icon
- Logic in `TechLayout.jsx` already computes `taskCount` — just change which tab the dot decorates

**Files:** `TechLayout.jsx` only.

**Acceptance:**
- When `taskCount > 0`, red dot appears on the More tab icon
- When all today's tasks are complete, dot disappears
- No other visual changes

**Commit:** `feat(tech-nav): move task badge to More tab`

---

## Phase 5 — Admin section (deferred)

**Deferred until admin tools are specified.** When ready:
- Add an **Admin** section at the bottom of `TechMore.jsx`
- Gate entire section via `canAccess('more:admin')` or check `employee.role === 'admin'` / `manager`
- Populate with whatever admin tools are defined at that point

No commit for this phase until admin tools are scoped.

---

## Completion checklist (when Phases 1–4 ship and user confirms)

1. Update `UPR-Web-Context.md`:
   - Tech nav section: document new tab order, More page pattern, task badge location
   - Add `TechMore.jsx` to file structure
   - Add `/tech/more` route to routing notes
2. Delete this task file: `git rm TECH-NAV-REORG-TASK.md`
3. Commit: `docs: update UPR-Web-Context.md, remove completed TECH-NAV-REORG-TASK.md`
4. User merges `dev` → `main`
