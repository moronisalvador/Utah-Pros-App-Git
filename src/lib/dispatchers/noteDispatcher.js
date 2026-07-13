// Dispatcher: sends a queued text note to Supabase via the insert_job_document RPC.
// Mirrors the in-page note flow (PhotosNotes.jsx / TimeTracker.jsx) exactly so an
// offline-captured note produces the same job_documents row as an online one.

import { resolveIdSwap } from '../offlineDb';

/**
 * Send a queued field note to the server.
 * @param {object} db - Authenticated supabase client (db.rpc).
 * @param {object} employee - employee row (for uploaded_by fallback).
 * @param {{
 *   clientId:string, jobId:string, appointmentId?:string, roomId?:string,
 *   description:string, name?:string, uploadedBy?:string
 * }} payload
 * @returns {Promise<{serverId:string|undefined}>}
 */
export async function dispatchNote(db, employee, payload /*, queueItem */) {
  const text = (payload?.description || '').trim();
  if (!payload?.clientId || !payload?.jobId || !text) {
    throw new Error('dispatchNote requires clientId, jobId, description');
  }

  // A roomId captured offline may still be a temp UUID from a queued room.create.
  const resolvedRoomId = await resolveIdSwap(payload.roomId);

  const doc = await db.rpc('insert_job_document', {
    p_job_id: payload.jobId,
    p_name: payload.name || 'Field note',
    p_file_path: '',
    p_mime_type: 'text/plain',
    p_category: 'note',
    p_uploaded_by: payload.uploadedBy || employee?.id || null,
    p_description: text,
    p_appointment_id: payload.appointmentId || null,
    p_room_id: resolvedRoomId || null,
  });

  const row = Array.isArray(doc) ? doc[0] : doc;
  return { serverId: row?.id };
}
