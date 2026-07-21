# App Store Readiness — File Ownership Manifest

**Committed with the plan of record. Binding for every app-store-readiness build session.**
Linked from `docs/app-store-readiness-roadmap.md` (the plan of record). Each session's read scope =
`CLAUDE.md` + its phase block in the roadmap + this file. Where the roadmap prose and this manifest
disagree, **this manifest is authoritative**.

Isolation in this initiative is **not** a feature flag (native/ops hardening, no user-facing surface
gate needed) — it's (a) this file-ownership split and (b) git-worktree isolation, all run from one
orchestrating session via the Workflow tool rather than separate cold sessions.

## 1. Frozen — nobody in this initiative edits outside their own phase

- `docs/app-store-readiness-roadmap.md`, this manifest — consumed, not re-authored. A session updates
  only its own phase's checkbox in the roadmap's §6 status list.
- Any file another live initiative currently owns per its own manifest (e.g. `src/App.jsx`'s route
  tree beyond Phase A's single guarded `markBundleReady()` line, `src/components/CrmLayout.jsx`,
  `src/pages/tech/v2/**`) — out of scope for this initiative entirely.

## 2. Ownership matrix

| Session | Phase | Owns exclusively (edit only these) | Schema/RPC |
|---|---|---|---|
| F1 | Signing & Push Foundation | `ios/App/App.entitlements` (new); `ios/App/App/AppDelegate.swift`; `ios/App/App/Info.plist`; `ios/App/App/PrivacyInfo.xcprivacy` (new); `ios/App/App.xcodeproj/project.pbxproj` | none |
| A | Backend hardening | one migration (`device_tokens` policy fix); `functions/api/send-push.js`; one guarded line in `src/App.jsx` | `device_tokens` policy replace |
| B | Account deletion | one migration (new RPC); `src/pages/settings/MyAccount.jsx` | `request_account_deletion` (new) |
| D | CI/fastlane scaffold | `ios/fastlane/{Fastfile,Appfile}` (new); `.github/workflows/ios-release.yml` (new) | none |

`project.pbxproj` is machine-generated/serial and prone to merge conflicts — **F1 is its sole owner**
in this initiative; any future phase needing an Xcode capability/file registration routes through F1
or is sequenced strictly after it, never parallel.

## 3. Migration rule

Two additive migrations total, one per owning phase (A's policy replace, B's new RPC) — each
RLS-safe, least-privilege (`authenticated, service_role`, never `anon`), with a stated rollback per
`database-standard.md` §6. No `ALTER`/`DROP`/rename of a live table. `migration-safety-checker` +
`anon-grant-auditor` audit both.

## 4. Close-out (every phase)

Per `.claude/rules/close-out-standard.md`, scoped to what each phase actually touches (F1/D have no
JS to test — say so explicitly rather than fake a green run). Every phase: commit → its own
close-out checks (roadmap §2 per-phase blocks) → push `-u` → **open a PR into `dev` as a handoff and
stop** — nobody in this initiative merges, subscribes to, or babysits their own PR. F1's PR carries
the explicit "cannot be compile-verified here, needs a real Xcode build-check" caveat.
