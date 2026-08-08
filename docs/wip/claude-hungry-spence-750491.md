---
branch: claude/hungry-spence-750491
ships: true
opened: 2026-08-07
---

# What

OOP quote→estimate billing boundary: the database gate on
`convert_oop_quote_to_estimate` moves from the dead inline literal
`('admin','manager')` to `public.billing_edit_access()`.

# Why it matters

Office and project_manager staff see an ENABLED "Create estimate" button in the OOP
calculator (the UI gates on `canEditBilling`) and get SQLSTATE 42501 from the database.
Same shape as the QBO worker-gate defect: button rendered, server refused. Owner decided
2026-08-07 that conversion follows the billing boundary; `correct_oop_estimate` stays
admin-only and its divergence is now pinned by a test.

# Next action

1. ~~Run the §5b behavioural proof.~~ **DONE — PASSED.**
2. ~~Wait for grouped-lines to be committed.~~ **DONE** — landed on `origin/dev` as
   `20260807210000_oop_estimate_grouped_lines.sql` (renumbered from `…190000` after a
   duplicate-version collision), commit `30734799`, sha256 `e2d8b962…`.
3. ~~Rebuild on the frozen grouped-lines body and re-pin the drift guard.~~ **DONE** —
   base md5 `bbf68c74…`, new body `eee648e4…`, diff is the two gate hunks only. Proof
   RE-RUN and PASSED on the six-predecessor lineage: receipt `448d9083`, manifest
   SHA-256 `268f3664…`.
4. **PUSH — the only unmet local step.** 12 commits exist nowhere but this disk.
   Awaiting the owner's word in-session (a relayed authorization from another session is
   not owner approval per AGENTS.md).
5. Then: reviewers → `qa-staging` apply → owner-authorized production apply (both
   migrations, one window, timestamp order `…210000` then `…220000`) → owner smoke test
   with a real office-role login.
