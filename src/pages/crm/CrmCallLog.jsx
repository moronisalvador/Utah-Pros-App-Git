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
 *                       call recordings via GET /api/callrail-recording
 *              writes → inbound_leads.lead_status (via update_lead_status RPC);
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

const err = (message) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type: 'error' } }));

const STATUS_OPTIONS = ['new', 'contacted', 'qualified', 'booked', 'not_interested', 'spam'];

function formatDuration(sec) {
  if (sec == null) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
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

function LeadRow({ lead, onStatusChange }) {
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
          {lead.source && <span className="crm-call-row-source">{lead.source}{lead.campaign ? ` · ${lead.campaign}` : ''}</span>}
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
      {(lead.recording_url || transcription) && (
        <div className="crm-call-row-detail">
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
        </div>
      )}
    </div>
  );
}

export default function CrmCallLog() {
  const { db } = useAuth();
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await db.select(
        'inbound_leads',
        'select=*,contact:contacts(name,phone)&order=occurred_at.desc,created_at.desc&limit=100'
      );
      setLeads(rows || []);
    } catch {
      window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: 'Failed to load call log', type: 'error' } }));
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => { load(); }, [load]);

  const handleStatusChange = async (leadId, status) => {
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, lead_status: status } : l));
    try {
      await db.rpc('update_lead_status', { p_lead_id: leadId, p_status: status });
    } catch {
      window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: 'Failed to update lead status', type: 'error' } }));
      load();
    }
  };

  if (loading) return <div className="crm-page"><div className="crm-loading">Loading…</div></div>;

  return (
    <div className="crm-page">
      <div className="crm-page-header">
        <h1 className="crm-page-title">Call Log</h1>
        <p className="crm-page-subtitle">Every call and web-form lead from CallRail, newest first.</p>
      </div>

      {leads.length === 0 ? (
        <div className="crm-empty-state">
          <IconCallLog className="crm-empty-icon" />
          <p>No leads yet. Connect CallRail from Integrations to start receiving calls and form submissions here.</p>
        </div>
      ) : (
        <div className="crm-call-list">
          {leads.map(lead => (
            <LeadRow key={lead.id} lead={lead} onStatusChange={handleStatusChange} />
          ))}
        </div>
      )}
    </div>
  );
}
