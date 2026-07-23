# Close-Out Standard

**Last verified:** 2026-07-23

Linked from `CLAUDE.md` and every wave-ownership manifest. **The single canonical checklist every
session runs before handoff or an authorized publication step.** Manifests reference this file and list only their *deltas* (extra
reviewers, migration steps) rather than restating it. Born from the UX audit's finding that the default
direct-to-`dev` workflow had zero gates and "visual check" was too vague to catch the resume/loading
bugs that reached techs.

## The checklist

1. **Build + test + lint.** `npm run build` (clean) · `npm run test` (green) · `npx eslint <changed
   files>` (zero NEW findings beyond the recorded baseline — the changed-files ratchet in
   `eslint.config.js` enforces this).
2. **Reviewer gauntlet** (run the ones relevant to the diff; a manifest may add more):
   - `upr-pattern-checker` — CLAUDE.md non-negotiables (always, on any `src` change).
   - `design-consistency-checker` — tokens/kits/components (any `src/pages`|`src/components` change).
   - `review-animations` — the **motion feel-gate** · **MANDATORY** for any PR touching
     motion / transitions / animation (a new or changed `@keyframes` / `transition`, View-Transition
     wiring, a `--motion-*` token, gesture/spring code, or a `.claude/rules/motion-standard.md` change).
     This is a **craft** gate — *keep-or-delete*, one justified purpose per animation, easing / duration /
     origin / interruptibility, and frequency-appropriateness — and is **distinct from** the uniformity
     checkers beside it: `design-consistency-checker` proves the token is *right*; `review-animations`
     proves the motion *feels* right and should exist at all. It is a **skill invoked by name** (it does
     not auto-fire), and per its posture **approval is earned, not assumed** — a motion that merely runs
     is not a pass. Companion for authoring a wave's motion work list: `improve-animations` (read-only,
     produces the recon → frequency-map → per-fix plans).
   - `page-behavior-checker` — lifecycle/loading/error (any `src/pages`|`src/components` change).
   - `migration-safety-checker` + `anon-grant-auditor` — any `supabase/migrations/` or database
     grant/catalog change.
   - `consent-path-auditor` — any send-path change.
   - `worker-security-reviewer` — any changed worker that returns non-public data or causes a side
     effect; SQL/catalog review remains with the database reviewers.
3. **Minimize / resume test (NEW — mandatory for any page change).** Background the PWA (or hide the
   browser tab) for 30s+, then resume. **Nothing may happen:** no blank content, no spinner flash, no
   route loss, no scroll loss, no lost form input. (See `page-lifecycle.md`. Note in the PR when a step is
   owner-device-gated because it needs a real installed iPhone.)
4. **390px mobile viewport check (NEW).** Every touched page, in both shells, at a 390px-wide viewport —
   no horizontal scroll, tap targets ≥ 48px on tech surfaces, no clipped content.
5. **Loading / empty / error states reviewed.** Force a load failure and an empty result on any list you
   touched — confirm `ErrorState`/`EmptyState` render correctly (never a blank page or the success
   empty-state on failure — `loading-error-states.md`).
6. **Perf delta (NEW).** Compare `npm run build` output against `perf-budget.md`; record the top-5 chunk
   deltas in the PR; flag any new render-blocking asset.
7. **Motion verification (NEW — motion PRs only).** For any PR touching motion / transitions / animation,
   run the Playwright motion harness (`playwright-core`) as a close-out expectation, on three CI-runnable
   axes: an **rAF FPS-under-throttle** probe (≥ 55fps under 4× CPU throttle) on the **route push + one
   sheet**; a **reduced-motion end-state** spec (`emulateMedia({ reducedMotion: 'reduce' })` — motion
   collapses to instant, the end-state still lands, focus-trap / `aria-live` intact); and **visual / token
   regression** (`toHaveScreenshot({ animations: 'disabled' })` + `toHaveCSS` pinning
   `transition-duration` / easing / color). Mock the Supabase RPCs (`page.route`) and freeze `page.clock`
   for determinism. **Honest caveat — state it in the PR:** Playwright runs **Chromium**, so it verifies
   *behavior and regressions*, **NOT true iOS-Safari / WKWebView feel** — the gesture fling, real Taptic
   haptics, and the 60fps-scroll-under-`backdrop-filter` question stay an **owner on-device iPhone check**
   (note it in the PR like the minimize test).
8. **Docs.** Update `UPR-Web-Context.md` (Rule 9). Bump the `Last-verified` stamp on any standard/design
   section the session relied on or changed. Refresh any hand-counted number you touched.
9. **Re-measure your slice** of the initiative's baseline metrics table (if the initiative has one) and
   reconcile the roadmap checkboxes **both directions** (nothing marked done-to-look-finished; nothing
   finished left as todo; owner-blocked stays open with the reason disclosed).
10. **Delete TEST rows** created during verification.
11. **Publish only when requested.** Without explicit commit/push/PR authorization, stop with the diff,
    verification report, and owner gates. When publication is requested, use `CLAUDE.md`'s current
    routine-versus-wave workflow. Sessions never click-merge or treat a provider/flag prerequisite as
    authorization; live flag flips are separately owner-authorized.

## Standard agent output format (all reviewer agents)

Every checker returns: a one-line **verdict** (`pass` / `changes-requested` / `blocker`), then a numbered
list of findings, each `severity` (`blocker` / `major` / `minor`) · `file:line` · the **rule** it
violates · a **minimal fix**. No prose walls; the fix must be actionable in one edit.
