/**
 * ════════════════════════════════════════════════
 * FILE: scripts/configure-ios-capgo-dev.node-test.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the UPR Dev update setup cannot retain the production identity,
 *   start without its public verification key, or allow the app to redirect
 *   itself to another update service or channel.
 *
 * DEPENDS ON:
 *   Packages:  Node.js built-ins
 *   Internal:  scripts/configure-ios-capgo-dev.mjs
 *   Data:      none
 * ════════════════════════════════════════════════
 */
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';

import {
  CAPGO_DEV_APP_ID,
  CAPGO_DEV_CHANNEL,
  CAPGO_PRODUCTION_APP_ID,
  createCapgoDevConfig,
} from './configure-ios-capgo-dev.mjs';
import { validateCapgoV2PublicKey } from './lib/capgo-public-key.mjs';

const { publicKey: validPublicKey, privateKey: validPrivateKey } =
  generateKeyPairSync('rsa', {
    modulusLength: 4096,
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });

const source = Object.freeze({
  appId: CAPGO_PRODUCTION_APP_ID,
  appName: 'UPR',
  webDir: 'dist',
  plugins: {
    CapacitorUpdater: {
      appId: CAPGO_PRODUCTION_APP_ID,
      autoUpdate: false,
      directUpdate: false,
    },
  },
});

test('creates an isolated, fail-closed UPR Dev updater contract', () => {
  const configured = createCapgoDevConfig(source, {
    publicKey: validPublicKey,
  });

  assert.equal(configured.appId, CAPGO_DEV_APP_ID);
  assert.equal(configured.appName, 'UPR Dev');
  assert.equal(configured.plugins.CapacitorUpdater.appId, CAPGO_DEV_APP_ID);
  assert.equal(configured.plugins.CapacitorUpdater.defaultChannel, CAPGO_DEV_CHANNEL);
  assert.equal(
    configured.plugins.CapacitorUpdater.publicKey,
    validPublicKey.trim(),
  );
  assert.equal(configured.plugins.CapacitorUpdater.autoUpdate, true);
  assert.equal(configured.plugins.CapacitorUpdater.directUpdate, false);
  assert.equal(configured.plugins.CapacitorUpdater.allowSetDefaultChannel, false);
  assert.equal(configured.plugins.CapacitorUpdater.allowModifyAppId, false);
  assert.equal(configured.plugins.CapacitorUpdater.allowModifyUrl, false);
  assert.equal(configured.plugins.CapacitorUpdater.persistModifyUrl, false);
});

test('accepts and fingerprints a canonical Capgo v2 RSA-4096 public key', () => {
  const validated = validateCapgoV2PublicKey(validPublicKey);
  assert.equal(validated.publicKey, validPublicKey.trim());
  assert.match(validated.sha256, /^[a-f0-9]{64}$/);
});

test('creates a keyless UPR Dev identity while OTA remains disabled', () => {
  const configured = createCapgoDevConfig(source, { otaEnabled: false });
  const updater = configured.plugins.CapacitorUpdater;

  assert.equal(configured.appId, CAPGO_DEV_APP_ID);
  assert.equal(configured.appName, 'UPR Dev');
  assert.equal(updater.appId, CAPGO_DEV_APP_ID);
  assert.equal(updater.autoUpdate, false);
  assert.equal(updater.directUpdate, false);
  assert.equal(updater.publicKey, undefined);
  assert.equal(updater.defaultChannel, undefined);
});

test('refuses missing, private, malformed, or undersized key material', () => {
  assert.throws(
    () => createCapgoDevConfig(source),
    /CAPGO_DEV_PUBLIC_KEY_V2 is required/,
  );
  assert.throws(
    () => createCapgoDevConfig(source, {
      publicKey: validPrivateKey,
    }),
    /must be a PKCS#1 RSA-4096 public key/,
  );
  assert.throws(
    () => createCapgoDevConfig(source, { publicKey: 'not a key' }),
    /must be a PKCS#1 RSA-4096 public key/,
  );

  const { publicKey: undersizedPublicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });
  assert.throws(
    () => createCapgoDevConfig(source, {
      publicKey: undersizedPublicKey,
    }),
    /must be a valid PKCS#1 RSA-4096 public key/,
  );
});

test('refuses to reinterpret an unexpected or dev-generated identity', () => {
  assert.throws(
    () => createCapgoDevConfig({ ...source, appId: CAPGO_DEV_APP_ID }, {
      publicKey: validPublicKey,
    }),
    /Expected generated production appId/,
  );
});
