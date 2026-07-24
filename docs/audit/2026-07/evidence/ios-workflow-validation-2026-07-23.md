<!--
FILE: docs/audit/2026-07/evidence/ios-workflow-validation-2026-07-23.md

WHAT THIS DOES (plain language):
  Records why GitHub showed an immediate iOS workflow failure on every dev push and how the
  repository-only repair keeps the paused workflow valid without starting an Apple release.

DEPENDS ON:
  Internal: .github/workflows/ios-release.yml, scripts/ios-release-workflow.test.js,
            docs/app-store-readiness-roadmap.md
  Data:     reads → GitHub Actions run metadata and repository workflow source
            writes → documentation only

NOTES / GOTCHAS:
  - No workflow dispatch, macOS runner, signing operation, Apple request or TestFlight upload ran.
  - Apple enrollment, credentials, Xcode archive/device proof and release remain owner gates.
-->

# iOS workflow validation evidence — 2026-07-23

## Finding

GitHub Actions run `30057157089` for dev commit `1900a78` failed immediately with zero jobs and no
logs even though `.github/workflows/ios-release.yml` declared only `workflow_dispatch`. The same
no-job failure recurred on preceding pushes.

The source used `secrets.APPLE_TEAM_ID` directly in two step `if` expressions. GitHub's current
workflow contract does not permit the `secrets` context in step conditions. Invalid workflow source
is parsed on a push and produces the misleading failed run before trigger filtering can create a
job.

## Repository repair

- map `APPLE_TEAM_ID` from the secret into job-level `env`;
- evaluate the two mutually exclusive steps through `env.APPLE_TEAM_ID`;
- keep `workflow_dispatch` as the only trigger;
- add `scripts/ios-release-workflow.test.js` to prevent push/schedule triggers or direct
  `secrets.*` step conditions from returning.

This is a validity/quiet-CI repair only. The no-secret manual branch still exits nonzero if an owner
explicitly dispatches the workflow before signing is configured, so a manual attempt cannot be
mistaken for release readiness.

## Verification

- focused workflow contract: one file, three tests passed;
- safe repository unit/Worker lane (excluding mutation-capable Supabase suites and stale hidden
  worktrees): 129 files, 1,589 tests passed;
- production web build: passed;
- changed-file ESLint and `git diff --check`: passed;
- post-push GitHub acceptance: pending.

## Remaining owner/external gates

1. Complete Apple Developer enrollment and choose the managed signing/key strategy.
2. Add the exact GitHub signing secrets without exposing their values.
3. Validate archive/sign in Xcode on macOS and on a real device.
4. Explicitly dispatch a controlled TestFlight candidate and retain its run/archive evidence.
5. Complete screenshots, reviewer credentials and App Store Connect entry.

No Apple/provider activation, secret creation, paid-seat purchase, device action or release occurred
in this phase.
