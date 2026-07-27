/**
 * ════════════════════════════════════════════════
 * FILE: offlineOperationId.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Creates the durable UUID used to identify one offline operation. It uses
 *   browser cryptography only and fails before callers persist a blob or row
 *   when secure randomness is unavailable.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - Timestamp/Math.random fallbacks are intentionally forbidden.
 *   - randomUUID output is validated; getRandomValues supplies an RFC 4122 v4
 *     fallback for supported browsers without randomUUID.
 * ════════════════════════════════════════════════
 */

const RFC4122_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isOfflineOperationId(value) {
  return typeof value === 'string' && RFC4122_V4_PATTERN.test(value);
}

function formatUuidV4(bytes) {
  const hex = [...bytes].map((byte) => (
    byte.toString(16).padStart(2, '0')
  ));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
}

export function createOfflineOperationId(
  cryptoImpl = globalThis.crypto,
) {
  try {
    const nativeUuid = cryptoImpl?.randomUUID?.();
    if (isOfflineOperationId(nativeUuid)) return nativeUuid;
  } catch {
    // A getRandomValues fallback remains available in some browser shells.
  }

  try {
    if (typeof cryptoImpl?.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      cryptoImpl.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const uuid = formatUuidV4(bytes);
      if (isOfflineOperationId(uuid)) return uuid;
    }
  } catch {
    // Fall through to the visible fail-closed result.
  }

  throw new Error(
    'Secure offline operation identity is unavailable on this device',
  );
}
