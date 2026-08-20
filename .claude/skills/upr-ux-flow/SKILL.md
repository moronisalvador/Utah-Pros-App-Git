---
name: upr-ux-flow
description: Design or simplify a material UPR user journey, workflow, page, modal, drawer, wizard, onboarding, or dependent-record creation flow. Use with new-feature, masterplan, new-crm-module, or upr-interface-craft when task completion, discoverability, context continuity, click count, progressive disclosure, or cross-entity orchestration matters. Skip trivial visual edits and purely backend work.
---

<!-- GENERATED from tooling/skills/upr-ux-flow/SKILL.md by scripts/render-tooling-adapters.mjs. Do not edit this adapter directly. Source SHA-256: 289035529e1ed5ae. -->

# UPR UX flow

Design around the user's intended outcome without corrupting UPR's restoration record graph.

## 1. Establish the task

Identify the user, entry point, desired outcome, frequency, urgency, prior knowledge, and failure
consequence. Write the task in the user's language, such as “put this customer on the schedule,”
rather than as a sequence of tables or routes.

Map the current path before proposing a replacement. Count route changes, steps, required decisions,
manual returns, repeated entry, and information the user must remember across contexts.

## 2. Load the UPR record graph

For any flow touching customers, contacts, properties, CLMs/claims, estimates, jobs, appointments,
invoices, or payments, read
[restoration-record-graph.md](references/restoration-record-graph.md) plus the current canonical
domain evidence it names.

Do not mistake “hide the assembly sequence” for “flatten the business model.” The interface may
orchestrate several records in one task, but it must preserve their distinct identity, cardinality,
authorization, and financial meaning.

Determine before designing:

- which record is the user's anchor and which records are parents, children, joins, or allocations;
- whether an existing CLM represents the same property/loss or a different loss for the same customer;
- whether a new job is another division/workstream under an existing CLM or a new claim entirely;
- whether an appointment is a job visit or a company event;
- whether a payment belongs to one invoice, several invoice allocations, or an external combined-QBO
  relationship;
- which current contracts are live versus only planned in a roadmap.

## 3. Define scenarios before screens

Cover at least:

- existing customer + existing CLM + existing job;
- existing customer + existing CLM + new related job;
- existing customer + new loss/property/CLM;
- new customer + new CLM + new job;
- same property with a repeat loss;
- multiple plausible customers, properties, CLMs, jobs, or invoices;
- missing dependent records created inline;
- validation, authorization, and financial-permission denial;
- partial failure, retry, cancel, draft, and resume;
- long content, keyboard/focus, mobile touch, offline, and reduced-motion behavior when applicable.

Add estimate, appointment, invoice, payment, payer, or allocation scenarios when the flow touches
those records. State required-now fields separately from information that can be inferred, defaulted,
or deferred.

## 4. Preserve task context

Keep the initiating surface visible or return the user to the exact prior context. Preserve selected
date/time, filters, scroll position, draft values, newly created record selection, and the chosen
customer/CLM/job chain.

When the primary task depends on related records, search or create them inline unless the dependent
record genuinely requires a separate complex workflow. The system should orchestrate the required
records without making the user manually traverse their storage order.

Inline orchestration must not silently create duplicates. Show enough human-readable context to
distinguish same-name customers, multiple properties, repeat losses, related job numbers, divisions,
invoice balances, and payer identities.

## 5. Choose the smallest coherent interaction

Prefer:

- one obvious primary action;
- unified search across the identifiers users actually know: name, company, phone, email, property
  address, CLM number, job number, estimate number, and invoice number;
- results labeled with the minimum disambiguating context, not raw internal ids;
- inline create from empty or no-match states;
- explicit “use existing” versus “create new loss/CLM” and “add related job” decisions;
- progressive disclosure for rare or deferrable fields;
- sensible defaults and prefilled context;
- transactional or compensating backend behavior for multi-record creation or payment allocation;
- explicit success confirmation and the next likely action.

Do not optimize click count alone. Minimize cognitive load, context switching, ambiguity, wrong-parent
selection, duplicate creation, irreversible mistakes, and recovery cost.

## 6. Protect business invariants

A streamlined flow must still prove:

- contacts remain reusable person/company records rather than being treated as a claim or job;
- a CLM/claim remains the umbrella for one loss/opportunity and may contain multiple estimates and
  jobs;
- a job remains a specific production workstream/division under a CLM and may contain multiple
  appointments and invoices;
- job appointments attach to the correct job; company events remain distinct;
- invoices and payments follow the live billing source of truth, including allocations and payer
  identity, rather than being attached loosely to a customer;
- records are never auto-merged or auto-reparented from weak matches such as name alone;
- planned hierarchy changes are not assumed to be deployed.

When the desired UX requires atomic cross-record creation or allocation that the current backend
cannot guarantee, route the persistence work through the applicable feature and database workflows
instead of implementing a fragile client sequence.

## 7. Produce a flow contract

Before implementation, document:

- current and proposed flow diagrams;
- UPR record-graph/cardinality map for the touched entities;
- scenario/path matrix;
- required versus deferrable fields;
- state and recovery matrix;
- duplicate-detection and disambiguation rules;
- data, authorization, payer, and financial boundaries;
- persistence, transaction, compensation, and idempotency behavior;
- desktop and mobile interaction models;
- measurable acceptance criteria.

Store durable contracts under `docs/ux/flows/<flow-name>/` when the workflow is likely to be reused,
reviewed across sessions, or implemented in phases.

## 8. Verify independently

After planning and after implementation, run `ux-flow-reviewer` for any material new or changed flow,
page, modal, drawer, wizard, or onboarding experience. A visual review does not substitute for this
task-completion and record-integrity review.

For implemented work, exercise the real happy paths and alternates with browser tests where
available. Record rendered evidence separately from source inspection and real-device evidence.
