/**
 * ════════════════════════════════════════════════
 * FILE: tools-stripe-boundary.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves that owner confirmation cannot make the MCP worker create a payout, checkout link, or
 *   arbitrary Stripe mutation while the durable projection boundary is unavailable. Read tools
 *   and previews remain outside this focused contract.
 *
 * DEPENDS ON:
 *   Packages:  Vitest
 *   Internal:  tools registry
 *   Data:      reads  → none
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Every assertion runs before credentials or an outbound Stripe request can be reached.
 * ════════════════════════════════════════════════
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { STRIPE_MCP_MUTATION_DURABLE_BOUNDARY_REQUIRED, TOOLS } from './tools.js';

describe('MCP Stripe durable mutation boundary', () => {
  const fetchSpy = vi.fn();

  beforeEach(() => vi.stubGlobal('fetch', fetchSpy));
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['stripe_create_payout', { amount_cents: 100, confirm: true }],
    ['stripe_create_payment_link', { amount_cents: 100, confirm: true }],
    ['stripe_request', { method: 'POST', path: '/refunds', params: {}, confirm: true }],
  ])('%s refuses confirmation before provider work', async (toolName, args) => {
    await expect(TOOLS[toolName].run({}, args)).rejects.toMatchObject({
      code: STRIPE_MCP_MUTATION_DURABLE_BOUNDARY_REQUIRED,
      reason: STRIPE_MCP_MUTATION_DURABLE_BOUNDARY_REQUIRED,
      status: 503,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
