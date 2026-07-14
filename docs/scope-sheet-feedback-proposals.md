# Scope Sheet — feedback-driven additions (v4 SHIPPED 2026-07-14)

**Status: LIVE.** Schema **v4** (`demo_sheet_schemas` id `6693fd6a-db91-4e6a-ace3-9b0d0f6e5fcc`,
`v4 — mitigation billing detail`) was published 2026-07-14 and is the active scope sheet on the one
shared Supabase → live on **dev + production**. New sheets use v4; already-saved sheets keep their own
version snapshot. This was a **data-only** change (a new `demo_sheet_schemas` version) — **no code,
migrations, or repo files**, because the tech renderer + report (email/PDF) are 100% schema-driven.

## Where it came from
Two sources: technician feedback (Juani Sajtroch, 2026-07-08 — baseboard/casing sizes, PPE, tension
poles) and the **InstaEstimate** estimator **Mark Gallacher** (instaestimate@gmail.com), who builds
UPR's mitigation + recon estimates from the scope sheet. Mark's 2026-06-25 email listed the general
mitigation items missing from the sheet; owner framing: *a good scope sheet is one recipe for BOTH the
mitigation estimate and the recon estimate.*

Already in v3 (no change needed): emergency after-hours call, floor-protection SF by type,
asbestos/lead/Itel, containment SF, content labor hours, and **Air Scrubber** (already an equipment
option).

## What v4 added
| Addition | Where | Detail |
|---|---|---|
| **PPE Used** | job-level `ppe` | list: item + qty/day + days → `computed` total pieces (`ppePieces`). Items: Gloves, Tyvek suit, Shoe covers, N95, Half-face, Full-face, Respirator cartridges |
| **Cleaning Performed?** | per-room `cleaning` (gated) | multi-chip: Anti-microbial, HEPA vacuuming, Stud/cavity + sanding, Floor, Tile, Concrete, Encapsulation |
| **Debris Removal** | job-level `debris` | list: method (Pickup / Dump trailer / Dumpster / Haul-away) + # loads (`debrisLoads`) |
| **Monitoring Visits** | job-level `monitoring` (gated) | monitoring visits + after-hours visits |
| **Baseboard / casing size + corners** | per-room `trim` | `baseboardSize` (3¼/4¼/5¼/Other), `casingSize` (2¼/3¼/4¼/Other), `roundedCorners` count |
| **Repair Scope / Continuous Flooring** | job-level `repairScope` | free-text note that feeds the recon estimate |
| **Equipment unit-days** | per-room `equipment` | `unitDays` computed (qty × days) → `equipmentUnitDays` |
| **Tension posts count** | per-room `containment` | `tensionPosts` now carries a `summaryKey` (count surfaces alongside post-days) |

**Billing-breakdown principle (owner):** PPE, drying equipment, and tension poles are captured as
**qty × days** and the generated report shows the per-line breakdown + total — not a lump sum. This is
achieved with `computed` fields (same pattern v3 already used for tension `postDays`), so the email +
PDF render it automatically.

Dropped: **"GP"** in the PPE list (nobody could confirm what it is).

## Publish / rollback (per `.claude/rules/scope-sheet-rollback.md`)
- **Live now:** v4 `6693fd6a-db91-4e6a-ace3-9b0d0f6e5fcc`.
- **Revert instantly (no deploy):** `SELECT publish_demo_schema('d7f78022-f444-46d1-8131-b68eb23be089');`
  (that is v3 — the prior active). Re-publish v4's id to roll forward again.
- **Edit going forward:** make a **new version** in Settings → Scope Sheets ("+ New"), keep each change
  individually revertable by re-publishing the prior row — never edit a published version in place.
- Shared-DB caveat: a publish affects dev AND prod at once.

## Possible follow-ups (not done)
- Per-**type** equipment unit-days buckets (currently one combined `equipmentUnitDays` bucket + the
  per-item lines). Would need a small `DemoSheetRenderer` tally-branch change (data-only handles the
  per-item breakdown today).
- Optional per-type SF on cleaning (owner chose checklist-only for now; structured to add later).
- Confirm the exact baseboard/casing size labels with the field once techs use it.
