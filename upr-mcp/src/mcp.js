// MCP API handler — Streamable HTTP transport.
// Mounted by OAuthProvider at /mcp. Only requests carrying a valid OAuth token
// reach here; the authenticated owner's identity arrives on ctx.props.email.
//
// IMPORTANT: Claude's connector opens `GET /mcp` and expects a 200
// text/event-stream (SSE) channel to be established BEFORE it will send the
// `POST initialize` JSON-RPC request. Returning 405 on GET makes the client loop
// and fail to connect. So GET returns an open SSE stream; POST handles JSON-RPC.

import { TOOLS, toolList } from './tools.js';
import { assertAllowed, assertEnabled, logAudit } from './audit.js';

const SERVER_INFO = { name: 'upr-mcp', version: '1.0.0' };
const PROTOCOL_VERSION = '2025-06-18';

const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

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
        await logAudit(env, { actor: email, tool: name, args, status, result: JSON.stringify(result) });
        return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: false });
      } catch (e) {
        await logAudit(env, { actor: email, tool: name, args, status: 'error', error: e.message });
        return rpcResult(id, { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });
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
