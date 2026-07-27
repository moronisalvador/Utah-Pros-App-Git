/**
 * ════════════════════════════════════════════════
 * FILE: roomDispatcher.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Retains the dormant room-create prototype for historical source context.
 *
 * DEPENDS ON:
 *   Internal:  offlineDb
 *   Data:      writes → create_room RPC; owner-bound IndexedDB ID swap
 *
 * NOTES / GOTCHAS:
 *   - DORMANT: the production enqueue boundary rejects `room.create` and the
 *     sync runner does not import this prototype.
 *   - create_room must continue deduplicating p_client_id for safe replay.
 * ════════════════════════════════════════════════
 */

import {
  isStableQueueOperationId,
  recordIdSwap,
} from '../offlineDb';

/**
 * Send a queued room-create to Supabase.
 * @param {object} db - Authenticated supabase client from useAuth().
 * @param {object} employee - employee row from useAuth() (used for created_by fallback).
 * @param {{jobId:string, clientId:string, name:string, areaSqft?:number, ceilingHeightFt?:number, sortOrder?:number, createdBy?:string}} payload
 * @returns {Promise<{serverId:string, row:object}>}
 */
export async function dispatchRoom(
  db,
  employee,
  payload,
  queueItem,
  ownerLease,
) {
  const operationId = queueItem?.operationId;
  if (
    !payload?.jobId
    || !payload?.name
    || !isStableQueueOperationId(operationId)
    || payload.clientId !== operationId
    || ownerLease?.owner !== queueItem?.owner
  ) {
    throw new Error(
      'dispatchRoom requires an owner-bound stable operation ID',
    );
  }

  const result = await db.rpc('create_room', {
    p_job_id: payload.jobId,
    p_name: payload.name,
    p_area_sqft: payload.areaSqft ?? null,
    p_ceiling_height_ft: payload.ceilingHeightFt ?? null,
    p_sort_order: payload.sortOrder ?? null,
    p_client_id: operationId,
    p_created_by: payload.createdBy || employee?.id || null,
  });

  // RPC may return the row directly or wrap it in an array depending on PostgREST settings.
  const row = Array.isArray(result) ? result[0] : result;
  const serverId = row?.id;
  if (!serverId) throw new Error('create_room returned no id');

  // Record swap so any in-flight photos/readings referencing the temp id can resolve it.
  if (serverId !== operationId) {
    await recordIdSwap(operationId, serverId, ownerLease);
  }

  return { serverId, row };
}
