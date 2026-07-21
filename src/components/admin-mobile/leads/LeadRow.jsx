/**
 * ════════════════════════════════════════════════
 * FILE: LeadRow.jsx  (Admin Mobile — Lead Center one lead)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   One inbound lead in the field-tech Lead Center: who it was, when, how long
 *   the call ran, and any spam / value flags. A tech can play the recording,
 *   show the transcript, and change the lead's status right on the card.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (a presentational card)
 *   Rendered by:  src/pages/tech/admin/AdminLeadCenter.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/lib/realtime (getAuthHeader — for the recording proxy fetch),
 *              ./RecordingPlayer, ./TranscriptView, ./leadFormat
 *   Data:      reads → call recording via GET /api/callrail-recording
 *                     (call-only proxy worker) · writes → none directly (status
 *                     changes are handed up to the page via onStatusChange)
 *
 * NOTES / GOTCHAS:
 *   - Presentational on purpose: no useAuth() here. The page owns the db and does
 *     the update_lead_status write, so this card renders without an AuthContext
 *     (keeps it unit-testable) and can't accidentally re-fetch the whole list.
 *   - "Play recording" streams through /api/callrail-recording (which adds
 *     CallRail's key server-side). We fetch it as a blob with the Supabase auth
 *     header and play it via URL.createObjectURL — an <audio src> can't carry the
 *     header. The blob URL is revoked on unmount to avoid a memory leak.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback } from 'react';
import { getAuthHeader } from '@/lib/realtime';
import RecordingPlayer from './RecordingPlayer';
import TranscriptView from './TranscriptView';
import {
  STATUS_OPTIONS, statusLabel, formatDuration, formatValue, isAwaitingRecording, contactLabelFor,
} from './leadFormat';
import { err } from '@/lib/toast';

export default function LeadRow({ lead, onStatusChange }) {
  const [audioUrl, setAudioUrl] = useState(null);
  const [loadingRec, setLoadingRec] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);

  const contactLabel = contactLabelFor(lead);
  const when = lead.occurred_at
    ? new Date(lead.occurred_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '—';

  // ─── SECTION: Event handlers ──────────────
  // Free the blob URL when the row unmounts / a new one replaces it.
  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);

  const playRecording = useCallback(async () => {
    if (audioUrl || loadingRec) return;
    setLoadingRec(true);
    try {
      // The recording lives behind CallRail's API key — fetch it through the
      // proxy worker (which attaches the key server-side) as a blob, then play
      // it inline. An <audio src> can't send the auth header, so we fetch first.
      const res = await fetch(`/api/callrail-recording?lead_id=${lead.id}`, { headers: await getAuthHeader() });
      const ct = res.headers.get('Content-Type') || '';
      // Guard against playing a non-audio body (e.g. a JSON error) — surface the
      // real reason instead of a dead 0:00 player.
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

  const hasTranscript = Boolean(lead.transcription) || Boolean(lead.transcript_analysis?.turns?.length);

  // ─── SECTION: Render ──────────────
  return (
    <div className="am-lead-row">
      <div className="am-lead-main">
        <div className="am-lead-type" data-type={lead.source_type}>
          {lead.source_type === 'call' ? 'Call' : 'Form'}
        </div>
        <div className="am-lead-contact">
          <div className="am-lead-name">{contactLabel}</div>
          {lead.caller_number && lead.contact?.name && (
            <div className="am-lead-phone">{lead.caller_number}</div>
          )}
        </div>
        <div className="am-lead-when">{when}</div>
      </div>

      <div className="am-lead-meta">
        {lead.source_type === 'call' && <span className="am-lead-dur">{formatDuration(lead.duration_sec)}</span>}
        {lead.source && <span className="am-lead-source">{lead.source}{lead.campaign ? ` · ${lead.campaign}` : ''}</span>}
        {formatValue(lead.value) && <span className="am-lead-badge am-lead-badge--value">{formatValue(lead.value)}</span>}
        {(lead.spam_flag || lead.lead_status === 'spam') && <span className="am-lead-badge am-lead-badge--spam">Spam</span>}
      </div>

      <div className="am-lead-actions">
        {isAwaitingRecording(lead) && (
          <span className="am-lead-awaiting">
            <span className="am-awaiting-dot" aria-hidden="true" />
            Waiting for recording &amp; transcript…
          </span>
        )}
        {lead.recording_url && (
          audioUrl
            ? <RecordingPlayer src={audioUrl} />
            : <button type="button" className="am-lead-action-btn" onClick={playRecording} disabled={loadingRec}>
                {loadingRec ? 'Loading…' : '▶ Play recording'}
              </button>
        )}
        {hasTranscript && (
          <>
            <button type="button" className="am-lead-action-btn" onClick={() => setShowTranscript((v) => !v)}>
              {showTranscript ? '▴ Hide transcript' : '▾ Show transcript'}
            </button>
            {showTranscript && <TranscriptView analysis={lead.transcript_analysis} text={lead.transcription} />}
          </>
        )}
      </div>

      <label className="am-lead-status-row">
        <span className="am-lead-status-label">Status</span>
        <select
          className="am-lead-status"
          value={lead.lead_status || 'new'}
          onChange={(e) => onStatusChange(lead.id, e.target.value)}
        >
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </select>
      </label>
    </div>
  );
}
