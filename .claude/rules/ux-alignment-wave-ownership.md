# UX Alignment Wave — File & RPC Ownership Manifest

**Committed by the UX Quality plan of record (2026-07-13). Binding for every UX-alignment session.**
Linked from `docs/ux-quality-roadmap.md` (plan of record) and `docs/ux-quality-dispatch.md` (launch
blocks). Each session's read scope = `CLAUDE.md` + its phase block in the roadmap + the standing rules
it touches (`page-lifecycle.md`, `loading-error-states.md`, `perf-budget.md`, `workers-standard.md`,
`close-out-standard.md`, `UPR-Design-System.md`) + **this file**. Where roadmap prose and this manifest
disagree on a name or path, **this manifest is authoritative** (it reflects what Foundation shipped).

Isolation in this initiative is **not** the branch — it is this ownership split. There is no feature
flag (the surfaces are already live; the insurance is additive primitives + per-page swaps + the
reviewer gauntlet + git-revert). Stay inside your owned files and no two sessions collide.

---

## 1. Frozen for the wave — Foundation owns these; NOBODY else edits them in-wave

- **Plan-of-record docs** (`docs/ux-quality-roadmap.md`, `docs/ux-quality-dispatch.md`, this manifest,
  the five `.claude/rules/` standards docs, the checker agents). A session updates its OWN phase's
  checkboxes/status; it never re-authors these. **If they are not on disk, your base is wrong — re-sync
  from `dev` per the dispatch Base Preflight; do NOT recreate them.**
- **`src/components/ui/**` + the new shared hooks** (`useResumeRefetch`, `useTwoClickConfirm`,
  `useLookup`, `usePhotoUpload`) — F-S2 owns/creates them; wave sessions IMPORT only. A needed change to
  a primitive is a disclosed F-S2 follow-up, never an in-wave edit.
- **`src/index.css` `:root` token block + the design-system base** — F-S2 owns the token definitions;
  wave sessions consume `var(--…)` and write only inside their reserved section marker.
- **`functions/lib/{auth,http,worker-runs,supabase,cors}.js`** — F-B owns; workers import only.
- **`src/lib/{supabase,stableDb,realtime,toast}.js`, `src/contexts/AuthContext.jsx`,
  `src/components/{Layout,TechLayout,Sidebar,TopNav}.jsx`** — shared shell/auth surface; consume, don't
  restyle. (H8's `TechLayout` toast token-class fix is a W1-owned exception, disclosed.)
- **`package.json` + lockfile.**
- **In-flight OTHER initiatives** — do not touch, route to their W6 fold-in instead:
  `src/pages/Conversations.jsx` + `src/components/conversations/**` (sms-experience C);
  `src/pages/tech/v2/**` + `src/pages/tech/TechAppointment.jsx`/`TechJobDetail.jsx` retirement (Job Hub
  H3 — W1 may make BEHAVIOR/dark/tap-target fixes to TechAppointment but NOT restyle it);
  `src/pages/Schedule.jsx` deep restructure + `ScheduleTemplates.jsx` (Schedule Desktop — W2 makes only
  the callback→silentReloadBoard + error-branch behavior fixes); `functions/api/process-*` +
  `src/pages/Marketing.jsx` (CRM 4b/5-Ops).

## 2. Ownership matrix

| Session | Phase | Owns exclusively (edit only these) | Schema/RPC |
|---|---|---|---|
| Phase 0 | Hardening | `functions/api/encircle-{search,rooms,upload}.js`, `purge-feedback-media.js`, `stripe-payout.js`, the money-worker auth lines, `src/lib/supabase.js` (retry guard — owner-directed), the 3 crew-sync call sites (interim), `.claude/settings.json` (hook matcher), the browser callers' Bearer headers | none (F-B lands the RPCs) |
| F-S1 | Standards | the 5 rule docs, 2 checker agents, `upr-pattern-checker.md`, `eslint.config.js`, `.github/workflows/ci.yml`, `CLAUDE.md`, `tech-mobile-ux.md`, `documentation-standard.md`, `masterplan/SKILL.md` | none |
| F-S2 | Primitives | `src/components/ui/**`, `src/hooks/**` (new), `src/index.css` `:root` + base, `UPR-Design-System.md` | none |
| F-B | Backend | `functions/lib/{auth,http,worker-runs}.js`, the 3 new RPCs' migrations, money-worker tests, `useOfflineQueue` extension | `sync_appointment_crew`, `save_estimate_lines`, `get_jobs_list` |
| W1 | Tech behavior | the 9 legacy tech pages, `TechLayout` toast + tech `.tech-*` dark overrides, `techConstants` color maps | none |
| W2 | Desktop behavior | Schedule callbacks (behavior only), ClaimPage/JobPage/CustomerPage, the failure→empty-state list pages, ClaimsList, Collections tab-mount | none (calls F-B RPCs) |
| W3 | Codemods | the toast/StatusPill/Modal/icon/SearchInput/formatter/two-click sweeps (cross-cutting — sole owner) | none |
| W4 | A11y/i18n | icon-button labels, Field adoption, tech i18n namespace files | none |
| W5 | Perf | fonts, lazy-load config, `useLookup`/`get_jobs_list` rollout, (RED) service worker | none (calls F-B `get_jobs_list`) |

## 3. Migration rule

Phase 0 + W-sessions ship **zero schema migrations**. F-B ships the only migrations (3 additive RPCs +
the offline-queue types), db-migration-skill discipline (additive-only, RLS/grants, rollback note,
test-first). Any session that discovers it needs a migration: **stop and flag** for F-B or a separate
reviewed change.

## 4. index.css rule

F-S2 owns `:root` + base. Every W-session writes CSS ONLY inside its reserved marker
(`/* ─── UX-ALIGN RESERVED — W<n> ─── */`) near the end of `src/index.css`, using `var(--…)` tokens
only (the `design-consistency-checker` fails raw hex/px where a token exists). Mobile-only rules use
`@media (max-width: 768px)`. Existing selectors may be reused; new classes carry the surface prefix.

## 5. Close-out (every session)

Per `.claude/rules/close-out-standard.md`: `npm run test` + `npm run build` + `npx eslint` (changed
files) → gauntlet (`upr-pattern-checker` + `design-consistency-checker` + `page-behavior-checker`; add
`migration-safety-checker` + `anon-grant-auditor` on F-B/Phase-0 migrations & worker gates) → **minimize/
resume test** (background the PWA / hide the tab 30s+, resume — no blank, no spinner flash, no route/
scroll loss) → **390px mobile viewport check** on any touched page → **perf delta** vs `perf-budget.md`
→ update `UPR-Web-Context.md` (Rule 9) → **re-measure this session's slice of the roadmap baseline
metrics** → reconcile roadmap checkboxes (both directions) → delete TEST rows → push `-u` → open a PR
into `dev` as a handoff → **STOP** (owner/orchestrator merges; do not subscribe/babysit/click-merge).
