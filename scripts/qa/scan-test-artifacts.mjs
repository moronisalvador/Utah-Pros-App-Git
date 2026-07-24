/**
 * ════════════════════════════════════════════════
 * FILE: scan-test-artifacts.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Runs the repository's privacy check against Playwright result and report folders. Missing folders
 *   are treated as empty, while any unsafe retained file makes the command fail.
 *
 * DEPENDS ON:
 *   Packages:  Node.js built-ins only
 *   Internal:  tests/qa/lib/artifact-scan.mjs
 *   Data:      reads  → test-results, playwright-report
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - The scan reports rule names and relative paths only.
 * ════════════════════════════════════════════════
 */

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { assertArtifactsSafe } from '../../tests/qa/lib/artifact-scan.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const targets = [
  path.join(root, 'test-results'),
  path.join(root, 'playwright-report'),
];

try {
  assertArtifactsSafe(targets);
  process.stdout.write('QA artifact scan: 0 unsafe retained files.\n');
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'QA artifact scan failed'}\n`);
  process.exitCode = 1;
}
