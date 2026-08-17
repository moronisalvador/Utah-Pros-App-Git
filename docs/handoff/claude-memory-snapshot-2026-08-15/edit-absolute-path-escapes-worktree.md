---
name: edit-absolute-path-escapes-worktree
description: "In a worktree session, an absolute Edit/Write path silently lands in the shared main checkout — Bash cwd is the worktree, so git status there looks clean and the edit is invisible"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: ad434d4c-d1c7-4cab-bf6c-77454e91c117
  modified: 2026-08-15T01:14:02.461Z
---

Working in `.claude/worktrees/<name>/`, an **absolute** `Edit`/`Write` path pointing at
`/Users/moronisalvador/APPS/Utah-Pros-App-Git/<file>` writes to the **shared main checkout**, not
the worktree. Hit 2026-08-14 editing `UPR-Design-System.md`: Bash `cwd` was the worktree, so
`git status` there stayed clean and the edit left no trace where I was looking. It surfaced only
because I ran `git status` in the main checkout on a hunch.

**Why it is easy to do and hard to notice:** `grep`/`Glob` return *relative* paths, so the absolute
path gets reconstructed from the repo root you remember — which is the main checkout, not the
worktree. `Read`ing the file back does not catch it either: the absolute path reads the same file
it wrote, so the content looks correct.

**Why it matters here specifically:** the main checkout is shared with live sessions, and per
[[shared-checkout-index-and-head-betray-commits]] another session's `git commit` sweeps the index —
so a stray edit there can ship inside someone else's commit under an unrelated message.

**How to apply:** in a worktree session, derive every absolute path from the worktree root
(`/Users/moronisalvador/APPS/Utah-Pros-App-Git/.claude/worktrees/<name>/…`), or pass the relative
path. Before finishing, run `git status --porcelain` in the **main checkout** as well as the
worktree — a clean worktree is not evidence you did not write outside it. To undo, confirm the diff
is exclusively yours first (`git diff <file>`), then `git checkout -- <file>` there; the main
checkout usually carries other sessions' uncommitted work, so never revert it wholesale.
