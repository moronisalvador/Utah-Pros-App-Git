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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  fileURLToPath(new URL('../../../.github/workflows/capgo-dev.yml', import.meta.url)),
  'utf8',
);
const publishStep = workflow.slice(
  workflow.indexOf('      - name: Stage encrypted bundle without channel assignment'),
  workflow.indexOf('      - name: Disable future UPR Dev update delivery'),
);

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

  it('stages without delivery and keeps only the emergency disable mutation', () => {
    expect(workflow).toContain('test ! -e dist/sw.js');
    expect(workflow).toContain('test ! -e dist/manifest.json');
    expect(publishStep).toContain('capgo bundle upload "$CAPGO_DEV_APP_ID"');
    expect(publishStep).not.toContain('--channel');
    expect(workflow).not.toContain('rollback_bundle');
    expect(workflow).not.toContain("inputs.operation == 'rollback'");
    expect(workflow).toContain('--no-ios');
    expect(workflow).toContain('bundleAssignedToChannel: false');
    expect(workflow).toContain('deviceDeliveryActivated: false');
    expect(workflow).not.toContain('--send-update-notification');
  });

  it('keeps credential-free validation independent of Capgo secrets', () => {
    expect(workflow).toContain(
      'if [[ "$OPERATION" = "publish" || "$OPERATION" = "disable" ]]',
    );
    expect(workflow).toContain('if [[ "$OPERATION" = "publish" ]]');
    expect(workflow).not.toMatch(
      /if \[\[ -z "\$\{CAPGO_DEV_API_KEY:-\}" \]\]/,
    );
  });
});
