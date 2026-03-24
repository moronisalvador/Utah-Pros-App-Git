import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import PullToRefresh from '@/components/PullToRefresh';

const toast = (msg, type = 'success') =>
  window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type } }));
const errToast = (msg) => toast(msg, 'error');

const DIV_COLOR = { water: '#2563eb', mold: '#9d174d', reconstruction: '#d97706', fire: '#dc2626', contents: '#059669' };
const DIV_EMOJI = { water: '💧', mold: '🧬', reconstruction: '🏗️', fire: '🔥', contents: '📦' };

const AR_STATUSES = [
  { value: 'open',        label: 'Open',        color: '#6b7280', bg: '#f9fafb' },
  { value: 'invoiced',    label: 'Invoiced',    color: '#2563eb', bg: '#eff6ff' },
  { value: 'partial',     label: 'Partial',     color: '#d97706', bg: '#fffbeb' },
  { value: 'paid',        label: 'Paid',        color: '#059669', bg: '#ecfdf5' },
  { value: 'disputed',    label: 'Disputed',    color: '#dc2626', bg: '#fef2f2' },
  { value: 'written_off', label: 'Written Off', color: '#9ca3af', bg: '#f3f4f6' },
];

// ── Formatters ────────────────────────────────────────────────────────────────
const fmtDollar = (v) => {
  if (v == null) return '—';
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const fmtKilo = (v) => {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (Math.abs(n) >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'M';
  if (Math.abs(n) >= 1000)    return '$' + (n / 1000).toFixed(0) + 'k';
  return '$' + Math.round(n);
};
const fmtPh = (ph) => {
  if (!ph) return null;
  const d = ph.replace(/\D/g, '');
  const n = d.startsWith('1') ? d.slice(1) : d;
  if (n.length === 10) return `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`;
  return ph;
};
const fmtDate = (v) =>
  v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—';
const fmtPct = (n, d) =>
  d > 0 ? Math.round((n / d) * 100) + '%' : '—';

// ── Aging helpers ─────────────────────────────────────────────────────────────
function ageDays(job) {
  const ref = job.invoiced_date || job.phase_entered_at || job.received_date || job.created_at;
  if (!ref) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(ref)) / 86400000));
}
const ageBucket = (d) =>
  d === null ? 'unknown' : d < 30 ? 'current' : d < 60 ? '30-60' : d < 90 ? '60-90' : '90+';
const ageColor = (d) => {
  if (d === null) return 'var(--text-tertiary)';
  if (d < 30)     return '#059669';
  if (d < 60)     return '#d97706';
  if (d < 90)     return '#ea580c';
  return '#dc2626';
};
const ageBg = (d) => {
  if (d === null) return 'var(--bg-tertiary)';
  if (d < 30)     return '#ecfdf5';
  if (d < 60)     return '#fffbeb';
  if (d < 90)     return '#fff7ed';
  return '#fef2f2';
};

// ── Balance decomposition ─────────────────────────────────────────────────────
// For insurance jobs:
//   Total owed = invoiced - collected
//   Homeowner portion (deductible) = deductible if not yet received
//   Insurance portion = balance - deductible_portion
function getBalances(job) {
  const invoiced   = Number(job.invoiced_value)   || 0;
  const collected  = Number(job.collected_value)  || 0;
  const deductible = Number(job.deductible)       || 0;
  const balance    = Math.max(0, invoiced - collected);
  const ded_owed   = (job.insurance_company && deductible > 0 && !job.deductible_collected)
    ? Math.min(deductible, balance)
    : 0;
  const ins_balance = Math.max(0, balance - ded_owed);
  return { balance, ded_owed, ins_balance, invoiced, collected, deductible };
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Collections() {
  const navigate = useNavigate();
  const { db } = useAuth();

  const [jobs,         setJobs]         = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [migrationErr, setMigrationErr] = useState(false);
  const [tab,          setTab]          = useState('all');        // all | deductibles | insurance
  const [search,       setSearch]       = useState('');
  const [divFilter,    setDivFilter]    = useState('all');
  const [statusFilter, setStatusFilter] = useState('outstanding'); // default to jobs with balance
  const [ageFilter,    setAgeFilter]    = useState('all');
  const [sortBy,       setSortBy]       = useState('balance');
  const [sortDir,      setSortDir]      = useState('desc');
  const [payModal,     setPayModal]     = useState(null);  // job object
  const [notesModal,   setNotesModal]   = useState(null);  // job object
  const [saving,       setSaving]       = useState(null);  // job id

  const loadJobs = async () => {
    setLoading(true);
    setMigrationErr(false);
    try {
      const data = await db.rpc('get_ar_jobs', {});
      setJobs(Array.isArray(data) ? data : []);
    } catch (e) {
      if (e.message?.includes('get_ar_jobs') || e.message?.includes('404')) {
        setMigrationErr(true);
      } else {
        errToast('Failed to load: ' + e.message);
      }
      setJobs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadJobs(); }, []);

  // ── Summary stats ──────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    let totalInvoiced = 0, totalCollected = 0, totalBalance = 0;
    let totalDedOwed = 0, totalInsBalance = 0, totalDeprecHeld = 0;
    for (const j of jobs) {
      const b = getBalances(j);
      totalInvoiced   += b.invoiced;
      totalCollected  += b.collected;
      totalBalance    += b.balance;
      totalDedOwed    += b.ded_owed;
      totalInsBalance += b.ins_balance;
      totalDeprecHeld += Math.max(0, Number(j.depreciation_held || 0) - Number(j.depreciation_released || 0));
    }
    return { totalInvoiced, totalCollected, totalBalance, totalDedOwed, totalInsBalance, totalDeprecHeld };
  }, [jobs]);

  // ── Aging buckets ──────────────────────────────────────────────────────────
  const agingBuckets = useMemo(() => {
    const buckets = { current: 0, '30-60': 0, '60-90': 0, '90+': 0 };
    for (const j of jobs) {
      const { balance } = getBalances(j);
      if (balance <= 0) continue;
      const bkt = ageBucket(ageDays(j));
      if (bkt !== 'unknown') buckets[bkt] += balance;
    }
    return buckets;
  }, [jobs]);

  // ── Filtered + sorted jobs ─────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = [...jobs];

    // Tab filters
    if (tab === 'deductibles') {
      list = list.filter(j => Number(j.deductible) > 0 && !j.deductible_collected && j.insurance_company);
    } else if (tab === 'insurance') {
      list = list.filter(j => !!j.insurance_company);
    }

    // Text search
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(j =>
        j.insured_name?.toLowerCase().includes(q) ||
        j.job_number?.toLowerCase().includes(q) ||
        j.insurance_company?.toLowerCase().includes(q) ||
        j.claim_number?.toLowerCase().includes(q)
      );
    }

    // Filters
    if (divFilter !== 'all') list = list.filter(j => j.division === divFilter);
    if (statusFilter !== 'all') {
      if (statusFilter === 'outstanding') {
        list = list.filter(j => getBalances(j).balance > 0);
      } else {
        list = list.filter(j => (j.ar_status || 'open') === statusFilter);
      }
    }
    if (ageFilter !== 'all') {
      list = list.filter(j => ageBucket(ageDays(j)) === ageFilter);
    }

    // Sort
    list.sort((a, b) => {
      let av, bv;
      switch (sortBy) {
        case 'balance':    av = getBalances(a).balance;  bv = getBalances(b).balance; break;
        case 'invoiced':   av = a.invoiced_value || 0;   bv = b.invoiced_value || 0; break;
        case 'days':       av = ageDays(a) ?? -1;        bv = ageDays(b) ?? -1; break;
        case 'deductible': av = a.deductible || 0;       bv = b.deductible || 0; break;
        case 'client':     av = a.insured_name || '';    bv = b.insured_name || ''; break;
        default:           av = getBalances(a).balance;  bv = getBalances(b).balance;
      }
      if (typeof av === 'string')
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === 'asc' ? av - bv : bv - av;
    });

    return list;
  }, [jobs, tab, search, divFilter, statusFilter, ageFilter, sortBy, sortDir]);

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('desc'); }
  };

  // ── Mutations ──────────────────────────────────────────────────────────────
  const patchJob = async (id, fields) => {
    setSaving(id);
    try {
      await db.update('jobs', `id=eq.${id}`, { ...fields, updated_at: new Date().toISOString() });
      setJobs(prev => prev.map(j => j.id === id ? { ...j, ...fields } : j));
    } catch (e) {
      errToast('Update failed: ' + e.message);
    } finally {
      setSaving(null);
    }
  };

  const markDeductiblePaid = async (job) => {
    const today = new Date().toISOString().split('T')[0];
    const { balance, deductible } = getBalances(job);
    await patchJob(job.id, {
      deductible_collected:      true,
      deductible_collected_date: today,
      ar_status: (balance - deductible) <= 0 ? 'paid' : 'partial',
    });
    toast(`✓ Deductible of ${fmtDollar(job.deductible)} received — ${job.insured_name}`);
  };

  const handleStatusChange = (job, status) => patchJob(job.id, { ar_status: status });

  const handleLogPayment = async ({ job, amount, source, note, date }) => {
    const newCollected = Number(job.collected_value || 0) + Number(amount);
    const { invoiced }  = getBalances(job);
    let newStatus = job.ar_status || 'open';
    if (newCollected >= invoiced) newStatus = 'paid';
    else if (newCollected > 0)    newStatus = 'partial';

    const noteEntry = `[${date}] +${fmtDollar(amount)} (${source})${note ? ' – ' + note : ''}`;
    const updatedNotes = [job.ar_notes, noteEntry].filter(Boolean).join('\n');

    await patchJob(job.id, {
      collected_value:    newCollected,
      ar_status:          newStatus,
      ar_notes:           updatedNotes,
      last_followup_date: date,
    });
    setPayModal(null);
    toast(`Payment of ${fmtDollar(amount)} logged`);
  };

  const handleSaveNotes = async (job, notes, invoicedDate) => {
    const fields = {
      ar_notes:           notes,
      last_followup_date: new Date().toISOString().split('T')[0],
    };
    if (invoicedDate !== undefined) fields.invoiced_date = invoicedDate || null;
    await patchJob(job.id, fields);
    setNotesModal(null);
    toast('Notes saved');
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) return <div className="loading-page"><div className="spinner" /></div>;

  const outstandingCount = jobs.filter(j => getBalances(j).balance > 0).length;
  const dedUnpaidCount   = jobs.filter(j => j.deductible > 0 && !j.deductible_collected && j.insurance_company).length;

  return (
    <div className="collections-page">

      {/* ── PAGE HEADER ── */}
      <div className="collections-header">
        <div>
          <h1 className="page-title">Collections</h1>
          <p className="page-subtitle">
            {outstandingCount} jobs with open balances · {dedUnpaidCount} deductibles uncollected
          </p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={loadJobs} style={{ gap: 5 }}>
          ↻ Refresh
        </button>
      </div>

      {/* ── MIGRATION ERROR ── */}
      {migrationErr && (
        <div className="ar-migration-banner">
          <strong>⚠️ Setup required:</strong> Run the SQL migration in Supabase before using this page.
          <br />
          <span style={{ fontSize: 11 }}>See the Collections setup SQL provided with this feature.</span>
        </div>
      )}

      {/* ── KPI STRIP ── */}
      <div className="ar-kpi-strip">
        <KPICard
          label="Total Invoiced"
          value={fmtKilo(stats.totalInvoiced)}
          sub={`${jobs.length} jobs`}
          color="var(--accent)"
        />
        <KPICard
          label="Collected"
          value={fmtKilo(stats.totalCollected)}
          sub={fmtPct(stats.totalCollected, stats.totalInvoiced) + ' of billed'}
          color="#059669"
        />
        <KPICard
          label="Outstanding A/R"
          value={fmtKilo(stats.totalBalance)}
          sub={`${outstandingCount} open jobs`}
          color={stats.totalBalance > 0 ? '#dc2626' : '#059669'}
          alert={stats.totalBalance > 10000}
        />
        <KPICard
          label="Insurance A/R"
          value={fmtKilo(stats.totalInsBalance)}
          sub="Owed by carriers"
          color="#2563eb"
        />
        <KPICard
          label="Deductibles Owed"
          value={fmtKilo(stats.totalDedOwed)}
          sub={`${dedUnpaidCount} uncollected`}
          color="#d97706"
        />
        {stats.totalDeprecHeld > 100 && (
          <KPICard
            label="Depreciation Held"
            value={fmtKilo(stats.totalDeprecHeld)}
            sub="Supplement potential"
            color="#7c3aed"
          />
        )}
      </div>

      {/* ── AGING BAR ── */}
      <AgingBar buckets={agingBuckets} />

      {/* ── TABS + FILTERS ── */}
      <div className="ar-controls">
        <div className="ar-tabs">
          {[
            { key: 'all',          label: 'All A/R',      count: outstandingCount },
            { key: 'deductibles',  label: 'Deductibles',  count: dedUnpaidCount },
            { key: 'insurance',    label: 'Insurance',    count: jobs.filter(j => j.insurance_company).length },
          ].map(t => (
            <button
              key={t.key}
              className={`ar-tab${tab === t.key ? ' active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
              {t.count > 0 && <span className="ar-tab-count">{t.count}</span>}
            </button>
          ))}
        </div>

        <div className="ar-filters">
          <div style={{ position: 'relative', flex: 1, minWidth: 140, maxWidth: 280 }}>
            <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)', fontSize: 13, pointerEvents: 'none' }}>🔍</span>
            <input
              className="input"
              style={{ paddingLeft: 28, height: 34 }}
              placeholder="Job #, client, carrier…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <select className="input" style={{ width: 'auto', minWidth: 110, height: 34 }} value={divFilter} onChange={e => setDivFilter(e.target.value)}>
            <option value="all">All Divisions</option>
            <option value="water">💧 Water</option>
            <option value="mold">🧬 Mold</option>
            <option value="reconstruction">🏗️ Recon</option>
            <option value="fire">🔥 Fire</option>
            <option value="contents">📦 Contents</option>
          </select>
          <select className="input" style={{ width: 'auto', minWidth: 130, height: 34 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="all">All Records</option>
            <option value="outstanding">Has Balance</option>
            {AR_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select className="input" style={{ width: 'auto', minWidth: 100, height: 34 }} value={ageFilter} onChange={e => setAgeFilter(e.target.value)}>
            <option value="all">All Ages</option>
            <option value="current">Current (&lt;30d)</option>
            <option value="30-60">30–60 days</option>
            <option value="60-90">60–90 days</option>
            <option value="90+">90+ days</option>
          </select>
        </div>
      </div>

      {/* ── TABLE / CARDS ── */}
      <PullToRefresh onRefresh={loadJobs} className="ar-body">
        {filtered.length === 0 ? (
          <div className="empty-state" style={{ padding: '48px 20px' }}>
            <div className="empty-state-icon">💰</div>
            <div className="empty-state-title">No records match</div>
            <div className="empty-state-text">
              {statusFilter === 'outstanding'
                ? 'No jobs with open balances. Clear the filter to see all records.'
                : 'Adjust the filters or run the SQL migration if this is your first visit.'}
            </div>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="ar-desktop-table">
              <table>
                <thead>
                  <tr>
                    <th className="ar-th-job">
                      <SortBtn label="Job / Client" col="client" current={sortBy} dir={sortDir} onSort={toggleSort} />
                    </th>
                    <th>Insurance / Carrier</th>
                    <th>Phase</th>
                    <th className="ar-th-num">
                      <SortBtn label="Invoiced" col="invoiced" current={sortBy} dir={sortDir} onSort={toggleSort} />
                    </th>
                    <th className="ar-th-num">Collected</th>
                    <th className="ar-th-num">
                      <SortBtn label="Balance" col="balance" current={sortBy} dir={sortDir} onSort={toggleSort} />
                    </th>
                    <th className="ar-th-num">
                      <SortBtn label="Deductible" col="deductible" current={sortBy} dir={sortDir} onSort={toggleSort} />
                    </th>
                    <th className="ar-th-num">
                      <SortBtn label="Days" col="days" current={sortBy} dir={sortDir} onSort={toggleSort} />
                    </th>
                    <th style={{ width: 120 }}>Status</th>
                    <th style={{ width: 90 }} />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(job => (
                    <ARRow
                      key={job.id}
                      job={job}
                      isSaving={saving === job.id}
                      onView={() => navigate(`/jobs/${job.id}`)}
                      onPay={() => setPayModal(job)}
                      onNotes={() => setNotesModal(job)}
                      onMarkDedPaid={() => markDeductiblePaid(job)}
                      onStatusChange={s => handleStatusChange(job, s)}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="ar-mobile-cards">
              {filtered.map(job => (
                <ARCard
                  key={job.id}
                  job={job}
                  isSaving={saving === job.id}
                  onView={() => navigate(`/jobs/${job.id}`)}
                  onPay={() => setPayModal(job)}
                  onNotes={() => setNotesModal(job)}
                  onMarkDedPaid={() => markDeductiblePaid(job)}
                />
              ))}
            </div>

            <div className="ar-table-footer">
              {filtered.length} records ·
              Outstanding: <strong>{fmtKilo(filtered.reduce((s, j) => s + getBalances(j).balance, 0))}</strong>
              {' '}·
              Collected: <strong style={{ color: '#059669' }}>{fmtKilo(filtered.reduce((s, j) => s + Number(j.collected_value || 0), 0))}</strong>
            </div>
          </>
        )}
      </PullToRefresh>

      {/* ── MODALS ── */}
      {payModal && (
        <PaymentModal
          job={payModal}
          onClose={() => setPayModal(null)}
          onSubmit={handleLogPayment}
        />
      )}
      {notesModal && (
        <NotesModal
          job={notesModal}
          onClose={() => setNotesModal(null)}
          onSave={handleSaveNotes}
        />
      )}
    </div>
  );
}

// ── KPI Card ─────────────────────────────────────────────────────────────────
function KPICard({ label, value, sub, color, alert }) {
  return (
    <div className={`ar-kpi-card${alert ? ' ar-kpi-alert' : ''}`}>
      <div className="ar-kpi-label">{label}</div>
      <div className="ar-kpi-value" style={{ color }}>{value}</div>
      {sub && <div className="ar-kpi-sub">{sub}</div>}
    </div>
  );
}

// ── Aging Bar ─────────────────────────────────────────────────────────────────
const AGING_COLORS  = { current: '#059669', '30-60': '#d97706', '60-90': '#ea580c', '90+': '#dc2626' };
const AGING_LABELS  = { current: '< 30d', '30-60': '30–60d', '60-90': '60–90d', '90+': '90+d' };

function AgingBar({ buckets }) {
  const total = Object.values(buckets).reduce((s, v) => s + v, 0);
  if (total < 0.01) return null;
  return (
    <div className="ar-aging-strip">
      <span className="ar-aging-label">Aging</span>
      <div className="ar-aging-track">
        {Object.entries(buckets).map(([k, v]) =>
          v > 0 ? (
            <div
              key={k}
              style={{ flex: v / total, background: AGING_COLORS[k], height: '100%', minWidth: 4, transition: 'flex 400ms ease' }}
              title={`${AGING_LABELS[k]}: ${fmtDollar(v)}`}
            />
          ) : null
        )}
      </div>
      <div className="ar-aging-legend">
        {Object.entries(buckets).map(([k, v]) =>
          v > 0 ? (
            <span key={k} style={{ color: AGING_COLORS[k] }}>
              <span className="ar-aging-dot" style={{ background: AGING_COLORS[k] }} />
              {AGING_LABELS[k]}: {fmtKilo(v)}
            </span>
          ) : null
        )}
      </div>
    </div>
  );
}

// ── Sort Button ───────────────────────────────────────────────────────────────
function SortBtn({ label, col, current, dir, onSort }) {
  const active = current === col;
  return (
    <button className={`ar-sort-btn${active ? ' active' : ''}`} onClick={() => onSort(col)}>
      {label} {active ? (dir === 'desc' ? '↓' : '↑') : '↕'}
    </button>
  );
}

// ── Desktop A/R Row ───────────────────────────────────────────────────────────
function ARRow({ job, isSaving, onView, onPay, onNotes, onMarkDedPaid, onStatusChange }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const b    = getBalances(job);
  const days = ageDays(job);
  const status    = job.ar_status || 'open';
  const statusObj = AR_STATUSES.find(s => s.value === status) || AR_STATUSES[0];
  const isInsurance = !!job.insurance_company;

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e) => { if (!menuRef.current?.contains(e.target)) setMenuOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  return (
    <tr className={`ar-row${isSaving ? ' ar-row-saving' : ''}`}>
      {/* Job / Client */}
      <td>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <span style={{ fontSize: 18, lineHeight: 1.2, flexShrink: 0 }}>{DIV_EMOJI[job.division] || '📁'}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', marginBottom: 1 }}>
              {job.job_number || '—'}
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>
              {job.insured_name || 'Unknown'}
            </div>
            {job.client_phone && (
              <a href={`tel:${job.client_phone}`} style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none' }} onClick={e => e.stopPropagation()}>
                {fmtPh(job.client_phone)}
              </a>
            )}
          </div>
        </div>
      </td>

      {/* Insurance */}
      <td>
        {isInsurance ? (
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }}>
              {job.insurance_company}
            </div>
            {job.claim_number && (
              <div style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>{job.claim_number}</div>
            )}
          </div>
        ) : (
          <span className="ar-oop-badge">OOP</span>
        )}
      </td>

      {/* Phase */}
      <td>
        <span className="ar-phase-pill">{job.phase?.replace(/_/g, ' ') || '—'}</span>
      </td>

      {/* Invoiced */}
      <td className="ar-td-num">{fmtDollar(b.invoiced)}</td>

      {/* Collected */}
      <td className="ar-td-num" style={{ color: '#059669' }}>{fmtDollar(b.collected)}</td>

      {/* Balance */}
      <td className="ar-td-num">
        {b.balance > 0 ? (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontWeight: 700, color: ageColor(days), fontSize: 13 }}>{fmtDollar(b.balance)}</div>
            {b.ins_balance > 0 && b.ded_owed > 0 && (
              <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 1 }}>
                Ins: {fmtKilo(b.ins_balance)} + Ded: {fmtKilo(b.ded_owed)}
              </div>
            )}
          </div>
        ) : (
          <span style={{ color: '#059669', fontWeight: 700, fontSize: 12 }}>✓ Paid</span>
        )}
      </td>

      {/* Deductible */}
      <td className="ar-td-num">
        {isInsurance && b.deductible > 0 ? (
          <button
            className="ar-ded-btn"
            style={{
              background: job.deductible_collected ? '#ecfdf5' : '#fffbeb',
              color:      job.deductible_collected ? '#059669' : '#d97706',
              border:     `1px solid ${job.deductible_collected ? '#a7f3d0' : '#fde68a'}`,
              cursor:     job.deductible_collected ? 'default' : 'pointer',
            }}
            onClick={() => !job.deductible_collected && !isSaving && onMarkDedPaid()}
            title={job.deductible_collected
              ? `Received ${fmtDate(job.deductible_collected_date)}`
              : `Click to mark ${fmtDollar(b.deductible)} received`}
            disabled={job.deductible_collected || isSaving}
          >
            {job.deductible_collected ? '✓' : '○'} {fmtKilo(b.deductible)}
          </button>
        ) : (
          <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>—</span>
        )}
      </td>

      {/* Days outstanding */}
      <td className="ar-td-num">
        {days !== null ? (
          <span style={{ fontWeight: 700, fontSize: 11, padding: '2px 7px', borderRadius: 99, background: ageBg(days), color: ageColor(days) }}>
            {days}d
          </span>
        ) : '—'}
      </td>

      {/* AR Status */}
      <td>
        <select
          className="input"
          value={status}
          onChange={e => onStatusChange(e.target.value)}
          disabled={isSaving}
          style={{
            color:       statusObj.color,
            background:  statusObj.bg,
            borderColor: statusObj.color + '50',
            height:      28,
            fontSize:    11,
            fontWeight:  600,
            padding:     '0 6px',
            width:       '100%',
          }}
        >
          {AR_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </td>

      {/* Actions */}
      <td>
        <div className="ar-row-actions">
          <button className="btn btn-ghost btn-sm" onClick={onView} style={{ fontSize: 11, height: 26, padding: '0 8px' }}>
            ↗ Job
          </button>
          <div style={{ position: 'relative' }} ref={menuRef}>
            <button className="btn btn-ghost btn-sm" onClick={() => setMenuOpen(p => !p)} style={{ height: 26, width: 26, padding: 0, fontSize: 14 }}>
              ⋯
            </button>
            {menuOpen && (
              <div className="ar-action-menu">
                <button className="ar-action-item" onClick={() => { onPay(); setMenuOpen(false); }}>
                  💰 Log Payment
                </button>
                <button className="ar-action-item" onClick={() => { onNotes(); setMenuOpen(false); }}>
                  📝 Notes / Invoice Date
                </button>
                {job.adjuster_phone && (
                  <a href={`tel:${job.adjuster_phone}`} className="ar-action-item" onClick={() => setMenuOpen(false)}>
                    📞 Call Adjuster — {fmtPh(job.adjuster_phone)}
                  </a>
                )}
                {job.client_phone && (
                  <a href={`tel:${job.client_phone}`} className="ar-action-item" onClick={() => setMenuOpen(false)}>
                    📱 Call Client — {fmtPh(job.client_phone)}
                  </a>
                )}
                {job.adjuster_email && (
                  <a href={`mailto:${job.adjuster_email}`} className="ar-action-item" onClick={() => setMenuOpen(false)}>
                    ✉ Email Adjuster
                  </a>
                )}
                {isInsurance && b.deductible > 0 && !job.deductible_collected && (
                  <button className="ar-action-item" onClick={() => { onMarkDedPaid(); setMenuOpen(false); }}>
                    ✓ Mark Deductible Received
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}

// ── Mobile A/R Card ───────────────────────────────────────────────────────────
function ARCard({ job, isSaving, onView, onPay, onNotes, onMarkDedPaid }) {
  const b    = getBalances(job);
  const days = ageDays(job);
  const isInsurance = !!job.insurance_company;

  return (
    <div className="ar-mobile-card">
      {/* Top row: identity + balance */}
      <div className="ar-mobile-card-top">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 22, lineHeight: 1.1, flexShrink: 0 }}>{DIV_EMOJI[job.division] || '📁'}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>{job.job_number}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {job.insured_name || 'Unknown'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 1 }}>{job.insurance_company || 'Out of pocket'}</div>
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          {b.balance > 0 ? (
            <>
              <div style={{ fontWeight: 800, fontSize: 16, color: ageColor(days) }}>{fmtKilo(b.balance)}</div>
              {days !== null && <div style={{ fontSize: 10, color: ageColor(days), fontWeight: 600 }}>{days}d old</div>}
            </>
          ) : (
            <div style={{ fontWeight: 700, fontSize: 13, color: '#059669' }}>✓ Paid</div>
          )}
        </div>
      </div>

      {/* Detail rows */}
      <div className="ar-mobile-card-rows">
        <div className="ar-mobile-card-row">
          <span>Invoiced / Collected</span>
          <span>{fmtKilo(b.invoiced)} / <span style={{ color: '#059669' }}>{fmtKilo(b.collected)}</span></span>
        </div>
        {isInsurance && b.deductible > 0 && (
          <div className="ar-mobile-card-row">
            <span>Deductible</span>
            <span style={{ fontWeight: 700, color: job.deductible_collected ? '#059669' : '#d97706' }}>
              {job.deductible_collected ? `✓ Received${job.deductible_collected_date ? ' ' + fmtDate(job.deductible_collected_date) : ''}` : `${fmtKilo(b.deductible)} owed`}
            </span>
          </div>
        )}
        {isInsurance && b.ins_balance > 0 && (
          <div className="ar-mobile-card-row">
            <span>Insurance balance</span>
            <span style={{ fontWeight: 600, color: '#2563eb' }}>{fmtKilo(b.ins_balance)}</span>
          </div>
        )}
        {job.ar_notes && (
          <div className="ar-mobile-card-row" style={{ alignItems: 'flex-start' }}>
            <span>Notes</span>
            <span style={{ color: 'var(--text-secondary)', fontSize: 11, textAlign: 'right', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {job.ar_notes.split('\n')[0]}
            </span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="ar-mobile-card-actions" onClick={e => e.stopPropagation()}>
        {b.balance > 0 && (
          <button className="btn btn-secondary btn-sm" onClick={onPay} disabled={isSaving} style={{ fontSize: 12 }}>
            + Payment
          </button>
        )}
        {isInsurance && b.deductible > 0 && !job.deductible_collected && (
          <button className="btn btn-secondary btn-sm" onClick={onMarkDedPaid} disabled={isSaving} style={{ fontSize: 12, color: '#d97706', borderColor: '#fde68a' }}>
            Ded. Rcvd
          </button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={onNotes} style={{ fontSize: 12 }}>
          Notes
        </button>
        <button className="btn btn-primary btn-sm" onClick={onView} style={{ fontSize: 12, marginLeft: 'auto' }}>
          View ↗
        </button>
      </div>
    </div>
  );
}

// ── Payment Modal ─────────────────────────────────────────────────────────────
function PaymentModal({ job, onClose, onSubmit }) {
  const b = getBalances(job);
  const [amount,  setAmount]  = useState(b.balance > 0 ? b.balance.toFixed(2) : '');
  const [source,  setSource]  = useState(job.insurance_company ? 'insurance' : 'homeowner');
  const [note,    setNote]    = useState('');
  const [date,    setDate]    = useState(new Date().toISOString().split('T')[0]);
  const [saving,  setSaving]  = useState(false);

  const handleSubmit = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { errToast('Enter a valid amount'); return; }
    setSaving(true);
    await onSubmit({ job, amount: amt, source, note: note.trim(), date });
    setSaving(false);
  };

  return (
    <div className="ar-modal-overlay" onClick={onClose}>
      <div className="ar-modal" onClick={e => e.stopPropagation()}>
        <div className="ar-modal-header">
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Log Payment</div>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
              {job.insured_name} · {job.job_number}
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ width: 30, height: 30, padding: 0 }}>✕</button>
        </div>

        <div className="ar-modal-body">
          {/* Balance summary */}
          <div className="ar-pay-summary">
            <div className="ar-pay-summary-item">
              <div className="ar-pay-summary-label">Balance Due</div>
              <div className="ar-pay-summary-value" style={{ color: b.balance > 0 ? '#dc2626' : '#059669' }}>
                {fmtDollar(b.balance)}
              </div>
            </div>
            {job.insurance_company && b.deductible > 0 && (
              <>
                <div className="ar-pay-summary-item">
                  <div className="ar-pay-summary-label">Deductible</div>
                  <div className="ar-pay-summary-value" style={{ color: job.deductible_collected ? '#059669' : '#d97706' }}>
                    {job.deductible_collected ? '✓ Received' : fmtDollar(b.deductible)}
                  </div>
                </div>
                <div className="ar-pay-summary-item">
                  <div className="ar-pay-summary-label">Insurance A/R</div>
                  <div className="ar-pay-summary-value" style={{ color: '#2563eb' }}>
                    {fmtDollar(b.ins_balance)}
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="form-group">
            <label className="label">Amount Received <span style={{ color: '#ef4444' }}>*</span></label>
            <input
              className="input"
              type="number"
              step="0.01"
              min="0.01"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0.00"
              autoFocus
            />
          </div>

          <div className="form-group">
            <label className="label">Payment Source</label>
            <select className="input" value={source} onChange={e => setSource(e.target.value)}>
              <option value="insurance">Insurance Company (ACV / Check)</option>
              <option value="homeowner">Homeowner / Client</option>
              <option value="deductible">Deductible Collection</option>
              <option value="depreciation">Depreciation Release</option>
              <option value="supplement">Supplement Payment</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div className="form-group">
            <label className="label">Date Received</label>
            <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>

          <div className="form-group">
            <label className="label">Note <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>(check #, reference…)</span></label>
            <input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="Optional" />
          </div>
        </div>

        <div className="ar-modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={saving || !amount}>
            {saving ? 'Saving…' : `Log ${amount ? '$' + parseFloat(amount || 0).toFixed(2) : 'Payment'}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Notes Modal ───────────────────────────────────────────────────────────────
function NotesModal({ job, onClose, onSave }) {
  const [notes,        setNotes]        = useState(job.ar_notes || '');
  const [invoicedDate, setInvoicedDate] = useState(job.invoiced_date || '');
  const [saving,       setSaving]       = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onSave(job, notes, invoicedDate);
    setSaving(false);
  };

  return (
    <div className="ar-modal-overlay" onClick={onClose}>
      <div className="ar-modal" onClick={e => e.stopPropagation()}>
        <div className="ar-modal-header">
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Collections Notes</div>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
              {job.insured_name} · {job.job_number}
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ width: 30, height: 30, padding: 0 }}>✕</button>
        </div>

        <div className="ar-modal-body">
          <div className="form-group">
            <label className="label">Invoice Date</label>
            <input className="input" type="date" value={invoicedDate} onChange={e => setInvoicedDate(e.target.value)} />
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
              Used for aging. Leave blank to use job phase date.
            </div>
          </div>

          <div className="form-group">
            <label className="label">Collections Log</label>
            <textarea
              className="input textarea"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={9}
              placeholder={`Log contacts, promises, disputes, follow-up dates…\n\nPayment payments are appended automatically when you use Log Payment.`}
              autoFocus
              style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
            />
          </div>

          {job.last_followup_date && (
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
              Last follow-up: {fmtDate(job.last_followup_date)}
            </div>
          )}
        </div>

        <div className="ar-modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save Notes'}
          </button>
        </div>
      </div>
    </div>
  );
}
