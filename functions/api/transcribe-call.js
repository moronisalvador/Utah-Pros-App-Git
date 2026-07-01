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
 *   Data:          reads  → inbound_leads (recording_url, transcription,
 *                           transcript_analysis), integration_credentials
 *                           (provider='deepgram' + provider='callrail' keys)
 *                  writes → inbound_leads.transcription + transcript_analysis (via
 *                           set_lead_transcription RPC); inbound_leads.caller_name +
 *                           a blank linked contact's name (via set_lead_caller_name);
 *                           system_events, worker_runs
 *   External API:  CallRail (recording), Deepgram (transcription), Anthropic
 *                  (Claude Haiku — names the Agent/Customer speakers, best-effort)
 *
 * NOTES / GOTCHAS:
 *   - Requests nova-3 + diarize + Audio Intelligence (summary/sentiment/topics/
 *     entities) in one call. CallRail gives us a MONO recording, so `multichannel`
 *     is intentionally NOT requested (on a 1-channel file it suppresses diarization);
 *     diarize separates the two voices, and when mono defeats it (one speaker),
 *     resegmentSpeakers() rebuilds the turns with Claude. The structured result
 *     (turns + intelligence) is built by buildTranscriptAnalysis() and stored in
 *     inbound_leads.transcript_analysis; the flat text stays too.
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
import { formatDeepgramTranscript, buildTranscriptAnalysis } from '../lib/deepgram.js';
import {
  buildSpeakerPrompt, parseSpeakerIdentities, applySpeakerIdentities,
  needsResegment, buildResegmentPrompt, parseResegmentedTurns,
} from '../lib/speakerNaming.js';

const MAX_BACKFILL = 200; // hard cap — guards against a runaway paid-API fan-out
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const NAMING_MODEL = 'claude-haiku-4-5-20251001'; // cheap/fast — a simple extraction
const NAMING_SYSTEM = `You label the speakers in a transcript of an INBOUND phone call to Utah Pros Restoration (a water/fire/mold restoration company). One speaker is the company representative (role "agent"); the other is the caller (role "customer"). On an inbound call the agent almost always speaks first with a company greeting.

Return ONLY a JSON object (no prose, no markdown) of exactly this shape:
{"speakers":{"<label>":{"role":"agent"|"customer","name":<first name or null>}, ...},"caller_name":<the CUSTOMER's first name or null>}

Use the EXACT speaker labels from the transcript as the keys. Only set a name if the person actually states their name in the call — otherwise null. A name is a person's name, never a company name.`;
// nova-3 (best accuracy) + diarize (speaker separation) + utterances (per-turn
// segments) + Audio Intelligence (summary/sentiment/topics/entities), one request.
// NOTE: `multichannel` was DROPPED — CallRail hands us a MONO recording (both
// voices on one channel), and multichannel on a 1-channel file makes Deepgram
// treat the whole call as a single "channel 0" speaker, SUPPRESSING diarization.
// diarize alone gives it a fair shot at splitting the two voices; when it still
// can't (mono is hard), needsResegment → Claude rebuilds the turns (see below).
const DEEPGRAM_URL =
  'https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&punctuate=true' +
  '&utterances=true&diarize=true' +
  '&summarize=v2&sentiment=true&topics=true&detect_entities=true';

// System prompt for the re-segmentation pass (mono-recording rescue). Shares the
// Agent/Customer framing with NAMING_SYSTEM but asks Claude to REBUILD the turns.
const RESEGMENT_SYSTEM = `You are given a transcript of an INBOUND phone call to Utah Pros Restoration (a water/fire/mold restoration company) that was NOT split by speaker. One speaker is the company representative (role "agent"); the other is the caller (role "customer"). On an inbound call the agent almost always speaks first with a company greeting. Split the words into an ordered list of speaker turns and label each. Return ONLY the requested JSON — no prose, no markdown.`;

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

// ─── SECTION: Helpers ──────────────

// Best-effort: ask Claude which speaker is the Agent vs the Customer and each
// person's name, then relabel the analysis turns. Returns { analysis, callerName }.
// Any failure (no key, API error, unparseable answer) leaves the analysis as-is —
// naming is an enrichment, never a hard dependency of transcription.
async function nameSpeakers(env, analysis) {
  const turns = analysis?.turns || [];
  const prompt = buildSpeakerPrompt(turns);
  if (!env.ANTHROPIC_API_KEY || !prompt) return { analysis, callerName: null };
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: NAMING_MODEL, max_tokens: 400, system: NAMING_SYSTEM, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) return { analysis, callerName: null };
    const data = await res.json().catch(() => null);
    const out = (data?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const identities = parseSpeakerIdentities(out);
    if (!identities) return { analysis, callerName: null };
    return { analysis: applySpeakerIdentities(analysis, identities), callerName: identities.caller_name };
  } catch {
    return { analysis, callerName: null };
  }
}

// Mono-recording rescue: when diarization collapsed the whole call into ONE
// speaker (CallRail gives us mono), relabeling can't help — there's nothing to
// separate. So ask Claude to REBUILD the Agent/Customer turns from the raw
// transcript. Same best-effort contract as nameSpeakers: any failure (no key,
// API error, unparseable answer) returns the analysis unchanged.
async function resegmentSpeakers(env, analysis, transcriptText) {
  const prompt = buildResegmentPrompt(transcriptText);
  if (!env.ANTHROPIC_API_KEY || !prompt) return { analysis, callerName: null };
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: NAMING_MODEL, max_tokens: 4096, system: RESEGMENT_SYSTEM, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) return { analysis, callerName: null };
    const data = await res.json().catch(() => null);
    const out = (data?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const parsed = parseResegmentedTurns(out);
    if (!parsed) return { analysis, callerName: null };
    return { analysis: { ...analysis, turns: parsed.turns, speakerMode: 'resegment' }, callerName: parsed.caller_name };
  } catch {
    return { analysis, callerName: null };
  }
}

// Transcribe one lead's recording and store it. Returns the transcript length;
// throws with a precise reason so the caller can log/surface it.
async function transcribeLead(db, env, lead, callrailKey, deepgramKey) {
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
  // NEVER store text with a null analysis: the backfill re-selects rows where
  // transcript_analysis IS NULL, so a null here would re-transcribe (re-bill) the
  // row on every run. buildTranscriptAnalysis is aligned to be non-null whenever
  // `text` is, but keep a sentinel as a hard backstop against Deepgram shape drift.
  let analysis =
    buildTranscriptAnalysis(json) ||
    { model: 'nova-3', speakerMode: 'text', turns: [], summary: null, sentiment: null, topics: [], entities: [] };

  // Separate the speakers (Agent/Customer + real names) — best-effort enrichment.
  // Normally diarization gives ≥2 speakers and we just relabel them. But CallRail's
  // MONO recording can collapse the call into ONE speaker — then rebuild the turns
  // from the transcript with Claude instead of relabeling nothing.
  let callerName = null;
  if (needsResegment(analysis)) {
    const r = await resegmentSpeakers(env, analysis, text);
    analysis = r.analysis;
    callerName = r.callerName;
  } else {
    const named = await nameSpeakers(env, analysis);
    analysis = named.analysis;
    callerName = named.callerName;
  }

  await db.rpc('set_lead_transcription', {
    p_lead_id: lead.id,
    p_transcription: text,
    p_source: 'deepgram',
    p_analysis: analysis,
  });

  // Auto-name the lead from the caller's detected name (fills caller_name; backfills
  // a linked contact's name only if blank; never creates a contact). Best-effort.
  if (callerName) {
    try {
      await db.rpc('set_lead_caller_name', { p_lead_id: lead.id, p_name: callerName });
    } catch { /* naming the lead is a bonus, not a reason to fail the transcription */ }
  }

  return { id: lead.id, chars: text.length, transcription: text, analysis, callerName: callerName || null };
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
      // Default: target calls that lack a transcript OR the structured analysis, so a
      // row transcribed before an upgrade gets re-enriched exactly once (then has both
      // and is skipped) — avoids re-charging fully-processed calls. With `force:true`
      // re-process EVERY recent call (e.g. to apply speaker naming / a new layout to
      // already-transcribed rows) — still capped at MAX_BACKFILL.
      const freshOnly = body.force ? '' : '&or=(transcription.is.null,transcript_analysis.is.null)';
      leads = await db.select(
        'inbound_leads',
        `source_type=eq.call&recording_url=not.is.null${freshOnly}&occurred_at=gte.${startDate}` +
          `&select=id,recording_url&order=occurred_at.desc&limit=${MAX_BACKFILL}`
      );
    } else if (body.lead_id) {
      // Select transcription + analysis too so we can short-circuit an already-fully-
      // processed lead server-side (idempotency guard — see the loop below).
      leads = await db.select('inbound_leads', `id=eq.${body.lead_id}&select=id,recording_url,transcription,transcript_analysis`);
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
    // Idempotency / don't-double-charge guard: skip a lead that already has BOTH a
    // transcript AND the structured analysis, unless the caller forces it. (A row
    // with text but no analysis — transcribed before v2 — is intentionally NOT
    // skipped so it gets re-enriched once with nova-3 + intelligence.)
    if (lead.transcription && lead.transcript_analysis && !body.force) {
      skipped++;
      single = { id: lead.id, chars: lead.transcription.length, transcription: lead.transcription, analysis: lead.transcript_analysis };
      continue;
    }
    try {
      const r = await transcribeLead(db, env, lead, callrailKey, deepgramKey);
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
      // On a single-lead request, hand the transcript + analysis back (freshly made
      // OR the existing one when skipped) so the UI updates inline either way.
      transcription: leads.length === 1 && single ? single.transcription : undefined,
      analysis: leads.length === 1 && single ? single.analysis : undefined,
      callerName: leads.length === 1 && single ? (single.callerName || null) : undefined,
    },
    200,
    request,
    env
  );
}
