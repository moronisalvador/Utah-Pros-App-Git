# Handoff — Conversation participant scoping

**Status:** NOT STARTED. Authored 2026-07-25 by the branch/worktree reconciliation session
(worktree `upr-reconciliation-migration-6eb446`); never dispatched to a build session.
Recovered from that session's transcript on 2026-07-26 and saved here so it stops living
only inside a parked conversation.

**Verified 2026-07-26 (read-only, live):** `conversation_participants` carries
`contact_id / phone / email / role` and has **no employee column** — it models external
parties only. The prompt's Step-1 suspicion is therefore confirmed: employee membership
needs its own additive table. No schema, RPC, or UI for this feature exists yet.

**Stale line to ignore:** the "another session is actively working on the automation /
missed-call path" warning in *Before you write anything* is no longer true — that work
landed (PRs #517/#518/#519). The send-path files it names should still not be edited by
this feature, but for the original reason: participant scoping is about who *sees* a
thread, not who may *send*.

---

You are building **conversation participant scoping** for the UPR Platform (`moronisalvador/Utah-Pros-App-Git`).

**Problem (owner, in his words):** employees are getting texts/notifications from *every* client — including clients they aren't working on, and leads who aren't even customers yet. That's noise that will make the team stop paying attention to the inbox.

**Target model (owner's spec, mirrors HousecallPro):**
- A **technician** is a participant in a client's conversation when that technician is assigned to an appointment for that client.
- **Admins** are participants in **all** conversations, always.
- **An admin can edit membership at any time** — add or remove staff on any conversation.
- A conversation for a **lead with no assigned work** should reach **office/admin only** — never fan out to technicians.

## Before you write anything

**Another session is actively working** on the automation/missed-call path (`run-automations.js`, an `answered` column, and a consent-keyword fix). **Do not touch `functions/api/run-automations.js`, `functions/api/send-message.js`, or `functions/lib/automated-send.js`.** Confirm with the owner that it's finished before going anywhere near the send chokepoint. Your work is about **who sees and is notified about a thread**, not who may send.

Read first: `CLAUDE.md` · `.claude/rules/database-standard.md` · `docs/auth-and-authorization.md` · `docs/crm-lead-lifecycle.md` · `.claude/rules/tech-mobile-ux.md` · `.claude/rules/omni-inbox-wave-ownership.md` · `.claude/rules/tech-messages-v2-wave-ownership.md` · `.claude/rules/page-lifecycle.md`

## Step 1 — Diagnose before designing (do not skip)

Establish what the actual defect is, because there are two distinct possibilities and the fix differs:

1. **Visibility** — does the conversation *list* currently show all conversations to every employee? Check the RPC/queries behind `src/pages/Conversations.jsx` and `src/pages/tech/v2/messages/**`, and the RLS policies on `conversations`, `messages`, and `conversation_participants`.
2. **Notification fan-out** — who currently receives an inbound-message notification? Trace the `message.inbound` event through `functions/api/notify.js`, `send-push.js`, and the notification-outbox scheduler. There is a documented note that this audience is admin/office; verify whether technicians receive anything today.

Also determine what `conversation_participants` currently models. It carries `contact_id` and `email`, which suggests it tracks **external** parties, not employees. **If so, employee membership needs its own additive table — do not overload the existing one.** Report which it is before proceeding.

## Step 2 — The authorization principle (this is the part that matters)

**Scope it in the database, not the UI.** Hiding rows in React while the underlying rows remain readable by any authenticated employee is not access control — and per `database-standard.md`, `authenticated` proves identity, not permission. Whatever you build must make an unauthorized employee's query return **no rows**, not merely render nothing.

Concretely: scope the conversation/message read path with a real predicate (participant membership, or role = admin/office), and make the RPCs enforce it rather than relying on the client to filter.

## Step 3 — Derivation rule

The assignment join path is documented in `tech-mobile-ux.md` and is **not** direct: `employee → appointment_crew → appointments → (job / claim) → contact`. Tasks belong to appointments, not to technicians. Use the documented path; do not invent a shortcut.

Derive technician membership from that path. Admin membership is by role, not by row.

## Step 4 — Two design decisions to get right

**A. Manual overrides must survive re-derivation.** If an admin removes a technician from a conversation, the next auto-derive pass must **not** silently re-add them. Model membership with an explicit source (`derived` vs `manual`) and a precedence rule: a manual removal wins over a derivation. Without this, the admin's edit appears to work and then quietly reverts — which is worse than not having the feature.

**B. Notifications must match visibility, both directions.** Don't notify someone who can't open the thread (the push deep-link would land on a 403), and don't leave someone visible-but-silent if they're expected to respond. Whatever audience rule you land on, the notification query and the visibility predicate should derive from the same source of truth.

## Step 5 — Backfill existing conversations

Membership has to be derived for **existing** threads, not just new ones, or the feature appears broken on everything already in the system. Ship the backfill in the same reviewed migration, and state the row counts it touches before applying.

## Constraints

- **Additive only.** New table(s)/columns; no `DROP`/`RENAME`/`ALTER COLUMN` on live tables. Every migration ships a rollback (`database-standard.md` §6) and is mapped in `scripts/migration-provenance-manifest.json` **immediately** after applying, so the apply doesn't become provenance drift. Provenance is currently PASS — keep it that way.
- **Applying to the shared project needs a fresh owner instruction.** One Supabase backs both `dev` and production. Author, review, show the affected row counts, then ask.
- **Do not change consent, DND, or the send path.** Participant scoping is orthogonal. STOP/DND remain absolute.
- **Do not regress the office/admin experience** — admins must keep seeing everything.
- **Cross-initiative surface:** `conversation_participants` is Foundation-owned in the omni-inbox manifest, and the tech pane has its own ownership manifest. Record a disclosed rule amendment for anything you touch there rather than editing silently.
- **`src/index.css`:** write only inside a reserved marker.
- No secrets in chat/commits; don't spell the service-role env-var name in prose (the secret-scanner hook blocks it).

## Suggested sequence

1. Diagnosis report (Step 1) — **stop and share it before building.** The right design depends on what you find.
2. Additive schema + derivation + backfill migration, with rollback. Author, don't apply.
3. Read-path scoping (RPC/RLS) + tests proving an unassigned technician gets **zero rows**.
4. Notification audience aligned to the same predicate.
5. Admin membership editor UI (add/remove staff on a conversation).
6. Owner-authorized apply, then verify.

## Close-out

`npm run build` · `npm test` · `npx eslint` changed files · `npm run validate:provenance` · `migration-safety-checker` + `anon-grant-auditor` on migrations · `upr-pattern-checker` + `design-consistency-checker` + `page-behavior-checker` on any page/component change · minimize/resume test + 390px check on touched pages · update `UPR-Web-Context.md` (Rule 9).

Report actual results, never expected. Say plainly what you skipped and why.
