---
name: shared-checkout-index-and-head-betray-commits
description: "In the shared main checkout, git commit takes another session's staged files, and HEAD can be on someone else's branch — sync checks do not detect either"
metadata: 
  node_type: memory
  type: project
  originSessionId: e0df90d1-5e5b-4891-b899-d1efad5387c7
  modified: 2026-08-14T19:52:37.705Z
---

Two ways the shared checkout at `/Users/moronisalvador/APPS/Utah-Pros-App-Git` corrupts a commit.
Both measured 2026-08-09 (release night); neither is caught by the checks people actually run.

## 1. `git commit` commits the INDEX, not the paths you just added

Sessions share one index. Another session's `git add` leaves files staged; your later `git add <path>`
+ `git commit` sweeps **all of them** into your commit.

Measured: `a38cc4b2` ("docs(handoff): …") shipped `perf-budget.md`, `bundle-size-report.mjs` and
`bundle-size-report.node-test.mjs` — a **blocking CI budget constant change, 600,000 → 595,000** —
under a message mentioning none of it. Every `git add` in that session named explicit paths. The
files were pre-staged by someone else.

**"Stage by explicit path" — the rule `AGENTS.md` already carries — does not prevent this.** The
contamination arrives *between* your `add` and your `commit`, from another process. What works:

```bash
git commit -F msg.txt -- path/to/file    # pathspec commit; bypasses the index entirely
git diff --cached --name-only            # read immediately before every commit
```

Proof it works: `a485eea4` was committed with the pathspec form and contains exactly one file.

**Release consequence:** `git log` stops being a trustworthy source for release notes. Build them
from `git diff --name-only <main>..<candidate>`, never from commit subjects.

## 2. Sync is not identity — the checkout's HEAD branch moves too

Another session can `git checkout` the shared clone onto its own branch. A commit you believe is
landing on `dev` lands on theirs.

Measured the same night: the checkout silently moved from `dev` to `codex/set-password-link`
(which carried ten uncommitted files of live universal-link routing work).

**The trap:** `git rev-list --left-right --count HEAD...origin/dev` returns `0 0` just as happily
when you are sitting on **someone else's branch that happens to point at the same commit**. Sync
checks pass; identity is never tested. Re-check `git rev-parse --abbrev-ref HEAD` before every
commit, not once at session start.

Recovery that worked without disturbing the other session: push the commit object straight to the
intended branch after confirming its parent (`git push origin <sha>:dev`), then
`git reset --mixed <original>` the borrowed branch — `--mixed` leaves the working tree untouched.
Verify the other session's dirty files are byte-identical before and after.

## 3. Another session can push a merge into YOUR feature branch, mid-merge

Measured 2026-08-14 (PR #646): while resolving a `dev` conflict in my own worktree, another session
pushed its own `Merge remote-tracking branch 'origin/dev' into HEAD` onto **my** feature branch,
timestamped one minute before my local merge commit. My `git push` failed non-fast-forward.

Every session commits as `moronisalvador`, so **author and timestamp cannot tell you whose commit
it is** — same blind spot as §1/§2.

Do NOT `--force`, and do not assume they resolved it your way. Read their resolution first:

```bash
git show <remote-tip>:path/to/conflicted-file | grep -c <marker-your-change-adds>
git show <remote-tip>:path/to/conflicted-file | grep -c <marker-your-change-removes>
diff <(git show <remote-tip>:f) <(git show HEAD:f)   # identical resolutions merge trivially
```

Here they had resolved identically but merged a `dev` one commit older, so my side was a superset;
`git merge <remote-branch>` joined them with no conflict and no lost work. Verify after the join
with `git diff origin/dev HEAD --stat` — it should show **only** your intended files.

**Corollary for close-out:** after such a merge, `wip:close` and `worktrees:clean` key on the
**commit graph**, so they report "N commits never merged to dev" even when `git diff origin/dev HEAD`
is empty and the work demonstrably shipped. Confirm landing by content diff, never by ancestry —
and never `wip:close --force`, which records the entry as deliberately abandoned (a lie when it
actually merged).

Same family as [[shared-clone-moving-base-poisons-diff-gates]] (the `origin/dev` *ref* moving under
you) — there the shared state poisons a **read**, here it poisons a **write**. Also
[[harvested-worktree-orphans]]: check the content, not the git metadata.
