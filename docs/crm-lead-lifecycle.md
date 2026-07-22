# CRM Lead Lifecycle — Architecture, Canonical Rules & Invariants

**Last-verified: 2026-07-22** (written the day the system was audited end-to-end, every claim below
checked against the live database and code — see the 2026-07-22 entries in `UPR-Web-Context.md` for
the change log behind it).

**Who this is for:** any session touching CRM counting, the pipeline, telephony ingestion, or the
dashboards. Read this BEFORE changing how anything is counted, staged, classified, or reported.
`UPR-Web-Context.md` stays the source of truth for exact schema/RPC signatures; this doc is the map —
how the pieces fit, which rules are law, and which mistakes this system has already paid for.

---

## 1. The five layers

A call (or form) flows through five layers. Each writes different tables, is driven by a different
actor, and fails differently. Keep them mentally separate — most of the 2026-07-22 bugs came from
blurring two layers together.

| # | Layer | Actor / when | Writes | Key code |
|---|---|---|---|---|
| 1 | **Capture** | machine, seconds | `inbound_leads` (+`system_events`) | `callrail-webhook.js` → `upsert_lead_from_callrail` |
| 2 | **Enrich** | AI, ~1 min (+6h cron net) | `transcript_analysis`, `spam_flag`, contacts, stage advances | `transcribe-call.js` (Deepgram → Claude passes) |
| 3 | **Pipeline** | humans + triggers, hours–days | `lead_pipeline_stage`, `lead_stage_history` | Kanban (`CrmLeads.jsx`), `move_lead_to_stage`, `crm_advance_lead_if_forward`, `crm_auto_advance_leads` |
| 4 | **Sale truth** | hard evidence | `jobs.is_real_job` (+`job_real_flag_history`) | `mark_job_real` triggers, `set_job_real_job` |
| 5 | **Reporting** | read-only | — | `get_attribution_rollup`, `get_call_volume`, `get_speed_to_lead`, `get_conversion_trend`, `get_crm_revenue_by_division`, `get_estimator_leaderboard`, `get_contact_ltv`, `get_real_job_evidence_mismatches` |

### Layer 1 — Capture
CallRail fires the webhook **several times per call** (started / completed / recording-ready); the
upsert is idempotent on `callrail_id`, so re-deliveries update one row. At ingest:
- **Contact match**: `contact_id` links iff EXACTLY ONE contact shares the caller's last-10-digit
  phone suffix (ambiguous/no match → NULL — the backlink trigger closes this later, see §4).
- **Repeat-caller merge** (four tiers, `20260722_crm_dedup_repeat_caller_leads` — one person, one
  card): same phone merges into the existing lead when it is **open/stage-less** (always), in a
  **recoverable terminal stage** (Missed Calls — always, no time window: a redial of an un-handled
  caller is the same pending inquiry), **Won ≤30 days ago** (a post-win call is job logistics;
  after 30 days it's genuinely new business → new card), or **Lost proper ≤3h** (later → fresh
  card, fresh chance). Most-alive candidate wins (open > recoverable > won > lost). Sets
  `merged_into_lead_id`; the redial gets no card of its own. *(Supersedes the 2026-07-20/21 rule
  where Won never merged and Missed Calls only merged ≤3h — once missed calls auto-staged, every
  redial-after-3h duplicated, and the Won column double-counted a repeat caller — owner-caught.)*
  A WON prior lead never absorbs a redial (a past customer's new problem is a new lead).
- **Missed-call auto-stage**: the delivery carrying CallRail's EXPLICIT `answered='false'` stages the
  lead into the org's "Missed Calls" stage (string-compared, never a throwing cast; the call-started
  delivery has no `answered` key, so a ringing call never stages prematurely).
- Forms (`webflow-form-webhook` / hosted embed → `upsert_lead_from_form`) also write `contacts`,
  TCPA consent logs, and `lead_attribution` — **the only writer of `lead_attribution`**.

### Layer 2 — Enrich (the AI pass)
On recording-ready, best-effort auto-transcription: Deepgram (nova-3, diarize) → Claude naming pass →
resegment-if-mono → **verdict pass** producing: `is_customer_inquiry`, `service_match`
(in/out of scope), `caller_never_responded`, `inspection_scheduled`, customer name/email/address —
with a zero-turn fallback for dead air. Side effects (ALL best-effort, never blocking the transcript
save): spam-flag non-inquiries/dead air (removes the card), disqualify out-of-scope to Lost, advance
in-scope inquiries to **Qualified** and appointment-detections to **Inspection Scheduled**,
auto-create/link contacts, backfill contact email/address. A 6-hourly pg_cron safety net
(`upr_calls_backfill_safety_net` / `upr_calls_reclassify_safety_net`) retries anything the real-time
path silently dropped. **Structural fact: an unanswered call has no recording and can NEVER be
classified** — which is why marketing lead counts exclude them (§3) while the board still shows them.

### Layer 3 — Pipeline
`lead_pipeline_stage` (one row per lead) against admin-editable `pipeline_stages` (New → Missed
Calls → Contacted → Qualified → Inspection Scheduled → Estimate Sent → Won / Lost). Card movers:
humans dragging; the AI advances (§2); DB triggers on business events (estimate submitted → Estimate
Sent; invoice created total>0 / invoice first-paid / work-auth signed → Won, via
`crm_auto_advance_leads` per contact). **This board is sales ACTIVITY, not money** — "Won" here means
a card was moved, which is a different object from a sold job (§3).

### Layer 4 — Sale truth
`jobs` rows are created when work is **booked — including free inspections** (`phase='job_received'`),
which is exactly why phase can never mean "sold". The canonical flag `is_real_job` is auto-set by
three evidence triggers (signed work_auth/recon_agreement; invoice with `qbo_invoice_id`; approved
estimate) plus a manual JobPage toggle. Every change to the flag trio is recorded in
`job_real_flag_history`; demoting via `set_job_real_job` preserves the original
source/marked_at (evidence survives). The daily reconciler (§5's
`get_real_job_evidence_mismatches` + `upr_real_job_evidence_reconciler` cron) surfaces any
flag-vs-evidence drift.

### Layer 5 — Reporting
`CrmOverview` fires one `Promise.all` of the RPCs. Two scoping predicates govern everything (§3).
Channel resolution per lead: `lead_attribution` row → `crm_channel_for_source(lead.source)` →
contact's channel → `'other'`.

---

## 2. The composed loop (why the layers matter together)

Missed call → auto-staged **Missed Calls** → customer redials, answered → **merges** into the
canonical card → AI transcribes the redial, detects a real in-scope inquiry / an appointment →
advance **resolves the merge pointer** to the canonical and **revives** it out of Missed Calls to
Qualified / Inspection Scheduled → the AI (or the office) creates the contact → the **backlink
trigger** ties every unlinked lead from that phone to them → `crm_contact_is_traced` becomes true →
when the job sells, an evidence trigger sets `is_real_job`, the audit trail records it, and the
dashboards count it. Every arrow in that chain was broken or missing before 2026-07-22.

---

## 3. Canonical rules — THE definitions. Never reinvent these.

| Concept | THE rule | Enforced / defined by |
|---|---|---|
| **A sale ("won job")** | `jobs.is_real_job = true` — nothing else. Not phase, not stage, not invoices-eyeballed. | `UPR-Web-Context.md` ⭐ section; `20260722_crm_won_jobs_use_canonical_real_job_rule.sql`; test `crm_won_jobs_canonical_real_job_rule.test.js` |
| **Sale DATE** | `COALESCE(claims.created_at, jobs.created_at)` (matches `get_jobs_closed`). Exception: `get_commissions` deliberately uses `jobs.created_at` (payroll-period stability) — documented, do not "fix". | same migration |
| **A countable marketing lead** | non-spam AND non-merged AND (form OR answered call). Answered = `crm_call_is_answered(raw_payload, duration_sec)` in SQL; `isCountableLead(lead)` in JS — **twins; change both or neither**. | `20260722_crm_leads_exclude_unanswered_calls.sql`; `crmCharts.js` |
| **Speed-to-lead** | HUMAN first move only (`lead_stage_history.moved_by IS NOT NULL`). System moves are not responses. | `20260722_crm_speed_to_lead_human_moves_only.sql` |
| **CRM-traced business** | `crm_contact_is_traced(contact_id)`: a `lead_attribution` row OR a non-spam lead link. Gates estimates/won-jobs/revenue on CRM pages. Company-wide totals live on the Home dashboard, deliberately not here. | `20260722_crm_scope_attribution_to_traced_contacts.sql` |
| **Who moved a card** | `lead_stage_history.moved_by`: uuid = a human; **NULL = the system** (auto-stage, AI advance, triggers). | convention, relied on by speed-to-lead |
| **Ops vs marketing scope** | The Kanban board, task picker, and pipeline card show EVERYTHING non-spam/non-merged (staff must see missed calls to call back). Marketing metrics apply the countable-lead rule. This asymmetry is deliberate — do not "unify" it. | owner decision 2026-07-22 |

---

## 4. Invariants — things that must never break (each has an enforcement + a committed test)

1. **A merged lead never owns a stage row.** Redial duplicates render nowhere; their story lives on
   the canonical card ("Follow-up call" in the activity timeline).
   *(merge design + `crm_advance_lead_if_forward`'s pointer resolution; tests:
   `crm_merge_repeat_call_leads.test.js`, `crm_advance_revives_recoverable_stages.test.js`)*
2. **Any pipeline-advance signal fired on a merged row acts on its canonical root.** The AI pass runs
   on the redial row (where the transcript lives) — the function resolves the pointer first.
3. **Won and Lost are human-sticky.** No automation ever moves a lead off them. The ONLY exception is
   a stage marked `pipeline_stages.is_recoverable = true` (today: Missed Calls — a callback
   work-queue, not a judgment), which forward evidence may revive.
4. **A human's placement always beats the machine's.** Auto-stage/auto-advance never overwrite an
   existing stage row backward, and auto-stage never fires at all when any stage row exists.
5. **Every change to `jobs.is_real_job` / source / marked_at lands in `job_real_flag_history`** — RPC,
   trigger, or raw write alike — and **demotion preserves the original evidence**
   (`is_real_job=false` + `real_job_marked_at NOT NULL` = the recognizable "was sold, then demoted"
   signature). *(`20260722_real_job_flag_audit_trail.sql`)*
6. **Every automated identity link is audited and reversible.** Backlinks write
   `system_events('crm_lead_backlinked')`; a contact phone CHANGE releases that trigger's own prior
   links for the old number (`'crm_lead_backlink_reverted'`) — so a mistyped/recycled number can
   never permanently poach a stranger's lead history. Human-made links are never auto-touched.
   *(`20260722_crm_lead_contact_backlink.sql`)*
7. **The webhook write path never throws on payload garbage.** String comparisons over casts,
   best-effort side effects, 200-on-error (CallRail retry-storm guard).
8. **Identity linking uses ONE phone rule everywhere**: digits-only, `right(digits,10)`, both sides
   ≥10 digits, and link only when exactly ONE contact holds the suffix.

---

## 5. Vocabulary added 2026-07-22 (so greps land)

- `system_events.event_type`: `crm_lead_backlinked`, `crm_lead_backlink_reverted`,
  `real_job_evidence_mismatch` (whole-table events use the all-zeros sentinel `entity_id` — house
  convention), plus pre-existing `crm_lead_merged` / `crm_lead_created` / `crm_lead_updated`.
- `pipeline_stages.is_recoverable` — terminal-but-revivable (Missed Calls true; Won/Lost false).
- `job_real_flag_history` — the sale-flag ledger.
- pg_cron jobs: `upr_calls_backfill_safety_net`, `upr_calls_reclassify_safety_net`,
  `upr_real_job_evidence_reconciler` (plus the pre-existing automation/clock jobs).
- `real_job_source` values seen live: `work_auth | invoice | estimate | manual | backfill | verified |
  q2_reconcile_activity | encircle:*` — only the first five are documented writers; the rest are
  reconciliation-era history (see §7).

---

## 6. The failure patterns that caused every 2026-07-22 bug — use as review lenses

1. **Parallel definitions drift.** Five RPCs reinvented "won" as `phase <> 'lead'` and reported
   booked free inspections as sales (12 shown, 1 real). *Lens: if you're writing a WHERE clause that
   answers a business question, the canonical predicate probably already exists — call it.*
2. **Manual-once surfaces look automated.** The entire Missed Calls column (19 placements) and the
   entire Won column (12) were each ONE human bulk session; nothing ever moved cards automatically,
   and the counts froze the moment the human stopped. *Lens: for any "live" surface, find its
   automatic writer; if you can't, it isn't live.*
3. **Triggers that watch only their own column.** `AFTER UPDATE OF qbo_invoice_id` never re-fires
   when `job_id` is linked later — evidence arrives, nothing happens. *Lens: a trigger's UPDATE OF
   list must include every column in its WHEN condition's join path.* (Known open instance: the three
   `mark_job_real` triggers still don't watch `job_id`.)
4. **Structurally-unclassifiable data counted by default.** Unanswered calls can never be
   AI-screened, so "not flagged spam" silently meant "never checkable" — 45% of a week's "leads"
   were ring-outs. *Lens: for every classifier, ask what happens to items it can never reach.*
5. **Writes without an audit trail.** A bulk demotion un-sold 13 paid jobs ($37K+ collected) and the
   only proof it ever happened was a microsecond-identical timestamp pattern. *Lens: any
   business-truth flag needs a history table + trigger BEFORE it needs anything else.*
6. **Fixes that poison a neighbor.** The missed-call auto-stage instantly polluted speed-to-lead
   with fake 0-minute "responses" (caught same-day). *Lens: after changing what writes a table, grep
   every reader of that table.*

---

## 7. Known limits & open items (flagged, deliberately not built — do not silently "fix")

- **Owner rulings received 2026-07-22 (two of three executed):**
  - *Denver bucketing* — RULED "fix everywhere" and SHIPPED: all seven date-windowed CRM RPCs +
    `get_jobs_closed` now window/bucket via `mt_date()` (`20260722_crm_denver_day_bucketing.sql`;
    proof: an 11:30 PM Denver call counts on its Denver day, test
    `crm_denver_day_bucketing.test.js`). The 24%-wrong-day defect is closed; `get_commissions`
    deliberately untouched.
  - *Traced-gate display* — RULED "show both, labeled" and SHIPPED: `get_crm_sales_summary`
    (`20260722_crm_sales_summary_total_vs_traced.sql`) returns company-wide + traced won/revenue in
    one canonical query; CrmOverview's Won jobs / Revenue cards keep the traced headline with an
    "of N company-wide" sublabel.
  - *2026-07-03 demotion adjudication* — RULED AND EXECUTED (2026-07-22): the owner reviewed the
    17-row evidence-unflagged worklist and ruled "every job with a payment is a real job; same for
    a signed work auth" → all 17 restored via `set_job_real_job` (actor = owner; 17
    `job_real_flag_history` rows written — note `changed_by` is null there because the history
    trigger reads `auth.uid()`, absent in a SQL-run; `jobs.updated_by` carries the owner id).
    All-time sales 87 → **104** / $577K → **$628K**; the restored jobs date into their historical
    months (Mar–Jun), so current-week numbers were untouched. The reconciler's evidence_unflagged
    bucket is now **0**; the 14 flagged-no-evidence rows stay as-is (reconciliation-era manual
    verdicts, documented-legitimate).
- **Missed-call textback is dead-on-arrival** when A2P flips: `isMissedCall` in
  `run-automations.js` uses the duration proxy (ring time counts as "answered") AND requires
  `contact_id` (unanswered calls rarely have one). Consent-sensitive redesign — do not hot-fix.
- **`mark_job_real` triggers don't watch `job_id`** (§6 lens 3) — the reconciler catches the drift
  daily until fixed.
- **Won auto-advance has never fired organically** (0 system Won moves ever) — it needs the lead↔
  contact link, which the backlink trigger now provides going forward.
- **Forms are never AI-screened** — a spam form counts as a lead forever.
- **"Contacted" has no auto-mover** — outbound calls are invisible to the system (properly solved by
  the Twilio phone platform, below).
- **Backlink edges (disclosed in its migration):** household shared numbers — first contact created
  wins until the second exists; `merge_contacts` doesn't re-fire the backlink (freed leads stay
  unlinked until the survivor's phone is touched).
- **`jobs.estimator` is NULL on all rows** — the Estimator Leaderboard card has always rendered
  empty. Populate it or remove the card.

---

## 8. The Twilio future — provider seams (standing owner directive)

CallRail will eventually be replaced by an in-app Twilio phone platform (lines, numbers, forwarding).
**Do not deepen CallRail coupling.** The intelligence layers (§2–§5) sit entirely above the provider
seam; the six hard couplings to unwind in that initiative's Foundation are: `callrail_id` as the
idempotency key (→ `provider` + `provider_call_id`); `crm_call_is_answered`/`isCountableLead` reading
`raw_payload`'s CallRail shape (→ a first-class `answered` column stamped by the ingest adapter);
recording resolution via `callrail-api.js` (→ a provider adapter); CallRail's source/medium/campaign
attribution (→ an owned `phone_numbers` table mapping numbers to campaigns — which IS the
number-management product); the webhook mapper (already the right seam — a Twilio voice webhook is a
sibling mapper into the same upsert); CallRail's spam pre-flag (AI classifier already covers).
Twilio assets already in-house: `twilio.js`, credential resolver, SMS webhooks with idempotency
claims, A2P registration in flight. See the persistent memory
`project-twilio-phone-platform-constraint` and the planned `/masterplan` for the phone platform.
