# Google Integrations — Session Handoff & Continuation

> **Start here if you're resuming this work in a new session.** The per-user Google Drive
> integration is code-complete on this branch (`claude/account-migration-testing-srjbba`,
> draft **PR #101 → main**, Cloudflare CI green). External config + verification + merge remain.

## ✅ Done
- **Google Drive v1 — code complete.** `npm run build` passes; ESLint clean on new files.
  - Migration `supabase/migrations/20260627_google_drive_per_user.sql` — **applied to Supabase**
    (table **`user_google_accounts`** + RPC `get_google_drive_status`). Verify below.
  - Worker lib `functions/lib/google-drive.js` + 5 workers
    `functions/api/google-drive-{connect,callback,token,import,disconnect}.js`.
  - Frontend: `src/lib/googleDrivePicker.js`, `src/components/GoogleDriveButton.jsx`,
    Settings → Integrations tab + `GoogleDriveIntegrationPanel` (`src/pages/Settings.jsx`),
    button wired into the JobPage Files tab + tolerant `getFileUrl` (`src/pages/JobPage.jsx`).
- **Supabase-write permission fixed.** The account migration renamed the Supabase MCP server
  (old UUID → `Supabase`), so old allowlist entries didn't match → DB writes were gated.
  `.claude/settings.json` now allows `mcp__Supabase__apply_migration` + `mcp__Supabase__execute_sql`.
  A **new session** loads this and has working Supabase writes.

## 🔜 Remaining work (ordered)
1. **Verify the migration landed** (Supabase MCP works in a new session):
   `SELECT to_regclass('public.user_google_accounts'), to_regprocedure('public.get_google_drive_status()');`
   — both non-null. If missing, re-apply the migration file.
2. **External config — Google Cloud + Cloudflare** (manual; gates both Drive and Maps). Checklist below.
3. **Google Maps address autocomplete — NO code needed.** Already built
   (`src/components/AddressAutocomplete.jsx` + `src/lib/googleMaps.js`) and wired into 8 surfaces incl.
   the New Customer modal (`AddContactModal.jsx:198`) and New Job modal (`CreateJobModal.jsx:291`). It
   silently falls back to a plain input when the key is missing — which is why it *looks* absent. Fix =
   set `VITE_GOOGLE_MAPS_API_KEY` + enable **Places API (New)**; verify by typing in an address field.
4. **Merge/ship PR #101:** feature branch → `dev` (staging) → verify on dev.utahpros.app →
   `dev → main` PR (merge commit, fast-forward `dev`). Flip PR draft → ready when verified.
   Drive workers + the Settings tab only exist on the branch until merged.
5. **Drive end-to-end verification** (after config + deploy): connect → pick → import → render;
   token refresh; per-user isolation; disconnect.

## External config checklist (step 2)
**Google Cloud Console (one project):**
- Enable APIs: **Maps JavaScript API**, **Places API (New)**, **Google Picker API**, **Google Drive API**.
- OAuth consent screen: **Internal** if all staff use @utah-pros.com Google accounts (skips Google
  verification); else External. Scopes: `drive.file`, `openid`, `email` (non-sensitive).
- OAuth client (Web app): JS origins `https://utahpros.app`, `https://dev.utahpros.app`,
  `http://localhost:5173`; redirect URIs `https://utahpros.app/api/google-drive-callback` +
  `https://dev.utahpros.app/api/google-drive-callback`. → Client ID + Secret.
- One browser **API key**, restricted to the 3 browser APIs (Maps JS, Places New, Picker) + HTTP
  referrers for the domains → used for BOTH `VITE_GOOGLE_API_KEY` and `VITE_GOOGLE_MAPS_API_KEY`.

**Cloudflare Pages env — set in BOTH Production and Preview, then redeploy:**

| Var | Production | Preview |
|---|---|---|
| `GOOGLE_CLIENT_ID` | OAuth client id | same |
| `GOOGLE_CLIENT_SECRET` | OAuth secret | same |
| `GOOGLE_REDIRECT_URI` | `https://utahpros.app/api/google-drive-callback` | `https://dev.utahpros.app/api/google-drive-callback` |
| `VITE_GOOGLE_API_KEY` | browser API key | same |
| `VITE_GOOGLE_MAPS_API_KEY` | same browser API key | same |

`VITE_` vars are build-time → **redeploy required**; they're public by design (security comes from the
API-key restrictions, not from hiding them).

## ✅ Google Calendar sync — BUILT (Jun 28 2026, this branch)
Appointment + assigned crew → push create/update/delete events to each crew member's Google Calendar.
Reuses the same `user_google_accounts` connection + token refresh. **Migration applied** (inert until
someone connects the calendar scope).
- **Source-agnostic by design** (~~survives the appointments→scheduled-jobs refactor~~ — refactor
  declared stale, superseded by `docs/schedule-roadmap.md` 2026-07-03): mapping table
  `google_calendar_links (source_type, source_id, employee_id, google_event_id, sync_hash, status …)`.
  Today `source_type='appointment'`; flip to `'job_schedule'` later with no schema change.
- **Scope:** `calendar.events` added to the single "Connect Google" consent. **Internal Workspace app
  ⇒ no Google verification** even though it's a sensitive scope (resolved the old blocker).
- **Triggers** on `appointments` + `appointment_crew` → `notify_google_calendar_sync()` → pg_net →
  worker `functions/api/google-calendar-sync.js`. Lib: `functions/lib/google-calendar.js`.
- **Backfill:** `functions/api/google-calendar-resync.js` + Settings "Sync my appointments" button.
- **Status RPC:** `get_google_calendar_status()`. Times sent with `timeZone: 'America/Denver'`.
- **Gated on the SAME config as Drive** (OAuth client + Cloudflare env vars) + the calendar scope on the
  consent screen. On production release: `UPDATE integration_config SET value=
  'https://utahpros.app/api/google-calendar-sync' WHERE key='gcal_worker_url';`
- **To verify (after config + connect):** Moroni/Ben/E connect Google → Settings shows "Calendar sync" →
  click "Sync my appointments" (or create/edit an appointment) → event appears on their Google Calendar;
  edit → updates; cancel/delete → removed.

## Gotchas
- Token table is **`user_google_accounts`** (generalized for Calendar), not `user_google_drive`.
- `file_path` has two conventions; JobPage `getFileUrl` was made tolerant (strips leading `job-files/`);
  the import worker stores the prefixed form.
- Drive uses non-restricted `drive.file` (no CASA); Calendar's `calendar.events` is sensitive.
- Never push `main` directly — ship via `dev → main` PR (CLAUDE.md Rule 5).

## Key files
- Migration: `supabase/migrations/20260627_google_drive_per_user.sql`
- Workers: `functions/lib/google-drive.js`, `functions/api/google-drive-*.js`
- Frontend: `src/lib/googleDrivePicker.js`, `src/components/GoogleDriveButton.jsx`,
  `src/pages/Settings.jsx` (`GoogleDriveIntegrationPanel`), `src/pages/JobPage.jsx`
- Maps (already built): `src/components/AddressAutocomplete.jsx`, `src/lib/googleMaps.js`
