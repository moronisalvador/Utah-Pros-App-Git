---
branch: claude/job-hub-wave2-customer-page-ebcwix
ships: true
opened: 2026-08-15
---

# What

Job Hub wave 2 (H2-a appointment redirect, H2-b four-row section list, H2-c rail +
stage summary, division-awareness) plus the new field customer page (H2-d) at
`/tech/customer/:contactId?job=`. Executes
`docs/handoff/job-hub-wave2-and-customer-page-plan-2026-08-15.md`.

# Why it matters

H2-a closes a LIVE defect: push notifications stored `/tech/appointment/<id>` for
months, so a tech tapping an old notification lands on the legacy page this wave
exists to replace. H2-b is the owner's original complaint — wave 1 put a new head
on the old body. H2-d closes a recorded dead end where `TechNewCustomer`'s
post-save ejected the tech out of the field shell entirely.

No migration: every read and write already had its grant.

# Next action

Draft PR https://github.com/moronisalvador/Utah-Pros-App-Git/pull/669 is open into
`dev` at head `49c96786`, mergeable/clean. **Owner marks it ready and merges**, then
bakes on their phone (the flag already targets them).

**The visual gate is CLOSED (2026-08-15).** Verified twice on the owner's Mac — in a
browser at 375/390px and then on a native `UPR Dev` simulator build with no local
overrides. Both hero modes, the connector rail (measured, not eyeballed),
reconstruction gating both directions, the resume test, and all three write paths
exercised and reverted. Full record + handoff for a new machine:
`docs/handoff/job-hub-wave2-takeover-2026-08-15.md`.

Owner gates that remain, none of which an agent can do:
1. Merge #669 to `dev`, then bake.
2. `dev → main` promotion, and — **before any OFFICIAL iOS build** — the
   associated-domains gate, which is pre-existing and unrelated to this wave but
   blocks the same path. Then `ios-release.yml` from `main`.
3. The flag SET — `page:tech_job_hub` widened together with `page:tech_moisture`,
   `page:tech_equipment`, `page:tech_rooms` and `page:water_loss_report`.
   Widening the Hub alone ships a Hub with no moisture or equipment sections.
4. Delete verification residue contact `3cbc422b-1643-4865-b1b1-01c8f636b34c`.

Still unverified, and the only open verification class: **a physical device**. Simulator
input is not a finger on glass. `npm run build:ios:dev` + Xcode run to device covers it
and never touches `main` or the official app.

Deliberately NOT started: H2-e daily logs and the Activity event feed. Both need
schema and route through `/db-migration` with their own plans.
