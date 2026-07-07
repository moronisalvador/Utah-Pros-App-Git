# Admin Mobile — Dispatch (cold-session launch blocks)

Plan of record: `docs/admin-mobile-roadmap.md`. Ownership: `.claude/rules/admin-mobile-wave-ownership.md`.
Each block below is a **complete, standalone** prompt for a fresh Claude Code session — no block
references any conversation. Where a block cites a Foundation artifact name, the **ownership
manifest + the phase's roadmap block are authoritative** if names drift.

## Preconditions

- **Wave 0 (Foundation) unlocks Wave 1.** Do not launch any Wave-1 session until Foundation's PR
  has merged to `dev`.
- **Coordinate Foundation's one `src/App.jsx` line with the in-flight Tech Job Hub v2 H3 cutover**
  (which rewrites the same `TechRoutes()` block). Before dispatching Foundation, confirm H3's
  status; if H3 is open, let one land its edit first and the other rebase (it is a one-line hunk).
- **Owner pre-decisions (settled):** admin features live in the tech PWA; "receive payment" =
  record-a-payment only; admins-only, dark-launched behind `page:admin_mobile` (already seeded
  `enabled:false` + owner `dev_only_user_id`). **The flag flip to all admins is the owner's**,
  after the wanted phases merge and bake.
- **Wave 1 sessions may all launch simultaneously** once Foundation merges. They are
  pairwise-disjoint. Merge order is a preference (P2 → P3 → P4a → P1 → P4b → P5), never a gate —
  throttle concurrent sessions to your review bandwidth.

---

## Wave 0

### [Session F — Wave 0]  Foundation
- **Branch:** use your harness-assigned `claude/*` branch, cut from `dev`.
- **Model:** Opus · **Effort:** high
- **Launch after:** now (coordinate the App.jsx one-liner with Job Hub v2 H3 per Preconditions).

```
You are building Phase F (Foundation) of the Admin Mobile initiative — ONE phase only, no scope
creep. Read, in order: CLAUDE.md; the "Phase F — Foundation" block in docs/admin-mobile-roadmap.md;
.claude/rules/admin-mobile-wave-ownership.md; .claude/rules/tech-mobile-ux.md.

Goal: bring admin capabilities into the field-tech PWA (/tech/*, TechLayout), reached from
TechMore.jsx, gated to employee.role === 'admin' behind the dark flag page:admin_mobile
(already seeded in the DB: enabled=false, dev_only_user_id = the owner). Foundation ships the
SEAMS ONLY — no feature logic; every screen is an empty stub.

Hard constraints:
- ZERO migrations, ZERO new RPCs. The entire backend already exists. If you think you need one,
  STOP and flag it — do not add one.
- Your src/App.jsx edit is EXACTLY ONE line: a delegating <Route path="admin/*" element={...}>
  inside TechRoutes(), pointing at a new src/pages/tech/admin/AdminMobileRoutes.jsx subrouter.
  All per-screen routes live in that subrouter. Never reuse /tech or /tech/schedule (they render
  null for persistent panes). NOTE: the Tech Job Hub v2 H3 cutover may be editing the same
  TechRoutes() block — keep your line at the end of the block to minimize merge conflict.
- Admin-mobile icons live in src/components/admin-mobile/** — NEVER add to Icons.jsx or the
  frozen crmIcons.jsx.
- index.css: pre-scaffold SIX reserved markers near the tech block:
  /* ─── ADMIN-MOBILE: SHARED ─── */ and one each for DASH, COLLECTIONS, INVOICE, ESTIMATE, LEADS.
  New classes are .am-*; never restyle existing .tech-*/.coll-*/.crm-* selectors.

Build order:
1. Add page:admin_mobile to src/lib/featureFlags.js EXPLICIT_FLAGS as enabled:false (load-bearing).
2. Write the AdminMobileRoute guard (role==='admin' && isFeatureEnabled('page:admin_mobile'), else
   <Navigate to="/tech">). Test-first: a named unit test of its allow/deny matrix.
3. Write src/pages/tech/admin/AdminMobileRoutes.jsx wiring six routes to stub pages, and add the
   ONE delegating line to App.jsx.
4. Write the stub pages under src/pages/tech/admin/: AdminDash, AdminCollections,
   AdminInvoiceDetail, AdminEstimateDetail, AdminEstimateEditor, AdminLeadCenter (each renders a
   TabLoading/placeholder).
5. Write src/components/admin-mobile/** shared primitives: AdminMobilePage, MoneyStatCard,
   AmListRow, PeriodSwitch, AmTabs, an href helper (build links to the detail routes), and the
   admin-mobile icon set. Publish the shared .am-* CSS vocabulary in the SHARED marker.
6. Add the admin nav group to src/pages/tech/TechMore.jsx, conditional on
   role==='admin' && isFeatureEnabled('page:admin_mobile') (mirror the existing
   tool:oop_pricing conditional-group pattern), linking to the five/six stub routes.
7. Commit .claude/rules/admin-mobile-wave-ownership.md (already drafted — verify it matches what
   you shipped; correct any path drift).

Follow every CLAUDE.md non-negotiable (useAuth() db; no alert()/confirm(); CSS tokens; documentation
header on new files). Close out: npm run test + npm run build green; npx eslint clean on changed
files; run upr-pattern-checker and admin-mobile-phase-reviewer; visual check (admin sees the More
group only with the flag on; a tech never does; desktop Layout untouched); update UPR-Web-Context.md;
reconcile the Phase-F checklist in the roadmap (both directions); push -u; open a PR into dev as a
handoff and STOP. Do not click-merge, subscribe to, or babysit the PR.
```

---

## Wave 1  (launch all after Foundation merges; merge preference P2 → P3 → P4a → P1 → P4b → P5)

### [Session B2 — Wave 1]  P2 Collections / AR
- **Branch:** harness-assigned `claude/*`, cut from `dev`. **Model:** Opus · **Effort:** medium
- **Launch after:** Foundation merged.

```
You are building Phase P2 (Collections / AR, mobile) of the Admin Mobile initiative — ONE phase
only, no scope creep. Read: CLAUDE.md; the "Phase P2" block in docs/admin-mobile-roadmap.md;
.claude/rules/admin-mobile-wave-ownership.md; .claude/rules/tech-mobile-ux.md.

Foundation shipped: the page:admin_mobile flag + AdminMobileRoute guard, the AdminMobileRoutes.jsx
subrouter with your route wired to a stub, the src/components/admin-mobile/** primitives (AmTabs,
AmListRow, MoneyStatCard, PeriodSwitch, href helper, icons, .am-* CSS), the TechMore admin group,
and the six index.css markers. Import those; never edit them.

Hard constraints: ZERO migrations / ZERO new RPCs (read existing RPCs only). Edit ONLY
src/pages/tech/admin/AdminCollections.jsx, src/components/admin-mobile/collections/**, and the
index.css §COLLECTIONS marker. Never restyle .tech-*/.coll-*/.crm-*.

Build: mobile tabs (AR aging · Invoices · Estimates · Payments ledger) via AmTabs, reusing
get_ar_invoices, get_estimates, get_payments_ledger, get_payments_received (POST rpc via
useAuth() db). Period switch on AR/Invoices. Rows deep-link via Foundation's href helper to the
AdminInvoiceDetail / AdminEstimateDetail routes (frozen route strings — smoke-test nav against
the stubs; the full landing is a VERIFICATION TAIL once P3/P4a merge — say so in your PR).
FINANCIAL GATE: AR and payments ledger are financial — respect canAccess('overview_financials')
(skip render AND fetch for non-privileged roles).

Test-first (named): list render + aging-bucket math (reuse the desktop AGING_BUCKETS) + the href
builder. Non-negotiables: useAuth() db; no alert()/confirm(); CSS tokens; doc header on new files.
Close out: npm run test + build green; eslint clean; upr-pattern-checker + admin-mobile-phase-reviewer
clean; visual check desktop+mobile; update UPR-Web-Context.md; reconcile the P2 checklist (both
directions); push -u; open a PR into dev as a handoff and STOP.
```

### [Session B3 — Wave 1]  P3 Invoice view + send + record payment  ⚠ money
- **Branch:** harness-assigned `claude/*`, cut from `dev`. **Model:** Opus · **Effort:** high
- **Launch after:** Foundation merged.

```
You are building Phase P3 (Invoice view + send + RECORD PAYMENT, mobile) of the Admin Mobile
initiative — ONE phase only, no scope creep. This is MONEY-CRITICAL. Read: CLAUDE.md; the
"Phase P3" block in docs/admin-mobile-roadmap.md (finding F-1 binds); BILLING-CONTEXT.md;
.claude/rules/admin-mobile-wave-ownership.md (§3 call-only seams); .claude/rules/tech-mobile-ux.md.

Foundation shipped the flag/guard/subrouter/primitives/markers (import only). Edit ONLY
src/pages/tech/admin/AdminInvoiceDetail.jsx, src/components/admin-mobile/invoice/**, and the
index.css §INVOICE marker.

Hard constraints — READ CAREFULLY (finding F-1):
- ZERO migrations / ZERO new RPCs. There is NO record_payment RPC — replicate the desktop path
  from src/pages/InvoiceEditor.jsx (the receivePayment/recordPayment handlers) WITHOUT editing it.
- Record payment = db.insert('payments', {...}) then POST /api/qbo-payment { payment_id } (Bearer).
  Insert ONLY: invoice_id, job_id, contact_id, amount, payment_date, payer_type, payer_name,
  payment_method, reference_number, recorded_by. NEVER write amount_paid / insurance_paid /
  homeowner_paid / status / paid_at — a DB trigger owns them.
- Guard double-submit (a busy flag; there is no insert-level idempotency key). Only POST
  /api/qbo-payment when inv.qbo_invoice_id exists. Treat a failed QBO sync as NON-FATAL (the UPR
  payments row is already recorded; qbo_sync_error is stored) — surface a toast, do not roll back.
- Never edit functions/api/qbo-payment.js or qbo-invoice.js (call-only). Never bypass the human
  Save→QBO gate.

Build: view the invoice (line items read-only); send it (POST /api/qbo-invoice { action:'send' });
record a payment per the spec above with a TWO-CLICK inline confirm (Rule 2 — no confirm()) and a
toast. Show balance = adjusted_total ?? total − amount_paid (reuse the desktop calc).

Test-first (named): the payment insert writes only the safe column set and asserts it does NOT
write amount_paid/status/paid_at; the double-submit guard; the qbo_invoice_id precondition; the
non-fatal QBO-sync path. Non-negotiables: useAuth() db; no alert()/confirm(); CSS tokens; doc
header. Close out: npm run test + build green; eslint clean; upr-pattern-checker +
admin-mobile-phase-reviewer (money-weighted) clean; visual check; update UPR-Web-Context.md;
reconcile the P3 checklist (both directions); push -u; open a PR into dev as a handoff and STOP.
```

### [Session B4a — Wave 1]  P4a Estimate view + send + convert
- **Branch:** harness-assigned `claude/*`, cut from `dev`. **Model:** Opus · **Effort:** medium
- **Launch after:** Foundation merged.

```
You are building Phase P4a (Estimate view + send + convert, mobile) of the Admin Mobile
initiative — ONE phase only, no scope creep. Read: CLAUDE.md; the "Phase P4a" block in
docs/admin-mobile-roadmap.md; BILLING-CONTEXT.md; .claude/rules/admin-mobile-wave-ownership.md;
.claude/rules/tech-mobile-ux.md.

Foundation shipped the flag/guard/subrouter/primitives/markers (import only). Edit ONLY
src/pages/tech/admin/AdminEstimateDetail.jsx, src/components/admin-mobile/estimate/** (VIEW
modules — distinct files from P4b's builder), and the index.css §ESTIMATE marker (view rules; if
P4b is also in flight, keep your rules above its appended block).

Hard constraints: ZERO migrations / ZERO new RPCs. Call-only on /api/qbo-estimate,
convert_estimate_to_invoice, /api/qbo-invoice — never edit them or EstimateEditor.jsx.

Build: view an estimate (line items read-only); send (POST /api/qbo-estimate { action:'send' });
convert to invoice (convert_estimate_to_invoice → /api/qbo-invoice, honoring the needs_confirm
two-click return). Surface "Edit / add line items" and "New estimate" as links to P4b's route via
Foundation's href helper (frozen route — verification tail after P4b merges; say so in the PR).

Test-first (named): the send payload + the convert needs_confirm handling. Non-negotiables:
useAuth() db; no alert()/confirm() (two-click for convert); CSS tokens; doc header. Close out:
npm run test + build green; eslint clean; upr-pattern-checker + admin-mobile-phase-reviewer clean;
visual check; update UPR-Web-Context.md; reconcile the P4a checklist (both directions); push -u;
open a PR into dev as a handoff and STOP.
```

### [Session B1 — Wave 1]  P1 Admin dashboard  ⚠ financial gate
- **Branch:** harness-assigned `claude/*`, cut from `dev`. **Model:** Opus · **Effort:** medium
- **Launch after:** Foundation merged.

```
You are building Phase P1 (Admin dashboard, mobile) of the Admin Mobile initiative — ONE phase
only, no scope creep. Read: CLAUDE.md; the "Phase P1" block in docs/admin-mobile-roadmap.md
(finding F-2 binds); UPR-Design-System.md; .claude/rules/admin-mobile-wave-ownership.md;
.claude/rules/tech-mobile-ux.md.

Foundation shipped the flag/guard/subrouter/primitives/markers (import only). Edit ONLY
src/pages/tech/admin/AdminDash.jsx, src/components/admin-mobile/dash/**, and the index.css §DASH
marker.

Hard constraints: ZERO migrations / ZERO new RPCs — reuse the existing widget RPCs
(get_revenue_by_division, get_payments_received, get_avg_ticket, get_open_estimates_summary,
get_jobs_closed, get_jobs_completed, get_active_drying_jobs, get_ar_invoices,
get_dashboard_action_items, get_tech_status_board, get_pipeline_summary). Mirror the desktop
src/pages/Dashboard.jsx logic (read it; do not import its internals). Charts are CSS/SVG (no chart
lib). Fixed widget order on mobile (NO drag/resize).

FINANCIAL GATE (finding F-2 — highest risk): the financial RPCs are NOT server-gated. Reproduce
canAccess('overview_financials') and skip BOTH the render AND the fetch for non-privileged roles
(mirror the desktop enabled=false pattern so the RPC is never called). Test-first (named): assert
the financial widgets are neither rendered nor fetched when canAccess('overview_financials') is
false.

Period switch (MTD/Last 30/QTD/YTD; reuse periodBounds). Rows deep-link via the href helper.
Non-negotiables: useAuth() db; no alert()/confirm(); CSS tokens; doc header. Close out:
npm run test + build green; eslint clean; upr-pattern-checker + admin-mobile-phase-reviewer
(gate-weighted) clean; visual check; update UPR-Web-Context.md; reconcile the P1 checklist (both
directions); push -u; open a PR into dev as a handoff and STOP.
```

### [Session B4b — Wave 1]  P4b Estimate create + line-item builder  (deferrable)
- **Branch:** harness-assigned `claude/*`, cut from `dev`. **Model:** Opus · **Effort:** high
- **Launch after:** Foundation merged (build parallel; merge after P4a for coherent UX).

```
You are building Phase P4b (Estimate CREATE + line-item builder, mobile) of the Admin Mobile
initiative — ONE phase only, no scope creep. This is the heaviest UI in the wave. Read: CLAUDE.md;
the "Phase P4b" block in docs/admin-mobile-roadmap.md; BILLING-CONTEXT.md;
.claude/rules/admin-mobile-wave-ownership.md; .claude/rules/tech-mobile-ux.md.

Foundation shipped the flag/guard/subrouter/primitives/markers (import only). Edit ONLY
src/pages/tech/admin/AdminEstimateEditor.jsx, the BUILDER modules under
src/components/admin-mobile/estimate/** (distinct files from P4a's view modules), and the index.css
§ESTIMATE marker (builder rules — append BELOW P4a's block inside the marker; never edit P4a's lines).

Hard constraints: ZERO migrations / ZERO new RPCs. Create = create_estimate_for_contact
(contact-only — no job/claim dependency; reuse search_contacts_for_job, get_insurance_carriers,
AddContactModal, AddressAutocomplete). Line items write estimate_line_items; line_total is a
GENERATED column — NEVER write it. QBO item/class lookup via /api/qbo-query (call-only). Never edit
EstimateEditor.jsx or the workers.

Test-first (named): the create-shell payload; the line-item write excludes line_total.
Non-negotiables: useAuth() db; no alert()/confirm(); CSS tokens; doc header. Close out:
npm run test + build green; eslint clean; upr-pattern-checker + admin-mobile-phase-reviewer clean;
visual check; update UPR-Web-Context.md; reconcile the P4b checklist (both directions); push -u;
open a PR into dev as a handoff and STOP.
```

### [Session B5 — Wave 1]  P5 Lead Center
- **Branch:** harness-assigned `claude/*`, cut from `dev`. **Model:** Opus · **Effort:** medium
- **Launch after:** Foundation merged.

```
You are building Phase P5 (Lead Center, mobile) of the Admin Mobile initiative — ONE phase only,
no scope creep. Read: CLAUDE.md; the "Phase P5" block in docs/admin-mobile-roadmap.md;
.claude/rules/admin-mobile-wave-ownership.md (§3 call-only seams); .claude/rules/tech-mobile-ux.md.

Foundation shipped the flag/guard/subrouter/primitives/markers (import only). Edit ONLY
src/pages/tech/admin/AdminLeadCenter.jsx, src/components/admin-mobile/leads/**, and the index.css
§LEADS marker.

Hard constraints: ZERO migrations / ZERO new RPCs.
- Leads list via get_inbound_leads (embeds contact; POST rpc). Filter spam/status.
- Play recording via GET /api/callrail-recording?lead_id=<uuid> with a Supabase Bearer header
  (getAuthHeader) — it returns an AUDIO BLOB; play via URL.createObjectURL (an <audio src> can't
  carry the header). Never edit functions/api/callrail-recording.js.
- View transcript from the stored transcript_analysis jsonb (summary/sentiment/topics/speaker
  turns) with a flat-transcription fallback for older rows.
- COPY IN RecordingPlayer + TranscriptView from src/pages/crm/CrmCallLog.jsx into
  src/components/admin-mobile/leads/**, and copy their crm-* CSS into your §LEADS marker. NEVER
  edit CrmCallLog.jsx or the CRM stylesheet.
- Lead status/stage writes are CALL-ONLY on the CRM-owned REPLACEs move_lead_to_stage /
  get_contact_activity — never re-REPLACE them.

Test-first (named): lead-list render + transcript-view render from a fixture transcript_analysis.
Non-negotiables: useAuth() db; no alert()/confirm(); CSS tokens; doc header. Close out:
npm run test + build green; eslint clean; upr-pattern-checker + admin-mobile-phase-reviewer clean;
visual check; update UPR-Web-Context.md; reconcile the P5 checklist (both directions); push -u;
open a PR into dev as a handoff and STOP.
```

---

## Wave table

| Wave | Session | Phase | Model · effort | Launch after |
|---|---|---|---|---|
| 0 | F | Foundation | Opus · high | now (coordinate App.jsx line w/ Job Hub v2 H3) |
| 1 | B2 | P2 Collections / AR | Opus · medium | F merged |
| 1 | B3 | P3 Invoice + record payment ⚠money | Opus · high | F merged |
| 1 | B4a | P4a Estimate view + send | Opus · medium | F merged |
| 1 | B1 | P1 Admin dashboard ⚠gate | Opus · medium | F merged |
| 1 | B4b | P4b Estimate create + build (deferrable) | Opus · high | F merged (merge after P4a) |
| 1 | B5 | P5 Lead Center | Opus · medium | F merged |
