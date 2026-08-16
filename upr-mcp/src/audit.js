/**
 * ════════════════════════════════════════════════
 * FILE: audit.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Protects the owner-only MCP service before it can run a tool. It checks the
 *   owner address, confirms the explicit enable switch, and records each request.
 *   A missing, unclear, or unavailable switch keeps the service safely off.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ./supabase.js
 *   Data:      reads  → integration_config
 *              writes → upr_mcp_audit
 *
 * NOTES / GOTCHAS:
 *   - Exactly one raw `upr_mcp_enabled` value of `true` enables tool execution.
 *   - The enable lookup is abortable and time-bounded; a timeout is a disabled state.
 * ════════════════════════════════════════════════
 */

import { supabase } from './supabase.js';

export const MCP_DATABASE_TIMEOUT_MS = 1_500;
export const MCP_ENABLED_LOOKUP_TIMEOUT_MS = MCP_DATABASE_TIMEOUT_MS;
export const MCP_DISABLED_CODE = 'upr_mcp_disabled';

function disabledError() {
  const error = new Error('QBO MCP is currently disabled.');
  error.code = MCP_DISABLED_CODE;
  error.reason = MCP_DISABLED_CODE;
  error.status = 503;
  return error;
}

async function boundedFetch(url, options = {}) {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) abortFromCaller();
    else options.signal.addEventListener('abort', abortFromCaller, { once: true });
  }
  let timeoutId;
  const timedOut = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new Error('MCP database request timed out'));
    }, MCP_DATABASE_TIMEOUT_MS);
  });
  try {
    // `supabase.js` parses a response body after this transport resolves. Do
    // not clear the timeout (or abort its signal) at response headers: doing so
    // can cut off a streamed JSON body before select()/insert() consumes it.
    // Buffer the body while the same timeout is active, then hand the caller an
    // equivalent detached Response whose body is safe to parse.
    const fetchAndBuffer = async () => {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const body = response.status === 204 ? null : await response.arrayBuffer();
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    };
    return await Promise.race([
      fetchAndBuffer(),
      timedOut,
    ]);
  } finally {
    clearTimeout(timeoutId);
    controller.abort();
    options.signal?.removeEventListener('abort', abortFromCaller);
  }
}

async function selectMcpEnabledRow(env) {
  const controller = new AbortController();
  let timeoutId;
  const timedOut = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new Error('upr_mcp_enabled lookup timed out'));
    }, MCP_ENABLED_LOOKUP_TIMEOUT_MS);
  });

  try {
    const database = supabase(env, (url, options = {}) => boundedFetch(url, {
      ...options,
      signal: controller.signal,
    }));
    // Do not use limit=1: an ambiguous duplicated configuration must fail closed.
    return await Promise.race([
      database.select('integration_config', 'key=eq.upr_mcp_enabled&select=value'),
      timedOut,
    ]);
  } finally {
    clearTimeout(timeoutId);
    controller.abort();
  }
}

// Hard gate: the authenticated email must match ALLOWED_EMAIL. The OAuth login
// already enforces this, but we re-check on every call so a misconfigured grant
// can never reach QBO.
export function assertAllowed(email, env) {
  const allowed = (env.ALLOWED_EMAIL || '').trim().toLowerCase();
  if (!allowed) throw new Error('Server misconfigured: ALLOWED_EMAIL is not set.');
  if (!email || email.trim().toLowerCase() !== allowed) {
    throw new Error('Forbidden: this MCP server is locked to a single owner account.');
  }
}

// Kill switch. Default OFF: exactly one row whose raw value is exactly the string
// 'true' enables tool execution. Any ambiguity or lookup failure is maintenance.
export async function assertEnabled(env) {
  try {
    const rows = await selectMcpEnabledRow(env);
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.value !== 'true') {
      throw disabledError();
    }
  } catch {
    throw disabledError();
  }
}

export async function logAudit(env, entry) {
  try {
    const args = (() => {
      try { return JSON.parse(JSON.stringify(entry.args ?? null)); } catch { return null; }
    })();
    await supabase(env, boundedFetch).insert('upr_mcp_audit', {
      actor_email: entry.actor || null,
      tool:        entry.tool || null,
      arguments:   args,
      status:      entry.status || null,
      result:      entry.result ? String(entry.result).slice(0, 2000) : null,
      error:       entry.error ? String(entry.error).slice(0, 2000) : null,
    });
  } catch {
    // Never let audit failure break a tool call; just log to the worker console.
    console.warn('qbo_mcp_audit insert failed: audit_write_unavailable');
  }
}
