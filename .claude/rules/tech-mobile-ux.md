# UX Design Principles — Tech Mobile App

Linked from `CLAUDE.md`. Applies to everything under `src/pages/tech/` and `src/components/tech/`.

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
All photos and notes go into `job_documents` table via `insert_job_document` RPC. Photos upload to `job-files/{job_id}/{timestamp}-{filename}` in Supabase Storage. The RPC accepts `p_appointment_id` and `p_description` (both optional) — always pass `p_appointment_id` when uploading from an appointment context.

**Document query pattern (important):**
When fetching docs for an appointment, query by BOTH appointment_id OR job_id as a fallback for older docs:
```js
db.select('job_documents', `or=(appointment_id.eq.${apptId},job_id.eq.${jobId})&select=*&order=created_at.desc`)
```
