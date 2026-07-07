# Admin Mobile — File & RPC Ownership Manifest

**Committed by Phase F (Foundation). Binding for every admin-mobile wave session.**
Linked from `CLAUDE.md`-adjacent workflow and `docs/admin-mobile-roadmap.md` (the plan of
record) + `docs/admin-mobile-dispatch.md` (cold-session launch blocks). Each wave session's
read scope = `CLAUDE.md` + its phase block in the roadmap + **this file** (+
`.claude/rules/tech-mobile-ux.md` since screens live in the tech shell). Where the roadmap
prose and this manifest disagree on a name or path, **this manifest is authoritative** (it
reflects what Foundation actually shipped).

Isolation in this wave is **not** the branch — it is (a) the `page:admin_mobile` flag
(`enabled:false` + owner `dev_only_user_id`) keeping every admin-mobile screen invisible until
the owner opens it, and (b) this ownership split. Stay inside your files and no two sessions
collide.

The initiative brings **admin capabilities into the field-tech PWA** (`/tech/*`,
`TechLayout`), reached from `TechMore.jsx`, gated to `employee.role === 'admin'` + the flag.
**Zero new schema, zero new RPCs** — every screen consumes existing RPCs/workers.

---

## 1. Frozen in-wave — NOBODY edits these except Foundation (they are the seams)

- `src/App.jsx` — Foundation adds **exactly one** delegating `<Route path="admin/*">` line
  inside `TechRoutes()`, pointing at `src/pages/tech/admin/AdminMobileRoutes.jsx`. Wave
  sessions add their per-screen routes **inside `AdminMobileRoutes.jsx`**, never in `App.jsx`.
  (Also frozen/owned by the in-flight Tech Job Hub v2 wave — coordinate the merge; see the
  roadmap §6.)
- `src/lib/featureFlags.js` — Foundation adds the `page:admin_mobile` `EXPLICIT_FLAGS` entry.
  Import/read only.
- `src/pages/tech/TechMore.jsx` — Foundation adds the admin nav group. Import/read only after F.
- `src/components/admin-mobile/**` — Foundation's shared primitives (`AdminMobilePage`,
  `MoneyStatCard`, `AmListRow`, `PeriodSwitch`, `AmTabs`, the href helper, the
  **admin-mobile icon set**, the `AdminMobileRoute` guard) and the shared `.am-*` CSS
  vocabulary. **Import only.** A needed change → disclosed copy-in to your own subfolder, or a
  Foundation follow-up PR.
- `src/pages/tech/admin/AdminMobileRoutes.jsx` — the subrouter. Foundation wires all five (six
  incl. P4b) routes to the stub pages. A wave session **fills its stub page**, it does not
  re-wire routes.
- **Frozen shared surface (consumed as-is, never edited in-wave):** `src/components/Icons.jsx`
  and `src/lib/crmIcons.jsx` (admin-mobile icons live in `admin-mobile/**`, NOT here);
  `src/components/TechLayout.jsx`; `src/pages/crm/CrmCallLog.jsx` (P5 **copies in**
  `RecordingPlayer`/`TranscriptView`, never edits it); `src/pages/InvoiceEditor.jsx`,
  `src/pages/EstimateEditor.jsx`, `src/components/collections/**`, `src/pages/Dashboard.jsx`
  (reference implementations — read to mirror logic, never import page-scoped internals);
  `functions/api/qbo-payment.js`, `qbo-invoice.js`, `qbo-estimate.js`, `qbo-query.js`,
  `functions/api/callrail-recording.js` (**call-only** workers).
- `src/index.css` **outside your phase's reserved marker.** Existing `.tech-*` / `.coll-*` /
  `.crm-*` selectors may NOT be restyled — admin-mobile styles are new `.am-*` classes.
- **All `supabase/migrations/`** — the wave ships ZERO migrations (§4).

---

## 2. Ownership matrix

| Session | Phase | Owns exclusively (edit only these) | Schema/RPC |
|---|---|---|---|
| F | Foundation | flag entry in `featureFlags.js`; one line in `App.jsx`; `TechMore.jsx` admin group; all `src/components/admin-mobile/**`; `src/pages/tech/admin/AdminMobileRoutes.jsx`; all stub pages in `src/pages/tech/admin/`; the six `index.css` markers; this manifest | **none** (seeds the `page:admin_mobile` flag row — one-time, already applied) |
| B2 | P2 Collections | `src/pages/tech/admin/AdminCollections.jsx`, `src/components/admin-mobile/collections/**`, css §COLLECTIONS | none (reads `get_ar_invoices`, `get_estimates`, `get_payments_ledger`, `get_payments_received`) |
| B3 | P3 Invoice+payment | `src/pages/tech/admin/AdminInvoiceDetail.jsx`, `src/components/admin-mobile/invoice/**`, css §INVOICE | none (**call-only**: `db.insert('payments')` + `/api/qbo-payment`, `/api/qbo-invoice`) |
| B4a | P4a Estimate view+send | `src/pages/tech/admin/AdminEstimateDetail.jsx`, `src/components/admin-mobile/estimate/**` (view modules), css §ESTIMATE (view rules) | none (call-only: `/api/qbo-estimate`, `convert_estimate_to_invoice`, `/api/qbo-invoice`) |
| B1 | P1 Dashboard | `src/pages/tech/admin/AdminDash.jsx`, `src/components/admin-mobile/dash/**`, css §DASH | none (reads the 11 widget RPCs) |
| B4b | P4b Estimate create+build | `src/pages/tech/admin/AdminEstimateEditor.jsx`, `src/components/admin-mobile/estimate/**` (builder modules — distinct files from P4a), css §ESTIMATE (builder rules) | none (call-only: `create_estimate_for_contact`, `estimate_line_items` writes, `/api/qbo-query`) |
| B5 | P5 Lead Center | `src/pages/tech/admin/AdminLeadCenter.jsx`, `src/components/admin-mobile/leads/**`, css §LEADS | none (reads `get_inbound_leads`; call-only `/api/callrail-recording`; CRM REPLACEs `move_lead_to_stage`/`get_contact_activity` are **call-only**) |

`page:admin_mobile` opening to all admins is the **owner's** call in DevTools → Flags.

**§ESTIMATE marker note:** P4a and P4b share the §ESTIMATE css marker but own **distinct
component files**. If both are in flight, P4b appends its rules **below** P4a's block inside the
marker (never edits P4a's lines).

---

## 3. Call-only / sacred seams (binding — the reviewer weights these)

1. **Payments (P3).** Record-payment = `db.insert('payments', {safe columns only})` +
   `POST /api/qbo-payment`. **Never** write `amount_paid`/`insurance_paid`/`homeowner_paid`/
   `status`/`paid_at` (a DB trigger owns them). Never bypass the human Save→QBO gate. QBO-sync
   failure is non-fatal (the UPR row already persists). Guard double-submit. (Finding F-1.)
2. **Estimate/invoice workers (P3/P4a/P4b).** `/api/qbo-invoice`, `/api/qbo-estimate`,
   `/api/qbo-query`, `convert_estimate_to_invoice` are call-only; never edit the workers.
   `estimate_line_items.line_total` is GENERATED — never written.
3. **Lead RPCs (P5).** `move_lead_to_stage` and `get_contact_activity` are CRM-Foundation
   REPLACEs — **call only, never re-REPLACE**. `get_inbound_leads` is call-only.
4. **Recording proxy (P5).** `GET /api/callrail-recording?lead_id=` with a Supabase Bearer;
   returns an audio blob. Copy-only for `RecordingPlayer`/`TranscriptView` and their `crm-*`
   CSS — never edit `CrmCallLog.jsx` or the CRM stylesheet.
5. **Financial gate (P1, P2).** Reproduce `canAccess('overview_financials')` — skip both render
   and fetch for non-privileged roles (the RPCs are NOT server-gated). (Finding F-2.)

---

## 4. Migration rule (this wave)

**Zero migrations and zero new RPCs by anyone, including Foundation.** The backend already
exists. There are no signature-frozen stubs (nothing to stub) and no function-body-only
replaces. The `page:admin_mobile` flag row is a one-time idempotent seed (already applied), not
a migration. If a phase discovers it needs a schema or RPC change: **stop and flag** for a
separate reviewed change — do not `ALTER`/`DROP` a live table or add an RPC in-phase.

## 5. index.css rule

Write CSS ONLY inside your phase's reserved marker (`/* ─── ADMIN-MOBILE: DASH | COLLECTIONS |
INVOICE | ESTIMATE | LEADS ─── */`; Foundation owns the SHARED marker). Never edit Foundation's
SHARED block, another phase's section, or any existing `.tech-*` / `.coll-*` / `.crm-*`
selector. New classes are `.am-*`. Mobile-only rules use `@media (max-width: 768px)`.

## 6. Foundation artifacts the wave consumes (frozen contracts)

- `page:admin_mobile` flag (`isFeatureEnabled('page:admin_mobile')`) + the `AdminMobileRoute`
  guard.
- The `src/components/admin-mobile/**` shared primitives + href helper + icon set + `.am-*` CSS.
- The five/six routes wired in `AdminMobileRoutes.jsx` (frozen route strings — deep-link against
  these; the full landing is a verification tail once the target phase merges).
- The `TechMore.jsx` admin group (entry points).

## 7. Close-out (every wave session)

Commit → `npm run test` + `npm run build` + `npx eslint` (changed files) → `upr-pattern-checker`
+ `admin-mobile-phase-reviewer` (money/gate-weighted where relevant) → visual check
desktop+mobile → update `UPR-Web-Context.md` (your pre-seeded sub-header) + reconcile your
roadmap checklist (both directions) → push `-u` → open a **PR into `dev` as a handoff** →
**STOP** (the owner merges; do not subscribe to / babysit / click-merge your PR).
