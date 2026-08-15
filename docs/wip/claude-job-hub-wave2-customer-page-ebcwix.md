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
`dev`. Owner merges, then bakes on their phone (the flag already targets them).

Owner gates, none of which an agent can do:
1. The VISUAL check — nothing here is screenshotted; this was a cloud session.
   Specifically: both hero modes, the default-open deviation from the artifact
   (Dry Logs + Tasks open in appointment mode), the connector rail's alignment,
   a reconstruction job, and the customer page's edit paths.
2. `dev → main` promotion, and a TestFlight build from `main` for native users.
3. The flag SET — `page:tech_job_hub` widened together with `page:tech_moisture`,
   `page:tech_equipment`, `page:tech_rooms` and `page:water_loss_report`.
   Widening the Hub alone ships a Hub with no moisture or equipment sections.

Deliberately NOT started: H2-e daily logs and the Activity event feed. Both need
schema and route through `/db-migration` with their own plans.
