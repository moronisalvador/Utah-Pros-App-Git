/**
 * ════════════════════════════════════════════════
 * FILE: contractor-compliance-file.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Gives an authorized manager a short-lived link to one private contractor
 *   document. It does not accept a storage path from the browser.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  auth.js, supabase.js, contractor-compliance.js
 *   Data:      reads → employees, contractor_compliance_documents
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Project managers cannot get a file link, including for W-9 files.
 * ════════════════════════════════════════════════
 */
import { corsHeaders, handleOptions } from '../lib/cors.js';
import { requireRole } from '../lib/auth.js';
import { fetchWithTimeout } from '../lib/http.js';
import { supabase } from '../lib/supabase.js';
import { complianceEnabled, validUuid } from '../lib/contractor-compliance.js';

const EXPIRES_IN = 300;
function response(body, status, cors = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors } });
}
export function onRequestOptions({ request, env }) { return handleOptions(request, env); }

export async function onRequestPost({ request, env }) {
  const cors = corsHeaders(request, env);
  if (!complianceEnabled(env)) return response({ error: 'Not found' }, 404, cors);
  const db = supabase(env, fetchWithTimeout);
  // PM deliberately cannot mint *any* file URL. This is stricter than the minimum
  // W-9 rule and avoids later accidental disclosure through insurance filenames.
  const auth = await requireRole(request, env, db, ['admin', 'office'], fetchWithTimeout);
  if (auth.error) return response({ error: auth.error }, auth.status || 403, cors);
  let body;
  try { body = await request.json(); } catch { return response({ error: 'Invalid request body' }, 400, cors); }
  if (!validUuid(body?.document_id)) return response({ error: 'A valid document_id is required' }, 400, cors);
  const disposition = body?.disposition === 'attachment' ? 'attachment' : 'inline';
  try {
    const authorized = await db.rpc('contractor_compliance_authorize_document_file', {
      p_actor_employee_id: auth.employee.id,
      p_document_id: body.document_id,
    });
    const file = Array.isArray(authorized) ? authorized[0] : authorized;
    if (!file?.storage_bucket || !file?.storage_object_path) return response({ error: 'Document not found' }, 404, cors);
    const url = await db.signStorage(
      file.storage_bucket,
      file.storage_object_path,
      EXPIRES_IN,
      { download: disposition === 'attachment' ? file.original_filename : false },
    );
    return response({ url, expires_in: EXPIRES_IN }, 200, cors);
  } catch {
    return response({ error: 'Document is temporarily unavailable' }, 503, cors);
  }
}
