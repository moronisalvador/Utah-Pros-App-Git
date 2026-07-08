# DB Foundation — File & RPC Ownership Manifest

**Committed with the plan of record. Binding for every DB Foundation phase session.**
Linked from `docs/db-foundation-roadmap.md` and `docs/db-foundation-dispatch.md`. Each phase session's
read scope = `CLAUDE.md` + its phase block in the roadmap + `.claude/rules/database-standard.md` +
**this file**. Where the roadmap prose and this manifest disagree on a name or path, **this manifest is
authoritative** (it reflects what Foundation actually shipped).

Isolation in this initiative is **not** the branch — it is (a) this ownership split and (b) the
apply-window discipline of `database-standard.md` §5 on the one shared Supabase. There is **no feature
flag** (this is backend hardening, not a user surface); the insurance is additive-only migrations +
rollback scripts + git-revert.

---

## 1. Frozen in-wave — NOBODY in this initiative edits these

**In-flight from OTHER initiatives (do not touch until they merge — see §8 deferred-hardening):**
- Job Hub v2 (H2 open PR #322, H3 pending): `src/pages/tech/v2/TechJobHub.jsx`,
  `src/pages/tech/v2/hub/**`, `src/App.jsx` tech routes, `src/pages/tech/TechAppointment.jsx`,
  `src/pages/tech/TechJobDetail.jsx`, `src/components/tech/TimeTracker.jsx`. **P8 (signed URLs) is hard-gated on H3.**
- Omni-inbox (I/O/U unbuilt): `functions/api/send-message.js`, `src/pages/Conversations.jsx`,
  `email-worker/**`, `functions/lib/email*.js`, `functions/lib/conversation-email.js`.
- Schedule Desktop (A/B/C unstarted): `src/pages/Schedule.jsx`, `src/pages/JobPage.jsx`,
  `src/pages/ScheduleTemplates.jsx`.
- CRM 4b / 5-Ops: `src/pages/Marketing.jsx`, `functions/api/process-crm-automations.js`,
  `src/pages/crm/CrmAutomations.jsx`.

**Shared surface (consumed, never edited in-wave):** `functions/lib/*` (service-role client, consent
gate, email, twilio, supabase, cors, date-mt, phone), `src/lib/supabase.js`, `src/lib/realtime.js`,
`src/contexts/AuthContext.jsx`, `package.json` + lockfile.

**Cross-phase frozen:** Foundation's baseline-snapshot dir + drift-check script + `mt_*` helpers +
history tables + the `ALTER DEFAULT PRIVILEGES` migration + the secret-exposure gate script are
consumed by later phases, never re-defined.

---

## 2. Ownership matrix

| Session | Phase | Owns exclusively (edit only these) | Schema / RPC |
|---|---|---|---|
| F | Foundation | baseline-snapshot dir + `scripts/db-drift-check*`; drift-capture migrations (re-derived live); `mt_today()`/`mt_date()` migration; `ALTER DEFAULT PRIVILEGES` revoke-anon migration; claims/invoices history tables + guarded triggers migration; `set_billing_setting` admin-gate replace; `supabase/tests/` secret-exposure SQL gate + deny-all + billing-gate tests; `UPR-Web-Context.md` (helpers/history/event-registry sections) | **ALL shared schema + both live-RPC touches** |
| P1 | Quick wins | one advisor-fix migration (`search_path` pins, drop dup `job_notes` index, `pg_net` out of public); `functions/api/sync-encircle.js` (POST auth gate only) | attribute/index-only + 1 worker |
| P2 | Storage stage 1 | one storage.objects policy migration (`schemaname='public'` hard-excluded); its test | storage policies only |
| P3 | Anon closure | public-schema policy-recreate + RPC grant-revoke migrations (catalog-generated, allowlist-minus); `src/pages/SignPage.jsx` + the SignPage-template RPC | policies + grants + 1 RPC |
| P4 | Data integrity | constraint + repair migrations (external-ID UNIQUE incl. partial-unique-index form, FKs `NOT VALID`→`VALIDATE`, CHECKs); orphan-data report | constraints + repair (no `crm_automations`) |
| P5 | Indexes | FK covering-index migration (parallel); DROP-unused/dup migration (after P6, fresh `idx_scan`) | indexes only |
| P6 | Reporting | reporting-views migration (`security_invoker`, `REVOKE anon`); timezone RPC body-replaces (drift-dumped, signature-frozen); `UPR-Web-Context.md` reporting/event-registry consumption | views + RPC bodies |
| P7 | Docs | `docs/database/*` guides + README + glossary; `scripts/db-docs-gen*` + `docs/generated/**`; `documentation-standard.md` SQL-header addendum | none |
| P8 | Storage stage 2 | the `job-files` signed-URL helper + its ~15 call-site swaps + bucket privacy flip | storage + helper (gated on H3) |

---

## 3. Frozen contracts (change the BODY within the owner phase, never re-define)

- `mt_today() → date`, `mt_date(timestamptz) → date` (F; IMMUTABLE, `America/Denver`).
- `set_billing_setting(p_key, p_value)` — F adds `p_assert_admin` gate; signature unchanged.
- The reporting timezone RPCs P6 replaces are **signature-frozen** — body-only `CREATE OR REPLACE`,
  drift-dumped from live first (3 are not in the repo), return shape identical, with a committed
  return-shape guard test. `get_call_volume`/`get_conversion_trend` (CRM Phase-9 frozen) +
  `get_my_appointments_today`/`get_assigned_tasks`/`get_stalled_materials_for_employee` (tech-v2
  frozen) require a **disclosed rule amendment** in P6's PR and the existing backward-compat tests green.
- The public `anon` allowlist is `database-standard.md` §2 — P3 revokes everything else; no phase adds
  an `anon` grant without an allowlist entry + `-- public: <reason>` comment.

## 4. Migration rule (this initiative)

Additive / policy-grant / index-only. **No `DROP`/`RENAME`/`ALTER COLUMN` that tightens a live table**
(removals are a separate reviewed change). Every migration carries a rollback note (`database-standard`
§6) and is apply-window-sequenced (§5) — P3 and P4 must not have overlapping apply windows (both
strong-lock the same hot tables); use `NOT VALID`→`VALIDATE` for constraints and chunked
`DROP POLICY IF EXISTS` recreates for policies. `migration-safety-checker` + `anon-grant-auditor`
audit every migration-shipping PR.

## 5. Frontend-contract freeze (binding on every phase)

No phase renames/moves/drops a column or changes an RPC return shape the deployed frontend reads
(`database-standard.md` §3). The only sanctioned FE-visible changes: P6's timezone RPCs shift computed
date VALUES (same columns), P4's repair changes displayed external-ID/sync-badge VALUES on the
currently-wrong duplicate rows only, P3's REVOKE is an access change (regression-tested on public
surfaces), P8's photo URLs move public→signed (behind the helper). Everything else is additive.

## 6. Foundation artifacts the wave consumes (frozen contracts)

- The `ALTER DEFAULT PRIVILEGES ... REVOKE ... FROM anon` (so no new object re-opens anon) — every
  later phase's new object still appends an explicit `REVOKE ... FROM anon` as belt-and-suspenders.
- `mt_today()`/`mt_date()`; the claims/invoices history tables (P6 reports from them, does not create them).
- The secret-exposure SQL gate + `anon-grant-auditor` + `db-foundation-phase-reviewer` (close-out).
- The baseline snapshot + drift-check (P7's generator reads live but never writes F's baseline dir).

## 7. Close-out (every phase session)

Commit → `npm run test` + `npm run build` + `npx eslint` (changed files) → `migration-safety-checker`
+ `anon-grant-auditor` (any migration) + `db-foundation-phase-reviewer` sign-off (weighted on the
phase's blast surface) → apply + verify migrations live via MCP within the sequenced window → update
`UPR-Web-Context.md` (Rule 9) → reconcile the roadmap checkboxes (both directions) → delete TEST rows →
push `-u` → open a PR into `dev` as a handoff → **STOP** (the owner or the autonomy policy merges; do
not subscribe to / babysit / click-merge). RED-tier actions (REVOKE / DROP / data UPDATE / bucket flip)
stage the migration + rollback + tests and wait for the owner's OK per the roadmap's autonomy ledger.

## 8. Deferred-hardening bucket (re-check keyed to in-flight merges)

P3/P4 changes on these tables land only after the owning phase merges OR ship a committed
backward-compat test that the in-flight caller still succeeds: `messages`/`conversations`/`email_*`
(omni), `crm_automations`/`crm_automation_runs`/`jobs`/`job_phase_history` (5-Ops),
`appointments`/`jobs`/`claims`/`contacts` (schedule A), `automation_settings` (CRM 4b). Everything else
is uncontested.
