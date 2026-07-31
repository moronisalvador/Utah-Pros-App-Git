# UPR Web Context — Changelog Archive (through 2026-07-29)
Extracted from `UPR-Web-Context.md` on 2026-07-29 (owner-directed restructure). These are dated
session logs, incident write-ups, shipped-phase narratives and plans-of-record — HISTORY, not
current state. The live reference stays in the root `UPR-Web-Context.md`. Nothing here is law;
where an entry conflicts with a current doc, the current doc wins.

## Dorothy Killian downstairs reconstruction A/R repair (2026-07-27)

Migration source
`20260727222000_dorothy_killian_downstairs_reconstruction_repair.sql` is a bounded, idempotent
repair for the already-existing UPR records tied to QuickBooks invoice `4283` / document
`R-2604-062`. It does not create another job, invoice, line item, or payment. It corrects the
downstairs reconstruction job to claim `CLM-2603-010` / Encircle `4390121`, moves the incorrectly
assigned upstairs reconstruction job to its own Encircle claim `4760844`, fills the reviewed
customer/job identity fields, adds the missing primary `contact_jobs` association, and restores the
existing invoice line to `$10,611.51`. Existing triggers then derive invoice balance `$2,938.64`
from the preserved `$7,672.87` QuickBooks payment. The migration never writes generated or
payment-trigger-owned money columns directly.

The paired rollback is emergency-only because it intentionally restores the known-broken `$0`
invoice total and negative displayed balance. The exact migration committed in `97b81c82` was applied
to shared UPR Supabase project `glsmljpabrwonfiltiqm` as ledger version `20260727224804`. Immediate
read-back verified one QBO invoice `4283`, one payment `4284`, one primary contact association, one
reconstruction job for each Encircle claim, invoice total `$10,611.51`, preserved payment
`$7,672.87`, balance `$2,938.64`, and `partially_paid` status in `get_ar_invoices()`. QuickBooks and
Encircle remained read-only; this repair made no provider write.

## Encircle managed credentials initiative (2026-07-23)

Implementation is landed and was dark-gated in the dated 2026-07-23 evidence. That snapshot said
the migration was pending. The active ownership register later recorded a live ledger row
`20260726233416 encircle_managed_credentials`, applied by another session, but also records that
the source-to-live mapping and fresh catalog evidence are missing. This mobile integration did not
recapture Encircle live state. Current apply/catalog/flag state is therefore **unknown pending the
separately scoped read-only provenance recapture**; do not replay the migration or infer rollout
readiness from either dated statement. No credential entry, rotation, revocation, deployment, or
provider action occurred in this mobile session. The plan of record is
`docs/encircle-managed-credentials-roadmap.md`, with the dated catalog and test snapshot at
`docs/audit/2026-07/evidence/encircle-managed-credential-readiness-2026-07-23.md`.

- Seven Pages Encircle workers now resolve the locked `integration_credentials` source first and
  retain the current environment binding as a temporary fallback.
- `upr-mcp/src/encircle.js` uses the same managed row/state precedence.
- New `/api/encircle-credential` requires an active admin plus a fail-closed rollout flag, validates
  a candidate against Encircle before storage, and never returns it.
- `20260723_encircle_managed_credentials.sql` is the reviewed repository source. It seeds no
  secret, leaves the flag OFF, adds fallback/active/disabled plus verification metadata, and
  preserves zero-policy RLS. The later reported live ledger row is unmapped; verify provenance and
  catalog state read-only before deciding whether this source already corresponds to it.
- `/settings/integrations` adds the Encircle card only when the explicit flag row is effectively on.
- Technician Scope Sheet files and payload/response contracts were intentionally not changed.
- Service-role writer gates were tightened without removing the technician new-job path: import is
  active admin/office/project-manager, backfill and legacy bulk sync are owner-only, and technician
  Scope Sheet/new-claim calls require an active employee.
- Read-only Cloudflare evidence confirms `ENCIRCLE_API_KEY` bindings exist in Pages Production,
  Pages Preview, and the deployed `upr-mcp` Worker. The owner confirmed on 2026-07-23 that the
  legacy Netlify Demo Sheet is obsolete and unsupported; retire that deployment and any remaining
  secret binding separately. It is not a credential-rotation dependency.

**Live URL:** https://dev.utahpros.app (dev branch) | https://utahpros.app (main)
**GitHub repo:** moronisalvador/Utah-Pros-App-Git
**Local repo:** F:\APPS\RestorationAPP\Utah-Pros-App-Git
**Deployment:** Cloudflare Pages (auto-deploys on push to `dev` branch)
**Rule:** Always work on `dev` (or a feature branch). Ship to `main` only via a reviewed `dev → main` PR a human merges — see **Deployment & Release Workflow** below.

## Conversation attachment scroll correction (2026-07-23)

Both `/conversations` and the technician v2 thread reuse
`src/components/conversations/MessageBubble.jsx`. Attachment images can change height after the
initial message paint, especially after a private `upr-storage://message-attachments/...` reference
is exchanged for its short-lived authenticated URL. `MessageBubble` now notifies its thread owner
when an image finishes loading or falls back after failure. A near-bottom reader stays pinned; a
history reader keeps the first visible message at the same viewport offset through both prepends and
delayed image layout. Initial thread-open snapping now runs before paint and resets per-thread scroll
intent. Resume recovery uses `useResumeRefetch` and merges the refreshed newest page into already
loaded history instead of replacing it. The shared anchor/merge policy is in
`src/components/conversations/threadScroll.js`; no send, webhook, consent, or provider contract changed.

## CallRail outbound MMS projection hardening (2026-07-24)

Outbound `message.sent` MMS events do not download UPR's own attachment back from CallRail. Both
the immediate webhook and retained-event worker require private media capture only for inbound MMS;
outbound confirmation instead matches the exact send-attempt ledger entry. The worker requires the
event channel to equal `requested_channel`, and MMS attempts must contain only non-empty
`upr-storage://message-attachments/outbound/` references.

Migration `20260724193628_bind_callrail_outbound_mms_identity.sql` preserves
`project_callrail_outbound_event(uuid,uuid)` and enforces the same checks transactionally before
any attempt, message, or event state update. A mismatch returns the existing
`outbound_unmatched` outcome for compatibility with both deployed and updated workers. Its exact
prior-body rollback is
`supabase/rollbacks/20260724193628_bind_callrail_outbound_mms_identity.rollback.sql`. It is live as
ledger version `20260724195329_bind_callrail_outbound_mms_identity`. The compatibility follow-up
`20260724195802_accept_frozen_callrail_mms_media_shape.sql` accepts both the frozen canonical
JSON-string media shape and the newer send-attempt array shape without weakening private-reference
validation; it is live as ledger version
`20260724200321_accept_frozen_callrail_mms_media_shape`. Post-apply rollback-only tests proved a
valid historical JSON-string row confirms through the attempt-less fallback, malformed JSON stays
`outbound_unmatched` with no state mutation, and channel/non-private attempt mismatches also stay
unchanged. Anonymous and authenticated callers remain denied; only `service_role` can execute.

---

## Session-efficiency optimizations (2026-07-13 — tooling only, no feature code)

Owner-approved token/usage optimizations for Claude Code sessions; no schema, no `src/` change:
- **Admin Mobile manifest archived** — the initiative is fully merged (all 7 phases; flag opened
  to all admins 2026-07-07; verified by a 10-agent audit incl. adversarial refutation against the
  live DB + open PRs), so `admin-mobile-wave-ownership.md` moved to `docs/archive/rules/` with a
  tombstone stub left in `.claude/rules/` per CLAUDE.md's archival rule. The other 8 wave manifests
  were audited and stay ACTIVE (each has genuinely open phases: CRM 4b/5-Ops, settings P4-blocked
  item + P9 owner cutover, tech-v2 H3, omni I/O/U, sms C/D/G + F-red, db-foundation P2–P8,
  tech-messages F-M/B1/B2, ux-quality W1–W6).
- **`upr-scout` agent** (`.claude/agents/upr-scout.md`) — Haiku, read-only, low-effort scout for
  file/pattern/caller finding; CLAUDE.md "How we work" §5 + masterplan delegation vocabulary now
  route inventory fan-outs to it (subagents with no `model:` inherit the expensive session model).
- **CLAUDE.md compact instructions** — what auto-compaction must preserve (incl. applied
  migrations on the shared Supabase) vs discard.
- **`upr_code_context` MCP tool** (2026-07-14, `upr-mcp/`) — a read-only "where does this feature
  live?" map for the UPR MCP server. Given a plain-English feature (e.g. "invoice payment
  reconciliation") it returns the relevant pages/components/workers/RPCs/tables/tests, the applicable
  `.claude/rules/` standards, and any gold-standard implementation named in those rules — in one
  compact (<2k-token) response. Backed by a **curated keyword index** (`upr-mcp/src/codeIndex.js`,
  no embeddings) with UPR business-vocabulary synonym expansion (claim/job/estimate/invoice/
  collections/tech/CRM/scope-sheet/QBO/Encircle/Twilio…); regenerated from the repo docs by
  `npm run build-index` (`upr-mcp/scripts/build-index.js`, scans `src/`, `functions/api/`,
  `supabase/migrations/`, `.claude/rules/`, `UPR-Web-Context.md`, `CLAUDE.md`). Purely offline — no
  DB or repo reads at runtime. Search logic in `upr-mcp/src/codeContext.js` (pure, unit-tested in
  `codeContext.test.js`); registered alongside `upr_schema`/`upr_search` and allow-listed in
  `.claude/settings.json`. Worker deploy is dashboard-side (`cd upr-mcp && npx wrangler deploy`).
- **TypeScript LSP wiring** — `typescript-lsp@claude-plugins-official` enabled in
  `.claude/settings.json` (`enabledPlugins`); `typescript-language-server` + `typescript`
  installed by `scripts/install_pkgs.sh` in cloud sessions (before the warm-cache skip); new root
  `jsconfig.json` (`@/* → src/*`, `checkJs:false`) so the LSP resolves the alias without flooding
  untyped-code diagnostics. Local machines: run
  `npm install -g typescript-language-server typescript` once.

## UX Quality initiative — plan of record + Phase 0 + F-S1 + F-S2 (2026-07-13)

A masterplan-standard session (11-auditor read-only sweep → synthesis → adversarial verification)
produced the **UX Quality** plan of record: `docs/ux-quality-roadmap.md` + `docs/ux-quality-dispatch.md`
+ `.claude/rules/ux-alignment-wave-ownership.md`. Goal: make every surface (desktop + tech PWA) behave
and look uniformly, and install enforcement so new work ships excellent without manual UX/UI cleanup.
Owner decisions: prep-for-redesign consolidation + foundation-first sequencing.

**Shipped this session (branch → dev):**
- **Phase 0 hardening** — REST client no longer retries non-idempotent writes (`src/lib/supabase.js`);
  `encircle-search/rooms/upload` now require a Supabase session (+ Bearer on the `TechDemoSheet` callers);
  `purge-feedback-media` gated behind the scheduler secret + 30-day floor; `stripe-payout` gated to
  admin/manager + stable idempotency key; destructive-SQL hook matcher broadened to `mcp__.*__`. Tests in
  `functions/api/phase0-security-gates.test.js`. (Deferred to F-B: the broad money-worker role gate and
  crew-sync atomicity — see the roadmap.)
- **F-S1 standards** — five rule docs (`page-lifecycle`, `loading-error-states`, `perf-budget`,
  `close-out-standard`, `workers-standard`), two reviewer agents (`design-consistency-checker`,
  `page-behavior-checker`), amended `upr-pattern-checker`, `eslint.config.js` (Rule 2 now error-level;
  toast/db-import drift at warn), `ci.yml` (build+test now gates `dev`), and amendments to `CLAUDE.md`,
  `tech-mobile-ux.md`, `documentation-standard.md`, and the `masterplan` skill (5 changes incl. a
  frontend-excellence guardrail + the minimize/resume test in close-out).
- **F-B backend foundation (branch `claude/ux-fb-backend`, PR into `dev`, 2026-07-13)** — three shared
  worker libs + three transactional RPCs + offline-queue extension. ⚠️ **The 3 RPC migrations are staged
  on disk but NOT yet applied to the shared prod DB** — the orchestrator applies + verifies them via MCP
  in a low-traffic window before merge.
  - **New RPCs** (all `SECURITY DEFINER`, `REVOKE EXECUTE FROM PUBLIC, anon` + `GRANT TO authenticated,
    service_role`; migrations `supabase/migrations/20260713_uxq_fb_*.sql`):
    - `sync_appointment_crew(p_appointment_id uuid, p_crew jsonb) → SETOF appointment_crew` — atomic
      delete-then-insert replace of an appointment's crew (kills the non-atomic loop in
      `TechEditAppointment`/`EditAppointmentModal`/`EventModal`).
    - `save_estimate_lines(p_id uuid, p_lines jsonb, p_kind text DEFAULT 'estimate') → jsonb` — atomic
      line replace for estimates (default) or invoices (`p_kind='invoice'`); never writes the GENERATED
      `line_total`; the recompute trigger rolls up the subtotal.
    - `get_jobs_list(p_search text, p_limit int, p_offset int) → SETOF json` — trimmed ~31-col set +
      server-side search (name/job#/address/claim#/insurer) + pagination (`total_count` window),
      replacing the ~52-col unbounded Jobs/Production query. Tests: `supabase/tests/uxq_fb_rpcs.test.js`
      (anon-denied least-privilege) + `supabase/tests/uxq_fb_rpcs.sql` (live atomicity/shape gate).
  - **New libs** (`functions/lib/`): `auth.js` (`requireUser`/`requireEmployee`/`requireRole`/
    `checkCronSecret` + `getActorEmployee` moved here from `google-drive.js`, which now re-exports it;
    token verify uses the anon key on `/auth/v1/user`), `http.js` (`fetchWithTimeout`, 15s
    `AbortSignal.timeout`, adopted in `twilio/quickbooks/email/callrail-api`), `worker-runs.js`
    (`recordWorkerRun`/`withRunRecording`).
  - **Consolidation:** 11 uncontested workers swapped from a local `requireAuth` copy to `requireUser`;
    8 uncontested workers' hand-rolled `worker_runs` inserts migrated to `recordWorkerRun`. Files owned by
    active initiatives were left for their owners (see the F-B PR body for the exact skip list).
  - **Offline queue:** `note.insert` + `task.toggle` mutation types added (`src/lib/dispatchers/
    {noteDispatcher,taskDispatcher}.js` + `syncRunner.js` switch) so offline notes/checkbox taps sync
    like online. Money-worker safety tests added (`functions/api/{qbo-payment,stripe-webhook}.test.js`).

**Key audit findings (grounded in file:line, not memory):** two-speed codebase (new surfaces already
correct, legacy half hand-rolls); 1,644 hardcoded hex (836 distinct); 11 surfaces blank a rendered page
on PTR/mutation; 6 loading primitives; 125 raw toast dispatches; failed loads render success empty-states
on top screens (Schedule/JobPage). Foundation-then-wave remediation (F-S2 primitives/tokens, F-B backend,
W1–W5 page alignment, W6 fold-ins) — F-S2 shipped (below); F-B + W1–W5 run alongside next week's features.

### F-S2 — Shared primitives, tokens & motion foundation (2026-07-13, branch → dev)
The contract every W-session imports. **Ships primitives + tokens + docs only; zero call-site migration
(that's W1–W3 by design).**
- **`src/index.css` `:root`** — new semantic status token family `--success/--danger/--warning/--info/--neutral`
  (+ `-bg`/`-border`), minted from the grep-verified dominant in-code triplets, with dark-theme re-tones in
  the `[data-theme="dark"] .tech-layout` block; new motion catalog tokens `--motion-duration-{fast,base,slow}`
  + `--motion-ease-{standard,decelerate,accelerate}`. Plus a base CSS block for the primitives, the promoted
  `.btn` press feedback, the animated `.ui-seg` segmented control, the reusable `.ui-chat-bubble-*` classes,
  and the `@view-transition { navigation: auto }` page-transition mechanism — all transform/opacity-only and
  `prefers-reduced-motion`-wrapped.
- **`src/components/ui/**`** — `Modal` (role=dialog + focus trap + ESC/overlay close + mobile bottom-sheet),
  `StatusPill` (+ `statusTone.js` classifier), `EmptyState`, `ErrorState` (shape from TechJobDetail:330),
  `PageHeader`, `SearchInput`, `IconButton` (label-required); barrel `index.js`.
- **`src/hooks/**`** — `useResumeRefetch` (the one silent resume/focus/poll refetch hook — replaces 8
  hand-rolled visibility handlers), `useTwoClickConfirm`, `useLookup` (react-query roster cache:
  employees/job_phases/carriers), `usePhotoUpload` + `thumbUrl`/`publicUrl` (mediaCompress on upload; the
  single media-URL construction point = db-foundation P8's signed-URL swap seam).
- **`UPR-Design-System.md`** — deleted the inline-hex Status Color Palette recipe; converted the
  Modal/StatusPill/empty-error-loading/two-click/toast pattern sections to component/hook imports; added the
  Kit Registry, the Dark-theme contract, and the Motion Catalog; regenerated the division table from
  `DivisionIcons.DIVISION_CONFIG`; per-section Last-verified 2026-07-13 stamps.
- Tests: `src/components/ui/uiPrimitives.render.test.jsx` + `src/hooks/hooks.test.jsx` (renderToStaticMarkup
  + pure-logic). Build clean, full suite green (1119 passed), 0 new eslint findings, CSS bundle 392.82 KB raw
  (< 400 KB budget). **Deferred (by design):** the router `viewTransition`-prop wiring + shell
  `view-transition-name` marking (App.jsx/Layout are frozen — a shell-owner follow-up); call-site adoption of
  every primitive/hook is W1–W3/W5.

## DB Foundation initiative — plan of record (planning session, 2026-07-08)

A masterplan planning session produced the **DB Foundation** plan of record: `docs/db-foundation-roadmap.md`
+ `docs/db-foundation-dispatch.md` + `.claude/rules/db-foundation-wave-ownership.md`, plus the new standing
rulebook `.claude/rules/database-standard.md`, three reviewer agents (`db-foundation-phase-reviewer`,
`anon-grant-auditor`, and the amended `migration-safety-checker`), and least-privilege amendments to
`CLAUDE.md` (Rule 7 + the PostgREST/RLS paragraph). **No schema shipped in the planning session** — the
build phases (F, P1–P8, hotfix H0) run next, gated by the roadmap's GREEN/YELLOW/RED autonomy ledger.

**Key live findings (verified against `glsmljpabrwonfiltiqm` 2026-07-08, not memory):** 198/220 public
policies are `USING(true)` and 163 grant `anon` (incl. `payments`/`invoices`/`employees` write); ~329
`SECURITY DEFINER` functions are anon-executable; both storage buckets are public with anon write/delete
(`message-attachments` has 21 orphaned objects + zero code consumers); 290 live migrations vs 133 repo
files (`system_events`, `get_dashboard_stats` live-only); live duplicate external-IDs
(`invoices.qbo_invoice_id` 7 dup groups, etc.); 108 unindexed FKs; 25 mutable `search_path`. **Secrets:
NO exposure** — every API key/OAuth token is in a deny-all RLS table (anon+auth read 0 rows), plaintext at
rest (Vault empty). Two live fixes queued: `set_billing_setting` lacks an admin gate (anon-callable
billing-config write), and Postgres default privileges auto-grant `anon` on every new object (Foundation
ships `ALTER DEFAULT PRIVILEGES ... REVOKE ... FROM anon`). The initiative is additive/policy/index-only
with a **frontend-contract freeze** — no column moves, no RPC signature/return-shape changes (the sole FE
location change is P8's photo URLs public→signed, isolated as a serial tail). Full details + the challenge
report (2 draft claims refuted) live in the roadmap. Standing DB rules now in
`.claude/rules/database-standard.md`.

### DB Foundation — Phase F SHIPPED (2026-07-08, security/audit/drift hardening)

Reviewed via the full gauntlet (`migration-safety-checker` + `anon-grant-auditor` + `db-foundation-phase-reviewer`)
before landing; the review found + closed two live anon exposures F had reproduced from old drift (below).
All applied + verified live on the shared Supabase.

```
-- New tables (RLS on, authenticated-read policy, anon revoked; SECURITY DEFINER triggers write them)
claim_status_history(id, claim_id→claims, from_status, to_status, changed_at)
invoice_status_history(id, invoice_id→invoices, from_status, to_status, changed_at)
     — append-only audit of every claims/invoices status change; seeded a current-state baseline row
       per existing parent (130 claims / 80 invoices). Fed by AFTER UPDATE OF status triggers that fire
       ONLY WHEN (OLD.status IS DISTINCT FROM NEW.status) and are EXCEPTION-wrapped (can never roll back
       the parent financial write).

-- New RPCs (authenticated + service_role ONLY — never anon)
mt_date(timestamptz) → date  — America/Denver calendar date of a moment. IMMUTABLE (index/generated safe).
mt_today() → date            — today's Denver date. STABLE. Bucket days/weeks with these, never UTC.

-- Security hardening
set_billing_setting(p_key,p_value)  — NOW admin-gated (PERFORM p9_assert_admin() first stmt); was
                                      anon-callable with no caller check. Signature frozen; anon revoked.
                                      (canEditBilling's 'manager' string matches no live role → effective
                                      behavior already admin-only, so no user regression.)
ALTER DEFAULT PRIVILEGES            — REVOKE anon on new tables/sequences/functions. NOTE: managed Supabase
                                      re-applies built-in EXECUTE-TO-PUBLIC on new functions at
                                      ddl_command_end, so EVERY new function migration MUST also
                                      `REVOKE EXECUTE ... FROM PUBLIC, anon` per-object (database-standard §1).
Secret-store deny-all               — integration_credentials / integration_config / user_google_accounts
                                      stay RLS-enabled with ZERO policies (deny anon AND authenticated).
                                      Tripwire: supabase/tests/db_foundation_secret_exposure.{sql,test.js}.

-- Drift reconciliation
system_events, get_dashboard_stats  — drift-captured (re-derived from live catalog, idempotent).
                                      Review follow-up (20260708_dbf_revoke_anon_dashboard_and_events):
                                      revoked anon EXECUTE on get_dashboard_stats (KPI counts, no anon
                                      caller) and dropped system_events' anon policies+grants entirely →
                                      RLS-on deny-all (service-role workers + definer RPCs only; the
                                      audit log is no longer world-readable). Baseline db/baseline/ +
                                      scripts/db-drift-check.{sql,mjs} diff live vs repo (~73 tables /
                                      ~101 functions predate schema-as-code — documented backlog).
```

### DB Foundation — Phase P1 SHIPPED (2026-07-08, advisor quick wins)

Reviewed via the full gauntlet (`migration-safety-checker` + `anon-grant-auditor` +
`db-foundation-phase-reviewer` — all pass). Applied + verified live on the shared Supabase.
Migration `supabase/migrations/20260708_dbf_p1_advisor_quick_wins.sql` (attribute/index-only).

```
-- search_path pinned (attribute-only, behavior-preserving — no body change)
25 functions            — ALTER FUNCTION ... SET search_path = public (7 SECURITY DEFINER +
                          18 SECURITY INVOKER triggers/helpers). Clears the 25
                          function_search_path_mutable advisors (verified 25 → 0 live). Each body
                          references only public objects / pg_catalog built-ins / qualified
                          auth.uid(), so a public-pinned path resolves identically.
-- duplicate index dropped
job_notes               — dropped idx_job_notes_job_id; kept the identical job_notes_job_idx
                          (both were non-unique btree(job_id)). UNIQUE + PK untouched.
-- worker auth hole closed
sync-encircle.js        — POST now runs requireAuth (mirrors the GET). Was unauthenticated (anyone
                          with the URL could trigger a bulk Encircle→jobs import). Sole caller is the
                          authenticated DevTools trigger; no cron depends on it (4 net.http_post cron
                          jobs target other endpoints). Test-first: functions/api/sync-encircle.test.js.

-- DEFERRED (documented, NOT done — out of P1's additive/no-DROP scope)
pg_net out of public    — ALTER EXTENSION pg_net SET SCHEMA extensions ERRORS live (pg_net is
                          non-relocatable). Only fix is a destructive DROP/CREATE EXTENSION (drops
                          net.http_request_queue + momentarily breaks the 4 net.* cron jobs) →
                          separate reviewed RED-tier change. extension_in_public advisor stays at 1.
leaked-password protect — Supabase Dashboard → Auth toggle (no SQL surface). Owner action pending;
                          auth_leaked_password_protection advisor stays at 1.
```

> **Drift note:** F already snapshotted its baseline before P1 applied (F shipped first, ahead of
> the original Wave-0 "P1-before-F-snapshot" ordering), so these 25 `SET search_path` attribute
> changes will register as drift against F's baseline until the baseline is refreshed. Expected +
> benign — the drift-check is a verification aid, not a gate.

### DB Foundation — Phase P2 SHIPPED (2026-07-08, storage lockdown stage 1)

Storage.objects **policies only** — zero public-schema change (P3's domain), zero frontend edits, zero
bucket-privacy flip on `job-files` (P8's). Applied + verified live via MCP; migration
`20260708_dbf_p2_storage_lockdown.sql`. Test: `supabase/tests/db_foundation_storage_lockdown.test.js`
(expired/absent-JWT offline-replay upload refusal; self-skips without creds).

```
-- Final storage.objects policy state after P2 (verified live):
job-files:
  job_files_select                  SELECT  public   — KEPT (public photo/PDF READ; §2 allowlist until P8)
  anon_read_job_files               SELECT  anon     — KEPT (same allowlist entry)
  job_files_authenticated_insert    INSERT  authenticated — NEW (replaces the dropped PUBLIC write path)
  job_files_authenticated_delete    DELETE  authenticated — NEW
message-attachments:
  (ZERO policies — dead bucket fully locked; 0 code consumers, 21 orphaned objects)
```

**Why the authenticated re-grant (important, not in the original roadmap prose):** the dropped write/delete
policies on `job-files` were scoped to `anon` + PUBLIC — there was **no** `authenticated`-only policy, so the
PUBLIC policy was silently carrying logged-in techs. A pure drop broke real uploads (verified live:
authenticated INSERT → 42501). P2 therefore **replaces** the anon/public write/delete with
`authenticated`-scoped write/delete (database-standard §1 least-privilege floor), restoring the exact prior
authenticated capability (INSERT + DELETE; there was never an UPDATE policy) while removing the anon/public
hole. Net effect on a logged-in tech: none. The offline photo dispatcher (`Bearer ${db.apiKey}` = user JWT)
is unaffected; only its anon-key fallback (expired/absent session) is now refused.

**STAGED, awaiting owner OK (RED-tier — autonomy ledger):**
`supabase/migrations-staged/20260708_dbf_p2_message_attachments_purge.sql` — flips `message-attachments`
bucket to private (`public=false`) and deletes its 21 orphaned objects. Irreversible (delete) → held for
owner approval. It lives OUTSIDE `supabase/migrations/` so no `supabase db push`/`reset` or MCP apply
sweeps it (a `.STAGED.sql` suffix inside the dir would NOT be excluded — the CLI globs `*.sql`). Pre-apply
guard: `supabase/tests/db_foundation_p2_purge_precheck.test.js`.

### DB Foundation — Phase P3 anon closure (2026-07-08, ✅ APPLIED live 2026-07-08)

**APPLIED + verified live** (owner-approved). As the anon role: `payments`/`invoices` now read **0 rows**
(RLS-deny; anon table grants remain but no policy applies), `employees` still readable (login bootstrap,
allowlisted). Anon-executable public functions dropped to exactly the **6 allowlist** RPCs. Realtime intact
(`notifications` authenticated policy present). Applied as: `anon_policy_closure` verbatim; `anon_rpc_revoke`
via an equivalent catalog-driven revoke (same reviewed intent — revoke PUBLIC+anon on all-but-6-allowlist;
end state verified = 6). **TWO follow-ups still open:**
- **`document_templates` temp anon-read bridge** — ✅ **REMOVED 2026-07-08** (`20260708_dbf_p3_drop_document_templates_bridge.sql`)
  after the `dev→main` release (#355) shipped the RPC-based SignPage to prod. **P3 anon closure is now 100% complete**
  — `document_templates` is authenticated-only; verified live post-drop that signing still works via
  `get_sign_document_templates` (anon RPC returns rows) while direct anon table read returns 0.
- **P2 purge:** `message-attachments` is flipped **private** (applied), but its 21 orphaned objects are NOT
  deleted — Supabase's `storage.protect_delete()` blocks SQL deletes; remove them via the Storage dashboard if
  desired (harmless in a now-private bucket). The staged SQL DELETE cannot run and should be treated as a no-op.



Closes the anonymous (`anon`) browser-role exposure (roadmap finding S1). The app runs as
`authenticated` (real Supabase JWT — `AuthContext.jsx`); workers as `service_role`; so scoping
public policies + RPC grants to those roles regresses nothing. Generated from the LIVE catalog
(161 anon policies / 85 tables; 327 anon-executable functions), MINUS the `database-standard.md`
§2 allowlist, MINUS the ownership-manifest §8 deferred-hardening tables.

```
-- Migration A — ADDITIVE, applied (code-first). 20260708_dbf_p3_sign_document_templates_rpc.sql
get_sign_document_templates(p_token text) → SETOF document_templates  — SECURITY DEFINER, token-gated.
     Replaces SignPage.jsx's direct anon read of the whole document_templates table: resolves the
     doc_type from a valid sign_requests.token and returns only that type's sections (bogus token →
     0 rows). anon EXECUTE kept (§2 allowlist: public e-sign). SignPage.jsx now calls this RPC.

-- Migration B — RED, STAGED. 20260708_dbf_p3_anon_policy_closure.sql
Recreates 126 public policies (66 tables) dropping anon → TO authenticated (USING/WITH CHECK
     unchanged, incl. the `(NOT is_crm_partner(auth.uid()))` predicates). nav_permissions narrowed
     (anon ALL → anon SELECT for the then-deployed bootstrap; the anonymous selector is now retired).
     notifications_select ALTERed TO authenticated
     (never dropped — realtime + reads depend on it). Idempotent (DROP POLICY IF EXISTS), alphabetical.

-- Migration C — RED, STAGED. 20260708_dbf_p3_anon_rpc_revoke.sql
REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC, anon on 322 functions (both grants — anon ∈ PUBLIC;
     revoking anon alone leaves the PUBLIC grant, per F's managed-Supabase note) + re-GRANT
     authenticated, service_role (belt-and-suspenders). Rollback = re-GRANT anon (commented in-file).

-- KEPT anon (§2 allowlist): RPCs get_feature_flags, get_employee_page_access, get_crm_build_progress,
     upsert_lead_from_form, get_sign_request_by_token, get_sign_document_templates; table reads on
     employees / feature_flags / employee_page_access / nav_permissions (historical bootstrap
     compatibility; current source uses a genuine session and selector-free RPCs).
     Current correction: `20260723235900_public_form_rpc_boundary.sql` is now authored to remove
     upsert_lead_from_form from this temporary exception because both runtime callers use the
     service-role Worker path. It remains unapplied until an owner-authorized serialized window.
-- DEFERRED (manifest §8 — anon LEFT until the owning in-flight phase merges): messages, conversations,
     conversation_participants, email_campaigns/recipients/exclusions, email_suppressions (omni);
     crm_automations, crm_automation_runs, jobs, job_phase_history (5-Ops); appointments, claims,
     contacts (schedule); automation_settings (CRM 4b). 30 anon policies stay this phase.
-- Gate: supabase/tests/db_foundation_p3_anon_closure.{sql,test.js} — asserts zero anon outside the
     allowlist (∪ deferred) post-apply. Supersedes the unapplied hardening migration in PR #224.
```

### DB Foundation — Phase P5 covering indexes (2026-07-08, half 1 shipped; DROP half deferred)

Postgres does **not** auto-index the referencing side of a foreign key, so FK joins/lookups and
parent-DELETE integrity checks fall back to sequential scans. The live audit found **108** unindexed
FKs. P5's covering-index half adds indexes to a deliberately **tight hot-path subset (7)** — the rest
were excluded on principle, not overlooked:

```
-- APPLIED + VERIFIED LIVE (all indisvalid). 20260708_dbf_p5_fk_covering_indexes.sql (YELLOW, additive)
idx_jobs_lead_tech_id                     jobs(lead_tech_id)               -- filter jobs by lead tech (dispatch/schedule)
idx_invoices_estimate_id                  invoices(estimate_id)            -- estimate → invoice link (billing)
idx_estimates_converted_invoice_id        estimates(converted_invoice_id)  -- estimate → converted invoice (billing)
idx_job_documents_sign_request_id         job_documents(sign_request_id)   -- docs for an e-sign request (45k+ seq scans/table)
idx_sign_requests_contact_id              sign_requests(contact_id)        -- sign requests for a contact (e-sign)
idx_job_time_entries_continued_from       job_time_entries(continued_from) -- supersede/continuation clock chain (tech clock)
idx_conversation_participants_contact_id  conversation_participants(contact_id) -- inbound SMS resolves conversation by participant contact_id

-- EXCLUDED from the CREATE set (not hot-path):
--   • employee audit FKs (created_by/updated_by/recorded_by/entered_by/approved_by/…) — never filtered,
--     parent (employees) is deactivated not DELETEd → index only taxes writes.
--   • zero-row flag-gated crm_*/form_*/sequence_* tables (page:crm closed) — no active read path yet.
-- Touches NONE of P4's external-ID columns (all 7 are internal uuid FKs). Rollback = 7 DROP INDEX (in-file header).

-- DEFERRED — DROP-unused/duplicate half. Blocked on P6 merge (no open PR yet): needs P6's view/RPC
--   definitions to build the exclusion list + a fresh idx_scan re-verify; RED-tier (owner OK). Ships as
--   a separate revert-ready migration (CREATE statements in its header) once P6 lands.
```
### DB Foundation — Phase P7 docs & onboarding (2026-07-08, shipped)

Docs + generator only — zero schema, zero `src/` page edits. Ships:

- `docs/database/how-the-data-model-works.md` — plain-English guide (invoicing-guide style: one
  ASCII diagram, who-writes-what table) that **links into this file's own sections**, never copies
  the schema (Rule 9). Carries a header disclaiming schema authority — this file wins on conflict.
- `docs/database/glossary.md` — RLS/policy/anon/authenticated/SECURITY DEFINER/additive-only/etc.
- `docs/database/adding-a-table-rpc-or-policy.md` — the practical, in-order checklist companion to
  `database-standard.md` (the standing rules) and the `db-migration` skill (the guided build).
- `README.md` refresh — points at `CLAUDE.md`/this file instead of hand-listing routes/pages (the
  prior README's 10-route/page list was already stale before this phase).
- `scripts/db-docs-gen.sql` (pure catalog SELECT — no DDL, no app-table reads, safe with a read-only
  role) + `scripts/db-docs-gen.mjs` (transforms a snapshot file into markdown; the script itself
  never holds DB credentials of any kind) → `docs/generated/schema-overview.md` +
  `docs/generated/rpc-inventory.md`, each with a "regenerate, don't edit" banner. Framed as a
  drift-verification aid (flags any table/function with an `anon` grant, for a quick glance against
  `database-standard.md` §2's allowlist), never a second schema source. Distinct from Phase F's
  `db/baseline/` (a frozen comparison snapshot `db-drift-check.mjs` diffs against) — this generator
  never writes that directory; its own output is always "what does live look like right now."
  Regenerated again after the notification scheduler apply from a fresh read-only live catalog
  capture at 2026-07-24 01:00:19 UTC: 133 public tables and 374 distinct function-name rows
  (375 overloads in the separate closure query). The two new service-only scheduler functions
  explain the delta. The generated RPC inventory shows `exec_read_sql` service-only and, correctly
  for the still-unapplied public-form containment, `upsert_lead_from_form` executable by browser
  roles.
- `.claude/rules/documentation-standard.md` — new "SQL migration header" addendum formalizing the
  `MIGRATION:`/`Phase:`/`WHAT THIS DOES`/`ADDITIVE-ONLY`/`ROLLBACK` header pattern Phase F/P1's
  migrations already established, satisfying `database-standard.md` §6's rollback requirement.

---

### DB Foundation — Phase P4 data integrity (2026-07-08, ✅ YELLOW + RED both APPLIED)

**RED repair APPLIED + verified live 2026-07-08** (owner-approved "get everything done safely"): NULLed the
non-canonical external IDs on 4 duplicate claims + 1 duplicate contact (canonical rows — claim 4018951,
contact 531 — kept, verified), then added partial-UNIQUE on `claims.encircle_claim_id` +
`contacts.qbo_customer_id` (0 dup groups remain) and dropped the superseded `claims_encircle_claim_id_idx`.
Exact-inverse rollback in the migration headers. **Owner follow-up (NOT auto-touched):** invoice `4274` is a
genuine QBO discrepancy (neither row nor their sum matches the QBO total) — needs a QuickBooks look.

Constraints + pre-check data repair (roadmap findings 8/9). Full evidence:
`docs/db-foundation-p4-orphan-report.md`. Avoids `crm_automations` (5-Ops owns an ALTER there);
apply-window serialized vs P3 (both strong-lock claims/contacts). Gate:
`supabase/tests/db_foundation_p4_data_integrity.{sql,test.js}` (adaptive — green pre- and post-repair).

**Headline:** the `invoices.qbo_invoice_id` (7) / `payments.qbo_payment_id` (5) "duplicates" are NOT
dedup targets — the QBO document `TotalAmt` equals the SUM of the two UPR rows (one carrier
invoice/payment split across two jobs = **combined billing**; both rows canonical, distinct `job_id`).
Left unconstrained/unrepaired. `estimates.qbo_estimate_id` excluded for the same caution.
`invoices.qbo_invoice_id=4274` is the one true anomaly (neither row nor sum matches QBO) → owner/QBO
review, not auto-repaired. `jobs.encircle_claim_id` (67 groups) is legitimately many-jobs-per-claim
(already `UNIQUE(encircle_claim_id, division)`).

```
-- APPLIED LIVE (YELLOW / additive):
20260708_dbf_p4_missing_fks.sql            notifications.job_id → jobs(id) (ON DELETE SET NULL),
                                              NOT VALID → VALIDATE, 0 orphans. Only genuine missing FK.
20260708_dbf_p4_check_constraints.sql      job_time_entries hours/total_paused_minutes/travel_minutes
                                              each (IS NULL OR >= 0), NOT VALID → VALIDATE. Protects
                                              labor-cost math. (Other status/amount CHECKs already exist.)
20260708_dbf_p4_external_id_unique_clean.sql  partial UNIQUE on forms.encircle_note_id +
                                              google_calendar_links.google_event_id (dup-free 1:1 keys).
                                              Most import keys already UNIQUE (callrail_id, encircle_media_id,
                                              encircle_note_id (job_notes), encircle_room_id, twilio_sid,
                                              stripe_charge_id) — prior migrations.

-- STAGED, RED — owner-gated (apply via MCP after OK, NOT overlapping P3's window):
20260708_dbf_p4_external_id_repair.sql     NULLs external-ID on 4 non-canonical claims + 1 stray contact
                                              only (never money/status/canonical). Canonical determined
                                              live: claims via Encircle contractor_identifier (all 4 →
                                              the CLM-2606-* row); contact 531 → the row with the claim+email.
                                              In-tx assertions; exact-inverse rollback in-file.
20260708_dbf_p4_external_id_unique_repaired.sql  partial UNIQUE on claims.encircle_claim_id +
                                              contacts.qbo_customer_id AFTER repair (ordering = safety
                                              interlock); DROPs superseded plain claims_encircle_claim_id_idx.
-- Owner follow-ups (out of P4's external-ID scope): merge same-claim pair 4077213; merge duplicate
     contact 531 (fold correct +1 801 phone into canonical, delete stray); investigate invoice 4274;
     investigate rooms.client_id (4 UUIDs matching no contacts/jobs/claims).
### DB Foundation — Phase P6 SHIPPED (2026-07-08, reporting foundation)

Reviewed via the full gauntlet (`migration-safety-checker` + `anon-grant-auditor` +
`db-foundation-phase-reviewer`). Applied + verified live on the shared Supabase. Two migrations,
both additive/body-only — nothing the deployed frontend reads was renamed, dropped, or reshaped.

```
-- ① Reporting-views layer  (20260708_dbf_p6_reporting_views.sql) — the first TRACKED views (was 0).
--    All WITH (security_invoker = true) → run as the QUERYING user (RLS on base tables applies, no
--    owner-bypass); REVOKE ALL FROM PUBLIC, anon; GRANT SELECT TO authenticated, service_role only.
--    Faithful 1:1 projections (no row filtering) + convenience columns future dashboards kept
--    re-deriving. NO consumer yet — pure additive scaffolding. mt_date()/mt_today() supply MT days.
rv_jobs         — one row per job: division/phase/status/source (text), value + cost columns, a rolled
                  total_cost (labor+material+equipment+sub+other), created_day/converted_day (mt_date).
rv_invoices     — AR projection: totals, balance_due, insurance/homeowner split, is_qbo_synced,
                  created_day, days_outstanding = mt_today()−invoice_date when unpaid & balance>0.
rv_payments     — amount, method, payer, stripe_fee, refunded_amount, created_day, is_qbo_synced.
rv_leads        — source/medium/campaign, lead_status/score, is_answered_call / is_missed_call (call +
                  duration_sec), spam_flag, occurred_day/created_day (mt_date of occurred_at∥created_at).
rv_time_entries — hours, travel_minutes, rate, total_cost, computed_labor_cost =
                  (travel_minutes/60 + hours)×rate (tech-mobile-ux model), created_day.
    Guard: supabase/tests/db_foundation_p6_reporting_views.test.js — asserts anon is DENIED on each view.

-- ② Timezone RPC body-replaces  (20260708_dbf_p6_timezone_rpc_bodies.sql) — one convention: MT (§7).
--    Session TZ on this DB is UTC (no role/db override), so naive CURRENT_DATE returned the UTC day —
--    wrong every evening for a Denver business. BODY-ONLY swap CURRENT_DATE → public.mt_today() in 8
--    live RPCs; signatures + RETURNS shapes byte-identical (drift-dumped via pg_get_functiondef first —
--    3 were never in the repo). CREATE OR REPLACE preserves each function's existing grants (anon kept —
--    P3 owns anon closure, not P6); each also `REVOKE EXECUTE ... FROM PUBLIC` (managed-Supabase trap).
    add_custom_schedule_phase · get_assigned_tasks* · get_call_volume† · get_conversion_trend† ·
    get_my_appointments_today* · get_payroll_summary · get_stalled_materials_for_employee* ·
    get_timesheet_entries.
    † CRM Phase-9 frozen · * tech-v2 frozen → body-only replace under a DISCLOSED rule amendment
      (manifest §3); their existing backward-compat tests (crm_phase9_intelligence.test.js,
      tech_v2_feed_upgrades.test.js) assert RETURN SHAPE only and stay green.
    Guard: supabase/tests/db_foundation_p6_timezone_rpcs.test.js — per-RPC return-shape guard.
```

**event_type registry (system-wide audit + lifecycle vocabulary).** Two complementary layers record
"what happened / how did state move":

```
1) system_events — the general audit log (drift-captured by F; RLS-on deny-all, written by
   SECURITY DEFINER RPCs / service-role workers via log_system_event). Columns: event_type,
   entity_type, entity_id, actor_id, job_id, payload(jsonb), created_at.
   • entity_type ∈ { claim, contact, crm_import_batch, crm_task, document, email_campaign,
     email_suppression, form_definition, inbound_lead, job, job_time_entry, lead_attribution,
     message, note, sign_request }.
   • event_type naming: core domain events use dotted `domain.action`; CRM events use snake
     `crm_*`. Current registry (extend deliberately — keep the prefix convention):
       claim.*  : claim.created, claim.status_changed, claim.carrier_changed, claim.contact_changed
       job.*    : job.created, job.status_changed, job.phase_changed, job.division_changed,
                  job.approved_value_changed, job.invoiced_value_changed, job.payment_received
       document.* : document.uploaded, document.deleted        note.* : note.added
       esign.*  : esign.signed        message.* : message.outbound        contact.* : contact.merged
       clock.*  : clock.abandoned
       time_entry.* : time_entry.admin_clocked_out, time_entry.admin_updated,
                      time_entry.auto_closed_stale, time_entry.deleted
       crm_*    : crm_lead_created[_manual], crm_lead_updated, crm_lead_promoted, crm_lead_scored,
                  crm_lead_attributed, crm_lead_caller_named, crm_lead_stage_changed,
                  crm_lead_status_updated, crm_lead_details_updated, crm_contact_owner_set,
                  crm_contact_lifecycle_set, crm_contacts_imported, crm_task_created,
                  crm_task_status_changed, crm_call_transcribed, crm_form_saved/published/submitted,
                  crm_email_campaign_created/updated/deleted/queued/sent/exclusions_set,
                  crm_email_unsubscribed.
   NB: get_claims_list's last_activity_at deliberately EXCLUDES `%.created` events (bulk-import noise).

2) Transition-history tables — typed, per-entity movement logs (NOT in system_events):
     claim_status_history(from_status,to_status,changed_at)      — F (AFTER UPDATE OF status trigger)
     invoice_status_history(from_status,to_status,changed_at)    — F (same pattern)
     job_phase_history(from_phase,to_phase,changed_by,changed_at,duration_hours)   — pre-existing
     lead_stage_history(stage_id,from_stage_id,lost_reason,moved_by,moved_at)      — CRM
   These are the backfill-proof source for funnel/aging/velocity reporting the rv_* layer builds on.
```

---

## CRM Module — Phase 0 (Jul 1 2026 — progress tracking + shell skeleton)

Roadmap of record: `docs/crm-roadmap.md`. Full CRM build workflow rules (branch-per-phase, additive-
only migrations, shared-DB caveats, test-data isolation): `CLAUDE.md` → "CRM Phase Workflow". Phase 0
is the first build phase — a minimal `/crm` route skeleton plus the always-current build-progress
tracker every later phase reports into at close-out.

**Feature flag:** `page:crm` — `dev_only_user_id` = Moroni's employee id
(`d1d37f3c-2de5-4d8c-b5a8-f7b87e93d2da`), `enabled = false`. Invisible to every other employee on
both `dev` and `main` until opened up. Gates the `/crm/*` route tree (`<FeatureRoute flag="page:crm">`
in `src/App.jsx`) and the CRM nav entry (`src/lib/navItems.jsx` — `NAV_ITEMS` + `OVERFLOW_ITEMS`,
key `crm`, `IconCrm`).

**Tables** (migration: `supabase/migrations/20260701_crm_phase0_scaffold.sql` — additive, all RLS
`FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)` at creation):
```
crm_orgs          — id, name, is_test bool default false, created_at. The org_id tenancy seam every
                    later CRM table carries. Seeded with exactly two rows: "Utah Pros Restoration"
                    (is_test=false, the real org) and "Utah Pros — TEST" (is_test=true, disposable —
                    every CRM test row from later phases keys to this org).
crm_build_phases  — phase_key TEXT PK, title, status ('planned'|'in_progress'|'shipped', default
                    'planned'), shipped_at, sort_order. One row per roadmap phase: 0, 1, 2, 3, 4a,
                    4b, 4c, 4d, 5, and (since roadmap v3, 2026-07-02 — migration
                    `20260702_crm_roadmap_v3_phases.sql`) F, 6a, 6b, 7, 8, 9, 10.
crm_build_stages  — id, phase_key FK→crm_build_phases (ON DELETE CASCADE), title, status
                    ('todo'|'in_progress'|'done', default 'todo'), sort_order, UNIQUE(phase_key,
                    title). The sub-steps/to-dos inside each phase — seeded from each phase's
                    committed close-out checklist in docs/crm-roadmap.md.
```

**RPCs** (all SECURITY DEFINER, GRANT EXECUTE TO anon, authenticated):
```
get_crm_build_progress()                  — Returns one jsonb object: { phases: [...], overall_done,
                                             overall_total }. Each phase object carries phase_key,
                                             title, status, shipped_at, sort_order, stages (array of
                                             { id, title, status, sort_order }), done_count,
                                             total_count. Powers /crm/roadmap end to end.
set_crm_phase_status(p_phase_key, p_status) — Validates status is one of planned/in_progress/shipped;
                                             stamps shipped_at = now() whenever p_status = 'shipped'
                                             (re-stamps on every call, doesn't just set-once); raises
                                             on an unknown phase_key. Returns the updated row.
set_crm_stage_status(p_stage_id, p_status)  — Same shape for crm_build_stages (todo/in_progress/
                                             done). Returns the updated row.
```

**Frontend**: `src/components/CrmLayout.jsx` — deliberately bare (just `<Outlet/>`); Phase 1 replaces
it with the real designed shell (contextual left sidebar, `--crm-*` scoped tokens, SVG icon set —
see docs/crm-roadmap.md's "Design & shell decisions" section). `src/pages/crm/CrmRoadmap.jsx` —
`/crm/roadmap`, read-only, reads `get_crm_build_progress()` via `db.rpc()`; renders every phase as a
card with a status badge, a `done/total` progress bar, and its stages as a checklist. This page is
the single source of truth for CRM build progress — no external tracker. CSS lives in `src/index.css`
under a `.crm-roadmap-*` block (plain app tokens — Phase 1 introduces the `.crm-shell`/`--crm-*`
scoped token set, not used yet).

**Test-first**: `supabase/tests/crm_phase0_build_progress.test.js` — an integration test (vitest,
hits the live Supabase REST API directly via `src/lib/supabase.js`'s unauthenticated client) proving
`set_crm_phase_status` stamps `shipped_at`, `set_crm_stage_status` marks a stage done, and
`get_crm_build_progress` rolls up done/total counts correctly; committed before the migration (see
git history). Self-skips via `describe.skipIf` when `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`
aren't set — matches CI's `npm test` step, which doesn't currently receive those secrets (only the
Build step does; see `.github/workflows/ci.yml`). **Known sandbox limitation**: this session's outbound
network egress proxy does not allow-list the Supabase host, so the test could not be executed for real
here — the identical assertions were instead verified directly against the live `dev`/`main` shared
database via the Supabase MCP `execute_sql` tool (a `DO $$ ... ASSERT ...` block), which passed. The
committed test will run for real on a machine with normal (non-sandboxed) egress and populated
credentials.

**Dogfooding**: Phase 0 marks its own `crm_build_phases`/`crm_build_stages` rows via these same RPCs
at close-out (`set_crm_stage_status` per stage, then `set_crm_phase_status('0', 'shipped')`) — the
first real exercise of the tracker. As of this session's close-out, 6 of 7 stages are marked `done`
and phase 0 is `in_progress` (not yet `shipped`) — the one remaining stage is the live branch-preview
visual check, which needs a logged-in Moroni session and could not be done from this sandbox (same
network egress limitation as the integration test, above). Flip it to `done` and the phase to
`shipped` via `set_crm_stage_status`/`set_crm_phase_status` once that's confirmed on the pushed
branch's Cloudflare preview.

## CRM Module — Phase 1 (Jul 1 2026 — CRM shell + CallRail lead ingestion)

Builds on Phase 0 (above), which merged into `dev` first. Full spec: `docs/crm-roadmap.md` →
"Phase 1 — CRM shell + CallRail lead ingestion".

**Table** (migration: `supabase/migrations/20260701_crm_phase1_shell_callrail.sql` — additive, RLS
`FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)` at creation):
```
inbound_leads — id, org_id (FK crm_orgs), contact_id (FK contacts, nullable — see the spam/duration
                filter below), source_type ('call'|'form'), callrail_id UNIQUE, tracking_number,
                caller_number, duration_sec, spam_flag bool default false, source, medium, campaign,
                recording_url, transcription, form_data jsonb, lead_status default 'new', value,
                direction, occurred_at, raw_payload jsonb, notes, created_at, updated_at. Indexed on
                contact_id, org_id, occurred_at desc. Deliberately NOT named `leads` — see the
                roadmap's terminology-fix note: `Leads.jsx` is unrelated (jobs in phase='lead'), and
                this is a raw call/form touch that may never become anything.
```

**RPCs** (SECURITY DEFINER, GRANT EXECUTE TO anon, authenticated):
```
upsert_lead_from_callrail(p_callrail_id, p_source_type, p_tracking_number, p_caller_number,
  p_duration_sec, p_spam_flag, p_source, p_medium, p_campaign, p_recording_url, p_transcription,
  p_form_data, p_lead_status, p_value, p_direction, p_occurred_at, p_raw_payload, p_org_id)
  — True upsert-and-merge keyed on callrail_id (CallRail redelivers webhooks for the same call as
  the recording/transcript become available later): fields present in the new payload overwrite,
  null fields preserve whatever was already saved. p_org_id defaults to the real Utah Pros org when
  omitted; callers pass the "Utah Pros — TEST" org id explicitly for test rows. **NEVER auto-creates
  a contact** (`20260701_crm_lead_no_autocreate_contact.sql`): it LINKS the lead to an existing
  contact when one already matches `caller_number` (so a known customer's call lands on their
  timeline), but an unknown number stays a contact-free lead — most inbound calls are
  spam/wrong-numbers/price-shoppers, and auto-creating a contact per call floods the contacts table
  **(2026-07-21 fix, `20260721_crm_contact_link_and_activity.sql`, function-body-only
  `CREATE OR REPLACE`, signature unchanged):** the phone match was a bare `phone = p_caller_number`
  string comparison, so a contact whose phone wasn't stored in the exact same format as CallRail's
  E.164 `caller_number` never matched — verified live, several real customers' repeat calls stayed
  unlinked despite an exact-matching contact existing the whole time. Now normalizes both sides
  (strip non-digits, compare last 10) and skips (never guesses) an ambiguous multi-contact match. A
  one-time backfill in the same migration linked every previously-orphaned lead it could resolve
  unambiguously (`REVOKE...FROM PUBLIC,anon` re-affirmed; grants stay `authenticated, service_role`
  only — the header line above listing `anon` predates the P3 anon-grant closure and is stale for
  this RPC specifically).
  (and, via `trg_qbo_customer_sync`, QuickBooks). A contact is created only when the lead is
  qualified: it books (the app's find-or-create-by-phone flows) or staff run `promote_lead_to_contact`.
  (This retired the old `shouldCreateContact` spam-gate predicate + `functions/lib/callrail.js`, now
  moot since nothing is auto-created.) Every call writes a `system_events` row (`crm_lead_created`
  or `crm_lead_updated`).
promote_lead_to_contact(p_lead_id, p_name, p_email, p_created_by) — the CRM "Add as customer" action
  (Leads board detail panel, shown for a contact-free lead): find-or-creates a contact by the lead's
  `caller_number` (already E.164 from CallRail), backfills name/email where blank, links this lead
  **and any other still-unlinked leads from the same number**, and logs a `crm_lead_promoted`
  system_events row. `SECURITY DEFINER`, granted `anon, authenticated`.
update_lead_status(p_lead_id, p_status, p_notes, p_updated_by) — staff follow-up (Call Log page);
  logs a `crm_lead_status_updated` system_events row.
set_lead_transcription(p_lead_id, p_transcription, p_source default 'deepgram', p_analysis jsonb
  default null) — stores a call transcript we generated ourselves (see transcribe-call.js). Sets
  `transcription`, `transcription_source`, `transcribed_at`, `transcript_analysis` (COALESCE — a
  null analysis leaves the existing one), bumps `updated_at`, logs `crm_call_transcribed`
  (payload notes `has_analysis`). `SECURITY DEFINER`, granted `anon, authenticated`. Modeled on
  `update_lead_status`. **v2 (migration `20260701_crm_call_transcription_analysis.sql`)** dropped
  the original 3-arg version and recreated it with `p_analysis`.
set_lead_caller_name(p_lead_id, p_name) — stores a transcript-detected caller name on the lead
  (`caller_name`, only-if-blank) and backfills a LINKED contact's name only when that name is
  currently blank. **Never creates a contact** (raw-call spam must not pollute contacts — same
  stance as ingestion). `SECURITY DEFINER`, granted `anon, authenticated`, logs
  `crm_lead_caller_named`. (migration `20260701_crm_caller_name.sql`.)
set_lead_details(p_lead_id, p_notes, p_value, p_updated_by) — sets a lead's `notes` (text) + `value`
  (numeric) DIRECTLY (form is source of truth; null clears). Powers the Call Log "Notes & value"
  editor. Logs `crm_lead_details_updated`. (migration `20260701_crm_lead_details.sql`; the columns
  already existed.)
get_tracking_numbers() → (tracking_number, label, call_count) — every DISTINCT tracking number seen
  in inbound_leads LEFT JOINed to its campaign title + call count, most-active first. Powers the
  **CRM Settings → Tracking Numbers** editor AND the Call Log's read-only title lookup (`labelMap`).
set_tracking_number_label(p_tracking_number, p_label) — upsert the campaign TITLE for a tracking
  number (on the org's row). Both `SECURITY DEFINER`, granted `anon, authenticated`.
  (migration `20260701_crm_tracking_numbers.sql`.) **Titles are set in CRM Settings**, not inline on
  the Call Log — the Call Log chip is now read-only, showing the title (or the formatted number when
  untitled). `CrmSettings.jsx` lists every number with its call count + an editable title field.
get_inbound_leads(p_limit default 100, capped 500) → jsonb array of the newest leads with the linked
  `contact` ({name, phone}) embedded — mirrors the old `select=*,contact:contacts(name,phone)` shape
  exactly. `SECURITY DEFINER`, `STABLE`, granted `anon, authenticated`. **Why an RPC and not a GET
  select:** a GET is cacheable, so returning to the Call Log after a soft navigation showed a STALE
  cached list (a just-landed live call was missing until a hard refresh); an RPC is a POST, which
  browsers never cache. `CrmCallLog.jsx` `load()` calls this. (migration `20260701_crm_get_inbound_leads.sql`.)
  **Auto-refresh:** `CrmCallLog.jsx` polls this every 15s while the tab is visible + refetches on tab
  focus, and has a manual **Refresh** button — so a newly-landed call appears without a hard reload
  (CallRail's post-call webhook can lag ~1 min after the call). Silent background refreshes don't
  blank the list or toast; open inline editors keep their local state. NOTE: to make calls appear at
  *ring* time (near-instant), add a CallRail **"Call Started"** webhook pointing at the same
  `/api/callrail-webhook?secret=…` endpoint — ingestion already handles it (the mapper tolerates the
  missing duration/recording and `upsert_lead_from_callrail` is idempotent on `callrail_id`, so the
  post-call event enriches the same row). An in-progress lead renders with duration `—` plus a
  pulsing **"Waiting for recording & transcript…"** indicator (`isAwaitingRecording`: a call with no
  recording seen in the last 10 min) so a fresh 0:00 row never looks broken — the page auto-refreshes
  it into Play/transcript once CallRail delivers and the webhook auto-transcribes.
```

**New table `crm_tracking_numbers`** (`id, org_id, tracking_number, label, created_at, updated_at`,
`UNIQUE(org_id, tracking_number)`, RLS-enabled at creation) — maps a CallRail tracking number to a
**campaign label**. CallRail leaves `campaign`/`source` empty on direct dials, so the tracking
number IS the ad-source identity; staff label each number ("Google Ads", "Yard signs") inline on
the Call Log and the label shows on every call from it. `org_id` supplied by the RPC (Postgres
forbids a subquery column DEFAULT); the table is only written through `set_tracking_number_label`.

**`src/lib/phone.js`** gained `formatPhone(e164)` → `"(801) 447-1917"` (US 10-digit; echoes
anything else unchanged) for displaying tracking/caller numbers.

**`inbound_leads.caller_name text`** (migration `20260701_crm_caller_name.sql`, additive) — a
name detected from the call transcript by the Claude naming pass (see transcribe-call.js). The Call
Log prefers `contact.name` → `caller_name` → the raw phone number for the row label.

**`inbound_leads` columns added** (two additive migrations):
- `20260701_crm_call_transcription.sql`: `transcription_source text` + `transcribed_at timestamptz`
  — WHERE a transcript came from (`'deepgram'`) and WHEN.
- `20260701_crm_call_transcription_analysis.sql`: `transcript_analysis jsonb` — the structured
  Deepgram result: `{ model, speakerMode: 'channel'|'diarize', turns:[{speaker,text}], summary,
  sentiment:{label,score}, topics:[], entities:[{label,value}] }`. Mirrors the existing
  `raw_payload`/`form_data` JSONB pattern. The flat `transcription` text column stays alongside it
  (for search / a future LLM); `transcript_analysis` backs the Call Log conversation view.

**Existing RPC widened**: `get_integration_status(p_provider)` (originally QBO-only) only checked
`refresh_token IS NOT NULL` for "connected". CallRail has no OAuth — its API key lives in
`integration_credentials.access_token` with `refresh_token` left NULL — so the check was widened to
`refresh_token IS NOT NULL OR access_token IS NOT NULL`. Strict superset of the old behavior (QBO
always has both set together once connected), verified live via the Supabase MCP (see Verification
below) — not a behavior change for existing QBO callers.

**Workers** (`functions/api/`):
```
callrail-webhook.js   — POST, receives CallRail's call/form events, maps payload → 
                         upsert_lead_from_callrail, logs a worker_runs row per call. Auth is a
                         `?secret=` query param checked against integration_config
                         ('callrail_webhook_secret') — a documented placeholder (CallRail lets you
                         fully customize the webhook target URL, so this avoids guessing at an
                         unverified HMAC/signature-header scheme); confirm against CallRail's actual
                         webhook docs/dashboard and adjust if it differs. **Payload shape CONFIRMED
                         against a live delivery:** CallRail POSTs `application/x-www-form-urlencoded`
                         (NOT JSON), so the worker parses text→JSON→URLSearchParams; every decoded
                         value is a string, and the call id is under `resource_id` (no top-level
                         `id`). The pure mappers now live in `functions/lib/callrail.js`
                         (mapCallPayload/mapFormPayload/pickCallId/boolish/isAllowedRecordingUrl),
                         unit-tested against the real payload in `functions/lib/callrail.test.js`.
                         `boolish()` fixes a form-encoding trap where the string "false" was truthy
                         and mis-flagged clean calls as spam. **Auto-transcribe:** after the upsert,
                         if `shouldAutoTranscribe(lead)` (a call with an api-form recording and no
                         transcript yet), it runs Deepgram in the background via `context.waitUntil`
                         (imports `transcribeLead` from transcribe-call.js) — so the transcript +
                         summary are ready within seconds of the recording landing, no manual click.
                         Idempotent: only the recording-ready delivery passes, and a re-delivery after
                         the transcript exists is skipped (never re-bills Deepgram); best-effort, so a
                         failed auto-transcript never fails the webhook. Always returns 200 except on a
                         bad/missing secret (403), to avoid a CallRail retry storm.
callrail-connect.js   — GET (read the webhook secret) / POST (save API key, returns the secret) /
                         DELETE (disconnect), all authenticated. Writes integration_credentials
                         (provider='callrail', key in access_token) and generates the webhook
                         shared secret into integration_config on first connect only (never rotated
                         on reconnect — it's already pasted into CallRail's dashboard by then). The
                         GET exists because integration_config has no anon/authenticated RLS policy
                         (service-role only) — the frontend can't select it directly, so
                         CrmIntegrations.jsx calls this endpoint to display the webhook URL +
                         secret for Moroni to paste into CallRail's dashboard. Reuses
                         google-drive.js's generic getActorEmployee Bearer-auth helper (not
                         Google-Drive-specific despite the file name).
github-connect.js     — GET (connected? + default_repo) / POST (save GitHub PAT, validated
                         against GitHub /user; also sets integration_config.github_default_repo;
                         token-less POST updates just the repo) / DELETE (disconnect), all
                         authenticated (getActorEmployee). Writes integration_credentials
                         (provider='github', PAT in access_token). Backs AdminIntegrations.jsx;
                         the UPR MCP's github.js reads this token (env GITHUB_TOKEN fallback).
callrail-backfill.js  — POST, authenticated, manually triggered (not a cron). Pulls historical
                         CALLS ONLY via CallRail's v3 list-calls API and upserts through the same
                         RPC. Needs the connected API key + the CallRail account id; the account id
                         is resolved by functions/lib/callrail-api.js resolveCallRailAccountId()
                         (saved integration_config('callrail_account_id') → CALLRAIL_ACCOUNT_ID env
                         → auto-discovered via CallRail's /v3/a.json and persisted). callrail-connect
                         POST also resolves+stores it on connect (and thereby validates the key), so
                         no Cloudflare env var is required — a pasted key is enough. Requests
                         `&fields=transcription` (CallRail omits the transcript from the default list
                         response — opt-in Conversation Intelligence); both backfill + webhook run the
                         value through `transcriptText()` (functions/lib/callrail-api.js) which coerces
                         CallRail's string/object/array transcript shape to plain text. Field name +
                         shape unverified against the live account — re-run the backfill to confirm.
                         Endpoint path/field names are unverified against a live account — same
                         open item as the webhook. Hard-capped at 50 pages to guard against a
                         runaway pagination loop. **Disclosed scope gap**: the roadmap spec asks for
                         "historical calls + form leads" — this worker deliberately backfills calls
                         only; CallRail's historical form-submission list API is a second,
                         differently-shaped endpoint this session couldn't verify without a live
                         account (same open item as whether the site's form even routes through
                         CallRail's Form Tracking product — see docs/crm-roadmap.md "Open items to
                         confirm before Phase 1 starts"). Does NOT affect live form leads — those
                         arrive the same way calls do, through callrail-webhook.js's
                         mapFormPayload(), once CallRail is connected.
callrail-recording.js — GET, active internal admin or company-wide `crm_call_log` employee/role
                         capability. Streams a call recording INLINE so staff never leave
                         the Call Log. `inbound_leads.recording_url` is CallRail's authenticated API
                         endpoint (opening it directly in a browser → "HTTP Token: Access denied"),
                         so this proxy takes a UUID `lead_id`, proves it is a call row and that its
                         stored `callrail_id` matches the ID embedded in its stored allowlisted
                         recording URL, then reads the
                         CallRail API key from integration_credentials, fetches with the
                         `Authorization: Token token="…"` header, and streams the audio back. SSRF
                         guard (`isAllowedRecordingUrl`, functions/lib/callrail.js): proxies only a
                         CallRail-hosted URL stored on that lead. Identity/object denial happens
                         before credential/provider access. External identities, including current
                         desktop `crm_partner` Call Log users, are deliberately denied; hiding that
                         playback control is a separate UI compatibility follow-up. There is no
                         employee→CRM-org assignment model, so this is explicitly company-wide
                         capability scope. **app→api rewrite (critical):** the
                         LIVE webhook delivers `app.callrail.com/calls/{id}/recording/redirect?access_key=…`,
                         which THROWS when fetched server-side → the Worker crashed and Cloudflare
                         returned a raw **502 (text/html)**, so live-call recordings would not play or
                         transcribe. The proxy now rewrites that app URL to the working
                         `api.callrail.com/v3/a/{acct}/calls/{id}/recording.json` form (via
                         `extractCallId` + `callrailApiRecordingUrl` + `resolveCallRailAccountId`)
                         before fetching — the same form the backfill stores and that streams cleanly.
                         `callrail-webhook.js` also normalizes recording_url to the api form AT INGEST,
                         so all consumers (this proxy + `transcribe-call`) get a working URL.
                         `resolveCallRecording` now try/catches the fetch so a throw returns a clean
                         error shape instead of 502-ing the Worker. Both provider and signed-audio
                         fetch paths are timed. The key never reaches the client. Robust to CallRail's response shape: streams
                         audio/* directly, follows a JSON `{url}` descriptor to the signed audio and
                         streams that, else returns a 502 with the upstream status + body snippet so
                         a bad shape is diagnosable. That raw bounded upstream diagnostic and the
                         trusted provider-returned signed URL/content type are preserved deployed
                         contracts and remain P2 redaction/validation residuals. Direct
                         `get_inbound_leads`/`inbound_leads` access can still expose stored recording
                         URLs and is a separate database authorization residual.
                         `CrmCallLog.jsx` fetches it as a blob (an
                         `<audio src>` can't carry the Supabase Bearer) and plays it in a compact
                         **custom** player (`RecordingPlayer` — a hidden `<audio>` engine + CRM-styled
                         play/pause, seek, and time), not the browser's default control chrome. Each
                         call row also has a collapsible **"Show transcript"** toggle (only when a
                         transcript exists), and a **"Transcribe"** button when a recording exists
                         but no transcript does (calls transcribe-call.js below). The
                         recording-URL resolution (direct-audio-stream vs. JSON→signed-URL) now lives
                         in the shared `resolveCallRecording()` (functions/lib/callrail-api.js),
                         reused by transcribe-call.js.
transcribe-call.js    — POST, authenticated. Transcribes call audio OURSELVES because our CallRail
                         plan doesn't expose transcripts via the API (that needs CallRail's Premium
                         Conversation Intelligence add-on, ~$110/mo — confirmed live: `transcription`,
                         `lead_score`, `lead_explanation` all come back null even on long answered
                         calls). Body `{ lead_id }` (one call, from the Call Log Transcribe button) or
                         `{ backfill: true, days?: 30 }` (every recent call with a recording but no
                         transcript). Reads the Deepgram + CallRail keys from integration_credentials,
                         resolves the recording via `resolveCallRecording()`, then hands Deepgram the
                         signed URL so it fetches the audio itself (no Worker buffering; falls back to
                         POSTing bytes when CallRail streams directly). **v2 request** (one call):
                         `model=nova-3&smart_format&punctuate&utterances&diarize` +
                         Audio Intelligence `summarize=v2&sentiment&topics&detect_entities`.
                         **`multichannel` was DROPPED** — CallRail actually hands us a **MONO**
                         recording, and multichannel on a 1-channel file makes Deepgram treat the whole
                         call as one "channel 0" speaker, SUPPRESSING diarization (a two-person call
                         collapsed into a single "Agent" block). `diarize` alone separates the voices;
                         when mono still defeats it (≤1 speaker → `needsResegment`), a Claude pass
                         (`resegmentSpeakers` + pure `buildResegmentPrompt`/`parseResegmentedTurns`)
                         **rebuilds** the Agent/Customer turns from the raw transcript
                         (`speakerMode='resegment'`). Stores BOTH the flat text (`formatDeepgramTranscript`)
                         and the structured `transcript_analysis` (`buildTranscriptAnalysis` — pure,
                         unit-tested: turns + summary + sentiment + topics + entities) via
                         `set_lead_transcription`. **Idempotency:** the single-lead guard skips only
                         when a row has BOTH transcript AND analysis (unless `force`); the backfill
                         targets `or=(transcription.is.null,transcript_analysis.is.null)` so pre-v2
                         rows get re-enriched once with nova-3 + intelligence, then are skipped.
                         Backfill hard-capped at 200 (MAX_BACKFILL); logs one worker_runs row.
                         **Deepgram key** lives in integration_credentials (provider='deepgram') —
                         a pasted key, not a Cloudflare env var, same pattern as CallRail's. Confirmed
                         live: CallRail's download is MONO (hence the diarize + re-segment path above);
                         the parser is defensive — unconfirmed Audio-Intelligence shapes degrade to
                         null/[], never throw.
                         **Speaker naming (best-effort):** after Deepgram, a Claude Haiku pass
                         (`functions/lib/speakerNaming.js` — pure buildSpeakerPrompt/
                         parseSpeakerIdentities/applySpeakerIdentities, unit-tested) identifies which
                         speaker is the Agent vs Customer and each person's name, relabeling the
                         `transcript_analysis` turns (each turn gains a `role`). **When diarization
                         collapsed to one speaker** (mono), the worker instead runs `resegmentSpeakers`
                         (above), which rebuilds AND names the turns in one pass. The caller's name is
                         stored via `set_lead_caller_name`. Needs `ANTHROPIC_API_KEY` (Cloudflare env,
                         already set for the chat workers); any failure leaves Speaker 1/2 untouched.
                         Topics are capped to the 6 most-confident in `buildTranscriptAnalysis`
                         (Deepgram over-tags). The Call Log renders turns as grouped speaker blocks
                         (consecutive same-speaker turns merged; name bold-blue; tinted by role).
                         **Clean-up + summary pass (2026-07-17, best-effort, runs LAST):** owner
                         feedback — Deepgram's `summarize=v2` is generic ("A roofing contractor
                         introduces himself and pitches a partnership.") and raw transcript wording has
                         obvious speech-to-text errors. A SECOND Claude Haiku call
                         (`cleanAndSummarize` in transcribe-call.js; pure helpers in NEW
                         `functions/lib/callCleanup.js` — buildCleanupPrompt/parseCleanupResponse/
                         applyCleanup, unit-tested) runs after naming/resegmentation (so it sees the
                         final Agent/Customer/name speaker labels) and (1) fixes obvious mis-heard
                         words turn-by-turn WITHOUT changing what was said — each cleaned turn keeps
                         the original as `rawText` for QA — and (2) writes a 2-4 sentence
                         restoration-business-aware summary (damage type, urgency, key details, call
                         outcome) that **replaces** `transcript_analysis.summary` (same key the lead
                         panel already renders — no frontend change needed). **Strict turn-count
                         guard:** `parseCleanupResponse` requires the returned `turns` array to have
                         EXACTLY the same length as what was sent; a mismatch (merged/dropped lines) is
                         treated as a parse failure and the pass is a no-op, same graceful-degradation
                         contract as speaker naming. The flat `inbound_leads.transcription` text is then
                         rebuilt from the final turns via NEW `turnsToFlatText()` (deepgram.js) instead
                         of staying frozen at Deepgram's raw "Speaker 1/2" output — so it now matches
                         the named + cleaned turns too. Adds one more Claude Haiku call per
                         transcription (now up to 2 total: naming/resegment, then clean+summarize) —
                         same cheap/fast model, same `ANTHROPIC_API_KEY`.
```

**Frontend — the real CRM shell** (`src/components/CrmLayout.jsx`, replacing Phase 0's bare
`<Outlet/>`): a `.crm-shell` wrapper scoping its own `--crm-*` design tokens (dark sidebar, Public
Sans font loaded in `index.html`) — deliberately its own visual identity, not UPR's Inter-based
look, mirroring how `.tech-layout` scopes `--tech-*` tokens. A left sidebar (desktop ≥1024px; a
horizontal scrollable strip below that) lists Overview, Leads, Call Log, Tasks, Attribution,
Reports, Integrations, Settings — icons in the new `src/lib/crmIcons.jsx` (kept separate from
`src/lib/navItems.jsx` because a couple of names, e.g. `IconLeads`, would otherwise collide with
unrelated existing icons there). `/crm/roadmap` (Phase 0) is intentionally NOT one of these sidebar
items — it stays in the main app's visual style as a separate build/ops page, linked from the CRM
sidebar's footer instead of taking a nav slot; `/crm` now redirects to `overview` (was `roadmap`).
`/crm/roadmap` also gained a page-local dark mode (defaults on, toggle button in the page header) —
a `.crm-roadmap-page.dark` wrapper re-points the same `--bg-*`/`--text-*`/`--border-*`/
`--accent-light` custom properties `.page`/`.card`/`.status-badge` already read, same scoped-
token-override trick as `.tech-layout`/`.crm-shell`. Plain component state, not `localStorage` (per
the app's no-localStorage-for-state rule) — resets to dark on reload rather than persisting.

**Top-nav placement**: the `crm` nav entry moved from `OVERFLOW_ITEMS` (the "..." drawer) to
`PRIMARY_ITEMS` in `src/lib/navItems.jsx` — it now renders directly in the always-visible desktop
top bar, not buried behind the menu. Visibility is unchanged: still gated by `isItemVisible()`'s
`featureFlag: 'page:crm'` check, so it only appears for whoever the flag's `dev_only_user_id`
resolves to (Moroni) — every other employee's top bar still shows exactly the original 7 items.
The legacy `NAV_ITEMS` sidebar entry's path was also updated to `/crm/overview` (was `/crm/roadmap`)
to match the new default landing page.

Only two sidebar pages have real data this phase (`src/pages/crm/`):
- **CrmCallLog.jsx** (`/crm/call-log`) — lists `inbound_leads` (embeds `contacts` via the
  `contact_id` FK), newest first; inline `<select>` to change `lead_status` (calls
  `update_lead_status`); recording link + transcript shown when present.
- **CrmIntegrations.jsx** (`/crm/integrations`) — a card per provider: CallRail (paste-API-key
  form when disconnected, or a status + inline two-click "Disconnect" confirm when connected —
  calls `/api/callrail-connect` POST/DELETE), plus **Google Ads and Meta Ads (Phase 2, shipped
  this session)** — a shared `OAuthProviderCard` component: "Connect"/"Reconnect" redirects to
  `/api/google-ads-connect` or `/api/meta-ads-connect` (GET → `{url}` → `window.location.href`,
  same pattern DevTools' QuickBooks card uses), lands back on `/crm/integrations?google_ads=` /
  `?meta_ads=connected|error|badstate` which the page toasts and clears from the URL. Two-click
  "Disconnect" via the same connect workers' DELETE. None of the three cards ever writes
  `integration_credentials` directly from the frontend (no anon/authenticated RLS policy —
  service-role only, same as QBO); status reads go through the read-only `get_integration_status`
  RPC for all three providers.

Only `CrmTasks.jsx` still renders the shared `CrmStubPage.jsx` ("Coming in Phase 4d") until its
phase ships. `CrmLeads.jsx` and `CrmSettings.jsx` shipped real screens in **Phase 4a**;
`CrmOverview.jsx`, `CrmAttribution.jsx`, and `CrmReports.jsx` shipped in **Phase 3** — see those
sections below.

**Test-first**:
- `functions/lib/callrail.test.js` — vitest unit test for `shouldCreateContact({spam_flag,
  duration_sec})` (test target "c"), committed before `functions/lib/callrail.js` existed.
- `supabase/tests/crm_phase1_callrail.test.js` — integration test (same pattern as Phase 0's) for
  `upsert_lead_from_callrail` idempotency (test target "b"): a redelivered "recording ready" webhook
  updates the same row instead of duplicating it, preserving fields the second payload didn't
  include; plus an integration assertion that a spam/sub-15-second call never creates a contact.
  Self-skips via `describe.skipIf` without `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` (matches
  CI). **Same known sandbox limitation as Phase 0**: this session's network egress doesn't allow-list
  the Supabase host, so the committed test couldn't run live here either — the identical scenario
  (create → redeliver with new fields → assert one row + merged fields; spam call → assert no
  contact) was instead run for real against the live shared database via the Supabase MCP
  `execute_sql` tool, passed, and the manually-inserted rows were deleted afterward.

**Acceptance criteria status (docs/crm-roadmap.md "Phase 1 — verification & acceptance")**: the
RPC-level criteria (idempotent upsert, spam filter, `system_events`/`worker_runs` logging, API key
read from `integration_credentials` not a hardcoded secret) are verified live per above. **Not
verified from this sandbox** — needs Moroni, post-merge: a real call/form through an actual CallRail
account and dedicated dev tracking number (this session has no CallRail account access), the
backfill's row count against CallRail's own dashboard, and the visual check of Call Log +
Integrations against the original Stitch handoff mockup (not present in the repo — it was reviewed
in an earlier session's chat, not committed as an asset) on the branch's Cloudflare preview. The
CallRail webhook auth mechanism and payload field names are also placeholders pending confirmation
against CallRail's real dashboard/docs (see the workers' NOTES above) — the two "open items to
confirm before Phase 1 starts" from the roadmap were not resolvable in this session either, for the
same reason.

**Independent review**: `upr-pattern-checker` found 5 hardcoded-hex CSS violations outside the
`.crm-shell` token block and one two-click-confirm missing its `onBlur` cancel — all fixed (see git
history). `crm-phase-reviewer` (Opus) then graded the phase DO-NOT-SHIP-YET pending three fixable
items, all addressed before this PR: (1) the Integrations page's file header claimed it showed the
webhook URL/secret but didn't — `callrail-connect.js` gained a `GET` endpoint and the page now
displays it; (2) the backfill worker's calls-only scope vs. the roadmap's "calls + form leads" spec
was silently narrowed in this doc rather than disclosed — fixed above; (3) phase/stage status was
undocumented — fixed by this paragraph and the dogfooding note below. The remaining open acceptance
criteria (real call/form, backfill count, visual check, webhook auth confirmation) were confirmed by
the reviewer as legitimately blocked by this session's no-CallRail-account/no-Supabase-egress
limits, not silent gaps.

**Dogfooding**: 4 of 8 `crm_build_stages` rows are marked `done` as of this session's close-out
(test-first, `npm test`/`build`/`eslint`, `upr-pattern-checker`+`crm-phase-reviewer` sign-off,
this doc update) via `set_crm_stage_status`; `crm_build_phases('1')` is `in_progress`, not yet
`shipped` — same honest pattern as Phase 0. The remaining 4 stages (full acceptance criteria, the
visual check, marking `shipped`, and the `dev → main` PR) need a real CallRail account and a
logged-in Moroni session this sandbox doesn't have. Flip them via
`set_crm_stage_status`/`set_crm_phase_status('1', 'shipped')` once confirmed on the pushed branch's
Cloudflare preview and a real CallRail connection.

**Phase 1 close-out (Roadmap v3, Wave 0, Session A — 2026-07-02)**: Phase 1's core build (above)
had already merged to `dev`/`main` in earlier sessions (PR #189 + follow-ups through #223) with a
real, live CallRail connection — the "needs Moroni / no CallRail account" caveats in the two
paragraphs above are now resolved: 59 real call rows are live in `inbound_leads`, correctly linking
to existing contacts by `caller_number` and never auto-creating one (intake rule changed post-spec,
see below), webhook auth + payload shape are confirmed against real deliveries (not placeholders —
`functions/lib/callrail.test.js` pins an actual captured payload), the CallRail API key reads from
`integration_credentials` not a hardcoded secret, and every lead/run writes `system_events`/
`worker_runs`. The backfill (30-day default window) processed 57 records against CallRail's own
54-in-window count — within tolerance. This close-out session:
- Confirmed a **business-rule change since the original spec**: `upsert_lead_from_callrail` no
  longer auto-creates a contact at all (migration `20260701_crm_lead_no_autocreate_contact.sql`,
  commit `1494542`) — it only LINKS to an existing contact by phone; a contact is created only via
  the new `promote_lead_to_contact` RPC ("+ Add as customer" on the Leads board) or normal booking
  flows. This retires the original `shouldCreateContact({spam_flag, duration_sec})` predicate and
  its vitest unit test (removed in the same commit) — moot, not skipped, since no call can ever
  auto-create a contact now regardless of spam/duration. The roadmap's test-target "(c)" and the
  Phase 1 branch checklist's item (b)+(c) title are stale references to this retired function; the
  integration test in `supabase/tests/crm_phase1_callrail.test.js` was rewritten for the new
  behavior and still covers the intent (unknown number → no contact).
- **Form-capture stage stays open, disclosed, not closed as done or as superseded.** No owner
  decision on the CallRail-Form-Tracking-vs-Phase-10 fork was recorded in `docs/crm-roadmap.md`'s
  dispatch section, so the roadmap's default-if-undecided rule applies ("verify the CallRail form
  path anyway"). Checked live via the CallRail MCP tools: `callrail_list_form_submissions` returns
  **0 records** across the full ~2-year retention window, and `inbound_leads` has **0**
  `source_type='form'` rows — a real fixture is genuinely unobtainable without the owner (either a
  live test form submission, or an owner decision to supersede this stage per Phase 10). `mapFormPayload`
  in `functions/lib/callrail.js` therefore remains **untested guesswork** (only `mapCallPayload` is
  pinned to a real captured fixture) — a live form submission through the site today would run through
  unverified field-name mapping. `crm_build_stages` sort_order 8 stays `todo` with this disclosure.
- **Visual check vs. the Stitch handoff** also stays open/owner-gated — the mockup isn't a repo asset
  and can't be verified from this sandbox.
- Fixed 2 new hardcoded-hex CSS violations `upr-pattern-checker` found in the `.crm-shell` token
  block (`.crm-timeline-badge[data-type="sms"]` and `.crm-badge-won`, both duplicating
  `--crm-success-bg`'s `#ecfdf5` instead of referencing it) — now tokenized.
- `crm-phase-reviewer` (Sonnet, this session) independently verified the above against the live
  files/migrations (not just the summary) and recommended **SHIP** — call-side ingestion,
  idempotency, logging, and credential handling all pass with real evidence; the two open items are
  genuinely owner-gated. Flagged one non-blocking, latent issue: `20260701_crm_lead_no_autocreate_contact.sql`
  sorts lexically *before* `20260701_crm_phase1_shell_callrail.sql` (`l` &lt; `p`), but functionally
  depends on it (references the `inbound_leads` type the phase-1 migration creates). The live DB is
  correct (migrations were applied via MCP in chronological order, not filename order), but a clean
  rebuild via `supabase db push`/reset would resolve migrations by filename and could apply them out
  of order. Not fixed in this session — renaming an already-applied migration file risks desyncing
  Supabase's migration-history tracking against the shared `dev`/`main` project; left as a disclosed
  follow-up rather than a live risky rename.
- Reconciled `crm_build_stages` (phase_key='1'): flipped sort_order 6 ("set phase-1 shipped; delete
  test rows") and 7 ("pushed to dev, verified, dev → main PR opened") from `todo` to `done` — both
  had genuinely already happened (PR #189 merged; Phases 2/3/4a/4c already shipped on top of Phase 1)
  but were never flipped, under-reporting progress. No test rows tagged with a dev tracking number
  were found to delete (`inbound_leads` has zero `callrail_id LIKE 'test-%'` rows). Form-capture
  (sort_order 8) and the visual check (sort_order 4) stay `todo`, disclosed above. `crm_build_phases('1')`
  set to **`shipped`** — all non-owner-gated acceptance criteria pass.

### Phase 2 — Ad spend ingestion (Google Ads + Meta Ads)

**New table** `ad_spend` (`supabase/migrations/20260701_crm_phase2_adspend.sql`, applied to the
live shared dev/main Supabase project) — `id, org_id (FK crm_orgs), platform ('google'|'meta'),
campaign_id, campaign_name, date, spend, impressions, clicks, platform_conversions, created_at,
updated_at`, `UNIQUE(platform, campaign_id, date)`. `platform_conversions` is deliberately
informational-only (Google/Meta's own conversion counts never reconcile with CallRail's) —
**CallRail leads + won jobs in UPR remain the funnel's one source of truth**; ad platforms only
ever supply spend dollars. RLS enabled + explicit `FOR ALL` policy at creation.

**RPCs** (both `SECURITY DEFINER`, granted `anon, authenticated`):
- `upsert_ad_spend(p_platform, p_campaign_id, p_campaign_name, p_date, p_spend, p_impressions,
  p_clicks, p_platform_conversions, p_org_id)` — true upsert on `(platform, campaign_id, date)`;
  `spend`/`impressions`/`clicks`/`platform_conversions` overwrite on conflict (not additive) so a
  same-day re-pull corrects that day's revised numbers in place. Defaults `org_id` to the real
  (non-test) org, same pattern as `upsert_lead_from_callrail`. **Idempotency verified live** via
  Supabase MCP: two calls for the same platform/campaign/date left exactly one row with the
  second call's values; the manually-inserted test row (`campaign_id='TESTCMP001'`) was deleted
  afterward.
- `get_ad_spend(p_platform, p_start_date, p_end_date)` — read helper for verification now and the
  Phase 3 dashboard later.

**Workers**:
```
functions/lib/date-mt.js      — mountainYesterday(nowUtc) / isStale(lastUtc, nowUtc, days), pure,
                                 America/Denver (DST-aware via Intl) calendar-day math — the one
                                 place the roadmap's "pick one timezone convention" rule lives.
                                 Test-first: functions/lib/date-mt.test.js, 7 vitest unit tests
                                 (MDT/MST DST boundaries + a UTC-midnight-that-isn't-an-MT-boundary
                                 case), committed failing before the implementation existed.
functions/lib/google-ads.js   — Google OAuth (buildAuthorizeUrl/exchangeCodeForTokens/
                                 refreshTokens/saveTokens/getValidAccessToken, mirrors
                                 quickbooks.js) + fetchCampaignSpend() via GAQL searchStream.
                                 SEPARATE OAuth app from google-drive.js's per-user Drive/Calendar
                                 app on purpose — its own env vars (GOOGLE_ADS_CLIENT_ID/SECRET/
                                 REDIRECT_URI/DEVELOPER_TOKEN/CUSTOMER_ID, optional
                                 GOOGLE_ADS_LOGIN_CUSTOMER_ID for MCC) — one company-wide
                                 integration_credentials row, not per-employee.
functions/lib/meta-ads.js     — Meta/Facebook OAuth (no classic refresh_token grant — a short-lived
                                 code-exchange token is exchanged for a ~60-day long-lived token;
                                 getValidAccessToken re-exchanges the current long-lived token when
                                 within 5 days of expiry) + fetchCampaignSpend() via Graph API
                                 Insights (paginated, MAX_PAGES=50 cap). Env vars: META_APP_ID/
                                 APP_SECRET/REDIRECT_URI/AD_ACCOUNT_ID.
google-ads-connect.js         — GET (authenticated, returns {url} for window.location.href) /
google-ads-callback.js          DELETE (disconnect), mirrors quickbooks-connect.js/
                                 quickbooks-callback.js exactly. Callback redirects to
                                 /crm/integrations?google_ads=connected|error|badstate.
meta-ads-connect.js /         — same shape as the Google Ads pair; callback exchanges the OAuth
meta-ads-callback.js            code for a short-lived token then immediately for a long-lived one
                                 before saving. Redirects to /crm/integrations?meta_ads=...
sync-google-ads.js /          — GET/POST (authenticated, manual trigger) + `scheduled()` export for
sync-meta-ads.js                Cloudflare's dashboard-configured daily Cron Trigger (no
                                 wrangler.toml in this repo, per CLAUDE.md). Default run pulls ONE
                                 day — mountainYesterday(now) — via fetchCampaignSpend(), upserts
                                 each campaign/day through upsert_ad_spend. `{ backfill: true,
                                 days }` (default 365, capped at 400 — MAX_BACKFILL_DAYS) pulls a
                                 historical range. Per-row upsert failures don't abort the run
                                 (mirrors callrail-backfill.js); every invocation logs a
                                 worker_runs row (worker_name 'sync-google-ads'/'sync-meta-ads').
```

**Frontend**: `CrmIntegrations.jsx` gained real Google Ads / Meta Ads cards (`OAuthProviderCard`,
shared by both providers) replacing Phase 1's "Coming in Phase 2" placeholders — see the Phase 1
Integrations entry above for the full connect/disconnect flow. New `--crm-integration-google`
(`#4285f4`) / `--crm-integration-meta` (`#0866ff`) tokens in the `.crm-shell` block.

**DISCLOSED GAP, NOT AN OVERSIGHT — needs human verification before the first real cron run**:
the exact Google Ads API (GAQL `searchStream`, pinned at `v18`) and Meta Graph API (Insights,
pinned at `v19.0`) request/response field shapes are best-effort, written from public API docs,
**not exercised against a live developer-token account in this session** — same disclosed-gap
pattern Phase 1 used for CallRail's webhook payload shapes. This is downstream of the roadmap's
own Phase 2 prerequisite ("Google Ads developer token approved") being an external, days-to-weeks
Google approval process with no tool available in this environment to check or complete it.
Nothing runs until a human connects real credentials via the Integrations page — confirm the API
shapes against a live account at that point, per each file's NOTES section
(`functions/lib/google-ads.js`, `functions/lib/meta-ads.js`).

**Test-first**: `functions/lib/date-mt.test.js` (7 tests) committed at `597772e` before
`functions/lib/date-mt.js` existed — confirmed genuinely failing at that commit (import error),
then passing once the implementation landed at `fcc6b42`.

**`npm run test` + `npm run build` + `npx eslint`**: all green on every changed file.

**Independent review**: `upr-pattern-checker` found one hardcoded inline `style={{ gap: 8 }}` in
`CrmIntegrations.jsx` where `--space-2` already existed as the matching token — fixed (now
`.crm-integration-actions-row`). `crm-phase-reviewer` (Opus) graded every acceptance criterion
PASS except this doc update (fixed by this paragraph) and two live-only unverifiable items (the
`crm_build_phases`/test-row state, confirmed below; the backfill-vs-platform-dashboard tolerance
check, which needs a live connected account) — recommendation **SHIP into `dev`** (not `main` —
invisible behind `page:crm`/`dev_only_user_id` either way). Full verdict in this session's
transcript.

**Dogfooding**: all 8 `crm_build_stages` rows for phase-2 are marked `done` via
`set_crm_stage_status` (test-first, acceptance criteria met in-session, test/build/eslint green,
both review agents passed, this doc update, `crm_build_phases('2')` set to `shipped`, test
`ad_spend` row deleted) — except the branch-push/PR stage, flipped once the PR is actually opened.
The GAQL/Insights live-account verification called out above is an operational follow-up for
Moroni post-merge, not a build-completion blocker (same treatment Phase 1 gave its
CallRail-account-dependent items).

### Phase 3 — Attribution + funnel dashboard

**Design record**: `docs/crm-phase3-attribution-model.md` (Opus-High pass, written before any metric
code per the roadmap's model note). Locks in: **last-touch, single-touch** attribution for v1 (every
touch stored so first-touch/weighted is a future re-aggregation, not a schema change); **UPR's
won-job + QBO `jobs.invoiced_value` is the single source of truth for conversions + revenue**;
CallRail's "converted" flag and `ad_spend.platform_conversions` are informational-only, never in the
ROAS/cost math; zero-spend channels render `—`, not `0`.

**New table** `lead_attribution` (`supabase/migrations/20260701_crm_phase3_attribution.sql`, applied
live to the shared dev/main Supabase) — `id, org_id (FK crm_orgs), lead_id (FK inbound_leads, ON
DELETE CASCADE), contact_id (FK contacts, ON DELETE CASCADE), channel (CHECK IN
google_ads|meta_ads|organic|referral|insurance|other), source, campaign, referral_source_id (FK
referral_sources), occurred_at, created_by, created_at, updated_at`. One row per attribution TOUCH;
last-touch is computed at query time by `MAX(occurred_at)` so position never goes stale. RLS enabled
+ explicit `FOR ALL` policy at creation; writes via the `upsert_lead_attribution` RPC. Additive-only
— no existing table altered.

**RPCs** (all `SECURITY DEFINER`, granted `anon, authenticated`):
- `crm_channel_for_source(p_source text) → text` — normalizes a raw source string to a canonical
  channel. Data-driven: keyword rules (ordered so organic-Google — My Business/SEO — is matched
  before paid-Google — Ads/LSA), then a `referral_sources.category` fallback (insurance→insurance,
  personal/trade/program/real_estate/emergency→referral, digital→organic, traditional/other→other).
  Verified live against 23 sample strings incl. the paid-vs-organic Google split.
- `get_attribution_rollup(p_start_date, p_end_date, p_org_id) → TABLE(channel, spend, leads,
  estimates, won_jobs, revenue)` — the per-channel funnel aggregate; always returns all six channels
  (VALUES list) so zero-spend rows never disappear. Raw counts/sums ONLY — the derived money math
  lives in the unit-tested `src/lib/attribution.js`, never in SQL. Leads counted per lead (CallRail =
  truth); estimates (`status <> 'draft'`), won jobs (`phase <> 'lead' AND status <> 'deleted'`) and
  revenue (`SUM(jobs.invoiced_value)`) counted per contact's last-touch channel with `COUNT(DISTINCT
  job.id)` guarding the contact→jobs fan-out; anything unresolvable folds into `other`. **Verified
  live**: the job/revenue aggregation matched an independent hand-recompute exactly (other 95 jobs /
  $300,975, insurance 2 / $1,250, google_ads 2 / $0, organic 2 / $0, referral 1 / $0 — 102 jobs /
  $302,225 total), and the spend/ROAS/cost-per-job path was verified with disposable TEST-org
  `ad_spend` rows (google $1000 / meta $500) then cleaned up (`ad_spend` back to 0 rows).
- `get_attribution_by_campaign(p_start_date, p_end_date, p_org_id) → TABLE(channel, platform,
  campaign_id, campaign_name, spend, leads)` — paid-campaign detail (Google Ads split by agency,
  encoded in `campaign_name`), leads matched by `inbound_leads.campaign = ad_spend.campaign_name`.
- `get_crm_revenue_by_division(p_start_date, p_end_date) → TABLE(division, won_jobs, revenue)` —
  Reports' won-revenue-by-division. **Namespaced `get_crm_*`** to avoid colliding with the
  pre-existing `get_revenue_by_division(date,date) → jsonb` (a different, unrelated function — the
  first migration attempt failed on this and was corrected).
- `upsert_lead_attribution(p_channel, p_source, p_campaign, p_lead_id, p_contact_id,
  p_referral_source_id, p_occurred_at, p_created_by, p_org_id) → lead_attribution` — the RPC write
  path (manual entry / enrichment); validates channel, requires a lead_id or contact_id, logs a
  `system_events` `crm_lead_attributed` row. Not wired to UI this phase (dashboards are read-only).

**Money math** — `src/lib/attribution.js` (pure, importable, unit-tested): `costPerLead(spend,leads)`
(null if spend≤0 or leads≤0), `roas(revenue,spend)` (null ONLY if spend≤0 — a real $0 revenue on
real spend is a legitimate 0.0×), `costPerJob(spend,jobs)`, `conversionRate(num,denom)` (null only on
zero denom — a 0 numerator over a positive denom is a real 0%), `deriveChannelMetrics(row)`,
`rollupTotals(rows)` (blended efficiency computed on PAID channels only so ads aren't credited with
organic revenue), `funnelStages(counts)`, and `fmtMoney/fmtRatio/fmtPct` (null → `—`, real 0 →
`$0`/`0.0×`/`0%`). **Test-first**: `src/lib/attribution.test.js` (40 units, every expected value
hand-computed) committed failing before the module existed, then green.

**Frontend** (fill the three CRM-shell stub pages, `.crm-*` design system):
- **CrmOverview.jsx** (`/crm/overview`) — KPI cards (spend/leads/estimates/won/revenue/ROAS) + the
  Leads→Estimates→Won funnel (bars scale to the largest stage so they stay readable before CallRail
  leads accumulate). **Enriched 2026-07-21 (dashboard-gap initiative — see the dated entry below).**
- **CrmAttribution.jsx** (`/crm/attribution`) — per-channel table (Spend, Leads, Cost/lead,
  Estimates, Won, Cost/job, Revenue, ROAS; zero-spend rows show `—`) + Google Ads by campaign/agency.
- **CrmReports.jsx** (`/crm/reports`) — Source ROI, Won revenue by division, funnel conversion.
- **attributionParts.jsx** (components) + **attributionData.js** (helpers: `CHANNEL_LABELS`, `RANGES`,
  `rangeToDates`, `toNumberRow`, `deriveRows`) — split into two files so the `react-refresh` lint rule
  stays clean. New `--crm-*` scoped CSS block (metric cards, funnel, range picker, table,
  `--crm-channel-insurance` token). No `App.jsx` change — routes already existed from Phase 1.

**`npm run test` (80 pass / 9 skip) + `npm run build` + `npx eslint` (changed files)**: all green.

**Independent review**: `upr-pattern-checker` found one raw hex (`#d97706`) where a `--crm-*` token
should exist — fixed (`--crm-channel-insurance` token) — plus a cosmetic `get_funnel_overview`
comment/doc drift (the RPC shipped as `get_attribution_rollup`) — fixed. `crm-phase-reviewer` (Opus,
weighted on the attribution math) graded the pure money-math module (`attribution.js`) clean —
test-first ordering independently reproduced, every null/zero/div-by-zero boundary and the paid-only
blended ROAS hand-checked — and returned three actionable items, all resolved:
1. **Estimate filter** — flagged `e.status <> 'draft'` as dropping NULL-status rows via SQL
   three-valued logic. **Verified live the premise doesn't hold** (`estimates.status` is NOT NULL;
   0 nulls, 0 drafts; rollup estimates = 34 = all), so there was no undercount — but hardened to the
   null-safe `e.status IS DISTINCT FROM 'draft'` (codebase convention) anyway; totals unchanged.
2. **Google paid/organic keywords** — "Google Business Profile" (GMB's rename) and spelled-out
   "Local Services Ads" weren't covered. Added `%business profile%` → organic and `%local service%`
   → google_ads; re-verified live (both now classify correctly, existing 23 samples unchanged). The
   actual `referral_sources`/`contacts.referral_source` values in the DB already classified correctly.
3. **Doc update** — this section + the stub-description fix above.
The reviewer also noted the by-design last-touch asymmetry (leads counted by the lead's own source,
downstream conversions by the contact's last-touch channel) — disclosed on the Attribution page and
in the design doc, not a blocker for last-touch v1.

**Owner-gated verification**: `page:crm` is `enabled=false` with a `dev_only_user_id` gate, so
`/crm/*` is invisible to any non-Moroni session — the branch preview **builds** green (same Vite
build as local), but the behind-auth screenshot of the Attribution/Overview/Reports screens vs the
handoff requires Moroni's own session (same owner-gated treatment Phase 1/2 used for
account-dependent checks). `ad_spend` is still empty pending the Google Ads token, so paid-channel
cost/ROAS cells legitimately render `—` until the first sync runs.

**Dogfooding**: phase-3 `crm_build_stages` reconciled honestly and `crm_build_phases('3')` set to
`shipped` via the status RPCs (see the close-out reconciliation in this session).

### Phase 4a — Lead pipeline

Built directly off the Phase 1 shell (its only hard dependency, per the roadmap's own escape
hatch) rather than waiting on Phase 3, which was being built in a separate, parallel session at
the same time — no file overlap: this phase owns the Leads board, the contact activity timeline,
and pipeline-stage Settings CRUD; Phase 3 owns Attribution/Overview/Reports.

**New tables** (`supabase/migrations/20260701_crm_phase4a_lead_pipeline.sql`, applied to the live
shared dev/main Supabase project):
- **`pipeline_stages`** — `id, org_id (FK crm_orgs), name, sort_order, color, is_won, is_lost,
  created_at, updated_at`. Replaces the hardcoded New/Contacted/Qualified/Estimate Sent/Won/Lost
  enum that used to live only as `inbound_leads.lead_status` text + `CrmCallLog.jsx`'s
  `STATUS_OPTIONS` array — now a real, admin-editable table. Seeded with that same six-stage
  default set for both the real org and the disposable "Utah Pros — TEST" org. RLS enabled +
  explicit `FOR ALL` policy at creation.
- **`lead_pipeline_stage`** — `id, lead_id (FK inbound_leads, UNIQUE), org_id (FK crm_orgs),
  stage_id (FK pipeline_stages), moved_by (FK employees), created_at, updated_at`. Tracks each
  lead's current stage as its own table rather than a column added to `inbound_leads` — keeps this
  phase's migration to brand-new tables only, with zero touch to a table a prior phase introduced.
  A lead with no row here reads as sitting in the first stage (lowest `sort_order`) — both the
  frontend (`src/lib/crmPipeline.js`'s `groupLeadsByStage()`) and nothing server-side enforce this;
  it's a read-time fallback, not a DB default. RLS enabled + explicit policy at creation.

**Milestone auto-advance (2026-07-21, `20260721_crm_pipeline_auto_advance.sql`, owner-directed):** four
`AFTER` triggers push a contact's open (non-Won) leads forward without staff dragging a card — a signed
`work_auth` `sign_requests` row, a real `invoices` row created with `total > 0`, an invoice's
`amount_paid` going from 0 to positive (payment received), and an `estimates.status` transition to
`'submitted'` (this schema's closest equivalent of "sent" — there is no literal `sent` value in its
CHECK constraint). The first three move every open lead for that contact to **Won**; the fourth to
**Estimate Sent**. Shared helper `crm_auto_advance_leads(p_contact_id, p_stage_name)` — SECURITY DEFINER,
calls the frozen `move_lead_to_stage` RPC, never passes a reason into its `p_lost_reason` (these triggers
only move leads forward, never to Lost) — guards against ever pulling an already-`is_won` lead backward
(checked via `pipeline_stages.is_won`, not a hardcoded stage name) and against redundant same-stage
moves. Each of the 4 trigger functions (`crm_trg_sign_request_signed`/`crm_trg_invoice_created`/
`crm_trg_invoice_paid`/`crm_trg_estimate_submitted`) wraps its call in `BEGIN...EXCEPTION WHEN OTHERS`
and logs a `crm_auto_advance_failed` `system_events` row on failure instead of propagating — pipeline
bookkeeping must never roll back the real invoice/payment/signature write it's piggybacking on
(migration-safety-checker caught the unguarded version pre-ship). Verified live with real fixtures for
all four triggers + the no-downgrade guard; test: `supabase/tests/crm_pipeline_auto_advance.test.js`.

**New stage + AI-driven auto-advance (2026-07-21, `20260721_crm_inspection_scheduled_stage.sql`,
owner-directed):** added an **"Inspection Scheduled"** `pipeline_stages` row for both orgs, sitting
between Qualified and Estimate Sent (real org sort_order 4; test org 3 — Estimate Sent/Won/Lost each
renumbered +1 in both; no lead's stage *assignment* changed, only the column's display position). The
AI call-cleanup pass (`functions/api/transcribe-call.js`'s `cleanAndSummarize`, same Claude Haiku call
that already rewrites the summary) now also asks whether a real inspection/appointment was agreed to on
the call, returning `inspection_scheduled: true|false` in its JSON (parsed leniently — anything but a
literal `true` is `false`, never a parse failure; stored on `transcript_analysis.inspection_scheduled`
via `callCleanup.js`'s `parseCleanupResponse`/`applyCleanup`). When `true`, `transcribeLead()`
best-effort calls the new **`crm_advance_lead_if_forward(p_lead_id, p_stage_name)`** RPC (`SECURITY
DEFINER`, `authenticated, service_role` only). Unlike `crm_auto_advance_leads` (contact-wide, for real
business-document events), this one is **lead-scoped** — the AI signal is about ONE call, so it only
ever acts on that call's own `inbound_leads` row, never sibling leads for the same contact — and
**sort_order-aware**: it looks up the lead's current stage's `sort_order` and the target stage's
`sort_order` and no-ops if the target isn't strictly forward, plus the usual guards (unknown lead,
spam-flagged, terminal Won/Lost, stage doesn't exist for the org, already there). Any RPC failure is
caught and logged, never blocking the transcription write (same "bookkeeping never blocks the real
write" contract as the milestone triggers). Verified live against the TEST org across all 5 scenarios
(new lead advances; already-Estimate-Sent/Won/Lost never move backward or off a terminal stage;
spam-flagged never moves) — the local anon-role test environment can't run
`supabase/tests/crm_inspection_scheduled.test.js`'s live assertions (an unrelated anon-closure hardening
from a separate initiative removed anon read access to `crm_orgs`), so this was verified via direct
SQL fixtures instead, same as the milestone triggers were originally.

**Two more AI call-cleanup signals (2026-07-21, `20260721_crm_call_ai_enrichment.sql`,
owner-directed):** the same `cleanAndSummarize` Claude Haiku call was extended with two more JSON
fields. **`caller_never_responded: true|false`** — true only when the agent/company turn(s) have real
content and the customer turn(s) are empty/pure silence (never for a customer who spoke but the call was
just short/unhelpful/wrong-number). When true, `transcribeLead()` best-effort calls the new
**`set_lead_spam_flag(p_lead_id, p_spam, p_reason)`** RPC — reliably, automatically removes a
answered-but-silent call from the pipeline instead of relying on a human to notice it (a no-op write,
i.e. the value already matches, skips the `system_events` insert so a re-run never double-logs).
**`customer_email`/`customer_address: <value or null>`** — extracted ONLY when the customer clearly
stated it themselves (never inferred); `callCleanup.js`'s `parseCleanupResponse` additionally rejects
anything that doesn't look like a real email (basic shape check) before it can reach a contact record.
When present, best-effort calls the new **`set_lead_contact_details(p_lead_id, p_email, p_address)`**
RPC, which mirrors `set_lead_caller_name`'s exact "fill only if blank" contract — **and only ever acts
on an already-linked contact** (`inbound_leads` has no email/address column of its own; an unlinked
lead silently no-ops rather than ever auto-creating a contact from unverified AI-extracted data).
`customer_address` maps to `contacts.billing_address` (the only free-text street-address field on that
table). All three new signals are wrapped in the same best-effort try/catch as `inspection_scheduled` —
none of them can ever block the transcription write. Verified live against the TEST org (spam-flag set +
no duplicate audit row on a repeat no-op call + throws on an unknown lead; contact-details fill on a
blank field + never overwrites an existing value + never creates a contact for an unlinked lead) — same
local anon-role limitation as above, verified via direct SQL fixtures;
test: `supabase/tests/crm_call_ai_enrichment.test.js`.

**Reclassify-only backfill mode** (`POST /api/transcribe-call` with
`{ reclassify: true, days?: 90, force?: false }`): re-runs the AI naming + clean-up/classification passes
(`reclassifyLead()`) against leads that already have a transcript + `transcript_analysis`, with no
Deepgram/CallRail re-transcription and no added Deepgram cost — just fresh Claude Haiku calls against the
already-stored turns. Default selects only leads predating these new signals (`transcript_analysis->>
inspection_scheduled=is.null` reads as SQL NULL for a genuinely-missing key); `force:true` re-processes
every matching call regardless, for a naming-prompt improvement that benefits already-classified leads too.

**Full-name capture (2026-07-21) + a safe caller-name "upgrade" path:** the naming prompts
(`NAMING_SYSTEM` in `transcribe-call.js`, `buildResegmentPrompt` in `speakerNaming.js`) previously asked
for the caller's FIRST name only — owner-reported bug: cards showed only "Silvina"/"Jason" instead of
full names the transcript clearly stated. Both prompts now ask for the full name (first + last) when
stated. But `set_lead_caller_name`'s original contract only ever fills a BLANK name (by design, so an
AI mistake can never clobber a correct name) — meaning a lead already named "Silvina" from before this
fix would stay stuck there. `20260721_crm_caller_name_upgrade.sql` adds an opt-in third parameter,
`p_allow_upgrade boolean DEFAULT false` (old 2-arg callers unaffected — the migration `DROP`s the old
2-arg overload first so PostgREST/Postgres can't resolve a 2-arg call ambiguously against both): when
`true`, it replaces an existing name ONLY when the new name strictly extends the old one with a word
boundary ("Silvina" → "Silvina Wright" — yes; "Silvina" → "Robert" — never), checked via plain
`left()`/`btrim()` string comparison rather than `LIKE`, so a caller_name containing a literal `%`/`_`
from a garbled transcript can never turn into an unintended wildcard match (a `migration-safety-checker`
finding, fixed before shipping). `reclassifyLead()` now re-runs naming (`nameSpeakers`/
`resegmentSpeakers`, same logic `transcribeLead()` uses) before clean-up, and calls
`set_lead_caller_name(..., p_allow_upgrade: true)` — the only caller allowed to request the upgrade path.
Verified live against the TEST org (2-arg shape still fill-only-never-overwrite; upgrade rejects an
unrelated name; upgrade accepts a genuine extension on both the lead and its linked contact; a literal
`%`/`_` in a name is treated as plain text) — test: `supabase/tests/crm_caller_name_upgrade.test.js`.

**Leads board display fix (2026-07-21):** `CrmLeads.jsx`'s `leadLabel()` only ever checked
`lead.contact?.name`, falling straight through to the phone number — it never checked
`inbound_leads.caller_name` (set directly on the lead by the AI naming step the moment a call states the
caller's name, even before any contact link exists). Fixed to fall back to `lead.caller_name` before the
phone number, in both the board card title and the two equivalent checks in the lead detail panel
header. This was a pure frontend display bug — `caller_name` itself was already being captured
correctly by the existing `nameSpeakers()` step.

**Full-name capture — the real fix (2026-07-21):** the `p_allow_upgrade` change above didn't actually
fix full names on a reclassify pass — root cause: `nameSpeakers()` re-labels turns by asking Claude to
identify speakers, but when a turn is ALREADY labeled with a real name (not a generic "Speaker 1/2"),
the model doesn't reliably re-derive a fuller name from the conversation content; it treats the label as
already-resolved. Confirmed live: a caller who spelled her last name letter-by-letter ("Wright,
W-R-I-G-H-T") still only produced "Silvina" on reclassify. Fix: moved full-name extraction onto the AI
**cleanup** pass instead (`customer_full_name`, a 6th field alongside `customer_email`/
`customer_address`) — the same mechanism that already reliably reads full turn CONTENT rather than
trusting the existing speaker label. `transcribeLead()`/`reclassifyLead()` now prefer
`analysis.customer_full_name` over `nameSpeakers()`'s result, always with `p_allow_upgrade: true`.
Verified live end-to-end against the real production lead that surfaced the bug.

**Reclassify batch convergence fix (2026-07-21):** the bulk reclassify sweep's `force:true` had no
forward-progress guard — every call re-selected ALL matching leads regardless of prior work, and since
Cloudflare's gateway caps a request around ~100s, repeated rounds kept reprocessing the same
`occurred_at DESC` head-of-list leads without ever reaching the rest. Fixed by switching the sentinel to
`customer_full_name` (the newest field this pass writes) — a lead already reprocessed under current code
is skipped on the next round, so a sweep now genuinely converges instead of looping on the same subset.
Also added `{ reclassify: true, lead_id }` single-lead targeting for verifying a prompt change against
one known call without a bulk sweep. **~~Known permanent-error leads: ~37 of the 86 transcribed leads
have zero usable turns... not a bug, nothing to reclassify.~~ — superseded below (2026-07-21): this WAS
a bug, not a dead end — see "Zero-turn call classification gap".**

**Zero-turn call classification gap (2026-07-21):** the ~37 leads noted above as a permanent dead end
were in fact never being classified at all. Root cause: `buildCleanupPrompt(turns)`
(`functions/lib/callCleanup.js`) returns `''` when a call has ZERO usable speaker turns (genuine dead
air, a voicemail hang-up with no message, or a call that cut off before anyone spoke — Deepgram still
returns a raw flat transcript + its own one-line summary for these, just no diarized turns) —
`cleanAndSummarize()` in `transcribe-call.js` then skipped the Claude call entirely on an empty prompt,
so `caller_never_responded`/`is_customer_inquiry`/etc. never got computed and the lead sat in the
pipeline (usually stage "New") looking like a live lead forever with `spam_flag:false`. Live count at
discovery: 37 zero-turn leads, 28 still unflagged. **Deliberately NOT a duration/keyword heuristic** —
verified live that length/keywords don't reliably separate the two cases: a 68-second "voicemail" from
a real customer ("this is Brynn, requesting a mold inspection... left her callback number") is a
genuine lead, while several 20-30 second calls really are dead air with no message. Fixed with a new
pure helper module **`functions/lib/zeroTurnClassifier.js`** (`buildZeroTurnPrompt`/
`parseZeroTurnResponse`, same degrade-safely/lenient-boolean split as `callCleanup.js`) plus
`classifyZeroTurnCall()`/`ZERO_TURN_SYSTEM` in `transcribe-call.js`: when `buildCleanupPrompt` returns
`''`, `cleanAndSummarize()` now falls back to asking Claude Haiku a small separate question against
Deepgram's raw flat transcript + one-line summary (which do exist even with zero diarized turns) —
judging ONLY the actual words present, never call length — and sets `caller_never_responded`
(everything else about the lead was originally left alone, same "leave as whatever it already was"
contract as every other best-effort signal here). A garbled/missing AI answer is a safe no-op (never a
false spam-flag), matching every other pass in this file. Also relaxed `reclassifyLead()`'s guard — it
used to `throw` on any lead with `analysis.turns.length === 0` (the exact leads this fix targets); it
now only throws when there is NEITHER a usable turn NOR any raw transcript/summary text to judge at
all. The existing `{reclassify: true}` sweep already selects these leads without any query change (its
`inspection_scheduled IS NULL` sentinel was never set for them either, same as any never-processed
lead).

**Live backfill (2026-07-21):** discovered live that all 37 zero-turn leads actually carry
`transcript_analysis.model:'claude-agent-inline'`/`speakerMode:'diarized-flat'` — a tag
`transcribe-call.js` never writes — meaning these came from some prior backfill/import process that
already wrote a real flat `transcription` + a rich Deepgram-style summary but left `turns` empty; NOT
literally all Deepgram dead-air (several have full real conversations in the raw text). Ran the
judgment call by hand against the 28 unflagged leads (same read-the-raw-text criteria the classifier
uses) since the deployed worker needs an authenticated employee session token this environment
doesn't have: 8 were genuine dead air/no-message hang-ups (spam-flagged via `set_lead_spam_flag`,
reason `ai_detected_caller_never_responded`), 20 were real content (including the Brynn mold-inspection
voicemail — verified still `spam_flag:false`) and left untouched. Final split: 17 flagged / 20
unflagged of the 37.

**`is_customer_inquiry` follow-up (2026-07-21):** the initial fix left 2 of the 20 remaining
unflagged leads uncaught — a clear wrong-number call and a personal call asking for "Mister Moroni" —
since `caller_never_responded` doesn't fire when the other party spoke. Extended `ZERO_TURN_SYSTEM` +
`parseZeroTurnResponse` to also read `is_customer_inquiry`, same opposite-lenient-direction default
(`true`) as the full cleanup pass's field of the same name — but deliberately conservative: the prompt
only asks for a CLEAR-CUT wrong-number/personal-call case, not the harder vendor/solicitor judgment,
since a zero-turn call's raw text is thinner evidence than a full per-turn transcript. No new call-site
wiring needed — `transcribeLead()`/`reclassifyLead()` already call `set_lead_spam_flag` when
`analysis.is_customer_inquiry === false` (shared with the full cleanup pass), so setting the field on
the zero-turn branch is enough to route through the same existing spam-flagging path.
Test: `functions/lib/zeroTurnClassifier.test.js`.

**Agent/customer role-confusion fix + auto-qualify contact linking (2026-07-21):** two bugs found
reviewing real production data — two leads ~1.5hrs apart from the same caller
(`+16267717702`, 2026-06-26). (1) On the callback, the caller (Jake Nelson) asked "Is this Ben?"
(Ben was the AGENT from the earlier call) and the cleanup pass extracted "Ben" as
`customer_full_name`, flipping agent/customer in the AI summary — `caller_name` itself stayed
correct only because `set_lead_caller_name`'s extend-only upgrade guard happened to refuse the
conflicting overwrite. Fixed at the source: `NAMING_SYSTEM`/`RESEGMENT_SYSTEM`
(`transcribe-call.js`) and `buildResegmentPrompt` (`speakerNaming.js`) now explicitly warn that a
name mentioned while ASKING FOR someone ("Is this X?", "Can I speak to X?") belongs to that other
person, never the asking speaker; `CLEANUP_SYSTEM`'s `customer_full_name` field gets the same
warning. As defense-in-depth, new pure helper **`nameExtendsOrMatches(newName, establishedName)`**
(`functions/lib/callCleanup.js`, mirrors the SQL upgrade-guard's word-boundary-extend check) is
now applied in both `transcribeLead()`/`reclassifyLead()`: a `customer_full_name` that conflicts
with the lead's already-established `caller_name` is nulled out before it's stored, so the panel
never displays (or upgrades the name to) a role-confused guess. (2) A fully-qualified lead (real
first+last name, real phone, `is_customer_inquiry:true`, `service_match:'in_scope'`, not spam) had
no way to get a contact — the existing name/detail-backfill RPCs deliberately never auto-create
one — so a legitimate repeat caller's follow-up call always showed up as a disconnected duplicate
lead instead of linking to the same person. New RPC **`crm_auto_qualify_contact(p_lead_id)`**
(`20260721_crm_auto_qualify_contact.sql`, `SECURITY DEFINER`, `authenticated, service_role` only)
auto-creates/links a contact ONLY when every signal clears at once; phone-matches first using the
exact normalized/ambiguous-skip logic `upsert_lead_from_callrail` already uses (never creates a
duplicate; an ambiguous multi-contact match is skipped, not guessed), prefers the already-vetted
`caller_name` over the freshly-extracted `customer_full_name` for the name, and no-ops on an
already-linked lead. Called best-effort (try/catch, never blocks the transcription) right after
`set_lead_caller_name` in both `transcribeLead()` and `reclassifyLead()` — so the existing
`{reclassify: true}` backfill sweep also auto-qualifies already-transcribed historical leads with
no new backfill mode needed. Verified live against the TEST org: new-contact creation, link-to-
existing-by-differently-formatted-phone (no duplicate), already-linked idempotency, first-name-only
rejection (no space), spam-flagged/`is_customer_inquiry:false`/`service_match:'out_of_scope'`
rejection, and ambiguous-phone-match skip (two contacts sharing digits) — all fixture rows cleaned
up after. Tests: `functions/lib/callCleanup.test.js` (`nameExtendsOrMatches`),
`functions/lib/speakerNaming.test.js` (prompt-guard text), `functions/api/transcribe-call.test.js`
(prompt-guard text + `reclassifyLead()` cross-validation behavior with a stubbed Anthropic fetch),
`supabase/tests/crm_auto_qualify_contact.test.js` (self-skips locally, same as other `crm_*`
integration suites).

**Quick-add-task text wrapping fix (2026-07-21):** the Leads card's quick-add-task popover used a
single-line `<input type="text">` (the sibling Add-note popover already correctly used a wrapping
`<textarea>`) — a long task title typed past the visible width was invisible/clipped. Swapped to a
`<textarea rows={2}>`, `onKeyDown` still submits on Enter (`preventDefault`s the newline) but allows
Shift+Enter for a literal line break.

**Lead value sync from invoices (2026-07-21, `20260721_crm_lead_value_sync.sql`, owner-directed):** so
the Leads pipeline's weighted-value math and future ROI/total-sales reporting reflect real deal size
instead of staying blank, a real invoice being created (a brand-new invoice OR one converted from an
estimate — `invoices.estimate_id` — both are just "an invoices row with a real total," so one trigger
point covers both cases per the owner's ask) now fills in the closing CRM lead's `inbound_leads.value`.
New helper **`crm_sync_lead_value(p_contact_id, p_amount)`** (`SECURITY DEFINER`, `authenticated,
service_role` only) — deliberately **fill-blank-only** (never overwrites) and scoped to **exactly ONE
lead** (the contact's most-recently-Won, non-spam lead still missing a value, `ORDER BY
lead_pipeline_stage.updated_at DESC LIMIT 1`) rather than every open/Won lead for the contact — a
contact can have multiple `inbound_leads` rows (repeat caller, separate inquiries), and blasting the
same invoice amount onto more than one would double-count it in any future `SUM(value)` sales report.
Wired into the existing `crm_trg_invoice_created` trigger (function-body-only replace, runs AFTER the
existing auto-advance-to-Won call so the lead is already Won by the time the value lookup runs), using
`COALESCE(NEW.adjusted_total, NEW.total)` — a manual invoice correction is the real final number when
present. Own exception-safety wrap (never blocks the real invoice write on failure, logs
`crm_lead_value_sync_failed` to `system_events`). Verified live against the TEST org: fills a blank
value; never overwrites an existing one; never sets a value on two Won leads for the same contact (only
the most-recent gets it); composes correctly with the pre-existing auto-advance-to-Won trigger (a
not-yet-Won lead gets advanced AND valued in the same invoice-create event); uses `adjusted_total` over
`total`; a zero/negative total never sets a value. Test: `supabase/tests/crm_lead_value_sync.test.js`.
No frontend change needed — `crmPipeline.js`'s `weightedPipelineValue()` already reads `lead.value`.

**Duplicate-lead merge on repeat calls (2026-07-21, `20260721_crm_merge_repeat_call_leads.sql`,
owner-directed):** confirmed live — phone `+16267717702` ("Jake Nelson" / "Jake") produced two
`inbound_leads` rows 62ms apart, both landing as separate cards in the same "Estimate Sent" column
(the duplicate's `contact_id` was NULL — the two cards were moved into that column independently,
most likely by hand, unaware they were the same conversation; not an auto-advance chain reaction).
Root cause: `upsert_lead_from_callrail` had no concept of "does this phone already have an open lead" — every call became its own Kanban card via `groupLeadsByStage()`'s
first-stage fallback (a lead needs no `lead_pipeline_stage` row at all to render as "New"). Fix is
**stage-based, not a time window** (owner decision): a genuinely NEW call (never a redelivered
webhook — checked via the existing `v_existed` flag) whose normalized phone matches another
non-spam, not-already-merged lead sitting on a stage that's neither `is_won` nor `is_lost` (or no
stage row at all, i.e. still "New") gets `inbound_leads.merged_into_lead_id` set to that lead's id
(new nullable FK column + partial index) — picks the OLDEST matching open lead so a chain of repeat
calls always converges on one true original. The merged row still gets a full `inbound_leads` insert
(the call/transcript stays for history/compliance) but never a `lead_pipeline_stage` row of its own.
A repeat call from a phone whose prior lead already reached Won/Lost is NOT merged — a past
customer's new problem correctly gets a fresh, independent lead. `CrmLeads.jsx`'s board query gained
`merged_into_lead_id=is.null` (same filter position as the existing `spam_flag=eq.false`) — the
actual mechanism keeping a merged duplicate off the board, since the fallback-to-first-stage
behavior means "just don't create a stage row" alone would NOT have hidden it. `crm_auto_advance_leads`
(body-only replace) gained the same `merged_into_lead_id IS NULL` guard so a merged duplicate can
never be independently pulled through Won/Estimate Sent again; `crm_disqualify_lead_if_open` gained
the same guard as defense-in-depth. `get_lead_activity`/`get_contact_activity` (both body-only
replaces, same signatures/return shapes) gained a `'follow_up_call'` UNION ALL arm surfacing every
lead merged into the one being viewed (summary, occurred_at, `meta.merged_lead_id` linking back to
the merged call's own transcript/recording); `get_contact_activity`'s `'lead'` arm now excludes
`merged_into_lead_id IS NOT NULL` rows so a merged duplicate doesn't ALSO render as its own plain
"Call" entry. `ActivityTimeline.jsx` needed no changes — already generic over `activity_type`, so the
new type renders with the same default (unstyled) badge as `stage_change`/`task`/etc. One-time
backfill merges the single known live pair ("Jake" → "Jake Nelson", the first-created of the two) and
deletes the duplicate's now-orphaned `lead_pipeline_stage` row. Test:
`supabase/tests/crm_merge_repeat_call_leads.test.js` (self-skips locally, same as other `crm_*`
integration suites) — covers merge-while-open, no-merge-after-Won, no-merge-after-Lost, fresh-number
new-lead, and redelivered-webhook-doesn't-re-merge.

**Redial-after-Lost time-window amendment (2026-07-22, `20260721_crm_merge_repeat_call_leads_time_window.sql`,
adversarial-challenge follow-up):** the 2026-07-21 fix above still left a real gap — a caller whose
first call landed in a *terminal LOST* stage (most commonly "Missed Calls," nobody picked up) never
merged on redial, since the merge check only considered still-open leads. Every rapid callback after a
missed call became its own brand-new lead. `upsert_lead_from_callrail` (body-only replace, signature
unchanged) now ALSO merges into a LOST-stage lead, but only when the redial happens within a 3-hour
window of the original call's `occurred_at` — a same-day callback is almost certainly the same
inquiry; a call from the same number weeks later is very likely a genuinely new, unrelated job and
correctly stays its own lead. A WON lead is still never merged into, at any recency (unchanged from
2026-07-21). Verified live against the TEST org (not just the test suite): a redial 30 minutes after
landing in Lost merges; a redial 5 hours after does not; a redial 30 minutes after Won still does not.
Re-asserts the `REVOKE ... FROM PUBLIC, anon` / `GRANT ... TO authenticated, service_role` pair after
the replace (belt-and-suspenders per `database-standard.md` §1's managed-Supabase function trap — this
platform re-applies `EXECUTE TO PUBLIC` to a function at `ddl_command_end` even on a same-signature
replace; confirmed live grants stayed `authenticated`/`service_role`-only throughout). Test: extended
`supabase/tests/crm_merge_repeat_call_leads.test.js` with the within-window-merges /
beyond-window-does-not-merge split (the Lost case now needs an explicit `occurred_at` to control the
gap, since two calls fired back-to-back in a test are always well inside 3 hours).

**Automated call-classification safety net (2026-07-22, `20260722_crm_calls_classification_cron.sql`,
adversarial-challenge follow-up):** `callrail-webhook.js` already auto-transcribes a call in real time
the moment its recording lands, but that path is best-effort — a Deepgram hiccup, a not-yet-ready
recording, or a transient Anthropic error silently gives up with no retry. Verified live 2026-07-22: a
batch of 21 calls sat never-transcribed for weeks with nobody noticing (the only prior remedy was a
human manually POSTing `{backfill:true}`/`{reclassify:true}` to `/api/transcribe-call` from devtools
with their own login). `functions/api/transcribe-call.js` now ALSO accepts the shared
`cron_worker_secret` (via `functions/lib/auth.js`'s `checkCronSecret`, same OR'd pattern as
`process-scheduled.js`/`run-automations.js` — a human's session-based trigger still works unchanged),
and two new `pg_cron` jobs call it every 6 hours: `upr_calls_backfill_safety_net`
(`{backfill:true, days:3}`, catches anything still missing a transcript) and
`upr_calls_reclassify_safety_net` (`{reclassify:true}`, 20 minutes later, catches anything transcribed
but not yet classified — Claude-only, no Deepgram cost). Reuses the existing `cron_worker_secret`
`integration_config` row (no new secret) and adds one new `transcribe_call_worker_url` row (a public
HTTPS URL, not a secret). Confirmed both jobs registered `active=true` in `cron.job` post-apply. A
one-time manual `{backfill:true, days:90}` pass (owner-run from devtools, same auth snippet pattern as
the existing reclassify one) is still needed to clear the pre-existing 21-call backlog once — the cron
only prevents new backlog from forming going forward, it wasn't run retroactively wider than its
3-day window. **Owner ran the backfill 2026-07-22 and it correctly touched 0 leads**: all 21 have
`answered:false` (no recording exists for an unanswered call — nothing for Deepgram to transcribe), and
19/21 are already correctly sitting in the "Missed Calls" stage (the other 2 are within 24h, awaiting
whatever periodic process assigns a missed call to that stage — unrelated to transcription).

**CrmOverview.jsx: campaign donut + New-leads KPI window-scoping fix (2026-07-22, owner-caught live):**
`CrmOverview.jsx`'s single `data.leads` fetch (`spam_flag=eq.false&merged_into_lead_id=is.null`, no date
filter, `limit=1000`) is intentionally UNBOUNDED by date for the sales pipeline (`groupLeadsByStage`
needs every currently-open lead regardless of creation date) — but it was ALSO being reused unscoped for
the "Leads by campaign" donut and the "New leads" KPI, which sit right next to numbers that ARE scoped to
the range picker. Live: a "7 days" pick showed 27 leads-by-source (correct) but 67 leads-by-campaign
(wrong — counted against the full unscoped fetch), and "New leads" was hardcoded to a fixed
`now - 7 days` cutoff regardless of the picker (only looked right by coincidence when the picker
happened to also be "7 days"). Fix: `load()` now stores `rangeStart`/`rangeEnd` (the same `start`/`end`
already passed to the RPCs) instead of the old hardcoded `sinceISO`; `derived` filters `data.leads` down
to a `windowLeads` array by `[rangeStart, rangeEnd]` (end-inclusive through the full calendar day) before
handing it to `leadsByCampaign` and the New-leads count — the pipeline keeps using the unscoped
`data.leads`, unchanged. KPI sub-label changed from "last 7 days" to "in this window". Verified live
against the shared Supabase: the new `windowLeads` count (27) matches the RPC-derived "Leads by source"
total exactly for the current 7-day window. `newLeadsSince` (crmCharts.js) is no longer imported by this
page (still exported/tested, just unused here now — `windowLeads.length` replaced it directly). Two
pre-existing, non-regressing notes surfaced during review: `rangeToDates` builds dates UTC-anchored, not
`America/Denver` per `database-standard.md` §7 (was already true before this fix, same strings already
went to the RPCs); and the 1000-row cap on the leads fetch can under-count `windowLeads` for very wide
windows (12mo/All time) with >1000 total leads — neither is new, both are candidates for a future
follow-up.

**"Leads" excludes unanswered calls everywhere (2026-07-22, `20260722_crm_leads_exclude_unanswered_
calls.sql`, owner-caught live):** every "Leads" number on Overview/Attribution/Reports (headline card,
"Leads by source", "Leads by campaign", "New leads" KPI, Conversion Trend's leads bar) counted ANY
non-spam-flagged `inbound_leads` row — but a call that rang and was never picked up has no recording and
no transcript, so it can NEVER be run through the AI classifier that would otherwise catch it as spam.
Verified live: **13 of 29 "leads" in a 7-day window (45%) were unanswered calls with zero content** —
after this fix the same window correctly shows **16** (manually audited: 15 confirmed real water/mold
inquiries + 1 confirmed real inquiry for an out-of-scope service). Fix introduces ONE canonical
`crm_call_is_answered(raw_payload, duration_sec) → boolean` SQL helper — mirrors `get_call_volume`'s
own existing inline CASE expression exactly (trust CallRail's `raw_payload->>'answered'` flag when
present, else fall back to `duration_sec > 0` for legacy rows) — and adopts it in `get_call_volume`
(DRY, behavior-identical), `get_attribution_rollup`'s `leads_agg` CTE, and `get_conversion_trend`'s
`lead_c` CTE (both gain `AND (source_type <> 'call' OR crm_call_is_answered(...))`). All three
signatures byte-for-byte unchanged. `crmCharts.js` gained the client-side twin `isCountableLead(lead)`
(+ 4 tests) for the ONE lead-counting consumer that doesn't go through an RPC — `CrmOverview.jsx`'s raw
`inbound_leads` select, which now also selects `source_type`, `duration_sec`, and
`answered:raw_payload->>answered` (verified this PostgREST jsonb-path aliasing works against the live
REST endpoint before using it) and filters `windowLeads` down to `countableWindowLeads` before feeding
the campaign donut/New-leads count. **Deliberately UNCHANGED:** the Kanban board (`CrmLeads.jsx`), task
picker (`CrmTasks.jsx`), and the sales pipeline's stage grouping all still show/count unanswered calls —
staff still need to see a missed call in order to actually call the person back, so this is a
MARKETING-METRIC fix only, never an ops/triage visibility change. Verified live end-to-end: an
unanswered-call fixture did NOT increase `get_attribution_rollup`'s leads count; an answered-call
fixture with the same shape did (0→1); both cleaned up. Grants confirmed `authenticated`/
`service_role`-only on all 4 functions post-apply. Test:
`supabase/tests/crm_leads_exclude_unanswered_calls.test.js` (self-skips locally like sibling CRM
suites) — covers `get_attribution_rollup`/`get_conversion_trend` answered-vs-unanswered deltas and the
no-`answered`-key legacy-row duration_sec fallback.

**Missed calls auto-stage (2026-07-22, `20260722_crm_auto_stage_missed_calls.sql`, owner-reported live):**
NOTHING had ever moved a lead into the "Missed Calls" pipeline stage automatically — all 19 historical
placements were ONE manual drag session (2026-07-21 15:49, human moved_by); every unanswered call since
sat stage-less in "New" and the column's count froze. `upsert_lead_from_callrail` (body-only replace)
now stages a call lead into the org's "Missed Calls" stage on the delivery carrying CallRail's EXPLICIT
`answered='false'` (string-compared, never a throwing `::boolean` cast; the call-started delivery has no
`answered` key so a ringing call never stages prematurely) via `move_lead_to_stage` (history/events
bookkeeping identical to a human move, `moved_by NULL` = system). Guards: existing human/AI placement
always wins; merged redials + spam never stage; missing stage for the org → graceful no-op. One-time
backfill staged the 4 stranded calls (19 → 23, verified live + full delivery-sequence smoke on the TEST
org, which now carries its own "Missed Calls" stage). Known accepted behavior: an answered redial that
merges into a Missed-Calls lead leaves the card there until a human moves it (auto-advance correctly
refuses to leave a terminal stage). Test: `supabase/tests/crm_missed_calls_auto_stage.test.js`.

**Speed-to-lead counts HUMAN moves only (2026-07-22, `20260722_crm_speed_to_lead_human_moves_only.sql`,
same-day self-caught regression):** the auto-stage above (and the AI auto-advance) write `moved_by NULL`
stage moves within seconds of a call — `get_speed_to_lead` counted those as "responses", so every missed
call would have registered a fake near-instant SLA hit (verified live pre-fix: 7 of 88 samples' FIRST
move was a system move, 4 added by the auto-stage backfill that same day). Body-only replace adds
`AND lsh.moved_by IS NOT NULL` to the first_move CTE: only a PERSON's first touch counts as a response;
a machine-only-moved lead contributes no sample until someone actually touches it.

**CRM reliability wave (2026-07-22, ultracode multi-agent build + adversarial verify, all applied live):**
five artifacts authored in parallel, each reviewed by `migration-safety-checker`/`upr-pattern-checker`,
plus a cross-cutting `anon-grant-auditor` pass and a dedicated adversary attacking the backlink logic
against live data (verdicts: all pass except one adversary MAJOR, fixed before apply — see backlink):
- **Lead→contact backlink** (`20260722_crm_lead_contact_backlink.sql`): trigger
  `trg_backlink_leads_to_contact` on contacts (AFTER INSERT OR UPDATE OF phone) — when a contact is
  created/re-phoned and is the ONLY contact with that last-10-digit suffix (ingest-side exactly-one rule,
  identical normalization), all still-unlinked, non-merged leads from that number link to them; every
  link audited in `system_events` ('crm_lead_backlinked', via trigger|backfill). **Self-healing (the
  adversary's major, fixed):** a REAL phone change first RELEASES this trigger's own prior links for the
  OLD number (system_events-trail-scoped — human links untouched; audited as
  'crm_lead_backlink_reverted'), so a mistyped/recycled number can no longer permanently poach a
  stranger's lead history. Disclosed limits: household shared-number ordering (first contact created
  wins until the second exists), and `merge_contacts` never re-fires the trigger (known follow-up).
  Verified live end-to-end via the real `import_contacts` path: contact import → lead auto-linked →
  phone change → link released + revert audited. One-time backfill linked 2 (3 at authoring; drift).
  This closes the forward linkage gap; the 79/87 HISTORIC untraced real jobs are unrecoverable by
  linkage (82 unlinked leads have NO matching contact — the CRM postdates most of those jobs).
- **is_real_job audit trail** (`20260722_real_job_flag_audit_trail.sql`): new `job_real_flag_history`
  table (RLS, SELECT floor TO authenticated — conscious call documented in the migration) + jobs
  triggers capturing EVERY change to is_real_job/real_job_source/real_job_marked_at (incl. INSERTs born
  true — the raw-write pattern behind the 8 true/NULL/NULL rows) with `changed_by = auth.uid()` when
  available; `set_job_real_job` (body-only, signature frozen) now PRESERVES source/marked_at on DEMOTE
  (the old body's overwrite is how the 2026-07-03 bulk demotion destroyed 13 sold jobs' provenance).
  Silent demotions are now structurally impossible. Test: `supabase/tests/real_job_flag_audit_trail.test.js`.
- **Evidence reconciler** (`20260722_real_job_evidence_reconciler.sql`): `get_real_job_evidence_
  mismatches()` — one row per job whose flag disagrees with its own canonical evidence (predicates
  verbatim from the mark_job_real triggers), two categories: 'evidence_unflagged' (live: **17 jobs,
  incl. $50.9K invoiced/paid demotion victims**, each with evidence kinds, $ totals, was_demoted
  signature) and 'flagged_no_evidence' (live: **15 jobs**, real_job_source included — manual marks are
  legitimate, surfaced not judged). Daily pg_cron `upr_real_job_evidence_reconciler` (13:15 UTC) logs
  ONE system_events row ('real_job_evidence_mismatch', whole-table sentinel entity_id) only on drift
  days. **Changes no data** — the owner adjudicates the 17+15 from this worklist.
- **Trend merged-filter** (`20260722_crm_trend_excludes_merged_leads.sql`): `get_conversion_trend`'s
  lead_c now excludes `merged_into_lead_id IS NOT NULL` like the rollup already did (was 26 vs 28 on
  one screen).
- **Missed-call label** (frontend): `CrmCallLog.jsx` now shows "Missed call — no recording" instead of
  the forever-"Waiting for recording & transcript…" for unanswered calls; `crmCharts.isCountableLead`
  gained a `raw_payload.answered` fallback (+tests) for select=*-shaped rows.

**Open gaps flagged, deliberately NOT built (owner rulings / follow-ups):** missed-call textback
automation is dead-on-arrival when A2P flips (isMissedCall uses the duration proxy — ring time counts
as "answered" — AND requires contact_id, which unanswered calls never have; consent-sensitive redesign
needed); the three mark_job_real triggers don't watch `job_id` (an invoice/estimate/sign_request linked
to its job AFTER the signal column was set never fires — the suspected mechanism for job 26-20); Won
auto-advance depends on lead↔contact linkage (0 system Won moves ever recorded); forms are never
AI-screened for spam; "Contacted" stage has no auto-mover (outbound calls are invisible — properly
fixed by the future Twilio phone platform); UTC-vs-Denver bucketing + traced-gate display + 2026-07-03
demotion adjudication all await owner rulings.

**RPCs** (all `SECURITY DEFINER`, granted `anon, authenticated`):
- `get_pipeline_stages(p_org_id)` — read helper, defaults to the real org.
- `upsert_pipeline_stage(p_id, p_name, p_color, p_sort_order, p_is_won, p_is_lost, p_org_id)` — add
  (`p_id` NULL) or rename/recolor/reorder/toggle-won-lost (`p_id` set) a stage; no code change
  needed for any of that, per the roadmap's "not a hardcoded enum" requirement.
- `delete_pipeline_stage(p_stage_id)` — refuses (raises, surfaced as a toast) if any lead is still
  on that stage, so a delete can never silently orphan a `lead_pipeline_stage` row.
- `move_lead_to_stage(p_lead_id, p_stage_id, p_moved_by)` — true upsert on `lead_id`; logs a
  `crm_lead_stage_changed` `system_events` row.
- `get_contact_activity(p_contact_id)` — the unified activity timeline: `UNION ALL` across
  `inbound_leads` (calls/forms, Phase 1), `messages` joined through `conversation_participants`
  (SMS — `messages.channel` exists on the table but is never written by any current worker, so the
  SMS branch reads `messages.type`, e.g. `sms_outbound`/`sms_inbound`, which
  `functions/api/send-message.js` / `twilio-webhook.js` actually populate), `job_notes` joined
  through `contact_jobs` (notes are job-scoped, not contact-scoped, hence the join), and `estimates`
  (`contact_id` is direct). Ordered newest-first across all four sources. **(2026-07-21 addition,
  `20260721_crm_contact_link_and_activity.sql`, function-body-only `CREATE OR REPLACE`, signature
  unchanged):** three more `UNION ALL` arms — `appointment` (joined through `contact_jobs` same as
  `job`/`note`, since `appointments` has no direct `contact_id`), `invoice` (direct `contact_id`), and
  `work_authorization` (from `sign_requests`, direct `contact_id` — the e-sign work-authorization
  mechanism). This is the UPR job-management/invoicing-side history the CRM lead/contact panel was
  missing; `ActivityTimeline.jsx` is fully generic (renders whatever `activity_type` rows come back),
  so no frontend change was needed. `REVOKE...FROM PUBLIC,anon` re-affirmed; grants stay
  `authenticated, service_role` only, verified live before/after
  (`.claude/rules/crm-wave-ownership.md` §1 lists this RPC as a Foundation-owned frozen REPLACE —
  this was an owner-directed production fix, not an in-wave session, and stays backward-compatible
  per that manifest's own REPLACE rule). **⚠️ This bullet describes only the FIRST few arms — the
  live function has since grown to 24 arms via several more body-only `CREATE OR REPLACE`s. See the
  dated "Contact-activity timeline — full current shape (2026-07-24)" addendum below for the
  authoritative live arm list, the `crm_lead_notes` note arm, and the durable all-arms guard.**

**Phase 4a follow-up — manual lead entry** (`supabase/migrations/20260701_crm_manual_lead.sql`):
the Leads board originally only populated from CallRail ingestion, so with CallRail unconnected
the board was empty and untestable, and there was no way to add a walk-in/referral lead by hand.
Added a **"+ New lead"** button on `CrmLeads.jsx` (and in its empty state) opening a create panel
(name/phone/source/value), backed by a new `create_manual_lead(p_phone, p_name, p_source, p_value,
p_org_id, p_created_by)` RPC (`SECURITY DEFINER`, granted `anon, authenticated`). It matches or
creates a `contacts` row by phone (name backfilled only when blank), then inserts an `inbound_leads`
row and logs a `crm_lead_created_manual` `system_events` row. **Additive-only — no schema change**:
a manual lead has no CallRail id so the RPC synthesizes a unique `manual:<uuid>` `callrail_id` (that
column is NOT NULL + UNIQUE), and uses `source_type='form'` because the `source_type` CHECK only
allows `call`/`form` and an additive change must not alter that live constraint — the real origin
lives in the `source` column (e.g. `Referral`, `Walk-in`). Verified live against the TEST org
(create → assert one lead + one contact by phone → a second same-phone lead reuses the one contact →
cleaned up); integration test at `supabase/tests/crm_manual_lead.test.js` (committed test-first,
self-skips without live creds, same as the Phase 0/1 suites). **Phone is normalized to E.164 in
`CrmLeads.jsx`'s create panel** via `normalizePhone()` (`src/lib/phone.js`) before the RPC call —
the same canonical form CallRail ingestion and every other create-contact flow use — so a
hand-typed `(801) 555-0100` matches (never duplicates) an existing contact on the unique `phone`
column; an invalid number is rejected with a toast.

**Frontend** (`src/pages/crm/`), replacing their Phase 1 `CrmStubPage.jsx` placeholders:
- **CrmLeads.jsx** (`/crm/leads`) — a real Kanban board, reusing `Production.jsx`'s drag-and-drop
  pattern (desktop-only `draggable`, gated by the same `isTouchDevice()` check) rather than building
  one from scratch. Columns come from `get_pipeline_stages`, sorted via `sortStages()`; cards are
  every non-spam `inbound_leads` row (contact embedded), bucketed via `groupLeadsByStage()`. Header
  subtitle shows a **weighted pipeline value** (`weightedPipelineValue()` — `is_won` stages weight
  1, `is_lost` weight 0, open stages weight by position among the open stages, `(index+1)/(open+1)`
  — a deliberately simple stage-position heuristic, not a configurable probability field, since
  `pipeline_stages` has no such column). Clicking a card opens a slide-out detail panel: a stage
  `<select>` (the touch-device path for moving a lead, since drag is disabled there), lead
  metadata, and the `get_contact_activity`-backed timeline, badge-colored per activity type.
- **CrmSettings.jsx** (`/crm/settings`) — TWO sections. **(1) Tracking numbers:** lists every
  CallRail number from `get_tracking_numbers` with its call count + an editable **title** (the
  campaign it belongs to) → `set_tracking_number_label`; the Call Log shows that title in place of the
  raw number (read-only there). **(2) Pipeline-stage CRUD:** add, inline rename/recolor/
  won-lost-toggle, reorder via left/right buttons that swap `sort_order` with the neighboring stage
  (simpler and more reliable than drag-and-drop for an admin settings screen), delete via the
  inline two-click confirm pattern (`onBlur` cancels — no modal, per CLAUDE.md Rule 2), surfacing
  the server-side in-use guard as a toast if a stage still has leads on it.

**New pure-function module**: `src/lib/crmPipeline.js` — `sortStages`, `groupLeadsByStage`,
`stageWeight`, `weightedPipelineValue`. No DB access; used by both `CrmLeads.jsx` (board rendering)
and `CrmSettings.jsx` (stage ordering).

**New CSS**: `.crm-board-*` / `.crm-panel-*` / `.crm-timeline-*` / `.crm-stage-*` in `src/index.css`,
all under the existing `--crm-*` token scope (no new global tokens).

**Test-first**: `src/lib/crmPipeline.test.js` committed at `2afde90`, before `src/lib/crmPipeline.js`
existed (`bb34502`) — confirmed genuinely failing at the test-only commit (import error). Covers
stage-ordering-respects-`sort_order` (including a no-mutation check) and the weighted-pipeline-value
math against a hand calculation across open/won/lost stages, plus the null-value-contributes-zero
edge case.

**`npm run test` + `npm run build` + `npx eslint`**: all green on every changed file.

**Independent review**: `upr-pattern-checker` found zero violations. `crm-phase-reviewer` (Opus)'s
first pass raised one claimed blocker — that `get_contact_activity` referenced a non-existent
`messages.channel` column. That premise was actually wrong: `messages.channel` is a real column
(confirmed live via `information_schema.columns` and by running the RPC against a real contact),
so the RPC never threw. It's simply never populated by any current worker, so the fix applied was
a data-quality improvement rather than a crash fix — the SMS branch now reads the actually-populated
`messages.type` instead. A second reviewer pass, done skeptically (independently re-verifying
`messages.type`'s provenance via `send-message.js`/`twilio-webhook.js` rather than taking the fix on
faith), confirmed the fix and passed every acceptance criterion except this doc update itself
(now resolved by this section) — recommendation **SHIP into `dev`**.

**Dogfooding**: 3 of `phase-4a`'s 5 `crm_build_stages` rows flipped to `done` via
`set_crm_stage_status` — test-first, the Kanban+timeline+Settings-CRUD acceptance criteria, and
test/build/eslint+both review agents; `crm_build_phases('4a')` set to `shipped` (per CLAUDE.md's
"set status → update this doc — before opening the PR" order, same as Phase 2). Two stages stay
`todo`, honestly: the visual-check-vs-Stitch-handoff stage — it needs a logged-in Moroni session on
the branch's Cloudflare preview, which this sandbox doesn't have, same disclosed owner-gated
treatment Phase 1 gave its CallRail-account-dependent items, not a forgotten step — and the final
"set shipped/docs updated/pushed/PR opened" stage, which bundles the push+PR sub-step that hasn't
happened yet as of this doc edit (docs and the phase-shipped flip are done; push+PR is not) — same
split Phase 2 used, flipped once the PR is actually opened. No test rows needed cleanup this phase:
all verification queries against real (non-test-org) rows were read-only or exercised against
disposable TEST-org rows that were deleted immediately after (see the migration's own commit
message).

### Phase 4c — Email campaigns

Built **before Phase 4b** (text blasts) via an explicit, authorized reprioritization: 4b is
blocked on Twilio A2P 10DLC carrier approval (external, days-to-weeks); email runs on Resend,
already integrated, with no such dependency. The roadmap's own hard prerequisite — the CRM shell +
Phases 3/4a merged into `dev` — was confirmed live before this build started (branch diffed 0/0
against `origin/dev` at the tip carrying PR #195/#196). 4b's mention as 4c's prerequisite in
`docs/crm-roadmap.md` is the linear-chain default, not a real code/data dependency — 4c introduces
its own tables and touches nothing 4b would have added.

**New tables** (`supabase/migrations/20260701_crm_phase4c_email_campaigns.sql`, applied to the live
shared dev/main Supabase project) — deliberately NOT built on the pre-existing `campaigns`/
`campaign_recipients` tables (already live, queried by `Marketing.jsx` before this phase): those are
hard-wired for SMS — `campaigns.campaign_type` has a CHECK constraint with no `'email_blast'` value,
and `campaign_recipients.phone` is `NOT NULL` with no email column. Adding either would mean
ALTERing a live table, forbidden by this phase's additive-only rule — so email campaigns get fully
separate tables and the legacy SMS tables are left untouched for Phase 4b:
```
email_suppressions          — id, org_id (FK crm_orgs), email, reason ('unsubscribed'|'bounced'|
                               'complained'|'manual', default 'unsubscribed'), source,
                               suppressed_at, created_at. UNIQUE on lower(email) — an address is
                               suppressed regardless of casing on a later send. This is the
                               compliance-critical list every send checks.
email_campaigns              — id, org_id, name, subject, template_id (FK message_templates,
                               nullable — best-effort only, see NOTES below), body_html,
                               audience_filter jsonb, status ('draft'|'sending'|'sent'|'failed'),
                               audience_count, total_sent, total_suppressed, total_failed,
                               scheduled_at, sent_at, created_by (FK employees), created_at,
                               updated_at.
email_campaign_recipients     — id, campaign_id (FK email_campaigns, CASCADE), contact_id (FK
                               contacts, CASCADE), email, status ('pending'|'sent'|'suppressed'|
                               'failed'), resend_id, error_message, sent_at, created_at.
                               UNIQUE(campaign_id, contact_id) — the snapshotted audience for one
                               send.
```
All three RLS-enabled at creation (`FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)`),
writes via RPC only.

**RPCs** (all `SECURITY DEFINER`, granted `anon, authenticated`):
- `preview_email_audience(p_filter, p_org_id) → TABLE(contact_id, name, email)` — segmentation off
  `contacts`/`referral_sources` per the roadmap: filters on `referral_source` (matches
  `contacts.referral_source`), `role`, and a `tags` jsonb containment check. Always excludes no-email,
  `dnd`, and any suppressed address regardless of filter — non-negotiable. Deliberately does **not**
  filter on `contacts.opt_in_status` (that's the SMS/TCPA opt-in flag) — US marketing email is
  governed by CAN-SPAM, which is opt-out based, not opt-in based.
- `get_email_campaigns(p_org_id)` — read helper, defaults to the real org.
- `upsert_email_campaign(p_id, p_name, p_subject, p_template_id, p_body_html, p_audience_filter,
  p_org_id, p_created_by)` — create (`p_id` NULL) or edit a still-`draft` campaign; recomputes
  `audience_count` via `preview_email_audience` on every save.
- `delete_email_campaign(p_id)` — refuses (raises) unless the campaign is `draft`/`failed`.
- `queue_email_campaign(p_campaign_id)` — snapshots the resolved audience into
  `email_campaign_recipients` (idempotent — `ON CONFLICT DO NOTHING`), flips status to `sending`.
- `record_email_campaign_send(p_recipient_id, p_status, p_resend_id, p_error_message)` — per-recipient
  result + campaign counter rollup; auto-flips the campaign to `sent` once no `pending` recipients
  remain, so the worker never needs a separate "finalize" call.
- `email_unsubscribe(p_email, p_recipient_id, p_org_id)` — the public unsubscribe write path. Given a
  recipient id, resolves its email/marks that `email_campaign_recipients` row `suppressed`; either
  way upserts `email_suppressions` (`ON CONFLICT (lower(email)) DO UPDATE` — repeat clicks never
  error/duplicate).

**Shared send foundation** (`functions/lib/`, built now so Phase 4b can add its SMS branch
additively rather than a rewrite):
```
email-consent.js    — emailAllows({ email, suppressed, dnd }) → boolean. Pure predicate, no I/O —
                       refuses on no email, suppressed, or dnd; allows otherwise. Test-first:
                       email-consent.test.js (5 vitest units) committed at 095ab01 before this file
                       existed — confirmed genuinely failing (import error) at that commit, green
                       once the implementation landed.
automated-send.js   — sendAutomatedMessage(channel, contactId, templateKey, variables, env, extra)
                       — the generic single-send entry point Phase 4d's fixed automations will call;
                       'sms' throws (documented Phase 4b TODO), 'email' looks up the contact +
                       optional message_templates row (matched by title — that table has no
                       channel/key column, so this is a best-effort reuse of its variable-
                       substitution *pattern*, not a real integration) then calls sendGatedEmail.
                       sendGatedEmail(env, { contact, subject, html, recipientId }) is the ONE path
                       to sendEmail() for any marketing message — both sendAutomatedMessage('email')
                       and the campaign worker call it, so the suppression/consent check is
                       structurally unbypassable. It checks email_suppressions (case-insensitive
                       ilike lookup) + contact.dnd via emailAllows(), appends an unsubscribe footer
                       link, and sets List-Unsubscribe/List-Unsubscribe-Post headers (RFC 8058
                       one-click). The unsubscribe link carries `?rid=<recipient id>` when the caller
                       has one (campaign sends) so a click flips that exact recipient row, or a plain
                       `?email=` link otherwise (a future non-campaign automation send).
                       **SMS-experience Phase D (Jul 9 2026)** — the SMS branch (`sendGatedSms`) is
                       fully live: after passing the three frozen gates (kill-switch → TCPA consent →
                       quiet-hours, UNCHANGED order) a successful send now (1) **mirrors the text into
                       the contact's conversation thread** — find-or-create a `direct` conversation
                       (mirrors `twilio-webhook.js`) + insert an `sms_outbound` `messages` row
                       (service-role, **worker sole writer**, `sent_by:null`, `direction:'outbound'`) +
                       bump the conversation preview — and (2) passes a `/api/twilio-status`
                       **statusCallback** so Phase A fills status/error_code/num_segments/price by
                       twilio_sid (F-12). The thread-write is **best-effort** (wrapped+swallowed: a DB
                       hiccup never demotes a delivered text to a failure). Quiet-hours timezone is now
                       **per-recipient** (`timezoneForContact` — NANP area code → `billing_state` → env
                       → Mountain default; no `contacts.timezone` column exists and Phase D ships zero
                       schema, so the area code is the TCPA-correct "called party" signal). Sends retry
                       transient/429 errors with linear backoff and fail-fast on permanent ones
                       (`classifySendError` via F's `twilio-errors.js` + `sendSmsWithBackoff`), returning
                       an additive `{ permanent }` flag. **Frozen return preserved**: `{ok,skipped,reason}`
                       + the load-bearing `sms_disabled`/`quiet_hours` strings unchanged; new
                       `sid`/`error`/`permanent` are additive; backward-compat tests assert Phase 8's
                       `planStepOutcome` + Phase 5's `planRunOutcome` still HOLD/skip/send correctly.
                       **Scheduled-send compatibility (Jul 24 2026):** optional additive fields let
                       the same gate preserve an already-selected destination, conversation, staff
                       sender, stored body and MMS media. The provider receives the prefixed body,
                       the existing thread receives the unprefixed body and `sms`/`mms` channel, and
                       the additive `messageId` lets `process-scheduled` close its claim without a
                       second `messages` insert. The frozen `{ok,skipped,reason}` vocabulary and
                       load-bearing defer reasons are unchanged.
                       **Ambiguous-outcome closure (Jul 24 2026):** scheduled rows fail for
                       reconciliation, CRM automation runs fail at the same action, and sequence
                       enrollments pause at the same step with a required reconciliation event.
                       Fixed automations suppress later runs only after their terminal event
                       persists; automated SMS remains activation-blocked until a pre-send
                       reservation closes that post-send persistence gap.
                       **CallRail inbound-media host correction (Jul 24 2026):** signed webhooks
                       currently emit an `app.callrail.com/msg/a/...` media path even though API-key
                       retrieval belongs on `api.callrail.com/v3/a/...`. After exact numeric/masked
                       account alias, message and index validation, UPR prefers the current masked
                       `ACC...` identity and normalizes only that proven identity to the API host. It
                       never presents the API credential to the app host or relies on a numeric
                       account redirect.
email.js             — sendEmail() gained an optional `headers` param (passed through to Resend's own
                       `headers` object untouched) — the only change to this pre-existing
                       transactional-only file; every other caller (esign, demo-sheet, billing-2fa,
                       water-loss-report) is unaffected since the param defaults to unset.
```

**Workers**:
```
send-email-campaign.js  — POST, authenticated (Supabase session bearer token, verified against
                           /auth/v1/user with the anon key). Queues the campaign's audience, then
                           loops recipients: re-fetches each contact's LIVE name + dnd (not the
                           queue-time snapshot — a large campaign can take a while, and dnd could
                           change mid-send) before calling sendGatedEmail, records each result via
                           record_email_campaign_send, and logs one worker_runs row. Never calls
                           sendEmail() directly — always through sendGatedEmail so the suppression
                           gate can't be bypassed. Disclosed gap: the recipient loop runs
                           synchronously in the request; a campaign large enough to risk the
                           Cloudflare Pages Function execution-time limit would need a batched/queued
                           redesign — not built this phase since no real campaign has been sent yet.
email-unsubscribe.js    — public GET/POST (no auth by design — RFC 8058 one-click unsubscribe
                           requires an unauthenticated POST to succeed), reached from the campaign
                           email footer link and List-Unsubscribe-Post. Accepts `?rid=` (preferred,
                           resolves the exact recipient + campaign) or `?email=` (fallback), calls
                           email_unsubscribe, always returns a 200 HTML confirmation page except when
                           neither param is present (400).
crm-campaign-ai-design.js — POST, authenticated (same requireAuth as send-email-campaign.js — any
                           valid logged-in session, NOT the Moroni-only gate the Homebuilding AI
                           workers use, since CRM Campaigns is a shared team feature behind
                           `page:crm`, not a personal tool). Powers the CRM Campaigns builder's
                           "✨ Design with AI" button (`RichEmailEditor.jsx`): takes a plain-English
                           instruction + the current subject/body_html, asks Claude Sonnet 5 to
                           rewrite the email's INNER content HTML only (never the outer branded shell)
                           as a polished, brand-styled design — styled headings, accent-tinted
                           callout blocks, button-style CTAs, matching the hardcoded brand colors in
                           email-template.js's wrapEmailBody. Forced tool_choice structured output
                           (`{ body_html }`) — requires explicitly setting `thinking: { type:
                           'disabled' }`, since Sonnet 5 (unlike the 4.6 the Homebuilding workers use)
                           defaults extended thinking ON when the param is omitted, and forced tool
                           calls are incompatible with thinking enabled. No new table — logs a
                           worker_runs row like every other worker.
```

**Frontend**: `src/pages/Marketing.jsx` (pre-existing page, rewritten) — a simple Email/SMS tab
switcher. SMS tab unchanged (still Phase 4b's "coming soon" stub reading the legacy `campaigns`
table). Email tab (`EmailCampaignsTab`/`EmailCampaignForm`) — campaign list with status/audience/
sent/suppressed/failed counts, a simple builder (name, subject, body with `{{name}}` substitution,
referral-source + role segmentation dropdowns), a live "Preview audience" count
(`preview_email_audience`), save-as-draft/edit/delete (two-click inline confirm, no modal), and
"Send now" (calls `POST /api/send-email-campaign` via `getAuthHeader()`, same pattern
`CrmIntegrations.jsx` uses for its worker calls). New `.marketing-*` CSS block in `src/index.css` —
plain app tokens (`--space-*`/`--text-*`), not the CRM shell's `--crm-*` scope, since this page lives
outside `/crm/*`.

**`page:marketing` flag**: gained a `dev_only_user_id` (Moroni's employee id) this phase via a data
`UPDATE` (not a schema change) so the new Email tab is previewable — `enabled` stays `false`, so
every other employee still sees nothing, unchanged from before this phase.

**Test-first**: `functions/lib/email-consent.test.js` (5 units) committed at `095ab01`, confirmed
genuinely failing (import error) before `email-consent.js` existed at `4e63d64`.

**`npm run test` (94 pass / 9 skip) + `npm run build` + `npx eslint`**: all green on every changed
file.

**Independent review**: `upr-pattern-checker` — clean, no violations (RLS + explicit policies on all
three new tables at creation, no ALTER/DROP/rename of any pre-existing table, `useAuth()`-only `db`
in `Marketing.jsx`, no `alert()`/`confirm()`, two-click inline delete confirm, no hardcoded hex in
the new CSS). `crm-phase-reviewer` (Opus, weighted on the `emailAllows` gate + unsubscribe wiring)
traced every `sendEmail()` caller and confirmed the campaign path only ever reaches it through
`sendGatedEmail`; traced the full unsubscribe loop end-to-end (footer link → RPC → suppression table
→ excluded from the next `preview_email_audience`/`sendGatedEmail` check) and confirmed it genuinely
closes; confirmed test-first ordering by running the test at its own commit (failed, as expected).
First pass returned **DO-NOT-SHIP-YET** on 3 items: (1) `{{name}}` was rendering the recipient's
*email address* — `send-email-campaign.js` was substituting `recipient.email` instead of a real
name; (2) the campaign worker's `dnd` re-check was dead (always passed `undefined`); (3) the
suppression lookup was case-sensitive while every other suppression check in the system is
case-insensitive. Fixed (`61dd57a`): the worker now re-fetches each contact's live `name`+`dnd` at
send time instead of trusting the queue-time snapshot, and `isEmailSuppressed` uses a case-insensitive
`ilike` lookup. Also fixed a related cosmetic gap the reviewer flagged (a dead `?campaign=` query
param on the unsubscribe link that the endpoint never read) by switching to `?rid=<recipient id>`,
which the `email_unsubscribe` RPC uses to actually flip that recipient's row to `suppressed`. A
narrow confirmation pass re-verified all four fixes directly against the current file contents
(not the commit message) before this doc was written. All fixes were additionally verified live via
the Supabase MCP (`execute_sql`): queued a disposable TEST-org campaign/recipient, unsubscribed via
the `rid` path, confirmed the recipient row flipped to `suppressed`, confirmed a case-insensitive
suppression match — then cleaned up every test row.

**Owner-gated, disclosed as such (not a forgotten step)**: "Send now" has never been exercised
against a real Resend send + a real inbox click on the unsubscribe link — this sandbox has no
outbound egress to Supabase/Resend from a browser session, and sending real email requires a
connected Resend domain already live in production (see `EMAIL-DELIVERABILITY.md`), not something to
trigger from this build session. The RPC-level behavior (audience resolution, queueing, per-recipient
gating, unsubscribe) is verified live per above; the actual email delivery + inbox rendering + a real
one-click unsubscribe round-trip needs a logged-in Moroni session against the branch preview. The
recipient loop's synchronous-execution-time risk at real campaign scale (see workers section above)
is also disclosed, not silently capped.
**Sending-subdomain flag (per the task's explicit ask)**: this phase sends marketing volume from the
same `restoration@utahpros.app` address `EMAIL-DELIVERABILITY.md` documents for transactional mail
(esign, invoices, 2FA). That file's own §5 already recommends a dedicated sending subdomain
(`send.utah-pros.com`) as "the highest-impact upgrade" specifically to protect a shared domain's
reputation once volume increases — marketing sends are exactly that increase. No code change is
needed to adopt it (`EMAIL_FROM`/`EMAIL_REPLY_TO` env vars, already read by `functions/lib/email.js`)
but it wasn't set up in this session (a new Resend-verified subdomain + DNS records, which needs
Moroni's access to `utah-pros.com` DNS) — flagged here rather than silently reusing the transactional
sender at real volume.

**Dogfooding**: `crm_build_stages` for `phase-4c` reconciled and `crm_build_phases('4c')` status set
via the status RPCs — see the close-out reconciliation in this session for exactly which stages
flipped to `done` vs. stayed `todo` (the owner-gated real-send/visual-check items stay open, with the
reason stated above, not silently marked done).

## Roadmap v3 — gap audit + parallel-wave dispatch model (session 2026-07-02, docs/seed only — no feature code)

**What this session shipped** (branch `claude/new-session-vloxml` → PR into `dev`):
- `docs/crm-roadmap.md` → new **"Roadmap v3"** section (the dispatch model of record): live-DB status
  reconciliation, evidence-based gap-audit appendix (capability taxonomy A–J, verdicts only from
  code/schema, adversarially re-verified by a 10-agent challenge pass), and seven new phase blocks —
  **F (Foundation), 6a, 6b, 7, 8, 9, 10 (CRM Forms)**. The old strict-sequential rule is superseded:
  Phase F ships ALL schema/interfaces/wiring first, then 4d/6a/6b/7/8/9/10 run as ONE parallel wave
  (4b joins whenever A2P carrier approval lands). File-ownership matrix + frozen-file list will be
  committed by Phase F as `.claude/rules/crm-wave-ownership.md`.
- `supabase/migrations/20260702_crm_roadmap_v3_phases.sql` — **applied + verified live**: seeds
  phases F/6a/6b/7/8/9/10 (sort 9–15, all `planned`) + their close-out stages into
  `crm_build_phases`/`crm_build_stages` (idempotent ON CONFLICT DO NOTHING), plus one additive
  Phase 1 stage: **form-capture verification** (the CallRail form path is wired but untested at every
  layer — no `mapFormPayload` test, no form-ingestion test, payload shape guesswork).
- `.claude/agents/migration-safety-checker.md` (sonnet, read-only — additive-only/RLS/org_id/
  external-ID-upsert/backward-compatible-REPLACE/frozen-stub rules) and
  `.claude/agents/consent-path-auditor.md` (sonnet, read-only — every send call site must route
  through `sendAutomatedMessage()`/`sendGatedEmail()`; flags `skip_compliance`/direct sends in
  automation context). Both run before every wave-phase PR.
- `CLAUDE.md` → CRM Phase Workflow amended: foundation-then-parallel-wave model, zero-schema rule
  for wave sessions (function-body-only replaces of own frozen stubs), backward-compatible-REPLACE
  rule, dependency graph supersedes strict-sequential.

**Key audit findings recorded in the roadmap appendix** (full evidence there):
- **P0 (latent, exposure verified zero):** live `merge_contacts` reassigns only 14 legacy FKs before
  deleting the loser — a merge today CASCADE-deletes the loser's `lead_attribution` +
  `email_campaign_recipients` + `email_campaign_exclusions` rows and SET-NULLs their
  `inbound_leads.contact_id`. Neither it nor `get_duplicate_contacts` exists in `supabase/migrations/`
  (schema drift). **Fix ships first-thing in Phase F**; until then don't merge contacts with CRM
  activity. Merge UI already exists (`MergeModal.jsx` ×5 pages + DevTools).
- Weighted pipeline is a positional ramp (`stageWeight()` = (pos+1)/(open+1)), not probability —
  Phase 9 adds `pipeline_stages.win_probability` (F schema) with positional fallback.
- Email consent gate re-confirmed structurally unbypassable; `transcript_analysis` render confirmed.
- `system_events` audit gaps (campaign exclusions/edits/deletes, per-recipient suppression;
  duplicate empty-payload `crm_email_campaign_sent`) → Phase 6b audit hardening.
- Phase 4b remains blocked on A2P 10DLC carrier approval (external); Phase F pre-builds the
  `automated-send.js` sms branch + `consentAllows()` behind an `automation_settings.sms_sending_enabled`
  kill-switch so 4b/4d/8 never edit that file.

**Dispatch (see roadmap v3 section for the full model):** Wave 0 = Phase F (Opus·high) ∥ Phase 1
close-out (Sonnet·medium). Wave 1 (after F merges) = 4d·6a·6b·7·8·9·10 in parallel, per-phase cold
prompts generated after F commits its artifact names. Owner pre-decisions at dispatch: CallRail Form
Tracking replacement intent (forks Phase 1's form-fixture stage) and Cloudflare Turnstile site key
(Phase 10, or ships toggle-off).

---

## /masterplan skill — reusable planning recipe (session 2026-07-02, docs only)

`.claude/skills/masterplan/SKILL.md` — codifies the roadmap-v3 planning standard as a
one-line-invocable skill for ANY UPR initiative: `/masterplan <initiative>` in a fresh
session (strongest model, high effort, plan mode, "ultracode" in the message). The skill
walks the session through: live-verified state + finish-first list → evidence-only gap
audit (HAVE/PARTIAL/MISSING, exposure-checked bug findings) → ROI-ordered phase design
(options-on-record evaluations, decision forks, external hard gates) → Foundation-then-
parallel-wave restructure (frozen signatures, ownership manifest, kill-switch pre-builds,
what-resisted ledger) → mandatory adversarial challenge pass (refute-first verdicts,
disjointness proofs, counter-ordering) → present-and-wait → on go, commit the roadmap
section + idempotent tracker seeds (CRM tracker for CRM initiatives; doc checklists
otherwise — no generic tracker exists) + `docs/<slug>-dispatch.md` cold-session blocks +
any 3-plus-phase-recurring agents, ending with Wave-0 blocks. Built against a 2-agent
extraction benchmark of the roadmap-v3 artifacts and adversarially critiqued
(completeness + cold-usability, both SHIP_WITH_EDITS, findings folded in). Worked
example it points sessions at: docs/crm-roadmap.md "Roadmap v3" + docs/crm-dispatch.md.

---

## CRM Phase F — Foundation (Jul 2 2026 — shipped)

Owns 100% of the wave's schema + interfaces + wiring; downstream wave phases ship zero schema.
Migrations (all applied + verified live, additive-only, RLS + explicit policy + org_id at creation):
**Filenames renamed 2026-07-17** (`phaseF` → `phase0F`, content unchanged) — the bare `phaseF`
prefix sorted *after* `phase10` lexicographically, putting Foundation's schema-creating migrations
below phases that consume that schema in a fresh replay/drift-check ordering. `phase0F` sorts first
as intended. Already-applied migrations were not re-run — this is a filename-only fix, documented
via a rename-rationale header in each file (see `20260702_crm_phase0F_rpc_stubs.sql`).

- `20260702_crm_phase0F_merge_contacts_safety.sql` — **P0 fix.** Captures the drifted live
  `merge_contacts` body as a migration and supersedes it: now reassigns `lead_attribution`,
  `email_campaign_recipients`, `email_campaign_exclusions` (dedupe on their `UNIQUE(campaign_id,
  contact_id)`) and `inbound_leads.contact_id` onto the survivor **before** deleting the loser.
  Signature unchanged. Proof: `supabase/tests/crm_merge_contacts_safety.test.js`. Merges are now
  CRM-history-safe.
- `20260702_crm_phase0F_wave_schema.sql` — new tables: `automation_settings` (per-org; SMS
  kill-switch `sms_sending_enabled` **default OFF** + 4 per-automation toggles; one row per org
  seeded), `crm_tasks`, `lead_stage_history` (append-only pipeline history), `crm_segments`,
  `crm_import_batches`, `crm_sequences`/`crm_sequence_steps`/`crm_sequence_enrollments`
  (`UNIQUE(sequence_id, contact_id)` → enroll idempotency), `lead_score_factors`,
  `form_definitions`/`form_definition_versions`/`form_submissions` (`public_id` +
  `submission_token` UNIQUE). New columns: `inbound_leads.lost_reason` + `.lead_score`,
  `contacts.owner_id` + `.lifecycle_status`, `pipeline_stages.win_probability` (0..1, NULL →
  positional fallback).
- `20260702_crm_phase0F_shared_rpc_replaces.sql` — the **only two** live-RPC REPLACEs of the wave:
  `move_lead_to_stage` gains `p_lost_reason DEFAULT NULL` + writes a `lead_stage_history` row per
  move (dropped 3-arg + recreated 4-arg, no overload ambiguity; shipped 4a caller still works);
  `get_contact_activity` gains email/jobs/tasks arms (same 1-arg signature + columns). Proof:
  `supabase/tests/crm_shared_rpc_compat.test.js`. **Wave phases must NOT re-REPLACE these.**
- `20260702_crm_phase0F_rpc_stubs.sql` — 30 signature-frozen stubs (SECURITY DEFINER, GRANT anon +
  authenticated, body `RAISE EXCEPTION 'not implemented (phase X)'`), one owner phase each. Exact
  signatures + ownership in `.claude/rules/crm-wave-ownership.md`. Covers 4d(2), 6a(5), 6b(3),
  7(5), 8(4), 9(8: score_lead + 7 reports), 10(3).

Consent gate (frozen after F): `functions/lib/sms-consent.js` `consentAllows({phone,opt_in_status,
dnd})` (TCPA opt-in predicate, twin of `emailAllows`) + unit tests; `functions/lib/automated-send.js`
sms branch fully built — `sendGatedSms()` gates on the `sms_sending_enabled` kill-switch (default OFF)
then `consentAllows()`, sends via `twilio.js`, audits every outcome to `sms_consent_log`
(`automated_send`/`send_blocked_disabled`/`send_blocked_dnd`/`send_blocked_no_consent`/
`send_blocked_no_phone`/`send_failed`); `sendAutomatedMessage('sms', …)` routes through it. Unit test
`functions/lib/automated-send.test.js` proves OFF→no send, ON+no-consent→no send, ON+consent→sends.
Result: 4b/4d/8 never edit `automated-send.js`; 4b's remaining scope = external A2P registration +
flag flip + `Marketing.jsx`.

Shared code + frontend: `functions/lib/phone.js` (`normalizePhone` worker twin of `src/lib/phone.js`)
+ tests; `src/components/crm/ActivityTimeline.jsx` extracted from `CrmLeads.jsx` (behavior-identical,
self-loading); `CrmOverview.jsx` renders `OverdueTasksWidget` (Phase 7) + `ForecastWidget` (Phase 9)
slot stubs; `CrmContacts.jsx` skeleton renders `ContactsDirectory`/`ContactDetail` (6a) +
`ImportExportPanel`/`MergeTool` (6b) slot stubs (all in `src/components/crm/`); `CrmConversations`/
`CrmSequences`/`CrmForms` stub pages seeded (own CrmStubPage) so App.jsx stays frozen.

Wiring (frozen in-wave): `App.jsx` routes (`/crm/contacts|conversations|sequences|forms`);
`CrmLayout.jsx` nav (13 items) + `crmIcons.jsx` (IconContacts/Conversations/Sequences/Forms);
`index.css` Contacts-skeleton CSS + 8 reserved per-phase section markers.

Ownership manifest `.claude/rules/crm-wave-ownership.md` committed (frozen-file list, per-session
owned files, exact frozen stub signatures, migration + index.css rules) — each wave session's read
scope = CLAUDE.md + its phase block + this manifest. `crm_lead_stage_changed` `system_events` payload
now also carries `from_stage_id` + `lost_reason`.

Extra consent-safety fix (from the consent-path-auditor pass): `merge_contacts` now also reconciles
the survivor's consent flags to the more-restrictive record — `dnd` OR'd, `opt_in_status` false if
EITHER opted out, opt-out audit (`dnd_at`/`opt_out_at`/`opt_out_reason`) carried forward — so a merge
can't resurrect contactability a duplicate had revoked (TCPA). Regression-tested in the merge safety
suite.

**`crm_build_stages` reconciliation (honest):** 7 stages. Flipped **done** (real, verified work):
test-first suites; acceptance (schema+stubs+consent gate+slots+wiring+manifest all built & applied
live); `npm test`/`build`/`eslint` pass; UPR-Web-Context updated; reviewer gauntlet
(migration-safety-checker fixed→clean, upr-pattern-checker clean, consent-path-auditor PASS,
crm-phase-reviewer conditional-SHIP→both conditions met). The **visual-preview** and **push/verify/PR**
tail stages are the mechanical close-out, flipped as they complete (not owner-gated, not forgotten).
Phase `F` set `shipped` at close-out per the CRM workflow (commit → set shipped → PR). **Test-runner
caveat:** the two integration suites (`crm_merge_contacts_safety`, `crm_shared_rpc_compat`) self-skip
without CI creds and cannot run from this sandbox (network egress blocks the Supabase host — only the
MCP path is allowed); their behavior was instead verified directly against the live shared DB via
Supabase MCP (rollback DO-blocks), results captured in the PR. They execute green in CI/an
allowlisted env.

## CRM Phase 6a — Contacts read & segments (Jul 2 2026 — shipped)

Wave-1 phase (ran beside 6b). **Zero schema migrations** — one function-body-only migration
`20260702_crm_phase6a_contacts_segments.sql` fills five frozen 6a stubs + backward-compat-replaces
one live RPC. Edits confined to the two owned slot files + the Phase 6a `index.css` reserved section
(all per `.claude/rules/crm-wave-ownership.md`).

**RPCs (bodies filled; signatures unchanged from Phase F stubs):**
- `get_crm_contacts(p_search, p_limit, p_offset, p_org_id) → SETOF json` — searchable, paged
  directory. Matches name/email/company (ILIKE) + phone (digits-only LIKE). Each row carries
  `total_count` (`count(*) OVER ()` over the full pre-pagination match set) so the UI pages without a
  second count query. `contacts` has no `org_id` (one global book) so `p_org_id` is accepted but does
  not scope rows.
- `get_contact_consent(p_contact_id) → json` — **unified do-not-contact read.** `do_not_contact` =
  `dnd` OR `opt_out_at IS NOT NULL` OR email in `email_suppressions` (case/space-insensitive
  `lower(btrim(...))` match). Returns `{ contact_id, do_not_contact, sms:{dnd,opted_out,opt_out_at,
  opt_out_reason}, email:{address,suppressed,reason,suppressed_at} }`. **`opt_in_status` is
  deliberately NOT used** — it defaults `false` for all 117 contacts (an un-opted-in state, not an
  opt-out), so keying DNC off it would flag the whole book. This RPC is the single source of truth for
  the badge — never re-derive from raw columns.
- `upsert_segment(p_id, p_name, p_description, p_filter, p_org_id, p_created_by) → crm_segments`,
  `get_segments(p_org_id) → SETOF crm_segments`, `delete_segment(p_segment_id) → void` — segments CRUD.
  A segment's `filter` jsonb uses the **exact shape `preview_email_audience` consumes**
  (`{ referral_source, role, tag, city, company, search }`), so a saved segment is a drop-in campaign
  audience. Org defaults to the first non-test `crm_orgs` row (same pattern as `create_manual_lead`).
- `get_duplicate_contacts()` — **backward-compatible body-replace** (same
  `RETURNS TABLE(phone_normalized text, contact_ids uuid[], names text[], count bigint)`). Now
  UNION-es email-normalized groups (`lower(btrim(email))`) onto the existing phone groups; for an email
  group the `phone_normalized` column carries the normalized email (it's the group's match key, not
  necessarily a phone). The one shipped caller (`DevTools.jsx` "Scan for Duplicates") reads the same
  columns and keeps working. **Follow-up for 6b (owns `DevTools.jsx`):** that view's `formatPhone()`
  will garble email match-keys on display (cosmetic; no error) — branch on group type there.

**Components (owned slot files rendered by the frozen `CrmContacts.jsx` skeleton):**
- `src/components/crm/ContactsDirectory.jsx` — debounced search + pagination (25/page) over
  `get_crm_contacts`; collapsible Segments panel with CRUD, inline two-click delete, and a live preview
  count per segment via `preview_email_audience(filter)`.
- `src/components/crm/ContactDetail.jsx` — read-only: contact info + tags, the unified DNC badge (red
  "Do not contact" + reason line, or green "Contactable") from `get_contact_consent`, and the shared
  `ActivityTimeline`. Owner/lifecycle setters land in 6b.

**Tests:** `supabase/tests/crm_phase6a_contacts_segments.test.js` (test-first, committed failing before
the bodies existed): consent unified-DNC read across all three sources; segment filter round-trip (saved
filter → `preview_email_audience` count matches a direct query); email-normalized dup detection.
Integration suite (self-skips without CI creds, same as sibling CRM suites) — behavior verified live via
Supabase MCP: dnd/opt-out/suppressed each read `do_not_contact=true`, clean reads `false`; directory
`total_count` correct; a saved segment matched 2 contactable of 3 tagged (the dnd one excluded); email
dup group detected. `npm test` 193 passed / 25 skipped, `npm run build` green, eslint clean on changed
files. Foundation's `merge_contacts` safety fix confirmed present + its `crm_shared_rpc_compat` /
`crm_merge_contacts_safety` suites green.

Reviewer gauntlet: migration-safety-checker **clean** (signatures frozen, zero DDL, grants present);
upr-pattern-checker **clean** (CSS token fixes applied). Isolation stays the `page:crm` flag —
`/crm/contacts` invisible to staff until 6b opens it.

## CRM Phase 6b — Ownership, CSV import, staff roles & audit hardening (Jul 2 2026 — shipped)

Wave-1 phase (ran beside 6a). **Zero schema migrations** — one function-body-only migration
`20260702_crm_phase6b_rpcs.sql` fills three frozen 6b stubs + backward-compat-replaces four live
Phase 4c email-campaign RPCs (audit hardening). Edits confined to the owned files
(`ImportExportPanel.jsx`, `MergeTool.jsx`, `Admin.jsx`, `DevTools.jsx`, `featureFlags.js`,
`CrmLayout.jsx` role-gating only) + the Phase 6b `index.css` reserved section — all per
`.claude/rules/crm-wave-ownership.md`.

**RPCs (bodies filled; signatures unchanged from Phase F stubs / Phase 4c):**
- `import_contacts(p_rows jsonb, p_org_id, p_created_by, p_filename) → crm_import_batches` — CSV import
  with **dedupe-on-import**. Each incoming row matches an existing contact on **normalized phone**
  (last-10-digits, same convention as `get_duplicate_contacts`; a phone needs ≥10 digits to be a key)
  OR **normalized email** (`lower(btrim(...))`). A match → **fill-blanks UPDATE** (`COALESCE(existing,
  incoming)` — import never clobbers a curated value); no match → INSERT. The lookup re-queries
  `contacts` per row so duplicates **within one file** collapse too. A row with neither phone nor email
  is `skipped` (recorded in the batch `errors`); a row that throws is `errored` and the loop continues
  (one bad row can't lose the file). Writes a `crm_import_batches` audit row (org-scoped —
  `contacts` itself has no `org_id`) + a `crm_contacts_imported` system_event. Supported target fields:
  name, email, phone, phone_secondary, company, role, referral_source, notes, billing_address/city/
  state/zip, lifecycle_status, owner_id, tags. `contacts.phone` has a UNIQUE constraint — the
  normalized match prevents insert collisions.
- `set_contact_owner(p_contact_id, p_owner_id, p_actor_id) → contacts` — sets/clears `owner_id`
  (NULL unassigns; a non-null owner must be a real `employees` row); emits `crm_contact_owner_set`
  with `{owner_id, previous_owner_id}`.
- `set_contact_lifecycle(p_contact_id, p_lifecycle_status, p_actor_id) → contacts` — sets/clears
  `lifecycle_status`, gated to a fixed vocabulary **`lead | prospect | customer | past_customer |
  archived`** (the column is free-text with no CHECK; this RPC is the gate). Emits
  `crm_contact_lifecycle_set` with `{lifecycle_status, previous_status}`.
- **Audit-hardening body-replaces** (signatures + behavior unchanged, add `system_events` only —
  closes the "Audit trail PARTIAL" gap): `set_campaign_exclusions` → `crm_email_campaign_exclusions_set`
  `{excluded_count, audience_count}`; `upsert_email_campaign` → `crm_email_campaign_created` /
  `crm_email_campaign_updated`; `delete_email_campaign` → `crm_email_campaign_deleted` `{name, status}`
  (name captured pre-delete). **`record_email_campaign_send`**: the `crm_email_campaign_sent` event now
  fires **exactly once** — gated on `FOUND` from the `status='sending'→'sent'` UPDATE, so a
  retried/duplicate send on an already-sent campaign no longer emits a second empty event — and carries
  a `{sent, suppressed, failed, total}` counts payload (was empty `{}`). Shipped callers
  (`src/pages/crm/CrmCampaigns.jsx`, `functions/api/send-email-campaign.js`) unchanged and still pass.

**Components:**
- `src/components/crm/ImportExportPanel.jsx` (Contacts "Import / Export" slot) — browser-side quote-aware
  CSV parse → column-mapping UI (auto-guesses target from header names) → optional default owner +
  default lifecycle stamped on all rows → `import_contacts` → created/updated/skipped/error summary +
  a "Recent imports" audit list from `crm_import_batches`. Export streams all contacts to a CSV Blob.
- `src/components/crm/MergeTool.jsx` (Contacts "Find duplicates" slot) — two tabs: **Duplicates**
  (`get_duplicate_contacts` groups → pick keeper → sequential `merge_contacts` per loser, inline
  two-click confirm) and **Owner & lifecycle** (contact search → `set_contact_owner` /
  `set_contact_lifecycle`). **Placement note:** the owner/lifecycle setters live here, not in
  `ContactDetail.jsx` — that file is Phase 6a's, frozen read-only for the wave, and the frozen
  `CrmContacts.jsx` skeleton exposes no 6b detail-slot. MergeTool (a data-quality panel) is the
  wave-compliant home; when 6a/6b later reconcile, these could move into the detail.
- `src/components/CrmLayout.jsx` (role-gating only) — **per-screen staff gating**: a CRM screen is
  visible when `isFeatureEnabled('feature:crm_<screen>')` (rollout sub-flag; absent/enabled = open) AND
  `canAccess('crm_<screen>')` (per-employee override → admin → role `nav_permissions`). Enforced in both
  the nav filter and an **Outlet route guard** (direct-URL nav can't bypass the hidden nav; shows a
  "No access" panel). Overview is always reachable (CRM home); `crm_partner` accounts keep the whole CRM
  except Integrations (unchanged). Nav keys normalize hyphens → underscores (`call-log` → `crm_call_log`).
- `src/pages/Admin.jsx` — CRM per-screen keys (`crm_leads … crm_settings`) added to the role×nav_key
  matrix (PermissionsTab) **and** the per-employee override list (PageAccessTab, new "CRM" section), so
  roles are defined per screen **before** `page:crm` opens to staff.
- `src/lib/featureFlags.js` — registers the twelve `feature:crm_*` per-screen sub-flags (default ON =
  unrestricted) so they appear in DevTools for per-screen rollout/dev-only control.
- `src/pages/DevTools.jsx` — the duplicate-scan view now shows an email match-key as-is instead of
  running it through `formatPhone` (the cosmetic 6a follow-up).

**Isolation / rollout:** still the `page:crm` flag (dev-only to Moroni). **Opening `page:crm` to staff
gates on this phase** — the per-screen roles now exist; the flag flip itself is the owner's, post-merge.

**Tests:** `crm_phase6b_import_ownership.test.js` + `crm_phase6b_audit_hardening.test.js` (test-first,
committed failing before the bodies): import dedupe (existing-phone → update not create; within-file
email collapse; unmatchable row skipped), owner/lifecycle setters + events + junk-lifecycle rejection;
all four audit events fire; campaign-sent de-duplicated with counts. Integration suite (self-skips
without CI creds) — behavior **verified live via Supabase MCP**: dedupe A=0/1/0 (1 contact for the
phone), within-file B=1/1 (1 contact for the email), skip C recorded, owner+lifecycle set with events,
junk lifecycle rejected, campaign create/update/exclusions/delete events present, sent event fires once
with `{sent:1,total:1}` on a retried call, campaign flips to `sent`. All TEST rows + audit events
cleaned. `npm test` 216 passed / 34 skipped, `npm run build` green, eslint clean on changed files
(Admin.jsx's 12 errors are pre-existing — zero added).

Reviewer gauntlet: migration-safety-checker **clean** (zero DDL, 7 signatures frozen, grants present),
consent-path-auditor **PASS** (no send call sites added; `record_email_campaign_send` change is an
audit-log fix downstream of the consent decision; send gate untouched), upr-pattern-checker **clean**
(one two-click-confirm `onBlur` nit fixed), crm-phase-reviewer **SHIP** (all money/consent/audit code
correct + backward-compatible). Note: `import_contacts` sets `owner_id` from CSV without an explicit
employee-existence check like `set_contact_owner`, but `contacts.owner_id` carries an FK to
`employees(id)` so a bad id errors that one row (caught → `error_count`), and the UI only supplies real
employee ids — low risk, FK-backstopped.

**`crm_build_stages` reconciliation (honest): 7 stages — 6 flipped `done`, 1 left `todo`.** Done:
test-first, acceptance (slots/owner/lifecycle/roles), test+build+eslint/zero-schema, reviewer gauntlet,
UPR-Web-Context updated, and set-shipped/TEST-rows-deleted/pushed/PR-opened. **Left `todo` (owner-gated,
NOT forgotten):** *"Visual: import wizard + role-gated nav on preview"* — the CRM is invisible behind
the dev-only `page:crm` flag, so on-preview visual confirmation is the owner's after the flag opens.
Build-verified here (compiles + renders); there is no `blocked` status value yet, so it stays `todo`
with this disclosure (same convention as sibling phases).

## CRM Phase 4d — Fixed automations (Jul 2 2026 — shipped)

Wave-1 phase (cut from `dev`). Ships the four fixed automations as a cron worker + owner toggles.
**Zero schema migrations** — the `automation_settings` table, its RLS/policy, the SMS kill-switch
`sms_sending_enabled`, and the 4 per-automation toggle columns are all Foundation-owned; this phase
only filled two frozen RPC stub bodies and added a worker + UI.

**Worker — `functions/api/run-automations.js`** (new; `onRequest*` authenticated manual trigger +
`scheduled()` for a Cloudflare Cron Trigger; one `worker_runs` row per run). Four automations, each
individually gated by its `automation_settings` toggle:
- **speed-to-lead** (SMS) — texts a brand-new answered call / form lead within a 60-min lookup window.
- **missed-call text-back** (SMS) — texts back an unanswered inbound tracking-number call.
- **no-response follow-up** (email, **live**) — emails an open (`lead_status='new'`) lead quiet for
  3–30 days (`isStale`).
- **job-complete review request** (email, **live**) — emails a Google-review ask when a
  `job_phase_history` row lands on a `completed` phase; recipient = `jobs.primary_contact_id`.

Every send routes through `sendAutomatedMessage()` (Foundation's frozen gate) — this worker never
touches `twilio.js`/`email.js`/`send-message.js` and never passes `skip_compliance`. Each fired
trigger writes a `system_events` row whose `event_type` is the substrate a future rule engine would
subscribe to: `speed_to_lead→lead_created`, `missed_call_textback→call_missed`,
`no_response_followup→lead_stale`, `review_request→job_completed` (payload `{automation, channel,
outcome, reason}`). **Idempotency**: `alreadyFired(event_type, entity_id)` on `system_events` means a
lead/job is contacted at most once per trigger; only a TERMINAL outcome writes the row.
**Consent skips are durable** — recorded in `system_events` for every channel, plus `sms_consent_log`
for SMS (via the frozen gate). Copy prefers a `message_templates` row by title, hardcoded fallback
otherwise; SMS bodies append "Reply STOP to opt out." Review link = `env.GOOGLE_REVIEW_URL` (fallback
`https://utahpros.app`).

**SMS-experience Phase D (Jul 9 2026) — F-10 held-retry + throughput.** The terminal/idempotency rule
above was refined so a **deferred** text is never permanently dropped: `fireAutomation` now writes the
terminal `system_events` row only for `sent`, a **durable** consent-skip (dnd/no_consent/no_phone), or a
**PERMANENT** send failure (invalid number, via `sendGatedSms`'s additive `{permanent}` flag). A
**deferrable** skip (`quiet_hours` / `sms_disabled` — `DEFERRABLE_SKIP_REASONS`) and a **transient**
failure (429/5xx) write NO row, so the lead stays a candidate and retries once the window lifts. To keep
an after-hours lead visible until 8am, the two SMS automations' candidate lookback widened from 60 min to
a **13h overnight window** (`OVERNIGHT_DEFER_LOOKBACK_MIN`; email windows unchanged). Real SMS sends are
**MPS-paced** (`paceSms`, `SMS_PACE_MS` env, default 250 ms, injectable/0 in tests) between sends. The
per-recipient quiet-hours timezone, 429 backoff, statusCallback and in-thread mirror all live in
`automated-send.js` (see its entry). Zero schema.

**SMS is dark, doubly.** The two SMS automations are skipped entirely at the worker level unless
`sms_sending_enabled` is ON (`smsLive` guard — no queries, no burned idempotency rows while dark), and
even if that guard were removed, `sendGatedSms` in the frozen `automated-send.js` independently
refuses to text while the kill-switch is OFF. Phase 4b flips `sms_sending_enabled` ON after A2P 10DLC
carrier approval — no code change needed here. Email automations run on their own toggles regardless.

**RPCs — `supabase/migrations/20260702_crm_phase4d_automation_rpcs.sql`** (function-body-only
`CREATE OR REPLACE`, signatures byte-for-byte identical to Foundation's stubs, both SECURITY DEFINER +
GRANT anon/authenticated):
- `get_automation_settings(p_org_id uuid DEFAULT NULL) → automation_settings` — resolves the org
  (`COALESCE(p_org_id, first non-test org)`), lazily creates the row, returns it.
- `set_automation_setting(p_key text, p_value boolean, p_org_id uuid DEFAULT NULL) → automation_settings`
  — whitelists `p_key` against the 5 real boolean columns before a `format('… %I …')` UPDATE (no
  arbitrary-column write), returns the updated row.
Applied + verified live: get resolves the real org, toggles flip and persist, invalid key rejected,
`sms_sending_enabled` stays OFF, the shipped `sendGatedSms` caller still succeeds.

**UI — `src/pages/crm/CrmSettings.jsx`**: an "Automations" card (loads `get_automation_settings`,
toggles via `set_automation_setting`) with 4 switches, per-automation Text/Email badge, and a banner
explaining the two SMS automations stay dark until the global SMS switch is on. Styles live in the
`CRM WAVE RESERVED — Phase 4d` marker in `src/index.css` (tokens only). Backend does the sending; this
page only flips flags.

**Tests** (`functions/api/run-automations.test.js`, committed failing first): `isStale` + the three
other trigger predicates; each automation fires the correct `system_events` type via injected fake
db + send; consent-block leaves a durable `skipped` record; a fired trigger never re-fires. Full
vitest suite 214 passed / 19 skipped; `npm run build` + `npx eslint` (3 changed source files) clean.

**Reviewer gauntlet:** migration-safety-checker PASS (no schema, signatures frozen, injection
mitigated); consent-path-auditor PASS (double kill-switch, no bypass, durable skips, frozen gate
untouched); upr-pattern-checker + crm-phase-reviewer — see the PR.

**`crm_build_stages` reconciliation (honest):** 5 stages, all flipped **done** — test-first suite,
acceptance (4 automations route through the gate + fire system_events + toggleable), test/build/eslint
+ auditor gauntlet, the Settings toggle UI, and the mechanical close-out (phase set `shipped`, this
doc updated, PR opened). No test automation rows were seeded against production data — the automation
toggles were exercised only via the `set_automation_setting`/`get_automation_settings` RPC round-trip
and reset to OFF (verified live), so there are no test rows to delete. **Live-send verification is
owner-gated:** the SMS paths cannot fire an end-to-end text until Phase 4b flips `sms_sending_enabled`
(carrier approval), and the email paths only send against a real completed job / stale real lead — so
no real message was dispatched from this session by design. `crm_build_phases('4d')` set `shipped`.

## CRM Phase 9 — Intelligence: scoring, forecasting, reports, AI digest (Jul 2 2026 — shipped)

Wave-1 phase (cut from `dev`). Adds rule-based lead scoring, a weighted pipeline forecast, a fixed
report set, and a weekly AI digest. **Zero schema migrations** — every table/column it consumes
(`pipeline_stages.win_probability`, `inbound_leads.lead_score`, `lead_score_factors`,
`lead_stage_history`) is Foundation-owned; this phase only filled 8 frozen RPC stub bodies and added
UI + one worker. All displayed money math lives in the pure, unit-tested JS layer — the RPCs return
raw counts only (the Phase 3 convention).

**Money/decision math — `src/lib/crmPipeline.js` + `src/lib/attribution.js` (+ tests, test-first):**
- `stageWeight(stage, sortedStages)` now **prefers `pipeline_stages.win_probability` (0..1)** and falls
  back to the existing positional ramp when it is null/undefined/out-of-range; `is_won`→1 / `is_lost`→0
  stay terminal. `get_pipeline_stages` already returns the column. The Leads board's
  `weightedPipelineValue` inherits this automatically (same tested function).
- `classifyLeadChannel` / `scoreLeadFactors` / `scoreLead` — deterministic, **no ML**. Five factors,
  clamped 0..100: source (channel via crm_channel_for_source buckets), engagement (answered-call
  duration / form / missed), speed-to-first-touch (minutes), transcript sentiment, transcript
  urgency-topic keywords. Spam hard-zeros to a single factor. The SQL `score_lead` mirrors this exact
  point table.
- `attribution.js` gains `deriveConversionTrend`, `deriveLeaderboard`, `speedToLeadSummary`,
  `ltvSummary` — all with the same div-by-zero-guard / "real 0 ≠ —" conventions as the Phase 3 helpers.

**RPCs — `supabase/migrations/20260702_crm_phase9_intelligence_rpcs.sql`** (function-body-only
`CREATE OR REPLACE`, signatures byte-for-byte identical to Foundation's stubs; SECURITY DEFINER +
GRANT anon/authenticated; applied + verified live):
- `score_lead(p_lead_id) → integer` — mirrors the JS rule table; persists a 5-row breakdown to
  `lead_score_factors` + the clamped total to `inbound_leads.lead_score`; writes a `crm_lead_scored`
  `system_events` row. Speed-to-first-touch: answered inbound call = 0 min, else earliest outbound
  staff message after the lead (defensive, NULL on any lookup issue).
- `get_conversion_trend` (monthly leads→estimates→won→revenue), `get_estimator_leaderboard`
  (per `jobs.estimator`), `get_call_volume` (daily answered/missed), `get_speed_to_lead`
  (creation→first-move buckets, `within_sla` flag on ≤5-min), `get_estimate_aging` (submitted-not-
  converted by age), `get_pipeline_movement` (per-stage in/out/net), `get_contact_ltv` (top-25 or one
  contact by won-job revenue). All return `SETOF json` raw counts. Live parity check: a real
  answered-call lead scored **31**, matching the JS `scoreLead`.
- **History-backed honesty:** `get_speed_to_lead` + `get_pipeline_movement` carry a `data_since`
  (earliest `lead_stage_history.moved_at`) so the UI renders "Since <date>" — the log only accrues
  from Foundation's `move_lead_to_stage` replace onward, never implying older history.

**UI:**
- `src/components/crm/ForecastWidget.jsx` — fills the Overview slot: weighted-pipeline-forecast
  headline + per-open-stage breakdown (win % from `stageWeight`). Fails quiet (non-critical card).
- `src/pages/crm/CrmReports.jsx` — the full report set (conversion trend, estimator leaderboard,
  speed-to-lead SLA with since-caption, call volume, estimate aging, pipeline movement with
  since-caption, top-customer LTV) alongside the existing Source ROI / division / funnel cards. CSS in
  the `CRM WAVE RESERVED — Phase 9` marker (tokens only; one `@media (max-width:768px)` rule).

**Worker — `functions/api/weekly-crm-digest.js`** (new; `onRequest*` authenticated manual trigger +
`scheduled()` for a weekly Cloudflare Cron Trigger; one `worker_runs` row per run). Gathers 7-day
pipeline movement (RPC), stale open leads, and week-over-week ad-spend anomalies (±40%, div-by-zero
guarded); Claude (`claude-sonnet-5`) **summarizes only the numbers we computed** (deterministic
fallback digest when `ANTHROPIC_API_KEY` is absent); sends via `sendGatedEmail` (**import-only** from
the frozen `automated-send.js` — never `sendEmail`/twilio directly, no `skip_compliance`). Recipients
resolve `env.CRM_DIGEST_RECIPIENTS` → `env.OWNER_EMAIL` → the `crm_digest_recipients` row in
`integration_config` (comma-separated); with none set the worker still runs and sends nothing. Pure
helpers (`parseRecipients`, `spendAnomalies`, `isStaleLead`, `buildFallbackDigest`) unit-tested.

**Scheduling — Supabase pg_cron + pg_net (live, no Cloudflare dashboard needed).** The worker's HTTP
trigger authenticates EITHER a logged-in employee (manual UI) OR an `x-webhook-secret` header matching
`integration_config.crm_digest_secret` — the CallRail/Encircle webhook-secret pattern (the `scheduled()`
Cloudflare-cron export still works too, if ever configured). A weekly `pg_cron` job **`weekly-crm-digest`**
(jobid 3, `7 14 * * 1` = Mon 14:07 UTC ≈ 8am Denver) `net.http_post`s `https://utahpros.app/api/weekly-crm-digest`
with that secret header. Secret + recipient list live in `integration_config`
(`crm_digest_secret`, `crm_digest_recipients` = `moroni.s@utah-pros.com` initially — widen by updating
that row, no deploy). **Activates once this worker is deployed to production** (the endpoint 404s until
then, harmless). To change: `UPDATE integration_config SET value=… WHERE key='crm_digest_recipients';`
to add recipients; `SELECT cron.unschedule('weekly-crm-digest');` to stop it.

**AI reply suggestions — `src/components/crm/AiReplySuggestions.jsx`** (new): standalone, **draft-only**
(no send path — a human sends). Contextual template drafts with an injectable async `generate` prop for
a future AI endpoint. **NOT wired** — Phase 7 (`CrmConversations.jsx`) had not merged into `dev` at
ship time, and the dispatch forbids editing an unmerged phase's file, so the one-line wiring
(`<AiReplySuggestions context={…} onUseDraft={setComposerText} />`) is a documented **follow-up**.

**Tests** (committed failing first): `crmPipeline.test.js` (win_probability preference + positional
fallback, score_lead rule fixtures, spam/clamp), `attribution.test.js` (report helpers with guards),
`weekly-crm-digest.test.js` (13 pure-helper tests), `supabase/tests/crm_phase9_intelligence.test.js`
(self-skipping integration: SQL `score_lead` == JS `scoreLead` parity + report row shapes). Full vitest
254 passed / 32 skipped; `npm run build` + `npx eslint` (all changed files) clean.

**Reviewer gauntlet:** consent-path-auditor PASS (digest routes only through `sendGatedEmail`, no
bypass; AiReplySuggestions has no send path). migration-safety-checker / upr-pattern-checker /
crm-phase-reviewer — see the PR.

**`crm_build_stages` reconciliation (honest):** stages 0–3, 5, 6 flipped **done** (test-first suite;
acceptance — report set + forecast widget + digest + draft-only AI replies; test/build/eslint; auditor
gauntlet; doc update; mechanical close-out). The **Visual stage (4)** — "Reports set + forecast widget
on preview" — stays **todo**: `/crm/*` is invisible behind the `page:crm` flag (owner-gated, Phase 6b),
so a branch-preview screenshot can't be produced this session; the build/lint pass and live RPC
verification stand in until the owner opens the flag. `crm_build_phases('9')` set `shipped`.
## CRM Phase 8 — Drip / nurture sequences (Jul 2 2026 — shipped)

Wave-1 phase (cut from `dev`, consent-critical). **Zero schema migrations** — one function-body-only
migration `20260702_crm_phase8_sequences.sql` fills the four frozen Phase 8 stubs; the
`crm_sequences` / `crm_sequence_steps` / `crm_sequence_enrollments` tables + their RLS/policies and the
`UNIQUE(sequence_id, contact_id)` idempotency constraint are all Foundation-owned. Edits confined to the
two owned files (`CrmSequences.jsx`, `functions/api/process-sequences.js`) + the Phase 8 `index.css`
reserved section (per `.claude/rules/crm-wave-ownership.md`).

**RPCs (bodies filled; signatures byte-for-byte identical to Phase F stubs; all SECURITY DEFINER + GRANT
anon/authenticated):**
- `upsert_sequence(p_id, p_name, p_description, p_status, p_steps jsonb, p_org_id, p_created_by) →
  crm_sequences` — create or edit. **`p_steps` semantics:** a jsonb array (incl. `[]`) REPLACES the step
  set; **`NULL` leaves steps untouched** (used by status-only edits — pause/activate/archive). Default is
  `'[]'` (frozen), so a status-only caller must pass `p_steps => null` explicitly. Steps are renumbered
  to a contiguous 0-based `step_order` (respecting any provided order, then array position) so
  `UNIQUE(sequence_id, step_order)` can never be violated by caller input.
- `get_sequences(p_org_id) → SETOF json` — one object per sequence with ordered `steps`, aggregate
  `stats` (`active/paused/completed/exited/total`), and an `enrollments` roster (contact name/phone,
  status, `current_step`, `next_run_at`, `exit_reason`) capped at 200 rows.
- `delete_sequence(p_sequence_id) → void` — FK `ON DELETE CASCADE` takes steps + enrollments.
- `enroll_in_sequence(p_sequence_id, p_contact_id, p_segment_id, p_org_id) → SETOF
  crm_sequence_enrollments` — enroll a single contact OR a whole segment. **Idempotent** via
  `ON CONFLICT (sequence_id, contact_id) DO NOTHING` — re-enrolling returns the existing row, never a
  duplicate. `next_run_at` scheduled from the first step's `delay_hours` (`now() + make_interval`), NULL
  when the sequence has no steps. Segment resolver mirrors `preview_email_audience`'s filter keys
  (`referral_source`/`role`/`tag`) but **omits the email-only / consent constraints** — a sequence can
  carry SMS steps, and consent is enforced per-step at send time, not at enroll (enrollment is not a
  send).

**Worker — `functions/api/process-sequences.js`** (new; `onRequest*` authenticated manual trigger +
`scheduled()` for a Cloudflare Cron Trigger; one `worker_runs` row per run). Advances every active
sequence's due enrollments (`status='active' AND next_run_at <= now`, sequence `status='active'`):
1. **Exit check first** (before spending a send): `exit_on_reply` fires on an inbound `messages`
   (`type='sms_inbound'`, `sender_contact_id`) since `enrolled_at`; `exit_on_conversion` fires on a
   `crm_lead_promoted` `system_events` row (`payload->>contact_id`) since `enrolled_at`. On exit →
   `status='exited'` + `exit_reason` + a `crm_sequence_exited` event.
2. **Send** the current step through `sendAutomatedMessage()` (Foundation's frozen gate — email `subject`
   /`html`, SMS `orgId`/`body`). Never touches `twilio.js`/`email.js`/`send-message.js`, never passes
   `skip_compliance`.
3. **Outcome plan** (`planStepOutcome`, pure/unit-tested): `sent` → advance to next step scheduled by
   ITS `delay_hours`, or complete after the last step; **`held`** → an SMS returned
   `{skipped, reason:'sms_disabled'}` because the kill-switch is OFF, so the step is **NOT advanced** —
   `next_run_at` pushed `HOLD_RETRY_HOURS` (6h) forward so it sends the moment Phase 4b flips
   `sms_sending_enabled` (never bypassed); `skipped` → a durable consent skip (dnd/suppressed/no address)
   advances past the step (don't pester); `retry` → transient failure, untouched, retried next run. Each
   terminal outcome writes a `crm_sequence_step_{sent,held,skipped}` `system_events` row
   (`{step_order, channel, reason}`); SMS additionally logs `sms_consent_log` inside the frozen gate.

**Timing:** `delay_hours → next_run_at` is a fixed-hour UTC epoch offset (`computeNextRunAt`) —
timezone-invariant, so a "48h later" step lands 48h later across a DST change. `date-mt.js` (a
day-boundary/MT-calendar helper) does **not** apply to fixed-hour delays; same reasoning
`run-automations.js` documents for its lookback windows. The roadmap's "MT helpers" wording refers to
the shared time-convention rule, not a literal day-math import here.

**UI — `src/pages/crm/CrmSequences.jsx`** (fills the Phase F "Coming in Phase 8" stub): master/detail —
sequence list (name, status badge, step/enrollment counts) + a builder (ordered steps: channel
email/sms, `delay_hours`, subject [email]/body, move up/down, add/remove), status lifecycle
(draft/active/paused/archived via the status-only edit that preserves steps), inline two-click delete,
enroll a `crm_segments` segment (dropdown from `get_segments`), and a per-sequence enrollment roster +
stats. SMS steps are labeled "held until the SMS switch is on (Phase 4b)" in the editor. `useAuth()` db;
`upr:toast` feedback; CSS lives only in the `CRM WAVE RESERVED — Phase 8` `index.css` marker (tokens
only; mobile stacks to one column).

**Tests** (committed failing first): `functions/api/process-sequences.test.js` (20 pure unit tests —
`computeNextRunAt`/`firstRunAt`/`advanceEnrollment` timing, `classifyEvent`/`evaluateExit` reply &
conversion rules, and `planStepOutcome`'s sent/held/skipped/retry with the SMS-held-not-advanced
assertion). `supabase/tests/crm_phase8_sequences.test.js` (integration; self-skips without CI creds like
sibling CRM suites): sequence CRUD + ordered read-back, status-only edit preserves steps, enrollment
idempotency, segment enroll (matching contacts only), cascade delete. Behavior **live-verified via
Supabase MCP**: steps stored + renumbered `{0,1,2}` from input `{5,2,9}`, status-only edit kept 3 steps,
idempotent enroll = 1, segment enrolled 2 of 3 (non-match excluded), `get_sequences` shape correct,
delete cascaded to 0/0. `npm test` 236 passed / 30 skipped; `npm run build` green; `npx eslint` clean on
changed files.

**Reviewer gauntlet:** migration-safety-checker **PASS** (signatures frozen, zero DDL, grants present);
upr-pattern-checker **PASS** (useAuth/toast/two-click/tokens, index.css inside marker); consent-path-
auditor **PASS** (every send funnels through `sendAutomatedMessage`; SMS held+retried, never
force-sent/bypassed; durable audit on both channels; enrollment is not a send); crm-phase-reviewer —
see the PR. SMS stays dark behind the F kill-switch until Phase 4b (carrier approval).

**`crm_build_stages` reconciliation (honest, mapped to the 8 seeded stages by sort order):**
- **[0] Test-first** — `done` (suite committed failing first, now green).
- **[1] Acceptance: CRUD + segment enrollment + pause/stop; `process-sequences` cron w/ `worker_runs`;
  email live / SMS held** — `done` (live-verified via MCP; segment→enroll proven at the RPC layer with
  6a's `upsert_segment`/`get_segments` feeding `enroll_in_sequence`).
- **[2] Segment-UI→enroll E2E verification tail after 6a merges (disclosed)** — **`todo`
  (deploy/flag-gated).** 6a has merged and the segment→enroll **data path is verified at the RPC
  boundary**, but the literal **browser** click-through (make a segment in 6a's Contacts UI → enroll it
  via the Sequences UI in a running app) needs a Cloudflare preview with `page:crm` opened, which isn't
  runnable from this session — left open honestly, not forgotten.
- **[3] test+build+eslint pass; zero schema migrations; `automated-send.js` import-only** — `done`.
- **[4] migration-safety + upr-pattern + consent-path auditors clean; crm-phase-reviewer sign-off** —
  `done` (three auditors PASS; crm-phase-reviewer result in the PR).
- **[5] Visual: sequence builder + enrollment list on preview** — **`todo` (deploy-gated)** — same
  Cloudflare-preview + `page:crm` requirement as [2]; the UI builds clean but a preview screenshot can't
  be produced here.
- **[6] `UPR-Web-Context.md` updated** — `done` (this entry).
- **[7] Set phase 8 shipped; delete test sequences/enrollments; pushed, verified, PR opened** — `done`
  (no test rows remain — SQL smoke tests self-cleaned or rolled back via `RAISE`, verified 0
  `zz8%`/`smoke%` rows; `crm_build_phases('8')` set `shipped`; PR opened as the handoff).

There is no `blocked` status value yet, so [2] and [5] stay `todo` with the disclosure above — both are
owner/deploy-gated (the `page:crm` flag keeps `/crm/*` invisible until Phase 6b opens it), not skipped
work.
## CRM Phase 7 — Daily driver: tasks, timeline, comms in shell (Jul 2 2026 — shipped)

Wave-1 phase (cut from `dev`). The daily-driver surface: a real Tasks page, an Overview overdue-tasks
widget, win/loss capture + stage-age on Leads, click-to-call logging, and the existing Conversations
inbox embedded in the CRM shell. **Zero schema migrations** — `crm_tasks`, `lead_stage_history`,
`inbound_leads.lost_reason`, and `pipeline_stages.is_lost/is_won` are all Foundation-owned; this phase
filled five frozen RPC stub bodies and edited only its four owned files + the Phase 7 `index.css`
reserved section (per `.claude/rules/crm-wave-ownership.md`). App.jsx / CrmLayout.jsx / crmIcons.jsx
untouched (routes/nav/icons were pre-wired by Foundation).

**RPCs — `supabase/migrations/20260702_crm_phase7_task_rpcs.sql`** (function-body-only `CREATE OR
REPLACE`, signatures byte-for-byte identical to Foundation's stubs; all SECURITY DEFINER + GRANT
anon/authenticated). **Task status domain is `'open' | 'done'`** (the `crm_tasks_status_check`
constraint — NOT `'completed'`; the whole phase uses `'done'`):
- `get_crm_tasks(p_assignee, p_status, p_contact_id, p_lead_id, p_org_id) → SETOF json` — filtered
  list; LEFT JOINs `employees` (assignee_name) + `contacts` (contact_name). Order: open before done,
  then `due_at` asc NULLS LAST, then newest.
- `upsert_crm_task(p_id, p_title, p_notes, p_due_at, p_remind_at, p_assignee_id, p_contact_id,
  p_lead_id, p_org_id, p_created_by) → crm_tasks` — create (p_id NULL) or edit. Title required
  (trim-checked). Org defaults to the first non-test `crm_orgs` row (same pattern as
  `create_manual_lead`). **On edit it replaces every editable field with the passed value**, so the
  editor always submits full form state; writes a `crm_task_created` `system_events` row on insert.
- `set_task_status(p_task_id, p_status, p_actor_id) → crm_tasks` — validates `open|done`; sets
  `completed_at=now()` on done / NULL on reopen; writes a `crm_task_status_changed` event.
- `delete_crm_task(p_task_id) → void`.
- `get_overdue_tasks(p_assignee, p_org_id, p_now timestamptz DEFAULT now()) → SETOF json` — open tasks
  whose **Mountain-Time due DATE is a prior Denver day**: `(due_at AT TIME ZONE 'America/Denver')::date
  < (p_now AT TIME ZONE 'America/Denver')::date`. This is the SQL mirror of `functions/lib/date-mt.js`
  `isStale(due, now, 1)` — a task due earlier *today* in Denver is NOT overdue (UTC storage, MT day
  boundary). Verified live: prior-MT-day task overdue=true, earlier-same-MT-day task overdue=false.

**Components (owned files):**
- `src/pages/crm/CrmTasks.jsx` — real Tasks page: Open/Done tabs + assignee filter (Everyone/Mine/per
  employee); rows with a check toggle (complete/reopen), title/notes, due chip (red **Overdue** when
  past its MT day via the shared `isTaskOverdue`), assignee + contact/lead chips, and inline two-click
  delete. Editor panel: title (required), notes, due + reminder (`datetime-local` ↔ ISO), assignee
  select, and a small typeahead (`EntitySearch`) to link a contact (contacts search) or a lead
  (inbound_leads search). All CRUD via the RPCs above.
- `src/components/crm/OverdueTasksWidget.jsx` — Overview card from `get_overdue_tasks`; **hidden when
  nothing is overdue** (keeps the Overview clean, honoring Foundation's "renders nothing" slot
  contract). Exports `isTaskOverdue(dueAt, now)` (the MT-day mirror; imported by CrmTasks + unit-tested).
- `src/pages/crm/CrmLeads.jsx` — three additions: (1) **required win/loss reason** — dragging or
  `<select>`-moving a lead into an `is_lost` stage opens `LostReasonPrompt`; the reason is required
  client-side (`lostReasonError`, exported + unit-tested) and passed as `p_lost_reason` to
  `move_lead_to_stage` (the RPC keeps it optional — Foundation's `crm_shared_rpc_compat` backward-compat
  test stays green). (2) **stage-age badges** — "Nd in stage" from `lead_pipeline_stage.updated_at`
  (now selected in the load), red `.stale` at ≥7 days. (3) **click-to-call** — the lead's number is a
  `tel:` link that fire-and-forget inserts a `crm_click_to_call` `system_events` row (never blocks the
  dial).
- `src/pages/crm/CrmLeads.jsx`'s `LeadDetailPanel` (2026-07-17) — fixes the gap where a web-form
  lead's actual submitted answers, notes, tasks, and stage-move history were invisible in the UI even
  though they were already captured. Four additions, all reusing existing data/RPCs (no migration):
  (1) **Submitted answers** — renders `inbound_leads.form_data` as label/value rows; labels come from
  the form's real published schema (fetched via `raw_payload.form_id` → `form_definitions` →
  `form_definition_versions`) when that fetch succeeds, else a humanized version of the raw field key
  (`formDataRows()`/`humanizeKey()`, mirroring `functions/api/form-submit.js`'s server-side
  `leadNotificationRows()` for the email/push alert, but reading client-side). (2) **Notes** — a
  textarea that saves straight to `inbound_leads.notes` via `db.update()` (same direct-update pattern
  as `CustomerPage.jsx`'s contact notes), synced back into the parent's `leads`/`selectedLead` state via
  a new `onLeadPatched` callback so a reopened panel shows the saved note without a full reload.
  (3) **Tasks** — a compact list (reusing `CrmTasks.jsx`'s `crm-task-*` markup/CSS) of this lead's
  `crm_tasks` rows (`get_crm_tasks({ p_lead_id })`), with check-off (`set_task_status`, optimistic with
  revert-on-error) and a quick-add row (`upsert_crm_task({ p_lead_id, p_contact_id })`). (4) **Stage
  history** — lists this lead's `lead_stage_history` rows (already written by `move_lead_to_stage` but
  previously never rendered anywhere), stage names resolved client-side from the already-loaded
  `stages` prop. Zero new CSS (all four reuse existing `crm-panel-*`/`crm-task-*`/`crm-input` classes)
  and zero schema changes — `form_data`, `notes`, `crm_tasks`, and `lead_stage_history` all already
  existed with `authenticated`-scoped policies from earlier CRM-wave phases.
  - **UPDATE (2026-07-24) — the single Notes field became an append-only notes LOG** (migration
    `20260724180000_crm_lead_notes.sql`; owner-directed standalone). The overwrite-on-save `notes`
    textarea/`onLeadPatched` model is retired: staff run several follow-ups per lead and need a fresh,
    dated, attributed note for each. New table **`crm_lead_notes`** (`id, lead_id, org_id, contact_id,
    body, created_by, created_at`; RLS-enabled with NO browser policy — RPC-only access,
    `REVOKE ALL FROM PUBLIC, anon`). New RPCs (both `SECURITY DEFINER`, `REVOKE PUBLIC/anon`,
    `GRANT authenticated, service_role`): **`add_lead_note(p_lead_id, p_body, p_created_by) → json`**
    (append; resolves org_id+contact_id from the lead; returns the row already carrying `author_name`)
    and **`get_lead_notes(p_lead_id) → SETOF json`** (newest first, `author_name` joined from
    `employees`). The panel Notes section is now a list + composer; the board card's quick-note popover
    appends via `add_lead_note` (no longer `db.update('inbound_leads', { notes })`). The migration
    **backfills** existing `inbound_leads.notes` into the log (source column copied, NOT cleared —
    rollback-safe) and does a **function-body-only** `CREATE OR REPLACE` of the frozen
    `get_lead_activity` / `get_contact_activity` (signatures + `RETURNS TABLE` shape unchanged): adds a
    `'note'` arm reading `crm_lead_notes` (rendered by `ActivityTimeline`'s existing `note` badge +
    `meta.author_name`) and drops `il.notes`/`fu.notes` from the lead/follow-up body `COALESCE` so a
    backfilled note isn't shown twice. `inbound_leads.notes` remains on the table (additive rule) but is
    no longer written or displayed by the Leads UI. New CSS: `.crm-lead-note*` under a labeled marker at
    the end of `src/index.css`. Backward-compat test: `supabase/tests/crm_lead_notes.test.js`.
  - Also polished (same date, same panel): the header no longer shows a contact-less lead's phone
    number twice (title falls back to it via `leadLabel()`, and the subtitle used to unconditionally
    repeat it as a `tel:` link — now the title itself becomes the link and the subtitle is skipped);
    the Source row (`sourceLine()`) dedupes a `source`/`campaign` pair that are the same string
    (common for CallRail leads with no distinct campaign tag, e.g. "Call · Google My Business ·
    Google My Business"); the "not a customer yet" copy is source-type-aware instead of always
    saying "raw calls"; and the `!lead.contact_id` "Customer" block got a `crm-panel-section-title`
    heading + `crm-btn-sm` sizing to match every other section in the panel (it was previously the
    only section with neither, reading like a floating card rather than a section).
- `src/components/crm/ActivityTimeline.jsx` + new `src/lib/transcript.js` (2026-07-17) — a call's
  activity entry (`get_contact_activity`'s `'lead'` arm, `body = COALESCE(il.transcription,
  il.notes)`) used to render a full Deepgram-diarized transcript ("Speaker 1: ... Speaker 2: ...")
  as one unbroken paragraph. `parseTranscript()` (pure, in the new `src/lib/transcript.js` — kept out
  of `ActivityTimeline.jsx` specifically so it's unit-testable without a Supabase env stub, since
  that file transitively imports `AuthContext`/`realtime.js`) splits it into ordered `{speaker,
  line}` turns; `ActivityBody` (a new sub-component, one per timeline item so expand state is
  independent) renders them as labeled turns, collapsed to the first 2 with a "Show full transcript
  (N lines)" toggle. Anything that isn't a recognizable 2+-turn back-and-forth (SMS bodies, notes,
  a single-turn fragment) falls back to plain text, itself clamped at 220 chars with a "Show more"
  toggle when long. New CSS: `.crm-transcript`/`.crm-transcript-turn`/`.crm-transcript-speaker`/
  `.crm-transcript-toggle`, all on existing `--crm-*` tokens. Shared component — the same fix reaches
  the Contacts detail screen (Phase 6a's `ContactDetail.jsx`) automatically. Unit-tested:
  `src/lib/transcript.test.js`.
  - **Speaker labels (same date, follow-up)** — turns now show "Utah Pros"/"Customer" instead of
    "Speaker 1"/"Speaker 2". Two paths, in preference order: `turnsFromAnalysis()` reads
    `inbound_leads.transcript_analysis.turns[].role` (`'agent'|'customer'`) — the ALREADY-VERIFIED
    identification a separate Claude pass makes during transcription
    (`functions/api/transcribe-call.js`'s `nameSpeakers`/`resegmentSpeakers`, stored via
    `set_lead_transcription`) — and is accurate regardless of raw diarization speaker numbering or
    per-employee name (a captured "Ben" still displays as "Utah Pros", by design — company label, not
    individual). `get_contact_activity` didn't expose `transcript_analysis` before; migration
    `20260717_get_contact_activity_transcript_analysis.sql` adds it as one new `meta` key
    (function-body-only `CREATE OR REPLACE`, additive, `REVOKE...FROM PUBLIC,anon` re-affirmed —
    grants stay `authenticated, service_role` only, verified live before/after). `parseTranscript()`
    (the flat-text fallback, for a call transcribed before this enrichment existed) now also labels
    Utah Pros/Customer, but by a HEURISTIC — the raw speaker number that talks FIRST becomes Utah Pros
    (an inbound call is always answered with a company greeting), not a verified identity like the
    `turnsFromAnalysis` path; a 3rd+ distinct speaker (rare) keeps a neutral "Speaker N" label since
    there's no reliable default for it. Backward-compat: `crm_shared_rpc_compat.test.js` gained an
    assertion that `meta.transcript_analysis` key exists (integration, self-skips without creds).
  - **Summary section (2026-07-17, follow-up)** — `LeadDetailPanel` gains a "Summary" section, shown
    open (not collapsed — Deepgram's Audio Intelligence summary is inherently short) right after the
    Source/Occurred block, gated on `lead.source_type === 'call' && lead.transcript_analysis?.summary`
    (call leads only; `transcribe-call.js`'s Deepgram pass already writes this `summary` key). No
    migration or new fetch — `transcript_analysis` is already returned by the board's existing
    `select=*` on `inbound_leads`. A small "Generated from the call recording" caption
    (`.crm-panel-empty`) discloses the AI origin. Zero new CSS — reuses `.crm-answer-value` for the
    body text.
  - **Deep-link to the specific lead (2026-07-17, follow-up)** — the `lead.new` email's "View lead →"
    button, and the bell/push click-through, used to land on `/crm/leads` with the board rendered but
    no lead selected. `CrmLeads.jsx` now reads `useSearchParams()` for a `?lead=<id>` param on mount
    (`deepLinkAttemptedRef` — runs once, never re-fires as `leads` updates) and opens that lead's panel:
    first checked against the board's already-loaded most-recent-200 set, falling back to a direct
    one-off `inbound_leads` fetch for an older lead outside that window. The param is stripped
    (`setSearchParams(..., {replace:true})`) once acted on, success or failure, so the URL doesn't stay
    "stuck". `functions/api/form-submit.js`'s `buildLeadEmailHtml`/`buildLeadNotificationContent` and
    `functions/api/callrail-webhook.js`'s `notifyNewLead` now build `link`/`data.route`/the email's
    button href as `/crm/leads?lead=<id>` (falls back to the plain board link when a lead somehow has no
    id yet). `webflow-form-webhook.js` gets this for free — it already calls the same
    `notifyNewLeadFromForm`. Tests: `functions/api/lead-notify.test.js` asserts the exact deep-linked
    URL on both the callrail and form paths (bell/push `link`+`data.route` and the email HTML href) plus
    the no-id fallback.
  - **Spam excluded from reporting RPCs (2026-07-17, follow-up)** — the Leads board already excluded
    `spam_flag=true` leads, but four reporting RPCs still counted them: `get_attribution_rollup`
    (CrmOverview funnel), `get_attribution_by_campaign` (Attribution page per-campaign counts),
    `get_speed_to_lead` (Reports SLA buckets), and `get_pipeline_movement` (Reports stage in/out —
    previously had no reference to the underlying lead at all, just counted every
    `lead_stage_history` row). Fixed via `20260717_crm_reporting_rpcs_spam_filter.sql`, four
    function-body-only `CREATE OR REPLACE`s (same signatures/return shapes) adding a
    `COALESCE(il.spam_flag, false) = false` exclusion (`get_pipeline_movement` gained a
    `JOIN inbound_leads` to reach it). **Deliberately untouched:** the Call Log's
    `get_inbound_leads` — it's a full call-audit list that shows spam on purpose (visible "Spam"
    badge, staff can reclassify). Also hardened `CrmLeads.jsx`'s deep-link fallback fetch (above) to
    filter spam. The migration also tightened all four RPCs' grants from `anon, authenticated` to
    `authenticated, service_role` (database-standard.md least-privilege — DB-Foundation P3 had
    already closed `anon` on these exact functions; verified live via the grant table, no
    `anon`/`PUBLIC`). Proof: `supabase/tests/crm_pipeline_spam_filter.test.js` — before/after deltas
    scoped to run-unique fixtures/specific stages/buckets (not shape-only, not org-wide live counts).
  - **`lead.new` email design pass (2026-07-17, follow-up, `/impeccable polish`)** — `buildLeadEmailHtml`
    (`functions/api/form-submit.js`) gets a genuine polish, not just cosmetics: (1) a hidden inbox-preview
    line (`buildPreheader`) so Gmail/Outlook/Apple Mail show "who + what" next to the subject before the
    email opens — the single biggest lever for "glance and know whether to act now"; (2) phone-type
    fields render as a tap-to-call `tel:` link with a 📞 prefix (`telHref`, US-only best-effort, matches
    `CrmLeads.jsx`'s existing click-to-call `tel:` convention) — previously plain unclickable text; (3) the
    footer moved inside the card with the same `border-top`/`background:#f8fafc` treatment
    `functions/lib/email-template.js`/`send-esign.js` already use, instead of floating outside it; (4) the
    button padding now matches `send-esign.js`'s CTA exactly (`14px 36px`) for a ≥44px touch target,
    up from a ~38px one; (5) `<meta name="color-scheme"/"supported-color-schemes" content="light">` so
    dark-mode email clients don't invert the brand card. Also fixed a real legibility bug this surfaced —
    `leadNotificationRows`'s `displayValue` (and `CrmLeads.jsx`'s mirrored `displayFieldValue`, now
    exported for testing) rendered a checkbox field as the literal string `"true"`/`"false"`. Verified
    visually via a Playwright screenshot of the real render function (not a mockup) before shipping.
    Tests: `functions/api/lead-notify.test.js` (preheader text, `tel:` href, color-scheme meta) +
    `crmLeads.lostReason.test.js` (client-side `displayFieldValue`/`formDataRows` cases).
    - **Checked-boxes-only, not Yes/No (2026-07-17, same-day follow-up)** — the `"Yes"`/`"No"` fix above
      was itself still noisy: a form with one boolean field per service (e.g. separate Mold / Water
      Damage / Fire and Smoke / Remodeling checkboxes, as opposed to one multi-select array field —
      both schema shapes exist across UPR's forms) showed EVERY service, checked or not
      (`"Fire and Smoke: No"` for every service NOT requested). `leadNotificationRows` (+ its
      `CrmLeads.jsx` mirror `formDataRows`, now also exported) now drops an unchecked box (`false`)
      entirely — no row at all — and flags a checked one (`true`) `boolean: true` with an empty
      `value`, so the renderer shows just the label. Email HTML renders it as a single-column
      `&#10003; Mold` row; the plain-text bell/push body as a bare `Mold` line; the CRM panel's
      `.crm-answer-value` as `✓ Mold`. The existing multi-select-array case (e.g. "What do you need
      help with? → Mold, Water Damage") was already correct — `displayValue`'s array branch only ever
      included the selected options — and is now the reference example both code paths match. Tests
      updated in both files to prove only-checked-shown with zero `true`/`false`/`Yes`/`No` anywhere in
      either output.
  - **Unlinked-lead activity + stage history (2026-07-21, follow-up)** — an unlinked lead (no
    `contact_id` yet — the common pre-qualification state) showed a totally empty Activity timeline
    because `get_contact_activity` requires a `contact_id` on every branch. New
    `get_lead_activity(p_lead_id)` RPC (same return shape) covers that case: the lead's own call/form
    event, its own `crm_tasks` (`lead_id`-scoped), and its own `lead_stage_history` moves — no contact
    link required. `ActivityTimeline.jsx` now accepts a `leadId` prop as an alternative to `contactId`
    (`contactId` wins if both are passed); `CrmLeads.jsx`'s `LeadDetailPanel` calls it with `leadId`
    instead of showing a static "no linked contact yet" message. Also fixed two gaps that affected
    *linked* contacts: `lead_stage_history` was missing from `get_contact_activity` entirely (stage
    moves never appeared for anyone), and a task added while a lead was still unlinked (`lead_id` set,
    `contact_id` NULL) never surfaced even after that lead later linked to a contact — the `task` arm
    now also matches via `lead_id IN (SELECT id FROM inbound_leads WHERE contact_id = p_contact_id)`.
    Migration `20260721_crm_unlinked_lead_activity.sql` — function-body-only `CREATE OR REPLACE` of
    `get_contact_activity` (signature/return shape unchanged) + the new `get_lead_activity`, both
    granted `authenticated, service_role` only (no `anon`). Proof: `supabase/tests/crm_lead_activity.test.js`
    (integration, self-skips without creds). While extending `ActivityTimeline.jsx`, also fixed three
    `page-lifecycle.md` bugs the review caught: a failed load rendered the same empty-state as "no
    activity" instead of `<ErrorState>` (`loading-error-states.md` §1); the loading gate re-blanked an
    already-rendered timeline on every mutation-driven `contactId`/`leadId` prop swap instead of staying
    silent; and a stale response could win a race when switching leads quickly (now guarded by a
    request-id ref, plus `LeadDetailPanel` is keyed by `lead.id` in `CrmLeads.jsx` so a genuine lead
    switch remounts cleanly). `.claude/rules/crm-wave-ownership.md` §1 gained a disclosed amendment
    note — this is the second standalone-production-fix body-replace of the nominally Foundation-frozen
    `get_contact_activity`, same precedent as the 2026-07-21 contact-link-and-activity migration.
  - **Contact-activity timeline — full current shape (2026-07-24), verified live via the Supabase
    MCP (read-only, project `glsmljpabrwonfiltiqm`).** `get_contact_activity(p_contact_id uuid)` is now
    a **24-arm** `UNION ALL` (23 distinct `activity_type` values — the two `note` arms both emit
    `'note'`); signature + return shape (`activity_type, occurred_at, title, body, meta`) unchanged
    since Phase 1. Authoritative arm list, in source order: `lead, sms, note (job_notes),
    note (crm_lead_notes), estimate, email, job, task, appointment, invoice, work_authorization,
    stage_change, follow_up_call, claim, phase_change, payment, document, contact_owner_set,
    contact_lifecycle_set, work_auth_sent, work_auth_signed, scope_sheet, invoice_sent,
    estimate_sent`. Grown after the 2026-07-21 contact-link/unlinked-lead work by a chain of
    function-BODY-only `CREATE OR REPLACE` migrations (all additive, signature frozen):
    `20260721_crm_contact_activity_payment_document_events.sql` (payment/document/contact_owner_set/
    contact_lifecycle_set), `20260721_crm_contact_activity_send_events.sql` (work_auth_sent/
    work_auth_signed/scope_sheet/invoice_sent/estimate_sent), `20260721_crm_activity_actor_names.sql`
    (actor-name `meta` keys + claim/phase_change/follow_up_call), and `20260724180000_crm_lead_notes.sql`
    (the second `note` arm). The sibling `get_lead_activity(p_lead_id uuid)` (unlinked leads) is now
    **5 arms** — `lead, note, task, stage_change, follow_up_call`. Both remain `SECURITY DEFINER`,
    `REVOKE ... FROM PUBLIC, anon`, `GRANT ... TO authenticated, service_role` (no `anon`).
  - **Append-only lead notes — `crm_lead_notes` + `add_lead_note`/`get_lead_notes`
    (`20260724180000_crm_lead_notes.sql`).** Replaces the single overwritable `inbound_leads.notes`
    box with a real per-lead notes log. Table
    `crm_lead_notes(id, lead_id NOT NULL, org_id NOT NULL, contact_id, body NOT NULL, created_by,
    created_at NOT NULL)`, **RLS enabled with NO policies (deny-all — RPC-only)**. Writes go through
    `add_lead_note(p_lead_id uuid, p_body text, p_created_by uuid)` (append; blank body rejected);
    reads through `get_lead_notes(p_lead_id uuid)` (newest-first) — both `SECURITY DEFINER`,
    `authenticated, service_role` only. A one-time additive backfill copied existing
    `inbound_leads.notes` into the log (not cleared). The note surfaces on both timelines as a `'note'`
    row, told apart from the `job_notes` `'note'` arm by `meta.note_id`; the `lead`/`follow_up_call`
    bodies dropped `il.notes`/`fu.notes` from their COALESCE so a backfilled note isn't shown twice.
    ✅ **Provenance — RESOLVED 2026-07-24.** This migration shipped on commit `44dc519` and was LIVE
    while its source was unreachable from `dev` or `main`, so no branch reproduced the live function's
    second (`crm_lead_notes`) `note` arm — the 24th arm existed only because that commit had been
    applied to the one shared Supabase. PR #515 merged that source into `dev`, and the live
    `get_contact_activity(uuid)` body was verified semantically identical to it before merging.
    `dev` now reproduces all 24 arms from its own migration tree. See the "Concurrent-session
    reconciliation (2026-07-24)" section and
    `docs/audit/2026-07/evidence/migration-provenance-2026-07-24.md`.
  - **Durable 24-arm regression guard — `supabase/tests/crm_contact_activity.test.js` (2026-07-24).**
    A second suite seeds one contact wired to all 24 arms and asserts each returns ≥1 row (a dropped
    arm names itself in the failure). It exists to catch the recurring failure mode where a body-only
    `CREATE OR REPLACE` is re-authored from a stale ancestor and silently drops live arms — the exact
    near-miss review caught on the `crm_lead_notes` migration (a stale 12-arm ancestor would have
    dropped 11 live arms). Integration test, self-skips without `VITE_SUPABASE` creds; because
    `get_contact_activity`/`add_lead_note` are `authenticated`/`service_role`-only and `crm_lead_notes`
    is deny-all, it only truly runs under a privileged harness or the Supabase MCP, not an anon session.
    The live contract + every fixture column/enum was verified read-only via the Supabase MCP.
    `migration-safety-checker` flagged this guard as recommended-not-required. **Sibling guard
    (2026-07-24):** `supabase/tests/crm_lead_activity.test.js` carries the same guard for
    `get_lead_activity`'s 5 arms, closing the gap where its older suite covered only
    lead/task/stage_change and left `note` (crm_lead_notes) + `follow_up_call` unguarded. Both
    guards are keyed to arm lists verified read-only against the live catalog; when a future
    migration legitimately ADDS an arm, update the corresponding list in the same commit.
- `src/pages/crm/CrmConversations.jsx` — thin wrapper rendering the existing `src/pages/Conversations`
  inbox inside the CRM shell. **No new send path** — outbound SMS still goes through the existing
  `/api/send-message` worker (call-only, DND/opt-in enforced there); `send-message.js` / `twilio.js` /
  `automated-send.js` untouched; `skip_compliance` never used.

**Tests** (committed failing first): `src/components/crm/overdueTasks.test.js` (MT-day boundary via
`isTaskOverdue` — prior day overdue, earlier-same-day not, UTC-midnight-not-MT-midnight not, null never);
`src/pages/crm/crmLeads.lostReason.test.js` (`lostReasonError`: required on lost, accepted with reason,
never on non-lost — both mock `@/contexts/AuthContext` so importing the component in the node test env
doesn't pull in the realtime client); `supabase/tests/crm_phase7_tasks.test.js` (integration, self-skips
without creds like sibling suites: title required, upsert→get shape, done/reopen `completed_at`, and the
MT-day overdue predicate). Full vitest 225 passed / 29 skipped; `npm run build` green; `npx eslint` clean
on changed files (the two non-component helper exports carry a targeted `react-refresh/only-export-
components` disable — ownership forbids a new shared `src/lib` file, so the helpers live in their owned
component files).

**Reviewer gauntlet:** migration-safety-checker **PASS** (zero DDL, five signatures byte-for-byte frozen,
grants + SECURITY DEFINER present); upr-pattern-checker / consent-path-auditor / crm-phase-reviewer — see
the PR. Isolation stays the `page:crm` flag (opening to staff gates on Phase 6b).

**`crm_build_stages` reconciliation (honest):** stages 0–3, 5, 6 flipped **done** — test-first suite,
acceptance (Tasks/overdue widget/win-loss+stage-age/Conversations/click-to-call), test+build+eslint +
zero-schema, the auditor gauntlet, this doc, and the mechanical close-out. **Stage 4 ("Visual: … on
preview") stays `todo` on purpose** — a preview deploy only exists after the branch is pushed, so the
Tasks/Conversations/Overview-widget/lost-reason visual pass happens on the Cloudflare preview URL at
review time, not from this headless session. No test task rows remain (the live smoke was rolled back;
the integration suite self-cleans; `crm_tasks` verified empty of `smoke/v/phase7-` rows).
`crm_build_phases('7')` set `shipped`.

## CRM Phase 10 — CRM Forms: embeddable lead capture (Jul 2 2026 — shipped)

Wave-1 phase (cut from `dev`). Ships a first-party embeddable lead-capture form builder — the
public-endpoint + consent + XSS-weighted phase. **Zero schema migrations** — the
`form_definitions` / `form_definition_versions` / `form_submissions` tables (public_id UNIQUE,
submission_token UNIQUE, immutable published version snapshots) are all Foundation-owned; this phase
only filled three frozen RPC stub bodies and added a shared lib + worker + hosted page + embed
snippet + builder UI.

**Shared lib — `functions/lib/forms.js`** (new; pure, browser+worker-safe, unit-tested in
`forms.test.js`): `sanitizeLinkMarkup` (HTML-escapes everything, then converts ONLY `[text](url)`
with an http(s)/mailto url into an `<a rel="noopener noreferrer nofollow">` — javascript:/data:/
relative urls stay inert text; this is the sole link path, used by both the builder preview and the
hosted page), `validateSubmission(schema,data)` (required + per-type checks), `checkSpam` (honeypot +
min-fill-time), `consentValue`. This is the load-bearing XSS defense.

**RPCs — `supabase/migrations/20260702_crm_phase10_form_rpcs.sql`** (function-body-only
`CREATE OR REPLACE`, signatures byte-for-byte identical to Foundation's stubs, all SECURITY DEFINER +
GRANT anon/authenticated):
- `upsert_form(p_id, p_name, p_schema, p_theme, p_status, p_publish, p_turnstile_enabled, p_org_id,
  p_created_by) → form_definitions` — create/edit a form; generates a unique `public_id`; editing
  always writes a working DRAFT version and **publishing never mutates an already-published version
  row** (the next edit opens a fresh draft one version above it → every published snapshot stays
  immutable/revertable). Treats empty `{}` theme / read-only calls as no-ops so metadata isn't wiped.
- `get_forms(p_org_id) → SETOF json` — one json per non-archived form with published + draft schema,
  `submission_count`, and the most recent (≤200) submissions inline, so the builder's submissions
  view needs no extra RPC.
- `upsert_lead_from_form(p_form_id, p_submission_token, p_data, p_utm, p_consent, p_ip, p_user_agent,
  p_org_id) → inbound_leads` — **idempotent on `callrail_id = 'form:' || submission_token`** (the
  `create_manual_lead` `'manual:'` precedent); requires a published form; finds/creates the contact by
  SQL-normalized phone (mirrors `src/lib/phone.js`); logs `inbound_leads` (`source_type='form'`,
  source/medium/campaign from UTM); attributes via `upsert_lead_attribution` + `crm_channel_for_source`;
  writes `form_submissions`; **on consent → an `sms_consent_log` `opt_in` row (IP + form public_id +
  consent-text version) and sets `contacts.opt_in_status/opt_in_source='web_form'/opt_in_at`** (no
  opt-in written when consent is false); fires `system_events` `crm_lead_created` (so speed-to-lead
  triggers on form leads) + `crm_form_submitted`. Verified live on `dev` end-to-end (create → publish →
  edit-immutable → get_forms → submit → idempotent redelivery → consent / no-consent asserts), then
  all test rows deleted.

**Worker — `functions/api/form-submit.js`** (new; public `POST /api/form-submit`): permissive CORS
`*` on purpose (embeddable, credential-free, RPC-gated); spam gate = honeypot + min-fill-time +
per-IP rate limit (`form_submissions` in a 10-min window) + optional **per-form** Cloudflare Turnstile
(`form.turnstile_enabled`; secret read from `integration_config.turnstile_secret_key` via the
service-role client — that table is RLS-locked so anon/authenticated never see it — with
`env.TURNSTILE_SECRET_KEY` as fallback; if neither is set the check is skipped so forms work before a
key exists); server-side `validateSubmission` against the PUBLISHED version;
computes consent server-side from the submitted data; calls `upsert_lead_from_form`; logs a
`worker_runs` row. Spam-dropped submissions return `200 {ok:true}` (a bot can't tell it was filtered).
The supported public client posts only to this Worker. Direct browser execution of
`upsert_lead_from_form` is scheduled for removal by the grant-only
`20260723235900_public_form_rpc_boundary.sql`; pre-apply evidence confirms the migration is not live
yet, so the direct ACL bypass remains a current owner-gated closure rather than a shipped claim.

**Hosted page — `functions/f/[public_id].js`** (new; `GET /f/:public_id`): standalone HTML (not the
SPA) rendered from the published schema; every field label/option/value escaped, labels/description/
thank-you via `sanitizeLinkMarkup`; sets `Content-Security-Policy: frame-ancestors *` and never
`X-Frame-Options`, so it embeds on any customer site; posts JSON to `/api/form-submit`; reads the
UTM/gclid/fbclid/referrer/landing that `embed.js` forwarded onto its URL into hidden attribution;
`postMessage` auto-resize; Turnstile widget only when enabled AND a site key is set — site key read
from `integration_config.turnstile_site_key` (service-role), `env.TURNSTILE_SITE_KEY` as fallback,
looked up only when the form has Turnstile on.

**Turnstile keys live in Supabase (Jul 3 2026):** both keys are managed as rows in the RLS-locked
`integration_config` key/value table (`turnstile_site_key`, `turnstile_secret_key`) rather than
Cloudflare env vars — set/rotate them with a SQL `INSERT … ON CONFLICT (key) DO UPDATE`, no redeploy
to activate. `env.TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET_KEY` remain as fallbacks. Both workers resolve
via `pickConfiguredKey(configValue, envValue)` in `functions/lib/forms.js` (DB wins, trimmed, `''` →
dormant; unit-tested in `forms.test.js`).

**Embed — `public/embed.js`** (new static asset, served at `/embed.js`):
`<script src="…/embed.js" data-upr-form="PUBLIC_ID" async></script>` injects an `<iframe>` to
`/f/<public_id>` and forwards the **parent page's** UTM/gclid/fbclid + `document.referrer` +
landing URL into the iframe URL; origin derived from the script's own `src` (works dev+prod);
height messages trusted only from the form origin AND the exact iframe window (`event.source`).

**UI — `src/pages/crm/CrmForms.jsx`**: structured builder (NOT drag-drop — up/down reorder): 9 field
types (text/email/phone/textarea/select/radio/checkbox/date/**consent**), each with a **change-type**
dropdown, **duplicate**, required toggle, optional **help text** (`field.help`) and **default value**
(`field.default`), and a **per-field width** (Full / Half / Third → `field.width`; a 6-column grid so
e.g. City | State | ZIP share a row, single column on mobile). Dropdown / multiple-choice / **checkbox**
use a **structured per-option editor** (add / remove / reorder each option — replaced the raw
one-per-line textarea); dropdown also takes a custom first-choice `field.prompt`. The **`checkbox`
type is a multi-select group** (own options; value = array of chosen strings) — distinct from the
single **consent** opt-in box, which is unchanged (`consentValue` still keys off `type==='consent'`).
The **Preview tab is interactive & testable**: fill it in and Submit runs the *same*
`validateSubmission` the live form uses (inline per-field errors → then the thank-you), creating **no
lead / no write** ("preview only" note + a link to the live `/f/<id>` when published). All new field
keys are free-form JSON in the existing `form_definition_versions.schema` — **no RPC/migration change**,
backward compatible (a field with no `width`/`help`/`default` renders as before; a legacy option-less
checkbox stays a single box). Also: theme colors, restricted `[text](url)` markup in
labels/description/thank-you (rendered via `sanitizeLinkMarkup`), Save-draft vs Publish (two-click
confirm), copy-embed snippet (+ direct `/f/<id>` link), and a per-form **submissions** tab (array
values shown as a comma list). Styles live in the `CRM WAVE RESERVED — Phase 10` marker in
`src/index.css` (tokens only); the hosted page's inline theme colors are intentional (standalone
non-SPA). `page:crm`-gated like the rest of the shell.

**Optional Webflow adapter:** not built — the first-party form + embed covers WordPress/any site and
captures gclid/fbclid + writes `sms_consent_log`, which the Webflow-webhook path can't. Left as the
roadmap's documented optional stage.

**Ownership:** touched only Phase-10-assigned files (`CrmForms.jsx`, `functions/f/[public_id].js`,
`functions/api/form-submit.js`, `public/embed.js`) + the new shared `functions/lib/forms.js`
(Phase-10-owned, imports nothing frozen) + the three own frozen RPC stubs + the Phase 10 index.css
marker. No frozen file edited; no schema added.

**Tests / gauntlet:** `forms.test.js` (sanitizer XSS, validation, spam) + `crm_phase10_forms.test.js`
(publish immutability, get_forms, idempotency + consent-write) committed failing first. Full vitest
314 passed / 57 skipped; `npm run build` + `npx eslint` (changed files) clean. Integration suite
self-skips in CI (no creds, like every CRM suite) — the RPCs were instead verified live via SQL
assertions on `dev`. migration-safety-checker PASS; upr/consent/phase reviewers — see the PR.

**`crm_build_stages` reconciliation (honest):** 7 stages. Flipped **done**: test-first suite;
acceptance (builder + hosted form + embed + submissions→inbound_leads + attribution + events);
test/build/eslint + zero-schema; the auditor gauntlet; UPR-Web-Context update; and the mechanical
close-out. Left **todo** and disclosed: **"Visual: builder + live embedded form on a test page"** is
owner-gated — it needs the Cloudflare branch preview (a headless session can't render the iframe on an
external test page); the code is complete and unit/flow-verified. `crm_build_phases('10')` set `shipped`.

## CRM post-wave follow-ups (Jul 2 2026)

Small fixes committed straight to `dev` after the wave landed, from the #247–250 merge-readiness
review. All are behind `page:crm` (or dark behind the SMS kill-switch), so none is staff-visible yet.

- **ForecastWidget headline fix** (`src/components/crm/ForecastWidget.jsx`) — the "expected value of
  open leads" headline now sums only OPEN stages. It previously used `weightedPipelineValue().total`,
  which folds won-stage leads in at weight 1 (realized revenue) — inflating the number and making it
  disagree with the per-stage rows. `crmPipeline.weightedPipelineValue` is unchanged (Phase 9 tests
  stay green).
- **TCPA quiet-hours (SMS Gate 3)** — `functions/lib/automated-send.js` `sendGatedSms` now blocks
  automated SMS outside 8am–9pm in the recipient's local time via `isWithinQuietHours()` (tz-aware,
  DST-safe, unit-tested), returning `{ skipped:true, reason:'quiet_hours' }`. `process-sequences.js`
  HOLDS + retries that outcome (never drops it), same as the kill-switch hold. SMS-only (email/CAN-SPAM
  exempt); still behind `sms_sending_enabled`, so zero live impact until Phase 4b. Recipient tz defaults
  to `America/Denver` (`env.SMS_QUIET_HOURS_TZ` override) — per-recipient/area-code tz and
  `run-automations.js` held-retry remain for 4b (tracked in `docs/crm-roadmap.md` Phase 4b).
- **AiReplySuggestions wired into Conversations** — the shared `src/pages/Conversations.jsx` gained an
  OPTIONAL `replyAssist(context, insertDraft)` render-prop (the main app passes nothing → inert there;
  `src/pages/crm/CrmConversations.jsx` passes `AiReplySuggestions`). `insertDraft` fills the composer via
  the same DOM+state path as a template insert — draft-only, no send path added. Closes the Phase 9
  deferred follow-up.

---

## Feedback Media — plan of record (session 2026-07-02, docs only — no feature code)

**What this session shipped** (branch `claude/chat-session-og9agt` → PR into `dev`):
- `docs/feedback-media-roadmap.md` — the dispatch model of record for upgrading the feedback
  surface (photos + **video** attachments for everyone incl. a new desktop `/feedback` page,
  client-side **image** compression, video caps, 90-day attachment purge, admin inbox rebuilt with
  video player/lightbox, notify-on-submit). Live-verified gap audit (taxonomy A–G), 5 findings,
  three phase blocks (**F → B ∥ C**, disjointness adversarially proven), dependency graph,
  ownership matrix + frozen list (in-doc — no separate manifest file), options-on-record
  (video compression: caps not transcode; bucket: keep `job-files`; notify: bell + gated push).
- `docs/feedback-media-dispatch.md` — three complete cold-session copy-paste blocks (F, B, C).
- Zero code/schema/seed changes — non-CRM initiative, progress tracks via the roadmap doc's
  checklists (CRM tracker not used).

**Key findings recorded in the roadmap** (full evidence there):
- **RPC-cutover landmine (averted at plan time):** adding DEFAULT params to `insert_tech_feedback`
  via `CREATE OR REPLACE` would create an ambiguous overload and break every live submit instantly
  (shared Supabase). Phase F must DROP the 5-arg function + CREATE the 7-arg one, with a committed
  old-signature test; the new body mirrors screenshots↔attachments both ways so B/C deploy order
  never matters.
- **Two live bugs:** screenshot removal/abandon orphans storage objects (`TechFeedback.jsx:118-124`);
  AdminFeedback's shared `noteText` state can save notes onto the wrong row. Both fixed in-plan.
- **Push reaches nobody today:** `send-push` has zero callers, APNS env unset, `device_tokens` = 0
  rows. Notify design = in-app bell via `create_notification` (works today; global feed) + per-admin
  push fan-out (503-tolerant; goes live when the owner configures APNs). Email declined by owner.
- `storage.*` owned by `supabase_storage_admin` → migrations cannot create buckets/policies; the
  live `job-files` 50MB server cap is dashboard-configured (invisible to schema-as-code).
- New nav items need `always: true` or `isItemVisible()`/`canAccess()` hides them from everyone.

**Dispatch:** Wave 0 = Session F alone (Opus·high — schema cutover + `mediaCompress.js` +
`FeedbackAttachments.jsx` composer + working desktop page + wiring). Wave 1 after F merges =
Session B (Opus·medium — TechFeedback rebuild + `feedback-notify` worker) ∥ Session C (Opus·high —
AdminFeedback rebuild + `purge-feedback-media` worker). Owner anytime-lane actions: APNS env +
device tokens; point the external cron at the purge endpoint; optional dedicated bucket.

## CRM Phase 5 — Automation recipes (Jul 2 2026 — shipped)

Configurable linear automation builder (Session K). One additive migration
`20260702_crm_phase5_automations.sql` (post-wave single session — manifest §7 amends the
"zero schema" wave rule): two NEW tables + this phase's five API RPCs created directly (no stub
ceremony — no cross-session consumer). Behind `page:crm` + the new dev-only
`feature:crm_automations` sub-flag (seeded as a DB row — not in `featureFlags.js`, which is out
of Phase 5's ownership; a missing row would default OPEN, so seeding it is what gates the screen).

**Tables** (both `org_id` + RLS + explicit policy at creation):
- `crm_automations` — `id, org_id, name, description, trigger_event_type` (a `system_events.event_type`),
  `conditions jsonb` (`[{field, op, value}]` AND-filters), `actions jsonb` (ordered
  `[{type: send_email|send_sms|enroll_sequence|create_task, config, delay_hours}]`), `enabled`,
  `created_by, created_at, updated_at`.
- `crm_automation_runs` — one row per (rule, triggering event): `automation_id` (FK CASCADE),
  `org_id, triggering_event_id` (a `system_events.id` — no FK, the bus is append-only),
  `contact_id, entity_type, entity_id, current_action` (cursor into `actions[]`), `status`
  (`active|completed|failed|skipped|held`), `next_run_at, last_error`. **`UNIQUE(automation_id,
  triggering_event_id)`** is the idempotency/S1 dedup key — `system_events` has no cursor, so
  run-creation dedups on this, never on timestamps.

**RPCs** (SECURITY DEFINER + GRANT anon, authenticated): `get_crm_automations(p_org_id)` (list +
per-rule run stats), `upsert_crm_automation(...)` (create/edit — **S1 guard here**; `p_enabled`
NULL = leave as-is), `set_automation_enabled(p_id, p_enabled)` (**re-checks S1 on enable**),
`delete_crm_automation(p_automation_id)` (cascades runs), `get_automation_runs(p_automation_id,
p_org_id, p_limit)`. Plus `crm_fixed_automation_conflict(p_org_id, p_trigger_event_type)` (the S1
predicate, shared by both guarded RPCs) and `enqueue_automation_run(...)` (idempotent
`INSERT … ON CONFLICT (automation_id, triggering_event_id) DO NOTHING` — the worker calls it
because the REST client's `upsert` MERGES, which would overwrite a live run).

**Finding S1 (double-send, binding)** — the fixed engine (`run-automations.js`) and this
configurable engine keep dedup markers in namespaces that can't see each other, so a "missed
call → text" rule + the fixed missed-call-textback = two SMS for one call (TCPA, per-message).
Resolution: `crm_fixed_automation_conflict` refuses an ENABLED rule whose `trigger_event_type`
duplicates an ENABLED fixed automation, checked in `upsert_crm_automation` AND
`set_automation_enabled`; the engine also skips such rules at fire time (defense in depth). The
trigger→fixed-automation map (`speed_to_lead`/`missed_call_textback` → `crm_lead_created`(+`_manual`);
`review_request` → `job.phase_changed`/`job.status_changed`; `no_response_followup` is a time-scan
with no discrete event → collides with nothing) is duplicated in the engine's
`FIXED_AUTOMATION_TRIGGERS` and MUST stay in sync with the SQL predicate.

**Worker — `functions/api/process-crm-automations.js`** (new; `onRequest*` authenticated manual
trigger + `scheduled()` cron, deliberately named distinct from 4d's `run-automations.js`).
Structural sibling of `process-sequences.js`. ① **MATCH** — scans recent `system_events`
(`MATCH_LOOKBACK_MIN` 180) for enabled, non-S1-blocked triggers, evaluates AND-conditions against
the event payload merged over the trigger entity (payload wins on key collision), and enqueues one
idempotent run per match. ② **ADVANCE** — due runs (`status in (active,held) & next_run_at<=now`)
execute `actions[current_action]`: sends go ONLY through `sendAutomatedMessage()` (the frozen
consent gate — never twilio/email directly, never `skip_compliance`), enroll via
`enroll_in_sequence`, task via `upsert_crm_task`; then the cursor advances via imported Phase-8
`planStepOutcome`/`computeNextRunAt` semantics (read-only import; `process-sequences.js` never
edited). A held SMS (kill-switch OFF / TCPA quiet-hours) becomes `status='held'`, cursor
UNCHANGED, retried in `HOLD_RETRY_HOURS` — never dropped, never advanced past; a durable consent
skip (dnd/suppressed/no contact) advances past. One `worker_runs` row per cron run. Single-tenant:
`system_events` has no org_id, so runs scope to the one real org.

**UI — `src/pages/crm/CrmAutomations.jsx`** (master/detail, hand-rolled — no new dependency):
rule list → editor/detail. Editor = trigger picker (only event types the RPC layer actually
emits) → optional AND-condition rows (typed operators, `is_empty`/`in`/… with a field datalist) →
ordered action list with native up/down reorder + per-action wait + type-specific config; enable
checkbox with a client-side S1 collision warning (RPC still enforces). Detail = recipe summary +
per-rule run log (`get_automation_runs`). `useAuth()` `db` only, `upr:toast` feedback, inline
two-click delete. CSS only in the `CRM WAVE RESERVED — Phase 5` `index.css` marker (tokens;
mobile-only `@media (max-width:768px)` with 48px targets). Seams (authorized additive, manifest
§7): `App.jsx` lazy import + `<Route path="automations">`, `crmIcons.jsx` `IconAutomations`,
`CrmLayout.jsx` one `SIDEBAR_ITEMS` row + icon import.

**Tests** (committed failing first): `functions/api/process-crm-automations.test.js` (25 pure
unit tests — S1 `blockedTriggers`/`isTriggerBlocked`, null-safe typed AND-condition evaluator,
`planRunOutcome` held/skip/retry translation, idempotent `matchAutomations`);
`supabase/tests/crm_phase5_automations.test.js` (integration — CRUD, UNIQUE run idempotency, S1
save+enable guard; self-skips without creds like the other CRM suites). The SQL behavior (CRUD,
UNIQUE idempotency, S1 save+enable guard, conflict predicate) was verified live via Supabase MCP
assertions. `npm test` (319 passed / 53 skipped) + `npm run build` + `npx eslint` (changed files)
all green.

**Deliberately NOT** (owner-chosen v1 scope): branching/if-else, any node-graph canvas or new
frontend dep, editing `run-automations.js` (4d-owned) or `process-sequences.js` (Phase-8-owned —
imported read-only), touching the orphan `automation_rules` (its removal is a separate reviewed
cleanup). Recorded end-state (not v1): migrate the fixed four into `crm_automations` and retire
`run-automations.js` — one engine, guard obsolete.

## CRM Phase 5 re-plan (Jul 2 2026) — plan of record committed (no feature code)

Phase 5 ("Visual automation builder") scheduled by owner directive — its original go-signal gate
("4 fixed automations proven valuable + a real 5th need") is superseded, recorded transparently in
`docs/crm-roadmap.md` → **"Phase 5 re-plan (2026-07-02) — Linear automation recipes"** (the
authoritative section). v1 scope = **linear automation recipes**: trigger (a `system_events`
event type) → AND-conditions → ordered actions (send email/SMS via the frozen gate, enroll in
sequence, create task). One combined build session (**Session K**), runs **in parallel with
Phase 10** — disjointness proven by an adversarial challenge pass before commit.

Key design facts (adversarially verified): `system_events` is **RPC-fed, not trigger-fed** (one
lone DB trigger), no cursor/org_id → run-creation dedups on
**`UNIQUE(automation_id, triggering_event_id)`**; the legacy `automation_rules` table is a
verified unwired orphan (no org_id, zero code references, stale TODO at
`functions/api/twilio-webhook.js:229`) — Phase 5 uses fresh `crm_automations` /
`crm_automation_runs` instead; **finding S1 (double-send)** is binding — the fixed engine
(`run-automations.js`) and the new configurable engine keep dedup markers in namespaces that
can't see each other, so `upsert_crm_automation` AND the engine must block rules duplicating an
enabled fixed automation (TCPA). No new frontend dependency (hand-rolled linear builder per the
CrmLeads DnD precedent).

Artifacts committed (docs/seed only — zero feature code): the roadmap re-plan section (phase
block, gap audit, options-on-record, resisted ledger, challenge report; old Phase 5 block +
graph line superseded in place), `.claude/rules/crm-wave-ownership.md` **§7** (Session K row,
authorized additive seam edits to App.jsx/crmIcons/CrmLayout, own-additive-schema + no-stub
amendments, S1 guard), the **Session K dispatch block** in `docs/crm-dispatch.md`, and
`supabase/migrations/20260702_crm_phase5_replan_stages.sql` (applied + verified live: phase
title → "Automation recipes — linear visual builder", status still `planned`, placeholder stage
replaced by 7 real stages).

## CRM Phase 5-Ops plan (Jul 3 2026) — plan of record committed (no feature code)

Owner directive (full scope): extend the shipped automation engine with **ops actions**
(notify_staff via `create_notification`, job_note via `job_notes`, set_job_phase via a NEW
two-write-encapsulating RPC, create_draft_invoice via the idempotent `create_invoice_for_job` —
draft-only, the QBO push door stays human), a **scheduled-scan trigger family** ("something
DIDN'T happen": estimate aging, missing daily moisture reading [MT day boundary], invoice
overdue, stuck phase, dispatch SLA (`scan.no_appointment_after_create`) — code-defined registry,
thresholds-only config, deterministic uuidv5 dedup through the existing
`UNIQUE(automation_id, triggering_event_id)`),
and a **7-recipe starter pack seeded `enabled=false`**. Key finding recorded: the job/e-sign
trigger events ARE emitted (live counts verified — DB-side trigger functions from Mar-era
migrations; a repo-grep claim to the contrary was refuted), so no emit-path work is needed.
Commissions are explicitly NOT an action (stay derived via `is_real_job` → `get_commissions`).
Artifacts: roadmap "Phase 5-Ops plan (2026-07-03)" section, ownership manifest **§8** (Session L
row — Session K's two code files transferred post-#253; additive-ALTER allowance; call-only
plumbing list), Session L dispatch block in `docs/crm-dispatch.md`, and
`supabase/migrations/20260703_crm_phase5ops_stages.sql` (applied + verified: phase `5-ops`
seeded `planned` with 7 stages). Also this session: PR #169 (commissions foundation) reconciled
onto `dev` and merged — commission tracking starts from now (historical jobs stay unattributed
by owner decision).

## Tech Mobile v2 — plan of record (session 2026-07-03, docs + reviewer agent only — no feature code)

**What this session shipped** (branch `claude/planning-session-sec1ev` → PR into `dev`):
- `docs/tech-v2-roadmap.md` — the dispatch model of record for rebuilding the tech mobile
  Dashboard + Schedule to Apple/Google-Calendar polish and then merging TechAppointment +
  TechJobDetail into a Job Hub. Live-verified gap audit (taxonomy A–H), 7 severity findings,
  six phase blocks (**F → S ∥ D → C → M1 → M2**; S∥D disjointness adversarially proven,
  parallelism optional), dependency graph, ownership matrix + frozen list, options-on-record
  (TanStack Query vs hand-rolled cache; no virtualization dep; persister kept per owner
  offline decision), 6-agent challenge report folded in.
- `docs/tech-v2-dispatch.md` — six complete cold-session copy-paste blocks (F, S, D, C, M1, M2).
- `.claude/agents/tech-phase-reviewer.md` — Opus acceptance grader for tech-v2 phases
  (weights clock/time-entry math, flag rollout safety, legacy non-regression, frozen-list
  compliance; reconciles the roadmap checkboxes both directions).
- Zero code/schema/seed changes — non-CRM initiative; progress tracks via the roadmap doc's
  checklists (CRM tracker not used, on record).

**Key findings recorded in the roadmap** (full evidence there):
- **Two P1 root causes of "glitchy/slow":** `TechLayout.jsx:227-230` keys the content wrapper
  by pathname → every navigation remounts the page (all state dies, every RPC refires);
  `TechSchedule.jsx:486-510` derives the fetch window from `selectedDay` → every day tap
  refetches the full ~61-day window. Phase F ships a minimal v1 relief patch for both.
- **NEW live bug (challenge pass):** `clock_appointment_action` stamps `work_date` with the
  UTC date — a clock-in at/after 6pm MDT lands on tomorrow's `work_date` (1 of 158 live rows
  misdated; payroll groups by `work_date`; the midnight-split writer uses Denver — writers
  disagree). Fix = body-only REPLACE slotted into Phase F.
- **Schema drift ×13:** the core tech RPC surface (`get_my_appointments_today`,
  `get_assigned_tasks`, `toggle_appointment_task`, `update_appointment`, …) exists live with
  ZERO migration coverage. Phase F commits a verbatim `pg_get_functiondef` capture migration
  first.
- **The schema already out-runs the UI:** `appointments.color/kind/duration_days/is_milestone`
  exist but both tech feed RPCs strip them (desktop dispatch RPCs return color). Exposing
  them is additive jsonb keys — zero consumer breakage (challenge-confirmed).
- **Flag fail-open trap:** no `feature_flags` row = enabled for EVERYONE
  (`AuthContext.jsx:262`) — so v2 flag rows must be seeded in Supabase BEFORE any code
  referencing them merges; `EXPLICIT_FLAGS` entries need explicit `enabled:false`
  (auto-seed creates missing keys ON); `force_disabled` is inert for `isFeatureEnabled`.
- **Hours for the dashboard** must SUM the stored `job_time_entries.hours` column (+
  `travel_minutes`, + a live term for the open entry) — never recompute from timestamps
  (manual/admin-edited/midnight-split rows diverge); weeks are Monday-start Denver to match
  `get_payroll_summary`.
- Cancelled-as-"Upcoming" dash bug is latent-only: cancellation is a hard delete; zero
  `cancelled` rows have ever existed (no CHECK constraint prevents future writers, so v2
  feeds filter it anyway).

**Dispatch:** Wave 0 = Session F alone (Opus·high — flags seeded first, drift capture,
feed upgrades, `get_tech_dashboard`, work_date fix, v1 relief patch, TanStack trio
@5.101.2 + idb persister `upr-query-cache`, TechLayout pane host, v2 primitives + css
markers, ownership manifest). Wave 1 after F merges = Session S (Opus·high — Agenda + Day
timeline + week pager; Month view explicitly deferred) ∥ Session D (Opus·medium — Now/Next
hero, attention strip, My-numbers, one-RPC dashboard) — parallel-capable, serial fine.
Then C (Sonnet·medium cutover/cleanup + Month-view stretch, owner-gated bake), M1
(Opus·high Job Hub behind `page:tech_job_hub`), M2 (Opus·medium href flip + resolver
redirect + legacy detail deletion). Owner anytime-lane actions: flag flips in DevTools
(owner-only → all techs), phone bake sign-offs.

## Schedule Desktop — plan of record (session 2026-07-03, docs only — no feature code)

**What this session shipped** (branch `claude/build-plan-ftgfa1` → PR into `dev`):
- `docs/schedule-roadmap.md` — the dispatch model of record for the desktop Schedule page:
  create-and-schedule booking flow, dead-weight removal, Month-view parity. Live-verified
  evidence base (E1–E10), 5 severity findings, a full booking-modal design spec, three phase
  blocks (**A → B → C, strictly serial** — shared Schedule.jsx surface), dependency graph,
  ownership matrix + frozen-contract list, options-on-record, 3-agent challenge report folded in.
- `docs/schedule-dispatch.md` — three complete cold-session copy-paste blocks (A, B, C).
- Struck the stale "appointments→scheduled-jobs refactor" references in place (this doc's
  Calendar-sync section + `GOOGLE-INTEGRATIONS-HANDOFF.md`) — owner declared it stale; this plan
  supersedes it.
- Zero code/schema/seed changes — non-CRM initiative; progress tracks via the roadmap doc's
  checklists.

**Key findings recorded in the roadmap** (full evidence there):
- **The pain quantified:** 56 of 105 non-lead jobs (53%) have never had an appointment; every
  calendar create path requires an existing job; `Layout.jsx` force-navigates to the job page
  after create, which has zero scheduling affordance.
- **Templates/Wizard subsystem is data-proven dead** (0/230 appointments ever linked; wizard last
  run 2026-04-14) — Session B removes the UI; tables/RPCs stay, documented retired.
- **Owner corrections on record:** Week (not Month) is the beloved view; kill Jobs/Crew grids +
  3-Day span; HCP-style booking modal on the schedule page only; claim picker rows must show
  address · date of loss · claim number with "New claim" the default every time.
- **Live side-effect chain governs test protocol:** appointment INSERT triggers gcal sync; the
  worker emails the CLIENT ('confirmed', first-sync CAS) when job.client_email && notify_client
  (default TRUE), and emails + calendar-invites the CREW — test rows need no client_email/notify
  OFF and no real crew.
- **`get_dispatch_board` appointment objects carry no job_id** (parent job row does) — Month
  parity is frontend `_jobId` stamping, no RPC change; auto-show surfaces a new job with an
  in-range appointment without a pin, but the booking modal pins via `dispatch_board_jobs` to
  cover Auto-show-OFF.
- **`jobs.lead_source` exists, is NULL on all 236 jobs, zero writers** — booking modal writes it
  via post-insert update (an RPC param-add would mint an overload — the clock_appointment_action
  PGRST203 incident class).
- **Coordination:** draft PR #102 must be closed/rebased before Session B (it edits 6 of B's
  files incl. ScheduleTemplates.jsx, which B deletes); tech-v2 co-edits App.jsx (tech routes,
  different region) + index.css markers — Session A pre-commits all three SCHEDULE V2 markers.

**Dispatch:** Wave 0 = Session A (Opus·high — shared client/claim component extraction, tested
save chain, BookingModal, creationPicker "New job" entry, ~70%-budget chained-modals fallback).
Wave 1 = Session B (Opus·medium — Templates/Wizard removal end-to-end incl. both navItems entries
+ Admin.jsx registry row, viewMode-axis collapse with placementMode over-deletion guard, verbatim
MonthView extraction, JobPage "Schedule appointment" reverse path, remodeling-filter fix as its
own commit; gated on PR #102 closure). Wave 2 = Session C (Opus·medium — Month drag-reschedule,
click-day create, events rendering, chip enrichment; Week regression-verify only).

**⚠️ Owner amendment (2026-07-03, later the same day — recorded by the notify planning
session):** the owner changed their mind on the view axis — **KEEP the 3-Day view** ("works
great for iPad") alongside Week (daily driver, "pretty much perfect as is") and Month
(occasional overview + future HCP-style Gantt foundation). This supersedes the "kill … 3-Day
span" item above; `docs/schedule-roadmap.md` carries the same dated amendment. Session B of the
Schedule initiative must scope its viewMode-axis collapse to Jobs/Crew grids only.

**⚠️ Second amendment round (2026-07-03, owner conversation — this session):** ① Session C
rescoped from "Month parity, visuals identical" to **"Month upgraded to Week's design SYSTEM at
month DENSITY"** — miniature single-line eventCardStyle chips (soft-tint + left accent, replacing
the solid divColor blocks), Week's event/completed/status semantics, Week's hover popover; Week's
full card geometry explicitly NOT transplanted (month cells ~90px — density is the acceptance
bar). Owner delegated the design specifics to planner judgment ("do what's really best for the
monthly view"); the trade-off is in the roadmap's options-on-record. ② Week view: zero changes in
any phase, byte-identical. ③ **Mobile declared an explicit non-goal** for the desktop schedule
page (roadmap decision ⑨) — the tech app owns mobile scheduling and is untouched. ④ The stale
in-place "3-Day gone" text in the roadmap/dispatch Session B blocks was fixed to match the first
amendment. `docs/schedule-roadmap.md` + `docs/schedule-dispatch.md` are authoritative.

**⚠️ Third amendment round (2026-07-03, owner — this session): DEACTIVATE, don't delete.** The
Jobs view, Crew view, AND the Templates/Wizard subsystem are **deactivated (hidden from the UI,
all code + route + tables + RPCs retained dormant)** — "deactivate them for a while until we start
developing those again." **Calendar becomes the only active schedule view**; Templates/Wizard is
kept as the future-Gantt groundwork. Session B is rescoped from removal to reversible deactivation
(hide from view toggle / nav / entry points; grid code + ScheduleTemplates.jsx + ScheduleWizard.jsx
stay). **iPhone now defaults to the Calendar view** (guaranteed — Calendar is the only viewMode;
Day span on phones, matching the mobile app), which also auto-fixes the F3 stale-localStorage bug;
**desktop is unchanged (Calendar + Week default)**. Consequence: draft PR #102 downgrades from hard
gate to soft coordination (B no longer deletes a file #102 edits). `docs/schedule-roadmap.md` +
`docs/schedule-dispatch.md` are authoritative.

## Notification Center — plan of record (session 2026-07-03, docs only — no feature code)

**What this session shipped** (committed straight to `dev`): `docs/notify-roadmap.md` (the
authoritative plan of record — findings, event catalog, phase blocks, ownership matrix, frozen
list, dependency graph) + `docs/notify-dispatch.md` (copy-paste cold-session prompts) + the
stale-SW doc corrections in THIS file (PWA section, Tech SW bullet, registerSW line — they
described the killed Apr-2026 CacheFirst SW as live) + the Schedule-views owner note.

**The initiative:** Web Push to the installed iPhone PWA + desktop (VAPID/RFC 8291 — zero new
deps; the crypto was proven by executing RFC 8291 Appendix A byte-for-byte in the repo's test
runtime during planning) + an email channel + the existing bell, governed by per-user
preferences (types × push/email/both), role-scoped catalogs, and admin-managed lockable
system-wide defaults. Event catalog v1: message.inbound, appointment.assigned/updated/canceled,
estimate.accepted, payment.received, lead.new, esign.signed, feedback.submitted, timesheet/clock
events.

**Phases:** F1 delivery spike (SW re-enable behind `feature:web_push` + webPush.js crypto +
push_subscriptions + one hardcoded push; **stop-the-line owner gate: a real push must land on
the owner's iPhone home-screen PWA before anything else is built**) → F2 data foundation
(catalog + three-layer prefs + `notifications.recipient_id` + bell RPC DROP+CREATE cutover +
notify.js dispatcher + frozen stubs + inert appointment triggers) → one parallel wave: B event
wiring ∥ C my-prefs UI (Settings panel + /tech/notifications) ∥ D admin defaults UI
(disjointness challenge-proven; `get_effective_notification_prefs` ships fully implemented in
F2 and is frozen — the predicted C/D collision).

**Key findings recorded there:** main.jsx:44-72 kills any SW on every load (rewrite required;
flags load post-auth → localStorage mirror); push-only SW cannot re-create the MIME trap;
`google-calendar.js:531-534` already emails assigned employees (dedupe seam = the emailKind
decision, Session B); bell RPC cutover must be ALTER-first DROP+CREATE with re-GRANTs
(challenge-CONFIRMED); payment hook belongs in `functions/lib/qbo-payment-sync.js` (serves both
QBO paths); callrail-backfill must never fire lead.new. **Schema drift (live, unversioned, do
not ALTER):** `device_tokens` (+ upsert/delete RPCs; delete has zero callers), orphan
`notification_queue` (0 rows, anon-open writes — untouched per the `automation_rules`
precedent), `google_calendar_links.assigned_notified_at`/`time_sig`. `push_subscriptions` will
ship with NO anon SELECT (endpoint+p256dh+auth are send-capability secrets) — a documented
deviation from the house USING(true) pattern.

### F1 (delivery spike) — built, awaiting owner gate (2026-07-03)

Web Push proven end-to-end in code; the **stop-the-line owner gate** (real push on the owner's
iPhone PWA + desktop) is the only open item — it needs owner actions (env vars + flag flip +
device install), so it cannot be closed in-session.

**Crypto — `functions/lib/webPush.js`** (pure WebCrypto, zero npm deps, runs in Workers):
- `encrypt(payload, {p256dh,auth}, {asKeyPair,salt})` — RFC 8291 message encryption (aes128gcm /
  RFC 8188). Injectable `{asKeyPair, salt}` reproduces **RFC 8291 Appendix A byte-for-byte**
  (test-pinned); prod defaults to a fresh ephemeral ECDH pair + random 16-byte salt per call.
- VAPID (RFC 8292) ES256: `importVapidPrivateKey` (PKCS8 base64/PEM — raw EC private import is
  unsupported, mirrors send-push's `importP8Key`), `buildVapidJwt` (aud = endpoint origin,
  exp ≤ 24h, sub = mailto), `vapidAuthorizationHeader` (`vapid t=…, k=…`).
- `sendWebPush(subscription, payload, env, opts)` — encrypt + POST one subscription; **503-skips**
  when VAPID env is unset (APNs precedent), surfaces 404/410 for caller-side pruning.
- Tests: `functions/lib/webPush.test.js` (10) — Appendix A KAT, VAPID verify round-trip (never a
  byte-compare — ECDSA is randomized), b64url edges. Committed failing first.

**Schema — `push_subscriptions`** (migration `20260703_notify_f1_push_subscriptions.sql`, applied
via MCP): one row per device (`employee_id`, `endpoint` UNIQUE, `p256dh`, `auth`, `user_agent`).
**RLS ON with NO policy** — the documented deviation (finding 4): endpoint+p256dh+auth are
send-capability secrets, so no house `USING(true)` policy; reachable only via the two
SECURITY DEFINER own-row RPCs + the service-role worker (dashboard_layouts precedent). RPCs:
`upsert_push_subscription(p_endpoint,p_p256dh,p_auth,p_user_agent DEFAULT NULL) → push_subscriptions`
and `delete_push_subscription(p_endpoint) → void` (caller resolved via `auth.uid()`,
GRANT EXECUTE TO authenticated). PostgREST cache busted.

**Service worker — `public/sw.js`** rewritten as **push + notificationclick handlers ONLY, zero
fetch caching** (the Apr-2026 MIME/blank-page trap cannot re-form without a caching fetch
handler). `push` → `showNotification`; `notificationclick` → focus an open window (navigate) or
`openWindow(url)`.

**SW re-enable — `src/main.jsx`** SW block is now flag-gated on `feature:web_push`: **ON** →
register `/sw.js`; **OFF** → the original kill-switch (unregister + cache wipe + `/reset` bounce)
**verbatim**. Flags load post-auth, so main.jsx reads a **localStorage mirror**
(`upr:web_push_enabled`) written by `AuthContext.loadFeatureFlags` (same enabled/dev-only
resolution as `isFeatureEnabled`; missing row = OFF; one-page-load lag accepted). `BUILD_ID`
bumped to `2026-07-03-web-push-f1`. `src/lib/registerSW.js` rewritten as the registration + mirror
helper (`isWebPushEnabled`, `registerPushServiceWorker`, `WEB_PUSH_FLAG_MIRROR_KEY`).

**Subscribe client — `src/lib/webPushClient.js`**: `enablePush(db)` (permission →
`pushManager.subscribe({applicationServerKey: VITE_VAPID_PUBLIC_KEY})` → `upsert_push_subscription`),
`disablePush(db)` (unsubscribe + `delete_push_subscription`), capability guards
(`isPushSupported`/`isPushConfigured`/`pushPermission`) — iOS only exposes Push in an installed PWA.

**UI — `src/pages/Settings.jsx`**: new **Notifications** entry in `SETTINGS_NAV` + skeleton
`NotificationsPanel` with one working "Enable push on this device" row (inline two-click "Turn
off" confirm, toasts, iOS Add-to-Home-Screen guidance when uninstalled). The full types × channels
matrix is Session C's.

**Reference event — `functions/api/feedback-notify.js`**: additive fire-and-forget Web Push channel
(`sendWebPushToAdmins`) alongside the existing bell + APNs — pushes each admin recipient's
subscriptions behind `feature:web_push` (globally-enabled OR the recipient is the flag's
`dev_only_user_id` — the owner-gate window), 503-skips when VAPID is unset, prunes 404/410. Note:
audience is **admins minus the submitter** (catalog semantics) — for the owner gate, a *non-owner*
must submit the test feedback (or the owner submits from a second account) for the push to reach
the owner's device.

**Flag:** `feature:web_push` seeded in `featureFlags.js` (enabled:false) + a live `feature_flags`
row (enabled=false, `dev_only_user_id` = owner `dd188c16-…`) so the owner can self-enable to run
the gate without exposing push to staff.

**VAPID config — stored in Supabase (no Cloudflare env needed).** Owner preference (2026-07-03):
manage VAPID like every other worker secret rather than in Cloudflare. `loadVapidConfig(env, db)`
in `webPush.js` prefers Cloudflare env but falls back to Supabase — **private key** in
`integration_credentials` (`provider='web_push'.access_token`, PKCS8; RLS-on-no-policy, same
lockdown as the existing Deepgram/CallRail/GitHub tokens — never client-readable), **public key +
subject** in `integration_config` (`vapid_public_key` / `vapid_subject`). The client fetches the
public key at runtime from the new `GET /api/vapid-public-key` worker (returns ONLY the public
key), so there is **no build-time `VITE_VAPID_PUBLIC_KEY`** and zero Cloudflare dependency. All
three values were stored in the shared Supabase this session (Cloudflare env still works as an
override if ever preferred).

**Owner gate (OPEN — hand-off):** VAPID is already stored in Supabase, so no Cloudflare steps.
Owner keeps `feature:web_push` dev-only-on for themselves, installs the PWA (Share → Add to Home
Screen), enables push in Settings → Notifications, then a non-owner submits test feedback → a real
push must land on the locked iPhone AND desktop Chrome. **If iOS delivery fails: HALT — F2 and the
wave do not launch against a dead channel.** (VAPID keypair generated this session; private key is
in `integration_credentials`, never committed to the repo.)

### F2 (data foundation) — shipped 2026-07-03

Migration `20260703_notify_f2_foundation.sql` (applied via MCP; bell cutover, resolver
precedence + per-recipient targeting all verified live).

**Per-recipient bell.** `notifications` gained additive `recipient_id uuid NULL` (FK employees,
ON DELETE CASCADE) + `type_key text`. **NULL recipient = broadcast** → every pre-existing row
and every legacy `create_notification` caller keeps today's org-wide behavior. The three bell
RPCs were rebuilt via **DROP+CREATE** (never `OR REPLACE` — a wider signature mints an ambiguous
overload for the old `{}`/`{p_limit}` shapes, the `20260702_feedback_media.sql` trap):
`get_notifications(p_limit int DEFAULT 30, p_employee_id uuid DEFAULT NULL)`,
`get_unread_notification_count(p_employee_id uuid DEFAULT NULL)`,
`mark_all_notifications_read(p_employee_id uuid DEFAULT NULL)` — all with
`recipient_id IS NULL OR recipient_id = p_employee_id` semantics (fixes the P3 global-mark-all
bug). `create_notification` DROP+CREATEd with trailing `p_recipient_id`/`p_type_key` (defaulted,
so the 5 legacy callers are unaffected). Re-GRANTed to anon/authenticated/service_role after each.
A narrow `notifications_delete_testrows` policy lets the integration suite delete only its
`type='__f2test__'` sentinels (self-cleaning; real code never emits that type).

**Frontend:** `NotificationBell.jsx` now passes `employee.id` to the three RPCs (so each person
sees broadcast + own-targeted rows with their own read state) and ignores realtime inserts aimed
at a different employee; gained a `size` prop (office bell unchanged at 36). Mounted in
`TechLayout.jsx` (top-right, size 46 for the 48px field target; offline pill stacked below) so
techs get the badge + live toast. **Per the roadmap amendment, F2 adds NO `/tech/notifications`
route / TechMore row / stub page** — the shipped `/tech/settings` hub is the tech surface.

**Catalog — `notification_types`** (RLS + policy): 12 seeded types (`message.inbound`,
`appointment.assigned|updated|canceled`, `estimate.accepted`, `payment.received`, `lead.new`,
`esign.signed`, `feedback.submitted`, `timesheet.change_requested|change_reviewed`,
`clock.abandoned`) with `bell_default`/`push_default`/`email_default` + an `enabled` master
switch. Conservative seeds: bell on; push structurally opt-in; email silent except
`estimate.accepted`/`payment.received`; **only `feedback.submitted` enabled** — every other type
is INERT until Session B flips it.

**Three-layer prefs** (all RLS + policy at creation): `notification_role_defaults`
(role×type×channel + `user_customizable` lock — Session D writes), `notification_employee_overrides`
(admin per-employee — Session D writes), `notification_prefs` (self-service — Session C writes).
The ONE resolver, **`get_effective_notification_prefs(p_employee_id) → SETOF json`** (F2-owned,
fully implemented, **frozen in-wave — nobody REPLACEs it**), returns one row per (type,channel)
with `enabled` + `user_customizable`, precedence lowest→highest: catalog default → role default
→ admin override → my-pref, and **the lock wins** (a `user_customizable=false` row ignores
my-pref so the admin value stands). Missing role default ⇒ customizable, value from the catalog.

**Frozen stubs** (SECURITY DEFINER + GRANT + `RAISE 'not implemented'`; signatures per the
roadmap — `migration-safety-checker` enforces). Session C: `get_my_notification_prefs`,
`set_my_notification_pref`, `get_my_push_subscriptions`. Session D: `get_notification_defaults`,
`set_notification_default`, `get_employee_notification_overrides`,
`set_employee_notification_override`, `delete_employee_notification_override`.

**Dispatcher — `functions/api/notify.js`** (POST `/api/notify`): resolve audience →
`get_effective_notification_prefs` per recipient → per-recipient `create_notification` (bell) →
Web Push per subscription (`webPush.js`; 503-skip when VAPID unset, prune 404/410) →
transactional email via `sendEmail` (from `UPR - Notifications <restoration@utahpros.app>`;
NULL-address skip reported). Auth checks a supplied `x-webhook-secret` first with no Bearer fallback
on mismatch; matching secret callers retain the full deployed server payload. The legacy human
Bearer path now requires an active internal admin and accepts only object-proven
`appointment.assigned|updated|canceled` or `estimate.accepted` IDs; caller recipients, copy, HTML,
payload/data, entity/job fields and links are rejected. No checked-in browser/mobile/desktop Bearer
caller exists. Disabled types are inert (`{skipped}`). `dispatchEvent` is the reusable core
imported in-process by `feedback-notify.js`, which F2 **rewired** to replace F1's hardcoded
bell+APNs+webpush block with one `dispatchEvent('feedback.submitted', …)` call (still
fire-and-forget). All other trusted in-process callers and the sequential best-effort
fan-out/summary contract are unchanged. Optional APNs forward was omitted — native push stays
separate/dormant. Shared Auth and Web Push fetches remain unbounded legacy paths. Critically,
`notify_emit(text,jsonb)` remains an authenticated-executable `SECURITY DEFINER` confused-deputy
path that can present the stored secret with caller-controlled JSON; S1c HTTP hardening is partial
containment. S1d (`20260726110000_notify_emit_service_boundary.sql`) now provides the separately
reviewed local migration/rollback/tests: revoke browser execution, retain `service_role`, preserve
the owner-run trigger/RPC/cron chain, and reverse only the object merge so the trusted type key
wins. It is **not applied**, so this paragraph still describes the live capability until an
owner-authorized apply/verification window.

**Emission triggers** (live `20260630` pattern; **doubly inert**): `trg_appointment_crew_notify`
(appointment_crew INSERT → `appointment.assigned`) and `trg_appointment_notify` (appointments
guarded UPDATE → `appointment.updated`/`.canceled`, `IS NOT DISTINCT FROM` column guard). Both
call `notify_emit(type_key, body)`, which returns early unless the catalog type is enabled AND
`integration_config.notify_worker_url` is set → **zero traffic until Session B enables the types**.
`integration_config` seeded this session: `notify_worker_url = https://utahpros.app/api/notify` +
a server-generated `notify_webhook_secret` (never committed; the worker validates against it via
service role — no Cloudflare env needed).

**Tests:** `functions/api/notify.test.js` (injected fakes — audience, prefs gating, NULL-email
skip, VAPID 503-skip, 404/410 prune, auth) + `supabase/tests/notify_foundation.test.js`
(integration — old bell shapes, targeting, resolver precedence; self-skips without creds, verified
live via MCP). `feedback-notify.test.js` rewired to assert delegation.

**2026-07-26 S1g supersession:** the legacy `notify_foundation.test.js` was retired because its
anonymous shared-database client, sentinel DELETE cleanup, and broadcast-mutating mark-all probe
are unsafe/incompatible with the recipient/read boundary. Bell signature, recipient, RLS, and read
behavior now live in the two-gate, rollback-only S1g SQL suite wired to the local-only DB runner.
Full preference-resolver integration coverage remains a separate identity/preferences QA item;
this note does not rewrite the historical F2 verification claim.

### Session B (event wiring) — shipped Jul 3 2026
One emit hook at each event origin, all **additive + fire-and-forget** (a notify failure can never
throw into a webhook's business path — payment webhooks especially). Every hook calls the frozen
`dispatchEvent` in-process (never edits `notify.js`) and is **inert until its catalog type is
enabled** (a disabled type returns `{skipped}`). **Zero schema migrations.**

**Hooks (files owned by Session B):**
- **`message.inbound`** — `functions/api/twilio-webhook.js` (`notifyInboundMessage`, exported/tested),
  fired via `context.waitUntil` after the inbound `messages` insert. Audience = `conversation.assigned_to`
  when set, else the office/admin fallback (`ROLE_AUDIENCE`). Never fires for STOP/START/HELP (they
  return before the message insert).
- **`payment.received`** — one shared helper `notifyPaymentReceived` in
  **`functions/lib/qbo-payment-sync.js`** (the LIB, so BOTH `qbo-webhook` and the hourly
  `qbo-payments-sync` cron are covered — fires only in the `recorded` insert branch, so a
  re-delivered webhook that hits `already-synced` never re-fires), reused by
  `functions/api/stripe-webhook.js` (fires only on a fresh `payments` insert) and
  `functions/api/qbo-charge.js` (after the card payment is recorded).
- **`lead.new`** — `functions/api/callrail-webhook.js` (`notifyNewLead`) + `functions/api/form-submit.js`
  (`notifyNewLeadFromForm`). **Idempotent by a pre-existence check** on `inbound_leads.callrail_id`
  (calls send `started/completed/recording-ready`; form tokens can resubmit) → fires only on the
  FIRST delivery. Hook lives ONLY in the webhook/form worker, **never in the shared upsert RPC**, so
  `callrail-backfill.js` can never fire it (regression-guarded by test). Flagged spam is skipped.
- **`esign.signed`** — `functions/api/submit-esign.js` (`notifyEsignSigned`): **rewired** — replaced
  the legacy global `create_notification('esign_signed')` bell with `dispatchEvent('esign.signed')`
  (per-recipient bell + push + email via prefs; audience = admins). Job-note + internal PDF email unchanged.
- **`appointment.assigned` email dedupe seam** — `functions/lib/google-calendar.js`
  (`decideEmailKind` + `assignedEmailAllowed`, both exported/tested). The legacy calendar-sync
  "assigned"/"rescheduled" employee email **is** the appointment.assigned EMAIL channel (finding 5):
  now gated per-recipient on the employee's EFFECTIVE `appointment.assigned` email pref
  (**default-silent** — no longer fires ungated). The notify path delivers appointment.assigned as
  bell + push only (`email_default=false`), so this one path owns the email → **no double email**.

**Types enabled live (data flip, not schema).** `message.inbound`, `payment.received`, `lead.new`,
`esign.signed` flipped `enabled=true` via MCP with their F2 seeds unchanged (bell+push on; email off
except the curated `payment.received`). These four are **code-hook** types with NO DB trigger, so the
flip is inert until the worker code deploys — zero live risk on the shared prod DB. Effective-prefs
resolution for an admin verified live (bell+push on; email only on payment.received).

**Deferred (owner/preview-gated activation) — `appointment.assigned|updated|canceled`.** Their
emission triggers are ALREADY live in the DB and POST to `notify_worker_url = https://utahpros.app/api/notify`
(**prod**), where `notify.js` is **not yet deployed** (it's on `dev`, not `main`). Flipping these
`enabled=true` now would fire prod triggers into a 404 and can't be E2E-verified without a preview.
So they stay **disabled**, to be enabled at the `dev → main` release once `notify.js` is on prod and
the trigger is E2E-verified on the branch preview. Activation runbook lives in `docs/notify-roadmap.md`
(Session B block). One SQL statement:
`UPDATE notification_types SET enabled=true WHERE type_key IN ('appointment.assigned','appointment.updated','appointment.canceled');`

**Decision forks (resolved).**
- **payment.received: worker-hooks (chosen)** over a payments-INSERT trigger. A trigger would also
  cover frontend inserts (InvoiceEditor/ClaimBilling) + MCP bulk imports but needs a retroactive-import
  guard and IS schema (forbidden in B). Coverage gap accepted: a manually-entered payment (frontend)
  or an MCP import won't notify — a human entering it already knows. Flagged as a possible future trigger.
- **estimate.accepted: not wired by B.** Its only origins (the `convert_estimate_to_invoice` code sites
  / an estimates-status trigger) are OUTSIDE Session B's 8-file ownership (and a trigger = schema).
  Direction chosen = code-site hooks (covers all in-app acceptances; the 1/14 out-of-band approved row
  isn't worth a schema trigger), but the hook is a follow-up — `estimate.accepted` stays **disabled**.
- **create_manual_lead: OUT of `lead.new`** (default). Manual entry means a human already knows; and
  `CrmLeads.jsx` isn't in B's file scope anyway.
- **Noisy-channel guardrail:** kept F2's conservative seeds as-is (push structurally opt-in via
  `push_subscriptions`; email silent except the curated `payment.received`). No channel is emailed
  broadly before C/D land.

**Tests (all injected-fake, no creds):** `twilio-webhook.test.js` (message.inbound), `lead-notify.test.js`
(callrail + form lead.new + backfill-never-fires guard), `qbo-payment-sync.test.js` (payment.received
helper + recorded-only idempotency), `submit-esign.test.js` (esign.signed), `google-calendar.test.js`
(prefs-off suppression + no-double-email). Full suite green; every hook proven to swallow a dispatcher
error without throwing into its business path.

### Follow-ups (2026-07-04) — all 12 types live + nicer copy
After the `dev → main` release, all remaining types were **enabled** (`notification_types` now 12/12
`enabled=true`) and the 4 that had no emitter were wired. Supersedes the "deferred / not wired by B"
notes above.
- **Appointment copy enrichment (`functions/api/notify.js`).** The appointment triggers pass only
  `{ appointment_id }`, so pushes read a bare "Appointment assigned". `dispatchEvent` now enriches
  `appointment.*` (and `estimate.accepted`) into a clean title + body + deep link before fan-out —
  e.g. **"New appointment · Water Mitigation"** / **"Sat, Jul 4 · 9:00 AM – 11:00 AM"** →
  `/tech/appointment/:id`. Helpers `formatApptWhen` / `enrichAppointmentBody` / `enrichEstimateBody`
  (unit-tested, 27 in `notify.test.js`). `appointments.date/time_start/time_end` are wall-clock, so no
  tz conversion; the date is anchored at UTC-noon to stay off-by-one-safe. (iOS's "from UPR DEV" line is
  the cached PWA name of the dev install — OS attribution, not our payload; prod shows "UPR".)
- **`estimate.accepted`** — new DB trigger `trg_estimate_accepted_notify` (`20260704_notify_estimate_accepted.sql`)
  AFTER INSERT OR UPDATE OF status ON estimates, fires on a real transition to `status='approved'`
  (catches the "Convert to invoice" RPC **and** out-of-band writes). Body enriched in the worker
  (estimate number + amount + client). Audience admins.
- **`timesheet.change_requested` / `timesheet.change_reviewed`** (`20260704_notify_timesheet_events.sql`)
  — body-only `CREATE OR REPLACE` of `submit_time_entry_change_request` / `review_time_entry_change_request`
  (signatures unchanged), swapping the legacy catalog-less `create_notification` broadcast for
  `notify_emit(<catalog type>, …)`. Requested → admins; reviewed → the requester (via `body.employee_id`);
  the old approved/rejected split folds into one `timesheet.change_reviewed` with the decision in payload.
  All other logic (validation, `admin_upsert_time_entry`, `system_events` audit) byte-for-byte preserved.
- **`clock.abandoned`** (`20260704_notify_clock_abandoned_scan.sql`) — new SECURITY DEFINER
  `scan_abandoned_clocks(p_now, p_threshold_minutes=600)` + **pg_cron** `upr_scan_abandoned_clocks`
  (`*/30 * * * *`). Flags an OPEN live entry (`clock_out IS NULL AND travel_start IS NOT NULL`) whose
  `travel_start` is ≥10h ago (matches `FORGOT_CLOCKOUT_MIN`). Dedup = a `system_events('clock.abandoned',
  'job_time_entry', entry_id)` marker written **before** emit → at most once per entry, ever; does NOT
  close the entry (soft warning). Internal-only: `REVOKE ALL … FROM PUBLIC, anon, authenticated` (PUBLIC
  is the load-bearing revoke). Audience admins, bell-only.
- **Emitter status:** appointment.* + estimate.accepted + timesheet.* + clock.abandoned + the 5 Session-B/
  feedback types = **all 12 now have a live emitter**. `migration-safety-checker` + `upr-pattern-checker`
  clean (after fixing the PUBLIC-revoke gap they caught).

### Session C (my-prefs UI) — shipped (2026-07-03)
Self-service notification preferences on both the office **Settings → Notifications** panel and
the field-tech **/tech/settings** hub, plus a device manager. Ships **zero schema** — only
body-fills its three frozen stubs (`20260703_notify_c_my_prefs_rpcs.sql`, function-body-only
`CREATE OR REPLACE`, signatures unchanged; `migration-safety-checker` clean).

**RPC stub fills (applied + verified live via MCP):**
- `get_my_notification_prefs(p_employee_id) → SETOF json` — reads THROUGH the frozen resolver
  `get_effective_notification_prefs` and filters to **live types only** (`type_enabled=true`), so
  precedence/lock logic lives in exactly one place. Until Session B enables types, this returns
  only `feedback.submitted` (the sole enabled type today).
- `set_my_notification_pref(p_employee_id, p_type_key, p_channel, p_enabled) → notification_prefs`
  — upserts the caller's own pref (`ON CONFLICT (employee_id,type_key,channel)`), but **RAISEs when
  the role default locks the cell** (`user_customizable=false`; missing role default ⇒ customizable,
  matching the resolver's `COALESCE(...,true)`). Validates channel ∈ (bell,push,email).
- `get_my_push_subscriptions(p_employee_id) → SETOF json` — device list as `{id, label (user_agent),
  created_at, endpoint_hash}` — **NEVER** endpoint/p256dh/auth (send-capability secrets).
  `endpoint_hash` = first 16 hex of `extensions.digest(endpoint,'sha256')` (schema-qualified —
  pgcrypto lives in `extensions`); the client SHA-256s the current subscription's endpoint locally
  to recognise "this device" without ever seeing the raw endpoint.

**Frontend:**
- `src/components/settings/NotificationPrefsMatrix.jsx` (new, shared) — type × channel checkbox
  grid from `get_my_notification_prefs`; optimistic toggle with revert-on-error toast; locked cells
  render a disabled box + 🔒 hint (server also rejects the write — defence-in-depth). `variant`
  prop (`office`/`tech`) picks sizing; `categoryFilter` narrows rows.
- `src/components/settings/PushDevicesList.jsx` (new, office) — device list; the current device is
  badged "This device" and removable with a two-click confirm (real `pushManager.unsubscribe` +
  `delete_push_subscription` via `disablePush`). Other devices are info-only (a remote browser's
  registration can't be revoked from here; dead endpoints self-prune on 404/410).
- `src/pages/Settings.jsx` — `NotificationsPanel` now renders the enable-push row (F1) + device list
  + the office matrix (all enabled types).
- `src/components/tech/settings/NotificationsSection.jsx` — a second card renders the matrix with
  `variant="tech"` (≥48px targets), filtered to tech-visible categories `['appointments','messaging']`
  (interim until Session D seeds per-role defaults). iOS-not-installed → the existing
  display-mode:standalone check shows the "Share → Add to Home Screen" guidance before the enable
  button. New i18n keys under `settings.notifications.*` (en/es/pt).
- CSS: all inside the **`NOTIFY CENTER RESERVED — Session C`** marker in `index.css` (`.notif-matrix*`,
  `.notif-device*`, `.notif-prefs-section*`; tokens only, theme-aware).

**Tests:** `supabase/tests/notify_c_my_prefs.test.js` (integration, self-skips without creds like
the other notify suites; verified live via MCP): my-pref upsert round-trip, locked-row rejection,
and the push-subscription listing leaks no endpoint/p256dh/auth. `npm test` 518 pass / 88 skip,
`npm run build` clean, eslint no new errors, `upr-pattern-checker` clean.

### Session D (admin defaults UI) — shipped 2026-07-03

Admin → **Notifications** tab (`src/pages/Admin.jsx` wires it; all logic in the new
`src/components/admin/NotificationDefaultsTab.jsx`). Admin-only via the existing in-component
role check on `Admin.jsx` (behind `AdminRoute`). Two sub-views:

- **Role Defaults** — a role selector (admin/office/project_manager/supervisor/field_tech/
  crm_partner) → a type × channel (bell/push/email) matrix with auto-save toggles, plus a
  per-role×type **lock** (🔓/🔒). Types not yet enabled show a "Not live yet" badge. The lock is
  stored per role×type×channel but presented once per row; flipping it writes all three channels
  (each keeping its current on/off) so they stay in sync — a locked row hides from the user's
  self-service matrix (Session C).
- **Employee Overrides** — employee selector → per-type tri-state per channel: dashed = follows
  role default, green = override ON, red = override OFF, with a per-cell **×** clear and a
  two-click inline **Clear all overrides** (Rule 2 — no confirm/modal). The "effective" value the
  RPC returns is computed identically to `get_effective_notification_prefs` so the admin sees
  exactly what the resolver will apply (except a user's own unlocked pref, layer 3).

**RPCs — body-only fills of the F2 frozen stubs** (`20260703_notify_d_admin_defaults_rpcs.sql`,
applied + verified live via MCP; signatures frozen, zero schema):
- `get_notification_defaults() → SETOF json` — full role × type × channel matrix; where no
  `notification_role_defaults` row exists, `enabled` falls back to the catalog channel default and
  `user_customizable` to `true` (fields: role, type_key, label, category, sort_order, channel,
  type_enabled, type_channel_default, enabled, user_customizable, has_default). Role set is a fixed
  SQL VALUES list matching Admin.jsx `ROLES`.
- `set_notification_default(p_role, p_type_key, p_channel, p_enabled, p_user_customizable DEFAULT NULL) → notification_role_defaults`
  — upsert on `(role,type_key,channel)`; **`p_user_customizable` NULL = leave the lock unchanged**
  (new rows default customizable=true).
- `get_employee_notification_overrides(p_employee_id) → SETOF json` — one row per type×channel:
  role_default, user_customizable, has_override, override_enabled, has_my_pref, and a
  resolver-identical `effective`.
- `set_employee_notification_override(p_employee_id, p_type_key, p_channel, p_enabled, p_actor_id DEFAULT NULL) → notification_employee_overrides`
  — upsert; stamps `updated_by`.
- `delete_employee_notification_override(p_employee_id, p_type_key, p_channel) → void`.

Never re-REPLACEs `get_effective_notification_prefs` (F2-owned). CSS lives only in the
`NOTIFY CENTER RESERVED — Session D` marker (`notify-def-*` classes). Test:
`supabase/tests/notify_d_admin_defaults.test.js` (role-default upsert incl. NULL-lock-unchanged,
override set/delete round-trip, and a lock flip asserted THROUGH the F2 resolver) — self-skips
without creds like the other notify suites; its assertions were verified live via MCP this session.
`migration-safety-checker` + `upr-pattern-checker` clean; build + full `npm test` (518 passed)
green. Sentinel test rows deleted.

## Omnichannel Inbox — plan of record (session 2026-07-04, docs only — no feature code)

Planned the unified email+SMS conversation inbox (slug `omni-inbox`) to the roadmap-v3
standard. Deliverables committed this session (zero feature code): `docs/omni-inbox-roadmap.md`,
`docs/omni-inbox-dispatch.md` (4 cold-session blocks), `.claude/rules/omni-inbox-wave-ownership.md`.

**Goal.** Land inbound client email replies inside the existing SMS-only inbox
(`Conversations.jsx`, one component reused by staff/CRM/tech), unified into ONE per-contact
thread, channel-badged, with a structurally channel-safe composer. Owner decisions: unified
per-contact thread; inbound via a standalone **Cloudflare Email Worker**; **reply-only,
channel-locked, transactional** email.

**Key live findings (2026-07-04).** `messages.type` folds channel+direction into
`sms_inbound|sms_outbound|internal_note`; `messages.channel` exists (CHECK `sms|mms|rcs`) but
is mostly null with **no DEFAULT**; `conversations` is `twilio_number`-bound with no channel
(but threads already resolve by participant `contact_id` → already de-facto per-contact);
`conversation_participants` is phone-only (no email); **no inbound-email path exists**; outbound
`email.js` stores no Message-ID (and Resend does NOT return the RFC Message-ID — so the
plus-addressed reply token is the sole correlator); **no Resend bounce/complaint webhook** and
`email_suppressions` is empty (fed only by unsubscribe clicks). A live footgun:
`Conversations.jsx:452-466` silently `db.insert`s a message on worker error, bypassing channel
routing.

**Structure.** Foundation (F: all schema — widened `messages` type/channel CHECKs +
`channel DEFAULT 'sms'` + email columns, `conversation_participants.email`,
`conversations.email_reply_token`, `email_inbound_events` + `claim_inbound_email` RPC;
`email-threading.js` + `conversation-email.js` (reason-aware suppression gate);
`resend-webhook.js` (Svix/Web-Crypto → hard_bounce/complaint suppression); one-line
`process-sequences.js` reply widen; feature flag) → wave **I ∥ O** → **U**. Dependency edges:
F→I/O/U hard, **O→U hard** (no send UI before the channel-safe worker), I externally gated on
the owner's Cloudflare `reply@` route + `INBOUND_EMAIL_SECRET`. Six wrong-channel invariants
bind O/U (worker is sole writer of external rows; stored channel = transport actually used; no
cross-channel fallback; internal_note unsendable; channel-selected consent gate; token sets
thread only). Full detail in `docs/omni-inbox-roadmap.md`.

**Challenge pass.** Reordered from flat-parallel to F→(I∥O)→U; found the send footgun; forced
the channel DEFAULT + backfill; dropped an impossible In-Reply-To correlation fallback (token
only); added a triage queue for unmatched inbound + a bounce/complaint webhook; verified
Cloudflare subaddressing (base `reply@` rule + toggle, no catch-all) and Resend Svix signing.
Reviewer agents reused (no new agent): `migration-safety-checker`, `consent-path-auditor`,
`upr-pattern-checker`.

---

## Admin Mobile — plan of record committed (Jul 7 2026 — docs/seed/agent only, no feature code)

**Goal.** Bring core admin capability into the **field-tech PWA** (`/tech/*`, `TechLayout`),
reached from `TechMore.jsx`, gated to `employee.role === 'admin'` behind the dark flag
**`page:admin_mobile`** (seeded `enabled:false` + owner `dev_only_user_id`
`d1d37f3c-…d2da`). Screens: admin **Dashboard**, **Collections/AR**, **Invoice view + send +
record-payment**, **Estimate view + send** (+ deferred create/build), **Lead Center** (leads +
call-recording playback + transcripts). Owner decisions (2026-07-07): shell = the tech PWA (not
the office `Layout`, not a third shell); "receive payment" = **record a payment received** only
(Stripe pay-link / QBO card-charge stay unwired, out of scope); admins-only, dark-launched.

**Key finding — this is a FRONTEND-only initiative: ZERO new schema, ZERO new RPCs.** Live
verification confirmed all 17 dashboard/billing/lead RPCs exist and `payments` / `inbound_leads`
carry every needed column. Two constraints promoted to tested acceptance criteria: **F-1** the
mobile record-payment must insert only the safe column set and never the trigger-owned
`amount_paid`/`status`/`paid_at` (no `record_payment` RPC exists — it's `db.insert('payments')`
+ `/api/qbo-payment`, idempotent, non-fatal on QBO-sync failure); **F-2** the financial
dashboard RPCs are NOT server-gated, so the mobile UI must reproduce
`canAccess('overview_financials')` (skip render AND fetch) or it leaks financials.

**Structure.** Wave 0 = **Phase F (Foundation)** — the flag entry, `AdminMobileRoute` guard, a
**single** delegating `src/App.jsx` line → a F-owned `AdminMobileRoutes.jsx` subrouter (shrinks
the shared-seam edit to one line to dodge the in-flight Job Hub v2 H3 cutover), the `TechMore`
admin group, `src/components/admin-mobile/**` shared primitives + icon set + `.am-*` CSS, stub
pages, six `index.css` markers, and the ownership manifest. Wave 1 (all parallel after F, merge
preference **P2 → P3 → P4a → P1 → P4b → P5**): P1 Dashboard, P2 Collections/AR, P3
Invoice+record-payment (Opus·high, money), P4a Estimate view+send, P4b Estimate create+build
(deferrable, heaviest), P5 Lead Center. Every phase owns one page + one
`components/admin-mobile/<area>/**` subfolder + one css marker — proven pairwise-disjoint.

**Challenge pass.** Refute-first re-verification confirmed 4 of 5 verdicts and **MODIFIED** the
estimate one (create is a thin RPC shell, but the line-item builder is a large separate surface →
split into P4a/P4b). Disjointness proof: all 10 pairs disjoint; pinned icons to `admin-mobile/**`
(not the frozen `Icons.jsx`/`crmIcons.jsx`), pre-scaffolded css markers, flagged call-only money
seams. Counter-ordering flipped "Dashboard first" to **Collections-lists first** (cleanest shell
validation; money early per owner priority; lists give P3/P4a their entry points). Reviewer:
**new `admin-mobile-phase-reviewer`** agent (money/gate-weighted) + reused `upr-pattern-checker`.
Full detail in `docs/admin-mobile-roadmap.md`; launch blocks in `docs/admin-mobile-dispatch.md`;
ownership in `.claude/rules/admin-mobile-wave-ownership.md`.


---

## Session log — 2026-07-09 · SMS Experience plan of record (planning only, zero feature code)

Ran a full `/masterplan sms-experience` pass: 6-agent live audit (frontend `Conversations.jsx`;
inbound/status/transport workers; automation senders; realtime/push/mobile; initiative recon;
schema/tests) + independent live DB/Twilio verification + a 3-agent adversarial challenge pass. Committed
the plan of record (docs/agents only): `docs/sms-experience-roadmap.md`,
`docs/sms-experience-dispatch.md`, `.claude/rules/sms-experience-wave-ownership.md`, and a new
`.claude/agents/sms-experience-phase-reviewer.md`. No feature code shipped.

**Two objectives.** (1) A2P 10DLC code-readiness before the campaign approval — verdict **NOT ready**
(four live P0s + an env-only A2P-sender crux); (2) make texting feel iMessage/WhatsApp — mid-fidelity,
real gaps.

**Key live findings (2026-07-09, verified).**
- `messages`/`conversations`/`conversation_participants` carry live **anon `USING(true)`** policies +
  table GRANTs — SMS archive readable (rows forgeable via INSERT) with the browser anon key. (`messages`
  has no anon UPDATE/DELETE policy → read-surface-dominated.) Deferred by db-foundation §8; closed by F-red.
- `Conversations.jsx:433` P0 silent fake-send: `res.json()` before `res.ok` → ghost `queued` row + "sent"
  bubble on any worker error. `send-message.js:57` `skip_compliance` bypass (zero callers). STOP exact
  phone-match misses non-E.164 contacts (9/148) → send-after-STOP. Group send consent-checks only
  `participants[0]`.
- `twilio-status.js` no signature validation; automated SMS invisible in-thread (no conversation/message
  row); `run-automations` permanently drops quiet-hours-deferred texts; `process-scheduled` unauth +
  non-atomic claim. Twilio workers write no `worker_runs`.
- `integration_config.twilio_messaging_service_sid` NULL live → A2P sender is env-only
  (`TWILIO_MESSAGING_SERVICE_SID`) — if unset, sends use a long code, not the A2P sender. **Owner must
  verify the Cloudflare env var (both sets).** Twilio MCP not configured here → console side is an owner
  checklist.
- Schema-as-code gap: the 5 core SMS tables have NO `CREATE TABLE` in migrations; F-core ships a
  drift-capture baseline before touching them. `messages.twilio_sid` UNIQUE index + messages/conversations
  `supabase_realtime` publication membership are live-only (untracked drift) — F-core tracks them.

**Structure.** Wave -1 compliance hotfix (H0) ships first (3 live P0s); Foundation splits into **F-core**
(green, unblocks) + **F-red** (anon-closure, owner-gated, gates nothing); Wave 1 = A (transport
hardening) ∥ B (send chokepoint, absorbs omni O) ∥ C (conversation UX, absorbs omni U) ∥ D (automated
visibility, amends CRM automated-send freeze); Wave 2 = G (deliverability ops + verification tails +
A2P live-smoke fork). Tech PWA covered — `Conversations.jsx` is one shared component mounted at
`/tech/conversations` (Capacitor iOS); C additionally applies `tech-mobile-ux.md` + Capacitor
suspend-recovery. Notification delivery = HAVE (web push works on the PWA per owner); APNs stays
dormant/OUT.

**Cross-manifest (owner-approved supersessions, disclosed roadmap §8):** absorbs unbuilt omni-inbox
Phases O (`send-message.js`) + U (`Conversations.jsx`); amends the CRM-wave freeze on
`automated-send.js`/`run-automations.js` (Phase D, additive, return-vocab frozen + backward-compat tests
for the Phase 8/5 callers). No omni/CRM branch is in flight. CRM 4b campaigns/blasts + the
`sms_sending_enabled` flip stay out of scope / owner's.

**Challenge outcomes:** 6/6 refuted claims CONFIRMED; disjointness surfaced 5 hidden shared artifacts
(moved into F-core: send-message contract freeze, return-vocab freeze, atomic `unread_count` increment,
frozen `messages` insert shape; `process-scheduled` ownership → A); counter-ordering won the Wave -1
hotfix + F-core/F-red split. Full detail in `docs/sms-experience-roadmap.md`; launch blocks in
`docs/sms-experience-dispatch.md`; ownership in `.claude/rules/sms-experience-wave-ownership.md`.

---

## Session log — 2026-07-09 · SMS Experience Phase C — Conversation UX rebuild (shipped)

Rebuilt the shared `Conversations.jsx` (mounted at `/conversations`, `/tech/conversations`,
`/crm/conversations`) to the iMessage/WhatsApp bar. **Absorbs the unbuilt omni-inbox Phase U** (roadmap
§8a — SMS-only; email channel left for a future omni reconciliation). Zero schema, worker stays the sole
writer of any `sms_*` row.

**New files** (`src/components/conversations/`): `messageUtils.js` (GSM-7/UCS-2 segment counter, scheme-
whitelisted `linkifyTokens`, `parseMediaUrls` for the JSON-string `media_urls` column, `uiClassForMessage`
importing the frozen `functions/lib/twilio-errors.js`, per-thread draft get/set/clear), `MessageBubble.jsx`
(bubble + MMS render with `<img>`→file-link fallback + delivery-status affordance + inline retry),
`SegmentCounter.jsx`, `messageUtils.test.js` (18 cases, green).

**Behavior shipped:**
- **Optimistic send** — a `pending-N` bubble appends instantly (`_clientId`), reconciled by the worker's
  `data.message` AND the realtime INSERT (match by id, then by body) so neither ordering dupes; status
  `pending → sent → delivered → read → failed`, `failed` tinted by F's `uiClass` with **inline Retry**
  (reason from `error_code`/`error_message`). All async `setMessages` guarded by `activeIdRef`
  (**wrong-thread-injection fix**). Same-tick double-Enter guarded by reading/blanking the composer ref.
- **MMS** — inbound `media_urls` render (fixes F-6 empty bubble); outbound attach uploads (image-compressed)
  to the **public `job-files`** bucket under `conversations/{convId}/…` and passes the public URL as
  `media_urls` (the `message-attachments` bucket is private with no upload policy, and this phase ships zero
  schema — documented tradeoff; worker requires a non-empty body so MMS carries text).
- **Composer** — live segment/char counter accounting for the server `Name: ` prefix; per-thread localStorage
  **draft persistence**; multiline `pre-wrap`; feedback consolidated through `src/lib/toast.js`.
- **List/scroll** — thread + list **pagination** (`Load earlier` / `Load more`), scroll anchoring on prepend,
  **jump-to-latest pill** (never yanks a scrolled-up reader), **unread-desync** fix (open+visible thread stays
  read via `markActiveRead`; conversations realtime UPDATE can't re-mark it unread).
- **Deep-link + mobile** — per-thread **`?c=<id>` URL** (push-tap lands in-thread; no `App.jsx` route edit);
  `tech-mobile-ux.md` ≥48px targets; **Capacitor suspend recovery** via the shared
  `useResumeRefetch` hidden→visible edge + `visualViewport` keyboard offset — **no `realtime.js` edit**.

**Ownership honored:** edited only `Conversations.jsx`, new `components/conversations/**`, and `index.css`
inside the §623 omni-U marker. No edit to `realtime.js` / `CrmConversations.jsx` / any worker. `test` +
`build` + `eslint` green. **Owner-gated tail:** on-device iOS `/tech/conversations` verification is the
Phase G lane; A2P live-send stays gated (§7).

---

## Session log — 2026-07-09 · SMS Experience Phase G — Deliverability ops + verification tails (shipped)

Wave 2, launched after A + C merged into `dev`. Owned a new deliverability health component +
`Layout.jsx` (unread-badge only, per the ownership manifest); everything else was verification.

**Shipped:**
- **New `src/components/DeliverabilityHealth.jsx`**, embedded as a "Deliverability" sub-tab under
  DevTools → Messaging (zero new routes, zero schema/RPCs). Three read-only sections: (1) worker
  health for `twilio-webhook`/`twilio-status`/`process-scheduled` — latest status + recent error count
  via the existing `get_worker_runs` RPC; (2) A2P/messaging-service config health via the existing
  `get_managed_credentials_status()` RPC (booleans + phone number only — the secret itself is never
  exposed); (3) recent failed/undelivered messages grouped by F-core's frozen `classifyTwilioError`
  (imports `functions/lib/twilio-errors.js` directly — the same pattern
  `components/conversations/messageUtils.js` already established for a frontend file consuming a
  `functions/lib` module).
- **`Layout.jsx` unread badge**: replaced the 30s `fetchUnread` poll with the existing
  `subscribeToConversations` realtime channel + one seed fetch on mount. A per-conversation unread map
  (`unreadByConvRef`) is updated incrementally from INSERT/UPDATE/DELETE payloads and re-summed, instead
  of re-querying every conversation row on a timer.

**Verification tails — one confirmed-broken finding, filed not fixed:**
- **Per-thread push deep-link is BROKEN end-to-end** (live-traced, not fixed — the fix is outside G's
  owned files): `twilio-webhook.js`'s `notifyInboundMessage` calls `dispatchEvent` with
  `link: '/conversations'` (no `?c=<conversation_id>`); `notify.js:163` forwards it verbatim as the push
  payload's `url`; `public/sw.js`'s `notificationclick` opens that URL as-is. A push tap for an inbound
  text always lands on the bare inbox, never the specific thread, even though Phase C's `?c=` deep-link
  param works correctly when navigated to directly. Same `link` also drives the in-app
  `NotificationBell` click-through. **One-line fix** (append `?c=${conversation?.id}`) lives in
  `twilio-webhook.js`, exclusively owned by Session A — G has no edit rights there per the ownership
  manifest, so this is a disclosed follow-up, not an in-phase fix.
  **Current-state correction (2026-07-24 UTC):** the later provider-neutral notification dispatcher
  now emits `/conversations?c=<id>` for bell rows and `/tech/conversations?c=<id>` for Web Push.
  The owner received the push and the exact stored bell link was verified; the corrected
  field-PWA push-tap remains an owner-device verification tail. The paragraph above is retained as
  the historical Phase G finding, not current source behavior.
- **Tech-PWA on-device lane**: no iOS simulator/device in this session (same disclosure as Phase C).
  Static review confirms the shared hidden-edge resume hook and `visualViewport` keyboard handler are
  present in `Conversations.jsx`. Full on-device confirmation
  (including the push-tap→thread check, blocked on the finding above) stays owner-gated.
- **A2P live-smoke decision fork**: live-checked at session start — `automation_settings
  .sms_sending_enabled = false` and `integration_config.twilio_messaging_service_sid` /
  `twilio_account_sid` / `twilio_phone_number` are still unconfigured in the DB (env-only fallback,
  unchanged since the plan of record). No owner confirmation of A2P campaign approval was given at
  session start, so per roadmap §7 the live send stays deferred — never faked.

**Ownership honored:** touched only `src/components/DeliverabilityHealth.jsx` (new) and `Layout.jsx`
(unread-badge block only), plus one additive sub-tab wiring in `src/pages/DevTools.jsx` (not frozen by
this initiative) to host the new component. No edit to any worker, `Conversations.jsx`,
`components/conversations/**`, or any migration. `test` + `build` + `eslint` green.

---

## App Store Readiness & iOS Native Capabilities (2026-07-17 — masterplan committed, Wave 1 dispatched)

Plan of record: `docs/app-store-readiness-roadmap.md` + `.claude/rules/app-store-readiness-wave-ownership.md`.
Live-verified gap audit + adversarial challenge pass found: no `.entitlements` file exists (Push
capability not enabled at the Xcode level); native APNs fully dormant (`AppDelegate.swift` has zero
push-delegate code, `functions/api/send-push.js` has zero callers); `device_tokens` RLS policy named
"Own tokens or admin read" is actually `USING (true)` — every employee can read every device token
(security finding, fix owned by Phase A); no app-target `PrivacyInfo.xcprivacy` (Capacitor's bundled
one is an empty declaration, confirmed by direct read — doesn't cover the app); Capgo OTA's
`markBundleReady()` is defined but never called anywhere (docs previously claimed it was wired on
`App.jsx` mount — that was false); stock Capacitor placeholder icon/splash still in place; **the
single biggest finding**: Apple Guideline 3.2 ("Business") is a real-but-inconsistently-enforced risk
for a single-company internal app on the **public** App Store (Walmart's "Me@Walmart" app is a
documented live counter-example) — recommendation is **Apple Business Manager → Custom Apps**
distribution instead, an owner decision not yet made. In-app account deletion (Guideline 5.1.1(v))
is required regardless of which distribution path is chosen — no ABM/enterprise exemption exists
(confirmed by direct re-verification, unlike Sign-in-with-Apple's 4.8 which correctly does not apply
here). Four build phases dispatched in parallel via git-worktree-isolated subagents in one session
(not separate cold sessions): **F1** (signing/entitlements/push-delegate/privacy-manifest — Opus, can't
be compile-verified in this Linux environment, needs a real Xcode build-check before it reaches any
device), **A** (device_tokens RLS fix + send-push.js auth/pruning fix + markBundleReady() wire-up —
Opus, ships a migration on the shared prod Supabase), **B** (in-app account-deletion RPC + UI in
`MyAccount.jsx` — Opus, compliance-sensitive), **D** (fastlane + CI scaffold, no signing creds yet —
Sonnet, mechanical). Owner action items: kick off Apple Developer Program + ABM enrollment (longest
lead time, EIN now accepted for ABM itself per an April 2026 Apple Business platform change — but the
separate paid Developer Program still shows D-U-N-S as of this writing, verify live at signup); make
the distribution-model call; Xcode-side build-verify of F1 before any real device sees it.

### App Store Readiness Phase B — in-app account deletion (Guideline 5.1.1(v), shipped 2026-07-17)

Migration `20260717_account_deletion_requests.sql` (applied live to the shared Supabase). New table
**`account_deletion_requests`** (`id`, `employee_id` FK→employees ON DELETE CASCADE, `requested_at`,
`status` CHECK `pending|actioned|denied` default `pending`, `notes`, `actioned_by` FK→employees,
`actioned_at`). RLS on: an employee SELECTs/INSERTs only their own row; an active `admin` SELECTs all
and is the only role that can UPDATE (action/deny). A **partial unique index** (`employee_id` WHERE
`status='pending'`) enforces one open request per person. `REVOKE ALL … FROM anon` (belt-and-suspenders
over the default-privileges revoke).

New SECURITY DEFINER RPCs (`GRANT EXECUTE TO authenticated, service_role` — never anon):
- **`request_account_deletion(p_notes text DEFAULT NULL) → account_deletion_requests`** — resolves the
  caller via `auth.uid()`→employees, idempotently files a pending request (an existing open request is
  returned as-is, no dup, no re-notify; unique-violation race caught). On a NEW request it inserts one
  **admin-targeted** bell notification per active admin (`notifications.recipient_id` = each admin,
  `type='account_deletion_requested'`) — NOT an org-wide broadcast.
- **`get_my_account_deletion_request() → account_deletion_requests`** — the caller's open pending
  request (or null); SECURITY DEFINER so a fresh-table PostgREST cache lag can't 404 the read.

UI: **request-and-confirm** flow (accounts are admin-provisioned; job/claim/time records are a shared
business record, so no silent self-service hard-delete). `src/pages/settings/MyAccount.jsx` gains a
"Delete my account" section — inline two-click confirm (`useTwoClickConfirm`, no modal/`confirm()`),
shows the pending state instead of the button when a request already exists, `ErrorState` on a failed
status read (never falls through to the button). Same edit migrated the file's local `errToast/okToast`
copies to the sanctioned `@/lib/toast` and the disconnect button's hardcoded red to `--danger*` tokens.
An admin actions the actual access deactivation + data retention (no admin-action UI built this phase —
the bell notification is the surfacing hook; a future admin queue can read `account_deletion_requests`).

**2026-07-18 update — Wave 1 all four PRs open (#451–#454), CI green, no review comments** (F1
signing/push, A backend hardening incl. the live `device_tokens` RLS fix, B account deletion, D CI
scaffold). **Phase F2's non-Xcode-gated slice also shipped** this session (branch
`app-store-f2-polish-metadata`), per owner direction to get everything not blocked on Xcode done
now: real UPR-branded `AppIcon-512@2x.png` (1024×1024) + `splash-2732x2732*.png`, rendered from the
actual brand mark in `public/favicon.svg` via headless Chromium (Playwright, already installed) with
the alpha channel stripped via `pngjs` (Apple's icon format forbids transparency) — replacing the
stock Capacitor placeholder; a new public `/support` page (`src/pages/Legal.jsx` `Support` export +
`src/App.jsx` route) since App Store Connect requires a Support URL and none existed; and
`docs/app-store-connect-metadata.md`, a full submission-packet draft (description, keywords,
category, age rating, nutrition-label table, export-compliance answer, review notes) ready to paste
into App Store Connect. Still genuinely owner-only: the distribution-model decision, Apple Developer
Program / ABM enrollment, demo reviewer credentials, screenshots (needs a real Xcode/Simulator
build), merging the four open PRs, and the actual App Store Connect data entry.

---

### CRM Overview dashboard-gap enrichment (2026-07-21)

Standalone, owner-approved initiative (disclosed manifest amendment: `.claude/rules/crm-wave-ownership.md`
§9) that turns the thin `/crm/overview` front page into a sales & marketing command center. **Zero DB
migration** — reads only through existing RPCs. Layout: the 6 headline KPI cards → an actionable KPI
strip (**lead win rate** · speed-to-lead SLA · **calls handled** · new leads (7d) · open leads · aging
estimates 31+ $) → a Sales-pipeline card (open-leads-by-stage donut + per-stage count bars, with the
win-rate/won/lost/open summary in the header) → a 4-donut charts grid (calls handled vs missed · leads
by source · won jobs by division · leads by campaign) → a leads-vs-won conversion-trend mini bar chart →
the existing `OverdueTasksWidget`.

**Data-honesty decisions (v2, 2026-07-21 — from owner review of the live numbers):**
- **Closing rate was impossible (293%)** because `won_jobs` (from the `jobs` table, all booked jobs) is
  NOT a subset of tracked leads/estimates — most restoration/insurance revenue never flows through the
  CRM lead→estimate funnel. Replaced with **lead win rate = won ÷ (won + lost)** computed from the CRM
  lead pipeline (`crmCharts.pipelineOutcome`), a nested population that's always ≤100% and correctly
  counts leads lost *before* an estimate ever existed (e.g. missed calls). The inverted spend→won
  "Sales funnel" card was removed for the same reason (headline count cards still tell that story).
- **Weighted-$ pipeline was structurally $0** — inbound leads carry no `value` (0/70 live). Dropped the
  whole $ dimension: the pipeline card is now count-based, and the `ForecastWidget` (also $0) is no
  longer rendered on the Overview.
- **Pipeline card showed the same breakdown twice (looked like a bug).** `Donut` always renders its own
  legend (name/value/%) below the ring; `PipelineStageCard` also rendered a separate name/bar/count list
  beside it — same stage names and counts, printed twice. Fixed by giving `Donut` an opt-out
  (`showLegend={false}`, still shows its "No data" empty state) and making the row list the SINGLE place
  the breakdown lives — it also now shows each stage's %-of-open-pipeline (a number the legend used to
  carry that the bar-only version had dropped), distinct from the bar's relative-to-largest width. The
  other three `OverviewCharts` donuts (calls/source/division/campaign) keep their legend — they have no
  side list duplicating it.
- **Missed-call count was wrong — root cause was the RPC's math, not its source.** `get_call_volume`
  defined "missed" as CallRail `duration_sec = 0` → **1 call all-time**. But CallRail's OWN disposition
  (`raw_payload.answered`, present on every call row) says **20 missed of 68** — a call can ring, drop to
  voicemail with a few seconds of greeting, and still be a miss by CallRail's judgment; `duration > 0`
  ≠ answered. **v2 (reverted, wrong instinct):** briefly sourced calls from the CRM lead pipeline's
  "Missed Calls" stage instead — the owner correctly rejected this: calls are a CallRail/telephony fact,
  not a business/pipeline judgment, and matching on a stage NAME (`is_lost` + `/miss/i`) is fragile (a
  rename silently breaks it). **v3 (shipped) — fix the RPC, not the frontend:** standalone migration
  `20260721_crm_call_volume_uses_answered_field.sql` body-replaces `get_call_volume` (signature/return
  shape unchanged — every caller, incl. `CrmReports.jsx`, keeps working) to split on
  `raw_payload->>'answered'` with a `duration_sec > 0` fallback for any older row missing the field.
  Verified live: 20 missed / 48 answered / 68 total, matching CallRail directly. The frontend still
  passes an explicit `ALL_TIME_FLOOR` start under "All time" (the RPC defaults to a 30-day window on a
  null bound). The pipeline's own "Missed Calls" stage stays a **separate**, human-curated signal (it
  still drives the lead win rate) — the two are related but not forced to agree, since one is a
  telephony fact and the other is a business judgment about what happened after.

- **New pure lib:** `src/lib/crmCharts.js` (+ `crmCharts.test.js`, 29 tests) — `toDonutSegments`,
  `pipelineOutcome` (won/lost/open + bounded win rate), `agingOverThreshold`, `leadsByCampaign`,
  `leadsByChannel`, `newLeadsSince`, `callVolumeSplit` (now driven by the CallRail-corrected RPC), plus
  `CHART_PALETTE` / `CHANNEL_COLOR` / `CHANNEL_LABELS` / `DIVISION_LABELS` / `paletteColor`. All `var(--crm-*)`
  token colors; charts are CSS `conic-gradient` + inline SVG (no chart lib — perf-budget).
- **New charting primitives:** `src/components/crm/charts/Donut.jsx` (conic-gradient donut + legend, empty
  state, no animation) and `src/components/crm/charts/MiniTrend.jsx` (inline-SVG grouped bars).
- **New Overview widgets (presentational, props-only, no `db`):** `OverviewKpiStrip.jsx`,
  `PipelineStageCard.jsx`, `OverviewCharts.jsx`, `ConversionTrendCard.jsx` (all `src/components/crm/`).
- **`CrmOverview.jsx`** now owns a single `Promise.all` load (`get_attribution_rollup`, `get_call_volume`,
  `get_speed_to_lead`, `get_estimate_aging`, `get_conversion_trend`, `get_crm_revenue_by_division`,
  `get_pipeline_stages`, `lead_pipeline_stage` + `inbound_leads` selects) + memoized derivations. A failed
  load renders the shared `<ErrorState onRetry>` (not the funnel/empty state); loading uses a static
  skeleton; toast via `err()` (fixed the old raw `upr:toast` dispatch).
- **"Service type" honesty:** leads carry no division/service-type field (division is a post-conversion
  `jobs` attribute), so the "service type" donut is **won jobs by division** (`get_crm_revenue_by_division`),
  captioned accordingly.
- **Follow-up (not done here):** document the CRM chart primitives / `--crm-*` token layer as a "CRM Kit"
  section in `UPR-Design-System.md` (design-consistency-checker finding; that doc is design-system-owned,
  left for its owner to avoid a cross-initiative edit).
- **Pipeline card showed the same breakdown twice (looked like a bug, owner-caught).** `Donut` always
  renders its own legend (name/value/%) below the ring; `PipelineStageCard` ALSO rendered a separate
  name/bar/count list beside it — same stage names and counts, printed twice. Fixed by giving `Donut` a
  `showLegend={false}` opt-out (it still shows its "No data" empty state — that's feedback, not a
  duplicate); the row list is now the ONE place the breakdown lives, with %-of-open-pipeline added back
  (a real number the legend used to carry, distinct from the bar's relative-to-largest width). The
  other three `OverviewCharts` donuts keep their legend — no side list duplicates them.

**Integrating with the AI call-qualification system (owner-directed, 2026-07-21 — same day, earlier
session).** The owner had already built an AI transcript classifier (`functions/api/transcribe-call.js`
+ `functions/lib/zeroTurnClassifier.js`) that writes `inbound_leads.transcript_analysis.is_customer_
inquiry` (+ `caller_never_responded`, `service_match`, `inspection_scheduled`) and, on a spam verdict,
calls `set_lead_spam_flag()` — which the pipeline-stage-clearing migration
(`20260721_crm_spam_flag_clears_pipeline_stage.sql`) already wires to drop the lead's Kanban card. The
owner asked whether the Overview should reuse this screening rather than re-deriving spam itself — and
whether anything from that earlier session had been overwritten. **Confirmed: nothing was touched** —
this initiative's prior 3 commits only added new Overview-scoped files + one narrow, signature-frozen
`get_call_volume` body-replace.

Investigation found the dashboard ALREADY correctly uses that system: every count that filters
`spam_flag=eq.false` (headline Leads/Estimates/Won-jobs, `get_call_volume`, the pipeline) automatically
excludes every call the classifier has actually caught, because `spam_flag` IS the classifier's own
output signal. Two real gaps surfaced and were fixed:

1. **AI screening COVERAGE, not correctness, was the real risk.** Classification only runs when a human
   clicks "Transcribe" or a backfill job runs — it is not automatic on ingest. Live check: **41 of 67
   call-leads (61%) counted in "Leads" had never been screened at all** — an unknown-risk population,
   not a wrong number. Added `src/lib/crmCharts.js`'s `callScreeningCoverage(leads)` (+ tests) — a pure,
   read-only function that reports whether `transcript_analysis` carries the `is_customer_inquiry` key
   (i.e., has the classifier run yet), and makes NO spam judgment of its own. `CrmOverview.jsx` renders
   an honest caption under the headline KPIs: *"26 of 67 calls AI-screened for spam · 41 pending
   (confirmed spam is already excluded from the counts above)."* Requires only widening the existing
   `inbound_leads` select to include `source_type` + `transcript_analysis` (no migration, no new RPC).
2. **`get_attribution_rollup`'s leads count didn't exclude merged repeat-call duplicates** (found while
   auditing the same code path) — the merge system built earlier today
   (`20260721_crm_merge_repeat_call_leads.sql`) keeps a repeat call as its own `inbound_leads` row
   (`merged_into_lead_id` set) so it never gets a second Kanban card, but the RPC's `leads_agg` CTE never
   filtered that column. Fixed via `20260721_crm_attribution_excludes_merged_leads.sql` — a body-only
   `CREATE OR REPLACE` (signature/return shape unchanged, every caller incl. `CrmReports.jsx` and
   `CrmAttribution.jsx` keeps working), adding one `AND il.merged_into_lead_id IS NULL` line. Verified
   live: leads dropped from 71 to 70 (exactly the one known duplicate). Committed before/after-delta
   test: `supabase/tests/crm_attribution_excludes_merged_leads.test.js`.
   `migration-safety-checker` + `upr-pattern-checker`: both **pass**.

**Custom date-range picker (owner-requested, 2026-07-21) — "just like the Leads page."** The shared
`RangePicker` (`src/pages/crm/attributionParts.jsx`, used by `CrmOverview.jsx` / `CrmAttribution.jsx` /
`CrmReports.jsx`) gains a calendar icon beside its preset tabs (30 days / 90 days / 12 months / All
time) that opens a From/To custom-range popover — **reusing `CrmLeads.jsx`'s own date-filter classes
verbatim** (`crm-board-period*`, `crm-leads-popover*`, `crm-leads-datepicker`, `crm-leads-popover-field`,
plus a pixel-identical local `IconCalendar`), not just a visually-similar rebuild. No new CSS was
needed; the old `.crm-range`/`.crm-range-btn` rules (RangePicker's only consumer) were removed as dead
code once the tabs switched to the reused classes.
- **`attributionData.js`**: `rangeToDates(key, customRange)` — `key==='custom'` reads the picked
  From/To strings verbatim (an empty side stays unbounded/`null`, mirroring `CrmLeads.jsx`'s
  `dateRangeFor`); every other key's behavior (day-math, `null`/`null` for `'all'`) is unchanged.
  New test file `attributionData.test.js` (6 tests).
- **`RangePicker({value, onChange, onCustomRange})`**: `onCustomRange` is optional — a caller that omits
  it gets the preset-tabs-only fallback (no calendar icon, no popover), so this is backward compatible
  by construction (not just by convention).
- All three consuming pages: added `customRange` state, wired `onCustomRange={(start,end) =>
  setCustomRange({start,end})}`, and added `customRange` to `load()`'s dep array — required because
  re-applying a *different* custom range while already in `'custom'` mode doesn't change the `range`
  string itself, so the fetch wouldn't otherwise re-run (loading gate firing here is an intentional
  param change, sanctioned by `page-lifecycle.md` §1).
- `upr-pattern-checker`: **pass** (no blockers; confirmed genuine class reuse, zero orphaned CSS, safe
  dep-array wiring, verified backward-compat fallback). One PRE-EXISTING, untouched-by-this-diff finding
  flagged as a follow-up: `CrmAttribution.jsx`/`CrmReports.jsx` still raise their load-failure toast via
  a raw `upr:toast` dispatch instead of `err()` from `@/lib/toast` — `CrmOverview.jsx` already does this
  correctly; the other two are due for the same fix in a future pass.

**"7 days" preset + Pipeline/Trend half-width row (owner-requested, 2026-07-21).** `RANGES` in
`attributionData.js` gained a `'7d'` entry (before `'30d'`) — shared automatically by all three
`RangePicker` consumers, plus `attributionData.test.js`'s day-math loop. On `CrmOverview.jsx`, the Sales
pipeline card and the Conversion trend card now share one row (`.crm-pipeline-trend-row`, a 2-col grid
collapsing to 1 column below 768px) instead of the pipeline card claiming a full-width row on its own —
freeing that space per the owner's screenshot feedback.

**Live production bug found + fixed the same session — "All time" showed 0 calls (root cause: my own
earlier fix).** The owner's live screenshot showed the Calls donut reading "0 CALLS / No data" and
"Calls answered —" even though 68 real calls exist. Reproduced live via the deployed `dev.utahpros.app`
(the local Vite pane render-hangs in this sandbox, so verification used the real site + a `fetch`
monkey-patch in the page's own JS console to capture the exact request/response `get_call_volume` made
in a real authenticated session). **Root cause:** the 2026-07-21 `ALL_TIME_FLOOR='2000-01-01'` frontend
fix (meant to stop "All time" silently narrowing to 30 days) made `get_call_volume`'s internal
`generate_series(v_start, v_end, '1 day')` produce **~9,670 daily rows** — and PostgREST's default
**1000-row response cap** silently truncated the result to Jan 2000 – Sept 2002, which is entirely zero.
None of the real 2026 calls ever made it into the truncated response. Confirmed via a captured live
request: `arrayLength: 1000`, `lastRow.period: "2002-09-26"`, `sumTotal: 0`.
- **Fix — at the RPC, not another frontend patch** (consistent with the earlier "fix the RPC, not the
  frontend" principle): `20260722_crm_call_volume_all_time_floor_fix.sql` — body-only `CREATE OR
  REPLACE` (signature/shape unchanged). When `p_start` is null, derive the floor from the org's REAL
  earliest call (`MIN(occurred_at)`) instead of a guessed distant date, falling back to the old 30-day
  window only if the org has literally never had a call. Verified live: an omitted `p_start` now returns
  a small (52-row, for this ~3-week-old org) array reaching all the way to today with correct non-zero
  days. `CrmOverview.jsx`'s `ALL_TIME_FLOOR`/`callStart`/`callEnd` frontend hack was removed entirely —
  `get_call_volume` now receives the same `start`/`end` as every other RPC on the page.
- Committed test: `supabase/tests/crm_call_volume_no_null_start_truncation.test.js` (asserts the
  omitted-`p_start` response stays under 1000 rows and reaches "today").
- `migration-safety-checker`: **pass** (no blockers — signature/shape confirmed unchanged, GRANT/REVOKE
  correct, the new earliest-call lookup is injection-safe with a proper 3-way COALESCE fallback so
  `v_start` can never end up null, and the rollback note correctly warns that reverting the migration
  alone reintroduces the bug unless `CrmOverview.jsx`'s `ALL_TIME_FLOOR` frontend hack is also restored).
- **Lesson for future date-range work:** a `generate_series` CTE spanning a hardcoded/guessed floor date
  is a landmine — PostgREST's row cap will silently and invisibly truncate a too-wide by-day range to
  whatever slice happens to sort first, with no error thrown. Prefer deriving "all time" floors from real
  data, never a guessed constant.

**CRM-only attribution scoping (owner-directed, 2026-07-22) — the big one.** The owner asked, looking at
the Overview: "shouldn't these numbers only count what originated from a lead existing in the CRM?"
Investigation confirmed a real, large gap: only **24% of won jobs (30 of 127), 6% of revenue ($18,752 of
$314,983), and 23% of estimates (10 of 43)** could be traced to an actual CRM lead touch at all — the
rest was real business (direct insurance assignment, phone referrals a staffer handled without logging
the call, jobs entered straight into Jobs/Estimates) that never touches the CRM lead pipeline. Counting
it anyway made "won jobs" exceed "leads," which read as a broken, unreliable funnel — exactly the owner's
complaint. **Owner's explicit decision: full CRM-only scoping everywhere**, after being shown the real
before/after magnitude (not guessed).

- **New shared helper — `crm_contact_is_traced(p_contact_id uuid) → boolean`** (migration
  `20260722_crm_scope_attribution_to_traced_contacts.sql`): true only when a contact has a real,
  legitimate CRM touch — a `lead_attribution` row, or a **non-spam** `inbound_leads.contact_id` link (a
  spam-flagged-only touch does NOT count as legitimate attribution — verified this doesn't change today's
  numbers but is the more correct long-term definition). `SECURITY DEFINER`, `STABLE`, granted
  `authenticated, service_role` only (never `anon`) — confirmed live via
  `information_schema.routine_privileges`.
- **Rescoped (body-only `CREATE OR REPLACE`, signatures/return-shapes frozen, zero frontend code
  changes needed):**
  - `get_attribution_rollup` — `est_agg`/`job_agg` CTEs (headline Estimates/Won-jobs/Revenue on
    Overview/Attribution/Reports). `leads_agg` untouched — leads are already inherently CRM-native.
  - `get_crm_revenue_by_division` — its `jobs` query ("Won jobs by division" donut + Reports table).
  - `get_conversion_trend` — `est_c`/`job_c` CTEs (the trend chart). `lead_c` untouched, same reason.
  - `get_estimator_leaderboard` — the **whole** `WHERE` clause (both `total_jobs` AND `won_jobs` share
    the same population deliberately — a mismatched denominator would distort win-rate math).
  - `get_attribution_by_campaign` is **unchanged** — it only reports spend/leads, never won-jobs/revenue,
    so it needed no rescoping.
- **Deliberately NOT rescoped — a disclosed decision, not an oversight (owner-recommended defaults,
  accepted):**
  - `get_contact_ltv` — lifetime value is about a customer already *known*, not attribution. A repeat
    customer who found us via a tracked ad but booked job #2/#3 directly is still the same valuable
    customer; narrowing LTV to only the traced job would defeat the metric's purpose.
  - `get_estimate_aging` — an operational "these are going stale, follow up" tool. Staff need to see
    *every* open estimate at risk, regardless of channel — narrowing it would hide 77% of the real
    follow-up work from the people who act on it.
  - `get_call_volume` (CallRail-sourced) and `get_speed_to_lead`/`get_pipeline_movement`
    (`inbound_leads`-native) were never in scope either way — they don't touch jobs/estimates.
- **Live verification (exact before/after match on the real numbers quoted above):**
  `get_attribution_rollup` → Won jobs 30, Revenue $18,752.35, Estimates 10, Leads unchanged at 70.
  `get_crm_revenue_by_division` → water 19/$10,271.87 + reconstruction 6/$8,480.48 + mold 5/$0 = 30/
  $18,752.35, matching exactly. `get_estimator_leaderboard` → correctly empty (0 of the 30 traced jobs
  happen to have an `estimator` set — a genuine data fact, not a bug; `CrmReports.jsx` already handles an
  empty leaderboard gracefully).
- **Frontend disclosure (no logic changes, purely captions/docs — all 3 pages)**: `CrmOverview.jsx`'s
  3 headline MetricCards (Estimates/Won jobs/Revenue) get a "· CRM-traced" sub, plus a page-level
  `.crm-scope-note` explicitly naming that the won-jobs-by-division and conversion-trend charts share the
  same scope, and pointing to the main Home dashboard for company-wide totals. `CrmAttribution.jsx` gets
  the same treatment on its Revenue/Won-jobs cards. `CrmReports.jsx` gets a page-level scope note PLUS two
  explicit "company-wide on purpose" callouts on the Estimate-aging and Top-customers-LTV cards specifically
  (the two sections that are the exception, sitting right next to sections that ARE scoped — the contrast
  is exactly where confusion would happen without an explicit callout).
- **Owner follow-up — "show both, labeled" (reconciled to `dev` 2026-07-23):**
  `get_crm_sales_summary(date,date)` returns company-wide and CRM-traced won/revenue together using
  the canonical `jobs.is_real_job` rule, claim/job sale date, Denver-day window and
  `crm_contact_is_traced`. `CrmOverview` now uses the returned traced values as its Won jobs/Revenue
  headlines and labels the returned company-wide values beside them. It passes the same selected
  start/end dates as the attribution rollup and does not calculate either half independently.
  Read-only live verification confirmed the four-key numeric JSON shape, `anon` denial and
  `authenticated`/`service_role` execution. The migration was already live; this reconciliation
  applied no SQL and restored only the missing current-compatible UI/test/documentation slice.
- Committed test: `supabase/tests/crm_attribution_scoped_to_traced_contacts.test.js` — before/after
  deltas (never absolute counts) on all 4 rescoped RPCs, a genuine traced-vs-untraced contact pair, and a
  dedicated spam-only-touch edge case proving a spam-flagged-only lead does NOT count as traced.
- Reviewer gauntlet: `migration-safety-checker` **pass** (after two real fixes — a wrong rollback
  citation that would have silently reintroduced a UTC-bucketing bug via `get_conversion_trend`, and two
  test cases that were initially vacuous/shape-only and got rewritten as real before/after deltas),
  `anon-grant-auditor` **pass** (grants confirmed live), `upr-pattern-checker` **pass** (after widening
  the Overview scope-note to cover the trend/division charts it had initially omitted).

## `exec_read_sql` containment (2026-07-23; applied and verified)

The dedicated evidence and apply record is
`docs/audit/2026-07/exec-read-sql-containment.md`. Migration
`20260723205127_exec_read_sql_containment.sql` is the grant-only Critical DB-003 containment. It
applied to shared Supabase on 2026-07-23 as live ledger entry
`20260723221707 exec_read_sql_containment`. Catalog fingerprint checks passed; `anon` and
`authenticated` harmless calls returned `42501`; the verified `service_role` owner-MCP contract
returned `[{"ok":1}]`; and the security advisor no longer references `exec_read_sql`. The function
signature/body/owner remain unchanged and no business data was read or mutated. Exact evidence:
`docs/audit/2026-07/evidence/exec-read-sql-containment-2026-07-23.md`. Encircle files and its
unapplied/dark-gated migration remain untouched.

## Foundation F2 migration provenance (2026-07-23; source/release control only)

Four CRM ledger rows that were already live but absent from `dev` now have reviewed source records
restored without replaying SQL or overwriting live bodies:
`crm_denver_day_bucketing`, `crm_sales_summary_total_vs_traced`,
`crm_dedup_repeat_caller_leads`, and `crm_caller_name_follows_merge`. The restored files are
byte-identical to reviewed origins `c10a8bb`, `a5ef0e1`, and `a7ee5f8`. Direct catalog comparison
found 10 of 11 affected function bodies byte-identical. `set_lead_caller_name` is executable-body
equivalent after removing comments/whitespace, but live omits explanatory comments; the live function
was not replaced merely to align a hash.

`npm run validate:provenance` is the read-only release gate. It maps every live ledger row from
`20260722222426` onward to reviewed source reachable from the release ref, checks reviewed-origin
blob equality, requires evidence captured within six hours from an ancestor commit, and validates 13
function fingerprints plus four policy identities/roles/predicates. The refreshed live-ledger tail
also maps `20260724035913_attest_prior_sms_consent` to reviewed origin `e71e759`, including both
service-only invoker consent RPC ACLs and all three service-only consent-table policies.
`npm run test:provenance` covers unmapped rows, functional drift, wrong origins, changed release
blobs, stale/non-ancestor evidence, and policy drift. The gate consumes sanitized evidence and never
connects to or writes Supabase. Exact capture and review record:
`docs/audit/2026-07/evidence/migration-provenance-2026-07-23.md`.

## Concurrent-session reconciliation (2026-07-24; source control only, no apply)

Many parallel Codex/Claude sessions left three migrations **live in shared production with no source
reachable from `dev` or `main`**: `20260724181945 crm_lead_notes` (PR #515) and
`20260724190829 qbo_attachments` / `20260724190848 qbo_payments_sync_cron` (PR #516). Both PRs merged
to `dev`; **no SQL was replayed and no live body was overwritten** — the drift was source missing from
`dev`, and merging that source was the whole repair. Fingerprints were compared against the live
catalog first: all five affected functions are semantically identical to the merged source, and
`get_contact_activity(uuid)` holds its signature and return shape at **24 arms** (`get_lead_activity`
at 5).

Two things worth remembering, because both defeated a plausible check:

1. **Live-but-unmerged rows can be interleaved, not a tail.** The two newest live rows sorted *above*
   the three drifted ones, so walking the ledger down from the newest row until source appears finds
   zero drift. Reachability must be a set comparison over the whole window at/above
   `ledgerFloorVersion`, matched **by name** — ledger versions are assigned at apply time and do not
   equal filename prefixes (one file prefix is *later* than its live version).
2. **A passing `validate:provenance` against stale evidence proves nothing.** The gate reads a static
   snapshot; its `Unmapped live ledger row` check cannot fire for rows applied after capture. The
   manifest had drifted five rows behind live. Treat the six-hour evidence window as load-bearing, and
   refresh evidence *before* trusting a green gate near a release.

Also fixed: `project_callrail_outbound_event(uuid,uuid)` was covered by a hand-pinned
`expectedFingerprints` that went stale when two later reviewed migrations replaced its body. It now
uses real source comparison — `extractFunctionBodies` accepts `$$`-quoted bodies as well as
`$function$`, removing the need for pins (and that whole stale-pin failure mode). Manifest now maps
all 19 rows at/above the floor, 21 function fingerprints and 5 policies; gate **PASS**. Record:
`docs/audit/2026-07/evidence/migration-provenance-2026-07-24.md`.

`20260724200000_payments_qbo_dedup_index.sql` was subsequently **applied** under owner authorization
(ledger `20260724230933`) — 0 pre-existing violations, index valid+unique, 86 rows unchanged. It
closes the double-insert race between the hourly poller and the real-time webhook, both of which now
write payments. `upr_qbo_payments_sync_hourly` has been live and healthy since 19:17 UTC against the
already-deployed `/api/qbo-payments-sync` worker in `main`.

## Automation `no_consent` is deferrable, not terminal (2026-07-25)

`run-automations.js` previously treated `no_consent` as a **terminal** outcome: it wrote a
`system_events` row, so `alreadyFired()` returned true forever and that automation could never fire
for that entity again — even after the person later consented. A missed call from an unconsented
number was therefore permanently burned.

`DEFERRABLE_SKIP_REASONS` is now `{quiet_hours, sms_disabled, no_consent}`. Consent is a state that
genuinely changes (admin attestation, or inbound START), so it belongs with `quiet_hours` — a
condition that lifts — not with `dnd`. Still correctly terminal: `dnd` and opt-out-family reasons
(an explicit refusal by the person) and `no_phone` / `contact_not_found` (cannot self-resolve).

✅ **The duplicate-send window this depended on is CLOSED (2026-07-25)** — see the next section.

## Fixed-automation duplicate-send window CLOSED — claim before send (2026-07-25)

`fireAutomation` used to check `alreadyFired()`, **send**, then write its `system_events` dedup
marker. A crash or failed insert in between meant the text went out unmarked and the next cron tick
re-sent it. This is the "pre-existing fixed-automation post-send event persistence gap" PR #514
cited when it left automated SMS off. A duplicate automated text is **per-message** TCPA exposure,
and missed-call text-back targets people with no prior relationship.

**Migration `20260725060000_fixed_automation_claims.sql`** (applied 2026-07-25 under owner
authorization, live ledger `20260725060033`): table `fixed_automation_claims` with
`UNIQUE(automation_key, entity_id)` + three service-role-only RPCs
(`claim_fixed_automation`, `release_fixed_automation_claim`, `finalize_fixed_automation_claim`).
Atomicity is the unique constraint — `INSERT … ON CONFLICT DO NOTHING` + `ROW_COUNT`, so exactly one
caller wins. All three are `SECURITY INVOKER`, `search_path=''`, with an in-body `auth.role()`
service-role guard and an explicit `REVOKE … FROM PUBLIC, anon` before each `GRANT`.
**Verified live:** every function `anon=false, authenticated=false, service_role=true`; the table is
RLS-enabled with **0 policies** and no `anon`/`authenticated` privilege.

**New order:** `alreadyFired()` → **claim** → send → terminal ? (`system_events` + finalize) :
release. The release/keep decision reuses the *existing* terminal logic, so it needs no second
policy: anything that may have sent keeps its claim forever; anything that sent nothing (deferrable
skip, transient failure, or a throw from `send()`) releases and retries.

- **No stale-claim recovery, deliberately.** Unlike `claim_scheduled_message`, a claim left by a
  crash means "we may already have texted this person"; reclaiming it would reintroduce the exact
  duplicate this prevents. A stuck claim stops that one automation for that one entity until a human
  looks — the safe direction. There is no admin surface for stuck claims yet (follow-up).
- **Fails closed.** If the claim RPC is unavailable the worker refuses to send rather than falling
  back to the old ordering. ⚠️ **Deploy order is therefore INVERTED** from the usual rule: the
  migration must be applied *before* the worker deploys, or all four automations (including the two
  live email ones) go silently dark. It was applied first here.
- **`system_events` remains the durable "already fired" record** and is still checked first, so
  entities that fired before this migration can never re-fire, and the rollback (which drops the
  claim table) cannot resurrect them.

Tests: `functions/api/run-automations.test.js` 32 → **43** (crash-loses-marker cannot resend,
two-tick race sends exactly once, deferrable release-and-retry, transient-failure release, durable
`dnd` keeps the claim, ambiguous-outcome keeps the claim, `send()` throw releases, bookkeeping
failure doesn't abort the batch, claim-RPC-unavailable sends nothing, history checked before claim).
Plus `supabase/tests/fixed_automation_claims.test.js` (14 source-contract assertions; `db` lane).

⚠️ **Known, pre-existing, NOT fixed here:** `sendGatedSms` returns `reason:'no_consent'` for *both*
"never consented" and "explicitly opted out", so an opted-out contact takes the deferrable path
instead of the durable one. In practice the STOP handler sets `dnd=true` *together with*
`opt_out_at`, so a real STOP hits the durable `dnd` branch; the residual is `pending_stop`. No
message is ever sent to them either way — `automated-send.js` re-checks consent on every attempt.
Fixing it properly means **adding** a reason (e.g. `opted_out`) to the frozen
`{ok,skipped,reason}` vocabulary — additive and permitted, but a separate reviewed change with
backward-compat tests for `process-sequences.js` and `process-crm-automations.js`.

## P0 — inbound STOP had NEVER worked (2026-07-25, found by live test)

An owner STOP test at 17:13:47Z proved the opt-out was never recorded. The event
arrived and parked in `processing_state='retryable'` with:

```
project_callrail_inbound_event: 400 {"code":"42702",
 "message":"column reference \"contact_id\" is ambiguous"}
```

`project_callrail_inbound_event` is `RETURNS TABLE(..., contact_id uuid, ...)`, and a
`RETURNS TABLE` output column **is also a PL/pgSQL variable**. So the bare `contact_id` in
`ON CONFLICT (provider_event_id, contact_id, event_type)` was ambiguous against the
`sms_consent_log` column. PL/pgSQL's default `#variable_conflict` is `error`, so the whole
projection aborted and retried-and-failed every 5 minutes forever.

**Fix** (`20260725173000`, ledger `20260725171925`): `#variable_conflict use_column` as the first
line of the body. Because the default is `error`, every ambiguous name aborts today, so
`use_column` **cannot** change a statement that already works — a working statement had no
ambiguity to resolve. Body-only; signature, `RETURNS TABLE` shape, `SECURITY INVOKER` and
`search_path` unchanged. Verified post-apply: live body md5 (LF) `696afa6695e147e727c983b3ce52a18e`
== the committed file, byte-for-byte.

**Live proof:** event `1407ad82` `retryable → processed` (drained by the existing 5-min recovery
cron, no manual intervention) · first `stop_keyword` row in `sms_consent_log`'s history ·
`opt_in_status=false`, `opt_out_reason='stop_keyword'`, `opt_out_at = dnd_at = 17:13:47Z` (the
**original text time**, not the processing time).

⚠️ **Why reading the SQL was not enough.** The logic was correct; the statement never ran. Both
sites sit in branches ordinary traffic never enters (`IF v_keyword IS NOT NULL`, and the
new-contact path), so 14 normal inbound texts projected perfectly. Only a real keyword could
expose it. `sms_consent_log` having zero stop events was never "untested" — it was **broken**.

⚠️ **A THIRD site of the same bug class** (found by `migration-safety-checker` after the fix, and
missed in my own analysis): `ON CONFLICT (conversation_id, contact_id)` on the
`conversation_participants` insert — where **both** arbiter columns collide with OUT-param names.
That branch runs on any brand-new phone number's **first ever inbound text**, which is more common
than STOP. The function-wide pragma fixes it too. **No lead was lost:** zero events in
`message_provider_events` have ever carried a 42702/ambiguous error, and the only unprocessed
inbound are 3 known MMS media-URL failures — so the site was latent, not yet biting.

**Standing caution:** the pragma is function-scoped (PL/pgSQL has no statement-level granularity),
so a future edit introducing a new bare `contact_id`/`conversation_id`/`message_id`/`outcome`/
`inserted`/`requires_staff_reply` in this function will now bind silently to the column instead of
raising a loud 42702. The safety net is gone for this one function.

**Still owed (disclosed, not done):** a committed regression test asserting (a) a seeded `STOP`
projects and sets `opt_out_at`/`dnd`, (b) a brand-new number's ordinary first inbound text creates
its conversation/participant without exception, (c) an existing-conversation text is unchanged.
The `v_start_stale` START path is alias-qualified and verified unaffected, but is equally
un-exercised and should get the same coverage.

## Missed call is now AUTHORITATIVE, not inferred (2026-07-25)

`isMissedCall` in `run-automations.js` inferred "missed" from `Number(lead.duration_sec) > 0`.
`Number(null)` is `0` and `Number(undefined)` is `NaN` — neither is `> 0` — so **a call with no
duration recorded yet was treated as missed**. CallRail delivers one call across several webhooks
(the first carries no `answered` key at all), so an answered call could be caught mid-window and
texted *"sorry we missed your call"* to someone we had just spoken to. Absent data must never mean
missed.

**Migration `20260725160000_inbound_leads_answered.sql`** (applied 2026-07-25, ledger
`20260725160749`): adds `inbound_leads.answered` — a STORED generated `boolean`, `true` /
`false` / `NULL`-unknown, derived from `raw_payload->>'answered'` by **string compare, never a
cast**. Verified live after apply: `is_generated=ALWAYS`, 102 true / 29 false / 16 unknown,
**0 derivation mismatches** against `raw_payload` in either direction.

- `isMissedCall` now tests `lead.answered !== false` — strictly. `true`, `null`, `undefined`, a
  string `'false'`, `0`, or a missing property all mean *not a confirmed miss* and send nothing.
  That strictness, not the settling delay, is what makes "unknown is never missed" structurally
  true at any point in the delivery lifecycle.
- New `MISSED_CALL_SETTLE_MIN = 3` — belt-and-braces, so we act on a finalized record rather than
  one still mid-delivery. Well inside the 13h lookback.
- **Generated, not stamped-at-ingest.** `docs/crm-lead-lifecycle.md` §8 names a stamped column as
  the Twilio-era target; generated is the same seam for every *reader* (the worker never touches
  CallRail's payload shape) and strictly safer today, because it re-derives itself when a later
  webhook updates `raw_payload` instead of keeping a first, wrong stamp. Conversion later is
  `ALTER COLUMN answered DROP EXPRESSION` — every reader unchanged.
- **The countable-lead twins were deliberately NOT repointed.** `crm_call_is_answered()` /
  `isCountableLead()` still read `raw_payload`; they answer "is this lead countable?" (reporting,
  must not move). This column answers "may we text this person?" (unknown must fail safe to no).
  Three definitions, documented in `crm-lead-lifecycle.md` §6 — do not merge them.

Reviewers: `consent-path-auditor` **PASS** (no fixes). `migration-safety-checker`
changes-requested → all addressed: cited apply-window evidence (147 rows, 1128 kB, 2 writes/24h,
ACCESS EXCLUSIVE rewrite), the deliberate narrow match set, the stale doc entry, and a missing
`supabase/tests/inbound_leads_answered.test.js` (10 assertions).

⚠️ **Textback still cannot reach new callers — the `contact_id` half is unfixed.** Measured live:
**29** confirmed missed calls, but only **5** carry a `contact_id`. A brand-new caller has no
contact row by the deliberate `crm_lead_no_autocreate_contact` rule (raw calls must not flood
`contacts` — and via the QBO customer trigger, QuickBooks). Automated sends also require
`GLOBAL_OPT_IN`, which a new caller cannot have. So the exact leads the owner wants to catch are
still unreachable. Closing it is an **owner decision** (see the open item in
`crm-lead-lifecycle.md` §7), made harder because an unanswered call has no recording and therefore
can never be AI spam-screened.

## QBO payment webhook — cross-realm read + opaque-error fix (2026-07-24)

One live `Payment/Create` event (19:49Z) recorded only `"QBO get payment 400"` and sat
`processed_at=null` with nothing re-driving it. Two defects, both fixed:

- **`qbo-webhook.js` extracted `note.realmId` for the dedup key but never used it to scope the
  read.** `qboFetch` always builds `/v3/company/{stored connection realm}/…`, so an event from any
  other company was looked up in OURS — and Intuit answers that with a bare 400. The worker now
  resolves the connected realm once via `getConnection()` and records a foreign event as terminal
  `status='ignored'` + `realm_mismatch` instead of issuing a cross-company read. It **fails open**
  when the connection can't be read, so genuine events are never dropped.
- **Intuit reports object-not-found as HTTP 400 + Fault code `610`, never 404**, so the existing
  `res.status === 404` benign-skip branch in `qbo-payment-sync.js` was dead code and a genuinely
  missing payment threw. Per Intuit's troubleshooting guide, 610 also fires when a txn is *"deleted
  by one user and accessed by another"* — benign, but we recorded it as a hard error.
  `readQboFault()` now parses `Fault.Error[0].{code,Message,Detail}`; `610`/`6240` become the
  intended skip, everything else throws `QboRequestError` carrying the code in its text, with
  `retryable` true only for 429/5xx.

Status vocabulary is now `processed` / `ignored` / `retry` / `error`. **`qbo_events.status` has no
CHECK constraint** (verified live) — if one is ever added it must include `ignored` and `retry`.
Intuit retries a failed delivery only at **20/30/50 minutes and then disables the endpoint**, which
is why the worker always acks 200 and recovery is ours to own.

⚠️ **Still open:** nothing re-drives a `retry` row — that is registry item `COR-002`'s remaining
internal half (its external blocker, Intuit sandbox semantics, is unchanged); the hourly poller is
the only backstop today. `functions/api/qbo-webhook.test.js` is new — the worker previously had
**no tests at all**, which is how a silent cross-company read reached production.

## July 23 engineering documentation closure and Figma checkpoint

The end-of-day reconciliation is recorded in
`docs/audit/2026-07/evidence/engineering-foundation-documentation-closure-2026-07-23.md`, with the
complete dated Git reachability appendix in `git-ledger-2026-07-23.md`. It classifies every July 23
commit visible after remote pruning plus explicitly requested unreferenced objects. Temporary
CallRail recovery commit `d3fd17a` and shared-production QA proposal `3841056` are both branch-only
historical evidence and superseded; neither should be merged.

The minimum viable design-start contract is in
`docs/audit/2026-07/evidence/figma-readiness-checkpoint-2026-07-23.md`. It does not wait for hosted
write-capable QA, but remains owner-blocked on a dirty messaging UI worktree, CAP-SEC-001/
CAP-GOV-001 containment, explicit Figma permission/authority approval, and a dedicated
authenticated read-only staging browser session. No Figma plugin connection or paid seat exists
because those exact external steps require owner approval.

## Credential-free isolated QA and Figma internal foundation (2026-07-23)

Repository-internal P1/Foundation F3a groundwork now runs without hosted QA, real credentials,
production data, or provider effects. `vitest.config.js` and the governed runner split pure unit,
Worker-contract, QA-policy, and future isolated-database lanes. The credential-free lanes scrub
hosted/provider environment variables, block network APIs, require non-empty discovery, and reject
every skip/todo. The database runner recognizes only `http://127.0.0.1:54321`, the local project
reference and `upr-local-only-v1` sentinel; production or ambiguous targets are refused.

The Playwright foundation uses only the deterministic fixture served at
`http://127.0.0.1:4173`. Desktop 1440px and mobile 390px projects cover loading/error/empty/stale/
ready states, reduced motion, keyboard focus, lifecycle resume, overflow, and serious/critical axe
rules. Browser guards deny production Supabase navigation, provider egress, write requests,
popups, WebSockets, downloads, TCP/CDP attachment, and human browser profiles. Retained artifacts
are scanned for authentication material, production identifiers, and realistic identity data.
The ephemeral-profile containment gate explicitly parses absolute Windows or POSIX paths and
rejects relative/mixed-dialect inputs so repository/profile isolation behaves identically on local
Windows and Linux CI.
This is synthetic foundation evidence only; no real UPR account/page, hosted project, provider,
iOS device, or production path was exercised.

P2a database execution remains blocked because this repository has no governed
`supabase/config.toml`, local CLI/runtime, deterministic database seed, or representative-role
fixture. The runner fails closed instead of falling back to the shared project.

Figma remains disconnected with zero granted scopes. `.claude/figma-governance.json` and CI now
enforce the permission posture, while `docs/upr-figma-governance-and-handoff.md` records
repository-versus-Figma authority, the current token/component/page inventory, handoff manifest,
and representative desktop/390px screenshot plan. Plugin installation/connection, paid seat,
selected-file scope, actual UPR screenshot capture, and the overlapping messaging-worktree
reconciliation remain external/owner gates.

## Money Worker authorization slice (2026-07-23)

`functions/api/qbo-charge.js` and `stripe-pay-link.js` now use the shared `requireRole` boundary
with the UI's `admin`/`manager` billing-role set. Missing sessions, missing/inactive employees, and
non-billing roles return before provider calls. QBO charge no longer accepts the generic webhook
secret as a money-moving alternate identity. The S1b source slice additionally rejects external
employees before connection, invoice/contact access, telemetry or provider helpers.

The QBO route also requires a stable 16–64-character client `Idempotency-Key` and passes it as
Intuit's `Request-Id`; validates positive whole-cent amounts against the current outstanding invoice
balance; writes the actor into `payments.recorded_by`; and uses `mountainToday()` for both UPR
`payment_date` and QBO `TxnDate`. Handler tests prove denied roles never reach either provider and
the allowed execution passes the stable key, actor, and Mountain date.

This does not close the captured-but-unrecorded failure window. A durable attempt must exist before
provider execution, with sandbox-proven reconciliation after provider success/local insert failure.
Stripe stored-session reuse/expiry/concurrency also remains open. Exact boundary and residual-risk
evidence: `docs/audit/2026-07/evidence/money-worker-hardening-2026-07-23.md`.

## Private outbound message media (2026-07-24)

Both conversation composers now upload one final JPEG/PNG/GIF image through authenticated
`POST /api/message-media-upload` instead of writing a public `job-files` object. The Worker binds
the upload to an existing conversation, verifies the actual bytes and 5,000,000-byte maximum, and
stores it under private `message-attachments/outbound/{conversation-id}/...`. Clients and
`messages.media_urls` retain only the opaque `upr-storage://` reference.

`/api/send-message` re-downloads and revalidates private media after the existing staff
authorization/consent path. CallRail receives a multipart `media_file`; Twilio receives a one-hour
signed Storage URL created only in its adapter. `message-media-url` now resolves both inbound
CallRail and outbound private references only after message/index binding. Sent, failed, and
ambiguous references stay durable for history and safe retry. Abandoned private uploads are
retained until a durable draft/claim cleanup model can prevent deletion races and history loss;
there is no browser delete route. No database migration, RCS activation, provider fallback, or
automated CallRail path was added.

## Mobile messaging completion and CallRail readiness (2026-07-24)

Tech Messages v2 now includes a `?new=1` full-screen contact picker backed by
`GET/POST /api/message-conversations`. The Worker requires the shared Conversations capability,
returns at most 25 contacts projected to `id/name/phone/company`, and calls the service-role-only
`find_or_create_conversation(uuid)` RPC. The hardened invoker-mode RPC reuses only active
non-archived direct threads with no different contact participant. Starting a thread does not send
or change consent.

The owner-directed 2026-07-28 opt-out-only source removes
`GET /api/attest-sms-consent` from direct-thread open, eliminating the
“Checking SMS permission…” delay. The thread derives visible DND state from its loaded contact and
the server remains the final authority when Send is pressed. Active internal admin/office users may
still record stronger prior-consent evidence; technicians cannot, notes remain available, and no
attestation auto-sends. The distinct `IMPLIED_CONSENT` code may be accepted only by the
staff-written direct service-message path and the initial reviewed
`appointment_scheduled`, `appointment_canceled`, and `signature_request`
transactional-service policy registry. Those are initial examples; additional
service-notice purposes require a reviewed registry change. Direct implied service decisions must
write `service_send_allowed_existing_client`. A future automated exception must
use a dedicated typed producer that derives purpose/copy from the server-owned
appointment or signature record and writes
`transactional_service_send_allowed` before provider selection. The generic
`sendAutomatedMessage()` path cannot assert the exception, and no such automated
producer is live yet. Generic automation,
scheduled free-form messages, group, broadcast, bulk, marketing, and campaign
traffic still require `GLOBAL_OPT_IN`. DND, explicit opt-out, pending STOP, phone
mismatch, missing/unreadable status, worker-only writes, and no-fallback rules are unchanged.
The source migration `20260728000000_sms_consent_opt_out_only.sql` is not yet live; until its exact
reviewed body is separately applied, the database never returns `IMPLIED_CONSENT` and live send
behavior remains opt-in-only.

Native APNs now uses the same `notify.js` audience and employee-preference
dispatcher as bell, Web Push, and notification email. The focused
`20260728223000_native_apns_token_boundary.sql` migration applied live on
2026-07-28 and adds an exact
`sandbox`/`production` registration attribute, derives the authenticated
employee inside selector-free RPCs, returns redacted metadata, and removes raw
browser token access. Its preflight pins the exact legacy token RPC metadata,
bodies, overload counts, and ACLs, requires the new column/RPC identities to be
absent, and adds the check constraint `NOT VALID` before a separate validation
step to minimize the strong-lock interval. Existing rows remain `NULL` and inert
until a compatible client re-registers. The ordered
`20260728224000_native_push_delivery_guardrails.sql` companion applied
immediately afterward and contains
notification preferences to the authenticated owner, caps token fanout at five,
adds a private durable source-event/device-fingerprint claim, sends an APNs
collapse identity, allowlists only the native route payload, and
compare-and-deletes only the stale token version Apple rejected. The
non-reversible token/environment fingerprint is independent of the
`device_tokens` row, so logout, cap pruning, stale cleanup, and re-registration
cannot erase a 90-day replay boundary. Bounded cleanup prevents unbounded claim
growth. The legacy preference policy object is retained but altered to
fail-closed predicates; the new forced-RLS claim table has an explicit
service-role policy. The guarded rollback restores the exact four prior RPC
bodies/ACLs only with an explicit unsafe session flag, because doing so
deliberately re-opens the prior selector defect. Every production dispatcher now carries its persisted source
occurrence; missing identity skips native delivery. Explicit APNs 429/5xx
refusals release/reclaim for one bounded retry. An exhausted explicit refusal
from the durable message-notification outbox remains retryable in native-only
mode, so bell/Web Push/email do not repeat; network/timeout ambiguity retains
the claim and cannot double-send. Database events, inbound-message
outbox rows, recurring ops alerts, inbound SMS, leads, feedback, melds,
payments, and signed documents carry stable occurrence identities, so retries
collapse while two separate events with identical copy do not. The broad unapplied S1h migration is not
an activation prerequisite and remains separately deferred; its preflight must
be reconciled after the focused preference state changes.

Live CallRail evidence exposed two repository defects: sent webhooks used a ten-digit NANP recipient
while UPR attempts stored `+1` E.164, and current MMS history returned an account-scoped
`app.callrail.com/msg/.../media/...` endpoint that redirects to CallRail's signed S3 asset under a
browser-authenticated session. The
pending migrations/helper changes normalize only equivalent NANP identity and accept only that
exact account/message/index path plus a validated short-lived redirect. A controlled Preview MMS
then proved the app host itself returns `401` to the API token, so verified app identities are
canonicalized to the equivalent documented API media endpoint before download. The CallRail token
is stripped before the signed S3 request. Readiness now reports actionable queues separately from
terminal failure history.

## Ops health alerting (2026-07-25)

Nothing in this system reported its own failures. Evidence at build time: 121 `worker_runs` error
rows in seven days with no alert raised, and an inbound STOP that failed every five minutes for
45 minutes unnoticed. There was no alert, monitor, or health worker anywhere in `functions/api/`.

**New — `POST /api/ops-health`** (scheduler-only, `checkCronSecret`). Read-only over everything it
monitors; it reports and never repairs. Four conditions:

| Condition key | Trips when |
|---|---|
| `provider_events_failed` | any `message_provider_events` row in `failed` |
| `provider_events_stuck` | a `retryable` row is >15 min past `next_attempt_at` (the STOP signature) |
| `worker_errors` | any `worker_runs` error in the trailing 60 min, grouped by worker |
| `unfinalized_claims` | a `fixed_automation_claims` row unfinalized >30 min (no stale recovery by design) |

Alert bodies carry the **sender/recipient identity** (`describeParty`), because triage on 2026-07-24
burned several queries just establishing that three "lost" MMS were the owner's own test number.

Threshold logic is pure and unit-tested in `functions/lib/ops-health.js`
(`evaluateOpsHealth`, injected fixtures, no clock read); the Worker is a thin shell. Emission goes
through the existing in-process `dispatchEvent` staff path — no new send route, no SMS, so no
consent surface is reachable. Dedupe is per condition per Denver day via a `system_events`
`ops_health_alert` marker, and the marker is written **only after a successful dispatch**, so a
disabled type or a notify outage does not silently burn the day's slot. The dedupe lookup fails
**open** (alert twice rather than stay silent through an outage).

Migration `20260725190000_ops_health_alerting.sql` (additive; rollback shipped) seeds the
`ops.health` notification type (**bell-only** by default — owner's chosen channel; push/email remain
per-employee opt-ins), seeds the non-secret worker URL, and schedules `wake_ops_health_worker()`
every 15 minutes. The wake is deliberately **unconditional**: the sibling schedulers guard on "is
there due work", but this worker's job is to notice that something *stopped* happening, and a SQL
guard duplicating its thresholds could drift and silently stop alerting — the exact failure being
fixed.

**⚠️ Migration source is NOT evidence of live grant state — verify the catalog.** Two independent
reviewers on 2026-07-25 both reported anon exposure by reading a 2026-07-08 migration, and both were
wrong against live state, because the DB-Foundation P3 anon closure re-scoped those policies without
rewriting the original source. Verified live 2026-07-25:
`system_events` is **RLS-enabled with ZERO policies** — browser roles read nothing, `service_role`
only (this is why it is a safe home for the ops-health dedupe markers). `worker_runs`' three
policies are still *named* `anon_*` but are scoped `TO {authenticated}`. Always query `pg_policy` +
`pg_class.relrowsecurity` before concluding anything about exposure.

**Known weakness (pre-existing, not introduced here).** Live catalog check 2026-07-25:
`notification_types` has RLS enabled with exactly one policy — `notification_types_all`,
`FOR ALL TO authenticated USING (true) WITH CHECK (true)`. `anon` is therefore **closed** (RLS on,
no policy applies, so the broad table-level `anon` GRANT yields zero rows — an older migration's
`TO anon, authenticated` source was since re-scoped by the DB-Foundation P3 anon closure). But any
**authenticated** employee can `UPDATE`/`DELETE` any row in that catalog, i.e. silently disable the
`ops.health` type and switch the alerting off for everyone. Scoping that policy to SELECT-only plus
an admin-gated write is a separate reviewed change.

## CallRail account identity — verified live 2026-07-25

Read-only provider + catalog evidence, no mutation:

- **`api.callrail.com/v3` requires the NUMERIC account id.** `/v3/a/635117922/...` succeeds;
  `/v3/a/ACCac74130ee99242f0a8c4bde6a74272dc/...` returns **404**. `integration_config
  .callrail_account_id` = `635117922`; the masked id is an account-discovery alias only.
- `functions/lib/callrail-mms.js` `preferredApiAccountId()` **prefers the masked `ACC…` form** for
  every `/v3/` URL it builds (refresh endpoint, redirect validator, canonical media URL), and
  `ingestVerifiedCallrailEventMms` *rejects* the numeric id unless an `ACC…` alias is proven. That
  preference is inverted relative to the live API, so every media refresh 404s →
  `CALLRAIL_MMS_URL_REFRESH_FAILED`. **Not yet fixed** — inverting a deliberate, documented security
  decision needs its own reviewed change.
- **The five failed MMS are still recoverable.** All five `provider_message_id`s still return live
  `media_urls` in the documented numeric API form, so a re-drive after the identity fix recovers
  them. All five are the owner's own test number (385-314-5700), so no customer media was lost.
- **`INVALID_CALLRAIL_SIGNATURE` is a duplicate delivery, not dropped inbound.** CallRail's
  `sms_sent_webhook` and `sms_received_webhook` are each registered with **two** URLs —
  `dev.utahpros.app` *and* `utahpros.app`. Both environments share one Supabase, so every text
  produces one `completed` row and one signature-rejected row ~1s later from the environment whose
  `CALLRAIL_SIGNING_KEY` does not match. Inbound is captured exactly once; the noise is real but
  benign. `INVALID_CALLRAIL_TEXT_EVENT:id` occurred only **twice**, both on 2026-07-23, and is not
  recurring.

## Security tightening batch applied — 2026-07-27 (owner-authorized)

Eight migrations authored 2026-07-26 and applied live on owner instruction. Ledger versions
`20260727012536`..`20260727012929`, all mapped in `scripts/migration-provenance-manifest.json`.
Four reviewers signed off first (migration-safety-checker, anon-grant-auditor,
worker-security-reviewer, consent-path-auditor); every finding was addressed before apply.

**What was actually exposed.** `automation_settings` and `email_suppressions` each carried an
`ALL / {anon,authenticated} / USING true` policy plus all 7 table privileges granted to `anon`. The
anon key ships in the browser bundle, so with no login at all a caller could flip the customer-SMS
kill switch or delete the opt-out list. Both are now RPC-only with zero browser grants.

**Closed, verified live after each step:**

| Object | Before | After |
|---|---|---|
| `automation_settings`, `email_suppressions`, `notification_types` | always-true policy + anon grants | 0 policies, 0 browser grants, `service_role` retained |
| `set_automation_setting` | no caller check | `sms_sending_enabled` admin-only; four toggles admin-or-office; both exclude `is_external`; writes a `system_events` audit row in the same transaction |
| `nav_permissions`, `employee_page_access`, `feature_flags` | `ALL / authenticated / true` write | admin-only write via `is_active_internal_admin()` |
| 6 permission RPCs + 3 notification RPCs | no caller check | admin-gated, `service_role` bypass retained |
| `message_provider_events` | no acknowledgement path | `resolved_at`/`resolved_by` + partial index + service-only `resolve_provider_event()` |

**The trap that was one line from breaking the app:** `nav_permissions` has no authenticated SELECT
policy of its own — every logged-in read was served by the always-true policy being replaced.
Dropping it without adding `nav_permissions_auth_read` would have blanked the navigation menu for
every non-admin. The read policy is in place and verified; 103 rows intact.

**`is_active_internal_admin()`** is the shared admin predicate intended to replace 342 individual
definer reviews (backlog 3.2). Build on it; do not add a second one.

**Still off:** `automation_settings.sms_sending_enabled` is `false` in both org rows. That flip is a
separate owner decision and now writes an audit row capturing the full armed state, because
`missed_call_textback_enabled` is already `true` in one row and goes live the instant the switch does.

### CallRail stranded-event recovery — 2026-07-27

`rearm_callrail_provider_event()` closed a real capability gap: a terminally-failed event had no path
back into the queue, so a genuine customer photo that failed to fetch was unrecoverable by anyone.
Service-role only, matched on the exact event id AND its current `error_code`, so it cannot bulk-reset.

**First drain succeeded**, correcting the prior expectation recorded above under "CallRail account
identity — verified live 2026-07-25": event `c672c71b` (`CALLRAIL_MMS_URL_INVALID`) went
`failed → processed`, `outcome=inbound_persisted`, **media recovered** (765 KB JPEG, sha256 recorded).
It landed in `message-attachments` (`public: false`) and the message row carries an opaque
`upr-storage://` reference, not a URL — the private-media contract held. So `URL_INVALID` events are
recoverable today; the account-identity work is NOT a prerequisite for that class.

**Both `CALLRAIL_MMS_URL_REFRESH_FAILED` events also recovered** (`f50611e2`, `e69e002f`):
`failed → processed`, `outcome=inbound_persisted`, `owned_media=1` each, on their first attempt after
re-arming. **All three stranded inbound MMS are recovered; none was lost.**

Those two were drained by the **production** Worker — the URL switch below landed between their
re-arm and the tick that processed them, so production is proven live on this path, not just
configured.

⚠️ **This supersedes the "CallRail account identity — verified live 2026-07-25" section above.** That
section states the masked-vs-numeric account preference means "every media refresh 404s →
`CALLRAIL_MMS_URL_REFRESH_FAILED`" and is "not yet fixed". The refresh path demonstrably works today:
all three events, across BOTH error classes, recovered their media on first retry with no change to
`functions/lib/callrail-mms.js`. The account-identity finding was real when captured, but the fix
chain landed on 2026-07-24 (`7f86aaf`, `5f8e00f`, `48c7f0d`, `0ff443f`, all in `main`). What actually
kept these five events stuck was the *absence of any re-arm path*, not the account identity. Treat
that section as historical evidence, not current state.

**Worker URLs moved to production** (owner instruction 2026-07-27): both
`ops_health_worker_url` and `callrail_event_recovery_worker_url` now point at `https://utahpros.app/...`.
Verified before switching that both worker files exist on `origin/main` and that both production URLs
are inside the schedulers' exact-URL SSRF allowlist.

**Unexamined, flagged not fixed:** six events sit in `retryable` with
`CALLRAIL_OUTBOUND_UNMATCHED` / `processing_deferred` after 5 attempts each. These are likely what the
ops-health "stuck past retry time" condition reports, and relate to the outbound NANP identity seam.
Two outbound MMS remain `failed` and deliberately untouched pending an owner decision.
## Mobile PWA/Capacitor production-readiness program (2026-07-25)

The completed audit at historical application source
`ef305f6d6afab4d846eab92fc1b04038d70221f0` found 37 items: 2 P0, 21 P1, and 14 P2. The P0
boundaries are bypassable mobile authorization (`MOB-SEC-014`) and public/listable, broadly writable
`job-files` Storage (`MOB-SEC-015`). The audit and canonical mobile documentation are under
`docs/audit/mobile-pwa/` and `docs/mobile/`; macOS/Xcode/simulator addendum evidence is under
`docs/audit/2026-07/evidence/mobile-pwa-macos-xcode-simulator-2026-07-25.md`.

`docs/mobile-production-readiness-roadmap.md` is the active plan of record (`UPRF-MOB-001`).
`docs/mobile-production-readiness-wave-ownership.md` owns collaboration/hotspots, and
`docs/mobile-production-readiness-setup.md` owns task prerequisites. The initial promise is an
online-first PWA with tested warm continuity and a field-route-only Capacitor scope. Cold-offline,
admin-mobile native inclusion, native push, and OTA remain excluded/disabled until explicit owner
decisions and their device/release evidence pass.

The project now has one neutral `tooling/skills/mobile-readiness-wave` source and four bounded
neutral roles under `tooling/agents/`; `npm run generate:tooling` deterministically emits the
checked-in `.claude`, `.agents`, and `.codex` adapters. Run `npm run generate:tooling`,
`npm run check:tooling-generated`, `npm run preflight:mobile`, `npm run validate:tooling`, and
`npm run test:tooling` at session start/close-out. Until the foundation is integrated, start a
bounded `codex/mobile-readiness-*` wave from `codex/mobile-pwa-readiness-foundation`, fetch current
`origin/dev`, and reconcile drift without dropping either history; afterward, current `origin/dev`
is the base. Never assume the dated audit is current. Supabase/Storage/production/providers remain
read-only until a separately authorized apply/deploy/action, and Apple signing/TestFlight/App Store
work remains owner-gated.

### Wave R0 recapture and first containment slice (2026-07-25)

R0 started from clean foundation `7aa4b0c6569396b7e7b5524ed052eca279927218` in isolated branch
`codex/mobile-readiness-wave-r0`. Fetched `origin/dev`
`90b265ee6f733c8dbcd75786f4e4057dd3355d38` was already an ancestor, so the 14 foundation commits
were preserved without a merge/rebase. Historical audit source
`ef305f6d6afab4d846eab92fc1b04038d70221f0` remains the comparison anchor.

Read-only live recapture corrected the historical inline count to 84 current transitive,
client-reachable mobile RPC identifiers: 82 from the authenticated `/tech` graph plus
`get_sign_document_templates` and `get_sign_request_by_token` from public `SignPage`. All are
authenticated/service-role-executable `SECURITY DEFINER`; four allow `anon` and three allow
`PUBLIC`. The correction includes shared auth, bell, Web Push, native push, clock-precheck,
preference, job/claim-merge, and public-signing callers. The current graph also has 22 direct
PostgREST tables plus Realtime on
`conversations`, `messages`, and `notifications`; `messages` retains the scoped capability policy,
while several adjacent policies remain broad. `job-files` remains public with anonymous/public
SELECT, authenticated bucket-wide INSERT/DELETE, no MIME allowlist, a 50 MiB limit and aggregate
77 objects / 58,233,782 recorded bytes. No object name/content was read. Exact capture timestamps,
routes, callers, function signatures/bodies, policies/grants and complete
browser/worker/public-media inventory are in
`docs/audit/2026-07/evidence/mobile-readiness-r0-recapture-2026-07-25.md`.

The first bounded local slice adds `functions/lib/qbo-auth.js` and gates
`qbo-invoice`, `qbo-estimate`, `qbo-payment` and `qbo-query` before privileged work. The exact
server capability is preserved; browser access now requires an active, non-external `admin`.
Negative tests cover missing/expired/config-failed identities, missing/inactive/external employees,
every denied real role, server-secret precedence/fallback, malformed bodies and zero downstream
provider/domain calls. Approved-caller downstream response/provider contracts remain unchanged;
new denials are the deliberate authorization transition.

S1b continues from the exact R0 tip. Customer sync and HTTP payment sync now share the active,
internal-admin browser boundary while retaining their secret-first capability; direct
`scheduled()` payment reconciliation is unchanged. OAuth connect uses a human-only variant so the
server secret cannot replace state. QBO charge/attach remain Bearer-only and reject external
employees. Seventy-seven focused tests cover denied identities and auth/config failure before
business/provider helpers, scheduler/OAuth/capability compatibility and exact disconnected
responses. Customer-sync and manual payment-sync resolve the human actor for authorization but do
not persist that actor in current `worker_runs` telemetry; durable actor auditing remains open.

S1c continues from the exact S1b tip. The CallRail recording proxy now admits only an active
internal admin or `crm_call_log` employee/role capability, binds the call row/provider ID/URL
before secrets, preserves the private audio/error/rewrite contracts and times both fetch paths.
HTTP notify keeps exact-secret and in-process callers unchanged; a human Bearer is active internal
admin only and may request four object-derived appointment/estimate events with no caller-supplied
audience or content. Eighty-three focused tests cover identity/configuration/object denial,
provider-never-called ordering, recording success/error/timeout shapes, secret precedence and
notification object contracts. No provider, notification, customer content or secret value was
read.
The complete source/caller/test/review/rollout record is
`docs/audit/2026-07/evidence/mobile-readiness-s1c-callrail-notify-2026-07-26.md`.

S1d continues from exact S1c tip `352be211` and merges current provenance-only `origin/dev`
`d54b6ba` without rewriting history. A bounded read-only live capture confirmed the exact
`notify_emit(text,jsonb) -> void` signature, owner/definer/search-path/ACL/body and its six
owner-run caller functions/seven call sites, three triggers, and abandoned-clock `postgres` cron.
The authored migration keeps URL/secret/header/payload/pg_net/ignored-response contracts, removes
direct `authenticated` execution, retains `service_role`, and makes the trusted top-level type key
win. Exact rollback, catalog-only pre/post-apply checks, browser-denial/caller/failure/provenance
contracts and sanitized evidence are in
`docs/audit/2026-07/evidence/mobile-readiness-s1d-notify-rpc-2026-07-26.md`. Nothing was applied.

Neither P0 is closed. The pending S1d apply, direct `get_inbound_leads`/`inbound_leads`
recording-URL access, authenticated `create_notification`, the wider definer/direct-policy census,
unbounded shared Auth/Web Push fetches and the external-partner playback UI mismatch remain under
`MOB-SEC-014`; private media compatibility and live apply remain under `MOB-SEC-015`. Current
native source still mounts `/tech/admin/*`, so field-only Capacitor scope is an unenforced product
decision. Cold-offline, native/admin scope, Web Push/APNs, OTA, account-deletion fulfillment, pilot
support, `project_manager` billing authority and the shared QBO capability lifecycle remain owner
gates. QBO human-actor telemetry and external-admin `qbo_attachments` RLS remain separate named
residuals; S1d made no QBO or recording-source schema change.

No deploy, migration apply, push, secret/provider change, message, push notification, money
movement, signing or distribution occurred in S1d.

S1e continues from exact S1d tip `fa58dba` and merges fetched `origin/dev` `6b5dc802` through
`02ed432a` without rewriting history. Read-only live metadata captured only the exact
`get_inbound_leads` definition/hash/ACL, `inbound_leads` columns/ACL/policy/trigger metadata, and
employee/CRM assignment column names. No row, URL, recording, customer, provider, configuration or
secret value was selected.

Unapplied migration `20260726183409_inbound_lead_recording_source_boundary.sql` moves raw URLs to
forced-RLS service-only `inbound_lead_recording_sources`, captures future scalar sources after lead
IDs exist, recursively strips recording-source keys from `raw_payload` before storage, and leaves
`upr-recording://available` in the frozen public shape. It gates
`get_inbound_leads` to active internal admin or `crm_call_log`, removes anonymous privileges and
authenticated direct DML, and allows active-internal company-wide SELECT because no employee-to-
CRM-org/lead assignment exists. The approved proxy and `transcribe-call` read the new source table
with a validated legacy-column fallback for Worker-first rollout; mobile/desktop still send only
`lead_id` and test marker truthiness. Exact rollback, value-free apply checks and credential-free
contracts accompany it. Rollback cannot reconstruct privacy-safe keys removed from `raw_payload`.

S1d apply, `create_notification`, QBO actor telemetry, `qbo_attachments` RLS, private media and
other mobile/native/release gates remain separate. No apply, deploy, push, provider call, playback,
secret/live-setting change, message, money movement, signing or distribution occurred in S1e.

S1f continues from exact S1e tip `637ac709`, initially merges fetched `origin/dev` `65fddb5c`
through `b7bd45ab`, then reconciles final `origin/dev` `245c0c4` through `d99fce91` without
rewriting history. Catalog-only live capture found one exact
`create_notification(text,text,text,text,text,uuid,uuid,jsonb,uuid,text) -> notifications`
overload, owner `postgres`, SQL `SECURITY DEFINER`, `search_path=public`, unchanged body/definition
hashes, and EXECUTE for `authenticated` plus `service_role`. Its sole direct database-body caller
is owner-run `apply_midnight_clock_split()`; the sole non-test runtime API caller is the
service-role notification Worker.

Unapplied migration `20260726194300_create_notification_service_boundary.sql` changes only EXECUTE
ACLs: browser roles are denied and `service_role` is retained. Signature, defaults, return shape,
body, recipient/broadcast semantics, tables, rows, policies, triggers, and callers do not change.
Exact rollback, catalog-only pre/post checks, and a credential-free CI contract accompany it.
S1d/S1e/S1f applies, notification read/mark recipient binding, QBO telemetry/RLS, private media,
deployment, providers, and native/device gates remain separate. No live mutation or bell emission
occurred.

S1g starts from reviewed S1f tip `a6b139b`; fetched `origin/dev` remains `245c0c4` and is already
an ancestor, so no drift merge or history rewrite is required. Catalog-only live capture reads no
notification/employee/customer row. It pins the exact four bell read/mark overloads and
body/definition hashes, their authenticated/service ACLs, the 13-column notification shape,
broad table ACL, authenticated `notifications_select USING (true)`, sentinel-delete policy,
Realtime publication, the authenticated employee SELECT/RLS dependency, employee Auth uniqueness,
and zero direct database-body callers.

Migration `20260726260000_notification_read_recipient_boundary.sql`, live as
`20260728192024_notification_read_recipient_boundary`, preserves
`get_notifications(integer,uuid) -> SETOF notifications`,
`get_unread_notification_count(uuid) -> integer`, `mark_notification_read(uuid) -> void`, and
`mark_all_notifications_read(uuid) -> void`, including defaults and old broadcast-only call
shapes. Authenticated calls derive one active non-external employee from `auth.uid()` and reject
foreign selectors. Forced-RLS, browser-inaccessible `notification_reads` with an explicit
authenticated deny policy provides independent broadcast receipts while legacy globally-read
broadcasts stay read and targeted rows keep base `read_at`. The existing notification SELECT
policy object becomes active-internal own-or-broadcast, authenticated table access becomes
SELECT-only for Realtime, and the obsolete test-row DELETE policy object is retained but changed
to `USING (false)`. The shared PWA/Capacitor `NotificationBell` and Realtime client need no source
change; the JavaScript recipient filter remains defense in depth.

Exact fail-closed rollback, catalog-only pre/post checks, a two-gate rollback-only multi-identity
behavior script (including all service compatibility branches), local-only pgTAP runner bridge,
credential-free QA contract, and dated evidence accompany S1g. The 2026-07-28 correction aligns
the five-column identity-containment contract, makes the new receipt and retained delete policies
explicitly fail closed, and changes rollback to preserve authorization while disabling browser
access. Its exact sequence passed in disposable official local Supabase. The live postcondition,
Moroni list/count, foreign/unmapped denial, advisors, and provenance passed without returning
notification contents or changing read state. Two-session PostgREST/Realtime and installed-client
bell proof remain open. Rollback intentionally keeps the historical anonymous notification-table
grant revoked. S1d/S1e/S1f applies, emission, QBO telemetry/RLS,
private media, shared identity/device/preferences, deployment, providers, native signing/devices,
and final qualification remain separate. No notification mark, deploy, provider action, signing,
or distribution occurred in the S1g apply window.

S1h source began from reviewed S1g tip `f6554ad4`. The authorized governance merge preserves exact
parents `f6554ad4` and `e9bf8f2`; subsequent history through `e2b7585` keeps the R0→S1g chain and the
normal `origin/dev` merge at `6019b667` without rebase or rewrite. The owner transferred the DB-1
and APP-2/APP-3 coordination surfaces to this mobile-readiness session.

The final review worktree is `codex/mobile-readiness-current-origin-review`. Local integration merge
`4688ed64` preserves direct parents `4583f0a6` and `e2b7585f`. A read-only pre-publish fetch completed
2026-07-27 08:02 MDT and advanced `origin/dev` to `983b8ca4`; the follow-up merge has direct parents
`4688ed64` and `983b8ca4`, with common base `4583f0a6`. Its sole content conflict in `src/App.jsx`
was resolved by retaining both target-specific web/native registries and the latest field-tech
conversation/job/claim/schedule redirects. Work Authorization messaging, conversation retry
deduplication, friendly field error states, provenance updates, agent governance, and other
concurrent additions are retained rather than overwritten.

Authentication source is now selector-free and fail-closed. A genuine Supabase session resolves
`get_my_employee_profile()`; malformed profile/role/feature/page-access responses do not publish an
internal employee. Rejected bootstrap, logout, password recovery, observer-only session expiry,
and direct account transitions must complete or safely preserve old-account PWA/Web Push/APNs
cleanup before the next principal becomes usable. Observer-only cleanup failure never retries with
the expired client: local session state is cleared, the durable owner-bound journal survives, and
only a fresh same-account bootstrap may complete it before employee publication. Independent
security review found no remaining source P0/P1; the focused race suite passes 46/46.

### PR #525 integration onto current `dev` (2026-07-27)

**APPLIED to the shared database: `20260726180000_mobile_employee_identity_authority.sql`.**
**Ledger version assigned at apply time: `20260727154506`** — the filename is NOT the ledger
version; record the assigned one or the provenance gate reports it unmapped. Additive only: it
creates three `SECURITY DEFINER` functions with pinned `search_path`, `REVOKE` from `PUBLIC, anon`
then `GRANT` to `authenticated, service_role`:

- `get_my_employee_profile() → TABLE(id, full_name, display_name, email, role, is_active, is_external, default_division)`
- `get_employee_directory(p_include_inactive boolean DEFAULT false) → TABLE(id, full_name, display_name, role, color, avatar_url, is_active)`
- `get_message_author_directory(p_message_ids uuid[]) → TABLE(id, full_name, display_name)` — capped
  at 200 ids, gated behind `messaging_can_access_conversations()`

It had to be applied **before** the merge: `AuthContext` bootstraps every session through
`get_my_employee_profile` with no fallback, and its catch runs a local `signOut`. Verified live on a
real authenticated session — a fresh login resolves the RPC and publishes the employee.

**Owner ruling (2026-07-27):** `get_employee_directory` gates `is_external` only on the *inactive*
roster, so an active external account can enumerate the active internal roster (names, roles,
colors, avatars — no email, no pay). Owner reviewed and approved shipping as-is.

**APPLIED to the shared database 2026-07-28 (owner-authorized): `20260726182000_mobile_employee_identity_containment.sql`
→ live ledger version `20260728002105`.** It drops both `employees` policies for a single
`employees_self_identity_read` (`authenticated`, SELECT, `auth_user_id = auth.uid()`), revokes ALL
table privileges from `PUBLIC, anon, authenticated`, and re-grants column SELECT on exactly
`(id, auth_user_id, role, is_active, is_external)`. `get_all_employees()` is now admin/service-only;
commission read and write gate on the new `can_current_employee_access_settings()` helper
(EXECUTE granted to `postgres` only — the definers call it internally).

**What it actually closed, measured before the apply:** `anon` held all 8 table privileges plus
`allow_anon_read_employees` (`FOR SELECT`, `USING (true)`). The publishable key ships in the browser
bundle, so every employee's name, email, phone, `hourly_rate`, `overtime_rate` and commission was
readable **without logging in**. Post-apply, `anon` and `authenticated` both fail
`has_table_privilege(...,'SELECT')`, and reading `hourly_rate` as either role raises
`permission denied for table employees`.

Verified live in the office shell (2026-07-28, authenticated owner session): schedule board + crew
filter, `/time-tracking`, `/settings/team` (22 rows incl. rates), `/crm/tasks` assignee picker,
office and tech appointment crew pickers (16 employees each), `/jobs`, `/production`, job/claim/
customer pages, and `/settings/commissions`. Negative paths confirmed by direct role calls:
`get_all_employees()`, `get_employee_commissions()` and `upsert_employee_commission()` all raise
`NOT_AUTHORIZED` for a non-admin caller, the write raising *before* its `UPDATE`.

> **⚠️ IT BROKE THE INSTALLED CAPACITOR APP, and this is the lesson to carry forward.** The native
> app ships its web bundle **inside the binary** (`capacitor.config.json` `webDir: "dist"`, no
> `server.url`), so it does not pick up server-side deploys. The installed bundle predates the RPC
> refactor and still calls `db.select('employees', 'email=eq.…')` — a `select=*`, which now dies at
> the column-privilege layer. Login fails with **"Failed to load employee data."** (a string that no
> longer exists anywhere in `src/`, which is how the stale bundle was identified). Capgo OTA cannot
> push a fix: `.github/workflows/capgo-deploy.yml` was paused 2026-06-24 on a plan limit. The only
> remedy is a native rebuild + reinstall; `.github/workflows/ios-release.yml` needs five Apple
> signing secrets and dispatches only from `main`.
>
> **The process failure worth fixing:** the migration carries 27 hash-pinned guard sites that verify
> the database's internal consistency exactly, and **not one** checks whether a deployed or installed
> client still reads the table. Its own header lists that as apply-order step 3 — *"resolve old
> cached/native client compatibility explicitly"* — in prose, unenforced. The predecessor handoff
> also asserted that none of these four migrations blocks Capacitor, which is false. A grep for
> direct `employees` reads plus "what bundle is on real devices" would have caught it for free.
> Recommended before applying migrations 2–4: a CI check that fails on direct browser reads of
> RPC-only tables. Rollback stays available at
> `supabase/rollbacks/20260726182000_mobile_employee_identity_containment.rollback.sql`; it re-grants
> `anon`, so the destructive-SQL guard blocks agents from running it and the owner must run it
> manually. It does **not** delete the ledger row, so the provenance mapping above stays true either
> way.

**New routes:** `/tech/legal/privacy`, `/tech/legal/terms`, `/tech/legal/support` render the same
`PrivacyPolicy`/`TermsOfService`/`Support` components as the office routes, but inside the field
shell. Field Settings links these, never the bare office paths: those render with no nav, and the
PWA/Capacitor container has no browser back button, so a tech who tapped one had to force-quit. The
office routes remain for the logged-out case, which is why `Login.jsx` still links them.

**Offline product decision CLOSED (owner-ratified 2026-07-27):** online-only for the initial
release. See the amendment in `.claude/rules/tech-mobile-ux.md`; `docs/mobile-production-readiness-roadmap.md`
C1 updated. The four offline save handlers (`TechAppointment` readings/equipment, `HubTools`
likewise) **throw** rather than return — both entry sheets treat a resolved promise as success, so a
bare return fired "Reading saved", closed the sheet, and discarded the tech's typed reading.
Verified live on dev 2026-07-27: offline save produced one error toast, the sheet stayed open, and
the typed values (42.7 / 61 / 70) survived intact.

### Deploy-cache poisoning and the boot guard (2026-07-27)

**Build output moved from `assets/` to `app-assets/`** (`vite.config.js` `build.assetsDir`).
`public/_headers` follows it. This was a ONE-TIME un-poisoning, not routine practice.

`dev.utahpros.app` went fully blank — desktop and installed iPhone PWA. Not a code defect. Two
config lines combined: `public/_redirects`' `/* /index.html 200` answers a MISSING hashed asset with
the app shell at **HTTP 200**, and `public/_headers`' asset rule stamps it `immutable` for a year.
During a deployment swap an edge node requested a chunk that had not propagated, and both the
Cloudflare edge and end-user devices cached HTML under a `.js` URL. A browser refuses `text/html`
for `<script type="module">`, so the entry graph never instantiates: `main.jsx` never runs, React
never attaches, and **nothing throws**. Blank page, empty console.

Three things future work must not undo:

- **Prevention is NOT available at the Pages layer.** Two `_redirects` 404 variants were tried and
  BOTH were ignored on a real preview deploy. The hazard and both failed attempts are documented in
  `public/_redirects`; do not re-add an inert rule believing it protects anything.
- **The boot guard in `index.html` must stay a CLASSIC script.** `vite build` hoists the module tag
  into `<head>`, so correctness rests on module-defer semantics. As `type="module"` it would fail for
  the same reason the app does and become decorative.
- **`/reset` is inert on iOS.** It relies on `Clear-Site-Data`, which **Safari does not implement** —
  proven on a real iPhone. Every field technician is on iOS, so the guard repairs entries with
  `fetch(url, {cache:'reload'})` instead. Never treat `/reset` as the field app's recovery path.

**Post-deploy check:** `npm run smoke:deploy -- <url>` (`scripts/smoke-deploy.mjs`). Asserts every
boot asset really is JS/CSS and that `index.html` is `no-store`. Run it AFTER the alias swaps — the
Cloudflare check went green ~9 minutes early, measured twice. It caught the race recurring live.

### Office appointment route (2026-07-27)

**New route `/schedule/appointment/:apptId`** renders the Schedule board and opens the appointment's
existing `EditAppointmentModal` from the URL. Until it existed, `/tech/appointment/:id` was the ONLY
appointment screen in the app, so `notify.js` pointed every appointment notification at it and
desktop users clicking the bell landed in the mobile UI; `ClaimPage.jsx:706` already linked here and
simply 404'd. `notify.js` now stores the office path. `techShellRoutes.js` gained `techToOfficePath()`
so `linkForCurrentShell` translates BOTH directions — that is what fixes the notification rows that
already store a field path, with no data backfill.

### Applied to the shared database (2026-07-27)

Ledger versions are assigned AT APPLY TIME, not from the filename:

- `mobile_employee_identity_authority` → **`20260727154506`**
- `anon_closure_tranche_b` → applied. Dropped 8 always-true `anon` policies and revoked table
  privileges on `contacts` / `conversations` / `conversation_participants`. Verified after: anon
  policies 8→0, anon grants→0, all 6 `authenticated` policies intact, conversations still loading.
- `notification_role_defaults_rpc_only` → applied. Table is now RPC-only.
- `create_notification_service_boundary` → **`20260727233252`**
- `notify_emit_service_boundary` → **`20260727233704`**
- `upsert_employee_page_access_provenance_reconciliation` → **`20260727233845`**
- `mobile_employee_identity_containment` → **`20260728002105`** (2026-07-28). See the containment
  section above — verified live, and it **broke the installed Capacitor app**, which needs a native
  rebuild. Two of the mobile-security queue remain unapplied: `20260726183409` and
  `20260727022920`. Each needs its own owner authorization, and each should wait
  on the client-contract check the containment apply proved is missing.

**`employees.is_external` is a named carve-out, not a widening** (PR #528). The sibling migrations
`20260726183409` and `20260726260000` add POLICIES whose predicates read it, and a policy predicate
evaluates with the CALLING role's privileges — ungranted, every authenticated SELECT on those tables
fails. Both siblings preflight that the column EXISTS, never that it is GRANTED. Bounded by the
self-identity policy: a caller reads only their own row. The structural fix (route those policies
through a `SECURITY DEFINER` helper and drop the carve-out) is a roadmap item.

**2026-07-28 S1g qualification and apply:** fresh value-free production catalog capture confirmed
the containment ledger row, self-only employee policy, exact five authenticated employee columns
including `is_external`, absence of `notification_reads`, both original notification policies,
the original four function hashes/ACLs, and `supabase_realtime` publication. No employee or
notification row was read. The previously checksum-pinned S1g source incorrectly expected four
employee columns, created a forced-RLS table without an explicit policy, dropped a live policy
object, and shipped a rollback that expected the pre-containment state and reopened the BOLA.
Corrected source fixes all four defects and passes credential-free contracts. Its exact
preflight→forward→post-apply→isolated behavior→paired rollback chain passes against both a temporary
synthetic PGlite database and a disposable official local Supabase 2.110.0 stack. This proves the
catalog, role, function, transaction, and guarded rollback behavior but not live
Auth/PostgREST/Realtime sockets. The owner then authorized the exact corrected checksum; only S1g
applied, as `20260728192024`. The standalone live postcondition passed. Moroni's authorized
active-internal identity passed list/count/direct-RLS visibility while foreign-selector and
unmapped callers failed `42501`; no contents were returned and no read state changed. Browser
writes, direct receipt access, and anonymous access are denied. Advisors found no S1g regression,
and fresh provenance matches the ledger, four RPCs, and three policies. Two-session
PostgREST/Realtime plus PWA/Capacitor bell verification remain open.

The initial production release intentionally has **zero automatic offline command admission or
replay**. `PRODUCTION_QUEUE_TYPES` is empty, no production component exposes enqueue/retry or
persists a photo blob, and the maintenance runner imports no dispatcher. Field photo, moisture
reading, equipment placement, and equipment removal paths fail clearly while offline. Historical
IndexedDB rows are payload-free quarantine only; exact two-click local discard may clear all
accounts' offline stores, and bounded owner-scoped completed-photo cleanup never sends. Independent
offline review found no P0/P1; the focused zero-replay lane passes 58/58. Under Node 22.23.1, the
integrated unit lane passes 90 files/1,079 tests, Worker passes 99 files/1,476 tests, and QA passes
25 files/206 tests, with zero unexpected skips. Targeted lint and web/native builds pass; full lint
retains the known 310-problem baseline.

Credential-free local browser smoke at 390px and 1440px caught a current-origin route-registry
omission before release: `/settings/lists` still rendered `ListsAndValues`, but the page was missing
from the frozen web registry and `App` destructuring. The binding is restored, and a generic QA
contract now proves equality across all 90 declared lazy pages, web-registry exports, and
`App` bindings. Logged-out root, `/privacy`, and `/status` smoke now passes; independent
cross-platform review found no P0/P1 and confirmed the page remains absent from the native graph.
Authenticated/installed/device proof is still pending.

The revised S1h database source is an ordered sequence:

1. `20260726180000_mobile_employee_identity_authority.sql`;
2. compatible browser/PWA/native deployment and explicit old-client decision;
3. `20260726182000_mobile_employee_identity_containment.sql`;
4. `20260727020000_upsert_employee_page_access_provenance_reconciliation.sql`; and
5. `20260727022920_mobile_personal_ownership_boundary.sql`.

The prior permission writer is live as assigned version
`20260727012825 permission_write_gates`. The four new source migrations are absent from the live
ledger. Containment removes browser employee authority writes; the final boundary makes
`employee_page_access`, `notification_prefs`, `push_subscriptions`, and `device_tokens`
forced-RLS, policy-free, and browser-RPC-only. Web/native registration permits same-owner refresh
but rejects cross-owner possession/rebind; reviewed service maintenance remains.

The rejected `20260726223610` artifact is retained only under
`docs/audit/2026-07/evidence/rejected-sql/`. A temporary, non-retained PostgreSQL-compatible
experiment did not execute the exact checked-in forward, catalog, isolated, or rollback files and
retained no governed harness/log. S1h is therefore source-hardened but not applied,
database-behavior-verified, or `ready_for_apply`; use
`docs/mobile/s1h-database-apply-runbook.md`.

Native source includes separate web/native route registries, legal/support/signing routes, app-link
coordination, privacy-screen plumbing, account deletion, a release workflow, and an Apple privacy
manifest with 12 linked/nontracking App Functionality data types. Repository configuration is not
proof of APNs/VAPID, hosted AASA, Cloudflare bindings, Apple signing, archive/TestFlight/App Store
Connect acceptance, or real-device behavior.

S1d, S1e, S1f, S1g, the four S1h windows, QBO telemetry/RLS, private media, public signing,
deployment, providers, Apple signing/TestFlight, browser/PWA/device qualification, and eventual
`dev → main` promotion remain separate owner/external gates. Local source-integration commits and a
draft PR do not authorize any of them. No database apply, deployment, provider call, notification,
money movement, signing, or device action occurred in this reconciliation.

---

## Leads board search bar (2026-07-27, owner-directed standalone)

`/crm/leads` gained a free-text **search box** in its existing filter bar (`CrmLeads.jsx`,
`.crm-leads-filterbar`), positioned **after** the Last 7 / Last 30 / All time tabs and the Filters
panel (owner-directed 2026-07-27; the first pass placed it first in the row). Owner-directed standalone work, recorded as `.claude/rules/crm-wave-ownership.md`
§12. **Zero schema, zero migrations, no RPC touched, no worker touched.**

- **Pure client-side**, exactly like the date-range and criteria filters beside it: it narrows the
  `leads` array already in memory, no extra fetch, no loading flip. It is folded into the existing
  `filteredLeads` useMemo, so the board, the "N of M leads" subtitle and the empty state cannot
  disagree.
- **Matching** — three exported pure helpers in `CrmLeads.jsx`: `leadSearchTerms(query)`,
  `leadSearchText(lead)`, `matchesLeadSearch(haystack, terms)`. Every whitespace-separated term
  must match (**AND**, not OR), so "smith water" finds the Smith lead about water damage. Case
  insensitive. Covered by `src/pages/crm/crmLeads.search.test.js` (22 tests, unit lane).
- **Fields searched:** linked contact name/phone, `caller_name`, `caller_number`, `source`,
  `medium`, `campaign`, `transcript_analysis.summary` / `.topics` / `.customer_email` /
  `.customer_address`, every scalar and array value in a web form's `form_data`, `lost_reason`, and
  the legacy `notes` column.
- **Phone-aware:** each lead's numbers are also indexed digits-only, and a query term of 3+ digits
  is matched digits-only too, so `801-555`, `(801) 555` and `8015551234` all find the same stored
  `+18015551234`. `normalizePhone()` cannot serve here — it returns `null` below 10 digits, i.e. for
  every partial query. The 3-digit floor keeps a lone "5" from matching every dollar amount.
- **Raw `transcription` is deliberately NOT searched**, though the board loads it. This page never
  renders a transcript (Call Log does), so a transcript-only hit would surface a card with no
  visible reason for matching. The AI summary and topics are searched instead — both are on the
  card — so every match stays explainable. Deep transcript search belongs on Call Log.
- **Truncation is disclosed, not silent.** The board fetches the `BOARD_LEAD_LIMIT` (200) most
  recent leads. Live non-spam, non-merged count on 2026-07-27 was **75**, so search is currently
  complete. Once the cap is genuinely reached *and* a search is active, a line under the filter bar
  says "Searching the 200 most recent leads — older ones aren't loaded on this board"
  (`loading-error-states.md` §5). **Follow-up, not built:** a real server-side "search all leads"
  path is what this board needs before it passes 200 — the note is the trigger.
- **State is component-local, not URL** — consistent with the sibling filters, and opening a lead is
  an in-page panel rather than a route change, so nothing is lost. Clearing is either the input's own
  ✕ or the bar's Clear button, which is labelled "Clear search" when only search is set and
  "Clear filters" otherwise. Search counts toward `hasActiveFilters` but deliberately not toward the
  Filters badge count, which tracks only the criteria panel.
- **Perf:** haystacks are built once per `leads` change into a memoized `Map` (`searchIndex`), so a
  keystroke costs ~200 `String.includes` calls rather than 200 string rebuilds. No debounce needed.
- **UI:** the shared `SearchInput` primitive (`@/components/ui`) skinned onto the CRM kit via a new
  `/* ─── CRM LEADS SEARCH ─── */` marker at the end of `src/index.css` — same reasoning the
  `.crm-board-period` block already records. Height is pinned to the **measured 38px** of the
  segmented control and Filters button beside it (not `.input`'s 40px) so the three share a top and
  bottom edge. Desktop `flex: 0 1 260px` (min 190 / max 300); at ≤768px it takes its own full-width
  line at 40px, where the global iOS guard forces 16px and prevents zoom-on-focus. Sitting last also
  costs one row fewer on mobile than the original first-in-row placement did — the date tabs and
  Filters fit together on one 390px line, with search full-width beneath them.

## Native iOS audit remediation (2026-07-27, branch `codex/native-ios-remediation`)

Source-side remediation of the 2026-07-27 Native iOS Experience & Release
Readiness audit (37 findings: 7 P0, 24 P1, 6 P2). Branch is **not merged and not
pushed**; every commit stands alone with its own verification.

**Closed:** REL-01 (source half), REL-02, PRIV-01, PUSH-01, AUTH-01, KB-01,
SET-01, STAT-01, RES-01, SAFE-01, SAFE-02, JOB-01, PICK-02, PICK-03,
PICK-01 (partial), PICK-05, ESIGN-01, MSG-01, MSG-04.

### New shared modules

| Module | Purpose |
|---|---|
| `src/lib/companyDate.js` | `todayInCompanyTimeZone()` / `companyDateOf()` — America/Denver calendar dates. Client counterpart to the worker-only `functions/lib/date-mt.js`. Replaces `toISOString().split('T')[0]`, which returns TOMORROW after ~6pm Mountain. |
| `src/lib/nativeKeyboardLayout.js` | Reference-counted keyboard-inset port. Native adapter uses Capacitor keyboard events; web adapter uses the visualViewport baseline algorithm proven on-device in ThreadView. |
| `src/lib/useNativeKeyboardInset.js` | React consumer. **Native-only by owner decision** — returns 0 and attaches nothing on web. Also exports `techStickyCtaBottom()`. |
| `src/lib/publicSigningUrl.js` | Signing links pinned to a real UPR https host. `window.location.origin` is `capacitor://localhost` in the app. |
| `src/components/FieldShellRoute.jsx` | AUTH-01 role gate on `/tech/*`. Allowlist lives beside `getAccountLandingPath` in `authBootstrap.js` so gate and landing rule cannot drift. |
| `src/components/PublicNativeShell.jsx` | SAFE-02 safe-area + status surface for the seven public native routes. |

### Contract changes worth knowing

- **`nativeAppearance.js` API replaced.** `statusBarLight`/`statusBarDark` named the TEXT colour and mapped onto the same-sounding Capacitor enum member, which documents the opposite — both were inverted. Now keyed on the SURFACE: `setStatusBarBase` (ThemeContext owns it), `pushStatusBarSurface`, `restoreStatusBarBase`.
- **`data-native="true"`** is stamped on `documentElement` at module scope in `App.jsx` when `IS_NATIVE`. New native-only CSS scopes to it.
- **Two safe-area inset owners, one per shell:** `.tech-layout` (authenticated) and `.public-native-shell` (public). They never nest.
- **`isTimeRangeInvalid`** in `techFormConstants.js` is the single time-range rule for all three scheduling forms.

### Owner decisions still open

1. **`--brand-primary` + 6 sibling tokens are undefined** — referenced from CSS *and* JSX inline styles (`CustomerPage.jsx`); those declarations do not render. Recorded in `KNOWN_UNDEFINED` in `tests/qa/unit/css-token-resolution.test.js`. Choosing values is a design decision.
2. **Native `UIDatePicker` plugin** (PICK-01 remainder) — new dependency, needs `perf-budget.md` justification. The build-target seam already exists.
3. **Money date-defaults** still slice UTC: `ClaimBilling`, `recordPayment`, `invoiceMath`.
4. **`TIME_OPTIONS`** is English-only AM/PM, arbitrary 06:00–22:30.
5. **`22:30` as a start time** is a dead end; `LAST_SELECTABLE_START` is exported if you want to bound it.

### Release gates unchanged by this work

Apple Distribution certificate, App Store provisioning profile, and App Store
Connect API key remained absent at that audit boundary; the APNs and physical-
device state changed in the 2026-07-28 activation section below.
`ios/fastlane/Fastfile` still requires the distribution and provider assets.
**QUAL-01** remains open for the complete physical-device/iPad matrix even
though the current signed iPhone Debug slice now has evidence. DATA-01 needs a
migration and was excluded by the original audit decision.

## Native Push and App Store operational activation (2026-07-28)

The owner-authorized physical-device handoff closed the old “no real device” statement for the
current Debug slice: the exact verified branch build `1.0.0 (1)` was signed by team `H6ZUT739T9`,
installed in place over Wi-Fi on the owner's iPhone 17 Pro Max, launched successfully, and retained
the authenticated session without another Face ID challenge. This is not a distribution archive,
TestFlight install, or complete device matrix.

Apple Developer and App Store Connect now have real release state:

- bundle `com.utahprosrestoration.upr` has Associated Domains and Push Notifications enabled;
- APNs Auth Key `JX22945D4T` is team-scoped for Sandbox & Production;
- Cloudflare Pages project `utah-pros-app-git` has `APNS_P8_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID`,
  `APNS_TOPIC`, `APNS_ENV`, and `VITE_NATIVE_PUSH_ENABLED` in both environments;
- Preview uses APNs sandbox and Production uses APNs production. The compatible source SHA
  `dc8120797b273c1c5aa944659005aec56b7bbcf3c` deployed to the `dev` Preview target before the
  two focused migrations applied; the Cloudflare-hosted enrollment flag remains explicit `false`;
- the owner iPhone Debug build was rebuilt locally with native enrollment explicitly enabled,
  reinstalled in place, and registered a fresh redacted `sandbox` token after both migration
  postconditions passed. Older environment-less rows remain inert;
- the owner-only Dev Tools → Advanced → Native Push control calls the fixed
  `POST /api/send-push` diagnostic seam with a stable UUID. The server fixes the recipient to the
  authenticated owner, copy, and `/tech/settings` route, so the UI cannot choose another employee
  or arbitrary payload;
- the first generated APNs key was revoked before use after trace exposure, both downloaded key
  files were permanently removed, and only Cloudflare's encrypted copy of the active replacement
  remains; and
- App Store Connect app `6795664765` exists as **UPR Field Operations**, version 1.0, bundle
  `com.utahprosrestoration.upr`, SKU `UPR-IOS-2026`. “UPR” alone was unavailable.

The iOS release workflow now treats exact `VITE_NATIVE_PUSH_ENABLED=true` as a mandatory archive
input and passes it into the native web build; without that release input a TestFlight IPA would
silently ship enrollment disabled even if Cloudflare were configured.

Apple Distribution certificate `3QA6GT9L28` and App Store profile `UPR App Store 2026` now exist.
The app-target-scoped signing lane produced a clean Xcode 26.6 archive and exported IPA locally.
The verifier passed bundle/team/version/build identity, strict signature, production Push
entitlement, non-debug App Store provisioning, encryption declaration, privacy manifest, and
archive/IPA parity. The qualification IPA hash is
`eb022fae79464c25980746e961e80b383958677854ec5eafe1b4365d840b4b41`. Because the worktree was
dirty, its sanitized report has no source commit and it is evidence for the signing lane, not the
final upload artifact.

App Store Connect API access is enabled. The unusable first key was revoked, and replacement Admin
team key `XV5CUK6XLC` is configured in GitHub environment `ios-testflight` as encrypted
`ASC_KEY_ID`, `ASC_ISSUER_ID`, and `ASC_KEY_CONTENT_BASE64` secrets. GitHub confirmed all three
secret names and timestamps before the downloaded private-key file was removed. This closes the
App Store Connect authentication-key gate only; the remaining signing/build secrets, clean-source
artifact, and owner-authorized provider upload are still separate gates. No provider upload
occurred.

The focused native-push database boundary is now live. The three S1h dependencies were already live as
`20260727154506 mobile_employee_identity_authority`,
`20260727233845 upsert_employee_page_access_provenance_reconciliation`, and
`20260728002105 mobile_employee_identity_containment`; never replay them. Only
`20260727022920_mobile_personal_ownership_boundary.sql` remains absent and
deferred. The focused, ordered
`20260728223000_native_apns_token_boundary.sql` and
`20260728224000_native_push_delivery_guardrails.sql` applied separately as live
ledger versions `20260729021021` and `20260729021050`. The latter contains the
notification-preference owner boundary, durable source-event/device claims,
bounded fanout, compare-and-delete pruning, and service-role-only claim data.
Live postconditions proved selector-free authenticated enrollment, anonymous
denial, forced RLS, service-only claim data, and direct-table denial. A
compatible `dev` bundle is deployed, and the owner's development-signed iPhone
build enrolled a fresh APNs sandbox token while older environment-less rows
remain inert. The one authorized background banner and tap-to-`/tech/settings`
test is still pending. Production promotion, a clean-source distribution
archive, TestFlight upload/install, and production APNs proof remain separate
gates. After this focused apply, the broad S1h preflight is expected to refuse its old
input state until S1h is deliberately reconciled and re-qualified. Fresh live
preflight is required before any future S1h apply.

The reported field PWA `TechMore` failure carried release
`c9060b299a5a0430ad4814267322de51a2d9e07f`, while current `dev` is
`d5d08cb48ed083d45108dce018969df760076f55`. Current hosted `TechMore` chunk
resolution returns JavaScript successfully, the current page renders for field
and admin-mobile identities in a focused regression test, and the Web Push
feature flag, VAPID endpoint, authenticated subscription RPC ACLs, and the
owner's existing subscriptions remain present. This evidence points to an old
installed-PWA shell/chunk rather than the native APNs boundary disabling Web
Push. The existing **Clear cache & reload** recovery preserves authentication
and subscription state; physical PWA confirmation after that recovery remains
the release-facing proof.

## 2026-07-29 — CallRail inbound native Push occurrence repair

Read-only live evidence showed a CallRail inbound event projected and delivered
through the notification outbox, with Web Push subscriptions in its effective
audience, but no native delivery claim. Source review found the exact mismatch:
`claim_message_notification_outbox` returns the durable outbox `id` and omits
`provider_event_id`, while the worker passed the absent field as
`notification_event_id`. Native dispatch therefore failed closed before token
lookup as designed. The worker now uses the returned outbox `id` as the stable
APNs occurrence and records only aggregate allowlisted native delivery
telemetry. No schema, consent, CallRail send, audience, or customer-message
behavior changed.

## 2026-07-29 — Inactive Twilio inbound durable parity authored

Repository source now places signed Twilio inbound SMS/MMS behind the same
provider-event, per-phone atomic projection, and unique notification-outbox
boundary as CallRail. MessageSid is the replay identity; MMS bytes are
authenticated, bounded, byte-validated, and copied into private deterministic
Storage paths before projection; STOP/START/HELP consent remains ordered before
notification; and the direct best-effort `notifyInboundMessage()` module/path
was removed in the same change. Additive migration
`20260729211728_twilio_inbound_notification_parity.sql`, paired rollback,
credential-free Worker/QA coverage, and a rollback-only isolated database proof
were authored. At this authoring checkpoint nothing was applied to `qa-staging`
or production, deployed, provider-bound, activated, or sent.

## 2026-07-29 — Inactive Twilio inbound parity staged and shared-schema applied

Commit `8a7fd8e` deployed the compatible inactive Worker to `dev`; CI and the
34-asset deployment smoke passed. The exact reviewed migration, source SHA-256
`4f3859baba80d2f9d4d9801f7eaaba9e5cbfec564ed092eac575d1592cd6cf3f`,
was applied to isolated `qa-staging` under ledger `20260729220202`. Its
rollback-only behavioral proof passed and left zero fixture residue. The same
source was then applied to the shared project under ledger `20260729221116`.
Production and staging share deployed definition hash
`58b9d8db71347fb317145e683b8919db`, service-only ACL, invoker mode, pinned
search path, caller guard, phone lock, and outbox markers. Production
verification was read-only. No Twilio webhook/provider configuration changed,
no provider switch occurred, and no live traffic was sent.

## 2026-07-30 — Conflict markers, a dead-CSS structural defect, and the release-gate unblock

Three pre-existing defects found and fixed while reconciling `dev` and `main` and
promoting. None was introduced by this session.

**1. Committed conflict markers in `UPR-Web-Context.md`.** Unresolved
`<<<<<<< ours` / `=======` / `>>>>>>> theirs` at :132/:170/:213 had been committed
and pushed by `f27fc366`, and were live in BOTH `dev` and `main` — the Rule 9
source-of-truth doc was corrupted in production. The two sides documented
different, independent topics (the LES-01 load-failure contract and the
`useResumeRefetch` single-hook rule), so neither superseded the other; both were
kept verbatim and only the three marker lines removed. A repo-wide sweep found no
other occurrence.

**2. One unclosed `{` in `src/index.css`, silently disabling all `.crm-lead-value`
styling.** Details in the current-state doc. The short version: the last rule in
the file never closed, so the build re-emitted the remainder as CSS nesting and 7
selectors became inert. This was the true cause of the lead Value control showing
native button chrome. Found independently and near-simultaneously by two sessions;
the two fixes were converged by hand (merging two fixes for one missing brace can
emit two braces and break the file the other way — brace delta was verified 0 after
resolution, and `index.css` ended byte-identical to the CRM session's version).
Now guarded by `tests/qa/unit/css-structural-integrity.test.js`.

**3. The `dev → main` release gate could not have passed for anyone.**
`validate:provenance --strict-freshness` failed for two reasons, only one of which
was the 6-hour evidence clock (missed by 10 minutes). The real one:
`Unmapped live ledger row 20260730155213:crm_lead_value_from_claim` — that
migration was applied to production but never added to `ledgerMappings`, so every
promotion was blocked until it was mapped. Mapped to its committed source at
`reviewedOriginCommit 8bf6be6b`; the gate independently verifies source identity,
so a wrong mapping fails rather than passes.

Evidence was refreshed with the committed read-only catalog query — SELECT-only
over `pg_proc`/`pg_policies`/`schema_migrations`, returning md5 hashes and
privilege booleans, no table data and no secrets. **No migration was applied and
no write touched the shared project**; the provenance commit is bookkeeping about
an apply that had already happened. `capturedAt` is honest rather than re-stamped:
the facts were re-queried immediately before assembly and matched exactly
(`funcs_digest 1b029dac7d5c6d6688be77c1bb33cc04`, ledger 54, functions 27).

Also landed: `ci_scripts/ci_post_clone.sh` now runs `npm ci` before validating the
`VITE_SUPABASE_*` workflow variables, so a missing variable can no longer surface
as a misleading missing-SPM-package error. Dormant — Xcode Cloud is not the
canonical pipeline and is being paused; `.github/workflows/ios-release.yml` is
canonical.

Lesson recorded: three of these were invisible to diff review. Committed conflict
markers, an unbalanced brace at end-of-file, and a missing provenance mapping all
read as ordinary additions in a hunk. Each is now caught by a mechanical guard
rather than an eye.

## 2026-07-30 — Fleet-wide native message-push outage: dev-hosted outbox + Preview APNS_TOPIC

**Symptom (owner report, evening):** no employee received native notifications, and the
owner saw no iOS permission prompt. **Reality after investigation:** exactly one dispatch
path was dead — inbound-message notifications — and the prompt absence was expected
behavior (iOS asks once per install; the owner's install already held a grant).

**Timeline (MT).** Last successful native message push 07-29 19:17 (a SANDBOX send to the
owner's development build — the only enrolled device at the time). Owner installed
TestFlight 1.0.0 at ~19:43, registering the fleet's first production token. Dev redeployed
overnight (00:56 / 01:15 iOS commits). First failing run 07-30 07:41 — the owner's own
"Test log out apple compliance" text — and every run after showed
`attempted:N, sent:0, retryable:0, pruned:0`. Techs enrolled fresh production tokens at
08:02/08:14 into the already-broken window.

**Root cause.** The message-notification outbox worker was woken (pg_cron →
`wake_message_notification_outbox_worker()`) at
`integration_config.message_notification_outbox_worker_url`, which pointed at
**`https://dev.utahpros.app`** — the only worker URL on the dev deployment, i.e. the only
notifier running with Cloudflare **Preview** env vars. The 07-29 "UPR Dev" side-by-side
app work set Preview `APNS_TOPIC` for the dev bundle id
(`com.utahprosrestoration.upr.dev`); the overnight redeploy activated it, and Apple then
rejected every production-fleet push from that host — HTTP 400, the
`DeviceTokenNotForTopic` signature (valid key ⇒ no 403; valid tokens ⇒ no prune).
`docs/mobile/dev-app-variant.md` had warned "Preview-triggered pushes will not reach the
production-topic app." Everything dispatching from production (New Lead, appointments,
owner test sends) kept working throughout, which is what made the outage look
contradictory.

**Why it was invisible:** `worker_runs.meta.native` persists counters only — Apple's
`reason` strings live solely in the per-request results that no table stores. The
counter signature `attempted>0, sent=0, retryable=0, pruned=0` IS the fingerprint of a
non-retryable 4xx; `pruned` increments only on 410/`BadDeviceToken`, so a 400 with no
prune is a topic-class rejection.

**Diagnosis path that worked:** live `worker_runs`/`device_tokens` forensics → all three
local archives verified correctly signed (`aps-environment=production`, correct app id,
`VITE_APNS_ENV=production` in the bundle) → owner-authorized `POST /api/send-push` on
BOTH origins (production: `sent:2` Apple 200; dev: `400`, non-retryable) → `cron.job` +
wake-function source → `integration_config` URL row.

**Fix (owner-authorized, ~19:50 MT):** one-row UPDATE repointing
`message_notification_outbox_worker_url` to
`https://utahpros.app/api/process-message-notification-outbox` (already allowlisted in
the wake function; no deploy needed). **Verified end-to-end 19:55 MT:** the next real
inbound text produced `sent:4 / attempted:4` and the on-device banner. Missed
notifications from the outage window are not replayable (outbox rows were consumed).

**Follow-ups filed:** (1) Xcode Cloud `ci_post_clone.sh` does not validate
`VITE_NATIVE_PUSH_ENABLED`/`VITE_APNS_ENV` — a flag-less build ships push silently
disabled; (2) per-token APNs topic routing (store the bundle id per device token) so one
deployment can serve both the production app and the UPR Dev variant — until then, one
env-level `APNS_TOPIC` per deployment is a standing constraint. Enrollment census at
close: native = Moroni, Matheus, Juani; web push = Ben, Nano; no push channel = Bighetti,
Marcelo E., and one active employee with no display_name set.

## 2026-07-30 — pg_net worker-URL allowlists authored (outage-audit follow-up, NOT applied)

The 2026-07-30 outage audit found the same latent class elsewhere: two SECURITY DEFINER
pg_net callers still dispatch to WHATEVER URL their `integration_config` row holds —
`notify_google_calendar_sync(uuid,text,jsonb)` (only a NULL/blank check, from 20260630) and
`notify_emit(text,jsonb)` (same, from 20260728224000). A rewritten config row would turn
either into an SSRF vector that also hands the webhook-secret header to the attacker's host.

**Authored (owner apply pending):** `20260730214500_pg_net_worker_url_allowlists.sql` —
function-body-only replaces giving both callers the exact two-URL allowlist
(`dev.utahpros.app` + `utahpros.app` worker paths) and the fail-closed
`NULLIF(btrim(v_secret),'')` gate the four wake functions (outbox, ops-health,
CallRail-recovery, QBO-payments) already carry. Signatures, return types, owners and
effective ACLs unchanged; REVOKE-before-GRANT re-declared for the managed-project PUBLIC
re-grant trap. md5 drift guards anchor both directions: pre-change fingerprints
`9c97af19…` (gcal, computed from 20260630 source) and `3f972d71…` (notify_emit,
independently confirmed by the 20260728224000 rollback preflight); post-change
fingerprints are shared by the migration postflight, the paired rollback's preflight, and
the post-apply check. The secret gate is behavior-preserving: both receiving workers
(`google-calendar-sync.js:42-47`, `notify.js` `authorizeNotifyRequest`) already 401 a
blank secret.

**Shipped alongside:** paired rollback (restores byte-exact prior bodies — verified by
hash), CI contract test `tests/qa/unit/pg-net-worker-url-allowlists.test.js` (9
assertions, green; proves intent, not live effect), read-only
`supabase/tests/pg_net_worker_url_allowlists_post_apply.sql` for the apply window, and
**`docs/database/integration-config-worker-urls.md`** — the registry of all 8
`*_worker_url` keys plus the read-only ops query that catches the actual outage class
(a production-critical key pointing at dev; the allowlists deliberately permit both
origins, so they do not catch it — the ops check does).

**Deferred, recorded in the migration header:** (1) `notify_google_calendar_sync` keeps
its live `authenticated` EXECUTE grant (no browser caller found; tightening is a separate
ACL-only change); (2) the two `transcribe_call_worker_url` pg_cron command strings inline
`net.http_post` with no allowlist — hardening a cron command string is a different shape
(unschedule/reschedule) and gets its own change.

## 2026-07-31 — Scheduled-message participant boundary and one-submission source authored

The conversation-participant release review found a pre-existing escape hatch: any authenticated
browser could write `scheduled_messages`, choose `created_by`, and the dequeue Worker did not
recheck that creator's current Messages capability or conversation access. A retry could also
reclaim a stale scheduled row after an unknown provider outcome.

Repository source now contains a compatibility/enforcement pair, both **unapplied**. Compatibility
adds actor-derived stable-ID creation, exact-owner queue/cancel, random token-fenced service
lifecycle RPCs, and one irreversible `delivery_attempt_id` reservation made only after the central
kill-switch/consent/DND/quiet-hours gates. The Worker rechecks creator access and exactly one active
phone recipient at dequeue and reservation, permits one Twilio invocation, preserves fresh
in-flight work, and reconciles accepted/unknown outcomes without automatic resubmission. The
browser retains only an opaque owner-scoped operation ID across a Capacitor WebView restart so a
lost create response can be retried rather than duplicated. Enforcement later removes raw browser
table access and retires the frozen legacy claim fail closed.

Focused Worker and credential-free QA tests, migration hygiene, syntax, lint, and the mocked
provider-barrier concurrency proof passed during authoring. A rollback-only isolated database proof
was added to the governed local runner but was not run because no approved isolated local target
was configured. No hosted migration, deployment, provider call, production data change, or device
claim occurred.
