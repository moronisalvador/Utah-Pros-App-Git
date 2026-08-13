/**
 * ════════════════════════════════════════════════
 * FILE: qbo-schema-free-foundation.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the first QuickBooks production release is only a maintenance and
 *   containment boundary. It must run against today's database without any of
 *   the later P4c command, reservation, allocation-fence, or company-binding
 *   migrations.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path, node:url
 *   Internal:  Pages QBO routes/helpers, UPR MCP QBO adapter, package.json
 *   Data:      reads  → repository source
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This proves source compatibility, not live deployment or database state.
 *   - Future identifiers appear only in this deny-list; none may occur in the
 *     D1 runtime sources inspected below.
 * ════════════════════════════════════════════════
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

function runtimeSourcePaths(directory) {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const relative = join(directory, entry.name);
    if (entry.isDirectory()) return runtimeSourcePaths(relative);
    if (!/\.(?:js|jsx)$/.test(entry.name) || /\.(?:test|spec)\.[^.]+$/.test(entry.name)) return [];
    return [relative];
  });
}

// Scan the complete executable source graph, not a hand-picked route list. A new
// caller added anywhere in Pages, MCP, or the browser must not silently acquire a
// dependency on the migration-dependent D2 contract.
const runtimePaths = [
  ...runtimeSourcePaths('functions'),
  ...runtimeSourcePaths('upr-mcp/src'),
  ...runtimeSourcePaths('src'),
];

const futureIdentifiers = [
  'reserve_qbo_invoice_command',
  'release_qbo_invoice_command_reservation',
  'qbo_invoice_command_reservations',
  'stage_qbo_invoice_line_update',
  'finalize_qbo_invoice_line_update',
  'stage_qbo_invoice_line_change',
  'finalize_qbo_invoice_line_change',
  'qbo_payment_allocation_fences',
  'establish_qbo_payment_allocation_fences',
  'lock_qbo_payment_allocation_invoices',
  'reserve_qbo_payment_allocation_fence',
  'release_qbo_payment_allocation_fence',
  'release_qbo_payment_allocation_fences',
  'qbo_estimate_commands',
  'qbo_estimate_command_reservations',
  'get_qbo_estimate_command',
  'reserve_qbo_estimate_command',
  'prepare_qbo_estimate_command',
  'start_qbo_estimate_command_attempt',
  'record_qbo_estimate_provider_started',
  'record_qbo_estimate_provider_succeeded',
  'set_qbo_estimate_command_state',
  'finalize_qbo_estimate_command',
  'record_qbo_estimate_command_failure',
  'release_qbo_estimate_command_reservation',
  'qbo_company_binding',
  'qbo_binding_generation',
  'replace_qbo_connection',
  'refresh_qbo_connection_cas',
  'guard_qbo_realm_binding',
  'guard_quickbooks_company_binding',
  'feature:qbo_document_command_v2',
];

describe('schema-free QuickBooks production foundation', () => {
  it('contains no consumer of a future P4c database or capability contract', () => {
    for (const path of runtimePaths) {
      const source = read(path);
      for (const identifier of futureIdentifiers) {
        expect(source, `${path} must not use ${identifier}`).not.toContain(identifier);
      }
    }
  });

  it('keeps legacy invoice commands on the already-deployed command ledger', () => {
    const source = read('functions/api/qbo-invoice.js');
    const validation = source.indexOf("if (!invoiceId)");
    const gate = source.indexOf('requireQboProviderTraffic(env)');
    const connection = source.indexOf('getConnection(env)');

    expect(validation).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(validation);
    expect(connection).toBeGreaterThan(gate);
    expect(source).toContain('prepareQboInvoiceCommand');
    expect(source).not.toContain('reserveQboInvoiceCommand');
    expect(source).not.toContain('line_change');
  });

  it('source-disables legacy estimate mutations and places the receipt brake before provider work', () => {
    const estimate = read('functions/api/qbo-estimate.js');
    const receipt = read('functions/api/qbo-receive-payment.js');

    expect(estimate).toContain('qbo_estimate_durable_boundary_required');
    expect(estimate).not.toContain('requireQboProviderTraffic(env)');
    expect(estimate).not.toContain('getConnection(env)');
    expect(estimate).not.toContain('createEstimate(');
    expect(estimate).not.toContain('qbo-estimate-commands');
    expect(receipt.indexOf('requireQboProviderTraffic(env)'))
      .toBeLessThan(receipt.indexOf('getConnection(env)'));
    expect(receipt).toContain("db.rpc('reserve_qbo_payment_receipt'");
    expect(receipt).not.toContain('allocation_fence');
  });

  it('uses current-schema credential CAS and keeps MCP mutations source-disabled', () => {
    const pages = read('functions/lib/quickbooks.js');
    const mcp = read('upr-mcp/src/qbo.js');
    const tools = read('upr-mcp/src/tools.js');

    expect(pages).toContain('provider=eq.${PROVIDER}');
    expect(mcp).toContain('provider=eq.${PROVIDER}');
    for (const source of [pages, mcp]) {
      expect(source).toContain('realm_id=eq.');
      expect(source).toContain('updated_at=eq.');
    }
    expect(mcp).toContain('qbo_mcp_mutation_durable_boundary_required');
    expect(mcp).toMatch(/export async function qboCreate[\s\S]*?assertQboMcpMutationDurableBoundary\(\)/);
    expect(mcp).toMatch(/export async function qboSparseUpdate[\s\S]*?assertQboMcpMutationDurableBoundary\(\)/);
    expect(mcp).toMatch(/export async function qboDelete[\s\S]*?assertQboMcpMutationDurableBoundary\(\)/);
    expect(mcp).toMatch(/export async function qboSend[\s\S]*?assertQboMcpMutationDurableBoundary\(\)/);
    expect(tools).toContain('stripe_mcp_mutation_durable_boundary_required');
    for (const tool of ['stripe_create_payout', 'stripe_create_payment_link', 'stripe_request']) {
      const start = tools.indexOf(`${tool}:`);
      const end = tools.indexOf('\n  },', start);
      expect(start, `${tool} must remain registered`).toBeGreaterThan(-1);
      expect(tools.slice(start, end), `${tool} must refuse confirmed execution`).toContain(
        'assertStripeMcpMutationDurableBoundary()',
      );
    }
  });

  it('bounds every MCP database request by default', () => {
    const source = read('upr-mcp/src/supabase.js');

    expect(source).toContain('SUPABASE_REQUEST_TIMEOUT_MS = 15_000');
    expect(source).toContain('AbortSignal.timeout(SUPABASE_REQUEST_TIMEOUT_MS)');
    expect(source).toContain('fetchImpl = supabaseFetchWithTimeout');
  });

  it('does not publish P4c database qualifier scripts in the foundation package', () => {
    const pkg = read('package.json');
    expect(pkg).not.toContain('test:db:invoice-line-edit-lock:local');
    expect(pkg).not.toContain('test:db:qbo-invoice-command-reservation');
    expect(pkg).not.toContain('test:db:qbo-payment-allocation-lock-fence');
    expect(pkg).not.toContain('test:db:qbo-estimate-command-boundary');
  });

  it('bounds Collections AI and source-disables the Xactimate AI/Storage operation', () => {
    for (const path of ['functions/api/collections-chat.js', 'functions/api/analyze-xactimate.js']) {
      const source = read(path);
      expect(source, `${path} must use the shared timeout helper`).toContain('fetchWithTimeout');
      expect(source, `${path} must not make a raw outbound fetch`).not.toMatch(/await\s+fetch\s*\(/);
      expect(source, `${path} must bound its service-role database client`).toContain('supabase(env, fetchWithTimeout)');
    }
    const xactimate = read('functions/api/analyze-xactimate.js');
    const handler = xactimate.slice(xactimate.indexOf('export async function onRequestPost'));
    expect(handler).toContain('XACTIMATE_IMPORT_DURABLE_BOUNDARY_REQUIRED');
    expect(handler).toContain('supabase(env, fetchWithTimeout)');
    expect(handler).not.toMatch(/job_documents|downloadStorage|ANTHROPIC|invoice_line_items|findClassId|getConnection|recordWorkerRun/);
  });

  it('bounds the database and authentication transport in every changed QBO route', () => {
    for (const path of [
      'functions/api/qbo-estimate.js',
      'functions/api/qbo-invoice-drift.js',
      'functions/api/qbo-invoice.js',
      'functions/api/qbo-query.js',
      'functions/api/quickbooks-connect.js',
    ]) {
      expect(read(path), `${path} must bound its Supabase client`).toContain('supabase(env, fetchWithTimeout)');
    }
    for (const path of [
      'functions/api/qbo-attach.js',
      'functions/api/qbo-charge.js',
      'functions/api/qbo-invoice-drift.js',
    ]) {
      expect(read(path), `${path} must bound requireRole token verification`)
        .toMatch(/requireRole\([^;]+fetchWithTimeout\)/);
    }
  });

  it('documents and marks every D1 sessionless provider endpoint', () => {
    const auth = read('docs/auth-and-authorization.md');
    for (const path of [
      'functions/api/qbo-webhook.js',
      'functions/api/stripe-webhook.js',
      'functions/api/quickbooks-callback.js',
    ]) {
      const route = read(path);
      expect(route, `${path} must carry a public-by-design reason`).toMatch(/\/\/ public: [^\n]+/);
      const endpoint = `/api/${path.split('/').pop().replace(/\.js$/, '')}`;
      expect(auth, `${endpoint} must be in the sessionless HTTP allowlist`).toContain(endpoint);
    }
  });
});
