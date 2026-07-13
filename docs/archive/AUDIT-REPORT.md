# UPR Platform — Audit Report (Re-run)
**Date:** 2026-06-24
**Auditor:** Claude Code (automated re-audit)
**Branch:** claude/app-commercialization-viability-r2gg7d
**Scope:** Full platform — 32 pages, 54 components, 33 workers, 67 tables, 100+ RPCs (~60k LOC)
**Supersedes:** the 2026-04-09 audit (kept in git history). This run verifies which prior
findings were fixed, pulls **live** Supabase security/performance advisories, runs lint + tests,
and audits the subsystems that did not exist in April (QBO billing, Scope/Demo Sheet, water-loss
report, invoicing/collections).

---

## EXECUTIVE SUMMARY

**The platform is materially healthier than it was in April.** Of the 18 BUGs and 37 WARNINGs in
the prior audit, **every "Critical Blocker" is fixed** and almost the entire "Security hardening"
batch is done. The codebase has since added a full QuickBooks Online billing integration, a
versioned Scope/Demo Sheet builder, a water-loss PDF report generator, and a payments/collections
module — and the audit of those **new** subsystems found them to be defensively coded (auth,
webhook signature verification, HTML escaping, and PDF encoding-safety are handled deliberately).

**Health at a glance:**

| Signal | Result |
|---|---|
| Prior "Critical Blockers" (8) | **8/8 fixed** ✅ |
| Prior "Security hardening" batch (5) | **4.5/5 fixed** (one partial) ✅ |
| Unit tests | **27 pass / 27** (but only **1 test file** — coverage is near-zero) ⚠️ |
| ESLint | **179 errors, 26 warnings** across 67 files (mostly cosmetic; 2 are real crashes) ⚠️ |
| Supabase security advisors | **574** (5 ERROR, 563 WARN, 6 INFO) — dominated by the by-design single-tenant RLS pattern 🔶 |
| Supabase performance advisors | **136** (72 unindexed FKs, 53 unused indexes) 🔶 |
| New crash bugs found this run | **2** (false-error on supplements; duplicate-phone recovery crash) 🐛 |

**Bottom line for commercialization:** as an **internal tool for one company**, this is in good
shape — the remaining items are a short, well-scoped list (below). As a **multi-tenant SaaS sold to
other companies**, the blocker is unchanged and architectural: **133 tables use `USING (true)` RLS
policies** and the anon key ships in the client bundle, so the database is single-tenant by design.
That is correct for internal use and disqualifying for multi-customer use — see §4.

---

## 1. STATUS OF PRIOR (APRIL) FINDINGS

### Critical Blockers — 8/8 FIXED ✅
| Prior # | Finding | Status | Evidence |
|---|---|---|---|
| 4.1 | `DIVISION_COLORS` undefined crash | **FIXED** | `TimeTracking.jsx:53` now defines it; `:425` guards with `|| '#6b7280'` |
| 4.2 | Time-entry delete no confirm | **FIXED** | two-click confirm pattern present |
| 4.3–4.4 | Swipe-to-complete threshold/double-toggle | **FIXED** | TechTasks reworked |
| 6.1–6.2 | Tracking pixel hardcoded to dev domain | **FIXED** | `send-esign.js:11` / `resend-esign.js:11` use `getAppUrl(env)` → `APP_URL` env var |
| 6.3 | `WorkAuthSigning.jsx` dead prototype on live route | **FIXED** | file deleted; no route in `App.jsx` |
| 9.1 | `normalizePhone` returns invalid E.164 | **FIXED** | `phone.js:8` now `return null` for <10 digits |
| 5.7 | Group SMS comma-joined `To` | **FIXED** | no `join(',')` remains in `send-message.js` |
| 8.1 | Admin.jsx stale `db` closure | **FIXED** | (verified via section review) |

### Security Hardening — 4.5/5 FIXED ✅
| Prior # | Finding | Status | Evidence |
|---|---|---|---|
| 6.7 | No auth on send-esign/resend-esign | **FIXED** | both have `requireAuth()` (Bearer verified against `/auth/v1/user`) |
| 8.2 | No auth on Encircle import/search | **FIXED** | `encircle-import.js:8` `requireAuth()` |
| 8.3 | sync-encircle publicly triggerable | **PARTIAL** | GET now runs `requireAuth`; **POST is still intentionally unauthenticated** (documented as cron). Anyone who knows the URL can trigger a bulk import. |
| 6.4 | HTML injection in email templates | **FIXED** | `escHtml()` in send-esign/resend-esign/submit-esign; water-loss report escapes too |
| 5.8 | Twilio signature fail-open | **FIXED** | `twilio-webhook.js:49` now **fails closed** when token missing |

### Other notable prior items
- **10.3 orphan files (5):** **all deleted** ✅
- **2.1 Production `changed_by`:** **FIXED** (`Production.jsx:182`) ✅
- **4.5–4.8 touch targets <48px:** **largely FIXED** — `minWidth/minHeight:48` now present across TechAppointment/TechDash/TechTasks ✅
- **9.2 iOS auto-zoom (`--tech-text-body: 15px`):** **CSS var still 15px** (`index.css:4183`), but the new tech sheets set inline `fontSize:16` on inputs. Legacy tech inputs that rely on the var alone can still trigger zoom. **PARTIAL.**
- **Payment webhooks (new):** QBO (`qbo-webhook.js:53`) and Stripe (`stripe-webhook.js:50`) both **verify signatures correctly** ✅

---

## 2. NEW FINDINGS THIS RUN

### 🐛 Real runtime bugs (found via lint cross-check)
- **[N1] HIGH — `JobPage.jsx:518,522`: `toast` is not defined.** The supplement add/delete success
  path calls `toast('Supplement added')`, but only `errToast` is in scope. The DB write succeeds,
  then the `ReferenceError` is caught by the surrounding `catch`, so the user sees a **false
  "Failed to add supplement" error** on an operation that actually worked. Fix: use the
  `upr:toast` CustomEvent (or import the correct helper).
- **[N2] HIGH — `TechNewCustomer.jsx:125`: `data` is not defined.** In the duplicate-phone
  recovery branch, `data.phone` references a non-existent variable, so the "navigate to the
  existing customer" fallback **throws** exactly when a tech re-enters a known phone — the one
  moment it's supposed to recover gracefully. Fix: reference the actual form/payload variable.

### QBO Billing subsystem (new since April)
- **[N3] HIGH — `qbo-payments-sync.js:77-82`: no auth.** `onRequestGet/Post` call `reconcile(env)`
  with no Bearer/secret gate (unlike sibling QBO workers). Anyone hitting the URL can drive QBO API
  calls and payment inserts. Fix: add the `isAuthorized()` gate used by `qbo-invoice.js`.
- **[N4] HIGH — floating-point money to QBO (`qbo-invoice.js:151`, `quickbooks.js:336`).** Line
  amounts / payment `TotalAmt` are sent as raw floats with no cent-rounding, so totals can drift
  from QBO. Fix: `round2()` before building the payload (frontend already rounds).
- **[N5] MEDIUM — token-refresh race (`quickbooks.js:106-112`).** Read-modify-upsert with no lock;
  two concurrent workers can both refresh, and since Intuit rotates the refresh token, the loser
  persists a stale token and breaks the connection. Fix: single-flight the refresh.
- **[N6] MEDIUM — non-atomic invoice delete (`InvoiceEditor.jsx:178-187`)** and **no synchronous
  double-submit guard / payment idempotency (`ClaimBilling.jsx:98-119`).** A fast double-tap can
  create two UPR payment rows (QBO side is protected by the `qbo_payment_id` short-circuit). Fix:
  single RPC for delete; disable button synchronously or add a dedup key on payment insert.
- **[N7] MEDIUM — no retry/backoff on QBO calls.** Transient 5xx/429 just fails (payment sync is
  saved by the hourly cron; invoice push is manual-retry only).
- *Positive:* auth, webhook signature verification, idempotent payment sync, SELECT-only query
  passthrough, and consistent error-to-toast surfacing are all done right.

### Scope/Demo Sheet + Report/Email workers (new since April)
- **[N8] MEDIUM — `send-demo-sheet.js`: no auth on `onRequestPost`.** Any unauthenticated caller
  can send a Utah-Pros-branded email (arbitrary subject/body) to the fixed office recipients —
  spam-to-office. Fix: require a Bearer token like its siblings.
- **[N9] LOW — `track-open.js`: unauthenticated counter bump** (acceptable; token is opaque/random).
- **[N10] LOW — `DemoSheetRenderer.jsx:37`** uses `Date.now()+Math.random()` as a React key (rare
  collision risk); prefer `crypto.randomUUID()`.
- *Positive:* `escHtml` applied to every interpolated value; PDF generation sanitizes for WinAnsi
  (no emoji crash); schema versioning snapshots `schema_id` and re-renders drafts under their
  original schema; autosave has a create-in-flight guard preventing duplicate drafts; tech inputs
  use inline `fontSize:16` and `minHeight:48`.

### Unauthenticated SMS sender (pre-existing, not previously flagged)
- **[N11] MEDIUM — `send-message.js`: no auth gate.** The outbound-SMS worker doesn't verify a
  Bearer token, so a third party who learns the URL could send SMS on the company's Twilio account
  (cost + reputation/spam risk). Compliance (DND/opt-in) is still enforced, but the endpoint itself
  is open. Fix: verify the caller's Supabase token before sending.

---

## 3. BUILD / TEST / LINT HEALTH

- **Tests:** `vitest` → **27 pass**, but **only one test file exists**. For a ~60k-LOC platform
  handling money and SMS compliance, this is effectively no safety net. Highest-value additions:
  the money math (`round2`, AR reductions), `normalizePhone`, and TCPA keyword handling.
- **ESLint:** **179 errors / 26 warnings** across 67 files. Breakdown:
  - `105 no-unused-vars`, `33 react-refresh/only-export-components`, `13 no-empty`,
    `12 react-hooks/set-state-in-effect` — **mostly cosmetic / the project's own documented
    `useEffect(()=>{load()},[load])` pattern.**
  - `26 react-hooks/exhaustive-deps` — **the real signal**: this is the stale-closure class the
    April audit kept flagging. Worth a pass.
  - `7 no-undef` — includes the **2 real crashes above** (N1, N2); the rest are Node globals in
    `vite.config.js` / `patch_*.js` scripts (harmless, just need eslint env config).
  - `3 no-prototype-builtins`, `3 no-misleading-character-class` — low risk.
  - **Lint itself is currently broken from a clean clone** until `npm install` runs (config imports
    `@eslint/js`). CI should `npm ci` before linting.

---

## 4. LIVE SUPABASE ADVISORS (pulled this run)

### Security — 574 advisories (5 ERROR, 563 WARN, 6 INFO)
| Rule | Count | Interpretation |
|---|---|---|
| `rls_policy_always_true` | **133** | RLS policies are `USING (true)` → **single-tenant by design.** Correct for internal use; **the blocker for multi-tenant SaaS.** |
| `anon_security_definer_function_executable` | 150 | The project's RPC pattern (SECURITY DEFINER + GRANT to anon). By design, but every such function is effectively callable by anyone with the anon key. |
| `authenticated_security_definer_function_executable` | 150 | Same, for the authenticated role. |
| `function_search_path_mutable` | 126 | **Worth fixing:** SECURITY DEFINER functions without `SET search_path` are a known privilege-escalation vector. One-line `ALTER FUNCTION ... SET search_path = public` each (scriptable). |
| `security_definer_view` | **5 (ERROR)** | Views like `billing_overview` run as creator and bypass the querying user's RLS. Review each. |
| `rls_enabled_no_policy` | 6 | e.g. `billing_2fa_codes` — RLS on, no policy = **deny-all to PostgREST.** Confirmed not selected directly from the frontend, so this is intentional (RPC-only). Fine. |
| `public_bucket_allows_listing` | **2** | The `job-files` bucket is public with broad SELECT policies, so clients can **list/enumerate** stored job files (customer photos/docs). Review whether listing should be allowed. |
| `extension_in_public` (pg_net) | 1 | Minor — move out of `public`. |
| `auth_leaked_password_protection` | 1 | **Easy win:** enable HaveIBeenPwned check in Supabase Auth settings. |

### Performance — 136 advisories (11 WARN, 125 INFO)
- **72 unindexed foreign keys** — add covering indexes on hot FKs (appointments, job-related joins) as the data grows.
- **53 unused indexes** — candidates to drop (low data volume today may explain "unused").
- **10 multiple permissive policies** — two SELECT policies on the same table/role are both evaluated (overhead + the duplication smells like drift). Consolidate.
- **1 duplicate index** — `job_notes` has identical `{idx_job_notes_job_id, job_notes_job_idx}`; drop one.

---

## 5. UPDATED REMEDIATION PLAN

**Batch A — Real bugs (minutes each):**
1. N1 — fix `toast` ReferenceError in `JobPage.jsx` (false-error on supplements).
2. N2 — fix `data` ReferenceError in `TechNewCustomer.jsx` (duplicate-phone recovery crash).

**Batch B — Security hardening (1–2 hrs):**
3. N3 — add auth to `qbo-payments-sync.js`.
4. N8 — add auth to `send-demo-sheet.js`.
5. N11 — add auth to `send-message.js` (SMS spend protection).
6. sync-encircle POST (prior 8.3) — gate or restrict to cron secret.
7. Enable leaked-password protection; review the 2 public-bucket listing policies + 5 SECURITY DEFINER views.

**Batch C — Money correctness (1 hr):**
8. N4 — round to cents before sending amounts to QBO.
9. N6 — synchronous double-submit guard + payment idempotency key.

**Batch D — Hardening / polish (2–3 hrs):**
10. N5 — single-flight QBO token refresh; N7 — bounded retry on 429/5xx.
11. Pass over the 26 `react-hooks/exhaustive-deps` warnings (stale closures).
12. Add `SET search_path` to SECURITY DEFINER functions (scriptable across all 126).
13. Finish iOS-zoom fix: bump `--tech-text-body` to 16px (or audit legacy tech inputs).

**Batch E — Resilience / scale (ongoing):**
14. Add a real test suite (money math, phone, TCPA keywords first).
15. Add covering indexes on hot FKs; drop the duplicate/unused indexes.
16. Fix the clean-clone lint config so CI can lint.

**Multi-tenant SaaS track (separate, architectural — only if selling to other companies):**
- Replace the 133 `USING (true)` policies with tenant-scoped RLS (`tenant_id = auth.jwt()->>...`).
- Add a tenant column + isolation to every table, RPC, and view.
- Stop relying on the public anon key for data access; move to per-user authorization.
- This is a project, not a cleanup pass — estimate it before committing.

---

## 6. VERDICT

The "thousands of dollars to reach commercialization" fear is **not supported** for internal use:
the prior critical/security work is essentially done, and the new subsystems were built carefully.
What remains for a solid internal product is the short Batch A–C list above (well under a day of
focused work). The genuine cost center is the **multi-tenant re-architecture** — and that's a
business decision (do other companies want to buy this?), not a code-quality verdict.
