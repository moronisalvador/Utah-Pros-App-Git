# How the UPR Data Model Works — Plain-English Guide

> **This is not the schema.** It never lists a column name or a table's full shape — that's
> `UPR-Web-Context.md` (`## Database — All Tables` / `## All RPCs`), which stays the one source of
> truth per `CLAUDE.md` Rule 9. This guide only explains the *shape of the shape*: which tables exist,
> who writes to them, and how they connect — so a new session (or a new hire) can orient before
> reading the real thing. If this guide and `UPR-Web-Context.md` ever disagree, **`UPR-Web-Context.md`
> wins** — open an issue/PR to fix this file, don't trust it over a live column read.
>
> Style/scope modeled on `UPR-Invoicing-Financials-Employee-Guide.md` (billing, employee-facing).
> This one is for anyone touching the database layer — devs and AI sessions alike.

---

## 1. The Big Picture

```
   CONTACT/LEAD  ──►  CLAIM  ──►  JOB (one per division)  ──►  APPOINTMENTS  ──►  INVOICE
  (a person/property)  (the insurance     (Mitigation / Recon /   (scheduled visits,   (billed in
                         event)             Homebuilding …)         crew + tasks)        QuickBooks)
                                                  │
                                                  ▼
                                        job_documents / photos
                                        (Encircle rooms, e-sign,
                                         demo sheets, scope sheets)
```

A few ideas that make the rest of the schema make sense:

- **A claim can spawn multiple jobs.** One claim with water damage *and* a rebuild is **two jobs**
  (Mitigation, Reconstruction) — each gets its own invoice, its own appointments, its own phase
  history. This mirrors the invoicing guide's "one invoice per job" rule at the source.
- **Everything is `SECURITY DEFINER` RPCs first, direct table access second.** Any table added
  *after* initial deploy, anything cross-table, anything money/consent/permission-weighted goes
  through `db.rpc()` — PostgREST's schema cache lags on brand-new tables, RPCs don't have that
  problem, and RPCs are where business rules (admin gates, org scoping, consent checks) actually
  live. Direct `db.select/insert/update/delete` is for simple, low-stakes, already-cached tables.
- **RLS is the floor, not the enforcement layer.** Every table has Row Level Security enabled, but
  most policies read `USING (true) FOR ALL TO authenticated` — the real gatekeeping happens in the
  RPC layer (admin checks, ownership checks) and in the React route guards (`AdminRoute`,
  `AccessRoute`). See `.claude/rules/database-standard.md` §1 for where this is tightening.
- **One shared Supabase project backs both `dev` and `main`.** There is no separate staging
  database — a migration is live in production the instant it's applied. This is *why* the
  apply-window and additive-only rules in `database-standard.md` exist.
- **Append-only logs, not mutable audit columns.** Cross-cutting history (`system_events`,
  `worker_runs`, `sms_consent_log`, `job_phase_history`, `lead_stage_history`) are insert-only
  tables — nothing update/deletes a row once written. If you need "what happened to this record
  over time," look for one of these before adding a new `*_history` table.
- **Every business area keeps its own timestamp source of truth in `America/Denver`.** Date
  bucketing (today, this week, aging buckets) uses `mt_today()`/`mt_date()` (SQL) or
  `functions/lib/date-mt.js` (JS) — never raw `CURRENT_DATE` or UTC-derived dates. See
  `database-standard.md` §7.

---

## 2. Who Writes What (by area)

| Area | Primary writer | Reads from | Notes |
|---|---|---|---|
| Contacts / Leads | Marketing forms, CRM, staff | Everywhere (jobs, claims, conversations FK to `contacts`) | `contacts.lifecycle_status` / `owner_id` are CRM-wave additions. |
| Claims → Jobs | Staff (ClaimPage), Encircle sync worker | Estimates, invoices, appointments, job_documents | One claim, N jobs (one per division). |
| Scheduling | Staff (Schedule/ScheduleTemplates), techs (clock actions) | `appointment_crew` join → tasks | Tasks belong to **appointments**, not directly to technicians — see `.claude/rules/tech-mobile-ux.md`. |
| Time tracking | Tech app clock actions (`clock_appointment_action` RPC) | `job_time_entries` | Timer starts at `travel_start` (On My Way), not `clock_in`. |
| Invoicing/Payments | Staff (InvoiceEditor), QuickBooks sync workers | `estimate_line_items`, `payments`, QBO webhooks | UPR → QuickBooks is one-way; nobody edits invoices/payments directly in QBO. See the invoicing guide. |
| Documents/Photos | Tech uploads (`insert_job_document` RPC), Encircle sync, e-sign workers | Supabase Storage (`job-files` bucket) + `job_documents` rows | Storage lockdown is in flight (DB-Foundation P2/P8). |
| Messaging | Twilio webhooks (inbound), staff (outbound), automation workers | `messages` / `conversations` | Channel-locked send gate: `functions/lib/automated-send.js` is the only path for automated sends. |
| CRM (tasks/sequences/forms) | CRM wave RPCs (`upsert_crm_task`, `enroll_in_sequence`, `upsert_form`, …) | `crm_*` tables, gated behind `page:crm` | Zero anon exposure by design — CRM tables are `authenticated`-only. |
| Secrets / integration credentials | Admin-only settings pages, OAuth callback workers | Deny-all tables (`integration_credentials`, `integration_config`, `user_google_accounts`) | No policy grants `authenticated` or `anon` read — see `database-standard.md` §4. |

For the authoritative table list (91+ base tables) and the full RPC catalog, see
`UPR-Web-Context.md` → `## Database — All Tables` and `## All RPCs`. This guide intentionally does
not restate either list — it goes stale the moment a phase ships a table, and Rule 9 already
requires updating the real one.

---

## 3. How a New Table Gets In (in one sentence)

Every new table starts life as a migration in `supabase/migrations/`, RLS-enabled with an explicit
policy at creation, fronted by a `SECURITY DEFINER` RPC once anything beyond a trivial read/write is
needed — see [`adding-a-table-rpc-or-policy.md`](adding-a-table-rpc-or-policy.md) for the actual
step-by-step, and the `db-migration` skill for the guided build.

## 4. Drift & Docs Generation

`scripts/db-docs-gen.mjs` (this phase) produces `docs/generated/**` — a point-in-time inventory of
the live schema, regenerated on demand, useful for spotting drift between what's documented and
what's live. It is **not** a second source of truth (that's still `UPR-Web-Context.md`) and it never
writes to `db/baseline/` (that dir is DB-Foundation Phase F's drift-check baseline — a different
tool for a different job: F's baseline is a frozen snapshot compared against on every run; this
generator's output is always "what does live look like right now").

---

*Questions this guide doesn't answer belong in `UPR-Web-Context.md` (schema/RPCs), `BILLING-CONTEXT.md`
(QBO/invoicing), or `.claude/rules/database-standard.md` (the standing DB rules). If none of those
answer it either, that's a documentation gap — flag it, don't guess.*
