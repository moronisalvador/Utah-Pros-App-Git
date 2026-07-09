# Tech Messages v2 — Session Dispatch Blocks

Copy-paste launch blocks per `docs/tech-messages-v2-roadmap.md` (the plan of record).
Fully self-contained cold-session prompts. Claude Code web hands each session a
harness-assigned `claude/…` branch — use it as-is; the Branch line is illustrative.
Where a block and the roadmap disagree, **the roadmap phase block + the ownership
manifest (`.claude/rules/tech-messages-v2-wave-ownership.md`) are authoritative.**

**Preconditions:** F-M launches once the plan-of-record commit is on `dev` — nothing
else. B1 launches after F-M's PR merges; B2 after B1's. **Strictly serial, one session
at a time** (same owner-files; one design author). No owner pre-decisions outstanding —
the DND fork, Enter=send, all-org scoping, and the B2 core/stretch split are adjudicated
in the roadmap. Flag flips stay the owner's (DevTools → Flags). **Floating-release rule:
a dev→main PR (e.g. #382) may ship your merged code to production at any time — never
merge a phase while its flag seed or EXPLICIT_FLAGS entry is missing.**

---

```
[Session F-M — Foundation]
Branch: session-assigned (illustrative: tech-msgs-v2/f-foundation), cut from origin/dev
Model: Opus 4.8 (or newest Opus-tier)
Effort: High
Launch after: the tech-messages-v2 plan-of-record commit is on dev — nothing else

You are building Tech Messages v2 Phase F-M — Foundation: every frozen seam, the data
contracts, and the Messages-tab badge for the field-tech messaging pane; one phase only,
zero feature UI beyond a stub. Context: /tech/conversations today mounts the SHARED
desktop Conversations.jsx (3 mounts — it stays UNTOUCHED forever in this initiative);
the rewrite is a keep-alive tech-v2 pane behind page:tech_msgs_v2, replicating the
TechScheduleV2 machine. Read scope: CLAUDE.md, the ENTIRE docs/tech-messages-v2-roadmap.md
(the "Binding design principles & architecture calls" + "Data-layer contracts" sections
+ your F-M block are the acceptance criteria — the roadmap wins over this prompt),
.claude/rules/tech-messages-v2-wave-ownership.md (your ownership + the authorized
frozen-file amendments), .claude/rules/database-standard.md, and
.claude/rules/tech-mobile-ux.md. Work on your session's assigned branch cut from
origin/dev. Order of work (riskiest first):
(1) SEED THE FLAG FIRST, live via Supabase MCP, BEFORE any code is pushed anywhere:
feature_flags row page:tech_msgs_v2 enabled=false,
dev_only_user_id='d1d37f3c-2de5-4d8c-b5a8-f7b87e93d2da' (a missing row FAILS OPEN —
AuthContext.jsx:294 returns true; DevTools auto-seeds missing registry keys ON). Then add
the EXPLICIT_FLAGS entry in src/lib/featureFlags.js with enabled:false (copy the
page:tech_sched_v2 entry at :91-97) — same PR.
(2) Migration (additive-only; applied via MCP; migration-safety-checker +
anon-grant-auditor must pass): [a] get_tech_conversations(p_limit int DEFAULT 50,
p_before timestamptz DEFAULT NULL, p_before_id uuid DEFAULT NULL, p_search text DEFAULT
NULL, p_status text DEFAULT NULL, p_conversation_id uuid DEFAULT NULL) → jsonb —
SECURITY DEFINER returning {conversations:[…page…], unread_total, status_counts:{all,
unread, needs_response, waiting_on_client, resolved}}; per-row embed shape = what
Conversations.jsx:236-244 gets today (participants + contacts incl. dnd/dnd_at) + a
computed sort_key; ordering COALESCE(last_message_at, created_at) DESC, id DESC with the
id tiebreaker in the cursor predicate (a bare last_message_at cursor is BROKEN — NULL
tail unreachable); p_status='unread' supported; p_search over title/preview/participant
name+phone server-side; p_conversation_id = single-row mode for deep-link cache misses.
[b] find_or_create_conversation(p_contact_id uuid) → jsonb — server-side participant
lookup else INSERT conversations+participants, returning the same embed shape (kills the
paginated-dedupe split-thread hazard). BOTH: GRANT EXECUTE TO authenticated, service_role
+ explicit REVOKE EXECUTE ... FROM PUBLIC, anon (the managed-Supabase ddl_command_end
trap re-grants PUBLIC — the REVOKE line is load-bearing); SQL documentation-standard
headers + rollback notes; committed shape + cursor tests (fixture IDs, never live counts).
(3) techQuery.js amendment (AUTHORIZED by the manifest — the one frozen-registry change):
add kinds convos() and thread(convId); MUTATION_INVALIDATIONS gains 'message' → [CONVOS,
THREAD]; update src/lib/techQuery.test.js in the SAME commit (it asserts the exact kinds
list). Also add a persister dehydrateOptions.shouldDehydrateQuery filter EXCLUDING the
thread kind — raw SMS bodies must never persist to IndexedDB (the convos list may).
(4) Shared hook src/pages/tech/v2/messages/useTechConversations.js — the ONLY
reader/writer of the convos cache: useQuery(techKeys.convos()) → the RPC, refetchInterval
~60s (TechLayout taskCount precedent :260-271), PLUS one subscribeToConversations channel
alive for the pane's mounted lifetime that updates the cache via
queryClient.setQueryData/targeted invalidate. Realtime note (verified, on record): the
socket carries the authenticated JWT and survives the pending F-red anon closure;
devLogin-based local testing will falsely appear broken post-F-red — verify with a real
login.
(5) TechLayout.jsx (authorized seam edit): third pane mirroring :241-294 — msgsV2 flag
check, msgsActive = flag && pathname==='/tech/conversations', fold into paneCovering
(:245), pane block after :294, lazy import. App.jsx is NOT touched (paneCovering already
suppresses the keyed outlet; flag-off falls back to legacy automatically — verified).
PLUS the Messages-tab unread badge on the tab row (:135-141): reads unread_total from
useTechConversations — NEVER gated on the pane's active prop (a badge matters precisely
when the tech is elsewhere).
(6) TechMsgsPane (src/pages/tech/v2/messages/TechMsgsPane.jsx) — a purpose-built pane
host, DISCLOSED COPY-IN of src/components/tech/v2/TechPane.jsx (do NOT edit TechPane):
two layers — list layer (own scroller + ref-based continuous scroll tracking + pre-paint
restore) and thread layer (own scroller, pinned-to-bottom; no restore-to-saved) — hidden
attr semantics preserved; the thread-open class is applied ONLY while `active` (a naive
:has(.tv2-msgs-thread-open) nav-hide would strand the app's tab bar while the pane is
hidden). Nav-hide css rule scoped:
.tech-layout:has(.tv2-msgs-pane:not([hidden]) .tv2-msgs-thread-open) > .tech-nav.
(7) Stub TechMessagesV2 pane page (skeleton list via SkeletonList) proving cover +
fallback both ways: flag ON → pane covers, legacy never mounts; flag OFF → legacy
byte-identical. css: append the /* ─── TECH-V2: MSGS ─── */ reserved marker after the
last existing reserved block in src/index.css; new tv2-msgs-* classes only.
(8) i18n scaffold: msgs namespace — src/i18n/locales/{en,pt,es}/msgs.json + the
src/i18n/index.js recipe (3 imports + NAMESPACES entry + 3 resources lines; the parity
test auto-covers). H3-SEAM NOTE: Job Hub H3 also edits src/i18n/index.js (namespace
deletions) — keep your edit minimal/additive; the manifests carry the coordination note.
(9) Verify the manifests landed with the plan commit (.claude/rules/
tech-messages-v2-wave-ownership.md + tech-v2 §8 + sms-experience §10 + sms roadmap §6
pointer); extend only if drifted — do not re-author.
Named tests first (committed red → green): RPC shape + cursor math (NULL last_message_at
tail reachable; tiebreaker), find_or_create idempotency, techQuery kinds list, dehydrate
filter excludes thread. Close-out: npm run test + npm run build + npx eslint (changed
files); migration-safety-checker + anon-grant-auditor + upr-pattern-checker clean;
tech-phase-reviewer (Opus) graded against the F-M block in
docs/tech-messages-v2-roadmap.md; delete TEST rows; update UPR-Web-Context.md (Rule 9);
reconcile the F-M checkboxes honestly (both directions); push -u and open a PR into dev
using the repo template, mark it ready for review, and STOP — the owner/orchestrator
merges. The flag stays OFF for everyone.
```

---

```
[Session B1 — Core experience]
Branch: session-assigned (illustrative: tech-msgs-v2/b1-core), cut from origin/dev
Model: Opus 4.8 (or newest Opus-tier)
Effort: High
Launch after: F-M merged into dev

You are building Tech Messages v2 Phase B1 — the core native-feel experience: list,
thread, composer, keyboard, send, realtime; one phase only, and you are AT THE MEASURED
ONE-SESSION CEILING — add NOTHING beyond this block (MMS, templates, status pills,
new-conversation are B2's; the roadmap's B2 list is off-limits). The bar: an iPhone user
cannot tell this isn't a native messages app. Read scope: CLAUDE.md, the ENTIRE
docs/tech-messages-v2-roadmap.md (architecture calls 3-12 + data contracts + your B1
block are the acceptance criteria; the roadmap wins over this prompt),
.claude/rules/tech-messages-v2-wave-ownership.md (binding: your files + frozen list +
the authorized copy-ins), and .claude/rules/tech-mobile-ux.md (persona is law). Work on
your session's assigned branch cut from origin/dev. Foundation shipped: the flag
(OFF/owner-only), get_tech_conversations + find_or_create_conversation live, techQuery
convos/thread kinds + 'message' mutation + thread-excluding dehydrate filter,
useTechConversations hook, the TechLayout pane + badge, TechMsgsPane two-layer host, the
css §MSGS marker, the msgs i18n namespace. Hard constraints: ZERO schema/migrations;
edit ONLY src/pages/tech/v2/TechMessagesV2.jsx + src/pages/tech/v2/messages/** + css
inside §MSGS (tv2-msgs-* classes; pane-scoped descendant overrides of reused bubble
classes are permitted INSIDE the marker); Conversations.jsx / realtime.js /
send-message.js / components/conversations/** are NEVER edited — import the Phase C
primitives (MessageBubble, SegmentCounter, messageUtils) as-is; the send path is
POST /api/send-message ONLY (worker is sole writer; no skip_compliance — TCPA penalties
are per message). Build order (riskiest first):
(1) Data hooks: useThread(convId) — infinite query on techKeys.thread (newest-30 pages,
keyset by created_at) + the OPTIMISTIC OVERLAY model (mandatory, challenge-adjudicated):
render = server pages + a pane-local overlay keyed by _clientId; realtime UPDATE →
queryClient.setQueryData row-patch (delivery ticks NEVER refetch); INSERT → setQueryData
append with legacy reconcile semantics (dedupe by id → reconcile pending/failed by
type+body → append; preserve employees); reconnect/suspend → invalidate as safety net.
Copy-in sources (authorized, disclosed): Conversations.jsx:732-870 (dispatchSend/
retryMessage — copy; handleSend — REWRITE for textarea + cache model) AND :258-278 (the
serverIds/serverBodies merge heuristic) AND the open-thread unread-desync guard
(:316-327). :364-399 is REFERENCE-ONLY — reimplement against the cache model, do not
transplant. Preserve: 201-with-failed-row (201 ≠ delivered), inline surfacing of 403
DND_ACTIVE / NO_CONSENT / CONTACT_NOT_FOUND / ALL_RECIPIENTS_BLOCKED, the activeIdRef
stale-frame guard.
(2) List view in the pane's list layer: rows ≥56px, status-color-from-3-feet accent,
unread bold + count badge, locale-aware relative dates (techDateUtils — never hardcoded
Today/Yesterday), All/Unread filter + search wired to the RPC's p_status/p_search (cache
keyed per filter), pull-to-refresh below a FIXED header, skeletons on true cold start
only — content is never replaced by a spinner.
(3) Thread view in the thread layer: own pinned-to-bottom scroller; load-earlier with
scroll anchoring (no setTimeout); jump-to-latest pill with new-count; DateDivider;
MessageBubble/SegmentCounter imports (the thread container MUST be a flex column —
align-self dependency); delivery ticks + inline Retry.
(4) URL-driven navigation: open thread = setSearchParams({c: id}) push; close =
navigate(-1); the pane derives threadOpen from useSearchParams gated on active; iOS
swipe-back closes the thread. ?c= deep-link on cache miss → RPC single-row mode + merge
into the convos cache, then open.
(5) Composer: real <textarea>, AutoGrowTextarea-style autosize (capped ~5 lines),
Enter=send + Shift+Enter newline, enterKeyHint="send", font ≥16px (iOS zoom), 48px send
button, SegmentCounter with the server "Name: " prefixLen (billing-real), per-thread
drafts (messageUtils get/set/clearDraft), internal-note toggle → is_internal_note (amber
path), the [+] actions-sheet SHELL (empty besides note toggle — MMS/templates are B2),
DND banner (read-only in B1) blocking send.
(6) Keyboard: visualViewport handler GATED on active, writing a PANE-SCOPED css var
(never documentElement — legacy owns --conv-kb-offset), consumed as padding-bottom on
the THREAD layer only; nav-hide class only while active; no layout jump; blur-safe.
(7) Realtime + lifecycle: per-thread subscribeToMessages gated on active; the
conversations channel stays F-M's hook's job; Capacitor suspend recovery
(visibilitychange refetch, active-gated). Mark-read on thread open (raw db.update — F-red
safe, verified) + the unread-desync guard.
(8) i18n: every string through t() (msgs + tech namespaces), EN complete, PT/ES keys
present (drafts ok — B2 sweeps).
Named tests first (committed red → green): overlay reconcile (dedupe by id /
pending-match by type+body / append), page-merge + cursor selectors, day-divider
grouping, unread math, deep-link miss path. Close-out: npm run test + npm run build +
npx eslint (changed files); upr-pattern-checker + consent-path-auditor (send path) +
tech-phase-reviewer (Opus) graded against the B1 block; UPR-Web-Context.md; reconcile
checkboxes honestly; push -u and open a PR into dev using the repo template, ready for
review, and STOP. Flag stays owner-only OFF; never enable it for staff.
```

---

```
[Session B2 — Capability completion & polish]
Branch: session-assigned (illustrative: tech-msgs-v2/b2-polish), cut from origin/dev
Model: Opus 4.8 (or newest Opus-tier)
Effort: High
Launch after: B1 merged into dev

You are building Tech Messages v2 Phase B2 — capability completion + the polish pass;
one phase only, the LAST build phase before the owner bake. Read scope: CLAUDE.md, the
ENTIRE docs/tech-messages-v2-roadmap.md (your B2 block = acceptance criteria; CORE vs
STRETCH is binding — STRETCH items may be shed HONESTLY as open checkboxes with the
reason, never silently), .claude/rules/tech-messages-v2-wave-ownership.md, and
.claude/rules/tech-mobile-ux.md. Work on your session's assigned branch cut from
origin/dev. Same hard constraints as B1 (files, zero schema, frozen imports, worker-only
send path). CORE work:
(1) MMS: attach ≤5 images via the [+] sheet, src/lib/mediaCompress, storage upload to
the job-files conversations/ path (copy-in from Conversations.jsx:687-700), media_urls
on send; inbound media render via parseMediaUrls with broken-image fallback. P8
COORDINATION (manifest note): this module is the named db-foundation-P8 swap target
(bucket privacy flip → signed URLs) — keep the URL construction in ONE helper.
(2) Status filter pills (NeedsResponse/Waiting/Resolved) + per-filter counts from the
RPC's status_counts channel; read-all driven by server counts (never the loaded page).
(3) Templates picker (message_templates is_active, categories, tap-to-insert at cursor).
(4) Mark-unread as a 48px inline affordance (NO right-click/hover idioms); swipe or
overflow action — your design call within tech-mobile-ux rules.
(5) DND (adjudicated fork — implement exactly): techs get ONE-TAP DND ON with the
sms_consent_log write copied verbatim (performed_by = employee); DND OFF is NOT rendered
for techs (office/admin-only); disclose the fork + rationale in the PR body.
consent-path-auditor runs on this.
(6) Thread info header: contact name/phone, DND state, linked-job chip via jobHref()
from src/components/tech/v2/nav.js (NEVER a hardcoded /tech path — H3 safety).
(7) Group/broadcast conversations: type badge + recipient count; replies allowed with
per-recipient partial-block surfacing (the worker's twilio[] response).
(8) Error/empty/not-found states (Back + Retry — never a dead end); dark-theme
pane-scoped bubble overrides inside §MSGS; PT/ES sweep to real quality (parity test
green); polish pass vs TechDashV2/TechScheduleV2 design language — haptics
(impact('light')) on send success, 200ms thread slide-in/out with the reduced-motion
guard, NO autofocus on thread open, keyboard blur-on-scroll-up in thread.
STRETCH (shed-able, each its own honest checkbox): new-conversation flow (server contact
search + find_or_create_conversation; phone-less contacts unselectable) · scheduled
sends (date/time picker → scheduled_messages insert, text-only).
Close-out: npm run test + npm run build + npx eslint; upr-pattern-checker +
consent-path-auditor + tech-phase-reviewer (Opus) graded against the B2 block;
UPR-Web-Context.md; reconcile checkboxes BOTH directions; push -u; PR into dev via the
template, ready for review; STOP. After your merge the OWNER GATE opens: the owner bakes
on their phone (flag owner-only; ~0.5 session of post-bake fixes is budgeted and
expected). Cutover = the owner flips page:tech_msgs_v2 in DevTools → Flags.
```
