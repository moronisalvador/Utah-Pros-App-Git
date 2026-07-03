# Feedback Media — Roadmap & Dispatch Model of Record (2026-07-02)

Produced by a `/masterplan` planning session (docs only — zero feature code) and adversarially
reviewed by a 4-agent challenge pass (refute-first verification, B∥C disjointness proof,
design-validation architect, counter-ordering skeptic). Every HAVE/PARTIAL verdict below comes
from live code/DB reads, not docs. Companion dispatch blocks: `docs/feedback-media-dispatch.md`.

**The initiative:** everyone in the company (not just field techs) can attach **photos and
videos** to bug reports and improvement suggestions; **image compression + video caps + 90-day
attachment purge** keep storage structurally bounded; the owner's triage inbox renders the media
properly (video player, lightbox, sizes). Owner decisions on record: everyone submits · notify
admins on submit (push chosen; email declined) · auto-purge 90 days after resolved/dismissed ·
existing code is "low quality", rebuild welcome.

**Storage clarification (recorded):** media lives in Supabase **Storage** (~$0.021/GB/mo), not
Postgres — the risk is cost/clutter, not DB bloat. Compression (images), caps (video), and purge
(both) bound it structurally. Today: ~104MB total across both buckets; `tech_feedback` has 1 row.

---

## Status reconciliation (live DB + code, 2026-07-02)

Fresh initiative — nothing in-flight to finish first. The existing surface is live and working
(tech-only, images-only):

| Piece | Live status | Notes |
|---|---|---|
| `tech_feedback` table + 3 RPCs | live | Defined in the **undated outlier** `supabase/migrations/tech_feedback.sql` (pre-dates the naming convention). F supersedes via a dated migration; the old file is not edited. |
| `TechFeedback.jsx` submit form | live | Tech app only (⋮ menu on TechDash). 3 images max, `image/*` only, no compression. |
| `AdminFeedback.jsx` triage inbox | live | `/tech-feedback`, AdminRoute. `<img>`-only render — a video path would render broken. |
| Desktop submit surface | none | Office staff cannot file feedback at all. |
| Notifications on submit | none | Pull-only; owner sees new items only by opening the inbox. |
| Compression / video / retention | none | No compression code anywhere in the repo; no video handling; no purge. |

**Doc-drift disclosures:** `UPR-Web-Context.md` names a `message-attachments` bucket; zero code
references exist (21 live files in it — investigate someday, out of scope here). The live
`job-files` bucket has a **server-side 50MB `file_size_limit`** that appears nowhere in the repo
(bucket config is dashboard-only; see Finding 5).

## Severity findings

1. **P2 — storage-leak on screenshot removal/abandon.** `TechFeedback.jsx:118-124` uploads
   immediately on pick but `removePhoto` only drops local state — the storage object is never
   deleted; abandoning the form after picking also orphans objects. Exposure: bounded (feature
   barely used; 1 feedback row ever). Interim guidance: none needed. Fix: Session B (real DELETE
   on remove) + Session C's purge worker sweeps `feedback/`-prefix orphans unreferenced by any
   row and older than 7 days.
2. **P2 — AdminFeedback shared `noteText` state.** `AdminFeedback.jsx:63,79-95,344-352` binds one
   `noteText` state across all rows; a status change can save the wrong row's notes (and the
   feedbacks array mutates on every keystroke). Exposure: minimal today (1 row), real once volume
   grows. Fix: Session C per-row draft-notes redesign.
3. **P3 — raw filenames interpolated into storage URL paths.** `feedback/${emp}/${ts}-${file.name}`
   breaks on `#`, `?`, spaces, emoji-named iOS files. Fix: `sanitizeFilename` in Phase F,
   used by the shared composer.
4. **P3 — no `resolved_at` timestamp.** Retention is impossible to compute today. Fix: F migration.
5. **Observation — server-side limits are dashboard-only.** `storage.buckets`/`storage.objects`
   are owned by `supabase_storage_admin`, so **SQL migrations cannot create buckets or storage
   policies** — bucket config is invisible to schema-as-code. Recorded; the plan works within it
   (see options-on-record: bucket).

## Gap-audit appendix (evidence-based; HAVE only from code/schema, never from docs)

| # | Capability | Verdict | Evidence |
|---|---|---|---|
| A1 | Tech-app feedback submit (bug/feature, title, description) | HAVE | `TechFeedback.jsx` → `insert_tech_feedback` (`tech_feedback.sql:27-47`) |
| A2 | Desktop/office submit surface | MISSING | No route/nav; grep confirms form exists only in tech shell |
| B1 | Image attachments | PARTIAL | 3 max, 10MB client guard, `image/*` only (`TechFeedback.jsx:40-41,87,350`) |
| B2 | Video attachments | MISSING | Every MIME guard is `startsWith('image/')`; no `<video>` anywhere |
| C1 | Client image compression | MISSING | No canvas resize/`toBlob` in repo; no media npm package (package.json). Challenge-CONFIRMED |
| C2 | Client video compression | MISSING | Nothing; rejected as v1 scope (options-on-record) |
| C3 | Server-side size cap | PARTIAL | Live bucket `file_size_limit=52428800` (50MB) — dashboard-configured, not in repo |
| C4 | Server-side MIME allowlist | MISSING | `job-files.allowed_mime_types = null` (live query) |
| D1 | Attachment metadata (mime/size/duration) | MISSING | `screenshots` jsonb = bare path strings (`tech_feedback.sql:11`) |
| D2 | Retention / purge | MISSING | No `resolved_at`, no purge path, no worker |
| E1 | Admin triage inbox | HAVE | `AdminFeedback.jsx` + `get_tech_feedback`/`update_tech_feedback` |
| E2 | Admin media rendering (video, lightbox, sizes) | MISSING | `<img>`-only at `AdminFeedback.jsx:283-301` |
| F1 | Notify on submit — APNs push | PARTIAL, wired-unverified | `send-push.js` exists, zero callers; APNS env unset (503 path); **`device_tokens` = 0 rows live** → delivery reaches nobody today. Challenge-CONFIRMED |
| F2 | Notify on submit — in-app bell | PARTIAL | `NotificationBell.jsx` + `create_notification` RPC + realtime toast work today, but feed is **global** (no recipient column, `20260624_notifications.sql:4`) |
| G1 | Upload code reuse | MISSING | Storage-POST pattern copy-pasted at 8 call sites; `fileUrl()` helper has ~12 inline clones |

## Compression strategy (options-on-record)

**Images — real compression (the actual win):** client canvas downscale to ≤1920px long edge,
JPEG q≈0.8 → a 10MB phone photo lands at ~0.3–0.6MB (>90% reduction). HEIC/decode-failure
fallback: upload the original if ≤10MB, else reject with a clear toast. Never upload a result
larger than the original.

**Video — caps, not transcode (the honest answer).** Phone video is already codec-compressed;
re-encoding in a Capacitor WebView / iOS Safari is fragile and slow. Evaluated:
- **Option 1 (CHOSEN): caps + purge.** 1 video per feedback, ≤90s (metadata probe), 50MB
  server-enforced (live bucket cap). With the 90-day purge, worst realistic steady state is
  single-digit GB ≈ pennies/month. All PRs/docs must say **"compression = images only."**
- Option 2: MediaRecorder canvas re-encode — runs at playback speed, audio pitfalls, Safari
  fragility. Rejected. Caveat under which it wins: none foreseeable in-browser.
- Option 3: Cloudflare Stream ($5/1k min stored) — external billing + new dependency, overkill at
  internal-feedback volume. Rejected. Caveat: revisit if feedback video ever becomes a
  customer-facing feature.

**Caps (owner-tunable constants in `mediaCompress.js`):** 5 files total · 1 video · video ≤90s ·
image input ≤25MB pre-compression · video ≤50MB (mirrors live server cap).

## Notify channel (options-on-record)

Owner picked push; challenge pass proved push-alone is a **silent no-op today** (APNS env unset →
worker returns 503; `device_tokens` empty; admins work on desktop where the iOS token path never
runs). Adjudicated design: **both channels via one tiny worker** (`feedback-notify`, Session B):
`create_notification` (in-app bell + realtime toast — works today; global feed, all employees see
it — disclosed) **plus** per-admin `send-push` fan-out (503-tolerant; becomes real the day the
owner configures APNS env vars and devices register). Email: declined by owner, out of scope.

## Storage bucket (options-on-record)

- **CHOSEN: keep `job-files` + `feedback/` prefix.** Existing wide-open policies cover it; live
  50MB server cap already enforced; legacy paths need zero rewriting; migrations can't create
  buckets anyway (Finding 5).
- Option: dedicated `feedback-media` bucket with MIME allowlist + independent size cap — a
  2-minute **owner dashboard action**, upgradeable later without code changes beyond one constant.
  On record, not a gate.
- **Accepted risk (recorded):** attachments are world-readable public URLs (pattern used by the
  whole app). Mitigations: unguessable timestamp-prefixed paths, internal tool, 90-day purge
  shrinks the exposure window. Follow-up option on record: private prefix + worker-signed URLs.

---

## Phase F — Foundation (schema cutover + shared media lib + working desktop page)

> **Branch:** harness-assigned (illustrative: `feedback/phase-f-foundation`), cut from `origin/dev`.
> **Prerequisite:** this plan-of-record PR merged into `dev`. Model: **Opus · high** (live-RPC
> cutover on the shared Supabase — the riskiest work in the initiative).
> **Read scope:** this block + the ownership matrix below + `CLAUDE.md` + `.claude/rules/tech-mobile-ux.md` + `.claude/rules/documentation-standard.md`.
> **Close-out checklist:**
> - [x] Test-first, now green: `supabase/tests/feedback_media_schema.test.js` — old **5-arg**
>       `insert_tech_feedback` via PostgREST still succeeds (proves no overload ambiguity +
>       cache bust); 7-arg round-trip incl. both-direction mirror; `resolved_at` state table
>       (set on first terminal, kept terminal↔terminal, NULL on reopen); purge boundary 89d/91d
>       (assert own ids only); purged-row exclusion; afterAll cleanup. `src/lib/mediaCompress.test.js`
>       — `fitWithin` never upscales, `sanitizeFilename` edge cases, `validateFile`/`validateSelection`/
>       `checkVideoDuration` caps, `buildStoragePath`/`stripBucketPrefix` shapes.
>       *(Suite self-skips without `VITE_SUPABASE_*` creds — the build container's egress policy
>       blocks supabase.co, so every assertion was additionally executed live: RPC calls through
>       PostgREST via MCP, purge-boundary semantics via a live SQL DO-block.)*
> - [x] Acceptance: migration applied + verified live via MCP, `bust_postgrest_cache()` run, live
>       TechFeedback submit re-verified working (old code, new RPC); desktop `/feedback` page
>       **working end-to-end** (type/title/description/attachments, `source:'desktop'`) and visible
>       in nav to all employees; composer compresses a large image and enforces all caps.
> - [x] `npm run test` + `npm run build` + `npx eslint` (no new errors) pass.
> - [x] `migration-safety-checker` + `upr-pattern-checker` clean.
> - [x] Visual: `/feedback` via Playwright at 1366px + 768px (Supabase stubbed — same egress
>       policy; Cloudflare branch preview built green for the human spot-check).
> - [x] `UPR-Web-Context.md` updated (seed the "Feedback Media" section WITH pre-labeled
>       Session B / Session C sub-headers).
> - [x] Reconcile this doc's checkboxes; delete test rows; pushed; PR #256 into `dev`.
>
> **Delivered 2026-07-03 (PR #256) — deltas vs this block, all additive, none breaking:**
> - Found live: legacy `screenshots` values were **double-encoded jsonb string scalars**
>   (`JSON.stringify` → PostgREST) that AdminFeedback's `Array.isArray` silently drops —
>   the migration normalizes existing rows and the new insert body decodes string input.
> - `get_purgeable_feedback_media` also returns `resolved_at` (extra column, additive).
> - Adversarial review (3 lenses × 2 refute-skeptics) confirmed 5 bugs in F's own new code;
>   all fixed pre-PR. Binding consequence for **Session B/C**: the composer's **reset
>   contract** — `value` seeds tiles ON MOUNT ONLY; to clear it, remount with a new `key`
>   (a value-watching effect raced parallel uploads and was removed). Also: Retry
>   re-validates caps; remove runs behind a busy `removing` state (blocks submit).
> - Nav entries carry `hideForRoles: ['crm_partner']` (new generic `isItemVisible` check) —
>   that role is locked to /crm/*+/help by Layout's choke point, the link would dead-end.
> - The legacy mobile Sidebar got the link hardcoded after the NAV_ITEMS loop (Help
>   precedent, same crm_partner exclusion) on the owner's blanket go-ahead.
> - `formatBytes` / `formatDuration` exported from `mediaCompress.js` per this doc (Session
>   C imports them; the composer's duration chip already uses `formatDuration`).

Scope (everything additive):
- **Migration `20260702_feedback_media.sql`** (one transaction; apply via MCP `apply_migration`):
  - `ALTER TABLE tech_feedback ADD COLUMN IF NOT EXISTS`: `attachments jsonb NOT NULL DEFAULT '[]'`,
    `source text NOT NULL DEFAULT 'tech' CHECK (source IN ('tech','desktop'))`,
    `resolved_at timestamptz`, `attachments_purged_at timestamptz`.
  - Backfills: `attachments` from legacy `screenshots` (elements become `{path}`-only — every
    consumer treats all keys except `path` as optional); `resolved_at = now()` for already-terminal
    rows (conservative: nothing purges on the first run).
  - **`insert_tech_feedback`: `DROP FUNCTION insert_tech_feedback(uuid,text,text,text,jsonb)` then
    CREATE the 7-arg version** (+`p_attachments jsonb DEFAULT '[]'`, `p_source text DEFAULT 'tech'`).
    `CREATE OR REPLACE` would create an ambiguous **overload** and break every live submit the
    moment it applies (one shared Supabase = live in prod instantly). Body mirrors both directions:
    old caller (screenshots only) → derive `attachments`; new caller → mirror image paths into
    `screenshots` **in the legacy `job-files/`-prefixed format (`'job-files/' || path`)** — legacy
    `screenshots` values include the bucket (`TechFeedback.jsx:108`) and the pre-C `AdminFeedback`
    renders them verbatim (`AdminFeedback.jsx:286,296`), so mirroring the bucket-less
    `buildStoragePath` value unprefixed would render broken images during the B-before-C window —
    so the B/C deploy window never breaks rendering. Re-`GRANT EXECUTE` after CREATE.
  - `update_tech_feedback` (same signature → plain OR REPLACE): `resolved_at = now()` on first
    transition into `resolved`/`dismissed`; unchanged on terminal↔terminal; **NULL on reopen**
    (purge can never fire on a reopened item). `attachments_purged_at` is never cleared.
  - `get_tech_feedback`: RETURNS TABLE changes → DROP + CREATE with `attachments`, `source`,
    `resolved_at`, `attachments_purged_at` added (live caller reads named JSON keys — extras ignored).
  - Purge RPCs: `get_purgeable_feedback_media(p_days int DEFAULT 90) RETURNS TABLE(id uuid,
    attachments jsonb)` — eligibility = terminal AND `resolved_at <= now() - make_interval(days =>
    GREATEST(p_days, 30))` AND `attachments_purged_at IS NULL` AND has attachments (**clamp lives
    inside the RPC** — the worker endpoint is unauthenticated by cron convention and must not be
    coaxable into purging fresh files); `mark_feedback_attachments_purged(p_id uuid)`. Both
    SECURITY DEFINER + GRANT (anon-callable = leaks only paths of an already-public bucket — accepted,
    consistent with the table's wide-open RLS).
- **`src/lib/mediaCompress.js`** — pure functions at top (node-testable): `fitWithin(w,h,maxDim=1920)`
  (never upscales), `isImage`/`isVideo`, `sanitizeFilename` (keep `[A-Za-z0-9._-]`, collapse runs,
  cap base ~80 chars, preserve extension), `buildStoragePath(employeeId, filename, ts)` →
  `feedback/{emp}/{ts}-{sanitized}` (bucket-less), `validateFile`, `validateSelection`,
  `checkVideoDuration(seconds, max=90)` (null/NaN duration → ok; size cap still protects),
  `stripBucketPrefix`, and the display formatters `formatBytes(n)` / `formatDuration(seconds)`
  (Session C's admin view imports these — "formatting helpers" in its dispatch block means
  exactly these two); browser section below a SECTION marker: `compressImage(file,{maxDim,quality:0.8})`
  (createImageBitmap → canvas → toBlob jpeg; HEIC/decode failure → original if ≤10MB else throw;
  if compressed ≥ original, return original) and `probeVideo(file)` (`<video preload="metadata">`,
  never rejects, 5s timeout → nulls). Attachment element shape produced:
  `{path, name, mime, size, original_size, width?, height?, duration?}`.
- **`src/components/FeedbackAttachments.jsx`** (composer — complete, frozen in-wave): single hidden
  `<input type="file" accept="image/*,video/*" multiple>`, snap-first immediate upload, per-tile
  state machine picked→compressing/probing→uploading→done|failed(Retry/Remove), remove on a done
  tile = best-effort storage DELETE (fixes Finding 1) then `onChange` without the record, video
  preview tile with duration chip, ≥48px hit areas (old 24px X violated the rule). Contract:
  `value/onChange/onBusyChange/disabled/caps` — parent gates submit on `!uploadsBusy`; failed tiles
  never block submit. Uses `useAuth()` itself (Rule 3). The **admin gallery/viewer is NOT in this
  component** — Session C owns its own viewer (single consumer, no shared seam).
- **Working desktop page** `src/pages/Feedback.jsx` (real form, not a stub — gives the composer an
  in-tree consumer and makes F independently shippable). `App.jsx` route (Layout shell, **no admin
  gate**) + `navItems.jsx` entries (reuse `IconFeedback`) with **`always: true`** — without it,
  `isItemVisible()`/`canAccess()` hides the item from everyone (`navItems.jsx:142`).
- Reserved `src/index.css` section markers appended for Sessions B and C (CRM-wave precedent).
- Doc headers per the Documentation Standard on all new files. The legacy undated
  `tech_feedback.sql` is superseded by the dated migration, never edited.

## Session B — Submit surfaces + notify

> **Branch:** harness-assigned (illustrative: `feedback/phase-b-submit`), cut from `origin/dev`.
> **Prerequisite:** Phase F merged into `dev`. Model: **Opus · medium**.
> **Read scope:** this block + ownership matrix + `CLAUDE.md` + `.claude/rules/tech-mobile-ux.md`.
> **Close-out checklist:**
> - [x] Test-first, now green: `functions/api/feedback-notify.test.js` — pure helpers (admin-id
>       selection excludes submitter; push-payload builder) + injected-fake handler (401 without
>       Bearer; fan-out count; tolerates a 503 from send-push without failing the request). 12 tests.
> - [x] Acceptance: TechFeedback rebuilt on the shared composer (photos + video, compression, caps,
>       real storage DELETE on remove, ≥48px targets, snap-first — no blocking inputs); desktop
>       `Feedback.jsx` polished with `source:'desktop'`; both pages call `feedback-notify`
>       fire-and-forget via `src/lib/api.js` (success toast never depends on it); in-app bell
>       notification arrives on submit; "Improvement" relabel (UI-only — DB keeps `feature`).
> - [x] `npm run test` (388 passed / 68 skipped) + `npm run build` + `npx eslint` (no new errors)
>       pass; **zero schema migrations**; frozen files untouched (composer, mediaCompress, App.jsx,
>       navItems, send-push — call-only).
> - [x] `upr-pattern-checker` clean (one flagged item — pre-existing inline hex in TechFeedback's
>       type selector — fixed by tokenizing to match the sibling desktop page).
> - [~] Visual: desktop `/feedback` + tech `/tech/feedback` — **deferred to the Cloudflare branch
>       preview** (same as Phase F): the container's egress blocks supabase.co and both routes
>       require an authenticated session, so a headless render isn't possible here. Build is green;
>       owner spot-checks the preview (390px tech + desktop).
> - [x] `UPR-Web-Context.md` — filled the pre-labeled **Session B** sub-header only.
> - [x] Reconcile this doc's checkboxes (push-reaches-nobody gate disclosed in the PR + the
>       UPR-Web-Context sub-header); no test rows created (nothing submitted live — the build
>       container can't reach Supabase); PR into `dev` opened as a handoff the owner merges (no
>       babysitting).

Scope: owns `src/pages/tech/TechFeedback.jsx` (rebuild), `src/pages/Feedback.jsx` (polish),
**new** `functions/api/feedback-notify.js` (+ test): POST `{feedback_id}`, requireAuth shape from
`send-push.js`; service-key lookups (feedback row + `employees?role=eq.admin`, excluding the
submitter); channels = `create_notification` RPC (bell) + per-admin same-origin `send-push` POSTs
forwarding the caller's Authorization header (503s reported, never thrown); returns
`{notified, attempted, results}`. Its own reserved index.css section.

## Session C — Owner's media view + retention purge

> **Branch:** harness-assigned (illustrative: `feedback/phase-c-triage`), cut from `origin/dev`.
> **Prerequisite:** Phase F merged into `dev`. Model: **Opus · high** (irreversible storage deletes).
> **Read scope:** this block + ownership matrix + `CLAUDE.md` + `UPR-Design-System.md`.
> **Close-out checklist:**
> - [x] Test-first, now green: `functions/api/purge-feedback-media.test.js` — `stripBucketPrefix`/
>       `collectPaths` (legacy `{path}`-only elements included); injectable `runPurge` with fakes:
>       dry-run marks nothing, delete-failure skips marking (retries next run), not-found counts as
>       success, empty run still writes a `worker_runs` row, orphan sweep only touches
>       `feedback/`-prefix objects unreferenced by any row and >7 days old. **12 tests, committed
>       failing first.**
> - [x] Acceptance: AdminFeedback rebuilt — media gallery renders images (own lightbox) AND videos
>       (`<video controls preload="metadata">`), per-file name/size + "10.4 MB → 0.8 MB" when
>       `original_size` present, source badge (tech/desktop), purged state ("attachments purged"
>       on reopened items — files never come back), **per-row draft notes** (Finding 2 dead),
>       filters, two-click inline manual purge (per-item + "purge all eligible") working with zero
>       cron. Worker retention query verified **live via MCP** (`get_purgeable_feedback_media`
>       clamp: `days=0/1/90` → 0 purgeable). **Owner-gated:** hitting the deployed
>       `GET /api/purge-feedback-media?dry_run=1` needs the branch preview (the build container's
>       egress blocks supabase.co) — run the dry-run there before any real pass.
> - [x] `npm run test` (388 passed / 68 skipped) + `npm run build` + `npx eslint` (no new errors)
>       pass; **zero schema migrations**; frozen files untouched.
> - [x] `upr-pattern-checker` clean — 2 Rule-3 hex flags: the new `.fb-purge-btn[data-armed]`
>       armed-red converted to `var(--status-paused-*)`; the `TYPE_BADGE`/`STATUS_BADGE` palette
>       objects are inherited verbatim from the pre-rebuild file (no exact 1:1 token for every
>       badge, e.g. `resolved`) and left as-is (not new debt).
> - [ ] Visual: `/tech-feedback` on the branch preview with a seeded image+video test row.
>       **Preview-gated** — deferred to the branch preview (no headless browser reach to live
>       Storage to upload a real image+video row). Recommended owner spot-check post-merge.
> - [x] `UPR-Web-Context.md` — filled the pre-labeled **Session C** sub-header only.
> - [x] Reconcile this doc's checkboxes (cron trigger disclosed as owner-gated in the PR); no test
>       rows/objects were seeded (headless egress blocks Storage upload), so nothing to delete;
>       pushed; PR into `dev` opened as a handoff the owner merges (no babysitting).

Scope: owns `src/pages/AdminFeedback.jsx` (rebuild; builds its **own** viewer/lightbox — do NOT
edit tech-scoped `src/components/tech/Lightbox.jsx`, img-only and shared by 5 tech screens),
**new** `functions/api/purge-feedback-media.js` (+ test): GET, no auth (cron convention — the
RPC's ≥30-day clamp is the guardrail), service-key bulk delete `{prefixes:[…]}` per row, marks via
`mark_feedback_attachments_purged` only on success/not-found, `worker_runs` row always, `dry_run`
param, orphan sweep (Finding 1); `src/pages/DevTools.jsx:702` WORKER_NAMES entry
(`'purge-feedback-media'`). Its own reserved index.css section. Manual purge in the UI uses the
anon-key per-object DELETE pattern (`JobPage.jsx:801`) + the mark RPC.

---

## Dependency graph

```
plan-of-record PR (this doc) merged into dev
        │
        ▼
   Phase F ── hard artifact edge ──► Session B ─┐
        │                                        ├─ one parallel wave (proven disjoint)
        └───── hard artifact edge ──► Session C ─┘

anytime lane (owner actions — hard gates, not built on hope; no wave slot):
  · APNS env vars + iOS device-token registration  → makes B's push fan-out actually deliver
  · point external cron (process-scheduled mechanism) at /api/purge-feedback-media → auto-purge
    (manual purge button works from C's merge, day 1)
  · optional: dedicated feedback bucket w/ MIME allowlist via dashboard
```

Edge types: F→B and F→C are **hard artifact edges** (composer, migration, wiring). B↔C:
**independent** (disjointness proven — see ownership). The anytime-lane items are
**externally-gated** and block nothing in-wave.

## Dispatch model

- **Wave 0** = Phase F alone (it owns 100% of the schema and every shared seam).
- **Wave 1** = Sessions B and C, launchable **simultaneously** once F merges into `dev`. Merge
  order within the wave is a preference, never a gate — each PR is independent. Throttle freely:
  running B and C serially (or handing both to one session back-to-back) is equally valid; the
  disjointness that makes them parallel-safe makes them serial-safe.
- **How work lands (per CLAUDE.md Rule 4):** these are concurrent sessions, which qualify for the
  branch-isolation exception — each session works on its harness-assigned branch and opens a
  **PR into `dev` as a handoff, then stops** (owner merges; no click-merge, no subscribing, no
  babysitting). Copy-paste session prompts: `docs/feedback-media-dispatch.md`.
- **No feature flag** (decision on record): this upgrades an already-live internal surface that is
  all-employees-by-design; production exposure is still gated by the reviewed `dev → main` PR.
- **Progress tracking:** non-CRM initiative → tracked via THIS doc's phase checklists (the CRM
  tracker is not used; no generic tracker exists).

## Ownership matrix & frozen list (authoritative for the wave — no separate manifest file;
a 3-session initiative doesn't earn `.claude/rules/` ceremony, per the adjudicated challenge pass)

| Session | Owns exclusively (edit only these) | New files it creates |
|---|---|---|
| F | migration `20260702_feedback_media.sql`, `src/lib/mediaCompress.js` (+test), `src/components/FeedbackAttachments.jsx`, `src/pages/Feedback.jsx`, `src/App.jsx` (route only), `src/lib/navItems.jsx` (entry only), index.css reserved markers, `supabase/tests/feedback_media_schema.test.js`, UPR-Web-Context "Feedback Media" section seed | all of the former |
| B | `src/pages/tech/TechFeedback.jsx`, `src/pages/Feedback.jsx` (polish), its index.css section, its UPR-Web-Context sub-header | `functions/api/feedback-notify.js` (+test) |
| C | `src/pages/AdminFeedback.jsx`, `src/pages/DevTools.jsx` (WORKER_NAMES line), its index.css section, its UPR-Web-Context sub-header | `functions/api/purge-feedback-media.js` (+test) |

**Frozen in-wave (nobody edits after F ships):** the migration, `mediaCompress.js`,
`FeedbackAttachments.jsx`, `App.jsx`, `navItems.jsx`, `functions/api/send-push.js` (B calls it,
never edits), `functions/lib/*`, `src/components/tech/Lightbox.jsx`. Shared-table writes
(`tech_feedback`, `worker_runs`, `notifications`) are DATA only. **Zero schema migrations outside
F.** If a wave session finds a genuinely missing column: stop and flag for a separate reviewed
change — never ALTER a live table in-wave.

**What resisted maximum parallelism (honest record):** ① `UPR-Web-Context.md` is co-edited by B
and C — mitigated by F seeding pre-labeled sub-headers, accepted as a soft collision the owner's
serial merges absorb. ② `get_tech_feedback`'s new return columns ship in F while their only
consumer upgrades in C — safe because the live caller ignores extra JSON keys (verified), and the
insert RPC's two-way mirror keeps the old renderer working through the whole window. ③ Push
delivery and auto-purge cron are owner-gated external actions (anytime lane) — both built
degrade-gracefully so nothing in-wave waits on them. ④ F is a single point of failure for the
wave — priced in via Opus·high, the committed old-signature test, and applying the migration only
after its test is green on `dev`. ⑤ The composer being frozen means a gap discovered by B
requires a flag-and-wait, not a hotfix — accepted; F ships it with a real consumer (the desktop
page) to de-risk exactly this.
