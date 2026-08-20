# UPR restoration record graph

Use this reference whenever a user flow touches restoration intake, claims, production work,
scheduling, estimates, invoices, or payments. It is a product-semantics guardrail, not a substitute
for inspecting current code and schema.

## Current business graph

The common operational path is:

```text
Contact / Customer
  ├─ service or billing address(es)
  └─ CLM / Claim — one loss or opportunity umbrella
       ├─ Estimate(s) — current linkage may still be indirect or transitional
       └─ Job(s) — mitigation, mold, contents, reconstruction, or another workstream
            ├─ Appointment(s) — scheduled job visits
            ├─ Task(s), documents, rooms/readings, and operational records
            └─ Invoice(s)
                 └─ Payment allocation(s)
```

This is not a strict tree:

- `contacts` is a reusable person/company identity used across CRM, jobs, billing, messaging, and
  e-sign.
- A contact can have multiple addresses, claims, and jobs, and a job can link multiple contacts with
  roles.
- A CLM/claim is the loss/opportunity umbrella. It is not itself a sale, job, or completion state.
- One CLM can hold multiple estimates and multiple jobs.
- A job is a specific workstream/division under the claim and can have many appointments and
  invoices.
- Appointments of kind `job` belong to a job; company events are a separate kind.
- Payments follow invoice and allocation semantics. External QBO relationships can be broader than a
  simple one-job tree, including combined relationships that must not be silently collapsed.

## Current truth versus planned truth

Always inspect the live contracts before designing. In particular:

- `docs/schema-v2/domains/jobs.md` describes the current jobs/claims model and the duplicated
  insurance identity that still exists between them.
- `docs/schema-v2/domains/sched.md` describes the current appointment model and direct creation paths.
- `docs/schema-v2/domains/billing.md` describes invoices, payments, allocations, and QBO/Stripe
  behavior.
- `docs/schema-v2/domains/crm.md` defines `contacts` as the platform-wide person/company record and
  `contact_jobs` as a role-bearing join.
- `CLAIM-ESTIMATE-HIERARCHY-PLAN.md` is a planned target, not proof that `estimates.claim_id` or its
  UX has shipped.

Do not design from a roadmap as though it were production truth.

## Identity and cardinality decisions

Before creating anything, determine:

1. **Person/company identity:** Is this an existing contact, a new contact, or an ambiguous match?
2. **Property:** Is this the same service address, a different property, or a corrected address?
3. **Loss/CLM:** Is this the same loss/opportunity or a distinct loss at the same property?
4. **Job:** Is this an existing job or a new related workstream under the same CLM?
5. **Appointment:** Is it a visit for a specific job or a company event?
6. **Financial target:** Which estimate, invoice, payer, and allocation is affected?

Name, phone, email, or address alone is not always sufficient to merge or reparent records.

## Required disambiguation labels

Selection results should expose the smallest set needed to avoid a wrong choice:

- contact/customer name or company;
- phone/email when useful;
- property address;
- CLM number;
- loss date/type when available;
- job number plus division/workstream and status;
- estimate or invoice number;
- invoice balance and payer/allocation context for payment flows.

Use human-readable identifiers. Do not show raw UUIDs.

## Flow-specific invariants

### Scheduling

The office user's task may be “put this customer on the schedule,” but a job appointment still needs
the correct job relationship.

A strong flow can create or select Customer → CLM → Job → Appointment in one uninterrupted
experience. It must still ask only the decisions needed to distinguish:

- existing job;
- new related job under the same loss;
- new loss/CLM for an existing customer;
- entirely new customer and loss.

The selected calendar date/time and schedule context must survive every inline creation step.

### Job creation

Do not equate “new job” with “new claim.” A new mitigation, contents, mold, or reconstruction job may
belong under an existing CLM. Conversely, a repeat loss at the same property generally requires a
distinct CLM even though the customer and address match.

### Estimates

A CLM may have several estimates, and a won estimate may convert into a job under the same claim.
Because the claim-first estimate model is documented as planned work, verify the current linkage and
migration state before relying on it.

### Payments

A payment is not merely “money from this customer.” Review:

- invoice(s) receiving the payment;
- payer identity, which may be homeowner, carrier, mortgage company, or another party;
- partial or split allocation;
- deductible, depreciation, insurance/homeowner responsibility, and current balance semantics;
- QBO/Stripe idempotency and external identifiers;
- authorization to record, edit, void, or reallocate.

Never infer a payment target from customer identity alone.

## UX principle

Hide orchestration, not meaning.

The employee should not manually visit separate pages to assemble the graph, but the interface must
make the selected customer, property, CLM, job, invoice, and payer context clear enough to prevent a
fast wrong transaction.
