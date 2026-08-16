# Job Hub wave 2 + tech customer page — takeover handoff

**Created:** 2026-08-15 · **For:** a fresh session on a DIFFERENT Mac
**Subject:** PR [#669](https://github.com/moronisalvador/Utah-Pros-App-Git/pull/669), branch
`claude/job-hub-wave2-customer-page-ebcwix`, head **`49c96786`**, draft, base `dev`,
`MERGEABLE / CLEAN`

**Reads with:** the verification record
[`job-hub-wave2-mac-verification-and-rollout-plan-2026-08-15.md`](job-hub-wave2-mac-verification-and-rollout-plan-2026-08-15.md)
(phases, D1–D4, the write-path test) · [`../job-hub-wave2-roadmap.md`](../job-hub-wave2-roadmap.md)
(wave plan + evidence ledger) ·
[`job-hub-wave2-and-customer-page-plan-2026-08-15.md`](job-hub-wave2-and-customer-page-plan-2026-08-15.md)
(what was built and why) ·
[`../tech-redesign/prototypes/job-hub-wave2-approved.html`](../tech-redesign/prototypes/job-hub-wave2-approved.html)
(the approved artifact — **not** `prototypes/job-hub.html`, a different design).

---

## Status in one paragraph

The code is complete, CI-green and verified on a real screen — twice. **The visual gate that
blocked this wave is CLOSED.** What remains is not engineering: it is a sequence of owner clicks
(merge, bake, promote, flag-widen) plus one genuinely open verification class, a physical device.
**There is no work here an agent can simply pick up and finish.** The value a takeover session adds
is: run the physical-device check if the owner wants it, run the reviewer gauntlet if the owner
lifts the subagent restriction, and otherwise support the owner through the release steps.

---

## What is verified, and by what

| Claim | Evidence |
|---|---|
| Every gate green at head `49c96786` | On the previous Mac: `build` · `build:native` · **`npm test` 6,389/6,389** (unit 1,897 · worker 2,431 · **qa 2,061**) · lint ratchet **0 regressions** / 46 changed files · `test:tooling` 46/46 |
| The screens render correctly | Browser pass at 375px and 390px, signed in, real database — full checklist in the verification record |
| Same, on a real native build | `UPR Dev` simulator build, **no local overrides**, both hero modes + section list |
| Connector rail alignment (ledger #9) | **Measured**, not eyeballed: circle centres y=510.4; rail y 510.4→512.4; rail x 82.83→286.17 vs outer centres 81.5/287.5 and inner edges 105.5/263.5 |
| Consent guardrail holds | **Behaviourally** — after a real contact save, `opt_in_status` / `opt_out_at` / `dnd` unchanged |
| Remove deletes the link, not the person | The contact row survived its link's deletion |
| The destructive confirm is really two-click | The link was confirmed present in the database **between** the two taps |

⚠ **Two "known container artifact" test failures do NOT reproduce on a Mac.**
`scripts/ios-release-workflow.test.js` (48 tests) and `tests/qa/unit/capgo-dev-workflow.test.js`
(12 tests) pass. A commit message on this branch reports `qa 2060/2061`; that was that session's
container. **If either fails on your Mac, that is new information — stop.**

---

## The four owner decisions — SETTLED, do not re-litigate

Confirmed by the owner in conversation on 2026-08-15 (asked a second time, because the first answers
arrived while they were asleep).

| | Decision | State |
|---|---|---|
| **D1** | Every section row defaults **CLOSED** in both modes, matching the artifact | **Applied** in `edcefbcd`; pinned by `HubSections.render.test.jsx` |
| **D2** | Accept the entry-graph spend; book the ratchet separately | No code change |
| **D3** | The customer page ships **UNGATED**, knowingly | No code change — see the warning below |
| **D4** | Write paths tested on the test job, then reverted | Done; one residue row named below |

### D3 is the one to say out loud before merging

`/tech/customer/:contactId` has **no `FeatureRoute` and no role check**, and the `TechClaimDetail`
"View customer" row that reaches it is ungated too. So **the five-flag set does not gate this page**:
an editable customer / insurance / contact-link surface goes live for **every field tech** the moment
`dev` reaches `main`, regardless of the flags.

This is **not** a privilege escalation — `contacts_authenticated_update` already grants every
non-`crm_partner` authenticated user the same write, and `FieldShellRoute` keeps external identities
out of `/tech`, so AGENTS.md §16 is satisfied at the server. It is a **rollout-control** fact, and the
owner accepted it deliberately. Do not "fix" it silently; if it is revisited, gating is ~10 lines
(`FeatureRoute` on the route, the same flag on the claim row, extend
`tests/qa/unit/tech-customer-route.test.js`).

---

## Traps — every one of these cost time to find

1. **The flag holder is NOT the dev-login account.** The five wave flags are `dev_only_user_id`-scoped
   to employee **`d1d37f3c` (Moroni Salvador, admin, `moroni@utah-pros.com`)**. The `.env.local`
   dev-login button signs in as **`moroni.s@utah-pros.com`**, which resolves to employee
   **`dd188c16` ("Moroni Tech", field_tech)** — a *different* employee. `resolveFeatureFlagAccess`
   compares `flag.dev_only_user_id === employee.id`, so **the dev-login session does not reach the
   Hub; it bounces to `/tech`.** Rendering it locally needs a human-authenticated admin session, or a
   temporary local override you must revert.
2. **The clock card renders only for a crew member** (`hubStageState.isOnCrew`). A non-crew viewer
   sees "View only — you're not on this visit's crew" and **no connector rail and no stage summary**.
   **Do not write an `appointment_crew` row to production for a screenshot.**
3. **Build `-configuration Dev`, NEVER `Debug`.** `Debug` builds under the PRODUCTION bundle id and
   overwrites the real app. Verify `CFBundleIdentifier` ends `.dev` in the built `App.app/Info.plist`
   before installing.
4. **Both apps register the same URL scheme.** On the previous Mac's simulator BOTH
   `com.utahprosrestoration.upr` and `.dev` were installed, so `simctl openurl` cannot choose between
   them. Launch by bundle id and confirm which app you drove before trusting a screenshot.
5. **There is no `.xcworkspace`** — this is SPM. Use `-project ios/App/App.xcodeproj`, scheme
   **`UPR Dev`**.
6. **`cap sync` can rewrite `ios/App/CapApp-SPM/Package.swift` to absolute worktree paths**, which
   breaks CI (regression history: `31c5ade8`, guarded by
   `tests/qa/unit/native-spm-paths-portable.test.js`). It did **not** recur on the previous Mac
   because `node_modules` was a real directory rather than a symlink. **Check `git status` after every
   `cap sync`.**
7. **Synthetic pointer clicks do not dispatch in the in-app browser pane** — they land as
   text-selection drags. Drive the web app with direct DOM `.click()` instead.
8. **A running Vite dev server can poison the unit lane.** Stop it before believing a red run.

---

## What this Mac will NOT have

The previous machine's simulator carried a **signed-in session for the admin account**, which is why
the native pass needed no overrides. **A fresh Mac will not have that.** Native builds have **no
dev-login button**, so signed-in native verification there is **owner-gated**: the owner must sign
into the simulator or device once, after which an agent can drive it.

You will also need your own `.env.local` (gitignored) for the web dev server, and a full
`npm ci` in the worktree.

---

## Remaining work — ordered

**Owner actions. None of these is pre-authorized for an agent.**

1. Mark #669 ready and **merge to `dev`**. Say the D3 exposure out loud first. Three things reach
   every tech at that moment regardless of flags: the connector rail (tech Dash + legacy appointment
   page), the "New document" relabel, and the customer page.
2. **Bake** on a real phone. This is also the written gate that unblocks the H3 cutover.
3. Reviewed **`dev → main`** PR, CI green at the exact head.
4. **⚠ Before any OFFICIAL iOS build: the associated-domains gate.** Pre-existing, unrelated to this
   wave, and it blocks the same path. Confirm on a device that a production `/tech` link opens the
   production app, a dev link opens UPR Dev, and emailed password/signing links stay in the browser.
   **Green CI is not evidence.** See `docs/mobile/testing-and-release.md` → "NAMED GATE".
5. `ios-release.yml` from `main`.
6. **Widen the five flags as a SET** — `page:tech_job_hub` · `page:tech_moisture` ·
   `page:tech_equipment` · `page:tech_rooms` · `page:water_loss_report`. Widening the Hub alone ships
   a Hub with no moisture and no equipment sections. One shared Supabase, so it hits both domains at
   once.

**Agent-available, if the owner asks:**

- **Physical-device run** — `npm run build:ios:dev` + Xcode run to device. The only open verification
  class; simulator input is not a finger on glass. Never touches `main` or the official app.
- **Reviewer gauntlet** — `upr-pattern-checker`, `design-consistency-checker`,
  `page-behavior-checker`, `interface-accessibility-reviewer`. **Never run on this branch**, because
  the verifying session was told not to use subagents.

---

## Loose ends

- **Residue contact `3cbc422b-1643-4865-b1b1-01c8f636b34c`** — "ZZ Verify Deleteme",
  `+13855550100`, created by the D4 write test. Unlinked from every job, `opt_in_status: false`,
  number in the reserved-fictional `555-01xx` range, so it reaches nobody and appears on no job.
  The tech page's Remove deletes links only, by design, and the agent delete tool is
  permission-denied. Owner: `DELETE FROM contacts WHERE id = '3cbc422b-1643-4865-b1b1-01c8f636b34c';`
- **`.env.local` on the PREVIOUS Mac's worktree** — a copy of the owner's secrets file, made to run
  the dev server; `rm` was permission-denied. Gitignored, so it cannot be committed. Irrelevant to a
  new machine except as a reminder to clean up your own.
- **The old worktree** `.claude/worktrees/job-hub-wave2-mac-verify-f00ee4` on the previous Mac is
  clean and fully pushed; it can be removed per `worktree-lifecycle.md`.
- **Open, NOT this wave's:** "Edit list" is a 32px control — consistent with the Hub's existing pill
  idiom (`+ Add reading`, `+ Place`, `See all` are all 32px and predate this wave), recorded as a
  consistency note. And the connector rail's 2px line sits 1px below the circle centres; deliberately
  not fixed, because it is imperceptible and `TimeTracker` is shared with the legacy page.

## Out of scope — do not start

**H2-e daily logs** and the **Activity event feed**. Both need schema and route through
`/db-migration` with their own plans. Also out: a reconstruction-specific Hub, the H3 cutover (gated
on the bake sign-off), and the entry-graph ratchet-down implied by D2.
