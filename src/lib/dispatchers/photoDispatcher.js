// Dispatcher: uploads a queued photo blob to Supabase Storage then inserts the
// `job_documents` row via `insert_job_document` RPC. Mirrors the exact flow used in
// TechAppointment.jsx (Storage POST with bearer + Content-Type, then RPC) so online/offline
// code paths produce identical server state.

import { getPhotoBlob, deletePhoto, resolveIdSwap } from '../offlineDb';

/**
 * Send a queued photo upload to Supabase.
 * @param {object} db - Authenticated supabase client (exposes baseUrl, apiKey, rpc).
 * @param {object} employee - employee row (used for uploaded_by fallback).
 * @param {{clientId:string, jobId:string, appointmentId?:string, roomId?:string, description?:string, name:string}} payload
 * @returns {Promise<{serverId:string|undefined}>}
 */
export async function dispatchPhoto(db, employee, payload /*, queueItem */) {
  if (!payload?.clientId || !payload?.jobId || !payload?.name) {
    throw new Error('dispatchPhoto requires clientId, jobId, name');
  }

  const blobRow = await getPhotoBlob(payload.clientId);
  if (!blobRow?.blob) {
    // Blob was deleted or never saved. Treat as non-retryable — surface error upstream.
    throw new Error('Photo blob missing from local storage');
  }

  // A roomId stored when the user was offline may still be a temp UUID from a queued
  // `room.create`. Resolve to the real server UUID before hitting the server.
  const resolvedRoomId = await resolveIdSwap(payload.roomId);

  const mime = blobRow.mimeType || blobRow.blob.type || 'image/jpeg';
  const filePath = `${payload.jobId}/${Date.now()}-${payload.name}`;
  const uploadUrl = `${db.baseUrl}/storage/v1/object/job-files/${filePath}`;

  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${db.apiKey}`,
      'Content-Type': mime,
    },
    body: blobRow.blob,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Storage upload failed: ${res.status} ${text}`);
  }

  const doc = await db.rpc('insert_job_document', {
    p_job_id: payload.jobId,
    p_name: payload.name,
    p_file_path: `job-files/${filePath}`,
    p_mime_type: mime,
    p_category: 'photo',
    p_uploaded_by: blobRow.uploadedBy || employee?.id || null,
    p_appointment_id: payload.appointmentId || null,
    p_description: payload.description || null,
    p_room_id: resolvedRoomId || null,
  });

  // Free local storage on success — the blob is now durable server-side.
  await deletePhoto(payload.clientId);

  const row = Array.isArray(doc) ? doc[0] : doc;
  return { serverId: row?.id };
}
