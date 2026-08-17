---
name: job-hub-wave2-remaining
description: "What is left of Job Hub wave 2, the evidence behind it, and three corrections to earlier assumptions about what was already built"
metadata: 
  node_type: memory
  type: project
  originSessionId: ab5c0ae0-482f-4316-ba3c-d14864994f6b
  modified: 2026-08-09T01:00:17.153Z
---

**Plan lives in the repo: [`docs/job-hub-wave2-roadmap.md`](../../../../APPS/Utah-Pros-App-Git/docs/job-hub-wave2-roadmap.md)** (written 2026-08-08 via `/masterplan`, planning only —
nothing in it is authorized to build). Read that first; this memory carries only what a cold session
would otherwise get wrong.

**Slice A shipped on `dev`:** `18058697`, `6c505759`, `80512d3c`, `8378b0af`+`b0402e80`, `e4315e35`.
Ticking clock retired · `Message · Docs · Notes · More` · dock reduced to capture · legacy-job
redirect · hero rebuilt (client name leads, `job# · type · date of loss` beneath, Customer + Claim
pills). See [[job-hub-wave2-spec]] for the approved artifact and its rulings.

## Three corrections — the spec's "missing" list was wrong

1. **The Docs page and document generation EXIST.** `EsignRequestSheet` has its own picker over
   **8** doc types; `TechJobDocuments` already opens it. But the button reads *"Request signature"*,
   not a `+` meaning "generate a document" — narrower framing than the spec, and an open decision,
   not a closed one.
2. **Notes is an on-page section**, not a missing page. The action bar's Notes scrolls to
   `PhotosNotes`.
3. **The below-fold work is RE-HOUSING, not building.** All five of `Dry Logs · Tasks · Rooms ·
   Visits · Activity` already exist as components; they are stacked, not listed.

Genuinely missing: **customer page**, **daily logs** (zero matches repo-wide — the only item needing
schema), the **clock connector rail**, and a **per-day photo count**.

## The highest-value open item, and it is not the below-fold

**`/tech/appointment/:id` has no redirect guard** (`App.jsx:361`) while `/tech/jobs/:id` now does.
It is the identical defect the owner reported — and it reaches further: `techShellRoutes.js:67`
records that `notify.js` stored `/tech/appointment/<id>` **for months**, so historical push
notifications deep-link to the legacy page, and `TimeTracker.jsx:411` navigates there from *inside
the Hub itself*. Mirror `LegacyJobRedirect`; the one difference is that the appointment route must
resolve `job_id` asynchronously, so plan for resolving / resolved / job-less-appointment rather than
a synchronous swap.

## Two owner decisions block phases

- **What "Activity" means** in the five-row list — photos+notes, or a real event feed.
- **Customer page: re-skin the office `CustomerPage`, or a new tech screen.** Until then the hero's
  Customer pill opens and scrolls to the Job & Claim card, which is a real destination.

See [[job-hub-stale-sim-bundle-trap]] for the simulator recipe — and grep the installed bundle before
believing a change did not land.
