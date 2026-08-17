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
 *   two-tap Remove). Reading insertion, placement, and removal require a live
 *   connection for the initial production release.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (part of the Stage, Z2)
 *   Rendered by:  src/pages/tech/v2/hub/HubStage.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom, react-i18next
 *   Internal:  @/contexts/AuthContext, @/components/tech/ReadingEntrySheet,
 *              @/components/tech/EquipmentPlacementSheet, @/components/tech/MaterialIcon,
 *              @/lib/toast, @/lib/offlineOperationId
 *   Data:      reads  → moisture_readings (get_job_readings), equipment_placements
 *                        (get_job_equipment)
 *              writes → moisture_readings (insert_reading), equipment_placements
 *                        (place_equipment, remove_equipment; online only)
 *
 * NOTES / GOTCHAS:
 *   - Readings/equipment are JOB-scoped (shared across a job's visits); tasks are
 *     per-visit. Mirrors the legacy TechAppointment behavior exactly.
 *   - Automatic offline command admission/replay is disabled for the initial
 *     release; every field mutation below fails before its network write.
 *   - Equipment Remove is a two-tap inline confirm (turns red, resets after 3s) —
 *     the only confirm idiom on the stage, never a modal or native confirm.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import ReadingEntrySheet from '@/components/tech/ReadingEntrySheet';
import EquipmentPlacementSheet, { EQUIPMENT_LABELS } from '@/components/tech/EquipmentPlacementSheet';
import MaterialIcon, { MATERIAL_LABELS } from '@/components/tech/MaterialIcon';
import { ErrorState } from '@/components/ui';
import { toast } from '@/lib/toast';
import { techKeys } from '@/lib/techQuery';
import { createOfflineOperationId } from '@/lib/offlineOperationId';

/**
 * `job` / `address` went with the scope-sheet row — HubMoreSheet builds those
 * query params now. This component is the LOGS (moisture, equipment, rooms).
 * @param {{ jobId: string, rooms: Array|null,
 *           onCreateRoom: (name:string)=>Promise<any>, onMutation?: (kind:string)=>void }} props
 */
export default function HubTools({ jobId, rooms, onCreateRoom, onMutation }) {
  const { t } = useTranslation('hub');
  const { employee, db, isFeatureEnabled } = useAuth();
  const queryClient = useQueryClient();
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

  // ── Saves (online-first release) ──
  const handleSaveReading = async (payload) => {
    if (!jobId) throw new Error('Job not loaded');
    // THROW, never return. ReadingEntrySheet awaits this and treats resolution as
    // success — it fires "Reading saved" and closes the sheet. A bare return here
    // resolved the promise, so the tech saw an error toast INSTANTLY overwritten by
    // a success toast, the sheet closed, and the typed reading was gone. Throwing
    // lands in the sheet's catch: "Failed to save reading: …", sheet stays open,
    // form intact.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error(
        'Moisture readings require an internet connection. Reconnect and try again.',
      );
    }
    const clientId = createOfflineOperationId();
    const p = {
      clientId, jobId, roomId: payload.roomId || null,
      material: payload.material, location: payload.location || null,
      mc: payload.mc ?? null, rh: payload.rh ?? null, tempF: payload.temp_f ?? null,
      gpp: payload.gpp ?? null, dewPoint: payload.dew_point ?? null,
      isAffected: !!payload.is_affected, equipmentId: payload.equipment_id || null,
      notes: payload.notes || null, takenBy: employee?.id || null,
      takenAt: new Date().toISOString(),
    };
    await db.rpc('insert_reading', {
      p_job_id: p.jobId, p_room_id: p.roomId, p_material: p.material, p_location: p.location,
      p_mc: p.mc, p_rh: p.rh, p_temp_f: p.tempF, p_gpp: p.gpp, p_dew_point: p.dewPoint,
      p_is_affected: p.isAffected, p_equipment_id: p.equipmentId, p_taken_by: p.takenBy,
      p_notes: p.notes, p_client_id: clientId,
    });
    toast(t('toast.readingSaved'));
    reloadHydro();
    onMutation?.('room');
  };

  const handlePlaceEquipment = async (payload) => {
    if (!jobId) throw new Error('Job not loaded');
    // THROW, never return — see handleSaveReading above. EquipmentPlacementSheet
    // has the identical await-then-succeed shape.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error(
        'Equipment placement requires an internet connection. Reconnect and try again.',
      );
    }
    const clientId = createOfflineOperationId();
    const p = {
      clientId, jobId, roomId: payload.roomId || null,
      equipmentType: payload.equipment_type, nickname: payload.nickname || null,
      serialNumber: payload.serial_number || null, placedBy: employee?.id || null,
    };
    await db.rpc('place_equipment', {
      p_job_id: p.jobId, p_room_id: p.roomId, p_equipment_type: p.equipmentType,
      p_nickname: p.nickname, p_serial: p.serialNumber, p_placed_by: p.placedBy,
      p_client_id: clientId, p_notes: null,
    });
    toast(t('toast.placed'));
    reloadHydro();
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
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        toast(
          'Equipment removal requires an internet connection. Reconnect and try again.',
          'error',
        );
        return;
      }
      await db.rpc('remove_equipment', { p_equipment_id: id, p_removed_by: employee?.id || null });
      toast(t('toast.equipRemoved'));
      reloadHydro();
      onMutation?.('room');
    } catch (err) {
      toast(t('toast.removeFailed', { message: err?.message || 'unknown' }), 'error');
    }
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
      {/* The Scope Sheet and OOP estimate rows moved to the action bar's "More"
          sheet 2026-08-08. They are VERBS — things a tech starts — and More is
          where verbs live now; leaving copies here meant two routes to one
          action, which is the duplication this wave is removing. What stays in
          this block is the LOGS: moisture, equipment, rooms.
          "Take a reading" in More scrolls here, so this block is also that
          sheet's landing target (see TechJobHub's toolsRef). */}

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

          {/* A thrown RPC and a genuinely empty job both arrive here as [],
              because `readingsQuery.data || []` cannot tell them apart. Showing
              the success empty-state on a failure is the highest-impact rule in
              loading-error-states.md §1, and on THIS screen it has a field
              consequence: a tech reading "No readings yet" during an outage may
              re-take readings that already exist. */}
          {readingsQuery.isError ? (
            <ErrorState message={t('stage.readingsError')} onRetry={() => readingsQuery.refetch()} retryLabel={t('states.retry')} />
          ) : readings.length === 0 ? (
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

          {equipmentQuery.isError ? (
            <ErrorState message={t('stage.equipmentError')} onRetry={() => equipmentQuery.refetch()} retryLabel={t('states.retry')} />
          ) : equipment.length === 0 ? (
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
