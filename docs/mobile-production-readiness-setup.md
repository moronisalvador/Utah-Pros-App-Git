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
 *   Internal:  .codex/config.toml, .codex/agents/*, .agents/skills/mobile-readiness-wave/*,
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
| Codex | Desktop app with GPT-5.6 Sol and Ultra reasoning available | Primary orchestration and project-scoped custom agents |
| Git | Current Git with worktree support | Isolated branches and preservation of unrelated work |
| Node.js | Node 22, matching `.node-version` and `.github/workflows/ci.yml` | Reproducible build/test behavior |
| npm | Version supplied with Node 22; install with `npm ci` | Exact `package-lock.json` dependency graph |
| Repository branch | `codex/mobile-pwa-readiness-foundation`, then a fresh `codex/` wave branch from current `origin/dev` | Loads the foundation and avoids `main` |

No additional npm package is required by the foundation. The adapter generator, preflight, and
governance tests use Node built-ins. Do not globally install Capacitor, Vite, test runners, or
Fastlane as a substitute for the repository declarations.

After checking out the foundation:

```bash
npm ci
npm run generate:mobile-codex
npm run preflight:mobile
npm run validate:tooling
npm run test:tooling
```

Restart/open a new Codex task after checkout so project `.codex/config.toml`, `.codex/agents/*.toml`,
and `.agents/skills/mobile-readiness-wave` are discovered at task start. Select GPT-5.6 Sol and
Ultra reasoning for the primary. The project caps simultaneous subagents at three; the primary is
separate.

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
| Ruby | Ruby 3.3 is declared by the iOS release workflow |
| Bundler/Fastlane | Use `ios/Gemfile`; the missing checked-in lock is a known reproducibility finding, not permission to invent one casually |
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

Do not schedule the whole roadmap unattended on day one. First run Wave R0 manually, confirm the
custom roles, subprocess cleanup, tests, and handoff quality, and adjust the checked-in workflow if
needed. After one successful manual wave, automations may safely handle read-only drift checks,
adapter/preflight validation, test reruns, and status summaries. Production applies, deploys,
provider actions, merges, signing, distribution, and owner decisions remain interactive gates.

## Ready-state checklist

- foundation branch fetched and clean;
- project agent/skill adapters pass generation check;
- Node 22 and lockfile dependencies installed;
- preflight and tooling tests pass;
- a fresh wave branch/worktree exists and its base SHA is recorded;
- GPT-5.6 Sol + Ultra selected;
- Wave 1 prompt copied from `docs/handoff/mobile-production-readiness-wave-1-prompt.md`;
- external systems remain read-only and limitations are named.
