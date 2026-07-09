# Tech Messages v2 — dedicated field-tech messaging pane (Roadmap, 2026-07-09)

Produced by the tech-messages-v2 masterplan session (6-agent live-verified audit + 6-agent
adversarial challenge pass, ALL verdicts MODIFIED / none REFUTED — outcomes folded in; see
the Challenge Report at the bottom). **This is the dispatch model of record.** Companions:
`docs/tech-messages-v2-dispatch.md` (cold-session launch blocks) and
`.claude/rules/tech-messages-v2-wave-ownership.md` (binding ownership manifest). Non-CRM
initiative → progress tracked by the per-phase checklists in THIS doc. All facts below were
verified live (Supabase `glsmljpabrwonfiltiqm`) or by file reads at dev tip `8b43094` —
never assumed from docs or memory.

## Context & goal

`/tech/conversations` mounts the SHARED desktop-first `src/pages/Conversations.jsx`
(1,333 lines; **three mounts**: `/conversations` App.jsx:343, `/tech/conversations`
App.jsx:280, CRM via `CrmConversations`) inside TechLayout's pathname-keyed `<Outlet/>`.
Owner verdict on the tech mount: "sucks, not polished, doesn't feel/look like Native iOS."
Goal: a dedicated **keep-alive tech-v2 pane** behind `page:tech_msgs_v2` — the exact
machine that rebuilt Schedule — that mounts once, never remounts on tab switch, paints
instantly from cache, and treats list↔thread as a native in-pane switch. The shared
`Conversations.jsx` is **never edited** and keeps serving web + CRM.

**Live scale (2026-07-09):** 5 conversations, 1 message total, 0 unread, 0 assigned,
5 participants. Production messaging is near-empty — scale behavior is unproven; the
plan's server-side feed is cheap insurance, and TEST fixtures will dominate test data.

**The native-iOS acceptance bar (owner's):** instant cache-first paint (no
spinner-replaces-content) · zero remount on tab switch · smooth keyboard (composer rides
visualViewport, thread pinned to newest, safe-area respected, no layout jump) · momentum
scroll with ref-based restore (no setTimeout hacks) · 48px+ targets · status color from
3 feet · i18n (PT/ES techs) · optimistic send with inline retry · pull-to-refresh with a
fixed header.

## Status reconciliation & stale-state disclosures (finish-first)

| In-flight item | Live truth | Bearing on this initiative |
|---|---|---|
| sms-experience H0/F-core/A/B/C/D/G | ALL merged to dev (last: G `8b43094`) | Build on top; Phase C primitives are the reuse surface |
| sms roadmap banners at :227/:249 | **STALE** — claim A/B PRs "awaiting merge"; both merged | Disclosed here; do not re-dispatch |
| sms F-red (anon-RLS closure) | NOT built/applied; cold-launchable | Pane must run authenticated end-to-end (verified it does — challenge §4) |
| sms Phase G deep-link | **FOUND BROKEN, unfixed** — `twilio-webhook.js:104` sets `link:'/conversations'` (no `?c=`), Session-A-owned | OUT of scope here (audience is admin/office); coordination note in the sms manifest amendment |
| sms Phase C/G on-device iOS lanes | Owner-gated, target the LEGACY mount | Superseded by this initiative's own bake (sms manifest amendment) |
| omni-inbox O/U | Absorbed by sms B/C (roadmap §8); email compose future targets `Conversations.jsx` | Reason the shared component stays untouched |
| tech-v2 Job Hub H3 | OPEN (owner-gated bake) — edits App.jsx routes + deletes tech pages + prunes i18n namespaces | File overlap with this plan = **exactly one file**: `src/i18n/index.js` (seam note in both manifests) |
| PR #382 (dev→main sms release) | Draft, floating | Safe either way; dispatch rule: never merge a phase with the flag seed pending |
| db-foundation P8 (job-files privacy flip) | Planned | The pane's MMS module is a named P8 swap target (manifest note) |
| Stale PRs #102 (lint), #224 (security) | Both edit files since rewritten/deleted | Recommend close/redo; not this initiative's scope |

## Severity findings (mechanism · evidence · interim guidance)

| # | Sev | Finding | Evidence |
|---|---|---|---|
| 1 | P1-arch | **Remount storm** — the tech mount lives in the pathname-keyed outlet; every tab switch destroys state + both realtime channels, then full-page spinner + refetch-everything | TechLayout.jsx:298-304; Conversations.jsx:181,330,398,979 |
| 2 | P1-perf | **Unbounded queries** — list select pulls the ENTIRE conversations table (no limit) with participant+contact embed; new-conversation loads ALL contacts | Conversations.jsx:236-244, 899-903 |
| 3 | P2-ux | **contentEditable composer** — deprecated `execCommand` paste, DOM/state dual source of truth, no newline path on mobile | Conversations.jsx:874-895, 1191-1202 |
| 4 | P2-perf | **Org-wide realtime → full list refetch on ANY conversation INSERT**; `window.focus` refetch fires liberally on iOS | Conversations.jsx:328, 482 |
| 5 | P2-i18n | **Hardcoded English** in an otherwise tri-language tech shell (0 `useTranslation`) | Conversations.jsx:45-54, 109-123 |
| 6 | P3-ux | Residual sub-48px targets (28px dots menu, 24px attach-remove, 32px chips) + hover/right-click desktop idioms for mark-unread | index.css:311-313, 743, 273; Conversations.jsx:994-995 |
| 7 | P3 | **No unread badge on the Messages tab** — a tech cannot see new messages without opening the tab | TechLayout.jsx:135-141 (no badge plumbing) |
| 8 | P3-exposure | Tech over-exposure: mass org read-all, two-way DND toggle, desktop `/contacts` links that 404 in the tech route tree | Conversations.jsx:627-636, 638-667, 1221-1229 |
| 9 | P3 | 50ms setTimeout open-scroll; global `--conv-kb-offset` written on documentElement (single-surface assumption) | Conversations.jsx:438, 492-509 |

## Gap audit (taxonomy constructed for this domain; HAVE only from code/schema)

| # | Capability | Verdict | Evidence |
|---|---|---|---|
| A1 | Keep-alive surface (state survives nav) | MISSING | Finding 1 |
| A2 | Cache-first paint (idb persister) | MISSING | nothing persisted; contrast techQueryPersister.js |
| A3 | Server-limited paginated feed | MISSING | Finding 2; **no conversation-feed RPC exists at all** (pg_proc scan) |
| A4 | Realtime kept, scoped, cheap | PARTIAL | works, but Finding 4 |
| B1 | List + status filters + search + per-filter counts | HAVE (client-side over full table) | Conversations.jsx:536-553 — breaks under pagination unless server-side (challenge blocker) |
| B2 | Unread badges + mark read/unread + read-all | HAVE (org-global counter) | conversations.unread_count; no per-tech read state exists |
| B3 | Messages-tab badge | MISSING | Finding 7 |
| C1 | Thread: newest-30 + load-earlier + anchoring + jump-pill | HAVE | Conversations.jsx:334-467, 1083-1088 |
| C2 | Optimistic send + retry + delivery ticks | HAVE | :732-870; MessageBubble.jsx:66-87 |
| C3 | Internal notes / MMS / templates / scheduled / drafts / segment counter | HAVE | inventory items 9-15 (audit) |
| C4 | DND banner + consent display + toggle | HAVE (two-way toggle, any tech) | :638-667, 1134-1146 — fork adjudicated below |
| D1 | Native keyboard handling | PARTIAL | visualViewport exists (Phase C) but global var + contentEditable (Findings 3, 9) |
| D2 | 48px everywhere / no hover idioms | PARTIAL | Finding 6 |
| E1 | Feed/thread RPC layer + migration coverage | MISSING | zero RPCs; only increment_conversation_unread + claim_scheduled_message exist (tracked, no drift) |
| E2 | Realtime survives F-red | HAVE (verified) | supabase-js attaches session JWT to the socket; publication covers both tables — challenge-CONFIRMED, devLogin caveat |
| F1 | i18n | MISSING | Finding 5; no msgs namespace |

## Binding design principles & architecture calls (post-challenge, corrected)

1. **App.jsx untouched.** `paneCovering` (TechLayout.jsx:245) suppresses the keyed outlet
   whenever the pane is active, so the legacy route element never mounts flag-on, and
   flag-off falls back byte-identically. Challenge-CONFIRMED (no flash: flags are awaited
   pre-paint). The fail-open trap therefore lives ONLY in the flag row: **seed the live row
   FIRST** (`enabled=false`, `dev_only_user_id='d1d37f3c-2de5-4d8c-b5a8-f7b87e93d2da'`),
   then the `EXPLICIT_FLAGS` entry with `enabled:false` in the same PR
   (AuthContext.jsx:294 fail-opens on a missing row; DevTools auto-seeds missing keys ON).
2. **TechLayout third pane** mirroring :241-294: `msgsActive = flag &&
   pathname==='/tech/conversations'`, folded into `paneCovering`, lazy import. PLUS the
   **Messages-tab unread badge** (Finding 7) — TechLayout-owned freshness (see data
   contracts), never gated on the pane's `active`.
3. **`TechMsgsPane` — a purpose-built pane host** (disclosed copy-in of TechPane, owned by
   this initiative). Challenge blocker: TechPane's continuous scroll tracker is
   clamp-poisoned by a list↔thread content swap. Structure: list layer (own scroller +
   ref-based restore) and thread layer (own scroller, pinned-to-bottom); `hidden` attr
   semantics preserved; nav-hide class applied **only while `active`** (the naive
   `:has(.tv2-msgs-thread-open)` rule would strand the whole app's tab bar while the pane
   is hidden — challenge blocker #2). Nav-hide rule scoped
   `.tech-layout:has(.tv2-msgs-pane:not([hidden]) .tv2-msgs-thread-open) > .tech-nav`.
4. **URL is the source of truth for the thread**: open = `setSearchParams({c: id})`
   (push), close = `navigate(-1)`. Buys `?c=` deep-link parity AND correct iOS swipe-back
   for free (a pure client switch broke both — challenge). On a `?c=` cache miss, fetch
   the single conversation (RPC single-row mode) and merge into the cache.
5. **React Query + persister**, keys via the amended frozen registry (kinds `convos`,
   `thread`; mutation `'message'` → [CONVOS, THREAD]). **Privacy:** `dehydrateOptions.
   shouldDehydrateQuery` EXCLUDES the `thread` kind — raw SMS bodies are never persisted
   to IndexedDB; the list is (cold-open paint).
6. **Optimistic overlay model** (challenge-mandated): thread render = RQ server pages +
   a pane-local overlay keyed by `_clientId`. Realtime message **UPDATE → row-patch via
   `setQueryData`** (delivery ticks never refetch); **INSERT → append via `setQueryData`**
   with legacy reconcile semantics (dedupe by id → reconcile pending/failed by type+body →
   append; preserve `employees`); reconnect/suspend → invalidate as the safety net.
   Copy-in sources: Conversations.jsx **:732-870 AND :258-278** (the merge heuristic);
   **:364-399 is reference-only — reimplement against the cache model**. `handleSend` is
   REWRITTEN for the textarea; the 201-with-failed-row path is preserved (201 ≠ delivered)
   and 403 codes DND_ACTIVE / NO_CONSENT / CONTACT_NOT_FOUND / ALL_RECIPIENTS_BLOCKED
   surface inline. Open-thread unread-desync guard (:316-327) is in the copy-in list.
7. **Realtime subscriptions:** per-thread channel gated on `active`; ONE
   `subscribeToConversations` channel alive for the pane's mounted lifetime (updates the
   convos cache via setQueryData/targeted invalidate — feeds the badge). Consume frozen
   `realtime.js` as-is. Verified: the socket carries the authenticated JWT (survives
   F-red); **devLogin caveat**: local realtime testing post-F-red will falsely appear
   broken — verify with a real login; one live re-verify line after F-red applies.
8. **Composer**: real `<textarea>` (AutoGrowTextarea-style autosize, capped), **Enter =
   send** + `enterKeyHint="send"` (legacy tech muscle memory + one-primary-action;
   Shift+Enter = newline for hardware keyboards), ≥16px font, 48px send target,
   `SegmentCounter` with the server `"Name: "` `prefixLen` carried over (billing-real).
   Keyboard lift: visualViewport handler **gated on `active`**, writing a **pane-scoped**
   var consumed as `padding-bottom` on the thread layer only (list has no composer).
9. **Reuse Phase C primitives by import** — `MessageBubble`, `SegmentCounter`,
   `messageUtils` (segments/linkify/parseMediaUrls/uiClass/failureReason/drafts).
   Challenge-CONFIRMED: every class they emit is top-level/unscoped (renders in the pane);
   the thread container must be a **flex column** (align-self dependency). Their internal
   strings are EN-only — **disclosed v1 parity gap** vs the i18n goal (chrome around them
   is fully translated; a bubble-i18n follow-up is an sms-owner change).
10. **CSS**: new `tv2-msgs-*` classes ONLY inside a new `/* ─── TECH-V2: MSGS ─── */`
    reserved marker appended after the last reserved block; never restyle
    `.conv-*`/`.message*`/`.tech-*` — **amended**: pane-scoped descendant overrides of
    reused classes (e.g. dark-theme bubble fixes) ARE permitted inside the marker (they
    cannot leak — legacy never renders inside `.tv2-msgs-*`).
11. **i18n from day one**: new `msgs` namespace (3 locale files + the index.js recipe;
    parity test auto-covers); dates via locale-aware `techDateUtils`.
12. **Send path frozen**: `POST /api/send-message` only; worker is sole writer of `sms_*`
    rows; no `skip_compliance`; client inserts only via the worker (notes included).
    `consent-path-auditor` runs on every phase that touches sending.

## Data-layer contracts (F-M ships; B1/B2 consume — signatures frozen after F-M)

- **`get_tech_conversations(p_limit int DEFAULT 50, p_before timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL, p_search text DEFAULT NULL, p_status text DEFAULT NULL,
  p_conversation_id uuid DEFAULT NULL) → jsonb`** — SECURITY DEFINER. Returns
  `{conversations: [...page...], unread_total, status_counts: {all, unread,
  needs_response, waiting_on_client, resolved}}` with the legacy embed shape per row
  (participants + contacts incl. dnd) + a computed `sort_key`. Ordering/cursor:
  `COALESCE(last_message_at, created_at) DESC, id DESC` with the id tiebreaker (the naive
  `last_message_at NULLSLAST + p_before` cursor was challenge-REFUTED: NULL tail
  unreachable, no tiebreaker). `p_status='unread'` supported; search server-side over
  title/preview/participant name+phone. `p_conversation_id` = single-row mode (deep-link
  miss). Scoping v1 = **all org conversations** (today's behavior; `assigned_to` is 100%
  unpopulated); a future `p_employee_id` is reserved as an additive-DEFAULT param.
  **GRANT EXECUTE TO authenticated, service_role + explicit REVOKE FROM PUBLIC, anon**
  (managed-Supabase re-grant trap), SQL doc header + rollback note, committed shape test.
- **`find_or_create_conversation(p_contact_id uuid) → jsonb`** — SECURITY DEFINER;
  server-side participant lookup else INSERT conversations+participants; returns the row
  with the same embed shape. Kills the paginated-dedupe split-thread hazard. Same grants.
- **techQuery amendment (authorized, manifest §)**: kinds `convos()`, `thread(convId)`;
  `MUTATION_INVALIDATIONS['message'] = [CONVOS, THREAD]`; `techQuery.test.js` updated in
  the SAME commit (asserts the exact kinds list); persister dehydrate filter excluding
  `thread`. Registry re-frozen after F-M.
- **Badge freshness (F-M end-to-end)**: shared `useTechConversations` hook = the ONLY
  reader/writer of the convos cache (RPC + `refetchInterval` 60s, the TechLayout taskCount
  precedent) + the pane-lifetime conversations subscription; TechLayout badge consumes
  `unread_total` from it. B1 imports the hook — it does not build its own.
- **Mark read/unread/read-all**: keep legacy's raw `db.update('conversations', …)` —
  challenge-VERIFIED to survive F-red (authenticated ALL policies remain).

## Decision forks — adjudicated (owner may override in the dispatch)

- **DND toggle (asymmetric)**: techs get **one-tap DND ON** (a customer revokes consent
  face-to-face to the person in their house; consent-protective; `sms_consent_log` write
  copied verbatim with `performed_by`). **DND OFF is office/admin-only** (re-opening
  messaging without consent evidence is the real TCPA exposure). Full read-only was
  rejected as an undisclosed regression.
- **Enter=send** (`enterKeyHint="send"`), Shift+Enter newline. Legacy parity won.
- **Scoping = all-org** for v1; per-employee scoping reserved additively.
- **Group/broadcast conversations**: render with type badge + recipient count; replies
  allowed with per-recipient partial-block surfacing (legacy `twilio[]` response parity).
- **Dropped-with-disclosure**: `location.state.contactId` deep-link (callers are
  desktop-only pages); desktop `/contacts/:id` info-drawer links (404 in tech tree —
  replaced by a thread info header using `jobHref()` for the linked-job chip, H3-safe);
  scheduled-send visibility in thread (parity-equal absence, stated non-goal).

## Phases

### Phase F-M — Foundation (seams, data contracts, badge)
> **Branch:** session-assigned, cut from `origin/dev`. **Prerequisite:** this plan on dev.
> **Model: Opus · high** (frozen-seam edits + live-RPC contracts + a compliance-adjacent
> surface). **Read scope:** CLAUDE.md + this roadmap + the ownership manifest +
> `.claude/rules/database-standard.md` + tech-mobile-ux.md.
> **Close-out checklist:** _(all shipped — F-M PR into `dev`; flag stays OFF/owner-only)_
> - [x] Flag row seeded live FIRST via MCP (`enabled=false`, owner dev_only) — BEFORE any code push; verified live (SELECT confirmed the row); `EXPLICIT_FLAGS` entry `enabled:false` in the same PR
> - [x] Migration: `get_tech_conversations` (composite shape, fixed keyset cursor, filters, single-row mode) + `find_or_create_conversation`; GRANT authenticated,service_role + REVOKE FROM PUBLIC,anon; SQL headers + rollback notes; committed shape + cursor tests; `migration-safety-checker` + `anon-grant-auditor` clean — applied + verified live via MCP
> - [x] techQuery amendment (kinds convos/thread + 'message' mutation + dehydrate filter excluding thread) + `techQuery.test.js` same commit
> - [x] Shared `useTechConversations` hook (RPC + 60s refetch + pane-lifetime conversations subscription updating the cache)
> - [x] TechLayout: third pane block + `paneCovering` fold-in + lazy import + Messages-tab unread badge (from the hook's `unread_total`; never active-gated)
> - [x] `TechMsgsPane` host (disclosed TechPane copy-in; two layers; active-gated nav-hide class; scoped `:has` rule)
> - [x] Stub `TechMessagesV2` pane page (skeleton list; proves cover + fallback both ways)
> - [x] css `TECH-V2: MSGS` reserved marker appended; i18n `msgs` namespace scaffold (3 locales + index.js recipe; parity test green)
> - [x] Manifests: commit `.claude/rules/tech-messages-v2-wave-ownership.md`; tech-v2 §8 amendment; sms-experience §10 amendment; sms roadmap §6 supersession pointer (all landed with THIS plan — verify present, extend only if drifted)
> - [x] `npm run test` + `build` + eslint; `upr-pattern-checker`; `tech-phase-reviewer` graded against THIS block; UPR-Web-Context.md; checkboxes reconciled; PR to `dev` ready (handoff; owner/orchestrator merges) — flag stays OFF
**Scope:** owns the manifest-listed seams + `src/pages/tech/v2/TechMessagesV2.jsx` (stub) + `src/pages/tech/v2/messages/**` (hook + pane host) + one migration.

### Phase B1 — Core experience (the native-feel bar)
> **Branch:** session-assigned, cut from `origin/dev`. **Prerequisite:** F-M merged.
> **Model: Opus · high.** **AT THE MEASURED ONE-SESSION CEILING — nothing may be added.**
> **Close-out checklist:**
> - [ ] List: rows ≥56px, status-color-from-3-feet accents, unread bold+badge, relative dates via techDateUtils, pull-to-refresh below a fixed header, skeletons cold-start only
> - [ ] All/Unread filter + search (server-side via the RPC params; cache keyed per filter)
> - [ ] Thread: own pinned-to-bottom scroller, load-earlier w/ scroll anchoring (no setTimeout), jump-to-latest pill w/ new-count, DateDivider, MessageBubble/SegmentCounter imports (flex-column container)
> - [ ] URL-driven open/close (`?c=` push / navigate(-1)); deep-link miss → single-row fetch + cache merge; iOS swipe-back closes the thread
> - [ ] Composer: textarea autosize (capped), Enter=send + Shift+Enter newline, `enterKeyHint="send"`, ≥16px, 48px send, prefixLen-aware SegmentCounter, per-thread drafts, internal-note toggle + amber note path, [+] actions-sheet SHELL (MMS/templates land B2)
> - [ ] Keyboard: active-gated visualViewport handler → pane-scoped var → thread-layer padding-bottom; no layout jump; nav-hide only while active
> - [ ] Send: copied dispatchSend/retryMessage + REWRITTEN handleSend; optimistic overlay + reconcile-merge (:258-278 semantics); 201-with-failed-row preserved; all four 403 codes surfaced inline; DND banner blocks send
> - [ ] Realtime: thread channel active-gated; UPDATE=row-patch, INSERT=append-reconcile; reconnect/suspend (visibilitychange, active-gated) → invalidate; unread-desync guard; mark-read on open
> - [ ] i18n EN complete through `t()` (msgs+tech namespaces); PT/ES keys present (draft)
> - [ ] Named tests first: cursor/page-merge selectors, overlay reconcile (dedupe/pending-match/append), day-divider grouping, unread math, deep-link miss path
> - [ ] `npm run test`+`build`+eslint; `upr-pattern-checker` + `consent-path-auditor` (send path) + `tech-phase-reviewer` vs THIS block; UPR-Web-Context.md; reconcile; PR to `dev` ready; flag stays owner-only
**Scope:** owns `TechMessagesV2.jsx` + `messages/**` + css §MSGS only. ZERO schema.

### Phase B2 — Capability completion & polish
> **Branch:** session-assigned, cut from `origin/dev`. **Prerequisite:** B1 merged.
> **Model: Opus · high** (polish IS the deliverable; consent surface included).
> **Close-out checklist — CORE (must ship):**
> - [ ] MMS: attach ≤5, mediaCompress, storage upload, media_urls send; inbound render via parseMediaUrls (P8 coordination note honored — this module is the named swap target)
> - [ ] Status filter pills (NeedsResponse/Waiting/Resolved) + per-filter counts from the RPC's `status_counts`
> - [ ] Templates picker (message_templates, categories, tap-insert)
> - [ ] Mark-unread as a 48px affordance (no right-click/hover idioms); read-all driven by server counts
> - [ ] One-tap DND ON for techs (consent-log write verbatim, `performed_by`); DND OFF absent for techs (office-only) — fork disclosure in the PR
> - [ ] Thread info header: contact name/phone, DND state, linked-job chip via `jobHref()` (never hardcoded /tech paths)
> - [ ] Group/broadcast rendering (type badge, recipient count, partial-block surfacing)
> - [ ] Error/empty/not-found states (Back+Retry — never a dead end); dark-theme pane-scoped bubble overrides; PT/ES sweep to real quality; polish pass vs Dash/Sched design language (haptics on send, 200ms thread slide w/ reduced-motion guard, no autofocus-on-open, blur-on-scroll-up)
> **STRETCH (explicitly shed-able, each its own honest checkbox):**
> - [ ] New-conversation flow (contact search via server, `find_or_create_conversation`; phone-less contacts unselectable)
> - [ ] Scheduled sends (date/time picker → scheduled_messages insert)
> - [ ] `npm run test`+`build`+eslint; `upr-pattern-checker` + `consent-path-auditor` + `tech-phase-reviewer`; UPR-Web-Context.md; reconcile (shed stretch honestly, never silently); PR to `dev` ready
**Scope:** same files as B1. ZERO schema. **OWNER GATE opens after B2: bake on the owner's
phone (flag owner-only). Budgeted: ~0.5 session of post-bake fixes — expected, not failure.
Cutover = the owner flips `page:tech_msgs_v2` in DevTools → Flags. No deletion phase:
legacy keeps serving web/CRM; the tech route mount simply never renders flag-on.**

## Dependency graph

```
plan on dev → F-M ──> B1 ──> B2 ──(owner bake + ~0.5 fix round)──> owner flag flip
Edges: all HARD artifact edges, strictly serial, same owner-files (one design author).
External gates: NONE (A2P irrelevant — no live sends tested; F-red independent — verified).
Soft coordination edges: H3 (src/i18n/index.js seam) · db-foundation P8 (MMS swap target)
· sms deep-link follow-up (twilio-webhook.js, sms-owned).
```

## What resisted maximum parallelism (honest ledger)

Everything, deliberately — same rationale as Job Hub v2: one design author per surface;
B1 sits at the measured single-session ceiling (Schedule S ≈2,481 ins, H1 ≈2,450, sms C
≈1,272; B1's replicated surface ≈1,800-2,400) so the split protects the native-feel core,
not reviewer bandwidth. Rules bent (all disclosed in manifests): ① techQuery key-freeze
amendment (8th/9th kinds — H1 precedent); ② TechLayout/featureFlags/css-marker frozen-seam
edits (tech-v2 §8); ③ sms-experience copy-in authorization (send helpers :732-870/:258-278)
+ §6 tech-arm supersession (sms §10); ④ TechPane copied rather than edited (sanctioned
fallback). Foundation-as-SPOF priced in via the full reviewer gauntlet before B1 dispatches.

## Adversarial challenge report (6 agents, 2026-07-09 — what changed)

1. **Parity (MODIFIED, 1 blocker):** naive pagination silently broke search/filters/
   counts/badge/dedupe → composite RPC + server filters + find_or_create; deep-link miss
   path; overlay-vs-invalidate contradiction fixed; unread-desync guard added; group/
   broadcast + info-header + dropped-with-disclosure list; DND fork adjudicated asymmetric.
2. **Design (MODIFIED, 2 blockers):** naive `:has()` nav-hide would strand the app tab bar
   (scoped + active-gated now); TechPane wrong host (TechMsgsPane two-layer copy-in);
   URL-driven thread (swipe-back); keyboard = thread-layer padding var; Enter=send
   adjudicated; native punch list (haptics/slide/no-autofocus/blur-on-scroll).
3. **Contracts (MODIFIED):** primitives confirmed unscoped (flex-column dependency named);
   copy-in surface honestly rescoped (handleSend rewritten; :364-399 reference-only);
   **realtime JWT verified — survives F-red** (devLogin caveat); 403 code set completed;
   201≠delivered preserved; persister privacy filter added; bubble-EN disclosed; dark-theme
   override rule amended.
4. **Data (MODIFIED):** keyset cursor fixed (COALESCE + id tiebreaker); badge freshness
   contract (hook owns cache; conversations channel pane-lifetime); grants settled
   (authenticated+service_role, REVOKE PUBLIC/anon); raw mark-read verified F-red-safe;
   append-don't-invalidate adjudicated for the thread cache.
5. **Disjointness (CONFIRMED w/ additions):** H3 overlap = exactly `src/i18n/index.js`
   (seam notes both manifests); tech-v2 amendment expanded to 4 items; sms amendment
   gains consumed-contract freeze + deep-link + P8 notes; TechLayout/css region proven
   editor-free across live initiatives; #382 floating-release dispatch rule.
6. **Scope (MODIFIED):** F-M loaded into a real session (hook+badge+pane host in F-M);
   B1 at ceiling — suspend recovery + All/Unread+search moved IN, MMS/templates stay B2
   (attach-button premise tested and FALSE); B2 core-vs-stretch split made explicit;
   ~0.5 post-bake session budgeted. 3 planned sessions + 0.5.
