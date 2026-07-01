/**
 * ════════════════════════════════════════════════
 * FILE: crm_status_public_access.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the public /status page's one data dependency actually works for a
 *   logged-out visitor: calling get_crm_build_progress() with only the anon
 *   key (no employee login, no session token) succeeds and returns the
 *   phases/stages shape the page renders. This is the exact request
 *   src/pages/Status.jsx makes.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client — the same
 *              anon client Status.jsx uses; see CLAUDE.md rule 3's carve-out
 *              for public/bootstrapping calls)
 *   Data:      reads  → crm_build_phases, crm_build_stages (via
 *                       get_crm_build_progress) — no writes
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase project (same
 *     rationale as crm_phase0_build_progress.test.js — an RPC grant can't be
 *     verified as a pure unit test). Needs real VITE_SUPABASE_URL /
 *     VITE_SUPABASE_ANON_KEY (see .env.example) to run; self-skips otherwise
 *     so CI's `npm test` step (no DB secrets) stays green.
 *   - This is the regression guard for "the RPC is GRANTED to anon" — if a
 *     future migration ever revokes that grant, this test starts failing
 *     instead of the public page silently breaking in production.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!hasCreds)('Public /status page — anon access to CRM build progress', () => {
  it('get_crm_build_progress succeeds for an unauthenticated (anon-key-only) caller', async () => {
    const progress = await db.rpc('get_crm_build_progress');

    expect(typeof progress.overall_done).toBe('number');
    expect(typeof progress.overall_total).toBe('number');
    expect(Array.isArray(progress.phases)).toBe(true);
    expect(progress.phases.length).toBeGreaterThan(0);

    const phaseZero = progress.phases.find(p => p.phase_key === '0');
    expect(phaseZero).toBeTruthy();
    expect(Array.isArray(phaseZero.stages)).toBe(true);
    expect(['planned', 'in_progress', 'shipped']).toContain(phaseZero.status);
  });

  it('does not expose anything beyond the phase/stage progress shape (no PII, no credentials)', async () => {
    const progress = await db.rpc('get_crm_build_progress');
    const serialized = JSON.stringify(progress);

    // The response is meant to be safe to render on a logged-out, public page —
    // it should never carry contact/lead data, tokens, or emails.
    expect(serialized).not.toMatch(/@[\w.-]+\.\w+/); // no email-shaped strings
    expect(serialized.toLowerCase()).not.toContain('token');
    expect(serialized.toLowerCase()).not.toContain('password');
  });
});
