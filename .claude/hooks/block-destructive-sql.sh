#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# PreToolUse guard for the Supabase migration / execute_sql tools.
# One shared Supabase serves dev AND main, so a migration hits
# production the instant it runs. This blocks DATA-destroying or
# live-table-restructuring SQL — the operations an unattended /
# auto-approved session must never do. Additive DDL passes
# (CREATE TABLE/COLUMN/INDEX/FUNCTION/POLICY, ADD COLUMN, ENABLE RLS),
# and so do recoverable code-object drops used for idempotent
# migrations (DROP FUNCTION/POLICY/INDEX/TRIGGER — no data loss).
# Exit 2 = block (message on stderr), exit 0 = allow.
# ─────────────────────────────────────────────────────────────
set -uo pipefail
payload="$(cat)"

if command -v jq >/dev/null 2>&1; then
  sql="$(printf '%s' "$payload" | jq -r '.tool_input.query // .tool_input.sql // empty' 2>/dev/null)"
else
  sql="$payload"
fi

# Normalize: strip -- comments, collapse whitespace, uppercase.
norm="$(printf '%s' "$sql" | sed -E 's/--[^\n]*//g' | tr '\n\t' '  ' | tr -s ' ' | tr '[:lower:]' '[:upper:]')"

block() {
  echo "BLOCKED — destructive SQL on the shared production database: $1" >&2
  echo "Auto-approve/overnight refuses this. CRM phases are additive-only (CLAUDE.md)." >&2
  echo "If this is genuinely needed, run it yourself as a daytime, reviewed change." >&2
  exit 2
}

case "$norm" in
  *"DROP TABLE"*)                 block "DROP TABLE" ;;
  *"DROP SCHEMA"*)                block "DROP SCHEMA" ;;
  *"DROP DATABASE"*)              block "DROP DATABASE" ;;
  *"TRUNCATE"*)                   block "TRUNCATE" ;;
  *"DROP COLUMN"*)                block "DROP COLUMN" ;;
  *"RENAME TO"*)                  block "RENAME (table/object)" ;;
  *"RENAME COLUMN"*)              block "RENAME COLUMN" ;;
  *"DISABLE ROW LEVEL SECURITY"*) block "DISABLE ROW LEVEL SECURITY" ;;
esac

# ALTER COLUMN ... TYPE — changing a live column's type.
if printf '%s' "$norm" | grep -Eq 'ALTER COLUMN [A-Z0-9_"]+ (SET DATA )?TYPE'; then
  block "ALTER COLUMN TYPE"
fi

# DELETE / UPDATE with no WHERE anywhere in the statement — mass data change.
if printf '%s' "$norm" | grep -q 'DELETE FROM' && ! printf '%s' "$norm" | grep -q 'WHERE'; then
  block "DELETE without WHERE"
fi
if printf '%s' "$norm" | grep -Eq 'UPDATE [A-Z0-9_.\"]+ SET ' && ! printf '%s' "$norm" | grep -q 'WHERE'; then
  block "UPDATE without WHERE"
fi

exit 0
