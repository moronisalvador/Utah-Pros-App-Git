/**
 * ════════════════════════════════════════════════
 * FILE: qa-fixture-secret-boundary.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Prevents the standing qa-staging login password from being committed again.
 *   The database seed accepts only an injected bcrypt hash, while the hosted test
 *   runner receives the matching plaintext from GitHub's encrypted secret store.
 *
 * DEPENDS ON:
 *   Packages:  node:fs, node:url, vitest
 *   Internal:  QA fixture seed/helper/runner and the CI workflow
 *   Data:      reads → repository source files; writes → none
 * ════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (relative) => readFileSync(
  fileURLToPath(new URL(relative, import.meta.url)),
  'utf8',
).replace(/\r\n/g, '\n');

const seed = read('../../../scripts/qa/seed-branch-fixtures.sql');
const helper = read('../../../supabase/tests/helpers/qaFixtures.mjs');
const runner = read('../../../scripts/qa/run-qa-branch-db-tests.mjs');
const workflow = read('../../../.github/workflows/ci.yml');

describe('qa-staging fixture credential boundary', () => {
  it('requires an injected bcrypt hash instead of hashing a committed password', () => {
    expect(seed).toContain("current_setting('upr.qa_fixture_password_hash'");
    expect(seed).toContain("v_password_hash !~ '^\\$2[aby]\\$");
    expect(seed).not.toMatch(/extensions\.crypt\s*\(\s*'/);
    expect(seed).not.toMatch(/password for all three/i);
  });

  it('requires the QA-only password from process environment', () => {
    expect(helper).toContain('process?.env?.UPR_QA_FIXTURE_PASSWORD');
    expect(helper).toContain('fixture sign-in refused: UPR_QA_FIXTURE_PASSWORD is not configured');
    expect(helper).not.toMatch(/QA_FIXTURE_PASSWORD\s*=\s*['"][^'"]+['"]/);
  });

  it('forwards only the explicitly configured GitHub secret to the DB lane', () => {
    expect(runner).toContain('UPR_QA_FIXTURE_PASSWORD: fixturePassword');
    expect(workflow).toContain(
      'UPR_QA_FIXTURE_PASSWORD: ${{ secrets.UPR_QA_FIXTURE_PASSWORD }}',
    );
  });
});
