/**
 * ════════════════════════════════════════════════
 * FILE: recording-source-migration.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Locks the S1e recording-source migration, rollback, worker source reads,
 *   browser compatibility marker, and company-wide authorization decision
 *   without connecting to Supabase or a provider.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path, node:url
 *   Internal:  S1e SQL, CallRail/transcription Workers, exact UI consumers
 *   Data:      reads → repository source only
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This is credential-free static evidence. Live role proof remains an
 *     owner-authorized apply-window gate.
 * ════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

const migration = read('supabase/migrations/20260726183409_inbound_lead_recording_source_boundary.sql');
const rollback = read('supabase/rollbacks/20260726183409_inbound_lead_recording_source_boundary.rollback.sql');
const recordingWorker = read('functions/api/callrail-recording.js');
const recordingTests = read('functions/api/callrail-recording.test.js');
const transcriptionWorker = read('functions/api/transcribe-call.js');
const callrailMapper = read('functions/lib/callrail.js');
const callrailBackfill = read('functions/api/callrail-backfill.js');
const mobileConsumer = read('src/components/admin-mobile/leads/LeadRow.jsx');
const desktopConsumer = read('src/pages/crm/CrmCallLog.jsx');
const preflightSql = read('supabase/tests/inbound_lead_recording_source_preflight.sql');
const postApplySql = read('supabase/tests/inbound_lead_recording_source_post_apply.sql');

describe('S1e recording-source database boundary', () => {
  it('pins the exact live RPC, table ACL, policy and trigger-free preconditions', () => {
    expect(migration).toContain("pg_get_function_identity_arguments(p.oid) = 'p_limit integer'");
    expect(migration).toContain("md5((SELECT p.prosrc FROM pg_proc p WHERE p.oid = v_oid)) <> '8e9119ed1af57bd45c6af4ed227ef38f'");
    expect(migration).toContain('{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}');
    expect(migration).toContain("policyname = 'inbound_leads_all'");
    expect(migration).toContain("c.relname = 'inbound_leads'");
    expect(migration).toContain('WHERE NOT t.tgisinternal');
  });

  it('moves raw URLs to a forced-RLS service-only table and leaves an opaque marker', () => {
    expect(migration).toContain('CREATE TABLE public.inbound_lead_recording_sources');
    expect(migration).toContain('ALTER TABLE public.inbound_lead_recording_sources FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('REVOKE ALL ON TABLE public.inbound_lead_recording_sources FROM PUBLIC, anon, authenticated');
    expect(migration).toContain('TO service_role');
    expect(migration).toContain('INSERT INTO public.inbound_lead_recording_sources (lead_id, recording_url, updated_at)');
    expect(migration).toContain("SET recording_url = 'upr-recording://available'");
    expect(migration).toContain("SET recording_url = 'upr-recording://available'");
    expect(migration).toContain("recording_url <> 'upr-recording://available'");
  });

  it('captures future writes after IDs exist and scrubs composite payloads before storage', () => {
    expect(migration).toContain('CREATE TRIGGER protect_inbound_lead_recording_source');
    expect(migration).toContain('AFTER INSERT OR UPDATE OF recording_url ON public.inbound_leads');
    expect(migration).toContain('ON CONFLICT (lead_id) DO UPDATE');
    expect(migration).toContain('CREATE FUNCTION public.strip_recording_sources(p_value jsonb)');
    expect(migration).toContain("WHERE e.key NOT IN ('recording', 'recording_url')");
    expect(migration).toContain('CREATE TRIGGER sanitize_inbound_lead_recording_payload');
    expect(migration).toContain('BEFORE INSERT OR UPDATE OF raw_payload ON public.inbound_leads');
    expect(migration).toContain('REVOKE EXECUTE ON FUNCTION public.protect_inbound_lead_recording_source()');
    expect(migration).toContain('FROM PUBLIC, anon, authenticated');
    expect(callrailMapper).toContain('withoutRecordingSources(body)');
    expect(callrailBackfill).toContain('withoutRecordingSources(c)');
  });

  it('reduces direct access to active internal company-wide reads', () => {
    expect(migration).toContain('REVOKE ALL ON TABLE public.inbound_leads FROM anon');
    expect(migration).toContain('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER');
    expect(migration).toContain('GRANT SELECT ON TABLE public.inbound_leads TO authenticated');
    expect(migration).toContain('CREATE POLICY inbound_leads_active_internal_select');
    expect(migration).toContain('e.auth_user_id = (SELECT auth.uid())');
    expect(migration).toContain('AND e.is_active = true');
    expect(migration).toContain('AND e.is_external = false');
    expect(migration).not.toMatch(/inbound_leads_active_internal_select[\s\S]*org_id\s*=/);
  });

  it('preserves the RPC signature and requires admin or crm_call_log capability', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.get_inbound_leads(p_limit integer DEFAULT 100)');
    expect(migration).toContain('RETURNS jsonb');
    expect(migration).toContain("v_employee.role::text = 'admin'");
    expect(migration).toContain("epa.nav_key = 'crm_call_log'");
    expect(migration).toContain("np.nav_key = 'crm_call_log'");
    expect(migration).toContain("RAISE EXCEPTION 'insufficient privilege'");
    expect(migration).toContain("USING ERRCODE = '42501'");
    expect(migration).toContain('LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500))');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.get_inbound_leads(integer)');
    expect(migration).toContain('TO authenticated, service_role');
    expect(migration).toContain('REVOKE EXECUTE ON FUNCTION public.upsert_lead_from_callrail(');
    expect(migration).toContain(') FROM PUBLIC, anon, authenticated;');
  });

  it('keeps both UIs on lead-id proxy playback and truthy availability only', () => {
    for (const consumer of [mobileConsumer, desktopConsumer]) {
      expect(consumer).toContain('lead.recording_url');
      expect(consumer).toContain('/api/callrail-recording?lead_id=');
      expect(consumer).not.toContain('fetch(lead.recording_url');
    }
  });

  it('makes approved server consumers read the service-only source table', () => {
    expect(recordingWorker).toContain("'inbound_lead_recording_sources'");
    expect(recordingWorker).toContain('`lead_id=eq.${leadId}&select=recording_url&limit=1`');
    expect(transcriptionWorker).toContain("'inbound_lead_recording_sources'");
    expect(transcriptionWorker).toContain('select=lead_id,recording_url');
    expect(recordingWorker).toContain('lead.recording_url');
    expect(recordingWorker).toContain('isAllowedRecordingUrl(lead.recording_url)');
    expect(transcriptionWorker).toContain('isAllowedRecordingUrl(lead.recording_url)');
    expect(recordingTests).toContain("if (table === 'inbound_lead_recording_sources')");
  });

  it('preserves the approved CallRail validation, audio and error contracts', () => {
    expect(recordingWorker).toContain('isAllowedRecordingUrl(recUrl)');
    expect(recordingWorker).toContain('extractCallId(recUrl)');
    expect(recordingWorker).toContain("lead?.source_type !== 'call'");
    expect(recordingWorker).toContain("error: 'Unsupported recording URL'");
    expect(recordingWorker).toContain("error: 'No recording for this lead'");
    expect(recordingWorker).toContain("rec.kind === 'stream'");
    expect(recordingWorker).toContain("rec.kind === 'url'");
    expect(recordingWorker).toContain("'Cache-Control': 'private, max-age=300'");
  });

  it('provides a drift-guarded rollback that restores exact prior exposure', () => {
    expect(rollback).toContain('DROP TRIGGER protect_inbound_lead_recording_source');
    expect(rollback).toContain('SET recording_url = src.recording_url');
    expect(rollback).toContain('LANGUAGE sql');
    expect(rollback).toContain("8e9119ed1af57bd45c6af4ed227ef38f");
    expect(rollback).toContain('CREATE POLICY inbound_leads_all');
    expect(rollback).toContain('GRANT ALL ON TABLE public.inbound_leads TO anon, authenticated');
    expect(rollback).toContain('DROP TABLE public.inbound_lead_recording_sources');
    expect(rollback).toContain('DROP FUNCTION public.strip_recording_sources(jsonb)');
  });

  it('provides value-free apply-window catalog proofs for browser denial and service access', () => {
    expect(preflightSql).toContain("md5((SELECT prosrc FROM pg_proc WHERE oid = v_get))");
    expect(preflightSql).toContain("to_regclass('public.inbound_lead_recording_sources') IS NULL");
    expect(postApplySql).toContain("NOT has_table_privilege('authenticated', 'public.inbound_lead_recording_sources', 'SELECT')");
    expect(postApplySql).toContain("has_table_privilege('service_role', 'public.inbound_lead_recording_sources', 'SELECT')");
    expect(postApplySql).toContain("NOT has_function_privilege('authenticated', v_upsert, 'EXECUTE')");
    for (const sql of [preflightSql, postApplySql]) {
      expect(sql).not.toMatch(/SELECT\s+(recording_url|raw_payload)/i);
      expect(sql).not.toContain('integration_credentials');
    }
  });

  it('does not touch the explicitly separate residual boundaries', () => {
    for (const sql of [migration, rollback]) {
      expect(sql).not.toContain('notify_emit');
      expect(sql).not.toContain('create_notification');
      expect(sql).not.toContain('qbo_attachments');
      expect(sql).not.toContain('storage.objects');
      expect(sql).not.toContain('notification');
    }
  });
});
