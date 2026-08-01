/**
 * ════════════════════════════════════════════════
 * FILE: scripts/configure-ios-capgo-dev.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Converts Capacitor's generated iOS settings into the isolated UPR Dev
 *   contract. It refuses production identities and requires the reviewed
 *   public update-verification key before enabling UPR Dev updates.
 *
 * DEPENDS ON:
 *   Packages:  Node.js built-ins
 *   Data:      reads  → generated Capacitor configuration and environment
 *              writes → generated iOS Capacitor configuration only
 *
 * NOTES / GOTCHAS:
 *   - The checked-in production capacitor.config.json is never changed.
 *   - The private Capgo key must never be passed to this script.
 * ════════════════════════════════════════════════
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCapgoV2PublicKey } from './lib/capgo-public-key.mjs';

export const CAPGO_DEV_APP_ID = 'com.utahprosrestoration.upr.dev';
export const CAPGO_DEV_CHANNEL = 'upr-dev-canary';
export const CAPGO_PRODUCTION_APP_ID = 'com.utahprosrestoration.upr';

export function createCapgoDevConfig(source, { publicKey } = {}) {
  if (source?.appId !== CAPGO_PRODUCTION_APP_ID) {
    throw new Error(
      `Expected generated production appId ${CAPGO_PRODUCTION_APP_ID} before dev isolation`,
    );
  }

  const plugins = source.plugins && typeof source.plugins === 'object'
    ? source.plugins
    : {};
  const updater = plugins.CapacitorUpdater
    && typeof plugins.CapacitorUpdater === 'object'
    ? plugins.CapacitorUpdater
    : {};

  return {
    ...source,
    appId: CAPGO_DEV_APP_ID,
    appName: 'UPR Dev',
    plugins: {
      ...plugins,
      CapacitorUpdater: {
        ...updater,
        appId: CAPGO_DEV_APP_ID,
        autoUpdate: true,
        autoDeleteFailed: true,
        autoDeletePrevious: true,
        resetWhenUpdate: true,
        directUpdate: false,
        appReadyTimeout: 30000,
        responseTimeout: 20,
        publicKey: validateCapgoV2PublicKey(publicKey).publicKey,
        defaultChannel: CAPGO_DEV_CHANNEL,
        allowSetDefaultChannel: false,
        allowModifyAppId: false,
        allowModifyUrl: false,
        persistModifyUrl: false,
        shakeMenu: false,
        allowShakeChannelSelector: false,
      },
    },
  };
}

export function configureIosCapgoDev({
  environment = process.env,
  configPath = path.resolve('ios/App/App/capacitor.config.json'),
} = {}) {
  const source = JSON.parse(readFileSync(configPath, 'utf8'));
  const configured = createCapgoDevConfig(source, {
    publicKey: environment.CAPGO_DEV_PUBLIC_KEY_V2,
  });
  writeFileSync(configPath, `${JSON.stringify(configured, null, 2)}\n`, {
    mode: 0o644,
  });
  return configPath;
}

const isDirectInvocation =
  process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectInvocation) {
  try {
    const outputPath = configureIosCapgoDev();
    console.log(`Configured isolated UPR Dev Capgo settings: ${outputPath}`);
  } catch (error) {
    console.error(`UPR Dev Capgo configuration failed: ${error.message}`);
    process.exitCode = 1;
  }
}
