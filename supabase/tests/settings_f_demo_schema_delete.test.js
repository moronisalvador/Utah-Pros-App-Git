/**
 * ════════════════════════════════════════════════
 * FILE: settings_f_demo_schema_delete.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the new "delete a Scope Sheet version" database function is safe: it
 *   REFUSES to delete the version that is currently live (so the app can never
 *   erase the schema every saved sheet is built on), and it ALLOWS deleting a
 *   throwaway draft that was never published and has no sheets. This protects the
 *   60-second rollback runbook (.claude/rules/scope-sheet-rollback.md).
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client — fine for a
 *              script/test, not a component; see CLAUDE.md rule 3)
 *   Data:      reads  → demo_sheet_schemas (via get_active_demo_schema)
 *              writes → demo_sheet_schemas (a throwaway draft via
 *                       upsert_demo_schema, deleted again via delete_demo_schema)
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase project (a SQL RPC's
 *     behavior can't be verified as a pure unit test). Needs real
 *     VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (see .env.example). CI's
 *     `npm test` step does not pass those secrets, so this suite self-skips via
 *     `describe.skipIf` rather than failing red — same pattern as the CRM suites.
 *   - It NEVER calls publish_demo_schema (that would flip the production active
 *     version). It only creates + deletes a never-published draft, and asserts
 *     the live active version refuses deletion.
 *   - upsert_demo_schema(p_id=null) bumps the version counter; the draft is
 *     removed again in the same test, so no lasting drift.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!hasCreds)('delete_demo_schema — safe deletion (integration)', () => {
  it('refuses to delete the active version', async () => {
    const rows = await db.rpc('get_active_demo_schema');
    const active = Array.isArray(rows) ? rows[0] : rows;
    expect(active?.id, 'expected a live active demo schema to exist').toBeTruthy();
    await expect(db.rpc('delete_demo_schema', { p_id: active.id })).rejects.toThrow();
  });

  it('allows deleting a never-published, unreferenced draft', async () => {
    const draftId = await db.rpc('upsert_demo_schema', {
      p_id: null,
      p_name: `__test draft ${Date.now()}`,
      p_definition: { sections: [] },
      p_notes: 'settings-f delete test — safe to remove',
      p_created_by: null,
    });
    expect(draftId).toBeTruthy();
    // A brand-new draft is is_active=false, published_at=null, zero sheets → deletable.
    const ok = await db.rpc('delete_demo_schema', { p_id: draftId });
    expect(ok).toBe(true);
    // And it's really gone.
    const gone = await db.rpc('get_demo_schema', { p_id: draftId });
    expect(Array.isArray(gone) ? gone.length : gone).toBeFalsy();
  });

  it('refuses to delete a non-existent version', async () => {
    await expect(
      db.rpc('delete_demo_schema', { p_id: '00000000-0000-0000-0000-000000000000' }),
    ).rejects.toThrow();
  });
});
