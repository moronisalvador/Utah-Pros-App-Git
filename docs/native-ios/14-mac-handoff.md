<!--
FILE: docs/native-ios/14-mac-handoff.md

WHAT THIS DOES (plain language):
  Provides the exact handoff and opening prompt for resuming the native iOS initiative in a fresh
  Codex session on the owner's Mac with Xcode and simulators.

DEPENDS ON:
  Internal: every file under docs/native-ios/, .claude/rules/native-ios-wave-ownership.md
  Data:     reads → planning branch and repository evidence
            writes → documentation only

NOTES / GOTCHAS:
  - The planning branch must be published or transferred before a different Mac can fetch it.
  - The first Mac session is a decision/foundation checkpoint, not authorization to ship features.
-->

# Native iOS Mac Handoff

## Transfer state

- Planning branch: `codex/native-ios-plan`
- Planning base: `origin/dev` at `90b265ee6f733c8dbcd75786f4e4057dd3355d38`
- This branch contains documentation only.
- This is a review branch, not the default implementation base.
- It must not be merged into `dev` until the owner reviews the plan.
- If the branch is still local on the Windows machine, the Mac cannot fetch it. Publishing the
  branch is a separate owner-authorized Git action.

## What the first Mac session should accomplish

The first session is **Discovery Session A**, not an all-day attempt to settle every future
capability. It should:

1. verify the exact branch, commit, clean worktree, Xcode/Swift/macOS versions, available simulators,
   physical devices, Apple team access, and signing visibility without printing secrets;
2. fetch current `origin/dev` and record merge base/ahead/behind drift without rebasing or editing
   the planning snapshot;
3. read project law and use the plan index as a routed reference rather than making the owner wait
   while every artifact is narrated;
4. decide v1 users/scope, device/accessibility matrix, native visual direction, and two or three
   first-slice candidates using concrete examples;
5. defer DocuSign, background location, AI, broad notification, release and retirement decisions
   unless they materially constrain the next phase;
6. record Session A decisions and prepare a copy-ready **Discovery Session B** prompt for
   first-slice contracts, technical architecture, QA, offline/privacy and dependency decisions;
7. stop for owner review. Do not create the production target or feature screens.

Session B selects the first slice and closes the first-build gate. It may create a disposable,
uncommitted proof-of-toolchain spike only if the owner explicitly opens that phase.
It must not apply migrations, alter live services, deploy, submit, send, charge, or use production
data.

## Transition to an implementation branch

After the owner accepts Sessions A and B and separately authorizes implementation:

1. fetch and verify the latest clean `origin/dev`;
2. record the planning commit, current `origin/dev`, merge base and drift;
3. create a new isolated implementation worktree/branch from the explicitly approved current
   `origin/dev` commit;
4. carry the reviewed planning commit into that branch through a reviewed cherry-pick/merge or
   equivalent exact-path reconciliation;
5. resolve canonical-document drift before code and inspect the complete resulting diff;
6. never begin Swift implementation directly on a stale planning snapshot by default.

## Ready-to-use opening prompt for the Mac

Copy the prompt below into a fresh Codex task after the branch is reachable from the Mac:

```text
Continue the Utah Pros native iOS initiative from the existing planning branch.

Repository: Utah-Pros-App-Git
Required branch: codex/native-ios-plan
Planning base recorded by the plan: origin/dev at
90b265ee6f733c8dbcd75786f4e4057dd3355d38

Do not recreate the plan and do not begin by coding screens.

First:
1. Fetch remote state and check out codex/native-ios-plan in a new isolated worktree.
2. Fetch origin/dev and record the planning HEAD, current origin/dev, merge base, ahead/behind
   count, upstream, worktree status, macOS/Xcode/Swift versions, simulator runtimes, connected test
   device classes, and timestamp. Do not rebase the planning branch.
3. Confirm the worktree contains only the intended plan changes and no unrelated files.
4. Treat this planning branch as review-only. Do not begin implementation on it.
5. Read AGENTS.md and CLAUDE.md completely, then the applicable .claude/rules documents.
6. Read docs/native-ios/README.md and use its linked documents as the routed source of truth.
7. Read the current canonical architecture, database, authorization, business-rule, integration,
   testing/deployment, App Store, QA, design-system, and unfinished-work documents named by the plan.
8. Treat Supabase, production services, production data, provider consoles, Apple configuration,
   deployments, signing, and releases as read-only unless I separately authorize an exact change.

Use one primary orchestrator responsible for scope, dependency ordering, evidence, contradiction
resolution, and final documentation. Use bounded specialists only where scopes are disjoint.
Coordinate all Supabase/schema interpretation through one data-contract lane. No agent may create a
competing roadmap or change application code during the owner-discovery checkpoint.

Run Discovery Session A from docs/native-ios/02-owner-decisions-and-discovery.md with me. Present
recommended defaults and concrete alternatives. Ask only what is needed now:
- product users, first release scope, and which existing workflows must reach parity;
- whether to preserve, evolve, or replace the Apple Field Pro/current mobile visual language;
- brand personality, references, typography, color, density, motion, accessibility, dark mode,
  navigation, device/OS/iPad support, and field-use constraints;
- two or three first end-to-end vertical-slice candidates and what outcome would prove value;
- timeline/budget constraints, available Apple devices/accounts, representative technician access,
  and decisions I want to retain personally.

Defer detailed contracts, offline/storage, DocuSign, location, AI, broader notifications, App Store
cutover, and retirement to Session B or their later gates unless an answer is necessary to avoid a
foundation mistake.

Do not silently choose unresolved owner decisions. Record decision state as `proposed` or
`deferred`; use the canonical `Owner gate` label when the owner's choice or authority is required.

After Session A:
1. Write or update its decision records, including rejected alternatives and explicit deferrals.
2. Define the non-production visual-direction prototypes and representative technician validation
   needed before foundation freeze.
3. Produce a Session B prompt that will select one thin slice and fill its contract, architecture,
   QA, offline/privacy, test, device, performance and ownership packet.
4. Explain current origin/dev drift and the later safe implementation-branch transition.
5. Stop for my review; do not create a Swift project or production identity.

All development servers, simulators controlled by scripts, browser checks, subprocesses, and
runtime validation commands must have a maximum five-minute timeout per attempt, guaranteed cleanup
in a finally/defer block, terminate spawned children, and record authentication/device/environment
limitations as blocked. No optional runtime check may stall the initiative.

Do not modify the existing Capacitor ios/ project, React application, Workers, migrations, live
database, provider configuration, Apple configuration, deployment, or release during this
checkpoint. Do not commit, push, merge, open a PR, deploy, or submit unless I explicitly authorize
that delivery action after reviewing the diff.

End with:
- decisions made and still open;
- exact branch/commit/status and changed files;
- evidence captured and limitations;
- ranked first-slice candidates and the decision needed in Session B;
- owner/external gates;
- the exact Discovery Session B prompt.
```

## Mac evidence to preserve

Record evidence without credentials:

- `sw_vers`, `xcodebuild -version`, `swift --version`, selected developer directory;
- `xcrun simctl list` summary and selected simulator UDIDs only when needed;
- physical device model/OS matrix without personal identifiers;
- Xcode project/workspace and scheme inventory once a native project exists;
- signing **availability/status**, never certificates, keys, session tokens, or profiles themselves;
- Swift Package resolution and license/privacy review;
- simulator and real-device evidence tied to branch, commit, build, OS, device class, and timestamp;
- runtime command, timeout, exit, cleanup result, and whether proof is simulator/device/external.

## Recommended handoff point after the first Mac session

After Session A, stop with the product/design/device decisions, ranked slice candidates,
deferrals, current-branch drift, and a copy-ready Session B prompt. After Session B, stop again once
the selected-slice packet, architecture ADR, QA/offline/privacy gates, and design-foundation scope
are reviewable. Both checkpoints are intentionally before broad implementation.
