-- ════════════════════════════════════════════════
-- SCRIPT: backfill-recon-invoice-lines.sql
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Restores the missing line items on 35 invoices that were imported from
--   QuickBooks during the Q2-2026 reconciliation with their totals but WITHOUT
--   their line detail (surfaced as "amount due, no line items"). Each invoice's
--   lines are taken from its QBO source invoice, so they sum to the penny to the
--   total the invoice already shows. Because the sum is identical, the recompute
--   trigger leaves every total/balance/status unchanged — this only fills in the
--   line detail that was supposed to be there.
--
--   APPLIED to the shared Supabase (project glsmljpabrwonfiltiqm) on 2026-07-07:
--   35 invoices, 50 line rows. This file is the reproducible record and mirrors
--   exactly what was inserted (re-running is a safe no-op — see Idempotent below).
--
-- SAFETY (why this cannot corrupt a financial figure):
--   * Runs in ONE transaction (a single DO block) — all 35 succeed or NOTHING
--     is written (all-or-nothing).
--   * Per invoice it captures the pre-existing `total`, inserts the lines (which
--     fires recompute_invoice_from_lines -> total = SUM(line_total)+tax), then
--     ASSERTS the new total equals the old one to the cent. Any drift raises an
--     exception and rolls the whole thing back.
--   * Idempotent: skips any invoice that already has line items, so re-running
--     is a no-op.
--   * Never writes the GENERATED column line_total (DB derives it from qty*price).
--
-- KEYED BY UUID, not invoice_number: INV-000062 exists twice (a paid QBO-4291
--   import AND a separate $0 draft). The map below targets ONLY the 4291 row.
--
-- OFFSETTING PAIR (INV-000080 / INV-000081, both paid): QBO invoice 4275 (doc 1223)
--   spans mold + a $1,005.63 reconstruction charge. During reconciliation that recon
--   charge was grouped onto INV-000080 (the reconstruction job) so both paid headers
--   stay intact. It is therefore restored on INV-000080, not INV-000081.
--
-- REVERSAL (if ever needed): DELETE the inserted lines AND restore the frozen
--   header totals (deleting lines would otherwise recompute total to 0). The
--   before-state totals are recorded in the PR / Q2-RECON-TASK.md. Template:
--     DELETE FROM invoice_line_items WHERE invoice_id IN (<the 35 uuids>);
--     UPDATE invoices SET subtotal = <orig>, total = <orig> WHERE id = <uuid>;  -- per row
--
-- Source of line data: each invoice's QBO Invoice.Line[] (SalesItemLineDetail),
--   category mapped from the QBO ItemRef (mitigation/reconstruction/mold/testing/
--   contents/discount). See BILLING-AR-CONSUMER-CHAIN.md §4/§5/§6b.
-- ════════════════════════════════════════════════

DO $backfill$
DECLARE
  v_payload jsonb := $payload$
[
  { "invoice_number": "INV-000059", "expected_total": 7553.9, "lines": [
    { "description": "998 W 430 N, Lehi UT ", "quantity": 1, "unit_price": 9162.98, "item_id": "1010000071", "item_name": "Water Damage:Water Damage Mitigation And Drying", "class_id": null, "class_name": null, "category": "mitigation", "sort_order": 0 },
    { "description": "Settlement", "quantity": 1, "unit_price": -1609.08, "item_id": "1010000231", "item_name": "Discounts:Insurance Adjustments", "class_id": null, "class_name": null, "category": "discount", "sort_order": 1 } ] },
  { "invoice_number": "INV-000076", "expected_total": 1600.0, "lines": [
    { "description": "Canless lights.", "quantity": 1, "unit_price": 1600, "item_id": "37", "item_name": "Reconstruction:Repairs, plumbing, electrical and Handyman Services", "class_id": null, "class_name": null, "category": "reconstruction", "sort_order": 0 } ] },
  { "invoice_number": "INV-000049", "expected_total": 29706.95, "lines": [
    { "description": "Insurance Work - Reconstruction", "quantity": 1, "unit_price": 27914.56, "item_id": "1010000201", "item_name": "Reconstruction:Reconstruction/ Remodeling Services", "class_id": "1000000003", "class_name": "Reconstruction", "category": "reconstruction", "sort_order": 0 },
    { "description": "Supplemental ", "quantity": 1, "unit_price": 1792.39, "item_id": "1010000201", "item_name": "Reconstruction:Reconstruction/ Remodeling Services", "class_id": "1000000003", "class_name": "Reconstruction", "category": "reconstruction", "sort_order": 1 } ] },
  { "invoice_number": "INV-000070", "expected_total": 2250.0, "lines": [
    { "description": "Mold Remediation – Full Downstairs Bathroom & Adjacent Areas (containment, HEPA, antimicrobial treatment, drying, sealing per IICRC S520). Down from $4,824.64 — insurance paid part of the demolition.", "quantity": 1, "unit_price": 1500, "item_id": "1010000131", "item_name": "Mold:Mold Remediation Services", "class_id": null, "class_name": null, "category": "mold", "sort_order": 0 },
    { "description": "Testing for Asbestos & Lead", "quantity": 1, "unit_price": 750, "item_id": "1", "item_name": "Testing Mold/ Asbestos/ Sewer Services", "class_id": null, "class_name": null, "category": "testing", "sort_order": 1 } ] },
  { "invoice_number": "INV-000086", "expected_total": 1000.0, "lines": [
    { "description": "Deductible - $1,000", "quantity": 1, "unit_price": 1000, "item_id": "1010000201", "item_name": "Reconstruction:Reconstruction/ Remodeling Services", "class_id": null, "class_name": null, "category": "reconstruction", "sort_order": 0 } ] },
  { "invoice_number": "INV-000062", "expected_total": 11890.52, "lines": [
    { "description": "Reconstruction / Remodeling Services", "quantity": 1, "unit_price": 11890.52, "item_id": "1010000201", "item_name": "Reconstruction:Reconstruction/ Remodeling Services", "class_id": null, "class_name": null, "category": "reconstruction", "sort_order": 0 } ] },
  { "invoice_number": "INV-000075", "expected_total": 1600.0, "lines": [
    { "description": "Floor Leveling", "quantity": 1, "unit_price": 1600, "item_id": "1010000201", "item_name": "Reconstruction:Reconstruction/ Remodeling Services", "class_id": null, "class_name": null, "category": "reconstruction", "sort_order": 0 } ] },
  { "invoice_number": "INV-000074", "expected_total": 2085.08, "lines": [
    { "description": "Based on Insurance Pricing", "quantity": 1, "unit_price": 2085.08, "item_id": "40", "item_name": "Contents:Pack out/ Pack in", "class_id": null, "class_name": null, "category": "contents", "sort_order": 0 } ] },
  { "invoice_number": "INV-000066", "expected_total": 5674.8, "lines": [
    { "description": "Bathroom floor replacement (tear out tile/mortar/underlayment, remove & reset vanity and toilet, level floor, detach/reinstall baseboards, install new flooring incl. material).", "quantity": 1, "unit_price": 2341.36, "item_id": "1010000201", "item_name": "Reconstruction:Reconstruction/ Remodeling Services", "class_id": null, "class_name": null, "category": "reconstruction", "sort_order": 0 },
    { "description": "New outlets in office", "quantity": 1, "unit_price": 350, "item_id": "1010000201", "item_name": "Reconstruction:Reconstruction/ Remodeling Services", "class_id": null, "class_name": null, "category": "reconstruction", "sort_order": 1 },
    { "description": "Replace office flooring for Vinyl planks", "quantity": 1, "unit_price": 1993.44, "item_id": "1010000201", "item_name": "Reconstruction:Reconstruction/ Remodeling Services", "class_id": null, "class_name": null, "category": "reconstruction", "sort_order": 2 },
    { "description": "Replace door jambs and align them.", "quantity": 1, "unit_price": 990, "item_id": "1010000201", "item_name": "Reconstruction:Reconstruction/ Remodeling Services", "class_id": null, "class_name": null, "category": "reconstruction", "sort_order": 3 } ] },
  { "invoice_number": "INV-000060", "expected_total": 2000.0, "lines": [
    { "description": "Insurance handling, estimate and settlement", "quantity": 1, "unit_price": 2000, "item_id": "1010000201", "item_name": "Reconstruction:Reconstruction/ Remodeling Services", "class_id": null, "class_name": null, "category": "reconstruction", "sort_order": 0 } ] },
  { "invoice_number": "INV-000051", "expected_total": 900.0, "lines": [
    { "description": "Set up airtight chamber, and negative air pressure through a HEPA filter, Remove baseboard, cut paneling and drywall to check for mold, HEPA vacuum area, treat surfaces with antimicrobial, then run HEPA air scrubber for 24 hours.", "quantity": 1, "unit_price": 425, "item_id": "1010000131", "item_name": "Mold:Mold Remediation Services", "class_id": null, "class_name": null, "category": "mold", "sort_order": 0 },
    { "description": "Reinstall baseboards, calk, seal and paint, then Stretch and reinstall carpets and follow with deep steam cleaning.", "quantity": 1, "unit_price": 475, "item_id": "1010000201", "item_name": "Reconstruction:Reconstruction/ Remodeling Services", "class_id": null, "class_name": null, "category": "reconstruction", "sort_order": 1 } ] },
  { "invoice_number": "INV-000058", "expected_total": 6000.0, "lines": [
    { "description": "Set up containment and Decon chamber to Remediate mold found in bathroom, part of bedroom and shower.\nTear out and dispose of unsalvageable materials, mechanically remove mold from framing, using a metal wire brush, and follow with sanding, then HEPA vacuum all surfaces treat with antimicrobial for microbial growth prevention, apply mold stain remover to framing (2 applications in 24 hours), set up HEPA filter and air scrubber to perform air exchanges and reduce spores count to acceptable levels.\nTear out shower and subfloor affected inside of the bathroom.\n\nThis scope of work and pricing is limited to the mold encountered up to this point, and limited to the bathroom, shower area and part of the bedroom. \n", "quantity": 1, "unit_price": 6000, "item_id": "1010000131", "item_name": "Mold:Mold Remediation Services", "class_id": null, "class_name": null, "category": "mold", "sort_order": 0 } ] },
  { "invoice_number": "INV-000067", "expected_total": 1480.0, "lines": [
    { "description": "Bedroom 1 and bedroom 2 - Setup containment and negative air chamber, protect all flooring with plastic, remove affected baseboards and drywall, HEPA vacuum affected framing, sand framing to remove remaining mold staining and treat framing with anti-microbial treatment, then set up equipment to dry for 3 days.", "quantity": 1, "unit_price": 785, "item_id": "1010000131", "item_name": "Mold:Mold Remediation Services", "class_id": null, "class_name": null, "category": "mold", "sort_order": 0 },
    { "description": "Bathroom - Setup containment and negative air chamber, protect all flooring with plastic, HEPA vacuum affected framing, sand framing to remove remaining mold staining and treat framing with anti-microbial treatment. Dispose of vanity and baseboards. Drying billed to insurance as part of another project.", "quantity": 1, "unit_price": 695, "item_id": "1010000131", "item_name": "Mold:Mold Remediation Services", "class_id": null, "class_name": null, "category": "mold", "sort_order": 1 } ] },
  { "invoice_number": "INV-000064", "expected_total": 2530.39, "lines": [
    { "description": "Mitigation", "quantity": 1, "unit_price": 2530.39, "item_id": "1010000071", "item_name": "Water Damage:Water Damage Mitigation And Drying", "class_id": null, "class_name": null, "category": "mitigation", "sort_order": 0 } ] },
  { "invoice_number": "INV-000061", "expected_total": 4198.81, "lines": [
    { "description": "Materials - paneling, molding, paint.", "quantity": 1, "unit_price": 1012.5, "item_id": "1010000201", "item_name": "Reconstruction:Reconstruction/ Remodeling Services", "class_id": null, "class_name": null, "category": "reconstruction", "sort_order": 0 },
    { "description": "Labor - Paneling and Trim Installation - Painting Paneling and Trim.", "quantity": 1, "unit_price": 2936.31, "item_id": "1010000201", "item_name": "Reconstruction:Reconstruction/ Remodeling Services", "class_id": null, "class_name": null, "category": "reconstruction", "sort_order": 1 },
    { "description": "4 Drywall Repairs, including drywall, tape, mud, texture, paint.", "quantity": 1, "unit_price": 250, "item_id": "1010000201", "item_name": "Reconstruction:Reconstruction/ Remodeling Services", "class_id": null, "class_name": null, "category": "reconstruction", "sort_order": 2 } ] },
  { "invoice_number": "INV-000065", "expected_total": 2797.82, "lines": [
    { "description": "Asbestos Abatement of positive drywall", "quantity": 1, "unit_price": 2047.82, "item_id": "1010000071", "item_name": "Water Damage:Water Damage Mitigation And Drying", "class_id": null, "class_name": null, "category": "mitigation", "sort_order": 0 },
    { "description": "Mitigation of water damage. Remove all affected padding, clean up mold, dry framing, carpet and concrete and treat for material growth.", "quantity": 1, "unit_price": 750, "item_id": "1010000071", "item_name": "Water Damage:Water Damage Mitigation And Drying", "class_id": null, "class_name": null, "category": "mitigation", "sort_order": 1 } ] },
  { "invoice_number": "INV-000052", "expected_total": 4276.0, "lines": [
    { "description": "Water Damage Mitigation and Drying", "quantity": 1, "unit_price": 4276, "item_id": "1010000071", "item_name": "Water Damage:Water Damage Mitigation And Drying", "class_id": null, "class_name": null, "category": "mitigation", "sort_order": 0 } ] },
  { "invoice_number": "INV-000053", "expected_total": 7964.39, "lines": [
    { "description": "Water Damage Mitigation and Drying", "quantity": 1, "unit_price": 7964.39, "item_id": "1010000071", "item_name": "Water Damage:Water Damage Mitigation And Drying", "class_id": null, "class_name": null, "category": "mitigation", "sort_order": 0 } ] },
  { "invoice_number": "INV-000054", "expected_total": 9154.69, "lines": [
    { "description": "Reconstruction / Repair Services", "quantity": 1, "unit_price": 9154.69, "item_id": "1010000201", "item_name": "Reconstruction:Reconstruction/ Remodeling Services", "class_id": null, "class_name": null, "category": "reconstruction", "sort_order": 0 } ] },
  { "invoice_number": "INV-000055", "expected_total": 5400.0, "lines": [
    { "description": "Water Damage Mitigation and Drying", "quantity": 1, "unit_price": 5400, "item_id": "1010000071", "item_name": "Water Damage:Water Damage Mitigation And Drying", "class_id": null, "class_name": null, "category": "mitigation", "sort_order": 0 } ] },
  { "invoice_number": "INV-000056", "expected_total": 8000.0, "lines": [
    { "description": "Reconstruction / Repair Services", "quantity": 1, "unit_price": 8000, "item_id": "1010000201", "item_name": "Reconstruction:Reconstruction/ Remodeling Services", "class_id": null, "class_name": null, "category": "reconstruction", "sort_order": 0 } ] },
  { "invoice_number": "INV-000057", "expected_total": 13513.63, "lines": [
    { "description": "Reconstruction / Repair Services", "quantity": 1, "unit_price": 13513.63, "item_id": "1010000201", "item_name": "Reconstruction:Reconstruction/ Remodeling Services", "class_id": null, "class_name": null, "category": "reconstruction", "sort_order": 0 } ] },
  { "invoice_number": "INV-000063", "expected_total": 2975.96, "lines": [
    { "description": "Water Damage Mitigation and Drying", "quantity": 1, "unit_price": 2975.96, "item_id": "1010000071", "item_name": "Water Damage:Water Damage Mitigation And Drying", "class_id": "1000000005", "class_name": "Mitigation", "category": "mitigation", "sort_order": 0 } ] },
  { "invoice_number": "INV-000068", "expected_total": 7731.22, "lines": [
    { "description": "Water damage mitigation and drying (water portion split from combined invoice 1227, 1295 Oquirrh Dr).", "quantity": 1, "unit_price": 7731.22, "item_id": "1010000071", "item_name": "Water Damage:Water Damage Mitigation And Drying", "class_id": null, "class_name": null, "category": "mitigation", "sort_order": 0 } ] },
  { "invoice_number": "INV-000071", "expected_total": 3400.0, "lines": [
    { "description": "Upstairs bathroom — Asbestos abatement: tear out entire shower lead tiles; asbestos abatement flood cuts on all walls; tear out tile floors; clean up area, treat with mechanical microbial removal followed by antimicrobial treatment and drying.", "quantity": 1, "unit_price": 3400, "item_id": "1010000071", "item_name": "Water Damage:Water Damage Mitigation And Drying", "class_id": null, "class_name": null, "category": "mitigation", "sort_order": 0 } ] },
  { "invoice_number": "INV-000087", "expected_total": 10538.19, "lines": [
    { "description": "Water Damage Mitigation & Drying — State Farm claim 44-9757-66Z, loss 3/11/2026 (insured Paul R. Engemann II). Reconciled from Wells Fargo desktop check deposit 6/18/2026.", "quantity": 1, "unit_price": 10538.19, "item_id": "1010000071", "item_name": "Water Damage:Water Damage Mitigation And Drying", "class_id": "1000000005", "class_name": "Mitigation", "category": "mitigation", "sort_order": 0 } ] },
  { "invoice_number": "INV-000082", "expected_total": 4710.44, "lines": [
    { "description": "Approved Insurance Pricing", "quantity": 1, "unit_price": 4710.44, "item_id": "1010000071", "item_name": "Water Damage:Water Damage Mitigation And Drying", "class_id": null, "class_name": null, "category": "mitigation", "sort_order": 0 } ] },
  { "invoice_number": "INV-000083", "expected_total": 19989.26, "lines": [
    { "description": "Approved Insurance Pricing", "quantity": 1, "unit_price": 20989.26, "item_id": "1010000201", "item_name": "Reconstruction:Reconstruction/ Remodeling Services", "class_id": null, "class_name": null, "category": "reconstruction", "sort_order": 0 },
    { "description": "Discount - Deductible (BNI)", "quantity": 1, "unit_price": -1000, "item_id": "1010000201", "item_name": "Reconstruction:Reconstruction/ Remodeling Services", "class_id": null, "class_name": null, "category": "reconstruction", "sort_order": 1 } ] },
  { "invoice_number": "INV-000077", "expected_total": 2919.27, "lines": [
    { "description": "Scope of Work – Mitigation Phase - Apartment 201 (IICRC S500, Category 2). Removed cabinet toe kicks, linoleum flooring and underlayment, affected pad; cleaned and applied EPA-registered antimicrobial; installed air movers + dehumidifier; moisture verification prior to reconstruction.", "quantity": 1, "unit_price": 2569.27, "item_id": "1010000071", "item_name": "Water Damage:Water Damage Mitigation And Drying", "class_id": null, "class_name": null, "category": "mitigation", "sort_order": 0 },
    { "description": "Scope of Work – Mitigation Phase - Apartment 101 (IICRC S500, Category 2). Ceiling drywall + insulation removal from water migrating from upper unit; cleaned framing, antimicrobial treatment, air movers + dehumidifier; moisture verification prior to reconstruction.", "quantity": 1, "unit_price": 350, "item_id": "1010000071", "item_name": "Water Damage:Water Damage Mitigation And Drying", "class_id": null, "class_name": null, "category": "mitigation", "sort_order": 1 } ] },
  { "invoice_number": "INV-000078", "expected_total": 4869.68, "lines": [
    { "description": "Reconstruction Scope of Work - APT 201 & 101. Drywall repair (labor & material), heavy hand texture, painting; R-30 batt insulation; snaplock laminate flooring over 1/2\" OSB underlayment; hardwood baseboard + casing installation and paint; appliance/fixture reset; carpet pad + relay and seam repair.", "quantity": 1, "unit_price": 4869.68, "item_id": "1010000201", "item_name": "Reconstruction:Reconstruction/ Remodeling Services", "class_id": null, "class_name": null, "category": "reconstruction", "sort_order": 0 } ] },
  { "invoice_number": "INV-000084", "expected_total": 5385.26, "lines": [
    { "description": "Approve By Insurance", "quantity": 1, "unit_price": 5385.26, "item_id": "1010000071", "item_name": "Water Damage:Water Damage Mitigation And Drying", "class_id": null, "class_name": null, "category": "mitigation", "sort_order": 0 } ] },
  { "invoice_number": "INV-000085", "expected_total": 4112.54, "lines": [
    { "description": "Approved by Insurance", "quantity": 1, "unit_price": 4112.54, "item_id": "1010000201", "item_name": "Reconstruction:Reconstruction/ Remodeling Services", "class_id": null, "class_name": null, "category": "reconstruction", "sort_order": 0 } ] },
  { "invoice_number": "INV-000079", "expected_total": 2757.96, "lines": [
    { "description": "Scope of Work – Mitigation Phase (IICRC S500). Roof-leak water intrusion, ~1 month exposure; removed affected drywall + saturated insulation, inspected framing, cleaned and applied EPA-registered antimicrobial; installed air movers + dehumidifier until dry standards met.", "quantity": 1, "unit_price": 2757.96, "item_id": "1010000071", "item_name": "Water Damage:Water Damage Mitigation And Drying", "class_id": null, "class_name": null, "category": "mitigation", "sort_order": 0 } ] },
  { "invoice_number": "INV-000080", "expected_total": 3522.83, "lines": [
    { "description": "Scope of Work – Interior Repairs. Drywall repair (labor & material, minimum charge); high wall/ceiling access (14'–20'); heavy hand texture; self-adhesive floor protection; carpet detach & relay + new pad; 4 1/4\" hardwood baseboard install + one coat paint. Painting of baseboards only (walls/ceilings not included unless separately noted).", "quantity": 1, "unit_price": 2517.2, "item_id": "1010000201", "item_name": "Reconstruction:Reconstruction/ Remodeling Services", "class_id": null, "class_name": null, "category": "reconstruction", "sort_order": 0 },
    { "description": "Reconstruction charge from QBO invoice 1223 (item Reconstruction/ Remodeling Services), grouped onto this reconstruction job during Q2-2026 reconciliation.", "quantity": 1, "unit_price": 1005.63, "item_id": "1010000201", "item_name": "Reconstruction:Reconstruction/ Remodeling Services", "class_id": null, "class_name": null, "category": "reconstruction", "sort_order": 1 } ] },
  { "invoice_number": "INV-000081", "expected_total": 761.59, "lines": [
    { "description": "Mold Remediation Services (Dining Area Ceiling) per IICRC S520. Containment + decon chamber, PPE, removal/disposal of affected drywall and insulation, mechanical removal of mold from framing, EPA-registered antimicrobial, HEPA air scrubbers + dehumidifiers, final inspection prior to reconstruction.", "quantity": 1, "unit_price": 1269.31, "item_id": "1010000071", "item_name": "Water Damage:Water Damage Mitigation And Drying", "class_id": null, "class_name": null, "category": "mitigation", "sort_order": 0 },
    { "description": "40% Discount - (Contingent to do both mitigation at the living room and remediation at the dinning room)", "quantity": 1, "unit_price": -507.72, "item_id": "43", "item_name": "Discounts:Discounts and Adjustments", "class_id": null, "class_name": null, "category": "discount", "sort_order": 1 } ] }
]
  $payload$::jsonb;

  -- invoice_number -> invoice UUID (INV-000062 -> the qbo_invoice_id=4291 row, NOT the $0 draft)
  v_map jsonb := $map$
  {
    "INV-000049":"466f3150-a8e8-40c3-9173-9773c4e22fa1",
    "INV-000051":"7e3599a3-58ec-4d9b-8ad9-97b511e39e99",
    "INV-000052":"276b48e4-5ae5-408a-ac14-0a887f39129c",
    "INV-000053":"507241c5-59de-4cf1-9167-98f49e3e135f",
    "INV-000054":"d1961575-c7a2-4bb7-9049-3ee3fe979b06",
    "INV-000055":"bcc7ed92-824c-4947-84fb-9bdb3ee851e2",
    "INV-000056":"0fc6ca4f-728f-4db5-9920-8ffa8e526a0a",
    "INV-000057":"017819e4-7d2a-4b9a-b139-9eafc098f83b",
    "INV-000058":"d2f64c78-0d63-4682-987c-a4dee04bb876",
    "INV-000059":"f06cf937-4117-432c-8f22-ac70e61c6b42",
    "INV-000060":"76c22066-6bbd-405a-b42f-49d32c340907",
    "INV-000061":"b4fa3fc2-7466-4778-88c3-15e033c6ed52",
    "INV-000062":"e9a29fea-9802-47a4-80d6-79bd1d5ce873",
    "INV-000063":"7efb2577-24b8-489e-b771-c3f8dbb76148",
    "INV-000064":"1f7c0c2c-1311-430f-83e7-81eeda012b12",
    "INV-000065":"e43ab44a-8cb6-41fd-a929-31603264dfd3",
    "INV-000066":"61ba5791-8054-45f5-9ad5-a4f2360219a3",
    "INV-000067":"67e5707f-5700-4989-b534-56c7dfa7646d",
    "INV-000068":"7647afcb-3332-4ce1-a04d-c1d1bfc146ca",
    "INV-000070":"589e499a-92d3-4aed-b5ca-49da7bdff50c",
    "INV-000071":"46de464a-6bec-4ba1-ab86-659cf1344983",
    "INV-000074":"fc5044cb-1a4c-4662-a4de-c501f98ef19a",
    "INV-000075":"3d649d9e-c4eb-4577-8865-74a29e641d43",
    "INV-000076":"806f516e-8077-4bda-a4b2-8aa76c80a589",
    "INV-000077":"c9f60ea0-442d-4458-bc9e-b079c5f9d469",
    "INV-000078":"770fe682-a23c-4d48-b7ed-9dc5a97a25d8",
    "INV-000079":"f35ce1a7-e0db-4e3f-8a64-1484718e61cf",
    "INV-000080":"833ac9b5-146c-4e1f-81fd-258380d13f61",
    "INV-000081":"a262c974-0d70-4741-9a7d-b4f16bf79e39",
    "INV-000082":"97ef5733-81c7-4bc6-a93b-50c6e51d4fe0",
    "INV-000083":"7a2e3e78-b8de-4eb4-b912-e07d42866e3f",
    "INV-000084":"419fbb7d-50be-4fa8-987b-8f8afccc82e4",
    "INV-000085":"7bca4177-c84f-4255-adaa-fd83c7ea59be",
    "INV-000086":"5e58e731-6cda-4bb0-8ca5-1474178d251e",
    "INV-000087":"28d0a648-b52e-4e34-8a5a-5ad5afb04d1c"
  }
  $map$::jsonb;

  p            record;
  v_id         uuid;
  v_before     numeric;
  v_after      numeric;
  v_existing   int;
  v_inserted   int;
  v_total_rows int := 0;
  v_invoices   int := 0;
BEGIN
  FOR p IN
    SELECT * FROM jsonb_to_recordset(v_payload)
      AS t(invoice_number text, expected_total numeric, lines jsonb)
  LOOP
    v_id := (v_map ->> p.invoice_number)::uuid;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'No UUID mapping for %', p.invoice_number;
    END IF;

    SELECT count(*) INTO v_existing FROM invoice_line_items WHERE invoice_id = v_id;
    IF v_existing > 0 THEN
      RAISE NOTICE 'SKIP % — idempotent no-op', p.invoice_number;
      CONTINUE;
    END IF;

    SELECT total INTO v_before FROM invoices WHERE id = v_id;
    IF v_before IS NULL THEN
      RAISE EXCEPTION 'Invoice % (%) not found', p.invoice_number, v_id;
    END IF;

    INSERT INTO invoice_line_items
      (invoice_id, description, quantity, unit_price, qbo_item_id, qbo_item_name, qbo_class_id, qbo_class_name, category, sort_order)
    SELECT v_id, l.description, l.quantity, l.unit_price,
           l.item_id, l.item_name, l.class_id, l.class_name, l.category, l.sort_order
    FROM jsonb_to_recordset(p.lines)
      AS l(description text, quantity numeric, unit_price numeric, item_id text, item_name text,
           class_id text, class_name text, category text, sort_order int);
    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    SELECT total INTO v_after FROM invoices WHERE id = v_id;
    IF round(v_after, 2) <> round(v_before, 2) THEN
      RAISE EXCEPTION 'TOTAL DRIFT on % (%): before % / after % — aborting entire backfill',
        p.invoice_number, v_id, v_before, v_after;
    END IF;

    v_total_rows := v_total_rows + v_inserted;
    v_invoices   := v_invoices + 1;
  END LOOP;

  RAISE NOTICE 'DONE — % invoices, % line rows inserted', v_invoices, v_total_rows;
END $backfill$;
