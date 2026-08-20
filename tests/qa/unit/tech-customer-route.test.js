/**
 * ════════════════════════════════════════════════
 * FILE: tech-customer-route.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks the wiring around the field customer screen: that it has a real
 *   address in the app (not just an entry in a list of pages), that the iOS build
 *   is allowed to carry it, that every screen pointing at a customer points at
 *   THIS one rather than the office page, and that nothing on it can touch a
 *   customer's texting permission.
 *
 * WHY THIS EXISTS:
 *   Two traps this repository has already paid for. A page in the native
 *   registry with no route bounces silently to /tech with a green build (Lead
 *   Center, 2026-08-08). And a page reached only through the office path ejects
 *   a technician out of the field shell — which is exactly the recorded dead end
 *   this screen fixes.
 *
 * NOTES / GOTCHAS:
 *   - Source-contract test (credential-free lane). It proves the wiring, not the
 *     rendering; the render contract is TechCustomerPage.render.test.jsx and the
 *     on-device check is an owner gate.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const CUSTOMER_MODULES = [
  'src/pages/tech/v2/customer/AdditionalContactsSection.jsx',
  'src/pages/tech/v2/customer/CustomerInfoSection.jsx',
  'src/pages/tech/v2/customer/InsuranceSection.jsx',
  'src/pages/tech/v2/customer/TechCustomerPage.jsx',
  'src/pages/tech/v2/customer/customer-page.css',
  'src/pages/tech/v2/customer/customerHelpers.js',
];

describe('Tech customer screen — route and registry wiring', () => {
  it('has a real route, in the SHARED tech routes so native gets it too', () => {
    // A registry entry without a route silently bounces to /tech with a green
    // build. The route must sit inside TechRoutes(), which both build trees
    // render — not in a web-only block.
    const app = read('src/App.jsx');
    const line = app.split('\n').find((l) => l.includes('path="tech/customer/:contactId"'));
    expect(line, 'the field customer route must exist').toBeTruthy();
    expect(line).toContain('TechCustomerPage');

    const techRoutesStart = app.indexOf('function TechRoutes()');
    const routeAt = app.indexOf('path="tech/customer/:contactId"');
    expect(techRoutesStart).toBeGreaterThan(-1);
    expect(routeAt).toBeGreaterThan(techRoutesStart);
  });

  it('is registered in BOTH build-target page registries', () => {
    for (const registry of [
      'src/routes/buildTargetPages.web.jsx',
      'src/routes/buildTargetPages.native.jsx',
    ]) {
      const source = read(registry);
      expect(source, registry).toContain("import('@/pages/tech/v2/customer/TechCustomerPage')");
      expect(source, registry).toContain('  TechCustomerPage,');
    }
  });

  it('every module — stylesheet included — is in the sorted native allowlist', async () => {
    const { NATIVE_PAGE_ALLOWLIST } = await import('../../../scripts/native-bundle-boundary.mjs');
    for (const module of CUSTOMER_MODULES) {
      expect(NATIVE_PAGE_ALLOWLIST, module).toContain(module);
    }
    // The array is asserted to equal its own sort elsewhere; re-checking here
    // keeps the failure next to the entries that caused it.
    expect([...NATIVE_PAGE_ALLOWLIST]).toEqual([...NATIVE_PAGE_ALLOWLIST].sort());
  });

  it('routes through customerHref, never a hardcoded customer path', () => {
    const nav = read('src/components/tech/v2/nav.js');
    expect(nav).toContain('export function customerHref(');
    expect(read('src/components/tech/v2/index.js')).toContain('customerHref');

    // TechNewCustomer's post-save was a recorded live dead end: it navigated to
    // the office /customers/:id, which on native hits the catch-all and dumps
    // the tech on /tech.
    const newCustomer = read('src/pages/tech/TechNewCustomer.jsx');
    expect(newCustomer).toContain('customerHref(result[0].id)');
    expect(newCustomer).toContain('customerHref(existing[0].id)');
    expect(newCustomer).not.toMatch(/`\/customers\/\$\{/);
  });

  it('maps the office customer path into the field shell', () => {
    const shellRoutes = read('src/lib/techShellRoutes.js');
    expect(shellRoutes).toContain('if (customer) return customerHref(customer[1]);');

    // …and the office route itself is wrapped, so a field tech who reaches it
    // by a saved link is redirected rather than ejected from the shell.
    const app = read('src/App.jsx');
    const at = app.indexOf('path="customers/:contactId"');
    expect(at).toBeGreaterThan(-1);
    expect(app.slice(at, at + 260)).toContain('TechShellRedirect');
  });

  it('needs no migration — it writes only already-granted tables', () => {
    // Every write below rides a policy that already grants `authenticated`:
    // contacts (contacts_authenticated_update/insert), the jobs insurance
    // columns, and contact_jobs (whose `anon_`-prefixed policy NAMES are a
    // rename vestige — the roles are authenticated). Nothing here may reach for
    // a table or RPC outside that set.
    const page = read('src/pages/tech/v2/customer/TechCustomerPage.jsx');
    const contacts = read('src/pages/tech/v2/customer/AdditionalContactsSection.jsx');
    const written = [
      ...page.matchAll(/db\.(update|insert|delete)\('([a-z_]+)'/g),
      ...contacts.matchAll(/db\.(update|insert|delete)\('([a-z_]+)'/g),
    ].map((m) => m[2]);
    expect([...new Set(written)].sort()).toEqual(['contact_jobs', 'contacts', 'jobs']);
  });

  it('can never write a consent column', () => {
    // AGENTS.md §14 — TCPA penalties are per message. Phone and email are
    // editable here; permission to be texted is not, and is changed only by the
    // customer, the attestation flow, or the provider webhook.
    const helpers = read('src/pages/tech/v2/customer/customerHelpers.js');
    for (const column of ['opt_in_status', 'opt_out_at', 'dnd']) {
      expect(helpers).toContain(`'${column}'`); // named in CONSENT_COLUMNS…
    }
    for (const file of CUSTOMER_MODULES.filter((f) => !f.endsWith('customerHelpers.js') && !f.endsWith('.css'))) {
      const source = read(file);
      // …and never assigned anywhere else on the surface.
      expect(source, file).not.toMatch(/opt_in_status\s*:/);
      expect(source, file).not.toMatch(/opt_out_at\s*:/);
      expect(source, file).not.toMatch(/\bdnd\s*:/);
    }
  });

  it('never hands a text off to the phone, so Message stays in-app', () => {
    // An OS text link sends from the technician's personal number: no UPR
    // thread, nothing in the CRM, and it never touches the consent chokepoint.
    // This directory is inside the field-surface invariant walk too; asserted
    // here as well because that walk's reach has been wrong before. Same
    // quote-then-scheme matcher that walk uses, so prose about the rule does
    // not read as a violation of it.
    for (const file of CUSTOMER_MODULES.filter((f) => !f.endsWith('.css'))) {
      expect(read(file), file).not.toMatch(/['"`]sms:/);
    }
    expect(read('src/pages/tech/v2/customer/CustomerInfoSection.jsx')).toContain('openInAppThread');
  });

  it('gives the tel:/mailto: value rows a real hit area', () => {
    // tech-mobile-ux.md: "Hit areas <24px are banned regardless of visual
    // size." A bare inline <a> in a 44px row is only as tall as its line box —
    // MEASURED at 21px on a real screen during the 2026-08-15 Mac
    // verification, which is what a static check could not have told us. The
    // link must carry its own height, not inherit the row's.
    const css = read('src/pages/tech/v2/customer/customer-page.css');
    const rule = css.slice(
      css.indexOf('.tv2-cust-row__v.is-link'),
      css.indexOf('}', css.indexOf('.tv2-cust-row__v.is-link')),
    );
    expect(rule).toMatch(/min-height:\s*44px/);
    expect(rule).toMatch(/display:\s*inline-flex/);
  });

  it('registers the customer namespace in all three locales', () => {
    // The parity suite statically imports all three barrels and fails if any
    // language misses a namespace.
    expect(read('src/i18n/index.js')).toContain("'customer'");
    for (const lang of ['en', 'es', 'pt']) {
      const barrel = read(`src/i18n/locales/${lang}/index.js`);
      expect(barrel, lang).toContain("import customer from './customer.json'");
      // Position-independent: the original `'customer };'` only passed while
      // customer happened to be the last namespace, so adding any namespace
      // after it failed a test that was never about ordering.
      expect(barrel, lang).toMatch(/export default \{[^}]*\bcustomer\b[^}]*\}/);
    }
  });

  it('amends the frozen cache registry rather than inventing keys inline', () => {
    const techQuery = read('src/lib/techQuery.js');
    expect(techQuery).toContain("CUSTOMER: 'customer'");
    expect(techQuery).toContain('customer: (contactId) =>');
    // A contact edit must repaint an open Hub: its hero title and contacts list
    // both come out of get_job_hub.
    expect(techQuery).toContain('contact: [K.CUSTOMER, K.HUB]');
  });
});
