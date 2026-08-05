---
branch: origin/codex/qbo-picker-controls
ships: true
opened: 2026-08-05
---

# What

Shared DatePicker keyboard accessibility + eslint rules banning native select/date inputs

# Why it matters

Real keyboard-accessibility defect in a component used across office, CRM and tech surfaces; the lint rule stops regressions

# Next action

Rebase onto current origin/dev, regenerate scripts/eslint-ratchet-baseline.json from scratch, run the close-out gauntlet
