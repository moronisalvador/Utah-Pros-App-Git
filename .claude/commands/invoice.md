---
description: Kick off a focused invoice-builder / Xactimate-AI work session (billing surface only)
argument-hint: [optional task to start on]
---

You are starting a **dedicated session for the UPR billing surface** — the invoice builder, the
estimate builder, and the Xactimate AI import. Keep this session scoped to that area so its context
stays clean; unrelated work belongs in its own session.

## Before you touch anything
1. **Read `BILLING-CONTEXT.md`** (repo root) — the deep-dive on the invoice builder, the two-way
   QuickBooks Online (QBO) sync, payments, and the Xactimate AI tool. It is the source of truth here.
2. Do **not** load the giant `UPR-Web-Context.md` wholesale — pull only the specific table/RPC sections
   you need. Use an Explore subagent for broad searches so the main thread stays lean.

## Files in scope (shared with another chat — coordinate)
- `src/pages/InvoiceEditor.jsx` — the invoice builder (route `/invoices/:invoiceId`)
- `src/pages/EstimateEditor.jsx` — the estimate builder (mirrors the invoice builder)
- `functions/api/analyze-xactimate.js` — the Xactimate AI worker (Anthropic Messages API)
- `functions/lib/quickbooks.js` + `functions/api/qbo-*.js` — the QBO sync helpers + workers
- `src/components/collections/*` — the shared kit (collKit, collTokens, SearchSelect, ActionMenu)

Because these files are edited by more than one session, **`git fetch origin dev` and rebase onto
`origin/dev` before you start**, and again before you push.

## How to work (see CLAUDE.md → "How we work (the operating loop)")
- **Plan** non-trivial changes first; read before editing; reuse existing patterns.
- **Verify** with `npx eslint <changed files>` and `npm run build` before shipping — report the real result.
- **Ship** via the sanctioned flow: feature branch → push `dev` → reviewed **`dev → main` PR** →
  merge commit (not squash) → fast-forward `dev` to `main`. Never push `main`. Wait for the Cloudflare
  Pages check to go green before merging.
- **Report honestly** — surface discrepancies/assumptions, state failures, don't over-claim.
- Money is **human-in-the-loop**: the AI and the builder only ever produce a DRAFT; nothing reaches
  QuickBooks until a person clicks **Save invoice** (see `BILLING-CONTEXT.md` §0).

## Model
This work wants the strongest model — confirm the session is running on **Opus** (`/model` → Opus)
before making substantive changes.

## Your task
$ARGUMENTS

If the task above is empty, briefly confirm you've read `BILLING-CONTEXT.md`, summarize the current
state of the billing surface, and ask what to build.
