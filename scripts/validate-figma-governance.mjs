/**
 * ════════════════════════════════════════════════
 * FILE: validate-figma-governance.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks that the repository's Figma contract remains disconnected, exactly scoped, and unable to
 *   install, connect, purchase, auto-sync, publish, or change files without a new owner decision.
 *
 * DEPENDS ON:
 *   Packages:  Node.js built-ins only
 *   Internal:  .claude/figma-governance.json
 *   Data:      reads  → Figma governance metadata
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This validates repository intent only; it does not inspect or change a Figma account.
 * ════════════════════════════════════════════════
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const DENIED_ACTIONS = [
  'installPlugin',
  'connectAccount',
  'purchaseSeat',
  'autoSync',
  'codeGeneration',
  'publicPublish',
];
const ASK_ACTIONS = [
  'readOrExport',
  'writeDesign',
  'comment',
  'share',
  'import',
  'repositoryWrite',
];

export function validateFigmaGovernance(policy) {
  const errors = [];
  if (policy?.schemaVersion !== 1) errors.push('schemaVersion must equal 1');
  if (policy?.status !== 'disconnected') errors.push('status must remain disconnected');
  if (policy?.scope?.wildcardsAllowed !== false) errors.push('wildcard scope must be disabled');
  if (policy?.scope?.publicSharingAllowed !== false) errors.push('public sharing must be disabled');
  for (const field of ['workspaceIds', 'fileIds']) {
    const values = policy?.scope?.[field];
    if (!Array.isArray(values)) {
      errors.push(`${field} must be an array`);
    } else if (values.some((value) => typeof value !== 'string' || !value || /[*?]/.test(value))) {
      errors.push(`${field} contains an empty or wildcard scope`);
    }
  }
  for (const action of DENIED_ACTIONS) {
    if (policy?.actions?.[action] !== 'deny') errors.push(`${action} must remain deny`);
  }
  for (const action of ASK_ACTIONS) {
    if (!String(policy?.actions?.[action] || '').startsWith('ask-')) {
      errors.push(`${action} must require exact approval`);
    }
  }
  if (policy?.authority?.runtimeBehavior !== 'repository') {
    errors.push('runtime behavior authority must remain the repository');
  }
  if (policy?.authority?.authorizationAccessibilityResponsiveTests !== 'repository') {
    errors.push('engineering safety authority must remain the repository');
  }
  if (policy?.artifacts?.authStateInRepository !== false) {
    errors.push('Figma Auth state must be forbidden from the repository');
  }
  if (policy?.artifacts?.customerDataAllowed !== false) {
    errors.push('customer data must remain forbidden');
  }
  return errors;
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const policy = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'figma-governance.json'), 'utf8'));
  const errors = validateFigmaGovernance(policy);
  for (const error of errors) process.stderr.write(`Figma governance error: ${error}\n`);
  process.stdout.write(`Figma governance: ${errors.length} error(s); status disconnected.\n`);
  process.exitCode = errors.length ? 1 : 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
