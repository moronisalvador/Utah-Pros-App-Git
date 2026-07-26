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

block() {
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
norm="$(printf '%s' "$sql" \
  | sed -E 's@/\*[^*]*\*+([^/*][^*]*\*+)*/@ @g' \
  | sed -E 's/--[^\n]*//g' \
  | tr '\n\t' '  ' | tr -s ' ' | tr '[:lower:]' '[:upper:]')"

# ── Data-destroying / live-table-restructuring operations ──
case "$norm" in
  *"DROP TABLE"*)                 block "DROP TABLE" ;;
  *"DROP SCHEMA"*)                block "DROP SCHEMA" ;;
  *"DROP DATABASE"*)              block "DROP DATABASE" ;;
  *"TRUNCATE"*)                   block "TRUNCATE" ;;
  *"DROP COLUMN"*)                block "DROP COLUMN" ;;
  *"DROP CONSTRAINT"*)            block "DROP CONSTRAINT" ;;
  *"RENAME TO"*)                  block "RENAME (table/object)" ;;
  *"RENAME COLUMN"*)              block "RENAME COLUMN" ;;
  *"DISABLE ROW LEVEL SECURITY"*) block "DISABLE ROW LEVEL SECURITY" ;;
esac

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
