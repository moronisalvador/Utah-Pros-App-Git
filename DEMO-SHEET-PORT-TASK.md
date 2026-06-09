# Demo-Sheet Port to UPR — TASK.md

Port the standalone Netlify demo sheet tool into the UPR app as a Tech PWA tool, with Supabase draft persistence and Cloudflare Workers replacing Netlify functions.

---

## Pre-flight: read these first

1. `UPR-Web-Context.md` — canonical DB/RPC/system docs
2. `CLAUDE.md` — coding rules (`useAuth`, `db.rpc`, no `alert()`, `upr:toast`)
3. `_porting/demo-sheet/demo-sheet-v21.jsx` — the 1,675-line source component
4. `_porting/demo-sheet/encircle-search.js`, `encircle-rooms.js`, `encircle-upload.js`, `send-email.js` — Netlify functions to convert
5. Existing CF Worker for reference: `functions/api/sync-encircle.js` (for Encircle auth pattern + `jsonResponse` usage)
6. Existing Tech pages: `src/pages/TechDash.jsx`, `src/components/TechLayout.jsx` (for routing + card patterns)

**Rules in effect:** dev branch only, no `alert()`/`confirm()` (use `upr:toast` event), `const { db } = useAuth()`, CSS scoped to `@media (max-width: 768px)` unless provably safe on desktop.

---

## What the demo sheet does

A field-tech scope sheet capturing per-room data: dimensions, baseboard/trim LF, flooring SF, drywall, flood cuts, insulation, cabinets/countertops, doors, fixtures, appliances, equipment, contents move hours, notes. Plus job header (date/tech/address w/ Google Maps autocomplete/insured). Searches Encircle to link a claim, pulls rooms from the claim, submits via email + as an Encircle note.

---

## Target architecture

| What | Where |
|---|---|
| Main page | `src/pages/TechDemoSheet.jsx` |
| Route | Add to `src/App.jsx` (or wherever routes live): `/tech/demo-sheet` |
| Dash card | `src/pages/TechDash.jsx` (add card linking to the page) |
| Workers | `functions/api/encircle-search.js`, `encircle-rooms.js`, `encircle-upload.js`, `send-demo-sheet.js` |
| Migration | `supabase/migrations/<timestamp>_demo_sheets.sql` |

**Note on naming:** the email worker is renamed to `send-demo-sheet.js` (not `send-email`) to avoid collision with future generic email workers.

---

## Phase 1 — Database (Supabase)

Use `apply_migration`, NOT `execute_sql`. After applying, call `bust_postgrest_cache()`.

```sql
-- demo_sheets table
CREATE TABLE demo_sheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES employees(id),
  job_date DATE,
  tech_id UUID REFERENCES employees(id),
  job_number TEXT,
  address TEXT,
  insured_name TEXT,
  encircle_claim_id TEXT,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted')),
  submitted_at TIMESTAMPTZ,
  encircle_note_id TEXT
);

ALTER TABLE demo_sheets ENABLE ROW LEVEL SECURITY;

-- RLS — list both anon AND authenticated (UPR convention)
CREATE POLICY "demo_sheets_select" ON demo_sheets
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "demo_sheets_insert" ON demo_sheets
  FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "demo_sheets_update" ON demo_sheets
  FOR UPDATE TO anon, authenticated USING (true);

-- updated_at trigger (use existing helper if one exists, else inline)
CREATE TRIGGER demo_sheets_updated_at
  BEFORE UPDATE ON demo_sheets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Index for draft lookups
CREATE INDEX idx_demo_sheets_status_updated ON demo_sheets(status, updated_at DESC);
```

### RPCs (SECURITY DEFINER + explicit GRANT)

```sql
-- Save (insert if p_id null, update otherwise) — returns the row id
CREATE OR REPLACE FUNCTION save_demo_sheet(
  p_id UUID,
  p_data JSONB,
  p_job_date DATE,
  p_tech_id UUID,
  p_job_number TEXT,
  p_address TEXT,
  p_insured_name TEXT,
  p_encircle_claim_id TEXT,
  p_status TEXT DEFAULT 'draft',
  p_encircle_note_id TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
  IF p_id IS NULL THEN
    INSERT INTO demo_sheets(data, job_date, tech_id, job_number, address, insured_name,
                            encircle_claim_id, status, encircle_note_id,
                            submitted_at)
    VALUES (p_data, p_job_date, p_tech_id, p_job_number, p_address, p_insured_name,
            p_encircle_claim_id, p_status, p_encircle_note_id,
            CASE WHEN p_status = 'submitted' THEN now() ELSE NULL END)
    RETURNING id INTO v_id;
  ELSE
    UPDATE demo_sheets SET
      data = p_data,
      job_date = p_job_date,
      tech_id = p_tech_id,
      job_number = p_job_number,
      address = p_address,
      insured_name = p_insured_name,
      encircle_claim_id = p_encircle_claim_id,
      status = p_status,
      encircle_note_id = COALESCE(p_encircle_note_id, encircle_note_id),
      submitted_at = CASE WHEN p_status = 'submitted' AND submitted_at IS NULL THEN now() ELSE submitted_at END,
      updated_at = now()
    WHERE id = p_id
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION save_demo_sheet(UUID, JSONB, DATE, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

-- List recent drafts
CREATE OR REPLACE FUNCTION get_demo_sheet_drafts()
RETURNS TABLE (
  id UUID, updated_at TIMESTAMPTZ, job_date DATE,
  job_number TEXT, address TEXT, insured_name TEXT,
  encircle_claim_id TEXT
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT id, updated_at, job_date, job_number, address, insured_name, encircle_claim_id
  FROM demo_sheets
  WHERE status = 'draft'
  ORDER BY updated_at DESC
  LIMIT 20;
$$;
GRANT EXECUTE ON FUNCTION get_demo_sheet_drafts() TO anon, authenticated;

-- Load one
CREATE OR REPLACE FUNCTION get_demo_sheet(p_id UUID)
RETURNS demo_sheets
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM demo_sheets WHERE id = p_id;
$$;
GRANT EXECUTE ON FUNCTION get_demo_sheet(UUID) TO anon, authenticated;

-- Active techs for the dropdown (replaces hardcoded TECHS array)
-- Check first if get_active_techs already exists. If yes, reuse. If no, create:
CREATE OR REPLACE FUNCTION get_active_techs()
RETURNS TABLE (id UUID, name TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT id, name FROM employees
  WHERE active = true
  AND role IN ('field_tech', 'supervisor', 'project_manager', 'admin')
  ORDER BY name;
$$;
GRANT EXECUTE ON FUNCTION get_active_techs() TO anon, authenticated;

SELECT bust_postgrest_cache();
```

**Verify after migration:** query `demo_sheets` via `db.rpc('get_demo_sheet_drafts')` returns `[]` (not 403, not 404).

---

## Phase 2 — Cloudflare Workers (4 files)

Convert each Netlify function to Cloudflare Pages Function syntax. Reuse `functions/lib/cors.js` (`jsonResponse(data, status, request, env)` signature per existing convention) and `functions/lib/supabase.js` if needed.

### Conversion reference

| Netlify | Cloudflare Pages Function |
|---|---|
| `exports.handler = async (event) =>` | `export async function onRequest({ request, env })` |
| `process.env.X` | `env.X` |
| `event.queryStringParameters` | `new URL(request.url).searchParams` |
| `event.httpMethod` | `request.method` |
| `event.body` (string) | `await request.text()` / `await request.json()` |
| `return { statusCode, headers, body }` | `return jsonResponse(data, status, request, env)` |
| OPTIONS handling | Use `handleCors(request)` from `lib/cors.js` if it exists; else mirror existing worker pattern |

### `functions/api/encircle-search.js`
- Reads `env.ENCIRCLE_API_KEY` (already set in CF, ends in `5db6` per memory)
- Query params: `policyholder_name`, `contractor_identifier`, `assignment_identifier`
- Calls `https://api.encircleapp.com/v1/property_claims?...&limit=20&order=newest`
- Header: `X-Encircle-Attribution: UtahProsRestoration` (match existing UPR convention, NOT `UtahProsRestorationDemoSheet`)
- Returns `{ list: [...] }`

### `functions/api/encircle-rooms.js`
- Same pattern as Netlify version: fetch structures for claim, then rooms for each in parallel
- Returns `{ rooms: [...], structures: [...] }`

### `functions/api/encircle-upload.js`
- POST to `https://api.encircleapp.com/v2/property_claims/{claim_id}/notes`
- Body: `{ title, text }`
- Returns `{ ok: true, id: <note_id> }` so the page can store `encircle_note_id` in Supabase

### `functions/api/send-demo-sheet.js`
- Uses `env.SENDGRID_API_KEY` (already in CF)
- POST to SendGrid v3 `/v3/mail/send`
- Body: `{ subject, message }`
- `from: restoration@utah-pros.com`, `to: moroni.s@utah-pros.com,restoration@utah-pros.com` (or pull from env if those vars exist in CF — check first)

**For each worker:** match the error handling pattern of `sync-encircle.js`. Log Encircle status + response on non-2xx.

---

## Phase 3 — Component port

### `src/pages/TechDemoSheet.jsx`

Read `_porting/demo-sheet/demo-sheet-v21.jsx` as the source. Use `write_file` for the new file (not `edit_file` — too many changes). Apply these transformations during the port:

#### 3.1 — Auth + db
At top of main component:
```js
import { useAuth } from '../context/AuthContext'; // or wherever useAuth lives — check existing pages
const { db, user } = useAuth();
```

#### 3.2 — Fetch endpoints
Find/replace all four:
- `/.netlify/functions/encircle-search` → `/api/encircle-search`
- `/.netlify/functions/encircle-rooms` → `/api/encircle-rooms`
- `/.netlify/functions/encircle-upload` → `/api/encircle-upload`
- `/.netlify/functions/send-email` → `/api/send-demo-sheet`

#### 3.3 — Replace hardcoded TECHS
**OLD:**
```js
const TECHS = ["Matheus", "Nano", "Juani", "Ben", "Moroni", "Marcelo"];
```
**NEW:**
```js
const [techs, setTechs] = useState([]);
useEffect(() => {
  db.rpc('get_active_techs').then(data => setTechs(data || []));
}, []);
```
Then update the tech `<select>` to map over `techs` using `tech.id` as value and `tech.name` as label. Update `jobInfo.tech` storage to use `tech_id` (UUID) instead of name string. Display name elsewhere by lookup.

#### 3.4 — Replace `alert()` / `confirm()`
```js
window.dispatchEvent(new CustomEvent('upr:toast', {
  detail: { message: 'Saved', type: 'success' } // type: 'success' | 'error' | 'info'
}));
```
For confirms, use a custom modal or just proceed with the action + toast confirmation. **Do not block on `confirm()`.**

#### 3.5 — Add Supabase persistence

Add at the top of the component:
```js
const [sheetId, setSheetId] = useState(null);
const [drafts, setDrafts] = useState([]);
const saveTimerRef = useRef(null);

// Load draft from URL query param
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  if (id) {
    db.rpc('get_demo_sheet', { p_id: id }).then(row => {
      if (row) {
        setSheetId(row.id);
        setRooms(row.data.rooms || [defaultRoom()]);
        setJobInfo(row.data.jobInfo || {date:today(),tech:'',jobNumber:'',address:'',insuredName:''});
        setEncircleLinked(row.encircle_claim_id ? { id: row.encircle_claim_id, ...row.data.encircleLinked } : null);
        // restore other top-level state from row.data as needed
      }
    });
  }
  // Load drafts list
  db.rpc('get_demo_sheet_drafts').then(d => setDrafts(d || []));
}, []);

// Debounced autosave on any change
const autoSave = useCallback(() => {
  clearTimeout(saveTimerRef.current);
  saveTimerRef.current = setTimeout(async () => {
    const payload = {
      p_id: sheetId,
      p_data: { rooms, jobInfo, encircleLinked, /* any other top-level state */ },
      p_job_date: jobInfo.date || null,
      p_tech_id: jobInfo.tech || null,
      p_job_number: jobInfo.jobNumber || null,
      p_address: jobInfo.address || null,
      p_insured_name: jobInfo.insuredName || null,
      p_encircle_claim_id: encircleLinked?.id || null,
      p_status: 'draft',
    };
    const newId = await db.rpc('save_demo_sheet', payload);
    if (!sheetId && newId) {
      setSheetId(newId);
      window.history.replaceState({}, '', `?id=${newId}`);
    }
  }, 2000);
}, [sheetId, rooms, jobInfo, encircleLinked]);

useEffect(() => { autoSave(); }, [rooms, jobInfo, encircleLinked, autoSave]);
```

On submit success (after both Encircle upload AND email succeed): call `save_demo_sheet` with `p_status='submitted'` and `p_encircle_note_id=<id from upload response>`.

#### 3.6 — Drafts banner at top of page
If `drafts.length > 0` AND no current `?id=` in URL, show a small banner: "Resume draft: [job number / address] — Last edited X ago". Clicking it appends `?id=...` to the URL and reloads/loads.

#### 3.7 — Mobile CSS
Verify any new style additions are scoped to `@media (max-width: 768px)`. The original component is mobile-built; should mostly Just Work.

### `src/pages/TechDash.jsx`
Add a card linking to `/tech/demo-sheet` matching the existing card pattern (read `TechDash.jsx` first to see what pattern it uses — likely a `TechCard` component or similar).

### Routing
Add `/tech/demo-sheet` route to whatever routing setup exists. Ensure it sits inside `TechLayout` so the bottom nav stays consistent.

---

## Phase 4 — Verification (real iPhone)

**Pre-deploy checks:**
1. Cloudflare env has `ENCIRCLE_API_KEY` (`5db6`) and `SENDGRID_API_KEY` — verify in CF dashboard, do NOT change
2. Migration applied via `apply_migration`, `bust_postgrest_cache()` called
3. All 3 RPCs grant EXECUTE to `anon, authenticated`
4. RLS policies list both `anon, authenticated` roles

**Manual test flow on real iPhone:**
1. Open `/tech` → Demo Sheet card visible → tap → routes to `/tech/demo-sheet`
2. Tech dropdown populates from `employees` table (no longer hardcoded)
3. Search Encircle for a known job (use a real claim) → results render
4. Tap a result → rooms populate from `encircle-rooms` endpoint
5. Fill in one room (length/width/baseboard/etc.)
6. Wait 3 seconds → check Supabase → row exists in `demo_sheets` with `status='draft'`
7. Hard-reload the page → URL has `?id=...` → state restores from DB
8. Submit → check email arrives + Encircle note appears on the claim
9. Verify `demo_sheets` row updated to `status='submitted'`, `submitted_at` set, `encircle_note_id` populated
10. Open `/tech/demo-sheet` fresh (no `?id=`) → drafts banner shows the previous draft if any are still in draft state

---

## Phase 5 — Cleanup

1. Delete `_porting/demo-sheet/` folder entirely
2. Update `UPR-Web-Context.md`:
   - Add `demo_sheets` table to tables list
   - Add `save_demo_sheet`, `get_demo_sheet_drafts`, `get_demo_sheet`, `get_active_techs` (if new) to RPCs
   - Add 4 new workers to `functions/api/` list
   - Add `TechDemoSheet.jsx` to pages list
3. Delete this `DEMO-SHEET-PORT-TASK.md` after merge to main

---

## Commit strategy

Per UPR rule "commit and deploy after every 2-3 files":
- **Commit 1:** Migration + RPCs (test via SQL editor before moving on)
- **Commit 2:** 4 Cloudflare Workers (test each endpoint via curl after deploy)
- **Commit 3:** TechDemoSheet.jsx + TechDash card + route
- **Test on real iPhone before commit 4**
- **Commit 4:** Delete `_porting/`, update `UPR-Web-Context.md`

All on `dev` branch. Merge to `main` only after iPhone verification passes.

---

## Watch-outs

- **VITE_ env vars are build-time only.** Workers cannot read `VITE_*` — only `ENCIRCLE_API_KEY`, `SENDGRID_API_KEY` (no prefix). Already correct in your CF setup.
- **Encircle attribution header:** use `UtahProsRestoration` to match existing UPR pattern, not the demo-sheet original `UtahProsRestorationDemoSheet`.
- **PostgREST schema cache:** if `db.rpc('save_demo_sheet')` returns 404 after migration, call `bust_postgrest_cache()` again. Hosted Supabase needs the explicit RPC.
- **Tech ID type change:** the original stored tech as a name string. New version stores UUID. If you import/restore an old draft from the file system somewhere, this will need migration. (Not a concern for this port since there are no old drafts in DB.)
- **Encircle rate limit:** if search starts returning 429, that means the new UPR auto-create flow + this tool are competing for the same key's quota. Monitor; consider a separate Encircle key per app if it becomes an issue.
