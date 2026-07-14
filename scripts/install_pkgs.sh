#!/bin/bash
# ════════════════════════════════════════════════
# FILE: scripts/install_pkgs.sh
# ════════════════════════════════════════════════
#
# WHAT THIS DOES (plain language):
#   When a Claude Code session starts in the cloud (Claude Code on the web,
#   or the desktop app set to "Remote"), this script installs the project's
#   npm packages so the code is ready to run. It does NOTHING on your own
#   machine — local sessions skip it entirely so they stay fast.
#
# WHERE IT LIVES:
#   Triggered by:  .claude/settings.json  (SessionStart hook, matcher "startup|resume")
#
# DEPENDS ON:
#   Tools:     bash, npm (pre-installed in cloud sessions)
#   Internal:  package.json / package-lock.json (project dependencies)
#   Env vars:  CLAUDE_CODE_REMOTE — set to "true" only in cloud sessions
#
# NOTES / GOTCHAS:
#   - Local guard: exits immediately unless CLAUDE_CODE_REMOTE=true, so it
#     never touches your laptop's node_modules or slows a local session.
#   - Skip-if-present: if node_modules already exists (warm environment
#     cache), it skips the install so resumed sessions start instantly.
#   - npm ci is preferred (lockfile-exact); falls back to npm install only
#     if ci fails (e.g. lockfile drift), so a session never fails to start.
#   - Cloud sessions need Trusted/Custom network access to reach the npm
#     registry — see CLOUD-SESSIONS.md.
# ════════════════════════════════════════════════

# Only run the heavy install in cloud sessions; do nothing locally.
if [ "$CLAUDE_CODE_REMOTE" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

# TypeScript language server for the typescript-lsp code-intelligence plugin
# (works on JS/JSX too — see jsconfig.json). Runs BEFORE the node_modules
# skip so warm-cache sessions still get it. Non-fatal: without it, code
# navigation just degrades to grep.
if ! command -v typescript-language-server >/dev/null 2>&1; then
  echo "Installing typescript-language-server for code intelligence..."
  npm install -g typescript-language-server typescript \
    || echo "typescript-language-server install failed (non-fatal)."
fi

# Warm cache already has deps on disk — skip reinstalling.
if [ -d node_modules ]; then
  echo "node_modules present — skipping install."
  exit 0
fi

echo "Cloud session detected — installing npm dependencies..."
npm ci || npm install

exit 0
