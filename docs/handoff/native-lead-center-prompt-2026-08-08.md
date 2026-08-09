# Cold-session prompt — native Lead Center

Paste everything below the line. Full reasoning and evidence:
`docs/handoff/native-lead-center-plan-2026-08-08.md`.

---

Bring Lead Center natively into the UPR iOS app — the fourth and last office surface. Full
scope: see new leads, transcripts, contact info, and activity history on the phone.

Read first: `docs/handoff/native-lead-center-plan-2026-08-08.md` and
`.claude/rules/initiative-status.md` ("Native office surfaces"). Do not re-derive their
evidence.

ALREADY DONE — do not redo:
- `14304aff` — Lead Center reads the KANBAN STAGE, not `inbound_leads.lead_status` (that
  column is never advanced: 206 of 210 leads read 'new', including 17 the board calls Won).
  Tabs are Working/Won/Lost/All, grouped BY STAGE FLAGS never by name; each row shows its
  exact stage as a chip. The barrel import is already fixed in that file.
- Collections + Dashboard shipped natively the same way — copy that pattern.

Do this, in order:

**1. MIGRATION FIRST.** Five lead RPCs are `SECURITY DEFINER`, granted to `authenticated`,
with NO role check: `get_pipeline_stages`, `move_lead_to_stage`, `get_lead_activity`,
`get_lead_notes`, `add_lead_note`. Owner decided office roles (`billing_edit_access()` =
admin/office/project_manager).

⚠ THE TRAP: `get_pipeline_stages` and `move_lead_to_stage` are ALSO called by
`src/pages/crm/CrmLeads.jsx` — the desktop kanban. Gating those two to `billing_edit_access()`
would lock out 6 active `crm_partner` users from the board they work daily. Those two need
office roles + `crm_partner`; the other three are office-only. Verify `get_inbound_leads`'
existing role check before assuming what it does.

Ship it the way `20260808210000_estimate_read_boundary.sql` did: drift guard pinning the live
body md5, postconditions, paired rollback, a `database-standard.md` §5b behavioural proof on a
disposable local stack with per-role ALLOW **and** DENY including `crm_partner` and
`field_tech`, plus a CI-visible static contract test. Do not apply without explicit owner
authorization.

**2. ACTIVITY HISTORY IS A PORT, NOT A BUILD — and it needs a boundary carve-out.**

`src/components/crm/ActivityTimeline.jsx` already accepts a `leadId` and calls
`get_lead_activity` (line 201). `CrmLeads.jsx` already does notes via `get_lead_notes` /
`add_lead_note`. Reuse them; do not write a second timeline — duplication across the two
shells is the exact problem the reconciliation plan exists to stop.

⚠ BLOCKER: `src/components/crm/` is in `FORBIDDEN_NATIVE_PREFIXES` — a hard prefix ban, not a
missing allowlist entry. `ActivityTimeline` cannot enter the native graph until that is carved
out. Do it the way the collections and admin-mobile bans were: replace the blanket prefix with
a named `NATIVE_CRM_ALLOWLIST` holding ONLY the files the lead card composes, keeping
deny-by-default for everything else under `crm/`. Precedent: `NATIVE_COLLECTIONS_ALLOWLIST`
(5 entries) and `NATIVE_ADMIN_MOBILE_ALLOWLIST`.

Its imports are already native-safe — `AuthContext`, `@/lib/transcript`, `toast`,
`TabLoading`, `ui/ErrorState` — so the carve-out should stay small. Let `build:ios` name any
transitive pulls rather than guessing.

**3. Native carve-out for the screen**, copying Collections/Dashboard: `AdminLeadCenter.jsx`
into `NATIVE_PAGE_ALLOWLIST` (95 today), and
`leads/{LeadRow.jsx,RecordingPlayer.jsx,TranscriptView.jsx,leadFormat.js}` into
`NATIVE_ADMIN_MOBILE_ALLOWLIST` (27 today). SORTED — arrays are asserted against their own
`.sort()`. TWO files pin this and CI runs both:
`tests/qa/unit/native-bundle-boundary.test.js` AND
`scripts/native-bundle-boundary.node-test.mjs`. Then route + registry entry.

Check every `leads/` module for `'@/components/admin-mobile'` barrel imports before building —
native aliases that barrel to a denying shim, so a barrel import renders the screen BLANK with
the build green and the graph guard silent. There is already an assertion for this; make sure
it covers the new modules.

**4. Run `npm run build:ios`** and let it name transitive modules you missed. Add each
individually with a reason, never by prefix.

**DESIGN AND FEEL — not optional polish, part of the work.**

Invoke the skills; do not eyeball it. `new-feature` drives, with `upr-interface-craft` as the
supporting specialist. `impeccable` owns visual direction. `apple-design` for native feel —
sheets, gestures, momentum, interruptible motion. `emil-design-eng` for polish.
`review-animations` is the close-out feel-gate and is MANDATORY for anything touching motion;
it does not auto-fire, invoke it by name, and per its posture approval is earned — a motion
that merely runs is not a pass.

Binding docs, not suggestions: `UPR-Design-System.md` (tokens and existing components — use
them, never recreate), `.claude/rules/tech-mobile-ux.md`, `.claude/rules/motion-standard.md`,
`.claude/rules/loading-error-states.md`, `.claude/rules/page-lifecycle.md`.

Match the native shell that already exists. Lead Center must look like it was built alongside
Collections and Dashboard, not next to them: the same `AdminMobilePage` shell, `AmTabs`,
`AmListRow`, the `am-*` class family, the same card rhythm and spacing. Reuse those primitives
rather than styling new ones.

A CRAFT DECISION TO MAKE DELIBERATELY, not by accretion: the lead card will carry a stage
mover, transcript toggle, recording player, contact details and an activity timeline. Stacked
inline that is an accordion wall. The desktop uses a detail panel. Decide between a bottom
sheet and a pushed detail screen ON PURPOSE — tapping a lead should open its detail, and the
list should stay a scannable list. Do not solve it by adding a sixth collapsible section.

Non-negotiables from `motion-standard.md`: `prefers-reduced-motion` fallback on every
transition and keyframe (missing one is a review failure); press feedback on every interactive
control; hover transforms gated behind `@media (hover: hover) and (pointer: fine)`;
transform/opacity only; no framer-motion, GSAP or react-spring. High-frequency controls — the
tab switch, the stage mover — stay instant or ≤120ms; an instant high-frequency control is
CORRECT, not a miss.

RESTRAINT OVER IMPRESSIVENESS. This screen is used one-handed, probably standing outside a
customer's house, to answer *who called and where is it*. Fast and legible beats beautiful.

**Verify:** `npm run build:ios` + `node scripts/assert-native-dist.mjs` (NEVER `npm run
build`), `npm test` (set `UPR_TEST_LANE`; `tests/qa/unit` is the qa lane), `npm run
test:tooling`, `npm run report:bundle-size`, then the SIMULATOR on BOTH accounts — "Moroni
Salvador" (admin) and "Moroni Tech" (field_tech). The tech session proves nothing leaked.
Verify on the simulator, not at a 390px browser viewport — UPR is native-only, there is no
PWA, so `build:ios` plus the simulator is the real check.

ONE GENUINELY UNKNOWN THING: recording playback. `LeadRow` fetches `/api/callrail-recording`
as a blob and plays it via `URL.createObjectURL` because an `<audio src>` cannot carry the
Supabase auth header. That is unverified under WKWebView. Test it on the simulator
specifically; if it fails, say so rather than shipping a dead play button.

**Shared checkout:** `git fetch` first, and CHECK YOU ARE ON `dev` —
`git rev-parse --abbrev-ref HEAD`. A session switched the main folder to another branch on
2026-08-08 and commits silently landed there. If you need your own branch, use
`git worktree add`, never `git checkout` in the main folder. Stage by explicit path, reconcile
by merge never rebase. A red `npm test` may be another session writing mid-run — re-run before
believing it.

**Out of scope:** retiring `lead_status` (it has live readers — the CallRail intake RPC writes
it and six functions reference it); the "Not a Lead" stage flag (owner's CRM-settings
decision); native drag-and-drop between stages (wanted later, not now).
