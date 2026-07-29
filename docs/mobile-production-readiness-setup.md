/**
 * ════════════════════════════════════════════════
 * FILE: mobile-production-readiness-setup.md
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Lists the tools, local setup, and checks needed before a mobile-readiness build task starts.
 *   It separates required source-work tools from later Apple, production, and provider gates.
 *
 * DEPENDS ON:
 *   Packages:  repository package-lock.json
 *   Internal:  tooling/capabilities.json, tooling/skills/mobile-readiness-wave/,
 *              tooling/agents/mobile-readiness-*, generated .claude/.agents/.codex adapters,
 *              scripts/mobile-readiness-preflight.mjs
 *   Data:      reads  → local tool versions and repository metadata
 *              writes → local dependency/cache folders only when the operator runs npm ci
 *
 * NOTES / GOTCHAS:
 *   - Never copy credentials into a worktree or commit machine-local environment files.
 *   - Apple signing, TestFlight, Supabase applies, and provider access are later owner gates.
 * ════════════════════════════════════════════════
 */

# Mobile Production Readiness — Workstation and Task Setup

## Required for every source-work task

| Requirement | Supported setup | Why |
|---|---|---|
| Codex | Desktop app with GPT-5.6 Sol and Ultra reasoning available | Primary orchestration and neutral-generated project agents |
| Git | Current Git with worktree support | Isolated branches and preservation of unrelated work |
| Node.js | Node 22, matching `.node-version` and `.github/workflows/ci.yml` | Reproducible build/test behavior |
| npm | Version supplied with Node 22; install with `npm ci` | Exact `package-lock.json` dependency graph |
| Repository branch | Fresh isolated `codex/` wave branch/worktree from the exact reviewed handoff SHA | Avoids `main` and stale branch assumptions; fetch and reconcile current `origin/dev` without rewriting history before editing |

No additional npm package is required by the mobile tooling. The neutral adapter generator,
preflight, and governance tests use Node built-ins. Do not globally install Capacitor, Vite, test
runners, or Fastlane as a substitute for the repository declarations.

After creating the isolated worktree:

```bash
npm ci
npm run generate:tooling
npm run check:tooling-generated
npm run validate:tooling
npm run test:tooling
npm run preflight:mobile
```

`npm run preflight:mobile` is read-only and never fetches. When current-origin freshness is required
and that network read is authorized, refresh the local `origin/dev` ref separately before running
the gate. The preflight prints full SHAs for `refs/remotes/origin/dev` and
`refs/heads/codex/mobile-pwa-readiness-foundation`, requires a nonempty
`codex/mobile-readiness-*` branch and zero unmerged index entries, and proves both histories are
preserved:

- during an intentional no-commit integration, one side must equal the exact local `origin/dev`
  SHA and the other side must be the sole `MERGE_HEAD`; the mobile side must preserve/descend from
  the foundation;
- after a normal merge commit, both the local `origin/dev` and foundation refs must be ancestors of
  `HEAD`.

The command does not create, resolve, or commit a merge and does not prove that a dirty integration
tree is promotable.

Edit only the neutral files in `tooling/`; never hand-edit their generated `.claude`, `.agents`, or
`.codex` adapters. Restart/open a new task after checkout or regeneration so the runtime discovers
the generated skill and agents at task start. Select GPT-5.6 Sol and Ultra reasoning for the primary.
The project caps simultaneous subagents at three; the primary is separate.

For a source-only mobile build check, use `npm run build:native`. It forces the native target and
enforces the field-only module graph. `npm run build:ios` also runs `cap sync ios` and therefore
belongs only to an explicitly authorized native synchronization/release lane.

## Optional delivery tooling

- GitHub CLI (`gh`) is useful for authentication, pushing, and an explicitly requested PR. Source
  implementation does not require it, and no session should push/open/merge by implication.
- A connected Supabase tool is useful for minimal read-only catalog/configuration recapture.
  Migration/application permissions are not a prerequisite and should not be broadly pre-approved.
- Browser control is needed only for a declared browser/device verification lane. A credential-free
  fixture is not authenticated application proof.

The unrelated recommended connectors (Atlassian, Box, Figma, Notion, Outlook, SharePoint, Teams)
are not dependencies of this program and should not be installed merely to enlarge the tool surface.

## Native-lane requirements

These are required only when a session explicitly enters a Capacitor/iOS validation or release
lane:

| Requirement | Boundary |
|---|---|
| macOS + Xcode | Xcode 26.6 was used in the 2026-07-25 audit; re-check the selected Xcode path/version |
| iOS simulator runtime | iOS 26.5 and an iPhone 17 Pro simulator passed unsigned validation; this is not physical-device proof |
| Node/npm dependencies | `npm ci`, then the repository `build:ios`/Capacitor commands as declared |
| Ruby | Exact source pin: Ruby 3.3.12 in `ios/.ruby-version`, `ios/Gemfile`, and the release workflow |
| Bundler/Fastlane | Release workflow and `ios/Gemfile.lock` pin Bundler 2.5.22; `ios/Gemfile`/lock pin Fastlane 2.237.0 on Ruby 3.3.12 |
| Capacitor App plugin | Direct `@capacitor/app` source and the managed `CapApp-SPM/Package.swift` are synchronized; every release still rejects unexpected `cap sync ios` drift |
| Apple team/certificate/profile | Required for signed archive/device/TestFlight work and supplied only through an owner-controlled gate |
| Physical devices | Named supported iPhone/iPad models and OS versions for the signed release matrix |

The unsigned generic-device and simulator build evidence proves local compilation, install, and
launch only. It does not prove signing, entitlements, privacy declarations, APNs, Universal Links,
OTA, physical-device lifecycle, TestFlight, or App Review.

## External gates that are intentionally not preinstalled

Do not put these into repository files or broad shared permissions:

- Supabase service-role credentials or migration apply authority;
- Cloudflare production deploy tokens;
- Twilio, Resend, QBO, CallRail, Stripe, Capgo, or APNs provider secrets;
- Apple certificates, provisioning profiles, App Store Connect keys, or real test identities;
- customer content, customer identifiers, or copied production data.

When a later wave reaches one of these gates, create a separate bounded task, name the exact action
and rollback, use the smallest permission/window, and record observed results without exposing
secret material.

## Automation policy

Do not schedule the whole roadmap unattended. Keep each wave bounded, confirm the neutral roles,
subprocess cleanup, tests, and handoff quality, and adjust the checked-in neutral source if needed.
Automations may handle read-only drift checks, adapter/preflight validation, test reruns, and status
summaries. Production applies, deploys, provider actions, merges, signing, distribution, and owner
decisions remain interactive gates.

## Ready-state checklist

- exact handoff SHA and current `origin/dev` fetched, recorded, and reconciled in an isolated
  worktree without rewriting history;
- neutral project agent/skill sources exist and all generated adapters pass the drift check;
- Node 22 and lockfile dependencies installed;
- tooling checks/tests pass and the mobile preflight reports no errors;
- web and native target builds pass from the reconciled source;
- GPT-5.6 Sol + Ultra selected;
- the current bounded handoff prompt and roadmap phase are identified;
- external systems remain read-only and limitations are named.
