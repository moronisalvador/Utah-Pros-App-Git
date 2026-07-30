#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# PreToolUse guard for EVERY tool that can reach SQL on the one
# shared Supabase project. That project serves dev AND main, so a
# statement hits production the instant it runs.
#
# Design: gate the MUTATION, not the dispatcher. Planning and
# authoring migrations stay freely model-invocable; this refuses the
# operations an unattended session must never perform.
#
# Additive DDL passes (CREATE TABLE/COLUMN/INDEX/FUNCTION/POLICY,
# ADD COLUMN, ENABLE RLS), and so do recoverable code-object drops
# used by idempotent migrations (DROP FUNCTION/POLICY/INDEX/TRIGGER
# — no data loss).
#
# FAIL CLOSED. Exit 2 = block (reason on stderr). Exit 0 = allow.
# Never exit 1: exit 1 is NON-blocking in both Claude Code and
# Codex, so a crash must not read as permission.
#
# Canonical body. Codex references THIS file via .codex/hooks.json;
# do not fork a second copy (they drifted 638 bytes once already).
# ─────────────────────────────────────────────────────────────
set -uo pipefail

# Repo root, derived from this script's own location so the guard works from any cwd.
_hook_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="${CLAUDE_PROJECT_DIR:-$(CDPATH= cd -- "$_hook_dir/../.." && pwd)}"

normalize_sql() {
  printf '%s' "$1" \
    | sed -E 's@/\*[^*]*\*+([^/*][^*]*\*+)*/@ @g' \
    | sed -E 's/--.*$//' \
    | tr '\n\t' '  ' | tr -s ' ' | tr '[:lower:]' '[:upper:]'
}

# ── Is this SQL verbatim a COMMITTED rollback file? ──
# Measured 2026-07-27: this guard refused 15 of 31 committed rollbacks — DROP
# TABLE undoing a CREATE TABLE, TRUNCATE, DROP COLUMN undoing an ADD COLUMN,
# GRANT TO anon undoing a REVOKE. Every one of those is the rollback doing its
# job. One was even refused for "carries no ROLLBACK section", which is circular.
# A guard that refuses the undo is worse than the thing it blocks: it left a
# broken Capacitor login with no agent-runnable fix.
#
# The exemption cannot be forged. The SQL must byte-match a file that is TRACKED
# and identical to HEAD, so an agent cannot write new SQL, drop it in
# supabase/rollbacks/, and run it — an uncommitted or edited file does not match.
# This also mirrors database-standard.md §5, which already requires applying only
# migration source committed to a reviewed commit.
# Compares RAW text, not the SQL-normalized form, on purpose. A second
# normalizer would be a second thing to drift, and if the two ever disagreed the
# match would silently fail and every undo would be refused again. Only line
# endings and trailing whitespace are canonicalized. Stricter than semantic
# matching — a reformatted rollback simply does not match and stays blocked,
# which is the safe direction to fail.
#
# Cost matters: this runs inside block(). A first version shelled out to
# `git show` once per rollback file and made the guard's own test suite take 133
# seconds. Now: two git calls plus one node pass.
matched_rollback=""
is_committed_rollback() {
  [ -n "${sql:-}" ] || return 1
  # Cheap pre-filter so the common case — a short ad-hoc statement being refused —
  # never pays for git or node at all. The smallest committed rollback is 323
  # bytes; a hand-written DROP/TRUNCATE is 30-80. 256 sits below every real
  # rollback and above every ad-hoc statement, and erring low only costs time.
  [ "${#sql}" -ge 256 ] || return 1
  command -v git >/dev/null 2>&1 || return 1
  command -v node  >/dev/null 2>&1 || return 1
  # Worktree copies are only trustworthy as "reviewed source" if they are
  # identical to HEAD. If anything under rollbacks/ is dirty, grant no exemption.
  git -C "$REPO_ROOT" diff --quiet HEAD -- supabase/rollbacks 2>/dev/null || return 1
  local list
  list="$(git -C "$REPO_ROOT" ls-files 'supabase/rollbacks/*.sql' 2>/dev/null)" || return 1
  [ -n "$list" ] || return 1
  matched_rollback="$(printf '%s' "$sql" | node -e '
    const fs = require("fs"), path = require("path");
    const repo = process.argv[1];
    const list = process.argv[2].split("\n").filter(Boolean);
    const canon = (s) => s.replace(/\r\n?/g, "\n").split("\n")
      .map((l) => l.replace(/[ \t]+$/, "")).join("\n").trim();
    const want = canon(fs.readFileSync(0, "utf8"));
    if (!want) process.exit(1);
    for (const rel of list) {
      let body;
      try { body = fs.readFileSync(path.join(repo, rel), "utf8"); } catch { continue; }
      if (canon(body) === want) { process.stdout.write(rel); process.exit(0); }
    }
    process.exit(1);
  ' "$REPO_ROOT" "$list" 2>/dev/null)" && [ -n "$matched_rollback" ]
}

block() {
  if is_committed_rollback; then
    echo "ALLOWED — a rule matched (\"$1\"), but this SQL is verbatim" >&2
    echo "$matched_rollback as committed in HEAD, so it is reviewed rollback source." >&2
    echo "Undoing a change necessarily looks like the change it undoes." >&2
    exit 0
  fi
  echo "BLOCKED — $1" >&2
  echo "One shared Supabase serves dev AND production; this guard refuses it for an" >&2
  echo "unattended or auto-approved session. If genuinely needed: author it as a" >&2
  echo "reviewed migration with a ROLLBACK section and apply it in a daytime window." >&2
  exit 2
}

payload="$(cat 2>/dev/null || true)"

# ── Fail closed: a guard that cannot read the request must refuse it ──
if [ -z "${payload//[[:space:]]/}" ]; then
  block "empty hook payload — this guard could not verify the call"
fi

# ── Parse with node, NOT jq ──
# node is a hard dependency of this repository; jq is not installed on the
# owner's machine and is absent from most CI images. Depending on jq made the
# tool-aware layers below (rollback requirement, unfiltered-write refusal,
# fail-closed-on-unreadable-SQL) silently INERT while the guard still reported
# success — the exact silent-degradation failure this guard exists to prevent.
tool=""
sql=""
filter_present=0

parse_out=""
parse_rc=1
if command -v node >/dev/null 2>&1; then
  parse_out="$(printf '%s' "$payload" | node -e '
    const fs = require("fs");
    let p;
    try { p = JSON.parse(fs.readFileSync(0, "utf8")); } catch (e) { process.exit(3); }
    const ti = (p && typeof p.tool_input === "object" && p.tool_input) || {};
    const sql = [ti.query, ti.sql, ti.statement, ti.migration, ti.body]
      .find((v) => typeof v === "string") || "";
    const f = ti.filter;
    const hasFilter = f !== undefined && f !== null && String(f).length > 0;
    process.stdout.write(((p && p.tool_name) || "") + "\n" + (hasFilter ? "1" : "0") + "\n" + sql);
  ' 2>/dev/null)"
  parse_rc=$?
fi

if [ "$parse_rc" -eq 3 ]; then
  block "hook payload was not valid JSON — this guard could not verify the call"
fi

if [ "$parse_rc" -ne 0 ]; then
  # No usable JSON parser. Refuse rather than scan blindly: a partial check
  # that reports success is worse than an honest refusal.
  block "no JSON parser available to this guard (node not found) — refusing to allow unverified SQL"
fi

tool="$(printf '%s' "$parse_out" | sed -n '1p')"
[ "$(printf '%s' "$parse_out" | sed -n '2p')" = "1" ] && filter_present=1
sql="$(printf '%s' "$parse_out" | sed -n '3,$p')"

# ── Row-scoped write tools (upr_update / upr_delete): an absent filter is a mass mutation ──
case "$tool" in
  *upr_delete|*upr_update|*upr_upsert)
    if [ "$filter_present" -eq 0 ]; then
      block "$tool with no filter — an unfiltered row mutation on shared production"
    fi
    ;;
esac

# ── A SQL-bearing tool with no readable SQL is unverifiable, so refuse it ──
if [ -z "${sql//[[:space:]]/}" ]; then
  case "$tool" in
    *apply_migration|*execute_sql|*upr_sql|*exec_read_sql)
      block "$tool carried no readable SQL parameter — cannot verify what would run"
      ;;
  esac
fi

# ── Normalize: strip -- and /* */ comments, collapse whitespace, uppercase ──
norm="$(normalize_sql "$sql")"

# ── Data-destroying / live-table-restructuring operations ──
case "$norm" in
  *"DROP TABLE"*)                 block "DROP TABLE" ;;
  *"DROP SCHEMA"*)                block "DROP SCHEMA" ;;
  *"DROP DATABASE"*)              block "DROP DATABASE" ;;
  *"DROP COLUMN"*)                block "DROP COLUMN" ;;
  *"DROP CONSTRAINT"*)            block "DROP CONSTRAINT" ;;
  *"RENAME TO"*)                  block "RENAME (table/object)" ;;
  *"RENAME COLUMN"*)              block "RENAME COLUMN" ;;
  *"DISABLE ROW LEVEL SECURITY"*) block "DISABLE ROW LEVEL SECURITY" ;;
esac

# TRUNCATE — match the STATEMENT, not the privilege NAME.
# TRUNCATE is also a GRANT-able table privilege, so it appears legitimately in
# three NON-destructive forms that a bare substring match cannot distinguish
# from a statement:
#   1. 'TRUNCATE'                                 — quoted privilege literal
#   2. 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES' — quoted comma-joined list
#   3. REVOKE INSERT, UPDATE, TRUNCATE ... ON t   — UNQUOTED, in a GRANT/REVOKE
# Form 3 is why quote-awareness alone is not enough. The mobile-security
# migrations that assert ACL state (supabase/migrations/2026072*) hit all three,
# so the old bare `*"TRUNCATE"*` match refused all four of them AND all four of
# their rollbacks — every one a false positive. A guard that refuses correct,
# reviewed work is worse than a narrower one: it trains people to bypass it.
# Discriminator: a STATEMENT is TRUNCATE + whitespace + optional TABLE/ONLY +
# a table name. In the three forms above it is followed by a comma or a quote.
# Verified against all 8 of those files (0 matches) and against TRUNCATE TABLE x,
# bare TRUNCATE x, ONLY, CASCADE, RESTART IDENTITY, quoted idents, post-`;`, and
# inside DO $$ ... $$ (all still blocked).
# KNOWN GAP, accepted 2026-07-27: TRUNCATE inside dynamic SQL, e.g.
# EXECUTE 'TRUNCATE t'. The bare match caught that; this does not. Judged the
# better trade because this guard exists to stop unattended ACCIDENTS, and a
# session hand-rolling dynamic SQL to defeat it is not the threat model.
# FOURTH FORM, found 2026-07-27 by running this guard over real work:
#   4. REVOKE INSERT, UPDATE, TRUNCATE ON t   — TRUNCATE LAST, directly before ON
# The comma forms above pass because a comma follows TRUNCATE. Here `ON` follows,
# and `[A-Z0-9_."]` happily reads it as a table name, so the guard called it a
# statement. `GRANT SELECT, TRUNCATE ON t TO service_role` blocked the same way.
# Strip TRUNCATE when it sits in PRIVILEGE position — immediately before ON/FROM/TO
# — then test the remainder for the statement shape. `TRUNCATE ONLY t` is
# untouched because `ON ` requires the trailing space that `ONLY` does not have.
norm_truncate="$(printf '%s' "$norm" | sed -E 's/TRUNCATE +(ON|FROM|TO) /\1 /g')"
if printf '%s' "$norm_truncate" | grep -Eq "(^|[^,'A-Z_]) *TRUNCATE +(TABLE +|ONLY +)?[A-Z0-9_.\"]"; then
  block "TRUNCATE"
fi

# ALTER COLUMN ... TYPE — retyping a live column.
if printf '%s' "$norm" | grep -Eq 'ALTER COLUMN [A-Z0-9_"]+ (SET DATA )?TYPE'; then
  block "ALTER COLUMN TYPE"
fi

# ALTER COLUMN ... SET NOT NULL — database-standard.md §3 forbids tightening a live column.
if printf '%s' "$norm" | grep -Eq 'ALTER COLUMN [A-Z0-9_"]+ SET NOT NULL'; then
  block "ALTER COLUMN SET NOT NULL (tightens a live column — database-standard.md §3)"
fi

# GRANT ... TO anon — only the database-standard.md §2 public allowlist may do this,
# and an allowlisted grant is a reviewed daytime change, never an unattended one.
if printf '%s' "$norm" | grep -Eq 'GRANT .* TO [^;]*\bANON\b'; then
  block "GRANT ... TO anon (database-standard.md §2 allowlist — reviewed change only)"
fi

# Mass data change: DELETE/UPDATE with no WHERE anywhere in the statement.
if printf '%s' "$norm" | grep -q 'DELETE FROM' && ! printf '%s' "$norm" | grep -q 'WHERE'; then
  block "DELETE without WHERE"
fi
if printf '%s' "$norm" | grep -Eq 'UPDATE [A-Z0-9_.\"]+ SET ' && ! printf '%s' "$norm" | grep -q 'WHERE'; then
  block "UPDATE without WHERE"
fi

# ── Every applied migration must carry its undo (database-standard.md §6) ──
# This is the layer that converts "irreversible" into "recoverable": it is the
# difference between a mistake that costs minutes and one that costs a restore.
# NOTE: this checks the RAW sql, not the comment-stripped $norm. The ROLLBACK
# section lives inside `--` comments (documentation-standard.md's SQL migration
# header), which $norm deliberately removes for the destructive-pattern checks.
# Checking $norm here rejected every correctly-formatted migration.
raw_upper="$(printf '%s' "$sql" | tr '[:lower:]' '[:upper:]')"
case "$tool" in
  *apply_migration)
    if ! printf '%s' "$raw_upper" | grep -q 'ROLLBACK'; then
      block "migration carries no ROLLBACK section (database-standard.md §6 requires a stated undo)"
    fi
    ;;
esac

exit 0
