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

1. ~~Run the §5b behavioural proof.~~ **DONE 2026-08-07 — PASSED** at commit `5d7fd841`,
   manifest SHA-256 `0d1feaf3…`. 3 ALLOW + 6 DENY + unmapped + claimless + grants, both
   passes, rollback fail-closed check green. Running it found three defects every static
   check had missed.
2. Wait for `20260807190000_oop_estimate_grouped_lines.sql` to be committed (it is
   uncommitted in the MAIN checkout, session "OOP calculator mobile and invoice issues",
   currently stopped). It replaces the SAME function body.
3. Rebuild `20260807220000`'s body from the frozen grouped-lines body and re-pin the
   drift-guard md5 (`scripts` generator: one-line source swap — the legacy gate block is
   byte-identical in both files). Add grouped-lines to the qualifier's PREDECESSORS and
   re-run. **Grouped-lines itself needs NO edit** — sequencing resolves the collision.
4. Reviewers → `qa-staging` apply → owner-authorized production apply (both migrations,
   one window, timestamp order) → owner smoke test with a real office-role login.
