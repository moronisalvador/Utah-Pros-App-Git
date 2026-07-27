/**
 * ════════════════════════════════════════════════
 * FILE: noteDispatcher.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Retains the dormant field-note prototype for historical source context.
 *
 * DEPENDS ON:
 *   Internal:  offlineDb
 *   Data:      reads → owner-bound IndexedDB ID swap; writes → job document RPC
 *
 * NOTES / GOTCHAS:
 *   - DORMANT: the production enqueue boundary rejects `note.insert` and the
 *     sync runner does not import this prototype.
 *   - The RPC has no operation ID. Ambiguous outcomes require manual
 *     reconciliation and must never auto-replay.
 * ════════════════════════════════════════════════
 */

import {
  isStableQueueOperationId,
  resolveIdSwap,
} from '../offlineDb';

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
export async function dispatchNote(
  db,
  employee,
  payload,
  queueItem,
  ownerLease,
) {
  const text = (payload?.description || '').trim();
  if (
    !payload?.jobId
    || !text
    || !isStableQueueOperationId(queueItem?.operationId)
    || payload.clientId !== queueItem.operationId
    || ownerLease?.owner !== queueItem?.owner
  ) {
    throw new Error(
      'dispatchNote requires an owner-bound stable operation ID',
    );
  }

  // Historical prototype data may reference a temporary room UUID.
  const resolvedRoomId = await resolveIdSwap(payload.roomId, ownerLease);

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
