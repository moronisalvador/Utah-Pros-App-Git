# Native loopback-URL guard — DONE 2026-08-16

**Status:** built, measured, tested, verified both directions. Branch `dev`.
Guard: `scripts/assert-native-dist.mjs` → `assertNoLoopbackHost()`.
Proof: `tests/qa/unit/native-build-target-guard.test.js` → "native loopback-host guard".

## The incident this prevents (it already happened, 2026-08-15)

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

This is the repository's recurring pattern, recorded four times in `initiative-status.md`:
**a check was green because of what it did not execute.**

## What was built

`assertNoLoopbackHost(root)` in `scripts/assert-native-dist.mjs`, called by the direct-run gate
immediately after `assertNativeDist()`. It walks `dist/`, skips binary extensions, and throws
listing **every** offending file. Build-time only, matching the file's existing posture: a runtime
refusal could brick a shipped app, and this mistake happens on a developer machine.

Wired through `npm run sync:ios`, so it covers `build:ios`, `build:ios:dev` and
`build:ios:dev:capgo`. CI is unaffected — both iOS workflows call `build-native.mjs` then
`cap sync ios` directly.

## The measurement, and why the patterns are what they are

**Measured, not guessed.** The same commit was built twice — once with `.env.local` on the local
stack, once with `VITE_SUPABASE_URL` pointed at production — and both bundles grepped for every
candidate pattern. Counts over 138 text files:

| pattern | clean bundle | broken bundle |
|---|---|---|
| `127.0.0.0/8` | **0** | 13 hits / 6 files |
| `0.0.0.0` | 0 | 0 |
| `[::1]` | 0 | 0 |
| `://localhost:<dev port>` | **0** | 0 |
| bare `localhost` | **3 hits / 2 files** | 3 |
| `://localhost` | **2** | 2 |

**A correct native bundle contains `localhost` three times**, all vendored: gotrue-js's
`http://localhost:9999` default, react-router's `http://localhost` base fallback, and a WebAuthn
`=== 'localhost'` hostname check. So bare `localhost` — and `://localhost` — **fail a good build**.
That is why the localhost rule requires a known local dev port (`5432[1-4]`, `5173`, `8787`,
`8788`, `3000`) and why gotrue's `:9999` passes.

**Do not widen these without re-measuring.** A guard that fails correct builds gets switched off
within a week, which is worse than no guard.

**Why a dist scan and not the build marker:** `build-native.mjs` keeps `upr-native-build.json`
byte-reproducible on purpose — the release workflow rejects Capacitor project drift, and a test
pins that it carries no timestamp. Recording the resolved URL there would make it
environment-dependent. Scanning emitted assets is also the stronger check: it sees a loopback
address baked in from *any* source, not only `VITE_SUPABASE_URL`.

## Verified

- **Refuses the real failure:** `npm run build:ios` with `.env.local` on the local stack stops at
  the gate, before `cap sync ios`, naming all 6 chunks.
- **Passes the real success:** `VITE_SUPABASE_URL=https://…supabase.co npm run build:ios` → exit 0,
  through `cap sync ios`.
- Guard run directly against both preserved bundles: clean PASSED, broken REFUSED.
- `npm run build` clean · `npm test` **6,422 passed** (unit 1,897 · worker 2,457 · qa 2,068) ·
  eslint 0 findings on both changed files.

The test fixtures are **verbatim excerpts** from those two bundles, not paraphrases — the guard's
whole job is telling those exact bytes apart, so an approximated fixture would prove nothing.

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
- **A LAN IP is not covered, deliberately.** `http://192.168.1.50:54321` baked into a TestFlight
  build is also wrong, but it *works* on the same wifi and is a legitimate device-testing setup.
  Refusing it would be the false-positive class this guard is measured to avoid.
