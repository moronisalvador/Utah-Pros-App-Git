/**
 * ════════════════════════════════════════════════
 * FILE: artifact-scan.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks retained QA files for credentials, browser sessions, production identifiers, and likely
 *   personal contact data. It reports only rule names and file paths, never the matched content.
 *
 * DEPENDS ON:
 *   Packages:  Node.js built-ins only
 *   Internal:  tests/qa/lib/target-policy.mjs
 *   Data:      reads  → QA artifact folders selected by the caller
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This is defense in depth; the browser config also avoids retaining sensitive artifact types.
 *   - Binary files are checked for text markers but their contents are never printed.
 * ════════════════════════════════════════════════
 */

import fs from 'node:fs';
import path from 'node:path';

import { PRODUCTION_PROJECT_REF } from './target-policy.mjs';

const RULES = [
  ['authorization-header', /authorization["':\s]+bearer\s+(?!\$\{|<|example|placeholder)[^\s"',]{12,}/i],
  ['auth-token-field', /"(?:access_token|refresh_token|id_token)"\s*:\s*"(?!example|placeholder)[^"]{8,}"/i],
  ['browser-storage-state', /"(?:cookies|origins)"\s*:\s*\[/i],
  ['cookie-header', /(?:^|\r?\n)(?:set-)?cookie\s*:/i],
  ['production-project-ref', new RegExp(PRODUCTION_PROJECT_REF, 'i')],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['likely-email', /\b(?!qa_[a-z]+@example\.test\b)[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i],
  ['likely-phone', /(?:^|[^\d])\+1[2-9]\d{9}(?:[^\d]|$)/],
];

function walkFiles(root) {
  if (!fs.existsSync(root)) return [];
  const results = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new Error(`Artifact scan refused symbolic link: ${current}`);
    }
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(current)) stack.push(path.join(current, entry));
    } else if (stat.isFile()) {
      results.push(current);
    }
  }
  return results;
}

export function scanArtifactRoots(roots) {
  const findings = [];
  for (const root of roots) {
    const resolvedRoot = path.resolve(root);
    for (const file of walkFiles(resolvedRoot)) {
      const raw = fs.readFileSync(file);
      const text = raw.toString('utf8');
      for (const [rule, pattern] of RULES) {
        if (pattern.test(text)) {
          findings.push({
            rule,
            file: path.relative(resolvedRoot, file).replaceAll('\\', '/') || path.basename(file),
          });
        }
      }
    }
  }
  return findings;
}

export function assertArtifactsSafe(roots) {
  const findings = scanArtifactRoots(roots);
  if (findings.length) {
    const summary = findings.map(({ rule, file }) => `${rule}:${file}`).join(', ');
    throw new Error(`QA artifact scan failed: ${summary}`);
  }
  return { roots: roots.length, findings: 0 };
}
