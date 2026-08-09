# WIP Triage — 2026-08-04

**Scope:** every unmerged remote branch (55), every closed-unmerged PR (15), every dirty local
worktree (13). Method: independent triage agents per batch, then an adversarial verify pass that
re-checked every consequential verdict against current `origin/dev` by blob/symbol comparison —
"not merged" was never accepted as evidence of value, and "superseded" was never accepted without
locating the replacement. 46 agents, ~750 verification tool calls.

**Headline: nothing of substance has been lost.** The two-week pile is almost entirely work that
*landed by another route* — squash merges, relands, and successor branches that git ancestry
cannot see. The genuinely-open remainder is small and now registered in `docs/wip/`.

---

## 1. Genuinely open work (registered in `docs/wip/`)

| Item | What | Next action |
|---|---|---|
| PR #582 `codex/notification-producer-crew-phase-a-reconcile` | Compose 5 contained notification producers with live Crew Phase A · **P0 gate** | Owner lifts draft hold, authorizes exact-head review/merge |
| `codex/mobile-readiness-reminder-activation` | Delivery-claim layer the appointment reminder needs before re-enable | Open PR at qualified head; gauntlet + db reviewers at that SHA |
| `codex/qbo-picker-controls` | DatePicker keyboard a11y + lint ban on native pickers | Rebase; regenerate eslint ratchet baseline; gauntlet |
| `claude/upr-tech-redesign-continued` | 2 owner design rulings existing nowhere else (Carrier optional; claim-ID split) | Merge the two docs-only commits (1d81e2ce, 302eb14b) |
| `claude/upr-crm-dashboard-gap-e0e8ba` (PR #496) | Dev test asserts the OPPOSITE of an applied production migration | Cherry-pick the 3 corrected test files only |
| `claude/standardize-claim-tiles-NRRJe` | False "Imported" badge hides un-imported Encircle claims | Cherry-pick one line: `&claim_id=not.is.null` in Customers.jsx |

Plus one spun-off finding (chip created): **3 workers with session-only auth** —
`stripe-accounts.js`, `analyze-xactimate.js`, `collections-chat.js` use an inline `isAuthorized()`
that proves only that the token resolves; no role, no active-employee predicate (AGENTS.md §16).

## 2. Keep, do not resume (ARCHIVE)

- **`codex/native-ios-plan`** — only copy of the owner-accepted 8,550-line native-Swift blueprint.
  Never delete; revisit when the native decision reopens.
- **`codex/mobile-readiness-conversation-notifications`** — design reference for per-conversation
  notification mute, the one capability in it dev still lacks. Keep read-only.
- **`rescue/*` (both)** — deliberate archives, protected by policy.

## 3. Delete after a 1-minute extraction

- **`claude/openscad-curtain-rod-mount-r76szw`** — only copy of a personal 282-line OpenSCAD
  curtain-bracket model. Copy the `.scad` file somewhere personal first; it does not belong in
  this repo.
- **`claude/security-bug-audit-uonb4b`** — fully superseded once the 3-worker auth chip lands;
  also noted: dev's `.gitignore` lacks the branch's `*.pem/*.key/*.p12/*.mobileprovision` patterns.
- **`fix/migration-hygiene-windows-path`** (PR #551) — one 3-line NOTES comment about the Windows
  `URL.pathname` trap is worth copying into `check-migration-hygiene.mjs` first.

## 4. Safe to delete — 45 remote branches

Every one verified superseded or obsolete by the two-pass check. Split by recoverability:

**24 had a PR** — commits stay reachable on GitHub forever after deletion (fully reversible):

```
agent/reconcile-mobile-current-origin-lease-20260729  claude/db-foundation-phase-f-pne5kb
claude/notify-center-event-wiring-oni7yv              claude/phase-f1-web-push-pm0157
claude/quickbooks-payment-matching-routine-rok5b9     claude/roadmap-progress-page-rw8vph
claude/session-c-my-preferences-jm3e7x                claude/session-d-admin-defaults-6p0vxi
claude/settings-p2-integrations-e67rj3                claude/tech-msgs-v2-foundation-8gawvm
claude/tech-msgs-v2-b1-core-5gqbi3                    claude/tech-msgs-v2-b2-polish-6yam75
claude/upr-form-submission-missing-4ryb6n             claude/upr-houzz-pro-automation-99jdjs
claude/ux-fb-backend                                  claude/ux-fs2-primitives
claude/ux-liquid-glass-proto                          claude/ux-view-transitions
claude/waiting-for-command-e59v4y                     claude/webflow-lead-webhook
codex/mobile-readiness-capgo-validate-portability     codex/mobile-readiness-current-origin-review
roadmap-to-main                                       schema-v2/p0-map
```

**21 had no PR** — deletion removes the only remote copy (still superseded; content verified
present in dev, but there is no PR safety net):

```
audit/mobile-pwa-production-readiness      chore/tooling-governance-pilot
claude/app-commercialization-viability-r2gg7d  claude/capacitor-phase-1-setup-iUth7
claude/create-api-endpoints-sXfgx          claude/dreamy-lamport-xji9jl
claude/fix-schedule-client-search-3twfJ    claude/fix-work-auth-404-oedf8
claude/funny-edison-1w1dko                 claude/gallant-wozniak-wlllqb
claude/laughing-faraday-d3us94             claude/lint-errors-warnings-uc4k7b
claude/qbo-send-invoice-button             claude/remove-sms-consent-check-e15260
codex/invoice-send-review-activity         codex/messaging-transport-phase-1
codex/mobile-readiness-notification-parity demo-sheet-encircle-autolink
demo-sheet-job-linkage                     demo-sheet-on-main
demo-sheet-on-main-v2
```

Deletion is owner-gated: run `git push origin --delete <branch>` per batch, or ask a session to
do it under explicit authorization. Local counterparts then fall to `npm run worktrees:clean`.

## 5. Closed-unmerged PRs — all 15 accounted for

13 × LANDED_ELSEWHERE (successor named and verified in each case), 2 × PARTIAL:

- **#496** (CRM reporting) — the branch's test corrections never landed; registered above.
- **#224** (security audit) — the site-wide CSP Report-Only header never shipped; already tracked
  as remediation-backlog item 28/SEC-002. Not re-tracked here.

Notable verified-dead: #563 conversation participants (superseded by #566/v2, 63 of 66 files
matched; the 3 absent files were deliberate replacements), #546 schema-v2 usage map (landed as
docs), #519/#282 release PRs (content merged via later trains).

## 6. Dirty local worktrees — 13 judged, 4 hold real work

The two worktrees with RUNNING sessions (`wonderful-bouman-b25f68`, `nervous-meitner-af0f01`/PR
#585) were deliberately not judged. Every REDUNDANT verdict below was independently re-diffed:
each dirty hunk was located verbatim in a pushed dev commit before the verdict stood.

**KEEP — uncommitted work that exists nowhere else (registered in `docs/wip/`):**

| Worktree | Session | What's uncommitted |
|---|---|---|
| `inspiring-tesla-8b829c` **RISKY** | Fix NOT_AUTHORIZED in 7 QBO receipt RPCs | Complete repair for grouped receive-payment (**feature has never worked**): migration `20260805010000_qbo_receipt_service_role_check_repair` + rollback + tests. Base 14 commits stale — reconcile before commit. |
| `epic-blackburn-d8654f` **RISKY** | Reconcile 2 QBO/UPR invoice drift cases | `docs/qbo-invoice-drift-2026-08-04.md`, only copy: 5 discrepancies reconciled, 3 proven deliberate, 3 repairs owner-gated. |
| `vibrant-einstein-fa6091` | Reclaim index.css headroom | Verified dead-CSS sweep, −36,142 bytes / −1,287 lines / 183 dead classes. Port onto current dev; do not commit the stale-based file. |
| `kind-grothendieck-9f41f6` | Audit eslint ratchet baseline | Baseline covers only 16 of ~103 debt-carrying files; reusable capture script authored. Blocked on an owner decision (82-file baseline expansion vs the shrink-only rule). |

**DISCARD-SAFE — 8 REDUNDANT + 1 JUNK, every hunk verified present in pushed dev commits:**
`dazzling-mestorf-d3028f` (sweep landed as `e6eedcf6`; 4 files deliberately reverted in `a282ad01`
as a tracked punch-list item — do not resurrect the dirty copies), `nervous-cori-247144` (LES-01
landed; dirty copies strictly older than dev), `eager-wright-a9dd16`, `jovial-taussig-c78195`,
`mystifying-khorana-24631d`, `suspicious-pascal-e43b4a`, `jovial-jemison-b7137c`,
`crew-phase-a-recovery-20260803`, and `Utah-Pros-App-Git-main-xcode` (1 build artifact).

Discarding uncommitted files is unrecoverable, so even the discard-safe set stays owner-gated:
confirm the sessions won't resume, then remove the worktrees.

**Not triaged: the 3 stashes.** `stash@{0}` (scheduled-message hardening pre-reconcile),
`stash@{1,2}` (s1h identity/device-preferences drafts). Existing memory says the s1h migration
they relate to is retired/DO-NOT-APPLY, so they are likely dead — but no agent verified their
contents against dev. Review by hand before any `git stash drop`.

## 7. Outside this repo (flagged, not triaged)

- **utah-pros-website: PRs #19, #20 open and untouched since 2026-07-19** — the oldest open work
  anywhere.
- **XactimaPro:** 4 abandoned worktree sessions from 2026-07-20..22 (ESX sketch geometry,
  Symbility parser variant, 2 UI fixes).

## Method note

Verdict changes forced by the adversarial pass (3 of 55): `openscad` OBSOLETE→ARCHIVE (only copy
of a personal file), `security-bug-audit` SUPERSEDED→ARCHIVE (live 3-worker gap found),
`conversation-notifications` SUPERSEDED→ARCHIVE (per-conversation mute genuinely missing). PR pass:
#496 LANDED_ELSEWHERE→PARTIAL. One triage evidence string was caught overclaiming ("not one of 48
paths absent" — one path was archived, not present); conclusion stood, claim corrected. The
remaining 51 verdicts survived attack unchanged.
