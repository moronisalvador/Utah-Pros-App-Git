/**
 * ════════════════════════════════════════════════
 * FILE: readingDispatcher.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Retains the dormant moisture-reading dispatch helper and its owner-bound
 *   stable-operation contract for possible later review.
 *
 * DEPENDS ON:
 *   Internal:  offlineDb
 *   Data:      reads → owner-bound IndexedDB ID swaps; writes → insert_reading RPC
 *
 * NOTES / GOTCHAS:
 *   - DORMANT: production command admission/replay is empty and the sync runner
 *     does not import this helper.
 *   - insert_reading must continue deduplicating p_client_id for safe replay.
 * ════════════════════════════════════════════════
 */

import {
  isStableQueueOperationId,
  resolveIdSwap,
} from '../offlineDb';

/**
 * Send a queued moisture reading to the server.
 * @param {object} db - Authenticated supabase client (db.rpc).
 * @param {object} employee - employee row (for taken_by fallback).
 * @param {{
 *   clientId:string, jobId:string, roomId?:string, equipmentId?:string,
 *   material:string, location?:string,
 *   mc?:number, rh?:number, tempF?:number, gpp?:number, dewPoint?:number,
 *   isAffected:boolean, takenBy?:string, notes?:string, takenAt?:string
 * }} payload
 * @returns {Promise<{serverId:string|undefined}>}
 */
export async function dispatchReading(
  db,
  employee,
  payload,
  queueItem,
  ownerLease,
) {
  const operationId = queueItem?.operationId;
  if (
    !payload?.jobId
    || !payload?.material
    || !isStableQueueOperationId(operationId)
    || payload.clientId !== operationId
    || ownerLease?.owner !== queueItem?.owner
  ) {
    throw new Error(
      'dispatchReading requires an owner-bound stable operation ID',
    );
  }

  // If the reading was captured while a room was still queued as a temp UUID,
  // swap it to the server UUID now. Same story for equipment.
  const resolvedRoomId = await resolveIdSwap(payload.roomId, ownerLease);
  const resolvedEquipmentId = await resolveIdSwap(
    payload.equipmentId,
    ownerLease,
  );
  const queuedAt = Number.isFinite(queueItem.createdAt)
    ? new Date(queueItem.createdAt).toISOString()
    : null;

  const row = await db.rpc('insert_reading', {
    p_job_id:       payload.jobId,
    p_room_id:      resolvedRoomId || null,
    p_material:     payload.material,
    p_location:     payload.location || null,
    p_mc:           payload.mc ?? null,
    p_rh:           payload.rh ?? null,
    p_temp_f:       payload.tempF ?? null,
    p_gpp:          payload.gpp ?? null,
    p_dew_point:    payload.dewPoint ?? null,
    p_is_affected:  !!payload.isAffected,
    p_equipment_id: resolvedEquipmentId || null,
    p_taken_by:     payload.takenBy || employee?.id || null,
    p_notes:        payload.notes || null,
    p_client_id:    operationId,
    p_taken_at:     payload.takenAt || queuedAt,
  });

  const result = Array.isArray(row) ? row[0] : row;
  return { serverId: result?.id };
}
