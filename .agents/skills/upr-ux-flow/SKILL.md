---
name: upr-ux-flow
description: Design or simplify a material UPR user journey, workflow, page, modal, drawer, wizard, onboarding, or dependent-record creation flow. Use with new-feature, masterplan, new-crm-module, or upr-interface-craft when task completion, discoverability, context continuity, click count, progressive disclosure, or cross-entity orchestration matters. Skip trivial visual edits and purely backend work.
---

<!-- GENERATED from tooling/skills/upr-ux-flow/SKILL.md by scripts/render-tooling-adapters.mjs. Do not edit this adapter directly. Source SHA-256: 2316ad147266dd65. -->

# UPR UX flow

Design around the user's intended outcome, not the database entity hierarchy.

## 1. Establish the task

Identify the user, entry point, desired outcome, frequency, urgency, prior knowledge, and failure
consequence. Write the task in the user's language, such as “put this customer on the schedule,”
rather than as a sequence of tables or routes.

Map the current path before proposing a replacement. Count route changes, steps, required decisions,
manual returns, repeated entry, and information the user must remember across contexts.

## 2. Define scenarios before screens

Cover at least:

- fastest common path;
- existing related records;
- missing dependent records created inline;
- duplicate or ambiguous matches;
- validation and permission denial;
- partial failure, retry, cancel, draft, and resume;
- long content, keyboard/focus, mobile touch, offline, and reduced-motion behavior when applicable.

State required-now fields separately from information that can be inferred, defaulted, or deferred.

## 3. Preserve task context

Keep the initiating surface visible or return the user to the exact prior context. Preserve selected
date/time, filters, scroll position, draft values, and newly created record selection.

When the primary task depends on related records, search or create them inline unless the dependent
record genuinely requires a separate complex workflow. The system should orchestrate client,
property, job, appointment, estimate, work order, or other dependent records without making the user
manually traverse their storage order.

## 4. Choose the smallest coherent interaction

Prefer:

- one obvious primary action;
- unified search across the identifiers users actually know;
- inline create from empty or no-match states;
- progressive disclosure for rare or deferrable fields;
- sensible defaults and prefilled context;
- transactional or compensating backend behavior for multi-record creation;
- explicit success confirmation and the next likely action.

Do not optimize click count alone. Minimize cognitive load, context switching, ambiguity, irreversible
mistakes, and recovery cost.

## 5. Produce a flow contract

Before implementation, document:

- current and proposed flow diagrams;
- scenario/path matrix;
- required versus deferrable fields;
- state and recovery matrix;
- data and authorization boundaries;
- persistence/transaction behavior;
- desktop and mobile interaction models;
- measurable acceptance criteria.

Store durable contracts under `docs/ux/flows/<flow-name>/` when the workflow is likely to be reused,
reviewed across sessions, or implemented in phases.

## 6. Verify independently

After planning and after implementation, run `ux-flow-reviewer` for any material new or changed flow,
page, modal, drawer, wizard, or onboarding experience. A visual review does not substitute for this
task-completion review.

For implemented work, exercise the real happy paths and alternates with browser tests where
available. Record rendered evidence separately from source inspection and real-device evidence.
