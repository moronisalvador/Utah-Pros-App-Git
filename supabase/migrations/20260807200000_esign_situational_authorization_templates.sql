-- ════════════════════════════════════════════════
-- MIGRATION: 20260807200000_esign_situational_authorization_templates
-- Phase: n/a (standalone e-sign document expansion, Phase A)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Adds the wording for six new documents a client can sign, for six situations
--   that come up on real losses but had no template — so they were being typed by
--   hand outside the app. The six are: emergency removal of Category 3
--   contaminated materials, emergency demolition, an acknowledgment that
--   insurance coverage is not yet confirmed, a record that the client declined
--   work we recommended, early removal of drying equipment at the client's
--   request, and permission to enter the property when nobody is home.
--
--   This is TEXT ONLY. It adds six rows to the table that already holds the
--   wording of the Work Authorization and the Certificate of Completion. It
--   creates no table, no column and no function, and it changes nothing about
--   how signing works.
--
-- ADDITIVE-ONLY:
--   Yes — one INSERT adding six rows to public.document_templates. No table
--   DROP/RENAME/ALTER COLUMN, no function created or replaced, no grant or
--   policy change, and no existing row is modified.
--
-- WHY `WHERE NOT EXISTS` AND NOT `ON CONFLICT DO NOTHING`:
--   document_templates has only a PRIMARY KEY on id — there is NO unique
--   constraint on (doc_type, division), because recon_agreement legitimately
--   holds 16 NULL-division rows (one per numbered section), so such a constraint
--   cannot exist. With no unique index to conflict against, ON CONFLICT DO
--   NOTHING never fires and a second apply would insert six DUPLICATE rows —
--   producing exactly the two-row failure described below. The correlated
--   NOT EXISTS guard is what actually makes this idempotent, which matters
--   because the qualify-*-local.mjs harness applies forward, rolls back, and
--   re-applies in a single run.
--
-- WHY THE ROWS ARE REQUIRED (not just the JS defaults):
--   src/pages/settings/templates/templateData.jsx carries the same six bodies,
--   but that constant is only the fallback the Settings editor shows. The
--   SIGNING path reads the database: get_sign_document_templates(p_token) for the
--   on-screen document and a document_templates SELECT for the PDF. With no row,
--   BOTH fall through to Certificate-of-Completion boilerplate — SignPage.jsx via
--   buildSectionText() and functions/api/submit-esign.js via buildCocSections().
--   A client authorizing emergency carpet removal would be shown, and would sign,
--   "the work is 100% complete and I have no outstanding complaints." These rows
--   are what prevent that.
--
-- EXACTLY ONE ROW PER DOC TYPE — DO NOT ADD A SECOND:
--   SignPage.jsx:201 renders EVERY row for the doc type, while
--   submit-esign.js:214 reads only templates[0].body for the PDF. A second row
--   would show the client two sections and put only one in the document they
--   actually signed.
--
-- NO {{insurance_section}} IN ANY BODY:
--   That token expands to a full irrevocable pre-assignment of insurance
--   benefits. It belongs in a Work Authorization, not in a narrow
--   one-situation acknowledgment. It also expands to materially different text
--   in SignPage.jsx than in submit-esign.js, so the client would read one
--   version and sign another. The bodies below use only tokens that both
--   renderers resolve identically.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Run supabase/rollbacks/20260807200000_esign_situational_authorization_templates.rollback.sql.
--   It deletes exactly these six rows by doc_type. Any sign_requests already
--   created against these types keep their signed PDFs and job_documents rows —
--   those are stored artifacts, not re-rendered from this table. A PENDING
--   request of one of these types would, after rollback, fall back to the CoC
--   boilerplate described above, so cancel any pending request of these types
--   before rolling back.
-- ════════════════════════════════════════════════

-- One statement, six rows. The correlated NOT EXISTS makes a re-apply a no-op.
INSERT INTO public.document_templates (doc_type, division, heading, body, sort_order)
SELECT t.doc_type, NULL, t.heading, t.body, 1
FROM (VALUES
  -- ── 1. Emergency Removal Authorization — Category 3 Water ──
  (
    'cat3_removal',
    'Emergency Removal Authorization — Category 3 Water',
    $body$## WHAT I WAS TOLD TODAY
A representative of {{company_name}} inspected the property at {{address}}, {{city}}, {{state}} {{zip}} (Job No. {{job_number}}) and advised me that the water affecting the carpet, pad, and other materials at the Property is **Category 3 — grossly contaminated** under the IICRC S500 standard. I was told that Category 3 water may contain sewage, bacteria, pesticides, soils, and other harmful contaminants.

## WHAT WAS RECOMMENDED
I was advised that carpet, carpet pad, and other porous materials affected by Category 3 water are **not salvageable** and cannot be reliably cleaned, disinfected, or restored in place. I was advised that these materials should be removed and disposed of **without delay**, both to limit the risk to the health of the occupants and to prevent microbial growth from spreading to unaffected areas of the Property. I had the opportunity to ask questions, and my questions were answered.

## WHAT I AM AUTHORIZING
I authorize {{company_name}} to remove and dispose of the affected carpet, carpet pad, and other porous materials described above, and to perform related cleaning and drying as necessary, beginning immediately. I am requesting that this work begin now, for the safety of the occupants, rather than waiting for an insurance inspection or a coverage determination.

## THIS WORK CANNOT BE UNDONE
I understand that once these materials are removed and disposed of, they will **no longer be available for inspection** by my insurance carrier or any other party. I understand that {{company_name}} will document the pre-existing condition with photographs, moisture readings, and written notes, and will make that documentation available to me and to my carrier on request. I accept the removal on these terms.

## INSURANCE COVERAGE IS NOT CONFIRMED
I understand that as of the time of signing, coverage for this work has **not been confirmed** by any insurance carrier, and that {{company_name}} has made no representation, promise, or guarantee that my insurance will cover or pay for any part of it. Coverage decisions are made solely by the carrier.

## I ACCEPT RESPONSIBILITY FOR THE COST
I agree to pay {{company_name}} for the work authorized above **regardless of whether my insurance carrier approves, denies, or partially pays** the claim. My obligation to pay is not contingent on any insurance decision. I remain responsible for my deductible and for any amount my carrier does not pay.$body$
  ),

  -- ── 2. Emergency Demolition & Material Removal Authorization ──
  (
    'emergency_demo',
    'Emergency Demolition & Material Removal Authorization',
    $body$## WHAT WAS FOUND
A representative of {{company_name}} inspected the property at {{address}}, {{city}}, {{state}} {{zip}} (Job No. {{job_number}}) and advised me that damaged building materials at the Property must be removed in order to stop ongoing damage, allow the structure to dry, or make the Property safe.

## WHAT I AM AUTHORIZING
I authorize {{company_name}} to remove and dispose of the damaged building materials identified and shown to me by its representative at the Property. The specific materials, rooms, and quantities are recorded in the photographs, moisture readings, and written notes taken for Job No. {{job_number}} before the work begins, which {{company_name}} will make available to me and to my carrier on request.

## WHY IT CANNOT WAIT
I was advised that delaying this work risks additional damage to the Property, including microbial growth, and that waiting for an insurance inspection would extend that exposure. I am requesting that the work begin now rather than waiting for an adjuster to inspect or for coverage to be determined.

## THIS WORK CANNOT BE UNDONE
I understand that demolition and disposal are **not reversible**, and that removed materials will not be available for later inspection by my insurance carrier or any other party. I understand that {{company_name}} will document the pre-existing condition with photographs, moisture readings, and written notes before the work begins, and will make that documentation available to me and to my carrier on request.

## INSURANCE COVERAGE IS NOT CONFIRMED
I understand that coverage for this work has **not been confirmed**, and that {{company_name}} has made no representation, promise, or guarantee that my insurance will cover or pay for any part of it.

## I ACCEPT RESPONSIBILITY FOR THE COST
I agree to pay {{company_name}} for the work authorized above **regardless of whether my insurance carrier approves, denies, or partially pays** the claim. I remain responsible for my deductible and for any amount my carrier does not pay.$body$
  ),

  -- ── 3. Acknowledgment — Insurance Coverage Not Confirmed ──
  (
    'coverage_unconfirmed',
    'Acknowledgment — Insurance Coverage Not Confirmed',
    $body$## WHAT THIS DOCUMENT IS
This acknowledgment concerns work performed by {{company_name}} at the property located at {{address}}, {{city}}, {{state}} {{zip}} (Job No. {{job_number}}).

## CLAIM INFORMATION
Insurance Carrier: {{insurance_company}}
Claim Number: {{claim_number}}
Policy Number: {{policy_number}}
Date of Loss: {{date_of_loss}}

## NO GUARANTEE OF COVERAGE
I understand that {{company_name}} has **not confirmed** that my insurance carrier will cover the work being performed, and has made no representation, promise, or guarantee that any part of it will be covered or paid by insurance. I understand that coverage decisions are made solely by the carrier, and that {{company_name}} is not acting as my insurance adjuster or representative and has given me no advice regarding my policy, my coverage, or my claim.

## I AM ASKING THE WORK TO PROCEED
I have chosen to have {{company_name}} proceed with the work now rather than waiting for a coverage determination. This is my decision.

## MY RESPONSIBILITY FOR PAYMENT
I agree that I am directly responsible for payment of all authorized work performed, **regardless of whether my carrier approves, denies, or partially pays** the claim. My obligation to pay is not contingent on any insurance decision. I remain responsible for my deductible, for any withheld depreciation, and for any line item my carrier does not pay.$body$
  ),

  -- ── 4. Declination of Recommended Services ──
  (
    'service_declined',
    'Declination of Recommended Services',
    $body$## WHAT WAS RECOMMENDED
A representative of {{company_name}} inspected the property at {{address}}, {{city}}, {{state}} {{zip}} and recommended work that was described to me in detail and is recorded in the project file for Job No. {{job_number}}.

## WHAT I WAS TOLD ABOUT THE RISKS
The reasons for the recommendation, and the risks of not performing the work, were explained to me — including the potential for continuing or worsening damage, microbial growth, moisture that remains hidden inside the structure, and damage that is not visible today. I had the opportunity to ask questions, and my questions were answered.

## MY DECISION
Having been advised as described above, I have **decided not to have this work performed** at this time. This is my decision, made voluntarily and against the recommendation of {{company_name}}.

## WHAT I ACCEPT
I understand that declining the recommended work may result in continuing or worsening damage to the Property, including damage that is not visible today, and that such damage may not be covered by my insurance carrier. I accept responsibility for the consequences of not performing the recommended work, and I release {{company_name}}, its officers, employees, and agents from any and all claims or liability arising from the work I have declined.

## THIS IS NOT A COMPLETION CERTIFICATE
I understand that this document records only my decision to decline the work described above. It is not a statement that any work has been completed, and it does not release {{company_name}} from responsibility for work it did perform.$body$
  ),

  -- ── 5. Early Equipment Removal at Customer Request ──
  (
    'equipment_early_removal',
    'Early Equipment Removal at Customer Request',
    $body$## WHAT THIS DOCUMENT IS
This authorization concerns drying equipment installed by {{company_name}} at the property located at {{address}}, {{city}}, {{state}} {{zip}} (Job No. {{job_number}}).

## CURRENT CONDITIONS
The moisture readings taken at the Property and recorded in the project file for Job No. {{job_number}} show that the affected materials have not yet reached their target moisture content. Those readings were shown and explained to me.

## WHAT I WAS ADVISED
I was advised by {{company_name}} that the drying process is **not complete**, that the affected materials have not reached their target moisture content, and that removing the equipment now may leave moisture in the structure. I was advised that trapped moisture can lead to microbial growth, odor, warping, and damage that may not become visible for weeks or months.

## MY INSTRUCTION
Notwithstanding that advice, I am instructing {{company_name}} to remove its drying equipment from the Property now. This is my decision, made voluntarily and against the recommendation of {{company_name}}.

## RELEASE AND HOLD HARMLESS
I agree to release, indemnify, and hold harmless {{company_name}}, its officers, employees, and agents from any and all claims or liability arising from the incomplete drying process or from any secondary damage that results from the early removal of the equipment. I understand my insurance carrier may decline to pay for damage caused by stopping the drying process early.

## AMOUNTS ALREADY OWED
I understand that removing the equipment early does not reduce my obligation to pay for the work already performed and the equipment already placed.$body$
  ),

  -- ── 6. Property Access & Key Release Authorization ──
  (
    'access_release',
    'Property Access & Key Release Authorization',
    $body$## WHAT I AM AUTHORIZING
I authorize {{company_name}}, its employees, and its subcontractors to enter the property located at {{address}}, {{city}}, {{state}} {{zip}} (Job No. {{job_number}}) to perform authorized restoration work, including entry when I am not present.

## HOW ACCESS IS PROVIDED
I have separately provided {{company_name}} with the means of access — a key, lockbox code, gate code, or alarm code as applicable. That information is recorded in the project file and is deliberately **not** reproduced in this signed document, which is emailed and stored as a PDF.

## PERIOD OF AUTHORIZATION
This authorization is effective from the date signed and remains in effect until the authorized work is complete or until I revoke it in writing. Any restrictions on days, hours, or areas of the Property that are off limits have been communicated to {{company_name}} and are recorded in the project file.

## WHAT I ACKNOWLEDGE
I confirm that I am the owner of the Property or am otherwise authorized to grant access to it. I understand that {{company_name}} will secure the Property on leaving to the extent the condition of the Property allows, but that it is **not responsible for pre-existing security conditions** — including doors, windows, or locks that were damaged by the loss or that do not secure properly.

## VALUABLES AND OCCUPANTS
I agree to remove or secure cash, jewelry, firearms, prescription medication, and other valuables before unaccompanied access begins. I agree to inform {{company_name}} of any pets, alarm systems, or other occupants or conditions that affect safe entry.$body$
  )
) AS t(doc_type, heading, body)
WHERE NOT EXISTS (
  SELECT 1 FROM public.document_templates d WHERE d.doc_type = t.doc_type
);
