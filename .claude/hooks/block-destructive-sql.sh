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
# An apply_migration payload must ALSO be the reviewed file itself
# (database-standard.md §5). See the payload-fidelity section below.
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

# ── Is an apply_migration payload the COMMITTED file, or a retyped copy? ──
# Added 2026-08-04 after a live near-miss: an agent applying a migration to the
# shared production project abbreviated the header comment "to save context".
# That silently dropped the required ROLLBACK section, so the payload was no
# longer the reviewed file. The guard refused it — but only because the layer at
# the bottom greps the raw SQL for the literal "ROLLBACK". A payload that had
# dropped a REVOKE or a GRANT line while KEEPING the ROLLBACK header would have
# passed and been applied to production. Precedent for the same failure mode:
# the CRM lead-value apply (initiative-status.md) shipped `crm_backfill_lead_values`
# granted to anon — "a transcription slip in the apply payload, not in the
# reviewed file" — caught only because it happened to be rehearsed on staging.
#
# So compare the payload to the file. This enforces what database-standard.md §5
# already requires: "Apply only migrations committed to a reviewed commit
# reachable from the designated release branch." Reviewing a file and then
# applying a paraphrase of it is not applying reviewed source.
#
# Candidates are TRACKED files under supabase/migrations/ and supabase/rollbacks/
# that are identical to HEAD. Dirty paths are excluded PER FILE, not per
# directory, so authoring an uncommitted migration B does not block applying
# committed migration A. Untracked files are never candidates, so an agent
# cannot write new SQL, drop it in supabase/migrations/, and run it.
#
# Rollbacks are candidates too: an operator-run undo is legitimately dispatched
# through apply_migration, and the suite already exercises that path.
#
# CANONICAL FORM — read this before touching it. Line endings are normalized,
# runs of spaces/tabs INSIDE a line collapse to one, each line is trimmed, and
# blank lines drop. That absorbs re-indentation and CRLF while still refusing any
# payload whose tokens differ from the file's.
# LINE BOUNDARIES ARE DELIBERATELY PRESERVED. Collapsing newlines too would be
# forgeable: migration headers routinely carry real DDL inside `--` comments
# ("-- ROLLBACK: DROP TABLE t;"), so a payload that merely inserted a newline
# after the colon would normalize identically to the file while executing the
# DROP for real. Keeping newlines means any token that moves across a line
# boundary fails to match, which is the safe direction to fail.
#
# Returns 0 = matched, 1 = no match, 2 = cannot verify. 2 must fail closed: a
# partial check that reports success is worse than an honest refusal.
matched_migration=""
payload_matches_committed_migration() {
  matched_migration=""
  command -v git  >/dev/null 2>&1 || return 2
  command -v node >/dev/null 2>&1 || return 2
  local tracked dirty
  tracked="$(git -C "$REPO_ROOT" ls-files 'supabase/migrations/*.sql' 'supabase/rollbacks/*.sql' 2>/dev/null)" || return 2
  [ -n "$tracked" ] || return 2
  # `git diff HEAD` covers staged AND unstaged edits; untracked files are not in
  # ls-files at all. A path that appears here is not reviewed source.
  dirty="$(git -C "$REPO_ROOT" diff --name-only HEAD -- supabase/migrations supabase/rollbacks 2>/dev/null)" || return 2
  matched_migration="$(printf '%s' "$sql" | node -e '
    const fs = require("fs"), path = require("path");
    const repo = process.argv[1];
    const dirty = new Set(process.argv[3].split("\n").filter(Boolean));
    const list = process.argv[2].split("\n").filter(Boolean).filter((rel) => !dirty.has(rel));
    const canon = (s) => s.replace(/\r\n?/g, "\n").split("\n")
      .map((l) => l.replace(/[ \t]+/g, " ").trim())
      .filter((l) => l.length > 0).join("\n");
    const want = canon(fs.readFileSync(0, "utf8"));
    if (!want) process.exit(1);
    for (const rel of list) {
      let body;
      try { body = fs.readFileSync(path.join(repo, rel), "utf8"); } catch { continue; }
      if (canon(body) === want) { process.stdout.write(rel); process.exit(0); }
    }
    process.exit(1);
  ' "$REPO_ROOT" "$tracked" "$dirty" 2>/dev/null)" && [ -n "$matched_migration" ] && return 0
  return 1
}

# Optional extra remedy lines: block "reason" "line" "line". When present they
# replace the generic tail, because generic advice on a specific failure is how
# the pre-2026-07-27 guard produced refusals nobody could act on.
block() {
  # Defaulted, not bare "$1": under `set -u` a zero-arg call would abort the
  # shell with status 1 — and exit 1 is NON-BLOCKING in both tools, so a bug in
  # this function would silently read as permission. Every call site passes a
  # reason; this only guarantees a future one cannot turn a refusal into an allow.
  local reason="${1:-unspecified refusal}"
  [ "$#" -gt 0 ] && shift
  if is_committed_rollback; then
    echo "ALLOWED — a rule matched (\"$reason\"), but this SQL is verbatim" >&2
    echo "$matched_rollback as committed in HEAD, so it is reviewed rollback source." >&2
    echo "Undoing a change necessarily looks like the change it undoes." >&2
    exit 0
  fi
  echo "BLOCKED — $reason" >&2
  echo "One shared Supabase serves dev AND production; this guard refuses it for an" >&2
  echo "unattended or auto-approved session." >&2
  if [ "$#" -gt 0 ]; then
    printf '%s\n' "$@" >&2
  else
    echo "If genuinely needed: author it as a reviewed migration with a ROLLBACK" >&2
    echo "section and apply it in a daytime window." >&2
  fi
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
    # ── Payload fidelity FIRST, so the message names the real defect ──
    # Ordering matters. An abbreviated payload usually loses the ROLLBACK header
    # too, and refusing it for the missing header sends the operator off to add a
    # header — treating the symptom while the retyped body sails through on the
    # next attempt. Fidelity is the accurate diagnosis; run it first.
    #
    # ── The escape hatch, deliberately loud ──
    # A genuine non-file apply exists: an owner-authorized emergency fix, where
    # the outage IS the reason there is no reviewed commit yet. Production
    # already carries one such bridge (initiative-status.md ledger
    # 20260804003152, "immutable emergency bridge"). Refusing that case outright
    # would push the operator to disable the hook, which loses every other check
    # in this file — strictly worse. So the opt-out is explicit, self-documenting
    # and recorded in the SQL that gets applied, rather than silent:
    #
    #   -- owner-authorized-unreviewed-apply: <reason>
    #
    # It skips ONLY this fidelity check. Every destructive-pattern refusal above
    # has already run and is unreachable from here, and the ROLLBACK requirement
    # below still applies. The reason text is mandatory — a marker that can be
    # typed as a bare reflex is not a decision.
    if printf '%s' "$sql" | grep -Eqi '^[[:space:]]*--[[:space:]]*owner-authorized-unreviewed-apply:[[:space:]]*[^[:space:]]'; then
      echo "!! UNREVIEWED APPLY — payload-fidelity check SKIPPED by an explicit marker." >&2
      echo "!! This SQL was NOT matched against any committed migration file. It is" >&2
      echo "!! reaching the one shared Supabase that serves dev AND production." >&2
      echo "!! Valid only under a fresh, task-specific owner authorization for THIS" >&2
      echo "!! apply (AGENTS.md authorization boundary). Commit the exact applied" >&2
      echo "!! source afterwards so the ledger and the repository agree." >&2
    else
      payload_matches_committed_migration
      case "$?" in
        0) : ;;  # verbatim committed source
        2)
          block "cannot verify the apply payload against committed migration source" \
            "git or node is unavailable to this guard, so it cannot confirm this payload" \
            "is the reviewed file (database-standard.md §5). Refusing rather than guessing." \
            "Run the apply from a normal checkout with git on PATH."
          ;;
        *)
          block "apply payload does not match any committed migration file" \
            "database-standard.md §5 allows applying ONLY migration source committed to a" \
            "reviewed commit. This payload is not byte-equal (modulo indentation) to any" \
            "tracked, HEAD-clean file in supabase/migrations/ or supabase/rollbacks/." \
            "" \
            "Do this: Read the migration file from disk and pass its ENTIRE contents as" \
            "the query, unedited. Do not abbreviate, summarize or re-type the header —" \
            "a shortened header is how a required ROLLBACK section, a REVOKE, or a GRANT" \
            "silently goes missing from what actually reaches production." \
            "" \
            "If the file itself needs to change, edit and commit it, then apply the" \
            "committed file. If this is an owner-authorized emergency fix with no" \
            "reviewed commit, add a line to the SQL:" \
            "  -- owner-authorized-unreviewed-apply: <reason>"
          ;;
      esac
    fi

    if ! printf '%s' "$raw_upper" | grep -q 'ROLLBACK'; then
      block "migration carries no ROLLBACK section (database-standard.md §6 requires a stated undo)"
    fi
    ;;
esac

exit 0
