#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# PreToolUse guard: refuse to write real secrets into the repo.
# Wired in .claude/settings.json (matcher "Write|Edit").
# Reads the hook JSON on stdin; exit 2 = block (message on stderr),
# exit 0 = allow. Deliberately narrow — it must NOT false-alarm on
# normal edits (the public anon key / Supabase URLs in docs are fine).
# ─────────────────────────────────────────────────────────────
set -uo pipefail
payload="$(cat)"

# Pull the target path and the text being written. Prefer jq; fall back
# to a tolerant grep so a missing jq never silently disables the guard.
if command -v jq >/dev/null 2>&1; then
  path="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // .tool_input.path // empty' 2>/dev/null)"
  text="$(printf '%s' "$payload" | jq -r '.tool_input.content // .tool_input.new_string // empty' 2>/dev/null)"
else
  path="$(printf '%s' "$payload" | grep -oE '"(file_path|path)"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -E 's/.*:[[:space:]]*"([^"]*)"/\1/')"
  text="$payload"
fi

base="$(basename "$path" 2>/dev/null || echo "")"

# 1) Block committing a real .env secrets file. Templates are allowed.
if [[ "$base" == .env || "$base" == .env.* ]] && [[ "$base" != *.example && "$base" != *.sample && "$base" != *.template ]]; then
  echo "BLOCKED: refusing to write a .env secrets file ($path)." >&2
  echo "Secrets live in Cloudflare env vars / the integration_credentials table, never committed. Use .env.example for placeholder names." >&2
  exit 2
fi

# 2) Block unambiguous live-secret material in the content. Patterns are
#    chosen to match ONLY real secrets — not the public anon key, URLs,
#    or ordinary code (the anon key carries role "anon", never "service_role").
if printf '%s' "$text" | grep -Eq \
  'SUPABASE_SERVICE_ROLE|"role":"service_role"|sk_live_[0-9a-zA-Z]{10}|rk_live_[0-9a-zA-Z]{10}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|xoxb-[0-9A-Za-z-]{10}'; then
  echo "BLOCKED: the content looks like it contains a LIVE secret" >&2
  echo "(service-role key / Stripe live key / AWS key / private key / Slack token)." >&2
  echo "Store it in Cloudflare env vars or integration_credentials — do not commit it." >&2
  exit 2
fi

exit 0
