# DevTools.jsx — Remaining Phases Build Task
**File to edit:** `src/pages/DevTools.jsx` (single file — all tabs live here)
**Branch:** `dev` only
**Read CLAUDE.md first for all rules, patterns, and constraints.**

---

## Current State of DevTools.jsx

The file already has these components fully built and working — **DO NOT REWRITE THEM:**

| Component | Status | Notes |
|-----------|--------|-------|
| `FlagsTab` | ✅ Complete | Toggle, dev-only, add, two-click delete |
| `HealthTab` | ✅ Complete | 5 parallel DB checks, bust cache button |
| `EmployeesTab` | ✅ Complete | Auth status table, send invite |
| `WorkersTab` | ✅ Complete | Run log, per-worker cards, trigger sync |
| `IntegrityTab` | 🔲 Stub | Replace `ComingSoon` component with real implementation |
| `MessagingTab` | 🔲 Stub | Replace `ComingSoon` component with real implementation |
| `ComingSoon` | helper | Keep — still used by any unbuilt sub-sections |
| `TabLoading` | helper | Keep |
| `StatPill` | helper | Keep |
| Main `DevTools` | ✅ Complete | Tab bar, routing, page header |

**The file structure to preserve:**
```
imports
toast helpers (ok, err)
icon components
TABS array
CATEGORY_COLOR constant
--- tab components (replace stubs, keep working ones) ---
FlagsTab         ← DO NOT TOUCH
HealthTab        ← DO NOT TOUCH
EmployeesTab     ← DO NOT TOUCH
WorkersTab       ← DO NOT TOUCH
IntegrityTab     ← REPLACE STUB with Phase 4 implementation
MessagingTab     ← REPLACE STUB with Phase 5 implementation
--- shared helpers ---
TabLoading       ← DO NOT TOUCH
StatPill         ← DO NOT TOUCH
ComingSoon       ← Keep if any section still needs it
labelStyle const
inputStyle const
--- main export ---
DevTools default export ← DO NOT TOUCH
```

---

## Phase 3A — Health Check Dashboard (already complete, built into HealthTab)
Nothing to do. HealthTab already runs parallel checks + bust cache. ✅

## Phase 3B — Employee Auth Status (already complete, built into EmployeesTab)
Nothing to do. EmployeesTab already shows auth status + send invite. ✅

## Phase 3C — Worker Execution Log (already complete, built into WorkersTab)
Nothing to do. WorkersTab reads `worker_runs` table via `get_worker_runs` RPC. ✅

**Note for Phase 3C:** The existing workers (`functions/api/*.js`) do NOT yet log to `worker_runs`. This is a separate optional improvement — add logging to each worker file only if explicitly asked. The UI already works — it will just show empty until workers log their runs.

---

## Phase 4 — Data Integrity Tools (replace IntegrityTab stub)

### 4A — Orphan Checker

**Replace `IntegrityTab` function entirely** with a component that has two sub-tabs:
- "Orphans" (4A)
- "Claim Tree" (4B)

Use local state `const [subTab, setSubTab] = useState('orphans')` to switch between them.

**Orphan checks to run (all via `db.rpc()` — RPCs defined below):**

| Check ID | Label | RPC to call |
|----------|-------|-------------|
| `jobs_no_claim` | Jobs with no claim | `get_orphan_jobs_no_claim` |
| `jobs_no_contact` | Jobs with no primary contact | `get_orphan_jobs_no_contact` |
| `contacts_no_job` | Contacts with no job links | `get_orphan_contacts` |
| `conversations_no_participant` | Conversations with no participants | `get_orphan_conversations` |
| `claims_no_jobs` | Claims with no jobs | `get_orphan_claims` |

**UI behavior:**
- "Run Checks" button triggers all 5 RPCs in `Promise.all`
- Each check shows: label, count badge (green if 0, red if > 0), expandable row list
- Click a check's count badge to expand and show the offending records (job_number, contact name, claim_number, etc.)
- No auto-fix actions needed for now — display only

**SQL to create the RPCs (run in Supabase SQL editor before building UI):**

```sql
-- Jobs with no claim
CREATE OR REPLACE FUNCTION get_orphan_jobs_no_claim()
RETURNS TABLE(id UUID, job_number TEXT, division TEXT, created_at TIMESTAMPTZ)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT id, job_number, division, created_at FROM jobs WHERE claim_id IS NULL ORDER BY created_at DESC LIMIT 100;
$$;
GRANT EXECUTE ON FUNCTION get_orphan_jobs_no_claim() TO anon, authenticated;

-- Jobs with no primary contact
CREATE OR REPLACE FUNCTION get_orphan_jobs_no_contact()
RETURNS TABLE(id UUID, job_number TEXT, division TEXT, created_at TIMESTAMPTZ)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT id, job_number, division, created_at FROM jobs WHERE primary_contact_id IS NULL ORDER BY created_at DESC LIMIT 100;
$$;
GRANT EXECUTE ON FUNCTION get_orphan_jobs_no_contact() TO anon, authenticated;

-- Contacts with no job links
CREATE OR REPLACE FUNCTION get_orphan_contacts()
RETURNS TABLE(id UUID, first_name TEXT, last_name TEXT, phone TEXT, role TEXT, created_at TIMESTAMPTZ)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT c.id, c.first_name, c.last_name, c.phone, c.role, c.created_at
  FROM contacts c
  LEFT JOIN contact_jobs cj ON c.id = cj.contact_id
  WHERE cj.id IS NULL
  ORDER BY c.created_at DESC LIMIT 100;
$$;
GRANT EXECUTE ON FUNCTION get_orphan_contacts() TO anon, authenticated;

-- Conversations with no participants
CREATE OR REPLACE FUNCTION get_orphan_conversations()
RETURNS TABLE(id UUID, status TEXT, created_at TIMESTAMPTZ)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT c.id, c.status, c.created_at
  FROM conversations c
  LEFT JOIN conversation_participants cp ON c.id = cp.conversation_id
  WHERE cp.id IS NULL
  ORDER BY c.created_at DESC LIMIT 100;
$$;
GRANT EXECUTE ON FUNCTION get_orphan_conversations() TO anon, authenticated;

-- Claims with no jobs
CREATE OR REPLACE FUNCTION get_orphan_claims()
RETURNS TABLE(id UUID, claim_number TEXT, status TEXT, created_at TIMESTAMPTZ)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT cl.id, cl.claim_number, cl.status, cl.created_at
  FROM claims cl
  LEFT JOIN jobs j ON j.claim_id = cl.id
  WHERE j.id IS NULL
  ORDER BY cl.created_at DESC LIMIT 100;
$$;
GRANT EXECUTE ON FUNCTION get_orphan_claims() TO anon, authenticated;
```

---

### 4B — Claim/Job Tree Viewer (second sub-tab inside IntegrityTab)

**UI:**
- Search input — typeahead on `claim_number` using `db.select('claims', 'claim_number=ilike.*{q}*&select=id,claim_number,status&limit=10')`
- On select: call `db.rpc('get_claim_jobs', { p_claim_id: id })` which returns `{ claim, jobs[] }`
- For each job, also call `db.rpc('get_job_contacts', { p_job_id: id })` and `db.rpc('get_job_task_summary', { p_job_id: id })`
- Render as a tree:

```
CLM-2603-001  [status badge]
├── 👤 Homeowner: John Smith
├── 👤 Adjuster: Jane Doe
├── 💧 Job: Water Mitigation  #JOB-001  [phase badge]
│      Tasks: 4/12 complete   Contacts: 2
└── 🧫 Job: Mold Remediation  #JOB-002  [phase badge]
       Tasks: 0/8 complete    Contacts: 1
```

**Division icons:** 💧 water, 🧫 mold, 🏗️ reconstruction, 🔥 fire, 📦 contents
**Implementation:** use nested `div`s with left border lines, not a real tree library.
**No edit actions** — read-only viewer.

---

### 4C — Duplicate Contact Detector (third sub-tab inside IntegrityTab)

Add a third sub-tab: "Duplicates"

**Logic:**
1. Call `db.rpc('get_duplicate_contacts')` (RPC defined below)
2. Display groups of potential duplicates
3. No merge action yet — display only, with a "View" link to `/customers/:id` for each contact

**SQL for RPC:**
```sql
-- Contacts sharing the same normalized phone number (potential duplicates)
CREATE OR REPLACE FUNCTION get_duplicate_contacts()
RETURNS TABLE(
  phone_normalized TEXT,
  contact_ids UUID[],
  names TEXT[],
  count BIGINT
)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT
    regexp_replace(phone, '[^0-9]', '', 'g') AS phone_normalized,
    array_agg(id ORDER BY created_at) AS contact_ids,
    array_agg(first_name || ' ' || COALESCE(last_name, '') ORDER BY created_at) AS names,
    COUNT(*) AS count
  FROM contacts
  WHERE phone IS NOT NULL AND length(regexp_replace(phone, '[^0-9]', '', 'g')) >= 10
  GROUP BY regexp_replace(phone, '[^0-9]', '', 'g')
  HAVING COUNT(*) > 1
  ORDER BY count DESC
  LIMIT 50;
$$;
GRANT EXECUTE ON FUNCTION get_duplicate_contacts() TO anon, authenticated;
```

**UI:** Card per duplicate group showing: normalized phone, list of names with their contact IDs, count badge. "View →" NavLink to `/customers/:id` for each.

---

## Phase 5 — Messaging Tools (replace MessagingTab stub)

### 5A — Template Preview/Test (first sub-tab inside MessagingTab)

**Replace `MessagingTab` function** with a component that has sub-tabs:
- "Template Preview" (5A)
- "Message Log" (5B)
- "Scheduled Queue" (5C)

**Template Preview UI:**
1. Dropdown: select from `message_templates` — load via `db.select('message_templates', 'select=id,name,body,category&order=name')`
2. Text input fields for variable substitution: `{{client_name}}`, `{{job_number}}`, `{{company_name}}`, `{{address}}`, `{{adjuster_name}}` — auto-detect which `{{variables}}` appear in the selected template body
3. Preview panel: template body with substitutions applied (simple string replace, no eval)
4. Character count + SMS segment count (ceil(length / 160)) shown below preview
5. No send button — preview only

**Variable replacement:**
```js
const preview = template.body.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] || `{{${key}}}`);
```

---

### 5B — Message Log Viewer (second sub-tab inside MessagingTab)

**Data source:** `messages` table joined with `conversations` and `contacts`

**SQL for RPC:**
```sql
CREATE OR REPLACE FUNCTION get_message_log(
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0,
  p_direction TEXT DEFAULT NULL,   -- 'inbound' | 'outbound' | NULL = both
  p_status TEXT DEFAULT NULL       -- 'delivered' | 'failed' | 'sent' | NULL = all
)
RETURNS TABLE(
  id UUID, body TEXT, direction TEXT, status TEXT,
  created_at TIMESTAMPTZ, contact_name TEXT, contact_phone TEXT,
  conversation_id UUID, media_url TEXT
)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT
    m.id, m.body, m.direction, m.status, m.created_at,
    COALESCE(c.first_name || ' ' || c.last_name, c.phone) AS contact_name,
    c.phone AS contact_phone,
    m.conversation_id, m.media_url
  FROM messages m
  JOIN conversations conv ON m.conversation_id = conv.id
  LEFT JOIN contacts c ON conv.contact_id = c.id
  WHERE (p_direction IS NULL OR m.direction = p_direction)
    AND (p_status IS NULL OR m.status = p_status)
  ORDER BY m.created_at DESC
  LIMIT p_limit OFFSET p_offset;
$$;
GRANT EXECUTE ON FUNCTION get_message_log(INT, INT, TEXT, TEXT) TO anon, authenticated;
```

**UI:**
- Filter bar: Direction dropdown (All / Inbound / Outbound), Status dropdown (All / delivered / failed / sent / undelivered)
- Table: contact name, phone, direction badge, status badge, body preview (truncated 60 chars), timestamp
- Click row to expand full body
- Load more button (pagination via p_offset)

---

### 5C — Scheduled Message Queue (third sub-tab inside MessagingTab)

**Data source:** `scheduled_messages` joined with contacts

**SQL for RPC:**
```sql
CREATE OR REPLACE FUNCTION get_scheduled_queue(p_limit INT DEFAULT 50)
RETURNS TABLE(
  id UUID, body TEXT, send_at TIMESTAMPTZ, status TEXT,
  contact_name TEXT, contact_phone TEXT, template_name TEXT
)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT
    sm.id, sm.body, sm.send_at, sm.status,
    COALESCE(c.first_name || ' ' || c.last_name, c.phone) AS contact_name,
    c.phone AS contact_phone,
    mt.name AS template_name
  FROM scheduled_messages sm
  LEFT JOIN contacts c ON sm.contact_id = c.id
  LEFT JOIN message_templates mt ON sm.template_id = mt.id
  ORDER BY sm.send_at ASC
  LIMIT p_limit;
$$;
GRANT EXECUTE ON FUNCTION get_scheduled_queue(INT) TO anon, authenticated;
```

**UI:**
- Default filter: pending only (where `status = 'pending'`), toggle to show all
- Table: contact name, phone, scheduled time (formatted), template name (if any), body preview, status badge
- Cancel button per row: `db.update('scheduled_messages', 'id=eq.' + id, { status: 'cancelled' })` — requires two-click confirm
- No reschedule UI needed for now

---

## Phase 6 — Advanced Dev Tools (add as new tabs OR sub-sections in a new "Advanced" tab)

Add a 7th tab `{ key: 'advanced', label: 'Advanced', icon: IconCode }` to the `TABS` array, then build a single `AdvancedTab` component with three sub-tabs.

### 6A — RPC Test Runner

**Sub-tab: "RPC Runner"**

Hardcoded list of key RPCs (no need to fetch from pg_proc):
```js
const RPC_LIST = [
  { name: 'get_dashboard_stats',    params: [] },
  { name: 'get_all_employees',      params: [] },
  { name: 'get_feature_flags',      params: [] },
  { name: 'get_worker_runs',        params: [{ key: 'p_limit', type: 'number', default: 10 }] },
  { name: 'get_orphan_jobs_no_claim', params: [] },
  { name: 'get_orphan_contacts',    params: [] },
  { name: 'get_orphan_claims',      params: [] },
  { name: 'get_customers_list',     params: [] },
  { name: 'get_claims_list',        params: [] },
  { name: 'bust_postgrest_cache',   params: [] },
  { name: 'get_claim_jobs',         params: [{ key: 'p_claim_id', type: 'text', default: '' }] },
  { name: 'get_job_task_summary',   params: [{ key: 'p_job_id',   type: 'text', default: '' }] },
  { name: 'get_message_log',        params: [{ key: 'p_limit', type: 'number', default: 20 }] },
  { name: 'get_scheduled_queue',    params: [{ key: 'p_limit', type: 'number', default: 20 }] },
];
```

**UI:**
- Dropdown to select RPC from `RPC_LIST`
- Dynamic input fields rendered from `params` array (text or number inputs)
- "Run" button — calls `db.rpc(selectedRpc, builtParams)`
- JSON response rendered in a `<pre>` block with `overflow-x: auto`, `font-family: var(--font-mono)`, `font-size: 11px`, max-height 400px
- Show response time in ms
- Show error in red if thrown

---

### 6B — Table Inspector

**Sub-tab: "Tables"**

Hardcoded list of key tables to inspect:
```js
const TABLE_LIST = [
  'jobs', 'contacts', 'claims', 'conversations', 'messages',
  'scheduled_messages', 'employees', 'feature_flags', 'worker_runs',
  'sign_requests', 'job_tasks', 'appointments', 'job_documents',
  'system_events', 'sms_consent_log',
];
```

**For each selected table, run:**
```js
// Row count + most recent created_at
await db.select(tableName, 'select=id,created_at&order=created_at.desc&limit=5')
// Then show: count (use length of result as approximation, or use a count RPC)
```

**Better: create one RPC to avoid N+1:**
```sql
CREATE OR REPLACE FUNCTION get_table_stats(p_table TEXT)
RETURNS TABLE(row_count BIGINT, latest_created_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY EXECUTE format(
    'SELECT COUNT(*)::BIGINT, MAX(created_at) FROM %I', p_table
  );
END;
$$;
GRANT EXECUTE ON FUNCTION get_table_stats(TEXT) TO authenticated;
```

**UI:**
- Dropdown to select table
- On select: show row count, last insert timestamp
- Show last 5 rows as a compact JSON list in a `<pre>` block
- "Refresh" button

---

### 6C — PostgREST Cache Buster (already in HealthTab)
The "Bust Schema Cache" button already exists in HealthTab. No separate UI needed.
In the Advanced tab, just add a note: "Cache buster available in Health tab."

---

## Build Order

Execute in this exact order to avoid dependency issues:

1. **Run all SQL** from Phases 4 and 5 in Supabase SQL editor first (before any UI changes). This creates all needed RPCs. Verify each RPC exists before building its UI component.

   **⚠️ DO NOT re-run Phase 1 SQL — it is already in the database.** The following already exist and must not be recreated:
   - Table: `feature_flags` ✅
   - Table: `worker_runs` ✅
   - RPC: `get_feature_flags` ✅
   - RPC: `upsert_feature_flag` ✅
   - RPC: `delete_feature_flag` ✅
   - RPC: `get_worker_runs` ✅
   - RPC: `bust_postgrest_cache` ✅
   - All 8 `feature_flags` seed rows ✅

   **RPCs that do NOT yet exist (you must create these):**
   - Phase 4: `get_orphan_jobs_no_claim`, `get_orphan_jobs_no_contact`, `get_orphan_contacts`, `get_orphan_conversations`, `get_orphan_claims`, `get_duplicate_contacts`
   - Phase 5: `get_message_log`, `get_scheduled_queue`
   - Phase 6: `get_table_stats`

   You can verify before running: `SELECT routine_name FROM information_schema.routines WHERE routine_schema = 'public' ORDER BY routine_name;`

2. **Replace `IntegrityTab`** — implement with three sub-tabs (Orphans 4A, Claim Tree 4B, Duplicates 4C). Keep `ComingSoon` for any sub-tab not yet built.

3. **Replace `MessagingTab`** — implement with three sub-tabs (Template Preview 5A, Message Log 5B, Scheduled Queue 5C).

4. **Add `AdvancedTab`** and the 7th entry in `TABS` array, implement three sub-tabs (RPC Runner 6A, Table Inspector 6B, cache note 6C).

5. **Commit after each tab replacement** — one commit per major tab: integrity, messaging, advanced.

---

## Verification Checklist Before Each Commit

- [ ] No `alert()` or `confirm()` calls anywhere in the file
- [ ] All destructive actions use two-click confirm pattern
- [ ] All DB calls use `const { db } = useAuth()` not direct import
- [ ] All errors caught and dispatched as toast events
- [ ] Loading states shown while fetching
- [ ] `FlagsTab`, `HealthTab`, `EmployeesTab`, `WorkersTab` — untouched, still working
- [ ] Main `DevTools` export — untouched
- [ ] `TABS` array — only additions allowed, no removals
- [ ] Build passes (`npm run build` — no errors)

---

## Quick Reference — Existing Icons in DevTools.jsx

These are already defined in the file — reuse them, don't redefine:
`IconFlag, IconHeart, IconUsers, IconZap, IconShield, IconMsg, IconPlus, IconTrash, IconRefresh, IconUser, IconCode, IconX, IconSend`

Add new icons as needed following the same inline SVG pattern.

---

## Notes on Existing Data

- **65 jobs** in DB, some may have `claim_id IS NULL` or `primary_contact_id IS NULL` — orphan checks will find real data
- **20 claims** — some may have no jobs (test claims from early dev)
- **18 contacts** — some may have no job links
- **0 worker_runs** — workers haven't been updated to log yet; UI will show empty state
- **10 message_templates** seeded — template preview will work immediately
- **`scheduled_messages`** — may be empty; queue UI will show empty state gracefully

---

## ✅ Task Completion Checklist

When ALL phases are implemented and committed, do the following before closing the PR:

### 1. Update `UPR-Web-Context.md`

Update the Dev Tools Roadmap Status table — change all 🔲 to ✅ for completed phases:

```
| 1C  | Sidebar guards + FeatureRoute in App.jsx         | ✅ Done |
| 2A  | DevRoute + /dev-tools route in App.jsx            | ✅ Done |
| 2B  | DevTools.jsx page shell + Flags tab               | ✅ Done |
| 3A  | Health check dashboard                            | ✅ Done |
| 3B  | Employee auth status tab                          | ✅ Done |
| 3C  | Worker execution log tab                          | ✅ Done |
| 4A  | Orphan checker                                    | ✅ Done |
| 4B  | Claim/job tree viewer                             | ✅ Done |
| 4C  | Duplicate contact detector                        | ✅ Done |
| 5A  | Template preview/test                             | ✅ Done |
| 5B  | Twilio message log viewer                         | ✅ Done |
| 5C  | Scheduled message queue                           | ✅ Done |
| 6A  | RPC test runner                                   | ✅ Done |
| 6B  | Table inspector                                   | ✅ Done |
| 6C  | bust_postgrest_cache() RPC + button               | ✅ Done |
```

Also add all new RPCs created during this task to the **Key RPCs** section of `UPR-Web-Context.md`:
- `get_orphan_jobs_no_claim`
- `get_orphan_jobs_no_contact`
- `get_orphan_contacts`
- `get_orphan_conversations`
- `get_orphan_claims`
- `get_duplicate_contacts`
- `get_message_log(p_limit, p_offset, p_direction, p_status)`
- `get_scheduled_queue(p_limit)`
- `get_table_stats(p_table)`

### 2. Delete `DEVTOOLS-TASK.md`

This task is complete — the file is no longer needed and should not clutter the repo.

```bash
git rm DEVTOOLS-TASK.md
```

### 3. Final commit message

```
docs: update UPR-Web-Context.md, remove completed DEVTOOLS-TASK.md
```

Then open/update the PR to merge into `dev`.
