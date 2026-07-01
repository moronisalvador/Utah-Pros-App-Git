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
 *   Data:      reads  → inbound_leads (embeds contacts via contact_id FK);
 *                       call recordings via GET /api/callrail-recording
 *              writes → inbound_leads.lead_status (via update_lead_status RPC)
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
import { useState, useEffect, useCallback } from 'react';
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

function LeadRow({ lead, onStatusChange }) {
  const contactLabel = lead.contact?.name || lead.caller_number || (lead.source_type === 'form' ? 'Web form' : 'Unknown');
  const [audioUrl, setAudioUrl] = useState(null);
  const [loadingRec, setLoadingRec] = useState(false);

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
      {(lead.recording_url || lead.transcription) && (
        <div className="crm-call-row-detail">
          {lead.recording_url && (
            audioUrl
              ? <audio className="crm-call-row-audio" controls autoPlay src={audioUrl} />
              : <button className="crm-call-row-play" onClick={playRecording} disabled={loadingRec}>
                  {loadingRec ? 'Loading…' : '▶ Play recording'}
                </button>
          )}
          {lead.transcription && <p className="crm-call-row-transcript">{lead.transcription}</p>}
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
