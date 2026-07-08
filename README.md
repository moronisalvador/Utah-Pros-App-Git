# UPR Platform

Internal business management platform for Utah Pros Restoration — messaging, job management,
scheduling, CRM, billing, and field-tech mobile tools.

**Start here, not in this file:**
- **[`CLAUDE.md`](CLAUDE.md)** — the project's non-negotiable rules, stack, DB client API, deployment
  workflow, and file-structure map. The single source of truth for "how do we work here."
- **[`UPR-Web-Context.md`](UPR-Web-Context.md)** — the full, continuously-updated schema (all tables,
  all RPCs), page/component inventory, and per-initiative build history. This file deliberately does
  **not** duplicate that list (a hand-copied page/table list is exactly how this README went stale
  before — see `docs/db-foundation-roadmap.md`).
- **[`docs/database/`](docs/database/)** — a plain-English "how the data model works" guide, a
  glossary, and a "how to safely add a table/RPC/policy" checklist, for anyone (human or AI session)
  orienting on the database layer before diving into `UPR-Web-Context.md`.
- **[`BILLING-CONTEXT.md`](BILLING-CONTEXT.md)** — QuickBooks/invoicing internals.
  **[`UPR-Design-System.md`](UPR-Design-System.md)** — CSS tokens/components.

## Stack

React 19 + Vite 8 (all JSX, no TypeScript) · React Router v7 · Supabase Postgres + PostgREST
(no Supabase JS SDK for data — see `CLAUDE.md`'s DB Client API) · Cloudflare Pages Functions
(`functions/api/*.js`) · Capacitor 8 iOS app (`ios/`) · CSS custom properties, no Tailwind.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Create env files
cp .env.example .env.local        # Frontend vars (anon key)
cp .dev.vars.example .dev.vars    # Worker vars (service role key, Twilio, etc.)

# 3. Fill in your Supabase anon key in .env.local — see .env.example for the variable names.

# 4. Start development
npm run dev                        # Vite dev server (port 5173)
npx wrangler pages dev dist        # Cloudflare Pages + Workers (port 8788)
```

For full development with Workers, run both Vite and Wrangler simultaneously — the Vite proxy
config forwards `/api/*` requests to the Wrangler dev server.

```bash
npm run lint     # ESLint (non-blocking on main's CI; don't add new errors)
npm run build    # Vite production build
npm test         # vitest
```

## Project Structure

High-level orientation only — `CLAUDE.md`'s **File Structure** section is the maintained map (it's
explicit that `src/pages/` alone has 41+ files and is not exhaustive; use `Glob` before assuming a
page doesn't exist).

```
src/            React app — App.jsx (routes), pages/, pages/tech/ (field-tech mobile shell),
                pages/crm/ (CRM), pages/settings/ (settings hub), components/, contexts/, lib/
functions/      Cloudflare Pages Functions — api/ (58+ workers: SMS, Encircle, e-sign, QuickBooks,
                Stripe, Google, AI, docs/reports), lib/ (shared server-side clients/helpers)
supabase/       migrations/ (schema-as-code, source of truth for the live DB) + tests/
docs/           per-initiative roadmaps/dispatch docs + docs/database/ (this phase) +
                docs/generated/ (schema drift-verification snapshots, regenerate-don't-edit)
db/baseline/    committed live-schema snapshot used by scripts/db-drift-check.mjs
scripts/        db-drift-check*, db-docs-gen* (schema introspection, read-only), integrity checks
.claude/        rules/ (standing project rules), agents/ (review agents), commands/ (slash commands)
```

## Environment Variables

See `.env.example` and `.dev.vars.example` for the full, current list — they're the source of truth
for variable names (a hand-copied table here has gone stale before). In short: the frontend gets the
Supabase URL + anon key; Workers get the Supabase service role key plus per-integration secrets
(Twilio, QuickBooks, Stripe, Google, Resend). Cloudflare keeps separate Production/Preview variable
sets — see `CLAUDE.md`'s Deployment section.

## Auth Flow

Supabase Auth (email/password) → `AuthContext` matches the auth user to an `employees` row by email
→ page access + nav loaded from the employee's role/overrides → `db` (the authenticated REST client)
is exposed via `useAuth()` for the rest of the app. Dev builds also offer `devLogin` (bypass auth,
pick an employee directly) — see `CLAUDE.md`'s AuthContext section for the full list of what's
exposed.

## Deploy

Push to `dev` → Cloudflare Pages auto-builds and deploys to `dev.utahpros.app` (staging). Production
(`utahpros.app`, and the Capacitor iOS app's `/tech/*` build) ships via a reviewed `dev → main` PR —
see `CLAUDE.md`'s Deployment & Release Workflow section for the full model (why routine work skips a
PR, why production doesn't, and how the CRM/tech-v2/etc. parallel waves differ).

- **Framework preset**: React (Vite) · **Build command**: `npm run build` · **Output**: `dist`
- **Workers**: auto-detected from `functions/`
