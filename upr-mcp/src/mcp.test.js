/**
 * ════════════════════════════════════════════════
 * FILE: mcp.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves QBO provider faults are reduced to stable MCP/audit identifiers.
 *
 * DEPENDS ON:
 *   Packages: vitest
 *   Internal: ./mcp.js
 *   Data: mocked Worker and QBO responses only
 * ════════════════════════════════════════════════
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mcpApiHandler } from './mcp.js';

const env = {
  ALLOWED_EMAIL: 'owner@example.test',
  SUPABASE_URL: 'https://db.test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
  QBO_ENVIRONMENT: 'sandbox',
};

const jsonResponse = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

afterEach(() => vi.restoreAllMocks());

describe('upr-mcp error disclosure', () => {
  it('returns and audits only a stable provider category/code plus intuit_tid', async () => {
    let auditBody;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options = {}) => {
      const target = String(url);
      if (target.includes('/integration_config?') && target.includes('upr_mcp_enabled')) return jsonResponse([{ value: 'true' }]);
      if (target.includes('/integration_config?') && target.includes('qbo_provider_traffic_enabled')) return jsonResponse([{ value: 'true' }]);
      if (target.includes('/integration_credentials?')) return jsonResponse([{
        provider: 'quickbooks', access_token: 'access-token-secret', refresh_token: 'refresh-token-secret',
        token_expires_at: '2099-01-01T00:00:00.000Z', realm_id: 'realm-A', environment: 'sandbox', qbo_binding_generation: 4,
      }]);
      if (target.includes('/qbo_company_binding?')) return jsonResponse([{ environment: 'sandbox', realm_id: 'realm-A', generation: 4 }]);
      if (target.includes('/v3/company/realm-A/query?')) {
        return new Response(JSON.stringify({ Fault: { Error: [{
          Message: 'raw-provider-message-secret', Detail: 'raw-provider-detail-secret', code: '6190',
        }] } }), { status: 400, headers: { 'Content-Type': 'application/json', intuit_tid: 'tid-safe-123' } });
      }
      if (target.endsWith('/upr_mcp_audit')) {
        auditBody = JSON.parse(options.body);
        return jsonResponse([]);
      }
      throw new Error(`unexpected fetch ${target}`);
    });

    const response = await mcpApiHandler.fetch(new Request('https://mcp.test/mcp', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'qbo_query', arguments: { sql: 'SELECT * FROM Invoice' } } }),
    }), env, { props: { email: 'owner@example.test' } });
    const body = await response.json();
    const text = body.result.content[0].text;

    expect(text).toBe('Error: provider (qbo_provider_request_failed) [intuit_tid tid-safe-123]');
    expect(text).not.toMatch(/raw-provider|access-token|refresh-token/);
    expect(auditBody.error).toBe(JSON.stringify({ category: 'provider', code: 'qbo_provider_request_failed', intuit_tid: 'tid-safe-123' }));
    expect(auditBody.error).not.toMatch(/raw-provider|access-token|refresh-token/);
  });
});
