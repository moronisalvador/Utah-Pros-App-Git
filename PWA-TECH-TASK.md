# PWA Tech View — Build Task
**Branch:** dev only  
**Commit after each phase. Test on real iPhone before moving to next phase.**

---

## Pre-flight (do this before writing any code)

1. Read `CLAUDE.md` fully
2. Read `UPR-Web-Context.md` fully  
3. Read `UPR-Design-System.md` fully
4. Verify `employees.role` has value `'field_tech'` via:
   ```sql
   SELECT DISTINCT role FROM employees ORDER BY role;
   ```
5. Verify these RPCs exist:
   ```sql
   SELECT routine_name FROM information_schema.routines
   WHERE routine_type = 'FUNCTION'
   AND routine_name IN (
     'get_my_appointments_today',
     'get_appointment_tasks',
     'toggle_appointment_task',
     'get_claims_list',
     'clock_appointment_action',
     'get_assigned_tasks'
   )
   ORDER BY routine_name;
   ```
   If `clock_appointment_action` or `get_assigned_tasks` are missing, run Phase 0 first.

---

## Phase 0 — Database RPCs (only if missing from pre-flight check)

### RPC 1: `clock_appointment_action`
Handles all time tracking actions atomically. Replaces direct REST updates.

```sql
CREATE OR REPLACE FUNCTION public.clock_appointment_action(
  p_appointment_id UUID,
  p_employee_id    UUID,
  p_action         TEXT  -- 'omw' | 'start' | 'pause' | 'resume' | 'finish'
)
RETURNS SETOF job_time_entries
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_entry        job_time_entries%ROWTYPE;
  v_now          TIMESTAMPTZ := NOW();
  v_job_id       UUID;
  v_paused_min   NUMERIC;
  v_total_ms     NUMERIC;
  v_hours        NUMERIC;
BEGIN
  -- Get job_id from appointment
  SELECT job_id INTO v_job_id
  FROM appointments WHERE id = p_appointment_id;

  -- Get or create time entry for this appointment + employee
  SELECT * INTO v_entry
  FROM job_time_entries
  WHERE appointment_id = p_appointment_id
    AND employee_id = p_employee_id
  LIMIT 1;

  IF p_action = 'omw' THEN
    -- Close any other open entries for this employee
    UPDATE job_time_entries
    SET
      clock_out = v_now,
      hours = GREATEST(0,
        EXTRACT(EPOCH FROM (v_now - clock_in)) / 3600
        - COALESCE(total_paused_minutes, 0) / 60
      )
    WHERE employee_id = p_employee_id
      AND clock_in IS NOT NULL
      AND clock_out IS NULL
      AND id != COALESCE(v_entry.id, '00000000-0000-0000-0000-000000000000');

    IF v_entry.id IS NULL THEN
      INSERT INTO job_time_entries (
        job_id, employee_id, appointment_id, work_date,
        hours, work_type, travel_start, entered_by, description
      ) VALUES (
        v_job_id, p_employee_id, p_appointment_id, v_now::DATE,
        0, 'field', v_now, p_employee_id,
        (SELECT COALESCE(title, 'Appointment') FROM appointments WHERE id = p_appointment_id)
        || ' — en route'
      )
      RETURNING * INTO v_entry;
    ELSE
      UPDATE job_time_entries SET travel_start = v_now
      WHERE id = v_entry.id
      RETURNING * INTO v_entry;
    END IF;

    UPDATE appointments SET status = 'en_route' WHERE id = p_appointment_id;

  ELSIF p_action = 'start' THEN
    UPDATE job_time_entries SET clock_in = v_now
    WHERE id = v_entry.id
    RETURNING * INTO v_entry;

    UPDATE appointments SET status = 'in_progress' WHERE id = p_appointment_id;

  ELSIF p_action = 'pause' THEN
    UPDATE job_time_entries SET paused_at = v_now
    WHERE id = v_entry.id
    RETURNING * INTO v_entry;

    UPDATE appointments SET status = 'paused' WHERE id = p_appointment_id;

  ELSIF p_action = 'resume' THEN
    v_paused_min := COALESCE(v_entry.total_paused_minutes, 0)
      + EXTRACT(EPOCH FROM (v_now - v_entry.paused_at)) / 60;

    UPDATE job_time_entries
    SET paused_at = NULL,
        total_paused_minutes = ROUND(v_paused_min::NUMERIC, 2)
    WHERE id = v_entry.id
    RETURNING * INTO v_entry;

    UPDATE appointments SET status = 'in_progress' WHERE id = p_appointment_id;

  ELSIF p_action = 'finish' THEN
    v_paused_min := COALESCE(v_entry.total_paused_minutes, 0);
    IF v_entry.paused_at IS NOT NULL THEN
      v_paused_min := v_paused_min + EXTRACT(EPOCH FROM (v_now - v_entry.paused_at)) / 60;
    END IF;

    v_total_ms := EXTRACT(EPOCH FROM (v_now - v_entry.clock_in)) * 1000
                  - v_paused_min * 60000;
    v_hours := GREATEST(0, ROUND((v_total_ms / 3600000)::NUMERIC, 2));

    UPDATE job_time_entries
    SET clock_out            = v_now,
        on_site_end          = v_now,
        hours                = v_hours,
        paused_at            = NULL,
        total_paused_minutes = ROUND(v_paused_min::NUMERIC, 2)
    WHERE id = v_entry.id
    RETURNING * INTO v_entry;

    UPDATE appointments SET status = 'completed' WHERE id = p_appointment_id;
  END IF;

  RETURN NEXT v_entry;
END;
$$;

GRANT EXECUTE ON FUNCTION public.clock_appointment_action(UUID, UUID, TEXT)
  TO anon, authenticated;
```

### RPC 2: `get_assigned_tasks`
Returns all incomplete tasks assigned to this employee, with job context.

```sql
CREATE OR REPLACE FUNCTION public.get_assigned_tasks(
  p_employee_id UUID
)
RETURNS TABLE (
  task_id          UUID,
  task_name        TEXT,
  is_complete      BOOLEAN,
  sort_order       INT,
  phase_name       TEXT,
  appointment_id   UUID,
  appointment_date DATE,
  appointment_time TEXT,
  is_today         BOOLEAN,
  job_id           UUID,
  job_number       TEXT,
  insured_name     TEXT,
  division         TEXT,
  job_phase        TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    jt.id                                              AS task_id,
    jt.name                                            AS task_name,
    COALESCE(jt.is_complete, FALSE)                    AS is_complete,
    COALESCE(jt.sort_order, 0)                         AS sort_order,
    jt.phase_name,
    ac.appointment_id,
    a.date                                             AS appointment_date,
    a.time_start                                       AS appointment_time,
    (a.date = CURRENT_DATE)                            AS is_today,
    j.id                                               AS job_id,
    j.job_number,
    c.first_name || ' ' || c.last_name                AS insured_name,
    j.division,
    j.phase                                            AS job_phase
  FROM job_tasks jt
  -- Link task → appointment via appointment_crew assignment
  JOIN appointment_tasks ac ON ac.task_id = jt.id
  JOIN appointments a        ON a.id = ac.appointment_id
  JOIN appointment_crew acr  ON acr.appointment_id = a.id
                             AND acr.employee_id = p_employee_id
  JOIN jobs j                ON j.id = jt.job_id
  LEFT JOIN contacts c       ON c.id = j.primary_contact_id
  WHERE COALESCE(jt.is_complete, FALSE) = FALSE
    AND a.status NOT IN ('cancelled', 'completed')
  ORDER BY
    is_today DESC,
    a.date ASC,
    a.time_start ASC,
    jt.sort_order ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_assigned_tasks(UUID)
  TO anon, authenticated;
```

> **Note:** If the join via `appointment_tasks` table doesn't exist or returns empty, check actual column names in `information_schema.columns` for `job_tasks` and `appointment_crew` before adjusting the query. Never assume column names.

**After applying migrations, call `bust_postgrest_cache()` RPC.**

---

## Phase 1 — TechLayout component

**File:** `src/components/TechLayout.jsx`

A full-viewport shell for field_tech role. No sidebar. Bottom nav only. 5 tabs.

**Spec:**
- Full viewport: `height: 100dvh`, `display: flex`, `flex-direction: column`
- Main content area: `flex: 1`, `overflow-y: auto`
- Bottom nav: fixed at bottom, 5 tabs — Dash / Schedule / Tasks / Messages / Claims
- Bottom nav height: 72px + `env(safe-area-inset-bottom, 0px)`
- Active tab: accent color + filled icon variant. Inactive: `--text-tertiary`
- Minimum tap target per tab: 44px
- No sidebar, no Layout.jsx, no bottom-bar from existing CSS
- All styles in `index.css` under new classes: `.tech-layout`, `.tech-nav`, `.tech-nav-tab`, `.tech-nav-tab.active`
- Add these CSS classes in a clearly labeled block: `/* ── TechLayout ── */`

**Tab definitions:**
| Key | Label | Route | Icon (use SVG from Icons.jsx or inline) |
|-----|-------|-------|----------------------------------------|
| dash | Dash | /tech | house/grid |
| schedule | Schedule | /tech/schedule | calendar |
| tasks | Tasks | /tech/tasks | checklist/checkmark-square |
| messages | Messages | /conversations | chat bubble |
| claims | Claims | /tech/claims | folder/document |

- Messages tab navigates to `/conversations` (existing page — do not rebuild it)
- All other tabs use React Router `<Link>` or `useNavigate`
- Active state detected via `useLocation()` matching pathname

**Commit after this file.**

---

## Phase 2 — App.jsx routing

**File:** `src/App.jsx` — read it fully before editing.

Add the following:
1. Import `TechLayout` from `@/components/TechLayout`
2. Import all 4 new tech pages (TechDash, TechSchedule, TechTasks, TechClaims) — they won't exist yet, stubs are fine for now
3. In the route tree, add a role-gate wrapper:
   - If `employee?.role === 'field_tech'`, redirect `/` → `/tech`
   - Wrap `/tech/*` routes in `<TechLayout>`
   - Routes: `/tech` → TechDash, `/tech/schedule` → TechSchedule, `/tech/tasks` → TechTasks, `/tech/claims` → TechClaims
4. `/conversations` stays as-is — shared between all roles

**Do not restructure existing routes. Only add.**

**Commit after this file.**

---

## Phase 3 — TechDash page

**File:** `src/pages/tech/TechDash.jsx`

**Data:**
```js
const { employee, db } = useAuth();
// Load on mount:
const appointments = await db.rpc('get_my_appointments_today', { p_employee_id: employee.id });
// For each appointment, load tasks:
const tasks = await db.rpc('get_appointment_tasks', { p_appointment_id: appt.id });
```

**Layout (mobile-first, no desktop concerns):**
```
┌─────────────────────────────────┐
│  [Today's date, e.g. Thursday March 27]  │
│  [Employee first name] · N appointments  │
│                                 │
│  ┌── Appointment Card ────────┐ │
│  │  08:00 AM                  │ │
│  │  Water Mitigation          │ │
│  │  456 Elm St, Murray  [→]   │ │
│  │                            │ │
│  │  [Time Tracker widget]     │ │
│  │                            │ │
│  │  ▾ Tasks  3/8 complete     │ │
│  │    ☑ Extract standing...   │ │
│  │    ☐ Set up dehumidifiers  │ │
│  │                            │ │
│  │  [📷 Photo]  [💬 Message]  │ │
│  └────────────────────────────┘ │
│                                 │
│  ┌── Future Card (collapsed) ─┐ │
│  │  12:00 PM · Mold Inspection│ │
│  │  789 Oak Ave, Sandy        │ │
│  └────────────────────────────┘ │
└─────────────────────────────────┘
```

**Appointment card behavior:**
- Address is tappable → opens `maps://` (iOS) or `https://maps.google.com/?q=` (Android/web). Use `window.open(url)` — this is a web app.
- Tasks section: collapsed by default, tap header to expand. Show `X/Y complete` count.
- Task checkbox: calls `db.rpc('toggle_appointment_task', { p_task_id, p_employee_id: employee.id })` then refreshes
- Photo button: `<input type="file" accept="image/*" capture="environment" style={{display:'none'}} ref={fileRef} />` triggered by button click → upload to Supabase Storage `job-files` bucket at `{job_id}/{timestamp}-{filename}` → call `db.rpc('insert_job_document', {...})` → toast success/error
- Message button: `navigate('/conversations')` — do not pass params, existing page handles it

**Time Tracker widget (inline component inside this file):**

States and transitions (match mobile app logic exactly):

| State | Condition | Shows |
|-------|-----------|-------|
| Scheduled | No time entry or no `travel_start` | "On My Way" button (amber) |
| En Route | `travel_start` set, no `clock_in` | "Start Work" button (green) + left-at time |
| In Progress | `clock_in` set, no `clock_out`, no `paused_at` | Live timer + Pause + Finish |
| Paused | `paused_at` set | Frozen timer + Resume + Finish |
| Completed | `clock_out` set | Summary: clock in / clock out / hours |

**Time entry load:** `db.select('job_time_entries', 'appointment_id=eq.{id}&employee_id=eq.{empId}&select=*')`

**Actions — use the new RPC:**
```js
await db.rpc('clock_appointment_action', {
  p_appointment_id: appt.id,
  p_employee_id: employee.id,
  p_action: 'omw' // | 'start' | 'pause' | 'resume' | 'finish'
});
```

**Live timer:** `setInterval` every 1 second while in_progress and not paused. Calculate: `Date.now() - new Date(clock_in) - (total_paused_minutes * 60000)`. Display as `H:MM:SS`.

**"Finish" action:** Use two-click confirm pattern (CLAUDE.md rule — no Alert/confirm). First click turns button red + "Confirm Finish", second click executes, onBlur cancels.

**Future appointments (later today or upcoming):** Show as collapsed cards below active ones. No time tracker, no tasks. Tap opens full detail (can be a no-op or navigate to schedule for now).

**Empty state:** If no appointments today, show centered empty state: calendar icon + "No appointments today" + "Check your schedule for upcoming jobs" with link to /tech/schedule.

**Commit after this file.**

---

## Phase 4 — TechSchedule page

**File:** `src/pages/tech/TechSchedule.jsx`

**Data:**
```js
// Load appointments for next 14 days
const start = new Date().toISOString().split('T')[0];
const end = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0];
const appts = await db.rpc('get_appointments_range', {
  p_employee_id: employee.id,
  p_start_date: start,
  p_end_date: end
});
```

> Check actual param names on `get_appointments_range` via `information_schema.parameters` before calling.

**Layout:**
- Sticky date header per day group (e.g. "Today — Thursday Mar 27", "Tomorrow — Friday Mar 28", "Monday Mar 30")
- Each appointment: time range + title + address + division badge + status badge
- Tap → navigates to `/tech` (Dash) for today's appointments, or shows a simple detail view for future (time/address/crew only — read only)
- Pull to refresh via `PullToRefresh` component

**Commit after this file.**

---

## Phase 5 — TechTasks page

**File:** `src/pages/tech/TechTasks.jsx`

**Data:**
```js
const tasks = await db.rpc('get_assigned_tasks', { p_employee_id: employee.id });
```

**Layout:**
- Two tabs at top: **Today** | **All** (pill tab style from design system)
- Today tab: tasks where `is_today === true`, grouped by job (show job number + client name as group header)
- All tab: all tasks, same grouping by job
- Each task row: checkbox + task name + phase name (secondary text)
- Checkbox tap: `db.rpc('toggle_appointment_task', { p_task_id: task.task_id, p_employee_id: employee.id })` → optimistic update → toast
- Empty state per tab if no tasks

**Commit after this file.**

---

## Phase 6 — TechClaims page

**File:** `src/pages/tech/TechClaims.jsx`

**Data:**
```js
const claims = await db.rpc('get_claims_list');
```

**Layout:**
- Search input at top (filters by insured name, claim number, address)
- Claim cards: claim number + insured name + date of loss + status badge + job count pill
- Tap → navigates to `/claims/{id}` (existing ClaimPage — do not rebuild)
- Pull to refresh

**Known columns returned by `get_claims_list`:** `id, claim_number, insured_name, client_phone, date_of_loss, loss_type, loss_city, loss_state, status, job_count, total_invoiced, total_collected, total_balance, jobs_summary`

**Commit after this file.**

---

## Phase 7 — CSS

**File:** `src/index.css`

Add a clearly labeled block `/* ── TechLayout ── */` with:

```css
/* ── TechLayout ── */
.tech-layout {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  overflow: hidden;
  background: var(--bg-secondary);
}

.tech-content {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.tech-nav {
  display: flex;
  align-items: stretch;
  background: var(--bg-primary);
  border-top: 1px solid var(--border-color);
  padding-bottom: env(safe-area-inset-bottom, 0px);
  flex-shrink: 0;
  height: calc(60px + env(safe-area-inset-bottom, 0px));
}

.tech-nav-tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  border: none;
  background: none;
  cursor: pointer;
  color: var(--text-tertiary);
  font-family: var(--font-sans);
  font-size: 10px;
  font-weight: 500;
  text-decoration: none;
  min-height: 44px;
  padding: 0;
  transition: color 0.12s;
}

.tech-nav-tab.active {
  color: var(--accent);
}

.tech-nav-tab svg {
  width: 22px;
  height: 22px;
}

/* Tech page shared */
.tech-page {
  padding: var(--space-4);
  max-width: 600px;
  margin: 0 auto;
}

.tech-page-header {
  margin-bottom: var(--space-4);
}

.tech-page-date {
  font-size: var(--text-sm);
  color: var(--text-tertiary);
  margin-bottom: 2px;
}

.tech-page-title {
  font-size: var(--text-xl);
  font-weight: 700;
  color: var(--text-primary);
}

.tech-page-subtitle {
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

/* Appointment cards */
.tech-appt-card {
  background: var(--bg-primary);
  border-radius: var(--radius-xl);
  border: 1px solid var(--border-color);
  padding: var(--space-4);
  margin-bottom: var(--space-3);
  overflow: hidden;
}

.tech-appt-time {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-tertiary);
  margin-bottom: 2px;
}

.tech-appt-title {
  font-size: var(--text-lg);
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: var(--space-2);
}

.tech-appt-address {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: var(--accent-light);
  border-radius: var(--radius-md);
  color: var(--accent);
  font-size: var(--text-sm);
  font-weight: 500;
  text-decoration: none;
  margin-bottom: var(--space-3);
  cursor: pointer;
  border: none;
  width: 100%;
  text-align: left;
}

.tech-tasks-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  background: none;
  border: none;
  border-top: 1px solid var(--border-light);
  padding: 10px 0 0;
  margin-top: var(--space-3);
  cursor: pointer;
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-secondary);
}

.tech-task-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 8px 0;
  border-bottom: 1px solid var(--border-light);
  cursor: pointer;
}

.tech-task-row:last-child {
  border-bottom: none;
}

.tech-task-check {
  width: 20px;
  height: 20px;
  border-radius: var(--radius-sm);
  border: 2px solid var(--border-color);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-primary);
}

.tech-task-check.done {
  background: var(--accent);
  border-color: var(--accent);
}

.tech-task-name {
  font-size: var(--text-sm);
  color: var(--text-primary);
  flex: 1;
}

.tech-task-name.done {
  text-decoration: line-through;
  color: var(--text-tertiary);
}

.tech-appt-actions {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--border-light);
}

/* Time tracker */
.tech-tracker {
  background: var(--bg-secondary);
  border-radius: var(--radius-lg);
  padding: var(--space-3);
  margin: var(--space-3) 0;
}

.tech-tracker-timer {
  font-size: 28px;
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  margin-bottom: var(--space-2);
}

.tech-tracker-actions {
  display: flex;
  gap: var(--space-2);
}
```

**Do not change any existing CSS classes.** Only add the new block.

**Commit after this file.**

---

## Phase 8 — PWA shell

**Files:**
- `public/manifest.json`
- `public/sw.js`
- `index.html` — add manifest link + theme-color meta
- `src/main.jsx` — register service worker

### `public/manifest.json`
```json
{
  "name": "UPR — Utah Pros Restoration",
  "short_name": "UPR",
  "description": "Utah Pros Restoration field operations",
  "start_url": "/tech",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#111318",
  "orientation": "portrait",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

### `public/sw.js`
Cache-first service worker for app shell only:
```js
const CACHE = 'upr-v1';
const SHELL = ['/', '/index.html'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('/rest/v1/') || e.request.url.includes('/api/')) return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
```

### `index.html` additions (in `<head>`):
```html
<link rel="manifest" href="/manifest.json" />
<meta name="theme-color" content="#111318" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
<meta name="apple-mobile-web-app-title" content="UPR" />
```

### `src/main.jsx` — add at end of file:
```js
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
```

### Icons
Create two simple PNG icons programmatically (Node script or canvas):
- White "U" letter, bold, centered on `#2563eb` background
- 192×192 (`public/icon-192.png`) and 512×512 (`public/icon-512.png`)
- Use `canvas` npm package or create as SVG files if PNG generation is complex

**Flip PWA feature flag:**
```js
await db.rpc('upsert_feature_flag', {
  p_key: 'feature:pwa',
  p_enabled: true,
  p_category: 'feature',
  p_label: 'PWA',
  p_updated_by: null
});
```
Or run directly in Supabase:
```sql
UPDATE feature_flags SET enabled = true WHERE key = 'feature:pwa';
```

**Commit after this phase.**

---

## Phase 9 — Install prompt (field_tech only)

**File:** `src/components/TechLayout.jsx` — add to existing file

Show a "Add to Home Screen" banner only when:
1. `employee.role === 'field_tech'`
2. `window.matchMedia('(display-mode: standalone)').matches === false` (not already installed)
3. Not dismissed (use `sessionStorage.getItem('pwa-dismissed')`)

**iOS detection:** `navigator.userAgent.includes('iPhone') || navigator.userAgent.includes('iPad')` + not standalone → show manual instructions banner.

**Android/Chrome:** Listen for `beforeinstallprompt` event → store it → show "Install App" button → call `prompt()` on tap.

**Banner design:**
- Fixed at bottom, above tab nav
- `background: var(--accent)`, white text
- iOS: "Tap Share → Add to Home Screen to install UPR"
- Android: "Install App" button
- Dismiss X button → `sessionStorage.setItem('pwa-dismissed', '1')`

**Commit after this phase.**

---

## Completion checklist

After all phases are complete and tested on real iPhone:

- [ ] field_tech login → lands on `/tech` (Dash)
- [ ] admin login → lands on `/` (Dashboard) unchanged
- [ ] TechLayout shows bottom nav, no sidebar
- [ ] Dash shows today's appointments with time tracker
- [ ] OMW → En Route → In Progress → Pause → Resume → Finish all work
- [ ] Task checkboxes toggle via RPC
- [ ] Photo upload saves to Storage + job_documents
- [ ] Message button navigates to /conversations
- [ ] Schedule shows 14-day list
- [ ] Tasks page shows today/all tabs, grouped by job
- [ ] Claims page search works
- [ ] PWA installs on iPhone via Safari → Add to Home Screen
- [ ] App opens in standalone mode (no Safari chrome)
- [ ] No regressions on admin/other role pages

**When complete:**
1. Update `UPR-Web-Context.md`:
   - Add `TechLayout.jsx`, `TechDash.jsx`, `TechSchedule.jsx`, `TechTasks.jsx`, `TechClaims.jsx` to file structure
   - Add `clock_appointment_action` and `get_assigned_tasks` to RPCs list
   - Move PWA from "Known Pending Items" to completed
   - Add field_tech routing note to Auth & Session section
2. Delete this file: `git rm PWA-TECH-TASK.md`
3. Commit: `docs: update UPR-Web-Context.md, remove completed PWA-TECH-TASK.md`
