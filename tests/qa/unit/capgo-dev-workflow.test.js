/**
 * ════════════════════════════════════════════════
 * FILE: tests/qa/unit/capgo-dev-workflow.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Locks the Capgo release source to the isolated UPR Dev app and canary
 *   channel. It proves production identifiers, automatic triggers, unencrypted
 *   uploads, and loose rollback requests cannot enter this workflow.
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

  it('requires exact confirmation, encryption, and compatibility limits', () => {
    expect(workflow).toContain('expected_confirmation="UPR DEV CAPGO ${OPERATION^^}"');
    expect(workflow).toContain('CAPGO_DEV_API_KEY');
    expect(workflow).toContain('CAPGO_DEV_PRIVATE_KEY_V2');
    expect(workflow).toContain('CAPGO_DEV_PUBLIC_KEY_V2');
    expect(workflow).toContain('--key-data-v2 "$CAPGO_DEV_PRIVATE_KEY_V2"');
    expect(workflow).toContain('--min-update-version');
    expect(workflow).toContain('--fail-on-incompatible');
    expect(workflow).not.toContain('CAPGO_TOKEN');
  });

  it('keeps native cache files out and supports bounded rollback/disable', () => {
    expect(workflow).toContain('test ! -e dist/sw.js');
    expect(workflow).toContain('test ! -e dist/manifest.json');
    expect(workflow).toContain('--bundle "$ROLLBACK_BUNDLE"');
    expect(workflow).toContain('--no-downgrade');
    expect(workflow).toContain('--disable-auto-update patch');
    expect(workflow).toContain('--no-ios');
    expect(workflow).not.toContain('--send-update-notification');
  });
});
