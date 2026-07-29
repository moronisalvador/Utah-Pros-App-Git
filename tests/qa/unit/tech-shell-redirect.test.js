/**
 * ════════════════════════════════════════════════
 * FILE: tech-shell-redirect.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Guards the WIRING that keeps a field technician on field screens: which office
 *   routes are wrapped, and that only field techs are redirected. The mapping itself
 *   (which office page becomes which field page) is behaviour, and is tested for real
 *   in src/lib/techShellRoutes.test.js — this file only proves the router is hooked up.
 *
 *   It reads App.jsx as text rather than rendering it: App.jsx is the router for the
 *   whole application and pulls in dozens of lazy routes, so a render test would be
 *   far more fragile than the thing it protects. Same approach as the sibling
 *   contract tests in this folder.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/App.jsx (read as source)
 *
 * NOTES / GOTCHAS:
 *   - This proves INTENT, not runtime behaviour. The behavioural check is a real
 *     field_tech session landing on /conversations and ending up at
 *     /tech/conversations, which was done by hand on 2026-07-27.
 * ════════════════════════════════════════════════
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const source = readFileSync(join(ROOT, 'src/App.jsx'), 'utf8').replace(/\r\n/g, '\n');
const redirectBlock = source.slice(source.indexOf('function TechShellRedirect'));
const redirectBody = redirectBlock.slice(0, redirectBlock.indexOf('\n}'));

describe('the office appointment destination exists', () => {
  // Without this route, notify.js had nowhere to point an appointment notification
  // except /tech/appointment/:id, so desktop dispatchers landed in the phone UI —
  // and ClaimPage's existing /schedule/appointment/:id link just 404'd.
  it('routes /schedule/appointment/:apptId', () => {
    expect(source).toContain('path="schedule/appointment/:apptId"');
  });

  it('wraps it in TechShellRedirect so field techs still get the field screen', () => {
    const idx = source.indexOf('path="schedule/appointment/:apptId"');
    expect(source.slice(idx, idx + 260)).toContain('<TechShellRedirect>');
  });

  it('has the BELL link store the office path, not the field one', () => {
    const notify = readFileSync(join(ROOT, 'functions/api/notify.js'), 'utf8');
    // The stored `link` is what the in-app bell opens, and it is translated per
    // reader by linkForCurrentShell. It must stay the office path so a desktop
    // dispatcher is not dropped into the phone UI.
    expect(notify).toMatch(/link:\s*body\.link\s*\|\|\s*`\/schedule\/appointment\/\$\{body\.appointment_id\}`/);
  });

  // Amended by PUSH-01. This assertion previously forbade the field path
  // ANYWHERE in notify.js, which was too broad: Web Push never runs
  // linkForCurrentShell — the service worker validates the raw URL against its
  // own allowlist — so a bell-only office path left every tapped appointment
  // push normalizing to the '/tech' fallback. The contract is now explicitly
  // two-sided, and each side is pinned separately rather than by absence.
  it('has the PUSH destination carry the field path via data.url', () => {
    const notify = readFileSync(join(ROOT, 'functions/api/notify.js'), 'utf8');
    expect(notify).toMatch(/url:\s*body\.data\?\.url\s*\|\|\s*`\/tech\/appointment\/\$\{body\.appointment_id\}`/);
    // Still forbidden: the field path standing in for the bell link.
    expect(notify).not.toMatch(/link:\s*body\.link\s*\|\|\s*`\/tech\/appointment/);
  });
});

describe('field techs are redirected out of office routes', () => {
  it('only redirects field_tech, so office roles keep their pages', () => {
    expect(redirectBody).toContain("employee?.role === 'field_tech'");
    // Trapping admin/office/supervisor/PM in the field shell would be a worse bug
    // than the one being fixed.
    for (const role of ['admin', 'office', 'supervisor', 'project_manager']) {
      expect(redirectBody).not.toContain(`'${role}'`);
    }
  });

  it('preserves the query string, because message links carry ?c=<conversationId>', () => {
    expect(redirectBody).toContain('location.search');
  });

  it('replaces rather than pushes, so Back does not bounce', () => {
    expect(redirectBody).toContain('replace');
  });

  it('uses the shared mapping instead of its own copy', () => {
    // One source of truth, shared with NotificationBell — otherwise the router and
    // the bell can disagree about where a notification should land.
    expect(source).toContain("import { officeToTechPath } from '@/lib/techShellRoutes'");
    expect(redirectBody).toContain('officeToTechPath(location.pathname)');
  });

  it('passes through untouched when there is no field equivalent', () => {
    // officeToTechPath returns null for e.g. /devtools; that must render the page,
    // not redirect to "null".
    expect(redirectBody).toMatch(/if \(techPath\)/);
  });

  it('wraps the office routes a notification can point at', () => {
    // conversations (bell messages), jobs/:jobId (job notifications), claims/:claimId,
    // schedule. Counted rather than matched per-route so the wrappers stay uniform.
    const wrappers = source.match(/<TechShellRedirect>/g) || [];
    expect(wrappers.length).toBeGreaterThanOrEqual(4);
  });

  it('leaves list routes alone, so techs are not bounced off /claims or /jobs indexes', () => {
    // The index routes are rendered directly, never wrapped.
    expect(source).toMatch(/<Route index element=\{<ErrorBoundary section="Claims">/);
    expect(source).toMatch(/<Route index element=\{<ErrorBoundary section="Jobs">/);
  });
});
