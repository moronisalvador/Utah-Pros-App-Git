# DB-Foundation Phase P4 — Orphan-data & duplicate external-ID report

**Generated 2026-07-08** against the live shared Supabase (`glsmljpabrwonfiltiqm`), verified
row-by-row against QuickBooks Online and Encircle via the UPR MCP. This is item ① of Phase P4
(`docs/db-foundation-roadmap.md` → Phase P4 block). It is the evidence base for the repair (②),
the UNIQUE constraints (③), the missing FKs (④), and the CHECK constraints (⑤).

> **Headline finding (overturns a roadmap assumption):** the `invoices.qbo_invoice_id` and
> `payments.qbo_payment_id` "duplicates" are **NOT** duplicate rows and **NOT** mislinks. They are
> legitimate **combined-billing** records — one QBO document that spans two UPR jobs, split into two
> UPR rows. NULLing either row would orphan a real, paid, job-linked invoice from its QBO source.
> These two columns therefore **must not** be repaired and **must not** get a plain `UNIQUE`.
> See §2. Only `claims.encircle_claim_id` (4) and `contacts.qbo_customer_id` (1) are genuine
> duplicate-import dedup targets.

---

## 1. Scope — external-ID columns surveyed

25 external-ID columns exist across the schema. Most 1:1 import-identity columns **already carry a
UNIQUE index** from prior migrations (`inbound_leads.callrail_id`, `job_documents.encircle_media_id`,
`job_notes.encircle_note_id`, `rooms.encircle_room_id`, `messages.twilio_sid`,
`payments.stripe_charge_id`). Columns that are foreign *catalog/parent references* (not per-row
identities) are correctly **not** uniqueness candidates: `estimate_line_items.qbo_item_id`/
`qbo_class_id`, `invoice_line_items.qbo_item_id`/`qbo_class_id`, `rooms.encircle_structure_id`,
`forms.encircle_claim_id`, `jobs.encircle_claim_id` (many jobs per claim — see below).

### Duplicate groups found live (non-null values only)

| Column | Dup groups | Rows | Verdict |
|---|---|---|---|
| `jobs.encircle_claim_id` | 67 | 136 | **Not a dup** — many jobs legitimately share one claim. A `UNIQUE(encircle_claim_id, division)` index already enforces the real rule. No action. |
| `invoices.qbo_invoice_id` | 7 | 14 | **Combined billing** (see §2). No repair, no plain UNIQUE. 1 anomaly (`4274`) for owner review. |
| `payments.qbo_payment_id` | 5 | 10 | **Combined billing** (see §2). No repair, no plain UNIQUE. |
| `claims.encircle_claim_id` | 4 | 8 | **Genuine duplicate imports** — repair (§3). |
| `contacts.qbo_customer_id` | 1 | 2 | **Genuine duplicate contact** — repair (§3). |

---

## 2. `invoices.qbo_invoice_id` / `payments.qbo_payment_id` — combined billing, NOT dedup targets

For each duplicate group, the **QBO document's `TotalAmt` equals the SUM of the two UPR rows'
amounts**, and each UPR row carries a distinct `job_id`. That is one QBO invoice/payment covering two
jobs (typical for one insurance claim spanning multiple structures), split per-job inside UPR.

### Invoices (QBO `Invoice.TotalAmt` vs UPR row totals)

| qbo_invoice_id | QBO TotalAmt | UPR rows (invoice_number = total) | Sum matches? |
|---|---|---|---|
| 1921 | 21,339.47 | INV-000033 = 12,359.48 · INV-000034 = 8,979.99 | ✅ 21,339.47 |
| 3559 | 24,699.70 | INV-000083 = 19,989.26 · INV-000082 = 4,710.44 | ✅ 24,699.70 |
| 3960 | 7,788.95 | INV-000077 = 2,919.27 · INV-000078 = 4,869.68 | ✅ 7,788.95 |
| 4196 | 9,497.80 | INV-000084 = 5,385.26 · INV-000085 = 4,112.54 | ✅ 9,497.80 |
| 4309 | 11,670.59 | INV-000029 = 3,745.16 · INV-000011 = 7,925.43 | ✅ 11,670.59 |
| 5210 | 7,801.14 | INV-000046 = 4,719.14 · INV-000045 = 3,082.00 | ✅ 7,801.14 |
| **4274** | **5,275.16** | INV-000080 = 3,522.83 · INV-000079 = 2,757.96 (=6,280.79) | ❌ **anomaly** |

### Payments (QBO `Payment.TotalAmt` vs UPR row amounts) — all 5 sum-match

| qbo_payment_id | QBO TotalAmt | UPR amounts | Sum matches? |
|---|---|---|---|
| 4129 | 2,599.82 | 349.82 + 2,250.00 | ✅ |
| 4673 | 11,670.59 | 7,925.43 + 3,745.16 | ✅ (pays combined invoice 4309) |
| 5211 | 5,461.00 | 4,719.14 + 741.86 | ✅ |
| 5304 | 8,100.37 | 2,957.28 + 5,143.09 | ✅ |
| 5329 | 4,866.48 | 1,890.52 + 2,975.96 | ✅ |

**Decision:** leave both columns unconstrained; do not repair. The correct uniqueness (if ever
wanted) is a composite like `(qbo_invoice_id, job_id)`, which is a data-model change out of P4's
scope. **`invoices.qbo_invoice_id = 4274` is the one true anomaly** (neither row nor the sum matches
the QBO total 5,275.16) — flagged for owner/QBO investigation, NOT auto-repaired.

`estimates.qbo_estimate_id` (0 dups today) is deliberately **excluded** from the UNIQUE work for the
same combined-billing caution — an insurance estimate can be bundled like its invoice. Left
unconstrained pending an owner decision.

---

## 3. Genuine dedup targets — repair plan (RED, item ②; staged, awaits owner OK)

Canonical row was determined authoritatively, not guessed: for claims, from **Encircle's own
`contractor_identifier`** (the CLM number Encircle records for that claim); for contacts, from which
row actually carries downstream references.

**Repair = NULL the external-ID on the NON-canonical row only. Never the canonical row; never a
status or money column.**

### claims.encircle_claim_id (keep the CLM-2606-* row Encircle points to; NULL the older mislink)

| encircle_claim_id | Encircle contractor_identifier (canonical) | Canonical row (keep) | Non-canonical row → NULL encircle_claim_id |
|---|---|---|---|
| 4018951 | CLM-2606-169 (USAA · Julia Grant) | `e8c0ef86-9bf2-4545-be08-313d7b3a80a0` | `cd742f5a-f28b-438d-930a-46feb3f15216` (CLM-2604-046, Cincinnati — a *different* claim) |
| 4077213 | CLM-2606-168 (Bear River · Pablo Díaz) | `32605eee-bf80-41ae-9426-299fb73a419e` | `ff218cae-70b4-4873-8138-1f437bd84836` (CLM-2604-102) |
| 4382559 | CLM-2606-170 (Will Kruger) | `feb39487-6065-4358-9982-ef124428b9cf` | `afa6648f-390c-4af9-b72a-5544e9d0a8b7` (CLM-2603-013) |
| 4392873 | CLM-2606-171 (Chris & Michael Smith) | `5c86b66c-cea8-443a-b61b-b57fb89766bb` | `65b7493f-8a9d-4ddf-95d1-66fd0fc19efb` (CLM-2603-006) |

Both rows in each pair keep their jobs — NULLing `encircle_claim_id` only unlinks the non-canonical
row from Encircle; no job/room/money data is touched. **Owner note:** 4077213 and its pair are the
*same* physical claim (same address/policyholder) and are candidates for a later **claim merge**;
4018951's pair are two *different* carriers at the same address and should stay two claims.

### contacts.qbo_customer_id

| qbo_customer_id | Canonical row (keep) | Non-canonical row → NULL qbo_customer_id |
|---|---|---|
| 531 (Jaren Pope) | `2c97bcce-9d65-41d3-bc9d-9c92aaad8612` (has the claim + email) | `93bd0fc8-2fed-4d11-9b00-c4b909a6ba7b` (0 refs, no email — a stray duplicate) |

**Owner note:** the stray row (`93bd0fc8`) holds the *correct* Utah phone `+18016362823`; the
canonical row has an apparent toll-free typo `+18006362823`. A later **contact merge** should fold
the right phone into the canonical row and delete the stray. P4 only NULLs the duplicate external ID
(narrow scope); the merge is a separate owner action.

---

## 4. Missing foreign keys (item ④)

The schema is already densely FK-covered (200+ existing FKs). Surveying every `_id` column without an
FK, the only genuine missing relational FK is:

- **`notifications.job_id → jobs(id)`** — 0 orphan rows live; sibling `notification_queue.job_id`
  already has this FK. Added `NOT VALID` → `VALIDATE`.

Correctly **left without an FK** (not integrity gaps): polymorphic `entity_id`
(`system_events`/`notifications`/`notification_queue`/`crm_automation_runs`); external-system ids
(`integration_credentials.realm_id`, `email_sync_log.message_id`, `property_meld_melds.*`,
`google_calendar_links.calendar_id`/`source_id`); `form_definitions.public_id` (a public slug);
`time_entry_deletions.entry_id` (an audit log that points at *already-deleted* entries — an FK would
defeat its purpose).

**Orphan `client_id` (investigate, no action):** `rooms.client_id` holds 4 UUIDs that match no
`contacts`/`jobs`/`claims` row (`moisture_readings.client_id`/`equipment_placements.client_id` are
all-NULL). Likely a legacy/Encircle-side identifier. Left unconstrained; flagged for owner.

---

## 5. CHECK constraints (item ⑤)

The schema already enforces the important CHECKs (status enums on invoices/estimates/payments,
`payments.amount > 0`, `pipeline_stages.win_probability ∈ [0,1]`, contact role/method). The remaining
verified integrity gap:

- **`job_time_entries`** duration non-negativity: `hours`, `total_paused_minutes`, `travel_minutes`
  each `IS NULL OR >= 0`. 0 violating rows live; matches the documented time model
  (`hours = clock_out − clock_in − paused`, always ≥ 0) and protects labor-cost math. Added
  `NOT VALID` → `VALIDATE`.

Money non-negativity on `invoices.total`/`estimates` was **considered and deferred** — negatives are
absent today, but a blanket CHECK risks blocking a legitimate future credit/adjustment on the most
sensitive money tables, and adjustments already live in a dedicated `invoice_adjustments` table.

---

## 6. Contested tables (deferred-hardening §8) — disclosure

`claims` and `contacts` are in the ownership manifest's deferred-hardening bucket (Schedule-Desktop
wave, currently **unstarted** — no open PR). Their repair + UNIQUE are RED-tier and owner-gated
regardless, and ship with a committed backward-compat check that the current app's insert path still
succeeds under the new UNIQUE (rolled-back in the SQL gate). `messages.twilio_sid` /
`conversations.twilio_group_sid` (omni-inbox, unbuilt) are **not** touched here — the former is
already UNIQUE; the latter is deferred to that wave.

---

## 7. Apply-window (database-standard.md §5)

P3 (anon closure) is committed to `dev` but **not yet applied live** (161 public `anon` policies
still present) — it is RED-staged awaiting the owner. P3's policy recreates and P4's constraints both
strong-lock the same hot tables (`claims`, `contacts`), so **the owner must apply P4's RED migrations
and P3 in separate windows, not concurrently.** P4's YELLOW migrations (notifications FK,
job_time_entries CHECK, clean UNIQUEs on `forms`/`google_calendar_links`) touch tables P3 also
re-policies but are millisecond `NOT VALID`/index operations and were applied in a discrete window
before any P3 apply.
