# Job Hub wave 2 finish + Tech Customer Page — execution plan

**Created:** 2026-08-15 · **Status:** **EXECUTED 2026-08-15** on
`claude/job-hub-wave2-customer-page-ebcwix`, open as a draft PR into `dev`. Steps 1–8 of the
execution order are done; step 9 (publish) is done as a DRAFT — merging, promoting, applying,
deploying and flag-widening all remain owner actions. **H2-e and the Activity feed were not
started.**
· **Branch it was written on:** `claude/job-hub-release-blockers-vh7bpd`
**Reads with:** [`docs/job-hub-wave2-roadmap.md`](../job-hub-wave2-roadmap.md) (the wave plan and its
evidence ledger) and
[`docs/tech-redesign/prototypes/job-hub-wave2-approved.html`](../tech-redesign/prototypes/job-hub-wave2-approved.html)
(the owner-approved visual spec — open it in a browser; both hero modes are side by side).

This file exists because the session that produced it ran out of budget before building. It carries
**four owner decisions made in conversation on 2026-08-15** that unblock three phases, plus a
file-level design for each, so a cold session can execute without re-deriving any of it. The
roadmap remains the authority on *why* things are the way they are; this file is the *what next*.

---

## Where the work actually stands (verified 2026-08-15, not from memory)

Wave 1 shipped the adaptive-hero Job Hub. **Wave 2 slice A shipped to `dev` on 2026-08-07/08** —
the ticking clock retired, `Message · Docs · Notes · More`, the dock reduced to capture, the
legacy-job redirect, and the hero rebuilt so the client's name leads. Then work stopped, and the
reason was not the code: the owner-approved spec existed only in a wiped `/private/tmp` scratchpad
and a claude.ai URL. A 2026-08-14 session recovered it, committed it, and folded the memory-only
rulings into the roadmap (`75f5bb9e`, docs only). **No Job Hub production code has been written
since 2026-08-08.**

Three facts worth carrying, each of which changes a decision:

1. **`page:tech_job_hub` is `enabled=false` with `dev_only_user_id` = the owner.** One shared
   Supabase sits behind both domains, so dev and production behave identically: exactly one person
   reaches the Hub anywhere. Promoting to `main` ships it to nobody until the flag widens.
2. **The Hub's sub-surfaces have their own flags** — `page:tech_moisture`, `page:tech_equipment`,
   `page:tech_rooms`, `page:water_loss_report` — all currently off and owner-scoped. Widening
   `page:tech_job_hub` alone would ship techs a Hub with no moisture or equipment sections. **The
   release step is a flag *set*, not a flag.**
3. **The hub folder drifted under the camera/photos initiative** on 2026-08-13/14
   (`PhotosNotes.jsx`, `HubDock.jsx` were rewritten). Re-read those files before depending on
   them; one step below depends on `PhotosNotes`'s exact react-query key.

---

## Owner decisions — 2026-08-15, in conversation

| Question the roadmap left open | Decision |
|---|---|
| **H2-d customer page shape** (roadmap line 66: new tech screen or re-skin of the office `CustomerPage`?) | **A brand-new tech-shell screen.** Not a re-skin — the office page is desk-shaped (tile grid, tabs, Financial surfaces, modals) and would need heavy rework to meet `tech-mobile-ux.md` anyway. |
| **Who may edit customer data from the field** | **Techs edit everything** — contact info (name/phone/email/company), insurance fields (carrier, policy #, claim #), and add/edit/remove additional contacts. They are the ones standing in front of the customer. |
| **What "Activity" means** in the five-row list (roadmap line 65) | **A real event feed** — therefore it is *not* the photos+notes zone, and it does **not** ship in this wave. The section list ships **four rows**; Activity becomes its own follow-up slice (scoped at the bottom of this file). |
| **Release posture** | **Bake first.** Land the work, open a PR into `dev`, owner merges and bakes on their phone (the flag already targets them). `dev → main` promotion and flag widening follow as separately authorized owner actions. |

**One further owner requirement, new this session:** reconstruction jobs must stop being shown
mitigation-only UI. Today the Hub never branches on division, so a reconstruction job renders the
Moisture and Equipment blocks as permanent empty states with live "+ Add reading" buttons. The
cheap, honest step is in scope here (hide them); **a reconstruction-specific Hub is a later wave**
and is deliberately not designed in this file.

---

## Workstream A — finish Job Hub wave 2

### H2-a — appointment-link parity *(first; it is a live defect)*

`/tech/jobs/:jobId` redirects Job Hub users away from the legacy page; `/tech/appointment/:id`
does not — and it reaches further, because `notify.js` stored that path in push notifications for
months and `TimeTracker` navigates there from inside the Hub itself.

**New:** `src/components/tech/v2/LegacyAppointmentRedirect.jsx` (the guard, beside
`LegacyJobRedirect.jsx`), `src/components/tech/v2/legacyApptResolve.js` (two pure helpers —
`resolveApptRedirect(detail)` and `buildHubApptUrl(jobId, apptId, search)` — so the decision logic
is testable in the `node`-environment lanes), and their tests.

**Modified:** `src/App.jsx` — wrap the `tech/appointment/:id` route, **statically imported** (the
sibling contract test fails a lazy guard). Do **not** wrap `tech/appointment/:id/edit`; the Hub
links into it (`HubChecklist`, `HubStage`).

**Resolution mechanism — `db.rpc('get_appointment_detail')`, and the reasoning matters:**

- There is **no `CREATE POLICY` for `appointments`** anywhere in `supabase/migrations/`, so a direct
  table read by a field tech is not a proven-granted path. Do not invent one for a redirect
  (least-privilege posture, `AGENTS.md` §13).
- The RPC is `SECURITY DEFINER`, returns `job_id`, and is **the legacy page's own loader** — so
  anyone who can render the legacy page can call it, with byte-identical visibility.
- Its private-appointment filter is built in (returns NULL when hidden), so a private appointment
  degrades to the legacy page's own not-found handling rather than a new failure mode.
- The result is exactly the object the Hub's visit query wants: seed it with
  `queryClient.setQueryData([...techKeys.hub(jobId), 'visit', id], detail)` and the redirect costs
  **zero extra round trips**.

**Three render states** (the roadmap's stated requirement — the guard only knows an appointment id,
so resolution is async):

1. **flag off** → `return children` immediately; no fetch ever fires for a non-Hub user.
2. **resolving** → `SkeletonList` (the tech-v2 cold-start primitive). This is what prevents a
   legacy-page flash for flag holders.
3. **resolved** → `<Navigate replace>` to `/tech/job/:jobId` carrying `location.state` and the
   merged query string with `appt` pinned (the pin is what satisfies `resolveHero` rule 2).
4. **no job / private / RPC threw** → `return children`. A job-less private appointment must keep
   rendering the legacy page — a failed lookup degrades to the old page, never a dead end.

Read `isHubNav()` and **never re-derive the flag** — that is why a link and a redirect can never
disagree, and the contract test asserts it.

**Retarget the client-side hardcoded callers** through `apptHref`: `TimeTracker.jsx`
(`handleSupersedeGoToJob` — and `ClockSupersedeSheet.jsx` must pass `job_id` through; the precheck
row already carries it), `StalledWidget.jsx` (its row already has `job_id`), `techShellRoutes.js`
(no jobId available from an office path — `apptHref` without one returns the legacy URL by
contract, and the new guard finishes the job). **Leave the worker-side links**
(`functions/api/notify.js`, `functions/lib/notificationPresentation.js`) — those are H3 scope.

**Contract test** `tests/qa/unit/job-hub-legacy-appointment-redirect.test.js` mirrors the job test
clause-for-clause, and **widens the hardcoded-caller scan** from that test's fixed four-file list to
a recursive `src/**` walk for `` /`\/tech\/appointment\/\$\{[^}]+\}(?!\/edit)/ `` with a one-file
allowlist (`nav.js`, the sanctioned constructor). The `(?!\/edit)` lookahead keeps the Hub's
legitimate edit links legal.

### H2-b — the below-fold becomes the section list *(the substance of the wave)*

**Four rows, not five** (Activity is deferred per the owner decision above):
**Dry Logs · Tasks · Rooms · Visits**, then the non-artifact remainder in its existing
"reference before gallery" order.

**New:** `src/pages/tech/v2/hub/HubSection.jsx` (the collapsible shell) and
`src/pages/tech/v2/hub/HubSections.jsx` (the layout).
**Retired:** `HubBelowFold.jsx` — its `VisitRow` and upcoming/past split move into `HubSections.jsx`
verbatim. Keeping a file whose only job was ordering would leave two layout owners.

`HubSection` is a header button (**48px** — new primary controls get the floor) plus
`{open && children}`, reusing the existing `.tv2-hub-collapse__chev` rotation and the render-time
`openSignal` adjust idiom from `JobClaimSection`. Open/close is **instant** — high-frequency tier in
`motion-standard.md` §3, and height animation is banned by §5. Children with their own queries
simply do not mount while closed.

Row by row:

1. **Dry Logs** — wraps the existing `HubTools` (moisture + equipment internals unchanged). Carries
   the scroll ref and open signal. **Rendered only when `showsDryingTools(job.division)`.**
2. **Tasks** — appointment mode only (the artifact's job-mode screen has no Tasks card, and job
   mode already shows an open-task count on its stat card). Count comes from the hub frame row
   (`task_completed`/`task_total` — free, no new fetch). The "Edit list" link moves up into the
   section header via a new optional `embedded` prop on `HubChecklist` (default `false`, so nothing
   else changes).
3. **Rooms** — plain section, artifact `.sect` idiom (title left, count right). Shared `RoomCard`
   grid + an Add-room tile calling the page's existing `handleCreateRoom`. **Cover photos are
   derived from the docs cache already in memory — no new fetch.** Tiles navigate only when a claim
   exists (`TechRoomDetail` is claim-scoped); claim-less OOP jobs render display-only tiles, which
   is not a regression because the Hub shows no rooms grid today. Disclose it in the PR.
4. **Visits** — the switcher content moves verbatim.

Then: **Job & Claim** (kept — it is the Hub's only home for adjuster contact, carrier/policy/claim
numbers, admin-only deductible and A/R notes; its `openSignal` plumbing is removed once the pill
navigates), **Photos & Notes** (`notesRef` target unchanged), **Generate report**.

`HubStage`/`JobStage` shed their `HubChecklist`/`HubTools` blocks. Everything else in both stages is
frozen slice-A territory — clock band, crew, office note, breakdown, next-visit.

**Every entry point must still land somewhere real:**

| Entry point | After H2-b |
|---|---|
| More → "Take a reading" | retargets to the Dry Logs section (bump signal, then `requestAnimationFrame` scroll). **Must move in the same commit as the `HubTools` re-house** — this is the roadmap's sequencing trap; split them and the More sheet lands nowhere. |
| Action bar → Notes | unchanged; `notesRef` now wraps Photos & Notes inside `HubSections` |
| Hero → Customer (pill and name) | navigates to the new customer page (Workstream B). Pass `undefined` when there is no contact — the header already hides the pill on a falsy handler, so a contact-less job never gets a dead tap. |

**Division-awareness.** New pure helper `showsDryingTools(division)` in `hubHelpers.js`, written as
**hide-for-reconstruction**, not allowlist-the-mitigation-divisions. That is deliberate: the two
`MITIGATION_DIVS` constants in the repo disagree about `fire`, so an allowlist would silently change
fire jobs. Consumers: the Dry Logs row, `HubMoreSheet`'s take-reading row (its own header states the
law — a row that appears in one place and not the other is the bug), and `GenerateReportButton` via
a new **optional** `division` prop so the prop-less legacy caller is untouched.

**CSS / boundary:** new section-head class in `job-hub.css`; **delete the dead
`.tv2-hub-stubcontact` trio** (zero consumers — note `perf-budget.md` currently claims every
`tv2-hub-*` name is live, which is no longer true); add the file's **first
`prefers-reduced-motion` block** (a missing fallback is a hard review failure for touched work).
`NATIVE_PAGE_ALLOWLIST`: remove `HubBelowFold`, add `HubSection`/`HubSections`, sorted, **in the
same commit as the files** or `build:native` and `test:tooling` fail.

### H2-c — connector rail + stage-meta *(cosmetic; rides along)*

1. **Connector rail** between the three clock circles: an inline absolutely-positioned 2px divider
   as the station grid's first child, with each circle given `position:relative; z-index:1` so its
   opaque background covers the line — the spec's own technique. Inline DOM, so zero `index.css`
   budget cost. It is static (no animation, no reduced-motion obligation) and ships to all three
   `TimeTracker` consumers including the legacy page, which is what the roadmap intends.
2. **`N of M tasks · N photos today`** under the stations, via a new **optional** `stageMeta` prop
   (the established `windowLabel`/`onEdit`/`onJobLiveLabel` pattern — prop-less consumers
   unchanged). Tasks are free from the hub frame row. Photos-today uses a **byte-identical
   queryKey and queryFn to `PhotosNotes`'s docs query** so react-query dedupes to one request and
   one cache entry — **re-diff `PhotosNotes.jsx` against `origin/dev` immediately before writing
   this**, because the camera initiative rewrote that file on 2026-08-13/14 and a drifted key
   silently becomes a second fetch. Day bucketing uses the company timezone helper the Hub already
   uses.

### Docs affordance relabel *(roadmap evidence-ledger #1, decided here)*

The Docs page's pinned button reads **"Request signature"** with a pencil, which is a narrower
framing than the machinery — it generates 8 document types, and a tech hunting a Certificate of
Completion will not read "Request signature" as the way to get one. **Relabel to "New document"**
(button + sheet title, plus icon instead of pencil), with the empty state reading
`Tap "New document" to create one and send it for signature.` The sheet body still makes the
signature step explicit. These strings are hardcoded English today, so there is no locale work.

---

## Workstream B — the tech customer page (H2-d)

A **new tech-shell screen**, per the owner decision. **No migration is required** — every read and
write below rides grants that already exist in production, verified against the policy migrations.

**Route:** `/tech/customer/:contactId` with optional `?job=<jobId>`, reached through a new
`customerHref()` helper in `nav.js` (never a hardcoded path). Contact-scoped rather than job-scoped
because `TechNewCustomer`'s post-save has only a contact id — a job-scoped route would leave that
entry point still broken. Two modes:

- **Job mode** (`?job=`): customer info · insurance & claim · additional contacts. Reads
  `get_job_hub` under the **same react-query key the Hub uses**, so arriving from the Hub paints
  instantly with no new round trip.
- **Contact mode** (no `?job=`): customer info · contact-level insurance defaults. The
  additional-contacts section does not render — there is no job to link against. This is also the
  explicit no-claim state.

**Where the fields actually live** (this is the part worth not re-deriving): the insurance the field
shows is the **job's denormalized copy** (`jobs.insurance_company` / `policy_number` /
`claim_number`) — the same fields the office JobPage edits, and an existing trigger one-way syncs
carrier/date-of-loss to the claim. Contact-level `contacts.insurance_carrier` / `policy_number` are
the office CustomerPage's tile and serve contact mode. Claim numbers and policy numbers are **not**
synced between jobs and claims; that drift is pre-existing and the office accepts it. **Do not
invent a client-side double-write.** Additional contacts are `contact_jobs` rows
(`contact_id`, `job_id`, `role`, `is_primary`, unique on the triple) — today written **only** inside
job-creation RPCs, so client write paths are genuinely net-new.

**Permission verdicts — all permitted today, nothing ships read-only:** `contacts` update and
insert, `jobs` insurance update, `contact_jobs` insert/update/delete (the `anon_`-prefixed policy
names there are a rename vestige; the roles are `authenticated`). **Consent guardrail: never touch
`opt_in_*` / `dnd` / `opt_out_*` columns** — phone and email edits only, mirroring the office tile.

**Components** under `src/pages/tech/v2/customer/` (inside the field-surface invariant walk, so the
`sms:` ban covers it automatically): `TechCustomerPage.jsx` (query frame; skeleton → `ErrorState`
with retry → a **distinct** not-found `EmptyState`; `PullToRefresh` below a fixed 48px header;
silent refresh; no hand-rolled visibility listeners), `CustomerInfoSection.jsx` (rows with `tel:` /
`mailto:`, Message through `openInAppThread` — **never `sms:`**, and inline in-place editing, never
a modal), `InsuranceSection.jsx` (carrier suggestions from the existing RPC; date-of-loss,
type-of-loss, deductible and adjuster stay read-only; claim breadcrumb only when a claim exists),
`AdditionalContactsSection.jsx` (cards keyed by link id; expand-in-place to edit the person or the
link role; **Remove deletes the link, never the person**, behind an inline two-click confirm; the
`is_primary` link gets no Remove because the Hub hero and the conversation picker depend on it; Add
person offers link-existing via the contact-search RPC or new-person with duplicate-phone
auto-link), `customerHelpers.js`, and a route-lazy `customer-page.css` (`tv2-cust-*` prefix — zero
bytes against the blocking `index.css` gate).

`EditContactModal.jsx` is deliberately **not** adopted: it has zero consumers today and it is a
modal, which field surfaces ban.

**The native trap, stated because it has already cost this repo a day:** a page needs the route
*and* the lazy entry in **both** build-target registries *and* a sorted `NATIVE_PAGE_ALLOWLIST`
entry (co-located CSS included). A page in the registry without a route silently bounces to `/tech`
with a green build and a silent module-graph guard.

**Entry points wired:** the Hub hero pill and name (replacing the interim scroll);
`TechNewCustomer`'s post-save, **which is a recorded live dead-end today** — it navigates to the
office `/customers/:id`, which on native hits the catch-all and dumps the tech on `/tech`, and on
web ejects them out of the tech shell; a `/customers/:id → /tech/customer/:id` mapping in
`techShellRoutes` with the office route wrapped in `TechShellRedirect`; and a "View customer" row on
`TechClaimDetail`.

**Cache registry amendment** (that file is frozen with amendment history — follow the precedent):
add a `CUSTOMER` kind, `techKeys.customer(contactId)`, and `MUTATION_INVALIDATIONS.contact =
[CUSTOMER, HUB]`, because a contact or insurance edit must repaint an open Hub whose contacts and
hero title come from `get_job_hub`.

**i18n:** a new `customer` namespace in **all three** locales plus barrel registration — the parity
suite statically imports all three and fails if any language misses it. Never static-import the
`pt`/`es` barrels from app code.

---

## Execution order

> **As executed.** The order below was followed with one change worth recording: nothing else moved.
> Where the plan and the build disagreed, the build is noted inline in
> [`../job-hub-wave2-roadmap.md`](../job-hub-wave2-roadmap.md), which is the reconciled record.
>
> **What the plan got wrong, found by building it:** the recursive hardcoded-caller scan was
> specified with a **one-file allowlist** (`nav.js`). In practice three more files legitimately name
> that path — the two legacy pages (which no Hub viewer can render, and which H3 deletes) and
> `nav.test.js`. The scan ships with those documented rather than with the files rewritten, because
> rewiring a page scheduled for deletion is churn. `ClaimPage`'s field-side rows were NOT on the
> plan's caller list and were retargeted anyway: `get_claim_appointments` already returns `job_id`,
> so it was a one-line fix to a live route into the legacy page.
>
> **A blocker the plan could not have known about:** `npm run build:native` was already RED on
> `origin/dev` — `composerAttachmentStore.js` (merged in `9dcf18fd`) was never added to
> `NATIVE_PAGE_ALLOWLIST`. That gate is a prerequisite for this work, so it was repaired in its own
> commit (`88838a9c`) ahead of everything else.

The two workstreams share exactly one seam — the hero Customer pill — so the customer page lands
before the Hub re-house retargets it. Nothing dangles at any commit.

1. **Setup** — `git fetch origin`; merge current `origin/dev`; `npm run wip:open -- --next "…"`;
   re-read every file before editing.
2. **H2-a** — guard + helpers + route → tests → `TimeTracker` + `ClockSupersedeSheet` →
   `StalledWidget` + `techShellRoutes`. → gates
3. **Customer page** — the page, registries, allowlist, cache amendment, nav helper, i18n, CSS,
   tests → then the `TechNewCustomer` dead-end fix + `officeToTechPath` + `TechShellRedirect`.
   → gates
4. **H2-b** — helpers → `HubSection` + CSS + allowlist → `HubSections` swap and retire
   `HubBelowFold` → **the atomic move** (Dry Logs + Tasks into sections, stages shed their blocks,
   More-sheet retarget, division gate) → Customer-pill navigation → i18n → render tests. → gates
5. **Division rider** — `GenerateReportButton` division prop + render test.
6. **H2-c** — rail → stage-meta (deduped docs query) → i18n. → gates
7. **Riders** — docs relabel; `TechClaimDetail` "View customer" row.
8. **Close-out** — update `UPR-Web-Context.md`; reconcile this file and the roadmap **both
   directions**; changelog entry; close-out gauntlet reviewers; record bundle-size deltas.
9. **Publish** — push, open a **draft PR into `dev`** with the verification summary and every owner
   gate named. Do not merge it.

**Gate battery, after each block:** `npm run build` · `npm test` (three credential-free lanes) ·
`npx eslint <changed>` · **`npm run validate:lint-ratchet -- origin/dev`** · `npm run build:native` ·
`npm run test:tooling`.

Two traps that have each cost a session here: plain `npx eslint` exits 0 on warning-level findings
the **ratchet** fails, and touching a file makes its pre-existing debt yours; and `build:native`
refuses any new `src/pages/**` module missing from the sorted allowlist.

**New test files:** `legacyApptResolve.test.js`, `job-hub-legacy-appointment-redirect.test.js`,
`HubSections.render.test.jsx` (the **first** render coverage in the hub folder),
`GenerateReportButton.render.test.jsx`, `hubHelpers.test.js` extensions,
`customerHelpers.test.js`, `TechCustomerPage.render.test.jsx`, `tech-customer-route.test.js`.
Note the render tests run in the `node` environment: they prove structure and gating, **not
interaction** — say so in their headers and leave tap-through to the device gate.

---

## Getting this to production

`dev` auto-deploys to `dev.utahpros.app`; production is a reviewed `dev → main` PR, and **merging it
is the owner's click**. Bake-first, as decided:

1. Land the phases → draft PR into `dev` → owner merges.
2. **Owner bake** on their phone — the flag already targets them. This is the written gate that also
   unblocks H3.
3. On sign-off: the `dev → main` promotion PR (owner merges), plus a fresh TestFlight build from
   `main` for native users (`ios-release.yml` refuses any other ref).
4. **Flag widening — as a set, not a single flip:** `page:tech_job_hub` together with
   `page:tech_moisture`, `page:tech_equipment`, `page:tech_rooms` and `page:water_loss_report`.
   Widening the Hub alone ships a Hub with no moisture or equipment sections. One shared Supabase,
   so the flip hits both domains at once. Owner action, always.
5. **After the bake period:** the H3 cutover session — appointment resolver + JoblessVisit fallback,
   legacy page deletion, orphaned i18n cleanup. Outside this plan, and it unblocks the DB-foundation
   P8 signed-URL work that is hard-gated on it.

**A cloud session cannot screenshot.** No Mac, no Xcode, no simulator. Nothing visual may be
reported as "verified" — this wave already produced one incident of work reported delivered that
nobody had seen render. What *is* provable without a screen: `build:native` resolves the real module
graph, and `dist/app-assets/` chunk-import grepping shows whether a page resolved real chunks or a
denying shim. Leave the visual check as a named owner gate in the PR body with the exact deep link.

---

## Deliberately deferred — named, not dropped

- **Activity event feed** (the fifth row). Candidate spine: `system_events` already carries
  `job_id`, `event_type` and an indexed timestamp, and receives clock actions today;
  `invoice_activity` covers the spec's own example row ("Invoice #INV-2042 sent"); `sign_requests`,
  `job_documents`, equipment placements and readings are unionable. The proven UI shape is the CRM
  `ActivityTimeline` fed by a per-entity merged-timeline RPC, so the follow-up is a
  `get_job_activity(p_job_id)` union RPC — route it through `/db-migration` for grants — plus a
  fifth `HubSection` row.
- **H2-e daily logs** — genuinely unbuilt, the only item needing schema; roadmap routes it through
  `/db-migration`, unchanged.
- **A reconstruction-specific Hub** — this plan only stops mitigation-only UI appearing on
  reconstruction jobs. What a reconstruction visit should actually show (phases, sub-trades,
  material selections, punch list) is an owner conversation and its own wave.
- **H3 cutover** — gated on the written bake sign-off.
- **Backfilling render tests** for the rest of the hub folder — new work ships with tests; the
  historical gap is not closed here.

## Risks to carry

- **Lint-ratchet debt adoption** — touching `TimeTracker.jsx`, `StalledWidget.jsx` and
  `TechJobDocuments.jsx` makes their pre-existing warning debt yours. Budget time to clean it, not
  to baseline it.
- **Camera-initiative drift** — re-diff `PhotosNotes.jsx` and `HubDock.jsx` before depending on
  them, specifically before the H2-c dedupe.
- **Default-open deviation from the artifact** — the artifact draws Tasks collapsed and Dry Logs as
  a compact summary card, but that card's data (drying day, wet/dry counts) does not exist until
  H2-e, and collapsing the moisture log hides live stalled badges. This plan defaults both rows
  **open in appointment mode**, closed in job mode. That is a judgment call against the pixels —
  put it in the PR body as an explicit owner-checkable line rather than burying it.
- **Shared-contact edits are global** — editing an adjuster's phone from one job edits them
  everywhere. Same semantics as the office page; surface a hint on shared roles rather than
  inventing per-job overrides.
