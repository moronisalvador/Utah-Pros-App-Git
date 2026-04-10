# UPR Platform — Claude Code Project Context
**Last updated:** March 28, 2026
**Project:** Utah Pros Restoration — Internal Business Management Platform
**Developer:** Moroni Salvador
**Repo:** moronisalvador/Utah-Pros-App-Git
**Local:** F:\APPS\RestorationAPP\Utah-Pros-App-Git

---

## ⚠️ NON-NEGOTIABLE RULES — FOLLOW EVERY SINGLE ONE

1. **Read files from disk before editing.** Never assume file contents from memory.
2. **Use `write_file` for full rewrites.** `edit_file` fails silently on Windows CRLF files — if in doubt, rewrite the whole file.
3. **Never use `alert()` or `confirm()`.** All user feedback goes through:
   ```js
   window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: 'msg', type: 'success' } }))
   window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: 'msg', type: 'error' } }))
   ```
   For destructive actions that need confirmation, use **inline two-click confirm state** — first click turns button red + shows "Confirm", second click executes, `onBlur` cancels. Never a modal or native dialog.
4. **Always use `const { db } = useAuth()`** in components. Never import `db` directly from `@/lib/supabase`.
5. **Work on `dev` branch only.** Never touch `main`.
6. **CSS: mobile changes use `@media (max-width: 768px)` only.** Never change desktop layout, colors, or spacing unintentionally. `dvh` and `env(safe-area-inset-bottom)` are safe globally.
7. **Commit after every 2–3 files.** Small commits, clear messages.
8. **DB queries: always use `db.rpc()` for new tables.** PostgREST schema cache may not reflect new tables — `SECURITY DEFINER` RPCs always work.
9. **Check actual column names** via `information_schema.columns` before writing any query. Never assume column names.
10. **Do not break existing pages.** Every page currently in the app is live and in use. If unsure, read the file first.
11. **Always update `UPR-Web-Context.md` after any session that creates or modifies tables, RPCs, components, pages, or workers.** This applies whether or not a `*-TASK.md` file exists. The context doc is the permanent source of truth — if it's not documented there, the next session won't know it exists.
12. **`viewport-fit=cover` is required in `index.html`.** This enables `env(safe-area-inset-bottom)` on iOS Safari. Without it, all safe area CSS evaluates to `0px` and bottom nav bars touch the home indicator. Never remove it.
13. **Bottom nav safe area:** `.tech-nav` must use `padding-bottom: max(12px, env(safe-area-inset-bottom, 12px))` — the `max()` with 12px minimum ensures spacing even on devices where `env()` returns 0.

---

## Stack

- **Frontend:** React 19 + Vite — all JSX, no TypeScript
- **Database:** Supabase PostgreSQL + PostgREST REST API — **NO Supabase JS SDK**
- **Auth:** `@supabase/supabase-js` for auth only (realtime client), raw fetch for all data
- **Workers:** Cloudflare Pages Functions (`functions/api/*.js`)
- **Routing:** React Router v6
- **Styling:** CSS custom properties (no Tailwind, no CSS modules — global `index.css` only)
- **Deployment:** Cloudflare Pages — auto-deploys on push to `dev` branch

**Supabase project ID:** `glsmljpabrwonfiltiqm`
**Supabase anon key:** `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdsc21sanBhYnJ3b25maWx0aXFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2NDgwNjIsImV4cCI6MjA4ODIyNDA2Mn0.MySSItxhestKG9H4HOHgbnAIoHyngxAz3aAKrPDrfx4`

---

## DB Client API

All data access goes through the `db` object from `useAuth()`. The methods:

```js
const { db } = useAuth();

// REST operations
await db.select(table, queryString)     // GET /rest/v1/{table}?{queryString}
await db.insert(table, data)            // POST — returns inserted row(s)
await db.update(table, filter, data)    // PATCH — filter is PostgREST filter string
await db.delete(table, filter)          // DELETE — returns null on 204
await db.rpc(functionName, params)      // POST /rest/v1/rpc/{fn} — preferred for new tables
```

**RPC is the default for anything complex or on tables created after initial deploy.**

---

## AuthContext — What's Exposed

```js
const {
  user,              // Supabase auth user object
  employee,          // employees table row for current user
  permissions,       // nav_permissions rows
  featureFlags,      // { 'page:marketing': { key, enabled, dev_only_user_id, ... } }
  loading,
  error,
  db,                // Authenticated Supabase REST client — USE THIS
  login,
  logout,
  devLogin,          // DEV builds only
  canAccess,         // canAccess('nav_key') → boolean
  isFeatureEnabled,  // isFeatureEnabled('page:marketing') → boolean
  isAuthenticated,
  isDev,
} = useAuth();
```

---

## File Structure (key files)

```
src/
  App.jsx                   — Routes: AdminRoute, FeatureRoute, DevRoute wrappers
  index.css                 — ALL styles — CSS custom properties, no external CSS
  contexts/
    AuthContext.jsx          — Auth + featureFlags + isFeatureEnabled + canAccess
  lib/
    supabase.js             — REST client (do not modify without good reason)
    realtime.js             — Supabase realtime + auth
  pages/
    DevTools.jsx            — Dev tools (Moroni-only, 7 tabs)
    Settings.jsx            — Good pattern reference for tabbed pages
    Admin.jsx               — Good pattern reference for tables + forms
  pages/tech/
    TechDash.jsx            — Field tech dashboard: sticky greeting, active cards (client name + progress bar + Photo/Notes/Clock In), timeline future rows, upcoming 7-day preview when empty, snap-first photo flow
    TechSchedule.jsx        — Field tech 14-day schedule: division-colored left borders, time+duration columns, accent today header, jump-to-today FAB
    TechTasks.jsx           — Field tech tasks: SVG completion ring, swipe-to-complete with "Done" text, collapsible job groups with mini progress bars
    TechClaims.jsx          — Field tech claims: Encircle-style rows, 48px search bar, accent-colored addresses, division pills
    TechAppointment.jsx     — Appointment detail: division gradient hero, 4-button action bar (Navigate/Call/Message/Photo), 2-col photo grid, pinch-to-zoom lightbox, snap-first photo with optional caption
  components/
    Layout.jsx              — App shell — owns toasts, sidebar, bottom bar
    TechLayout.jsx          — Field tech app shell — bottom nav, no sidebar
    Sidebar.jsx             — Nav — feature-flag aware, Moroni-only Dev Tools link
    ErrorBoundary.jsx       — Wraps every route

functions/
  api/                      — Cloudflare Pages Functions (workers)
  lib/
    supabase.js             — Worker-side Supabase client (different from frontend)
    cors.js                 — jsonResponse(data, status, request, env)
```

---

## CSS Design System (from `index.css`)

Use these variables — do not hardcode colors or spacing:

```css
/* Colors */
--bg-primary: #ffffff
--bg-secondary: #f8f9fb
--bg-tertiary: #f1f3f5
--border-color: #e2e5e9
--border-light: #f0f1f3
--text-primary: #111318
--text-secondary: #5f6672
--text-tertiary: #8b929e
--accent: #2563eb
--accent-hover: #1d4ed8
--accent-light: #eff6ff

/* Typography */
--font-sans: 'Inter', -apple-system, ...
--font-mono: 'JetBrains Mono', 'Fira Code', monospace
--text-xs: 11px  --text-sm: 13px  --text-base: 14px

/* Spacing */
--space-1: 4px  --space-2: 8px  --space-3: 12px
--space-4: 16px  --space-5: 20px  --space-6: 24px  --space-8: 32px

/* Radius */
--radius-sm: 4px  --radius-md: 6px  --radius-lg: 8px
--radius-xl: 12px  --radius-full: 9999px

/* Shadows */
--shadow-sm: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)
--shadow-md: 0 4px 6px -1px rgba(0,0,0,0.06), 0 2px 4px -2px rgba(0,0,0,0.04)
```

**Tech mobile CSS tokens (scoped to `.tech-layout`):**
```css
--tech-text-body: 15px    --tech-text-label: 12px   --tech-text-heading: 22px
--tech-text-hero: 28px    --tech-text-timer: 40px
--tech-radius-card: 16px  --tech-radius-button: 14px
--tech-shadow-card: 0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04)
--tech-min-tap: 48px      --tech-row-height: 56px    --tech-nav-height: 64px
/* Status palette: --status-scheduled-*, --status-enroute-*, --status-working-*, --status-paused-*, --status-completed-* (each has -bg, -color, -border) */
```

**Existing utility classes (from index.css):**
```
.btn .btn-primary .btn-secondary .btn-sm
— These already exist. Use them, don't reinvent.
```

**Status colors (use inline for status badges):**
```
Green:  bg #f0fdf4  text #16a34a  border #bbf7d0
Red:    bg #fef2f2  text #dc2626  border #fecaca
Yellow: bg #fffbeb  text #d97706  border #fde68a
Blue:   bg #eff6ff  text #2563eb  border #bfdbfe
Purple: bg #faf5ff  text #7c3aed  border #ddd6fe
```

---

## UX Design Principles — Tech Mobile App

**The User Persona:** Every tech UI decision should be made through the lens of a 64-year-old field technician who is not tech-savvy, standing in a flooded basement or doing drywall repair, wearing work gloves, holding his phone in one hand, possibly in direct sunlight. If he can't figure it out in one tap without reading instructions, it's too complicated.

**Core principles:**
- **Snap-first, describe-later** — Photos upload immediately on capture with no blocking step. Description is optional, offered via a dismissable toast with "Add note" link. Never block the camera→save flow with a required input.
- **No modals for field actions** — Inline expandable inputs on cards, not popups. The tech shouldn't lose context of where they are.
- **One primary action per screen** — Clock In on Dash, checkbox on Tasks, search on Claims.
- **48px minimum touch targets** — No exceptions. Gloved hands, wet fingers.
- **Status = color from 3 feet away** — Amber=OMW/en_route, Green=working, Red=paused, Blue=scheduled, Gray=completed.
- **Sticky headers don't move on pull-to-refresh** — The greeting/date header stays fixed, only the content below refreshes. Pattern: `PullToRefresh` wraps content BELOW the fixed header, not around it.
- **Empty states show upcoming work** — When 0 appointments today, show next 7 days of upcoming appointments so techs can prep the night before.
- **Completed state shows breakdown** — Travel time, on-site time, total. Never just "3.5h" with no context.

**Task assignment business logic (CRITICAL):**
Tasks are NOT assigned directly to technicians. Tasks belong to appointments. Technicians are assigned to appointments via `appointment_crew`. The join path is: `employee → appointment_crew → appointments → tasks`. The `get_assigned_tasks` RPC handles this join internally.

**Time tracking model:**
- Timer starts from `travel_start` (On My Way), not `clock_in` (Start Work)
- `travel_minutes` — stored on `job_time_entries`, computed when tech hits Start Work: `now() - travel_start`
- `hours` — on-site time only: `clock_out - clock_in - paused_minutes` (used for billing/Xactimate)
- Total labor cost = `(travel_minutes/60 + hours) × rate`
- Tech sees one continuous timer from OMW; backend stores travel and on-site separately

**Photo/Note storage:**
All photos and notes go into `job_documents` table via `insert_job_document` RPC. Photos upload to `job-files/{job_id}/{timestamp}-{filename}` in Supabase Storage. The RPC accepts `p_appointment_id` (optional) and `p_description` (optional). Always pass `p_appointment_id` when uploading from an appointment context.

**Document query pattern (important):**
When fetching docs for an appointment, query by BOTH appointment_id OR job_id as a fallback for older docs:
```js
db.select('job_documents', `or=(appointment_id.eq.${apptId},job_id.eq.${jobId})&select=*&order=created_at.desc`)
```

---

## Key Supabase Tables (confirmed columns)

### `feature_flags`
`key TEXT PK, enabled BOOLEAN, force_disabled BOOLEAN, dev_only_user_id UUID, category TEXT, label TEXT, description TEXT, updated_by UUID, updated_at TIMESTAMPTZ`

### `employee_page_access`
`id UUID PK, employee_id UUID, nav_key TEXT, can_view BOOLEAN, updated_by UUID, updated_at TIMESTAMPTZ`

### `worker_runs`
`id UUID PK, worker_name TEXT, status TEXT CHECK('started','completed','error'), records_processed INT, error_message TEXT, started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ`

### `employees`
`id UUID PK, full_name TEXT, email TEXT, role TEXT, auth_user_id UUID, default_division TEXT`

### `jobs`
`id UUID PK, job_number TEXT, claim_id UUID, primary_contact_id UUID, division TEXT, phase TEXT, status TEXT, created_at TIMESTAMPTZ`

### `contacts`
`id UUID PK, name TEXT, phone TEXT, email TEXT, role TEXT`

### `claims`
`id UUID PK, claim_number TEXT, contact_id UUID, date_of_loss DATE, status TEXT`

### `conversations`
`id UUID PK, contact_id UUID, status TEXT, last_message_at TIMESTAMPTZ, unread_count INT`

### `messages`
`id UUID PK, conversation_id UUID, direction TEXT, body TEXT, status TEXT, created_at TIMESTAMPTZ, media_url TEXT`

### `scheduled_messages`
`id UUID PK, conversation_id UUID, contact_id UUID, body TEXT, send_at TIMESTAMPTZ, status TEXT, template_id UUID`

### `message_templates`
`id UUID PK, name TEXT, body TEXT, category TEXT, created_at TIMESTAMPTZ`

### `contact_jobs`
`id UUID PK, contact_id UUID, job_id UUID, role TEXT, is_primary BOOLEAN`

### `conversation_participants`
`id UUID PK, conversation_id UUID, contact_id UUID`

### `system_events`
`id UUID PK, event_type TEXT, entity_type TEXT, entity_id UUID, actor_id UUID, job_id UUID, payload JSONB, created_at TIMESTAMPTZ`

### `job_documents`
`id UUID PK, job_id UUID, appointment_id UUID (nullable), name TEXT, file_path TEXT, mime_type TEXT, category TEXT ('photo'|'note'|etc), description TEXT (nullable), uploaded_by UUID, created_at TIMESTAMPTZ`

### `job_time_entries`
`id UUID PK, job_id UUID, appointment_id UUID, employee_id UUID, travel_start TIMESTAMPTZ, clock_in TIMESTAMPTZ, clock_out TIMESTAMPTZ, paused_at TIMESTAMPTZ, total_paused_minutes NUMERIC, hours NUMERIC (on-site only), travel_minutes NUMERIC (nullable — computed on clock_in from travel_start)`

---

## Key RPCs Available

```
get_feature_flags()
upsert_feature_flag(p_key, p_enabled, p_dev_only_user_id, p_category, p_label, p_description, p_updated_by, p_force_disabled)
delete_feature_flag(p_key)
get_employee_page_access(p_employee_id)
upsert_employee_page_access(p_employee_id, p_nav_key, p_can_view, p_updated_by)
delete_employee_page_access(p_employee_id, p_nav_key)
get_worker_runs(p_limit INT DEFAULT 10)
bust_postgrest_cache()
get_table_stats(p_table TEXT)
get_all_employees()
get_dashboard_stats()
get_claim_jobs(p_claim_id)
get_job_contacts(p_job_id)
get_customers_list(...)
search_contacts_for_job(...)
get_document_templates(...)
get_sign_request_by_token(p_token)
clock_appointment_action(p_appointment_id, p_employee_id, p_action)
get_assigned_tasks(p_employee_id)  — joins employee → appointment_crew → appointments → tasks
insert_job_document(p_job_id, p_name, p_file_path, p_mime_type, p_category, p_uploaded_by, p_appointment_id DEFAULT NULL, p_description DEFAULT NULL)
toggle_appointment_task(p_task_id, p_employee_id)
get_appointment_tasks(p_appointment_id)
get_appointment_detail(p_appointment_id)
get_my_appointments_today(p_employee_id)
get_appointments_range(p_start_date, p_end_date)
```

---

## Patterns to Follow

### Loading state
```jsx
const [loading, setLoading] = useState(true);
if (loading) return <TabLoading />;  // Component defined in DevTools.jsx
```

### Data fetch pattern
```jsx
const load = useCallback(async () => {
  setLoading(true);
  try {
    const rows = await db.rpc('some_rpc', { p_param: value });
    setData(rows || []);
  } catch (e) {
    err('Failed to load data');
  } finally {
    setLoading(false);
  }
}, [db]);

useEffect(() => { load(); }, [load]);
```

### Two-click delete (REQUIRED — no confirm() or alert())
```jsx
const [confirmDel, setConfirmDel] = useState(null);

// First click: set confirmDel to item id
// Second click: execute delete
// onBlur: cancel
const handleDelete = async (item) => {
  if (confirmDel !== item.id) { setConfirmDel(item.id); return; }
  setConfirmDel(null);
  // ... execute delete
};

<button
  onClick={() => handleDelete(item)}
  onBlur={() => setConfirmDel(null)}
  style={{
    background: confirmDel === item.id ? '#fef2f2' : 'var(--bg-tertiary)',
    color:      confirmDel === item.id ? '#dc2626' : 'var(--text-tertiary)',
    border:     `1px solid ${confirmDel === item.id ? '#fecaca' : 'var(--border-light)'}`,
  }}
>
  {confirmDel === item.id ? 'Confirm Delete' : 'Delete'}
</button>
```

### Table layout pattern
```jsx
// Header
<div style={{
  display: 'grid', gridTemplateColumns: '...',
  padding: '8px 16px', background: 'var(--bg-secondary)',
  borderBottom: '1px solid var(--border-color)',
  fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)',
  letterSpacing: '0.06em', textTransform: 'uppercase',
}}>

// Rows
<div style={{
  display: 'grid', gridTemplateColumns: '...',
  alignItems: 'center', padding: '10px 16px',
  borderBottom: isLast ? 'none' : '1px solid var(--border-light)',
  background: 'var(--bg-primary)',
}}>
```

### Badge/pill pattern
```jsx
<span style={{
  fontSize: 11, fontWeight: 600, padding: '2px 8px',
  borderRadius: 'var(--radius-full)',
  background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0',
}}>
  Active
</span>
```

### Section wrapper
```jsx
<div style={{
  borderRadius: 'var(--radius-lg)',
  border: '1px solid var(--border-color)',
  overflow: 'hidden',
}}>
  {/* header row + item rows inside */}
</div>
```

---

## PostgREST Gotchas

- **New tables:** always use `SECURITY DEFINER` RPC + `GRANT EXECUTE TO anon, authenticated`
- **RLS:** every table needs `ALTER TABLE x ENABLE ROW LEVEL SECURITY` + explicit policies
- **Anon policy syntax:** `CREATE POLICY "name" ON table FOR SELECT TO anon, authenticated USING (true);`
- **Schema cache:** after new tables, call `bust_postgrest_cache()` RPC or redeploy
- **204 responses:** `db.rpc()` and `db.delete()` return `null` on 204 — handle this
- **`db.select()` returns `[]` on 404** — silent failure, use `db.rpc()` for reliability on new tables

---

## What NOT to Touch

- `src/lib/supabase.js` — stable, do not modify
- `src/lib/realtime.js` — stable, do not modify
- `src/contexts/AuthContext.jsx` — only modify if a new feature explicitly requires it
- `src/components/Layout.jsx` — do not modify unless explicitly instructed
- `src/App.jsx` — only add routes, do not restructure
- Any existing page unless explicitly instructed
- `main` branch — dev branch only

---

## Workers (Cloudflare Pages Functions)

Located in `functions/api/`. Each worker exports a `onRequest` handler.
Worker-side Supabase client: `import { createClient } from '../lib/supabase.js'`
CORS: `import { jsonResponse, corsHeaders } from '../lib/cors.js'`

**Active workers (10):**
- `send-message.js` — outbound SMS
- `twilio-webhook.js` — inbound SMS
- `twilio-status.js` — delivery receipts
- `process-scheduled.js` — cron, processes scheduled_messages
- `sync-encircle.js` — pulls Encircle claims → jobs + contacts
- `admin-users.js` — employee invite / auth management
- `send-esign.js` — create sign request + send email via SendGrid
- `submit-esign.js` — process signature, generate PDF, upload to storage
- `resend-esign.js` — resend esign email for existing pending request
- `track-open.js` — email open tracking pixel

---

*For the current active task, see any `*-TASK.md` file in this repo root (if one exists).*
*For UI patterns, components, and design tokens, see `UPR-Design-System.md`.*
*For full database documentation (all 69 tables, 85+ RPCs), see `UPR-Web-Context.md`.*

---

## Task File Protocol

When a `*-TASK.md` file exists in the repo root, it defines the active build task. Follow this protocol:

1. **Read the task file first** before touching any code.
2. **Follow the build order exactly** as specified in the task file.
3. **On completion** of all phases in the task file:
   - Update `UPR-Web-Context.md` with any new tables, RPCs, components, or status changes described in the task file's completion checklist
   - Delete the task file from the repo: `git rm <TASKFILE>.md`
   - Commit with message: `docs: update UPR-Web-Context.md, remove completed <TASKFILE>.md`
4. **Never leave a completed task file in the repo** — it becomes stale and misleads future sessions.
5. **`UPR-Web-Context.md` is the permanent source of truth** — always up to date, never deleted.
