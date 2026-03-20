import { DIV_COLORS, TYPE_COLORS, fmtTime } from '@/lib/scheduleUtils';

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
      allAppts.push({ ...appt, _jobName: job.insured_name, _jobId: job.job_id, _division: job.division });
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
                  const dc = DIV_COLORS[appt._division] || { bg: '#f1f3f5', text: '#6b7280' };
                  const isDone = appt.status === 'completed';
                  const crew = appt.crew || [];

                  return (
                    <div key={appt.id} onClick={e => { e.stopPropagation(); onApptClick(appt); }}
                      style={{
                        position: 'absolute', top, left: 2, right: 2, height: Math.max(height - 2, 26),
                        background: dc.bg, borderLeft: `3px solid ${color}`, borderRadius: 0,
                        padding: '3px 6px', overflow: 'hidden', cursor: 'pointer', zIndex: 2,
                        opacity: isDone ? 0.5 : 1,
                      }}
                      onMouseEnter={e => e.currentTarget.style.boxShadow = 'var(--shadow-sm)'}
                      onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
                    >
                      <div style={{ fontSize: 11, fontWeight: 700, color: dc.text, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {appt._jobName}
                      </div>
                      <div style={{ fontSize: 10, fontWeight: 500, color: dc.text, opacity: 0.8, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {appt.title}
                      </div>
                      {height > 50 && crew.length > 0 && (
                        <div style={{ fontSize: 9, color: dc.text, opacity: 0.7, marginTop: 2 }}>
                          {crew.map(c => c.display_name || c.full_name?.split(' ')[0]).join(', ')}
                        </div>
                      )}
                      {height > 70 && appt.time_start && (
                        <div style={{ fontSize: 9, color: dc.text, opacity: 0.6, marginTop: 1 }}>
                          {fmtTime(appt.time_start)}{appt.time_end ? ` – ${fmtTime(appt.time_end)}` : ''}
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
