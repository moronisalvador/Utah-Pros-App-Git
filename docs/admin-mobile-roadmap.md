# Admin Mobile — Roadmap (plan of record)

**Slug:** `admin-mobile` · **Created:** 2026-07-07 · **Owner:** Moroni Salvador
**Companion docs:** `docs/admin-mobile-dispatch.md` (cold-session launch blocks),
`.claude/rules/admin-mobile-wave-ownership.md` (file/RPC ownership manifest — authoritative
where names drift).

> **One-line goal.** Bring the core admin capabilities into the **field-tech PWA shell**
> (`/tech/*`, `TechLayout`), reached from the tech **"More"** screen, gated to
> `employee.role === 'admin'` behind a **dark feature flag** (`page:admin_mobile`,
> owner-only until flipped). Screens: admin **Dashboard**, **Collections/AR**, **Invoice
> view + send + record-payment**, **Estimate view + send** (+ a deferred create/build
> surface), and a **Lead Center** (leads + call-recording playback + transcripts).

---

## 0. Owner decisions of record (2026-07-07 planning session)

1. **Where the features live:** *inside the tech PWA*, admin-gated under "More" — **not** a
   mobile-polish of the office `Layout` shell, and **not** a separate third shell.
2. **"Receive payments on mobile" means:** *record a payment already received* (cash / check /
   card-in-hand) — mirrors to QuickBooks via the existing path. **Out of scope:** Stripe
   pay-by-link and QBO card-charge (their workers exist but stay unwired).
3. **Audience & rollout:** *admins only*, **dark-launched** behind `page:admin_mobile`
   (owner-only `dev_only_user_id`), flipped on when ready. Flag flips are the owner's.

---

## 1. State verified live (2026-07-07) — not trusted from docs

All findings below are from live Supabase schema reads (`information_schema`, `pg_proc`) and
real file reads, cross-checked by an adversarial challenge pass (§7).

- **Two shells.** Admins normally land in the office `Layout` (`src/components/Layout.jsx`);
  field techs use the `/tech/*` PWA (`src/components/TechLayout.jsx`), whose bottom bar is
  `Dash · Claims · Schedule · Messages · More`. Per Owner decision 1, admin-mobile screens
  live in the tech shell, gated in, reached from `src/pages/tech/TechMore.jsx`.
- **Backend is ~95% already built — this is a FRONTEND-heavy initiative with ZERO new
  schema.** All 17 dashboard/billing/lead RPCs exist and are callable by an authenticated
  admin; `payments` and `inbound_leads` carry every needed column (verified).
- **No `record_payment` RPC.** Recording a payment = `db.insert('payments', {...})` then
  `POST /api/qbo-payment { payment_id }` (idempotent; non-fatal if QBO sync fails). A DB
  trigger (`update_invoice_paid`) owns `amount_paid`, `insurance_paid`, `homeowner_paid`,
  `status`, `paid_at` — **mobile code must never write those columns.**
- **Financial dashboard RPCs have NO server-side gate.** `get_revenue_by_division`,
  `get_payments_received`, `get_avg_ticket`, `get_ar_invoices`, etc. are `SECURITY DEFINER`
  readers with no role check. The desktop hides financials via a **UI-layer**
  `canAccess('overview_financials')`. The mobile UI **must reproduce that gate** or it leaks
  financials to non-privileged admins.
- **Lead Center is fully reusable with zero CRM-file edits.** `get_inbound_leads` (GRANT to
  authenticated), `GET /api/callrail-recording?lead_id=` (any-authenticated-employee Bearer,
  no `page:crm` gate; returns an audio blob), and the stored `transcript_analysis` jsonb are
  all directly consumable. `RecordingPlayer` + `TranscriptView` in `src/pages/crm/CrmCallLog.jsx`
  are self-contained and can be **copied in** (their `crm-*` CSS copied too — never edit the
  CRM sheet).

### Status reconciliation (in-flight initiatives — collision awareness)

| Initiative | State (verified) | Bearing on admin-mobile |
|---|---|---|
| Tech Mobile v2 (dash/schedule) | **shipped** (F/S/D/C) | shell pattern to mirror; no collision |
| Tech **Job Hub v2** (H1/H2/H3) | **H1/H2 landed; H3 cutover PENDING** — legacy `TechAppointment.jsx` + `TechJobDetail.jsx` still on disk | **Only acute seam:** H3 rewrites the `src/App.jsx` tech-route block. Mitigated (§5, §6). |
| CRM wave | phases 0–4d, 6–9 shipped; **Phase 5 + 10** in-flight | `move_lead_to_stage`/`get_contact_activity` are CRM-owned REPLACEs — P5 **calls only** |
| Settings Overhaul | F/P1/P2/P3/P6/P7-lite shipped; P4 tail + P10 planned | no shared owned files |
| omni-inbox / schedule / feedback-media / notify | planned or partially shipped | no shared owned files |

No stale checkbox drift to disclose — this is a net-new initiative (no prior admin-mobile
tracker rows exist). Progress is tracked via this doc's phase checklists (no CRM-style
`crm_build_phases` tracker — this is not a CRM initiative; see §9).

---

## 2. Severity findings

No P0/P1 bugs surfaced. Two constraints are promoted to **binding, tested acceptance
criteria** because getting them wrong is a money or data-exposure defect:

**F-1 (money — data integrity, HIGH scrutiny).** The mobile record-payment path must insert
**only** `{ invoice_id, job_id, contact_id, amount, payment_date, payer_type, payer_name,
payment_method, reference_number, recorded_by }`. It must **never** write the trigger-owned
columns (`amount_paid`, `insurance_paid`, `homeowner_paid`, `status`, `paid_at`). It must
guard double-submit (a `busy` flag — there is no insert-level idempotency key), only POST
`/api/qbo-payment` when `inv.qbo_invoice_id` exists (with a Bearer header), and treat a failed
QBO sync as **non-fatal** (the UPR `payments` row is already recorded; `qbo_sync_error` is
stored). *Exposure:* writing a computed column would corrupt `invoices.amount_paid`/`status`
for that invoice until re-derived. *Interim guidance until P3 ships:* none needed — the
desktop path is untouched. **Owns:** Phase P3, test-first.

**F-2 (financial data exposure, HIGH scrutiny).** The financial dashboard widgets have no
server-side gate; the mobile dashboard **must** reproduce `canAccess('overview_financials')`
and skip both the render **and** the fetch for non-privileged roles (mirror the desktop
`enabled=false` pattern in `usePolledRpc`). *Exposure:* a non-privileged admin-role user on
mobile could see revenue/AR/payments the desktop hides. **Owns:** Phase P1, test-first.

---

## 3. Capability gap audit (evidence table)

`✓Challenge` = adversarially re-verified in §7 (refute-first pass).

| # | Capability | Verdict | Evidence (file / RPC / live query) |
|---|---|---|---|
| A1 | Admin dashboard on mobile | **MISSING** | `src/pages/Dashboard.jsx` desktop-only (`react-grid-layout`); 11 widget RPCs all present (live `pg_proc`) |
| A2 | Financial gate reproduced on mobile | **MISSING (security)** ✓Challenge | RPCs ungated server-side; `Dashboard.jsx:97` `canAccess('overview_financials')` is UI-only |
| B1 | Collections/AR worklist on mobile | **MISSING** | `src/pages/Collections.jsx` + `src/components/collections/*`; `get_ar_invoices` present |
| B2 | Invoice view + send on mobile | **MISSING** | `src/pages/InvoiceEditor.jsx`; `/api/qbo-invoice` (send action) |
| B3 | Record payment on mobile | **MISSING** ✓Challenge | path = `db.insert('payments')` + `/api/qbo-payment` (`InvoiceEditor.jsx:414`); **no `record_payment` RPC** (live `pg_proc`) |
| B4 | Estimate view + send | **MISSING** | `get_estimates`, `/api/qbo-estimate` (send), `convert_estimate_to_invoice` |
| B5 | Estimate **create + line-item build** | **MISSING + heavier than it looks** ✓Challenge | create = thin `create_estimate_for_contact` (contact-only, no job/claim dep) → then the large `EstimateEditor` line-item surface |
| C1 | Lead list on mobile | **MISSING** | `get_inbound_leads` (GRANT authenticated); `inbound_leads` cols verified |
| C2 | Call recording playback | **MISSING** ✓Challenge | `GET /api/callrail-recording?lead_id=` (any-employee Bearer, no CRM gate); `recording_url` stored, audio streamed live |
| C3 | Call transcripts | **MISSING** ✓Challenge | `transcript_analysis` jsonb + `transcription` text stored on `inbound_leads`; `TranscriptView` reusable |

Taxonomy: **A** = dashboard/insight, **B** = money/billing, **C** = lead intelligence.

---

## 4. Phases

Standard schema per phase. Every wave phase ships **zero migrations** and **zero new RPCs**
(this initiative adds no schema — see §8). Each phase's close-out ends by opening a PR into
`dev` as a **handoff and stopping** — the owner/orchestrator merges; sessions do **not**
click-merge, subscribe, or babysit.

---

### Phase F — Foundation

> **Branch:** session-assigned `claude/*` (illustrative: `admin-mobile/foundation`), cut from `dev`.
> **Prerequisite:** none to build. **Merge coordination:** its one-line `src/App.jsx` edit
> shares the tech-route block with the in-flight Job Hub v2 **H3** cutover — see §5/§6; the
> edit is deliberately reduced to a single delegating line to make the merge trivial.
> **Model · effort:** Opus · high (gating/security seam + shared-primitive contracts).
> **Read scope:** `CLAUDE.md` + this Phase-F block + `.claude/rules/tech-mobile-ux.md` +
> `.claude/rules/admin-mobile-wave-ownership.md` (this phase commits it).

**Close-out checklist**
- [x] `page:admin_mobile` added to `src/lib/featureFlags.js` `EXPLICIT_FLAGS` as
      **`enabled:false`** (load-bearing dark-launch) — the DB row is already seeded
      (owner-only `dev_only_user_id`).
- [x] `AdminMobileRoute` guard (`role==='admin'` && `isFeatureEnabled('page:admin_mobile')`;
      else `<Navigate to="/tech">`), plus a named unit test of the guard's allow/deny matrix
      (`src/components/admin-mobile/adminMobileAccess.test.js`, 8 cases — pure
      `canAccessAdminMobile()`).
- [x] **`src/App.jsx`: exactly ONE added line** — a delegating `<Route path="tech/admin/*"
      element={…}>` at the END of `TechRoutes()` (to minimize the H3 merge hunk) pointing at the
      new F-owned `src/pages/tech/admin/AdminMobileRoutes.jsx` subrouter (+ one lazy-import const
      in the imports section). All per-screen routes live in that subrouter, not in `App.jsx`.
      (Path is `tech/admin/*` because the sibling tech routes carry the `tech/` prefix — the
      roadmap's `admin/*` was shorthand.)
- [x] Admin group added to `src/pages/tech/TechMore.jsx` (conditional on
      `canAccessAdminMobile({role, flagEnabled})`, mirroring the existing `tool:oop_pricing`
      conditional-group pattern) linking to the navigable landing routes (Dashboard, Collections,
      New Estimate, Lead Center). Invoice/estimate **detail** routes are id-parameterized (reached
      from the P2 Collections lists), so they are not menu entries.
- [x] Shared primitives in `src/components/admin-mobile/**`: `AdminMobilePage` wrapper,
      `MoneyStatCard`, `AmListRow`, `PeriodSwitch`, `AmTabs`, the **href helper** (`href.js`),
      **and the admin-mobile icon set** (`icons.jsx` — icons live HERE, never routed through the
      frozen `Icons.jsx`/`crmIcons.jsx`) + an `index.js` barrel. Shared `.am-*` CSS vocabulary
      published in the SHARED marker.
- [x] Stub pages (render `AdminMobilePage` + a placeholder) for all five screens under
      `src/pages/tech/admin/`: `AdminDash.jsx`, `AdminCollections.jsx`,
      `AdminInvoiceDetail.jsx`, `AdminEstimateDetail.jsx`, `AdminLeadCenter.jsx`
      (+ `AdminEstimateEditor.jsx` stub for the deferred P4b).
- [x] **Six `index.css` reserved markers** pre-scaffolded near the tech block:
      `/* ─── ADMIN-MOBILE: SHARED | DASH | COLLECTIONS | INVOICE | ESTIMATE | LEADS ─── */`.
- [x] `.claude/rules/admin-mobile-wave-ownership.md` committed (already on `dev` from plan-commit;
      verified it matches what shipped — no path drift to correct).
- [x] `npm run test` (772 passed / 101 skipped) + `npm run build` green; `npx eslint` on changed
      files clean.
- [x] `upr-pattern-checker` + `admin-mobile-phase-reviewer` clean (the reviewer agent run via the
      committed `.claude/agents/admin-mobile-phase-reviewer.md` definition).
- [x] Visual check: verified by the guard's allow/deny unit test + the shared `canAccessAdminMobile`
      gate used by both `AdminMobileRoute` and the `TechMore` group (a tech/flag-off admin never
      sees the group nor reaches the routes); desktop `Layout.jsx` has **zero** changes in the diff.
      (Headless session — no live screenshot; verification is reasoned from the tested gate + the
      untouched-Layout diff.)
- [x] `UPR-Web-Context.md` updated; this checklist reconciled; push `-u`; open PR into `dev`; stop.

**Scope.** Owns the flag registry entry, the one App.jsx line, `TechMore.jsx`, all of
`src/components/admin-mobile/**`, the `AdminMobileRoutes.jsx` subrouter, all stub pages, the six
css markers, and the ownership manifest. **No feature logic** — screens are empty stubs.
**No new RPCs, no migrations.**

---

### Phase P2 — Collections / AR (mobile) · *merge preference 1st*

> **Branch:** session-assigned. **Prerequisite:** F merged. **Model · effort:** Opus · medium
> (read-only lists; data-integrity display). **Read scope:** `CLAUDE.md` + this block +
> `.claude/rules/admin-mobile-wave-ownership.md` + `.claude/rules/tech-mobile-ux.md`.
> Rationale for merging first: homogeneous lists give the cleanest end-to-end shell/auth/flag
> validation signal, and they provide the list→detail entry points P3/P4a link into.

**Close-out checklist**
- [x] `AdminCollections.jsx` renders mobile tabs (AR aging · Invoices · Estimates · Payments
      ledger) via `AmTabs`, reusing `get_ar_invoices`, `get_estimates`, `get_payments_ledger`,
      `get_payments_received`. Period switch on AR/Invoices.
- [x] Rows deep-link via F's href helper to `AdminInvoiceDetail` / `AdminEstimateDetail`
      routes (frozen route strings — smoke-test nav against F's stubs; full landing is a
      **verification tail** once P3/P4a merge — disclosed in the PR). *(Route smoke-tested via the
      href-builder unit test asserting the frozen strings; rows resolve to F's stub pages today.)*
- [x] Financial content respects `canAccess('overview_financials')` (AR/ledger are financial). *(AR
      aging + Payments ledger tabs are dropped from the tab bar when the permission is absent →
      never mounted → their RPCs never fetched: skips render AND fetch. The pure decision
      `visibleCollectionsTabs(canFin)` is unit-tested; P1 owns the binding component-level F-2 test.)*
- [x] Named test: list-render + aging-bucket math (reuse desktop `AGING_BUCKETS`) + href builder.
      *(`collFormat.test.js` — 15 cases; AGING_BUCKETS mirrored from desktop `collTokens`, not
      imported, since that tree is frozen read-to-mirror. Adds the F-2 tab-gate cases.)*
- [x] `npm run test` (787 passed / 101 skipped) + `build` green; eslint clean on changed files.
- [x] `upr-pattern-checker` + `admin-mobile-phase-reviewer` clean; visual check desktop+mobile.
      *(Reviewer run via its committed `.claude/agents/` definition; headless — visual reasoned from
      the mobile-first `.am-coll-*` CSS tokens + the gate/tab logic.)*
- [x] `UPR-Web-Context.md`; reconcile checklist; push `-u`; PR into `dev`; stop.

**Scope.** Owns `src/pages/tech/admin/AdminCollections.jsx`,
`src/components/admin-mobile/collections/**`, css §COLLECTIONS. Reads existing RPCs only.

---

### Phase P3 — Invoice view + send + **record payment** (mobile) · *merge preference 2nd*

> **Branch:** session-assigned. **Prerequisite:** F merged. **Model · effort:**
> **Opus · high** (money write + QBO mirror; finding **F-1** binds). **Read scope:**
> `CLAUDE.md` + this block + `BILLING-CONTEXT.md` + the ownership manifest +
> `.claude/rules/tech-mobile-ux.md`.

**Close-out checklist**
- [ ] `AdminInvoiceDetail.jsx`: view an invoice (line items read-only), **send** it
      (`POST /api/qbo-invoice { action:'send' }`), and **record a payment** per **F-1**.
- [ ] **Test-first (named):** `record-payment` inserts only the safe column set; asserts it
      does NOT write `amount_paid`/`status`/`paid_at`; double-submit guard; `/api/qbo-payment`
      fired only when `qbo_invoice_id` present; QBO-sync failure is non-fatal (row persists).
- [ ] Balance shown = `adjusted_total ?? total − amount_paid` (reuse desktop calc).
- [ ] Two-click confirm on the record-payment action (Rule 2 — no `confirm()`); toast feedback.
- [ ] Never touches `src/pages/InvoiceEditor.jsx` or `functions/api/qbo-payment.js` (call-only).
- [ ] `npm run test` + `build` green; eslint clean.
- [ ] `upr-pattern-checker` + `admin-mobile-phase-reviewer` (money-weighted) clean; visual check.
- [ ] `UPR-Web-Context.md`; reconcile checklist; push `-u`; PR into `dev`; stop.

**Scope.** Owns `src/pages/tech/admin/AdminInvoiceDetail.jsx`,
`src/components/admin-mobile/invoice/**`, css §INVOICE. **Call-only** on the payments insert +
`/api/qbo-payment` + `/api/qbo-invoice`.

---

### Phase P4a — Estimate view + send + convert (mobile) · *merge preference 3rd*

> **Branch:** session-assigned. **Prerequisite:** F merged. **Model · effort:** Opus · medium
> (transactional QBO send; reads + one send action, no line-item money math). **Read scope:**
> `CLAUDE.md` + this block + `BILLING-CONTEXT.md` + the ownership manifest.

**Close-out checklist**
- [ ] `AdminEstimateDetail.jsx`: view an estimate (line items read-only), **send**
      (`POST /api/qbo-estimate { action:'send' }`), and **convert to invoice**
      (`convert_estimate_to_invoice` → `/api/qbo-invoice`, honoring the `needs_confirm`
      two-click return).
- [ ] "Edit / add line items" and "New estimate" surface as links to P4b's route (frozen route
      via F's href helper; verification tail after P4b merges — disclosed).
- [ ] Named test: send action payload + convert `needs_confirm` handling.
- [ ] `npm run test` + `build` green; eslint clean.
- [ ] `upr-pattern-checker` + `admin-mobile-phase-reviewer` clean; visual check.
- [ ] `UPR-Web-Context.md`; reconcile checklist; push `-u`; PR into `dev`; stop.

**Scope.** Owns `src/pages/tech/admin/AdminEstimateDetail.jsx`,
`src/components/admin-mobile/estimate/**` (the detail/view portion), css §ESTIMATE (view rules).
**Call-only** on `/api/qbo-estimate`, `convert_estimate_to_invoice`, `/api/qbo-invoice`.

---

### Phase P1 — Admin dashboard (mobile) · *merge preference 4th*

> **Branch:** session-assigned. **Prerequisite:** F merged. **Model · effort:** Opus · medium
> (financial display; finding **F-2** binds — treat the gate as the primary risk).
> **Read scope:** `CLAUDE.md` + this block + `UPR-Design-System.md` + the ownership manifest.

**Close-out checklist**
- [ ] `AdminDash.jsx`: single-column mobile dashboard reusing the existing widget RPCs
      (`get_revenue_by_division`, `get_payments_received`, `get_avg_ticket`,
      `get_open_estimates_summary`, `get_jobs_closed`, `get_jobs_completed`,
      `get_active_drying_jobs`, `get_ar_invoices`, `get_dashboard_action_items`,
      `get_tech_status_board`, `get_pipeline_summary`). Period switch (MTD/Last 30/QTD/YTD).
      CSS/SVG charts (no chart lib).
- [ ] **Test-first (named) for F-2:** financial widgets are neither rendered nor fetched when
      `canAccess('overview_financials')` is false (assert the RPC is not called).
- [ ] Fixed widget order (no drag/resize on mobile). Rows deep-link via href helper.
- [ ] `npm run test` + `build` green; eslint clean.
- [ ] `upr-pattern-checker` + `admin-mobile-phase-reviewer` (gate-weighted) clean; visual check.
- [ ] `UPR-Web-Context.md`; reconcile checklist; push `-u`; PR into `dev`; stop.

**Scope.** Owns `src/pages/tech/admin/AdminDash.jsx`, `src/components/admin-mobile/dash/**`,
css §DASH. Reads existing RPCs only.

---

### Phase P4b — Estimate create + line-item builder (mobile) · *merge preference 5th; deferrable*

> **Branch:** session-assigned. **Prerequisite:** F merged (builds in parallel; **merge after
> P4a** for coherent UX — disjoint files, so not a hard build gate). **Model · effort:**
> **Opus · high** (heaviest UI; creates an estimate + line items + QBO item lookup).
> **Read scope:** `CLAUDE.md` + this block + `BILLING-CONTEXT.md` + the ownership manifest.
> **Decision fork (owner default = include in Wave 1):** if this over-runs one session, split
> it out as a standalone follow-up initiative — it is the least field-urgent capability (an
> admin can build an estimate on desktop; the field-urgent path is view+send in P4a).

**Close-out checklist**
- [ ] `AdminEstimateEditor.jsx`: **create** (`create_estimate_for_contact` — contact-only, no
      job/claim dependency; reuse `search_contacts_for_job`, `get_insurance_carriers`,
      `AddContactModal`, `AddressAutocomplete`) and **edit line items** (writes
      `estimate_line_items`; `line_total` is GENERATED — never written; QBO item/class lookup
      via `/api/qbo-query`).
- [ ] Named test: create-shell payload; line-item write excludes `line_total`.
- [ ] `npm run test` + `build` green; eslint clean.
- [ ] `upr-pattern-checker` + `admin-mobile-phase-reviewer` clean; visual check.
- [ ] `UPR-Web-Context.md`; reconcile checklist; push `-u`; PR into `dev`; stop.

**Scope.** Owns `src/pages/tech/admin/AdminEstimateEditor.jsx`, the create/builder modules
under `src/components/admin-mobile/estimate/**` (distinct files from P4a's view modules), css
§ESTIMATE (builder rules — coordinate the marker with P4a: P4a takes view rules, P4b takes
builder rules; if timing overlaps, P4b appends below P4a's block within §ESTIMATE).

---

### Phase P5 — Lead Center (mobile) · *merge preference last*

> **Branch:** session-assigned. **Prerequisite:** F merged. **Model · effort:** Opus · medium
> (read + lead-status writes via existing RPCs; copy-in playback/transcript). **Read scope:**
> `CLAUDE.md` + this block + the ownership manifest + `.claude/rules/tech-mobile-ux.md`.

**Close-out checklist**
- [ ] `AdminLeadCenter.jsx`: leads list via `get_inbound_leads` (embeds contact), filter
      spam/status; **play recording** via `GET /api/callrail-recording?lead_id=` (Bearer →
      audio blob → `URL.createObjectURL`); **view transcript** from `transcript_analysis`
      (summary/sentiment/topics/speaker turns) with flat-`transcription` fallback.
- [ ] `RecordingPlayer` + `TranscriptView` **copied in** to
      `src/components/admin-mobile/leads/**` (with their `crm-*` styles copied into §LEADS —
      **never edit `src/pages/crm/CrmCallLog.jsx` or the CRM css**).
- [ ] Lead-status / stage writes are **call-only** on the CRM-owned REPLACEs
      (`move_lead_to_stage`, `get_contact_activity`) — never re-REPLACE them.
- [ ] Named test: lead-list render + transcript-view render from a fixture `transcript_analysis`.
- [ ] `npm run test` + `build` green; eslint clean.
- [ ] `upr-pattern-checker` + `admin-mobile-phase-reviewer` clean; visual check.
- [ ] `UPR-Web-Context.md`; reconcile checklist; push `-u`; PR into `dev`; stop.

**Scope.** Owns `src/pages/tech/admin/AdminLeadCenter.jsx`,
`src/components/admin-mobile/leads/**`, css §LEADS. Reads/calls existing RPCs + the recording
proxy only.

---

## 5. Dependency graph (edge types named)

```
                          ┌───────────────────────────────┐
                          │  Phase F — Foundation (Wave 0) │
                          │  flag · guard · 1-line route   │
                          │  · TechMore group · primitives │
                          │  · stubs · css markers · manifest
                          └───────────────┬───────────────┘
                                          │  [hard artifact edge]
                                          │  every wave phase imports F's
                                          │  primitives + routes against F's stubs
        ┌──────────────┬──────────────┬──┴───────────┬──────────────┬─────────────┐
        ▼              ▼              ▼               ▼              ▼             ▼
      P2 Coll        P3 Inv+Pay     P4a Est v/s      P1 Dash       P4b Est build  P5 Leads
     (Wave 1)        (Wave 1)       (Wave 1)         (Wave 1)      (Wave 1)       (Wave 1)
        │  soft verification-tail    ▲                              ▲
        └────────────────────────────┘ (list→detail deep-link,      │ [soft: merge P4b
          P2 links to P3/P4a detail routes via F's href helper;      │  after P4a for
          full landing verified after P3/P4a merge — route-only,     │  coherent UX;
          NOT a file dependency, NOT a build gate)                   │  disjoint files]

  External seam: F's 1-line src/App.jsx edit ↔ Tech Job Hub v2 H3/M2 (both edit TechRoutes).
  Edge type: git-adjacency / coordination — NOT a logical dependency. Mitigation §6.
```

**Edge legend.** *hard artifact edge* — must have F's committed artifacts to build.
*soft verification-tail* — builds against frozen routes/signatures + F stubs; the end-to-end
check runs after the depended-on phase merges, disclosed in the PR. *coordination* — a shared
text region in a file, resolved by merge sequencing, no logical dependency.

---

## 6. Dispatch model

- **Wave 0 = Phase F alone.** Every wave phase consumes F's routes/stubs/primitives, so nothing
  runs beside F. (The `admin-mobile-phase-reviewer` agent is created at plan-commit, not a
  build phase.)
- **Wave 1 = P1, P2, P3, P4a, P4b, P5 — all launch simultaneously once F merges.** They are
  pairwise-disjoint (§7 challenge 2).
- **Merge order is a PREFERENCE, never a gate.** Preference: **P2 → P3 → P4a → P1 → P4b → P5**
  (validate the shell with the simplest real screen, then land money early per owner priority,
  then dashboard, then the heavy builder, then leads). Each PR is independent; **throttle the
  number of concurrent sessions freely to your review bandwidth.**
- **The one coordination item:** Foundation's single `src/App.jsx` line shares the `TechRoutes()`
  block with the in-flight **Job Hub v2 H3** cutover. Because F's edit is exactly one delegating
  `<Route path="admin/*">` line appended in that block (all real routes live in F's
  `AdminMobileRoutes.jsx`), a git auto-merge is near-certain; whoever merges second resolves a
  one-line hunk. **Before dispatching F, confirm H3's status** — if H3 is still open, either let
  F land its one line first (H3 rebases) or vice-versa. This is coordination, not a blocker.
- **Owner pre-decisions (already made):** §0 (shell = tech PWA; payments = record-only; audience
  = admins-only dark-launch). **Flag flip to all admins is the owner's**, in DevTools → Flags,
  after the phases the owner wants are merged and baked.

---

## 7. Adversarial challenge report — what changed

Three read-only agents ran against the draft before this doc was written.

**Challenge 1 — refute-first re-verification (5 least-certain verdicts).**
- Shell collision (Claim 1) → **CONFIRMED + caveat:** `TechMore.jsx` is unowned (safe); the
  `App.jsx` tech-route block is actively edited by Job Hub v2 H3. **Change:** reduced F's
  App.jsx footprint to one delegating line + a subrouter file (§4 Phase F, §6).
- Payment path (Claim 2) → **CONFIRMED + mandatory safe-path spec** → became finding **F-1**.
- Dashboard RPCs (Claim 3) → **CONFIRMED + security note** (no server gate) → became **F-2**.
- Lead Center reuse (Claim 4) → **CONFIRMED:** proxy + `get_inbound_leads` ungated for
  authenticated; copy-in works with zero CRM-file edits.
- Estimate create (Claim 5) → **MODIFIED:** create is a thin RPC shell, but the line-item
  builder is a large separate surface. **Change:** split the estimate work into **P4a**
  (view+send) and **P4b** (create+build); P4b deferrable.

**Challenge 2 — disjointness proofs.** All 10 phase-pairs **DISJOINT** on page file, component
subfolder, and css marker. Hidden-artifact findings folded in: (a) **icons pinned** to F's
`admin-mobile/**` (not the frozen `Icons.jsx`/`crmIcons.jsx`); (b) F **pre-scaffolds all six css
markers**; (c) money seams flagged **call-only** (P3 payments+`/api/qbo-payment`; P5
`move_lead_to_stage`/`get_contact_activity`); (d) P2→P3/P4a is **route-only** (verification
tail). Zero-new-schema invariant holds for every phase.

**Challenge 3 — counter-ordering.** A skeptic argued **P2 → P3 → P4a → P1 → P4b → P5** over the
draft's "Dashboard first." **Adjudicated: the alternative won** — lists are the cleanest
shell-validation signal (Dashboard's 11 widgets are deceptively large), money lands early per
the owner's explicit priority, and P2 gives P3/P4a their list→detail entry points. Also drove
the P4 split. Folded into §4/§6.

---

## 8. Ownership & migration rule (summary — manifest is authoritative)

- **Ownership matrix, frozen list, and call-only seams:** `.claude/rules/admin-mobile-wave-ownership.md`.
- **Migration rule (this initiative):** **zero migrations, zero new RPCs — by anyone,
  including Foundation.** The entire backend already exists; admin-mobile is a pure frontend
  consumer. There are therefore **no signature-frozen stubs** (nothing to stub) and no
  function-body-only replaces. The dark-launch flag row is a one-time idempotent **seed**
  (already applied), not a migration. If any phase discovers it needs a schema/RPC change:
  **stop and flag** for a separate reviewed change — do not `ALTER` a live table or add an RPC
  in-phase.
- **index.css:** each phase writes only inside its reserved marker; never restyle existing
  `.tech-*` / `.coll-*` / `.crm-*` selectors; new classes are `.am-*`. Mobile-only rules use
  `@media (max-width: 768px)`.

---

## 9. Progress tracking

No CRM-style DB tracker (`crm_build_phases`/`crm_build_stages`) — this is not a CRM initiative,
and bolting onto the CRM tracker is forbidden. **Progress is tracked via this doc's phase
checklists** (two-direction reconciliation at each close-out: nothing marked done that isn't
verified; nothing finished left as todo; owner-blocked items stay open with the reason stated).
Cloning the CRM tracker pattern for platform-wide initiatives remains an unscheduled,
owner-approval-gated idea — not in this plan's scope.

---

## 10. What resisted maximum parallelism (honest ledger)

- **`src/App.jsx` shared seam vs in-flight Job Hub v2 H3/M2.** Softened — not eliminated — by
  collapsing F's edit to a single delegating route line + a F-owned subrouter. Residual: a
  one-line merge hunk if H3 and F land in the same window. Coordination note in §6.
- **P4 could not be one phase.** The refute pass proved create+build is a large surface; split
  into P4a/P4b. P4b carries a deferral fork.
- **P4b merge-after-P4a** is a UX-coherence preference (disjoint files, so build-parallel).
- **Financial gate is not server-enforced** — every financial-displaying phase (P1, and AR/ledger
  in P2) must reproduce `canAccess('overview_financials')` as a discipline, tested (F-2). We did
  **not** add a server-side gate (would be a shared-RPC change touching desktop — out of scope
  for a frontend initiative; flagged as a possible future hardening).
- **Foundation is the single point of failure** (all six phases depend on its primitives/routes)
  — priced in via Opus·high on F and the `admin-mobile-phase-reviewer` gauntlet on F before any
  wave phase launches.
- **Rules bent — transparency:** none beyond the standard. The usual "wave ships zero schema"
  amendment (function-body-only replaces for own stubs) is **unused here** because there are no
  stubs and no new RPCs; the rule is *stricter* than default, not looser.

---

## 11. Out of scope (explicit)

- Stripe pay-by-link and QBO card-charge wiring (owner chose record-payment only; workers stay
  unwired — a possible future phase).
- Invoice **creation/editing** on mobile (view + send + record-payment only; creation stays
  desktop).
- Dashboard drag/resize layout customization on mobile (fixed widget order).
- Full CRM suite on mobile (contacts, sequences, forms, campaigns) — only the Lead Center slice.
- A server-side financial-access gate (frontend gate reproduced instead; see §10).
- Any change to the office `Layout` shell or its desktop pages.

---

## 12. Options-on-record (contested calls)

**Shell approach (decided — Owner decision 1).** Options weighed: (a) polish the office
`Layout` mobile experience; (b) a new dedicated admin-mobile shell mirroring tech-v2; (c) inside
the tech PWA. **Chosen: (c).** Trade-off: (c) reuses the loved PWA and its install/offline
surface and needs no third shell, at the cost of mixing admin screens into a field-tech shell —
managed by strict admin-gating + flag so techs never see them, and by giving admin screens their
own `.am-*` UX rather than forcing the field persona. (a) would have been cheapest but the owner
does not use the office shell on mobile; (b) is highest-fidelity but a whole third shell to
maintain. **Recommendation stands with (c);** the cheaper (a) would only win if the owner
routinely used the office shell on a phone, which they do not.

**Data layer (decision fork — default = standard load pattern).** Reuse the CLAUDE.md
`db.rpc` + `useState/useCallback` pattern (default — avoids touching the frozen `techQuery.js`
registry and keeps phases independent) vs a dedicated TanStack client for cross-nav caching.
Default wins for v1 (routed pages, read-mostly); revisit if nav-churn refetch becomes a felt
problem.
