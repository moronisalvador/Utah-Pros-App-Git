// Dispatcher: sends a queued moisture_reading to Supabase via insert_reading RPC.
// Mirrors the in-page flow exactly so online/offline writes produce identical rows.

import { resolveIdSwap } from '../offlineDb';

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
export async function dispatchReading(db, employee, payload /*, queueItem */) {
  if (!payload?.clientId || !payload?.jobId || !payload?.material) {
    throw new Error('dispatchReading requires clientId, jobId, material');
  }

  // If the reading was captured while a room was still queued as a temp UUID,
  // swap it to the server UUID now. Same story for equipment.
  const resolvedRoomId = await resolveIdSwap(payload.roomId);
  const resolvedEquipmentId = await resolveIdSwap(payload.equipmentId);

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
    p_client_id:    payload.clientId,
    p_taken_at:     payload.takenAt || new Date().toISOString(),
  });

  const result = Array.isArray(row) ? row[0] : row;
  return { serverId: result?.id };
}
