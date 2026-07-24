/**
 * ════════════════════════════════════════════════
 * FILE: scripts/ios-release-workflow.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Keeps the paused iOS release workflow valid and manual-only until the
 *   owner supplies Apple signing access and deliberately enables releases.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  .github/workflows/ios-release.yml
 *   Data:      reads  → repository workflow text
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - GitHub rejects secret references directly inside step conditions.
 *   - This test does not sign, build, upload, or contact Apple.
 * ════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const workflowPath = fileURLToPath(
  new URL('../.github/workflows/ios-release.yml', import.meta.url),
);
const workflow = readFileSync(workflowPath, 'utf8');

describe('paused iOS release workflow', () => {
  it('remains workflow-dispatch-only', () => {
    expect(workflow).toMatch(/^\s{2}workflow_dispatch:\s*\{\}\s*$/m);
    expect(workflow).not.toMatch(/^\s{2}(push|pull_request|schedule):/m);
  });

  it('never references the secrets context directly in a step condition', () => {
    expect(workflow).not.toMatch(/^\s+if:.*\bsecrets\./m);
  });

  it('maps the signing gate to job env before evaluating it', () => {
    expect(workflow).toMatch(/^\s{6}APPLE_TEAM_ID:\s*\$\{\{\s*secrets\.APPLE_TEAM_ID\s*\}\}\s*$/m);
    expect(workflow).toMatch(/^\s{8}if:\s*\$\{\{\s*env\.APPLE_TEAM_ID\s*!=\s*''\s*\}\}\s*$/m);
    expect(workflow).toMatch(/^\s{8}if:\s*\$\{\{\s*env\.APPLE_TEAM_ID\s*==\s*''\s*\}\}\s*$/m);
  });
});
