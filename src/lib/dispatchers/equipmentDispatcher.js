// Dispatchers for equipment lifecycle — place_equipment + remove_equipment.
// place is idempotent on client_id. remove targets a server id (no queued removes
// against temp ids in v1 — remove always happens after place has synced).

import { resolveIdSwap } from '../offlineDb';

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
export async function dispatchEquipmentPlace(db, employee, payload /*, queueItem */) {
  if (!payload?.clientId || !payload?.jobId || !payload?.equipmentType) {
    throw new Error('dispatchEquipmentPlace requires clientId, jobId, equipmentType');
  }

  const resolvedRoomId = await resolveIdSwap(payload.roomId);

  const row = await db.rpc('place_equipment', {
    p_job_id:         payload.jobId,
    p_room_id:        resolvedRoomId || null,
    p_equipment_type: payload.equipmentType,
    p_nickname:       payload.nickname || null,
    p_serial:         payload.serialNumber || null,
    p_placed_by:      payload.placedBy || employee?.id || null,
    p_client_id:      payload.clientId,
    p_notes:          payload.notes || null,
  });

  const result = Array.isArray(row) ? row[0] : row;
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
export async function dispatchEquipmentRemove(db, employee, payload /*, queueItem */) {
  if (!payload?.equipmentId) {
    throw new Error('dispatchEquipmentRemove requires equipmentId');
  }
  const row = await db.rpc('remove_equipment', {
    p_equipment_id: payload.equipmentId,
    p_removed_by:   payload.removedBy || employee?.id || null,
  });
  const result = Array.isArray(row) ? row[0] : row;
  return { serverId: result?.id };
}
