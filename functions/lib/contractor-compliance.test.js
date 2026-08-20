/**
 * ════════════════════════════════════════════════
 * FILE: contractor-compliance.test.js
 * ════════════════════════════════════════════════
 * WHAT THIS DOES (plain language): Checks document and upload-link safety rules.
 * DEPENDS ON:
 *   Packages: vitest
 *   Internal: contractor-compliance.js
 *   Data: reads → none; writes → none
 * NOTES / GOTCHAS: Runs without a database or network.
 * ════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';
import {
  CONTRACTOR_COMPLIANCE_MAX_BYTES,
  tokenDigest,
  deterministicCapabilityToken,
  validateDocumentDates,
  validateContractorDocument,
} from './contractor-compliance.js';

describe('contractor compliance document boundary', () => {
  it('accepts only matching PDF/JPEG/PNG bytes', () => {
    expect(validateContractorDocument(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), 'application/pdf')).toMatchObject({ extension: 'pdf' });
    expect(() => validateContractorDocument(new Uint8Array([60, 104, 116, 109, 108]), 'application/pdf')).toThrow(/does not match/);
    expect(() => validateContractorDocument(new Uint8Array([0xff, 0xd8, 0xff]), 'image/gif')).toThrow(/PDF, JPEG, or PNG/);
  });

  it('rejects oversize before it can reach private storage', () => {
    expect(() => validateContractorDocument(new Uint8Array(CONTRACTOR_COMPLIANCE_MAX_BYTES + 1), 'application/pdf')).toThrow(/6 MiB/);
  });

  it('requires explicit W-9 years or complete insurance intervals', () => {
    expect(validateDocumentDates('w9', { taxYear: '2026' })).toEqual({ effectiveDate: null, expirationDate: null, taxYear: 2026 });
    expect(() => validateDocumentDates('w9', {})).toThrow(/tax year/);
    expect(validateDocumentDates('general_liability', { effectiveDate: '2026-01-01', expirationDate: '2026-12-31' })).toEqual({ effectiveDate: '2026-01-01', expirationDate: '2026-12-31', taxYear: null });
    expect(() => validateDocumentDates('workers_comp', { effectiveDate: '2026-12-31', expirationDate: '2026-01-01' })).toThrow(/effective and expiration/);
    // A coverage document may arrive UNDATED — the reviewer supplies the dates on
    // accept, and contractor_compliance_review_document refuses to accept without
    // them. Refusing the file here is what kept certificates off the roster.
    expect(validateDocumentDates('general_liability', {})).toEqual({ effectiveDate: null, expirationDate: null, taxYear: null });
    expect(validateDocumentDates('general_liability', { effectiveDate: '', expirationDate: '' })).toEqual({ effectiveDate: null, expirationDate: null, taxYear: null });
    // One date without the other is a half-filled form, not a deliberate
    // omission, and the CHECK constraint rejects it too.
    expect(() => validateDocumentDates('general_liability', { effectiveDate: '2026-01-01' })).toThrow(/effective and expiration/);
    expect(() => validateDocumentDates('general_liability', { expirationDate: '2026-12-31' })).toThrow(/effective and expiration/);
    // W-9 still requires a tax year: the constraint has not been relaxed there.
    expect(() => validateDocumentDates('w9', { effectiveDate: '', expirationDate: '' })).toThrow(/tax year/);
  });

  it('hashes a raw capability without retaining it', async () => {
    const token = 'a'.repeat(32);
    expect(await tokenDigest(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(await tokenDigest('short')).toBeNull();
  });

  it('derives a stable non-reversible scheduled capability only with a long secret', async () => {
    const secret = 's'.repeat(32);
    expect(await deterministicCapabilityToken(secret, 'profile:w9:2026')).toMatch(/^[a-f0-9]{64}$/);
    expect(await deterministicCapabilityToken(secret, 'profile:w9:2026')).toEqual(
      await deterministicCapabilityToken(secret, 'profile:w9:2026'),
    );
    expect(await deterministicCapabilityToken('short', 'profile:w9:2026')).toBeNull();
  });
});
