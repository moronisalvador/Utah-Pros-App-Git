---
branch: claude/vigorous-napier-60978d
ships: true
opened: 2026-08-09
---

# What

ESLint ratchet baseline correctness: fix the no-undef findings rather than freeze
them, harden the capture tool so adding a file counts as an expansion, and pin
both with tests.

# Why it matters

The baseline is the gate that decides whether a PR is blamed for lint debt it did
not write. PR #608 completed the census; this makes the recorded debt honest (four
files leave, two because their findings were never real and two because they were
captured from a stale tree) and makes the capture tool refuse to freeze brand-new
debt by accident.

# Next action

Open PR into dev; merge stays owner-gated.
