# Tech View — Mobile Polish Task
**Branch:** dev only  
**Commit after every 2–3 files. Test on real iPhone after each batch.**

---

## Pre-flight

1. Read `CLAUDE.md`, `UPR-Web-Context.md`, `UPR-Design-System.md`
2. Read all files you will touch before editing them — never assume contents
3. All changes are mobile-only unless explicitly stated otherwise
4. Use `@media (max-width: 768px)` for any new CSS — never change desktop layout

---

## Batch 1 — Immediate impact (highest ROI)

### 1A. Press states on all cards and buttons

**Files:** `src/index.css`

Every tappable element in the tech view needs visible press feedback. Add to the tech CSS block:

```css
/* Press states */
.tech-appt-card { cursor: pointer; transition: transform 0.1s, box-shadow 0.1s; }
.tech-appt-card:active { transform: scale(0.985); box-shadow: none; }

.tech-nav-tab:active { opacity: 0.6; }

.tech-appt-address:active { opacity: 0.7; }
```

Also add `-webkit-touch-callout: none` and `-webkit-user-select: none` to `.tech-appt-card`, `.tech-nav-tab`, `.tech-tracker`, all buttons inside tech pages — prevents iOS long-press popup on UI chrome.

Add `touch-action: manipulation` to all buttons and tappable cards in the tech CSS block — eliminates 300ms tap delay on iOS.

### 1B. Card status left border

**Files:** `src/index.css`

Appointment cards should have a left border color matching status — same pattern as job cards on the Jobs page:

```css
.tech-appt-card[data-status="scheduled"]   { border-left: 3px solid #3b82f6; }
.tech-appt-card[data-status="en_route"]    { border-left: 3px solid #f59e0b; }
.tech-appt-card[data-status="in_progress"] { border-left: 3px solid #10b981; }
.tech-appt-card[data-status="paused"]      { border-left: 3px solid #ef4444; }
.tech-appt-card[data-status="completed"]   { border-left: 3px solid #d1d5db; }
```

**Files:** `src/pages/tech/TechDash.jsx`

Add `data-status={appt.status}` to each `.tech-appt-card` div.

### 1C. Task checkbox size and animation

**Files:** `src/index.css`

Task checkboxes must be minimum 44px tap target on mobile. Update:

```css
@media (max-width: 768px) {
  .tech-task-row {
    min-height: 44px;
    padding: 10px 0;
  }

  .tech-task-check {
    width: 24px;
    height: 24px;
    border-radius: 6px;
    flex-shrink: 0;
    transition: background 0.15s, border-color 0.15s, transform 0.1s;
  }

  .tech-task-check.done {
    background: var(--accent);
    border-color: var(--accent);
    transform: scale(1.05);
  }

  .tech-task-name {
    font-size: 15px;
    line-height: 1.4;
    transition: color 0.15s, text-decoration 0.15s;
  }

  .tech-task-name.done {
    color: var(--text-tertiary);
    text-decoration: line-through;
  }
}
```

### 1D. Haptic feedback on time tracker actions

**Files:** `src/pages/tech/TechDash.jsx`, `src/components/tech/TimeTracker.jsx` (if extracted)

Add haptic feedback via `navigator.vibrate()` on every time tracker action. Add this helper at the top of the file:

```js
const haptic = (ms = 50) => { 
  if ('vibrate' in navigator) navigator.vibrate(ms); 
};
```

Call `haptic()` before each clock action:
- OMW: `haptic(50)` — light
- Start: `haptic(50)` — light  
- Pause: `haptic(30)` — very light
- Resume: `haptic(50)` — light
- Finish (confirm): `haptic([50, 30, 50])` — double pulse — satisfying completion

### 1E. Skeleton loading states

**Files:** `src/pages/tech/TechDash.jsx`, `src/index.css`

Replace the spinner on TechDash with skeleton cards while loading. Add CSS:

```css
@keyframes tech-skeleton-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.tech-skeleton-card {
  background: var(--bg-primary);
  border-radius: var(--radius-xl);
  border: 1px solid var(--border-color);
  padding: var(--space-4);
  margin-bottom: var(--space-3);
  animation: tech-skeleton-pulse 1.4s ease-in-out infinite;
}

.tech-skeleton-line {
  background: var(--bg-tertiary);
  border-radius: var(--radius-sm);
  height: 12px;
  margin-bottom: 10px;
}

.tech-skeleton-line.short { width: 40%; }
.tech-skeleton-line.medium { width: 65%; }
.tech-skeleton-line.long { width: 90%; }
.tech-skeleton-line.tall { height: 16px; }
```

In TechDash, while `loading === true` render 2 skeleton cards instead of a spinner:

```jsx
{loading && (
  <>
    {[1, 2].map(i => (
      <div key={i} className="tech-skeleton-card">
        <div className="tech-skeleton-line short" />
        <div className="tech-skeleton-line tall medium" />
        <div className="tech-skeleton-line long" />
        <div style={{ height: 16 }} />
        <div className="tech-skeleton-line long" />
        <div className="tech-skeleton-line medium" />
      </div>
    ))}
  </>
)}
```

### 1F. Relative time on future appointment cards

**Files:** `src/pages/tech/TechDash.jsx`

For appointments that haven't started yet, show relative time under the time:

```js
function getRelativeTime(appt) {
  const apptDate = new Date(`${appt.date}T${appt.time_start || '00:00'}`);
  const diffMs = apptDate - Date.now();
  if (diffMs < 0) return null;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 60) return `in ${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  const remMin = diffMin % 60;
  if (remMin === 0) return `in ${diffHr}h`;
  return `in ${diffHr}h ${remMin}m`;
}
```

Show this as a small badge next to the time on future (not yet started) cards.

**Commit Batch 1.**

---

## Batch 2 — High value interactions

### 2A. iOS global fixes

**Files:** `src/index.css`

Add this block inside the existing `@media (max-width: 768px)` section or as a new tech-specific block:

```css
@media (max-width: 768px) {
  /* Momentum scrolling on all scroll containers */
  .tech-content,
  .tech-page,
  .tech-appt-detail-scroll {
    -webkit-overflow-scrolling: touch;
    overscroll-behavior-y: contain;
  }

  /* Remove focus outline — replaced by press states */
  .tech-nav-tab:focus,
  .tech-appt-card:focus {
    outline: none;
  }

  /* Prevent text selection on UI chrome */
  .tech-nav,
  .tech-appt-card,
  .tech-tracker {
    -webkit-user-select: none;
    user-select: none;
  }

  /* Remove tap highlight */
  .tech-nav-tab,
  .tech-appt-card,
  .tech-task-row {
    -webkit-tap-highlight-color: transparent;
  }
}
```

**Files:** `index.html`

Update the status bar meta tag:
```html
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
```

### 2B. Sticky date headers in TechDash

**Files:** `src/pages/tech/TechDash.jsx`, `src/index.css`

The "Today" date/greeting header should stick at the top as you scroll appointments. Wrap it in a sticky container:

```css
@media (max-width: 768px) {
  .tech-page-header-sticky {
    position: sticky;
    top: 0;
    z-index: 10;
    background: var(--bg-secondary);
    padding: var(--space-3) var(--space-4);
    margin: 0 calc(-1 * var(--space-4));
    border-bottom: 1px solid var(--border-light);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    background: rgba(248, 249, 251, 0.9);
  }
}
```

Replace `.tech-page-header` with `.tech-page-header-sticky` on TechDash.

### 2C. Sticky section headers in TechAppointment

**Files:** `src/pages/tech/TechAppointment.jsx`, `src/index.css`

Section headers (TIME TRACKER, CREW, TASKS, PHOTOS, NOTES) should stick as you scroll:

```css
@media (max-width: 768px) {
  .tech-section-header-sticky {
    position: sticky;
    top: 0;
    z-index: 5;
    background: rgba(248, 249, 251, 0.92);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    padding: 10px var(--space-4) 6px;
    margin: 0 calc(-1 * var(--space-4));
    font-size: 11px;
    font-weight: 700;
    color: var(--text-tertiary);
    letter-spacing: 0.8px;
    text-transform: uppercase;
    border-bottom: 1px solid var(--border-light);
  }
}
```

Replace section header divs in TechAppointment with this class.

### 2D. Tab bar blur effect

**Files:** `src/index.css`

```css
@media (max-width: 768px) {
  .tech-nav {
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    background: rgba(255, 255, 255, 0.85);
    border-top: 1px solid rgba(226, 229, 233, 0.8);
  }
}
```

### 2E. Active tab pill indicator

**Files:** `src/index.css`

Replace the color-only active state with a filled pill background:

```css
@media (max-width: 768px) {
  .tech-nav-tab.active {
    color: var(--accent);
    position: relative;
  }

  .tech-nav-tab.active::before {
    content: '';
    position: absolute;
    top: 6px;
    left: 50%;
    transform: translateX(-50%);
    width: 36px;
    height: 28px;
    background: var(--accent-light);
    border-radius: var(--radius-full);
    z-index: -1;
  }
}
```

### 2F. Swipe to complete tasks

**Files:** `src/pages/tech/TechTasks.jsx`, `src/index.css`

Add swipe-right gesture to complete tasks. Use pointer events (works on iOS Safari):

```js
// In each task row — track swipe with onPointerDown/onPointerMove/onPointerUp
const [swipeX, setSwipeX] = useState(0);
const startX = useRef(null);

const handlePointerDown = (e) => { startX.current = e.clientX; };
const handlePointerMove = (e) => {
  if (startX.current === null) return;
  const dx = e.clientX - startX.current;
  if (dx > 0) setSwipeX(Math.min(dx, 80));
};
const handlePointerUp = (e) => {
  if (swipeX > 60) {
    haptic(50);
    toggleTask(task);
  }
  setSwipeX(0);
  startX.current = null;
};
```

Style the task row with `transform: translateX(${swipeX}px)` and show a green checkmark reveal underneath:

```css
.tech-task-swipe-wrap {
  position: relative;
  overflow: hidden;
  border-radius: var(--radius-md);
}

.tech-task-swipe-bg {
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 80px;
  background: #10b981;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
}

.tech-task-row {
  position: relative;
  background: var(--bg-primary);
  transition: transform 0.1s ease-out;
  will-change: transform;
}
```

### 2G. Collapsible job groups in TechTasks

**Files:** `src/pages/tech/TechTasks.jsx`

Each job group header should be tappable to collapse/expand its task list:

```js
const [collapsed, setCollapsed] = useState({});
const toggleCollapse = (jobId) => setCollapsed(prev => ({ ...prev, [jobId]: !prev[jobId] }));
```

Show a chevron icon that rotates on collapse. Task count always visible in header even when collapsed:

```
▾ 456 Elm St — JOB-042  (3 tasks)
  ☐ Extract standing water
  ☐ Set up dehumidifiers
  ☐ Document moisture readings
```

### 2H. Unread task badge on Tasks tab

**Files:** `src/components/TechLayout.jsx`

Show incomplete task count on the Tasks tab label:

```js
// Load count on mount + refresh every 60s
const [taskCount, setTaskCount] = useState(0);
useEffect(() => {
  const load = async () => {
    const tasks = await db.rpc('get_assigned_tasks', { p_employee_id: employee.id });
    setTaskCount((tasks || []).filter(t => t.is_today).length);
  };
  load();
  const interval = setInterval(load, 60000);
  return () => clearInterval(interval);
}, [db, employee]);
```

Show as a small red badge dot (not number) above the Tasks icon when `taskCount > 0`. Dot only — numbers clutter the nav.

**Commit Batch 2.**

---

## Batch 3 — Polish and delight

### 3A. Page transition animations

**Files:** `src/index.css`, `src/components/TechLayout.jsx`

Add slide-in animation when navigating to TechAppointment:

```css
@keyframes tech-slide-in {
  from { transform: translateX(100%); opacity: 0; }
  to   { transform: translateX(0);    opacity: 1; }
}

@keyframes tech-slide-out {
  from { transform: translateX(0);    opacity: 1; }
  to   { transform: translateX(-20%); opacity: 0; }
}

@media (max-width: 768px) {
  .tech-page-enter {
    animation: tech-slide-in 0.22s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
  }
}
```

Apply `tech-page-enter` class to TechAppointment on mount via `useEffect` after a 1-frame delay.

### 3B. Collapsing hero header in TechAppointment

**Files:** `src/pages/tech/TechAppointment.jsx`, `src/index.css`

As the user scrolls down in TechAppointment, the hero card should collapse into a compact sticky header showing just the appointment name and back button:

```js
const [scrolled, setScrolled] = useState(false);
const handleScroll = (e) => setScrolled(e.target.scrollTop > 80);
```

```css
@media (max-width: 768px) {
  .tech-appt-hero-sticky {
    position: sticky;
    top: 0;
    z-index: 20;
    transition: all 0.2s ease;
  }

  .tech-appt-hero-sticky.collapsed {
    background: var(--bg-primary);
    border-bottom: 1px solid var(--border-color);
    padding: 8px var(--space-4);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  }
}
```

When `scrolled === true`, show compact header (back button + title only). When `scrolled === false`, show full hero card.

### 3C. Jump-to-today FAB in TechSchedule

**Files:** `src/pages/tech/TechSchedule.jsx`, `src/index.css`

When the user has scrolled past today's appointments in TechSchedule, show a floating "Today" button:

```jsx
{showJumpBtn && (
  <button
    className="tech-jump-today-fab"
    onClick={() => scrollToToday()}
  >
    ↑ Today
  </button>
)}
```

```css
.tech-jump-today-fab {
  position: fixed;
  bottom: calc(72px + env(safe-area-inset-bottom, 0px) + 16px);
  left: 50%;
  transform: translateX(-50%);
  background: var(--text-primary);
  color: #fff;
  border: none;
  border-radius: var(--radius-full);
  padding: 8px 20px;
  font-size: 13px;
  font-weight: 600;
  font-family: var(--font-sans);
  cursor: pointer;
  z-index: 50;
  box-shadow: var(--shadow-md);
  touch-action: manipulation;
}
```

Use `useRef` on the today section and `scrollIntoView({ behavior: 'smooth' })`.

### 3D. Appointment type icons in TechSchedule

**Files:** `src/pages/tech/TechSchedule.jsx`, `src/index.css`

Each appointment type needs a distinct icon and color — match the React Native TYPE_CONFIG:

```js
const TYPE_CONFIG = {
  monitoring:       { label: 'Monitoring',   color: '#3b82f6', bg: '#eff6ff',  icon: '📡' },
  mitigation:       { label: 'Mitigation',   color: '#0ea5e9', bg: '#f0f9ff',  icon: '💧' },
  inspection:       { label: 'Inspection',   color: '#8b5cf6', bg: '#f5f3ff',  icon: '🔍' },
  reconstruction:   { label: 'Recon',        color: '#f59e0b', bg: '#fffbeb',  icon: '🔨' },
  estimate:         { label: 'Estimate',     color: '#10b981', bg: '#ecfdf5',  icon: '📋' },
  mold_remediation: { label: 'Mold Remed.',  color: '#059669', bg: '#ecfdf5',  icon: '🌿' },
  other:            { label: 'Other',        color: '#6b7280', bg: '#f3f4f6',  icon: '📌' },
};
```

Show as a small colored pill with icon in each schedule card.

### 3E. Pull-to-refresh on all tech pages

**Files:** `src/pages/tech/TechDash.jsx`, `src/pages/tech/TechSchedule.jsx`, `src/pages/tech/TechTasks.jsx`, `src/pages/tech/TechClaims.jsx`, `src/pages/tech/TechAppointment.jsx`

Confirm `PullToRefresh` component wraps the scrollable content on all 5 pages. Read each file first — if already wrapped, skip. If not, wrap the main scroll container:

```jsx
<PullToRefresh onRefresh={load} className="tech-content">
  {/* page content */}
</PullToRefresh>
```

### 3F. Instant search in TechClaims

**Files:** `src/pages/tech/TechClaims.jsx`

Search should filter on every keystroke with 200ms debounce — no submit button needed:

```js
const [query, setQuery] = useState('');
const [filtered, setFiltered] = useState([]);

useEffect(() => {
  const timer = setTimeout(() => {
    if (!query.trim()) { setFiltered(claims); return; }
    const q = query.toLowerCase();
    setFiltered(claims.filter(c =>
      c.claim_number?.toLowerCase().includes(q) ||
      c.insured_name?.toLowerCase().includes(q) ||
      c.loss_city?.toLowerCase().includes(q) ||
      c.insurance_carrier?.toLowerCase().includes(q)
    ));
  }, 200);
  return () => clearTimeout(timer);
}, [query, claims]);
```

**Commit Batch 3.**

---

## Completion checklist

Test every item below on a real iPhone before marking complete:

- [ ] All cards have visible press state (slight scale down)
- [ ] Appointment cards have colored left border matching status
- [ ] Task checkboxes are 44px tap target, animate on complete
- [ ] Haptic feedback fires on every time tracker action
- [ ] Skeleton loading shows instead of spinner on TechDash
- [ ] Relative time ("in 2h 30m") shows on future appointment cards
- [ ] No iOS tap highlight on cards/buttons (transparent)
- [ ] No 300ms tap delay (touch-action: manipulation)
- [ ] Sticky header on TechDash while scrolling
- [ ] Sticky section headers in TechAppointment
- [ ] Tab bar has blur effect (frosted glass)
- [ ] Active tab has pill background indicator
- [ ] Swipe right completes tasks in TechTasks
- [ ] Job groups collapsible in TechTasks
- [ ] Task count badge dot on Tasks tab
- [ ] Page slide-in animation when opening TechAppointment
- [ ] Hero header collapses on scroll in TechAppointment
- [ ] Jump-to-today FAB in TechSchedule
- [ ] Appointment type icons/colors in TechSchedule
- [ ] Pull-to-refresh works on all 5 tech pages
- [ ] Search filters instantly in TechClaims
- [ ] No regressions on admin/desktop pages

**When complete:**
1. Update `UPR-Web-Context.md` — add TimeTracker as shared component if extracted, note polish improvements
2. Delete this file: `git rm TECH-POLISH-TASK.md`
3. Commit: `docs: update UPR-Web-Context.md, remove completed TECH-POLISH-TASK.md`
