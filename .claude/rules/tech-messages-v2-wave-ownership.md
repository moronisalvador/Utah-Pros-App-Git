# Tech Messages v2 — File & RPC Ownership Manifest

**Committed with the plan of record (2026-07-09). Binding for every tech-messages-v2 session.**
Linked from `docs/tech-messages-v2-roadmap.md` (plan of record) and
`docs/tech-messages-v2-dispatch.md` (launch blocks). Each session's read scope = `CLAUDE.md`
+ its roadmap phase block + **this file** (+ `database-standard.md` for F-M,
`tech-mobile-ux.md` for all). Where roadmap prose and this manifest disagree, **this
manifest is authoritative.**

Isolation = the `page:tech_msgs_v2` flag (owner-only until the owner flips it) + this
ownership split. Phases are **strictly serial, same owner-files** (F-M → B1 → B2) — the
split protects the design budget, not reviewer bandwidth.

---

## 1. Frozen — NOBODY in this initiative edits these

- `src/pages/Conversations.jsx` — the shared desktop screen (3 mounts; sms-experience
  Phase C-owned). **Copy-in sources authorized from it** (see §3) — never an edit.
- `src/components/conversations/**` (MessageBubble, SegmentCounter, messageUtils + tests)
  — sms-C-owned; **import-only** (consumed contract, see the sms manifest §10 amendment).
- `functions/api/send-message.js`, `functions/api/twilio-webhook.js`, `twilio-status.js`,
  `process-scheduled.js`, `functions/lib/*` — sms-experience frozen; **call-only**.
- `src/lib/realtime.js` — frozen "do not edit"; consume `subscribeToMessages` /
  `subscribeToConversations` as-is.
- `src/App.jsx` — **untouched by design** (paneCovering suppresses the keyed outlet;
  verified). If a session believes it needs an App.jsx edit, STOP and flag.
- `src/components/tech/v2/TechPane.jsx` + the other v2 primitives — import-only;
  `TechMsgsPane` is a **disclosed copy-in**, not an edit.
- `src/lib/techQueryPersister.js` (the dehydrate filter rides `techQuery.js`'s client
  options, not this file — if that proves wrong, F-M discloses the single edit),
  `src/contexts/AuthContext.jsx`, `package.json` + lockfile.
- All `supabase/migrations/` outside F-M's one migration (B1/B2 ship ZERO schema).

## 2. Ownership matrix

| Session | Phase | Owns exclusively (edit only these) | Schema / RPC |
|---|---|---|---|
| F-M | Foundation | ONE migration; `src/lib/techQuery.js` + `techQuery.test.js` (authorized amendment); `src/lib/featureFlags.js` (one EXPLICIT_FLAGS entry); `src/components/TechLayout.jsx` (third pane + Messages badge only); `src/pages/tech/v2/TechMessagesV2.jsx` (stub); `src/pages/tech/v2/messages/**` (hook + TechMsgsPane); css §MSGS marker (new); `src/i18n/` msgs scaffold (3 locale files + index.js recipe lines) | **ALL**: `get_tech_conversations`, `find_or_create_conversation` |
| B1 | Core experience | `src/pages/tech/v2/TechMessagesV2.jsx`, `src/pages/tech/v2/messages/**`, css inside §MSGS, `src/i18n/locales/*/msgs.json` | none |
| B2 | Completion & polish | same as B1 | none |

## 3. Authorized frozen-file amendments & copy-ins (rule-amendment transparency)

- **techQuery key freeze** (tech-v2 manifest §1/§3, re-frozen after Job Hub H1): F-M adds
  kinds `convos()` + `thread(convId)`, `MUTATION_INVALIDATIONS['message']`, the
  thread-excluding persister dehydrate filter, and updates `techQuery.test.js` in the same
  commit. Precedent: H1's `hub` kind. Registry **re-frozen after F-M**.
- **TechLayout.jsx** (tech-v2 §1 frozen): F-M adds the third pane block + `paneCovering`
  fold-in + lazy import + the Messages-tab unread badge — nothing else in the file.
- **featureFlags.js / index.css marker** (tech-v2 §1/§5): F-M adds one EXPLICIT_FLAGS
  entry (`enabled:false`) and appends the `TECH-V2: MSGS` reserved marker. B1/B2 write
  css ONLY inside it — new `tv2-msgs-*` classes; **pane-scoped descendant overrides of
  imported `.message*`/`.conv-*` classes ARE permitted inside the marker** (they cannot
  leak — legacy never renders inside `.tv2-msgs-*`). Never restyle those classes at
  top level.
- **Copy-ins from sms-C-owned code (disclosed, authorized by sms manifest §10):**
  `dispatchSend`/`retryMessage` (Conversations.jsx:732-870 — copy; `handleSend` is
  REWRITTEN), the suspend-merge heuristic (:258-278), the unread-desync guard (:316-327),
  the MMS upload path (:687-700, B2). `:364-399` (realtime reconcile) is REFERENCE-ONLY.
- **TechMsgsPane** = disclosed copy-in of TechPane (two-layer host; thread-open class
  active-gated; nav-hide `:has` rule scoped to `:not([hidden])`).

## 4. Coordination seams (soft edges — note, don't block)

- **Job Hub H3** (open, owner-gated): the ONLY file overlap is `src/i18n/index.js`
  (H3 deletes namespaces; F-M adds `msgs`). Keep edits minimal; whoever merges second
  resolves a 3-line conflict. Also both roadmaps' close-outs re-grep `/tech/` links —
  the pane's job chip goes through `jobHref()` (H3-safe, binding).
- **db-foundation P8** (job-files bucket privacy flip): the pane's MMS module is a named
  P8 swap target — keep media-URL construction in ONE helper; P8's call-site inventory
  must include it (and Twilio's unauthenticated media fetch needs adequate signed-URL TTL).
- **sms deep-link follow-up**: `twilio-webhook.js:104` (`link:'/conversations'`, no `?c=`)
  is sms-Session-A-owned and its push audience is admin/office. The pane ships `?c=`
  parity so a future role-aware link can target `/tech/conversations?c=` without pane work.
- **Floating release PRs** (e.g. #382): may promote merged flag-off code to prod anytime —
  never merge a phase with the flag seed or EXPLICIT_FLAGS entry missing.
- **F-red** (sms anon closure): verified — the pane runs authenticated end-to-end
  (REST + realtime JWT). devLogin realtime testing falsely breaks post-F-red; use a real
  login. One live re-verify after F-red applies.

## 5. Consent / send seams (reviewer-weighted)

Send path = `POST /api/send-message` ONLY (worker is sole writer of `sms_*` rows; client
never inserts message rows; internal notes go through the worker too). No
`skip_compliance` (it no longer exists — never reintroduce). DND: techs get one-tap
DND ON with the verbatim `sms_consent_log` write; DND OFF is office/admin-only (fork
adjudicated in the roadmap). `consent-path-auditor` runs on B1 and B2. A2P is owner-gated:
no live-send testing.

## 6. Close-out (every session)

Commit → `npm run test` + `npm run build` + `npx eslint` (changed files) → reviewer
gauntlet (`tech-phase-reviewer` graded against the phase's roadmap block;
`upr-pattern-checker`; `consent-path-auditor` on send-path phases;
`migration-safety-checker` + `anon-grant-auditor` on F-M) → delete TEST rows → update
`UPR-Web-Context.md` (Rule 9) → reconcile the phase checkboxes BOTH directions (shed
STRETCH items honestly, never silently) → push `-u` → **open a PR into `dev` as a handoff,
mark ready, STOP** (owner/orchestrator merges; never subscribe/babysit/click-merge).
Flag flips are the owner's, in DevTools → Flags.
