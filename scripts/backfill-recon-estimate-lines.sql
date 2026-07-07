-- ════════════════════════════════════════════════
-- SCRIPT: backfill-recon-estimate-lines.sql
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Restores the missing line items on 34 estimates imported from QuickBooks during
--   the Q2-2026 reconciliation with their header amount but WITHOUT their line detail.
--   The estimate screens (mobile AdminEstimateDetail + desktop EstimateEditor) compute
--   totals FROM the line items, so these estimates displayed $0 and the 'submitted'
--   ones couldn't be converted. Each estimate's lines are pulled from its QBO estimate
--   source, so they sum to the penny to the amount it already carries.
--
--   APPLIED to the shared Supabase (project glsmljpabrwonfiltiqm) on 2026-07-07:
--   34 estimates, 57 line rows. Companion to the invoice backfill/corrections
--   (scripts/backfill-recon-invoice-lines.sql, fix-recon-invoice-line-amounts.sql).
--
--   NOTE ON DESCRIPTIONS: the live apply condensed the longest scope-of-work text into
--   accurate summaries; amounts, items, quantities, classes and structure are identical
--   and verified (every estimate's amount was asserted unchanged). This file retains the
--   FULL verbatim QBO scope text as the higher-fidelity reference; the authoritative full
--   text also lives in QuickBooks. Re-running is an idempotent no-op on prod (lines exist).
--
-- SAFETY: one transaction (all-or-nothing). Per estimate it captures the pre-existing
--   `amount`, inserts the lines (which fires recompute_estimate_from_lines ->
--   amount = subtotal = SUM(line_total)), then ASSERTS amount is unchanged to the cent.
--   Any drift raises and rolls back all 34. Idempotent (skips estimates that already
--   have lines). Never writes the GENERATED line_total (= quantity*unit_price).
--   estimate_line_items has no `category` column (unlike invoice_line_items), so lines
--   carry qbo_item_id/name (+ class where QBO had one) only. A genuine discount is a
--   NEGATIVE line (e.g. #1132 "Deposit paid on Estimate" -562.50), preserved verbatim.
--   All 34 map 1:1 to their own QBO estimate (no split allocation).
-- ════════════════════════════════════════════════

DO $ebackfill$
DECLARE
  v_payload jsonb := $epayload$
[
  {
    "estimate_id": "9d43e914-dd95-4af9-b1c5-3d2b04ef7225",
    "estimate_number": "1125",
    "qbo_estimate_id": "4328",
    "expected_amount": 1978.59,
    "found": true,
    "qbo_total": 1978.59,
    "lines": [
      {
        "description": "Water Damage Mitigation – Basement \n\nWater damage mitigation services performed per IICRC S500 standards at [property address]. Scope included moisture assessment and documentation of two (2) separate water intrusion areas along the left and right walls of the basement, consistent with foundation seepage and/or failed window seal(s). Work performed in both areas included: flood cut and removal of affected drywall, removal and disposal of saturated insulation, cleaning of exposed structural materials, application of EPA-registered antimicrobial to all exposed surfaces, and deployment of commercial air movers and LGR dehumidification equipment. Drying monitored and documented over a standard 3-day drying cycle with daily moisture logs. Equipment removed upon confirmation of drying goals per IICRC S500.",
        "quantity": 1,
        "unit_price": 1978.59,
        "item_id": "1010000071",
        "item_name": "Water Damage:Water Damage Mitigation And Drying",
        "class_id": null,
        "class_name": null,
        "sort_order": 0
      }
    ]
  },
  {
    "estimate_id": "a940ecd5-8e7f-483a-8db5-4c410c92931c",
    "estimate_number": "1126",
    "qbo_estimate_id": "4344",
    "expected_amount": 1789,
    "found": true,
    "qbo_total": 1789,
    "lines": [
      {
        "description": "Mitigation Scope – Window Leak\nPerformed flood cuts around window opening and down affected wall cavity to expose wet framing and insulation resulting from window leak intrusion. Established drying chambers to concentrate airflow to affected structural materials. Removed non-salvageable materials as needed. Monitored and documented drying over a 3-day drying period until materials reached acceptable moisture content per IICRC S500 standards.",
        "quantity": 1,
        "unit_price": 1789,
        "item_id": "1010000071",
        "item_name": "Water Damage:Water Damage Mitigation And Drying",
        "class_id": null,
        "class_name": null,
        "sort_order": 0
      }
    ]
  },
  {
    "estimate_id": "43491784-7a72-414d-85ee-d296e72a0eb3",
    "estimate_number": "1127",
    "qbo_estimate_id": "4345",
    "expected_amount": 2750,
    "found": true,
    "qbo_total": 2750,
    "lines": [
      {
        "description": "Upstairs - Remove toilet, baseboard and tile, perform flood cuts on affected drywall behind toilet, and apply anti-microbial solution prior to starting drying process. Drying for approximate 3 days.",
        "quantity": 1,
        "unit_price": 1250,
        "item_id": "1010000071",
        "item_name": "Water Damage:Water Damage Mitigation And Drying",
        "class_id": null,
        "class_name": null,
        "sort_order": 0
      },
      {
        "description": "LVP removal and installation in bathroom around the vanity. Includes underlayment, and LVP medium quality ($1.5 - $2.35 per square feet). Baseboard installation - 4 1/12 MDF flat. Seal and Paint.",
        "quantity": 1,
        "unit_price": 1500,
        "item_id": "1010000201",
        "item_name": "Reconstruction:Reconstruction/ Remodeling Services",
        "class_id": null,
        "class_name": null,
        "sort_order": 1
      }
    ]
  },
  {
    "estimate_id": "057cf2cf-3b3d-42cb-b06b-618962275029",
    "estimate_number": "1128",
    "qbo_estimate_id": "4615",
    "expected_amount": 4429.25,
    "found": true,
    "qbo_total": 4429.25,
    "lines": [
      {
        "description": "Scope of Work — Residential Repair\n\nDrywall: Remove and replace damaged drywall on walls and ceiling with new 1/2\" drywall, taped, floated, and finished ready for paint.\nInsulation: Replace insulation with new R13 batt throughout affected area. Select section receives double-layer insulation for added thermal performance.\nPaint: Apply one coat of sealer/primer and two coats of finish paint to all repaired wall and ceiling surfaces, matched to existing color.\nBaseboards: Install new 4½\" paint-grade baseboard, caulked and finished with one coat primer and two coats paint to match existing trim.\nCarpet: Detach existing carpet, replace damaged pad, and re-stretch and relay carpet throughout the room using a power stretcher.",
        "quantity": 1,
        "unit_price": 4429.25,
        "item_id": "1010000201",
        "item_name": "Reconstruction:Reconstruction/ Remodeling Services",
        "class_id": null,
        "class_name": null,
        "sort_order": 0
      }
    ]
  },
  {
    "estimate_id": "5af83919-ebf1-443f-af54-f1261c0a6e46",
    "estimate_number": "1129",
    "qbo_estimate_id": "4632",
    "expected_amount": 1998,
    "found": true,
    "qbo_total": 1998,
    "lines": [
      {
        "description": "Mitigation Phase — Proposed Scope of Work\n\n1. Inspection & Moisture Testing\nInspect the affected ceiling area using calibrated moisture meters and thermal imaging camera to identify the full extent of water intrusion and establish baseline moisture readings before any work begins.\n\n2. Asbestos & Lead Testing (Required Before Demolition)\nBecause this home was built in 1905, materials in the ceiling — including plaster, insulation, and paint — may contain asbestos or lead. Samples will be collected and submitted to a certified laboratory for testing. Demolition will not begin until clearance results are received. This is required to protect the occupants and our crew.\n\n3. Work Area Setup & Containment\nSeal off the work area with plastic sheeting and set up a HEPA air filtration machine to prevent dust and particles from spreading to the rest of the home. Cover and protect all floor surfaces below the work area.\n\n4. Removal of Damaged Materials\nRemove all wet and unsalvageable ceiling materials, including drywall or plaster assembly and insulation. All debris will be bagged, sealed, and properly disposed of.\n\n5. Inspection of Exposed Framing\nOnce the ceiling is opened, inspect all exposed wood framing and joists for structural damage and any signs of mold or staining.\n\n6. Antimicrobial Treatment\nApply an EPA-registered antimicrobial solution to all exposed wood framing as a precautionary measure against mold growth, consistent with IICRC S520 guidelines.\n\n7. Drying Equipment Placement\nDeploy commercial-grade dehumidifiers and air movers throughout the affected area to begin structural drying.\n\n8. Daily Monitoring\nMonitor and record moisture readings, humidity levels, and temperature daily to ensure drying is progressing as expected.\n\n9. Final Drying Inspection & Clearance\nPerform a final moisture inspection once target drying levels are reached. All monitoring data will be documented. Structure will be confirmed dry before reconstruction begins.",
        "quantity": 1,
        "unit_price": 1248,
        "item_id": "1010000071",
        "item_name": "Water Damage:Water Damage Mitigation And Drying",
        "class_id": null,
        "class_name": null,
        "sort_order": 0
      },
      {
        "description": "Testing for Lead on Paint and Asbestos in Drywall - required by Laws - Utah Admin. Code R307-801 (Utah Asbestos Rule) and R307-842 (Lead-Based Paint Program)",
        "quantity": 1,
        "unit_price": 750,
        "item_id": "1",
        "item_name": "Testing Mold/ Asbestos/ Sewer Services",
        "class_id": null,
        "class_name": null,
        "sort_order": 1
      }
    ]
  },
  {
    "estimate_id": "b63cc00c-cdc1-4166-bac6-1c4efb9f32c8",
    "estimate_number": "1130",
    "qbo_estimate_id": "4645",
    "expected_amount": 13630.4,
    "found": true,
    "qbo_total": 13630.4,
    "lines": [
      {
        "description": "Culture Marble Shower:\n\nRemove and haul off existing bathtub to prepare for new shower installation.\nRemove existing tub/shower faucet, valve, and shower head in preparation for new installation.\nSupply and install new shower pan with drain, including waterproofing materials and labor.\nSupply and install cultured marble wall panels on three shower walls (30\"×60\"×30\", 75 SF). Set in mastic adhesive.\nSupply and install 1/2\" cement backer board on shower walls (75 SF) as required substrate for wall panels.\nSupply and install cultured marble shower base (30\"×60\"), set on dry-mix concrete bed. Connected to new drain.\nSupply and install 6 LF shower entry curb finished in cultured marble to match enclosure.\nSupply and install high-grade shower door system including door, side light, frame, and hardware.\nSupply and install high-grade shower faucet assembly including trim, pressure-balance valve, and shower head. (Qty 2 — confirm with adjuster.)\nSupply and install three (3) waterproof wet-location ceiling light fixtures inside shower enclosure, individually wired per code.",
        "quantity": 1,
        "unit_price": 10156.28,
        "item_id": "1010000201",
        "item_name": "Reconstruction:Reconstruction/ Remodeling Services",
        "class_id": null,
        "class_name": null,
        "sort_order": 0
      },
      {
        "description": "Tile Bathroom Floor:\n\nSupply and install high-grade ceramic/porcelain floor tile (50 SF). Includes tile, grout, thinset, and installation labor.\nSupply and install 1/2\" cement backer board over concrete slab (50 SF). Required substrate for floor tile installation.\nSupply and install high-grade tile base along all walls at floor level (25 LF). Finished transition between floor tile and walls.\nDetach and reset existing toilet. Reinstalled with new wax ring, mounting bolts, and caulked base seal upon completion of floor work.\nApply penetrating grout sealer to all floor tile grout joints (50 SF). Protects against moisture, staining, and mold.\nFloor tile trade labor minimum. Separate minimum charge for floor tile trade, distinct from wall tile and marble work.",
        "quantity": 1,
        "unit_price": 3474.12,
        "item_id": "1010000201",
        "item_name": "Reconstruction:Reconstruction/ Remodeling Services",
        "class_id": null,
        "class_name": null,
        "sort_order": 1
      }
    ]
  },
  {
    "estimate_id": "347094da-717f-4d3f-b063-a9806b28b8d4",
    "estimate_number": "1131",
    "qbo_estimate_id": "4648",
    "expected_amount": 750,
    "found": true,
    "qbo_total": 750,
    "lines": [
      {
        "description": "Discovery Demolition and Inspection",
        "quantity": 1,
        "unit_price": 750,
        "item_id": "1010000071",
        "item_name": "Water Damage:Water Damage Mitigation And Drying",
        "class_id": null,
        "class_name": null,
        "sort_order": 0
      }
    ]
  },
  {
    "estimate_id": "1b1aa871-4da1-4c13-b0be-678f5f4bfafd",
    "estimate_number": "1132",
    "qbo_estimate_id": "4649",
    "expected_amount": 2696.74,
    "found": true,
    "qbo_total": 2696.74,
    "lines": [
      {
        "description": "Scope of Work – Bathroom Water Damage Mitigation\nCategory 2 Water Loss\n\nOverview\nWater damage has affected the shower area and the surrounding drywall in the bathroom. Based on our moisture readings and assessment, the source is classified as Category 2 (gray water), which requires proper containment and removal of all affected materials to prevent further damage and microbial growth.\n\nWork to Be Performed\nContainment & Preparation\nSet up containment to protect unaffected areas of the home during the mitigation process. This includes plastic sheeting and ensuring proper airflow management throughout the work area.\nShower Removal\nRemove the shower unit and all associated components, including fixtures, surround panels or tile, and backing materials. All removed materials will be bagged and disposed of per Category 2 protocols.\nDrywall Removal\nRemove all moisture-affected drywall adjacent to the shower area. Cuts will be made to visually dry, structurally sound material to ensure no compromised drywall remains in the wall cavity. This step is necessary to allow the wall framing and cavity to dry completely and to eliminate conditions that support mold growth.\nStructural Drying\nDeploy professional-grade drying equipment — including air movers and dehumidifiers — to bring all remaining structural materials (framing, subfloor, etc.) to acceptable moisture levels per IICRC S500 standards. Daily moisture monitoring will be performed and documented until drying goals are met.\nFinal Documentation\nProvide a written drying log with moisture readings, equipment placement, and a clearance confirmation upon completion. This documentation supports your insurance claim and confirms the structure is ready for reconstruction.",
        "quantity": 1,
        "unit_price": 3259.24,
        "item_id": "1010000071",
        "item_name": "Water Damage:Water Damage Mitigation And Drying",
        "class_id": null,
        "class_name": null,
        "sort_order": 0
      },
      {
        "description": "Deposit paid on Estimate",
        "quantity": 1,
        "unit_price": -562.5,
        "item_id": "1010000071",
        "item_name": "Water Damage:Water Damage Mitigation And Drying",
        "class_id": null,
        "class_name": null,
        "sort_order": 1
      }
    ]
  },
  {
    "estimate_id": "1f10a12e-b0bb-4d09-b87f-eea614aa41a0",
    "estimate_number": "1133",
    "qbo_estimate_id": "4650",
    "expected_amount": 19482.08,
    "found": true,
    "qbo_total": 19482.08,
    "lines": [
      {
        "description": "Scope of Work: \n\nContainment & Preparation\nEstablish containment to protect unaffected areas of the home during the mitigation process. This includes plastic sheeting, proper airflow management, and PPE for all technicians working in the affected space given the Category 2 classification.\n\nBathroom Floor – Tile & Underlayment\nAlthough the tile itself may appear intact, moisture has migrated beneath the tile and into the underlayment and subfloor. Affected tile and underlying materials will be removed as needed to allow the subfloor to be properly dried. Tile cannot be effectively dried in place due to its non-porous surface trapping moisture beneath it.\n\nBaseboards\nRemove all affected baseboards throughout the bathroom. Baseboards are a primary pathway for water to wick into wall cavities and cannot be dried in place once saturated.\n\nDrywall\nMoisture readings will determine the full extent of drywall removal required. Any drywall reading above acceptable moisture thresholds will be removed to allow wall cavities to dry completely. Given the two-week exposure window on the initial loss, the likelihood of elevated moisture and early microbial activity in the wall cavity is high.\n\nMain Level Ceiling – Below Bathroom\nRemove affected drywall on the ceiling of the main level directly below the bathroom. Water migration through the subfloor has compromised this ceiling material. If insulation is present in the ceiling cavity, it will be removed as well — insulation cannot be dried once saturated and must be replaced to eliminate moisture and contamination.\n\nStructural Drying\nDeploy air movers and dehumidifiers to dry all remaining structural materials — including subfloor, wall framing, and ceiling joists — to IICRC S500 standards. Daily moisture monitoring will be documented throughout the drying period until clearance readings are achieved.\n\nFinal Documentation\nA complete drying log will be provided upon job completion, including daily moisture readings, equipment placement records, and a final clearance confirmation. This documentation supports the insurance claim and certifies the structure is ready for reconstruction.",
        "quantity": 1,
        "unit_price": 3257.21,
        "item_id": "1010000071",
        "item_name": "Water Damage:Water Damage Mitigation And Drying",
        "class_id": null,
        "class_name": null,
        "sort_order": 0
      },
      {
        "description": "Scope of Work – Bathroom Reconstruction (Tile Flooring Option)\nFlooring\nInstallation of 1/2\" cement board substrate and tile floor covering. Includes heavy cleaning of the tile floor surface prior to installation.\nWalls\nDrywall repair (minimum charge, labor and material). Wall masking with plastic, paper, and tape per linear foot. Heavy hand texture applied to drywall surfaces. Seal/prime (1 coat) and paint (2 coats) all wall surface areas.\nVanity & Cabinetry\nSupply and installation of full-height custom cabinet units. Single sink detach and reset. P-trap assembly detach and reset. Plumbing fixture supply line installation.\nFixtures\nToilet detach and reset upon completion of tile flooring and finish work.\nTrim & Finish\n3-1/4\" MDF baseboard with profile — installation included. Baseboard sealed (1 coat) and painted (1 coat).",
        "quantity": 1,
        "unit_price": 9391.03,
        "item_id": "1010000201",
        "item_name": "Reconstruction:Reconstruction/ Remodeling Services",
        "class_id": null,
        "class_name": null,
        "sort_order": 1
      },
      {
        "description": "Scope of Work – Bathroom Reconstruction (Laminate Flooring Option)\nFlooring\nConcrete grinding to remove remaining adhesive and level the substrate following tile removal. Installation of 1/2\" OSB underlayment. Snaplock laminate simulated wood flooring installed over prepared substrate.\nWalls\nDrywall repair (minimum charge, labor and material). Wall masking with plastic, paper, and tape per linear foot. Heavy hand texture applied to drywall surfaces. Seal/prime (1 coat) and paint (2 coats) all wall surface areas.\nVanity & Cabinetry\nSupply and installation of full-height custom cabinet units. Single sink detach and reset. P-trap assembly detach and reset. Plumbing fixture supply line installation.\nFixtures\nToilet detach and reset upon completion of laminate flooring and finish work.\nTrim & Finish\n3-1/4\" MDF baseboard with profile — installation included. Baseboard sealed (1 coat) and painted (1 coat).",
        "quantity": 1,
        "unit_price": 6833.84,
        "item_id": "1010000201",
        "item_name": "Reconstruction:Reconstruction/ Remodeling Services",
        "class_id": null,
        "class_name": null,
        "sort_order": 2
      }
    ]
  },
  {
    "estimate_id": "812dcb62-599c-4090-8b34-48cb8d95c3b1",
    "estimate_number": "1134",
    "qbo_estimate_id": "4652",
    "expected_amount": 2685.1,
    "found": true,
    "qbo_total": 2685.1,
    "lines": [
      {
        "description": "\nScope of Work: \n\nEmergency Response – After Hours\nReceived emergency call at 8:00 PM and dispatched a technician to the property the same evening. Technician arrived, assessed the extent of the water damage, extracted standing water, lifted and pulled back affected carpet, removed saturated pad, and placed initial stabilization equipment to begin the drying process and prevent further damage overnight.\n\nMitigation & Demo – Day 2\nReturned the following day to complete full mitigation of the affected areas. Removed and disposed of all saturated carpet pad, detached and removed affected carpet for evaluation, removed damaged baseboards and trim, and performed controlled demolition of affected drywall. Work area was cleaned and prepared for the drying phase. All debris was bagged and hauled off site.\n\nEquipment Placement\nDeployed the following drying equipment following demo completion:\n\n11 Air Movers\n1 Dehumidifier\n1 Air Scrubber\n\nEquipment was staged to maximize airflow through affected wall cavities, subfloor, and remaining structural materials per IICRC S500 drying protocols.\n\nStructural Drying – 3 Days\nMonitored and documented moisture readings daily across all affected structural materials over a 3-day drying period. Equipment was adjusted as needed based on psychrometric readings. All materials reached acceptable moisture levels before equipment was removed. Final clearance readings confirmed the structure was dry and ready for reconstruction.",
        "quantity": 1,
        "unit_price": 2685.1,
        "item_id": "1010000071",
        "item_name": "Water Damage:Water Damage Mitigation And Drying",
        "class_id": null,
        "class_name": null,
        "sort_order": 0
      }
    ]
  },
  {
    "estimate_id": "691cf50a-a0c4-4abf-8e65-a08ec9400d29",
    "estimate_number": "1135",
    "qbo_estimate_id": "4654",
    "expected_amount": 7000,
    "found": true,
    "qbo_total": 7000,
    "lines": [
      {
        "description": "Bathroom Renovation - Culture Marble Shower, Drywall, Paint, Casing, Baseboards, and LVP Floors",
        "quantity": 1,
        "unit_price": 7000,
        "item_id": "1010000201",
        "item_name": "Reconstruction:Reconstruction/ Remodeling Services",
        "class_id": null,
        "class_name": null,
        "sort_order": 0
      }
    ]
  },
  {
    "estimate_id": "ec336d3c-9cdf-46c9-91d7-ed660fcc5b98",
    "estimate_number": "1136",
    "qbo_estimate_id": "4694",
    "expected_amount": 9045,
    "found": true,
    "qbo_total": 9045,
    "lines": [
      {
        "description": "Option A – Without Shower Removal\n\nWork to Be Performed\n\nContainment & Setup\nFull containment will be established in both bathrooms prior to any demolition or remediation work. This includes floor-to-ceiling plastic sheeting, negative air pressure setup, and a decontamination barrier at entry points. This prevents mold spores from migrating to other areas of the home during the remediation process.\nPersonal Protective Equipment\nAll technicians will utilize appropriate PPE throughout the project including respirators, disposable suits, and gloves per S520 requirements.\nDemolition – Ceiling & Upper Walls\nRemove all mold-affected drywall on the ceilings and upper wall portions of both bathrooms (approx. 30 SF each). All debris will be double-bagged and disposed of per mold remediation protocols. If insulation is found above the ceiling drywall, it will be removed as well, as insulation cannot be cleaned once mold-affected and must be replaced.\nStructural Cleaning & Treatment\nOnce affected materials are removed, all exposed framing, joists, and structural surfaces will be HEPA vacuumed, cleaned, and treated with an EPA-registered antimicrobial solution. This step addresses any surface mold remaining on structural wood and helps prevent regrowth.\nAir Scrubbing\nHEPA air scrubbers will run continuously throughout the remediation process in both bathrooms to capture airborne spores and maintain air quality within the containment zones.\nFinal Clearance\nUpon completion of remediation work, a final visual inspection will be performed. Clearance testing is recommended prior to reconstruction to confirm the areas meet acceptable mold levels. We will coordinate with a third-party industrial hygienist if clearance sampling is requested.",
        "quantity": 1,
        "unit_price": 3250,
        "item_id": "1010000131",
        "item_name": "Mold:Mold Remediation Services",
        "class_id": null,
        "class_name": null,
        "sort_order": 0
      },
      {
        "description": "Option B – With Shower Removal (One Bathroom Only)\nOverview\nSame as Option A, with the addition of shower removal in the primary bathroom. This bathroom has visible cracks in the shower sealing, which indicates a secondary moisture intrusion point beyond the ventilation issue. These cracks allow water to penetrate behind the shower enclosure during use, potentially contributing to mold growth in areas that are not visible from the surface. Removing the shower in this bathroom allows full access to inspect and treat all surrounding wall surfaces and cavities.\n\nAdditional Work to Be Performed\n(All work listed in Option A applies. The following is added to the primary bathroom only:)\nShower Removal – Primary Bathroom\nRemove the shower unit including fixtures, surround panels or enclosure, and all backing materials. The cracked sealing on this shower presents a secondary moisture source that warrants full removal to properly assess and treat the wall cavity behind and adjacent to the enclosure. All materials will be bagged and disposed of per mold remediation protocols.\nExpanded Wall Inspection & Treatment – Primary Bathroom\nWith the shower removed, all exposed framing and wall cavities behind the shower area will be inspected for mold activity, HEPA vacuumed, and treated with an EPA-registered antimicrobial solution as needed.",
        "quantity": 1,
        "unit_price": 5795,
        "item_id": "1010000131",
        "item_name": "Mold:Mold Remediation Services",
        "class_id": null,
        "class_name": null,
        "sort_order": 1
      }
    ]
  },
  {
    "estimate_id": "29254ab0-d782-48a2-b864-2e5cbe00f930",
    "estimate_number": "1137",
    "qbo_estimate_id": "4695",
    "expected_amount": 500,
    "found": true,
    "qbo_total": 500,
    "lines": [
      {
        "description": "Lead and Asbestos Test - required by law:\n\nUtah Law Requirements\nUtah enforces federal EPA and OSHA standards that mandate testing and safe handling protocols:\n\nUtah Admin. Code R307-801 adopts the EPA's National Emission Standards for Hazardous Air Pollutants (NESHAP) for asbestos, which requires a thorough inspection by an accredited inspector before any renovation, repair, or demolition that will disturb regulated materials in a pre-1980 structure.\nEPA Renovation, Repair and Painting Rule (RRP Rule) — 40 CFR Part 745 requires that any contractor disturbing more than 6 sq ft of painted surface indoors (or 20 sq ft outdoors) in a pre-1978 home must be EPA-certified and follow lead-safe work practices. Utah enforces this through the Utah Department of Environmental Quality (UDEQ).\nOSHA 29 CFR 1926.1101 (asbestos in construction) and 29 CFR 1926.62 (lead in construction) require employers and contractors to assess and control exposure. In a pre-1980 building, presumed asbestos-containing material (PACM) rules apply unless the material is tested and confirmed negative.\nUtah Div. of Air Quality enforces asbestos NESHAP requirements at the state level, including notification requirements before demolition or renovation of regulated amounts.",
        "quantity": 1,
        "unit_price": 500,
        "item_id": "1",
        "item_name": "Testing Mold/ Asbestos/ Sewer Services",
        "class_id": null,
        "class_name": null,
        "sort_order": 0
      }
    ]
  },
  {
    "estimate_id": "f466f2cb-d780-468f-92d1-0ee54f1dc34d",
    "estimate_number": "1138",
    "qbo_estimate_id": "4707",
    "expected_amount": 750,
    "found": true,
    "qbo_total": 750,
    "lines": [
      {
        "description": "Discovery Demolition Above Shower and Window - Master Bathroom",
        "quantity": 1,
        "unit_price": 750,
        "item_id": "1010000071",
        "item_name": "Water Damage:Water Damage Mitigation And Drying",
        "class_id": null,
        "class_name": null,
        "sort_order": 0
      }
    ]
  },
  {
    "estimate_id": "3ba26af2-a3b6-4580-b228-bc72816f16ad",
    "estimate_number": "1139",
    "qbo_estimate_id": "4803",
    "expected_amount": 10924,
    "found": true,
    "qbo_total": 10924,
    "lines": [
      {
        "description": "Perform inspection and moisture mapping of all affected materials including drywall, insulation, and carpet to establish drying targets and document pre-mitigation conditions in accordance with IICRC S500 standards.\nRemove and dispose of wet drywall in affected wall cavities to allow for proper airflow and drying of wall assemblies. Perform flood cuts as needed to expose saturated framing and insulation.\nRemove and dispose of saturated batt insulation from all affected wall cavities.\nApply EPA-registered antimicrobial solution to all exposed framing, subfloor, and structural surfaces in affected areas as a precautionary measure given Category 2 classification.\nDeploy air movers, dehumidifiers, and negative air pressure equipment throughout the affected area to establish a controlled drying environment. Negative air units to be positioned to direct airflow away from unaffected areas and maintain containment.\nMonitor and document temperature, humidity, and moisture readings daily throughout the drying cycle. Equipment to remain in place until affected materials reach established drying goals per IICRC S500 guidelines.\nRemove all drying equipment upon confirmation of drying goals. Perform final moisture readings and document post-mitigation conditions.\nDemo and haul all removed materials including drywall, insulation, and debris from the structure including applicable dump fees.\nNote: \n- Final determination on carpet replacement or restoration to be made following drying cycle and post-mitigation inspection.\n- Doesn't include content manipulation - additional cost for moving heavy equipment.",
        "quantity": 1,
        "unit_price": 4340,
        "item_id": "1010000071",
        "item_name": "Water Damage:Water Damage Mitigation And Drying",
        "class_id": null,
        "class_name": null,
        "sort_order": 0
      },
      {
        "description": "Install 4\" R-13 paper/foil-faced batt insulation to restore thermal and moisture barrier performance within wall cavities.\nInstall 1/2\" drywall on wall surfaces up to 2 feet in height as needed in the affected area.\nApply light hand texture to all repaired drywall surfaces to match existing finish.\nInstall 5-1/4\" MDF baseboard with flat profile along all affected walls to restore finished appearance.\nApply one seal coat and one finish coat of paint to all installed baseboard.\nSeal and prime all repaired surfaces with one coat, followed by two finish coats of paint to match existing color and sheen.\nInstall 3-1/4\" casing around all affected door and window openings.\nApply one seal coat and one finish coat of paint to all installed casing.\nMask and prep all surfaces with plastic, paper, and tape in preparation for paint.\nHaul all debris from the affected area including dump fees.\nInstall 7 electrical outlets to restore functionality in affected areas.\nInstall 4 electrical switches to restore functionality in affected areas.",
        "quantity": 1,
        "unit_price": 6584,
        "item_id": "1010000201",
        "item_name": "Reconstruction:Reconstruction/ Remodeling Services",
        "class_id": null,
        "class_name": null,
        "sort_order": 1
      },
      {
        "description": "Carpet and Rubber Replacement - Waiting on Quote",
        "quantity": 1,
        "unit_price": 0,
        "item_id": "1010000201",
        "item_name": "Reconstruction:Reconstruction/ Remodeling Services",
        "class_id": null,
        "class_name": null,
        "sort_order": 2
      }
    ]
  },
  {
    "estimate_id": "ed83af6d-6da4-4a9b-b033-ca194a945f69",
    "estimate_number": "1140",
    "qbo_estimate_id": "4815",
    "expected_amount": 6500,
    "found": true,
    "qbo_total": 6500,
    "lines": [
      {
        "description": "Tile shower reconstruction including installation of new shower valve and matching trim kit. Existing shower door to be reset and reinstalled. Additional cost applied if door replacement is selected in lieu of reset. - Materials take 1 day to come in.\n\nDrywall, Texture and Paint work. \n\nCasing and Baseboard. \n\nToilet Reset.",
        "quantity": 1,
        "unit_price": 6500,
        "item_id": "1010000201",
        "item_name": "Reconstruction:Reconstruction/ Remodeling Services",
        "class_id": null,
        "class_name": null,
        "sort_order": 0
      }
    ]
  },
  {
    "estimate_id": "74a74b25-6b72-463c-9368-1c354fbd329a",
    "estimate_number": "1141",
    "qbo_estimate_id": "4816",
    "expected_amount": 2259.14,
    "found": true,
    "qbo_total": 2259.14,
    "lines": [
      {
        "description": "Scope of Work – Water Damage Mitigation\nExterior Intrusion, Category 2 | IICRC S500\nWater Extraction Extract standing and residual water from affected carpet and flooring areas.\nCarpet & Pad Removal and disposal of saturated carpet and pad. Pad is non-restorable at Category 2.\nBaseboard Removal Detach and remove baseboards along affected walls to allow wall cavity drying.\nStructural Drying Set and position air movers targeting affected wall cavities and subfloor. Monitor and document moisture readings daily per IICRC S500.\nDehumidification Deploy commercial dehumidifier(s) throughout affected area to maintain proper drying conditions for the duration of the dry-out.\nAntimicrobial Treatment Apply EPA-registered antimicrobial solution to all affected surfaces per IICRC S500 Category 2 protocol.\nDaily Monitoring Check and document equipment readings, moisture levels, and drying progress each visit.\nEquipment Removal Remove all drying equipment upon confirmed dry standard. Document and retain final moisture readings.",
        "quantity": 1,
        "unit_price": 2259.14,
        "item_id": "1010000071",
        "item_name": "Water Damage:Water Damage Mitigation And Drying",
        "class_id": null,
        "class_name": null,
        "sort_order": 0
      }
    ]
  },
  {
    "estimate_id": "4e3996b4-aa25-4d4f-bec1-335fbf250704",
    "estimate_number": "1142",
    "qbo_estimate_id": "4856",
    "expected_amount": 3980.4,
    "found": true,
    "qbo_total": 3980.4,
    "lines": [
      {
        "description": "Proposed Scope of Work – Water Damage Mitigation\nCategory 2 Gray Water Loss | Main Level & First Level | Toilet Overflow\n\nPerform inspection and moisture mapping of all affected materials including drywall, insulation, subfloor, and carpet across all affected levels to establish drying targets and document pre-mitigation conditions in accordance with IICRC S500 standards.\nRemove and dispose of wet drywall in all affected wall cavities across both levels. Perform flood cuts as needed to expose saturated framing and insulation.\nRemove and dispose of saturated batt insulation from all affected wall cavities.\nRemove and dispose of carpet pad in all affected areas. Carpet to remain in place pending inspection for delamination. If delamination is confirmed, carpet will be removed and disposed of accordingly.\nApply EPA-registered antimicrobial solution to all exposed framing, subfloor, and structural surfaces in affected areas given Category 2 classification.\nDeploy air scrubber during all demolition activities and throughout the drying cycle to maintain air quality and control airborne particulates in the contained work area.\nDeploy air movers, dehumidifiers, and supplemental heating equipment throughout all affected areas on both levels to establish a controlled drying environment.\nMonitor and document temperature, humidity, and moisture readings daily throughout the drying cycle. Equipment to remain in place until affected materials reach established drying goals per IICRC S500 guidelines.\nRemove all drying equipment upon confirmation of drying goals. Perform final moisture readings and document post-mitigation conditions.\nDemo and haul all removed materials including drywall, insulation, carpet pad, and debris from the structure including applicable dump fees.\nNote: Final determination on carpet replacement or restoration to be made following drying cycle and post-mitigation inspection for delamination.",
        "quantity": 1,
        "unit_price": 3980.4,
        "item_id": "1010000071",
        "item_name": "Water Damage:Water Damage Mitigation And Drying",
        "class_id": null,
        "class_name": null,
        "sort_order": 0
      }
    ]
  },
  {
    "estimate_id": "6994dc78-6d03-4d99-93c6-e67a4b358ca7",
    "estimate_number": "1143",
    "qbo_estimate_id": "4880",
    "expected_amount": 1000,
    "found": true,
    "qbo_total": 1000,
    "lines": [
      {
        "description": "Discovery Demolition",
        "quantity": 1,
        "unit_price": 250,
        "item_id": "1010000071",
        "item_name": "Water Damage:Water Damage Mitigation And Drying",
        "class_id": null,
        "class_name": null,
        "sort_order": 0
      },
      {
        "description": "SCOPE OF WORK — MITIGATION\n\nUtah Pros Cleaning & Restoration\nLoss Type: Water Damage — Category 2\nAffected Area: Garage (Ceiling)\n\nScope of Work: \n\nUpon arrival, technicians performed moisture mapping of the garage ceiling and adjacent framing to establish affected boundaries. The source of loss was identified as a suspected leaking supply or drain line originating from the bathroom above the garage. Category 2 water intrusion had migrated through the ceiling assembly, saturating drywall and insulation.\nAffected ceiling drywall and insulation (under 50 SF) were removed to expose structural framing and allow for adequate airflow and drying. All demo debris was bagged and removed from the structure. Following demolition, an EPA-registered antimicrobial was applied to exposed framing and surrounding surfaces per IICRC S500 protocols.\nDrying equipment was deployed and monitored over a 2–3 day drying cycle. Daily moisture readings were documented to track drying progress toward goal. Equipment was removed upon confirmation of dry standard.\n\nNote: No Mold Remediation Included.",
        "quantity": 1,
        "unit_price": 750,
        "item_id": "1010000071",
        "item_name": "Water Damage:Water Damage Mitigation And Drying",
        "class_id": null,
        "class_name": null,
        "sort_order": 1
      }
    ]
  },
  {
    "estimate_id": "367b3252-a316-4d77-b5ca-b38b1a162994",
    "estimate_number": "1144",
    "qbo_estimate_id": "4889",
    "expected_amount": 2009.8,
    "found": true,
    "qbo_total": 2009.8,
    "lines": [
      {
        "description": "Floor Upgrade: Barkley Oak.",
        "quantity": 1,
        "unit_price": 2009.8,
        "item_id": "1010000201",
        "item_name": "Reconstruction:Reconstruction/ Remodeling Services",
        "class_id": null,
        "class_name": null,
        "sort_order": 0
      }
    ]
  },
  {
    "estimate_id": "746359d9-8e0a-4383-bdae-2d171f3f98ae",
    "estimate_number": "1145",
    "qbo_estimate_id": "5171",
    "expected_amount": 20705.32,
    "found": true,
    "qbo_total": 20705.32,
    "lines": [
      {
        "description": "Scope of Work – Bathroom Water Damage Mitigation Category 2 Water Loss\n\nOverview\n\nWater damage has affected the shower area and the surrounding drywall and flooring in the bathroom. Based on our moisture readings and assessment, the source is classified as Category 2 (gray water), which requires proper containment and removal of all affected materials to prevent further damage and microbial growth.\n\nWork to Be Performed\n\nContainment & Preparation\n\nSet up containment to protect unaffected areas of the home during the mitigation process. This includes plastic sheeting and ensuring proper airflow management throughout the work area.\n\nDrywall Removal\n\nRemove all moisture-affected drywall adjacent to the shower area. Cuts will be made to visually dry, structurally sound material to ensure no compromised drywall remains in the wall cavity. This step is necessary to allow the wall framing and cavity to dry completely and to eliminate conditions that support mold growth. The shower unit will remain in place; drywall removal will be performed in all accessible areas surrounding it.\n\nFlooring Removal\n\nRemove moisture-affected flooring in the impacted portion of the bathroom. Removal will extend to dry, unaffected material to ensure no compromised flooring or underlayment remains. All removed materials will be bagged and disposed of per Category 2 protocols.\n\nStructural Drying\n\nDeploy professional-grade drying equipment — including air movers and dehumidifiers — to bring all remaining structural materials (framing, subfloor, etc.) to acceptable moisture levels per IICRC S500 standards. Daily moisture monitoring will be performed and documented until drying goals are met.\n\nFinal Documentation\n\nProvide a written drying log with moisture readings, equipment placement, and a clearance confirmation upon completion. This documentation supports your insurance claim and confirms the structure is ready for reconstruction.",
        "quantity": 1,
        "unit_price": 1582.57,
        "item_id": "1010000071",
        "item_name": "Water Damage:Water Damage Mitigation And Drying",
        "class_id": null,
        "class_name": null,
        "sort_order": 0
      },
      {
        "description": "Scope of Work – Bathroom Water Damage Mitigation\nCategory 2 Water Loss\n\nOverview\n\nWater damage has affected the shower area and the surrounding drywall and flooring in the bathroom. Based on our moisture readings and assessment, the source is classified as Category 2 (gray water), which requires proper containment and removal of all affected materials to prevent further damage and microbial growth.\n\nWork to Be Performed\n\nContainment & Preparation\n\nSet up containment to protect unaffected areas of the home during the mitigation process. This includes plastic sheeting and ensuring proper airflow management throughout the work area.\n\nShower Removal\n\nRemove the shower unit and all associated components, including fixtures, surround panels or tile, and backing materials. All removed materials will be bagged and disposed of per Category 2 protocols.\n\nDrywall Removal\n\nRemove all moisture-affected drywall adjacent to the shower area. Cuts will be made to visually dry, structurally sound material to ensure no compromised drywall remains in the wall cavity. This step is necessary to allow the wall framing and cavity to dry completely and to eliminate conditions that support mold growth.\n\nFlooring Removal\n\nRemove moisture-affected flooring in the impacted portion of the bathroom. Removal will extend to dry, unaffected material to ensure no compromised flooring or underlayment remains. All removed materials will be bagged and disposed of per Category 2 protocols.\n\nStructural Drying\n\nDeploy professional-grade drying equipment — including air movers and dehumidifiers — to bring all remaining structural materials (framing, subfloor, etc.) to acceptable moisture levels per IICRC S500 standards. Daily moisture monitoring will be performed and documented until drying goals are met.\n\nFinal Documentation\n\nProvide a written drying log with moisture readings, equipment placement, and a clearance confirmation upon completion. This documentation supports your insurance claim and confirms the structure is ready for reconstruction.\n",
        "quantity": 1,
        "unit_price": 2769.25,
        "item_id": "1010000071",
        "item_name": "Water Damage:Water Damage Mitigation And Drying",
        "class_id": null,
        "class_name": null,
        "sort_order": 1
      },
      {
        "description": "Bathroom reconstruction includes installation of vinyl plank flooring, detach and reset of toilet and existing baseboard, installation of 1 LF of new 4 1/4\" baseboard and 7 LF of 2 1/4\" casing, minimum drywall finishing, and minimum paint labor.",
        "quantity": 1,
        "unit_price": 2353.5,
        "item_id": "1010000201",
        "item_name": "Reconstruction:Reconstruction/ Remodeling Services",
        "class_id": null,
        "class_name": null,
        "sort_order": 2
      },
      {
        "description": "Tile Shower",
        "quantity": 1,
        "unit_price": 6500,
        "item_id": "1010000201",
        "item_name": "Reconstruction:Reconstruction/ Remodeling Services",
        "class_id": null,
        "class_name": null,
        "sort_order": 3
      },
      {
        "description": "Culture Marble Shower",
        "quantity": 1,
        "unit_price": 7500,
        "item_id": "1010000201",
        "item_name": "Reconstruction:Reconstruction/ Remodeling Services",
        "class_id": null,
        "class_name": null,
        "sort_order": 4
      }
    ]
  },
  {
    "estimate_id": "1be981c5-9ce5-49da-86f6-b58577f39c71",
    "estimate_number": "1146",
    "qbo_estimate_id": "5174",
    "expected_amount": 750,
    "found": true,
    "qbo_total": 750,
    "lines": [
      {
        "description": "Loss Type: Mold Remediation\nAffected Area: Bathroom (Shower/Tub Surround, Subfloor)\n\nPrior to commencing work, technicians established a containment barrier around the affected bathroom to prevent cross-contamination to adjacent areas. An air scrubber was placed inside the containment and run continuously throughout the remediation process per IICRC S520 protocols.\nMicrobial growth was identified on the shower/tub surround and the subfloor beneath, with a total affected area of under 10 SF. Technicians performed HEPA vacuuming of all visibly affected surfaces to remove loose spore material. Wire brushing and sanding were then performed on affected wood substrate to mechanically remove embedded growth down to clean material.\nFollowing mechanical remediation, an EPA-registered antimicrobial agent was applied to all affected surfaces, including exposed subfloor framing, to inhibit future microbial activity. Treated wood surfaces were sealed upon confirmation of clean substrate. All remediation debris was contained, bagged, and properly disposed of per applicable guidelines.\nContainment was maintained until clearance conditions were met and air scrubber runtime was confirmed sufficient for the affected area.",
        "quantity": 1,
        "unit_price": 750,
        "item_id": "1010000131",
        "item_name": "Mold:Mold Remediation Services",
        "class_id": null,
        "class_name": null,
        "sort_order": 0
      }
    ]
  },
  {
    "estimate_id": "139646f9-7704-4869-b217-3dc20c83bebc",
    "estimate_number": "1147",
    "qbo_estimate_id": "5175",
    "expected_amount": 1250,
    "found": true,
    "qbo_total": 1250,
    "lines": [
      {
        "description": "Drywall Repair",
        "quantity": 1,
        "unit_price": 1250,
        "item_id": "1010000201",
        "item_name": "Reconstruction:Reconstruction/ Remodeling Services",
        "class_id": null,
        "class_name": null,
        "sort_order": 0
      }
    ]
  },
  {
    "estimate_id": "d04d05e5-c90b-4465-8e98-a203e4f8d242",
    "estimate_number": "1148",
    "qbo_estimate_id": "5200",
    "expected_amount": 7801.14,
    "found": true,
    "qbo_total": 7801.14,
    "lines": [
      {
        "description": "Scope of Work – Water Damage Mitigation\nCategory 2 Water Loss\nOverview\nWater damage has affected the carpet, flooring, walls, baseboards, casing, insulation, and a portion of the ceiling in the impacted area. The source of loss is an exterior faucet failure that has been leaking on each use over an undetermined period. Based on our moisture readings and assessment, the source is classified as Category 2 (gray water), which requires proper containment and removal of all affected materials to prevent further damage and microbial growth.\nWork to Be Performed\nContainment & Preparation\nSet up containment to protect unaffected areas of the home during the mitigation process. This includes plastic sheeting and ensuring proper airflow management throughout the work area.\nWater Extraction\nPerform extraction of standing and absorbed water from affected carpet and flooring surfaces prior to material removal. This step reduces moisture load and prepares the area for controlled demolition and drying.\nCarpet & Pad Removal\nRemove affected carpet and pad from the impacted area. Carpet will be inspected for salvageability; pad will be disposed of per Category 2 protocols. All removed materials will be bagged and removed from the structure.\nDrywall, Baseboard & Casing Removal\nRemove all moisture-affected drywall, baseboards, and door or window casing in the impacted area. Cuts will be made to visually dry, structurally sound material to ensure no compromised drywall remains in the wall cavity. This step is necessary to allow wall framing and cavities to dry completely and to eliminate conditions that support mold growth.\nCeiling Removal\nRemove the affected portion of ceiling material in the impacted area. Cuts will be made to dry, unaffected material. All removed materials will be bagged and disposed of per Category 2 protocols.\nInsulation Removal\nRemove all moisture-affected insulation from wall cavities exposed during drywall removal. Wet insulation cannot be dried in place and must be removed to allow the structural framing to reach acceptable moisture levels and to prevent microbial growth.\nStructural Drying\nDeploy professional-grade drying equipment — including air movers and dehumidifiers — to bring all remaining structural materials (framing, subfloor, wall cavities, etc.) to acceptable moisture levels per IICRC S500 standards. Daily moisture monitoring will be performed and documented until drying goals are met.\nFinal Documentation\nProvide a written drying log with moisture readings, equipment placement, and a clearance confirmation upon completion. This documentation supports your insurance claim and confirms the structure is ready for reconstruction.\n",
        "quantity": 1,
        "unit_price": 3082,
        "item_id": "1010000071",
        "item_name": "Water Damage:Water Damage Mitigation And Drying",
        "class_id": null,
        "class_name": null,
        "sort_order": 0
      },
      {
        "description": "Drywall – hung, taped, floated, ready for paint — 32 SF\nDrywall per LF (up to 2' tall) — 43 LF\nTexture drywall – light hand texture — 133.4 SF\nBatt insulation – 6\" R19, paper/foil faced — 56 SF\nTexture drywall – heavy hand texture, ceiling — 10 SF\nPainter – per hour, ceiling — 1 HR\nSeal/prime (1 coat) and paint (2 coats) — 336 SF\nBaseboard – 5 1/4\" MDF flat profile — 42 LF\nSeal and paint casing – oversized (1 coat each) — 42 LF\nCasing – 3 1/4\" — 28 LF\nSeal and paint baseboard – oversized (1 coat each) — 28 LF\nMask and prep for paint – plastic, paper, tape — 97 LF\nTackless strip — 42 LF\nCarpet pad – premium grade — 144 SF\nCarpet – detach and relay — 144 SF\nClean and deodorize carpet — 1 EA\nOutlet/switch – detach and reset — 4 EA\nInterior door – detach and reset — 1 EA\nBypass (sliding) door set, slabs only – detach and reset — 2 EA",
        "quantity": 1,
        "unit_price": 4719.14,
        "item_id": "1010000201",
        "item_name": "Reconstruction:Reconstruction/ Remodeling Services",
        "class_id": null,
        "class_name": null,
        "sort_order": 1
      }
    ]
  },
  {
    "estimate_id": "14f7dbeb-bf04-41ba-9efd-992fc31e9c5a",
    "estimate_number": "1149",
    "qbo_estimate_id": "5206",
    "expected_amount": 6399.69,
    "found": true,
    "qbo_total": 6399.69,
    "lines": [
      {
        "description": "Scope of Work – Mold RemediationScope of Work – Mold Remediation\nIICRC S520 Standard\nOverview\nMicrobial growth has been identified in the bathroom as a result of long-term water intrusion from a failed caulking seal at the shower/tub unit. Moisture has affected the areas around, below, and behind the shower/tub, creating conditions that have allowed mold to establish in the surrounding building materials. This scope addresses full containment, removal of all affected materials, mold treatment, and structural drying per IICRC S520 standards.\nWork to Be Performed\nContainment & Preparation\nSet up critical containment to isolate the work area and protect unaffected areas of the home from cross-contamination during remediation. This includes plastic sheeting, negative air pressure where applicable, and proper airflow management throughout the work area. Workers will follow personal protective equipment (PPE) protocols as required under S520 guidelines.\nToilet Removal\nRemove and relocate the toilet to provide full access to the affected area. The toilet will be reset upon completion of remediation work.\nShower/Tub Removal\nRemove the shower/tub unit and all associated components, including fixtures, surround panels or tile, and backing materials. All removed materials will be bagged and disposed of per mold remediation protocols.\nDrywall & Baseboard Removal\nRemove all mold-affected drywall and baseboards surrounding the shower/tub area, including areas below and behind the unit where moisture intrusion and microbial growth have been confirmed. Cuts will be made to visually dry, unaffected material to ensure full removal of compromised assemblies.\nMold Treatment\nApply an EPA-registered antimicrobial agent to all exposed framing, wall cavities, and structural surfaces within the remediation area. Treatment will address visible mold and residual contamination on structural materials that will remain in place after demolition.\nStructural Drying\nDeploy professional-grade drying equipment — including air movers and dehumidifiers — to bring all remaining structural materials (framing, subfloor, wall cavities, etc.) to acceptable moisture levels per IICRC S500 standards. Daily moisture monitoring will be performed and documented until drying goals are met.\nFinal Documentation\nProvide a written clearance report upon completion, including moisture readings, equipment placement log, and confirmation that the structure is dry and remediation goals have been met per IICRC S520 standards. This documentation supports your insurance claim and confirms the area is ready for reconstruction.",
        "quantity": 1,
        "unit_price": 1785,
        "item_id": "1010000071",
        "item_name": "Water Damage:Water Damage Mitigation And Drying",
        "class_id": null,
        "class_name": null,
        "sort_order": 0
      },
      {
        "description": "Drywall per LF (up to 2' tall) — 6 LF\nTexture drywall – light hand texture — 18 SF\nSeal/prime (1 coat) and paint (2 coats) — 90 SF\nBaseboard – 5 1/4\" MDF flat profile — 8 LF\nSeal and paint casing – oversized (1 coat each) — 8 LF\nMask and prep for paint – plastic, paper, tape — 60 LF\nInterior door – detach and reset — 1 EA\nToilet – detach and reset — 1 EA\nFloor drain – tub/shower, metal/plastic — 1 EA\nTub/shower faucet — 1 EA\nFiberglass tub and shower combination — 1 EA\nPlumber – per hour — 3 HR\nQuarter round – for wood flooring — 5 LF\nHaul debris – per pickup truck load, including dump fees — 1 EA",
        "quantity": 1,
        "unit_price": 4614.69,
        "item_id": "1010000201",
        "item_name": "Reconstruction:Reconstruction/ Remodeling Services",
        "class_id": null,
        "class_name": null,
        "sort_order": 1
      }
    ]
  },
  {
    "estimate_id": "8922497d-22d3-4b00-b963-314ede94c037",
    "estimate_number": "1150",
    "qbo_estimate_id": "5246",
    "expected_amount": 6501,
    "found": true,
    "qbo_total": 6501,
    "lines": [
      {
        "description": "Master Bathroom - Based on the Initial Inspection Report ",
        "quantity": 1,
        "unit_price": 3270,
        "item_id": "1010000071",
        "item_name": "Water Damage:Water Damage Mitigation And Drying",
        "class_id": "1000000005",
        "class_name": "Mitigation",
        "sort_order": 0
      },
      {
        "description": "Secondary Bathroom - Based on Initial Inspection Report",
        "quantity": 1,
        "unit_price": 2481,
        "item_id": "1010000071",
        "item_name": "Water Damage:Water Damage Mitigation And Drying",
        "class_id": "1000000005",
        "class_name": "Mitigation",
        "sort_order": 1
      },
      {
        "description": "Initial Discovery Demolition on master bathroom and secondary bathroom. Cut behind the toilets to check the affected areas. \n\nNote: this amount will be discounted of final invoice, if the full scope of work is accepted. ",
        "quantity": 1,
        "unit_price": 750,
        "item_id": "1010000071",
        "item_name": "Water Damage:Water Damage Mitigation And Drying",
        "class_id": "1000000005",
        "class_name": "Mitigation",
        "sort_order": 2
      }
    ]
  },
  {
    "estimate_id": "b5f35e61-a2bd-419d-a5a0-1ff1648b5c9e",
    "estimate_number": "1151",
    "qbo_estimate_id": "5247",
    "expected_amount": 6558,
    "found": true,
    "qbo_total": 6558,
    "lines": [
      {
        "description": "Based on Initial Report - Apartment 101 and 201\n\nNote: Post Remediation Furnace Cleaning not included. Request Pricing. ",
        "quantity": 1,
        "unit_price": 6558,
        "item_id": "1010000131",
        "item_name": "Mold:Mold Remediation Services",
        "class_id": null,
        "class_name": null,
        "sort_order": 0
      }
    ]
  },
  {
    "estimate_id": "08ccbbfd-a7e5-41c1-8148-84db322355e0",
    "estimate_number": "1152",
    "qbo_estimate_id": "5252",
    "expected_amount": 1250,
    "found": true,
    "qbo_total": 1250,
    "lines": [
      {
        "description": "Minimum Mold Remediation Fee - Based on the Inspection Report",
        "quantity": 1,
        "unit_price": 1250,
        "item_id": "1010000131",
        "item_name": "Mold:Mold Remediation Services",
        "class_id": null,
        "class_name": null,
        "sort_order": 0
      }
    ]
  },
  {
    "estimate_id": "25d163ac-9e36-42da-ab91-d0f3f905bc12",
    "estimate_number": "1153",
    "qbo_estimate_id": "5253",
    "expected_amount": 2484,
    "found": true,
    "qbo_total": 2484,
    "lines": [
      {
        "description": "Based on Initial Inspection Report",
        "quantity": 1,
        "unit_price": 2484,
        "item_id": "1010000071",
        "item_name": "Water Damage:Water Damage Mitigation And Drying",
        "class_id": "1000000005",
        "class_name": "Mitigation",
        "sort_order": 0
      }
    ]
  },
  {
    "estimate_id": "4e5f4233-1747-4ff5-8584-c925384e724d",
    "estimate_number": "1154",
    "qbo_estimate_id": "5254",
    "expected_amount": 4276,
    "found": true,
    "qbo_total": 4276,
    "lines": [
      {
        "description": "",
        "quantity": 1,
        "unit_price": 4276,
        "item_id": "1010000071",
        "item_name": "Water Damage:Water Damage Mitigation And Drying",
        "class_id": null,
        "class_name": null,
        "sort_order": 0
      }
    ]
  },
  {
    "estimate_id": "4c100881-d7d7-42e5-b821-dd977caaa562",
    "estimate_number": "1155",
    "qbo_estimate_id": "5370",
    "expected_amount": 3150,
    "found": true,
    "qbo_total": 3150,
    "lines": [
      {
        "description": "Asbestos and Lead Testing ",
        "quantity": 1,
        "unit_price": 650,
        "item_id": "1",
        "item_name": "Testing Mold/ Asbestos/ Sewer Services",
        "class_id": "1000000003",
        "class_name": "Reconstruction",
        "sort_order": 0
      },
      {
        "description": "Salt Lake City - Minimum Fee \n\nNote: if testing is negative. ",
        "quantity": 1,
        "unit_price": 2500,
        "item_id": "1010000201",
        "item_name": "Reconstruction:Reconstruction/ Remodeling Services",
        "class_id": "1000000003",
        "class_name": "Reconstruction",
        "sort_order": 1
      }
    ]
  },
  {
    "estimate_id": "f2e1902d-ede6-4031-9e48-8bb95abfef2a",
    "estimate_number": "1156",
    "qbo_estimate_id": "5475",
    "expected_amount": 3716,
    "found": true,
    "qbo_total": 3716,
    "lines": [
      {
        "description": "Limited Remediation Based on Report",
        "quantity": 1,
        "unit_price": 3716,
        "item_id": "1010000071",
        "item_name": "Water Damage:Water Damage Mitigation And Drying",
        "class_id": "1000000005",
        "class_name": "Mitigation",
        "sort_order": 0
      }
    ]
  },
  {
    "estimate_id": "56831f35-2050-4d62-b73c-73ef374835b0",
    "estimate_number": "1157",
    "qbo_estimate_id": "5496",
    "expected_amount": 18152,
    "found": true,
    "qbo_total": 18152,
    "lines": [
      {
        "description": "Option A - Full Scope of Work (check attached report)",
        "quantity": 1,
        "unit_price": 2106,
        "item_id": "1010000131",
        "item_name": "Mold:Mold Remediation Services",
        "class_id": "1000000005",
        "class_name": "Mitigation",
        "sort_order": 0
      },
      {
        "description": "Option B - Limited remediation (check attached report)",
        "quantity": 1,
        "unit_price": 1196,
        "item_id": "1010000131",
        "item_name": "Mold:Mold Remediation Services",
        "class_id": "1000000005",
        "class_name": "Mitigation",
        "sort_order": 1
      },
      {
        "description": "Option A - with Tile Wall\n\nTile shower reconstruction including installation of new shower valve and matching trim kit.  Bathtub/Shower Door not included. Additional cost applied if door replacement is selected in lieu of reset. - Materials take 1 day to come in.\n\nDrywall, Texture and Paint work. \n\nCasing and Baseboard. \n\nToilet Reset.",
        "quantity": 1,
        "unit_price": 6500,
        "item_id": "1010000201",
        "item_name": "Reconstruction:Reconstruction/ Remodeling Services",
        "class_id": "1000000003",
        "class_name": "Reconstruction",
        "sort_order": 2
      },
      {
        "description": "Option B - with Culture Marble Walls\n\nCulture Marble shower reconstruction including installation of new shower valve and matching trim kit. Bathtub/Shower Door not included. Additional cost applied if door replacement is selected in lieu of reset. - Materials take 15 day to come in.\n\nDrywall, Texture and Paint work. \n\nCasing and Baseboard. \n\nToilet Reset.",
        "quantity": 1,
        "unit_price": 6500,
        "item_id": "1010000201",
        "item_name": "Reconstruction:Reconstruction/ Remodeling Services",
        "class_id": "1000000003",
        "class_name": "Reconstruction",
        "sort_order": 3
      },
      {
        "description": "Option C - without bathtub shower.\n\nDrywall, Texture and Paint work. \n\nCasing and Baseboard. \n\nToilet Reset.",
        "quantity": 1,
        "unit_price": 1850,
        "item_id": "1010000201",
        "item_name": "Reconstruction:Reconstruction/ Remodeling Services",
        "class_id": "1000000003",
        "class_name": "Reconstruction",
        "sort_order": 4
      }
    ]
  },
  {
    "estimate_id": "24ef65d2-3543-49ee-b399-9b63729f75ba",
    "estimate_number": "1158",
    "qbo_estimate_id": "5516",
    "expected_amount": 12740,
    "found": true,
    "qbo_total": 12740,
    "lines": [
      {
        "description": "SCOPE OF WORK — DEMOLITION\n\nProject Address: 10311 Bayhill Dr, Cedar Hills, UT\n\nRole: Subcontractor — Demolition\n\nScope Type: Controlled Interior Demolition / Exterior Demolition\n\nOverview\nUtah Pros will perform demolition services as a subcontractor in preparation for a rear addition/expansion. Work encompasses the main level and basement and includes full removal of the existing deck structure, exterior walls, interior walls, and kitchen cabinets. All work will be performed in a controlled manner to protect unaffected areas of the home.\n\nScope of Work\nDeck and Exterior Structure Demolition\n\nRemove and dispose of full deck structure including decking boards, framing, beams, posts, stair system, and railings.\nRemove support posts and understructure of the elevated deck along the walkout basement level.\nRemove retractable awning.\nDemo exterior stucco walls on the rear of the home — main level and basement — as required for the addition footprint.\n\nInterior Demolition\n\nDemo interior walls adjacent to the rear addition on the main level.\nDemo interior walls adjacent to the rear addition in the basement.\nRemove and dispose of all kitchen cabinets — upper and lower — in the affected area.\n\nContainment and Protection\n\nCross-contamination containment chambers will be installed prior to demolition to protect unaffected living areas.\nExposed openings will be protected following demolition until general contractor assumes control of the structure.\n\nWaste Removal\n\nDumpster provided by general contractor. All demolition debris will be removed and disposed of on-site.\n\n\nExclusions\n\nNo mitigation services included.\nNo structural, framing, or reconstruction work included.\nAppliance disconnection or removal not included unless directed by general contractor.\nAny work beyond the areas identified above requires a written change order prior to commencement.",
        "quantity": 1,
        "unit_price": 12740,
        "item_id": "1010000201",
        "item_name": "Reconstruction:Reconstruction/ Remodeling Services",
        "class_id": "1000000003",
        "class_name": "Reconstruction",
        "sort_order": 0
      }
    ]
  }
]$epayload$::jsonb;

  p            record;
  v_before     numeric;
  v_after      numeric;
  v_existing   int;
  v_inserted   int;
  v_total_rows int := 0;
  v_estimates  int := 0;
BEGIN
  FOR p IN
    SELECT * FROM jsonb_to_recordset(v_payload)
      AS t(estimate_id uuid, estimate_number text, expected_amount numeric, lines jsonb)
  LOOP
    SELECT count(*) INTO v_existing FROM estimate_line_items WHERE estimate_id = p.estimate_id;
    IF v_existing > 0 THEN
      RAISE NOTICE 'SKIP % (% already has % line[s]) — idempotent no-op', p.estimate_number, p.estimate_id, v_existing;
      CONTINUE;
    END IF;

    SELECT amount INTO v_before FROM estimates WHERE id = p.estimate_id;
    IF v_before IS NULL THEN
      RAISE EXCEPTION 'Estimate % (%) not found', p.estimate_number, p.estimate_id;
    END IF;

    INSERT INTO estimate_line_items
      (estimate_id, description, quantity, unit_price, qbo_item_id, qbo_item_name, qbo_class_id, qbo_class_name, sort_order)
    SELECT p.estimate_id, l.description, l.quantity, l.unit_price,
           l.item_id, l.item_name, l.class_id, l.class_name, l.sort_order
    FROM jsonb_to_recordset(p.lines)
      AS l(description text, quantity numeric, unit_price numeric, item_id text, item_name text,
           class_id text, class_name text, sort_order int);
    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    SELECT amount INTO v_after FROM estimates WHERE id = p.estimate_id;
    IF round(v_after, 2) <> round(v_before, 2) THEN
      RAISE EXCEPTION 'AMOUNT DRIFT on % (%): before % / after % — aborting entire backfill',
        p.estimate_number, p.estimate_id, v_before, v_after;
    END IF;

    v_total_rows := v_total_rows + v_inserted;
    v_estimates  := v_estimates + 1;
  END LOOP;

  RAISE NOTICE 'DONE — % estimates, % line rows inserted', v_estimates, v_total_rows;
END $ebackfill$;
