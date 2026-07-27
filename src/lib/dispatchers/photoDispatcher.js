/**
 * ════════════════════════════════════════════════
 * FILE: photoDispatcher.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Retains the dormant queued-photo helper for historical cleanup and future
 *   contract review. Production does not admit or dispatch photo uploads.
 *
 * DEPENDS ON:
 *   Internal:  offlineDb
 *   Data:      reads/writes → owner-bound IndexedDB; Storage; job document RPC
 *
 * NOTES / GOTCHAS:
 *   - DORMANT: production command admission/replay is empty and the sync runner
 *     does not import this helper.
 *   - Metadata insertion has no server idempotency key. Ambiguous outcomes are
 *     manual-reconciliation errors and must never auto-replay.
 * ════════════════════════════════════════════════
 */

import {
  QUEUE_CLAIM_TTL_MS,
  deletePhoto,
  getPhotoBlob,
  isStableQueueOperationId,
  resolveIdSwap,
} from '../offlineDb';

export const PHOTO_UPLOAD_TIMEOUT_MS = Math.floor(
  QUEUE_CLAIM_TTL_MS / 2,
);

/**
 * Send a queued photo upload to Supabase.
 * @param {object} db - Authenticated supabase client (exposes baseUrl, apiKey, rpc).
 * @param {object} employee - employee row (used for uploaded_by fallback).
 * @param {{clientId:string, jobId:string, appointmentId?:string, roomId?:string, description?:string, name:string}} payload
 * @returns {Promise<{serverId:string|undefined}>}
 */
export async function dispatchPhoto(
  db,
  employee,
  payload,
  queueItem,
  ownerLease,
  {
    fetchImpl = globalThis.fetch,
    AbortControllerImpl = globalThis.AbortController,
    setTimeoutImpl = globalThis.setTimeout,
    clearTimeoutImpl = globalThis.clearTimeout,
  } = {},
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
      'dispatchPhoto requires an owner-bound stable operation ID',
    );
  }

  const blobRow = await getPhotoBlob(operationId, ownerLease);
  if (
    !blobRow?.blob
    || blobRow.jobId !== payload.jobId
    || blobRow.name !== payload.name
  ) {
    // Blob was deleted or never saved. Treat as non-retryable — surface error upstream.
    throw new Error('Owned photo blob metadata is missing or inconsistent');
  }

  // Historical local data may still reference a temporary room UUID from the
  // dormant room prototype. Current production code does not enqueue room.create.
  const resolvedRoomId = await resolveIdSwap(payload.roomId, ownerLease);

  const mime = blobRow.mimeType || blobRow.blob.type || 'image/jpeg';
  const safeName = String(payload.name)
    .split(/[\\/]/)
    .pop()
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .slice(-120) || 'photo.jpg';
  const filePath = `${payload.jobId}/offline/${operationId}-${safeName}`;
  const encodedPath = filePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const uploadUrl = `${db.baseUrl}/storage/v1/object/job-files/${encodedPath}`;

  if (
    typeof fetchImpl !== 'function'
    || typeof AbortControllerImpl !== 'function'
  ) {
    throw new Error('Bounded photo upload is unavailable');
  }
  const controller = new AbortControllerImpl();
  const timeout = setTimeoutImpl(
    () => controller.abort(),
    PHOTO_UPLOAD_TIMEOUT_MS,
  );
  let res;
  try {
    res = await fetchImpl(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${db.apiKey}`,
        'Content-Type': mime,
        'x-upsert': 'false',
      },
      body: blobRow.blob,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted || error?.name === 'AbortError') {
      throw new Error('Storage upload timed out before queue claim expiry');
    }
    throw error;
  } finally {
    clearTimeoutImpl(timeout);
  }
  if (!res.ok) {
    // Keep the upstream body out of the durable offline queue. The status is
    // enough for the runner to distinguish deterministic 4xx rejections from
    // ambiguous transport failures.
    await res.text().catch(() => '');
    const error = new Error(`Storage upload failed (${res.status})`);
    error.status = res.status;
    throw error;
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

  const row = Array.isArray(doc) ? doc[0] : doc;
  return {
    serverId: row?.id,
    // Delete only after the queue's owner/epoch/claim completion is durable.
    cleanup: () => deletePhoto(operationId, ownerLease),
  };
}
