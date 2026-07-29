---
paths: ["src/pages/tech/**", "src/components/tech/**"]
---
# UX Design Principles — Tech Mobile App

**Last-verified: 2026-07-27** (offline bullet amended — owner ratified online-only for the initial
release; see the amendment under "Resume, loading & offline".)

Linked from `CLAUDE.md`. Applies to everything under `src/pages/tech/` and `src/components/tech/`.

**The User Persona:** Every tech UI decision should be made through the lens of a 64-year-old field technician who is not tech-savvy, standing in a flooded basement or doing drywall repair, wearing work gloves, holding his phone in one hand, possibly in direct sunlight. If he can't figure it out in one tap without reading instructions, it's too complicated.

**Core principles:**
- **Snap-first, describe-later** — Photos upload immediately on capture with no blocking step. Description is optional, offered via a dismissable toast with "Add note" link. Never block the camera→save flow with a required input.
- **No modals for field actions** — Inline expandable inputs on cards, not popups. The tech shouldn't lose context of where they are.
- **One primary action per screen** — Clock In on Dash, checkbox on Tasks, search on Claims.
- **Touch targets: 48px primary, 44px documented-secondary** — gloved hands, wet fingers. Primary field
  actions (Clock In, checkbox, save, capture) are ≥48px. A dense secondary control (a Remove ✕, an inline
  chip) may be 44px if it carries a comment saying so. **Hit areas <24px are banned regardless of visual
  size.** Typography floor: 11px absolute, 12px for any actionable text.
- **Status = color from 3 feet away** — Amber=OMW/en_route, Green=working, Red=paused, Blue=scheduled, Gray=completed.
- **Sticky headers don't move on pull-to-refresh** — The greeting/date header stays fixed, only the content below refreshes. Pattern: `PullToRefresh` wraps content BELOW the fixed header, not around it.
- **Empty states show upcoming work** — When 0 appointments today, show next 7 days of upcoming appointments so techs can prep the night before.
- **Completed state shows breakdown** — Travel time, on-site time, total. Never just "3.5h" with no context.

**Resume, loading & offline (the field reality — see [`page-lifecycle.md`](page-lifecycle.md) for the full law):**
- **Resume does nothing.** The app is an installed home-screen PWA; iOS suspends it on a quick app-switch
  and evicts it after a longer background. On resume the sticky header stays put, refetches are silent, and
  any timer (clock, OMW) keeps continuity — a tech who checks the calculator and comes back sees exactly
  what they left. Never re-run a spinner-gated `load()` on resume/pull-to-refresh (the minimize test at
  close-out enforces this).
- **Loading:** cold-start skeleton only; a refetch never blanks a rendered screen.
- **Offline:** the initial production release does not admit or automatically replay field
  mutations. Photos, notes, readings, equipment actions, task toggles, and other writes fail clearly
  while offline and remain online-only until an end-to-end idempotent, account-owned queue contract
  is separately reviewed. The retained local queue surface is recovery-only: it may inventory and
  quarantine legacy metadata without exposing payloads, and it may delete exact local data only
  after explicit confirmation; it must never send or retry that work.

  > **AMENDED 2026-07-27 (owner-directed) — the offline product decision is MADE.** This bullet
  > previously read "mutations go through `useOfflineQueue` where wired (photos, notes, task toggles)
  > so a basement with no signal doesn't lose work." PR #525 rewrote it to the online-only wording
  > above **while `docs/mobile-production-readiness-roadmap.md`'s C1 row still listed "offline product
  > decision" as a pending exit criterion** — a rule rewritten with the decision behind it still open.
  > Asked to resolve it on 2026-07-27, the owner **ratified online-only for the initial release**, so
  > the wording above is now law rather than an implementation artifact, and C1's offline criterion is
  > closed. Recorded here in the `db-foundation-wave-ownership.md` §8 format so the change is
  > attributable rather than silent.
  >
  > **What this costs, stated plainly:** a tech in a basement with no signal now *loses* the tap. The
  > protection is that they are TOLD — the save fails visibly and the sheet stays open with the typed
  > value intact (`TechAppointment.jsx` `handleSaveReading`/`handlePlaceEquipment`,
  > `hub/HubTools.jsx` likewise). Those four handlers **throw**; they must never `return`, because both
  > entry sheets treat a resolved promise as success and would fire "Reading saved", close, and discard
  > the reading. Re-opening queued offline writes is a separate reviewed change, not a bug fix.

**Task assignment business logic (CRITICAL):** *(also mirrored in `UPR-Web-Context.md`; that is the
source of truth for the join paths and column names — verify live, not from this summary.)*
Tasks are NOT assigned directly to technicians. Tasks belong to appointments. Technicians are assigned to appointments via `appointment_crew`. The join path is: `employee → appointment_crew → appointments → tasks`. The `get_assigned_tasks` RPC handles this join internally.

**Time tracking model:**
- Timer starts from `travel_start` (On My Way), not `clock_in` (Start Work)
- `travel_minutes` — stored on `job_time_entries`, computed when tech hits Start Work: `now() - travel_start`
- `hours` — on-site time only: `clock_out - clock_in - paused_minutes` (used for billing/Xactimate)
- Total labor cost = `(travel_minutes/60 + hours) × rate`
- Tech sees one continuous timer from OMW; backend stores travel and on-site separately

**Photo/Note storage:**
All photos and notes go into `job_documents` table via `insert_job_document` RPC. Photos upload to `job-files/{job_id}/{timestamp}-{filename}` in Supabase Storage. The RPC accepts `p_appointment_id` and `p_description` (both optional) — always pass `p_appointment_id` when uploading from an appointment context.

**Document query pattern (important):**
When fetching docs for an appointment, query by BOTH appointment_id OR job_id as a fallback for older docs:
```js
db.select('job_documents', `or=(appointment_id.eq.${apptId},job_id.eq.${jobId})&select=*&order=created_at.desc`)
```
