/**
 * ════════════════════════════════════════════════
 * FILE: CrmCallLog.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Shows every call and web-form lead CallRail has sent us, newest first —
 *   who called (or filled out a form), how long the call lasted, which ad or
 *   source it came from, and whether it was spam. Staff can mark a lead's
 *   status (new/contacted/booked/etc.) right from this list.
 *
 * WHERE IT LIVES:
 *   Route:        /crm/call-log
 *   Rendered by:  src/App.jsx, inside CrmLayout, behind
 *                 <FeatureRoute flag="page:crm">
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (useAuth → db), @/lib/realtime
 *              (getAuthHeader for the recording proxy fetch)
 *   Data:      reads  → inbound_leads (embeds contacts via contact_id FK;
 *                       incl. transcript_analysis for the conversation view);
 *                       crm_tracking_numbers titles via get_tracking_numbers RPC
 *                       (READ-ONLY here — titles are edited in CrmSettings.jsx);
 *                       call recordings via GET /api/callrail-recording
 *              writes → inbound_leads.lead_status (update_lead_status RPC);
 *                       inbound_leads.notes + value (set_lead_details RPC);
 *                       inbound_leads.transcription + transcript_analysis via POST
 *                       /api/transcribe-call (the "Transcribe" button — Deepgram,
 *                       since CallRail's plan doesn't expose transcripts)
 *
 * NOTES / GOTCHAS:
 *   - A lead with no linked contact shows the raw caller_number/"Web form"
 *     instead of a name — ingestion never auto-creates a contact (raw calls
 *     stay contact-free until qualified; see upsert_lead_from_callrail).
 *   - "Play recording" streams through /api/callrail-recording (which adds
 *     CallRail's API key server-side); we fetch it as a blob and play it in an
 *     inline <audio>, since an <audio src> can't carry the Supabase auth header.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getAuthHeader } from '@/lib/realtime';
import { IconCallLog } from '@/lib/crmIcons';
import { formatPhone } from '@/lib/phone';
import { ok, err } from '@/lib/toast';

// Format a numeric lead value as "$1,500" (whole dollars); '' when unset.
function formatValue(v) {
  if (v == null || v === '') return '';
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '';
}

const STATUS_OPTIONS = ['new', 'contacted', 'qualified', 'booked', 'not_interested', 'spam'];

function formatDuration(sec) {
  if (sec == null) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// A call with no recording yet, seen in the last 10 minutes, is almost certainly
// still being processed by CallRail (recordings land ~1–3 min after hang-up, then
// we auto-transcribe). Show a "waiting" state so a fresh 0:00 row — which the page
// auto-refreshes into the finished call — never looks broken.
function isAwaitingRecording(lead) {
  if (lead.source_type !== 'call' || lead.recording_url) return false;
  const t = new Date(lead.occurred_at || lead.created_at || 0).getTime();
  return t > 0 && (Date.now() - t) < 10 * 60 * 1000;
}

function fmtTime(sec) {
  if (!sec || Number.isNaN(sec) || !Number.isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// A compact, CRM-styled audio player — a hidden <audio> engine driving our own
// play/pause button, seek bar, and time, so it matches the CRM look instead of
// the browser's default control chrome.
function RecordingPlayer({ src }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play(); else a.pause();
  };
  const onSeek = (e) => {
    const a = audioRef.current;
    if (a && dur) a.currentTime = (Number(e.target.value) / 100) * dur;
  };

  return (
    <div className="crm-audio">
      <button className="crm-audio-btn" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? '❚❚' : '▶'}
      </button>
      <input
        className="crm-audio-seek" type="range" min="0" max="100" step="0.1"
        value={dur ? (cur / dur) * 100 : 0} onChange={onSeek} aria-label="Seek recording"
      />
      <span className="crm-audio-time">{fmtTime(cur)} / {fmtTime(dur)}</span>
      <audio
        ref={audioRef} src={src} autoPlay className="crm-audio-engine"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setCur(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
        onEnded={() => setPlaying(false)}
      />
    </div>
  );
}

// Merge consecutive turns from the SAME speaker into one block, so a monologue
// isn't chopped into a dozen repeated-label rows. Returns [{speaker, role, texts[]}].
function groupTurns(turns) {
  const blocks = [];
  for (const turn of turns) {
    const last = blocks[blocks.length - 1];
    if (last && last.speaker === turn.speaker) {
      last.texts.push(turn.text);
    } else {
      blocks.push({ speaker: turn.speaker, role: turn.role || null, texts: [turn.text] });
    }
  }
  return blocks;
}

// Only show a handful of topic chips (Deepgram over-tags; new rows are already
// capped in the worker, this also tidies pre-cap rows).
const MAX_TOPIC_CHIPS = 6;

// Renders a call transcript. With structured analysis (new rows) it shows a
// conversation view — summary, sentiment, topics, then speaker turns grouped by
// speaker (name on its own bold line, tinted by role). Without analysis (older
// text-only rows) it falls back to the flat text, which preserves line breaks via
// the .crm-call-row-transcript `white-space` rule.
function TranscriptView({ analysis, text }) {
  if (!analysis || !Array.isArray(analysis.turns) || analysis.turns.length === 0) {
    return <p className="crm-call-row-transcript">{text}</p>;
  }
  const sentiment = analysis.sentiment?.label;
  const topics = (analysis.topics || []).slice(0, MAX_TOPIC_CHIPS);
  const blocks = groupTurns(analysis.turns);
  return (
    <div className="crm-transcript">
      {analysis.summary && (
        <div className="crm-transcript-summary">
          <div className="crm-transcript-summary-label">Summary</div>
          <div className="crm-transcript-summary-text">{analysis.summary}</div>
        </div>
      )}
      {(sentiment || topics.length > 0) && (
        <div className="crm-transcript-tags">
          {sentiment && (
            <span className={`crm-badge crm-badge-sentiment-${sentiment}`}>{sentiment}</span>
          )}
          {topics.map((t) => (
            <span key={t} className="crm-timeline-badge">{t}</span>
          ))}
        </div>
      )}
      <div className="crm-transcript-turns">
        {blocks.map((b, i) => (
          <div className="crm-transcript-block" data-role={b.role || 'unknown'} key={i}>
            <div className="crm-transcript-speaker">{b.speaker}</div>
            {b.texts.map((t, j) => (
              <p className="crm-transcript-text" key={j}>{t}</p>
            ))}
          </div>
        ))}
      </div>
      {analysis.entities && analysis.entities.length > 0 && (
        <div className="crm-transcript-entities">
          Detected: {analysis.entities.map((e) => e.value).join(', ')}
        </div>
      )}
    </div>
  );
}

function LeadRow({ lead, labelMap, onStatusChange }) {
  const { db } = useAuth();
  // caller_name (detected from the transcript) can arrive after load, so track it.
  const [callerName, setCallerName] = useState(lead.caller_name);
  const contactLabel = lead.contact?.name || callerName || lead.caller_number || (lead.source_type === 'form' ? 'Web form' : 'Unknown');
  const [audioUrl, setAudioUrl] = useState(null);
  const [loadingRec, setLoadingRec] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  // Transcript can arrive after load (staff clicks Transcribe), so track it locally.
  const [transcription, setTranscription] = useState(lead.transcription);
  const [analysis, setAnalysis] = useState(lead.transcript_analysis);
  const [transcribing, setTranscribing] = useState(false);

  // Campaign title for this call's tracking number — READ-ONLY here. Titles are
  // set once per number in CRM Settings → Tracking Numbers (the number is a
  // hard-coded reference, not something you edit per call).
  const campaignLabel = labelMap.get(lead.tracking_number);

  // Notes + value (qualify the lead).
  const [notes, setNotes] = useState(lead.notes || '');
  const [value, setValue] = useState(lead.value ?? '');
  const [editingDetails, setEditingDetails] = useState(false);
  const [savingDetails, setSavingDetails] = useState(false);

  const saveDetails = async () => {
    setSavingDetails(true);
    try {
      const numVal = value === '' || value == null ? null : Number(value);
      await db.rpc('set_lead_details', { p_lead_id: lead.id, p_notes: notes || null, p_value: numVal });
      ok('Saved');
      setEditingDetails(false);
    } catch { err('Could not save notes/value'); }
    finally { setSavingDetails(false); }
  };

  // Free the blob URL when the row unmounts / a new one replaces it.
  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);

  const playRecording = useCallback(async () => {
    if (audioUrl || loadingRec) return;
    setLoadingRec(true);
    try {
      // The recording lives behind CallRail's API key — fetch it through our
      // proxy worker (which attaches the key server-side) as a blob, then play
      // it inline. An <audio src> can't send the auth header, so we fetch first.
      const res = await fetch(`/api/callrail-recording?lead_id=${lead.id}`, { headers: await getAuthHeader() });
      const ct = res.headers.get('Content-Type') || '';
      // Guard against playing a non-audio body (e.g. a JSON error) — that's what
      // produced the earlier dead 0:00 player. Surface the real reason instead.
      if (!res.ok || !ct.startsWith('audio/')) {
        const detail = await res.json().catch(() => null);
        throw new Error(detail?.error || `unexpected response (${res.status}, ${ct || 'no type'})`);
      }
      setAudioUrl(URL.createObjectURL(await res.blob()));
    } catch (e) {
      console.error('[callrail-recording]', e?.message || e);
      err('Could not load the recording — details in the console');
    } finally {
      setLoadingRec(false);
    }
  }, [audioUrl, loadingRec, lead.id]);

  const transcribe = useCallback(async () => {
    if (transcribing) return;
    setTranscribing(true);
    try {
      // Our own transcription (CallRail's plan doesn't expose transcripts) —
      // the worker fetches the audio, sends it to Deepgram, and stores the text.
      const res = await fetch('/api/transcribe-call', {
        method: 'POST',
        headers: { ...(await getAuthHeader()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: lead.id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.transcription) {
        throw new Error(data?.errors?.[0]?.error || data?.error || `unexpected response (${res.status})`);
      }
      setTranscription(data.transcription);
      if (data.analysis) setAnalysis(data.analysis);
      if (data.callerName) setCallerName(data.callerName);
      setShowTranscript(true);
    } catch (e) {
      console.error('[transcribe-call]', e?.message || e);
      err('Could not transcribe this call — details in the console');
    } finally {
      setTranscribing(false);
    }
  }, [transcribing, lead.id]);

  return (
    <div className="crm-call-row">
      <div className="crm-call-row-main">
        <div className="crm-call-row-type" data-type={lead.source_type}>
          {lead.source_type === 'call' ? 'Call' : 'Form'}
        </div>
        <div className="crm-call-row-contact">
          <div className="crm-call-row-name">{contactLabel}</div>
          {lead.caller_number && lead.contact?.name && (
            <div className="crm-call-row-phone">{lead.caller_number}</div>
          )}
        </div>
        <div className="crm-call-row-meta">
          {lead.source_type === 'call' && <span>{formatDuration(lead.duration_sec)}</span>}
          {/* Campaign = the tracking number they dialed, shown by its title. The
              title (which campaign the number belongs to) is set in CRM Settings →
              Tracking Numbers; here it's a read-only chip. */}
          {lead.tracking_number && (
            <span
              className="crm-call-campaign crm-call-campaign-static"
              title={campaignLabel
                ? `${formatPhone(lead.tracking_number)} — set titles in CRM Settings → Tracking Numbers`
                : 'Untitled tracking number — set a title in CRM Settings → Tracking Numbers'}
            >
              {campaignLabel || formatPhone(lead.tracking_number)}
            </span>
          )}
          {lead.source && <span className="crm-call-row-source">{lead.source}{lead.campaign ? ` · ${lead.campaign}` : ''}</span>}
          {formatValue(value) && <span className="crm-badge crm-badge-value">{formatValue(value)}</span>}
          {lead.spam_flag && <span className="crm-badge crm-badge-spam">Spam</span>}
        </div>
        <div className="crm-call-row-time">
          {lead.occurred_at ? new Date(lead.occurred_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}
        </div>
        <select
          className="crm-call-row-status"
          value={lead.lead_status}
          onChange={(e) => onStatusChange(lead.id, e.target.value)}
        >
          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
      </div>
      <div className="crm-call-row-detail">
        {isAwaitingRecording(lead) && (
          <span className="crm-call-awaiting">
            <span className="crm-awaiting-dot" aria-hidden="true" />
            Waiting for recording &amp; transcript…
          </span>
        )}
        {lead.recording_url && (
          audioUrl
            ? <RecordingPlayer src={audioUrl} />
            : <button className="crm-call-row-play" onClick={playRecording} disabled={loadingRec}>
                {loadingRec ? 'Loading…' : '▶ Play recording'}
              </button>
        )}
        {transcription ? (
          <>
            <button className="crm-call-row-play" onClick={() => setShowTranscript(v => !v)}>
              {showTranscript ? '▴ Hide transcript' : '▾ Show transcript'}
            </button>
            {showTranscript && <TranscriptView analysis={analysis} text={transcription} />}
          </>
        ) : (
          lead.recording_url && (
            <button className="crm-call-row-play" onClick={transcribe} disabled={transcribing}>
              {transcribing ? 'Transcribing…' : '✎ Transcribe'}
            </button>
          )
        )}
        {/* Notes & value — available on every lead, recording or not. */}
        <button className="crm-call-row-play" onClick={() => setEditingDetails(v => !v)}>
          {editingDetails ? '▴ Notes & value' : `✎ Notes & value${notes ? ' ·' : ''}`}
        </button>
        {editingDetails && (
          <div className="crm-call-details-edit">
            <label className="crm-integration-label">Value ($)</label>
            <input
              className="crm-integration-input crm-call-value-input" type="number" min="0" step="1"
              value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. 1500"
            />
            <label className="crm-integration-label">Notes</label>
            <textarea
              className="crm-integration-input crm-call-notes-input" rows={3}
              value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything worth remembering about this lead…"
            />
            <div className="crm-call-details-actions">
              <button className="crm-btn crm-btn-primary" onClick={saveDetails} disabled={savingDetails}>
                {savingDetails ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function CrmCallLog() {
  const { db } = useAuth();
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // tracking_number → campaign label, shared across rows (so labeling one number
  // updates every call from it). Refreshed after a label save.
  const [labelMap, setLabelMap] = useState(new Map());

  const loadLabels = useCallback(async () => {
    try {
      const rows = await db.rpc('get_tracking_numbers', {});
      setLabelMap(new Map((rows || []).map((r) => [r.tracking_number, r.label])));
    } catch { /* non-fatal — rows just fall back to the formatted number */ }
  }, [db]);

  // `silent` = a background/auto refresh: don't flip the full-page "Loading…"
  // (which would blank the list every poll) and don't toast on a transient
  // failure — just swap in fresh rows. Open inline editors keep their own local
  // state (keyed by lead.id), so a background swap never clobbers them.
  const load = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true); else setLoading(true);
    try {
      // Read via RPC (a POST) rather than a GET select: a GET is cacheable, so
      // returning to the Call Log after a soft navigation could show a STALE
      // cached list and miss a call that had already landed. A POST is never
      // cached, so every visit reflects the current data. The RPC embeds the
      // linked contact exactly like the old select=*,contact:contacts(...).
      const rows = await db.rpc('get_inbound_leads', { p_limit: 100 });
      setLeads(rows || []);
    } catch {
      if (!silent) err('Failed to load call log');
    } finally {
      if (silent) setRefreshing(false); else setLoading(false);
    }
  }, [db]);

  useEffect(() => { load(); loadLabels(); }, [load, loadLabels]);

  // Auto-refresh so a newly-landed call appears WITHOUT a manual reload: poll
  // every 15s while the tab is visible, and refetch immediately when the tab
  // regains focus. CallRail's post-call webhook can lag ~1 min after the call,
  // so the page keeps itself current instead of forcing a hard refresh.
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') load({ silent: true }); };
    const id = setInterval(refresh, 15000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [load]);

  const handleStatusChange = async (leadId, status) => {
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, lead_status: status } : l));
    try {
      await db.rpc('update_lead_status', { p_lead_id: leadId, p_status: status });
    } catch {
      err('Failed to update lead status');
      load();
    }
  };

  if (loading) return <div className="crm-page"><div className="crm-loading">Loading…</div></div>;

  return (
    <div className="crm-page">
      <div className="crm-page-header">
        <div className="crm-page-header-row">
          <div>
            <h1 className="crm-page-title">Call Log</h1>
            <p className="crm-page-subtitle">Every call and web-form lead from CallRail, newest first. Updates automatically.</p>
          </div>
          <button className="crm-btn crm-btn-ghost" onClick={() => load({ silent: true })} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {leads.length === 0 ? (
        <div className="crm-empty-state">
          <IconCallLog className="crm-empty-icon" />
          <p>No leads yet. Connect CallRail from Integrations to start receiving calls and form submissions here.</p>
        </div>
      ) : (
        <div className="crm-call-list">
          {leads.map(lead => (
            <LeadRow
              key={lead.id} lead={lead} labelMap={labelMap}
              onStatusChange={handleStatusChange}
            />
          ))}
        </div>
      )}
    </div>
  );
}
