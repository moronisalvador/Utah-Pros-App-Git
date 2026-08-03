/**
 * ════════════════════════════════════════════════
 * FILE: contractor-compliance-upload.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Lets authorized office staff add one contractor document. The file is
 *   checked before it is stored and is marked for review instead of accepted.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  auth.js, supabase.js, contractor-compliance.js
 *   Data:      reads → employees
 *              writes → Storage, contractor_compliance_documents
 *
 * NOTES / GOTCHAS:
 *   - A failed document record triggers a best-effort private-file cleanup.
 * ════════════════════════════════════════════════
 */
import { corsHeaders, handleOptions } from '../lib/cors.js';
import { requireRole } from '../lib/auth.js';
import { fetchWithTimeout } from '../lib/http.js';
import { supabase } from '../lib/supabase.js';
import {
  complianceEnabled,
  CONTRACTOR_COMPLIANCE_BUCKET,
  randomStoragePath,
  safeOriginalFilename,
  sha256Hex,
  validateDocumentDates,
  validDocumentType,
  validUuid,
  validateContractorDocument,
} from '../lib/contractor-compliance.js';

function response(body, status, cors = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors } });
}
export function onRequestOptions({ request, env }) { return handleOptions(request, env); }

export async function onRequestPost({ request, env }) {
  const cors = corsHeaders(request, env);
  if (!complianceEnabled(env)) return response({ error: 'Not found' }, 404, cors);
  const db = supabase(env, fetchWithTimeout);
  const auth = await requireRole(request, env, db, ['admin', 'office'], fetchWithTimeout);
  if (auth.error) return response({ error: auth.error }, auth.status || 403, cors);
  let form;
  try { form = await request.formData(); } catch { return response({ error: 'Invalid multipart request' }, 400, cors); }
  const contractorId = String(form.get('contractor_id') || '');
  const documentType = String(form.get('document_type') || '');
  const file = form.get('file');
  if (!validUuid(contractorId) || !validDocumentType(documentType)) return response({ error: 'Invalid contractor or document type' }, 400, cors);
  if (!file || typeof file.arrayBuffer !== 'function') return response({ error: 'One document file is required' }, 400, cors);
  if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > 6 * 1024 * 1024) return response({ error: 'Documents must be no larger than 6 MiB.' }, 400, cors);
  let checked;
  let dates;
  try {
    dates = validateDocumentDates(documentType, {
      effectiveDate: form.get('effective_date'),
      expirationDate: form.get('expiration_date'),
      taxYear: form.get('tax_year'),
    });
  } catch (error) {
    return response({ error: error.message, code: error.code }, error.status || 400, cors);
  }
  try { checked = validateContractorDocument(await file.arrayBuffer(), file.type); } catch (error) {
    return response({ error: error.message, code: error.code }, error.status || 400, cors);
  }
  const storagePath = randomStoragePath(contractorId, checked.extension);
  let stored = false;
  let hash;
  try {
    hash = await sha256Hex(checked.bytes);
    await db.uploadStorage(CONTRACTOR_COMPLIANCE_BUCKET, storagePath, checked.bytes, checked.mimeType, { upsert: false });
    stored = true;
    const result = await db.rpc('contractor_compliance_ingest_document', {
      p_actor_employee_id: auth.employee.id,
      p_contractor_id: contractorId,
      p_document_type: documentType,
      p_source: 'internal_upload',
      p_storage_bucket: CONTRACTOR_COMPLIANCE_BUCKET,
      p_storage_path: storagePath,
      p_original_filename: safeOriginalFilename(file.name),
      p_mime_type: checked.mimeType,
      p_byte_size: checked.byteSize,
      p_content_sha256: hash,
      p_effective_date: dates.effectiveDate,
      p_expiration_date: dates.expirationDate,
      p_tax_year: dates.taxYear,
    });
    return response({ document: result?.[0] || result || null }, 201, cors);
  } catch {
    if (stored) await db.deleteStorage?.(CONTRACTOR_COMPLIANCE_BUCKET, storagePath).catch(() => {});
    // Do not expose storage paths, file names, hashes, or database details.
    return response({ error: 'The document could not be saved.' }, 503, cors);
  }
}
