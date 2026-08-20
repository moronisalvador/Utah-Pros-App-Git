/**
 * ════════════════════════════════════════════════
 * FILE: contractor-compliance-ui-contract.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks the source for the small safety rules that keep the contractor paperwork screens from
 *   exposing a secure link or treating a phone-sized screen like a desktop table.
 *
 * DEPENDS ON:
 *   Packages:  node:fs, node:path, vitest
 *   Internal:  Contractor Compliance pages, API helper, and route stylesheet
 *   Data:      reads  → source files only
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This is credential-free static coverage; Worker and database authorization are tested separately.
 * ════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (file) => readFileSync(join(root, file), 'utf8');
const dashboard = read('src/pages/Contractors.jsx');
const detail = read('src/pages/ContractorDetail.jsx');
const publicUpload = read('src/pages/ContractorUpload.jsx');
const audits = read('src/pages/ContractorAudits.jsx');
const taxReadiness = read('src/pages/ContractorTaxReadiness.jsx');
const app = read('src/App.jsx');
const api = read('src/components/contractor-compliance/api.js');
const delivery = read('functions/lib/contractor-compliance-delivery.js');
const css = read('src/pages/ContractorCompliance.css');
const techQuery = read('src/lib/techQuery.js');

describe('contractor compliance UI contract', () => {
  it('keeps current and audit-period reads explicit', () => {
    expect(dashboard).toContain("p_audit_start: auditMode === 'audit' ? auditStart : null");
    expect(dashboard).toContain('audit_start=${auditStart}');
    expect(detail).toContain("searchParams.get('audit_start')");
    expect(detail).toContain('p_audit_end: auditEnd || null');
  });

  it('uses the role-redacted detail payload and does not render W-9 fallback rows for PMs', () => {
    expect(detail).toContain("document.document_type !== 'w9' || permissions?.can_manage");
    expect(detail).toContain('permissions.can_view_files');
    expect(detail).toContain('get_contractor_compliance_detail');
  });

  it('uses purpose-built Worker endpoints and keeps raw public token out of URL/cache keys', () => {
    expect(api).toContain("'/api/contractor-compliance-requests'");
    expect(api).toContain("'/api/contractor-compliance-public'");
    expect(api).toContain("'X-Contractor-Upload-Token': token");
    expect(api).toContain("referrerPolicy: 'no-referrer'");
    expect(api).not.toContain('contractor-upload/${');
    expect(delivery).toContain('/contractor-upload#token=');
    expect(publicUpload).toContain('window.history.replaceState');
    expect(publicUpload).not.toContain('useParams');
    // The token IS part of the cache key, because react-query keeps entries for
    // 24h and a second request opened on the same phone would otherwise render
    // the FIRST request's document list. That is only safe because the key is
    // excluded from dehydration below — so the raw token never reaches disk.
    expect(publicUpload).toContain("queryKey: ['contractor-upload', token]");
    expect(techQuery).toContain("if (root === 'contractor-upload') return false;");
  });

  it('keeps the public upload page inside a 390px viewport', () => {
    // Measured on the LIVE page, not inferred: the card is a grid item, so its
    // automatic minimum size is min-content and it rendered 397px inside 366px of
    // available space — 19px of horizontal scroll on the exact phone width this
    // audience uses. `width: min(100%, 680px)` alone does not prevent it.
    expect(css).toMatch(/\.contractor-upload-card \{[^}]*min-width: 0/);
    expect(css).toMatch(/\.contractor-public-upload \{[^}]*min-width: 0/);
  });

  it('does not paint an empty status box, but keeps the live region mounted', () => {
    // The region must stay in the DOM for an aria-live insertion to be announced,
    // so it collapses its chrome instead of being removed or display:none'd.
    expect(css).toMatch(/\.contractor-inline-notice:empty \{[^}]*padding: 0/);
    expect(css).not.toMatch(/\.contractor-inline-notice:empty \{[^}]*display: none/);
    expect(publicUpload).toContain('aria-live="polite"');
  });

  it('does not capitalize sentence-length helper text', () => {
    // .contractor-public-upload sets text-transform: capitalize for short labels;
    // it turned real sentences into "Leave Blank If You Cannot Find Them."
    expect(css).toMatch(/\.contractor-dates-optional,?[\s\S]{0,120}text-transform: none/);
  });

  it('requires an inline rejection reason and retains stable intent IDs', () => {
    expect(detail).toContain('placeholder="Rejection reason"');
    expect(detail).toContain('!reason.trim()');
    expect(detail).toContain('crypto.randomUUID()');
    expect(detail).toContain('operation_id: operationFor');
  });

  it('preserves list origins and handles file-open and empty-upload states explicitly', () => {
    expect(dashboard).toContain('contractorReturnTo: `/contractors?${returnParams}`');
    expect(audits).toContain('contractorReturnTo: `/contractors/audits?${returnParams}`');
    expect(taxReadiness).toContain('contractorReturnTo: `/contractors/tax-readiness?${returnParams}`');
    expect(detail).toContain("location.state?.contractorReturnTo || '/contractors'");
    expect(detail).toContain('onClick={() => navigate(-1)}');
    expect(`${dashboard}\n${audits}\n${taxReadiness}`).not.toContain('window.scrollTo');
    expect(detail).toContain('await openDocument(documentId, disposition)');
    expect(detail).toContain("err(error.message || 'Could not open that document.')");
    // The copy moved into the `contractor` i18n namespace when this page gained
    // Spanish and Portuguese for contractors who do not read English. The
    // contract is that an explicit empty state is rendered — not that it is
    // written in English in the JSX.
    expect(publicUpload).toMatch(/<EmptyState[^>]*title=\{t\('allDone'\)\}/);
  });

  it('uses the repository mobile breakpoint and never uses browser confirmation dialogs', () => {
    expect(css).toContain('@media (max-width: 768px)');
    expect(css).toContain('min-height: 44px');
    expect(`${dashboard}\n${detail}\n${publicUpload}\n${audits}\n${taxReadiness}`)
      .not.toMatch(/\b(?:alert|confirm)\s*\(/);
  });

  it('keeps annual insurance audits separate from admin/office-only W-9 handoff', () => {
    expect(app).toContain('path="contractors/audits"');
    expect(app).toContain("<RoleRoute roles={['admin', 'office', 'project_manager']}>");
    expect(app).toContain('path="contractors/tax-readiness"');
    expect(app).toContain("<RoleRoute roles={['admin', 'office']}>");
    expect(audits).toContain('get_contractor_compliance_audit_manifest');
    expect(audits).toContain('Current active profiles seed a roster only');
    expect(taxReadiness).toContain('get_contractor_w9_tax_year_checklist');
    expect(taxReadiness).toContain('contractor_w9_upsert_provider_handoff');
    expect(taxReadiness).not.toContain('p_notes');
    expect(taxReadiness).toContain('QuickBooks or Gusto prepares, files, and sends 1099s');
    expect(taxReadiness).not.toContain('gross_reportable');
  });
});
