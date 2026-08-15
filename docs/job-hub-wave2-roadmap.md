# Job Hub Wave 2 — remaining work

**Created:** 2026-08-08 · **Status:** planning only; nothing below is authorized to build yet
**Predecessor:** `docs/tech-v2-roadmap.md` (Phase M1/M2/H3 — still the history; this file supersedes
its M2 checklist, which predates the owner's 2026-08-07 artifact review)
**Visual spec — IN THIS REPO:**
[`docs/tech-redesign/prototypes/job-hub-wave2-approved.html`](tech-redesign/prototypes/job-hub-wave2-approved.html).
Open it in a browser; it is self-contained and shows both hero modes side by side. It is the artifact
the owner approved on 2026-08-07, committed here on 2026-08-09 **because it previously existed only
in a `/private/tmp` scratchpad (since wiped) and a claude.ai URL — neither reachable from a cloud
session or a fresh clone.** Do not confuse it with the older
`prototypes/job-hub.html`, which is the Field Pro prototype and a different design.

### The rulings behind that artifact — they are not visible in the pixels

- **No ticking clock.** Owner: *"no need for a big clock scaring the technicians about time
  ticking."* Durations sit under each station, minutes until 60 then `2h 8m`.
- **The three circles ARE the control** — active = accent, **armed = red** (that red first tap IS the
  confirm, so there is no separate confirm pill), done = grey. No green checkmarks.
- **Call is removed** from the action bar: there is no dialer in this app and won't be for a while.
- **Photo is removed** from the spec's bar because capture belongs in rooms/notes/daily logs —
  but see H2-b: that is not true yet, which is why the capture bar still exists.
- **Docs = nouns, More = verbs.** Every customer-facing document is generated from the Docs page;
  More holds on-site actions. **Work authorization is deliberately NOT in More** — splitting it from
  its five siblings would teach two mental models for one task.
- **Office note is its own card UNDER the crew** (tried above the clock first; rejected).
- **Hero identity (owner-directed 2026-08-08, later than the artifact):** the big white line is
  ALWAYS the client's name, and the line beneath is `job# · type · date of loss`. The artifact still
  shows the visit title as the headline — **the repo is correct and the artifact is stale on this one
  point.** Everything else in the artifact stands.

---

## Where this stands

Wave 1 shipped the adaptive-hero Job Hub. Wave 2 slice A shipped on `dev` across five commits
(`18058697`, `6c505759`, `80512d3c`, `8378b0af`/`b0402e80`, `e4315e35`): the ticking clock retired,
`Message · Docs · Notes · More`, the dock reduced to capture, the legacy-job redirect, and the hero
rebuilt so the client's name leads with `job# · type · date of loss` beneath.

Everything below is what is left.

---

## Evidence ledger

Built from the repository on 2026-08-08, not from memory. **Three entries correct claims made
earlier in the wave — read them before planning around the old assumption.**

| # | Capability | State | Evidence |
|---|---|---|---|
| 1 | Docs page **and** document generation | **HAVE (function) / PARTIAL (affordance)** | `TechJobDocuments` has a fixed bottom button opening `EsignRequestSheet`, which carries its own picker (`setDocType`) over **8** document types — `work_auth`, `coc`, and 6 situational. ⚠️ **Correction:** the wave-2 spec listed "Docs page + its `+` FAB" as unbuilt. The *machinery* is built and offers more types than the spec's six. But challenged: the button reads **"Request signature"** with a pencil, a full-width bottom bar — not a `+` that says "generate a document". Narrower framing than the spec intends, and a tech wanting a Certificate of Completion may not read "Request signature" as the way to get one. **Decide: relabel, or accept.** Do not treat this row as simply done. |
| 2 | Notes | **HAVE (as a section)** | `PhotosNotes` owns add-note; the action bar's Notes scrolls to it. ⚠️ **Correction:** "Notes page" was on the missing list; notes are an on-page section and a page may not be wanted. |
| 3 | Rooms | **HAVE** | `TechRoomDetail` route + `get_job_rooms` already feeding the hub. |
| 4 | Task counts for the summary line | **HAVE** | `appt.task_total` / `task_completed` on every appointment row (`JobStage.jsx:52`). No new fetch needed. |
| 5 | Photo count for the summary line | **PARTIAL** | `PhotosNotes` fetches `job_documents` job-wide but never lifts a count; "N photos **today**" needs a derived per-day figure. |
| 6 | Below-fold destinations | **PARTIAL** | All five exist as components (moisture in `HubTools`, `HubChecklist`, rooms, the visits switcher, `PhotosNotes`) — as a long stack, not the spec's five-row list. This phase is **re-housing, not building**. |
| 7 | Clock connector rail | **MISSING** | `TimeTracker` renders a bare `grid-template-columns: 1fr 1fr 1fr`; the artifact draws a rail between the circles. |
| 8 | Customer page | **MISSING** | No tech route. Currently mitigated: the hero's Customer pill opens and scrolls to the Job & Claim card (name, one-tap call, email). |
| 9 | Daily logs | **MISSING** | Zero matches for `daily_log` / `drying_log` across `src/`, `functions/`, `supabase/migrations/`. Genuinely unbuilt, and the only item here needing schema. |
| 10 | **Appointment-link parity** | **MISSING** | `/tech/appointment/:id` has **no** redirect guard (`App.jsx:361`), while `/tech/jobs/:id` now has one. |

### ~~UNKNOWN — needs an owner answer~~ → **ANSWERED 2026-08-15, in conversation**

Both blocks are lifted. Execution plan carrying the file-level design for every phase below:
[`docs/handoff/job-hub-wave2-and-customer-page-plan-2026-08-15.md`](handoff/job-hub-wave2-and-customer-page-plan-2026-08-15.md).

- **"Activity" means a REAL EVENT FEED** — not the photos+notes zone. It therefore does **not** ship
  in this wave: H2-b ships **four** rows (`Dry Logs · Tasks · Rooms · Visits`) and the feed becomes
  its own follow-up slice (candidate data sources scoped in the plan — `system_events` is the
  spine).
- **The Customer page is a NEW tech screen**, not a re-skin of the office `CustomerPage`. H2-d is
  unblocked and designed; **no migration is needed** — every read and write rides existing grants.
- **Techs edit everything** on it: contact info, insurance fields, and additional contacts
  (add/edit/remove). Additional-contact editing is net-new product-wide.
- **New owner requirement, same conversation:** reconstruction jobs must stop showing
  mitigation-only UI. In scope here: hide the Dry Logs row, the More-sheet reading row and the
  water-loss report for `division === 'reconstruction'`. A reconstruction-specific Hub is a **later
  wave**, deliberately not designed.
- **Release posture: bake first** — land the phases, PR into `dev`, owner merges and bakes on their
  phone; `dev → main` and the flag widening follow as separate owner actions. Note the widening is a
  flag **set** (`page:tech_job_hub` + `page:tech_moisture` + `page:tech_equipment` +
  `page:tech_rooms` + `page:water_loss_report`) — widening the Hub alone ships a Hub with no
  moisture or equipment sections.

---

## H2-a — Appointment-link parity *(do this first; it is the reported bug, mirrored)*

**Why first.** The owner reported landing on a legacy job page that "still has the call button."
That was `/tech/jobs/:id`, now redirected. **The identical defect is still live for appointments**
and reaches further:

- `techShellRoutes.js:67` records that **`notify.js` stored `/tech/appointment/<id>` directly for
  months** — so historical push notifications deep-link straight to the legacy page;
- `TimeTracker.jsx:411` navigates there — a control rendered **inside the Hub itself**;
- `StalledWidget.jsx:120` likewise.

A tech tapping a months-old push lands on the screen this wave exists to replace.

**Shape.** Mirror `LegacyJobRedirect`: a guard on `/tech/appointment/:id` that, for a viewer with the
flag, resolves the appointment's `job_id` and replaces to `/tech/job/:jobId?appt=:id`. It must read
`isHubNav()` — never re-derive the flag — for the same reason the job guard does.

**The one real difference from the job guard:** the appointment route knows only an appointment id,
so the redirect needs a `job_id` lookup, which is async. Plan for the three states (resolving,
resolved, appointment-has-no-job) rather than assuming a synchronous swap; a private appointment with
no job must keep rendering the legacy page, not error.

**Owned:** `src/App.jsx` (one route), a new guard beside `LegacyJobRedirect`, its contract test, and
the three hardcoded callers. **Frozen:** `nav.js` (`apptHref` already correct).

**Done when:** a `/tech/appointment/:id` deep link lands on the Hub for a flag holder; a job-less
appointment still renders the legacy page; the contract test scans for new hardcoded
`/tech/appointment/${…}` callers the way the job test now does.

---

## H2-b — The below-fold becomes the five-row section list *(the substance of wave 2)*

**Why.** This is the owner's original complaint. Wave 1 put a new head on the old body; the head is
now right and the body is still the legacy stack — visits switcher, Job & Claim, PhotosNotes,
Generate report. The spec replaces it with `Dry Logs · Tasks · Rooms · Visits · Activity`.

**Shape.** Five collapsible rows that **re-house the existing components** (ledger #6). This is not a
rewrite: `HubChecklist`, the moisture/equipment block in `HubTools`, the visits switcher and
`PhotosNotes` keep their internals and move inside a section shell.

**Sequencing note that matters:** `HubTools` currently mixes moisture, equipment and rooms in one
block, and the More sheet's "Take a reading" scrolls to it. Splitting "Dry Logs" out of `HubTools`
changes that scroll target — the two must move together or the More sheet lands nowhere.

**Owned:** `src/pages/tech/v2/hub/**`, `job-hub.css`, `NATIVE_PAGE_ALLOWLIST` (new files must be
added, sorted — `build:native` refuses otherwise, as it did for `HubMoreSheet`).
**Frozen:** the clock card, the hero, the action bar — all settled in slice A.

**Blocked on:** the "Activity" UNKNOWN above.

**Done when:** the five rows replace the stack with no functionality lost; every existing entry point
(More → Take a reading, action bar → Notes, hero → Customer) still lands on something real;
screenshotted in both hero modes.

---

## H2-c — The two remaining artifact gaps

Both were named honestly in `e4315e35` as not-done; neither is load-bearing, and either can be cut.

1. **Connector rail** between the three clock circles. A `TimeTracker` change, so it also improves
   the legacy appointment page — additive and low risk. CSS on the existing grid; no logic.
2. **`N of M tasks · N photos today`** under the stations. Tasks are free (ledger #4); photos need a
   per-day count derived from the `job_documents` fetch `PhotosNotes` already makes (ledger #5) —
   lift the count rather than adding a second query.

**Owned:** `src/components/tech/TimeTracker.jsx`, `HubStage.jsx`, `PhotosNotes.jsx`.
**Watch:** `TimeTracker` is shared by three consumers. Keep the additions optional props, the way
`windowLabel` / `onEdit` / `onJobLiveLabel` were, so the legacy page is unaffected unless it opts in.

---

## H2-d — Customer page *(UNBLOCKED 2026-08-15 — owner picked; designed)*

The hero pill exists and has an interim destination, so this is an upgrade, not a gap in the flow.

**Owner decision: a NEW tech customer screen** (not the office re-skin), with **full field editing**
of contact info, insurance fields and additional contacts. Route `/tech/customer/:contactId?job=`,
inline editing (no modals), and **no migration** — the write paths were verified against the live
policy migrations and every one is already granted to authenticated internal employees.

It also fixes a recorded live dead-end unrelated to the Hub: `TechNewCustomer` navigates to the
office `/customers/:id` after save, which on native bounces the tech to `/tech` and on web ejects
them out of the tech shell.

Full design — components, data model, permission verdicts per table, entry-point wiring, tests:
[`docs/handoff/job-hub-wave2-and-customer-page-plan-2026-08-15.md`](handoff/job-hub-wave2-and-customer-page-plan-2026-08-15.md).
When it ships, re-point the Customer pill from the scroll-to-contacts interim to the route; the
pill's contract does not otherwise change.

---

## H2-e — Daily logs *(largest; needs schema; owner-gated)*

The only remaining item that is genuinely unbuilt (ledger #9) and the only one touching the database.

It is referenced in three places already — the More sheet deliberately omits a "Daily log" row rather
than shipping a dead one, the spec's More menu lists it, and the five-row list's "Dry Logs" row
implies it. Until it exists, those stay as they are.

**Route this through `/db-migration`, not `/new-feature`** — a new table, its RLS, and its grants are
the first decision, and `database-standard.md` §5b applies if any access predicate is involved.
**Not scoped here on purpose:** the schema question deserves its own plan, not a paragraph.

---

## Legacy page retirement *(after H2-a and H2-b bake)*

`docs/tech-v2-roadmap.md`'s M2 checklist calls for deleting `TechAppointment.jsx` and
`TechJobDetail.jsx` once baked. Both redirects must exist first (H2-a completes the pair), and the
flag is still `dev_only_user_id`-scoped to one employee — so **deletion is owner-gated on widening
the flag, not on these phases.** Do not delete while any tech still routes to them.

---

## Suggested order and why

```
H2-a  ──►  H2-b  ──►  H2-c
 │                       (H2-c is independent; slot it wherever it fits)
 └──► H2-d  (blocked: owner decision)
 └──► H2-e  (blocked: owner + schema plan)
```

H2-a first because it is a live defect the owner already felt, and it is small. H2-b next because it
is the actual wave-2 goal. H2-c is cosmetic and can ride along or be cut. H2-d and H2-e are both
blocked on decisions and should not start on assumption.

## Verification contract (every phase)

`npm run build` · `npm test` (three credential-free lanes) · `npx eslint <changed>` ·
**`npm run validate:lint-ratchet -- origin/dev`** — plain eslint exits 0 on warning-level findings
the ratchet fails, and touching a file makes its pre-existing debt yours ·
`npm run build:native` (refuses unlisted `src/pages/**` modules) · `npm run test:tooling` ·
screenshot on the simulator in **both** hero modes.

### If you are a CLOUD session (no Mac, no simulator) — read this

You can run every gate above **except the screenshot.** Xcode, `xcrun simctl` and the iOS build are
not available to you. That is a real limit, not a formality:

- **Say so explicitly** in your handoff. Do not write "verified" for anything visual. This wave
  already produced one incident where work was reported as delivered without anyone having seen it
  render, and a second where a stale simulator bundle made correct code look broken for a day.
- **What you CAN prove without a screen:** `npm run build:native` resolves the real module graph, so
  it catches an unlisted module. And a blank-screen defect is provable from `dist/app-assets/` —
  `grep -o 'from"\./[A-Za-z0-9_-]*\.js"' <Page>-*.js | sort -u` shows whether a page imported the
  real chunks or a denying shim. That is stronger than reading source, because it inspects what
  Rollup actually resolved. It is **not** a substitute for looking at the screen.
- **Leave the visual check as a named owner gate** in the PR body, with the exact deep link to open.

Simulator recipe for whoever has the Mac (the Claude sim panel cannot stream on it):
`xcrun simctl openurl <udid> "com.utahprosrestoration.upr://app/tech/job/<jobId>?appt=<apptId>"`
then `xcrun simctl io <udid> screenshot`. Build with **`-configuration Dev`** and verify the bundle
id ends in `.dev` before installing — `Debug` builds under the PRODUCTION bundle id and will
overwrite the real app. ⚠ Both apps register the same URL scheme, so `openurl` cannot choose between
them; confirm which app you actually drove before trusting a screenshot.

### Getting to production from here

`dev` auto-deploys to `dev.utahpros.app`. Production is a reviewed **`dev → main` PR** (AGENTS.md
Rule 4) — that is the only path, and merging it is the owner's click. Two things gate the Hub
reaching real technicians regardless of code state, and **neither is a code change**:

1. **`page:tech_job_hub` is still `enabled=false` with `dev_only_user_id` set to one employee.**
   Until the owner widens that flag, promoting to `main` ships the Hub to nobody. Flag flips are
   owner-gated.
2. **The legacy pages cannot be deleted until the flag is widened** — every tech without it still
   routes to them.

So "fully deliver to production" = land the phases, open the `dev → main` PR, and then the owner
widens the flag. An agent does not do the last step.

## Not in scope

Field Pro's own visual language (owner ruling: that arrives with the eventual native rewrite, app-wide);
widening `page:tech_job_hub` beyond its single dev user; deleting the legacy pages; any migration
apply, deploy, or TestFlight dispatch.
