# Tech Redesign — LOCAL Session Handoff (MacBook / Claude desktop app)

**Written 2026-07-18 by the cloud design session (Session 2, branch
`claude/upr-field-tech-ux-flows-2-zt5bg4`). This is the cold-start dispatch for continuing the
tech-redesign work in a LOCAL Claude Code session on the owner's MacBook** — where the session
gains what the cloud could never have: Safari/WebKit, the iOS Simulator, Xcode, and the owner's
actual iPhone. Read this file first, then follow the read order in §1.

**Why the move matters (proof, not theory):** the Add-visit prototype froze for seconds on the
owner's iPhone. Chromium (the cloud's only engine) rendered it in ~17ms and never showed the bug;
the cause — WebKit instantiating ~89 SVG `<use>` shadow trees — had to be found by deduction.
Locally that bug dies in the first on-device look. Verification moves from "the wrong engine +
owner round-trips" to "the right engine, immediately."

**Owner decisions at handoff (2026-07-18 — settled, don't re-ask):**
1. The repo is **already cloned** on the MacBook — preflight is a verify pass, not a setup pass.
2. The **cloud session stays alive as a standby** (away-from-desk phone sessions, artifact
   publishing, the weekly reminder routine). It does NOT work this branch while local is active.
3. **Design-first, then build:** finish the remaining flows (§5 order — Job Hub loose ends →
   New Job rework → …) before starting Session-3 build work. The §6 blur option stays available
   but only on the owner's explicit ask.

---

## 1. Read order (cold start)

1. **This file** (you are here).
2. `docs/tech-redesign/SESSION-STATE.md` — the save-game: owner decisions (binding — do not
   relitigate), locked flows, the remaining to-do, artifact URLs, working-loop history.
3. `docs/tech-redesign/TECH-DESIGN-STANDARD.md` — the LOCKED design system (Direction B /
   "Apple Field Pro") + §12 flow specs. This is law for every screen you produce.
4. `docs/tech-redesign/prototypes/` — the built artifacts. `kit.html` = foundation;
   `schedule.html`, `job-hub.html`, `new-job-flow.html` = the flows; `full-app.html` = the
   combined clickable app (assembled by `_combine.cjs`); `hydro-b.html` (in mockups/) = drying module.
5. `CLAUDE.md` + `.claude/rules/tech-mobile-ux.md` — repo law. Rules still bind locally
   (no alert/confirm, tokens, 48px targets, commit cadence, etc.).

**Branch:** continue on `claude/upr-field-tech-ux-flows-2-zt5bg4` (33 commits of design work;
everything pushed). `git checkout claude/upr-field-tech-ux-flows-2-zt5bg4 && git pull`.
Do NOT merge to `dev` yet — design session continues; PR when Session 2's deliverables are done.

## 2. Machine preflight (idempotent — skip what already passes)

Design-phase needs (enough to finish + verify every prototype):
- [ ] Repo cloned; on the branch above; `git pull` clean.
- [ ] **Safari** — open any prototype file directly (`open -a Safari docs/tech-redesign/prototypes/full-app.html`).
      This alone is already real WebKit — the single biggest upgrade over the cloud loop.
- [ ] **Xcode + iOS Simulator** — `xcrun simctl list devices | grep Booted` or boot one
      (e.g. iPhone 15 Pro). Serve the prototypes with **`node docs/tech-redesign/prototypes/serve.cjs`**
      (port 8899) and open in the simulator's Safari for true iOS rendering:
      `xcrun simctl openurl booted "http://localhost:8899/full-app.html#s-working@530"`
      (`#s-<screen>` opens a screen directly; `@<px>` scrolls it — simctl can't swipe).
      ⚠ **Never serve with bare `python3 -m http.server` / file://** — the prototypes are HTML
      FRAGMENTS (the artifact wrapper used to add doctype+viewport) and render BLANK on iOS
      without serve.cjs's on-the-fly wrapper (quirks mode + 980px legacy viewport; found 2026-07-17).
- [ ] **Owner's iPhone (same Wi-Fi):** with serve.cjs running, owner opens
      `http://<mac-ip>:8899/full-app.html` in iPhone Safari (`ipconfig getifaddr en0` for the IP).
      This replaces the claude.ai artifact round-trip — instant, and it's the REAL device.
- [ ] Safari **Develop menu** enabled (Settings → Advanced) → attach Web Inspector to the
      simulator/iPhone page for console + timeline when something feels slow.

Build-phase additions (only when the owner says "start building" — see §6):
- [ ] Node ≥ 20, `npm install` at repo root.
- [ ] `.env` from `.env.example` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
      `VITE_GOOGLE_MAPS_API_KEY`) — owner supplies values; never commit them.
- [ ] `npm run dev` serves the real app; phone on same Wi-Fi hits `http://<mac-ip>:5173`.
- [ ] Native shell: `npm run build:ios` (sets `VITE_BUILD_TARGET=native`, runs Vite +
      `cap sync ios`), then open `ios/App/App.xcodeproj` in Xcode (SPM, not CocoaPods) →
      run on simulator or the connected iPhone (needs the owner's signing team selected once).
      Full iOS reference: `UPR-Web-Context.md` → "Native iOS App (Capacitor)".

## 3. The working loop (adapted for local — this supersedes the cloud loop)

1. **Build/edit** the prototype HTML (same files, same kit, same tokens).
2. **Verify WebKit-FIRST:** open in Safari and/or the booted simulator. Chromium/Playwright
   becomes the *secondary* check (programmatic asserts, screenshots for the record) — never the
   primary feel-check again.
3. **Owner reviews on the real iPhone** via the local URL (no artifact publish needed; publishing
   to claude.ai artifacts is now optional, for away-from-desk review only).
4. Owner marks up → apply → re-verify → **lock**.
5. On lock: fold the flow into `TECH-DESIGN-STANDARD.md` §12, update `SESSION-STATE.md`,
   **commit + push** (same cadence as before — every locked round gets pushed; local disks die too).
6. After editing any of the three flow prototypes, **regenerate the combined app**:
   `node docs/tech-redesign/prototypes/_combine.cjs` (path-independent — runs from any clone).

**New rule from the freeze incident:** keep per-screen SVG `<use>` count modest (~40s are fine,
~90 froze an iPhone); never render invisible sprite icons on long lists (emit conditionally instead).

## 4. Now-unblocked checks (fold into every lock — these were "owner-device-gated" before)

- Real scroll feel + momentum, sheet drag, tap latency on the actual iPhone.
- `backdrop-filter` (frosted tab bar) scroll performance under WebKit.
- Safe-area behavior (`env(safe-area-inset-bottom)`, notch/home-indicator) on device.
- Haptics vocabulary (`nativeHaptics.js`) — only meaningful in the Capacitor build (§6).
- Dark mode on a real OLED screen; sunlight-legibility spot checks.
- 60fps-under-throttle checks via Safari Web Inspector timeline (not just Chromium CDP).

## 5. What's locked vs. what remains (mirror of SESSION-STATE — that file is authoritative)

**LOCKED (do not relitigate):** Direction B system + tokens; Schedule (month/day + Add-visit);
Job Hub (5 clock states, adaptive hero, clickable header, action bar, room-first photos, Notes
page w/ titles+photos, Docs page w/ e-sign FAB, Activity); combined app; §12.3–§12.6 specs.

**REMAINING (the to-do, in order):**
1. Job Hub loose ends: Work-Auth compliance ALERT (red banner when unsigned) + Crew row +
   owner picks the drying-module name (Arid / Dry Logs / Evap / …).
2. New Job flow rework (owner wants improvements — get his specifics first).
3. New Customer flow.
4. New Event + Edit/Reschedule Appointment.
5. Hydro/drying WRITE flows (Add-reading, Place/Pull equipment, Chambers).
6. TechClaims list+detail · TechTasks · Messages pane reskin (frozen seams — see
   `.claude/rules/tech-messages-v2-wave-ownership.md`) · TechMore/Help/Feedback (light).
7. Fold each new lock into `TECH-DESIGN-STANDARD.md` §12.

## 6. The Session-3 bridge (design → build), when the owner green-lights it

The plan's arc is unchanged: Session 2 finishes the flows; Session 3 builds them for real.
Locally the wall between them may blur — it's sanctioned to scaffold a locked flow's real screen
while it's fresh, IF the owner asks. When building starts:
- Real code follows ALL repo law: `CLAUDE.md` non-negotiables, `page-lifecycle.md`,
  `loading-error-states.md`, `perf-budget.md`, `motion-standard.md`, tech-v2 + tech-messages-v2
  ownership manifests (frozen files stay frozen — check before touching `src/pages/tech/v2/**`,
  `TechLayout`, `techQuery.js`, etc.).
- New tech-v2-style surfaces go behind feature flags like the existing waves (owner-only until
  opened); zero schema changes without the `db-migration` discipline.
- Verify in this order: Vite in iPhone Safari (fast loop) → Capacitor build on simulator →
  Capacitor on the owner's device (haptics, camera, geolocation, biometric gate).
- The cloud sessions' close-out standard applies unchanged (build+test+lint, reviewer gauntlet,
  minimize/resume test — now on a REAL device, 390px check).

## 7. Coordination with the cloud

- This branch remains the single line of work — local and cloud sessions must not run on it
  simultaneously. The owner decides where a given day's work happens; `git pull` first, always.
- The claude.ai artifacts (`SESSION-STATE.md` §5 URLs) stay valid as published snapshots; refresh
  them only if the owner wants remote viewing.
- The weekly redesign-backlog reminder routine (cloud) keeps running regardless of where work happens.
