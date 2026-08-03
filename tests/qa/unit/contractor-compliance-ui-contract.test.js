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
    expect(publicUpload).toContain("queryKey: ['contractor-upload']");
    expect(publicUpload).not.toContain("['contractor-upload', token]");
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
    expect(publicUpload).toContain('No documents remain in this request');
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
