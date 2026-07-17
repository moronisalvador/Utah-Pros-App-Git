/**
 * ════════════════════════════════════════════════
 * FILE: sync-houzz.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   When someone creates a new reconstruction job in UPR, this hands the
 *   job and customer's info off to Houzz Pro (our reconstruction
 *   project-management tool) so a matching customer + project shows up
 *   over there automatically — nobody has to re-type it by hand. It works
 *   by POSTing to a Zapier webhook (a small automation set up in Zapier),
 *   which is the only way to reach Houzz Pro since it doesn't offer a
 *   public way for other apps to talk to it directly.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (Cloudflare Pages Function, POST /api/sync-houzz)
 *   Rendered by:  n/a (server-side worker, called from
 *                 src/pages/tech/TechNewJob.jsx and
 *                 src/components/CreateJobModal.jsx right after a
 *                 reconstruction-division job is created)
 *
 * DEPENDS ON:
 *   Packages:  none beyond the platform fetch/AbortSignal
 *   Internal:  ../lib/cors.js, ../lib/supabase.js, ../lib/auth.js,
 *              ../lib/http.js, ../lib/worker-runs.js
 *   Data:      reads  → jobs (division, address, contact info, job_number,
 *                        houzz_synced_at)
 *              writes → jobs (houzz_sync_status, houzz_synced_at,
 *                       houzz_sync_error); worker_runs (telemetry)
 *
 * NOTES / GOTCHAS:
 *   - Zapier's webhook only confirms it RECEIVED the data, not that Houzz
 *     Pro actually finished creating the project — the Zap itself runs a
 *     moment later, asynchronously. A "sent" status here means "handed off
 *     successfully," not "confirmed created in Houzz Pro."
 *   - Houzz Pro has no public API to read a created project's ID back, so
 *     there is no houzz_project_id column — this is a one-way, fire-once
 *     push, not a two-way sync.
 *   - Idempotent: if the job already has houzz_synced_at set, a repeat call
 *     is a no-op (skipped:true) unless { force: true } is passed — so a
 *     retry from the UI (or a double-click) never double-creates a Houzz
 *     Pro project.
 *   - Requires the HOUZZ_ZAPIER_WEBHOOK_URL secret in Cloudflare (both
 *     Production and Preview env sets). Without it, returns 501 so a
 *     misconfigured environment fails loudly instead of silently no-oping.
 * ════════════════════════════════════════════════
 */

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { supabase } from '../lib/supabase.js';
import { requireUser } from '../lib/auth.js';
import { fetchWithTimeout } from '../lib/http.js';
import { recordWorkerRun } from '../lib/worker-runs.js';

const JOB_FIELDS =
  'id,job_number,division,insured_name,address,city,state,zip,' +
  'client_email,client_phone,insurance_company,claim_number,type_of_loss,houzz_synced_at';

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const startedAt = new Date().toISOString();

  const auth = await requireUser(request, env);
  if (auth.error) return jsonResponse({ error: auth.error }, auth.status, request, env);

  let body = {};
  try { body = await request.json(); } catch { /* empty body */ }
  const jobId = body.job_id;
  if (!jobId) return jsonResponse({ error: 'job_id required' }, 400, request, env);

  const db = supabase(env);

  let job;
  try {
    const rows = await db.select('jobs', `id=eq.${jobId}&select=${JOB_FIELDS}&limit=1`);
    job = rows?.[0];
  } catch {
    return jsonResponse({ error: 'Job lookup failed' }, 500, request, env);
  }
  if (!job) return jsonResponse({ error: 'Job not found' }, 404, request, env);

  if (job.houzz_synced_at && !body.force) {
    return jsonResponse({ ok: true, skipped: true }, 200, request, env);
  }

  if (!env.HOUZZ_ZAPIER_WEBHOOK_URL) {
    return jsonResponse({ error: 'Houzz Pro sync is not configured' }, 501, request, env);
  }

  try {
    const res = await fetchWithTimeout(env.HOUZZ_ZAPIER_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: job.id,
        job_number: job.job_number,
        division: job.division,
        customer_name: job.insured_name,
        email: job.client_email,
        phone: job.client_phone,
        address: job.address,
        city: job.city,
        state: job.state,
        zip: job.zip,
        insurance_company: job.insurance_company,
        claim_number: job.claim_number,
        type_of_loss: job.type_of_loss,
      }),
    });

    if (!res.ok) throw new Error(`Zapier webhook returned ${res.status}`);

    await db.update('jobs', `id=eq.${job.id}`, {
      houzz_sync_status: 'sent',
      houzz_synced_at: new Date().toISOString(),
      houzz_sync_error: null,
    });
    await recordWorkerRun(db, {
      workerName: 'sync-houzz', status: 'completed', recordsProcessed: 1, startedAt,
    });
    return jsonResponse({ ok: true }, 200, request, env);
  } catch (e) {
    await db.update('jobs', `id=eq.${job.id}`, {
      houzz_sync_status: 'failed',
      houzz_sync_error: String(e.message || e).slice(0, 500),
    });
    await recordWorkerRun(db, {
      workerName: 'sync-houzz', status: 'error', errorMessage: e.message, startedAt,
    });
    return jsonResponse({ error: e.message }, 502, request, env);
  }
}
