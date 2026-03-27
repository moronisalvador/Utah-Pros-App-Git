# Access Control — Per-Employee Page Access + Dev Kill Switch
**Branch:** `dev` only
**Files touched:** AuthContext.jsx, Admin.jsx, DevTools.jsx, DB migrations
**Read CLAUDE.md first.**

---

## What We're Building

A three-layer access control system:

```
Layer 1: feature_flags.force_disabled  →  kill switch (everyone, including admins)
Layer 2: employee_page_access table    →  per-employee overrides
Layer 3: nav_permissions by role       →  existing role defaults (unchanged)
```

**Priority order in `canAccess(navKey)`:**
1. If `featureFlags['page:{navKey}']?.force_disabled === true` → `false` (no exceptions)
2. If employee has row in `employeePageAccess` for this navKey → use `can_view` from that row
3. If `employee.role === 'admin'` → `true`
4. Check `nav_permissions` by role (existing logic)

---

## DB State — What Already Exists (DO NOT recreate)

- `feature_flags` table ✅ (has: key, enabled, dev_only_user_id, category, label, description, updated_by, updated_at)
- `nav_permissions` table ✅ (has: role, nav_key, can_view, can_edit)
- `employee_page_access` table ❌ does not exist yet
- `force_disabled` column on `feature_flags` ❌ does not exist yet
- All existing RPCs (get_feature_flags, upsert_feature_flag, etc.) ✅

---

## Phase 1 — Database Migrations

Run these in order in Supabase SQL editor. Verify each before continuing.

### 1A — Add `force_disabled` to `feature_flags`

```sql
ALTER TABLE feature_flags ADD COLUMN IF NOT EXISTS force_disabled BOOLEAN NOT NULL DEFAULT false;

-- Update upsert RPC to include force_disabled
CREATE OR REPLACE FUNCTION upsert_feature_flag(
  p_key TEXT,
  p_enabled BOOLEAN,
  p_dev_only_user_id UUID DEFAULT NULL,
  p_category TEXT DEFAULT 'page',
  p_label TEXT DEFAULT '',
  p_description TEXT DEFAULT NULL,
  p_updated_by UUID DEFAULT NULL,
  p_force_disabled BOOLEAN DEFAULT false
) RETURNS feature_flags LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO feature_flags (key, enabled, dev_only_user_id, category, label, description, updated_by, updated_at, force_disabled)
  VALUES (p_key, p_enabled, p_dev_only_user_id, p_category, p_label, p_description, p_updated_by, now(), p_force_disabled)
  ON CONFLICT (key) DO UPDATE SET
    enabled = EXCLUDED.enabled,
    dev_only_user_id = EXCLUDED.dev_only_user_id,
    category = EXCLUDED.category,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    updated_by = EXCLUDED.updated_by,
    updated_at = now(),
    force_disabled = EXCLUDED.force_disabled
  RETURNING *;
$$;
GRANT EXECUTE ON FUNCTION upsert_feature_flag(TEXT,BOOLEAN,UUID,TEXT,TEXT,TEXT,UUID,BOOLEAN) TO anon, authenticated;
```

**Note:** `get_feature_flags()` already does `SELECT * FROM feature_flags` so it will automatically return the new `force_disabled` column — no changes needed to that RPC.

---

### 1B — Create `employee_page_access` table + RPCs

```sql
CREATE TABLE employee_page_access (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  nav_key TEXT NOT NULL,
  can_view BOOLEAN NOT NULL DEFAULT false,
  updated_by UUID REFERENCES employees(id),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(employee_id, nav_key)
);

ALTER TABLE employee_page_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read_employee_page_access" ON employee_page_access
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "auth_write_employee_page_access" ON employee_page_access
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Get all page access overrides for a specific employee
CREATE OR REPLACE FUNCTION get_employee_page_access(p_employee_id UUID)
RETURNS SETOF employee_page_access LANGUAGE sql SECURITY DEFINER AS $$
  SELECT * FROM employee_page_access WHERE employee_id = p_employee_id ORDER BY nav_key;
$$;
GRANT EXECUTE ON FUNCTION get_employee_page_access(UUID) TO anon, authenticated;

-- Upsert a single override row
CREATE OR REPLACE FUNCTION upsert_employee_page_access(
  p_employee_id UUID,
  p_nav_key TEXT,
  p_can_view BOOLEAN,
  p_updated_by UUID DEFAULT NULL
) RETURNS employee_page_access LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO employee_page_access (employee_id, nav_key, can_view, updated_by, updated_at)
  VALUES (p_employee_id, p_nav_key, p_can_view, p_updated_by, now())
  ON CONFLICT (employee_id, nav_key) DO UPDATE SET
    can_view = EXCLUDED.can_view,
    updated_by = EXCLUDED.updated_by,
    updated_at = now()
  RETURNING *;
$$;
GRANT EXECUTE ON FUNCTION upsert_employee_page_access(UUID, TEXT, BOOLEAN, UUID) TO authenticated;

-- Delete an override (reverts employee to role default)
CREATE OR REPLACE FUNCTION delete_employee_page_access(
  p_employee_id UUID,
  p_nav_key TEXT
) RETURNS VOID LANGUAGE sql SECURITY DEFINER AS $$
  DELETE FROM employee_page_access WHERE employee_id = p_employee_id AND nav_key = p_nav_key;
$$;
GRANT EXECUTE ON FUNCTION delete_employee_page_access(UUID, TEXT) TO authenticated;
```

---

## Phase 2 — AuthContext.jsx Changes

**File:** `src/contexts/AuthContext.jsx`

### 2A — Add `employeePageAccess` state

Add a new state variable alongside `featureFlags`:
```js
const [employeePageAccess, setEmployeePageAccess] = useState({}); // nav_key → boolean
```

### 2B — Add `loadEmployeePageAccess` function

```js
const loadEmployeePageAccess = async (employeeId, dbClient = db) => {
  try {
    const rows = await dbClient.rpc('get_employee_page_access', { p_employee_id: employeeId });
    const map = {};
    (rows || []).forEach(r => { map[r.nav_key] = r.can_view; });
    setEmployeePageAccess(map);
  } catch (err) {
    console.error('Employee page access load error:', err);
    setEmployeePageAccess({}); // Fail open — empty = no overrides = use role defaults
  }
};
```

### 2C — Update `handleAuthUser` to load all three in parallel

```js
await Promise.all([
  loadPermissions(employees[0].role, authenticatedDb),
  loadFeatureFlags(authenticatedDb),
  loadEmployeePageAccess(employees[0].id, authenticatedDb),
]);
```

Also update `devLogin` the same way:
```js
await Promise.all([
  loadPermissions(emp.role),
  loadFeatureFlags(),
  loadEmployeePageAccess(emp.id),
]);
```

Also reset on logout and SIGNED_OUT:
```js
setEmployeePageAccess({});
```

### 2D — Update `canAccess()` — the core change

Replace the existing `canAccess` with:

```js
const canAccess = useCallback((navKey) => {
  if (!employee) return false;

  // Layer 1: Force-disabled kills the page for everyone, no exceptions
  const flag = featureFlags[`page:${navKey}`];
  if (flag?.force_disabled) return false;

  // Layer 2: Per-employee override — if a row exists, it wins over role
  if (employeePageAccess.hasOwnProperty(navKey)) {
    return employeePageAccess[navKey];
  }

  // Layer 3: Admins see everything (unless force_disabled above)
  if (employee.role === 'admin') return true;

  // Layer 4: Role-based nav_permissions (existing logic)
  if (permissions.length === 0) return false;
  const perm = permissions.find(p => p.nav_key === navKey);
  return perm ? perm.can_view : false;
}, [employee, permissions, featureFlags, employeePageAccess]);
```

### 2E — Expose `employeePageAccess` in context value

```js
const value = {
  // ... existing ...
  employeePageAccess,   // { dashboard: true, conversations: false, ... } — empty = no overrides
  // ... rest ...
};
```

---

## Phase 3 — Dev Tools: Add `force_disabled` to FlagsTab

**File:** `src/pages/DevTools.jsx` — modify only `FlagsTab`

### Changes to FlagsTab:

**1. Update `toggle` function — it must NOT touch `force_disabled`:**
The existing `toggle` function only flips `p_enabled`. It must pass `p_force_disabled: flag.force_disabled` to preserve the existing value:
```js
await db.rpc('upsert_feature_flag', {
  p_key:             flag.key,
  p_enabled:         !flag.enabled,
  p_dev_only_user_id: flag.dev_only_user_id,
  p_category:        flag.category,
  p_label:           flag.label,
  p_description:     flag.description,
  p_updated_by:      employee?.id,
  p_force_disabled:  flag.force_disabled || false,  // ← preserve
});
```

**2. Add `toggleForceDisabled` function:**
```js
const toggleForceDisabled = async (flag) => {
  setSaving(flag.key + '_force');
  try {
    await db.rpc('upsert_feature_flag', {
      p_key:             flag.key,
      p_enabled:         flag.enabled,
      p_dev_only_user_id: flag.dev_only_user_id,
      p_category:        flag.category,
      p_label:           flag.label,
      p_description:     flag.description,
      p_updated_by:      employee?.id,
      p_force_disabled:  !flag.force_disabled,
    });
    setFlags(prev => prev.map(f => f.key === flag.key ? { ...f, force_disabled: !f.force_disabled } : f));
    ok(!flag.force_disabled ? '⚠️ Force disabled — hidden for everyone including admins' : 'Force disable cleared');
  } catch (e) {
    err('Failed to update force disable');
  } finally {
    setSaving(null);
  }
};
```

**3. Add "Force Off" button to each flag row in the Actions section:**

Add alongside the existing "Set Dev" button:
```jsx
{/* Force disable — kills for everyone including admins */}
<button
  onClick={() => toggleForceDisabled(flag)}
  disabled={!!saving}
  title={flag.force_disabled ? 'Clear force disable (page returns to normal flag behavior)' : 'Force disable for EVERYONE including admins (bug fix kill switch)'}
  style={{
    padding: '4px 10px', borderRadius: 'var(--radius-md)', border: '1px solid',
    fontSize: 11, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer',
    background: flag.force_disabled ? '#fef2f2' : 'var(--bg-tertiary)',
    color:      flag.force_disabled ? '#dc2626' : 'var(--text-tertiary)',
    borderColor: flag.force_disabled ? '#fecaca' : 'var(--border-light)',
    opacity: saving === flag.key + '_force' ? 0.5 : 1,
    transition: 'all 0.12s',
  }}
>
  {flag.force_disabled ? '🔴 FORCE OFF' : 'Force Off'}
</button>
```

**4. Also show a `force_disabled` badge in the info section:**
```jsx
{flag.force_disabled && (
  <span style={{
    fontSize: 11, fontWeight: 700, padding: '1px 7px',
    borderRadius: 'var(--radius-full)',
    background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca',
  }}>FORCE DISABLED — ALL USERS</span>
)}
```

---

## Phase 4 — Admin Page: New "Page Access" Tab

**File:** `src/pages/Admin.jsx`

### 4A — Add third tab to the tab bar

```jsx
<button
  className={`admin-tab${activeTab === 'page_access' ? ' active' : ''}`}
  onClick={() => setActiveTab('page_access')}
>
  Page Access
</button>
```

And in the render:
```jsx
{activeTab === 'page_access' && <PageAccessTab />}
```

### 4B — PageAccessTab component

Build a new `PageAccessTab` component in `Admin.jsx`. This is the per-employee access control UI.

**Full spec:**

```
Layout:
┌─────────────────────────────────────────────────────────┐
│ Page Access                                             │
│ Grant or restrict individual pages per employee.        │
│ Overrides role defaults. Admins are unaffected.         │
│                                                         │
│ [Employee selector dropdown ▼]   [Clear All Overrides]  │
│                                                         │
│ ┌── MAIN ────────────────────────────────────────────┐  │
│ │ Dashboard        [role: ✅] [toggle]  source label  │  │
│ │ Conversations    [role: ✅] [toggle]  source label  │  │
│ │ Claims           [role: ❌] [toggle]  source label  │  │
│ │ Jobs             [role: ✅] [toggle]  source label  │  │
│ │ Production       [role: ❌] [toggle]  source label  │  │
│ │ Customers        [role: ❌] [toggle]  source label  │  │
│ ├── OPERATIONS ─────────────────────────────────────┤  │
│ │ Schedule         [role: ✅] [toggle]  source label  │  │
│ │ Time Tracking    [role: ✅] [toggle]  source label  │  │
│ └────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

**Details:**

- **Employee selector:** Dropdown of all active, non-admin employees (admins excluded — they always see everything). Load via `db.rpc('get_all_employees')`, filter to `is_active !== false && role !== 'admin'`.

- **Per-page row shows:**
  - Page label and section
  - **Role default indicator:** small badge showing what their role gives them by default (✅ or ❌). This is read-only info pulled from `nav_permissions`.
  - **Toggle:** the actual override. Three visual states:
    - **No override** (gray, dashed border): "Using role default" — clicking sets an override
    - **Override ON** (green): Employee explicitly granted access
    - **Override OFF** (red): Employee explicitly denied access
  - **Source label:** "Role default" / "Override: ON" / "Override: OFF"
  - **Clear button** (×): appears only when override exists — removes the row from `employee_page_access`, reverts to role default

- **Global flag info:** If a page has `force_disabled = true` in feature_flags, show a warning pill "⚠️ Globally disabled (Dev Tools)" — the toggle is greyed out because the override won't matter while force_disabled is active.

- **Clear All Overrides button:** Deletes all `employee_page_access` rows for the selected employee. Two-click confirm pattern.

- **Auto-save:** Each toggle saves immediately via `upsert_employee_page_access` RPC. No save button needed.

**NAV_KEYS to show** (same list as the existing `NAV_KEYS` const in Admin.jsx — DO NOT include `admin_panel` or `settings` since non-admins should never get those):

```js
const PAGE_ACCESS_KEYS = [
  { key: 'dashboard',          label: 'Dashboard',          section: 'Main' },
  { key: 'conversations',      label: 'Conversations',      section: 'Main' },
  { key: 'claims',             label: 'Claims',             section: 'Main' },
  { key: 'jobs',               label: 'Jobs',               section: 'Main' },
  { key: 'production',         label: 'Production',         section: 'Main' },
  { key: 'customers',          label: 'Customers',          section: 'Main' },
  { key: 'schedule',           label: 'Schedule',           section: 'Operations' },
  { key: 'schedule_templates', label: 'Schedule Templates', section: 'Operations' },
  { key: 'time_tracking',      label: 'Time Tracking',      section: 'Operations' },
  { key: 'collections',        label: 'Collections',        section: 'Operations' },
  { key: 'leads',              label: 'Leads',              section: 'Operations' },
  { key: 'marketing',          label: 'Marketing',          section: 'Growth' },
];
```

**Data loading pattern:**
```js
const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
const [overrides, setOverrides] = useState({}); // nav_key → boolean
const [rolePerms, setRolePerms] = useState({}); // nav_key → boolean (from nav_permissions)
const [featureFlags, setFeatureFlags] = useState({}); // from get_feature_flags
const [employees, setEmployees] = useState([]);
const [saving, setSaving] = useState(null); // nav_key currently saving

// When employee selected:
// 1. Load their overrides: db.rpc('get_employee_page_access', { p_employee_id: id })
// 2. Load their role's permissions: db.select('nav_permissions', `role=eq.${emp.role}&select=nav_key,can_view`)
// 3. Load feature flags: db.rpc('get_feature_flags')
// All three in Promise.all
```

**Override toggle handler:**
```js
const handleToggle = async (navKey, currentOverride, roleDefault) => {
  // If no override: set override to OPPOSITE of role default (if role says yes, override to no)
  // If override exists: flip it
  const newValue = currentOverride === undefined ? !roleDefault : !currentOverride;
  setSaving(navKey);
  try {
    await db.rpc('upsert_employee_page_access', {
      p_employee_id: selectedEmployeeId,
      p_nav_key:     navKey,
      p_can_view:    newValue,
      p_updated_by:  currentEmployeeId, // from useAuth() employee.id
    });
    setOverrides(prev => ({ ...prev, [navKey]: newValue }));
    ok(`${navKey} ${newValue ? 'granted' : 'revoked'} for ${selectedEmployee.full_name}`);
  } catch (e) {
    err('Failed to save');
  } finally {
    setSaving(null);
  }
};
```

**Clear single override:**
```js
const clearOverride = async (navKey) => {
  setSaving(navKey + '_clear');
  try {
    await db.rpc('delete_employee_page_access', {
      p_employee_id: selectedEmployeeId,
      p_nav_key:     navKey,
    });
    setOverrides(prev => {
      const next = { ...prev };
      delete next[navKey];
      return next;
    });
    ok('Override cleared — reverted to role default');
  } catch (e) {
    err('Failed to clear override');
  } finally {
    setSaving(null);
  }
};
```

---

## Build Order

1. **Run Phase 1 SQL** (force_disabled column + employee_page_access table + RPCs)
2. Verify in Supabase: `SELECT column_name FROM information_schema.columns WHERE table_name = 'feature_flags'` should include `force_disabled`
3. Verify: `SELECT routine_name FROM information_schema.routines WHERE routine_name LIKE '%employee_page_access%'` should return 3 RPCs
4. **Phase 2 — AuthContext.jsx** — update canAccess, add employeePageAccess state
5. **Phase 3 — DevTools.jsx** — add force_disabled toggle to FlagsTab only
6. **Phase 4 — Admin.jsx** — add PageAccessTab component + new tab
7. Commit after Phase 2+3 (auth changes), then again after Phase 4

---

## Verification Checklist

- [ ] `force_disabled` column exists on `feature_flags` table
- [ ] `employee_page_access` table exists with correct columns
- [ ] `get_employee_page_access`, `upsert_employee_page_access`, `delete_employee_page_access` RPCs all exist
- [ ] `canAccess()` respects all 4 layers in correct priority order
- [ ] `force_disabled = true` hides page even for admins
- [ ] Employee with override: override wins over role default
- [ ] Employee without override: role default applies normally
- [ ] Admins (no override): always see everything unless force_disabled
- [ ] FlagsTab: Force Off button works, badge shows "FORCE DISABLED — ALL USERS"
- [ ] FlagsTab: Regular enable/disable toggle still works (doesn't accidentally reset force_disabled)
- [ ] Admin Page Access tab: employee selector loads non-admin employees only
- [ ] Admin Page Access tab: role default column shows correct values
- [ ] Admin Page Access tab: toggle saves immediately via RPC
- [ ] Admin Page Access tab: clear (×) removes override and reverts to role default
- [ ] Admin Page Access tab: force_disabled flags show warning, toggle greyed out
- [ ] No `alert()` or `confirm()` — two-click confirm on "Clear All Overrides"
- [ ] Build passes

---

## ✅ Task Completion Checklist

When done, before closing PR:

1. Update `UPR-Web-Context.md`:
   - Add `employee_page_access` table to DB tables section
   - Add `get_employee_page_access`, `upsert_employee_page_access`, `delete_employee_page_access` RPCs
   - Update AuthContext section: add `employeePageAccess` state and updated `canAccess()` priority order
   - Add note: `force_disabled` column on `feature_flags` — kills page for everyone including admins

2. Delete `ACCESS-CONTROL-TASK.md` from the repo: `git rm ACCESS-CONTROL-TASK.md`

3. Final commit message: `docs: update UPR-Web-Context.md, remove completed ACCESS-CONTROL-TASK.md`
