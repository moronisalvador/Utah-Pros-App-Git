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
- Prepared/reviewed: 2026-07-25; Apple Field Pro and current-client-first sequencing addenda
  2026-07-26
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
- the completed mobile audit is reused rather than restarted, and a finite `NIOS-H` supportable
  baseline now precedes all committed Swift implementation;
- planning-only discovery remains a separately authorized exception, while the copy-ready Mac
  prompt deliberately stops when `NIOS-H` is stale or anything other than `READY`;
- staged Discovery Session A and Session B instead of one overwhelming owner workshop;
- non-production design prototype, compiled SwiftUI reference, then device/human acceptance as
  distinct evidence;
- after Gate H, Phase 0, and implementation-authority entry conditions pass, provisional
  first-slice work may continue while physical-device/human proof is blocked, but
  acceptance/foundation freeze/scaling may not;
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
- Apple Field Pro is the approved product/experience blueprint, while its exact native visual
  system and HTML/CSS/WebView mechanics are not preapproved implementation contracts;
- locked Apple Field Pro layouts/workflows are preserve-by-default, and unfinished/rework-requested
  areas remain discovery gates;
- current-PWA field utility is required comparative evidence rather than either discarded legacy or
  automatic visual authority;
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

## 2026-07-26 Apple Field Pro direction addendum

The owner approved evolving Apple Field Pro as the native app's product/experience blueprint while
making it more field-friendly and using the current PWA's readability/touch strengths as
comparative evidence. This addendum:

- added accepted ADR 0002;
- added a source-maturity and screen-level preservation/adaptation matrix;
- closed `preserve / evolve / replace` as **evolve** for layouts/workflows/refinements without
  closing colors, typography, symbols, materials, theme, native tab membership, device scope, exact
  component values, architecture, or first-slice gates;
- distinguished locked screens from pending-device-reaction, rework-requested, and unfinished flows;
- updated the roadmap, execution contract, design review, risk, completeness, Mac handoff, canonical
  context, and unfinished-work ledger so a fresh session does not restart or overstate the design;
- preserved the rule that owner approval and representative technician/physical-device proof are
  separate evidence.

No application source, Capacitor project, backend, database, provider, Apple configuration,
deployment, or production state changed.

### Independent addendum challenge and disposition

An independent read-only Apple Field Pro review on 2026-07-26 requested corrections before commit:

| Challenge | Disposition |
|---|---|
| Owner approval was stated too broadly as a frozen visual lineage | **Corrected:** approval is scoped to layout/workflow/refinement continuity; exact native colors, typography, symbols, materials, controls, and measurements remain proposed |
| The Mac prompt could open the HTML fragment incorrectly | **Corrected:** it requires the committed `serve.cjs` wrapper, forbids `file://`/bare servers on iOS, and binds the child to the five-minute/finally cleanup contract |
| Session A appeared to require SwiftUI implementation | **Corrected:** Session A produces non-production native-intent design artifacts; compiled SwiftUI remains D3 or separately authorized |
| New Job overpromoted claim/sync prototype behavior | **Corrected:** only explicit quick-add and Job Hub destination decisions are preserved; claim behavior is verify and sequence/sync presentation are reopened |
| Published artifact browser evidence needed a retained boundary | **Confirmed:** the orchestrator opened the published artifact on 2026-07-25, observed “UPR Tech PWA — Combined Prototype” and the expected navigable states; the committed HTML remains authoritative |

The Apple Field Pro reviewer reran the complete corrected diff and returned **PASS — no remaining
actionable findings**. A separate contract/governance review returned pass after one stale roadmap
review date was corrected.

## 2026-07-26 current-client-first sequencing addendum

The owner chose to finish hardening the operational PWA/Capacitor client before beginning the native
program on the Mac. This addendum:

- added accepted ADR 0003 and the canonical `NIOS-H` gate;
- adopted the completed mobile audit and its existing finding IDs as inputs rather than restarting
  orientation, census, specialist work, tests, governance, or Supabase evidence, and required reuse
  of any subsequently produced Mac addenda;
- defined `READY` as audit P0, current-client/shared-contract Critical, and unconditional P1
  closure; conditional P1 closure or explicit capability exclusion; and safe ownership of
  lower-risk debt;
- required current source/deployment identity, supported-capability scope, browser/PWA/Capacitor,
  Mac/device, rollback/support, independent-review, and owner-acceptance evidence;
- made Gate H and native Phase 0 separate prerequisites to Phase 1, with distinct implementation
  authority still required;
- updated the Mac prompt to fail closed before Discovery A when the hardening record is missing,
  stale, open, or blocked and to return a continuation prompt for the existing hardening work;
- kept current-client remediation, production/database/provider changes, deployment, Apple actions,
  and Swift implementation outside this documentation branch's authority.

The gate intentionally avoids two errors: beginning a rewrite while the fallback is unsafe, and
waiting for unrelated cosmetic or long-term debt after a supportable baseline is proven.

### Independent sequencing challenge and disposition

An independent read-only reviewer challenged the complete sequencing diff for early-start
loopholes, stale evidence, unbounded scope, mixed authority, and process cleanup:

| Challenge | Disposition |
|---|---|
| Phase 0, contract maturity, or a local scaffold could be mistaken for authority to start Swift | **Corrected:** Gate H, Phase 0, current-base reconciliation, fresh worktree, and separate implementation authority are all required |
| Completed audit work could be restarted or stale evidence promoted | **Corrected:** reuse existing finding IDs and evidence through a per-artifact provenance/freshness ledger; refresh only affected drift |
| The Mac prompt could evaluate stale `origin/dev` or pivot into production/current-client changes | **Corrected:** fetch precedes the gate decision; anything other than current `READY` stops; Discovery is strictly read-only |
| Runtime cleanup or the optional toolchain spike could leave unrelated processes/artifacts | **Corrected:** exact task-owned process cleanup only; temp/untracked/unsigned spike with guaranteed cleanup and no Phase 1 credit |
| A global High/cleanup requirement could become an indefinite perfection gate | **Corrected:** the gate is scoped to the supported current-client fallback/shared contracts and permits owned safe lower-risk deferrals |

The reviewer then reran the corrected package and returned **PASS — no remaining actionable
sequencing, authority, evidence-freshness, or runtime-cleanup contradiction**.

## Static validation

The following planning-package checks were executed with bounded commands:

| Check | Result |
|---|---|
| YAML parse | `registry-template.yaml` and `bootstrap-inventory.yaml` parsed with local `yq` |
| Bootstrap source paths | 57 unique referenced repository paths exist |
| Bootstrap uniqueness/count | no duplicate names within categories; 5 Auth operations, 73 RPCs, 20 direct tables, 22 Workers, 2 Storage buckets, 3 Realtime tables |
| Bootstrap literal coverage | scoped source literals and recorded operation/event lists reconciled after independent review; declared dynamic/out-of-scope limitations retained |
| Bootstrap semantics | every entry remains `inventory_only`; no live authorization/safety approval is claimed |
| Local Markdown targets | all local links resolved across 29 native planning Markdown files; new canonical cross-references were checked directly; two known pre-existing placeholder links in the large UPR context remain outside the scan |
| Documentation headers | all 29 native planning Markdown files include the project documentation header |
| Credential-like values | none found across the 26 intended files in the current sequencing diff |
| Legacy evidence tokens | no legacy bracketed evidence vocabulary remains |
| Markdown tables | all 29 native planning Markdown files have consistent table delimiters |
| Tracked whitespace/diff | `git diff --check` passed before staging; the two new files were separately checked for trailing whitespace |

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
- owner approval of exact native typography, symbols, tokens, tab structure, architecture, first
  slice, supported devices, production bundle/listing, or release decisions; Apple Field Pro
  evolution itself is approved;
- permission to implement, migrate, deploy, sign, upload, submit, publish, merge, or retire
  Capacitor.
- a completed or owner-accepted `NIOS-H` current-client hardening baseline.

Those are named later gates rather than hidden omissions.

## Disposition

The package is ready for owner review. The recommended Mac prompt begins Discovery Session A only
after a current `NIOS-H: READY` handoff; until then it returns to the existing current-client
hardening initiative without restarting its audit. This is not a production-readiness attestation
and not standing implementation authority. A committed scaffold waits for Gate H, the Phase 0
first-build gate, current-base reconciliation, a fresh worktree, and separate implementation
authority; production and external actions remain separately authorized.
