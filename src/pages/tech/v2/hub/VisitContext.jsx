/**
 * ════════════════════════════════════════════════
 * FILE: VisitContext.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Everything about the ONE visit the tech is currently looking at inside the
 *   Job Hub: the job timer (clock on-my-way / start / pause / finish), the
 *   crew on that visit, a shortcut into the Scope Sheet tool, the visit's task
 *   checklist, and — when those tools are turned on — the moisture-reading log
 *   and the drying-equipment list with the sheets to add to them. Readings and
 *   equipment are captured through the offline queue so they still save with no
 *   signal in a basement.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (part of /tech/job/:jobId, scoped to ?appt=)
 *   Rendered by:  src/pages/tech/v2/TechJobHub.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  @/contexts/AuthContext, @/components/tech/TimeTracker,
 *              ReadingEntrySheet, EquipmentPlacementSheet, MaterialIcon,
 *              @/lib/toast, @/lib/nativeHaptics, @/hooks/useOfflineQueue,
 *              @/lib/syncRunnerSingleton, @/pages/tech/techConstants
 *   Data:      reads  → job_tasks (get_appointment_tasks); moisture_readings,
 *                        rooms (get_job_readings); equipment_placements
 *                        (get_job_equipment)
 *              writes → job_tasks (toggle_appointment_task); moisture_readings
 *                        (insert_reading); equipment_placements (place_equipment,
 *                        remove_equipment) — direct or via the offline queue
 *
 * NOTES / GOTCHAS:
 *   - Tasks are per-visit (keyed to the appointment); readings/equipment/rooms
 *     are job-scoped (the same across the job's visits) — mirrors the legacy
 *     TechAppointment behavior exactly.
 *   - Equipment removal uses an inline two-tap confirm (button turns red, resets
 *     after 3s) — no modal or native confirm, per the no-alert rule.
 *   - Reading/equipment captures route through the offline queue when
 *     'offline:queue' is on (owner decision: per-visit captures keep the queue).
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import TimeTracker from '@/components/tech/TimeTracker';
import ReadingEntrySheet from '@/components/tech/ReadingEntrySheet';
import EquipmentPlacementSheet, { EQUIPMENT_LABELS } from '@/components/tech/EquipmentPlacementSheet';
import MaterialIcon, { MATERIAL_LABELS } from '@/components/tech/MaterialIcon';
import { toast } from '@/lib/toast';
import { useOfflineQueue } from '@/hooks/useOfflineQueue';
import { getSyncRunner } from '@/lib/syncRunnerSingleton';

// ─── SECTION: Helpers ──────────────
function relativeTime(isoStr) {
  if (!isoStr) return '';
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

export default function VisitContext({ appt, job, address, rooms, onCreateRoom, onClock }) {
  // ─── SECTION: State & hooks ──────────────
  const { employee, db, isFeatureEnabled } = useAuth();
  const navigate = useNavigate();
  const { enqueue } = useOfflineQueue();
  const offlineQueueEnabled = isFeatureEnabled('offline:queue');
  const moistureEnabled = isFeatureEnabled('page:tech_moisture');
  const equipmentEnabled = isFeatureEnabled('page:tech_equipment');

  const apptId = appt?.id;
  const jobId = job?.id;

  const [tasks, setTasks] = useState([]);
  const [readings, setReadings] = useState([]);
  const [equipment, setEquipment] = useState([]);
  const [readingSheetOpen, setReadingSheetOpen] = useState(false);
  const [equipmentSheetOpen, setEquipmentSheetOpen] = useState(false);
  const [confirmRemoveEquipId, setConfirmRemoveEquipId] = useState(null);
  const togglingRef = useRef(new Set());

  // ─── SECTION: Data fetching ──────────────
  const loadTasks = useCallback(async () => {
    if (!apptId) { setTasks([]); return; }
    try {
      const list = await db.rpc('get_appointment_tasks', { p_appointment_id: apptId });
      setTasks(list || []);
    } catch { setTasks([]); }
  }, [db, apptId]);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  const loadHydro = useCallback(async () => {
    if (!jobId) return;
    try {
      const [r, e] = await Promise.all([
        moistureEnabled ? db.rpc('get_job_readings', { p_job_id: jobId }) : Promise.resolve([]),
        equipmentEnabled ? db.rpc('get_job_equipment', { p_job_id: jobId, p_include_removed: false }) : Promise.resolve([]),
      ]);
      setReadings(r || []);
      setEquipment(e || []);
    } catch {
      // silent — sections just show their empty state
    }
  }, [db, jobId, moistureEnabled, equipmentEnabled]);

  useEffect(() => { loadHydro(); }, [loadHydro]);

  // Refresh readings/equipment when a queued change for THIS job finishes syncing.
  useEffect(() => {
    if (!offlineQueueEnabled || !jobId) return undefined;
    const runner = getSyncRunner();
    if (!runner) return undefined;
    return runner.on('sync:item-done', ({ item }) => {
      const t = item?.type;
      if (t !== 'reading.insert' && t !== 'equipment.place' && t !== 'equipment.remove') return;
      if (item?.payload?.jobId && item.payload.jobId !== jobId) return;
      loadHydro();
    });
  }, [offlineQueueEnabled, jobId, loadHydro]);

  // ─── SECTION: Event handlers ──────────────
  const toggleTask = async (task) => {
    if (togglingRef.current.has(task.id)) return;
    togglingRef.current.add(task.id);
    setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, is_completed: !t.is_completed } : t));
    try {
      await db.rpc('toggle_appointment_task', { p_task_id: task.id, p_employee_id: employee.id });
      onClock?.('task');
    } catch {
      toast('Failed to toggle task', 'error');
      setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, is_completed: !t.is_completed } : t));
    } finally {
      togglingRef.current.delete(task.id);
    }
  };

  const handleSaveReading = async (payload) => {
    if (!jobId) throw new Error('Job not loaded');
    const clientId = (crypto?.randomUUID?.()) || `${Date.now()}-${Math.random()}`;
    const queuePayload = {
      clientId, jobId, roomId: payload.roomId || null,
      material: payload.material, location: payload.location || null,
      mc: payload.mc ?? null, rh: payload.rh ?? null, tempF: payload.temp_f ?? null,
      gpp: payload.gpp ?? null, dewPoint: payload.dew_point ?? null,
      isAffected: !!payload.is_affected, equipmentId: payload.equipment_id || null,
      notes: payload.notes || null, takenBy: employee?.id || null,
      takenAt: new Date().toISOString(),
    };
    if (offlineQueueEnabled) {
      await enqueue({ type: 'reading.insert', clientId, payload: queuePayload });
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        toast('Reading queued — will upload when online', 'success');
      } else {
        toast('Reading saved');
      }
    } else {
      await db.rpc('insert_reading', {
        p_job_id: queuePayload.jobId, p_room_id: queuePayload.roomId,
        p_material: queuePayload.material, p_location: queuePayload.location,
        p_mc: queuePayload.mc, p_rh: queuePayload.rh, p_temp_f: queuePayload.tempF,
        p_gpp: queuePayload.gpp, p_dew_point: queuePayload.dewPoint,
        p_is_affected: queuePayload.isAffected, p_equipment_id: queuePayload.equipmentId,
        p_taken_by: queuePayload.takenBy, p_notes: queuePayload.notes, p_client_id: clientId,
      });
      toast('Reading saved');
      loadHydro();
    }
  };

  const handlePlaceEquipment = async (payload) => {
    if (!jobId) throw new Error('Job not loaded');
    const clientId = (crypto?.randomUUID?.()) || `${Date.now()}-${Math.random()}`;
    const queuePayload = {
      clientId, jobId, roomId: payload.roomId || null,
      equipmentType: payload.equipment_type, nickname: payload.nickname || null,
      serialNumber: payload.serial_number || null, placedBy: employee?.id || null,
    };
    if (offlineQueueEnabled) {
      await enqueue({ type: 'equipment.place', clientId, payload: queuePayload });
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        toast('Placement queued — will upload when online', 'success');
      } else {
        toast('Equipment placed');
      }
    } else {
      await db.rpc('place_equipment', {
        p_job_id: queuePayload.jobId, p_room_id: queuePayload.roomId,
        p_equipment_type: queuePayload.equipmentType, p_nickname: queuePayload.nickname,
        p_serial: queuePayload.serialNumber, p_placed_by: queuePayload.placedBy,
        p_client_id: clientId, p_notes: null,
      });
      toast('Equipment placed');
      loadHydro();
    }
  };

  const handleRemoveEquipment = async (equipmentId) => {
    if (confirmRemoveEquipId !== equipmentId) {
      setConfirmRemoveEquipId(equipmentId);
      setTimeout(() => setConfirmRemoveEquipId(null), 3000);
      return;
    }
    setConfirmRemoveEquipId(null);
    try {
      if (offlineQueueEnabled) {
        await enqueue({
          type: 'equipment.remove',
          clientId: (crypto?.randomUUID?.()) || `${Date.now()}-${Math.random()}`,
          payload: { equipmentId, removedBy: employee?.id || null, jobId },
        });
        toast('Equipment marked for removal');
      } else {
        await db.rpc('remove_equipment', { p_equipment_id: equipmentId, p_removed_by: employee?.id || null });
        toast('Equipment removed');
        loadHydro();
      }
    } catch (err) {
      toast('Remove failed: ' + (err?.message || 'unknown'), 'error');
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

  // Latest reading per (room, material) — for the stalled badge.
  const latestReadings = (() => {
    const seen = new Set();
    const out = [];
    for (const r of readings) {
      const key = `${r.room_id || 'none'}:${r.material}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
    return out;
  })();
  const stalledCount = latestReadings.filter((r) => r.is_stalled).length;

  // ─── SECTION: Render ──────────────
  if (!appt) {
    return (
      <div className="tv2-hub-section">
        <div style={{ fontSize: 13, color: 'var(--text-tertiary)', padding: '8px 0' }}>
          This visit is unavailable.
        </div>
      </div>
    );
  }

  const crew = appt.appointment_crew || [];
  const doneCount = tasks.filter((t) => t.is_completed).length;
  const totalCount = tasks.length;
  const progressPct = totalCount > 0 ? (doneCount / totalCount) * 100 : 0;

  return (
    <>
      {/* Time Tracker — consumed as-is */}
      <div style={{ padding: '0 var(--space-4)' }}>
        <TimeTracker appt={appt} employee={employee} db={db} onUpdate={() => onClock?.('clock')} />
      </div>

      {/* Crew */}
      {crew.length > 0 && (
        <div className="tv2-hub-section">
          <div className="tech-section-header-sticky">Crew</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {crew.map((c) => {
              const emp = c.employees;
              const initials = (emp?.display_name || emp?.full_name || '?')
                .split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
              const isLead = c.role === 'lead' || c.role === 'crew_lead';
              return (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 'var(--radius-full)',
                    background: 'var(--accent-light)', color: 'var(--accent)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 700, flexShrink: 0,
                  }}>
                    {initials}
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', flex: 1 }}>
                    {emp?.display_name || emp?.full_name || 'Unknown'}
                  </span>
                  {isLead && (
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '1px 6px',
                      borderRadius: 'var(--radius-full)',
                      background: 'var(--status-enroute-bg)', color: 'var(--status-enroute-color)', border: '1px solid var(--status-enroute-border)',
                    }}>
                      Lead
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Scope Sheet entry */}
      <div className="tv2-hub-section">
        <div className="tech-section-header-sticky" style={{ marginBottom: 8 }}>Tools</div>
        <button type="button" onClick={openScopeSheet} className="tv2-hub-tool-row">
          <div className="tv2-hub-tool-row__icon">📋</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Scope Sheet</div>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Capture scope of work room-by-room and email it</div>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      {/* Tasks */}
      <div className="tv2-hub-section">
        <div className="tech-section-header-sticky" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>Tasks {totalCount > 0 && <span style={{ fontSize: 12, fontWeight: 400, letterSpacing: 'normal', textTransform: 'none', color: 'var(--text-secondary)' }}>{doneCount}/{totalCount}</span>}</span>
          <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/tech/appointment/${apptId}/edit?section=tasks`)} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Tasks
          </button>
        </div>

        {totalCount > 0 && (
          <div className="tech-task-progress-bar" style={{ marginBottom: 8 }}>
            <div className="tech-task-progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
        )}

        {totalCount === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)', padding: '8px 0' }}>No tasks assigned</div>
        ) : (
          tasks.map((task) => (
            <div key={task.id} className="tech-task-row" onClick={() => toggleTask(task)} style={{ minHeight: 'var(--tech-row-height)' }}>
              <div className={`tech-task-check${task.is_completed ? ' done' : ''}`}>
                {task.is_completed && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                )}
              </div>
              <span className={`tech-task-name${task.is_completed ? ' done' : ''}`}>{task.title}</span>
            </div>
          ))
        )}
      </div>

      {/* Moisture (feature-gated) */}
      {moistureEnabled && (
        <div className="tv2-hub-section">
          <div className="tech-section-header-sticky" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              Moisture
              {readings.length > 0 && (
                <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-secondary)', letterSpacing: 'normal', textTransform: 'none' }}>
                  {readings.length} reading{readings.length === 1 ? '' : 's'}
                </span>
              )}
              {stalledCount > 0 && (
                <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 'var(--radius-full)', background: 'var(--status-paused-bg)', color: 'var(--status-paused-color)', border: '1px solid var(--status-paused-border)', letterSpacing: 'normal', textTransform: 'none' }}>
                  {stalledCount} stalled
                </span>
              )}
            </span>
            <button className="btn btn-secondary btn-sm" onClick={() => setReadingSheetOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Add Reading
            </button>
          </div>

          {readings.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-tertiary)', padding: '8px 0' }}>
              No readings yet. Log MC, RH, and temp to start a drying log.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
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
                  <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 48, padding: '8px 10px', borderRadius: 10, background: 'var(--bg-primary)', border: '1px solid var(--border-light)' }}>
                    <MaterialIcon type={r.material} size={22} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {MATERIAL_LABELS[r.material] || r.material}
                        {!r.is_affected && <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-tertiary)', marginLeft: 6 }}>(unaffected)</span>}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                        {r.room_name || 'Untagged'}
                        {r.location_description ? ` · ${r.location_description}` : ''}
                        {` · ${relativeTime(r.taken_at)}`}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', minWidth: 72 }}>
                      {mc != null ? (
                        <div style={{ fontSize: 16, fontWeight: 700, color: mcColor, fontFamily: 'var(--font-mono)' }}>{mc}%</div>
                      ) : (
                        <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>—</div>
                      )}
                      {goal != null && <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>goal {goal}%</div>}
                    </div>
                    {r.is_stalled && (
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 'var(--radius-full)', background: 'var(--status-paused-bg)', color: 'var(--status-paused-color)', border: '1px solid var(--status-paused-border)' }}>
                        STALLED
                      </span>
                    )}
                  </div>
                );
              })}
              {readings.length > 12 && (
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', paddingTop: 4 }}>
                  +{readings.length - 12} older reading{readings.length - 12 === 1 ? '' : 's'}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Equipment (feature-gated) */}
      {equipmentEnabled && (
        <div className="tv2-hub-section">
          <div className="tech-section-header-sticky" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>
              Equipment
              {equipment.length > 0 && (
                <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-secondary)', letterSpacing: 'normal', textTransform: 'none', marginLeft: 6 }}>
                  {equipment.length} on-site
                </span>
              )}
            </span>
            <button className="btn btn-secondary btn-sm" onClick={() => setEquipmentSheetOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Place
            </button>
          </div>

          {equipment.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-tertiary)', padding: '8px 0' }}>
              No equipment on-site. Place dehus, air movers, or AFDs to start tracking days on-site.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {equipment.map((e) => {
                const isConfirming = confirmRemoveEquipId === e.id;
                return (
                  <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 48, padding: '8px 10px', borderRadius: 10, background: 'var(--bg-primary)', border: '1px solid var(--border-light)' }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>
                      {(EQUIPMENT_LABELS[e.equipment_type] || 'EQ').slice(0, 3).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {e.nickname || EQUIPMENT_LABELS[e.equipment_type] || e.equipment_type}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                        {e.room_name || 'Untagged'}{` · Day ${(e.days_onsite || 0) + 1}`}
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemoveEquipment(e.id)}
                      onBlur={() => setConfirmRemoveEquipId(null)}
                      style={{
                        minHeight: 'var(--tech-min-tap, 48px)', minWidth: 48, padding: '6px 10px', fontSize: 12, fontWeight: 700,
                        border: `1px solid ${isConfirming ? 'var(--status-paused-border)' : 'var(--border-light)'}`,
                        borderRadius: 8,
                        background: isConfirming ? 'var(--status-paused-bg)' : 'var(--bg-tertiary)',
                        color: isConfirming ? 'var(--status-paused-color)' : 'var(--text-tertiary)',
                        cursor: 'pointer', fontFamily: 'var(--font-sans)',
                      }}
                    >
                      {isConfirming ? 'Confirm' : 'Remove'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Phase 2 sheets — mounted unconditionally; self-gate on `open`. */}
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
