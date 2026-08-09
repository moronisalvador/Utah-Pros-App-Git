/**
 * ════════════════════════════════════════════════
 * FILE: AdminLeadDetail.jsx  (Admin Mobile — one lead)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Everything about one inbound lead, on its own screen: who they are and how
 *   to call or text them, which stage of the sales board they are in (and a row
 *   of buttons to move them), the call recording, the transcript, and the full
 *   history of everything that has happened on that lead.
 *
 * WHERE IT LIVES:
 *   Route:        /tech/admin/leads/:leadId  (inside AdminMobileRoutes, tech shell)
 *   Rendered by:  src/pages/tech/admin/AdminMobileRoutes.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  @/contexts/AuthContext (useAuth → db), AdminMobilePage,
 *              ./ (leads) LeadContactCard, LeadStageMover, RecordingPlayer,
 *              TranscriptView, @/components/crm/ActivityTimeline,
 *              @/components/TabLoading, @/components/ui/ErrorState,
 *              @/lib/realtime (getAuthHeader), @/lib/toast
 *   Data:      reads  → get_inbound_leads + get_pipeline_stages RPCs,
 *                       lead_pipeline_stage · the recording via the
 *                       /api/callrail-recording proxy · the history via
 *                       get_lead_activity (inside ActivityTimeline)
 *              writes → lead_pipeline_stage via move_lead_to_stage RPC
 *
 * NOTES / GOTCHAS:
 *   - A PUSHED SCREEN, not a bottom sheet. Five sections (contact, stage,
 *     recording, transcript, history) inside a sheet is a scroll container
 *     inside a scroll container, and inside a list row it is an accordion wall.
 *     The list's job is scanning; this screen's job is one lead. Same shape as
 *     AdminEstimateDetail, which is the precedent in this shell.
 *   - ActivityTimeline is the CRM component the desktop lead card already
 *     renders, reused rather than reimplemented — a second native timeline over
 *     the same get_lead_activity RPC is exactly the cross-shell duplication the
 *     reconciliation plan exists to stop. It is self-loading and owns its own
 *     loading/error states, so this page does not fetch activity itself.
 *   - No get_inbound_lead(id) RPC exists, and adding one would change a
 *     CRM-owned contract. The list RPC is called with its normal limit and the
 *     lead is picked out of it — the same 100 rows the list screen already
 *     holds, so this costs one round trip and no new database surface.
 *   - Concrete module paths, never the '@/components/admin-mobile' barrel: the
 *     native build aliases that barrel to a denying shim, so a barrel import
 *     renders this screen BLANK on the phone without failing the build.
 *   - The recording is fetched as a blob with the auth header, because an
 *     <audio src> cannot carry one. The blob URL is revoked on unmount.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import AdminMobilePage from '@/components/admin-mobile/AdminMobilePage';
import LeadContactCard from '@/components/admin-mobile/leads/LeadContactCard';
import LeadStageMover from '@/components/admin-mobile/leads/LeadStageMover';
import RecordingPlayer from '@/components/admin-mobile/leads/RecordingPlayer';
import TranscriptView from '@/components/admin-mobile/leads/TranscriptView';
import { isAwaitingRecording } from '@/components/admin-mobile/leads/leadFormat';
import { adminLeadsHref } from '@/components/admin-mobile/href';
import ActivityTimeline from '@/components/crm/ActivityTimeline';
import TabLoading from '@/components/TabLoading';
import ErrorState from '@/components/ui/ErrorState';
import { getAuthHeader } from '@/lib/realtime';
import { err } from '@/lib/toast';

export default function AdminLeadDetail() {
  const { leadId } = useParams();
  const { db } = useAuth();
  const [lead, setLead] = useState(null);
  const [stages, setStages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [moving, setMoving] = useState(false);
  const [audioUrl, setAudioUrl] = useState(null);
  const [loadingRec, setLoadingRec] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);

  const dbRef = useRef(db);
  dbRef.current = db;

  // ─── SECTION: Data fetching ──────────────
  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [rows, stageRows, placements] = await Promise.all([
        dbRef.current.rpc('get_inbound_leads', { p_limit: 100 }),
        dbRef.current.rpc('get_pipeline_stages', {}),
        dbRef.current.select('lead_pipeline_stage', `select=lead_id,stage_id&lead_id=eq.${leadId}`),
      ]);
      const row = (rows || []).find((l) => l.id === leadId) || null;
      if (!row) {
        // A real "not found", not a failed fetch — say so rather than showing a
        // blank screen or the success empty state (loading-error-states.md §1).
        setLoadError('That lead is not in the latest 100 — open it from the CRM on a computer.');
        return;
      }
      const byId = new Map((stageRows || []).map((s) => [s.id, s]));
      const placed = (placements || [])[0];
      setStages(stageRows || []);
      setLead({ ...row, stage: (placed && byId.get(placed.stage_id)) || null });
    } catch {
      setLoadError('Failed to load this lead.');
    } finally {
      // Cold-start only: never re-set true, so a stage move can't blank the
      // screen mid-tap (page-lifecycle.md §1).
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => { load(); }, [load]);

  // Free the blob URL when the screen unmounts / a new one replaces it.
  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);

  // ─── SECTION: Event handlers ──────────────
  const playRecording = useCallback(async () => {
    if (audioUrl || loadingRec || !lead) return;
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
  }, [audioUrl, loadingRec, lead]);

  // Moves the lead on the SAME board the CRM kanban drives, through the same
  // RPC. Optimistic, with a rollback on failure so the chip can never keep
  // showing a stage the database refused (page-lifecycle.md §3).
  const handleMove = useCallback(async (stageId) => {
    const previous = lead?.stage || null;
    const next = stages.find((s) => s.id === stageId) || null;
    setMoving(true);
    setLead((l) => (l ? { ...l, stage: next } : l));
    try {
      await dbRef.current.rpc('move_lead_to_stage', { p_lead_id: leadId, p_stage_id: stageId });
    } catch {
      setLead((l) => (l ? { ...l, stage: previous } : l));
      err('Failed to move the lead');
    } finally {
      setMoving(false);
    }
  }, [lead, stages, leadId]);

  // ─── SECTION: Render ──────────────
  const page = (children) => (
    <AdminMobilePage title="Lead" subtitle="Inbound lead" back={adminLeadsHref()}>
      {children}
    </AdminMobilePage>
  );

  if (loading) return page(<TabLoading />);
  if (loadError || !lead) return page(<ErrorState message={loadError || 'Lead not found.'} onRetry={load} />);

  const hasTranscript = Boolean(lead.transcription) || Boolean(lead.transcript_analysis?.turns?.length);

  return page(
    <div className="am-lead-detail">
      <LeadContactCard lead={lead} />

      <LeadStageMover
        stages={stages}
        currentStageId={lead.stage?.id || null}
        onMove={handleMove}
        busy={moving}
      />

      {(lead.recording_url || hasTranscript || isAwaitingRecording(lead)) && (
        <section className="am-lead-detail-section">
          <div className="am-lead-section-label">The call</div>
          {isAwaitingRecording(lead) && (
            <span className="am-lead-awaiting">
              <span className="am-awaiting-dot" aria-hidden="true" />
              Waiting for recording &amp; transcript…
            </span>
          )}
          {lead.recording_url && (
            audioUrl
              ? <RecordingPlayer src={audioUrl} />
              : (
                <button type="button" className="am-lead-action-btn" onClick={playRecording} disabled={loadingRec}>
                  {loadingRec ? 'Loading…' : '▶ Play recording'}
                </button>
              )
          )}
          {hasTranscript && (
            <>
              <button
                type="button"
                className="am-lead-action-btn"
                aria-expanded={showTranscript}
                onClick={() => setShowTranscript((v) => !v)}
              >
                {showTranscript ? '▴ Hide transcript' : '▾ Show transcript'}
              </button>
              {showTranscript && <TranscriptView analysis={lead.transcript_analysis} text={lead.transcription} />}
            </>
          )}
        </section>
      )}

      <section className="am-lead-detail-section">
        <div className="am-lead-section-label">History</div>
        {/* The desktop lead card's own timeline, reused. Self-loading, and it
            owns its loading and error states. */}
        <ActivityTimeline leadId={lead.id} />
      </section>
    </div>,
  );
}
