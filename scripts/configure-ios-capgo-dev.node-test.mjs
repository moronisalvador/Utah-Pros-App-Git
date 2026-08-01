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
import test from 'node:test';

import {
  CAPGO_DEV_APP_ID,
  CAPGO_DEV_CHANNEL,
  CAPGO_PRODUCTION_APP_ID,
  createCapgoDevConfig,
} from './configure-ios-capgo-dev.mjs';

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
    publicKey: 'reviewed-dev-public-key',
  });

  assert.equal(configured.appId, CAPGO_DEV_APP_ID);
  assert.equal(configured.appName, 'UPR Dev');
  assert.equal(configured.plugins.CapacitorUpdater.appId, CAPGO_DEV_APP_ID);
  assert.equal(configured.plugins.CapacitorUpdater.defaultChannel, CAPGO_DEV_CHANNEL);
  assert.equal(configured.plugins.CapacitorUpdater.publicKey, 'reviewed-dev-public-key');
  assert.equal(configured.plugins.CapacitorUpdater.autoUpdate, true);
  assert.equal(configured.plugins.CapacitorUpdater.directUpdate, false);
  assert.equal(configured.plugins.CapacitorUpdater.allowSetDefaultChannel, false);
  assert.equal(configured.plugins.CapacitorUpdater.allowModifyAppId, false);
  assert.equal(configured.plugins.CapacitorUpdater.allowModifyUrl, false);
  assert.equal(configured.plugins.CapacitorUpdater.persistModifyUrl, false);
});

test('refuses missing or private key material', () => {
  assert.throws(
    () => createCapgoDevConfig(source),
    /CAPGO_DEV_PUBLIC_KEY_V2 is required/,
  );
  assert.throws(
    () => createCapgoDevConfig(source, {
      publicKey: '-----BEGIN PRIVATE KEY-----',
    }),
    /must contain only the Capgo v2 public key/,
  );
});

test('refuses to reinterpret an unexpected or dev-generated identity', () => {
  assert.throws(
    () => createCapgoDevConfig({ ...source, appId: CAPGO_DEV_APP_ID }, {
      publicKey: 'reviewed-dev-public-key',
    }),
    /Expected generated production appId/,
  );
});
