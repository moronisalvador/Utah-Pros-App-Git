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
 *        body: { lead_id }                   — transcribe one call, OR
 *              { backfill: true, days?: 30 }   — transcribe every recent call that
 *                                                has a recording but no transcript, OR
 *              { reclassify: true, lead_id?, days?: 90, force?: false } — re-run the AI
 *                                                naming + clean-up passes against already-
 *                                                transcribed leads (no Deepgram/CallRail
 *                                                creds needed, no re-transcription cost).
 *                                                lead_id targets exactly one lead
 *                                                (bypasses days/force). Otherwise, default
 *                                                targets only leads whose stored analysis
 *                                                predates inspection_scheduled;
 *                                                force:true re-processes every matching
 *                                                call regardless (e.g. to pick up a
 *                                                naming-prompt improvement on leads
 *                                                already fully classified).
 *
 * DEPENDS ON:
 *   Packages:      none (platform fetch)
 *   Internal:      ../lib/supabase.js, ../lib/cors.js, ../lib/google-drive.js
 *                  (getActorEmployee), ../lib/callrail-api.js (resolveCallRecording),
 *                  ../lib/deepgram.js (formatDeepgramTranscript, turnsToFlatText),
 *                  ../lib/callCleanup.js (the clean-up + summarize pass)
 *   External API:  CallRail (the call's recording), Deepgram (api.deepgram.com)
 *   Data:          reads  → inbound_leads (recording_url, transcription,
 *                           transcript_analysis), integration_credentials
 *                           (provider='deepgram' + provider='callrail' keys)
 *                  writes → inbound_leads.transcription + transcript_analysis (via
 *                           set_lead_transcription RPC); inbound_leads.caller_name +
 *                           a blank linked contact's name (via set_lead_caller_name);
 *                           lead_pipeline_stage + lead_stage_history (via
 *                           crm_advance_lead_if_forward, when the AI detects an
 *                           inspection was scheduled); inbound_leads.spam_flag (via
 *                           set_lead_spam_flag, when the AI detects the caller never
 *                           responded); a linked contact's blank email/billing_address
 *                           (via set_lead_contact_details, when the AI pulls a clearly-
 *                           stated one off the call); system_events, worker_runs
 *   External API:  CallRail (recording), Deepgram (transcription), Anthropic
 *                  (Claude Haiku — names the Agent/Customer speakers, then cleans up
 *                  wording + writes the summary + flags inspection_scheduled/
 *                  caller_never_responded + extracts customer_email/customer_address;
 *                  all best-effort)
 *
 * NOTES / GOTCHAS:
 *   - cleanAndSummarize() also asks Claude: whether a real inspection/appointment was
 *     agreed to (inspection_scheduled — best-effort calls
 *     crm_advance_lead_if_forward(lead_id, 'Inspection Scheduled'), a SECURITY DEFINER
 *     RPC that never moves a lead backward, off a terminal Won/Lost stage, or a
 *     spam-flagged lead); whether the agent spoke but the caller never actually
 *     responded (caller_never_responded — best-effort calls set_lead_spam_flag to
 *     reliably auto-remove it from the pipeline); and the customer's email/address
 *     when clearly stated (customer_email/customer_address — best-effort calls
 *     set_lead_contact_details, which only fills a BLANK field on an ALREADY-linked
 *     contact and never creates one). Any of these failing never blocks the
 *     transcription write.
 *   - Requests nova-3 + diarize + Audio Intelligence (summary/sentiment/topics/
 *     entities) in one call. CallRail gives us a MONO recording, so `multichannel`
 *     is intentionally NOT requested (on a 1-channel file it suppresses diarization);
 *     diarize separates the two voices, and when mono defeats it (one speaker),
 *     resegmentSpeakers() rebuilds the turns with Claude. The structured result
 *     (turns + intelligence) is built by buildTranscriptAnalysis() and stored in
 *     inbound_leads.transcript_analysis; the flat text stays too.
 *   - After speaker naming/resegmentation, cleanAndSummarize() makes ONE MORE
 *     Claude call to (a) fix obvious speech-to-text mistakes turn-by-turn without
 *     changing what was said, and (b) replace Deepgram's generic one-line
 *     summarize=v2 summary with a restoration-business-aware one (damage type,
 *     urgency, key details, call outcome). Best-effort like naming — any failure
 *     leaves the transcript/summary exactly as Deepgram produced them. The flat
 *     `transcription` text is then rebuilt from the final turns (turnsToFlatText)
 *     so it matches the named/cleaned speaker labels and wording, not Deepgram's
 *     raw "Speaker 1/2" output.
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
import { formatDeepgramTranscript, buildTranscriptAnalysis, turnsToFlatText } from '../lib/deepgram.js';
import {
  buildSpeakerPrompt, parseSpeakerIdentities, applySpeakerIdentities,
  needsResegment, buildResegmentPrompt, parseResegmentedTurns,
} from '../lib/speakerNaming.js';
import { buildCleanupPrompt, parseCleanupResponse, applyCleanup } from '../lib/callCleanup.js';

const MAX_BACKFILL = 200; // hard cap — guards against a runaway paid-API fan-out
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const NAMING_MODEL = 'claude-haiku-4-5-20251001'; // cheap/fast — a simple extraction
const NAMING_SYSTEM = `You label the speakers in a transcript of an INBOUND phone call to Utah Pros Restoration (a water/fire/mold restoration company). One speaker is the company representative (role "agent"); the other is the caller (role "customer"). On an inbound call the agent almost always speaks first with a company greeting.

Return ONLY a JSON object (no prose, no markdown) of exactly this shape:
{"speakers":{"<label>":{"role":"agent"|"customer","name":<full name or null>}, ...},"caller_name":<the CUSTOMER's full name or null>}

Use the EXACT speaker labels from the transcript as the keys. Only set a name if the person actually states their name in the call — otherwise null. Include the LAST NAME too whenever the caller states it (not just the first name) — never truncate a stated full name down to a first name. A name is a person's name, never a company name.`;
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

// System prompt for the clean-up + summarize pass (runs AFTER speaker naming/
// resegmentation, so speaker labels here are already correct — this pass only
// touches wording and writes the summary). Replaces Deepgram's generic
// summarize=v2 output with a business-aware one; fixes obvious speech-to-text
// errors in each turn without changing what was actually said.
const CLEANUP_MODEL = NAMING_MODEL; // same cheap/fast model as naming
const CLEANUP_SYSTEM = `You clean up and summarize a transcript of an INBOUND phone call to Utah Pros Restoration (a water/fire/mold restoration company). The transcript came from automatic speech-to-text and may contain mis-heard words, dropped words, or garbled phrases — but the speaker labels are already correct, so do not change who said what.

1) For each numbered turn, fix obvious transcription errors using context (a mis-heard word that makes no sense in context, a garbled but otherwise-clear detail). Keep the speaker's actual wording, tone, and meaning intact — do NOT paraphrase, do NOT invent content, do NOT remove real information. Trim filler ("um", "uh") only when it doesn't change the meaning. If a turn is already clean, return it unchanged.

2) Write a 2-4 sentence summary a busy office manager can scan in five seconds: the type of damage/service (water, fire, mold, roofing, remodel, etc.), urgency, any key details mentioned (location, timing), and how the call ended (e.g. appointment scheduled, quote requested, caller will call back, not a fit, voicemail).

3) Decide whether an in-person inspection/appointment was actually agreed to during THIS call — a specific day/time or a clear mutual "let's get someone out there" agreement. A vague "we'll follow up" or "someone will call you back" does NOT count. Set inspection_scheduled to true only when a real inspection visit was scheduled in this call.

4) Decide whether the caller never actually responded — the agent/company spoke (e.g. a greeting like "Thank you for calling, how can I help?") but the customer side has NO real speech at all (silence, dead air, or the recording just cuts off after the greeting). Set caller_never_responded to true ONLY when the agent turn(s) have real content and the customer turn(s) are empty/missing/pure silence — NOT when the customer spoke but the call was simply short, unhelpful, or a wrong number.

5) Extract the customer's email address and mailing/service address ONLY if the customer clearly stated it themselves during the call — never guess, infer, or use the business's own address. customer_email must be a literal email address spoken or spelled out; customer_address must be a real street address (not just a city/neighborhood name). Use null for either when not clearly stated.

6) Extract the customer's full name (first AND last, if both were stated anywhere in the call — including if they spelled it out letter by letter) into customer_full_name. Read the actual turn content for this, not just the speaker label the turns already carry — a speaker turn may already be labeled with just a first name from an earlier pass, but the full conversation may state the last name separately later on (e.g. the agent asks "what's your last name?" and the customer answers). Only include what was actually stated — never guess a last name. Use null if no name was stated at all.

Return ONLY a JSON object (no prose, no markdown) of exactly this shape:
{"turns":["<cleaned turn 1 text>","<cleaned turn 2 text>", ...],"summary":"<the summary>","inspection_scheduled":true|false,"caller_never_responded":true|false,"customer_email":"<email or null>","customer_address":"<address or null>","customer_full_name":"<full name or null>"}

The "turns" array MUST have EXACTLY the same number of entries, in the same order, as the numbered list you were given — one cleaned string per turn, nothing merged or split.`;

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

// Best-effort: ask Claude to fix obvious speech-to-text mistakes in each turn's
// wording and write a restoration-business-aware summary (replacing Deepgram's
// generic one-liner). Runs AFTER speaker naming/resegmentation so the prompt's
// speaker labels are already correct. Any failure (no key, API error, unparseable
// answer, turn-count mismatch) leaves the analysis exactly as-is — this is an
// enrichment, never a hard dependency of transcription.
async function cleanAndSummarize(env, analysis) {
  const turns = analysis?.turns || [];
  const usableCount = turns.filter((t) => t && typeof t.text === 'string' && t.text.trim()).length;
  const prompt = buildCleanupPrompt(turns);
  if (!env.ANTHROPIC_API_KEY || !prompt) return analysis;
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: CLEANUP_MODEL, max_tokens: 4096, system: CLEANUP_SYSTEM, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) return analysis;
    const data = await res.json().catch(() => null);
    const out = (data?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const cleaned = parseCleanupResponse(out, usableCount);
    if (!cleaned) return analysis;
    return applyCleanup(analysis, cleaned);
  } catch {
    return analysis;
  }
}

// Transcribe one lead's recording and store it. Returns the transcript length;
// throws with a precise reason so the caller can log/surface it. Exported so the
// CallRail webhook can auto-transcribe a call the moment its recording lands
// (callrail-webhook.js), not just this on-demand endpoint.
export async function transcribeLead(db, env, lead, callrailKey, deepgramKey) {
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

  // Fix obvious speech-to-text errors turn-by-turn and replace Deepgram's generic
  // summary with a restoration-business-aware one — best-effort, runs last so it
  // sees the final (named/resegmented) speaker labels.
  analysis = await cleanAndSummarize(env, analysis);

  // Keep the flat display transcript in sync with the named + cleaned turns
  // (falls back to Deepgram's raw output when there are no usable turns at all).
  const flatText = turnsToFlatText(analysis.turns) || text;

  await db.rpc('set_lead_transcription', {
    p_lead_id: lead.id,
    p_transcription: flatText,
    p_source: 'deepgram',
    p_analysis: analysis,
  });

  // Auto-name the lead. Prefer cleanAndSummarize's customer_full_name — it reads
  // the ACTUAL conversation content (not just the current speaker label), so it
  // reliably finds a last name even when nameSpeakers() only got a first name.
  // Falls back to nameSpeakers()'s result when the cleanup pass found nothing.
  // p_allow_upgrade:true is safe here too: it only ever extends an existing
  // name, never replaces it with something unrelated (see set_lead_caller_name).
  const bestCallerName = analysis?.customer_full_name || callerName;
  if (bestCallerName) {
    try {
      await db.rpc('set_lead_caller_name', { p_lead_id: lead.id, p_name: bestCallerName, p_allow_upgrade: true });
    } catch { /* naming the lead is a bonus, not a reason to fail the transcription */ }
  }

  // The AI detected a real inspection agreed to in this call — nudge the lead
  // forward to "Inspection Scheduled" (RPC is sort-order-aware: no-op if the
  // lead is already further along, spam-flagged, or the stage doesn't exist
  // for this org). Best-effort, like caller-name — pipeline bookkeeping never
  // blocks a transcription from saving.
  if (analysis?.inspection_scheduled) {
    try {
      await db.rpc('crm_advance_lead_if_forward', { p_lead_id: lead.id, p_stage_name: 'Inspection Scheduled' });
    } catch { /* pipeline auto-advance is a bonus, not a reason to fail the transcription */ }
  }

  // The AI detected the agent spoke but the caller never actually responded —
  // reliably auto-flag as spam so it never has to be caught by hand. Best-effort.
  if (analysis?.caller_never_responded) {
    try {
      await db.rpc('set_lead_spam_flag', { p_lead_id: lead.id, p_spam: true, p_reason: 'ai_detected_caller_never_responded' });
    } catch { /* spam auto-flagging is a bonus, not a reason to fail the transcription */ }
  }

  // The AI pulled a clearly-stated email/address off the call — backfill a
  // blank field on an already-linked contact (RPC no-ops if the lead has no
  // contact_id yet; never creates one). Best-effort.
  if (analysis?.customer_email || analysis?.customer_address) {
    try {
      await db.rpc('set_lead_contact_details', {
        p_lead_id: lead.id,
        p_email: analysis.customer_email || null,
        p_address: analysis.customer_address || null,
      });
    } catch { /* contact-detail backfill is a bonus, not a reason to fail the transcription */ }
  }

  return { id: lead.id, chars: flatText.length, transcription: flatText, analysis, callerName: callerName || null };
}

// Re-run the AI naming + clean-up/classification passes against an ALREADY-
// transcribed lead's stored turns — no Deepgram call, no re-transcription cost.
// Exists so a lead transcribed before inspection_scheduled/caller_never_responded/
// customer_email/customer_address existed (or before naming captured last names,
// not just first) can pick all of that up without re-paying for transcription.
// Applies the exact same best-effort side effects as transcribeLead(), PLUS a
// caller-name "upgrade" (p_allow_upgrade:true — replaces an existing first-name-
// only caller_name with a fuller one ONLY when the new name genuinely extends the
// old one; see set_lead_caller_name's own guard for the exact rule). Throws if
// the lead has no usable stored turns to reclassify.
export async function reclassifyLead(db, env, lead) {
  let analysis = lead.transcript_analysis;
  if (!analysis || !Array.isArray(analysis.turns) || !analysis.turns.length) {
    throw new Error('no usable turns to reclassify');
  }

  let callerName = null;
  if (needsResegment(analysis)) {
    const r = await resegmentSpeakers(env, analysis, turnsToFlatText(analysis.turns) || lead.transcription || '');
    analysis = r.analysis;
    callerName = r.callerName;
  } else {
    const named = await nameSpeakers(env, analysis);
    analysis = named.analysis;
    callerName = named.callerName;
  }

  analysis = await cleanAndSummarize(env, analysis);
  const flatText = turnsToFlatText(analysis.turns) || lead.transcription;

  await db.rpc('set_lead_transcription', {
    p_lead_id: lead.id,
    p_transcription: flatText,
    p_source: 'deepgram',
    p_analysis: analysis,
  });

  // Prefer customer_full_name (reads actual content, reliably finds a last name
  // even on a turn already labeled with just a first name) over the naming
  // re-run's result — same reasoning as transcribeLead().
  const bestCallerName = analysis?.customer_full_name || callerName;
  if (bestCallerName) {
    try {
      await db.rpc('set_lead_caller_name', { p_lead_id: lead.id, p_name: bestCallerName, p_allow_upgrade: true });
    } catch { /* naming the lead is a bonus, not a reason to fail reclassification */ }
  }

  if (analysis?.inspection_scheduled) {
    try {
      await db.rpc('crm_advance_lead_if_forward', { p_lead_id: lead.id, p_stage_name: 'Inspection Scheduled' });
    } catch { /* pipeline auto-advance is a bonus, not a reason to fail reclassification */ }
  }
  if (analysis?.caller_never_responded) {
    try {
      await db.rpc('set_lead_spam_flag', { p_lead_id: lead.id, p_spam: true, p_reason: 'ai_detected_caller_never_responded' });
    } catch { /* spam auto-flagging is a bonus, not a reason to fail reclassification */ }
  }
  if (analysis?.customer_email || analysis?.customer_address) {
    try {
      await db.rpc('set_lead_contact_details', {
        p_lead_id: lead.id,
        p_email: analysis.customer_email || null,
        p_address: analysis.customer_address || null,
      });
    } catch { /* contact-detail backfill is a bonus, not a reason to fail reclassification */ }
  }

  return { id: lead.id, analysis };
}

// ─── SECTION: Handler ──────────────

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = supabase(env);
  const startedAt = new Date().toISOString();

  const employee = await getActorEmployee(request, env, db);
  if (!employee) return jsonResponse({ error: 'Unauthorized' }, 401, request, env);

  const body = await request.json().catch(() => ({}));

  // Reclassify mode — re-run the AI naming + clean-up/classification passes
  // against already-transcribed leads (no Deepgram/CallRail creds needed, no
  // re-transcription cost). Default targets leads whose stored analysis
  // predates customer_full_name — the NEWEST signal this pass writes, so it's
  // the correct "still needs the current pass" sentinel (a lead that already
  // has it was fully reprocessed under the current code and is skipped on the
  // next round, so `force:true` sweeps make real forward progress instead of
  // reprocessing the same head-of-list leads every timed-out round; `->>` on a
  // genuinely-missing key reads as SQL NULL). `force:true` widens the target
  // set to every matching call within the day window regardless of
  // inspection_scheduled/other older signals (still skips ones with
  // customer_full_name already set) — e.g. after a NEW prompt/signal ships
  // that even an inspection_scheduled-having lead should pick up.
  if (body.reclassify) {
    let leads;
    try {
      if (body.lead_id) {
        // Targeted single-lead reclassify — bypasses the days/force filters
        // entirely, for testing a prompt change against one known call.
        leads = await db.select('inbound_leads', `id=eq.${body.lead_id}&select=id,transcription,transcript_analysis`);
      } else {
        const days = Number(body.days) > 0 ? Number(body.days) : 90;
        const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        const freshOnly = body.force
          ? '&transcript_analysis->>customer_full_name=is.null'
          : '&transcript_analysis->>inspection_scheduled=is.null&transcript_analysis->>customer_full_name=is.null';
        leads = await db.select(
          'inbound_leads',
          `source_type=eq.call&transcript_analysis=not.is.null${freshOnly}` +
            `&occurred_at=gte.${startDate}&select=id,transcription,transcript_analysis&order=occurred_at.desc&limit=${MAX_BACKFILL}`
        );
      }
    } catch {
      return jsonResponse({ error: 'Failed to load leads' }, 500, request, env);
    }
    leads = leads || [];
    let processed = 0;
    const errors = [];
    for (const lead of leads) {
      try {
        await reclassifyLead(db, env, lead);
        processed++;
      } catch (e) {
        errors.push({ id: lead.id, error: String(e.message || e).slice(0, 200) });
      }
    }
    await db.insert('worker_runs', {
      worker_name: 'transcribe-call-reclassify',
      status: errors.length && !processed ? 'error' : 'completed',
      records_processed: processed,
      error_message: errors.length ? JSON.stringify(errors).slice(0, 500) : null,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
    });
    return jsonResponse(
      { ok: true, processed, total: leads.length, errored: errors.length, errors: errors.slice(0, 10) },
      200,
      request,
      env
    );
  }

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
      return jsonResponse({ error: 'Provide lead_id, backfill:true, or reclassify:true' }, 400, request, env);
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
