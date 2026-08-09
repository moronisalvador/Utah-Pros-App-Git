---
branch: claude/esign-wordsof-real
ships: true
opened: 2026-08-09
---

# What

test(esign): stop the worker-lane word-grouping test re-implementing production

# Why it matters

`submit-esign.test.js`'s `wordsOf` helper was a hand-written mirror of the
tokenizer, and the mirror omitted `pdfSafe()` — which TRIMS. That trim is the
whole cause of defect d0d38278 (`hasnot been confirmedby` on signed customer
legal documents), so the mirror produced the right answer for that input by
construction and could not fail on the defect it appeared to cover. It now
calls the real exported `layoutWrappedRuns`, and carries the case the mirror
could never express. Proven to bite: deleting the leading-edge guard fails it
with the exact production string.

# Next action

Awaiting owner click-merge on PR #617 (base `dev`, all required checks green).

Was stacked on #615, which MERGED 2026-08-09T04:07Z, so `layoutWrappedRuns` is
on `dev` now and #617 was retargeted from `claude/esign-layout-extraction` to
`dev`. Note for anyone stacking again: `ci.yml` only fires for PRs based on
`main`/`dev`, and retargeting fires `edited`, which does not re-trigger it —
the required `verify`/`db-lane` checks had to be started by close/reopen.
