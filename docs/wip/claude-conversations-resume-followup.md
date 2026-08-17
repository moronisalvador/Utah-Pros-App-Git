---
branch: claude/conversations-resume-followup
ships: true
opened: 2026-08-15
---

# What

fix(conversations): finish the desktop resume — silent restore, caret, announce

# Why it matters

#658 fixed the half of the 30s-lease expiry that loses the employee's work. This is
the other half, and it is measured against #658 as merged, not argued: a mounted
test run against dev fails four ways — scroll snapped to the bottom (4x
scrollIntoView), focus dropped to <body> for anyone typing, the verifying state
unannounced, and "you no longer have access" shown as a GREEN success toast
(Layout paints everything except error/warning green; #656 fixed this for tech
only). PR #664.

# Next action

Release lane reviews #664; merge stays owner/release-lane. Then the live minimize test on dev.utahpros.app while signed in.
