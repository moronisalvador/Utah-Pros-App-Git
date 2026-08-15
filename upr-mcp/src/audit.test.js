/**
 * ════════════════════════════════════════════════
 * FILE: audit.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the owner MCP integration gate fails closed before any tool/provider work.
 *
 * DEPENDS ON:
 *   Packages: vitest
 *   Internal: ./audit.js, ./mcp.js
 *   Data:      reads  → mocked integration_config
 *              writes → mocked upr_mcp_audit
 *
 * NOTES / GOTCHAS:
 *   - Network calls are mocked so the test cannot contact the deployed MCP service.
 * ════════════════════════════════════════════════
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  assertEnabled,
  logAudit,
  MCP_DATABASE_TIMEOUT_MS,
  MCP_DISABLED_CODE,
  MCP_ENABLED_LOOKUP_TIMEOUT_MS,
} from './audit.js';
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

function delayedJsonResponse(value, { signal, delayMs = 5 } = {}) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return new Response(new ReadableStream({
    start(controller) {
      const timeoutId = setTimeout(() => {
        controller.enqueue(bytes);
        controller.close();
      }, delayMs);
      signal?.addEventListener('abort', () => {
        clearTimeout(timeoutId);
        controller.error(new DOMException('The response body was aborted', 'AbortError'));
      }, { once: true });
    },
  }), { headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => vi.restoreAllMocks());

describe('upr_mcp_enabled fail-closed gate', () => {
  for (const [label, response] of [
    ['false', [{ value: 'false' }]],
    ['missing', []],
    ['malformed', [{ value: 'TRUE' }]],
    ['duplicate', [{ value: 'true' }, { value: 'true' }]],
  ]) {
    it(`refuses ${label} configuration`, async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(response));
      await expect(assertEnabled(env)).rejects.toMatchObject({
        code: MCP_DISABLED_CODE, reason: MCP_DISABLED_CODE, status: 503,
      });
    });
  }

  it('refuses a database exception with the stable disabled error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('database unavailable'));
    await expect(assertEnabled(env)).rejects.toMatchObject({ code: MCP_DISABLED_CODE, status: 503 });
  });

  it('keeps the bounded enable lookup alive until a delayed response body is parsed', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => (
      delayedJsonResponse([{ value: 'true' }], options)
    ));

    await expect(assertEnabled(env)).resolves.toBeUndefined();
  });

  it('aborts and refuses a hung database lookup', async () => {
    vi.useFakeTimers();
    let signal;
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, options = {}) => {
      signal = options.signal;
      return new Promise(() => {});
    });
    const assertion = expect(assertEnabled(env)).rejects.toMatchObject({ code: MCP_DISABLED_CODE, status: 503 });
    await vi.advanceTimersByTimeAsync(MCP_ENABLED_LOOKUP_TIMEOUT_MS);
    await assertion;
    expect(signal?.aborted).toBe(true);
    vi.useRealTimers();
  });

  it('bounds a hung best-effort audit write without changing the caller outcome', async () => {
    vi.useFakeTimers();
    let signal;
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, options = {}) => {
      signal = options.signal;
      return new Promise(() => {});
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const audit = logAudit(env, { actor: 'owner@example.test', tool: 'qbo_query', status: 'ok' });
    await vi.advanceTimersByTimeAsync(MCP_DATABASE_TIMEOUT_MS);
    await expect(audit).resolves.toBeUndefined();
    expect(signal?.aborted).toBe(true);
    expect(warn).toHaveBeenCalledWith('qbo_mcp_audit insert failed: audit_write_unavailable');
    vi.useRealTimers();
  });

  it('keeps a bounded audit write alive until its delayed response body is consumed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => delayedJsonResponse([], options));

    await expect(logAudit(env, { actor: 'owner@example.test', tool: 'qbo_query', status: 'ok' })).resolves.toBeUndefined();

    expect(warn).not.toHaveBeenCalled();
  });

  it('refuses before tool/provider work and audits the stable maintenance code', async () => {
    let auditBody;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options = {}) => {
      const target = String(url);
      if (target.includes('/integration_config?')) return jsonResponse([{ value: 'false' }]);
      if (target.endsWith('/upr_mcp_audit')) {
        auditBody = JSON.parse(options.body);
        return jsonResponse([]);
      }
      throw new Error(`provider/tool work must not run: ${target}`);
    });

    const response = await mcpApiHandler.fetch(new Request('https://mcp.test/mcp', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'qbo_query', arguments: { sql: 'SELECT * FROM Invoice' } },
      }),
    }), env, { props: { email: 'owner@example.test' } });
    const body = await response.json();

    expect(body.result.content[0].text).toBe('Error: maintenance (upr_mcp_disabled)');
    expect(auditBody.error).toBe(JSON.stringify({ category: 'maintenance', code: MCP_DISABLED_CODE }));
    expect(fetchSpy.mock.calls.map(([url]) => String(url))).toEqual(expect.arrayContaining([
      expect.stringContaining('/integration_config?'),
      expect.stringContaining('/upr_mcp_audit'),
    ]));
    expect(fetchSpy.mock.calls).toHaveLength(2);
  });
});
