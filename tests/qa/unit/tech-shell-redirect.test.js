/**
 * ════════════════════════════════════════════════
 * FILE: tech-shell-redirect.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Guards the rule that a field technician following a notification ends up on a
 *   field screen, not the office website. The bell used to send techs to
 *   `/conversations` (the office inbox) while the same event delivered by push went
 *   to `/tech/conversations`, and job notifications pointed at the office job page.
 *
 *   This reads App.jsx as text rather than rendering it: App.jsx is the router for
 *   the whole application and pulls in dozens of lazy routes, so a render test
 *   would be far more fragile than the thing it protects. Same approach as the
 *   other contract tests in this folder.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/App.jsx (read as source)
 *
 * NOTES / GOTCHAS:
 *   - This proves INTENT (the wiring is present), not runtime behaviour. The
 *     behavioural check is a real field_tech session landing on /conversations and
 *     ending up at /tech/conversations.
 * ════════════════════════════════════════════════
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const source = readFileSync(join(ROOT, 'src/App.jsx'), 'utf8').replace(/\r\n/g, '\n');

describe('field techs are redirected out of office routes', () => {
  it('only redirects field_tech, so office roles keep their pages', () => {
    const block = source.slice(source.indexOf('function TechShellRedirect'));
    expect(block).toContain("employee?.role === 'field_tech'");
    // Trapping admin/office/supervisor/PM in the tech shell would be a worse bug
    // than the one being fixed.
    for (const role of ['admin', 'office', 'supervisor', 'project_manager']) {
      expect(block.slice(0, block.indexOf('}'))).not.toContain(`'${role}'`);
    }
  });

  it('preserves the query string, because message links carry ?c=<conversationId>', () => {
    const block = source.slice(source.indexOf('function TechShellRedirect'));
    expect(block).toContain('location.search');
  });

  it('replaces rather than pushes, so Back does not bounce', () => {
    const block = source.slice(source.indexOf('function TechShellRedirect'));
    expect(block).toContain('replace');
  });

  it('wraps the office conversations route (the bell message target)', () => {
    expect(source).toMatch(
      /<TechShellRedirect resolve=\{\(\) => '\/tech\/conversations'\}>/,
    );
  });

  it('wraps the office job route (the job notification target)', () => {
    expect(source).toMatch(/<TechShellRedirect resolve=\{\(p\) => jobHref\(p\.jobId\)\}>/);
  });

  it('routes jobs through jobHref, never a hardcoded tech job path', () => {
    // The tech-v2 manifest forbids hardcoding /tech/jobs/ so the Job Hub cutover
    // stays a one-constant flip.
    const jobRedirect = source.match(/<TechShellRedirect resolve=\{\(p\) => [^}]+\}>/g) || [];
    const jobLine = jobRedirect.find((line) => line.includes('jobId'));
    expect(jobLine).toBeTruthy();
    expect(jobLine).not.toContain('/tech/jobs/');
    expect(source).toContain("import { jobHref } from '@/components/tech/v2/nav'");
  });

  it('wraps the office claim route', () => {
    expect(source).toContain('resolve={(p) => `/tech/claims/${p.claimId}`}');
  });

  it('wraps the office schedule route', () => {
    expect(source).toMatch(/<TechShellRedirect resolve=\{\(\) => '\/tech\/schedule'\}>/);
  });

  it('leaves list routes alone, so techs are not bounced off /claims or /jobs indexes', () => {
    // Only the DETAIL routes have field equivalents. Redirecting the index routes
    // would strand a tech who legitimately opened a list.
    const wrapped = source.match(/<TechShellRedirect[\s\S]{0,120}?>/g) || [];
    expect(wrapped.some((w) => w.includes("'/tech/claims'"))).toBe(false);
    expect(wrapped.some((w) => w.includes("'/tech/jobs'"))).toBe(false);
  });
});
