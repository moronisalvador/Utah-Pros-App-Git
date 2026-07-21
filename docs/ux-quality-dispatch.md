# UX Quality — Dispatch Blocks

Copy-paste launch blocks for the UX Quality initiative. Plan of record:
[`docs/ux-quality-roadmap.md`](ux-quality-roadmap.md). Ownership:
[`.claude/rules/ux-alignment-wave-ownership.md`](../.claude/rules/ux-alignment-wave-ownership.md).

**Preconditions:** Phase 0 + F-S1 (this planning session) must merge to `dev` first — they install the
hardening patches and the standards/enforcement every later session reads. Then **F-S2 ∥ F-B** launch
(disjoint files). Then **W1–W5** once F-S2 (and, for W2/W5, F-B) merge. **W4 after W3.**

**Base Preflight (MANDATORY — first action of every session below):** the harness may start your
container from `main` or a stale commit, NOT the `dev` tip that carries this plan. So:
```
git fetch origin dev && git checkout -B "$(git branch --show-current)" origin/dev
```
Then verify these are on disk: `docs/ux-quality-roadmap.md`, `.claude/rules/ux-alignment-wave-ownership.md`,
`.claude/rules/{page-lifecycle,loading-error-states,perf-budget,close-out-standard,workers-standard}.md`,
`.claude/agents/{design-consistency-checker,page-behavior-checker}.md`. **If any are missing, your base
is wrong — STOP and re-sync; never recreate them.** Plan docs are CONSUMED, never re-authored.

Every block ends the same way: **close out per `.claude/rules/close-out-standard.md`, open a PR into
`dev` as a handoff, and STOP.** Do not subscribe to / babysit / click-merge your PR.

---

## [Session F-S2 — Wave 1] Primitives & tokens foundation
- **Branch:** session-assigned · **Model:** Opus · **Effort:** high · **Launch after:** F-S1 merged

```
You are building ONE phase of the UX Quality initiative: the shared UI primitives + design tokens that
every alignment session will import. No page behavior changes, no feature code. Do the Base Preflight
(docs/ux-quality-dispatch.md) first.

Read: CLAUDE.md; docs/ux-quality-roadmap.md (F-S2 block); .claude/rules/ux-alignment-wave-ownership.md;
.claude/rules/{loading-error-states,page-lifecycle,perf-budget,motion-standard}.md; UPR-Design-System.md.

Build (riskiest/most-depended-on first):
1. src/index.css :root — add the semantic token family, values MINTED FROM the dominant in-code hex
   (grep the status triplets first; do not invent colors): --success/-bg/-border, --danger-*, --warning-*,
   --info-*, --neutral-*; each with a dark-theme override in the existing theme block. Verify against
   ThemeProvider that both themes resolve.
2. Shared primitives in src/components/ui/: Modal (role=dialog, focus trap, ESC/overlay close, mobile
   bottom-sheet via @media max-width:768px), StatusPill(status), EmptyState(icon,title,sub,action?),
   ErrorState(message,onRetry) [copy the shape from TechJobDetail.jsx:330], PageHeader, SearchInput,
   IconButton(label required). Each with a Documentation Standard header and a render/interaction test.
3. Shared hooks in src/hooks/: useResumeRefetch({onResume,onFocus,pollMs,hiddenEdgeOnly}) [behavior =
   Conversations.jsx:475-489 edge-detection + usePolledRpc.js:58-84 hidden-pause; silent + cancel-guarded],
   useTwoClickConfirm, useLookup (react-query wrapper for employees/job_phases/carriers), usePhotoUpload
   + thumbUrl (storage render transform URLs + mediaCompress on the upload path).
4. Motion, interactions & haptics (.claude/rules/motion-standard.md): add the motion tokens to :root
   (durations + easings; migrate the raw --transition-* and hardcoded 0.1s/200ms sites; de-dup the
   fadeIn/sheetSlideUp keyframes). Wire the native View Transitions API for page enter/back
   (@view-transition{navigation:auto} + the RRv7 viewTransition prop; app shell = persistent transition
   name so only content animates; retire the 4 ad-hoc `entering` patterns). Standardize the interaction
   idioms: button press feedback (scale(0.97)+touch-action, promote from .tech-layout .btn to the shared
   button); animated selection indicators for tabs/segments/chips/toggles (kill the snaps incl.
   TechDemoSheet's inline tech-select); chat sent/received bubble motion (author now; the shared
   Conversations/MessageBubble is sms-experience-owned → implement at the W6 fold-in). Pair native
   haptics via src/lib/nativeHaptics.js (impact('light') press/send, selection() selection changes) —
   import-only, no dep. Wrap EVERYTHING in a prefers-reduced-motion fallback (nothing auto-skips) +
   suppress haptics under it. transform/opacity only, refresh-rate-agnostic (no >60fps dependency),
   never gate a spinner, never refetch on transition.
5. Rewrite UPR-Design-System.md: DELETE the inline-hex Status Color Palette recipe; every pattern
   section shows a component IMPORT not a style object; add the Kit Registry, the dark-theme contract
   (components consume color ONLY via var()), the **Motion section = the one tunable catalog** (page
   transition + per-primitive motion, each naming its tokens), the typography floor (11px absolute / 12px
   actionable on tech), and regenerate the division/status tables FROM code (DivisionIcons.jsx = division
   source, index.css = status source). Per-section Last-verified stamps.

Test-first: a render+interaction test per primitive (Modal focus-trap/ESC; StatusPill token class;
ErrorState onRetry; useResumeRefetch fires silently on hidden→visible only). Do NOT migrate call sites
(that is W1–W3) — ship the primitives + docs only, so the wave has a stable contract to import.

Close out per close-out-standard.md (incl. the 390px check on the primitives' demo states). PR into dev, STOP.
```

## [Session F-B — Wave 1] Backend foundation
- **Branch:** session-assigned · **Model:** Opus · **Effort:** high · **Launch after:** F-S1 merged (∥ F-S2)

```
You are building ONE phase of the UX Quality initiative: the workers-layer foundation + the transactional
RPCs the client fixes depend on. Base Preflight first.

Read: CLAUDE.md; docs/ux-quality-roadmap.md (F-B block); .claude/rules/{workers-standard,database-standard}.md;
the ownership manifest; the db-migration skill.

Build (riskiest first — migrations before lib sweeps):
1. RPCs (db-migration discipline — additive, RLS/grants, rollback note, test-first): sync_appointment_crew(
   p_appointment_id, p_crew jsonb) [atomic replace of appointment_crew — kills the delete-then-loop in the
   3 call sites]; save_estimate_lines(p_id, p_lines jsonb) [both editors]; get_jobs_list(p_search, p_limit,
   p_offset) [trimmed columns, server-side search — replaces the ~50-col unbounded Jobs/Production query].
2. functions/lib/auth.js: requireUser / requireEmployee / requireRole / checkCronSecret (move
   getActorEmployee out of google-drive.js). Delete the 14 local requireAuth copies + ~20 inline verifies.
3. functions/lib/http.js: fetchWithTimeout (AbortSignal.timeout, 15s default); adopt inside
   twilio/quickbooks/email/callrail libs so workers inherit it.
4. functions/lib/worker-runs.js: recordWorkerRun/withRunRecording; migrate the 31 hand-rolled worker_runs
   inserts.
5. Money-worker tests: qbo-payment.js + stripe-webhook.js minimum (auth gate present, idempotency, never
   write trigger-owned columns) — qbo-invoice.test.js is the template.
6. Extend useOfflineQueue with note.insert + task.toggle types.

Frozen contracts: keep send-message's {success} response shape; keep the 7/7 webhook claim-RPC idempotency.
Apply + verify the 3 RPCs live via MCP within a low-traffic window. Close out per close-out-standard.md.
PR into dev, STOP.
```

## [Session W1 — Wave 2] Tech legacy behavior + dark mode
- **Branch:** session-assigned · **Model:** Opus · **Effort:** medium · **Launch after:** F-S2 merged

```
Base Preflight first. Read: CLAUDE.md; docs/ux-quality-roadmap.md (W1); .claude/rules/{page-lifecycle,
loading-error-states,tech-mobile-ux,perf-budget}.md; UPR-Design-System.md; the ownership manifest.
Foundation shipped: the ui/ primitives, :root tokens, useResumeRefetch, usePhotoUpload/thumbUrl.

Owned files ONLY (the 9 legacy tech pages + TechLayout toast + tech dark overrides). TechAppointment gets
BEHAVIOR/dark/tap-target fixes ONLY — no restyle (Job Hub H3 retires it).
Build: (1) delete setLoading(true) from load() on the 9 PTR-blanking pages (TechAppointment's load is the
template — loading starts true, only ever set false). (2) TechAppointment: .btn-sm → 48px tech buttons,
status pill from --status-* tokens, safe-area fix, action labels 10px→12px, loading=lazy on the photo grid.
(3) Dark sweep: TechLayout toast → token classes FIRST (fixes all 22 pages), then techConstants color maps
and the ~297 tech hex → var(--status-*). (4) usePhotoUpload + compression on the 8 copy sites.
Gauntlet MUST include page-behavior-checker + design-consistency-checker + the minimize/resume test on a
tech page + the 390px check. PR into dev, STOP.
```

## [Session W2 — Wave 2] Desktop behavior alignment
- **Branch:** session-assigned · **Model:** Opus · **Effort:** medium · **Launch after:** F-S2 merged (F-B for get_jobs_list)

```
Base Preflight first. Read: CLAUDE.md; docs/ux-quality-roadmap.md (W2); .claude/rules/{page-lifecycle,
loading-error-states}.md; the ownership manifest. Foundation shipped ErrorState + useResumeRefetch.
Owned: Schedule (behavior only — NOT restyle/restructure, that is Schedule Desktop), ClaimPage, JobPage,
CustomerPage, the failure→empty-state list pages, ClaimsList, Collections.
Build: point Schedule's 6 modal/panel callbacks at the existing silentReloadBoard; add an error branch to
loadBoard failure (keep stale rows + banner); ClaimPage add-job/merge callbacks → {silent} load;
JobPage/CustomerPage → ErrorState+Retry; ErrorState on the Estimates/Customers/Leads/Marketing/TechTasks/
TechClaims failure→empty-state paths; ClaimsList:269 window.location.href → navigate(); Collections tabs
kept mounted with hidden; useResumeRefetch migration of the 8 hand-rolled handlers; document.hidden guards
on the 4 unguarded polls (StatusBoard stops toasting on its silent poll); git rm Estimates.jsx,
ClaimPage_header.jsx, nativeUpdater.js. Gauntlet + minimize/resume test + 390px check. PR into dev, STOP.
```

## [Session W3 — Wave 2] Component & toast adoption codemods
- **Branch:** session-assigned · **Model:** Opus · **Effort:** medium · **Launch after:** F-S2 merged

```
Base Preflight first. Read: CLAUDE.md; docs/ux-quality-roadmap.md (W3); UPR-Design-System.md; the
ownership manifest. This is MECHANICAL migration to F-S2 primitives — zero visual redesign, so it cannot
conflict with the owner's future restyle. You OWN the cross-cutting sweeps (no other wave edits these lines).
Build: toast codemod (22 local errToast + 125 raw upr:toast dispatches → src/lib/toast err()/ok(); then
the eslint rule flips to error); StatusPill migration (158 inline pills + 7 local triplet maps); Modal
migration (33 inline position:fixed overlays + conv-modal); icon consolidation (one Icons.jsx; 13
magnifier + 36 chevron copies); SearchInput (6 impls); formatter adoption (format.js absorbs 44 locals,
phone formatters first); useTwoClickConfirm (26 sites). Keep each codemod a separate commit. Verify no
visual diff on 5 sample pages (before/after screenshots at 390px + desktop). PR into dev, STOP.
```

## [Session W4 — Wave 2] A11y & i18n
- **Branch:** session-assigned · **Model:** Opus · **Effort:** medium · **Launch after:** W3 merged

```
Base Preflight first. Read: CLAUDE.md; docs/ux-quality-roadmap.md (W4); tech-mobile-ux.md; the ownership
manifest. Rides W3's primitives (IconButton brings the label, Field brings htmlFor).
Build: IconButton labels on the 108 unnamed icon buttons (two-click deletes + TechAppointment header
first); Field/htmlFor on the top tech create/edit forms; tech i18n namespaces for the 8 English-only pages
+ 5 field sheets (~310 strings; sheets first — ReadingEntry/EquipmentPlacement/PhotoNote; TechDemoSheet
last; parity test en/es/pt); html lang sync one-liner in src/i18n/index.js; useKeyboardInset on the 3
fixed bottom sheets. Record: desktop = English-only by design; admin-mobile English-only until a
non-English admin exists. PR into dev, STOP.
```

## [Session W5 — Wave 2] Boot & data performance
- **Branch:** session-assigned · **Model:** Opus · **Effort:** medium · **Launch after:** F-S2 merged. SW item: OWNER OK required.

```
Base Preflight first. Read: CLAUDE.md; docs/ux-quality-roadmap.md (W5); .claude/rules/perf-budget.md; the
ownership manifest. Governed by the perf budget (entry ≤232KB gzip, fail at +10%).
Build: self-host subsetted Inter (500/600/700 woff2, replace the 2 render-blocking Google Fonts links);
Public Sans scoped to the CRM chunk; lazy pt/es locales (i18n chunk, ~34KB gz); useMemo the AuthContext
value object; useLookup rollout to the 14 employees-roster sites + 3 job_phases sites; Jobs/Production onto
get_jobs_list (F-B). Record top-5 chunk deltas from npm run build in the PR.
OWNER-GATED (RED — do NOT build without explicit owner OK in the PR thread): precache-only service worker
— assets-only, content-type-verified cache.put, network-only navigations, behind a feature flag with the
existing /reset escape hatch preserved. If not OK'd, ship everything else and note the SW as deferred.
PR into dev, STOP.
```
