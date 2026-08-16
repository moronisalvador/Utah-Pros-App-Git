# New-Mac migration — read this first

**Written:** 2026-08-15, on the old Mac, before a machine change that wipes all local state
(including every Claude Code session transcript).
**Audience:** the first Claude Code session on the new Mac, and the owner.

Everything in this file was verified on the old machine at the time of writing, not assumed.

---

## 1. What is already safe (nothing to do)

All of it lives on GitHub and comes back with `git clone`:

- **`dev` and `main`** — all merged work. `dev` was at `ec207b50` when this was written.
- **Every open PR** — see §4 for the live list and what each one is blocked on.
- **21 `rescue/*` and `codex/*` branches**, including two pushed during this migration:
  - `codex/admin-mobile-p4c-production` — **80 commits that existed only on the old disk.**
  - `rescue/codex-a94b-2026-08-15` — a detached-HEAD worktree carrying `b139ade0`
    *"feat(mobile): ship guarded invoice editing and payments"*. That commit is **not** an
    ancestor of `dev`; its file content shipped through other commits, but this branch is the
    only home of that history. Do not delete either branch.
- **`docs/`, `.claude/rules/`, `AGENTS.md`, `CLAUDE.md`** — all project law, versioned.
- **`docs/wip/`** — the WIP register (`npm run wip`).

## 2. What only existed locally — now snapshotted here

### Claude memory (38 files)

Claude Code's per-project memory lived at
`~/.claude/projects/-Users-moronisalvador-APPS-Utah-Pros-App-Git/memory/` and is **not** part of
the repo. A verbatim snapshot is committed at
[`docs/handoff/claude-memory-snapshot-2026-08-15/`](claude-memory-snapshot-2026-08-15/).
Scanned for secrets before committing; none found.

**On the new Mac, restore it:**

```bash
mkdir -p ~/.claude/projects/-Users-moronisalvador-APPS-Utah-Pros-App-Git/memory
cp docs/handoff/claude-memory-snapshot-2026-08-15/*.md \
   ~/.claude/projects/-Users-moronisalvador-APPS-Utah-Pros-App-Git/memory/
```

If the new machine's home directory or repo path differs, the project-slug folder name changes
with it — create the folder that matches the new path and copy into that.

This snapshot is a **restore artifact, not the live memory.** Once restored, memory evolves in
`~/.claude`; this directory will go stale. Re-snapshot before the next machine change rather
than trusting it.

Highest-value entries, so they are not skipped:

| File | Why it matters |
|---|---|
| `testflight-release-policy.md` | The official app is **frozen**; only UPR Dev builds may be dispatched. |
| `photo-capture-flow-doctrine.md` | Owner rulings on the camera: instant open, one identical camera, shoot-&-save, and the composer `[+]` exception. |
| `agent-runs-the-session-fleet.md` | Owner put Claude in charge of coordinating sessions; lists what still escalates. |
| `swift-native-plugin-pattern.md` | The proven app-local Swift plugin recipe (`.overFullScreen`, pbxproj wiring). |
| `review-instruction-is-a-hypothesis.md` | Trace blast radius before applying a reviewer's fix — it has prevented real regressions twice. |
| `driving-ios-simulator-for-ui-verification.md`, `ios-sim-panel-metal-crash.md`, `sim-app-local-plugin-availability-flake.md` | Simulator traps that each look exactly like an app bug. **May not apply to the new Mac** — re-verify rather than assuming. |
| `mobile-ux-design-doctrine.md`, `job-hub-wave2-spec.md`, `field-pro-is-the-native-rewrite-target.md` | Owner design decisions that are expensive to re-derive. |

### What is gone and cannot be recovered

- **Session transcripts.** Their durable content is what was written into `docs/`,
  `.claude/rules/`, PR bodies, and memory. That is deliberate — those are the artifacts.
- **The session ledger** (`.claude/session-ledger.json`, gitignored) — a diary of which session
  left what dirty. Harmless to lose.

## 3. What the new Mac must recreate (cannot be committed)

| Thing | Why | How |
|---|---|---|
| **`.env.local`** | Gitignored secrets. 366 bytes on the old Mac: `VITE_SUPABASE_URL`, the **publishable** key, and the dev-login test credentials. **Never commit these.** | Recreate by hand. Without it, some unit tests fail at import with `supabaseUrl is required` — that is the missing file, not a broken test. |
| **Xcode + iOS platform** | Native builds. Old Mac used an Xcode **beta** whose toolchain has **no `Simulator.app`** — the sim is driven through an app called **Device Hub** instead. | Install Xcode; if the new one ships a normal `Simulator.app`, the sim-driving memory notes are obsolete. |
| **Apple signing / TestFlight credentials** | Signed builds. | Sign in to Xcode with the team account. |
| **MCP server auth** | Supabase MCP, GitHub, Slack, etc. all needed OAuth on the old machine. | Re-authorize in an interactive session (`claude mcp`, `/mcp`) or via claude.ai connector settings. |
| **`gh` CLI auth** | Everything in the release lane. | `gh auth login`. |
| **`npm install`** | Not committed. | Run it. In a **worktree**, `npm install` rewrites `package-lock.json` (strips `libc` fields) — revert the lockfile before staging. |

## 4. Work in flight — open PRs and what each is blocked on

Reviewed on 2026-08-15; findings are posted as comments on each PR.

| PR | What | State |
|---|---|---|
| **#660** | tech-msgs bounded re-prove grace | **Blocked by ruling.** It keeps message bodies on screen during the grace; the owner ruled content must be hidden. Fix: keep the shell mounted (scroll/draft/route) but render the loading state instead of the bodies. |
| **#662** | iOS photo permission strings | Strings are right; the doc + test falsely claim the app never writes to the camera roll. It does — the share sheet's `saveToCameraRoll` runs in-process and **requires** `NSPhotoLibraryAddUsageDescription`. Fix the record so nobody deletes that key. |
| **#663** | dark-shell `color` resolution | Real fix; wrongly claims the affected page is the public `/status`. It is the flag-gated `/crm/roadmap`. |
| **#664** | desktop resume follow-up | Proved by mutation it cannot leak bodies. One regression: the linked-job chip vanishes on every expiry resume and never returns. |
| **#665** | reminder activation groundwork | Containment holds (no flag, cron, or send path enabled — verified 4 ways). Writes a "qualified" claim into `.claude/rules/` that its own body calls void; 4 inputs drifted by hash. |
| **#666** | picker accessibility (DatePicker) | Ratchet is clean. Stale-base doc debris **reverses a money-surface containment record**; DatePicker never restores focus on close. |
| **#667**, **#669**, **#670** | job-hub wave-2 docs/build, native allowlist | Not yet reviewed. #667 is a draft. |
| **#622**, **#623**, **#582**, **#590** | Predate this wave | Each carries its own owner-gated steps. Not touched. |

## 5. Standing owner gates — none of these were done

1. **Simulator sign-in.** The old sim's stored UPR login was dead, blocking every in-app agent
   verification. On the new Mac the sim is fresh, so this is required before any signed-in UI check.
2. **UPR Dev TestFlight dispatch.** The whole native camera wave — shutter, flash, flip,
   pinch-zoom lens switching, streamed instant saves, the composer `[+]` menu — has **never run on
   real hardware**; the simulator has no camera. Official app stays frozen.
3. **`dev → main` promotion.** Last promotion was 2026-08-14 (PR #638). Everything merged since is
   on `dev` only. Provenance evidence must be re-captured inside its 6-hour window at promotion time.
4. **Associated-domains device check** before the next *official* iOS build — entitlements compile
   into the binary, so it is inert in the repo and only testable from a signed build.
5. Any migration apply, provider/flag activation, or money action — as always.

## 6. First moves on the new Mac

```bash
git clone https://github.com/moronisalvador/Utah-Pros-App-Git.git
cd Utah-Pros-App-Git && npm install
# restore memory (§2), recreate .env.local (§3), gh auth login
npm run build && npm test        # expect three green lanes
npm run wip                      # unfinished ship-bound work
npm run worktrees                # will be empty on a fresh machine — that is correct
```

Then read, in order: `AGENTS.md` → `CLAUDE.md` → `.claude/rules/initiative-status.md` → this file.

**One caution:** several memory entries describe traps specific to the old machine (the Metal
crash in the simulator panel, the missing `Simulator.app`, plugin-availability flakes on that
beta macOS). Treat them as "was true there," verify before relying on them, and delete the ones
that no longer apply rather than letting them mislead a future session.
