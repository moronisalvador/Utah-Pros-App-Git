/**
 * ════════════════════════════════════════════════
 * FILE: mcp.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Receives authenticated MCP requests from the owner's connector, lists the available tools,
 *   runs one selected tool, and returns its result. Every call passes the owner allowlist and
 *   database kill switch and writes a compact audit outcome without exposing provider fault text.
 *
 * DEPENDS ON:
 *   Packages:  n/a
 *   Internal:  tool registry, owner/kill-switch authorization, MCP audit logging
 *   Data:      reads  → integration_config through assertEnabled
 *              writes → upr_mcp_audit through logAudit
 *
 * NOTES / GOTCHAS:
 *   - GET /mcp must return an open event stream before the connector sends its initialize request.
 *   - Tool errors and audit results use stable categories/codes; raw provider payloads are omitted.
 * ════════════════════════════════════════════════
 */

import { TOOLS, toolList } from './tools.js';
import { assertAllowed, assertEnabled, logAudit } from './audit.js';

const SERVER_INFO = { name: 'upr-mcp', version: '1.0.0' };
const PROTOCOL_VERSION = '2025-06-18';

const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

const STABLE_ERROR_CODES = new Set([
  'qbo-connection-changed',
  'qbo-realm-mismatch',
  'qbo_mcp_mutation_durable_boundary_required',
  'qbo_provider_request_failed',
  'qbo_provider_traffic_disabled',
  'qbo_token_refresh_failed',
  'stripe_mcp_mutation_durable_boundary_required',
  'upr_mcp_disabled',
]);

function sanitizeToolError(error) {
  const code = STABLE_ERROR_CODES.has(error?.code) ? error.code : 'mcp_tool_request_failed';
  const category = code === 'qbo-connection-changed' || code === 'qbo-realm-mismatch' ? 'connection'
    : code === 'qbo_provider_traffic_disabled'
      || code === 'qbo_mcp_mutation_durable_boundary_required'
      || code === 'stripe_mcp_mutation_durable_boundary_required'
      || code === 'upr_mcp_disabled' ? 'maintenance'
      : code.startsWith('qbo_') ? 'provider' : 'request';
  const intuitTid = typeof error?.intuitTid === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(error.intuitTid)
    ? error.intuitTid
    : null;
  return { category, code, ...(intuitTid ? { intuit_tid: intuitTid } : {}) };
}

async function handleMessage(msg, env, ctx) {
  const { id, method, params } = msg || {};
  // Notifications (no id) get no response body.
  if (id === undefined || id === null) return null;

  switch (method) {
    case 'initialize':
      return rpcResult(id, {
        protocolVersion: (params && typeof params.protocolVersion === 'string') ? params.protocolVersion : PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      });

    case 'ping':
      return rpcResult(id, {});

    case 'tools/list':
      return rpcResult(id, { tools: toolList() });

    case 'tools/call': {
      const email = ctx.props && ctx.props.email;
      const name = params && params.name;
      const args = (params && params.arguments) || {};
      try {
        assertAllowed(email, env);       // single-owner hard gate (defense in depth)
        await assertEnabled(env);        // kill switch
        const tool = TOOLS[name];
        if (!tool) return rpcResult(id, { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true });

        const result = await tool.run(env, args);
        const status = result && result.preview ? 'preview' : 'ok';
        await logAudit(env, { actor: email, tool: name, args, status, result: JSON.stringify({ category: 'success', code: status }) });
        return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: false });
      } catch (e) {
        const safeError = sanitizeToolError(e);
        await logAudit(env, { actor: email, tool: name, args, status: 'error', error: JSON.stringify(safeError) });
        return rpcResult(id, { content: [{ type: 'text', text: `Error: ${safeError.category} (${safeError.code})${safeError.intuit_tid ? ` [intuit_tid ${safeError.intuit_tid}]` : ''}` }], isError: true });
      }
    }

    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

export const mcpApiHandler = {
  async fetch(request, env, ctx) {
    // GET → open an SSE stream so the client proceeds to POST initialize.
    if (request.method === 'GET') {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(': connected\n\n'));
          // Keep the stream open for server→client messages (we have none).
        },
      });
      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      });
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, POST' } });
    }

    let body;
    try { body = await request.json(); }
    catch { return Response.json(rpcError(null, -32700, 'Parse error'), { status: 400 }); }

    const messages = Array.isArray(body) ? body : [body];
    const responses = [];
    for (const m of messages) {
      const r = await handleMessage(m, env, ctx);
      if (r) responses.push(r);
    }
    if (responses.length === 0) return new Response(null, { status: 202 });
    return Response.json(Array.isArray(body) ? responses : responses[0]);
  },
};
