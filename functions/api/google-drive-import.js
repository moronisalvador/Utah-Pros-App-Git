/**
 * ════════════════════════════════════════════════
 * FILE: functions/api/google-drive-import.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Takes the files a staff member picked from their Google Drive and copies them
 *   into the job. For each file it downloads the bytes from Google, saves them in
 *   the app's file storage under the job, and records a document row so the file
 *   shows up in the job's Files tab. It returns the created document records.
 *
 * WHERE IT LIVES:
 *   Route: POST /api/google-drive-import  (authenticated — Supabase Bearer)
 *
 * DEPENDS ON:
 *   Internal:  ../lib/cors.js, ../lib/google-drive.js, ../lib/supabase.js
 *   Data:      reads  → employees, user_google_accounts
 *              writes → Supabase Storage (job-files bucket), job_documents (via RPC)
 *
 * NOTES / GOTCHAS:
 *   - Stores file_path WITH the `job-files/` prefix (the convention every
 *     insert_job_document caller uses). JobPage's getFileUrl tolerates this.
 *   - Native Google Docs/Sheets/Slides are exported (PDF/XLSX) by the lib; the
 *     returned name/extension reflect the exported format.
 *   - Per-file failures are collected and returned in `errors` rather than failing
 *     the whole batch.
 * ════════════════════════════════════════════════
 */

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { downloadFile, getActorEmployee } from '../lib/google-drive.js';
import { supabase } from '../lib/supabase.js';

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = supabase(env);

  const employee = await getActorEmployee(request, env, db);
  if (!employee) return jsonResponse({ error: 'Unauthorized' }, 401, request, env);

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid JSON' }, 400, request, env); }

  const { job_id, appointment_id = null, category = 'document', description = null, files } = body || {};
  if (!job_id) return jsonResponse({ error: 'Missing job_id' }, 400, request, env);
  if (!Array.isArray(files) || files.length === 0) return jsonResponse({ error: 'No files provided' }, 400, request, env);

  const created = [];
  const errors = [];

  for (const f of files) {
    try {
      const { bytes, mimeType, name } = await downloadFile(env, employee.id, f);
      const safeName = name.replace(/[^\w.-]+/g, '_');
      const path = `${job_id}/${Date.now()}-${safeName}`;

      // Upload bytes to the job-files bucket using the service-role key.
      const up = await fetch(`${env.SUPABASE_URL}/storage/v1/object/job-files/${path}`, {
        method: 'POST',
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': mimeType || 'application/octet-stream',
        },
        body: bytes,
      });
      if (!up.ok) throw new Error(`Storage upload failed: ${up.status} ${(await up.text()).slice(0, 160)}`);

      const doc = await db.rpc('insert_job_document', {
        p_job_id:         job_id,
        p_name:           name,
        p_file_path:      `job-files/${path}`,
        p_mime_type:      mimeType || 'application/octet-stream',
        p_category:       category,
        p_uploaded_by:    employee.id,
        p_appointment_id: appointment_id,
        p_description:    description,
      });
      // insert_job_document returns the job_documents row (object).
      if (doc) created.push(Array.isArray(doc) ? doc[0] : doc);
    } catch (e) {
      errors.push({ file: f?.name || f?.id, error: e.message || 'import failed' });
    }
  }

  return jsonResponse({ created, errors }, 200, request, env);
}
