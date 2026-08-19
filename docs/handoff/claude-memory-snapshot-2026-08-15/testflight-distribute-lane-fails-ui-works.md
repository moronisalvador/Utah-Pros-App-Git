---
name: testflight-distribute-lane-fails-ui-works
description: The iOS ASC distribute fastlane lane cannot assign a build to a TestFlight group on this tenant — ASC 404s the build relationship; assign in the App Store Connect UI instead
metadata: 
  node_type: memory
  type: project
  originSessionId: e0df90d1-5e5b-4891-b899-d1efad5387c7
  modified: 2026-08-09T20:29:04.136Z
---

`iOS ASC distribute` (the retro-assign workflow) **fails on this ASC tenant**. Measured
2026-08-09 on UPR Dev build 209.1, three consecutive runs, identical error:

```
The specified resource does not exist - There is no resource of type 'builds'
with id '6020f5ae-eff0-4bc2-8aae-71b85ddfebc8'   (Spaceship::UnexpectedResponse)
```

**The lane resolves the RIGHT build** — that UUID is exactly what App Store Connect's own
URL shows for 209.1. It finds the app, the group and the build, then `add_beta_groups`
(`POST /v1/builds/{id}/relationships/betaGroups`) 404s. Same family as the already-known
`bulkBetaTesterAssignments` 404: this tenant refuses some documented ASC relationship paths.

**What works: the App Store Connect UI.** App → TestFlight → iOS Builds → hover the build's
GROUPS cell → blue **+** → pick the internal group. Instant, and the badge appears immediately.

## Why the build was stranded in the first place

The `iOS dev TestFlight` workflow uploaded fine (13:37Z) then died at **exit 124** waiting
for Apple to finish processing — `Owned command exceeded 2692000 ms` (~45 min). Group
assignment happens *after* that wait, so the binary lands on ASC unassigned. The upload
itself is not lost; only the assignment is. The official `iOS release` run the same day
processed in ~3 minutes and self-assigned normally, so this is Apple-side variance, not a
repo bug.

## Two things that will mislead you

- **`iOS ASC diagnose` reports `groups=[]` for every build**, including ones that are
  definitely assigned (185.1, 113.1 …). That field is not a reliable assignment indicator —
  only the ASC UI's GROUPS column is.
- A build shows **no "Ready to Submit"** until Apple finishes processing. 209.1 showed blank
  during the failed distribute attempts and flipped to "Ready to Submit" ~5 min later. If
  distribute fails, re-check the status before concluding the lane is at fault — though here
  it failed even once Ready.

## The fix is already proven in the same file

`ios/fastlane/Fastfile` contains both directions, and only one of them works here:

- **`distribute` (broken)** — spaceship model call, build→group:
  `build.add_beta_groups(...)` → `POST /v1/builds/{id}/relationships/betaGroups` → **404**
- **`add tester` (works)** — raw `call_api` HTTP, group→testers, ~30 lines further down:
  `POST /v1/betaGroups/{group_id}/relationships/betaTesters` with
  `{ data: [{ type: …, id: … }] }`, plus a 409→link fallback

So the tenant accepts `betaGroups/{id}/relationships/*` and refuses `builds/{id}/relationships/*`.
Rewrite `distribute` to use the same raw `call_api` pattern against
`POST /v1/betaGroups/{group_id}/relationships/builds` with
`{ data: [{ type: "builds", id: build_id }] }`. Not implemented — it needs a stranded build
to test against, and CI holds the ASC key, so it cannot be validated locally.

Related: [[testflight-release-policy]] (official app is dispatch-gated),
and the group-nil bug in the same pipeline recorded in MEMORY.md's receive-payment entry.
