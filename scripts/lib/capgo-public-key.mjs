/**
 * ════════════════════════════════════════════════
 * FILE: scripts/lib/capgo-public-key.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Validates and fingerprints the public half of a Capgo v2 RSA keypair
 *   without printing or retaining any key material.
 *
 * DEPENDS ON:
 *   Packages:  Node.js built-ins
 *   Data:      reads  → caller-provided public key text
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Capgo CLI 8 emits a PKCS#1 RSA public-key PEM for v2 encryption.
 *   - Private keys, non-RSA keys, and RSA keys below 4096 bits fail closed.
 * ════════════════════════════════════════════════
 */
import { createHash, createPublicKey } from 'node:crypto';

const PKCS1_RSA_PUBLIC_BEGIN = '-----BEGIN RSA PUBLIC KEY-----';
const PKCS1_RSA_PUBLIC_END = '-----END RSA PUBLIC KEY-----';

export function validateCapgoV2PublicKey(publicKey, {
  label = 'CAPGO_DEV_PUBLIC_KEY_V2',
} = {}) {
  const value = publicKey?.trim().replaceAll('\r\n', '\n');
  if (!value) {
    throw new Error(`${label} is required before UPR Dev OTA can be enabled`);
  }
  if (
    value.includes('PRIVATE KEY')
    || !value.startsWith(PKCS1_RSA_PUBLIC_BEGIN)
    || !value.endsWith(PKCS1_RSA_PUBLIC_END)
  ) {
    throw new Error(`${label} must be a PKCS#1 RSA-4096 public key`);
  }

  let keyObject;
  try {
    keyObject = createPublicKey(value);
  } catch {
    throw new Error(`${label} must be a valid PKCS#1 RSA-4096 public key`);
  }

  if (
    keyObject.type !== 'public'
    || keyObject.asymmetricKeyType !== 'rsa'
    || keyObject.asymmetricKeyDetails?.modulusLength !== 4096
  ) {
    throw new Error(`${label} must be a valid PKCS#1 RSA-4096 public key`);
  }

  const normalizedKey = keyObject.export({
    format: 'pem',
    type: 'pkcs1',
  }).toString().trim();
  if (normalizedKey !== value) {
    throw new Error(`${label} must use canonical PKCS#1 PEM encoding`);
  }

  return Object.freeze({
    publicKey: normalizedKey,
    sha256: createHash('sha256').update(normalizedKey).digest('hex'),
  });
}
