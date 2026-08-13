/**
 * ════════════════════════════════════════════════
 * FILE: qbo-provider-traffic-response.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Gives QuickBooks browser routes one CORS-safe maintenance response when
 *   the company-wide provider traffic brake is closed.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  cors.js, qbo-provider-traffic.js
 *   Data:      reads  → none
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This file has no document-command or schema capability checks. It is
 *     safe to deploy before the P4c database migrations.
 * ════════════════════════════════════════════════
 */

import { jsonResponse } from '../lib/cors.js';
import {
  QBO_PROVIDER_TRAFFIC_DISABLED_CODE,
  QBO_PROVIDER_TRAFFIC_DISABLED_MESSAGE,
} from '../lib/qbo-provider-traffic.js';

export function qboProviderTrafficDisabledRouteResponse(request, env) {
  return jsonResponse({
    error: QBO_PROVIDER_TRAFFIC_DISABLED_MESSAGE,
    code: QBO_PROVIDER_TRAFFIC_DISABLED_CODE,
    reason: QBO_PROVIDER_TRAFFIC_DISABLED_CODE,
  }, 503, request, env);
}
