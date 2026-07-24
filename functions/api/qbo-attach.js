// POST /api/qbo-attach — attach a file to a QBO Invoice or Estimate, so it rides
// along on the email QuickBooks sends the customer (IncludeOnSend) and shows on the
// transaction inside QuickBooks.
//
// Auth: active admin/manager Supabase employee session (billing role) — mirrors
//       qbo-charge. Attaching pushes customer documents to QuickBooks.
//
// Attach:  { entity_type: 'invoice'|'estimate', id: '<upr uuid>',
//            file_name, content_type, file_base64, include_on_send?: bool }
//          Header: Idempotency-Key (stable per attach — a retry never double-attaches).
// Remove:  { action: 'delete', attachment_id: '<qbo_attachments uuid>' }
//
// The file goes browser → this worker → QuickBooks (accounting scope, already
// granted). We keep a qbo_attachments row so the editor can list what's attached
// and remove it. The raw bytes are never stored in UPR — only in QuickBooks.

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { requireRole } from '../lib/auth.js';
import { recordWorkerRun } from '../lib/worker-runs.js';
import { supabase } from '../lib/supabase.js';
import { getConnection, uploadAttachable, deleteAttachable } from '../lib/quickbooks.js';

const BILLING_ROLES = ['admin', 'manager'];
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB — comfortably under QBO's 100 MB/file cap.
const MAX_B64_LEN = Math.ceil(MAX_BYTES / 3) * 4 + 256; // base64 is ~4/3 the byte size (+ data-URL prefix).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;
const ENTITY = {
  invoice:  { table: 'invoices',  idCol: 'invoice_id',  qboCol: 'qbo_invoice_id' },
  estimate: { table: 'estimates', idCol: 'estimate_id', qboCol: 'qbo_estimate_id' },
};

// Decode a base64 (or data-URL) string to bytes without pulling in a dependency.
function decodeBase64(b64) {
  const clean = String(b64 || '').replace(/^data:[^;]+;base64,/, '');
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function logRun(db, status, processed, errorMessage, startedAt) {
  await recordWorkerRun(db, { workerName: 'qbo-attach', status, recordsProcessed: processed, errorMessage, startedAt });
}

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const startedAt = new Date().toISOString();
  const db = supabase(env);

  const auth = await requireRole(request, env, db, BILLING_ROLES);
  if (auth.error) return jsonResponse({ error: auth.error }, auth.status, request, env);

  const conn = await getConnection(env);
  if (!conn || !conn.refresh_token) return jsonResponse({ error: 'QuickBooks not connected' }, 409, request, env);

  let body = {};
  try { body = await request.json(); } catch { /* empty */ }

  // ── Remove path ──
  if (body.action === 'delete') {
    const attachmentId = body.attachment_id;
    if (!UUID_RE.test(String(attachmentId || ''))) return jsonResponse({ error: 'Provide a valid attachment_id' }, 400, request, env);
    try {
      const row = (await db.select('qbo_attachments', `id=eq.${attachmentId}&limit=1`))?.[0];
      if (!row) return jsonResponse({ error: 'Attachment not found' }, 404, request, env);
      await deleteAttachable(env, row.qbo_attachable_id);
      await db.delete('qbo_attachments', `id=eq.${attachmentId}`);
      await logRun(db, 'completed', 1, null, startedAt);
      return jsonResponse({ ok: true, removed: attachmentId }, 200, request, env);
    } catch (e) {
      await logRun(db, 'error', 0, e.message, startedAt);
      return jsonResponse({ error: e.message, intuit_tid: e.intuitTid || null }, 500, request, env);
    }
  }

  // ── Attach path ──
  const entityType = body.entity_type;
  const uprId = body.id;
  const fileName = (body.file_name || '').trim();
  const contentType = (body.content_type || '').trim() || 'application/octet-stream';
  const includeOnSend = body.include_on_send !== false; // default true
  const idempotencyKey = request.headers.get('Idempotency-Key') || '';
  const cfg = ENTITY[entityType];
  if (!cfg) return jsonResponse({ error: 'entity_type must be "invoice" or "estimate"' }, 400, request, env);
  if (!UUID_RE.test(String(uprId || ''))) return jsonResponse({ error: 'Provide a valid id' }, 400, request, env);
  if (!fileName) return jsonResponse({ error: 'Provide file_name' }, 400, request, env);
  if (!body.file_base64) return jsonResponse({ error: 'Provide file_base64' }, 400, request, env);
  if (!IDEMPOTENCY_KEY_RE.test(idempotencyKey)) {
    return jsonResponse({ error: 'Provide a stable Idempotency-Key (16–64 letters, numbers, _ or -)' }, 400, request, env);
  }
  // Cheap size gate before we materialize the bytes in memory.
  if (String(body.file_base64).length > MAX_B64_LEN) {
    return jsonResponse({ error: `File too large (max ${Math.round(MAX_BYTES / 1024 / 1024)} MB)` }, 413, request, env);
  }

  try {
    // Idempotency: if this exact attach already recorded a row, return it — never
    // upload a second copy to QuickBooks (which would email the customer twice).
    const prior = (await db.select('qbo_attachments', `idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&limit=1`))?.[0];
    if (prior) {
      await logRun(db, 'completed', 0, null, startedAt);
      return jsonResponse({ ok: true, attachment: prior, qbo_attachable_id: prior.qbo_attachable_id, idempotent: true }, 200, request, env);
    }

    let bytes;
    try { bytes = decodeBase64(body.file_base64); } catch { return jsonResponse({ error: 'Invalid file data' }, 400, request, env); }
    if (!bytes.length) return jsonResponse({ error: 'Empty file' }, 400, request, env);
    if (bytes.length > MAX_BYTES) return jsonResponse({ error: `File too large (max ${Math.round(MAX_BYTES / 1024 / 1024)} MB)` }, 413, request, env);

    const row = (await db.select(cfg.table, `id=eq.${uprId}&select=id,${cfg.qboCol}&limit=1`))?.[0];
    if (!row) return jsonResponse({ error: `${entityType} not found` }, 404, request, env);
    const qboEntityId = row[cfg.qboCol];
    if (!qboEntityId) return jsonResponse({ error: `Save this ${entityType} to QuickBooks before attaching a file.` }, 409, request, env);

    const attachable = await uploadAttachable(env, { entityType, qboEntityId, bytes, fileName, contentType, includeOnSend });

    const inserted = await db.insert('qbo_attachments', {
      entity_type: entityType,
      [cfg.idCol]: uprId,
      qbo_attachable_id: String(attachable.Id),
      file_name: fileName,
      content_type: contentType,
      file_size: bytes.length,
      include_on_send: includeOnSend,
      idempotency_key: idempotencyKey,
      created_by: auth.employee?.id || null,
    });
    const attachRow = Array.isArray(inserted) ? inserted[0] : inserted;

    await logRun(db, 'completed', 1, null, startedAt);
    return jsonResponse({ ok: true, attachment: attachRow, qbo_attachable_id: String(attachable.Id) }, 200, request, env);
  } catch (e) {
    await logRun(db, 'error', 0, e.message, startedAt);
    return jsonResponse({ error: e.message, intuit_tid: e.intuitTid || null }, 500, request, env);
  }
}
