/**
 * ════════════════════════════════════════════════
 * FILE: contractor-compliance.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Keeps the rules for safe contractor document files and upload links in one
 *   place. It checks files before they can be saved and never keeps raw links.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      reads → none
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Capability tokens are hashed or derived only in memory.
 * ════════════════════════════════════════════════
 *
 * Contractor Compliance private-file and request helpers.
 *
 * This module deliberately contains no direct table reads: the compliance SQL
 * contract owns token lookup, authorization, and state transitions.  Workers
 * receive only the minimal rows they need to perform a bounded side effect.
 */

export const CONTRACTOR_COMPLIANCE_BUCKET = 'contractor-compliance-private';
export const CONTRACTOR_COMPLIANCE_MAX_BYTES = 6 * 1024 * 1024;
export const CONTRACTOR_DOCUMENT_TYPES = Object.freeze([
  'w9', 'workers_comp', 'workers_comp_waiver', 'general_liability',
]);

const FILE_TYPES = Object.freeze({
  'application/pdf': {
    extension: 'pdf',
    matches: (bytes) => bytes.length >= 5
      && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44
      && bytes[3] === 0x46 && bytes[4] === 0x2d,
  },
  'image/jpeg': {
    extension: 'jpg',
    matches: (bytes) => bytes.length >= 3
      && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  },
  'image/png': {
    extension: 'png',
    matches: (bytes) => bytes.length >= 8
      && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
        .every((value, index) => bytes[index] === value),
  },
});

export class ContractorComplianceError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'ContractorComplianceError';
    this.code = code;
    this.status = status;
  }
}

export function complianceEnabled(env) {
  return env?.CONTRACTOR_COMPLIANCE_ENABLED === 'true';
}

export function remindersEnabled(env) {
  return complianceEnabled(env)
    && env?.CONTRACTOR_COMPLIANCE_REMINDERS_ENABLED === 'true';
}

export function validDocumentType(value) {
  return CONTRACTOR_DOCUMENT_TYPES.includes(String(value || ''));
}

export function validateDocumentDates(documentType, { effectiveDate, expirationDate, taxYear } = {}) {
  if (documentType === 'w9') {
    const year = Number(taxYear);
    if (!Number.isInteger(year) || year < 2000 || year > 2200) {
      throw new ContractorComplianceError('CONTRACTOR_DOCUMENT_DATES_INVALID', 'Enter a valid W-9 tax year.');
    }
    return { effectiveDate: null, expirationDate: null, taxYear: year };
  }
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  const start = String(effectiveDate || '');
  const end = String(expirationDate || '');
  if (!isoDate.test(start) || !isoDate.test(end) || end < start) {
    throw new ContractorComplianceError('CONTRACTOR_DOCUMENT_DATES_INVALID', 'Enter a valid effective and expiration date.');
  }
  return { effectiveDate: start, expirationDate: end, taxYear: null };
}

export function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(String(value || ''));
}

function declaredMime(value) {
  return String(value || '').split(';', 1)[0].trim().toLowerCase();
}

export function safeOriginalFilename(value) {
  const name = Array.from(String(value || ''), (char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127 || char === '\\' || char === '/' ? '_' : char;
  }).join('').trim();
  return (name || 'document').slice(0, 180);
}

export function validateContractorDocument(bytesLike, type) {
  const bytes = bytesLike instanceof Uint8Array
    ? bytesLike
    : new Uint8Array(bytesLike || []);
  const mimeType = declaredMime(type);
  const spec = FILE_TYPES[mimeType];
  if (!spec) {
    throw new ContractorComplianceError(
      'CONTRACTOR_DOCUMENT_TYPE_UNSUPPORTED',
      'Upload a PDF, JPEG, or PNG document.',
    );
  }
  if (!bytes.byteLength || bytes.byteLength > CONTRACTOR_COMPLIANCE_MAX_BYTES) {
    throw new ContractorComplianceError(
      'CONTRACTOR_DOCUMENT_SIZE_UNSUPPORTED',
      'Documents must be no larger than 6 MiB.',
    );
  }
  if (!spec.matches(bytes)) {
    throw new ContractorComplianceError(
      'CONTRACTOR_DOCUMENT_SIGNATURE_INVALID',
      'The document content does not match its declared file type.',
    );
  }
  return { bytes, mimeType, extension: spec.extension, byteSize: bytes.byteLength };
}

export async function sha256Hex(bytes) {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, '0')).join('');
}

export function randomStoragePath(contractorId, extension) {
  if (!validUuid(contractorId)) throw new ContractorComplianceError('CONTRACTOR_INVALID', 'Invalid contractor.', 400);
  return `contractors/${contractorId}/${crypto.randomUUID()}.${extension}`;
}

export async function tokenDigest(rawToken) {
  const token = String(rawToken || '');
  if (token.length < 32 || token.length > 512) return null;
  return sha256Hex(new TextEncoder().encode(token));
}

// The scheduled path cannot retrieve a raw token after storing only its digest.
// A keyed deterministic token lets a retry reconstruct the same capability
// without persisting it; the secret is Cloudflare-only and never logged.
export async function deterministicCapabilityToken(secret, identity) {
  const keyText = String(secret || '');
  const stableIdentity = String(identity || '');
  if (keyText.length < 32 || !stableIdentity || stableIdentity.length > 500) return null;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(keyText), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(stableIdentity));
  return Array.from(new Uint8Array(signature), (value) => value.toString(16).padStart(2, '0')).join('');
}

export function genericPublicResponse() {
  return { error: 'This upload link is unavailable.' };
}

export function emailHtmlForCompliance({ uploadUrl, requirementLabel, dueLabel }) {
  const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const escapedUrl = escapeHtml(uploadUrl);
  const requirement = escapeHtml(requirementLabel || 'required contractor compliance document');
  const due = dueLabel ? `<p>${escapeHtml(dueLabel)}</p>` : '';
  return `<p>Utah Pros Restoration needs your ${requirement}.</p>${due}`
    + `<p>Please securely upload it here: <a href="${escapedUrl}">Upload document</a>.</p>`
    + '<p>This link is specific to your request. Please do not forward it.</p>';
}
