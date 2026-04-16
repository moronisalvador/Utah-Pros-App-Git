# Reconstruction Agreement eSign — Build Task

**Status:** In progress
**Started:** 2026-04-16
**Owner:** Moroni

## Goal

Add a new `recon_agreement` doc type to the eSign flow — a reconstruction-phase Work Authorization with comprehensive legal coverage (16 sections) and 4 separately-attested consent checkboxes. Source pattern: `C:\Users\moronisalvador\Downloads\ReconSigningFlow.jsx` (Tailwind-based mockup — we're porting the logic and text into UPR's inline-style convention).

## Why a new doc type vs. reusing `work_auth`

Reconstruction work has fundamentally different risk (cancellation fee, commitment clause, supplement/change-order rigor, materials upgrades, lien pre-notice) than mitigation. Mixing them in one template invites ambiguity. `work_auth` stays as the mitigation Work Authorization; `recon_agreement` is the reconstruction-phase sibling.

## Legal upgrades this brings

1. 16 structured sections covering: scope & estimate, insurance negotiation, change orders, materials/upgrades, payment terms, direction to pay, timeline/delays, permits, subcontractors, hazmat, liability limits, warranty, access, lien rights, dispute ladder, general provisions.
2. Explicit commitment clause with 15% cancellation fee.
3. Four separately-attested consent checkboxes persisted with timestamp — stronger audit trail than one combined checkbox.
4. Division-coded amber branding (reconstruction) vs blue (mitigation).

## Places `doc_type` enum lives (all must be updated)

- `src/components/SendEsignModal.jsx` — `DOC_TYPES` array
- `src/pages/SignPage.jsx` — `DOC_LABELS` + renderer branch
- `functions/api/send-esign.js` — `DOC_LABELS`
- `functions/api/submit-esign.js` — `docLabel`, `DOC_TITLES`, `needsCoSig` check
- DB: `document_templates.doc_type` CHECK constraint (if any)

---

## Phase 1 — Schema & RPC updates

**Goal:** DB ready to accept the new doc type and four consent flags.

### Tasks

1. **Check `document_templates.doc_type` CHECK constraint**
   - If constrained to enum, add `'recon_agreement'`
   - Apply via `mcp__1cd66b34-...__apply_migration` or SQL in Supabase dashboard
2. **Add consent columns to `sign_requests`**
   ```sql
   ALTER TABLE sign_requests
     ADD COLUMN consent_terms       BOOLEAN,
     ADD COLUMN consent_commitment  BOOLEAN,
     ADD COLUMN consent_esign       BOOLEAN,
     ADD COLUMN consent_authority   BOOLEAN,
     ADD COLUMN consents_signed_at  TIMESTAMPTZ;
   ```
   Nullable because existing rows don't have them.
3. **Update `complete_sign_request` RPC** — add parameters:
   ```
   p_consent_terms       BOOLEAN DEFAULT NULL,
   p_consent_commitment  BOOLEAN DEFAULT NULL,
   p_consent_esign       BOOLEAN DEFAULT NULL,
   p_consent_authority   BOOLEAN DEFAULT NULL
   ```
   Write into the new columns + set `consents_signed_at = now()` when any are non-null. Defaults keep existing callers (mitigation flow) working.
4. **Add `'recon_agreement'` to any frontend-side enum helpers** (none currently — doc types are hardcoded per-file).
5. **Call `bust_postgrest_cache()`** after migration.

### Acceptance

- `INSERT INTO sign_requests (..., doc_type) VALUES (..., 'recon_agreement')` succeeds
- `SELECT consent_terms FROM sign_requests LIMIT 1` returns without error
- `complete_sign_request(... p_consent_terms := true, ...)` persists the flag

---

## Phase 2 — Seed `document_templates` with 16 sections

**Goal:** Legal text editable from DB without a deploy.

### Tasks

1. Insert 16 rows into `document_templates`:
   - `doc_type = 'recon_agreement'`
   - `sort_order = 1..16`
   - `heading` = section title (e.g. "Scope of Work & Estimate")
   - `body` = full markdown body for that section (from `ReconSigningFlow.jsx` lines 163–214)
   - `division = null` (not division-specific)
2. Use the existing `substituteVars` pattern for dynamic values — `{{company_name}}`, `{{address}}`, etc.
3. Add a 17th "summary row" `sort_order = 0` for the short-form content shown in the expandable cards before the full legal text (Scope & Estimate "How It Works", Commitment, Change Orders, Payment, etc.) — OR store those as separate rows with a `section_type = 'summary' | 'legal'` column. **Decision: use separate rows with `sort_order` 1–4 for summaries and 10–25 for full legal sections** to keep one clean table.
4. Store as a single migration SQL file in `supabase/migrations/` (or similar) for repeatability.

### Acceptance

- `SELECT * FROM document_templates WHERE doc_type = 'recon_agreement' ORDER BY sort_order` returns 16+ rows
- Sections render in correct order on the sign page

---

## Phase 3 — Update `SendEsignModal.jsx`

**Goal:** Office staff can select "Reconstruction Agreement" as a doc type.

### Tasks

1. Add `{ key: 'recon_agreement', label: 'Reconstruction Agreement' }` to `DOC_TYPES` array (line 6-11)
2. Consider layout — currently 2×2 grid, now 5 items. Either:
   - **(a)** Switch to 2-col grid with wrap (`grid-template-columns: 1fr 1fr`, auto rows)
   - **(b)** Single column (safer for small modal)
3. No other changes needed — the rest of the flow is doc-type-agnostic.

### Acceptance

- Modal shows 5 doc type buttons
- Selecting "Reconstruction Agreement" and clicking Collect/Send fires the request with `doc_type: 'recon_agreement'`

---

## Phase 4 — `SignPage.jsx` — new `ReconAgreementView` branch

**Goal:** Signer sees the beautiful expandable layout + 4 consent checkboxes when `doc_type === 'recon_agreement'`.

### Tasks

1. Create `ReconAgreementView` component (new file or inside SignPage.jsx)
   - Translate `ReconSigningFlow.jsx` Tailwind → UPR inline styles with CSS variables
   - Map: `bg-amber-500` → `#f59e0b` / `var(--accent-amber)` if we add it, `rounded-xl` → `var(--radius-xl)`, spacing → `var(--space-*)`
2. Remove `lucide-react` deps — replace with inline SVGs matching the existing `IconX` pattern in `SendEsignModal.jsx`. Icons needed: Check, ChevronDown, ChevronUp, AlertCircle, FileText, Shield, Hammer, Pen, X, ClipboardList
3. Replace `SAMPLE_CLAIM` with data from `get_sign_request_by_token` + `job` fields
4. Pull the 16 sections from `templates` state (already loaded) — group by `sort_order` into summary (1–4) and legal (10–25)
5. Wire the 4 consent checkboxes to state + pass to `submit-esign` in the POST body
6. Keep the existing signature pad (`SignPage.jsx` already has a better pad with Type/Draw mode) — don't use the downloaded file's pad. Integrate consent checkboxes above the signature block.
7. Branch in `SignPage.jsx` render: `if (data?.doc_type === 'recon_agreement') return <ReconAgreementView ... />`

### Acceptance

- `/sign/{token}` for a reconstruction agreement request renders the expandable layout
- All 4 consent checkboxes must be checked to enable Submit
- Existing mitigation docs still render with the current layout (no regression)

---

## Phase 5 — `submit-esign.js` — persist consents + extended PDF

**Goal:** Signed PDF includes the full legal text + consent attestations; DB persists which consents were checked.

### Tasks

1. Update `submit-esign.js` POST body to accept:
   ```js
   const { token, signer_name, signature_png,
     consent_terms, consent_commitment, consent_esign, consent_authority } = await request.json();
   ```
2. For `doc_type === 'recon_agreement'`: require all 4 consents to be `true`, else return 400
3. Add `recon_agreement` to `DOC_TITLES` + `needsCoSig` list (line 264)
4. Pass consent flags into `complete_sign_request` RPC call
5. PDF generation — extend `buildPdf` function:
   - Render full 16-section legal body in smaller font, multi-page
   - After signature block, add "Acknowledgments" section listing the 4 consents with ✓ and timestamp
   - Keep company cosig block (same as work_auth)
6. Confirmation email: include PDF attachment (already works per existing flow)

### Acceptance

- Signing a recon agreement produces a multi-page PDF with all 16 sections + consent attestations
- `sign_requests` row shows `consent_terms/commitment/esign/authority = true` and `consents_signed_at` set
- PDF downloads and opens cleanly

---

## Phase 6 — Audit trail

**Goal:** High-value legal events are logged to `system_events` for investigation/defense.

### Tasks

1. In `complete_sign_request` RPC (or `submit-esign.js` after success), emit an event:
   ```
   INSERT INTO system_events (event_type, entity_type, entity_id, job_id, payload)
   VALUES ('esign.signed', 'sign_request', {id}, {job_id}, {
     doc_type, signer_name, signer_ip,
     consents: { terms, commitment, esign, authority },
     signed_at
   })
   ```
2. Already-existing flow for `work_auth` / `coc` should get the same treatment — retroactive audit logging (optional, can be follow-up).

### Acceptance

- `SELECT * FROM system_events WHERE event_type = 'esign.signed' ORDER BY created_at DESC LIMIT 5` shows recent signings with full payload

---

## Completion checklist

When all phases are done:

- [ ] Commit each phase separately with clear messages
- [ ] Test end-to-end on dev: create recon agreement → sign → verify PDF + DB + event
- [ ] Update `UPR-Web-Context.md`:
  - New `sign_requests` columns
  - Updated `complete_sign_request` RPC signature
  - New `document_templates` rows count (8 → 24+)
  - Note `recon_agreement` as a supported doc_type
- [ ] Delete this file: `git rm RECON-ESIGN-TASK.md`
- [ ] Commit: `docs: update UPR-Web-Context.md, remove completed RECON-ESIGN-TASK.md`

## Non-goals (out of scope for this task)

- Making the same treatment for `work_auth` / mitigation (future task)
- Template editor UI for legal text (use DB directly or existing `document_templates` admin)
- Multi-signer flows (always one signer for now)
- Countersign by UPR employee (company block is pre-filled, not interactively signed)

## Source reference

`C:\Users\moronisalvador\Downloads\ReconSigningFlow.jsx` — the Tailwind mockup. Use for text content and UX structure. Do not copy the Tailwind className attributes — translate to UPR inline-style convention.
