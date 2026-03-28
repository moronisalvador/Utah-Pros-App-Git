# TECH UI/UX Enhancement — Field-Optimized Mobile Experience
**Created:** March 28, 2026
**Goal:** Transform the 5 tech pages + TechLayout + TimeTracker from "web app on mobile" to "native-feeling field app" optimized for iPhone Safari, big thumbs, sunlight, and dumb-proof operation.
**Scope:** CSS + JSX changes ONLY. No new RPCs, no new tables, no backend changes. Same data flows.
**Reference apps:** Encircle, Jobber, ServiceTitan, GHL — screenshots reviewed with Moroni.

---

## Design Principles (apply to EVERY decision)

1. **48px minimum touch target** — no exceptions, no "close enough"
2. **Big text for field use** — body 15-16px, headers 22-28px, labels 12-13px
3. **Status = color** — the tech should know their state from 3 feet away (amber=OMW/en_route, green=working, red=paused, blue=scheduled, gray=completed)
4. **One primary action per screen** — TimeTracker button on Dash, task checkbox on Tasks, search on Claims
5. **Cards have depth** — subtle shadow + border, not border alone
6. **Press feedback everywhere** — active:scale(0.97) on all tappable elements
7. **Full-width action buttons** — no tiny pill buttons for critical actions

---

## Global CSS Tokens (add to index.css INSIDE the existing `@media (max-width: 768px)` for tech pages)

These override the desktop design system for tech pages only. Add them as CSS custom properties scoped to `.tech-layout`:

```css
.tech-layout {
  --tech-text-body: 15px;
  --tech-text-label: 12px;
  --tech-text-heading: 22px;
  --tech-text-hero: 28px;
  --tech-text-timer: 40px;
  --tech-radius-card: 16px;
  --tech-radius-button: 14px;
  --tech-shadow-card: 0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04);
  --tech-shadow-card-active: 0 1px 2px rgba(0,0,0,0.04);
  --tech-min-tap: 48px;
  --tech-row-height: 56px;
  --tech-nav-height: 64px;

  /* Status palette */
  --status-scheduled-bg: #eff6ff;
  --status-scheduled-color: #2563eb;
  --status-scheduled-border: #bfdbfe;
  --status-enroute-bg: #fffbeb;
  --status-enroute-color: #b45309;
  --status-enroute-border: #fde68a;
  --status-working-bg: #ecfdf5;
  --status-working-color: #059669;
  --status-working-border: #a7f3d0;
  --status-paused-bg: #fef2f2;
  --status-paused-color: #dc2626;
  --status-paused-border: #fecaca;
  --status-completed-bg: #f3f4f6;
  --status-completed-color: #6b7280;
  --status-completed-border: #e5e7eb;
}
```

---

## Batch 1 — Highest Impact (TechLayout + TimeTracker + TechDash + global CSS)

### 1A. TechLayout.jsx — Bottom Nav Upgrade

**Current:** 72px total, 20px icons, 10px labels, subtle active pill
**Target:** Taller, bolder, more native feel

Changes:
- Icon size: 20px → 26px
- Label size: 10px → 11px, font-weight 600 on active
- Active tab: filled icon (already works) + accent color text + background pill (30px tall, 44px wide, radius-full, `var(--accent-light)`)
- Tab tap target: entire tab column min 48px wide
- Nav background: keep frosted glass blur but make it slightly more opaque (`rgba(255,255,255,0.92)`)
- Badge dot: 8px diameter (up from 7), solid red, no border
- Add subtle top border shadow: `box-shadow: 0 -1px 0 0 rgba(0,0,0,0.05)`

### 1B. TimeTracker.jsx — Complete Visual Redesign

This is the single most important component. Redesign to be status-aware and impossible to miss.

**Layout structure:**
```
┌─────────────────────────────────┐
│  STATUS LABEL          elapsed  │  (small label + time right-aligned)
│                                 │
│        0:42:15                  │  (big timer, centered, 40px tabular-nums)
│                                 │
│  ┌─────────────────────────┐    │
│  │     [ACTION BUTTON]     │    │  (full-width, 52px tall, rounded 14px)
│  └─────────────────────────┘    │
│  ┌──────────┐ ┌────────────┐   │  (secondary actions row, if applicable)
│  │  Pause   │ │   Finish   │   │
│  └──────────┘ └────────────┘   │
└─────────────────────────────────┘
```

**State-specific styling:**

| State | Background | Primary Button | Button Text | Timer Color |
|-------|-----------|---------------|------------|-------------|
| Scheduled (no entry) | `var(--bg-secondary)` | Amber (#b45309) fill, white text | "On My Way" | — |
| En Route (travel_start) | Amber tint `#fffbeb` | Green (#059669) fill, white text | "Start Work" | `#b45309` |
| Working (clock_in, no pause) | Green tint `#ecfdf5` | — | — | `#059669` |
| Paused (paused_at) | Red tint `#fef2f2` | — | — | `#dc2626` |
| Completed (clock_out) | `var(--bg-secondary)` | — | — | `var(--text-tertiary)` |

**Working state buttons:** Two equal buttons side by side:
- "Pause" — secondary style (border, no fill)
- "Finish" — uses existing two-click confirm pattern (first click → red "Confirm Finish")

**Completed state:** Compact summary — single row: "Completed · In: 8:30 AM · Out: 12:15 PM · 3.5h"

**Timer digits:** `font-size: var(--tech-text-timer)` (40px), `font-variant-numeric: tabular-nums`, `font-weight: 700`, `letter-spacing: -0.5px`

**Container:** `border-radius: var(--tech-radius-card)`, padding 20px, the status-specific background color

**Action buttons:** `min-height: 52px`, `border-radius: var(--tech-radius-button)` (14px), `font-size: 16px`, `font-weight: 700`, full width, `touch-action: manipulation`

**"On My Way" button icon:** Add a small → arrow or car/navigation icon before text

### 1C. TechDash.jsx — Layout Restructure

**Current:** Header → expanded cards → collapsed cards → completed cards
**Target:** Greeting → TimeTracker hero → Active job → Upcoming timeline → Quick actions

**Header section:**
```jsx
<div className="tech-dash-greeting">
  <div className="tech-dash-date">{dateStr}</div>
  <div className="tech-dash-name">Hey {firstName} 👋</div>
  <div className="tech-dash-summary">{appointments.length} appointment{s} today</div>
</div>
```
- `.tech-dash-name`: `font-size: var(--tech-text-hero)` (28px), `font-weight: 800`
- `.tech-dash-date`: `font-size: var(--tech-text-label)`, `color: var(--text-tertiary)`, uppercase, letter-spacing
- `.tech-dash-summary`: `font-size: var(--tech-text-body)`, `color: var(--text-secondary)`

**TimeTracker hero placement:**
If there's an active or next appointment, render TimeTracker at the TOP of the page, outside any card, as a standalone hero component. This is the Encircle "Clock In" pattern — it's the first thing you see and interact with.

**Active appointment card (expanded):**
- Division-colored left border: 4px (up from 3px)
- Card: `border-radius: var(--tech-radius-card)`, `box-shadow: var(--tech-shadow-card)`
- Title: 17px bold
- Address: tappable, blue text with pin icon, 15px
- Task progress: inline bar — `"Tasks 3/5"` with a thin progress bar underneath (green fill, gray track, 4px tall, full-width, rounded)
- Remove the separate "Tasks" toggle — show tasks inline always if ≤ 5, toggle if > 5

**Future appointments (collapsed):**
- Timeline style: time on left (fixed 60px column), vertical line (2px, `var(--border-color)`), title + address on right
- Row height: 56px min
- Tap → navigates to TechAppointment detail

**Quick Actions row (below appointments):**
```
[ 📸 Photo ]  [ 💬 Message ]  [ 📅 Schedule ]
```
- 3 equal circular icon buttons (48px diameter) with 11px label underneath
- Centered horizontally
- Photo opens camera, Message goes to /tech/conversations, Schedule goes to /tech/schedule

**Skeleton loading upgrade:**
- Use shimmer animation instead of pulse (moving gradient from left to right)
- Match the actual layout structure (greeting skeleton + tracker skeleton + card skeleton)

### 1D. Global Tech CSS Updates

Add/modify in `index.css` within the `.tech-layout` scope or mobile media query:

**Card base class update:**
```css
.tech-appt-card {
  border-radius: var(--tech-radius-card);
  box-shadow: var(--tech-shadow-card);
  border: 1px solid var(--border-light);
  padding: 16px;
  margin-bottom: 12px;
}
.tech-appt-card:active {
  transform: scale(0.98);
  box-shadow: var(--tech-shadow-card-active);
}
```

**Typography overrides for tech pages:**
```css
.tech-layout .tech-page {
  font-size: var(--tech-text-body);
}
.tech-page-title {
  font-size: var(--tech-text-heading);
  font-weight: 800;
}
```

**Skeleton shimmer (replace pulse):**
```css
@keyframes tech-skeleton-shimmer {
  0% { background-position: -200px 0; }
  100% { background-position: calc(200px + 100%) 0; }
}
.tech-skeleton-line {
  background: linear-gradient(90deg, var(--bg-tertiary) 25%, #e8eaed 37%, var(--bg-tertiary) 63%);
  background-size: 200px 100%;
  animation: tech-skeleton-shimmer 1.4s ease-in-out infinite;
}
```

**Commit Batch 1.** Test on real iPhone. Verify:
- [ ] TimeTracker fills width and is the first visual element on TechDash
- [ ] Timer digits are readable from arm's length
- [ ] On My Way / Start Work buttons are easy to tap
- [ ] Bottom nav feels solid, active tab is clearly indicated
- [ ] Cards have visible depth (shadow)
- [ ] Quick actions row is centered and tappable
- [ ] Skeleton shimmer animates smoothly

---

## Batch 2 — Task + Schedule Polish (TechTasks + TechSchedule)

### 2A. TechTasks.jsx — Progress + Polish

**Completion summary at top of page (when tab === 'today'):**
```jsx
<div className="tech-tasks-summary">
  <div className="tech-tasks-ring">
    {/* SVG donut/ring showing completion percentage */}
    {/* Center text: "3/7" */}
  </div>
  <div>
    <div style={{ fontSize: 16, fontWeight: 700 }}>{doneCount} of {totalCount} done</div>
    <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>today's tasks</div>
  </div>
</div>
```
- Ring: 52px diameter SVG circle, stroke-dasharray for progress, green fill on track
- Positioned left of text, flex row, gap 12px
- Only shows on "Today" tab

**Job group headers:**
- Background: slightly stronger `var(--bg-tertiary)` or division-tinted
- Add mini progress bar (4px, same as TechDash task bar) showing group completion
- Job number: 14px bold mono
- Insured name: 14px regular
- Task count + chevron: right-aligned

**Task rows:**
- Row height: `var(--tech-row-height)` (56px)
- Checkbox: 26px (up from 24px)
- Task name: `var(--tech-text-body)` (15px)
- Phase name subtitle: 12px
- Check animation: on complete, checkbox scales to 1.1 then back to 1.0 (CSS transition, 150ms)
- Completed tasks: softer strikethrough + lower opacity (0.5) instead of just color change

**Pill tabs (Today/All):**
- Height: 40px (up from ~32px)
- Font: 14px
- Active: filled accent, white text
- Inactive: `var(--bg-tertiary)` border, `var(--text-secondary)` text
- Gap: 10px

**Swipe to complete:**
- Green reveal bg: add a checkmark icon + "Done" text
- Threshold: keep at 60px but add a subtle haptic at 40px (approaching threshold)

### 2B. TechSchedule.jsx — Timeline Polish

**Date headers:**
- Today: accent background pill (`var(--accent-light)`) with bold accent text — make it POP
- Tomorrow: subtle tint
- Other days: standard but bolder (14px weight 700)

**Appointment rows:**
- Left section (fixed 70px): time in 14px bold, duration underneath in 11px tertiary
- Vertical divider: 2px line, division-colored (water=blue, mold=pink, recon=amber, fire=red)
- Right section: title 15px bold, address 13px secondary, type pill + status pill below
- Row min-height: 72px
- Row padding: 14px horizontal

**Division color stripe:**
Instead of the current status pills being the only color, add a 4px left border on each row colored by division (same pattern as the cards on TechDash):
```css
.tech-schedule-row[data-division="water"]          { border-left: 4px solid #3b82f6; }
.tech-schedule-row[data-division="mold"]           { border-left: 4px solid #ec4899; }
.tech-schedule-row[data-division="reconstruction"] { border-left: 4px solid #f59e0b; }
.tech-schedule-row[data-division="fire"]           { border-left: 4px solid #ef4444; }
.tech-schedule-row[data-division="contents"]       { border-left: 4px solid #10b981; }
```

**Jump-to-today FAB:**
- Bigger: padding 10px 24px, font 14px
- Add a small ↑ arrow icon before "Today"
- Background: `var(--accent)`, white text (instead of dark)

**Empty state:**
- Bigger icon (56px)
- "You're all clear for the next 2 weeks" (more personality than "No upcoming appointments")
- Link to "View past schedule" or similar

**Commit Batch 2.** Test on real iPhone. Verify:
- [ ] Task completion ring renders and updates
- [ ] Task rows are 56px tall and easy to tap
- [ ] Check animation plays on task complete
- [ ] Schedule day headers are scannable — Today jumps out
- [ ] Appointment rows are tall enough, division color visible
- [ ] Jump-to-today FAB is accent-colored and tappable

---

## Batch 3 — Claims + Appointment Detail (TechClaims + TechAppointment)

### 3A. TechClaims.jsx — Encircle-Style List

**Search bar:**
- Height: 48px (up from default)
- Font: 16px (prevents iOS zoom)
- Rounded: 12px
- Placeholder icon: slightly larger (18px)

**Claim rows — redesign to match Encircle claim list style:**
```
┌─────────────────────────────────────┐
│  CLM-2603-005         Mar 20, 2026  │  (claim number mono + date right)
│  Ben Johnson                        │  (bold name, 16px)
│  92 W 940 N St, Orem, UT           │  (address in accent color, tappable feel)
│  [water] [2 jobs] [open]            │  (pills row: division + job count + status)
└─────────────────────────────────────┘
```
- Row padding: 16px horizontal, 14px vertical
- Name: 16px bold (up from 14px)
- Address: 14px, `var(--accent)` color (like Encircle's blue/orange addresses)
- Claim number: 12px mono tertiary
- Date: 12px tertiary, right-aligned on same line as claim number
- Division pill: colored by division (small, 10px text, rounded)
- Job count pill: gray
- Status pill: status-colored
- Bottom border: 1px `var(--border-light)`
- Min row height: 80px
- Active press state: `background: var(--bg-secondary)` on :active

**Empty state when searching:**
- "No claims match '[query]'" — include the actual search term
- Clear search button

### 3B. TechAppointment.jsx — Colored Hero + Action Bar

**Hero header — replace current plain white header with a division-colored block:**
```
┌─────────────────────────────────────┐
│ ← back                    [status]  │  (top bar: back button, status pill)
├─────────────────────────────────────┤
│                                     │
│  Water Damage Assessment            │  (title, 20px bold, white text)
│  26-22 · Ben Johnson                │  (job number + name, 14px, white/80%)
│  92 W 940 N St, Orem, UT           │  (address, 14px, white/70%)
│                                     │
├─────────────────────────────────────┤
│  🧭 Navigate  📞 Call  💬 Msg  📸  │  (action bar, evenly spaced icons+labels)
└─────────────────────────────────────┘
```

- Hero background: division gradient
  - water: `linear-gradient(135deg, #1e40af, #3b82f6)`
  - mold: `linear-gradient(135deg, #831843, #ec4899)`
  - reconstruction: `linear-gradient(135deg, #78350f, #f59e0b)`
  - fire: `linear-gradient(135deg, #7f1d1d, #ef4444)`
  - contents: `linear-gradient(135deg, #064e3b, #10b981)`
  - default: `linear-gradient(135deg, #1e3a5f, #3b82f6)`
- Text: white, with opacity layers for hierarchy
- Back button: white, left-aligned
- Status pill: white background, division-colored text

**Action bar (directly below hero, white background):**
- 4 actions evenly distributed: Navigate, Call, Message, Photo
- Each: 24px icon above 10px label, centered in column
- Tap target: 64px wide × 56px tall each
- Thin bottom border to separate from content
- Navigate: opens Apple Maps / Google Maps
- Call: `tel:` link (only show if client_phone exists)
- Message: navigate to /tech/conversations
- Photo: trigger camera input

**TimeTracker:** Full-width below action bar, same redesign from Batch 1

**Tasks section:**
- Progress bar at section top (same 4px bar pattern)
- Task rows: same 56px height as TechTasks
- Checkbox: 26px

**Photos section:**
- Grid: 2 columns instead of 3 (bigger thumbnails on mobile)
- Thumbnail border-radius: 12px
- Aspect ratio: 1:1

**Lightbox:**
- Add pinch-to-zoom (CSS `touch-action: pinch-zoom` on the img)
- Swipe down to dismiss (optional — skip if complex)

**Notes section:**
- Note input: min-height 100px, 16px font
- Saved notes: slightly bigger text (14px)
- Add timestamp relative ("2h ago" instead of "Mar 28, 3:15 PM")

**Commit Batch 3.** Test on real iPhone. Verify:
- [ ] Hero header shows division color gradient with white text
- [ ] Action bar icons are tappable and properly spaced
- [ ] Navigate button opens Maps app
- [ ] Call button only shows when phone number exists
- [ ] Search bar in Claims doesn't cause iOS zoom
- [ ] Claim rows are tall enough and address is accent-colored
- [ ] Photo grid is 2-column and thumbnails are large enough
- [ ] Lightbox supports pinch-to-zoom

---

## Batch 4 — Transitions + Final Polish

### 4A. Page Transitions

Add slide transitions between all tech pages (not just TechAppointment):

- Forward navigation (deeper): slide in from right
- Back navigation: slide in from left
- Tab switches (bottom nav): crossfade (not slide)

Implementation: CSS classes on `.tech-content` based on navigation direction. Use React Router's `useLocation` to detect direction. Keep it simple — CSS only, no heavy animation libraries.

```css
.tech-content {
  animation: tech-fade-in 0.15s ease-out;
}

@keyframes tech-fade-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

NOTE: Do NOT use `translateX` for tab switches (feels wrong for bottom nav). Use a subtle `translateY(8px)` fade-up instead. Only TechAppointment keeps its slide-from-right animation since it's a drill-down view.

### 4B. Checkbox + Button Animations

**Task checkboxes:**
```css
.tech-task-check {
  transition: background 0.15s, border-color 0.15s, transform 0.15s;
}
.tech-task-check.done {
  animation: tech-check-pop 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}
@keyframes tech-check-pop {
  0%   { transform: scale(1); }
  50%  { transform: scale(1.15); }
  100% { transform: scale(1); }
}
```

**Buttons:**
```css
.tech-layout .btn {
  transition: transform 0.1s, box-shadow 0.1s, background 0.15s;
}
.tech-layout .btn:active {
  transform: scale(0.97);
}
```

### 4C. Misc Polish

- **Pull-to-refresh:** Add a branded spinner or loading indicator instead of default
- **Toast messages:** Ensure they appear above the bottom nav (bottom offset = nav height + safe area + 8px)
- **Empty states:** Replace generic SVG icons with slightly more expressive ones (e.g., calendar with checkmark for "all clear", clipboard for no tasks)
- **Haptic refinement:** Ensure haptic fires on: task complete, time tracker actions, pull-to-refresh trigger, swipe threshold reached

**Commit Batch 4.** Test on real iPhone. Verify:
- [ ] Page transitions feel smooth, not jarring
- [ ] Checkbox pop animation plays
- [ ] Button press states feel satisfying
- [ ] Toasts don't overlap bottom nav
- [ ] Overall app feels native, not webby

---

## Files Modified (complete list)

| File | Batches | Type of change |
|------|---------|---------------|
| `src/index.css` | 1, 2, 3, 4 | New CSS tokens, card styles, animations, tech-specific overrides |
| `src/components/TechLayout.jsx` | 1 | Bottom nav visual upgrade |
| `src/components/tech/TimeTracker.jsx` | 1 | Complete visual redesign (status-colored, big buttons) |
| `src/pages/tech/TechDash.jsx` | 1 | Layout restructure (greeting + hero tracker + timeline + quick actions) |
| `src/pages/tech/TechTasks.jsx` | 2 | Completion ring, bigger rows, check animation |
| `src/pages/tech/TechSchedule.jsx` | 2 | Timeline layout, division colors, bigger rows |
| `src/pages/tech/TechClaims.jsx` | 3 | Encircle-style rows, bigger search, accent addresses |
| `src/pages/tech/TechAppointment.jsx` | 3 | Colored hero, action bar, 2-col photos |

**NO files outside of tech pages and components are touched. NO desktop styles are modified.**

---

## What NOT to Change

- Desktop admin UI — untouched
- Conversations page — shared between admin and tech, don't modify
- Any RPCs or database — pure frontend
- TechLayout tab definitions (Dash/Schedule/Tasks/Messages/Claims) — keep all 5
- Data fetching logic — keep all `db.rpc()` calls as-is
- PullToRefresh component — keep as-is, just style the trigger
- TimeTracker state machine logic (OMW → Start → Pause/Resume → Finish) — keep, only change visuals

---

## Completion Checklist

When all 4 batches are done:
1. Update `UPR-Web-Context.md`:
   - Under "Auth & Session → Tech mobile polish" section, replace the current description with updated list of enhancements
   - Add note about status-colored TimeTracker, division-gradient hero, action bar pattern
2. Delete this file: `git rm TECH-UI-TASK.md`
3. Commit: `docs: update UPR-Web-Context.md, remove completed TECH-UI-TASK.md`
