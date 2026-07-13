# Close-Out Standard

Linked from `CLAUDE.md` and every wave-ownership manifest. **The single canonical checklist every
session runs before opening its PR.** Manifests reference this file and list only their *deltas* (extra
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
   - `page-behavior-checker` — lifecycle/loading/error (any `src/pages`|`src/components` change).
   - `migration-safety-checker` + `anon-grant-auditor` — any `supabase/migrations/` or worker-auth change.
   - `consent-path-auditor` — any send-path change.
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
7. **Docs.** Update `UPR-Web-Context.md` (Rule 9). Bump the `Last-verified` stamp on any standard/design
   section the session relied on or changed. Refresh any hand-counted number you touched.
8. **Re-measure your slice** of the initiative's baseline metrics table (if the initiative has one) and
   reconcile the roadmap checkboxes **both directions** (nothing marked done-to-look-finished; nothing
   finished left as todo; owner-blocked stays open with the reason disclosed).
9. **Delete TEST rows** created during verification.
10. **Push `-u`, open a PR into `dev` as a handoff, and STOP.** The owner/orchestrator merges; sessions
    never subscribe to / babysit / click-merge their own PR. Flag flips are the owner's.

## Standard agent output format (all reviewer agents)

Every checker returns: a one-line **verdict** (`pass` / `changes-requested` / `blocker`), then a numbered
list of findings, each `severity` (`blocker` / `major` / `minor`) · `file:line` · the **rule** it
violates · a **minimal fix**. No prose walls; the fix must be actionable in one edit.
