#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# PreToolUse guard for CLAUDE.md / AGENTS.md Rule 4:
#   "Routine work commits directly to `dev`; never push `main` directly."
#
# Production ships through a reviewed `dev → main` PR that the OWNER
# merges. So no session has a legitimate reason to write the `main`
# ref, and this guard has no true-positive cost to pay for.
#
# WHY A HOOK AND NOT A PERMISSION RULE:
#   Enumerated deny rules are belt only. They cannot carry exceptions,
#   and a bare ["git","push"] prefix rule never matches `git push
#   $BRANCH` — the destination is not a literal in the command text.
#   Deciding this needs REF PARSING, which only a hook can do.
#
# WHAT IT REFUSES (destination-side of every refspec):
#   git push origin main            git push origin dev:main
#   git push origin HEAD:main       git push origin +dev:main
#   git push origin :main           git push --delete origin main
#   git push origin refs/heads/main git push --all | --mirror
#   git push            (bare, while the current branch IS main)
#   git push origin HEAD            (while the current branch IS main)
#
# WHAT IT ALLOWS:
#   git push origin dev / -u origin <feature>   — the sanctioned flow
#   git push origin main:experimental           — does not write main
#   everything that is not a `git push` at all
#
# FAIL CLOSED, BUT NARROWLY. Exit 2 = block. Exit 0 = allow. Never
# exit 1: exit 1 is NON-blocking in both Claude Code and Codex, so a
# crash must not read as permission.
#
#   This hook matches EVERY Bash call, so blanket-refusing an
#   unparseable payload would take the whole session down — and a
#   guard the owner switches off protects nothing. Instead it fails
#   closed only over the RISKY CLASS: a payload it cannot parse is
#   refused if the text mentions a push, and allowed otherwise. The
#   literal string "push" must appear in the payload for a `git push`
#   to be encoded in it, which also lets the common case skip node
#   entirely.
#
# KNOWN GAP (documented, not silently accepted): a user-defined git
# alias that pushes without the substring "push" (e.g. `git p`) is not
# seen. Repo-level aliases are not configured; a personal one is
# repo-invisible, same class as ~/.claude/CLAUDE.md.
#
# Canonical body. Point any Codex-side hook config at THIS file; do
# not fork a second copy (the SQL guard's two copies drifted 638 B).
# ─────────────────────────────────────────────────────────────
set -uo pipefail

block() {
  echo "BLOCKED — $1" >&2
  echo "Rule 4: routine work commits directly to \`dev\`; \`main\` is never pushed" >&2
  echo "directly. Production goes through a reviewed \`dev → main\` PR that the owner" >&2
  echo "merges — that PR is the CI build+test gate before production." >&2
  exit 2
}

payload="$(cat 2>/dev/null || true)"

# An empty payload cannot encode a push. Allow (see FAIL CLOSED note).
if [ -z "${payload//[[:space:]]/}" ]; then
  exit 0
fi

# ── Fast path: no "push" anywhere in the request, so no push in it ──
# Keeps the guard free on the overwhelming majority of Bash calls
# instead of spawning node on every single one.
case "$payload" in
  *push*|*PUSH*|*Push*) ;;
  *) exit 0 ;;
esac

# ── Parse with node, NOT jq: jq is not installed on the owner's
#    machine and is absent from most CI images. A guard that depends
#    on it goes silently inert while still reporting success.
if ! command -v node >/dev/null 2>&1; then
  block "no JSON parser available to this guard (node not found), and this request mentions a push — refusing to allow it unverified"
fi

# Resolve the current branch OUTSIDE node so a bare `git push` can be
# judged. Empty means undeterminable, which the parser treats as unsafe.
branch="$(git -C "${CLAUDE_PROJECT_DIR:-.}" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"

verdict="$(printf '%s' "$payload" | CURRENT_BRANCH="$branch" node -e '
const fs = require("fs");
let p;
try { p = JSON.parse(fs.readFileSync(0, "utf8")); } catch (e) { process.exit(3); }

const PROTECTED = new Set(["main", "master"]);
// Options consumed BEFORE the git subcommand that take a separate value.
const GIT_VALUE_OPTS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--super-prefix"]);
// `git push` options that take a separate value, so it is not a refspec.
const PUSH_VALUE_OPTS = new Set(["-o", "--push-option", "--receive-pack", "--exec", "--repo"]);
// Commands that run another command, so the real push may be nested.
const WRAPPERS = new Set(["bash", "sh", "zsh", "dash", "env", "eval", "xargs", "nohup", "timeout", "sudo", "doas", "command", "busybox"]);

const cur = (process.env.CURRENT_BRANCH || "").trim();

// Splits on whitespace but keeps a quoted run as ONE token, so a
// nested `bash -c "git push origin main"` survives as a single token
// we can recurse into.
function tokenize(seg) {
  const toks = [];
  let buf = "", quote = null;
  for (const ch of seg) {
    if (quote) { if (ch === quote) quote = null; else buf += ch; continue; }
    if (ch === "\"" || ch === "'\''") { quote = ch; continue; }
    if (/\s/.test(ch)) { if (buf) { toks.push(buf); buf = ""; } continue; }
    buf += ch;
  }
  if (buf) toks.push(buf);
  return toks;
}

function analyze(cmdStr, depth) {
  if (depth > 3) return null;
  for (const seg of cmdStr.split(/\|\||&&|[;\n|]/)) {
    const r = analyzeSegment(seg, depth);
    if (r) return r;
  }
  return null;
}

function analyzeSegment(seg, depth) {
  const toks = tokenize(seg);
  while (toks.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[0])) toks.shift();
  if (!toks.length) return null;

  const base = toks[0].replace(/\\/g, "/").split("/").pop().replace(/\.exe$/i, "");

  if (WRAPPERS.has(base)) {
    for (const t of toks.slice(1)) {
      if (/\s/.test(t)) { const r = analyze(t, depth + 1); if (r) return r; }
    }
    const rest = toks.slice(1).filter((t) => !t.startsWith("-")).join(" ");
    if (rest) { const r = analyze(rest, depth + 1); if (r) return r; }
    return null;
  }
  if (base !== "git") return null;

  let i = 1, sub = null;
  while (i < toks.length) {
    const t = toks[i];
    if (t.startsWith("-")) { i += GIT_VALUE_OPTS.has(t) ? 2 : 1; continue; }
    sub = t; break;
  }
  if (sub !== "push") return null;

  const args = toks.slice(i + 1);
  const positional = [];
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a === "--all") return "`git push --all` pushes every local branch, main included";
    if (a === "--mirror") return "`git push --mirror` mirrors every ref, main included";
    if (a.startsWith("-")) { if (PUSH_VALUE_OPTS.has(a)) k++; continue; }
    positional.push(a);
  }

  // positional[0] is the remote; everything after it is a refspec.
  const refspecs = positional.slice(1);

  if (refspecs.length === 0) {
    if (!cur) return "a bare `git push`, and this guard could not determine the current branch to know where it lands";
    if (PROTECTED.has(cur)) return "a bare `git push` while the current branch is `" + cur + "`";
    return null;
  }

  for (const rs of refspecs) {
    let dest = rs.includes(":") ? rs.slice(rs.lastIndexOf(":") + 1) : rs;
    dest = dest.replace(/^\+/, "").replace(/^refs\/heads\//, "").trim();
    if (!dest) continue;
    const resolved = (dest === "HEAD" || dest === "@") ? cur : dest;
    if (!resolved) return "a push to `" + dest + "` whose destination branch could not be resolved";
    if (PROTECTED.has(resolved)) return "a push whose destination ref is `" + resolved + "` (from refspec `" + rs + "`)";
  }
  return null;
}

const ti = (p && typeof p.tool_input === "object" && p.tool_input) || {};
const cmd = typeof ti.command === "string" ? ti.command : "";
const reason = cmd.trim() ? analyze(cmd, 0) : null;
process.stdout.write(reason ? "BLOCK\t" + reason : "ALLOW");
' 2>/dev/null)"
parse_rc=$?

if [ "$parse_rc" -eq 3 ]; then
  block "hook payload was not valid JSON, and this request mentions a push — this guard could not verify where it lands"
fi
if [ "$parse_rc" -ne 0 ]; then
  block "this guard failed while inspecting a request that mentions a push — refusing rather than permitting unverified"
fi

case "$verdict" in
  BLOCK*) block "$(printf '%s' "$verdict" | cut -f2-)" ;;
esac

exit 0
