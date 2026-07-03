# Feedback Media — Session Dispatch Blocks

Copy-paste blocks below are complete, self-contained prompts for cold sessions with zero history.
Claude Code web hands each session a harness-assigned `claude/…` branch — the `Branch:` line in
each header is illustrative for humans; sessions use whatever branch they're given. Where a block
cites Phase F artifact names, the ownership matrix + phase blocks in
`docs/feedback-media-roadmap.md` are authoritative if names drift.

**How work lands (per CLAUDE.md Rule 4):** these are concurrent sessions — the branch-isolation
exception applies. Each session builds on its assigned branch and ends by opening a **PR into
`dev` as a handoff, then stopping**. The owner merges; sessions never click-merge, subscribe to,
babysit, or wait for a review on their PR.

**Preconditions:** Wave 0 (Session F) launches once the feedback-media plan-of-record PR is merged
into `dev`. Wave 1 (Sessions B and C, simultaneously or in either order — throttle freely) launches
once Session F's PR is merged into `dev`. Owner actions due **anytime, gating nothing in-wave**:
① configure `APNS_*` env vars in Cloudflare (both env sets) + get iOS devices registering
`device_tokens` rows — until then B's push fan-out is a disclosed no-op (the in-app bell channel
works regardless); ② after C merges, point the external cron mechanism (same one that drives
`process-scheduled`) at `GET /api/purge-feedback-media` — until then the manual purge button in
the admin inbox is the trigger; ③ optional: create a dedicated feedback bucket with a MIME
allowlist via the Supabase dashboard (SQL migrations cannot — `storage.*` is owned by
`supabase_storage_admin`).

---

## Wave 0 — Session F launches alone

```
[Session F — Wave 0]
Branch: session-assigned (illustrative: feedback/phase-f-foundation), cut from origin/dev
Model: Opus 4.8 (or strongest available)
Effort: High
Launch after: feedback-media plan-of-record PR merged into dev

You are building Phase F (Foundation) of the Feedback Media initiative — one phase only, no scope
creep. Read scope: CLAUDE.md, the "Phase F — Foundation" block plus the ownership matrix in
docs/feedback-media-roadmap.md (binding), .claude/rules/tech-mobile-ux.md, and
.claude/rules/documentation-standard.md. Work on your session's assigned branch cut from
origin/dev. Context: tech_feedback exists (undated migration supabase/migrations/tech_feedback.sql
— supersede via a dated migration, never edit it) with screenshots jsonb as bare path strings;
TechFeedback.jsx/AdminFeedback.jsx are live pages other sessions will rebuild — do NOT edit either.
Build riskiest-first: (1) supabase/tests/feedback_media_schema.test.js committed failing, then the
migration supabase/migrations/20260702_feedback_media.sql in ONE transaction: ADD COLUMNS
attachments jsonb NOT NULL DEFAULT '[]' / source text NOT NULL DEFAULT 'tech' CHECK
(source IN ('tech','desktop')) / resolved_at timestamptz / attachments_purged_at timestamptz;
backfill attachments from screenshots ({path}-only elements) and resolved_at=now() for
already-terminal rows; then the RPC cutover — CRITICAL: DROP FUNCTION
insert_tech_feedback(uuid,text,text,text,jsonb) and CREATE the 7-arg version (+p_attachments
jsonb DEFAULT '[]', p_source text DEFAULT 'tech') because CREATE OR REPLACE would create an
ambiguous overload that breaks every live submit instantly on the one shared Supabase; the body
mirrors both directions (screenshots→attachments for old callers, image attachments→screenshots
for new callers) so later deploy order never breaks rendering; re-GRANT EXECUTE after every
DROP+CREATE; update_tech_feedback keeps its signature (plain OR REPLACE) and stamps resolved_at
on first transition into resolved/dismissed, keeps it terminal↔terminal, NULLs it on reopen, and
never clears attachments_purged_at; get_tech_feedback is DROP+CREATE with attachments/source/
resolved_at/attachments_purged_at added to the RETURNS TABLE (live caller ignores extra JSON
keys); add get_purgeable_feedback_media(p_days int DEFAULT 90) with the eligibility clamp
GREATEST(p_days,30) INSIDE the RPC (the future purge endpoint is unauthenticated by cron
convention) and mark_feedback_attachments_purged(p_id uuid), both SECURITY DEFINER + GRANT anon,
authenticated. Apply via Supabase MCP apply_migration, run bust_postgrest_cache(), and verify the
OLD 5-arg insert call still succeeds through PostgREST (that test proves no overload). (2)
src/lib/mediaCompress.js with pure functions at top (node-testable: fitWithin never upscales,
sanitizeFilename, buildStoragePath returning feedback/{employeeId}/{ts}-{sanitized} bucket-less,
validateFile, validateSelection, checkVideoDuration max 90s tolerating null durations,
stripBucketPrefix, isImage/isVideo) and browser functions below a SECTION marker (compressImage:
createImageBitmap→canvas→toBlob('image/jpeg', 0.8) capped at 1920px long edge, HEIC/decode
failure falls back to the original if ≤10MB else throws, and never returns a blob larger than the
original; probeVideo: <video preload="metadata">, never rejects, 5s timeout → nulls); caps as
exported constants: 5 files total, 1 video, video ≤90s, image input ≤25MB, video ≤50MB; committed
unit tests src/lib/mediaCompress.test.js for every pure function. (3)
src/components/FeedbackAttachments.jsx — the shared composer, built COMPLETE (it is frozen for
the wave): single hidden <input type="file" accept="image/*,video/*" multiple>, snap-first
immediate upload on pick to POST ${db.baseUrl}/storage/v1/object/job-files/{buildStoragePath(...)}
with Bearer db.apiKey and Content-Type of the blob, per-tile state machine
picked→compressing/probing→uploading→done|failed with Retry, remove on a done tile does a
best-effort storage DELETE before onChange (this fixes a live orphaning bug), video tiles show a
duration chip, all hit areas ≥48px, records shaped
{path,name,mime,size,original_size,width?,height?,duration?}; contract:
value/onChange/onBusyChange/disabled/caps, and it calls useAuth() itself for db+employee (Rule 3
— never import db from @/lib/supabase). Do NOT build an admin gallery/viewer in it — Session C
owns that. (4) src/pages/Feedback.jsx as a WORKING desktop form (not a stub): type selector
(Bug Report / Improvement), title, description, FeedbackAttachments, submit via
db.rpc('insert_tech_feedback', {...}) with p_source:'desktop' and p_attachments; route it in
App.jsx inside the authenticated Layout shell with NO admin gate, and add navItems.jsx entries
reusing IconFeedback with always: true (without always:true, isItemVisible/canAccess hides the
item from everyone — verified trap). (5) Append two reserved section markers at the bottom of
src/index.css (/* ─── FEEDBACK MEDIA RESERVED — Session B ─── */ and the same for Session C);
put F's own styles above them in its own marked block. (6) Documentation Standard headers on
every new file. Hard constraints: additive-only migration, no edits to TechFeedback.jsx /
AdminFeedback.jsx / functions/*, no feature flag, no alert()/confirm() (toast + inline two-click
confirm patterns only), mobile CSS only inside @media (max-width: 768px). Close-out: npm run
test + npm run build + npx eslint (no new errors) pass; migration-safety-checker +
upr-pattern-checker clean; visual check of /feedback on the branch preview at desktop and 768px;
update UPR-Web-Context.md with a "Feedback Media" section seeded with pre-labeled Session B and
Session C sub-headers; reconcile the Phase F checkboxes in docs/feedback-media-roadmap.md
honestly (no marking done what isn't, no leaving done work unticked); delete any test rows;
commit in small steps, push -u, open a PR into dev via the template, mark it ready to merge, then
stop — the PR is a handoff the owner merges; do NOT subscribe to, babysit, or wait for a review
on it.
```

---

## Wave 1 — Sessions B and C may launch simultaneously once Session F is merged into dev

```
[Session B — Wave 1]
Branch: session-assigned (illustrative: feedback/phase-b-submit), cut from origin/dev
Model: Opus 4.8
Effort: Medium
Launch after: Session F merged into dev

You are building Session B (submit surfaces + notify) of the Feedback Media initiative — one
phase only, no scope creep. Read scope: CLAUDE.md, the "Session B" block plus the ownership
matrix in docs/feedback-media-roadmap.md (binding), and .claude/rules/tech-mobile-ux.md. Work on
your session's assigned branch cut from origin/dev. Foundation shipped: the
20260702_feedback_media migration (7-arg insert_tech_feedback with p_attachments/p_source,
resolved_at semantics, purge RPCs), src/lib/mediaCompress.js (compression + caps + path helpers),
the complete shared composer src/components/FeedbackAttachments.jsx, a working desktop
src/pages/Feedback.jsx wired at /feedback, and reserved index.css markers — the roadmap's
ownership matrix is authoritative if any name drifted. Hard constraints: ZERO schema migrations;
you edit ONLY src/pages/tech/TechFeedback.jsx, src/pages/Feedback.jsx (polish), your new
functions/api/feedback-notify.js (+ its test), your reserved index.css section, and your
pre-labeled Session B sub-header in UPR-Web-Context.md; frozen for you: FeedbackAttachments.jsx,
mediaCompress.js, App.jsx, navItems.jsx, functions/lib/*, and functions/api/send-push.js (call
it, never edit it); no alert()/confirm(); db comes from useAuth() only. Test-first (commit
failing first): functions/api/feedback-notify.test.js — pure helpers (admin-id selection from
employees with role=admin excluding the submitter; push-payload builder) plus an
injected-fake handler test proving 401 without a Bearer token, correct fan-out count, and that a
503 from send-push (APNs unconfigured) is reported without failing the request. Build: (1)
functions/api/feedback-notify.js — POST {feedback_id}, requireAuth in the exact shape of
send-push.js, service-key client from functions/lib/supabase.js to load the feedback row +
submitter name + admin ids, then two channels: db.rpc('create_notification', ...) for the in-app
bell (works today; the feed is global — everyone sees it, that's accepted and disclosed) and one
same-origin POST to /api/send-push per admin forwarding the caller's Authorization header with
title like "New bug report"/"New improvement idea", body "{submitter}: {title}", data
{feedback_id, route:'/tech-feedback'}; return {notified, attempted, results}; CORS via
functions/lib/cors.js. (2) Rebuild TechFeedback.jsx on the shared composer per tech-mobile-ux:
photos + video through FeedbackAttachments (compression and caps come free), storage DELETE on
remove now real, ≥48px targets throughout, snap-first with no blocking inputs, relabel the
'feature' type as "Improvement" in the UI only (the DB CHECK keeps 'bug'/'feature'), submit
passes p_attachments + p_source:'tech'. (3) Polish Feedback.jsx (desktop) to match, keeping
p_source:'desktop'. (4) Both pages call feedback-notify strictly fire-and-forget after the
insert RPC succeeds, via the src/lib/api.js helper (it attaches the user Bearer token) with a
swallowed catch — the success toast must never depend on it. Disclose in your PR and in your
UPR-Web-Context sub-header that push delivery reaches nobody until the owner configures APNS env
vars and iOS devices register device_tokens rows (0 rows exist today); the bell channel is the
one that works now. Close-out: npm run test + npm run build + npx eslint (no new errors) pass;
upr-pattern-checker clean; visual check of the tech form at 390px and the desktop form on the
branch preview; update your UPR-Web-Context.md sub-header only; reconcile the Session B
checkboxes in docs/feedback-media-roadmap.md honestly; delete any test feedback rows and their
storage objects; commit in small steps, push -u, open a PR into dev via the template, mark it
ready to merge, then stop — the PR is a handoff the owner merges; do NOT subscribe to, babysit,
or wait for a review on it.
```

```
[Session C — Wave 1]
Branch: session-assigned (illustrative: feedback/phase-c-triage), cut from origin/dev
Model: Opus 4.8
Effort: High
Launch after: Session F merged into dev (independent of Session B — either order)

You are building Session C (the owner's media view + retention purge) of the Feedback Media
initiative — one phase only, no scope creep. Read scope: CLAUDE.md, the "Session C" block plus
the ownership matrix in docs/feedback-media-roadmap.md (binding), and UPR-Design-System.md. Work
on your session's assigned branch cut from origin/dev. Foundation shipped: the
20260702_feedback_media migration (get_tech_feedback now returns attachments/source/resolved_at/
attachments_purged_at; get_purgeable_feedback_media(p_days) with a ≥30-day clamp inside;
mark_feedback_attachments_purged), src/lib/mediaCompress.js (import stripBucketPrefix and
formatting helpers from it), and reserved index.css markers — the roadmap's ownership matrix is
authoritative if any name drifted. Hard constraints: ZERO schema migrations; you edit ONLY
src/pages/AdminFeedback.jsx, your new functions/api/purge-feedback-media.js (+ its test), the
WORKER_NAMES array in src/pages/DevTools.jsx (~line 702, add 'purge-feedback-media'), your
reserved index.css section, and your pre-labeled Session C sub-header in UPR-Web-Context.md;
frozen for you: FeedbackAttachments.jsx, mediaCompress.js, App.jsx, navItems.jsx,
functions/lib/*, and src/components/tech/Lightbox.jsx (img-only, shared by five tech screens —
build your own viewer inside AdminFeedback instead); no alert()/confirm() — destructive actions
use the inline two-click confirm pattern; db comes from useAuth() only. Test-first (commit
failing first): functions/api/purge-feedback-media.test.js — stripBucketPrefix/collectPaths
handle legacy {path}-only attachment elements; an injectable runPurge(db, storageDelete, opts)
driven with fakes proving dry_run marks nothing, a delete transport-error skips marking (so the
row retries next run), storage not-found counts as success, an empty run still writes a
worker_runs row, and the orphan sweep only touches feedback/-prefix objects unreferenced by any
tech_feedback row and older than 7 days. Build riskiest-first: (1)
functions/api/purge-feedback-media.js — GET /api/purge-feedback-media?days=90&dry_run=1, no auth
(matches the process-scheduled cron convention; the RPC's GREATEST(p_days,30) clamp is the
guardrail), service-key client from functions/lib/supabase.js, rpc get_purgeable_feedback_media,
per row bulk-delete DELETE ${SUPABASE_URL}/storage/v1/object/job-files with body
{prefixes:[paths minus the job-files/ prefix]}, mark via mark_feedback_attachments_purged only on
success or not-found, collect errors without throwing, always insert a worker_runs row
(worker_name 'purge-feedback-media', status completed/error, records_processed, error_message,
started_at, completed_at), plus the orphan sweep above, returning {ok, checked, purged,
files_deleted, errors, dry_run}. Run it live with dry_run=1 to verify before any real pass. (2)
Rebuild AdminFeedback.jsx: media gallery from the attachments jsonb (fall back to legacy
screenshots when attachments is empty) rendering images with a lightbox and videos with <video
controls preload="metadata">, per-file name + size and a "10.4 MB → 0.8 MB" compression note when
original_size is present, a source badge (tech app / desktop), a purged state showing
"attachments purged" (including on reopened items — the files never come back), per-row draft
note state so editing one row's admin notes can never save into another row (the current shared
noteText state is a known bug you are killing), type/status filters, the "Improvement" label for
type 'feature', and a two-click inline manual purge (per-item and a "purge all eligible" sweep)
that uses the anon-key per-object DELETE pattern from JobPage.jsx:801 followed by
db.rpc('mark_feedback_attachments_purged'). Disclose in your PR that automatic scheduling is an
owner action (point the external cron that drives process-scheduled at the endpoint) and that the
manual button is the day-1 trigger. Close-out: npm run test + npm run build + npx eslint (no new
errors) pass; upr-pattern-checker clean; visual check of /tech-feedback on the branch preview
with a seeded image+video test row (then delete it and its storage objects); update your
UPR-Web-Context.md sub-header only; reconcile the Session C checkboxes in
docs/feedback-media-roadmap.md honestly (owner-gated cron stays open with the reason stated);
commit in small steps, push -u, open a PR into dev via the template, mark it ready to merge, then
stop — the PR is a handoff the owner merges; do NOT subscribe to, babysit, or wait for a review
on it.
```
