/**
 * ════════════════════════════════════════════════
 * FILE: TechDryLogs.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The drying screen for one job. Today it is deliberately close to empty, and
 *   it says so plainly instead of pretending: the readings and equipment it will
 *   hold are not switched on yet. It exists now so the Job Hub has a real place
 *   to send a technician who taps "Dry logs", instead of an accordion row that
 *   opens onto nothing.
 *
 * WHERE IT LIVES:
 *   Route:        /tech/job/:jobId/dry-logs
 *   Rendered by:  src/App.jsx (shared tech routes — web AND native)
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom, react-i18next, @tanstack/react-query
 *   Internal:  @/contexts/AuthContext, @/lib/techQuery, @/lib/backNav (goBackOr),
 *              @/components/TabLoading, ./hub/HubTools,
 *              ./hub/hubHelpers (showsDryingTools), ./job-hub.css
 *   Data:      reads  → get_job_hub (frame), get_job_rooms
 *              writes → none directly; HubTools owns the reading/equipment writes
 *
 * NOTES / GOTCHAS:
 *   - Drying is a DESTINATION, not a row. Chambers, monitoring points and
 *     readings-over-days is a workspace; an accordion can summarise that but can
 *     never be it. Owner ruling 2026-08-19, matching how Encircle treats the
 *     same job.
 *   - The page renders HubTools, which is itself gated on `page:tech_moisture`
 *     and `page:tech_equipment`. BOTH are false in production, so HubTools
 *     renders nothing and the empty state below is what a tech actually sees.
 *     That is the honest state, not a defect — and do NOT "fix" it by widening
 *     those two flags: they expose the legacy 4-step-per-reading wizard and GPP
 *     values that are ~15% low at this elevation (hydro-wave-ownership.md).
 *   - `showsDryingTools` gates BOTH this route and the action-bar button that
 *     reaches it. A destination reachable from a button that should not exist —
 *     or a button pointing at a route that refuses — is exactly the divergence
 *     that helper exists to prevent, so both consume the same one.
 *   - The rooms and frame queries are byte-identical to TechJobHub's, so
 *     react-query serves both from one cache entry when a tech arrives from the
 *     Hub rather than refetching the job.
 *   - It imports job-hub.css rather than owning a stylesheet, because HubTools
 *     renders tv2-hub-* markup and those rules live there. Vite emits ONE css
 *     chunk for both routes, so arriving from the Hub costs nothing extra.
 *   - Back is goBackOr, not a hard navigate: a tech who reached this from the
 *     Hub pops the entry instead of stacking a second copy of the Hub behind
 *     them. Cold-opened (a saved link), it falls back to the Hub with replace.
 * ════════════════════════════════════════════════
 */
import { useCallback } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { techKeys, invalidateTech } from '@/lib/techQuery';
import { goBackOr } from '@/lib/backNav';
import TabLoading from '@/components/TabLoading';
import HubTools from './hub/HubTools.jsx';
import { showsDryingTools } from './hub/hubHelpers.js';
import './job-hub.css';

export default function TechDryLogs() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation('hub');
  const { db, employee, isFeatureEnabled } = useAuth();
  const queryClient = useQueryClient();

  const roomsEnabled = isFeatureEnabled('page:tech_rooms');
  const moistureEnabled = isFeatureEnabled('page:tech_moisture');
  const equipmentEnabled = isFeatureEnabled('page:tech_equipment');

  const hubQuery = useQuery({
    queryKey: techKeys.hub(jobId),
    queryFn: () => db.rpc('get_job_hub', { p_job_id: jobId }),
    enabled: !!jobId,
  });
  const roomsQuery = useQuery({
    queryKey: techKeys.rooms(jobId),
    queryFn: () => db.rpc('get_job_rooms', { p_job_id: jobId }),
    enabled: !!(roomsEnabled && jobId),
  });

  const job = hubQuery.data?.job || null;

  // Byte-for-byte the Hub's own handler, invalidation included. A second,
  // subtly different room-creation path is how two screens start disagreeing
  // about what rooms exist.
  const onMutation = useCallback((kind) => invalidateTech(queryClient, kind), [queryClient]);

  const handleCreateRoom = useCallback(async (name) => {
    if (!jobId) throw new Error('Job not loaded');
    const created = await db.rpc('create_room', {
      p_job_id: jobId, p_name: name, p_created_by: employee?.id, p_client_id: crypto?.randomUUID?.() || null,
    });
    onMutation('room');
    return created;
  }, [db, jobId, employee?.id, onMutation]);

  if (hubQuery.isLoading) return <TabLoading />;

  // A reconstruction job has no drying phase, so this route refuses rather than
  // showing an empty workspace. The action-bar button is hidden by the same
  // helper — this guard is for a typed URL or a stale deep link.
  if (job && !showsDryingTools(job.division)) {
    return <Navigate to={`/tech/job/${jobId}`} replace />;
  }

  // Both writer surfaces are gated off, so HubTools would render an empty
  // fragment and the screen would read as broken rather than unfinished.
  const nothingToShow = !moistureEnabled && !equipmentEnabled;

  return (
    <div className="tv2-drylogs">
      <header className="tv2-drylogs__head">
        <button
          type="button"
          className="tv2-drylogs__back"
          onClick={() => goBackOr(navigate, `/tech/job/${jobId}`)}
          aria-label={t('dryLogs.back')}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className="tv2-drylogs__titles">
          <h1 className="tv2-drylogs__title">{t('sections.dryLogs')}</h1>
          {job?.job_number && <p className="tv2-drylogs__sub">{job.job_number}</p>}
        </div>
      </header>

      {nothingToShow ? (
        <div className="tv2-drylogs__empty">
          <p className="tv2-drylogs__empty-title">{t('dryLogs.emptyTitle')}</p>
          <p className="tv2-drylogs__empty-body">{t('dryLogs.emptyBody')}</p>
        </div>
      ) : (
        <div className="tv2-drylogs__body">
          <HubTools
            jobId={jobId}
            rooms={roomsQuery.data || null}
            onCreateRoom={handleCreateRoom}
            onMutation={onMutation}
          />
        </div>
      )}
    </div>
  );
}
