/**
 * ════════════════════════════════════════════════
 * FILE: tests/qa/unit/capgo-dev-workflow.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Locks the Capgo release source to the isolated UPR Dev app and canary
 *   channel. It proves production identifiers, automatic triggers, unencrypted
 *   uploads, direct delivery, and unproven rollback requests cannot enter it.
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
const publishStep = workflow.slice(
  workflow.indexOf('      - name: Stage encrypted bundle in the disabled dev channel'),
  workflow.indexOf('      - name: Activate the exact reviewed bundle'),
);
const activateStep = workflow.slice(
  workflow.indexOf('      - name: Activate the exact reviewed bundle'),
  workflow.indexOf('      - name: Disable future UPR Dev update delivery'),
);
const apiCredentialStep = workflow.slice(
  workflow.indexOf('      - name: Validate the dev-only Capgo API credential'),
  workflow.indexOf('      - name: Validate the dev-only Capgo encryption credentials'),
);
const encryptionCredentialStep = workflow.slice(
  workflow.indexOf('      - name: Validate the dev-only Capgo encryption credentials'),
  workflow.indexOf('      - name: Build the isolated native web bundle'),
);
const nativeBoundaryStep = workflow.slice(
  workflow.indexOf('      - name: Verify native cache and release boundaries'),
  workflow.indexOf('      - name: Compute immutable UPR Dev bundle identity'),
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

  it('requires exact confirmation, encrypted secrets, and compatibility proof', () => {
    expect(workflow).toContain('expected_confirmation="UPR DEV CAPGO ${OPERATION^^}"');
    expect(workflow).toContain('CAPGO_DEV_API_KEY');
    expect(workflow).toContain('CAPGO_DEV_PRIVATE_KEY_V2');
    expect(workflow).toContain(
      'CAPGO_DEV_PUBLIC_KEY_V2: ${{ secrets.CAPGO_DEV_PUBLIC_KEY_V2 }}',
    );
    expect(workflow).not.toContain('vars.CAPGO_DEV_PUBLIC_KEY_V2');
    expect(workflow).toContain('validateCapgoV2PublicKey');
    expect(workflow).toContain(
      'capgo bundle compatibility "$CAPGO_DEV_APP_ID"',
    );
    expect(workflow).toContain('--key-data-v2 "$CAPGO_DEV_PRIVATE_KEY_V2"');
    expect(workflow).not.toContain('CAPGO_TOKEN');
  });

  it('stages without delivery and activates only an exact reviewed bundle', () => {
    expect(workflow).toContain('test ! -e dist/sw.js');
    expect(workflow).toContain('test ! -e dist/manifest.json');
    expect(publishStep).toContain('capgo bundle upload "$CAPGO_DEV_APP_ID"');
    expect(publishStep).toContain('--channel "$CAPGO_DEV_STAGING_CHANNEL"');
    expect(publishStep).toContain(
      'capgo channel set "$CAPGO_DEV_STAGING_CHANNEL" "$CAPGO_DEV_APP_ID"',
    );
    expect(publishStep).toContain(
      "if: ${{ inputs.operation == 'publish' || inputs.operation == 'activate' }}",
    );
    expect(publishStep).toContain('--no-ios');
    expect(publishStep).toContain('--no-device');
    expect(activateStep).toContain(
      'capgo channel set "$CAPGO_DEV_CHANNEL" "$CAPGO_DEV_APP_ID"',
    );
    expect(activateStep).toContain('--bundle "$REQUESTED_BUNDLE_VERSION"');
    expect(activateStep).toContain('--ignore-metadata-check');
    expect(workflow).toContain(
      'activate requires an exact immutable UPR Dev bundle version.',
    );
    expect(workflow).not.toContain('rollback_bundle');
    expect(workflow).not.toContain("inputs.operation == 'rollback'");
    expect(workflow).toContain('--no-ios');
    expect(workflow).toContain(
      'bundleAssignedToChannel: process.env.OPERATION === "activate"',
    );
    expect(workflow).toContain(
      'deviceDeliveryActivated: process.env.OPERATION === "activate"',
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
    ).toHaveLength(5);
    expect(workflow).toContain(
      '-- node_modules/.bin/capgo bundle compatibility',
    );
    expect(workflow).toContain('-- node_modules/.bin/capgo bundle upload');
    expect(workflow).toContain('-- node_modules/.bin/capgo channel set');
  });

  it('keeps credential-free validation independent of Capgo secrets', () => {
    expect(apiCredentialStep).toContain(
      "if: ${{ inputs.operation == 'publish' || inputs.operation == 'activate' || inputs.operation == 'disable' }}",
    );
    expect(apiCredentialStep).toContain(
      'CAPGO_DEV_API_KEY: ${{ secrets.CAPGO_DEV_API_KEY }}',
    );
    expect(apiCredentialStep).not.toContain('CAPGO_DEV_PRIVATE_KEY_V2');
    expect(encryptionCredentialStep).toContain(
      "if: ${{ inputs.operation == 'publish' }}",
    );
    expect(encryptionCredentialStep).toContain(
      'CAPGO_DEV_PRIVATE_KEY_V2: ${{ secrets.CAPGO_DEV_PRIVATE_KEY_V2 }}',
    );
    expect(encryptionCredentialStep).not.toContain('CAPGO_DEV_API_KEY');
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
