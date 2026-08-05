---
branch: origin/claude/upr-crm-dashboard-gap-e0e8ba
ships: true
opened: 2026-08-05
---

# What

CRM reporting tests assert behavior OPPOSITE to a live production migration (Denver-day bucketing, repeat-caller after Won)

# Why it matters

A dev test contradicts applied production behavior; three applied CRM migrations have no behavioral coverage

# Next action

Do NOT merge the branch; cherry-pick its three corrected test files onto dev (CrmOverview.jsx and crm-lead-lifecycle.md there are older than dev's)
