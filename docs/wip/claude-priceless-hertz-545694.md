---
branch: claude/priceless-hertz-545694
ships: true
opened: 2026-08-14
---

# What

feat(mobile): multi-photo album selection on the five album surfaces (job/claim
albums, room detail, job/claim detail photo sections) — native source sheet +
OS multi-select picker, `multiple` web inputs, sequential batch upload with
per-file failure summary. Follow-up to PR #628.

# Why it matters

A tech documenting a job after the fact had to round-trip the picker once per
photo — ten photos meant ten taps through Add Photo. Quick-capture surfaces
deliberately stay snap-first single-shot (contract-pinned).

# Next action

Publish PR into dev; native sheet/picker verification on next UPR Dev build
