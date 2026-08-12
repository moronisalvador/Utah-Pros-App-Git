/**
 * ════════════════════════════════════════════════
 * FILE: qbo-document-command-gate.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks whether the newer QuickBooks document actions are allowed to run.
 *   It keeps those actions off unless the saved switch says they are on, and
 *   gives browser routes a consistent temporary-unavailable response.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  cors.js, qbo-provider-traffic.js
 *   Data:      reads  → feature_flags
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This deliberately ignores developer-preview settings: only the exact
 *     enabled boolean, without force-disabled, opens document commands.
 * ════════════════════════════════════════════════
 */

import { jsonResponse } from '../lib/cors.js';
import {
  QBO_PROVIDER_TRAFFIC_DISABLED_CODE,
  QBO_PROVIDER_TRAFFIC_DISABLED_MESSAGE,
} from '../lib/qbo-provider-traffic.js';

export const QBO_DOCUMENT_COMMAND_V2_FLAG = 'feature:qbo_document_command_v2';

export function qboProviderTrafficDisabledRouteResponse(request, env) {
  return jsonResponse({
    error: QBO_PROVIDER_TRAFFIC_DISABLED_MESSAGE,
    code: QBO_PROVIDER_TRAFFIC_DISABLED_CODE,
    reason: QBO_PROVIDER_TRAFFIC_DISABLED_CODE,
  }, 503, request, env);
}

export function isQboDocumentCommandV2Enabled(row) {
  return row?.enabled === true && row?.force_disabled !== true;
}

export async function requireQboDocumentCommandV2(db) {
  let rows;
  try {
    rows = await db.select(
      'feature_flags',
      `key=eq.${encodeURIComponent(QBO_DOCUMENT_COMMAND_V2_FLAG)}&select=key,enabled,force_disabled&limit=1`,
    );
  } catch {
    return false;
  }
  return Array.isArray(rows) && rows.length === 1 && isQboDocumentCommandV2Enabled(rows[0]);
}
