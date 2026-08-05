---
branch: origin/claude/standardize-claim-tiles-NRRJe
ships: true
opened: 2026-08-05
---

# What

Customers page shows a false 'Imported' badge on Encircle claims that were never imported

# Why it matters

The badge hides genuinely un-imported claims from staff on the live import page

# Next action

Do NOT merge the stale branch; cherry-pick one line onto dev: add &claim_id=not.is.null to the job-pill query in Customers.jsx
