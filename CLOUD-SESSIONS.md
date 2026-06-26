# Cloud Sessions — Claude Code on the Web & Desktop (Remote)

**Last updated:** June 24, 2026

This repo is wired to run in **Claude Code cloud sessions** — the same
Anthropic-hosted sandbox used by [claude.ai/code](https://claude.ai/code) and by
the **Claude Desktop app** when you set a session's environment to **Remote**.
A cloud session clones this repo fresh into a throwaway VM, works, and pushes to
a branch / PR — no local checkout required.

This doc is the source of truth for **how to configure that cloud environment**.
The network allowlist and setup script live in the claude.ai environment UI (not
in the repo), so they're recorded here so they're never lost.

---

## TL;DR setup path

1. Install the **Claude Desktop app** (macOS/Windows) — or just use the web at
   claude.ai/code.
2. Connect GitHub: authorize + install the **Claude GitHub App** on
   `moronisalvador/Utah-Pros-App-Git` (enables PR Auto-fix). Or run `/web-setup`
   in a terminal to sync a `gh` token.
3. In the app, start a session and set **Environment → Remote**, then pick this
   repo as the project folder.
4. Create/select a cloud **environment** and configure the **network allowlist**
   and (optionally) a setup script — see below.
5. Send your task. Dependencies install automatically via the SessionStart hook
   (see [Dependency install](#dependency-install)).

---

## Network allowlist

Cloud sessions default to **Trusted** network access, which allows package
registries + GitHub but **NOT** Supabase, Cloudflare, or our other services.
This app talks to all of them, so set **Network access → Custom**, check
**"Also include default list of common package managers"**, and add:

```text
# Supabase (DB, auth, storage, realtime) — project glsmljpabrwonfiltiqm
*.supabase.co
*.supabase.com
glsmljpabrwonfiltiqm.supabase.co

# Cloudflare Pages — production + preview deploys + API
utahpros.app
dev.utahpros.app
*.utahpros.app
*.pages.dev
api.cloudflare.com

# Email (Resend) — all transactional email
api.resend.com

# SMS / voice (Twilio)
api.twilio.com

# QuickBooks / Intuit
quickbooks.api.intuit.com
sandbox-quickbooks.api.intuit.com
oauth.platform.intuit.com
accounts.platform.intuit.com

# Encircle (sync-encircle worker)
api.encircleapp.com
```

> All hosts above were verified reachable from a live cloud session on
> 2026-06-24. The Encircle host is confirmed from `functions/api/sync-encircle.js`.

Alternatively, set **Network access → Full** to skip curating hosts (simpler,
no allowlist guardrail — fine for trusted solo work).

---

## Dependency install

`npm install` is handled automatically by a **SessionStart hook** committed to
the repo, so you do **not** need to put it in the environment setup script:

- `.claude/settings.json` → `SessionStart` hook runs `scripts/install_pkgs.sh`.
- The script only installs in cloud sessions (`CLAUDE_CODE_REMOTE=true`) and
  skips if `node_modules` already exists, so local sessions are untouched and
  resumed cloud sessions start instantly.

If you'd rather front-load installs into the cached environment snapshot (faster
cold starts), you can *also* paste this into the environment **Setup script**
field — but it's redundant with the hook, so pick one:

```bash
#!/bin/bash
set -e
npm ci || npm install
```

---

## Environment variables

Add any secrets the workers/build need as environment variables in the cloud
environment settings (`.env` format, one `KEY=value` per line, **no quotes**).
Note: this is **not** a secrets vault — anyone who can edit the environment can
read them.

Likely candidates (mirror what Cloudflare Pages already has):
`RESEND_API_KEY`, Twilio creds, Supabase service-role key, Intuit/QuickBooks
creds, Encircle API key. Add only what a given task actually needs.

---

## What carries over automatically (in the clone)

`CLAUDE.md`, `.claude/settings.json` (hooks — incl. the doc-header Stop hook and
the dependency SessionStart hook), `.mcp.json`, and any `.claude/agents`,
`.claude/skills`, `.claude/commands` are part of the repo, so they're active in
every cloud session. User-level (`~/.claude`) config does **not** carry over —
commit anything you want available remotely.

---

## Starting a focused (dedicated) session

To run a session scoped to one subsystem — e.g. the **billing / invoice builder + Xactimate AI** —
without unrelated work bloating its context:

1. Start a fresh cloud session on `moronisalvador/Utah-Pros-App-Git` (it clones `main`).
2. Set the session model to **Opus** in the model picker — the strong model is worth it for this work.
3. Set the network allowlist (above) — one-time per environment.
4. Make your **first message** the kickoff command: **`/invoice`** (or `/invoice <what to build>`). It's
   defined in `.claude/commands/invoice.md` — it points the session at `BILLING-CONTEXT.md`, declares
   the files in scope, and re-states the operating loop (plan → verify → ship via PR).
5. Keep that session for billing/invoice work only; spin up separate sessions for other areas.

The behavioral "operating loop" itself lives in `CLAUDE.md` → **How we work**, so it loads in *every*
session automatically — `/invoice` just adds the subsystem scope on top.

## Local vs. cloud — when to use which

| Use **cloud (Remote)** for | Use **local** for |
| --- | --- |
| Backend/worker logic, refactors, migrations, test runs, doc updates, long autonomous tasks, PR Auto-fix | Frontend/UI work where you need to *see* the tech mobile screens, quick interactive edits, live `npm run dev` preview |

Cloud limitations to know: no `@mention`/file-edit pane (ask Claude to edit), no
connectors/plugins (use routines), ~4 vCPU / 16 GB RAM / 30 GB disk, and you must
push before remote sees local work (the VM clones from GitHub).

---

## References

- Claude Code on the web: https://code.claude.com/docs/en/claude-code-on-the-web
- Desktop app (Remote sessions, "Continue in"): https://code.claude.com/docs/en/desktop
