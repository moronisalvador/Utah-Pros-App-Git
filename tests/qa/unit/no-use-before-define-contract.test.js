/**
 * ════════════════════════════════════════════════
 * FILE: no-use-before-define-contract.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the project rejects a variable that is read before it exists. This keeps
 *   the lint guard that would have caught the native TechLayout startup crash.
 *
 * DEPENDS ON:
 *   Packages:  eslint, vitest
 *   Internal:  eslint.config.js, .github/workflows/ci.yml
 *   Data:      reads  → none
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This runs the real project lint configuration instead of checking its source text.
 *   - The existing baseline keeps the rule at warning level; changed-file CI treats warnings as failures.
 * ════════════════════════════════════════════════
 */
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../../..');
const eslint = new ESLint({
  cwd: ROOT,
  overrideConfigFile: join(ROOT, 'eslint.config.js'),
});

async function ruleMessages(source) {
  const [result] = await eslint.lintText(source, {
    filePath: 'src/components/__eslint_contract_fixture__.jsx',
    warnIgnored: false,
  });

  return result.messages.filter(
    (message) => message.ruleId === 'no-use-before-define',
  );
}

describe('variable-before-definition lint contract', () => {
  it('rejects the TechLayout-style const reference before its declaration', async () => {
    const messages = await ruleMessages(
      'const dependencies = [paneCovering];\n'
      + 'const paneCovering = true;\n'
      + 'export { dependencies };\n',
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      ruleId: 'no-use-before-define',
      messageId: 'usedBeforeDefined',
      line: 1,
      column: 23,
      severity: 1,
    });
  });

  it('allows deferred function and class declaration references', async () => {
    const messages = await ruleMessages(
      'function useLaterFunction() { return laterFunction(); }\n'
      + 'function laterFunction() { return true; }\n'
      + 'function createLaterClass() { return new LaterClass(); }\n'
      + 'class LaterClass {}\n'
      + 'export { useLaterFunction, createLaterClass };\n',
    );

    expect(messages).toEqual([]);
  });
});

describe('changed-file CI ratchet', () => {
  it('blocks pull requests on every lint error or warning', () => {
    const workflow = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
    const stepStart = workflow.indexOf('- name: Lint changed files (blocking ratchet)');
    const nextStep = workflow.indexOf('\n      - name:', stepStart + 1);
    const step = workflow.slice(stepStart, nextStep);

    expect(stepStart).toBeGreaterThan(-1);
    expect(step).toContain("if: github.event_name == 'pull_request'");
    expect(step).toContain('npx eslint --max-warnings 0 $CHANGED');
    expect(step).not.toContain('continue-on-error');
  });
});
