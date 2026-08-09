# UPR ↔ QBO invoice drift — verified findings + detector scope

**Date:** 2026-08-04 · **Branch:** `claude/epic-blackburn-d8654f` (worktree off `origin/dev`)
**Status:** investigation **complete and verified live** against both the shared Supabase project
(`glsmljpabrwonfiltiqm`) and QuickBooks. **No write has been made to either system.** No commit,
push or PR.

Root cause class: invoices are **push-only UPR→QBO**. Only payments and estimate answers sync back
(`BILLING-CONTEXT.md` §4). An edit made inside QuickBooks desyncs UPR permanently and silently.

> ## ⚠ Headline: only **2 of the 5** flagged invoices are actually defects
>
> A parallel session swept all 99 `qbo_invoice_id`s and reported 5 drifted invoices, diagnosing
> the Chris Smith pair as an accidental misallocation to be repaired by moving $1,005.63 between
> two invoices. **Reading the actual line items disproves that.** Three of the five differences are
> **deliberate, documented business decisions**. Applying the proposed repair would have reversed a
> prior reconciliation and made job-level attribution *worse*.
>
> Genuine understatement is **$1,073.70**, not $1,212.72.

---

## 1. Verified findings — all five

| # | QBO | Doc | QBO total | UPR | UPR invoice | Delta | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | 4274 | 1222 | 5,275.16 | 6,280.79 | INV-000079 + **INV-000080** | +1,005.63 | ✅ **Not a defect** — deliberate regrouping |
| 2 | 4275 | 1223 | 1,767.22 | 761.59 | INV-000081 | −1,005.63 | ✅ **Not a defect** — same regrouping |
| 3 | 5966 | M-2608-001 | 3,004.98 | 2,865.96 | INV-000115 | −139.02 | ✅ **Not QBO drift** — UPR insurance adjustment |
| 4 | 5967 | R-2608-001 | 13,719.82 | 13,096.12 | INV-000116 | **−623.70** | ❌ **Real drift** — human edited QBO · **STILL OPEN** |
| 5 | 5968 | R-2608-002 | 1,950.00 | ~~1,500.00~~ **1,950.00** | INV-000107 | ~~−450.00~~ **0** | ✅ **FIXED** by the parallel session |

> **Live re-check 2026-08-05 ~02:05Z.** The parallel session filled INV-000107's blank line
> `e0d654a8…` with *"Possible Asbestos & Lead Test - $450"* (item `1`, 450.00). INV-000107 now totals
> 1,950.00 with `balance_due` 0 — matching QBO 5968 exactly. Finding 5 is closed.
>
> **The Chris Smith regrouping survived.** INV-000080 still carries both lines (2,517.20 +
> 1,005.63) with the Q2-2026 reconciliation note intact, and INV-000081 still holds 1,269.31 +
> (−507.72). Their `invoices.updated_at` bumped identically to `02:04:05.750309+00`, but every line
> `created_at` is still `2026-07-07` and no amount moved — so the invoice rows were touched, not the
> line items, and **the destructive two-sided repair was not applied.**
>
> **Finding 4 (INV-000116, −623.70) is still open**, and finding 3 (INV-000115, −139.02) is
> unchanged.

### 1.1 Chris Smith 4274/4275 — deliberate, documented, leave alone

`INV-000080` has **two** line items, not one mispriced line:

| Line | Amount | Description (verbatim from UPR) |
|---|---|---|
| `ae89c93e…` | **2,517.20** | "Scope of Work – Interior Repairs…" — matches QBO 4274 line 2 **exactly** |
| `c1b5a540…` | **1,005.63** | *"Reconstruction charge from QBO invoice 1223 (item Reconstruction/ Remodeling Services), **grouped onto this reconstruction job during Q2-2026 reconciliation**."* |

QBO 4275 line 3 (`Amount 1005.63`, item `1010000201` Reconstruction, **no `Description` field at
all**) was **deliberately moved** off the mold invoice and onto the reconstruction job
`R-2604-066`, because that is where reconstruction revenue belongs. `INV-000081` did not "drop"
line 3 — the line was **relocated on purpose**, and the reason is written into the description.

**QuickBooks never changed — it has been this way since the original estimate.** Estimate **3938**
(DocNumber 1113, TxnDate **2026-03-02**, `TxnStatus: Converted`, `LinkedTxn → Invoice 4275`)
already carries all three lines, including `Id 5` at **1,005.63**, item `1010000201`, account
`1150040005`, **with no `Description` field**. Invoice 4275 mirrors that estimate exactly, and
`LastModifiedByRef` is `"0"` (API/system) on both 4274 and 4275 — **neither was ever human-edited
in QuickBooks**. 4274 links to Estimate 3935; 4275 to Estimate 3938.

So the reconstruction charge was on the mold estimate from day one. QuickBooks billed a
reconstruction charge on a mold invoice; UPR's one-invoice-per-job model re-attributed it to the
reconstruction job. **The per-invoice mismatch is the intended outcome**; the pair still sums to
$7,042.38 on both sides.

> **The proposed two-sided repair is arithmetically self-consistent but operationally regressive.**
> Lowering INV-000080 and adding the line back to INV-000081 does land the pair on $7,042.38 — and
> in doing so pushes reconstruction revenue back onto the *mold* job, which is precisely the
> attribution error the regrouping was created to fix, while deleting the audit note. This is a
> judgment call about attribution, not a data error, and belongs with the owner.

**Applying the proposed repair would have reversed this** — pushing reconstruction revenue back
onto the mold job and destroying the audit note. Do not touch either invoice.

### 1.2 INV-000115 / QBO 5966 — a UPR-side insurance adjustment, not drift

UPR has **two** lines; QBO has one:

| | Amount | Item |
|---|---|---|
| UPR line 1 | 3,004.98 | `1010000131` Mold Remediation — **matches QBO exactly** |
| UPR line 2 | **−139.02** | `1010000231` — *"Insurance adjustments"* |
| QBO | 3,004.98 | single line |

`1010000231` is `QBO_INSURANCE_ADJUSTMENT_ITEM_ID` (`BILLING-CONTEXT.md` §4). This is a deliberate
UPR-recorded write-down that was never pushed to QuickBooks — the opposite direction from the other
findings.

**The sales-tax theory is dead.** The 4.85% resemblance was numerology: `2865.96 × 1.0485 =
3004.96`, two cents off the actual 3,004.98, and the real cause is an adjustment line. Good thing
it was checked rather than assumed.

**Decision needed:** either push the adjustment to QuickBooks so QBO reflects the write-down, or
remove it from UPR if it was never agreed. Not a mechanical fix — an owner call.

### 1.3 INV-000116 / QBO 5967 — **real drift, human-edited in QuickBooks**

The smoking gun is in QBO metadata:

```
"MetaData": { "CreateTime": "2026-08-03T08:30:45-07:00",
              "LastModifiedByRef": { "value": "9341456427913786" },
              "LastUpdatedTime": "2026-08-03T16:38:55-07:00" }
```

`LastModifiedByRef.value` is a **real user id**. On the untouched invoices it is `"0"` (API/system).
So a person opened QuickBooks on 2026-08-03 and raised this invoice from **13,096.12 → 13,719.82**;
UPR never heard about it. Same single line, same description
(*"Reconstruction and repairs per final Xactimate estimate BERRETT_ALLISON-REP."*), different
amount.

QBO Balance 11,219.82 = 13,719.82 − 2,500, and UPR holds a matching 2,500 payment — so payments are
consistent; only the invoice amount is stale.

**Fix:** UPR line `550ce7a4…` `unit_price` 13,096.12 → **13,719.82**.

### 1.4 INV-000107 / QBO 5968 — **real drift, UPR missing a whole line**

QBO 5968 has two lines; UPR has one real line plus an empty placeholder:

| | Amount | Item |
|---|---|---|
| QBO line 1 | 1,500.00 | `1010000071` Water Damage Mitigation |
| QBO line 2 | **450.00** | `1` Testing Mold/Asbestos/Sewer — *"Possible Asbestos & Lead Test - $450"* |
| UPR line `60554556…` | 1,500.00 | `1010000071` |
| UPR line `e0d654a8…` | **0.00** | blank — the editor's auto-inserted empty row |

`amount_paid` is 1,950.00 (a real payment row) against a 1,500.00 total, so `balance_due` is
currently **−450.00**. Adding the missing line fixes the total *and* the negative balance.

`LastModifiedByRef` is `"0"`, so this was API-side, not a human QBO edit — the $450 line was added
to QBO minutes after creation and UPR's mirror never caught up.

**Fix:** add the 450.00 line to INV-000107; optionally remove the blank 0.00 row.

---

## 2. Item 2 — the duplicate DocNumber, solved

Two *different customers* carry DocNumber `R-2608-002`:

| QBO | Customer | TxnDate | UPR invoice | UPR job | UPR `qbo_doc_number` |
|---|---|---|---|---|---|
| 5964 | **577 Jennifer Hansen** | 2026-07-27 | INV-000113 | **R-2608-002** | R-2608-002 ✅ |
| 5968 | **590 Silvina Wright** | 2026-08-03 | INV-000107 | **W-2607-044** | **R-2608-002** ❌ |

**The cause is a wrong `qbo_doc_number` on INV-000107.** Its job is `W-2607-044` (water division),
but its `qbo_doc_number` was set to `R-2608-002`. Per
[`qbo-invoice.js:145`](../functions/api/qbo-invoice.js) the worker **reuses
`inv.qbo_doc_number` verbatim** whenever it is set — the `-N` auto-suffix only runs when that column
is `NULL`. So the worker faithfully pushed the duplicate, and QuickBooks accepted it
(`LastModifiedByRef "0"`, no 6140 retry).

INV-000113/5964 reconciles to the cent and is the legitimate holder of `R-2608-002`.

**This is not the guide §2 `<job#>-2` case.** That rule covers a *second invoice on the same job*
(a supplement). Here the number is simply **wrong for the job**. The correct fix is
`W-2607-044`, not `R-2608-002-2`:

- UPR: `invoices.qbo_doc_number` `R-2608-002` → `W-2607-044` on INV-000107
- QBO: `qbo_update_entity('Invoice','5968',{DocNumber:'W-2607-044'})`

**Both are owner-gated; the QBO rename is a write to QuickBooks.** Also worth checking whether the
company's *"Warn if duplicate invoice number is used"* preference is off, since QBO accepted the
collision without complaint.

---

## 2bis. Why QuickBooks accepted the duplicate — and the guard UPR needs

**Read live from `Preferences` (SyncToken 22):**

- `SalesFormsPrefs.CustomTxnNumbers: true` — custom numbers are on, so `DocNumber` is honoured.
- `WarnDuplicateCheckNumber: true`, `WarnDuplicateBillNumber: false`, `WarnDuplicateJournalNumber: false`
- **There is no duplicate-*invoice*-number preference at all.** QBO exposes duplicate-warning
  settings for checks, bills and journals — not invoices.

So the collision was not "a warning someone switched off." **QuickBooks did not enforce invoice
`DocNumber` uniqueness on the API path**, and the 6140 retry in
[`qbo-invoice.js:324`](../functions/api/qbo-invoice.js) never fired because no error was raised.

**Conclusion: UPR cannot rely on QuickBooks to catch this. The guard has to be UPR-side.**

### Proposed guard at [`qbo-invoice.js:145`](../functions/api/qbo-invoice.js)

Today:

```js
let docNumber = inv.qbo_doc_number || null;
if (!docNumber && job.job_number) { /* … siblings → job_number or job_number-N … */ }
```

A stored `qbo_doc_number` is reused **verbatim and unvalidated**. Suggested addition: before reuse,
assert the stored value belongs to this job — `docNumber === job.job_number` or
`docNumber.startsWith(job.job_number + '-')`. If it does not, fail closed with an explicit error
naming both values rather than pushing another customer's number into QuickBooks. That single check
would have stopped INV-000107 (`R-2608-002` on job `W-2607-044`) at the door.

This is a **proposal only** — no worker change authored, no test written, nothing applied.

### Remediation sequence for INV-000107 / QBO 5968 (author-only; **not executed**)

The ordering matters, because fixing UPR alone creates a fresh mismatch:

1. **QBO first** — `qbo_update_entity('Invoice','5968',{DocNumber:'W-2607-044'})` (SyncToken 2).
   **Owner-gated: a write to QuickBooks.**
2. **UPR second** — `invoices.qbo_doc_number` `R-2608-002` → `W-2607-044` on INV-000107.
3. Re-verify: QBO 5964 remains the sole `R-2608-002`; INV-000113 still reconciles at 10,163.54.

Doing UPR first would leave UPR saying `W-2607-044` while QBO still says `R-2608-002` — swapping one
mismatch for another. Doing QBO first means the worst intermediate state is the one that already
exists today.

Correct target is **`W-2607-044`**, not `R-2608-002-2`: guide §2's `-N` suffix covers a *second
invoice on the same job*, and this is simply a foreign number on the wrong job.

---

## 3. Incidental: `amount_paid` set with zero payment rows

`INV-000079`, `INV-000080`, `INV-000081` and `INV-000115` all carry non-zero `amount_paid` with
**zero rows in `payments`**:

| Invoice | total | amount_paid | payment rows |
|---|---|---|---|
| INV-000079 | 2,757.96 | 2,757.96 | **0** |
| INV-000080 | 3,522.83 | 3,522.83 | **0** |
| INV-000081 | 761.59 | 761.59 | **0** |

`amount_paid` is documented as trigger-recomputed from `payments`, so these were seeded directly by
an earlier backfill. Consequence: **`amount_paid` cannot be assumed to follow `total`** on
historical rows, and any total change on such a row silently moves `balance_due`. Not a defect to
fix here — a caveat for whoever edits these next, and an argument for the detector to report
`amount_paid`-without-payments as its own category.

---

## 4. Schema facts (verified live + repository source)

| Fact | Evidence |
|---|---|
| `invoice_line_items` has **no `updated_at`** — writing it errors `42703` | `db/baseline/schema.sql` |
| `line_total numeric GENERATED ALWAYS AS ((quantity * unit_price)) STORED` | `db/baseline/schema.sql` |
| `invoices.balance_due GENERATED ALWAYS AS ((total - amount_paid)) STORED` | `db/baseline/schema.sql` |
| `quantity`/`unit_price` edits fire `trg_invoice_lines_total` → `recompute_invoice_from_lines()`, writing `invoices.subtotal`, `total`, `updated_at` | [`20260619_invoice_line_items_qbo.sql:13-38`](../supabase/migrations/20260619_invoice_line_items_qbo.sql) |
| **No unique index on `invoices.qbo_invoice_id`** — several UPR invoices may mirror one QBO invoice | `db/baseline/schema.sql` (only `invoices_pkey`) |
| `invoice_line_items.description` is **NOT NULL** | `db/baseline/schema.sql` |
| `invoices.tax` is a plain column and **no trigger recomputes `total` from it** | five triggers on `invoices`, none touches `total` |

**House pattern for a bounded production repair:**
[`20260727222000_dorothy_killian_downstairs_reconstruction_repair.sql`](../supabase/migrations/20260727222000_dorothy_killian_downstairs_reconstruction_repair.sql)
— advisory xact lock → `FOR UPDATE` in deterministic order → identity drift guards → idempotent
no-op check → pre-state guards → write only non-generated columns → postcondition assertions, with
a paired rollback declaring fixed UUIDs.

---

## 5. Item 3 — drift detector (scope only; not built)

### 5.1 What exists, and why it missed all five

`reconcile_qbo` at [`collections-chat.js:413`](../functions/api/collections-chat.js) already diffs
UPR against QuickBooks, but:

| Limit | Evidence | Consequence |
|---|---|---|
| QBO side `WHERE Balance > '0'` | `collections-chat.js:417` | paid invoices invisible |
| UPR side `balance > 0.005` | `collections-chat.js:416` | closed invoices invisible |
| compares **balance**, never **total** | `collections-chat.js:436-437` | a wrong total that is fully paid nets to zero and looks clean |

4274, 4275 and 5968 are all `Balance 0`. Structurally invisible. It is also ephemeral chat output
capped at 30 rows per category.

### 5.2 The hard lesson: **most differences are legitimate**

3 of 5 flagged rows were correct data. A detector that reports raw total deltas as "errors" would
have a **60% false-positive rate on this very sample** and would be ignored within a month. It must
classify, not just diff.

Signals available for free, all confirmed in this investigation:

1. **`QBO.MetaData.LastUpdatedTime` vs `invoices.qbo_synced_at`** — if QuickBooks was updated
   **later** than UPR last pushed, the change came from outside UPR. This is the reliable signal.
   Verified on this data:

   | Invoice | QBO `LastUpdatedTime` (UTC) | UPR `qbo_synced_at` | Reading |
   |---|---|---|---|
   | 4274 / 4275 | 2026-04-28 20:49:48 | 2026-06-29 23:10:24 | QBO older → no external edit ✓ |
   | 5967 (before) | 2026-08-03 23:38:55 | 2026-08-03 ~15:26 | **QBO newer → external edit** ✓ |
   | 5967 (now) | 2026-08-05 00:49:57 | 2026-08-05 00:49:57.701 | equal → change came from UPR ✓ |

   > **Correction to an earlier claim in this document.** I first proposed
   > `MetaData.LastModifiedByRef` as the primary signal — `"0"` = API/system, a numeric id = a human
   > in the QBO UI. **That is not reliable.** UPR's own push to 5967 on 2026-08-04 also stamped
   > `9341456427913786`, because UPR's OAuth connection is bound to a real Intuit user. The field
   > cannot separate "human edited in QuickBooks" from "UPR worker pushed". Timestamp comparison can.
   > `LastModifiedByRef` is still worth showing as supporting context; it must not be the test.
2. **UPR-only adjustment items** — a UPR line whose `qbo_item_id` is `1010000231`
   (insurance adjustment) or `43` (discounts) explains a negative delta as deliberate (1.2).
3. **Regrouping notes** — a UPR line describing a transfer from another QBO invoice (1.1). Worth
   formalising: a structured marker beats grepping a description.
4. **Line-count / line-amount comparison**, not just header totals — that is what distinguished
   "missing a whole line" (5968) from "line amount changed" (5967).

### 5.3 Core comparison

Because `qbo_invoice_id` is not unique, aggregate the UPR side and compare sums:

```sql
SELECT i.qbo_invoice_id,
       count(*)                                 AS upr_invoice_count,
       sum(COALESCE(i.adjusted_total, i.total)) AS upr_billable_total,
       array_agg(i.invoice_number ORDER BY i.invoice_number) AS upr_invoice_numbers
FROM invoices i
WHERE i.qbo_invoice_id IS NOT NULL
GROUP BY i.qbo_invoice_id;
```

Then join to QBO `Id`, tolerance $0.01, and **classify** each delta using 5.2 before reporting.

### 5.4 Categories

1. `qbo_human_edited` — delta **and** `LastModifiedByRef <> '0'` → **real drift, highest priority**
2. `upr_missing_line` — QBO line count > UPR, no matching UPR line
3. `upr_only_adjustment` — delta explained by a UPR adjustment/discount item → informational
4. `deliberate_regrouping` — UPR line references another QBO invoice → informational
5. `duplicate_doc_number` — one DocNumber across >1 QBO Id
6. `doc_number_mismatch` — `qbo_doc_number` ≠ job number **or** ≠ QBO DocNumber (would have caught
   INV-000107 before it ever collided)
7. `qbo_missing` — UPR references a `qbo_invoice_id` QBO no longer returns
8. `paid_without_payments` — `amount_paid > 0` with zero `payments` rows (§3)

### 5.5 Deliberately not flagged

Payment over-allocation. INV-000041 / R-2604-020 (A2Z, QBO 5461) shows `amount_paid` $27,861.99
against a $25,984.21 total because QBO Payment 5778 holds `UnappliedAmt` $1,877.78 as credit for a
supplement. QuickBooks is right; UPR cannot represent a partial allocation. Already answered by the
**`payment_receipts`** schema (live under ledger `20260731225654_qbo_multi_invoice_payment_receipts`,
rollout-disabled behind `feature:qbo_receive_payment` / `QBO_RECEIVE_PAYMENT_ENABLED` /
`VITE_QBO_RECEIVE_PAYMENT_UI_ENABLED`). Reference it; do not build a parallel mechanism.

### 5.6 Where it lives, and delivery

**Not in Postgres** — pg_cron/pg_net cannot call the QuickBooks API; `qbo_payments_sync_poll()` only
*wakes a Worker* over an allowlisted URL. The DB supplies the 5.3 aggregate; a Worker fetches QBO
(paging `STARTPOSITION`/`MAXRESULTS 1000` to exhaustion) and classifies.

| | Option | Notes |
|---|---|---|
| **A** | Ad-hoc read-only report | Effectively run twice now; baseline is **5 flagged / 99, of which 2 real** |
| **B** | Admin Worker `functions/api/qbo-drift-report.js` + Collections button | Active-internal-admin Bearer only (S1a/S1b + `workers-standard.md` §1), `fetchWithTimeout`, one `worker_runs` row, **read-only in both systems** |
| **C** | pg_cron → pg_net wake, on the `qbo_payments_sync_poll()` fail-closed allowlist pattern | Only after B runs quiet |

**Recommendation: B, skipping further manual A runs.** The classification in 5.2 is the whole value
and it cannot be done by eye at scale — this investigation took a full session for 5 rows.

---

## 6. Recommended actions

| Action | System | Status |
|---|---|---|
| INV-000107 add 450.00 line (item `1`, Testing Mold/Asbestos/Sewer) | UPR | ✅ **DONE** by the parallel session, ~02:05Z |
| INV-000116 line `550ce7a4…` `unit_price` → 13,719.82 | UPR | **OPEN — awaiting owner OK** |
| INV-000107 `qbo_doc_number` → `W-2607-044` | UPR | **OPEN — awaiting owner OK** |
| QBO 5968 `DocNumber` → `W-2607-044` | **QuickBooks** | **OPEN — awaiting owner OK** |
| INV-000115 −139.02 insurance adjustment | either | **owner decision** — push to QBO or drop |
| 4274 / 4275 Chris Smith | — | **do nothing** — deliberate, documented; confirmed still intact |
| INV-000041 A2Z | — | **do nothing** — confirmed correct |

Remaining genuine understatement: **$623.70** (INV-000116 only).

## 7. Honest status

Everything above is **verified live** — QBO entities read directly, UPR read via Supabase
`execute_sql` against `glsmljpabrwonfiltiqm`. `upr_sql` is permission-blocked in this session;
`upr_select`/`execute_sql` and the `qbo_*` reads work.

**No UPR write, no QuickBooks write, no migration applied, no commit, push or PR.** This file is
uncommitted in the worktree.
