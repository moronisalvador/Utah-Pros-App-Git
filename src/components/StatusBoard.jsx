import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';

const errToast = (msg) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type: 'error' } }));

// Status → colors. Uses existing --status-* tokens where defined; falls back to inline hex.
const STATUS_META = {
  paused:    { label: 'Paused',    bg: '#fef2f2', color: '#dc2626', border: '#fecaca', order: 1 },
  on_site:   { label: 'On site',   bg: '#f0fdf4', color: '#16a34a', border: '#bbf7d0', order: 2 },
  omw:       { label: 'OMW',       bg: '#fffbeb', color: '#d97706', border: '#fde68a', order: 3 },
  scheduled: { label: 'Scheduled', bg: '#eff6ff', color: '#2563eb', border: '#bfdbfe', order: 4 },
  idle:      { label: 'Idle',      bg: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: 'var(--border-color)', order: 5 },
};

const FILTER_ORDER = ['omw', 'on_site', 'paused', 'scheduled', 'idle'];

function fmtDuration(sinceIso) {
  if (!sinceIso) return '—';
  const ms = Date.now() - new Date(sinceIso).getTime();
  if (ms < 0) return '—';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function fmtAppt(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function mapsUrl(address) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

export default function StatusBoard() {
  const { db } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [divisionFilter, setDivisionFilter] = useState('all');
  const [lastUpdate, setLastUpdate] = useState(null);
  const [tick, setTick] = useState(0); // re-render every 60s to refresh durations
  const pollRef = useRef(null);

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const data = await db.rpc('get_tech_status_board');
      setRows(data || []);
      setLastUpdate(new Date());
    } catch (e) {
      errToast('Failed to load status board');
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, [db]);

  // Initial load + 30s poll
  useEffect(() => {
    load(true);
    pollRef.current = setInterval(() => load(false), 30000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load]);

  // Tick every 60s so "2h 15m" duration labels update without a full refetch
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  const counts = useMemo(() => {
    const c = { omw: 0, on_site: 0, paused: 0, scheduled: 0, idle: 0 };
    for (const r of rows) if (c[r.status] != null) c[r.status] += 1;
    return c;
  }, [rows]);

  const divisions = useMemo(() => {
    const set = new Set();
    for (const r of rows) if (r.division) set.add(r.division);
    return Array.from(set).sort();
  }, [rows]);

  const visibleRows = useMemo(() => {
    return rows.filter(r => {
      if (filter !== 'all' && r.status !== filter) return false;
      if (divisionFilter !== 'all' && r.division !== divisionFilter) return false;
      return true;
    });
  }, [rows, filter, divisionFilter]);

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>
        Loading status board…
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: 40 }} data-tick={tick}>
      {/* Header: counts as clickable filter pills */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
        padding: '12px 0 16px',
      }}>
        <FilterPill
          label="All"
          count={rows.length}
          active={filter === 'all'}
          onClick={() => setFilter('all')}
        />
        {FILTER_ORDER.map(key => (
          <FilterPill
            key={key}
            label={STATUS_META[key].label}
            count={counts[key]}
            active={filter === key}
            color={STATUS_META[key].color}
            bg={STATUS_META[key].bg}
            border={STATUS_META[key].border}
            onClick={() => setFilter(filter === key ? 'all' : key)}
          />
        ))}

        <div style={{ flex: 1 }} />

        {divisions.length > 0 && (
          <select
            value={divisionFilter}
            onChange={e => setDivisionFilter(e.target.value)}
            className="input"
            style={{ height: 32, fontSize: 13, minWidth: 140 }}
          >
            <option value="all">All divisions</option>
            {divisions.map(d => (
              <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>
            ))}
          </select>
        )}

        {lastUpdate && (
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
            Updated {lastUpdate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          </span>
        )}
      </div>

      {/* Table */}
      <div style={{
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border-color)',
        overflow: 'hidden',
        background: 'var(--bg-primary)',
      }}>
        {/* Header row */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1.5fr 110px 2fr 2fr 90px 130px',
          padding: '8px 16px',
          background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border-color)',
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--text-tertiary)',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}>
          <div>Technician</div>
          <div>Status</div>
          <div>Job / Client</div>
          <div>Address</div>
          <div>Duration</div>
          <div>Next appt</div>
        </div>

        {visibleRows.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-tertiary)' }}>
            {filter === 'all' ? 'No technicians match the current filters.' : `No technicians are currently ${STATUS_META[filter]?.label.toLowerCase() || filter}.`}
          </div>
        )}

        {visibleRows.map((r, i) => {
          const meta = STATUS_META[r.status] || STATUS_META.idle;
          const isLast = i === visibleRows.length - 1;
          return (
            <div
              key={r.employee_id}
              style={{
                display: 'grid',
                gridTemplateColumns: '1.5fr 110px 2fr 2fr 90px 130px',
                alignItems: 'center',
                padding: '12px 16px',
                borderBottom: isLast ? 'none' : '1px solid var(--border-light)',
                background: 'var(--bg-primary)',
                fontSize: 13,
              }}
            >
              {/* Tech name + division */}
              <div>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{r.full_name}</div>
                {r.default_division && (
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'capitalize', marginTop: 2 }}>
                    {r.default_division}
                  </div>
                )}
              </div>

              {/* Status pill */}
              <div>
                <span style={{
                  display: 'inline-block',
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '3px 10px',
                  borderRadius: 'var(--radius-full)',
                  background: meta.bg,
                  color: meta.color,
                  border: `1px solid ${meta.border}`,
                }}>
                  {meta.label}
                </span>
              </div>

              {/* Job / Client */}
              <div style={{ minWidth: 0 }}>
                {r.job_id ? (
                  <a
                    href={`/jobs/${r.job_id}`}
                    style={{ color: 'var(--text-primary)', textDecoration: 'none', display: 'block' }}
                  >
                    <div style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {r.job_number || '—'}
                    </div>
                    {r.client_name && (
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {r.client_name}
                      </div>
                    )}
                  </a>
                ) : (
                  <span style={{ color: 'var(--text-tertiary)' }}>—</span>
                )}
              </div>

              {/* Address */}
              <div style={{ minWidth: 0 }}>
                {r.address ? (
                  <a
                    href={mapsUrl(r.address)}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      color: 'var(--accent)',
                      textDecoration: 'none',
                      fontSize: 12,
                      display: 'block',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                    title={r.address}
                  >
                    {r.address}
                  </a>
                ) : (
                  <span style={{ color: 'var(--text-tertiary)' }}>—</span>
                )}
              </div>

              {/* Duration */}
              <div style={{ color: 'var(--text-secondary)' }}>
                {fmtDuration(r.status_since)}
              </div>

              {/* Next appt */}
              <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                {r.next_appt_time ? (
                  <>
                    <div>{fmtAppt(r.next_appt_time)}</div>
                    {r.next_appt_title && (
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {r.next_appt_title}
                      </div>
                    )}
                  </>
                ) : (
                  <span style={{ color: 'var(--text-tertiary)' }}>—</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FilterPill({ label, count, active, color, bg, border, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        borderRadius: 'var(--radius-full)',
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
        background: active ? (bg || 'var(--accent-light)') : 'var(--bg-primary)',
        color: active ? (color || 'var(--accent)') : 'var(--text-secondary)',
        border: `1px solid ${active ? (border || 'var(--accent)') : 'var(--border-color)'}`,
        transition: 'all 120ms',
      }}
    >
      <span>{label}</span>
      <span style={{
        fontSize: 11,
        padding: '1px 6px',
        borderRadius: 'var(--radius-full)',
        background: active ? 'rgba(255,255,255,0.5)' : 'var(--bg-tertiary)',
        color: active ? (color || 'var(--accent)') : 'var(--text-tertiary)',
      }}>
        {count}
      </span>
    </button>
  );
}
