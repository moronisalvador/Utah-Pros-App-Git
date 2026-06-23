#!/usr/bin/env bash
# ════════════════════════════════════════════════
# FILE: check-doc-headers.sh
# ════════════════════════════════════════════════
#
# WHAT THIS DOES (plain language):
#   A safety net that runs automatically whenever Claude finishes. It looks at
#   the code files we created or changed since we adopted the documentation
#   standard and checks that each one starts with the standard header. If any
#   are missing it, it lists them and refuses to let the session end until
#   they're documented.
#
# DEPENDS ON:
#   Tools:  git, jq, grep, head  (all present in the Claude Code environment)
#   Data:   .claude/doc-baseline (a commit SHA marking when we adopted the
#           standard — everything at or before it is grandfathered)
#
# NOTES / GOTCHAS:
#   - Mirrors stop-hook-git-check.sh: prints to stderr + exits 2 to surface
#     actionable feedback to Claude; honors stop_hook_active to avoid recursion.
#   - Scope is "from now on", NOT the whole repo: it checks .js/.jsx under src/
#     and functions/ that changed AFTER the baseline commit (baseline..HEAD) plus
#     the current working tree. The large pre-existing backlog of un-headered
#     files is grandfathered — but any legacy file gets checked the moment it's
#     edited again (it then shows up as a working-tree change), which matches
#     rule 14 in CLAUDE.md ("add the header when you substantially edit a file").
#   - If .claude/doc-baseline is missing/invalid, it degrades safely to checking
#     only the working tree + untracked — never the legacy backlog.
#   - Anchor string: "WHAT THIS DOES" (present in every header variant). Avoids
#     `set -o pipefail` on purpose: `head | grep -q` would mis-report on SIGPIPE.
# ════════════════════════════════════════════════

input=$(cat)

# Recursion guard — don't re-run while a stop hook is already being handled.
if [[ "$(printf '%s' "$input" | jq -r '.stop_hook_active' 2>/dev/null)" == "true" ]]; then
  exit 0
fi

# Only meaningful inside a git repo.
git rev-parse --git-dir >/dev/null 2>&1 || exit 0
cd "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || exit 0

# Grandfather baseline: only enforce on work done AFTER this commit. Falls back
# to "" (working tree only) if the marker file is missing or not a real commit.
baseline=""
if [[ -f .claude/doc-baseline ]]; then
  candidate="$(tr -dc '0-9a-fA-F' < .claude/doc-baseline)"
  if [[ -n "$candidate" ]] && git rev-parse --verify --quiet "${candidate}^{commit}" >/dev/null 2>&1; then
    baseline="$candidate"
  fi
fi

# Candidate files = committed after baseline (baseline..HEAD) + working-tree
# changes + untracked, excluding deletions. Only .js/.jsx under src/ and functions/.
missing=()
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  case "$f" in
    src/*.js|src/*.jsx|functions/*.js|functions/*.jsx) ;;
    *) continue ;;
  esac
  [[ -f "$f" ]] || continue
  if ! head -n 40 "$f" | grep -q "WHAT THIS DOES"; then
    missing+=("$f")
  fi
done < <(
  {
    [[ -n "$baseline" ]] && git diff --name-only --diff-filter=ACMR "$baseline" HEAD
    git diff --name-only --diff-filter=ACMR HEAD
    git ls-files --others --exclude-standard
  } 2>/dev/null | sort -u
)

if [[ ${#missing[@]} -gt 0 ]]; then
  {
    echo "Documentation Standard check failed — these code files were added or modified since the doc-standard baseline but are missing the required header (see the 'Documentation Standard' section in CLAUDE.md; the header must contain the anchor 'WHAT THIS DOES'):"
    for f in "${missing[@]}"; do
      echo "  - $f"
    done
    echo "Add the file header (and '// ─── SECTION: ... ──────────────' markers for long files), then commit. Do not finish until every changed code file under src/ and functions/ has a header."
  } >&2
  exit 2
fi

exit 0
