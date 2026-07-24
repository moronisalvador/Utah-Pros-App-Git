/**
 * ════════════════════════════════════════════════
 * FILE: artifact-scan.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves retained QA files reject fake credentials, browser sessions, production identifiers,
 *   and personal contact-shaped data without echoing the matched value into the error.
 *
 * DEPENDS ON:
 *   Packages:  vitest, Node.js built-ins
 *   Internal:  tests/qa/lib/artifact-scan.mjs, tests/qa/lib/target-policy.mjs
 *   Data:      reads  → temporary synthetic fixtures
 *              writes → temporary synthetic fixtures
 *
 * NOTES / GOTCHAS:
 *   - Every sensitive-looking value in this suite is generated from obvious fake fragments.
 * ════════════════════════════════════════════════
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { assertArtifactsSafe, scanArtifactRoots } from '../lib/artifact-scan.mjs';
import { PRODUCTION_PROJECT_REF } from '../lib/target-policy.mjs';

const roots = [];

function fixture(name, contents) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upr-artifact-scan-'));
  roots.push(root);
  fs.writeFileSync(path.join(root, name), contents);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('QA artifact privacy scan', () => {
  it('accepts a redacted synthetic summary', () => {
    const root = fixture(
      'summary.json',
      JSON.stringify({ actor: 'qa_admin', email: 'qa_admin@example.test', result: 'denied' }),
    );
    expect(assertArtifactsSafe([root])).toEqual({ roots: 1, findings: 0 });
  });

  it.each([
    ['authorization-header', `Authorization: Bearer ${['fake', 'fixture', 'credential', '123456789'].join('-')}`],
    ['auth-token-field', JSON.stringify({ access_token: 'fake-fixture-access-token' })],
    ['browser-storage-state', JSON.stringify({ cookies: [], origins: [] })],
    ['production-project-ref', PRODUCTION_PROJECT_REF],
    ['private-key', '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----'],
    ['likely-email', 'customer-person@real-looking.invalid'],
    ['likely-phone', '+13855550123'],
  ])('detects %s without returning matched content', (rule, value) => {
    const root = fixture('unsafe.txt', value);
    const findings = scanArtifactRoots([root]);
    expect(findings).toContainEqual({ rule, file: 'unsafe.txt' });

    let message = '';
    try {
      assertArtifactsSafe([root]);
    } catch (error) {
      message = error.message;
    }
    expect(message).toContain(rule);
    expect(message).not.toContain(value);
  });
});
