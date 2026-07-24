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
const ASK_ACTIONS = {
  readOrExport: 'ask-exact-scope',
  writeDesign: 'ask-every-change',
  comment: 'ask-every-change',
  share: 'ask-every-change',
  import: 'ask-every-change',
  repositoryWrite: 'ask-every-change',
};
const AUTHORITY = {
  approvedDesignIntent: 'repository-until-approved-figma-file-version',
  runtimeBehavior: 'repository',
  authorizationAccessibilityResponsiveTests: 'repository',
  tokensComponentsShippedSource: 'repository',
  conflictRule: 'repository-until-reviewed-commit',
};
const EXACT_KEYS = {
  root: ['schemaVersion', 'status', 'lastVerified', 'scope', 'authority', 'actions', 'artifacts'],
  scope: ['workspaceIds', 'fileIds', 'wildcardsAllowed', 'publicSharingAllowed'],
  authority: Object.keys(AUTHORITY),
  actions: [...DENIED_ACTIONS, ...Object.keys(ASK_ACTIONS)],
  artifacts: [
    'authStateInRepository',
    'customerDataAllowed',
    'baselineRequiresReleaseSha',
    'baselineRequiresManifest',
  ],
};

function rejectUnknownKeys(errors, label, value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${label} must be an object`);
    return;
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`${label}.${key} is not allowed`);
  }
}

export function validateFigmaGovernance(policy) {
  const errors = [];
  rejectUnknownKeys(errors, 'policy', policy, EXACT_KEYS.root);
  rejectUnknownKeys(errors, 'scope', policy?.scope, EXACT_KEYS.scope);
  rejectUnknownKeys(errors, 'authority', policy?.authority, EXACT_KEYS.authority);
  rejectUnknownKeys(errors, 'actions', policy?.actions, EXACT_KEYS.actions);
  rejectUnknownKeys(errors, 'artifacts', policy?.artifacts, EXACT_KEYS.artifacts);
  if (policy?.schemaVersion !== 1) errors.push('schemaVersion must equal 1');
  if (policy?.status !== 'disconnected') errors.push('status must remain disconnected');
  if (policy?.scope?.wildcardsAllowed !== false) errors.push('wildcard scope must be disabled');
  if (policy?.scope?.publicSharingAllowed !== false) errors.push('public sharing must be disabled');
  for (const field of ['workspaceIds', 'fileIds']) {
    const values = policy?.scope?.[field];
    if (!Array.isArray(values)) {
      errors.push(`${field} must be an array`);
    } else if (values.length !== 0) {
      errors.push(`${field} must remain empty while disconnected`);
    }
  }
  for (const action of DENIED_ACTIONS) {
    if (policy?.actions?.[action] !== 'deny') errors.push(`${action} must remain deny`);
  }
  for (const [action, expected] of Object.entries(ASK_ACTIONS)) {
    if (policy?.actions?.[action] !== expected) errors.push(`${action} must equal ${expected}`);
  }
  for (const [field, expected] of Object.entries(AUTHORITY)) {
    if (policy?.authority?.[field] !== expected) errors.push(`${field} must equal ${expected}`);
  }
  if (policy?.artifacts?.authStateInRepository !== false) {
    errors.push('Figma Auth state must be forbidden from the repository');
  }
  if (policy?.artifacts?.customerDataAllowed !== false) {
    errors.push('customer data must remain forbidden');
  }
  if (policy?.artifacts?.baselineRequiresReleaseSha !== true) {
    errors.push('baselines must require a release SHA');
  }
  if (policy?.artifacts?.baselineRequiresManifest !== true) {
    errors.push('baselines must require a manifest');
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
