<!--
FILE: docs/native-ios/16-plan-validation.md

WHAT THIS DOES (plain language):
  Records the provenance, independent reviews, validation checks, resolved contradictions, and
  honest limitations of the Native iOS planning package.

DEPENDS ON:
  Internal: every plan, contract, decision, template, ownership, and canonical update in this branch
  Data:     reads → Git/source/documentation evidence and validator output
            writes → documentation only

NOTES / GOTCHAS:
  - This validates the planning package, not a Swift application or live configuration.
  - Final Git commit/status is reported in the handoff because a document cannot embed its own
    final commit SHA without changing that SHA.
-->

# Native iOS Plan Validation

## Snapshot boundary

- Planning branch: `codex/native-ios-plan`
- Base branch: `origin/dev`
- Base commit: `90b265ee6f733c8dbcd75786f4e4057dd3355d38`
- Prepared/reviewed: 2026-07-25
- Scope: documentation, contract-orientation inventory, ownership rules, and canonical
  cross-references only
- Application/Capacitor/Worker/SQL/migration/CI/live-system changes: none

The prior mobile audit snapshot remains separate. Its repository/device limitations were used as
historical evidence but were not rebased, copied wholesale, or promoted into current device proof.

## Investigation model

One orchestrator retained scope, sequencing, evidence, normalization, contradiction resolution,
canonical updates, diff review, and final delivery. Bounded parallel workstreams covered:

- owner discovery, design foundations, accessibility, information architecture and workflow parity;
- data environments, contracts, security/privacy/compliance and offline/reliability;
- platform capabilities, testing/device proof, App Store/cutover, roadmap and agent ownership.

The design and delivery authors then performed independent cold reviews of work they did not own.
The orchestrator corrected the shared package and requested a separate data/security challenge.

## Material review corrections

The independent review prevented the following from remaining implicit or contradictory:

- one canonical evidence vocabulary, with provenance and decision state stored separately;
- a planning branch that is review-only and a fresh implementation branch based on current
  `origin/dev`;
- staged Discovery Session A and Session B instead of one overwhelming owner workshop;
- non-production design prototype, compiled SwiftUI reference, then device/human acceptance as
  distinct evidence;
- provisional first-slice implementation may continue while physical-device/human proof is
  blocked, but acceptance/foundation freeze/scaling may not;
- Dry Logs remains an owner-selected candidate rather than a silently fixed first slice;
- Phase 2A read/client foundations are separate from externally gated Phase 2B mutation QA;
- global design foundations plus selected-slice components replace speculative full-library work;
- nonproduction bundle identity and production App Store/bundle cutover are separate decisions;
- same-bundle migration includes legacy WebKit/Capacitor/Keychain/container inventory and reviewed
  import/quarantine/purge;
- capability lanes use real prerequisites instead of unrelated serial dependencies;
- credential-free CI and later isolated-QA CI are explicit deliverables;
- public client credential language aligns with the governed publishable-key/rotation plan;
- Swift domain code orchestrates client state but does not become a second business-rule authority;
- representative-technician usability evidence is distinct from owner approval;
- all Dynamic Type accessibility sizes are the default contract;
- native confirmation/undo/receipt/recovery preserves the safety invariant without blindly copying
  the web two-step interaction;
- Critical/High/Medium/Low severity has a shared impact rubric;
- sustained operations covers toolchains, OS/devices, dependencies, Apple assets, privacy,
  contracts, SLOs, incidents, support and recurring releases after cutover.
- contract truth now records normative intent and deployed observation independently;
- the trusted boundary derives actor/membership and audit attribution instead of trusting
  client-supplied identity fields;
- corrected mutations use a new operation ID, and receipt contracts now require concurrency,
  authorization, replay, retention, cleanup, and expiry semantics;
- authorization evidence is structured per privilege, policy command/expression, view, RPC
  overload, scope-column mutation, and source/live evidence axis;
- local and hosted QA prerequisites are assigned to the layers they can actually prove;
- independent source review added missing Auth operations, two push RPCs, invoice tables, direct
  read operations, and exact Realtime events to the bootstrap inventory, and removed one
  conversation read that its cited caller did not perform.

## Static validation

The following planning-package checks were executed with bounded commands:

| Check | Result |
|---|---|
| YAML parse | `registry-template.yaml` and `bootstrap-inventory.yaml` parsed with local `yq` |
| Bootstrap source paths | 57 unique referenced repository paths exist |
| Bootstrap uniqueness/count | no duplicate names within categories; 5 Auth operations, 73 RPCs, 20 direct tables, 22 Workers, 2 Storage buckets, 3 Realtime tables |
| Bootstrap literal coverage | scoped source literals and recorded operation/event lists reconciled after independent review; declared dynamic/out-of-scope limitations retained |
| Bootstrap semantics | every entry remains `inventory_only`; no live authorization/safety approval is claimed |
| Local Markdown targets | resolved across 32 planning/canonical/rule documents; two known pre-existing placeholder links in the large UPR context were excluded, and all new targets were checked directly |
| Documentation headers | every native planning Markdown file includes the project documentation header |
| Credential-like values | none found in intended planning/canonical artifacts |
| Legacy evidence tokens | no legacy bracketed evidence vocabulary remains |
| Tracked whitespace/diff | `git diff --check` passed before staging |

The final staged diff, exact changed-file allowlist, and clean post-commit status are separate
close-out checks and must be reported with the commit.

## Evidence not obtained

This plan does **not** claim:

- Xcode, Swift compilation, Simulator, signing, archive, TestFlight, App Store, or device proof;
- current Apple Developer/App Store Connect/APNs/provider configuration;
- current live Supabase catalog, grants, RLS, functions, Storage, Realtime, data, or deployment
  state beyond the explicitly dated evidence;
- a provisioned local Supabase or hosted native QA environment;
- authenticated native workflows, media, offline sync, location, notifications, DocuSign, AI,
  performance, battery or accessibility behavior;
- owner approval of the proposed visual direction, architecture, first slice, supported devices,
  production bundle/listing, or release decisions;
- permission to implement, migrate, deploy, sign, upload, submit, publish, merge, or retire
  Capacitor.

Those are named later gates rather than hidden omissions.

## Disposition

The package is ready for owner review and Discovery Session A on the Mac. It is not a production
readiness attestation and not standing implementation authority. A committed scaffold waits for the
Phase 0 first-build gate; production and external actions remain separately authorized.
