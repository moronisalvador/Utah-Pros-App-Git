/**
 * ════════════════════════════════════════════════
 * FILE: qbo-estimate-command-boundary.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks that every required estimate safety boundary is present in the
 *   committed source. It reads files only and needs no credentials, database,
 *   browser, or QuickBooks connection.
 *
 * DEPENDS ON:
 *   Packages:  node:fs, node:path, node:url, vitest
 *   Internal:  estimate/customer workers, browser helper, migration, rollback, proof, qualifier
 *   Data:      reads  → none
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Runtime database behavior is covered separately by the isolated qualifier.
 * ════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const migration = read('supabase/migrations/20260810182855_estimate_qbo_command_boundary.sql');
const rollback = read('supabase/rollbacks/20260810182855_estimate_qbo_command_boundary.rollback.sql');
const worker = read('functions/api/qbo-estimate.js');
const customerSync = read('functions/api/qbo-sync-customer.js');
const commands = read('functions/lib/qbo-estimate-commands.js');
const quickbooks = read('functions/lib/quickbooks.js');
const browser = read('src/lib/qboEstimateWorker.js');
const desktop = read('src/pages/EstimateEditor.jsx');
const nativeReview = read('src/pages/tech/NativeOopEstimateReview.jsx');
const isolated = read('supabase/tests/qbo_estimate_command_boundary_isolated.sql');
const qualifier = read('scripts/qa/qualify-qbo-estimate-command-boundary-local.mjs');

describe('QBO estimate command boundary', () => {
  it('uses forced-RLS private ledgers and NULL-safe service-only RPCs', () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.qbo_estimate_commands[\s\S]*request_hash text NOT NULL[\s\S]*intent_payload jsonb NOT NULL/);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.qbo_estimate_command_reservations[\s\S]*request_hash text NOT NULL[\s\S]*prerequisite_payload jsonb NOT NULL/);
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY;[\s\S]*FORCE ROW LEVEL SECURITY/);
    expect(migration).toMatch(/REVOKE ALL ON TABLE public\.qbo_estimate_commands FROM PUBLIC, anon, authenticated/);
    expect(migration).toMatch(/REVOKE EXECUTE[\s\S]*reserve_qbo_estimate_command[\s\S]*FROM PUBLIC,anon,authenticated/);
    expect(migration).not.toMatch(/DROP POLICY/i);
    expect(migration).toMatch(/DO \$estimate_command_service_policies\$[\s\S]*QBO_ESTIMATE_COMMAND_POLICY_SHAPE_UNEXPECTED[\s\S]*CREATE POLICY %I ON public\.%I FOR ALL TO service_role USING \(true\) WITH CHECK \(true\)/);
    expect(migration).not.toMatch(/auth\.role\(\)\s*<>\s*'service_role'/);
    expect(migration.match(/auth\.role\(\) IS DISTINCT FROM 'service_role'/g)?.length).toBeGreaterThanOrEqual(7);
    expect(worker).toContain("import { fetchWithTimeout } from '../lib/http.js'");
    expect(worker).toContain('supabase(env, fetchWithTimeout)');
    expect(customerSync).toContain("import { fetchWithTimeout } from '../lib/http.js'");
    expect(customerSync).toContain('supabase(env, fetchWithTimeout)');
  });

  it('accepts only closed line mutations and never trusts client totals', () => {
    expect(worker).toContain("const PATCH_KEYS = new Set(['description', 'qbo_item_id', 'qbo_item_name', 'qbo_class_id', 'qbo_class_name', 'quantity', 'unit_price'])");
    expect(worker).toMatch(/LINE_KEYS = Object\.freeze\([\s\S]*create: new Set\(\['kind', 'patch'\]\)[\s\S]*reorder: new Set\(\['kind', 'ordered_line_ids'\]\)/);
    expect(worker).toMatch(/typeof value\.quantity !== 'number'[\s\S]*Number\.isFinite\(quantity\)/);
    expect(worker).toMatch(/function qboEstimateLineCents[\s\S]*quantity\.units \* rate\.units[\s\S]*return cents;[\s\S]*export function qboEstimateLineAmount[\s\S]*Number\(qboEstimateLineCents\(line\)\) \/ 100/);
    expect(worker).toMatch(/\(scaled % denominator\) \* 2n >= denominator/);
    expect(worker).toMatch(/totalCents = staged\.lines\.reduce[\s\S]*totalCents <= 0n/);
    expect(worker).not.toMatch(/Amount:\s*(?:line\.)?line_total/);
    expect(migration).not.toMatch(/INSERT INTO public\.estimate_line_items\([^)]*line_total/);
  });

  it('reserves a durable customer prerequisite and retains unknown self-heal outcomes', () => {
    const reserve = worker.indexOf('const reservation = await reserveQboEstimateCommand');
    const ensure = worker.indexOf('await ensureQboCustomer');
    const prepare = worker.indexOf('const prepared = await prepareQboEstimateCommand');
    expect(reserve).toBeGreaterThan(0);
    expect(ensure).toBeGreaterThan(reserve);
    expect(prepare).toBeGreaterThan(ensure);
    expect(worker).toContain("code: 'customer-prerequisite-unknown', retry_same_request: true");
    expect(worker).toMatch(/customerCreateRequestId\(realmId, preflight\.contactId, 'primary'\)/);
    expect(worker).toContain('ensureQboCustomer(request, env, contactId, { expectedRealmId: realmId })');
    expect(customerSync).toContain('expected_realm_id');
    expect(customerSync).toContain("code: 'qbo-realm-mismatch'");
    expect(customerSync).toContain('findExistingCustomer(env, contact, payload, { expectedRealmId })');
    expect(customerSync).toMatch(/createCustomer\(env, payload, \{[\s\S]*expectedRealmId/);
    expect(migration).toMatch(/prerequisite_payload=p_prerequisite[\s\S]*prerequisite-mismatch/);
    expect(migration).toContain('prerequisite-source-mismatch');
    expect(worker).toMatch(/reservation now fences line writes[\s\S]*loadEstimateSnapshot\(db, estimateId\)[\s\S]*buildEstimateCandidate/);
    expect(worker).toMatch(/provider_source_preimage: providerSourcePreimage/);
    expect(worker).toMatch(/document_line_preimage: staged\.documentPreimage[\s\S]*document_line_preimage_hash: await hashEstimateCommand/);
  });

  it('recovers durable commands before checking current QBO connectivity', () => {
    const existing = worker.indexOf('const existing = await getQboEstimateCommand');
    const connection = worker.indexOf('const conn = await getConnection(env);', existing);
    expect(existing).toBeGreaterThan(0);
    expect(connection).toBeGreaterThan(existing);
    expect(worker).toMatch(/existing\.status === 'prepared'[\s\S]*qbo-connection-unavailable[\s\S]*retry_same_request: true/);
  });

  it('never repeats an unsafe provider attempt and forwards the frozen Intuit request id', () => {
    const startCheck = worker.indexOf('started.started !== true');
    const provider = worker.indexOf("if (providerAction === 'create') result = await createEstimate");
    expect(startCheck).toBeGreaterThan(0);
    expect(provider).toBeGreaterThan(0);
    expect(worker).toMatch(/existing\.status === 'prepared'[\s\S]*startQboEstimateCommandAttempt/);
    expect(worker).toMatch(/provider_started[\s\S]*ambiguous-provider-outcome/);
    expect(worker).toContain('const providerOptions = { requestId: providerRequestId, expectedRealmId: realmId }');
    expect(worker).toContain('createEstimate(env, providerPayload, providerOptions)');
    expect(worker).toContain('updateEstimate(env, providerTargetId, providerPayload, providerOptions)');
    expect(worker).toContain('sendEstimate(env, providerTargetId, providerPayload.send_to, providerOptions)');
    expect(worker).toContain('deleteEstimate(env, providerTargetId, { ...providerOptions, missingIsSuccess: true })');
    expect(quickbooks).toMatch(/export async function getValidAccessToken\(env, \{ expectedRealmId \} = \{\}\)[\s\S]*qbo-realm-mismatch[\s\S]*refreshTokens/);
    expect(quickbooks).toContain('getValidAccessToken(env, { expectedRealmId })');
    expect(quickbooks).toMatch(/export async function createEstimate\(env, payload, \{ requestId, expectedRealmId \} = \{\}\)[\s\S]*method: 'POST', requestId, expectedRealmId/);
    expect(quickbooks).toMatch(/export async function sendEstimate\(env, qboEstimateId, sendTo, \{ requestId, expectedRealmId \} = \{\}\)/);
  });

  it('atomically fences terminal races and finalizes lines plus estimate metadata', () => {
    for (const status of ['approved', 'denied', 'paid']) expect(migration).toContain(`'${status}'`);
    expect(migration).toMatch(/converted_invoice_id IS NOT NULL OR e\.status IN \('approved','denied','paid'\)/);
    expect(migration).toContain("current_setting('upr.qbo_estimate_finalizer_command_id',true)");
    expect(migration).toContain("set_config('upr.qbo_estimate_finalizer_command_id',c.id::text,true)");
    expect(migration).toMatch(/Validate every provider-driving source[\s\S]*provider-source-mismatch[\s\S]*line-source-mismatch[\s\S]*INSERT INTO public\.estimate_line_items/);
    expect(migration).toMatch(/document_line_preimage[\s\S]*document-line-source-mismatch/);
    expect(migration).toMatch(/provider_source_preimage[\s\S]*provider-source-mismatch/);
    expect(migration).toMatch(/CREATE TRIGGER trg_estimates_guard_qbo_command BEFORE UPDATE ON public\.estimates FOR EACH ROW\s+EXECUTE FUNCTION/);
    expect(isolated).toMatch(/provider metadata bypassed active estimate reservation/);
    expect(isolated).toMatch(/finalizer accepted provider-source drift/);
    expect(migration).toMatch(/status='succeeded'[\s\S]*response_status=p_response_status,response_payload=p_response_payload[\s\S]*DELETE FROM public\.qbo_estimate_command_reservations/);
    expect(migration).toMatch(/qbo_emailed_at=now\(\)[\s\S]*sent_to_email=c\.provider_result->>'send_to'/);
    expect(migration).toMatch(/qbo_estimate_id=NULL[\s\S]*qbo_email_status=NULL/);
  });

  it('binds browser estimate creation attribution while preserving service callers and the signature', () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.create_estimate_for_contact\([\s\S]*p_created_by uuid DEFAULT NULL/);
    expect(migration).toMatch(/auth\.role\(\) IS NOT DISTINCT FROM 'service_role'[\s\S]*v_created_by:=p_created_by/);
    expect(migration).toMatch(/e\.auth_user_id=auth\.uid\(\)[\s\S]*e\.is_active IS TRUE[\s\S]*e\.is_external IS FALSE/);
    expect(migration).toMatch(/p_property_zip,v_created_by\)/);
    expect(rollback).toMatch(/SECURITY-STICKY[\s\S]*caller-controlled created_by is not a[\s\S]*safe rollback operation/);
    expect(rollback).not.toContain('CREATE OR REPLACE FUNCTION public.create_estimate_for_contact');
    expect(migration).not.toContain('CREATE OR REPLACE FUNCTION public.create_estimate_for_job');
  });

  it('requires UUIDv4 browser identities and routes every repository caller through the stable helper', () => {
    expect(commands).toContain('QBO_ESTIMATE_COMMAND_ID_RE');
    expect(commands).toMatch(/command\.request_hash === requestHash/);
    expect(worker).toMatch(/hashEstimateCommand\(\{ send_to: input\.sendTo, line_change: input\.lineChange \}\)/);
    expect(worker).toMatch(/qboEstimateCommandIdentityMatches\(existing, \{ estimateId, action, actor, realmId: existing\.realm_id, requestHash \}\)/);
    expect(migration).toMatch(/r\.request_hash=p_request_hash[\s\S]*c\.request_hash IS DISTINCT FROM p_request_hash/);
    expect(browser).toMatch(/crypto\?\.randomUUID|crypto\.randomUUID/);
    expect(browser).toContain("'Idempotency-Key': operationId");
    for (const caller of [desktop, nativeReview]) {
      expect(caller).toContain('callQboEstimateWorker');
      expect(caller).not.toMatch(/fetch\(['"]\/api\/qbo-estimate/);
    }
  });

  it('ships rollback refusal and isolated runtime proof without hosted access', () => {
    expect(rollback).toMatch(/QBO_ESTIMATE_RESERVATIONS_ACTIVE[\s\S]*QBO_ESTIMATE_COMMANDS_ACTIVE/);
    expect(rollback).not.toContain('DROP TABLE IF EXISTS public.qbo_estimate_commands');
    expect(rollback).toMatch(/financial audit evidence[\s\S]*GRANT SELECT ON TABLE public\.qbo_estimate_commands/);
    expect(isolated).toContain('claimless estimate reserve unexpectedly succeeded');
    expect(isolated).toContain('DO $optional_company_binding$');
    expect(isolated).toContain("VALUES (true, 'sandbox', 'realm', 1)");
    expect(isolated).toContain('same command accepted a changed request hash');
    expect(isolated).toContain('browser attribution trusted p_created_by');
    expect(isolated).toContain('service conversion bypassed active estimate reservation');
    expect(isolated).toContain('line finalizer replay inserted a duplicate');
    expect(isolated).toContain('no-change finalizer accepted full-document drift');
    expect(qualifier).toContain('refusing non-local Docker endpoint');
    expect(qualifier).toContain('qbo_estimate_command_boundary_isolated.sql');
    expect(qualifier).toContain('desktop/finalizer lock-order race failed');
    expect(qualifier).toContain('QBO_ESTIMATE_RESERVATIONS_ACTIVE');
    expect(qualifier).toContain('zero-attached network');
  });
});
