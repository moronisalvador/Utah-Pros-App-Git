/**
 * ════════════════════════════════════════════════
 * FILE: transcribe-call.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Turns a recorded phone call into written text. Our CallRail plan doesn't
 *   hand us transcripts through its API (that costs $110/month extra), so this
 *   grabs the call's audio, sends it to Deepgram — an AI transcription service —
 *   and saves the written-out conversation onto the lead, with each speaker
 *   labeled. Can do one call at a time (a "Transcribe" button in the Call Log)
 *   or catch up the last N days of calls in one run.
 *
 * ENDPOINT:
 *   POST /api/transcribe-call   (authenticated — Supabase Bearer)
 *        body: { lead_id }                 — transcribe one call, OR
 *              { backfill: true, days?: 30 } — transcribe every recent call that
 *                                              has a recording but no transcript.
 *
 * DEPENDS ON:
 *   Packages:      none (platform fetch)
 *   Internal:      ../lib/supabase.js, ../lib/cors.js, ../lib/google-drive.js
 *                  (getActorEmployee), ../lib/callrail-api.js (resolveCallRecording),
 *                  ../lib/deepgram.js (formatDeepgramTranscript)
 *   External API:  CallRail (the call's recording), Deepgram (api.deepgram.com)
 *   Data:          reads  → inbound_leads (recording_url), integration_credentials
 *                           (provider='deepgram' + provider='callrail' keys)
 *                  writes → inbound_leads.transcription (via set_lead_transcription
 *                           RPC), system_events (via that RPC), worker_runs
 *
 * NOTES / GOTCHAS:
 *   - We hand Deepgram the SIGNED CDN URL when CallRail gives us one, so Deepgram
 *     fetches the audio itself and we don't buffer a long call in the Worker.
 *     Only when CallRail streams audio directly do we download the bytes and POST
 *     them (rare; still bounded by the recording length).
 *   - SSRF guard: only ever resolves an api.callrail.com recording URL, matching
 *     callrail-recording.js.
 *   - Backfill is hard-capped (MAX_BACKFILL) so a bad filter can't fan out into
 *     thousands of paid Deepgram calls. Logs one worker_runs row per invocation.
 * ════════════════════════════════════════════════
 */

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { supabase } from '../lib/supabase.js';
import { getActorEmployee } from '../lib/google-drive.js';
import { resolveCallRecording } from '../lib/callrail-api.js';
import { formatDeepgramTranscript } from '../lib/deepgram.js';

const MAX_BACKFILL = 200; // hard cap — guards against a runaway paid-API fan-out
const DEEPGRAM_URL =
  'https://api.deepgram.com/v1/listen?model=nova-2&diarize=true&punctuate=true&smart_format=true';

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

// ─── SECTION: Helpers ──────────────

// Transcribe one lead's recording and store it. Returns the transcript length;
// throws with a precise reason so the caller can log/surface it.
async function transcribeLead(db, lead, callrailKey, deepgramKey) {
  const recUrl = lead.recording_url;
  if (!recUrl || !/^https:\/\/api\.callrail\.com\//.test(recUrl)) {
    throw new Error('no/invalid recording URL');
  }

  const rec = await resolveCallRecording(callrailKey, recUrl);

  let dgRes;
  if (rec.kind === 'url') {
    // Preferred: let Deepgram fetch the signed URL itself (no Worker buffering).
    dgRes = await fetch(DEEPGRAM_URL, {
      method: 'POST',
      headers: { Authorization: `Token ${deepgramKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: rec.url }),
    });
  } else if (rec.kind === 'stream') {
    // CallRail streamed audio directly — POST the bytes.
    const audio = await rec.response.arrayBuffer();
    dgRes = await fetch(DEEPGRAM_URL, {
      method: 'POST',
      headers: { Authorization: `Token ${deepgramKey}`, 'Content-Type': rec.contentType || 'audio/mpeg' },
      body: audio,
    });
  } else {
    throw new Error(`recording unavailable (${rec.reason}${rec.status ? ` ${rec.status}` : ''})`);
  }

  if (!dgRes.ok) {
    const detail = (await dgRes.text().catch(() => '')).slice(0, 300);
    throw new Error(`Deepgram ${dgRes.status}: ${detail}`);
  }

  const json = await dgRes.json();
  const text = formatDeepgramTranscript(json);
  if (!text) throw new Error('Deepgram returned an empty transcript');

  await db.rpc('set_lead_transcription', {
    p_lead_id: lead.id,
    p_transcription: text,
    p_source: 'deepgram',
  });
  return { id: lead.id, chars: text.length, transcription: text };
}

// ─── SECTION: Handler ──────────────

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = supabase(env);
  const startedAt = new Date().toISOString();

  const employee = await getActorEmployee(request, env, db);
  if (!employee) return jsonResponse({ error: 'Unauthorized' }, 401, request, env);

  const body = await request.json().catch(() => ({}));

  const [dgCred] = await db.select('integration_credentials', `provider=eq.deepgram&select=access_token`);
  const deepgramKey = dgCred?.access_token;
  if (!deepgramKey) {
    return jsonResponse({ error: 'Deepgram not connected (no API key saved)' }, 400, request, env);
  }

  const [crCred] = await db.select('integration_credentials', `provider=eq.callrail&select=access_token`);
  const callrailKey = crCred?.access_token;
  if (!callrailKey) {
    return jsonResponse({ error: 'CallRail not connected (no API key saved)' }, 400, request, env);
  }

  // Build the work list — one lead, or a bounded backfill of recent untranscribed calls.
  let leads;
  try {
    if (body.backfill) {
      const days = Number(body.days) > 0 ? Number(body.days) : 30;
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      leads = await db.select(
        'inbound_leads',
        `source_type=eq.call&recording_url=not.is.null&transcription=is.null&occurred_at=gte.${startDate}` +
          `&select=id,recording_url&order=occurred_at.desc&limit=${MAX_BACKFILL}`
      );
    } else if (body.lead_id) {
      // Select `transcription` too so we can short-circuit an already-transcribed
      // lead server-side (idempotency guard — see the loop below).
      leads = await db.select('inbound_leads', `id=eq.${body.lead_id}&select=id,recording_url,transcription`);
    } else {
      return jsonResponse({ error: 'Provide lead_id or backfill:true' }, 400, request, env);
    }
  } catch {
    return jsonResponse({ error: 'Failed to load leads' }, 500, request, env);
  }

  leads = leads || [];
  let processed = 0;
  let skipped = 0;
  const errors = [];
  let single = null;

  for (const lead of leads) {
    // Idempotency / don't-double-charge guard: never re-transcribe a lead that
    // already has a transcript unless the caller explicitly forces it. (The
    // backfill branch already filters transcription=is.null, so this only bites
    // a re-POST of the single-lead path — a paid Deepgram call avoided.)
    if (lead.transcription && !body.force) {
      skipped++;
      single = { id: lead.id, chars: lead.transcription.length, transcription: lead.transcription };
      continue;
    }
    try {
      const r = await transcribeLead(db, lead, callrailKey, deepgramKey);
      processed++;
      single = r;
    } catch (e) {
      errors.push({ id: lead.id, error: String(e.message || e).slice(0, 200) });
    }
  }

  await db.insert('worker_runs', {
    worker_name: 'transcribe-call',
    status: errors.length && !processed ? 'error' : 'completed',
    records_processed: processed,
    error_message: errors.length ? JSON.stringify(errors).slice(0, 500) : null,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
  });

  return jsonResponse(
    {
      ok: processed > 0 || skipped > 0 || leads.length === 0,
      processed,
      skipped,
      errored: errors.length,
      errors: errors.slice(0, 10),
      // On a single-lead request, hand the transcript back (freshly made OR the
      // existing one when skipped) so the UI updates inline either way.
      transcription: leads.length === 1 && single ? single.transcription : undefined,
    },
    200,
    request,
    env
  );
}
