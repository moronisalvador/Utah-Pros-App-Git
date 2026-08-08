/**
 * ════════════════════════════════════════════════
 * FILE: templateData.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The built-in wording and helpers for the legal documents Utah Pros generates
 *   (Work Authorization, Direction to Pay, Certificate of Completion, Change
 *   Order). It holds the default text of each document, the list of {{variables}}
 *   you can drop in, and two small helpers that turn that text into a preview
 *   (fill in sample job data, and render the simple ## Heading / **bold** markup).
 *
 * WHERE IT LIVES:
 *   Route:        n/a (data + pure-helper module)
 *   Rendered by:  n/a — imported by the Templates settings page + its editor
 *
 * DEPENDS ON:
 *   Packages:  react (renderMarkdown returns JSX)
 *   Internal:  none
 *   Data:      reads → none · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Extracted verbatim (behavior-identical) from the old Settings.jsx monolith
 *     during Settings Overhaul Phase F. The saved overrides live in the
 *     document_templates table (read via get_document_templates, written via
 *     upsert_document_template) — this file is only the fallback defaults + the
 *     variable substitution used for the on-screen preview.
 * ════════════════════════════════════════════════
 */
import { collapseAddressGroups, formatPropertyAddress } from '@/lib/propertyAddress';

/* ═══ DOC TYPE METADATA ═══ */
export const DOC_TYPES = [
  { key: 'work_auth',     label: 'Work Authorization',        description: 'Scope consent, IICRC standards, equipment terms, payment, and liability.', icon: '📋', sections: 1 },
  { key: 'direction_pay', label: 'Direction to Pay',          description: 'Assignment of insurance benefits directing payment to Utah Pros.',           icon: '💳', sections: 1 },
  { key: 'coc',           label: 'Certificate of Completion', description: 'Per-division completion confirmations signed by the homeowner.',             icon: '✅', sections: 5 },
  { key: 'change_order',  label: 'Change Order',              description: 'Authorization for additional scope outside the original work auth.',          icon: '🔄', sections: 1 },

  /* ── Situational authorizations (added 2026-08-07) ──────────────────────────
     Six documents for situations that recur on real losses but had no template,
     so they were being written by hand outside the app. Each is ONE section
     (one document_templates row) on purpose: SignPage renders every row while
     submit-esign's PDF builder reads only templates[0].body, so a second row
     would show the client two sections and put one in the signed PDF. */
  { key: 'cat3_removal',            label: 'Emergency Removal — Cat 3',   description: 'Homeowner authorizes immediate removal of Category 3 contaminated materials.', icon: '🧪', sections: 1 },
  { key: 'emergency_demo',          label: 'Emergency Demolition',        description: 'Authorization to demo and dispose before an adjuster has inspected.',          icon: '🔨', sections: 1 },
  { key: 'coverage_unconfirmed',    label: 'Coverage Not Confirmed',      description: 'Client acknowledges work proceeds with coverage undetermined.',                icon: '❓', sections: 1 },
  { key: 'service_declined',        label: 'Declined Services',           description: 'Client declines recommended work after the risks were explained.',             icon: '🚫', sections: 1 },
  { key: 'equipment_early_removal', label: 'Early Equipment Removal',     description: 'Client asks for drying equipment to be pulled before targets are met.',        icon: '🌬️', sections: 1 },
  { key: 'access_release',          label: 'Property Access Release',     description: 'Client authorizes unaccompanied access and key or code release.',              icon: '🔑', sections: 1 },
];

export const DIVISION_META = {
  water:          { emoji: '💧', label: 'Water Damage Mitigation'  },
  mold:           { emoji: '🧫', label: 'Mold Remediation'          },
  reconstruction: { emoji: '🏗️', label: 'Repairs & Reconstruction' },
  remodeling:     { emoji: '🔨', label: 'Remodeling'              },
  fire:           { emoji: '🔥', label: 'Fire & Smoke Restoration'  },
  contents:       { emoji: '📦', label: 'Contents Restoration'      },
};

export const TEMPLATE_VARIABLES = [
  { key: '{{client_name}}',       label: 'Client Name'   },
  { key: '{{job_number}}',        label: 'Job #'         },
  // Preferred over the four separate parts below: it joins only what exists, so
  // a job whose city is empty cannot render "…, , UT" on a signed document.
  { key: '{{property_address}}',  label: 'Full Address'  },
  { key: '{{address}}',           label: 'Address'       },
  { key: '{{city}}',              label: 'City'          },
  { key: '{{state}}',             label: 'State'         },
  // SignPage and submit-esign have always resolved {{zip}}; it was missing from
  // this chip list and from substituteVarsPreview below, so it rendered live but
  // showed as a literal in the editor preview. The situational templates use it.
  { key: '{{zip}}',               label: 'ZIP'           },
  { key: '{{date_of_loss}}',      label: 'Date of Loss'  },
  { key: '{{insurance_company}}', label: 'Ins. Company'  },
  { key: '{{claim_number}}',      label: 'Claim #'       },
  { key: '{{policy_number}}',     label: 'Policy #'      },
  { key: '{{adjuster_name}}',     label: 'Adjuster'      },
  { key: '{{company_name}}',      label: 'Company Name'  },
  { key: '{{date}}',              label: "Today's Date"  },
  { key: '{{insurance_section}}', label: 'Insurance/Pay §', special: true },
];

/* ═══ DEFAULT TEMPLATE BODIES ═══ */
export const DEFAULT_TEMPLATES = {
  coc: [
    { division: 'water',          sort_order: 1, heading: 'Water Damage Mitigation',   body: 'I confirm that all water mitigation services performed by {{company_name}} at the above property have been completed to my satisfaction. The work was performed in a professional manner consistent with IICRC S500 standards and is 100% complete. I have no outstanding complaints or concerns.' },
    { division: 'mold',           sort_order: 2, heading: 'Mold Remediation',           body: 'I confirm that all mold remediation services performed by {{company_name}} have been completed to my satisfaction. The affected areas have been properly contained, treated, and cleared in accordance with IICRC S520 standards. The work is 100% complete and I have no outstanding complaints or concerns.' },
    { division: 'reconstruction', sort_order: 3, heading: 'Repairs & Reconstruction',  body: 'I confirm that all repairs and reconstruction performed by {{company_name}} have been completed to my satisfaction. The repaired portions of the property are in equal or better condition than prior to the loss. The work is 100% complete and I have no outstanding complaints or concerns.' },
    { division: 'fire',           sort_order: 4, heading: 'Fire & Smoke Restoration',  body: 'I confirm that all fire and smoke restoration services performed by {{company_name}} have been completed to my satisfaction. The work was performed in a professional manner and is 100% complete. I have no outstanding complaints or concerns.' },
    { division: 'contents',       sort_order: 5, heading: 'Contents Restoration',      body: 'I confirm that {{company_name}} has returned all salvageable contents items in satisfactory condition. I have had the opportunity to inspect the returned items. The work is 100% complete and I have no outstanding complaints or concerns.' },
    { division: 'remodeling',     sort_order: 6, heading: 'Remodeling',                body: 'I confirm that all remodeling and finish work performed by {{company_name}} has been completed to my satisfaction. The work is 100% complete, in equal or better condition than agreed, and I have no outstanding complaints or concerns.' },
  ],
  work_auth: [{ division: null, sort_order: 1,
    heading: 'Work Authorization & Service Agreement',
    body: `## AUTHORIZATION TO PERFORM SERVICES

I, {{client_name}}, the undersigned homeowner, policy holder, or authorized agent, hereby authorize {{company_name}} ("Company") to perform all necessary restoration, mitigation, remediation, and repair services at the property located at {{address}}, {{city}}, {{state}} ("Property").

## SCOPE OF WORK
I authorize the Company to perform all labor, equipment, and material necessary to properly restore and mitigate damage at the Property, including emergency services required to prevent further loss. The scope of work includes removal of non-salvageable material per IICRC S500 standards, and proper cleaning, treating, sanitizing, drying, and sealing of non-porous surfaces where applicable.

## CHEMICAL USE & SAFETY
The Company will use EPA-registered antimicrobials and sanitizers following IICRC standards. I agree to notify the Company of any known chemical sensitivities prior to commencement of work so that appropriate adjustments can be made.

## DRYING EQUIPMENT
I understand that high-velocity air movers and commercial dehumidifiers will be installed to accelerate the drying process. I will not turn off, unplug, or remove drying equipment without prior authorization from the Company. Target relative humidity is 25–35%. I will not open windows or doors unless instructed by the Company.

## EQUIPMENT RESPONSIBILITY
I am responsible for the safekeeping of drying equipment while in my care and custody. I agree to take reasonable precautions to prevent loss or theft of any equipment installed at the Property.

## STOP WORK / HOLD HARMLESS
If I instruct the Company to stop work before completion or remove drying equipment prematurely, I agree to release, indemnify, and hold harmless the Company, its officers, employees, and agents from any and all claims or liability arising from incomplete procedures or resulting secondary damage.

## PAYMENT TERMS
Payment is due within 30 days of invoice issuance. Any balance unpaid after 45 days will accrue a monthly finance charge of 1.5% (18% per annum). I agree to report any defects or concerns within seven (7) days of project completion. I am responsible for all costs not covered by insurance, including my deductible, withheld depreciation, and non-covered line items.

{{insurance_section}}

## SMS COMMUNICATIONS
By signing this Agreement, I consent to receive text messages (SMS/MMS) from Utah Pros Restoration at the mobile number provided in connection with this Agreement. Messages may include appointment reminders, project status updates, scheduling notifications, and other communications related to my restoration project. Message and data rates may apply. Message frequency varies. Reply STOP to opt out at any time. Reply HELP for assistance. Carriers are not liable for delayed or undelivered messages.

## GOVERNING LAW
This Agreement is governed by the laws of the State of Utah. Any dispute shall first be submitted to non-binding mediation. If mediation fails, the dispute shall be resolved by binding arbitration pursuant to the Utah Uniform Arbitration Act (Utah Code Ann. § 78B-11-101 et seq.). The prevailing party shall be entitled to recover reasonable attorney fees and costs.

By signing below, I confirm I have read and agree to all terms, and that I am authorized to execute this Agreement on behalf of the property owner.` }],

  direction_pay: [{ division: null, sort_order: 1,
    heading: 'Assignment of Benefits / Direction to Pay',
    body: `I, {{client_name}}, the undersigned insured or authorized representative, hereby irrevocably assign to {{company_name}} ("Company") all rights, title, and interest in insurance benefits payable under my property insurance policy with {{insurance_company}} (Policy No. {{policy_number}}) for the loss at {{address}}, {{city}}, {{state}}, on or about {{date_of_loss}} (Claim No. {{claim_number}}).

## SCOPE OF ASSIGNMENT
This assignment applies to all insurance proceeds attributable to restoration, mitigation, remediation, and repair services performed by the Company, including emergency services, water mitigation, mold remediation, structural repairs, contents restoration, and any supplemental amounts approved by the carrier.

## DIRECTION TO PAY
I hereby irrevocably direct {{insurance_company}} to issue all payments for covered restoration services payable to {{company_name}} as the authorized service provider. Checks issued solely in my name for covered services shall be promptly endorsed over to the Company.

## RIGHT TO NEGOTIATE & SUPPLEMENT
I authorize the Company to communicate directly with {{insurance_company}} and its representatives to negotiate, supplement, and finalize the claim on my behalf.

## DEDUCTIBLE OBLIGATION
This assignment does not relieve me of my obligation to pay the deductible required under my policy. My deductible is due directly to the Company.

## WITHHELD DEPRECIATION
I authorize the Company to collect any released recoverable depreciation directly from the carrier upon satisfactory completion of repairs and submission of required documentation.

This Direction to Pay shall remain in full force until the Company has received full and final payment for all authorized services. Any disputes shall be resolved through binding arbitration under the Utah Uniform Arbitration Act (Utah Code Ann. § 78B-11-101 et seq.).` }],

  change_order: [{ division: null, sort_order: 1,
    heading: 'Change Order Authorization',
    body: `This Change Order amends the original Work Authorization for the property at {{address}}, {{city}}, {{state}} (Job No. {{job_number}}).

I, {{client_name}}, hereby authorize {{company_name}} ("Company") to perform the additional scope of work described below. I understand this Change Order modifies the total contract value and that all other terms of the original Work Authorization remain in full force and effect.

## ADDITIONAL SCOPE OF WORK
[Describe the additional work authorized here]

## REASON FOR CHANGE
[State the reason — e.g., hidden damage discovered, scope expansion, supplemental approval]

## ACKNOWLEDGMENT
I confirm the additional scope has been explained to me in full, that I understand the nature of the work, and that I voluntarily authorize the Company to proceed. Payment for this additional scope is subject to the same payment terms as the original agreement.` }],

  /* ── Situational authorizations ─────────────────────────────────────────────
     {{insurance_section}} is deliberately NOT used in any of these. It expands
     to a full irrevocable pre-assignment of benefits, which is right for a Work
     Authorization and wrong for a narrow one-situation acknowledgment. It also
     renders differently in SignPage.jsx than in submit-esign.js, so the client
     would read one version and sign another. */

  cat3_removal: [{ division: null, sort_order: 1,
    heading: 'Emergency Removal Authorization — Category 3 Water',
    body: `## WHAT I WAS TOLD TODAY
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
I agree to pay {{company_name}} for the work authorized above **regardless of whether my insurance carrier approves, denies, or partially pays** the claim. My obligation to pay is not contingent on any insurance decision. I remain responsible for my deductible and for any amount my carrier does not pay.` }],

  emergency_demo: [{ division: null, sort_order: 1,
    heading: 'Emergency Demolition & Material Removal Authorization',
    body: `## WHAT WAS FOUND
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
I agree to pay {{company_name}} for the work authorized above **regardless of whether my insurance carrier approves, denies, or partially pays** the claim. I remain responsible for my deductible and for any amount my carrier does not pay.` }],

  coverage_unconfirmed: [{ division: null, sort_order: 1,
    heading: 'Acknowledgment — Insurance Coverage Not Confirmed',
    body: `## WHAT THIS DOCUMENT IS
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
I agree that I am directly responsible for payment of all authorized work performed, **regardless of whether my carrier approves, denies, or partially pays** the claim. My obligation to pay is not contingent on any insurance decision. I remain responsible for my deductible, for any withheld depreciation, and for any line item my carrier does not pay.` }],

  service_declined: [{ division: null, sort_order: 1,
    heading: 'Declination of Recommended Services',
    body: `## WHAT WAS RECOMMENDED
A representative of {{company_name}} inspected the property at {{address}}, {{city}}, {{state}} {{zip}} and recommended work that was described to me in detail and is recorded in the project file for Job No. {{job_number}}.

## WHAT I WAS TOLD ABOUT THE RISKS
The reasons for the recommendation, and the risks of not performing the work, were explained to me — including the potential for continuing or worsening damage, microbial growth, moisture that remains hidden inside the structure, and damage that is not visible today. I had the opportunity to ask questions, and my questions were answered.

## MY DECISION
Having been advised as described above, I have **decided not to have this work performed** at this time. This is my decision, made voluntarily and against the recommendation of {{company_name}}.

## WHAT I ACCEPT
I understand that declining the recommended work may result in continuing or worsening damage to the Property, including damage that is not visible today, and that such damage may not be covered by my insurance carrier. I accept responsibility for the consequences of not performing the recommended work, and I release {{company_name}}, its officers, employees, and agents from any and all claims or liability arising from the work I have declined.

## THIS IS NOT A COMPLETION CERTIFICATE
I understand that this document records only my decision to decline the work described above. It is not a statement that any work has been completed, and it does not release {{company_name}} from responsibility for work it did perform.` }],

  equipment_early_removal: [{ division: null, sort_order: 1,
    heading: 'Early Equipment Removal at Customer Request',
    body: `## WHAT THIS DOCUMENT IS
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
I understand that removing the equipment early does not reduce my obligation to pay for the work already performed and the equipment already placed.` }],

  access_release: [{ division: null, sort_order: 1,
    heading: 'Property Access & Key Release Authorization',
    body: `## WHAT I AM AUTHORIZING
I authorize {{company_name}}, its employees, and its subcontractors to enter the property located at {{address}}, {{city}}, {{state}} {{zip}} (Job No. {{job_number}}) to perform authorized restoration work, including entry when I am not present.

## HOW ACCESS IS PROVIDED
I have separately provided {{company_name}} with the means of access — a key, lockbox code, gate code, or alarm code as applicable. That information is recorded in the project file and is deliberately **not** reproduced in this signed document, which is emailed and stored as a PDF.

## PERIOD OF AUTHORIZATION
This authorization is effective from the date signed and remains in effect until the authorized work is complete or until I revoke it in writing. Any restrictions on days, hours, or areas of the Property that are off limits have been communicated to {{company_name}} and are recorded in the project file.

## WHAT I ACKNOWLEDGE
I confirm that I am the owner of the Property or am otherwise authorized to grant access to it. I understand that {{company_name}} will secure the Property on leaving to the extent the condition of the Property allows, but that it is **not responsible for pre-existing security conditions** — including doors, windows, or locks that were damaged by the loss or that do not secure properly.

## VALUABLES AND OCCUPANTS
I agree to remove or secure cash, jewelry, firearms, prescription medication, and other valuables before unaccompanied access begins. I agree to inform {{company_name}} of any pets, alarm systems, or other occupants or conditions that affect safe entry.` }],
};

/* ═══ DOC TYPE LABELS ═══
   Kept SHORT and identical to the copies in SignPage.jsx, JobPage.jsx,
   TechJobDocuments.jsx, send-esign.js, resend-esign.js and submit-esign.js.
   tests/qa/unit/esign-doc-type-label-parity.test.js pins all seven together.

   Short matters mechanically, not just visually: submit-esign.js draws the PDF
   title with an UNWRAPPED drawText at 18pt into a 500pt column, so a label past
   roughly 45 characters runs off the page. The full legal heading lives in the
   document body (document_templates.heading), not here. */
export const DOC_TYPE_LABELS = {
  coc:                     'Certificate of Completion',
  work_auth:               'Work Authorization',
  direction_pay:           'Direction of Pay',
  change_order:            'Change Order',
  recon_agreement:         'Reconstruction Agreement',
  cat3_removal:            'Emergency Removal Authorization',
  emergency_demo:          'Emergency Demolition Authorization',
  coverage_unconfirmed:    'Coverage Not Confirmed Acknowledgment',
  service_declined:        'Declination of Recommended Services',
  equipment_early_removal: 'Early Equipment Removal',
  access_release:          'Property Access Authorization',
  other:                   'Custom Authorization',
};

/**
 * Merge saved document_templates rows over the built-in defaults for one doc type
 * → the editor's initial sections. Pure (no I/O) so the editor's mount-fetch logic
 * is unit-testable. `rows` is the raw get_document_templates result (array).
 */
export function buildTemplateSections(rows, docType) {
  const map = {};
  for (const row of rows || []) {
    map[`${row.doc_type}::${row.division || '_'}`] = { heading: row.heading, body: row.body, sort_order: row.sort_order };
  }
  const getTemplate = (division) => {
    const saved = map[`${docType}::${division || '_'}`];
    if (saved) return saved;
    const def = (DEFAULT_TEMPLATES[docType] || []).find(t => t.division === division);
    return def ? { heading: def.heading, body: def.body, sort_order: def.sort_order } : { heading: '', body: '', sort_order: 0 };
  };
  return (DEFAULT_TEMPLATES[docType] || []).map(def => ({ division: def.division, sort_order: def.sort_order, ...getTemplate(def.division) }));
}

/* ═══ MARKDOWN RENDERER — handles ## Heading, **bold**, empty lines ═══ */
export function renderMarkdown(text) {
  if (!text) return null;
  return text.split('\n').map((line, i) => {
    if (line.startsWith('## ')) {
      return <div key={i} style={{ fontWeight: 700, fontSize: 12, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: i === 0 ? 0 : 14, marginBottom: 3 }}>{line.slice(3)}</div>;
    }
    if (!line.trim()) return <div key={i} style={{ height: 6 }} />;
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    const rendered = parts.map((p, j) => p.startsWith('**') && p.endsWith('**') ? <strong key={j}>{p.slice(2, -2)}</strong> : p);
    return <div key={i} style={{ fontSize: 13, color: '#334155', lineHeight: 1.65 }}>{rendered}</div>;
  });
}

/* ═══ PREVIEW VARIABLE SUBSTITUTION ═══ */
const SAMPLE_JOB = {
  insured_name: 'Dorothy Killian', job_number: 'UPR-2024-001',
  address: '1295 Oquirrh Dr', city: 'Provo', state: 'UT', zip: '84604',
  date_of_loss: '2024-01-15', insurance_company: 'State Farm',
  claim_number: 'SF-12345678', policy_number: 'HO-987654321', adjuster_name: 'Jane Doe',
};

export function substituteVarsPreview(text, withInsurance = true) {
  if (!text) return '';
  const co  = 'Utah Pros Restoration';
  const job = withInsurance ? SAMPLE_JOB : { ...SAMPLE_JOB, insurance_company: '', claim_number: '', policy_number: '' };

  const insuranceSection = job.insurance_company
    ? `## INSURANCE & DIRECTION TO PAY\nI authorize ${co} as the designated payee for all insurance proceeds. I authorize and direct ${job.insurance_company} (Claim No. ${job.claim_number}) to issue payment jointly or directly to ${co}. I agree to promptly endorse any insurance checks that include the Company's name. I remain responsible for my deductible and any amounts not covered by my carrier.`
    : `## PRIVATE PAY & CONDITIONAL ASSIGNMENT OF BENEFITS\nAt the time of signing, no insurance claim has been filed for the loss that is the subject of this Agreement. I agree to pay ${co} directly for all services rendered. All invoices are payable within 30 days of issuance.\n\n**SUBSEQUENT INSURANCE CLAIM:** If I file, or cause to be filed, an insurance claim related to the damage or loss described herein at any time — before, during, or after completion of the work — I hereby irrevocably pre-assign to ${co} all insurance proceeds attributable to the restoration, mitigation, and repair services performed under this Agreement. This pre-assignment is effective retroactively from the date of this Agreement. I agree to: (a) notify ${co} in writing within three (3) business days of filing any such claim; (b) execute a Direction to Pay and/or Assignment of Benefits in favor of ${co} immediately upon request; and (c) direct my insurance carrier to issue all applicable payments jointly or directly to ${co}. My obligation to pay ${co} in full for all authorized services is not contingent upon the filing, approval, or payment of any insurance claim.`;

  const m = {
    '{{insurance_section}}':  insuranceSection,
    '{{property_address}}':   formatPropertyAddress(job),
    '{{client_name}}':        job.insured_name,
    '{{job_number}}':         job.job_number,
    '{{address}}':            job.address,
    '{{city}}':               job.city,
    '{{state}}':              job.state,
    '{{zip}}':                job.zip,
    '{{date_of_loss}}':       'January 15, 2024',
    '{{insurance_company}}':  job.insurance_company || '',
    '{{claim_number}}':       job.claim_number      || '',
    '{{policy_number}}':      job.policy_number     || '',
    '{{adjuster_name}}':      job.adjuster_name     || '',
    '{{company_name}}':       co,
    '{{date}}':               new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
  };
  // Same order as SignPage and submit-esign: the address GROUP is collapsed
  // before the individual tokens, or there is no group left to recognise. The
  // editor preview has to agree with them, or staff tune wording against a
  // rendering the customer never sees.
  return Object.entries(m).reduce((t, [k, v]) => t.replaceAll(k, v), collapseAddressGroups(text, job));
}
