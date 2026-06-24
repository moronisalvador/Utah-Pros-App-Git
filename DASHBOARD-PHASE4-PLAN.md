# Dashboard Phase 4 — App-wide palette + first-class "Remodeling" division

**Status: DORMANT / not started.** This is a ready-to-execute plan, intentionally deferred.
It is the Phase 4 from the Overview-dashboard build (Phases 1–3 shipped; see
`UPR-Web-Context.md` → *Overview Dashboard*). Nothing here is active until you trigger it.

### How to activate (a future session)
- Start a session and say: **"Execute DASHBOARD-PHASE4-PLAN.md."** The agent should read this file
  top-to-bottom, get the owner sign-off in *Decisions* below, then build in the *Build order*.
- (Optional) rename this file to `DASHBOARD-PHASE4-TASK.md` to make it the **active build task** under the
  CLAUDE.md *Task File Protocol* (the agent reads `*-TASK.md` first, and deletes it on completion + updates
  `UPR-Web-Context.md`).

---

## Context / why
The new Overview dashboard uses its **own** division palette (teal/purple/coral/pink) and a **"Remodeling"**
division that the rest of the app doesn't have. That divergence was intentional and **scoped to the dashboard
only** (`src/components/overview/tokens.js`) so the rest of the app was untouched. Phase 4 is the deliberate,
app-wide rollout: adopt the new colors everywhere and make Remodeling a real division. It's deferred because
it ripples across ~24 files + the DB enum and is a visual change to the whole product — it deserves its own
focused session + owner review, not a side-effect of the dashboard work.

**Two independent parts** — they can ship separately:
- **Part A — app-wide palette** (recolor existing divisions). Pure front-end, low risk, fully reversible.
- **Part B — "Remodeling" as a first-class division** (DB enum + UI everywhere). Touches the shared DB; the
  enum add is effectively one-way.

---

## ⚠️ Decisions to confirm with the owner BEFORE coding
The dashboard collapses **water + fire + contents → "Mitigation"** (4 buckets: Mitigation / Reconstruction /
Remodeling / Mold). The app has **6 divisions** (`job_division` enum: `water, mold, fire, reconstruction,
contents, general`). So the 4-color dashboard palette does **not** map 1:1 to the app. Confirm:

1. **Keep all 6 app divisions and just recolor them** (recommended — least disruptive), or restructure the app
   toward the dashboard's 4 buckets (much larger; not recommended)?
2. **Exact color mapping** (recommended starting point, from `src/components/overview/tokens.js` `DIV`):
   | App division | New color | Note |
   |---|---|---|
   | water | `#0e9384` teal | dashboard "Mitigation" hue (water is the core mitigation work) |
   | reconstruction | `#8a5cf6` purple | |
   | mold | `#ec4899` pink | |
   | **remodeling** (new) | `#f2664a` coral | Part B |
   | fire | keep red (`#b91c1c`) | dashboard has no fire color — pick one |
   | contents | keep green (`#047857`) | dashboard has no contents color — pick one |
   | general | keep slate (`#475569`) | |
   Each also needs a light **bg tint** for badges (see Part A).
3. **Should the dashboard then drop its local palette** and import from the app-wide source
   (`DivisionIcons.jsx`) so there's one source of truth? (Recommended once colors match — see *Reconciliation*.)
   Note the dashboard's Mitigation bucket would then need a decision: keep aggregating water+fire+contents, or
   show each division separately.
4. **Do you actually want a Remodeling division now** (Part B), or just the recolor (Part A)? Part B only makes
   sense once Remodeling jobs are real.

---

## Part A — App-wide palette (recolor)

**Single source of truth:** `src/components/DivisionIcons.jsx` → `DIVISION_CONFIG` (`{ color, bg, label }` per
division) + the derived `DIVISION_COLORS`. **~24 files import these** (Jobs, Production, Schedule, JobPage,
ClaimPage, ClaimsList, Customers, CustomerPage, Conversations, TimeTracking, JobPanel, NewInvoiceModal,
AddRelatedJobModal, SendEsignModal, the overview module, …) — so changing `DIVISION_CONFIG` updates almost
everything automatically.

**Steps:**
1. Edit `DIVISION_CONFIG` in `src/components/DivisionIcons.jsx` — set the new `color` + a matching light `bg`
   tint per division (per the table above). `DIVISION_COLORS` derives automatically. `LOSS_CONFIG` (loss
   types: water/fire/mold/storm/sewer/vandalism/other) is separate — decide whether to recolor it to match.
2. Update the **hardcoded** division styles in CSS/JS that do NOT import the config:
   - `src/index.css` — the `.division-badge` / `[data-division="…"]` rules (water/mold/reconstruction/fire/
     contents bg+color). Grep `data-division` and `division-badge`.
   - `src/pages/Production.jsx` and `src/pages/Conversations.jsx` — `data-division` usages (verify they read
     the config vs hardcode).
3. Grep sweep for stray hardcoded division hexes (old values `#2563eb/#1d4ed8` water, `#9d174d/#7e22ce` mold,
   `#d97706/#b45309` recon, `#dc2626/#b91c1c` fire, `#059669/#047857` contents): `rg "#1d4ed8|#7e22ce|#b45309"`.
4. Ignore the helper scripts `patch_division_icons*.cjs` / `audit_division_icons.cjs` (one-off tooling).

**Verify:** `npm run build` + `npx eslint`; on `dev`, spot-check Jobs/Production/Claims/Customers badges,
division tabs, the tech app, and that the dashboard still looks right. Fully reversible (revert the commit).

---

## Part B — "Remodeling" as a first-class division

**DB (shared dev+main — sequence carefully):**
1. `ALTER TYPE public.job_division ADD VALUE IF NOT EXISTS 'remodeling';` — **additive and effectively
   one-way** (removing an enum value is painful). Safe to add anytime since no rows use it yet. Ship as a
   committed migration `supabase/migrations/<date>_division_remodeling.sql` AND apply live (MCP
   `apply_migration`). Per CLAUDE.md *shared-DB sequencing*: it's safe to add first because old code simply
   never selects it; deploy the UI that lists it right after.
   - Caveat: `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block with other statements in some
     PG versions — keep it in its own migration / statement.
2. Check for any DB CHECK constraints or RPCs that hardcode the division list (grep migrations for
   `'water'`/`'reconstruction'`), e.g. `dash_division_bucket` already handles `remodeling`.

**Frontend — add `remodeling` everywhere divisions are enumerated:**
1. `DivisionIcons.jsx`: add a `remodeling` entry to `DIVISION_CONFIG` (coral `#f2664a` + bg tint + label
   "Remodeling") and a `DivisionIcon` SVG case (pick an icon — e.g. a paint-roller/hammer).
2. Division pickers / filters / tabs — grep for hardcoded division lists, e.g. `MITIGATION_DIVS`,
   `['water'`, division `<option>`/tab arrays in: CreateJob / CreateJobModal, Jobs, Production (and its phase
   **macro groups** — decide which group Remodeling belongs to, or add a lane), Schedule filters, tech
   New-Job flow, OOP pricing (`job_type`), reporting filters.
3. The Overview dashboard already renders Remodeling (legend + a `$0` bucket) — once real data exists it
   populates via `dash_division_bucket` (already maps `'remodeling'`).

**Data migration:** none required (no existing jobs are remodeling). Optionally backfill any misfiled jobs.

**Verify:** create a test job with division=remodeling on `dev`; confirm it shows correctly in Jobs,
Production, badges, claim/job pages, the dashboard, and that filters include it. Build + lint clean.

---

## Reconciliation (optional, after A + B land)
Retire the dashboard-scoped palette so there's ONE source of truth:
- In `src/components/overview/tokens.js`, replace the local `DIV` hexes with imports from
  `DivisionIcons.jsx` `DIVISION_CONFIG` (keep the dashboard's bucket mapping if still aggregating
  water+fire+contents → "Mitigation", or switch to per-division). Update `UPR-Web-Context.md` to note the
  dashboard palette is no longer independent.

---

## Files most likely to change (from a Jun 2026 grep — re-grep when executing)
`src/components/DivisionIcons.jsx` (core) · `src/index.css` (`.division-badge`/`data-division`) ·
`src/pages/{Production,Conversations,Jobs,Schedule,JobPage,ClaimPage,ClaimsList,Customers,CustomerPage,
TimeTracking}.jsx` · `src/components/{JobPanel,NewInvoiceModal,AddRelatedJobModal,SendEsignModal}.jsx` ·
create-job + tech-new-job flows · `src/components/overview/tokens.js` (reconciliation) ·
new migration for the enum.

## Verification summary
- `npm run build` + `npx eslint` clean.
- Branch → `dev` (preview on dev.utahpros.app), visual spot-check across the app, then a reviewed
  `dev → main` PR (never push `main` directly).
- Part A is revert-safe; Part B's enum add is one-way (additive, low-risk).

## Rollback
- **Part A:** revert the commit (pure front-end).
- **Part B:** the enum value stays (harmless if unused); revert the UI commit to stop offering it.
