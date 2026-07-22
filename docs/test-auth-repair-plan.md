# Test-Suite Auth Repair — Plan of Record

**Status:** planned, not started · **Authored:** 2026-07-22 · **Owner-approved:** yes (2026-07-22)
**Target:** next available session (deferred for account-usage budget)
**Read scope for the executing session:** `CLAUDE.md` + this file + `.claude/rules/database-standard.md`.

---

## 1. The problem in one paragraph

UPR's integration test suite — **65 files in `supabase/tests/`, ~800 database calls** — connects to
Supabase with the **anon (public) key**. On 2026-07-08 the DB-Foundation P3 phase correctly revoked
`anon` across the schema. Today **360 of 366 functions are `authenticated`-only** and **107 of 127
tables have no anon policy**. The suite therefore cannot reach the database at all. It does not
report this: every file self-skips when credentials are absent (which is always, in CI), so
`npm test` prints a green **"1285 passed"** that contains **zero** verified database behavior. The
guard is locked out of the building and still signing the visitor log.

## 2. Evidence (measured 2026-07-22, not assumed)

| Fact | Value | How verified |
|---|---|---|
| Integration test files | 65 (all in `supabase/tests/`) | file scan |
| Files with a `skipIf(!hasCreds)` self-skip | 64 of 65 | grep |
| DB calls across the suite | ~800 `db.rpc/select/insert/update/delete` | grep count |
| Anon-callable functions in `public` | **6** | live `pg_proc` ACL query |
| `authenticated`-only functions | **360** | same |
| Tables with an anon policy | 20 | live `pg_policies` |
| Tables `authenticated`-only | **107** | same |
| CI passes DB credentials to `npm test` | **No** (`.github/workflows/ci.yml:56-57` runs bare `npm test`) | file read |
| `vite.config.js` has a vitest `test:` block | **No** — no `setupFiles`/`globalSetup` exists yet | file read |
| Tests outside `supabase/tests/` that hit the network | **None** — all `src/**/*.test.js` are pure unit tests | grep |

**Already in place (the enablers — do not rebuild these):**
- `src/lib/supabase.js:56` exports **`createSupabaseClient(token)`** — the same factory `AuthContext`
  uses; passing an access token yields a fully authenticated REST client.
- A dedicated **`[Local Dev Test Account]`** employee exists (`dev-local-test@utah-pros.com`,
  `role: admin`, `is_external: true`, its own Supabase Auth user — verified live). It is not a real
  employee's credentials.
- The sign-in call is `realtimeClient.auth.signInWithPassword({ email, password })`
  (`AuthContext.jsx:258`) returning a session with `access_token`.
- `.env.local` exists at the repo root and already backs the Login screen's "Dev Mode: Real Data"
  button (`Login.jsx:89-91`, reading `VITE_DEV_TEST_EMAIL` / `VITE_DEV_TEST_PASSWORD`).

## 3. The two failure modes — the second one is why this is urgent

1. **Loud:** an RPC call under anon throws `42501 permission denied for function ...`. A test that
   does this fails visibly. Fine.
2. **Silent (dangerous):** a `db.select`/`db.insert` blocked by RLS returns an **empty array with no
   error** — confirmed live this session (an insert into `jobs` and `contacts` returned `[]`, no
   throw). Most suites here assert on **before/after deltas**. `0 === 0` passes. So even if the
   credentials were restored tomorrow, a subset of these tests would go on passing **vacuously**
   without ever touching a row.

**Therefore the fix is not just "log in."** It must include a positive proof-of-life assertion, or we
re-create the same illusion with better paperwork.

## 4. Design

### 4.1 One shared authenticated client (`supabase/tests/_testDb.js`, new)

```js
// getTestDb() — memoized module-level promise: signs in ONCE per vitest process,
// returns createSupabaseClient(session.access_token).
// Throws (never returns an anon client) if credentials are missing or sign-in fails.
export async function getTestDb() { … }
export const hasTestAuth = !!(VITE_SUPABASE_URL && VITE_SUPABASE_ANON_KEY
                              && VITE_DEV_TEST_EMAIL && VITE_DEV_TEST_PASSWORD);
```

Rules: never fall back to the anon singleton (a silent downgrade is exactly today's bug); one
sign-in per process, not per file.

### 4.2 Proof-of-life canary (`vite.config.js` → `test: { globalSetup }`, new)

Before any suite runs, when `hasTestAuth` is true:
1. Sign in; assert a session and an `access_token` came back.
2. Call a known **`authenticated`-only** RPC (e.g. `get_crm_build_progress`) — must succeed.
3. **Write-path proof:** insert one row into a TEST-org table and read it back — must return the row,
   not `[]`. This is what closes the silent-RLS hole. Delete it.
4. Any failure → **throw**, aborting the whole run with a clear message. Never degrade to skipping.

### 4.3 Test-org safety rail (shared helper)

Every integration suite writes to the **one shared production Supabase**. The helper must expose
`getTestOrgId()` which resolves `crm_orgs.is_test = true` and **throws if it resolves the real org**.
Suites use it instead of resolving the org themselves. (This risk exists today — the fix is the
moment to fence it.)

### 4.4 Migration of the 65 files (mechanical)

Replace `import { db } from '../../src/lib/supabase.js'` +
`describe.skipIf(!hasCreds)` with the helper's `getTestDb()` + `hasTestAuth`. The `db.*` call sites
themselves **do not change** — same method names, same signatures — so this is a per-file header edit,
not a rewrite of ~800 calls.

### 4.5 CI (deliberately NOT "run everything on every PR")

These tests **write to production**. Running them on every push means production writes on every push.
Recommended split:
- **PR CI (unchanged, fast):** unit tests only — as today.
- **Nightly scheduled workflow** with `VITE_*` repository secrets: full integration run against the
  TEST org. Failures surface within a day, no PR-time production writes, no PR slowdown.
- **Visibility:** print the skipped-suite count in the PR job summary, so "62 skipped" can never
  again read as "all good."

## 5. Phases

| Phase | Work | Est. |
|---|---|---|
| **P0** | `_testDb.js` helper + globalSetup canary + test-org rail. Convert **2** pilot files and prove they genuinely hit the DB (and that the canary fails loudly when credentials are wrong). | ~1h |
| **P1** | Convert the remaining 63 files. **Expect real failures** — some of these have been unverified for weeks. Triage each: a genuine product bug gets a disclosed fix or a flagged issue; a test asserting anon-era behavior gets corrected. | ~3h |
| **P2** | Nightly CI workflow + skip-count visibility + `.env.example` documentation of the two var names. | ~1h |
| **P3** *(optional, flag-and-defer)* | A second **non-admin** test account so role-gating bugs are catchable — the current account is `admin`, so it cannot detect a missing permission check. | ~1h |

**Total: ~half a day**, P3 excluded. P1's estimate is the soft one; the triage is the unknown.

## 6. Human-only prerequisites (a session cannot do these)

1. Add `VITE_DEV_TEST_EMAIL` / `VITE_DEV_TEST_PASSWORD` to the root **`.env.local`**.
   `.claude/hooks/block-secrets.sh` blocks any agent write to `.env*` — **by design**. The session
   hands over the two lines; a human pastes them.
2. Add the same, plus `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`, as **GitHub repository
   secrets** for the nightly workflow.

## 7. Acceptance criteria

- [ ] With credentials present, **zero** integration suites skip; the run is visibly slower (real
      network calls) and the canary's write-path proof passed.
- [ ] With credentials **absent**, the run skips loudly and prints the skipped count.
- [ ] With **deliberately wrong** credentials, the run **fails** — it does not skip. (Test this
      explicitly; it is the whole point.)
- [ ] Every converted suite still cleans up its fixtures (no TEST rows left — verify by row count
      before/after a full run).
- [ ] No suite can resolve the real org; the rail throws.
- [ ] Every failure found during P1 is either fixed or written up — **none silenced by deleting or
      skipping the test.**
- [ ] `UPR-Web-Context.md` + `docs/crm-lead-lifecycle.md` updated; this file marked done.

## 8. Explicitly NOT in scope

- Re-granting `anon` to make the old tests work. That would undo the P3 security closure to serve a
  test harness — backwards.
- Rewriting test assertions. The migration is an auth change; assertion changes happen only where P1
  proves an assertion was wrong.
- A separate test database. Correct long-term, far larger than this job, and unnecessary while the
  TEST-org rail holds.

## 9. Why this matters (for whoever picks it up cold)

Every correctness fix from 2026-07-22 — the canonical `is_real_job` sale rule, Denver-day bucketing,
the four-tier repeat-caller merge, the real-job audit trail — ships with a test written to protect it.
Those tests currently protect nothing. The 2026-07-22 work was verified by hand against the live
database instead, which does not scale and does not survive the session. The next person to touch the
merge rules will be told "all tests pass," and that sentence is currently false.
