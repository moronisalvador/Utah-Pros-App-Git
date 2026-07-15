# Session 2 — Live State & Decision Log (the "save game")

**Purpose:** the single re-hydration file for the flows session. Any session — this one after a
compaction, or a fresh one opened later — reads **this file + `UX-FLOWS-BRIEF.md` + `TECH-DESIGN-STANDARD.md`
+ the prototypes on disk** and is fully caught up **without needing the chat history.** Update this file
as each screen locks (it is part of close-out). The brief (`UX-FLOWS-BRIEF.md`) predates the work below.

**Last-updated: 2026-07-15**

---

## 0. How to stay consistent across compaction (the method)

The design is **derived from disk, never from chat memory.** The durable sources, in precedence order:

1. `docs/tech-redesign/prototypes/kit.html` — the shared foundation: tokens, SVG sprite, fonts,
   component classes. Cloned verbatim from the 3 mockups. **Inlined into every prototype.** Token drift
   is a blocker — the tokens are UNPREFIXED (`--ground --surface --surface2 --ink --ink2 --ink3 --hair
   --pill-bg --pill-ink --amber/-bg --green/-bg --red/-bg --blue/-bg --gray/-bg --focus --frost --sh-card
   --sh-hero`) scoped to `.stage` (light) / `.stage[data-theme="dark"]` (dark). NOT `--t-*`, NOT
   `.tech-layout`.
2. `TECH-DESIGN-STANDARD.md` — the law. §12 (this session's flow amendments) folds in as each screen locks.
3. The prototypes — the actual locked screens.
4. This file — the owner decisions + progress that the above don't yet carry.

When in doubt: re-read the prototype and the kit, don't reconstruct from memory.

---

## 1. Working loop (keep it)

Build (helper builder agents) → adversarial persona + craft critics → mechanical QA → orchestrator
renders in headless Chromium and reviews with eyes → **owner reacts on their phone (marks up
screenshots) → I apply here with full system context → lock.** Owner reactions are the tuning
mechanism. The owner stays in THIS chat (not a separate "claude design" session) because the design
system, kit, repo, and standard context all live here — a fresh design session would lose them.

**Render harness:** `/tmp/kit/shoot.mjs` uses `import pkg from '<abs>/node_modules/playwright-core/index.js';
const {chromium}=pkg;`. Renders framed at 1040×940, or mobile at 430×860 (triggers `@media max-width:500px`).

---

## 2. Owner decisions (binding — do not relitigate)

### From AskUserQuestion batches
| # | Topic | Ruling |
|---|---|---|
| 4a | Job save → destination | **Land on the new job hub** (not a forced schedule chain). Hub carries a quiet "Schedule a visit" row. |
| 4a | Quick-add customer scope | **Job-flow-only, minimal** (name + phone). |
| 4c | Tech scheduling | **Full tech self-service** — "Add visit" is first-class (FAB on Schedule). |
| 4c | Appointment title | **Editable with auto-suggestion** (pre-filled from job type; pencil affordance). |
| 4d | Finish pill | **Finish is ALWAYS the solid black two-tap pill** — never gated/quieted. |
| 4f | Last task completes | **Both** Done-collapse **and** a coordinated emphasis moment. Finish stays black; the "clear to finish" ack is collapse + check-pop + `notify()` haptic + toast — NOT a pill state change. |
| 4b | Customer save → destination | **Land back with a success toast** (stay in `/tech/*`). |
| 4g | Chamber setup | **Full tech chamber control** (create chambers, assign rooms, set tolerances). Chambers have no native table — separate reviewed change; Rooms is the fallback grouping. |
| 4e | Burst photo capture | **Not adopted** — single snap-first loop stays the law. |
| Create-new-job from Add-visit | **Launch full New Job, return the selected job** (not an inline mini-form). |
| Activity log content | **System-automated messages only** (not tech-sent messages). PLUS: invoices created & sent, estimates created & sent, on top of the base list (on-my-way, report generated, equipment placed, visit scheduled, job created). |

### Verbal refinements made this session (all applied to prototypes)
- **Schedule month view:** tapping a different day **updates the day's appointments in-place (preview
  panel)** — it does NOT switch to the daily view. Daily view is optional/separate.
- **Add-visit start/end:** show **Start and End time as two blocks side-by-side**; make clear you must
  pick the end time too.
- **Add-visit job picker:** show the **address of the job** so you pick the right one; also show an
  **abbreviated date of loss** (people have >1 flood in the same month).
- **Add-visit job picker results = MATCH the polished search result layout** (below), plus a
  "Create new job" entry.
- **Type-of-visit choices:** **no checkmark** (it clipped "Reconstruction"). Removed at kit level.
- **Date & time pickers:** must use **native iOS pickers** (`<input type="date"/time">`), NOT the
  Chromium/desktop dropdown — owner will test on iPhone via the live artifact.
- **Add-visit = FULL-SCREEN PAGE, not a bottom sheet** (definitive fix after repeated iPhone scroll /
  cut-off-title / unreachable-X reports). Long creation forms = full-screen pages; pickers/quick actions
  = bottom sheets. Add-visit has a header with a reachable X + `.main` scroller + pinned footer pill.
- **Add-visit crew:** ship a version with **4–5 technicians** to test scrolling.
- **Add-visit notes:** add notes to a visit; **show who added each note + date/time**; if someone else
  edits a note, **ownership transfers to the editor.**
- **Activity log** lives inside the **job hub** (built next).
- **Visit-notes model (hub, 2026-07-15):** ONE notes stream per visit, surfaced twice — (1) the
  stage-card quiet "Office note" line is the *pinned* note (glanceable access/billing instruction);
  (2) a below-fold **Notes section** (between Documents and Activity) shows the full authored list
  with author + timestamp + edit + ownership-transfer, and "+ Add note". The Add-visit notes feed
  this same stream. Notes are SEPARATE from the Activity log (Activity = system-automated events
  only, per the owner's rule). Pinned = a surfacing property, independent of authorship (editing a
  pinned office note transfers ownership to the editor but keeps the pin).

### Polished SEARCH RESULT layout (locked — reuse everywhere a job/claim is searched)
Line 1: **water-loss type + abbreviated date of loss** on the same line.
Line 2: **full street address + city.**
Line 3: **claim number + job number** — standardized **smaller (12px, nowrap)** so they always fit on
one line (previously only fit when the Done chip was narrow).

---

## 3. File inventory (all under `docs/tech-redesign/prototypes/`)

| File | Status | Contents |
|---|---|---|
| `kit.html` | foundation | tokens + sprite (30 verbatim + 18 authored gap glyphs) + fonts + components. Inlined into each prototype. |
| `schedule.html` | **LOCKED** (owner: "we nailed the schedule and appointment creation part") | month (in-place day preview) · day (week strip + day-switch + prev/next) · day-empty · loading skeleton · error-over-stale · search (polished result layout) · **add-visit full-screen page** (job fpick→matching picker + create-new-job · date/time native pickers · start+end side-by-side · type choices no check · 5-tech crew · notes w/ ownership transfer). |
| `new-job-flow.html` | built; **owner wants rework** (deferred to after hub) | 7-step: FAB menu → customer → job type (division+referral) → claim fork → review → non-blocking sync → land on hub. |
| `job-hub.html` | **in Chromium review** (this session) — being reworked into a "job dashboard" | 5 clock states + Tasks (collapsible, default-open) + Drying WIDGET (taps→hydro) + below-fold (Visits/Job&Claim/Photos/Documents/Notes) + Activity as a collapsed ROW → dedicated `s-activity` page (full log). Sample: Gary Sorensen #26-1173, 1420 N Oak Dr Layton. |

**Job Hub rework (owner direction, 2026-07-15) — "treat it like a job dashboard":**
- LOCKED/frozen (owner: "perfect, don't mess with it"): the stage card (clock/OMW→Start→Finish/time
  tracking) + address row + the office-note glance. **Office note = the notes entered during
  appointment creation.** Activity stays pinned at the very BOTTOM, always.
- DONE this session (the owner's 3 asks + my advice, all approved): ① Activity → a collapsed row with a
  latest-event preview that opens a dedicated full Activity page (`s-activity`). ② Checklist → renamed
  **Tasks**, now a collapsible card (owner wanted default-collapsed; I recommended + shipped
  **default-OPEN** because tasks are the primary on-site work and the Done-collapse already keeps it
  short — one-line flip if owner still wants collapsed). ③ Drying gateway → a **progress widget**
  (Day 4 · 2/3 dry · 1 wet · Readings due) that taps into the hydro page.
- NEXT (owner's new requirement): **Room tiles** — tap a room → that room's photos + notes (the
  Encircle *function*, NOT its banned visuals). Must be the organizing spine (not another stacked
  section) to keep the page short. This reshapes how Photos/Notes are grouped. Its own focused build.
- STILL OPEN (my tile proposal, pending owner nod): Visits / Job & Claim / Documents → compact tap
  tiles instead of full stacked sections (the real length fix).

**Sequencing (owner):** calendar/schedule 100% ✓ → **job creation rework (next)** → job hub ("most
important"). NOTE: hub was built first as a draft to react to; the owner may still reorder.

---

## 4. Pending / open

- **Finish Job Hub review → commit → publish artifact** (in progress).
- **New Job flow rework** — owner said "needs improving," held specifics; deferred to after hub.
- **Fold locked specs into `TECH-DESIGN-STANDARD.md` §12** — schedule/appointment are lockable now;
  the draft lives at `/tmp/kit/standard-amendment-draft.md` (NOT committed — copy into the standard).
- **Claim vs job numbering scheme** — placeholder job numbers (#4821 etc.); confirm real scheme
  (is `#26-1173` the claim or the job number?).
- **Finish-pill §6.A.1/§8.2 supersession** — strike the "ripened quiet-pill" variant in the standard
  once the owner confirms on the hub reaction.

## 5. Artifact URLs (update-in-place via `url` param)
- Dashboard `claude.ai/code/artifact/d4713aec-ed7c-459e-8a7b-2b72166dcc17`
- Hub (mockup of record) `…/5bceeb63-769b-40e1-9bac-0038d5a52b5e`
- Drying `…/7af73e82-195d-4675-a841-1bd7a132bb53`
- Style guide `…/7b89687f-2495-4cb4-af8d-90a6c57dccfa`
- Session-2 prototype artifacts: recorded here as they publish (schedule, new-job, job-hub).
