/**
 * ════════════════════════════════════════════════
 * FILE: equipmentDispatcher.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Retains dormant equipment placement/removal helpers. Placement carries a
 *   stable operation ID; removal has no such server key.
 *
 * DEPENDS ON:
 *   Internal:  offlineDb
 *   Data:      reads/writes → owner-bound IndexedDB ID swaps; equipment RPCs
 *
 * NOTES / GOTCHAS:
 *   - DORMANT: production command admission/replay is empty and the sync runner
 *     does not import these helpers.
 *   - place_equipment is replay-safe only while p_client_id deduplicates.
 *   - remove_equipment requires manual reconciliation after ambiguity.
 * ════════════════════════════════════════════════
 */

import {
  isStableQueueOperationId,
  recordIdSwap,
  resolveIdSwap,
} from '../offlineDb';

/**
 * Place an equipment unit.
 * @param {object} db
 * @param {object} employee
 * @param {{
 *   clientId:string, jobId:string, roomId?:string,
 *   equipmentType:string, nickname?:string, serialNumber?:string,
 *   placedBy?:string, notes?:string
 * }} payload
 * @returns {Promise<{serverId:string|undefined}>}
 */
export async function dispatchEquipmentPlace(
  db,
  employee,
  payload,
  queueItem,
  ownerLease,
) {
  const operationId = queueItem?.operationId;
  if (
    !payload?.jobId
    || !payload?.equipmentType
    || !isStableQueueOperationId(operationId)
    || payload.clientId !== operationId
    || ownerLease?.owner !== queueItem?.owner
  ) {
    throw new Error(
      'dispatchEquipmentPlace requires an owner-bound stable operation ID',
    );
  }

  const resolvedRoomId = await resolveIdSwap(payload.roomId, ownerLease);

  const row = await db.rpc('place_equipment', {
    p_job_id:         payload.jobId,
    p_room_id:        resolvedRoomId || null,
    p_equipment_type: payload.equipmentType,
    p_nickname:       payload.nickname || null,
    p_serial:         payload.serialNumber || null,
    p_placed_by:      payload.placedBy || employee?.id || null,
    p_client_id:      operationId,
    p_notes:          payload.notes || null,
  });

  const result = Array.isArray(row) ? row[0] : row;
  if (result?.id && result.id !== operationId) {
    await recordIdSwap(operationId, result.id, ownerLease);
  }
  return { serverId: result?.id };
}

/**
 * Remove (return) an equipment unit. Targets a real server id — queued removes
 * of still-pending placements are not supported in v1 (rare in practice: techs
 * don't typically place and then un-place in the same offline session).
 * @param {object} db
 * @param {object} employee
 * @param {{equipmentId:string, removedBy?:string}} payload
 */
export async function dispatchEquipmentRemove(
  db,
  employee,
  payload,
  queueItem,
  ownerLease,
) {
  if (
    !payload?.equipmentId
    || !isStableQueueOperationId(queueItem?.operationId)
    || ownerLease?.owner !== queueItem?.owner
  ) {
    throw new Error(
      'dispatchEquipmentRemove requires an owner-bound operation',
    );
  }
  const row = await db.rpc('remove_equipment', {
    p_equipment_id: payload.equipmentId,
    p_removed_by:   payload.removedBy || employee?.id || null,
  });
  const result = Array.isArray(row) ? row[0] : row;
  return { serverId: result?.id };
}
