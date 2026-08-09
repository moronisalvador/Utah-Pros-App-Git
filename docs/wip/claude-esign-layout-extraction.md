---
branch: claude/esign-layout-extraction
ships: true
opened: 2026-08-09
---

# What

Extract the signed-PDF body-text layout out of `buildPdf`'s `drawWrapped` closure
into an exported pure `layoutWrappedRuns(str, { measure, maxWidth, size })`, and
add behavioural test cover that executes it. No behaviour change.

# Why it matters

Three defects reached signed customer legal documents through a fully green
suite (`b57c7365` literal `**`, `1b53ae11` `delay ,`, `d0d38278`
`hasnot been confirmedby` — introduced by the fix for the second and live in
production for hours). The logic was unreachable, so all five e-sign tests were
source-contract tests that grepped the file as text; every defect was found by a
human rendering a PDF and reading it.

# Next action

Open PR into `dev`; notify the MERGER release-lane session for `dev → main`
sequencing. Merging stays with the owner.
