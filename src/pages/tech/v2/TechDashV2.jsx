/**
 * ════════════════════════════════════════════════
 * FILE: TechDashV2.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The rebuilt field-tech dashboard — "mission control for today." It opens on
 *   the one thing that matters right now (a live job with its clock controls, a
 *   countdown to the next visit, or the next upcoming day), then shows the day at
 *   a glance: attention banners, a color-coded timeline of today's stops, the
 *   tech's own hours (travel + on-site + total) and task/photo counts, the
 *   finished visits with their time breakdown, and the next seven days. All of
 *   the main data comes from a single get_tech_dashboard call; taps that change
 *   things (clock, photo, tasks) refresh only the caches they touch.
 *
 * WHERE IT LIVES:
 *   Route:        /tech  (behind page:tech_dash_v2; legacy TechDash otherwise)
 *   Rendered by:  TechLayout pane host (persistent, kept alive across tabs)
 *
 * DEPENDS ON:
 *   Packages:  react, @tanstack/react-query
 *   Internal:  @/contexts/AuthContext, @/components/PullToRefresh,
 *              @/components/tech/v2 (TechV2Page, SkeletonList, ApptListRow),
 *              @/lib/techQuery (techKeys, invalidateTech),
 *              ./dash/* (DashHeader, NowNextHero, AttentionStrip, MiniTimeline,
 *              MyNumbers, CompletedRows, ComingUp, CreateFAB, dashHelpers)
 *   Data:      reads → get_tech_dashboard (one round trip: today's visits, my
 *                       next 7 days, open clock entry, hours today/week split
 *                       travel vs on-site, photos today)
 *              writes → none directly (composed widgets own their writes)
 *
 * NOTES / GOTCHAS:
 *   - `active` (from the pane host) gates the geolocation "away" check and the
 *     countdown ticker — a hidden persistent pane must not poll GPS or run timers.
 *   - Pull-to-refresh and post-mutation refreshes NEVER re-skeleton: the cold
 *     skeleton only shows on the very first load with no cached data; after that
 *     TanStack keeps the last data on screen while it revalidates in place.
 *   - Mutations invalidate through invalidateTech (techQuery's map) — no
 *     onReload-style full refetch.
 * ════════════════════════════════════════════════
 */
import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import PullToRefresh from '@/components/PullToRefresh';
import { TechV2Page, SkeletonList, ApptListRow } from '@/components/tech/v2';
import { techKeys, invalidateTech } from '@/lib/techQuery';
import { toast } from '@/lib/toast';
import DashHeader from './dash/DashHeader.jsx';
import NowNextHero from './dash/NowNextHero.jsx';
import AttentionStrip from './dash/AttentionStrip.jsx';
import MiniTimeline from './dash/MiniTimeline.jsx';
import MyNumbers from './dash/MyNumbers.jsx';
import CompletedRows from './dash/CompletedRows.jsx';
import ComingUp from './dash/ComingUp.jsx';
import CreateFAB from './dash/CreateFAB.jsx';
import { selectHero, splitToday } from './dash/dashHelpers.js';

/**
 * @param {{ active?: boolean }} props - active = this pane is the visible tab.
 */
export default function TechDashV2({ active = true }) {
  // ─── SECTION: State & hooks ──────────────
  const { employee, db, logout } = useAuth();
  const queryClient = useQueryClient();

  // ─── SECTION: Data fetching ──────────────
  const { data, isPending, refetch } = useQuery({
    queryKey: techKeys.dash(employee?.id),
    queryFn: () => db.rpc('get_tech_dashboard', { p_employee_id: employee.id }),
    enabled: !!employee?.id,
  });

  const onClock = useCallback(() => invalidateTech(queryClient, 'clock'), [queryClient]);
  const onPhoto = useCallback(() => invalidateTech(queryClient, 'photo'), [queryClient]);

  const onRefresh = useCallback(async () => {
    try { await refetch(); } catch { toast('Failed to refresh', 'error'); }
  }, [refetch]);

  // ─── SECTION: Render ──────────────
  // Cold start ONLY: no cached data yet. After first load, PTR/focus refreshes
  // keep the current content and never fall back to this skeleton.
  if (isPending || !data) return <SkeletonList rows={6} />;

  const appointments = data.appointments || [];
  const upcoming = data.upcoming || [];
  const hero = selectHero(data, employee?.id);
  const { active: activeAppts, scheduled, completed } = splitToday(appointments);

  // Everything today that isn't the hero and isn't completed → a plain list so
  // nothing is hidden behind the single hero tile.
  const heroId = hero?.appt?.id;
  const restOfToday = [...activeAppts, ...scheduled].filter((a) => a.id !== heroId);

  const tasksTotal = appointments.reduce((s, a) => s + Number(a.task_total || 0), 0);
  const tasksDone = appointments.reduce((s, a) => s + Number(a.task_completed || 0), 0);
  const isAdmin = employee?.role === 'admin';

  return (
    <TechV2Page>
      <DashHeader employee={employee} count={appointments.length} isAdmin={isAdmin} onLogout={logout} />

      <PullToRefresh onRefresh={onRefresh}>
        <div className="tv2-dash-body">
          <AttentionStrip
            employee={employee}
            db={db}
            active={active}
            openEntry={data.open_entry}
            onResolved={onClock}
          />

          <NowNextHero
            hero={hero}
            employee={employee}
            db={db}
            active={active}
            onClock={onClock}
            onPhoto={onPhoto}
          />

          <MiniTimeline appointments={appointments} />

          {restOfToday.length > 0 && (
            <div className="tv2-dash-rest">
              <div className="tv2-dash-section-title">Rest of today</div>
              {restOfToday.map((a) => <ApptListRow key={a.id} appt={a} />)}
            </div>
          )}

          <MyNumbers
            hoursToday={data.hours_today}
            hoursWeek={data.hours_week}
            tasksDone={tasksDone}
            tasksTotal={tasksTotal}
            photosToday={data.photos_today || 0}
          />

          <CompletedRows completed={completed} employee={employee} db={db} />

          <ComingUp upcoming={upcoming} />
        </div>
      </PullToRefresh>

      <CreateFAB />
    </TechV2Page>
  );
}
