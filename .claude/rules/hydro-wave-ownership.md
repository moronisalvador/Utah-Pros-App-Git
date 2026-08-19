# Hydro (drying documentation) — Active Ownership Manifest

**Last verified:** 2026-08-19
**Status:** F1/F2 authored, committed, **unapplied**. Repository implementation authorized; no
live action authorized.
**Plan:** [`docs/hydro-roadmap.md`](../../docs/hydro-roadmap.md)
**Dispatch:** [`docs/hydro-dispatch.md`](../../docs/hydro-dispatch.md)

## Lease

The Hydro initiative owns the new `hydro_*` schema, its Workers, pages, components and tests, plus
the narrow shared seams named below. The lease ends at owner handback or when the initiative row is
removed from [`initiative-status.md`](initiative-status.md).

Other sessions must not edit the owned objects or the reserved hydro blocks in shared files without
explicit coordination. This lease does not reserve unrelated behaviour in a shared file.

## Owned files and objects

- `docs/hydro-{roadmap,dispatch}.md`; `.claude/rules/hydro-wave-ownership.md`;
- `supabase/migrations/20260817010000_hydro_drying_spine.sql` + paired rollback;
- `supabase/migrations/20260817020000_hydro_legacy_access_hardening.sql` + paired rollback;
- any later `supabase/migrations/*hydro*` and paired rollback;
- `public.hydro_drying_chambers`, `public.hydro_chamber_rooms`,
  `public.hydro_monitoring_points`, `public.hydro_readings` and their policies/indexes/grants;
- `public.hydro_access()`, `public.hydro_upsert_chamber()`, `public.hydro_upsert_point()`,
  `public.hydro_insert_reading()`, `public.get_hydro_log()`;
- types `hydro_reading_kind`, `hydro_control_source`, `hydro_water_category`,
  `hydro_water_class`, `hydro_chamber_status`;
- `tests/qa/unit/hydro-*.test.js`, `supabase/tests/hydro_*.test.sql`,
  `scripts/qa/qualify-hydro-*-local.mjs`, `scripts/qa/probe-encircle-hydro.mjs`;
- new `src/pages/tech/` and `src/components/tech/` hydro surfaces and their route-lazy stylesheet.

## Narrow shared seams

Edits must be minimal and preserve every existing contract:

- `src/lib/psychrometric.js` — **elevation support only.** `calcGPP` gains an optional pressure
  parameter; the existing call signature must keep working, because it is the shipped one.
- `src/lib/dispatchers/readingDispatcher.js`, `equipmentDispatcher.js` — additive hydro paths and
  the equipment temp-UUID resolution.
- `src/pages/tech/v2/hub/HubTools.jsx`, `hubHelpers.js` — the Dry Logs surface only.
  **`HubSections.jsx` is released from this lease (2026-08-19).** The Dry Logs row it
  reserved no longer exists there — see the handover below — so the seam has nothing left
  to reserve, and holding it would block unrelated section-list work for no benefit.
- `src/pages/tech/v2/TechDryLogs.jsx` + the `§DRYLOGS` block in
  `src/pages/tech/v2/job-hub.css` — the destination that replaced the row. Hydro's Phase C
  capture UI lands INSIDE this page; it does not need a new route or a second screen.
- `functions/api/generate-water-loss-report.js` — additive report tiers.
- `src/App.jsx`, `src/routes/buildTargetPages.web.jsx`, `NATIVE_PAGE_ALLOWLIST` — route registration
  only.
- `ENCIRCLE_API_REFERENCE.md` §7, `UPR-Web-Context.md`, `.claude/rules/initiative-status.md`.

`src/index.css` is **not** leased. The global stylesheet is near its blocking ceiling; ship a
route-lazy, component-scoped stylesheet instead (contractor-compliance precedent).

## Frozen and forbidden

- **No change to `moisture_readings` or `equipment_placements` columns, and no data write to
  either.** F2 changes their policies, grants and their two writer functions' bodies — nothing else.
- **`get_job_readings`'s return shape is frozen** while the shipped Dry Logs card consumes it. F1
  does not touch it at all; Phase C may re-point it only with a committed backward-compatible test.
- **`insert_reading` and `place_equipment` signatures are frozen** — the deployed offline
  dispatchers call them by name with those exact parameters.
- No second role predicate: everything hydro consumes `public.hydro_access()`. Inlining a role list
  anywhere is a review failure.
- No `anon` grant on any hydro object, ever. Hydro has no pre-login surface and belongs in no
  `database-standard.md` §2 allowlist entry.
- No browser `INSERT`/`UPDATE`/`DELETE` grant on any `hydro_*` table. Writes go through the definer
  RPCs; that is the entire authorization posture.
- No write attempt against Encircle Hydro — its API is **GET-only**, verified 2026-08-17.
- **`page:tech_moisture` and `page:tech_equipment` must not be widened** — roadmap §1. They expose
  the legacy 4-step wizard and ~15%-low GPP.

## Handover — Dry Logs became a screen (2026-08-19, owner-directed)

Owner, in conversation: *"add the dry logs between notes and more… instead of on the body
of the page. That way, it's just a button that we click to access a dedicated dry logs page
just like encircle does"* — then, asked how far to take it: *"Just the button to the empty
page for now."*

Done by the Job Hub session, not this lease's holder, and recorded here because it moves
Hydro's landing zone:

- The collapsed Dry Logs accordion is **gone from `HubSections.jsx`**, along with the H2-e1
  summary query. That query eagerly fetched the whole `get_job_readings` list on every
  drying job to fill a one-line label; with no label it had no buyer, so the Hub stopped
  paying for it.
- `HubTools.jsx` is **unchanged** and now renders on `TechDryLogs.jsx` at
  `/tech/job/:jobId/dry-logs`. Its readings/equipment queries, its
  `insert_reading`/`place_equipment` calls and its frozen signatures are untouched.
- `page:tech_moisture` and `page:tech_equipment` are **still both off**, so the screen a
  tech actually sees is an honest empty state. **The standing instruction not to widen
  those two flags is unchanged and now matters more**, because widening them is the only
  thing that would put the legacy 4-step wizard and the ~15%-low GPP on a screen of its own.
- `dryingSummary()` in `hubHelpers.js` has **no caller** as of this change. It is kept, with
  its 20+ tests, because Phase L's daily log wants exactly that shape — it is a parked
  helper, not dead code.

**What this changes for Hydro:** Phase C has a real page to build into instead of an
accordion it would have had to outgrow, and the roadmap's "capture UI" no longer implies a
route decision. Nothing about F1/F2, the migrations, or `hydro_access()` is affected.

## Integration order

1. Behavioural §5b proof for F1/F2 (dispatch Block A).
2. Owner-authorized apply, **F1 then F2** — F2 depends on `hydro_access()`.
3. Phase C capture UI.
4. Phase E equipment; Phase L daily log; Phase R reports.
5. Canonical docs and reviewers at each step.

No block may assume a later block shipped or a migration was applied. All source must fail closed
when its schema, flag or provider configuration is absent.

## Collision and stop rules

- `git fetch origin` and compare the exact shared-file diff before every integration batch.
- If another active lease appears for a shared seam, stop and coordinate.
- Do not modify another initiative's unapplied migrations.
- **Re-verify that `moisture_readings` is still empty immediately before applying F1.** The entire
  "free redesign" argument rests on it; if readings exist, stop and re-plan.
- A hard stop: any `anon` grant, any browser table write path, any inlined role list, or any
  behavioural proof whose DENY cases leave rows behind.

## Close-out and handback

Run `.claude/rules/close-out-standard.md` in full. Handback reports exact changed files, repository
proof, unapplied migrations, external gates and working-tree state. Remove this lease only when the
initiative is integrated and handed back, or deliberately retired.
