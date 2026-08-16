# Next step — refuse a native bundle that carries a loopback URL

**Written:** 2026-08-16 · **Branch:** `dev` (clean, pushed) · **Status:** authorized by the owner,
not started.

## The incident this exists to prevent (it already happened, 2026-08-15)

The owner installed a TestFlight build and got **"load failed"** at sign-in on a real iPhone.

Cause: `.env.local` held `VITE_SUPABASE_URL=http://127.0.0.1:54321`, pointing at the tier-1 local
stack. **Vite bakes `VITE_*` into the bundle at build time**, so the compiled app asked
`127.0.0.1:54321` for its session. On the phone, `127.0.0.1` *is the phone* — nothing is listening,
so every auth call failed with no usable error.

**Why nothing caught it:**

- The **simulator passed**. It runs on the Mac, where loopback reaches the Mac's own local stack.
  The one device class that could not reproduce the bug is the one used to verify it.
- `assert-native-dist.mjs` checked *which build target* produced `dist/`, and it was correct —
  a genuine native build, with the wrong URL compiled inside it.
- Build green, tests green, boundary guard silent.

This is the repository's recurring pattern, recorded four times in `initiative-status.md` (native
page with no route; worker whose success path lacked CORS; `Package.swift` no build step
exercised): **a check was green because of what it did not execute.**

## The fix

Extend `scripts/assert-native-dist.mjs` — it is already wired into `npm run sync:ios`, so it covers
`build:ios`, `build:ios:dev` and `build:ios:dev:capgo`, and CI is unaffected (both iOS workflows run
`build-native.mjs` then `cap sync ios` directly).

Add a second assertion beside `assertNativeDist()`: scan the built assets in `dist/` and **throw if
a loopback host is compiled into a native bundle**. Keep the existing file's shape — exported
function plus the direct-run gate at the bottom — and its **build-time-only posture** (its NOTES
block explains why: a runtime refusal could brick a shipped app; this mistake happens on a developer
machine, so it should fail there).

Hosts to refuse: `127.0.0.1`, `localhost`, `0.0.0.0`, `::1`, and the Supabase local port `54321`.

## Do this before writing the matcher — do not skip it

**Measure what a clean native bundle actually contains.** Build one and grep it for each candidate
string. A naive `localhost` match may already appear in legitimate compiled code (a dev-only
branch, a library default, a comment surviving minification), and a guard that cries wolf on a
correct build gets disabled within a week — which is worse than no guard.

Let the measurement pick the rule: if bare `localhost` is noisy, match the URL shape
(`http://127.0.0.1`, `://localhost:`) rather than the bare token. Record in the file header what was
measured and why the final pattern is what it is.

## Pin it

Add a test in the **qa lane** so it runs on every push. Precedent and shape:
`tests/qa/unit/native-spm-paths-portable.test.js` — that one deliberately carries two complementary
kinds of assertion (shape checks that fail everywhere, plus an on-disk check that only fails on CI),
and the split was **measured by replaying the real broken file**. Do the same here: replay a bundle
containing `127.0.0.1` and prove the guard rejects it, rather than asserting the guard exists.

## Verify

`npm run build:ios` on a clean tree must still pass. Then re-point `.env.local` at the local stack,
rebuild, and confirm the guard **refuses** — the failing case is the whole point, and it is the case
a green run cannot demonstrate.

## Related, still open

- **Baseline refresh** (`npm run db:baseline:refresh`) — blocked on re-deriving three qualification
  proofs. A refresh changes `db/baseline/schema.sql`, whose SHA-256 is bound into commit-bound
  receipts; the last attempt failed CI on PR #672 with
  `qualification SHA-256 differs from reviewed source` and was reverted.
- **CallRail / Encircle guards + response fixtures** — registered in
  `docs/wip/feat-local-first-dev-environment.md`.
- Two PRs idle 7d, both deliberate rather than neglected: **#622** (job-files privacy phase 1) and
  **#582** (notification producer crew phase A, 23 commits). Neither is this session's to merge —
  see `close-out-standard.md` step 11a, which bounds self-merge to the session's own PR.
