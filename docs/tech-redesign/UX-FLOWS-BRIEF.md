# UX Flows Brief — Tech PWA Redesign (Session 2 of 3: Flows & Remaining Screens)

**Last-verified: 2026-07-14** · Authored at the close of the design-standards session (PR #422) to
transfer the knowledge that lives outside the standard: owner taste signals, flow-level anatomy of
the real code, and the exact scope of what remains to design. **This file + the pointers below are
the complete read scope for the flows session — it should NOT need this chat's history.**

---

## 1. What this session is (and is not)

- **IS:** interaction/UX design for the flows and the remaining screens of `/tech/*`, in the LOCKED
  Direction B system. Deliverables: steppable prototype artifacts the owner reacts to, flow specs
  folded into the standard, bespoke mockups for the screens that need them, and standard amendments
  where a flow demands a new component.
- **IS NOT:** implementation (that is session 3, per the brief's two-session decision — flag-gated,
  one screen per agent), and NOT a relitigation of anything in §3's decision ledger.
- **Method that worked (keep it):** builder agent → adversarial persona + craft critics → mechanical
  QA → orchestrator renders in headless Chromium and reviews with eyes → **owner reacts on their
  phone → lock**. The owner's reactions are the tuning mechanism. Run with `ultracode`.

## 2. Source of truth (read in this order)

1. `docs/tech-redesign/TECH-DESIGN-STANDARD.md` — the law (tokens, components, anatomies, motion,
   floors, build contract; §8.4 = the unmocked-screen rule).
2. `docs/tech-redesign/specs/` — six detail specs (foundations, icons, components-core,
   components-new, field-science, motion-map).
3. `docs/tech-redesign/mockups/` — the screens of record (`direction-b.html` dashboard ·
   `refine-b-jobhub.html` hub FINAL · `hydro-b.html` drying module). Clone their token blocks and
   defs verbatim; token drift is a blocker.
4. `docs/tech-redesign/design-context-pack.md` — owner decisions + the six grounding surveys
   (screens, shell, architecture, brand, constraints). Lines 1–145 are the rules digest.
5. Live artifacts (update-in-place via the `url` param): dashboard
   `claude.ai/code/artifact/d4713aec-ed7c-459e-8a7b-2b72166dcc17` · hub
   `…/5bceeb63-769b-40e1-9bac-0038d5a52b5e` · drying `…/7af73e82-195d-4675-a841-1bd7a132bb53` ·
   style guide `…/7b89687f-2495-4cb4-af8d-90a6c57dccfa`.

## 3. Owner taste ledger (decisions + signals NOT fully captured elsewhere — binding)

- **"Replace the blue with black."** The identity is ink; the old blue was stock Tailwind blue-600
  doubling as the scheduled-status hue. Never reintroduce a brand hue.
- **Hydro is the quality bar.** The owner's words: "excellent." Its recipe — quiet tabular readings,
  color only on state, one primary docked pill, glance-and-gate — is the house style for every
  data-dense surface.
- **The hub's structure is settled.** Three serious challengers (checklist-first "Flow", compressed
  "Deck", timeline "Story") lost to the original clock-stage structure; Story's best bits were
  folded in (stage progress meta, Done-collapse, inline capture pair). Do not re-open the hub's
  skeleton; polish only within it.
- **Owner dissatisfaction shows up as "let's talk," not as specs.** Present 2–3 concrete, openable
  options and ask for a reaction; never ask for abstract requirements.
- **Encircle = data-model reference, NEVER visual reference.** Its red side-stripes, six-tile grids,
  and orange chrome are all banned patterns in our system.
- **Persona wins ties.** When premium and rugged conflict, the gloved 64-year-old wins (48px/56px
  targets, 11/12px floors, ~7:1 primary contrast, shape-redundant status, one primary action).
- **No emojis anywhere, ever** — including ✓/→/↓ as text; all glyphs are drawn SVG in the 24px
  duotone family hand.
- **Frozen seams still bind design:** consent/send paths (worker sole-writer, no `skip_compliance`),
  `page:tech_msgs_v2` pane mechanism, `nav.js` href helpers, safe-area rules, motion-standard v2.

## 4. Flow inventory (what exists today → what to design)

Grounded in the live code 2026-07-14 (scout inventory of `TechNew*/TechEdit*` + the pack surveys).
For each flow the session designs: the choreography (sheets/steps/states), the B-language screens,
and the error/offline/interruption behavior. **Today's field semantics are jurisdiction — redesign
the experience, not the data contract.**

### 4a. Job + customer creation (the + FAB flow)
- **Today:** dash FAB → two pills (New Job / New Customer). `/tech/new-job`: customer search
  (debounced `search_contacts_for_job`) with inline quick-add customer (name+phone; duplicate phone
  auto-selects existing — keep this interruptibility grace); New-vs-Existing **claim fork** (existing
  pre-fills loss address + insurance); division pills (currently emoji — must become drawn icons);
  referral-source pills; address autocomplete (Google Places, plain-text fallback); carrier +
  claim# (hidden for OOP); save = one `create_job_with_contact` tx + awaited-8s Encircle sync →
  navigate to job.
- **Design targets:** a staged sheet/page sequence in B (persona: one decision per screen-zone);
  the claim fork made unmissable; division/referral pills in the drawn icon family; a visible
  "syncing to Encircle" state instead of a silent 8s await; success → where? (owner Q below).
- **Open owner Qs:** after creating a job in the field, land on the new job hub or schedule an
  appointment immediately (chained flow)? Should quick-add customer stay inside the job flow only?

### 4b. Standalone customer creation
- **Today:** `/tech/new-customer` — role pills (homeowner/tenant/adjuster/other), name+phone
  required, conditional company/billing-address, notes; duplicate-phone graceful redirect;
  navigates to the DESKTOP customer page (`/customers/<id>`) — a tech dead-ends outside the shell.
- **Design targets:** stay inside `/tech/*` after save (owner Q: does a tech customer page exist in
  scope, or land back where they came from with a toast?).

### 4c. Appointment + event creation / edit
- **Today:** `/tech/new-appointment` (job search → date → time selects 7:00–22:30 with +1h
  auto-advance → type pills → collapsible crew picker, self preselected as lead → collapsible task
  multi-select grouped by phase + inline add-task → notes → private flag) · `/tech/new-event`
  (title/date/time/crew/notes, no job) · `/tech/appointment/:id/edit` (same + collision info +
  task toggles + two-tap delete).
- **Known code smells to design AROUND (build session fixes them):** crew edits are destructive
  delete-all-reinsert; `is_private` is a split second write; the auto-title from phases has no
  user override.
- **Design targets:** the date/time picker in B (the standard has the sheet-picker pattern — this
  is its proving flow); crew picker as a B component (avatar chips?); task selection reconciled
  with the hub checklist idiom; collision feedback designed (today it only loads the day's list).
- **Open owner Qs:** should techs create appointments at all, or is this dispatcher-led with tech
  self-scheduling as the exception? Auto-title: keep, or editable-with-suggestion?

### 4d. Clock lifecycle (the app's heartbeat — interaction spec, mostly designed)
- **Today (pack survey §dash):** OMW → Start → Pause/Resume → Finish, `clock_appointment_action`,
  supersede sheet when another job runs (`ClockSupersedeSheet`), geo away-banner (200m), after-5pm
  banner, continuous-from-OMW timer, travel/on-site split.
- **Design targets:** the full state-walk as ONE steppable prototype (arriving → working → paused →
  wrapping → done) including supersede + the two banners in B; haptics + motion per the map; the
  two-tap arming rhythm everywhere terminal.
- **Open owner Q:** the "ripened Finish" (quiet-until-tasks-done) is canonized in the standard from
  the Flow challenger — confirm it applies on the hub when tasks remain, or Finish always-black.

### 4e. Snap-first photo capture
- **Today:** capture → instant upload (offline queue where wired) → dismissable "Photo saved · Add
  note" toast → optional note/room tag sheet. LAW: never a blocking step between camera and save.
- **Design targets:** the capture loop prototype (dock Photo → camera → toast → optional note
  sheet → album update), the uploading/queued/failed states in B (offline pill choreography),
  burst capture affordance (owner Q: needed?).

### 4f. Task interactions
- **Today:** check/uncheck via `toggle_appointment_task`, optimistic patch-in-place.
- **Design targets:** check pop + Done-collapse behavior (what happens the moment the last open
  task completes — the checklist collapses? Finish ripens? both?) as a micro-prototype.

### 4g. Hydro entry flows (the module is designed; its WRITES are not)
- **Add reading** (the docked pill): multi-field numeric entry (Temp/RH/GPP auto-calc?, per
  room/affected/control/HVAC) — numeric keypad UX, big targets, one-hand reach.
- **Place / pull equipment:** counts × type (air_mover/lgr/xlgr/scrubber/neg_air per the OOP
  vocabulary), chamber assignment, pull-confirmation vs wet-material warning (the office-note
  pattern exists — design the tech-side moment).
- **Chambers/rooms management:** create chamber, assign rooms, set tolerances (or is that
  office-only? owner Q).

### 4h. Messaging, Claims, Schedule, More (reskin-scope flows)
- Messages pane: shipped + owner-baked — **reskin only**, consent seams frozen; conversation UX
  unchanged.
- Claims list/detail, Schedule month/day, Tasks, More: derive from the system (§5); their only
  flow design = search/filter idiom + day-switch (instant tier) + list→detail push (VT directional).

## 5. Screen coverage map

- **Bespoke design needed (flows session):** TechNewJob sequence · TechNewCustomer · New/Edit
  Appointment + New Event · the clock state-walk (hub states beyond "working") · Add-reading +
  equipment sheets · TechSchedule (month/day in B — the one big UNDESIGNED read surface) ·
  TechClaims list+detail · TechTasks · Messages pane reskin · TechMore/Help/Feedback (light).
- **Derive-from-system (no bespoke mockup; standard §8.4 rule):** room detail/albums, docs viewers,
  OOP pricing + demo sheet (tool pages; explicitly later — owner-flagged surfaces), settings rows,
  empty/error/skeleton variants (already spec'd).

## 6. Prototype requirements (the new bit vs. session 1)

Flows are judged by FEEL of sequence, so static screens are not enough:
- Each flow ships as a **steppable artifact**: the real screens wired with a minimal state machine
  (taps advance states; a small "state" pill for jumping) — same artifact laws (self-contained,
  fonts embedded from the mockups' base64, both themes, no emoji, reduced-motion, pinned chrome).
- Keep the sample-day continuity (Marcus, Gary Sorensen #26-1173, 11:20 AM) so every prototype
  feels like the same living app.
- Every prototype passes: persona critic (glove/sunlight/one-hand walk of EVERY step incl. error +
  interruption paths) + craft/consistency critic (token identity vs the screens of record) +
  mechanical QA + orchestrator Chromium review → owner reaction gate.

## 7. Dispatch block (paste to start the flows session)

> **Dedicated UX-flows session — UPR field-tech PWA redesign (design only, session 2 of 3). ultracode.**
> Read, in order: `docs/tech-redesign/UX-FLOWS-BRIEF.md` (this file — the taste ledger and flow
> inventory are binding), `docs/tech-redesign/TECH-DESIGN-STANDARD.md`, the six specs in
> `docs/tech-redesign/specs/`, and the three mockups in `docs/tech-redesign/mockups/` (clone their
> tokens/defs verbatim). Direction B is LOCKED — no visual relitigation; the hub's structure is
> settled. Scope: the flow inventory (§4) + bespoke screens (§5), as steppable prototype artifacts
> built by builder→critics→QA pipelines, rendered-reviewed in Chromium, then locked by MY reactions
> — ask me the §4 open questions FIRST (propose defaults), then build the first flow (the + New Job
> sequence) and the Schedule screen in parallel. Update the same artifact URLs where a screen
> already exists (`url` param). Commit deliverables to a session branch off `dev`; fold locked flow
> specs into TECH-DESIGN-STANDARD.md as amendments. No app code.

## 8. After flows lock (session 3: the build)

Run `/masterplan tech-redesign-build`: foundation session (tokens/primitives/flag/ownership
manifest) → parallel wave, one screen/flow per cold session, `TECH-DESIGN-STANDARD.md` + the
prototypes as acceptance, reviewer gauntlet + `review-animations` as gates, `page:tech_v3`-style
flag owner-only until the bake. The §4 "code smells" (crew re-sync, is_private split write,
auto-title) become build-session fix items with tests.
