/**
 * ════════════════════════════════════════════════
 * FILE: HubTools.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The field tools on the Job Hub stage: a shortcut into the Scope Sheet, the
 *   moisture drying log (each reading colored against its drying goal, with
 *   "stalled" flags), and the drying-equipment list (what's on site, how many
 *   days each has been running — the number the drying rental bills off — with a
 *   two-tap Remove). Adding a reading or placing/removing equipment saves through
 *   the offline queue so it still works with no signal in a basement.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (part of the Stage, Z2)
 *   Rendered by:  src/pages/tech/v2/hub/HubStage.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom, react-i18next
 *   Internal:  @/contexts/AuthContext, @/components/tech/ReadingEntrySheet,
 *              @/components/tech/EquipmentPlacementSheet, @/components/tech/MaterialIcon,
 *              @/lib/toast, @/hooks/useOfflineQueue, @/lib/syncRunnerSingleton
 *   Data:      reads  → moisture_readings (get_job_readings), equipment_placements
 *                        (get_job_equipment)
 *              writes → moisture_readings (insert_reading), equipment_placements
 *                        (place_equipment / remove_equipment) — direct or queued
 *
 * NOTES / GOTCHAS:
 *   - Readings/equipment are JOB-scoped (shared across a job's visits); tasks are
 *     per-visit. Mirrors the legacy TechAppointment behavior exactly.
 *   - Offline fork (owner decision): per-visit captures keep the queue when
 *     'offline:queue' is on. A queued change fires onMutation('room') so the hub
 *     + rooms caches repaint once it syncs.
 *   - Equipment Remove is a two-tap inline confirm (turns red, resets after 3s) —
 *     the only confirm idiom on the stage, never a modal or native confirm.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import ReadingEntrySheet from '@/components/tech/ReadingEntrySheet';
import EquipmentPlacementSheet, { EQUIPMENT_LABELS } from '@/components/tech/EquipmentPlacementSheet';
import MaterialIcon, { MATERIAL_LABELS } from '@/components/tech/MaterialIcon';
import { toast } from '@/lib/toast';
import { techKeys } from '@/lib/techQuery';
import { useOfflineQueue } from '@/hooks/useOfflineQueue';
import { getSyncRunner } from '@/lib/syncRunnerSingleton';

const newClientId = () => (crypto?.randomUUID?.()) || `${Date.now()}-${Math.random()}`;

/**
 * @param {{ job: object, jobId: string, address?: string, rooms: Array|null,
 *           onCreateRoom: (name:string)=>Promise<any>, onMutation?: (kind:string)=>void }} props
 */
export default function HubTools({ job, jobId, address, rooms, onCreateRoom, onMutation }) {
  const { t } = useTranslation('hub');
  const { employee, db, isFeatureEnabled } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { enqueue } = useOfflineQueue();
  const offlineQueueEnabled = isFeatureEnabled('offline:queue');
  const moistureEnabled = isFeatureEnabled('page:tech_moisture');
  const equipmentEnabled = isFeatureEnabled('page:tech_equipment');

  const [readingSheetOpen, setReadingSheetOpen] = useState(false);
  const [equipmentSheetOpen, setEquipmentSheetOpen] = useState(false);
  const [confirmRemoveId, setConfirmRemoveId] = useState(null);
  const confirmTimer = useRef(null);

  // ── Relative time (localized, coarse) ──
  const relativeTime = useCallback((isoStr) => {
    if (!isoStr) return '';
    const mins = Math.floor((Date.now() - new Date(isoStr).getTime()) / 60000);
    if (mins < 1) return t('time.justNow');
    if (mins < 60) return t('time.minutesAgo', { n: mins });
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return t('time.hoursAgo', { n: hrs });
    const days = Math.floor(hrs / 24);
    if (days === 1) return t('time.yesterday');
    return t('time.daysAgo', { n: days });
  }, [t]);

  // ── Data (cache-first via React Query, under the hub prefix) ──
  const readingsQuery = useQuery({
    queryKey: [...techKeys.hub(jobId), 'readings'],
    queryFn: () => db.rpc('get_job_readings', { p_job_id: jobId }),
    enabled: !!(moistureEnabled && jobId),
  });
  const equipmentQuery = useQuery({
    queryKey: [...techKeys.hub(jobId), 'equipment'],
    queryFn: () => db.rpc('get_job_equipment', { p_job_id: jobId, p_include_removed: false }),
    enabled: !!(equipmentEnabled && jobId),
  });
  const readings = readingsQuery.data || [];
  const equipment = equipmentQuery.data || [];

  // Both hydro queries live under the 'hub' kind, so invalidating 'room' (which
  // also invalidates 'hub') repaints them — no manual load-effect needed.
  const reloadHydro = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: [...techKeys.hub(jobId), 'readings'] });
    queryClient.invalidateQueries({ queryKey: [...techKeys.hub(jobId), 'equipment'] });
  }, [queryClient, jobId]);

  useEffect(() => () => { if (confirmTimer.current) clearTimeout(confirmTimer.current); }, []);

  // Refresh when a queued hydro change for THIS job finishes syncing.
  useEffect(() => {
    if (!offlineQueueEnabled || !jobId) return undefined;
    const runner = getSyncRunner();
    if (!runner) return undefined;
    return runner.on('sync:item-done', ({ item }) => {
      const ty = item?.type;
      if (ty !== 'reading.insert' && ty !== 'equipment.place' && ty !== 'equipment.remove') return;
      if (item?.payload?.jobId && item.payload.jobId !== jobId) return;
      reloadHydro();
    });
  }, [offlineQueueEnabled, jobId, reloadHydro]);

  // ── Saves (offline fork) ──
  const handleSaveReading = async (payload) => {
    if (!jobId) throw new Error('Job not loaded');
    const clientId = newClientId();
    const p = {
      clientId, jobId, roomId: payload.roomId || null,
      material: payload.material, location: payload.location || null,
      mc: payload.mc ?? null, rh: payload.rh ?? null, tempF: payload.temp_f ?? null,
      gpp: payload.gpp ?? null, dewPoint: payload.dew_point ?? null,
      isAffected: !!payload.is_affected, equipmentId: payload.equipment_id || null,
      notes: payload.notes || null, takenBy: employee?.id || null,
      takenAt: new Date().toISOString(),
    };
    if (offlineQueueEnabled) {
      await enqueue({ type: 'reading.insert', clientId, payload: p });
      toast(typeof navigator !== 'undefined' && navigator.onLine === false ? t('toast.readingQueued') : t('toast.readingSaved'));
    } else {
      await db.rpc('insert_reading', {
        p_job_id: p.jobId, p_room_id: p.roomId, p_material: p.material, p_location: p.location,
        p_mc: p.mc, p_rh: p.rh, p_temp_f: p.tempF, p_gpp: p.gpp, p_dew_point: p.dewPoint,
        p_is_affected: p.isAffected, p_equipment_id: p.equipmentId, p_taken_by: p.takenBy,
        p_notes: p.notes, p_client_id: clientId,
      });
      toast(t('toast.readingSaved'));
      reloadHydro();
    }
    onMutation?.('room');
  };

  const handlePlaceEquipment = async (payload) => {
    if (!jobId) throw new Error('Job not loaded');
    const clientId = newClientId();
    const p = {
      clientId, jobId, roomId: payload.roomId || null,
      equipmentType: payload.equipment_type, nickname: payload.nickname || null,
      serialNumber: payload.serial_number || null, placedBy: employee?.id || null,
    };
    if (offlineQueueEnabled) {
      await enqueue({ type: 'equipment.place', clientId, payload: p });
      toast(typeof navigator !== 'undefined' && navigator.onLine === false ? t('toast.placementQueued') : t('toast.placed'));
    } else {
      await db.rpc('place_equipment', {
        p_job_id: p.jobId, p_room_id: p.roomId, p_equipment_type: p.equipmentType,
        p_nickname: p.nickname, p_serial: p.serialNumber, p_placed_by: p.placedBy,
        p_client_id: clientId, p_notes: null,
      });
      toast(t('toast.placed'));
      reloadHydro();
    }
    onMutation?.('room');
  };

  const handleRemove = async (id) => {
    if (confirmRemoveId !== id) {
      setConfirmRemoveId(id);
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirmRemoveId(null), 3000);
      return;
    }
    setConfirmRemoveId(null);
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    try {
      if (offlineQueueEnabled) {
        await enqueue({ type: 'equipment.remove', clientId: newClientId(), payload: { equipmentId: id, removedBy: employee?.id || null, jobId } });
        toast(t('toast.equipMarkedRemoval'));
      } else {
        await db.rpc('remove_equipment', { p_equipment_id: id, p_removed_by: employee?.id || null });
        toast(t('toast.equipRemoved'));
        reloadHydro();
      }
      onMutation?.('room');
    } catch (err) {
      toast(t('toast.removeFailed', { message: err?.message || 'unknown' }), 'error');
    }
  };

  const openScopeSheet = () => {
    const params = new URLSearchParams();
    if (job?.id) params.set('jobId', job.id);
    if (job?.job_number) params.set('jobNumber', job.job_number);
    if (address) params.set('address', address);
    if (job?.insured_name) params.set('insuredName', job.insured_name);
    if (job?.encircle_claim_id) params.set('claimId', job.encircle_claim_id);
    const qs = params.toString();
    navigate(`/tech/tools/demo-sheet${qs ? '?' + qs : ''}`);
  };

  // Latest reading per (room, material) → stalled count in the header.
  const stalledCount = (() => {
    const seen = new Set();
    let n = 0;
    for (const r of readings) {
      const key = `${r.room_id || 'none'}:${r.material}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (r.is_stalled) n += 1;
    }
    return n;
  })();

  return (
    <>
      {/* Scope Sheet */}
      <section className="tv2-hub-section">
        <div className="tv2-hub-section__title" style={{ marginBottom: 8 }}>{t('stage.tools')}</div>
        <button type="button" className="tv2-hub-tool-row" onClick={openScopeSheet}>
          <div className="tv2-hub-tool-row__icon">📋</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="tv2-hub-tool-row__title">{t('stage.scopeSheet')}</div>
            <div className="tv2-hub-tool-row__sub">{t('stage.scopeSheetDesc')}</div>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
        </button>
      </section>

      {/* Moisture log */}
      {moistureEnabled && (
        <section className="tv2-hub-section">
          <div className="tv2-hub-section__head">
            <span className="tv2-hub-section__title">
              {t('stage.moisture')}
              {readings.length > 0 && <span className="tv2-hub-section__count">{t('stage.readingsCount', { count: readings.length })}</span>}
              {stalledCount > 0 && <span className="tv2-hub-badge tv2-hub-badge--alert">{t('stage.stalled', { count: stalledCount })}</span>}
            </span>
            <button type="button" className="tv2-hub-linkbtn" onClick={() => setReadingSheetOpen(true)}>+ {t('stage.addReading')}</button>
          </div>

          {readings.length === 0 ? (
            <div className="tv2-hub-empty">{t('stage.noReadings')}</div>
          ) : (
            <div className="tv2-hub-rows">
              {readings.slice(0, 12).map((r) => {
                const mc = r.mc_pct;
                const goal = r.drying_goal_pct;
                let mcColor = 'var(--text-primary)';
                if (mc != null && goal != null) {
                  if (mc <= goal) mcColor = 'var(--status-working-color)';
                  else if (mc - goal <= 2) mcColor = 'var(--status-enroute-color)';
                  else mcColor = 'var(--status-paused-color)';
                }
                return (
                  <div key={r.id} className="tv2-hub-row">
                    <MaterialIcon type={r.material} size={22} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="tv2-hub-row__title">
                        {MATERIAL_LABELS[r.material] || r.material}
                        {!r.is_affected && <span className="tv2-hub-row__tag">{t('stage.unaffected')}</span>}
                      </div>
                      <div className="tv2-hub-row__sub">
                        {r.room_name || t('stage.untagged')}
                        {r.location_description ? ` · ${r.location_description}` : ''}
                        {` · ${relativeTime(r.taken_at)}`}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', minWidth: 64 }}>
                      {mc != null ? (
                        <div style={{ fontSize: 16, fontWeight: 700, color: mcColor, fontFamily: 'var(--font-mono)' }}>{mc}%</div>
                      ) : (
                        <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>—</div>
                      )}
                      {goal != null && <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{t('stage.goal', { value: goal })}</div>}
                    </div>
                    {r.is_stalled && <span className="tv2-hub-badge tv2-hub-badge--alert">{t('stage.stalledBadge')}</span>}
                  </div>
                );
              })}
              {readings.length > 12 && (
                <div className="tv2-hub-more">{t('stage.olderReadings', { count: readings.length - 12 })}</div>
              )}
            </div>
          )}
        </section>
      )}

      {/* Equipment list */}
      {equipmentEnabled && (
        <section className="tv2-hub-section">
          <div className="tv2-hub-section__head">
            <span className="tv2-hub-section__title">
              {t('stage.equipment')}
              {equipment.length > 0 && <span className="tv2-hub-section__count">{t('stage.onSiteCount', { count: equipment.length })}</span>}
            </span>
            <button type="button" className="tv2-hub-linkbtn" onClick={() => setEquipmentSheetOpen(true)}>+ {t('stage.place')}</button>
          </div>

          {equipment.length === 0 ? (
            <div className="tv2-hub-empty">{t('stage.noEquipment')}</div>
          ) : (
            <div className="tv2-hub-rows">
              {equipment.map((e) => {
                const isConfirming = confirmRemoveId === e.id;
                return (
                  <div key={e.id} className="tv2-hub-row">
                    <div className="tv2-hub-row__eq">{(EQUIPMENT_LABELS[e.equipment_type] || 'EQ').slice(0, 3).toUpperCase()}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="tv2-hub-row__title">{e.nickname || EQUIPMENT_LABELS[e.equipment_type] || e.equipment_type}</div>
                      <div className="tv2-hub-row__sub">{e.room_name || t('stage.untagged')} · {t('stage.day', { n: (e.days_onsite || 0) + 1 })}</div>
                    </div>
                    <button
                      type="button"
                      className={`tv2-hub-removebtn${isConfirming ? ' is-confirming' : ''}`}
                      onClick={() => handleRemove(e.id)}
                      onBlur={() => setConfirmRemoveId(null)}
                    >
                      {isConfirming ? t('stage.confirm') : t('stage.remove')}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      <ReadingEntrySheet
        open={readingSheetOpen}
        onClose={() => setReadingSheetOpen(false)}
        onSave={async (payload) => { await handleSaveReading(payload); setReadingSheetOpen(false); }}
        jobId={jobId}
        rooms={rooms}
        onCreateRoom={onCreateRoom}
        equipmentList={equipment.map((e) => ({ id: e.id, label: e.nickname || EQUIPMENT_LABELS[e.equipment_type] || e.equipment_type }))}
      />
      <EquipmentPlacementSheet
        open={equipmentSheetOpen}
        onClose={() => setEquipmentSheetOpen(false)}
        onSave={async (payload) => { await handlePlaceEquipment(payload); setEquipmentSheetOpen(false); }}
        jobId={jobId}
        rooms={rooms}
        onCreateRoom={onCreateRoom}
      />
    </>
  );
}
