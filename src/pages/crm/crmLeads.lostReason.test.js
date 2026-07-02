/**
 * ════════════════════════════════════════════════
 * FILE: crmLeads.lostReason.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the Leads board requires a reason when you drop a lead into a
 *   "lost" stage — the client-side guard that makes win/loss data honest.
 *   Moving into any non-lost stage never demands a reason. The database RPC
 *   stays backward-compatible (reason optional) — that is covered by
 *   crm_shared_rpc_compat.test.js; this pins the NEW UI requirement.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/pages/crm/CrmLeads.jsx (lostReasonError helper)
 *
 * NOTES / GOTCHAS:
 *   - Mocks @/contexts/AuthContext so importing the page module does not pull
 *     in the realtime Supabase client (needs env vars at import time). We only
 *     exercise the pure validator, never render the page.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ db: {}, employee: null }) }));

const { lostReasonError } = await import('./CrmLeads.jsx');

const lostStage = { id: 'l1', name: 'Lost', is_lost: true };
const openStage = { id: 'o1', name: 'Qualified', is_lost: false };

describe('lostReasonError — reason required only on lost stages', () => {
  it('demands a reason when moving into a lost stage with none given', () => {
    expect(lostReasonError(lostStage, '')).toBeTruthy();
    expect(lostReasonError(lostStage, '   ')).toBeTruthy();
    expect(lostReasonError(lostStage, null)).toBeTruthy();
  });

  it('accepts a non-empty reason on a lost stage', () => {
    expect(lostReasonError(lostStage, 'Went with competitor')).toBeNull();
  });

  it('never demands a reason on a non-lost stage', () => {
    expect(lostReasonError(openStage, '')).toBeNull();
    expect(lostReasonError(openStage, null)).toBeNull();
  });

  it('treats a missing/undefined stage as not requiring a reason', () => {
    expect(lostReasonError(undefined, '')).toBeNull();
    expect(lostReasonError(null, '')).toBeNull();
  });
});
