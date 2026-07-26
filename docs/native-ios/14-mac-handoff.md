<!--
FILE: docs/native-ios/14-mac-handoff.md

WHAT THIS DOES (plain language):
  Provides the exact handoff and opening prompt for resuming the native iOS initiative in a fresh
  Codex session on the owner's Mac with Xcode and simulators.

DEPENDS ON:
  Internal: every file under docs/native-ios/,
            docs/tech-redesign/prototypes/full-app.html,
            docs/tech-redesign/prototypes/serve.cjs,
            .claude/rules/native-ios-wave-ownership.md
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
4. preserve the approved Apple Field Pro **evolve** direction and load its source/maturity matrix;
   do not restart or relitigate preserve/evolve/replace, but do design the exact native visual
   system;
5. decide v1 users/scope, device/accessibility matrix, remaining native/field adaptations, and two
   or three first-slice candidates using the same realistic content across the current PWA, Apple
   Field Pro, and non-production native-intent design examples;
6. defer DocuSign, background location, AI, broad notification, release and retirement decisions
   unless they materially constrain the next phase;
7. record Session A decisions and prepare a copy-ready **Discovery Session B** prompt for
   first-slice contracts, technical architecture, QA, offline/privacy and dependency decisions;
8. stop for owner review. Do not create the production target or feature screens.

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

Owner decisions already closed — do not ask me to choose these again:
- Build a separate Swift/SwiftUI client in parallel; keep the PWA/Capacitor clients operational.
- Complete design discovery and a reusable native design foundation before scaling feature UI.
- EVOLVE Apple Field Pro as the native blueprint. Preserve its refinements, layouts, information
  hierarchy, and owner-locked workflows by default.
- Adapt Apple Field Pro for field readability, easier tapping, gloves, sunlight, one-hand use,
  accessibility, and native iOS behavior. Use the current PWA as comparative field evidence.
- Exact native colors, typography, symbols, materials, controls, measurements, and tab membership
  are not closed; decide them with concrete prototypes and device/field evidence.
- Do not use a slow screen-by-screen native migration inside Capacitor as the primary strategy.

First:
1. Fetch remote state and check out codex/native-ios-plan in a new isolated worktree.
2. Fetch origin/dev and record the planning HEAD, current origin/dev, merge base, ahead/behind
   count, upstream, worktree status, macOS/Xcode/Swift versions, simulator runtimes, connected test
   device classes, and timestamp. Do not rebase the planning branch.
3. Confirm the worktree contains only the intended plan changes and no unrelated files.
4. Treat this planning branch as review-only. Do not begin implementation on it.
5. Read AGENTS.md and CLAUDE.md completely, then the applicable .claude/rules documents.
6. Read docs/native-ios/README.md and use its linked documents as the routed source of truth.
7. Read docs/native-ios/decisions/0002-evolve-apple-field-pro-for-native-ios.md and
   docs/native-ios/03a-apple-field-pro-adaptation-matrix.md.
8. Load the durable Apple Field Pro sources:
   - docs/tech-redesign/TECH-DESIGN-STANDARD.md
   - docs/tech-redesign/SESSION-STATE.md
   - docs/tech-redesign/UX-FLOWS-BRIEF.md
   - docs/tech-redesign/prototypes/full-app.html
   Also open the published combined artifact when authenticated access is available:
   https://claude.ai/code/artifact/c7a22959-8a60-403a-8d4f-c000b08e730e?org=d137bb60-ad62-4349-858b-7098b468cfdc
   The committed HTML is the durable source of truth. Preserve maturity labels: locked, pending
   owner-device reaction, rework requested, and unfinished.
   If rendering the committed prototype locally, never use file:// or a bare
   `python3 -m http.server`: these files are HTML fragments and render blank or incorrectly on iOS.
   Start `node docs/tech-redesign/prototypes/serve.cjs` as a recorded child process inside a
   maximum-five-minute bounded wrapper, open
   `http://localhost:8899/full-app.html#s-working` in Simulator Safari (or the Mac LAN URL on the
   owner's iPhone), and terminate/wait for that exact child in guaranteed finally/defer cleanup.
   If port 8899 belongs to another process, do not terminate it; use an explicit alternate port.
9. Read the current canonical architecture, database, authorization, business-rule, integration,
   testing/deployment, App Store, QA, design-system, and unfinished-work documents named by the plan.
10. Treat Supabase, production services, production data, provider consoles, Apple configuration,
   deployments, signing, and releases as read-only unless I separately authorize an exact change.

Use one primary orchestrator responsible for scope, dependency ordering, evidence, contradiction
resolution, and final documentation. Use bounded specialists only where scopes are disjoint.
Coordinate all Supabase/schema interpretation through one data-contract lane. No agent may create a
competing roadmap or change application code during the owner-discovery checkpoint.

Run Discovery Session A from docs/native-ios/02-owner-decisions-and-discovery.md with me. Present
recommended defaults and concrete alternatives. Ask only what is needed now:
- product users, first release scope, and which existing workflows must reach parity;
- the specific field adaptations Apple Field Pro still needs: typography, contrast, density, target
  size/separation, one-hand reach, keyboard/focus, navigation, theme, motion, symbols, device/OS/iPad
  support, and accessibility;
- which current-PWA choices are easier to read, understand, reach, or tap for the same task and
  should inform the native translation;
- two or three first end-to-end vertical-slice candidates and what outcome would prove value;
- timeline/budget constraints, available Apple devices/accounts, representative technician access,
  and decisions I want to retain personally.

Do not present unrelated blank-slate product directions. For representative Schedule/Add Visit and
Job Hub/field-work states, compare the same realistic synthetic content in:
1. the current PWA/Capacitor experience;
2. the committed Apple Field Pro prototype; and
3. one or two field-adapted native-intent design translations.
These Session A translations are non-production design artifacts, not a Swift project or feature
implementation.
Record Preserve/Translate/Adapt/Reopen/Verify dispositions and never promote unfinished Apple Field
Pro flows to locked requirements.

Defer detailed contracts, offline/storage, DocuSign, location, AI, broader notifications, App Store
cutover, and retirement to Session B or their later gates unless an answer is necessary to avoid a
foundation mistake.

Do not silently choose unresolved owner decisions. Record decision state as `proposed` or
`deferred`; use the canonical `Owner gate` label when the owner's choice or authority is required.

After Session A:
1. Write or update its decision records, including rejected alternatives and explicit deferrals.
2. Complete the preservation/adaptation records for candidate first-slice screens and define the
   non-production native-intent design prototypes plus representative technician validation needed
   before foundation freeze. Reserve compiled SwiftUI for D3 or a separately authorized spike.
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
Apple Field Pro preservation/adaptation records, deferrals, current-branch drift, and a copy-ready
Session B prompt. After Session B, stop again once the selected-slice packet, architecture ADR,
QA/offline/privacy gates, and design-foundation scope are reviewable. Both checkpoints are
intentionally before broad implementation.
