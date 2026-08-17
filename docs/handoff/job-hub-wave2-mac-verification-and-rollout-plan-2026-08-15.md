# Job Hub wave 2 + tech customer page — Mac verification & rollout plan

> ## EXECUTED 2026-08-15 — phases 0–2 complete on the owner's Mac
>
> **Phase 0 — green, and it corrected the cloud report in our favour.** `npm ci` (lockfile
> unchanged) · `build` clean · `build:native` clean · **`npm test` 6,388/6,388** (unit 1,897 ·
> worker 2,431 · qa 2,060) · lint ratchet **0 regressions** across 46 changed files ·
> `test:tooling` 46/46. **Both "known container artifact" failures PASS on the Mac** —
> `ios-release-workflow.test.js` (48 tests) and `capgo-dev-workflow.test.js` (12 tests) — so the
> cloud session's diagnosis of them was right and there is no new information there.
>
> **Phase 1 — the screens have now been seen.** Rendered in a browser at 375px and 390px, signed
> in, against the real shared database. What the checklist found is in "Verification results"
> below. Ledger rows #8 and #9 are answered; #9 is answered with measurements, not an opinion.
>
> **A blocker worth recording, because it will hit the next session too:** the five wave flags are
> `dev_only_user_id`-scoped to employee `d1d37f3c` (**Moroni Salvador, admin**), but the only
> account reachable without a human typing credentials — the `.env.local` dev-login button — is
> `moroni.s@utah-pros.com`, which resolves to employee `dd188c16` (**"Moroni Tech", field_tech**).
> Different employee, so `resolveFeatureFlagAccess` refuses and the Hub bounces to `/tech`. The
> pass was done behind two **local-only, uncommitted** overrides (the flag predicate, and
> `isOnCrew` so the clock card would render without writing an `appointment_crew` row to
> production). **Both were reverted; the tree was verified clean at `edfa3f7f` before any commit.**
> Verifying as a field_tech is arguably the more faithful reading of a field surface anyway.
>
> **Phase 2 — decisions applied.** D1 changed code; D2/D3 changed no code; D4 was executed and
> reverted. See "Owner decisions — ANSWERED" below.
>
> **Not done here:** the native/simulator pass (`build:ios:dev` + `cap sync ios` both succeeded, but
> the app was not run in Xcode), and phases 3–5, which stay owner actions.

**Created:** 2026-08-15 · **Status:** phases 0–2 EXECUTED; phases 3–5 prepared, owner-gated
**For:** a LOCAL session on the owner's Mac (Xcode + iOS simulator + physical device)
**Subject:** draft PR [#669](https://github.com/moronisalvador/Utah-Pros-App-Git/pull/669),
branch `claude/job-hub-wave2-customer-page-ebcwix`, CI green on `d1105f34`, unmerged

**Reads with:** [`job-hub-wave2-and-customer-page-plan-2026-08-15.md`](job-hub-wave2-and-customer-page-plan-2026-08-15.md)
(what was built and why) · [`../job-hub-wave2-roadmap.md`](../job-hub-wave2-roadmap.md) (the wave
plan and its reconciled evidence ledger) ·
[`../tech-redesign/prototypes/job-hub-wave2-approved.html`](../tech-redesign/prototypes/job-hub-wave2-approved.html)
(the owner-approved visual spec).

---

## Why this file exists

The session that built wave 2 ran in the cloud: no Mac, no Xcode, no simulator. It could not render
a single pixel of ~4,500 lines of new interface. Every gate it *could* run is green — build,
`build:native`, three test lanes, the lint ratchet, tooling, and CI — and none of that is evidence
that the screens look right or work under a thumb.

This plan closes that gap and then drives to production. **Its centre of gravity is not the code; it
is the verification and the rollout order.**

---

## Evidence ledger

Built from the repository on 2026-08-15, not from memory. Every claim below names what proves it.

| # | Claim | State | Evidence |
|---|---|---|---|
| 1 | The wave's code is complete and merges cleanly | **HAVE** | PR #669: `mergeable_state: clean`, 7 commits, 67 files, base `dev`, `verify` + `db-lane` + Cloudflare Pages all ✅ on `d1105f34` |
| 2 | No migration is needed | **HAVE** | `contacts_authenticated_update/insert`, `contact_jobs` `authenticated` INSERT/UPDATE/DELETE/SELECT, `link_contact_to_job` granted to `authenticated`. `tech-customer-route.test.js` pins the write set to exactly `contacts`, `jobs`, `contact_jobs` |
| 3 | Consent columns are unwritable from the customer page | **HAVE** | `buildContactPatch` strips `CONSENT_COLUMNS` and cannot be widened past it; two contract tests; confirmed in the built bundle, where those names survive only inside the strip list |
| 4 | A **physical device** test is available WITHOUT touching `main` | **HAVE** | `npm run build:ios:dev` → `Dev` configuration → bundle `com.utahprosrestoration.upr.dev`, origin `dev.utahpros.app`, development APNs, "Xcode run to device" (`docs/mobile/dev-app-variant.md`) |
| 5 | An internal TestFlight build is available from `dev` | **HAVE** | `ios-dev-testflight.yml` — `workflow_dispatch`, `publish_to_testflight` input, group `UPR Dev`, and it **refuses any ref but `refs/heads/dev`** |
| 6 | The official app is `main`-only | **HAVE** | `ios-release.yml` — `if [[ "$GITHUB_REF" != "refs/heads/main" ]]` → hard fail |
| 7 | A test job exists to exercise the customer page against | **PARTIAL** | `W-2606-025` is recorded as `is_real_job = false` with deliberate test artifacts (`initiative-status.md`). **Its contact set is unverified** — see the test-data section |
| 8 | The screens render correctly | **UNKNOWN** | Nothing has been seen. This is the whole point of the plan |
| 9 | The connector rail aligns with the clock circles | **UNKNOWN** | Arithmetic against the station's padding + circle size; never measured on a screen |
| 10 | The next OFFICIAL iOS release clears the associated-domains gate | **MISSING** | `initiative-status.md`: entitlements narrowed in `708e3673`, inert in the repo, first take effect in the next `main` build. **Pre-existing, unrelated to this PR, and blocks the same path** |

---

## Three findings from challenging the plan

These changed the plan. Read them before executing anything.

### FINDING 1 — merging to `dev` is NOT invisible. Three surfaces reach every tech immediately.

The PR's release story says the five-flag set is the control. **That is only true of the Hub itself.**
Verified in source:

| Surface | Flag-gated? | Who sees it the moment this merges to `dev` |
|---|---|---|
| Job Hub section list, Dry Logs, rooms grid | ✅ `page:tech_job_hub` | owner only |
| Appointment redirect | ✅ reads `isHubNav()` | owner only |
| **Connector rail + stage summary** | ❌ **no gate** | **every tech** — `TimeTracker` is rendered by `TechAppointment` (legacy page) *and* `NowNextHero` (the tech **Dash**) |
| **"New document" relabel** | ❌ **no gate** | **every tech** on the job Documents page |
| **The customer page** `/tech/customer/:contactId` | ❌ **no gate, no role check** | **every tech**, reachable from the ungated "View customer" row on every claim |

The first two are cosmetic and low risk. The third is not.

### FINDING 2 — the customer page is an ungated, editable PII + insurance surface

`<Route path="tech/customer/:contactId" element={<ErrorBoundary …>}` — bare. No `FeatureRoute`, no
`RoleRoute`. The `TechClaimDetail` "View customer" row that leads to it is ungated too.

**State this accurately, because the accurate version is still worth acting on:**

- It is **NOT a privilege escalation.** `contacts_authenticated_update` already grants every
  non-`crm_partner` authenticated user UPDATE on `contacts`, and `FieldShellRoute` already keeps
  external identities out of the whole `/tech` tree. The UI grants nothing the database refuses.
  AGENTS.md §16 is satisfied: the server enforces the same boundary.
- It **IS a rollout-control gap.** The owner's "techs edit everything" decision was made about the
  *flag-gated Hub*. This ships an editable customer/insurance/contact-link surface to every field
  tech the moment `dev → main` merges, **regardless of the five flags** — so the flag set is not the
  release control the PR claims it is.

**Recommendation: gate the route and the claim row behind `page:tech_job_hub`.** ~10 lines, it makes
the flag set genuinely the control, and it costs nothing — the owner holds the flag, so their own
verification is unaffected. **Alternative: accept the wider exposure deliberately.** Either is
defensible; drifting into the second by not noticing is not. **This is decision D3 below.**

### FINDING 3 — the device gate is far cheaper than the PR says

The PR body says the native check needs "a TestFlight build from `main`". That is wrong, and it made
the plan look more expensive and more dangerous than it is. There are **three** device paths, and the
cheapest comes first:

1. **`npm run build:ios:dev` + Xcode run to device** — works from the **feature branch**, before any
   merge. Installs **UPR Dev** (`.dev` bundle, amber icon), points at `dev.utahpros.app`, cannot
   overwrite the real app.
2. **`ios-dev-testflight.yml` dispatch** — from `dev`, after merge, to the internal **UPR Dev** group.
3. **`ios-release.yml`** — `main` only, the official app. **Only this one trips the associated-domains
   gate (ledger #10).**

Path 1 satisfies the entire device gate for this wave. Paths 2–3 are about *distribution*, not
verification.

⚠ **The trap that has bitten here before:** build with **`-configuration Dev`**, never `Debug` —
`Debug` builds under the PRODUCTION bundle id and **overwrites the real app**. Both apps register the
same URL scheme, so `simctl openurl` cannot choose between them; confirm which app you actually drove
before trusting a screenshot.

---

## Test-data strategy — first-class, not a footnote

**One shared Supabase (`glsmljpabrwonfiltiqm`) sits behind `dev.utahpros.app`, `utahpros.app`, UPR
Dev and the simulator.** There is no sandbox. Everything below writes to production.

What the customer page can mutate, and how permanent it is:

| Action | Writes | Reversible? |
|---|---|---|
| Edit name / phone / email / company | `contacts` | Yes — note the old value first |
| Edit carrier / policy / claim # (job mode) | `jobs` | Yes — note the old values first |
| Change a person's role on the job | `contact_jobs.role` | Yes |
| **Remove** a contact from the job | **DELETE** `contact_jobs` row | **Re-addable, but the original `link_id` and `notes` are gone** |
| Add a brand-new person | **INSERT** `contacts` + `contact_jobs` | Row persists; delete it afterwards |

**Rules for the verification session:**

1. **Use ONE test job for every write.** Start from `W-2606-025` (`is_real_job = false`). **Verify
   before trusting it** — read `is_real_job` and its `contact_jobs` set first. If its contacts are
   real people, do not edit them: create a throwaway contact instead and link that.
2. **Never edit a contact whose phone is a real customer's.** An edit is global — the same person on
   every other job changes with it.
3. **Never tap Remove on a link you did not create.** Prefer creating a throwaway link and removing
   that.
4. **Record every write before making it** (old value → new value), in the session's handoff.
5. **Clean up at the end**, and say so explicitly. Roadmap precedent: the OOP work left test
   artifacts *deliberately* and *named them*. Silent residue is the failure.
6. **Never touch `opt_in_*`, `opt_out_*`, `dnd`** — the UI cannot, and neither should a
   verification step reaching around it.

**Read-only first pass.** The entire *layout* verification — four rows, hero modes, reconstruction
gating, rail alignment, the customer page's read view — needs **zero writes.** Do that pass first and
completely. Only then decide whether an edit-path test is worth its blast radius.

---

## Owner decisions — ANSWERED 2026-08-15, in conversation

| | Decision | Answer | What was done |
|---|---|---|---|
| **D1** | Default-open deviation | **Match the artifact — both collapsed** | Dry Logs `defaultOpen={false}` and Tasks `defaultOpen={false}` in `HubSections.jsx`; the render test inverted to pin closed-in-both-modes; roadmap and file header rewritten to record the reversal and its reason. The More sheet's take-a-reading still forces Dry Logs open through `openSignal`, and Visits still opens in job mode. |
| **D2** | +1,140 B entry-graph JS | **Accept; book the ratchet separately** | No code change. The ratchet-down against the entry chunk / `realtime` is its own task, per `perf-budget.md`. |
| **D3** | Gate the customer page? | **Accept the wider exposure, deliberately** | No code change — and that is the point: it is now a recorded decision rather than an oversight. **Stated plainly: when `dev` reaches `main`, `/tech/customer/:contactId` and the `TechClaimDetail` "View customer" row are live for every field tech regardless of all five flags.** Not a privilege escalation (`contacts_authenticated_update` already grants the same write, and `FieldShellRoute` excludes external identities), but it does mean the flag set is not the whole release control. |
| **D4** | Write-path test | **Test on the test job, then revert** | Executed and reverted — see "Write-path test" below. |

## The decision text as originally posed

The Mac session must not guess these. Each one changes what it does.

| | Decision | Options | Recommendation |
|---|---|---|---|
| **D1** | **Default-open deviation.** The artifact draws Tasks collapsed and Dry Logs as a compact summary card. The PR ships both **open** in appointment mode, because that card's data (drying day, wet/dry counts) does not exist until H2-e and collapsing the moisture log hides live stalled badges | accept as built · match the artifact · something else | **Decide by looking**, phase 1 |
| **D2** | **+1,140 B entry-graph JS** on a budget already breached on `dev` (256,479 B vs 237,568 B; 4,846 B below the fail line). Causes are structural: the eager `customer` i18n namespace (English is `fallbackLng`, init must be synchronous) and the deliberately-static redirect guard | accept · require a ratchet-down first | **Accept**, and book the ratchet separately. Neither cause is removable without a worse defect |
| **D3** | **FINDING 2** — gate the customer page + claim row behind `page:tech_job_hub`? | gate it · accept wider exposure | **Gate it.** Small, and it makes the flag set the real control |
| **D4** | **Cleanup posture** for anything created during verification | delete everything · leave and name it | **Delete**, unless something is genuinely useful later |

---

## Verification results — 2026-08-15, browser at 375px and 390px, signed in

Jobs used, all confirmed `is_real_job = false` before opening except where noted:
`W-2608-007` (water, appointment mode) · `W-2606-025` (water, job mode) · `R-2608-009`
(reconstruction) · `W-2608-011` (a **real** job, opened READ-ONLY only, to judge D1 against a job
with four visits and "Drylogs"-titled appointments).

| Checklist item | Result |
|---|---|
| Appointment mode — hero, clock card, four rows in order | **PASS.** Client name leads; `job# · type · date of loss` beneath (the date appears where the job has one — `W-2608-011` shows "W-2608-011 · Water · Aug 11, 2026"). Rows in order: Dry logs · Tasks · Rooms · Visits. |
| Job mode — no clock, no Tasks row, Visits open | **PASS**, exactly as specified. |
| D1 default-open | **Observed, then reversed** — see D1 above. |
| Connector rail (ledger #9) | **PASS, measured** — numbers in the roadmap ledger. One cosmetic 1px offset, reported and deliberately not fixed. |
| Stage summary | **PASS**, and it omits absent halves rather than printing zeros: `1 photo today` on a task-less job, `1 of 2 tasks` on a photo-less one. |
| Reconstruction gating | **PASS on all three consumers.** No Dry Logs row, no Reports/Water Loss Report block, and the More sheet shows only Scope Sheet. Proven **both directions** — the water job's More sheet does show "Take a reading". |
| Customer page, read only | **PASS.** Fixed header, identity + PRIMARY CLIENT / job chips, Customer info, Call/Text/Email, Insurance & claim with read-only date-of-loss / type-of-loss / adjuster, `PART OF CLAIM` breadcrumb, and the "Also on this job" empty state. |
| Rooms row | **PASS.** `aria-expanded` toggles correctly; expands to the Add-room tile plus a proper empty state. |
| 390px — no horizontal scroll | **PASS** on all three surfaces at both 375px and 390px: `scrollWidth === clientWidth`, zero elements overflowing the viewport. |
| Minimize / resume test | **PASS.** Across a hidden→visible cycle the `.tech-content` scroller held its 500px offset, content length was byte-identical, and the route was unchanged. No blank, no spinner. (Proxy: a synthetic `visibilitychange`; a true OS background is the device gate.) |
| Dark mode | **N/A** — under `prefers-color-scheme: dark` the tech shell renders identically light. It is light-only, so there is no dark-mode regression to have. |

**Two findings worth acting on, neither a blocker:**

1. **Tap targets on the new customer page are 21px tall.** The `tel:` and `mailto:` value links
   (`(385) 314-5700`, the email) measure 21px — under the 24px hard floor in
   `tech-mobile-ux.md`, which bans hit areas below 24px *regardless of visual size*. Mitigating:
   the page carries full-size **Call / Text / Email** buttons directly above, so these are
   secondary duplicates rather than the only affordance. Fix is a `min-height` on the value link.
2. **"Edit list" is a 32px control**, the one genuinely new sub-44px target this wave adds. It is
   consistent with the Hub's existing pill idiom (`+ Add reading`, `+ Place`, `See all`,
   `Water Loss Report` are all 32px and all predate this wave), so it is a consistency observation
   rather than a regression. **The new section headers are 48px**, which is the floor the plan
   asked for.

**Not verified, and stated as such:** tap-through interaction on a real device. Synthetic pointer
clicks do not dispatch in this browser pane (they land as text-selection drags), so every
interaction above was driven by direct DOM `.click()`. That proves handlers and state, not touch
behaviour, gesture feel, or safe-area insets.

## Write-path test (D4) — executed and reverted

Subject: contact `56a5323e` and job `W-2606-025` (`6e07fb0c`, `is_real_job = false`). The contact
carries `qbo_customer_id: "565"`, which is the sanctioned QuickBooks test customer in the
`BILLING-CONTEXT.md` §0 allowlist — independent corroboration that this is test data.

Every value was read and recorded **before** the first write.

| Path | Change | Restored? |
|---|---|---|
| `contacts` UPDATE | `company` `null` → `ZZ-VERIFY-TEST` | **Yes — exactly `null`**, not `""`. The page normalizes empty to null. |
| `jobs` UPDATE | `claim_number` `null` → `ZZ-CLAIM-TEST` | **Yes — exactly `null`.** |
| `contact_jobs` INSERT | new link, role `other` | **Yes — deleted via the UI's Remove.** |
| `contact_jobs` DELETE | the same link | n/a |

Verified after restore: every field on both rows is byte-identical to the recorded baseline —
`name`, `phone`, `email`, `company`, `insurance_carrier`, `policy_number`, `claim_number`,
`qbo_customer_id` on the contact; all insurance fields, `status` and `is_real_job` on the job.

**Three behaviours proven that a static test could not:**

- **The consent guardrail holds behaviourally.** After a contact save, `opt_in_status`,
  `opt_out_at` and `dnd` were all unchanged. Ledger #3 was previously argued from the
  `CONSENT_COLUMNS` strip list; it is now measured.
- **Remove deletes the link, never the person.** The contact row survived its link's deletion.
- **The destructive confirm is genuinely two-click.** "Remove" arms to "Tap to confirm", and the
  link was confirmed still present in the database between the two taps. It also self-disarms on a
  timeout. No modal, no `confirm()` — Rule 2 satisfied.

Also observed: phone validation rejected a 7-digit number with an inline error and wrote nothing;
a newly created contact is born `opt_in_status: false`, so it cannot receive automated traffic.

### ⚠ Residue — one row, named rather than left silent

**Contact `3cbc422b-1643-4865-b1b1-01c8f636b34c`, "ZZ Verify Deleteme", `+13855550100`.** Created by
the add-a-person test. It is **unlinked from every job**, `opt_in_status: false` and `dnd: false`,
and its number is in the reserved-fictional `555-01xx` range, so it cannot receive automated
messaging and appears on no job. It could not be removed from here: the tech page's Remove deletes
links only (by design), and the agent's delete tool is permission-denied. **Owner cleanup:**
`DELETE FROM contacts WHERE id = '3cbc422b-1643-4865-b1b1-01c8f636b34c';` — or delete it from the
office Customers page.

## Phases

Serialized on purpose. Every phase is a gate for the next, and **the only concurrency available
(building the iOS app while reading the diff) does not earn its coordination cost.**

### Phase 0 — Orient and reproduce green (~20 min, no risk)

```bash
git fetch origin
git checkout claude/job-hub-wave2-customer-page-ebcwix
git log --oneline origin/dev..HEAD          # expect 7 commits
npm ci
npm run build && npm run build:native
npm test                                     # unit · worker · qa
npm run validate:lint-ratchet -- origin/dev  # expect 0 regressions
npm run test:tooling
```

**Expect two pre-existing failures that are container artifacts and should PASS on a Mac** —
`scripts/ios-release-workflow.test.js` (process-group timeout) and
`tests/qa/unit/capgo-dev-workflow.test.js` (a `chmod 000` fixture that root could still read).
**If either fails on the Mac, that is new information — stop and investigate.**

**Exit:** every gate green locally. Any failure here means the cloud session's report was wrong;
report that plainly rather than working around it.

### Phase 1 — Read-only visual verification (the core of this plan)

Two surfaces, cheapest first.

**1a — Browser (5 min).** Open the Cloudflare branch preview on a phone-width viewport:
`https://claude-job-hub-wave2-custome.utah-pros-app-git.pages.dev`
Sign in as the flag holder. Covers layout, the four rows, D1, reconstruction gating, and the customer
page's read view.

**1b — Simulator / device.** From the feature branch:

```bash
npm run build:ios:dev
# open ios/App/App.xcworkspace, select configuration Dev, run
# CONFIRM the installed app is UPR Dev (amber icon, bundle ends .dev) BEFORE going further
xcrun simctl openurl <udid> "com.utahprosrestoration.upr://app/tech/job/<jobId>?appt=<apptId>"
xcrun simctl io <udid> screenshot phase1-appointment-mode.png
```

**Checklist — every item is a look, not a tap:**

- [ ] **Appointment mode** — hero, clock card, four rows in order: Dry logs · Tasks · Rooms · Visits
- [ ] **Job mode** (open the job with no `?appt=`) — no clock, no Tasks row, Visits open
- [ ] **D1** — Dry Logs and Tasks open in appointment mode, closed in job mode. **Is that right?**
- [ ] **Connector rail** — does the line actually meet the circle centres, and do the circles hide it
      where it passes underneath? (ledger #9)
- [ ] **Stage summary** — "N of M tasks · N photos today" under the stations
- [ ] **A reconstruction job** — **no** Dry Logs row, **no** take-a-reading in More, **no** water-loss
      report
- [ ] **Customer page, read only** — from the hero Customer pill; identity, insurance, other contacts
- [ ] **Rooms row** — tiles and the Add tile; on a claim-less job the tiles are display-only
- [ ] **390px** — no horizontal scroll anywhere; tap targets usable with a thumb
- [ ] **Minimize test** — background the app 30s+, resume. **Nothing may happen**: no blank, no
      spinner flash, no route loss, no scroll loss (`page-lifecycle.md`)
- [ ] **Dark mode**, if the tech shell offers it

**Exit:** screenshots of both hero modes attached to PR #669, plus a D1 ruling.
**If anything looks wrong, stop here and fix it on this branch before merging.** A defect found now
is cheap; found after `main`, it is a promotion cycle.

### Phase 2 — Decisions and any resulting change

Apply D1–D4. If **D3 = gate it**, the change is small and belongs on this branch:

- wrap the `tech/customer/:contactId` route in `<FeatureRoute flag="page:tech_job_hub">`
- gate the `TechClaimDetail` "View customer" row on the same flag
- extend `tests/qa/unit/tech-customer-route.test.js` to pin both

Re-run the Phase 0 battery. Push. **Do not merge on green alone** — Phase 1's screenshots are the gate.

### Phase 3 — Merge to `dev` (owner's click)

Mark PR #669 ready for review, merge. `dev` auto-deploys to `dev.utahpros.app`.

**What reaches every tech at this moment** (FINDING 1): the connector rail on the Dash and the legacy
appointment page, the "New document" relabel, and — unless D3 gated it — the customer page. **Say
this out loud before clicking**, because it is not obvious from the PR title.

### Phase 4 — Owner bake

The flag already targets the owner. Use the Hub on a real job, on a real phone, for a real shift.

**Bake specifically for what a static check cannot see:** does the section list actually reduce
scrolling, or just hide things one tap deeper? Do Dry Logs and Tasks open where you want them? Does
the customer page get used, or is the Job & Claim card still where you look?

Optionally distribute to the internal **UPR Dev** group:
`ios-dev-testflight.yml` → Run workflow → from `dev` → `publish_to_testflight: true`.
This is the **UPR Dev** app, never the official one.

**Exit:** a written sign-off. This is the gate that also unblocks H3 (legacy page retirement).

### Phase 5 — Production (each step separately owner-authorized)

1. Reviewed **`dev → main`** PR. CI must be green at the exact head.
2. **⚠ Before any official iOS build:** clear the **associated-domains gate** (ledger #10) —
   pre-existing, unrelated to this wave, and it blocks this path. Confirm on a device that a
   production `/tech` link still opens the production app, that a dev link opens UPR Dev, and that
   emailed password/signing links stay in the browser. `docs/mobile/testing-and-release.md` →
   "NAMED GATE — associated domains". **Green CI is not evidence for this.**
3. `ios-release.yml` from `main` for the official app (native users only get the wave here).
4. **Widen the flag SET — all five together**, in DevTools → Flags. Per flag: **enable
   (`setGlobalEnabled`) FIRST, then clear dev-only (`toggleDevOnly`)**:
   `page:tech_job_hub` · `page:tech_moisture` · `page:tech_equipment` · `page:tech_rooms` ·
   `page:water_loss_report`.
   ⚠ **The order matters and it used to be written the other way round** (clear dev-only, then
   enable). Those are two separate RPC round-trips, and in between the row is
   `enabled:false, dev_only_user_id:null` — which `resolveFeatureFlagAccess` resolves to OFF for
   **everyone, the owner included**. Five flags done that way is five dark windows on a live
   surface. Enabling first is strictly safe: `flag.enabled` is checked *before* `dev_only_user_id`,
   so the row is already open to everyone by the time dev-only is cleared, and clearing it is then
   pure hygiene. Corrected 2026-08-16.
   **Widening the Hub alone ships a Hub with no moisture and no equipment sections.** One shared
   Supabase, so the flip hits both domains at once. **Consider widening to one or two techs first**
   (`dev_only_user_id` is single-valued, so a true pilot needs the flag enabled and watched, not
   a second dev-only id).

---

## Cold-session dispatch

Self-contained. Assumes no access to the conversation that produced it.

> **Objective.** Verify Job Hub wave 2 + the tech customer page on a real screen, resolve four owner
> decisions, and drive PR #669 to production through its gates.
>
> **Authority.** Repository work on `claude/job-hub-wave2-customer-page-ebcwix` is authorized. **Every
> one of these is a SEPARATE owner action and none is pre-authorized:** merging any PR, opening a
> `dev → main` PR, dispatching any iOS workflow, flipping any feature flag, and any write to
> production data beyond the test-data rules above.
>
> **Required reading, in order.** This file · the two docs named at the top · `AGENTS.md` +
> `CLAUDE.md` · `.claude/rules/tech-mobile-ux.md` · `page-lifecycle.md` · `loading-error-states.md` ·
> `motion-standard.md` · `docs/mobile/dev-app-variant.md`.
>
> **Scope.** Phases 0–2 are yours to execute. Phases 3–5 you prepare and hand to the owner.
>
> **Acceptance.** Phase 0 green on the Mac; Phase 1 checklist complete with screenshots on the PR;
> D1–D4 answered; any resulting change committed with its tests and the full gate battery re-run.
>
> **Stop conditions — stop and ask rather than proceeding:**
> - a Phase 0 gate fails on the Mac (the cloud report was wrong)
> - anything in Phase 1 looks wrong (fix on the branch; do not merge around it)
> - a write would touch a contact or job you have not confirmed is test data
> - you are about to build anything other than `-configuration Dev`
> - any step would reach `main`, a flag, an iOS workflow, or a real customer record
>
> **Reviewers**, if Phase 2 changes code: `upr-pattern-checker`, `design-consistency-checker`,
> `page-behavior-checker`, `interface-accessibility-reviewer`; `review-animations` **only** if motion
> changes. No migration is involved, so the database reviewers do not apply.
>
> **Close-out.** `.claude/rules/close-out-standard.md`. Update `UPR-Web-Context.md` and reconcile
> `docs/job-hub-wave2-roadmap.md` both directions. Close the `docs/wip/` entry **only** once this
> lands in `dev`.

---

## Challenge findings

Recorded per the masterplan contract, including the objections that changed the plan.

1. **"Merge to `dev` first — the flag makes it invisible, so verifying on `dev` is simpler."**
   **Rejected, and it produced FINDING 1.** Three surfaces are not flag-gated, so a merge is not
   invisible. Verification stays ahead of the merge.
2. **"The device gate needs TestFlight from `main`."** **Refuted — FINDING 3.** `build:ios:dev` runs
   from the feature branch. The plan got materially cheaper and safer.
3. **"The customer page is fine ungated; the database already allows it."** **Half right, and the
   half that is right matters** — it is not a privilege escalation, and saying otherwise would be
   scaremongering. But it is still a rollout-control gap (FINDING 2), so it became decision D3 rather
   than either a silent fix or a silent acceptance.
4. **"Skip the read-only pass and just test the edit paths."** **Rejected.** Every write lands in
   production. The read-only pass answers most of the open questions at zero blast radius.
5. **Simpler option considered:** browser-only verification, no iOS build at all. **Partly adopted** —
   phase 1a exists because it is cheap. It cannot cover safe-area insets, WKWebView behaviour, or the
   native routes, so 1b stays.
6. **Ordering challenged:** is Phase 2 (decisions) really after Phase 1 (looking)? **Yes** — D1 is a
   visual judgment. Deciding it from a description is exactly the mistake this plan exists to correct.
7. **Ownership overlap checked:** the planned (not yet active) `job-files` privacy Phase 1 will lease
   `src/pages/tech/TechJobDocuments.jsx`, which this PR touches for the "New document" relabel.
   **No live lease today** (`initiative-status.md`: "PLANNED, nothing authored"), so there is no
   collision — but that initiative should rebase rather than assume.
8. **Failure recovery:** every phase before Phase 3 is revertible by discarding the branch. After
   Phase 3, recovery is a revert PR to `dev`. After Phase 5.4, recovery is turning the five flags
   back off — which is instant and needs no deploy. **That is the real safety net, and it is why
   the flag set matters more than the merge.**

---

## Out of scope

- **H2-e daily logs** and the **Activity event feed** — both need schema, both route through
  `/db-migration` with their own plans.
- **A reconstruction-specific Hub** — this wave only stops mitigation-only UI appearing on
  reconstruction jobs.
- **H3 cutover** (legacy page deletion, appointment resolver) — gated on the Phase 4 bake sign-off.
- **The entry-graph ratchet-down** implied by D2 — book it separately; it is not this wave's debt.
