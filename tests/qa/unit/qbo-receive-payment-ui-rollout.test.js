/**
 * Static source contract for the grouped QBO receive-payment UI exposure.
 *
 * Since 2026-08-06 the feature is LIVE (role-check repair applied, worker gates
 * widened to the billing roles) and the build-time VITE deployment gate was
 * retired — it was an env-drift trap (a per-variable-set Cloudflare value that
 * silently diverged from database/worker reality). What this suite now pins:
 * every exposure point gates on the BILLING roles plus the runtime
 * feature:qbo_receive_payment flag (the kill switch), never admin-only and
 * never a build-time env var. Worker money and authorization gates retain
 * their own focused suites; billing-role-surface-parity.test.js keeps the JS
 * role list and the database predicate from drifting apart.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

describe('QBO receive-payment UI exposure', () => {
  it('retired the build-time deployment gate everywhere', () => {
    for (const path of [
      'src/App.jsx',
      'src/pages/Collections.jsx',
      'src/pages/InvoiceEditor.jsx',
      'src/components/NewMenu.jsx',
      'src/components/Layout.jsx',
    ]) {
      const source = read(path);
      expect(source, `${path} must not read the retired VITE gate`).not.toContain(
        'QBO_RECEIVE_PAYMENT_UI_ENABLED',
      );
      expect(source, `${path} must not import the retired rollout helper`).not.toContain(
        'qboReceivePaymentRollout',
      );
    }
  });

  it('routes /collections/receive-payment behind the billing roles and the runtime flag', () => {
    const app = read('src/App.jsx');
    expect(app).toMatch(
      /collections\/receive-payment[\s\S]{0,200}RoleRoute roles=\{BILLING_EDIT_ROLES\}[\s\S]{0,200}FeatureRoute flag="feature:qbo_receive_payment"/,
    );
    expect(app).toContain("import { BILLING_EDIT_ROLES } from '@/lib/claimUtils'");
  });

  it('gates every in-page exposure on canEditBilling plus the runtime flag', () => {
    const collections = read('src/pages/Collections.jsx');
    expect(collections).toMatch(
      /receivePaymentOn = canEdit\s*&&\s*isFeatureEnabled\('feature:qbo_receive_payment'\)/,
    );

    const invoice = read('src/pages/InvoiceEditor.jsx');
    expect(invoice).toMatch(
      /canEdit && balance > 0\.005[\s\S]{0,400}isFeatureEnabled\('feature:qbo_receive_payment'\)/,
    );
  });

  it('offers New Payment only to billing roles, in lockstep with the flag', () => {
    const menu = read('src/components/NewMenu.jsx');
    expect(menu).toMatch(
      /key: 'payment'[\s\S]{0,200}flag: 'feature:qbo_receive_payment'[\s\S]{0,40}billing: true/,
    );
    const layout = read('src/components/Layout.jsx');
    expect(layout).toMatch(
      /key === 'payment'[\s\S]{0,80}navigate\('\/collections\/receive-payment'\)/,
    );
  });

  it('admits exactly the bounded receive-payment page to the native registry', () => {
    // Owner-directed 2026-08-06 (same pattern as the native OOP estimate
    // review): the ONE grouped receive-payment page ships in the iOS bundle,
    // role- and flag-gated at its route. Broad office/collections surfaces
    // still have no import path from the registry file itself.
    const nativePages = read('src/routes/buildTargetPages.native.jsx');
    expect(nativePages).toMatch(/const ReceivePayment = lazyRetry\(\(\) => import\('@\/pages\/ReceivePayment'\)\)/);
    expect(nativePages).not.toContain('components/collections');
    expect(nativePages).not.toContain('Collections');
    expect(nativePages).not.toContain('InvoiceEditor');

    const app = read('src/App.jsx');
    expect(app).toMatch(
      /\{IS_NATIVE && \([\s\S]{0,400}collections\/receive-payment[\s\S]{0,200}RoleRoute roles=\{BILLING_EDIT_ROLES\}[\s\S]{0,200}FeatureRoute flag="feature:qbo_receive_payment"/,
    );

    const more = read('src/pages/tech/TechMore.jsx');
    expect(more).toMatch(
      /canEditBilling\(employee\?\.role\) && isFeatureEnabled\('feature:qbo_receive_payment'\)[\s\S]{0,300}\/collections\/receive-payment/,
    );

    // The Dash "+" FAB pill carries the identical gate: techs never see it.
    const fab = read('src/pages/tech/v2/dash/CreateFAB.jsx');
    expect(fab).toMatch(
      /canEditBilling\(employee\?\.role\)\s*&& isFeatureEnabled\('feature:qbo_receive_payment'\)/,
    );
    expect(fab).toMatch(
      /showPayment && \([\s\S]{0,300}\/collections\/receive-payment/,
    );
  });

  it('keeps the customer picker searchable — never a bare dropdown', () => {
    // Owner report 2026-08-06: a plain <select> over the full customer roster
    // is unusable. The picker must stay a type-to-filter combobox.
    const form = read('src/components/collections/ReceivePaymentForm.jsx');
    expect(form).toMatch(/role="combobox"/);
    expect(form).toMatch(/role="listbox"/);
    expect(form).not.toMatch(/<select[^>]*>[^<]*<option value="">Choose customer/);
  });

  it('gives phones the step wizard, not the desktop form', () => {
    // Owner verdict 2026-08-06: the desktop form on a phone is the wrong
    // direction — the truck scene gets a POS-style one-decision-per-screen
    // flow. Native builds and narrow web viewports must route to it.
    const page = read('src/pages/ReceivePayment.jsx');
    expect(page).toMatch(/ReceivePaymentMobileFlow/);
    expect(page).toMatch(/IS_NATIVE_BUILD \|\| !!narrowQuery\?\.matches/);
    expect(page).toMatch(/if \(mobileFlow\) \{\s*return <ReceivePaymentMobileFlow/);
    const flow = read('src/components/collections/ReceivePaymentMobileFlow.jsx');
    // Professional register pinned (owner-directed 2026-08-06): titles are
    // nouns, never conversational questions.
    expect(flow).toMatch(
      /customer: 'Customer',\s*invoices: 'Invoices',\s*method: 'Payment method',\s*confirm: 'Confirm payment',/,
    );
  });
});
