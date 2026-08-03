/**
 * ════════════════════════════════════════════════
 * FILE: tests/qa/unit/capgo-dev-workflow.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Locks the Capgo release source to the isolated UPR Dev app and canary
 *   channel. It proves unsafe publishing, production identifiers, automatic
 *   triggers, direct delivery, and unproven rollback requests cannot enter it.
 *
 * DEPENDS ON:
 *   Packages:  vitest, Node.js built-ins
 *   Internal:  .github/workflows/capgo-dev.yml
 *   Data:      reads  → workflow source only
 *              writes → none
 * ════════════════════════════════════════════════
 */
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { verifyNativeReleaseAssets } from '../../../scripts/verify-native-release-assets.mjs';

const workflow = readFileSync(
  fileURLToPath(new URL('../../../.github/workflows/capgo-dev.yml', import.meta.url)),
  'utf8',
);
const capgoCliPackage = JSON.parse(readFileSync(
  fileURLToPath(new URL('../../../node_modules/@capgo/cli/package.json', import.meta.url)),
  'utf8',
));
const capgoCliSource = readFileSync(
  fileURLToPath(new URL('../../../node_modules/@capgo/cli/dist/index.js', import.meta.url)),
  'utf8',
);
const boundaryStep = workflow.slice(
  workflow.indexOf('      - name: Enforce the isolated dev boundary'),
  workflow.indexOf('      - name: Setup Node 22.23.1'),
);
const disableStep = workflow.slice(
  workflow.indexOf('      - name: Disable future UPR Dev update delivery'),
  workflow.indexOf('      - name: Write sanitized release evidence'),
);
const apiCredentialStep = workflow.slice(
  workflow.indexOf('      - name: Validate the dev-only Capgo API credential'),
  workflow.indexOf('      - name: Build the isolated native web bundle'),
);
const nativeBoundaryStep = workflow.slice(
  workflow.indexOf('      - name: Verify native cache and release boundaries'),
  workflow.indexOf('      - name: Compute immutable UPR Dev bundle identity'),
);
const bundleIdentityStep = workflow.slice(
  workflow.indexOf('      - name: Compute immutable UPR Dev bundle identity'),
  workflow.indexOf('      - name: Disable future UPR Dev update delivery'),
);
const RELEASE_SHA = 'a'.repeat(40);

function withAssetFixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'upr-native-release-assets-'));
  const assetsDir = join(root, 'app-assets');
  mkdirSync(assetsDir);
  try {
    return run({ assetsDir, root });
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

describe('UPR Dev Capgo workflow boundary', () => {
  it('is manual, serialized, read-only, and environment-gated', () => {
    expect(workflow).toMatch(/^\s{2}workflow_dispatch:\s*$/m);
    expect(workflow).not.toMatch(/^\s{2}(push|pull_request|schedule):/m);
    expect(workflow).toContain('contents: read');
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).toContain('environment: capgo-dev');
    expect(workflow).toContain('persist-credentials: false');
  });

  it('cannot name the official app or a production channel', () => {
    expect(workflow).toContain(
      'CAPGO_DEV_APP_ID: com.utahprosrestoration.upr.dev',
    );
    expect(workflow).toContain('CAPGO_DEV_CHANNEL: upr-dev-canary');
    expect(workflow).toContain('VITE_NATIVE_API_ORIGIN: https://dev.utahpros.app');
    expect(workflow).not.toContain('com.utahprosrestoration.upr\n');
    expect(workflow).not.toMatch(/CAPGO_[A-Z_]*CHANNEL:\s*(production|beta)/);
    expect(workflow).toContain('test "$GITHUB_REF" = "refs/heads/dev"');
  });

  it('requires exact confirmation before any permitted operation', () => {
    expect(workflow).toContain('expected_confirmation="UPR DEV CAPGO ${OPERATION^^}"');
    expect(workflow).toContain('CAPGO_DEV_API_KEY');
    expect(workflow).not.toContain('CAPGO_TOKEN');
    expect(boundaryStep.indexOf('expected_confirmation=')).toBeLessThan(
      boundaryStep.indexOf('if [[ "$OPERATION" == "publish" ]]'),
    );
  });

  it('retains publish as a fail-closed operation with no provider path', () => {
    expect(capgoCliPackage.version).toBe('8.31.5');
    expect(capgoCliSource).toContain('select("default_upload_channel")');
    expect(capgoCliSource).toContain('||"production"');
    expect(workflow).toContain('          - publish');
    expect(workflow).toContain('validate|publish|disable) ;;');
    expect(boundaryStep).toContain('if [[ "$OPERATION" == "publish" ]]');
    expect(boundaryStep).toContain(
      'Publish is blocked before credentials or provider traffic:',
    );
    expect(boundaryStep).toContain(
      'pinned Capgo CLI 8.31.5 assigns an omitted channel to the app default',
    );
    expect(workflow).not.toContain("inputs.operation == 'publish'");
    expect(workflow).not.toContain('capgo bundle upload');
    expect(workflow).not.toContain('capgo bundle compatibility');
    expect(workflow).not.toContain('CAPGO_DEV_PRIVATE_KEY_V2');
    expect(workflow).not.toContain('--key-data-v2');
    expect(workflow).not.toContain('CAPGO_DEV_STAGING_CHANNEL');
  });

  it('validates native assets while structurally blocking automated activation', () => {
    expect(workflow).toContain('test ! -e dist/sw.js');
    expect(workflow).toContain('test ! -e dist/manifest.json');
    expect(workflow).toContain(
      'Automated Capgo activation is blocked until provenance-bound activation exists.',
    );
    expect(workflow).not.toMatch(/^\s*-\s+activate\s*$/m);
    expect(workflow).not.toContain('bundle_version:');
    expect(workflow).not.toContain("inputs.operation == 'activate'");
    expect(workflow).not.toContain('REQUESTED_BUNDLE_VERSION');
    expect(workflow).not.toContain('--bundle "$REQUESTED_BUNDLE_VERSION"');
    expect(workflow).not.toContain('--ignore-metadata-check');
    expect(
      workflow.match(
        /capgo channel set "\$CAPGO_DEV_CHANNEL" "\$CAPGO_DEV_APP_ID"/g,
      ),
    ).toHaveLength(1);
    expect(disableStep).toContain(
      "if: ${{ inputs.operation == 'disable' }}",
    );
    expect(disableStep).toContain(
      'capgo channel set "$CAPGO_DEV_CHANNEL" "$CAPGO_DEV_APP_ID"',
    );
    expect(disableStep).toContain('--no-ios');
    expect(disableStep).toContain('--no-device');
    expect(disableStep).not.toContain('--bundle');
    expect(bundleIdentityStep).toContain(
      'ota_patch="$((10#$native_patch + 1))"',
    );
    expect(bundleIdentityStep).toContain(
      'bundle_version="${native_major}.${native_minor}.${ota_patch}-capgo.${GITHUB_RUN_NUMBER}.${GITHUB_RUN_ATTEMPT}+${short_sha}"',
    );
    expect(bundleIdentityStep).not.toContain(
      'bundle_version="${native_version}-capgo.',
    );
    expect(workflow).not.toContain('rollback_bundle');
    expect(workflow).not.toContain("inputs.operation == 'rollback'");
    expect(workflow).toContain('--no-ios');
    expect(workflow).toContain(
      'workflowBundleAssignmentAttempted: false',
    );
    expect(workflow).toContain(
      'workflowDeviceDeliveryActivationAttempted: false',
    );
    expect(workflow).toContain(
      'publishBlockedBeforeProvider: process.env.OPERATION === "publish"',
    );
    expect(workflow).toContain(
      'providerOperationSelected: process.env.OPERATION === "disable"',
    );
    expect(workflow).toContain(
      'DISABLE_STEP_OUTCOME: ${{ steps.disable_delivery.outcome }}',
    );
    expect(workflow).toContain(
      'disableProviderCommandCompleted:',
    );
    expect(workflow).not.toContain('providerRequestAttempted');
    expect(workflow).not.toContain('bundleAssignedToChannel');
    expect(workflow).not.toContain('deviceDeliveryActivated');
    expect(disableStep).toContain(
      'id: disable_delivery',
    );
    expect(workflow).not.toContain('--send-update-notification');
  });

  it('uses portable native-artifact SHA verification', () => {
    expect(nativeBoundaryStep).toContain(
      'node scripts/verify-native-release-assets.mjs',
    );
    expect(nativeBoundaryStep).not.toMatch(/\brg\b/);
    expect(nativeBoundaryStep).not.toMatch(/\bgrep\b/);
    expect(nativeBoundaryStep).not.toContain('dist/assets');
    expect(nativeBoundaryStep).not.toContain('secrets.CAPGO_DEV_');
    expect(nativeBoundaryStep).not.toContain('node_modules/.bin/capgo');
  });

  it('contains every Capgo network command in the five-minute owned runner', () => {
    expect(
      workflow.match(
        /node scripts\/qa\/run-owned-subprocess\.mjs\s+\\\n\s+--timeout-ms 292000/g,
      ),
    ).toHaveLength(1);
    expect(workflow).toContain('-- node_modules/.bin/capgo channel set');
  });

  it('keeps credential-free validation independent of Capgo secrets', () => {
    expect(apiCredentialStep).toContain(
      "if: ${{ inputs.operation == 'disable' }}",
    );
    expect(apiCredentialStep).toContain(
      'CAPGO_DEV_API_KEY: ${{ secrets.CAPGO_DEV_API_KEY }}',
    );
    expect(apiCredentialStep).not.toContain('CAPGO_DEV_PRIVATE_KEY_V2');
    expect(workflow).not.toMatch(
      /if:\s*\$\{\{\s*inputs\.operation == 'validate'\s*\}\}[\s\S]{0,400}secrets\.CAPGO_DEV_(API|PRIVATE)/,
    );
  });
});

describe('UPR Dev native release asset identity', () => {
  it('accepts a nested regular-file asset containing the exact release SHA', () => {
    withAssetFixture(({ assetsDir }) => {
      const nested = join(assetsDir, 'nested output');
      mkdirSync(nested);
      writeFileSync(join(nested, '-entry.js'), `release=${RELEASE_SHA}`);

      expect(
        verifyNativeReleaseAssets({ assetsDir, releaseSha: RELEASE_SHA }),
      ).toEqual({ fileCount: 1 });
    });
  });

  it('rejects malformed, missing, and absent release identity', () => {
    withAssetFixture(({ assetsDir }) => {
      writeFileSync(join(assetsDir, 'entry.js'), 'no release identity');

      expect(() => verifyNativeReleaseAssets({
        assetsDir,
        releaseSha: 'ABC',
      })).toThrow(/lowercase 40-character Git SHA/);
      expect(() => verifyNativeReleaseAssets({
        assetsDir,
        releaseSha: RELEASE_SHA,
      })).toThrow(/do not contain the requested release SHA/);
      expect(() => verifyNativeReleaseAssets({
        assetsDir: join(assetsDir, 'missing'),
        releaseSha: RELEASE_SHA,
      })).toThrow();
    });
  });

  it('rejects empty and symlinked asset trees', () => {
    withAssetFixture(({ assetsDir, root }) => {
      expect(() => verifyNativeReleaseAssets({
        assetsDir,
        releaseSha: RELEASE_SHA,
      })).toThrow(/directory is empty/);

      const source = join(root, 'source.js');
      writeFileSync(source, RELEASE_SHA);
      symlinkSync(source, join(assetsDir, 'linked.js'));
      expect(() => verifyNativeReleaseAssets({
        assetsDir,
        releaseSha: RELEASE_SHA,
      })).toThrow(/must not contain symlinks/);
    });
  });

  it('fails closed when a generated asset cannot be read', () => {
    withAssetFixture(({ assetsDir }) => {
      const unreadable = join(assetsDir, 'unreadable.js');
      writeFileSync(unreadable, RELEASE_SHA);
      chmodSync(unreadable, 0o000);
      try {
        expect(() => verifyNativeReleaseAssets({
          assetsDir,
          releaseSha: RELEASE_SHA,
        })).toThrow();
      } finally {
        chmodSync(unreadable, 0o600);
      }
    });
  });
});
