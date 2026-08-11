/**
 * ════════════════════════════════════════════════
 * FILE: qbo-production-maintenance-gates.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Keeps the QBO maintenance brake and P4c document-command capability
 *   boundary present across Pages, the standalone MCP, and both admin-mobile
 *   route graphs. It reads committed source only; it never contacts a provider
 *   or database.
 *
 * DEPENDS ON:
 *   Packages:  node:fs/promises, vitest
 *   Internal:  Pages QBO helpers/routes, UPR MCP QBO helper, auth/route gates
 *   Data:      reads → repository source only
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This guards source intent and placement. Runtime gate behavior belongs in
 *     the focused worker and MCP tests.
 * ════════════════════════════════════════════════
 */
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const read = (path) => readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
const files = await Promise.all([
  read('functions/lib/qbo-provider-traffic.js'),
  read('functions/lib/quickbooks.js'),
  read('functions/api/qbo-document-command-gate.js'),
  read('functions/api/qbo-invoice.js'),
  read('functions/api/qbo-estimate.js'),
  read('upr-mcp/src/qbo.js'),
  read('src/contexts/AuthContext.jsx'),
  read('src/pages/tech/admin/AdminMobileRoutes.jsx'),
  read('src/App.jsx'),
]);
const [traffic, quickbooks, documentGate, invoice, estimate, mcpQbo, authContext, webRoutes, appRoutes] = files;

function section(source, start, end) {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt + start.length);
  expect(startAt, `missing source section starting ${start}`).toBeGreaterThanOrEqual(0);
  expect(endAt, `missing source section ending ${end}`).toBeGreaterThan(startAt);
  return source.slice(startAt, endAt);
}

function routeSection(source, path) {
  return section(source, `<Route path="${path}"`, '<Route path=');
}

function expectOrdered(source, ...needles) {
  let previous = -1;
  for (const needle of needles) {
    const next = source.indexOf(needle, previous + 1);
    expect(next, `missing or out-of-order ${needle}`).toBeGreaterThan(previous);
    previous = next;
  }
}

describe('QBO production maintenance and document-command gates', () => {
  it('makes the Pages provider brake bounded, exact-value-only, and safely typed', () => {
    expect(traffic).toContain("QBO_PROVIDER_TRAFFIC_CONFIG_KEY = 'qbo_provider_traffic_enabled'");
    expect(traffic).toContain("QBO_PROVIDER_TRAFFIC_DISABLED_CODE = 'qbo_provider_traffic_disabled'");
    expect(traffic).toMatch(/QBO_PROVIDER_TRAFFIC_LOOKUP_TIMEOUT_MS\s*=\s*1_500/);
    expect(traffic).toMatch(/Promise\.race\(\[Promise\.resolve\(promise\), timeout\]\)/);
    expect(traffic).toMatch(/db\.select\([\s\S]*'integration_config'[\s\S]*key=eq\.\$\{QBO_PROVIDER_TRAFFIC_CONFIG_KEY\}&select=value&limit=1/);
    expect(traffic).toMatch(/!Array\.isArray\(rows\) \|\| rows\.length !== 1 \|\| rows\[0\]\?\.value !== 'true'/);
    expect(traffic).toMatch(/error\.code = QBO_PROVIDER_TRAFFIC_DISABLED_CODE[\s\S]*error\.reason = QBO_PROVIDER_TRAFFIC_DISABLED_CODE[\s\S]*error\.status = 503/);
  });

  it('places fresh Pages decisions before OAuth, CAS/credential writes, Accounting, Payments, and multipart upload', () => {
    const token = section(quickbooks, 'async function postToken', 'export function exchangeCodeForTokens');
    expectOrdered(token, 'await requireQboProviderTraffic(env);', 'fetchWithTimeout(TOKEN_URL');

    for (const [start, end, write] of [
      ['export async function replaceQboConnection', 'async function refreshQboConnectionCas', "db.rpc('replace_qbo_connection'"],
      ['async function refreshQboConnectionCas', 'export async function saveTokens', "db.rpc('refresh_qbo_connection_cas'"],
      ['export async function saveTokens', '// Returns a valid access token', 'db.upsert'],
    ]) {
      const writer = section(quickbooks, start, end);
      expectOrdered(writer, 'await requireQboProviderTraffic(env);', write);
    }

    const accounting = section(quickbooks, 'export async function qboFetch', '// ── QuickBooks PAYMENTS API');
    expectOrdered(accounting,
      'await requireQboProviderTraffic(env);',
      'await getValidAccessToken(env, { expectedRealmId })',
      'await requireQboProviderTraffic(env);',
      'return fetchWithTimeout(url',
    );
    const payments = section(quickbooks, 'export async function paymentsFetch', '// Charge a tokenized card');
    expectOrdered(payments,
      'await requireQboProviderTraffic(env);',
      'await getValidAccessToken(env)',
      'await requireQboProviderTraffic(env);',
      'return fetchWithTimeout(url',
    );
    const upload = section(quickbooks, 'export async function uploadAttachable', 'export async function getAttachable');
    expectOrdered(upload,
      'await requireQboProviderTraffic(env);',
      'await getValidAccessToken(env)',
      'await requireQboProviderTraffic(env);',
      'fetchWithTimeout(`${apiBase(environment)}/v3/company/${realmId}/upload',
    );
  });

  it('keeps MCP traffic exact-true and fresh around refresh, CAS persistence, and each provider request', () => {
    expect(mcpQbo).toContain("QBO_PROVIDER_TRAFFIC_KEY = 'qbo_provider_traffic_enabled'");
    expect(mcpQbo).toMatch(/row\.value !== 'true'/);
    expect(mcpQbo).toMatch(/Array\.isArray\(rows\) && rows\.length === 1/);
    expect(mcpQbo).toMatch(/error\.code = 'qbo_provider_traffic_disabled'[\s\S]*error\.status = 503/);
    expect(mcpQbo).toMatch(/supabase\(env, fetchWithTimeout\)\.select\(/);
    expect(mcpQbo).toMatch(/AbortSignal\.timeout\(QBO_TIMEOUT_MS\)/);
    expect(mcpQbo).not.toMatch(/qbo_provider_traffic_enabled[\s\S]{0,300}toLowerCase/);

    const refresh = section(mcpQbo, 'async function getValidAccessToken', '// Low-level QBO fetch');
    expectOrdered(refresh,
      'await assertQboProviderTrafficEnabled(env);',
      'const tokens = await refreshTokens',
      'conn = await refreshConnectionCas',
    );
    const cas = section(mcpQbo, 'async function refreshConnectionCas', 'async function getValidAccessToken');
    expectOrdered(cas, 'await assertQboProviderTrafficEnabled(env);', "db.rpc('refresh_qbo_connection_cas'");
    const provider = section(mcpQbo, 'async function qboFetch', 'async function asError');
    expectOrdered(provider,
      'await assertQboProviderTrafficEnabled(env);',
      'await getValidAccessToken(env)',
      'await assertQboProviderTrafficEnabled(env);',
      'return fetchWithTimeout(url',
    );
  });

  it('uses one strict, no-preview document-command capability predicate', () => {
    expect(documentGate).toContain("QBO_DOCUMENT_COMMAND_V2_FLAG = 'feature:qbo_document_command_v2'");
    expect(documentGate).toContain('return row?.enabled === true && row?.force_disabled !== true;');
    expect(documentGate).toMatch(/Array\.isArray\(rows\) && rows\.length === 1 && isQboDocumentCommandV2Enabled\(rows\[0\]\)/);
    expect(documentGate).not.toContain('dev_only');
    expect(authContext).toMatch(/export function resolveStrictFeatureFlagAccess\(key, featureFlags\) \{[\s\S]*flag\?\.enabled === true && flag\?\.force_disabled !== true/);
    expect(authContext).toMatch(/FAIL_CLOSED_FEATURE_FLAGS = new Set\([\s\S]*'feature:qbo_document_command_v2'/);
  });

  it('limits the invoice capability gate to line operations, while every estimate command is capability-gated first', () => {
    expect(invoice).toMatch(/if \(\(lineUpdate \|\| lineChange\) && !\(await requireQboDocumentCommandV2\(db\)\)\)/);
    const invoiceGate = invoice.indexOf('if ((lineUpdate || lineChange) && !(await requireQboDocumentCommandV2(db)))');
    const invoiceTraffic = invoice.indexOf('await requireQboProviderTraffic(env)', invoiceGate);
    const invoiceReservation = invoice.indexOf('await reserveQboInvoiceCommand', invoiceGate);
    expect(invoiceGate).toBeGreaterThanOrEqual(0);
    expect(invoiceTraffic).toBeGreaterThan(invoiceGate);
    expect(invoiceReservation).toBeGreaterThan(invoiceTraffic);

    const estimateGate = estimate.indexOf('if (!(await requireQboDocumentCommandV2(db)))');
    const estimateTraffic = estimate.indexOf('await requireQboProviderTraffic(env)', estimateGate);
    const estimateExisting = estimate.indexOf('await getQboEstimateCommand', estimateGate);
    const estimateReservation = estimate.indexOf('await reserveQboEstimateCommand', estimateGate);
    expect(estimateGate).toBeGreaterThanOrEqual(0);
    expect(estimateTraffic).toBeGreaterThan(estimateGate);
    expect(estimateExisting).toBeGreaterThan(estimateTraffic);
    expect(estimateReservation).toBeGreaterThan(estimateTraffic);
  });

  it('strict-gates only web and native document-line routes, not legacy document routes', () => {
    for (const path of ['invoice/:invoiceId/line/:lineId', 'estimate/:estimateId/line/:lineId']) {
      expect(routeSection(webRoutes, path)).toContain('<DocumentCommandRoute>');
      expect(routeSection(appRoutes, `tech/admin/${path}`)).toContain('<StrictFeatureRoute flag="feature:qbo_document_command_v2">');
    }
    for (const path of ['invoice/new', 'invoice/:invoiceId/pay', 'invoice/:invoiceId', 'estimate/new', 'estimate/:estimateId/edit', 'estimate/:estimateId']) {
      expect(routeSection(webRoutes, path)).not.toContain('<DocumentCommandRoute>');
      expect(routeSection(appRoutes, `tech/admin/${path}`)).not.toContain('<StrictFeatureRoute');
    }
  });
});
