---
branch: codex/mobile-readiness-reminder-activation
ships: true
opened: 2026-08-05
---

# What

Durable per-recipient/channel delivery-claim layer the appointment reminder needs before it can ever be re-enabled

# Why it matters

The reminder feature cannot be safely enabled at all until this lands; also removes browser-role grants on three tables

# Next action

Open the PR into dev at the exact qualified head; run close-out gauntlet + migration-safety-checker + anon-grant-auditor at that SHA
