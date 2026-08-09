# Job Hub Wave 2 — remaining work

**Created:** 2026-08-08 · **Status:** planning only; nothing below is authorized to build yet
**Predecessor:** `docs/tech-v2-roadmap.md` (Phase M1/M2/H3 — still the history; this file supersedes
its M2 checklist, which predates the owner's 2026-08-07 artifact review)
**Visual spec:** the owner-approved artifact — see the `job-hub-wave2-spec` memory for the rulings
behind it (why Call was removed, why the red circle is the confirm, why work-auth is not in More).

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

### UNKNOWN — needs an owner answer before the phase it blocks

- **What "Activity" means** in the five-row list: the photos+notes zone, or a true event feed. Blocks H2-b's fifth row only.
- **Whether a Customer page is a new tech screen or a re-skin** of the office `CustomerPage` (`/customers/:contactId`). Blocks H2-d.

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

## H2-d — Customer page *(blocked on an owner decision)*

The hero pill exists and has an interim destination, so this is an upgrade, not a gap in the flow.

Two options, and the answer changes the size by an order of magnitude:

- **Re-skin the office `CustomerPage`** for the tech shell — cheaper, but that page is built for a
  desk and would need real work to meet `tech-mobile-ux.md` (48px targets, no modals, resume-safe).
- **A new tech customer screen** — more work, but the field surface stays coherent.

**Do not start until the owner picks.** When it ships, re-point the Customer pill from the
scroll-to-contacts interim to the route; the pill's contract does not otherwise change.

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

Simulator recipe, since the Claude panel cannot stream on this Mac:
`xcrun simctl openurl <udid> "com.utahprosrestoration.upr://app/tech/job/<jobId>?appt=<apptId>"`
then `xcrun simctl io <udid> screenshot`. Build with **`-configuration Dev`** and verify the bundle
id ends in `.dev` before installing.

## Not in scope

Field Pro's own visual language (owner ruling: that arrives with the eventual native rewrite, app-wide);
widening `page:tech_job_hub` beyond its single dev user; deleting the legacy pages; any migration
apply, deploy, or TestFlight dispatch.
