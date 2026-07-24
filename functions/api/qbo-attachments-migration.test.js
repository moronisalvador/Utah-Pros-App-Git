import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const attachments = readFileSync(
  new URL('../../supabase/migrations/20260724180000_qbo_attachments.sql', import.meta.url),
  'utf8',
);
const cron = readFileSync(
  new URL('../../supabase/migrations/20260724180100_qbo_payments_sync_cron.sql', import.meta.url),
  'utf8',
);

describe('qbo_attachments migration', () => {
  it('creates an additive, RLS-enabled table', () => {
    expect(attachments).toContain('CREATE TABLE IF NOT EXISTS public.qbo_attachments');
    expect(attachments).toContain('ENABLE ROW LEVEL SECURITY');
    expect(attachments).toContain('FOR SELECT TO authenticated');
  });

  it('scopes reads to active admin/manager employees (not a blanket authenticated policy)', () => {
    expect(attachments).toContain('NOT is_crm_partner(auth.uid())');
    expect(attachments).toContain('FROM public.employees e');
    expect(attachments).toContain('e.auth_user_id = auth.uid()');
    expect(attachments).toContain('e.is_active');
    expect(attachments).toContain("e.role IN ('admin', 'manager')");
    // Must NOT be the bare always-true form.
    expect(attachments).not.toMatch(/USING \(true\)/);
  });

  it('is idempotent on external + client keys (no duplicate attach / customer double-email)', () => {
    expect(attachments).toContain('CONSTRAINT qbo_attachments_qbo_id_unique UNIQUE (qbo_attachable_id)');
    expect(attachments).toContain('idempotency_key   text UNIQUE');
  });

  it('never stores file bytes or grants anon, and cascades from its parent', () => {
    expect(attachments).not.toMatch(/\banon\b/);
    expect(attachments).not.toMatch(/file_base64|file_bytes|file_content/i);
    expect(attachments).toContain('ON DELETE CASCADE');
    expect(attachments).toContain('qbo_attachments_one_parent');
  });

  it('has no INSERT/UPDATE/DELETE policy (writes are service-role worker only)', () => {
    expect(attachments).not.toMatch(/FOR (INSERT|UPDATE|DELETE)/);
  });

  it('states a concrete rollback', () => {
    expect(attachments).toContain('DROP TABLE IF EXISTS public.qbo_attachments');
  });
});

describe('qbo_payments_sync_cron migration', () => {
  it('schedules the hourly poller by a stable name', () => {
    expect(cron).toContain("cron.schedule('upr_qbo_payments_sync_hourly'");
    expect(cron).toContain('qbo_payments_sync_poll');
  });

  it('fails closed to an exact UPR worker-URL allowlist (no SSRF lever)', () => {
    expect(cron).toContain("'https://utahpros.app/api/qbo-payments-sync'");
    expect(cron).toContain("'https://dev.utahpros.app/api/qbo-payments-sync'");
    expect(cron).toContain('NOT IN (');
    expect(cron).toContain('RETURN;'); // no URL / no secret → silent no-op
  });

  it('carries the existing server-only secret, never a browser grant', () => {
    expect(cron).toContain("key = 'qbo_webhook_secret'");
    expect(cron).toContain("'x-webhook-secret', v_secret");
    expect(cron).toContain('REVOKE ALL ON FUNCTION public.qbo_payments_sync_poll() FROM PUBLIC, anon, authenticated, service_role;');
  });

  it('states a concrete rollback (unschedule + drop + config cleanup)', () => {
    expect(cron).toContain("cron.unschedule('upr_qbo_payments_sync_hourly')");
    expect(cron).toContain('DROP FUNCTION IF EXISTS public.qbo_payments_sync_poll()');
  });
});
