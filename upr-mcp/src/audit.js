// Security + audit layer for the QBO MCP worker.
//   - Email allowlist (defense-in-depth on top of the OAuth login gate)
//   - Kill switch (integration_config.upr_mcp_enabled = 'false' disables instantly)
//   - Audit log: every tool call (read + write) is recorded to upr_mcp_audit

import { supabase } from './supabase.js';

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

// Kill switch. Default ON; only the explicit string 'false' disables it.
export async function assertEnabled(env) {
  try {
    const rows = await supabase(env).select('integration_config', `key=eq.upr_mcp_enabled&select=value&limit=1`);
    if (rows && rows[0] && String(rows[0].value).toLowerCase() === 'false') {
      throw new Error('QBO MCP is currently disabled (kill switch: integration_config.upr_mcp_enabled = false).');
    }
  } catch (e) {
    // If the check itself fails for a reason other than the kill switch, fail open
    // ONLY for connectivity — but a thrown kill-switch error must propagate.
    if (/kill switch/i.test(e.message)) throw e;
  }
}

export async function logAudit(env, entry) {
  try {
    const args = (() => {
      try { return JSON.parse(JSON.stringify(entry.args ?? null)); } catch { return null; }
    })();
    await supabase(env).insert('upr_mcp_audit', {
      actor_email: entry.actor || null,
      tool:        entry.tool || null,
      arguments:   args,
      status:      entry.status || null,
      result:      entry.result ? String(entry.result).slice(0, 2000) : null,
      error:       entry.error ? String(entry.error).slice(0, 2000) : null,
    });
  } catch (e) {
    // Never let audit failure break a tool call; just log to the worker console.
    console.warn('qbo_mcp_audit insert failed:', e.message);
  }
}
