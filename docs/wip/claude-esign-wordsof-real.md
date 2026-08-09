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

Stacked on PR #615 (`claude/esign-layout-extraction`), which is still OPEN —
`layoutWrappedRuns` does not exist on `dev` yet. Land after #615 merges.
