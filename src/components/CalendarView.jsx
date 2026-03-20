import { TYPE_COLORS, fmtTime } from '@/lib/scheduleUtils';

const CAL_START_HOUR = 7;
const CAL_END_HOUR = 18;
const CAL_HOUR_HEIGHT = 60;
const CAL_TOTAL_HOURS = CAL_END_HOUR - CAL_START_HOUR;

function timeToMinutes(t) {
  if (!t) return CAL_START_HOUR * 60 + 60; // default 7am
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

function CalendarView({ days, boardData, onApptClick, onCellClick }) {
  // Flatten all appointments with job info
  const allAppts = [];
  for (const job of boardData) {
    for (const appt of (job.appointments || [])) {
      allAppts.push({
        ...appt,
        _jobName: job.insured_name,
        _jobId: job.job_id,
        _division: job.division,
        _address: job.address,
        _jobNumber: job.job_number,
      });
    }
  }

  // Group by date
  const byDate = {};
  for (const a of allAppts) {
    if (!byDate[a.date]) byDate[a.date] = [];
    byDate[a.date].push(a);
  }

  const hours = Array.from({ length: CAL_TOTAL_HOURS }, (_, i) => CAL_START_HOUR + i);

  return (
    <div style={CV.wrap}>
      <div style={CV.grid}>
        {/* Time labels column */}
        <div style={CV.timeCol}>
          <div style={CV.timeHeader} />
          {hours.map((h, i) => (
            <div key={h} style={CV.timeLabel}>
              <span style={{
                position: 'absolute', right: 6, fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 500,
                top: i === 0 ? 4 : -7,
              }}>{h === 0 ? '12am' : h === 12 ? '12pm' : h < 12 ? `${h}am` : `${h - 12}pm`}</span>
            </div>
          ))}
        </div>

        {/* Day columns */}
        {days.map(day => {
          const appts = byDate[day.key] || [];
          return (
            <div key={day.key} style={CV.dayCol}>
              {/* Day header */}
              <div style={{ ...CV.dayHeader, ...(day.isToday ? { background: '#f0f7ff' } : {}) }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: day.isToday ? '#2563eb' : 'var(--text-secondary)' }}>{day.label}</div>
                <div style={{ fontSize: 11, color: day.isToday ? '#2563eb' : 'var(--text-tertiary)', fontWeight: day.isToday ? 600 : 400 }}>{day.shortDate}</div>
              </div>

              {/* Hour grid + appointment blocks */}
              <div style={CV.dayBody}>
                {/* Hour lines */}
                {hours.map(h => (
                  <div key={h} style={{ ...CV.hourLine, top: (h - CAL_START_HOUR) * CAL_HOUR_HEIGHT }}
                    onClick={() => {
                      // Find first job on board to create appointment
                      if (boardData.length > 0) onCellClick(boardData[0].job_id, day.key);
                    }} />
                ))}

                {/* Now line */}
                {day.isToday && (() => {
                  const now = new Date();
                  const mins = now.getHours() * 60 + now.getMinutes();
                  const top = ((mins - CAL_START_HOUR * 60) / 60) * CAL_HOUR_HEIGHT;
                  if (top < 0 || top > CAL_TOTAL_HOURS * CAL_HOUR_HEIGHT) return null;
                  return (
                    <div style={{ position: 'absolute', top, left: 0, right: 0, height: 2, background: '#ef4444', zIndex: 5, pointerEvents: 'none' }}>
                      <div style={{ width: 8, height: 8, borderRadius: 4, background: '#ef4444', position: 'absolute', left: -4, top: -3 }} />
                    </div>
                  );
                })()}

                {/* Appointment blocks */}
                {appts.map(appt => {
                  const startMins = timeToMinutes(appt.time_start);
                  const endMins = appt.time_end ? timeToMinutes(appt.time_end) : startMins + 60;
                  const top = ((startMins - CAL_START_HOUR * 60) / 60) * CAL_HOUR_HEIGHT;
                  const height = Math.max(((endMins - startMins) / 60) * CAL_HOUR_HEIGHT, 28);
                  const color = appt.color || TYPE_COLORS[appt.type] || '#6b7280';
                  const isDone = appt.status === 'completed';
                  const crew = appt.crew || [];
                  const getInitials = (name) => {
                    if (!name) return '?';
                    const parts = name.trim().split(/\s+/);
                    return parts.length >= 2 ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() : parts[0][0].toUpperCase();
                  };
                  // Short address — just street
                  const shortAddr = appt._address ? appt._address.split(',')[0] : '';

                  return (
                    <div key={appt.id} onClick={e => { e.stopPropagation(); onApptClick(appt); }}
                      style={{
                        position: 'absolute', top, left: 2, right: 2, height: Math.max(height - 2, 26),
                        background: color, borderLeft: `4px solid ${color}`, borderRadius: 4,
                        padding: '4px 7px', overflow: 'hidden', cursor: 'pointer', zIndex: 2,
                        opacity: isDone ? 0.5 : 1,
                      }}
                      onMouseEnter={e => e.currentTarget.style.filter = 'brightness(1.1)'}
                      onMouseLeave={e => e.currentTarget.style.filter = 'none'}
                    >
                      {/* Row 1: Job name + crew initials */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', flex: 1,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.2 }}>
                          {appt._jobName}
                        </span>
                        {crew.length > 0 && (
                          <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                            {crew.slice(0, 3).map(c => (
                              <span key={c.id} title={c.display_name || c.full_name} style={{
                                width: 20, height: 20, borderRadius: 10, fontSize: 8, fontWeight: 700,
                                background: 'rgba(255,255,255,0.3)', color: '#fff',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                border: c.role === 'lead' ? '1.5px solid rgba(255,255,255,0.8)' : 'none',
                              }}>{getInitials(c.display_name || c.full_name)}</span>
                            ))}
                            {crew.length > 3 && (
                              <span style={{ fontSize: 8, fontWeight: 600, color: 'rgba(255,255,255,0.7)', alignSelf: 'center' }}>+{crew.length - 3}</span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Row 2: Time window */}
                      {appt.time_start && (
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.85)', lineHeight: 1.3 }}>
                          🕐 {fmtTime(appt.time_start)}{appt.time_end ? `-${fmtTime(appt.time_end)}` : ''}
                        </div>
                      )}

                      {/* Row 3: Address (if space) */}
                      {height > 60 && shortAddr && (
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.75)', lineHeight: 1.3,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {shortAddr}
                        </div>
                      )}

                      {/* Row 4: Job number (if space) */}
                      {height > 80 && appt._jobNumber && (
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)', lineHeight: 1.3 }}>
                          Job #{appt._jobNumber}
                        </div>
                      )}

                      {/* Row 5: Task progress (if space) */}
                      {height > 100 && appt.tasks_total > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
                          <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.25)', borderRadius: 2, overflow: 'hidden' }}>
                            <div style={{
                              width: `${Math.round((appt.tasks_done / appt.tasks_total) * 100)}%`,
                              height: '100%', background: 'rgba(255,255,255,0.8)', borderRadius: 2,
                            }} />
                          </div>
                          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.7)' }}>{appt.tasks_done}/{appt.tasks_total}</span>
                        </div>
                      )}

                      {/* Row 6: Appointment title / phases (if space) */}
                      {height > 120 && (
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)', marginTop: 2, lineHeight: 1.3,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {appt.title}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const CV = {
  wrap: { flex: 1, overflow: 'auto' },
  grid: { display: 'flex', minWidth: 600 },
  timeCol: { width: 52, flexShrink: 0, borderRight: '1px solid var(--border-color)' },
  timeHeader: { height: 44, borderBottom: '1px solid var(--border-color)', background: 'var(--bg-secondary)' },
  timeLabel: { height: CAL_HOUR_HEIGHT, position: 'relative' },
  dayCol: { flex: 1, minWidth: 120, borderRight: '1px solid var(--border-light)' },
  dayHeader: {
    height: 44, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    borderBottom: '1px solid var(--border-color)', background: 'var(--bg-secondary)', flexShrink: 0,
  },
  dayBody: {
    position: 'relative', height: CAL_TOTAL_HOURS * CAL_HOUR_HEIGHT,
  },
  hourLine: {
    position: 'absolute', left: 0, right: 0, height: CAL_HOUR_HEIGHT,
    borderBottom: '1px solid var(--border-light)', cursor: 'pointer',
  },
};

// ═══════════════════════════════════════════════════════════════

export default CalendarView;
