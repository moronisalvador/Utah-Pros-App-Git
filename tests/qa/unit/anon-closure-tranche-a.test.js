/**
 * ════════════════════════════════════════════════
 * FILE: anon-closure-tranche-a.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Reads the anon-closure migration as TEXT and checks it still says what it is
 *   supposed to say. No database required.
 *
 *   This remains an always-visible source guard even though the JavaScript
 *   behavioral proof now runs in hosted CI against qa-staging. It catches a
 *   weakened migration before any database call and keeps the contract visible
 *   in credential-free test lanes; the hosted proof establishes effect.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path
 *   Internal:  supabase/migrations/20260726200000_anon_closure_tranche_a.sql
 *              supabase/rollbacks/20260726200000_anon_closure_tranche_a.rollback.sql
 *   Data:      reads  → migration + rollback source text
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This proves INTENT, not EFFECT. It cannot tell you the revoke actually
 *     applied — only that the source still asks for it. Live verification is the
 *     apply-window step plus supabase/tests/anon_closure_tranche_a.test.js.
 *   - Placed in tests/qa/unit/ so the source contract remains credential-free
 *     and independent of hosted database availability.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Derived from this file's location rather than the working directory, so the
// test resolves the same way however the lane runner is invoked.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MIGRATION = join(ROOT, 'supabase/migrations/20260726200000_anon_closure_tranche_a.sql');
const ROLLBACK = join(ROOT, 'supabase/rollbacks/20260726200000_anon_closure_tranche_a.rollback.sql');

const read = (p) => readFileSync(p, 'utf8');
const norm = (s) => s.replace(/\s+/g, ' ').toLowerCase();

describe('anon closure tranche (a) — migration source contract', () => {
  const sql = norm(read(MIGRATION));

  it('exists alongside a rollback (database-standard.md §6)', () => {
    expect(existsSync(MIGRATION)).toBe(true);
    expect(existsSync(ROLLBACK)).toBe(true);
  });

  it('drops both always-true policies', () => {
    expect(sql).toContain('drop policy if exists automation_settings_all');
    expect(sql).toContain('drop policy if exists email_suppressions_all');
  });

  it('revokes browser-role table access on both tables', () => {
    for (const table of ['automation_settings', 'email_suppressions']) {
      expect(sql).toContain(`revoke all on table public.${table} from public, anon, authenticated`);
    }
  });

  it('leaves RLS enabled rather than relying on the revoke alone', () => {
    for (const table of ['automation_settings', 'email_suppressions']) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
    }
  });

  it('gates the SMS kill switch to admin, excluding external accounts', () => {
    // The whole point: closing the table is not enough, because
    // set_automation_setting is granted to `authenticated`.
    expect(sql).toContain("if p_key = 'sms_sending_enabled' then");
    expect(sql).toContain('not_authorized: sms_sending_enabled is admin only');
    expect(sql).toContain('and not is_external');
  });

  it('preserves the frozen Phase 4d signature (crm-wave-ownership.md §3)', () => {
    expect(sql).toContain('set_automation_setting( p_key text, p_value boolean, p_org_id uuid default null::uuid )');
    expect(sql).toContain('returns automation_settings');
  });

  it('revokes function EXECUTE from PUBLIC/anon BEFORE granting (managed-Supabase trap)', () => {
    const revokeAt = sql.indexOf('revoke execute on function public.set_automation_setting');
    const grantAt = sql.indexOf('grant execute on function public.set_automation_setting');
    expect(revokeAt).toBeGreaterThan(-1);
    expect(grantAt).toBeGreaterThan(-1);
    expect(revokeAt).toBeLessThan(grantAt);
  });

  it('does NOT touch the database-standard.md §2 public allowlist', () => {
    // Tranche (a) must stay away from anything a logged-out visitor legitimately
    // needs: login bootstrap, /status, public e-sign, public job-file read.
    // Breaking one of those is how this change would take down logins or signing.
    for (const forbidden of [
      'sign_requests',
      'document_templates',
      'get_crm_build_progress',
      'crm_build_phases',
      'job_documents',
      'feature_flags',
      'employees',
    ]) {
      expect(sql).not.toContain(`revoke all on table public.${forbidden}`);
      expect(sql).not.toContain(`drop policy if exists ${forbidden}`);
    }
  });

  it('pins search_path on the replaced definer', () => {
    expect(sql).toContain("set search_path to 'public'");
  });

  it('records WHO changed a setting, in the same transaction', () => {
    // consent-path-auditor finding #5: without this there is no actor/timestamp
    // trail for arming customer texting. TCPA penalties are per message and
    // incident response starts with "who did this".
    expect(sql).toContain('insert into system_events');
    expect(sql).toContain("'automation_setting_changed'");
    expect(sql).toContain('select e.id into v_actor from employees e where e.auth_user_id = auth.uid()');
  });

  it('captures the full armed state when the kill switch goes ON', () => {
    // Flipping sms_sending_enabled does not enable one thing - every pre-armed
    // automation goes live at that instant, and one org already has
    // missed_call_textback_enabled = true waiting.
    expect(sql).toContain("when p_key = 'sms_sending_enabled' and p_value then to_jsonb(v_row)");
  });

  it('does not swallow an audit failure', () => {
    // No exception handler around the audit write: if we cannot record who armed
    // texting, the change must not commit.
    const body = sql.slice(sql.indexOf('create or replace function public.set_automation_setting'));
    expect(body.slice(0, body.indexOf('$function$;'))).not.toContain('exception when');
  });
});

describe('anon closure tranche (a) — rollback source contract', () => {
  const sql = norm(read(ROLLBACK));

  it('restores both policies verbatim', () => {
    expect(sql).toContain('create policy automation_settings_all');
    expect(sql).toContain('create policy email_suppressions_all');
    expect(sql).toContain('using (true) with check (true)');
  });

  it('re-grants both tables to the browser roles', () => {
    expect(sql).toContain('on table public.automation_settings to anon, authenticated');
    expect(sql).toContain('on table public.email_suppressions to anon, authenticated');
  });

  it('restores set_automation_setting without the authorization block', () => {
    expect(sql).toContain('create or replace function public.set_automation_setting');
    expect(sql).not.toContain('not_authorized: sms_sending_enabled is admin only');
  });
});
