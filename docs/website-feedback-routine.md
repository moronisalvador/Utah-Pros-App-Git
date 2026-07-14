# Website Feedback → Proposed Fix (Daily Routine)

**Created:** 2026-07-14 · **Owner:** Moroni · **Type:** Scheduled Routine (Claude Code Remote trigger)

A hands-off daily automation that reads new technician-submitted feedback, diagnoses each
item against the codebase, drafts a concrete proposed fix, and delivers it to the owner as a
push + email digest. It is **read-only and advisory** — it never edits code, changes feedback
status, or opens PRs. The owner reviews the digest and decides what to build.

This is an operational Routine, not app code. This file is the durable record of what it does
and how to manage it; the live definition is a Claude Code Remote scheduled trigger.

---

## What it does (each morning)

1. **Capture** — pulls `tech_feedback` rows created in the last 25 hours (a 24h window + 1h
   overlap so nothing is missed between runs), via the `get_tech_feedback()` RPC.
2. **Read & understand** — for each item, restates it plainly and locates the relevant
   page/component/worker in the repo (delegating the search to the `upr-scout` agent), reading
   the real files before drawing conclusions.
3. **Diagnose** — determines the likely root cause (bugs) or the concrete change needed
   (improvement ideas), and notes any screenshot/video attachments.
4. **Propose a fix** — the specific file(s) to touch, what to change, which CLAUDE.md
   rules/standards apply, rough effort (S/M/L), and any risks or open questions.
5. **Present** — sends the owner a skimmable digest (newest first) plus a prioritized shortlist
   of the 1–3 items to do first, via **push + email**. If there is no new feedback, it sends a
   single "No new technician feedback in the last 24 hours." line.

## Configuration

| Setting | Value |
|---|---|
| Cadence | Daily, `0 14 * * *` (14:00 UTC ≈ 8:00 AM Mountain) |
| Session | Fresh session per fire (standalone, no memory between days) |
| Delivery | Completion notification — **push + email** |
| Autonomy | Analyze + propose only — **no code changes, no PRs, no status writes** |
| Trigger id | `trig_01XPYtiUptMk8UhPQP73UwpX` |

## Data model it reads (no writes)

- **Table:** `tech_feedback` — submitted by technicians via `src/pages/tech/TechFeedback.jsx`
  and the desktop feedback path; surfaced to admins in `src/pages/settings/FeedbackInbox.jsx`.
- **Read RPC:** `get_tech_feedback()` → `id, employee_name, type, title, description, status,
  admin_notes, created_at, attachments, source`.
- **Field meanings:** `type` = `bug` (something broken) or `feature` (improvement idea);
  `source` = `tech` (field app) or `desktop`; `status` = `new | reviewed | resolved | dismissed`.
- The routine filters on `created_at` (last 25h). It intentionally does **not** key on `status`,
  so it never re-reports the same item on later days, and it never writes status/notes (that stays
  a human triage action in the Feedback Inbox).

## Managing the routine

The routine is a scheduled trigger, managed via the Claude Code Remote trigger tools (or ask
Claude in a session to do it):

- **Pause / resume:** `update_trigger` with `enabled: false` / `true`.
- **Change cadence or time:** `update_trigger` with a new `cron_expression`.
- **Run it now (outside schedule):** `fire_trigger` on the trigger id.
- **Edit what it does:** re-create it with a revised prompt (`delete_trigger` then
  `create_trigger`), and update this file to match.
- **Remove it:** `delete_trigger` on the trigger id.

## Notes / gotchas

- Fresh-session routines are the only kind that support completion push/email notifications, so
  the digest is delivered that way rather than into a persistent conversation.
- Interactively-authenticated MCP servers can be absent in headless runs; the routine reads
  `tech_feedback` through the UPR MCP server (token-authenticated), with a `upr_select` fallback
  if the `get_tech_feedback` RPC is unavailable.
- The routine is advisory by design (owner decision 2026-07-14). To have it also implement fixes
  as draft PRs, change the autonomy in its prompt and pair it with a per-fix PR delivery step.
