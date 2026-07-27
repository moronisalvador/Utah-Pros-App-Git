/**
 * ════════════════════════════════════════════════
 * FILE: native-account-legal-access.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Guards the source wiring that makes account deletion and legal/support pages
 *   discoverable from the field app without duplicating the desktop deletion flow.
 *
 * DEPENDS ON:
 *   Packages:  node, vitest
 *   Internal:  AccountDeletionPanel.jsx, MyAccount.jsx, TechSettings.jsx, Login.jsx
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - Native route declarations are checked by the native bundle boundary lane;
 *     this test owns only the links and shared component integration.
 * ════════════════════════════════════════════════
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../../..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const panel = read('src/components/settings/AccountDeletionPanel.jsx');
const myAccount = read('src/pages/settings/MyAccount.jsx');
const techSettings = read('src/pages/tech/TechSettings.jsx');
const login = read('src/pages/Login.jsx');

describe('shared account-deletion access', () => {
  it('keeps one authenticated two-click RPC flow for desktop and field Settings', () => {
    expect(panel).toMatch(
      /const \{ db, employee, pwaOwnerLease \} = useAuth\(\)/,
    );
    expect(panel).toContain("pwaOwnerLease?.epoch || 'no-lease'");
    expect(panel).toContain('requestedAccountKey !== accountKeyRef.current');
    expect(panel).toContain("db.rpc('get_my_account_deletion_request')");
    expect(panel).toContain("db.rpc('request_account_deletion', { p_notes: null })");
    expect(panel).toMatch(/Array\.isArray\(row\).+row\[0\]/);
    expect(panel).toMatch(/request && request\.id \? request : null/);
    expect(panel).toContain('useTwoClickConfirm()');
    expect(panel).toContain('onBlur={cancel}');

    expect(myAccount).toContain("from '@/components/settings/AccountDeletionPanel'");
    expect(myAccount).toContain('<AccountDeletionPanel />');
    expect(myAccount).not.toMatch(/function DeleteAccountPanel/);

    expect(techSettings).toContain("from '@/components/settings/AccountDeletionPanel'");
    expect(techSettings).toContain('<AccountDeletionPanel variant="tech" />');
  });

  it('does not add a browser dialog escape hatch', () => {
    for (const source of [panel, myAccount, techSettings, login]) {
      expect(source).not.toMatch(/\b(?:alert|confirm|prompt)\s*\(/);
    }
  });
});

describe('legal and support discovery', () => {
  // Both surfaces must expose all three destinations — that requirement is
  // unchanged. What differs is WHICH copy each one links, and that is the point:
  // Login runs pre-auth where no shell exists, so it links the bare public pages.
  // Field Settings runs inside the PWA/Capacitor container, which has no browser
  // back button — linking the bare pages there rendered a page with no nav and
  // stranded the tech until they force-quit. It links the /tech/legal/* copies,
  // same components inside the field shell.
  it('links all three public destinations before login', () => {
    expect(login).toContain("['/privacy', 'Privacy']");
    expect(login).toContain("['/terms', 'Terms']");
    expect(login).toContain("['/support', 'Support']");
    expect(login).toContain('aria-label="Legal and support"');
  });

  it('links all three from field Settings, inside the field shell', () => {
    expect(techSettings).toContain("['/tech/legal/privacy', 'Privacy']");
    expect(techSettings).toContain("['/tech/legal/terms', 'Terms']");
    expect(techSettings).toContain("['/tech/legal/support', 'Support']");
    expect(techSettings).toContain('aria-label="Legal and support"');
  });

  it('never sends the field app to a shell-less legal page', () => {
    // The regression this replaced: tapping Privacy in field Settings left the
    // tech shell entirely. Anchoring on the array-entry form keeps this honest
    // without matching the /tech/legal/* paths above.
    expect(techSettings).not.toContain("['/privacy',");
    expect(techSettings).not.toContain("['/terms',");
    expect(techSettings).not.toContain("['/support',");
  });
});
