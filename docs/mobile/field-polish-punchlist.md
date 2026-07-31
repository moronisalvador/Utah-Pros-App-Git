# Field polish punch list — TestFlight-era small findings

**Started:** 2026-07-29 (first TestFlight build night) · **Owner:** Moroni
**What this is:** a running list of small on-device findings from real field/tech use of the
native app and PWA. One line each. Not for bugs that block work (report those immediately) —
for polish: haptics, spacing, copy, motion, small UX friction.

**How to use with Claude Code:** start a session per THEME (e.g. "haptics pass"), point it at
this file, let it fix the batch, verify per `.claude/rules/tech-mobile-ux.md` +
`motion-standard.md` (haptics/motion changes go through the `review-animations` gate), mark
items done in place with the date. Native-feel items (haptics, gestures) are only fully
verifiable in the next native build — group them accordingly.

**Format:** `- [ ] (severity) surface — what's wrong → expected` · severity: P2 = annoying, P3 = polish

## Open

**Theme: perceived performance**

- [ ] (P2) Notification bell first-open jank — the first tap after every cold app start
      opens the panel at slideshow frame rate (feels "buggy, maybe 5 FPS"); every
      subsequent open is smooth. Likely cause: the panel's lazy chunk loads + parses
      during the open animation. Fix shape: idle-preload the chunk after shell mount
      and/or gate the open animation on content readiness (perf-budget.md +
      motion-standard.md §5 govern). (Found 2026-07-29, TestFlight 1.0.0 (1), recurs
      every cold start.)

**Theme: platform tech-debt**

- [ ] (P2) UIScene lifecycle migration — the iOS 27 SDK (Xcode 27 beta) hard-traps the
      app at launch because the Capacitor AppDelegate still uses the classic lifecycle
      (verified on-device 2026-07-29, EXC_BREAKPOINT in UIKit's launch check). Fine
      today (CI pins Xcode 26.6), but must land before Apple's toolchain requirement
      catches up. Check Capacitor 8 upstream for official UIScene support first.
      (Details: docs/mobile/dev-app-variant.md caveats.)

**Theme: notifications surface (feature-sized — may fold into the onboarding session)**

- [ ] (P3) Settings → Notifications — tapping the section should open a dedicated
      notifications page: activate/deactivate push plus per-type customization (the
      per-type self-recipient config that already exists server-side). (Owner request
      2026-07-29.)

**Theme: message legibility / accessibility**

- [ ] (P2) SMS thread text is hard to read — **repository release candidate implemented
      2026-07-31; device/release proof remains.** Owner reports thread body copy is
      genuinely hard to read in normal field use → rework size, weight, contrast and
      bubble density so a thread is comfortably readable one-handed, outdoors, moving.
      Run it through the `impeccable` design skill plus `design:accessibility-review`
      (measure real contrast ratios and dynamic-type behaviour rather than eyeballing).
      The bubble is shared — `src/components/conversations/MessageBubble.jsx` — so one
      fix reaches `/conversations`, the CRM wrapper and the tech v2 pane together;
      that also makes it a frozen consumed contract (tech-messages-v2 imports it), so
      additive changes only. Candidate uses the shared 18px mobile type token and quiet
      sender labels above every staff message and every customer message in a multi-recipient
      chat. Physical iOS/Capacitor readability proof remains. (Owner request 2026-07-30.)

**Theme: conversation participants (feature-sized — finishing parked work)**

- [ ] (P2) Manual participant control — **repository release candidate implemented
      2026-07-31; database/deployment/device gates remain.** `conversation_participants`
      represents customer recipients, not internal staff. Staff visibility now has separate
      forced-RLS `conversation_member_overrides` and `conversation_default_members` tables:
      active internal admins can add/remove technicians per chat and choose default technicians;
      eligible technicians can remove themselves; privileged office roles cannot be removed.
      Tap the conversation title in the tech thread to expand its info, then open
      **Chat participants**. Source includes paired rollbacks, credential-free contracts, and
      isolated behavioral SQL; the latter still needs a disposable database run.
      (Owner request 2026-07-30.)

      Future dry-log lifecycle (context only, explicitly deferred): after the final appointment
      marks a mitigation job dry and equipment picked up, derived mitigation technicians should
      fall out automatically unless privileged or manually re-added. Until rooms/dry logs and that
      lifecycle exist, removal is manual or technician self-leave.

**Theme: secondary contacts on a thread (feature-sized — sequenced after participant control)**

- [ ] (P2) Add a client's secondary contact into the chat — no way to pull a spouse,
      insurance agent or adjuster into an existing claim/client thread → staff can add a
      secondary contact from the client or claim record straight into that conversation.
      **Two constraints found 2026-07-30 — both need an owner decision before design:**
      **(a) group is recognised, but CallRail is not a group provider.**
      `send-message.js:534` already branches on `type === 'group' || 'broadcast'`, so
      multi-recipient threads are understood — but `:541-549` explicitly refuses CallRail
      for anything that is not 1:1 (`CALLRAIL_PURPOSE_UNSUPPORTED`). "CallRail is just
      Twilio behind the scenes" therefore does not hold at our send path as written: a
      group thread runs on Twilio, or lifting that refusal is its own reviewed change.
      **(b) consent is per-person, and group is stricter than 1:1.** The 2026-07-28
      opt-out-only rule (`IMPLIED_CONSENT`) covers staff 1:1 service SMS only; group and
      broadcast still accept `GLOBAL_OPT_IN` only
      (`.claude/rules/sms-experience-wave-ownership.md` §13). An adjuster or agent added
      to a thread is a new recipient carrying their own consent, DND and STOP state — none
      of it inherited from the client. Pick the intended lane before building.
      (Owner request 2026-07-30.)

**Theme: conversation list interaction**

- [ ] (P3) Swipe actions on the conversation row — replace the reveal-below overflow with
      the native iOS idiom → swipe left/right on a row reveals archive + mark unread, and
      the "⋯" stays as the visible, non-gesture path to the same actions.
      **Why the current one feels detached (confirmed in code 2026-07-30):** it isn't a
      floating dropdown, but it does render as a new block BELOW the row
      (`ConvoRow.jsx:100`, `showActions && <div className="tv2-msgs-row__actions">`), which
      shoves every row beneath it down — so the action reads as belonging to the gap, not
      to the thread you tapped. It also unmounts instantly on close with no exit, which
      `motion-standard.md` §3 already classes as a defect. This is a real fix, not taste.
      **Keep the "⋯" — it's required, not a redundant fallback.** Swipe is an invisible
      gesture; the `tech-mobile-ux.md` persona (64, gloved, one hand, sunlight) and
      VoiceOver both need a visible affordance, and Apple's own rule is that a swipe action
      always has a non-gesture equivalent.
      **One push-back for the owner to settle:** let the "⋯" reveal the SAME inline
      actions, but not by replaying a fake swipe. `motion-standard.md` §6 is explicit that
      finger-driven drag is a separate mechanism and a canned imitation of it "reads dead".
      A tap should snap the actions open crisply (fade + slide, ≤ `--motion-duration-base`,
      `--motion-ease-standard`); the SWIPE gets the real 1:1 finger tracking with velocity.
      Same end state, motion matched to its input.
      **Two gates before build:**
      (a) `motion-standard.md` §6 sanctions exactly three gesture surfaces (bottom-sheet
          drag-to-dismiss, `PullToRefresh`, swipe-to-dismiss toast) — "nothing else". A
          swipe-to-reveal list row is a FOURTH, so it needs an explicit owner extension of
          that list. **And the util it says to reuse does not exist** (checked 2026-07-30):
          no gesture/spring util in `src/lib/`, `PullToRefresh.jsx` runs on raw
          `onTouchStart/Move/End` rather than pointer events, `setPointerCapture` appears
          only in `CrmLeads.jsx:790` (the ad-hoc kanban drag §6 itself flags), and there is
          no bottom-sheet drag-to-dismiss. So the sanctioned path has to be BUILT first.
          The Framer Motion / GSAP / react-spring ban stands regardless.
      (b) Archive is half-built, not missing (corrected 2026-07-30 — an earlier note in
          this entry wrongly called it a new column). `conversations.status` already
          accepts `'archived'` (CHECK constraint, `20260709_sms_f01_drift_capture.sql:82`),
          a partial index already excludes archived rows (`:91`), and
          `get_tech_conversations` already accepts a `p_status` filter. What is missing:
          nothing anywhere SETS a conversation to archived, and the default list view
          (`p_status IS NULL`) returns archived threads along with everything else — so
          archiving today would hide nothing. Changing that default is a live-RPC contract
          change (`CREATE OR REPLACE`, same signature, new params `DEFAULT`, committed
          backward-compat test). Archived threads also need a way back —
          `loading-error-states.md` §5 forbids a silent dead-end.
      Skills: `apple-design` (gesture + spring feel) plus `emil-design-eng`.
      `review-animations` is a MANDATORY close-out gate here, and the on-device iPhone
      check stays owner-gated — Playwright proves behaviour, never feel.
      (Owner request 2026-07-30.)

## Done

**Theme: trapped screens / navigation escape hatches (fixed as one batch, 2026-07-29)**

- [x] (P2) Document signing screen — fixed 2026-07-29, commit acd7927e. The trapped
      surface is SignPage (`/sign/:token`), reached in-app by the tech "Collect
      signature on-site" flow; it now renders an escape hatch on every state when
      in-app history exists (header Back, Back bar on error/expired/signed cards,
      Done on the completion card). Abandon is safe — nothing is written before the
      atomic submit. The public customer link intentionally stays unchanged (no
      in-app history → no controls).
- [x] (P2) Legal & Support pages — fixed 2026-07-29, commit acd7927e. Standard chevron
      Back on all three (Legal.jsx LegalLayout): always visible in the tech shell at
      /tech/legal/* (fallback /tech/settings), history-gated on the public copies so
      the pre-login Login-footer path works and a cold direct visitor keeps the plain
      document. Cross-links now stay inside /tech/legal/* in the tech shell.
- [x] (P2) Job screen back button — fixed 2026-07-29, commit a7f27445. Origin-aware via
      new src/lib/backNav.js (React Router history idx): pops to the real origin
      (dashboard / schedule / claim / messages / push deep link); claim page only as
      the no-history fallback, '/tech' when the job has no claim. Applied to
      TechJobDetail + v2 TechJobHub/HubHeader (incl. not-found screens) and the
      Album/Documents "Back to job" buttons (pop, no duplicate history entries).
      Hub back control also brought up to the 44px tap floor + press feedback.

**Theme: haptics consistency**

- [x] (P3) Tech nav bar — tab presses have no haptic feedback, while the notification bell
      and the header trio by the technician's name feel great. Expected: primary nav taps
      match the dashboard header buttons' haptic (via src/lib/nativeHaptics.js, per
      motion-standard.md §4). (Found 2026-07-29, TestFlight 1.0.0 (1), iPhone 17 Pro Max.)
      **Done 2026-07-29, commit `86b00fc2`** — `impact('light')` on tab tap (the exact
      bell/header-trio pattern; `selection()` deliberately not used — the reference the
      owner praised is the impact tick) + the standard `:active` scale(0.97) press on
      `.tech-nav-tab` with reduced-motion collapse. Haptic FEEL check on device pends the
      next native build (code path pinned by `tests/qa/unit/tech-nav-haptics.test.js`).
      Office/CRM shells deliberately untouched: the native app mounts only `/tech/*`.
- [ ] (P3) Tech shell side-tab accent border (TechLayout.jsx ~L609) — design hook flags the
      thick one-side accent; consider a subtler treatment in the next design pass.
      (Flagged 2026-07-30 during overnight merge; pre-existing.)
- [ ] (P3) Side-tab accent borders (Layout.jsx ~L327, TechLayout.jsx ~L609) — design hook flags
      the thick one-side card accent; revisit in a design pass. (Flagged 2026-07-30; pre-existing.)
- [ ] (P3) Dark-theme status colors: 4 files reverted from the 2026-07-30 sweep because they
      carry unrelated lint debt the changed-files ratchet requires clearing —
      TimeTracker (exported helpers → own module), StalledWidget (load-in-effect hooks
      pattern), ClockSupersedeSheet + TechOOPPricing (style consts used before definition).
      Clear the debt, then re-apply the token swap. They keep frozen light-tone status
      colors in dark theme until then.
