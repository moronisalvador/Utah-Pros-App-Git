---
name: git-skip-worktree-hides-files
description: "This repo has had files with the skip-worktree bit set, making git status report clean while real WIP sat unsaved — always check git ls-files -v before trusting a clean tree"
metadata: 
  node_type: memory
  type: project
  originSessionId: 0f547a20-1cbb-4bc2-a94e-8757aac64730
  modified: 2026-08-01T03:49:21.522Z
---

`git status` on this repo cannot be trusted alone to mean "no uncommitted work."

On 2026-07-31 a rescue commit meant to capture all uncommitted state missed five files because they
carried the git **skip-worktree** bit: `git status` showed the tree clean, and the files were
invisible until `git merge` refused with *"Your local changes would be overwritten."*

**Check before trusting a clean tree, and in every worktree:**

```bash
git ls-files -v | grep -E '^[a-zS]'
```

`S` = skip-worktree, lowercase letter = assume-unchanged. Clear with
`git update-index --no-skip-worktree <paths>`.

Also worth checking for the same class of concealment: `status.showUntrackedFiles=no` in
`git config --list --show-origin`, repo-local rules in `.git/info/exclude`, and
`git sparse-checkout list`.

**Why:** the hidden files were WIP hardening revisions of already-applied migrations that existed in
no commit on any ref — one `git checkout` from being gone.

Related: [[uncaptured-local-work-2026-07-31]], [[rescue-branches-2026-08-01]].
