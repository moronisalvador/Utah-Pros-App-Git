/**
 * ════════════════════════════════════════════════
 * FILE: scripts/write-native-release-manifest.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Writes a non-secret contract into the native web bundle so a signed iOS
 *   artifact can prove which app variant, API origin, Push mode, APNs
 *   environment, and source commit it actually contains.
 *
 * DEPENDS ON:
 *   Packages:  Node.js built-ins
 *   Data:      reads  → reviewed release environment variables
 *              writes → dist/upr-native-release.json
 *
 * NOTES / GOTCHAS:
 *   - This file contains no credentials and must never be used to store them.
 *   - Production and dev identities/origins are an allowlist, not free-form.
 * ════════════════════════════════════════════════
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RELEASE_VARIANTS = Object.freeze({
  production: Object.freeze({
    bundleIdentifier: 'com.utahprosrestoration.upr',
    apiOrigin: 'https://utahpros.app',
  }),
  dev: Object.freeze({
    bundleIdentifier: 'com.utahprosrestoration.upr.dev',
    apiOrigin: 'https://dev.utahpros.app',
  }),
});

function requireExact(value, expected, label) {
  if (value !== expected) {
    throw new Error(`${label} must be exactly ${expected}`);
  }
}

export function createNativeReleaseManifest(environment) {
  const variant = environment.UPR_RELEASE_VARIANT;
  const release = RELEASE_VARIANTS[variant];
  if (!release) {
    throw new Error('UPR_RELEASE_VARIANT must be production or dev');
  }

  requireExact(
    environment.VITE_NATIVE_API_ORIGIN,
    release.apiOrigin,
    'VITE_NATIVE_API_ORIGIN',
  );
  if (!['true', 'false'].includes(environment.VITE_NATIVE_PUSH_ENABLED)) {
    throw new Error('VITE_NATIVE_PUSH_ENABLED must be exactly true or false');
  }
  if (
    !['true', 'false'].includes(
      environment.VITE_NATIVE_PUSH_RETIRE_DEV_TOKEN,
    )
  ) {
    throw new Error(
      'VITE_NATIVE_PUSH_RETIRE_DEV_TOKEN must be exactly true or false',
    );
  }
  requireExact(environment.VITE_APNS_ENV, 'production', 'VITE_APNS_ENV');

  const sourceCommit = environment.VITE_RELEASE_SHA;
  if (!/^[0-9a-f]{40}$/.test(sourceCommit || '')) {
    throw new Error('VITE_RELEASE_SHA must be a lowercase 40-character Git SHA');
  }

  const nativePushEnabled =
    environment.VITE_NATIVE_PUSH_ENABLED === 'true';
  const retireDevToken =
    environment.VITE_NATIVE_PUSH_RETIRE_DEV_TOKEN === 'true';
  if (
    (variant === 'dev' && retireDevToken === nativePushEnabled) ||
    (variant === 'production' && retireDevToken)
  ) {
    throw new Error(
      'UPR Dev must retire its token exactly when native Push is disabled',
    );
  }

  return {
    schemaVersion: 1,
    variant,
    bundleIdentifier: release.bundleIdentifier,
    apiOrigin: release.apiOrigin,
    nativePushEnabled,
    retireDevToken,
    apnsEnvironment: 'production',
    sourceCommit,
  };
}

export function writeNativeReleaseManifest({
  environment = process.env,
  outputDirectory = path.resolve('dist'),
} = {}) {
  const manifest = createNativeReleaseManifest(environment);
  mkdirSync(outputDirectory, { recursive: true });
  const outputPath = path.join(outputDirectory, 'upr-native-release.json');
  writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o644,
  });
  return outputPath;
}

const isDirectInvocation =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectInvocation) {
  try {
    const outputPath = writeNativeReleaseManifest();
    console.log(`Wrote native release manifest: ${outputPath}`);
  } catch (error) {
    console.error(`Native release manifest failed: ${error.message}`);
    process.exitCode = 1;
  }
}
