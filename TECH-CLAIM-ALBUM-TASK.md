# TECH-CLAIM-ALBUM-TASK

**Status:** In progress
**Owner:** Moroni Salvador
**Created:** 2026-04-16
**Branch:** `dev` only

---

## Goal

Dedicated photo album page for a claim, reached by tapping "See all →" from the Photos & Notes section on `TechClaimDetail`. Bigger thumbnails, timestamps per thumbnail, grouped by job, with the existing lightbox pager for full-screen viewing.

## Route

`GET /tech/claims/:claimId/photos` → new component `TechClaimAlbum.jsx`.
Back button returns to `/tech/claims/:claimId`.

## Success criteria

- Tapping **See all →** on the Photos & Notes section opens the album at the route above, with a working back button.
- Tapping **See all →** on a per-job group header opens the album scrolled/filtered to that job.
- Album shows a 2-column grid of ~160×160 thumbnails (bigger than the 3-up strip on the claim page).
- **Timestamp caption** below each thumbnail — relative for last 7 days ("2h ago", "Yesterday"), short date for older ("Apr 12").
- Grouped by job on multi-job claims (division mini-header + underline). Single-job claims skip the header.
- Tapping a thumbnail opens the existing lightbox pager.
- Add Photo button pinned at the bottom of the album, with the same multi-job sheet picker behavior.
- Photos only (no notes). Notes stay on the claim page per user preference.
- No changes to desktop pages.

## Non-negotiables

Same rules as TECH-CLAIM-DETAIL-TASK. `dev` branch only. Never `alert()`/`confirm()`. `useAuth()` for `db`. Update `UPR-Web-Context.md` on completion.

## Files

### New
- `src/pages/tech/TechClaimAlbum.jsx`

### Modified
- `src/App.jsx` — add route
- `src/pages/tech/TechClaimDetail.jsx` — add "See all →" entry points (section header + per-group header), pass optional `initialJobFilter` via navigation state
- `UPR-Web-Context.md`

### Not modified
- Desktop pages. `TechClaims.jsx`. Anything under `src/lib/` except what's needed.

## Reuse strategy

Per TechClaimDetail task file, the `Lightbox` component becomes a 2-caller component in this task — so extracting is justified. But to keep the diff small, for **v1 ship the album with a local copy of the Lightbox** (copy-paste). Follow-up task will extract both to `src/components/tech/` once `TechJobDetail` is built and becomes the third caller. This matches the "3+ call sites beats premature abstraction" heuristic in CLAUDE.md.

The data shape and the photo URL helper (`fileUrl(db, path)`) are tiny — duplicate those inline.

## Phases

### Phase 1 — Album page + route + "See all →" entry point

1. Scaffold `TechClaimAlbum.jsx`:
   - `useParams()` for `:claimId`, `useLocation()` to read `state.focusJobId` (optional filter).
   - Load `get_claim_detail` to get the jobs list + contact + division for hero tint.
   - Load `job_documents` for all jobs (same `job_id=in.(...)` pattern), filter to `category='photo'`.
   - Render:
     - Slim top bar: back chevron + title "Photos" + photo count badge.
     - Subtle division-tinted band under the top bar (lighter treatment than the full claim hero — no need for the big hero block here).
     - Groups by job (only on multi-job claims), division mini-header + underline.
     - 2-col grid, 160px tiles, `aspectRatio: '1'`, 8px gap.
     - Caption line under each thumbnail: `relativeOrShortDate(created_at)`.
     - Tap → open local `Lightbox` copied from TechClaimDetail.
   - Pinned bottom action bar: **+ Add Photo**. Reuse the same upload flow (copy the handful of functions from TechClaimDetail). Respect single vs multi-job picker.
2. `App.jsx`: add route inside `TechRoutes`.
3. `TechClaimDetail.jsx`:
   - Section header gets a **"See all →"** trailing button when `totalPhotos > 0`, navigates to `/tech/claims/:id/photos`.
   - Per-group header gets the same button when that job has ≥1 photo, navigating with `state: { focusJobId: job.id }`.
4. Verify in preview with CLM-2603-010 (has photos).

### Phase 2 — Context doc + cleanup

- Update `UPR-Web-Context.md`:
  - File structure: add `TechClaimAlbum.jsx` entry.
  - Design system: note the album pattern as reusable for `TechJobDetail`.
  - Known Pending Items: update entry 10 (TechJobDetail) — mention the album page will also need the same entry point there.
- `git rm TECH-CLAIM-ALBUM-TASK.md`
- Commit: `docs: update UPR-Web-Context.md, remove completed TECH-CLAIM-ALBUM-TASK.md`

---

## Open questions

None — user confirmed "photos only, not notes" and gave green light.
