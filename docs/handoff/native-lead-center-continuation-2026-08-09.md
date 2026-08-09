# Continuation — after the Lead Center session (2026-08-09)

Written at the end of the session that shipped native Lead Center and applied its boundary
migration. Everything below is **measured, not remembered**. Paste the prompt at the bottom.

## What is DONE — do not redo, do not re-verify

| Commit / ledger | What |
|---|---|
| `f4474354` | The five lead RPCs gated by `crm_lead_access()`; pipeline tables closed to browser writes |
| **ledger `20260809050801`** | **APPLIED to production.** Postflight verified live, plus real-data behavioural checks |
| `4ee68b12` | Lead Center native: scannable list + pushed `AdminLeadDetail`, `ActivityTimeline` reused |
| `c498762e` | The native route Lead Center was missing (see below) |
| `64790e3d` | Recording CORS fix + Text button sizing + hover-underline gate |

Lead Center is **verified working on the simulator, signed in**: Working 74 / Won 7 / Lost 16 /
All 100, stage chips, and the detail screen with Call/Text, stage strip, recording + transcript
controls, and real stage history.

## The two defects this session found by RUNNING it — read these before touching native

Both had green builds, silent guards and passing suites. Neither was findable in the repository.

1. **Adding a page to the native registry is NOT adding a route.** `AdminMobileRoutes` is web-only
   (`{!IS_NATIVE && …}` in `App.jsx`), so every native admin screen needs its own entry in the
   `IS_NATIVE` route block. Lead Center had a registry entry, an allowlist entry and a web route —
   and `/tech/admin/leads` matched nothing, so `AdminMobileRoute` bounced to the tech Dash.
2. **A worker's SUCCESS path can lack CORS while its error paths have it.**
   `functions/api/callrail-recording.js` returned audio with a hand-built header object; every
   error went through `jsonResponse(…, request, env)`. Native WebView is cross-origin, so the audio
   was blocked and only the errors arrived. Invisible on web. 32 worker tests passed over it.

**The lesson to carry:** for a native surface, "build green + tests green + boundary guard silent"
proves nothing about whether the screen opens. Press the button.

## What is LEFT

### 0. ~~The Text button routes messaging OUTSIDE UPR~~ — DONE 2026-08-09 (`aa3b864a`)

Fixed and verified on the simulator. `LeadContactCard` now calls `openInAppThread`.

**The correction that matters more than the fix:** this document previously said "a repo-wide grep
found no 'open a conversation for this contact' href helper" and called the fix "not a one-liner".
**That was wrong.** `src/lib/openInAppThread.js` was written on 2026-07-27 for the identical bug on
the job/claim/appointment Message buttons; its own header describes the failure in the same words.
It also already decided the nullable-`contact_id` question: no contact → the in-app contact picker,
never a fallback to the OS dialer. The owner-decision question this section asked for was therefore
moot, and no owner decision was needed.

The guard that should have caught it also already existed —
`tests/qa/unit/field-surface-invariants.test.js` bans `sms:` — but it walked only `src/pages/tech`
and `src/components/tech`, while the bug shipped from `src/components/admin-mobile`. Widened.
**Carry this: an invariant does not follow a surface into a new directory.**

Verified signed-in on the simulator, both branches: linked lead → the customer's real UPR thread
with history and composer, back returns to the lead; unlinked lead (112 of 210 live leads) → the
in-app picker. Also fixed: pressing Call painted `#fff` on `#f1f3f5`.

**Still open, named not fixed:** that picker is a bare search box with no lead context and no
"add as customer" path, so a genuinely new caller cannot be texted from this screen. It is safe
(nothing leaves UPR) but it is not good, and it is the majority case.

### 1. ~~Confirm recording playback~~ — DONE 2026-08-09
Cloudflare has redeployed `dev`, so the `64790e3d` CORS fix is live. Verified on the simulator: a
lead's recording streamed 0:03 → 0:10 of 10:04.

### 2. Cut the iOS dev build (owner action — the classifier blocks the agent)
```
gh workflow run ios-dev-testflight.yml --ref dev -f publish_to_testflight=true -f native_push_enabled=true
```
Nothing from this whole initiative is on a phone that is not the simulator until this runs.

### 3. Invoice detail — RUNNING IN ANOTHER SESSION, do not touch
Task `task_2ef34b70`, prompt at `docs/handoff/native-invoice-detail-prompt-2026-08-08.md`. It owns
`collFormat.js`, `AdminInvoiceDetail.jsx`, the `invoice/` subtree, the boundary allowlists and
probably `index.css`. **Check `git log` before editing any of those.** Two sessions already merged
each other's boundary edits tonight; it worked, but only because both stayed narrow.

### 4. Owner decisions still open
- **"Not a Lead" stage flag.** It carries neither `is_won` nor `is_lost`, so its ~24 leads group as
  Working. Tickable in CRM → Settings, but it merges non-opportunities into the lost column and
  changes conversion math. Deliberately not hardcoded by stage name.
- **`upsert_pipeline_stage` / `delete_pipeline_stage` / `crm_disqualify_lead_if_open`** are still
  ungated `SECURITY DEFINER` granted to `authenticated` — **a field tech can delete the company's
  pipeline stages.** Deliberately left out of `20260809050801`: different surface (CRM Settings),
  different decision, and folding it in would have widened an already-large migration. It is the
  most consequential thing still open.
- **`estimates` has ZERO `nav_permissions` rows**, so that office page is admin-only by accident of
  configuration rather than by decision.

### 5. Small, genuinely optional
- `docs/handoff/native-lead-center-{plan,prompt}-2026-08-08.md` are now historical — the plan named
  `billing_edit_access()` as the gate and live evidence overturned it. Either annotate or archive.

---

## Cold-session prompt

Continue the UPR native office-surfaces work in `/Users/moronisalvador/APPS/Utah-Pros-App-Git`.

Read first: `.claude/rules/initiative-status.md` ("Native office surfaces — Phase 5 step 5") and
`docs/handoff/native-lead-center-continuation-2026-08-09.md`. Both are current as of 2026-08-09 and
their evidence is measured — do not re-derive it.

Lead Center is DONE and verified on the simulator; its boundary migration is APPLIED to production
(ledger `20260809050801`). Do not redo either.

Do this, in order:

1. **Fix the Text button (§0) — ask the owner the remove-or-leave question FIRST.** It is
   `<a href="sms:…">` in `LeadContactCard.jsx`, which hands the message to iOS Messages, so the tech
   texts from their personal number: no UPR thread, no CRM record, and it never touches the
   consent/DND chokepoint `AGENTS.md` §14 protects. `tel:` is correct and stays. Wire it to UPR's own
   conversation instead — start at `src/pages/tech/v2/messages/NewConversationView.jsx` and
   `useConvoMutations.js`. `inbound_leads.contact_id` is NULLABLE, so decide deliberately what an
   unlinked lead does rather than letting it render a dead control.
2. **Confirm recording playback on the simulator** once Cloudflare has redeployed `dev`. Build the
   `.dev` app, not `.upr`:
   `xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Dev -sdk iphonesimulator -destination 'id=<udid>' -derivedDataPath <dd> build`
   then `xcrun simctl install <udid> <dd>/Build/Products/Dev-iphonesimulator/App.app`.
   Screenshot with `xcrun simctl io <udid> screenshot --type=png out.png` — the simulator MCP panel
   crashes; if input is needed and it is still dead, drive Simulator.app via computer-use after
   `request_access`, and say so rather than switching silently. **An agent must not sign in**; ask
   the owner to log in.
3. **Do not touch the invoice port** — another session owns it (§3 above). Check `git log` on any
   shared file before editing.
4. Ask the owner about the ungated pipeline-settings RPCs (§4) before designing anything — a field
   tech can currently delete the company's pipeline stages. It is a real hole, but whether it is
   next is their call.

Shared checkout: `git fetch` first, confirm `git rev-parse --abbrev-ref HEAD` says `dev`, stage by
explicit path, reconcile by merge never rebase. A red `npm test` may be another session writing
mid-run — re-run before believing it.

Verify anything you change with `npm run build:ios` + `node scripts/assert-native-dist.mjs` (NEVER
`npm run build`), `npm test` (set `UPR_TEST_LANE`; `tests/qa/unit` is the qa lane),
`npm run test:tooling`, `npm run report:bundle-size`.

Separately authorized, not implied: migration apply, push, PR, `dev → main` promotion, deployment,
a signed native build, TestFlight upload, feature-flag flips, any provider call.
