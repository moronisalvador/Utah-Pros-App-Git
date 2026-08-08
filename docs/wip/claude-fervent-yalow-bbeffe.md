---
branch: claude/fervent-yalow-bbeffe
ships: true
opened: 2026-08-08
---

# What

fix(qbo): scope payment removal to the QuickBooks realm — adds nullable
`payments.qbo_realm_id`, stamps it in both receipt RPCs and every Worker that
writes `qbo_payment_id`, and makes the void/delete cleanup realm-scoped.

# Why it matters

Money-path deletion keyed on a non-unique value. QBO Payment ids are per-company
sequential counters, so `removeQboPaymentFromUpr()` — matching on
`qbo_payment_id` alone, in BOTH modes — could silently delete a stale
`source='qbo'` row left by a prior QuickBooks connection whose id collided
numerically. No error, no trace (AGENTS.md §15 / Code Review Rule 1).

Worse than first reported: the predicate does not filter `receipt_id`, so it also
reaches receipt PROJECTIONS. Measured live 2026-08-07: 88 rows match — 79 legacy
plus 9 projections. For a foreign realm the realm-scoped RPC removes nothing and
this query would delete that realm's projections anyway, orphaning a
`payment_receipts` header still marked `reconciled`.

No backfill, deliberately: only one realm has ever been observed, but nothing on
record proves the pre-2026-08-07 rows belong to it, so the predicate is
NULL-tolerant instead and the tail self-heals on re-reconcile.

# Next action

1. Disposable-stack qualification proof (in progress) — house practice for a live
   money-RPC body replace, and the owner's stated bar for applying.
2. Owner-gated apply of `20260808070000_payments_qbo_realm_scoping`.
3. ONLY THEN merge into `dev`.

⚠ DEPLOY ORDER IS INVERTED. The Worker both writes and filters on the new column
and PostgREST rejects both without it — the cleanup filter's 400 is not caught, so
merging the code before the migration applies breaks every void and delete against
the shared production database.
