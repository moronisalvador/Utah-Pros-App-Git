/**
 * ════════════════════════════════════════════════
 * FILE: customDocSnippets.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Starting points for a one-off "Custom Authorization" — a document staff
 *   write themselves when none of the ready-made ones fits. Each snippet is a
 *   skeleton with blanks to fill in, so nobody starts from an empty box and
 *   forgets the parts that make a document worth signing.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      reads → none · writes → none
 *
 * NOTES / GOTCHAS:
 *   - These are SKELETONS, not documents. The six situations that come up often
 *     enough to have settled wording — Cat 3 removal, emergency demo, coverage
 *     unconfirmed, declined services, early equipment removal, property access —
 *     are their own real doc types with reviewed text in document_templates.
 *     Reach for one of those first; these are for the situation nobody
 *     anticipated.
 *   - Deliberately a plain .js file rather than an export from
 *     settings/templates/templateData.jsx. That module carries JSX and ~9 KB of
 *     legal prose and is only ever loaded in office route chunks; importing it
 *     from the tech PWA would pull all of it into the field bundle, against
 *     perf-budget.md §1's entry-graph and route-chunk budgets.
 *   - Text lives in code, not the database, on purpose (owner decision
 *     2026-08-07): git history of legal wording is worth more here than
 *     editability, and it needs no admin UI. Promote to a table later if the
 *     office asks to edit without a deploy.
 *   - CUSTOM_DOC_ALLOWED_TOKENS is mirrored in functions/lib/esign-custom-doc.js,
 *     which is the enforcing copy — functions/ is a separate Cloudflare bundle
 *     and cannot import from src/. Pinned by
 *     tests/qa/unit/esign-custom-doc-surface-parity.test.js.
 * ════════════════════════════════════════════════
 */

/* ═══ LIMITS — mirrored in functions/lib/esign-custom-doc.js ═══ */
export const CUSTOM_DOC_HEADING_MAX = 80;
export const CUSTOM_DOC_BODY_MAX = 8000;

/* ═══ FIELDS THAT FILL THEMSELVES IN ═══
   {{insurance_section}} is deliberately absent and is REJECTED by the server:
   it expands to a full irrevocable assignment of insurance benefits, and it
   expands differently on the signing page than in the PDF. */
export const CUSTOM_DOC_TOKENS = [
  { key: '{{client_name}}',       label: 'Client Name'   },
  { key: '{{job_number}}',        label: 'Job #'         },
  // Preferred over the four separate parts: it joins only what exists, so an
  // empty city cannot leave "…, , UT" on a signed document.
  { key: '{{property_address}}',  label: 'Full Address'  },
  { key: '{{address}}',           label: 'Address'       },
  { key: '{{city}}',              label: 'City'          },
  { key: '{{state}}',             label: 'State'         },
  { key: '{{zip}}',               label: 'ZIP'           },
  { key: '{{date_of_loss}}',      label: 'Date of Loss'  },
  { key: '{{insurance_company}}', label: 'Ins. Company'  },
  { key: '{{claim_number}}',      label: 'Claim #'       },
  { key: '{{policy_number}}',     label: 'Policy #'      },
  { key: '{{adjuster_name}}',     label: 'Adjuster'      },
  { key: '{{company_name}}',      label: 'Company Name'  },
  { key: '{{date}}',              label: "Today's Date"  },
];

/* ═══ SKELETONS ═══
   Shapes, not situations. Each one carries the four things that make an
   authorization hold up: what we told them, what they decided, what it costs,
   and what cannot be undone. */
export const CUSTOM_DOC_SNIPPETS = [
  {
    key: 'blank',
    label: 'Blank document',
    hint: 'Start from nothing',
    heading: '',
    body: '',
  },
  {
    key: 'advised_and_authorized',
    label: 'Advised → authorized',
    hint: 'We recommended it, they said go ahead',
    heading: 'Authorization to Proceed',
    body: `## WHAT I WAS TOLD
A representative of {{company_name}} inspected the property at {{address}}, {{city}}, {{state}} {{zip}} (Job No. {{job_number}}) and advised me of the following:

[What the tech observed and explained, in plain language]

## WHAT WAS RECOMMENDED
[What we recommended, and why it should happen now rather than later]

I had the opportunity to ask questions, and my questions were answered.

## WHAT I AM AUTHORIZING
I authorize {{company_name}} to perform the following work, beginning now:

[Exactly what is being authorized — rooms, materials, scope]

## MY RESPONSIBILITY FOR THE COST
I understand that {{company_name}} has made no representation that my insurance will cover this work, and I agree to pay for the work authorized above regardless of whether my carrier approves, denies, or partially pays the claim.`,
  },
  {
    key: 'advised_and_declined',
    label: 'Advised → declined',
    hint: 'We recommended it, they said no',
    heading: 'Acknowledgment of Declined Recommendation',
    body: `## WHAT WAS RECOMMENDED
A representative of {{company_name}} inspected the property at {{address}}, {{city}}, {{state}} {{zip}} (Job No. {{job_number}}) and recommended:

[What we recommended]

## WHAT I WAS TOLD ABOUT THE RISKS
[The risks that were explained — be specific]

I had the opportunity to ask questions, and my questions were answered.

## MY DECISION
Having been advised as described above, I have decided **not** to proceed with the recommended work at this time. This is my decision, made voluntarily and against the recommendation of {{company_name}}.

## WHAT I ACCEPT
I understand that declining this work may result in continuing or worsening damage, including damage that is not visible today, and that such damage may not be covered by my insurance. I release {{company_name}}, its officers, employees, and agents from any claims or liability arising from the work I have declined.`,
  },
  {
    key: 'irreversible_work',
    label: 'Irreversible work',
    hint: 'Removal or disposal that cannot be undone',
    heading: 'Authorization for Irreversible Work',
    body: `## WHAT I AM AUTHORIZING
I authorize {{company_name}} to perform the following at {{address}}, {{city}}, {{state}} {{zip}} (Job No. {{job_number}}), beginning now:

[Exactly what is being removed, demolished, or disposed of]

## WHY IT IS HAPPENING NOW
[Why this cannot wait — health risk, ongoing damage, safety]

## THIS CANNOT BE UNDONE
I understand this work is **not reversible** and that the affected materials will be disposed of and **will not be available for later inspection** by my insurance carrier or any other party. I understand that {{company_name}} will document the existing condition with photographs, moisture readings, and written notes beforehand, and will make that documentation available to me and to my carrier on request.

## INSURANCE AND COST
I understand coverage for this work has not been confirmed, and I agree to pay {{company_name}} for it regardless of whether my carrier approves, denies, or partially pays the claim.`,
  },
  {
    key: 'customer_request_against_advice',
    label: 'Against our advice',
    hint: 'They asked for something we advised against',
    heading: 'Customer Request Contrary to Recommendation',
    body: `## WHAT I AM ASKING FOR
I have asked {{company_name}} to do the following at {{address}}, {{city}}, {{state}} {{zip}} (Job No. {{job_number}}):

[What the customer is asking for]

## WHAT I WAS ADVISED
{{company_name}} advised me against this, and explained the following:

[What we told them, and what could go wrong]

I had the opportunity to ask questions, and my questions were answered.

## MY INSTRUCTION
Notwithstanding that advice, I am instructing {{company_name}} to proceed as I have asked. This is my decision, made voluntarily.

## RELEASE AND HOLD HARMLESS
I release, indemnify, and hold harmless {{company_name}}, its officers, employees, and agents from any claims or liability arising from my instruction, including any resulting secondary damage. I understand my insurance carrier may decline to pay for damage caused this way, and that my obligation to pay for work already performed is unchanged.`,
  },
];

export const CUSTOM_DOC_SNIPPET_KEYS = CUSTOM_DOC_SNIPPETS.map(s => s.key);
