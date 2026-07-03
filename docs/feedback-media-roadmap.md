# Feedback Media — Roadmap (Foundation + parallel wave)

**Initiative:** photos + video on employee feedback, a desktop submission surface, and
retention/purge plumbing — upgrading the tech-only screenshot pipeline (`tech_feedback`)
into one shared feedback-media system.

> **Provenance note (2026-07-03):** the plan-of-record PR for this roadmap had not merged
> when Session F launched — this file was seeded BY Phase F from the owner's dispatch block
> (which contained the full binding Phase F spec + ownership matrix). Sessions B and C:
> treat the ownership matrix below as binding; flesh out your own phase blocks when
> dispatched.

**Model:** Foundation-then-parallel-wave (same shape as CRM roadmap v3). **Phase F owns
100% of the wave's schema** — Sessions B and C ship zero migrations and consume the frozen
shared composer as-is. Isolation: there is no feature flag for this initiative (deliberate —
the /feedback page is harmless-by-design and ungated); the blast radius is contained by
file ownership instead.

---

## Ownership matrix (BINDING for the wave)

| Surface / file | Owner | Notes |
|---|---|---|
| `supabase/migrations/20260702_feedback_media.sql` | **F (shipped)** | ALL schema + RPC cutover. Wave ships ZERO schema migrations. |
| `supabase/tests/feedback_media_schema.test.js` | **F (shipped)** | Integration proof of the cutover. |
| `src/lib/mediaCompress.js` (+ test) | **F (shipped)** | FROZEN for the wave — B/C import, never edit. |
| `src/components/FeedbackAttachments.jsx` | **F (shipped)** | FROZEN for the wave — built complete; B/C render it as-is. Contract changes = Phase F follow-up. |
| `src/pages/Feedback.jsx` | **F (shipped)** | Desktop form. |
| `src/App.jsx` route + `src/lib/navItems.jsx` entries | **F (shipped)** | Frozen in-wave: B/C do not touch App.jsx/navItems.jsx. |
| `src/index.css` | shared, **section-markered** | F's block + two reserved blocks appended at the bottom. B writes ONLY inside `FEEDBACK MEDIA RESERVED — Session B`; C only below `… — Session C`. |
| `src/pages/tech/TechFeedback.jsx` | **Session B** | Live page — nobody else edits it, F did not touch it. |
| `src/pages/AdminFeedback.jsx` | **Session C** | Live page — nobody else edits it, F did not touch it. Admin gallery/viewer belongs here, NOT in FeedbackAttachments. |
| `functions/*` (incl. the future purge endpoint) | **frozen in-wave** | The purge worker is a separate post-wave change; the RPCs it needs already exist. |
| `supabase/migrations/tech_feedback.sql` (undated) | **frozen forever** | Superseded by the dated migration; never edited per protocol. |

---

## Phase F — Foundation (Session F) — ✅ SHIPPED

Everything the wave depends on: schema, RPC cutover, shared media library, the frozen
composer, the desktop surface, and the CSS/none-flag wiring.

### Schema + RPCs (`20260702_feedback_media.sql`, one transaction, additive-only)
- [x] `tech_feedback` + `attachments jsonb NOT NULL DEFAULT '[]'`
- [x] + `source text NOT NULL DEFAULT 'tech' CHECK (source IN ('tech','desktop'))`
- [x] + `resolved_at timestamptz`, + `attachments_purged_at timestamptz`
- [x] Backfill: screenshots → `{path}`-only attachment records; `resolved_at = now()` for already-terminal rows
- [x] **DROP+CREATE** `insert_tech_feedback` → 7-arg (`+p_attachments`, `+p_source`) — no ambiguous overload (verified live through PostgREST with the exact old 5-arg call)
- [x] Insert body mirrors BOTH directions (screenshots→attachments for old callers; image attachments→screenshots for new callers) so deploy order never breaks rendering
- [x] `update_tech_feedback` plain OR REPLACE, same signature — stamps `resolved_at` on first terminal transition, keeps it terminal↔terminal, NULLs on reopen, never touches `attachments_purged_at`
- [x] `get_tech_feedback` DROP+CREATE with the 4 new columns appended (live caller ignores extra keys)
- [x] `get_purgeable_feedback_media(p_days int DEFAULT 90)` with `GREATEST(p_days, 30)` clamp INSIDE the RPC
- [x] `mark_feedback_attachments_purged(p_id uuid)` — idempotent first-stamp-wins
- [x] Re-GRANT EXECUTE after every DROP+CREATE; all 5 RPCs SECURITY DEFINER + anon/authenticated
- [x] Applied via Supabase MCP `apply_migration` + `bust_postgrest_cache()`; test rows deleted
- [x] Bonus fix found live: legacy `screenshots` were double-encoded jsonb string scalars (`JSON.stringify` through PostgREST) — normalized in backfill + decoded in the insert body

### Shared code
- [x] `src/lib/mediaCompress.js` — pure caps/validation/path helpers above a SECTION marker (33 unit tests green), browser `compressImage` / `probeVideo` below
- [x] `src/components/FeedbackAttachments.jsx` — snap-first immediate upload, per-tile `picked→compressing/probing→uploading→done|failed` with Retry (cap-re-validated), best-effort storage DELETE on remove behind a busy `removing` state (fixes the live orphaning bug without opening a submit race), video duration chip, ≥48px hit areas, `{path,name,mime,size,original_size,width?,height?,duration?}` records, `value/onChange/onBusyChange/disabled/caps` contract, `useAuth()` internally. **Reset contract: `value` seeds on mount only — parents clear the composer by remounting with a new `key`** (a value-watching effect was removed after adversarial review proved it raced parallel upload completions)

### Desktop surface + wiring
- [x] `src/pages/Feedback.jsx` — working form (Bug Report / Improvement), submits `p_source:'desktop'` + `p_attachments`
- [x] Routed in `App.jsx` inside the authenticated Layout shell, NO admin gate
- [x] `navItems.jsx` entries (OVERFLOW_ITEMS + SYSTEM_ITEMS) reusing `IconFeedback` with `always: true` + `hideForRoles: ['crm_partner']` (that role is locked to /crm/*+/help by Layout's choke point — the link would dead-end); `isItemVisible` gained the generic `hideForRoles` check
- [ ] Legacy mobile `Sidebar.jsx` link — **deliberately not done**: `Sidebar.jsx` renders `NAV_ITEMS` with inline gating that ignores `always` (and its header freezes the legacy list), so a <1280px office user reaches /feedback by URL or the Settings rail only. Wiring the legacy sidebar is a follow-up decision for the owner, not silently-skipped work.
- [x] `index.css`: Phase F block + reserved `Session B` / `Session C` markers appended at the bottom
- [x] Documentation Standard headers on every new file

### Verification (Session F, 2026-07-03)
- [x] `npm test` (347 passed; integration suites self-skip without creds — the feedback suite runs green wherever `VITE_SUPABASE_*` creds + network are available and was proven equivalent live via PostgREST)
- [x] `npm run build`
- [x] `npx eslint` on all touched files — no new errors (navItems' 5 `react-refresh/only-export-components` errors pre-exist at HEAD)
- [x] Visual check of /feedback (Playwright, Supabase stubbed): desktop 1366px + 768px; parallel 2-file upload→compress→done tiles, remove→storage DELETE, submit payload `p_source:'desktop'` with a real-array `p_attachments`, success toast, post-submit composer reset
- [x] Adversarial review workflow (3 finder lenses × 2-skeptic verification): 5 confirmed findings — value-sync race (major), submit-during-remove window, retry cap bypass, stale failed tiles after reset, crm_partner dead-end link — **all fixed pre-merge** (see the composer reset contract + `hideForRoles` above)

---

## Session B — TechFeedback rebuild (parallel wave) — ⬜ NOT STARTED

Rebuild `src/pages/tech/TechFeedback.jsx` on `FeedbackAttachments` (photos + video for
field techs), keeping the tech-mobile-ux rules (snap-first, one primary action, 48px
targets). Calls the 7-arg `insert_tech_feedback` with real-array `p_attachments`
(NOT `JSON.stringify` — see the migration header) and `p_source:'tech'`. Styles inside the
`FEEDBACK MEDIA RESERVED — Session B` block in `index.css`. Zero migrations.
May add the tech-side nav/entry points it needs within its own files.

## Session C — AdminFeedback rebuild + gallery (parallel wave) — ⬜ NOT STARTED

Rebuild `src/pages/AdminFeedback.jsx`: render `attachments` (images + video player,
`source` badge, resolved/purged states) with a proper gallery/viewer — the viewer lives
HERE, not in the shared composer. Reads the extended `get_tech_feedback`; status updates
keep using `update_tech_feedback`. Styles below the `FEEDBACK MEDIA RESERVED — Session C`
marker. Zero migrations.

## Post-wave (owner-gated) — ⬜ NOT SCHEDULED

- Purge worker (`functions/api/…`, cron convention) consuming
  `get_purgeable_feedback_media` / `mark_feedback_attachments_purged` — the ≥30-day clamp
  already lives inside the RPC so the unauthenticated endpoint can't shorten retention.
- Legacy mobile `Sidebar.jsx` "Send Feedback" link (see Phase F open box).
