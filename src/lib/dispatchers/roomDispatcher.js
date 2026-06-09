// Dispatcher: drains a `room.create` queue item by calling the server-side `create_room` RPC.
// The RPC accepts our client-generated UUID (`p_client_id`) so reattempts are idempotent
// on the server — duplicate submits return the existing row instead of creating a new one.

import { recordIdSwap } from '../offlineDb';

/**
 * Send a queued room-create to Supabase.
 * @param {object} db - Authenticated supabase client from useAuth().
 * @param {object} employee - employee row from useAuth() (used for created_by fallback).
 * @param {{jobId:string, clientId:string, name:string, areaSqft?:number, ceilingHeightFt?:number, sortOrder?:number, createdBy?:string}} payload
 * @returns {Promise<{serverId:string, row:object}>}
 */
export async function dispatchRoom(db, employee, payload) {
  if (!payload?.jobId || !payload?.clientId || !payload?.name) {
    throw new Error('dispatchRoom requires jobId, clientId, name');
  }

  const result = await db.rpc('create_room', {
    p_job_id: payload.jobId,
    p_name: payload.name,
    p_area_sqft: payload.areaSqft ?? null,
    p_ceiling_height_ft: payload.ceilingHeightFt ?? null,
    p_sort_order: payload.sortOrder ?? null,
    p_client_id: payload.clientId,
    p_created_by: payload.createdBy || employee?.id || null,
  });

  // RPC may return the row directly or wrap it in an array depending on PostgREST settings.
  const row = Array.isArray(result) ? result[0] : result;
  const serverId = row?.id;
  if (!serverId) throw new Error('create_room returned no id');

  // Record swap so any in-flight photos/readings referencing the temp id can resolve it.
  if (serverId !== payload.clientId) {
    await recordIdSwap(payload.clientId, serverId);
  }

  return { serverId, row };
}
