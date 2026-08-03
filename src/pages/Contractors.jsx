/**
 * ════════════════════════════════════════════════
 * FILE: Contractors.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Shows office staff which subcontractors need paperwork and which ones are ready. It keeps the
 *   list, dates, and warnings supplied by the business system together in one easy-to-scan view.
 *
 * WHERE IT LIVES:
 *   Route:        /contractors
 *   Rendered by:  src/App.jsx after the Contractor Compliance route is wired
 *
 * DEPENDS ON:
 *   Packages:  react, @tanstack/react-query, react-router-dom
 *   Internal:  AuthContext, UI primitives, ComplianceStatus, ContractorCompliance.css
 *   Data:      reads  → get_contractor_compliance_dashboard RPC
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - The database, not this page, decides compliance so date and coverage rules stay consistent.
 * ════════════════════════════════════════════════
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { EmptyState, ErrorState, PageHeader, SearchInput } from '@/components/ui';
import ComplianceStatus from '@/components/contractor-compliance/ComplianceStatus';
import './ContractorCompliance.css';

const PAGE_SIZE = 25;
const FILTERS = ['', 'ready', 'needs_review', 'expiring', 'expired', 'gap', 'missing', 'inactive'];
const REQUIREMENTS = [
  ['w9', 'W-9'], ['workers_comp', 'Workers’ comp'], ['general_liability', 'General liability'],
];

function dateLabel(value) {
  if (!value) return '—';
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function KpiCard({ label, value, tone }) {
  return <div className={`card contractor-kpi contractor-kpi--${tone || 'neutral'}`}><span>{label}</span><strong>{value ?? 0}</strong></div>;
}

export default function Contractors() {
  const { db, employee } = useAuth();
  const navigate = useNavigate();
  const [urlParams, setUrlParams] = useSearchParams();
  const initialSearch = urlParams.get('search') || '';
  const [search, setSearch] = useState(initialSearch);
  const [searchValue, setSearchValue] = useState(initialSearch);
  const [status, setStatus] = useState(urlParams.get('status') || '');
  const [page, setPage] = useState(Number(urlParams.get('page')) || 0);
  const [auditMode, setAuditMode] = useState(urlParams.get('view') === 'audit' ? 'audit' : 'current');
  const [auditStart, setAuditStart] = useState(urlParams.get('audit_start') || '');
  const [auditEnd, setAuditEnd] = useState(urlParams.get('audit_end') || '');
  const auditRangeValid = auditMode === 'current' || (
    !!auditStart && !!auditEnd && auditStart <= auditEnd
    && auditStart.slice(0, 4) === auditEnd.slice(0, 4)
  );
  useEffect(() => { const timer = setTimeout(() => { setSearch(searchValue); setPage(0); }, 300); return () => clearTimeout(timer); }, [searchValue]);
  useEffect(() => {
    const params = new URLSearchParams();
    if (searchValue) params.set('search', searchValue);
    if (status) params.set('status', status);
    if (page) params.set('page', String(page));
    if (auditMode === 'audit') {
      params.set('view', 'audit');
      if (auditStart) params.set('audit_start', auditStart);
      if (auditEnd) params.set('audit_end', auditEnd);
    }
    setUrlParams(params, { replace: true });
  }, [auditEnd, auditMode, auditStart, page, searchValue, setUrlParams, status]);
  const query = useQuery({
    queryKey: ['contractor-compliance', 'dashboard', search, status, page, auditMode, auditStart, auditEnd],
    queryFn: async () => db.rpc('get_contractor_compliance_dashboard', {
      p_search: search || null, p_status: status || null, p_limit: PAGE_SIZE, p_offset: page * PAGE_SIZE,
      p_audit_start: auditMode === 'audit' ? auditStart : null, p_audit_end: auditMode === 'audit' ? auditEnd : null,
    }),
    enabled: auditRangeValid,
    placeholderData: (previous) => previous,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const data = query.data || {};
  const kpis = data.kpis || {};
  const total = data.total ?? data.total_count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const subtitle = query.isPending ? 'Loading readiness…' : `${total} subcontractor${total === 1 ? '' : 's'} • ${auditMode === 'audit' ? 'audit-period' : 'current'} readiness`;
  const rows = useMemo(() => (Array.isArray(data.items) ? data.items : []), [data.items]);
  const hasStaleRows = rows.length > 0;
  const auditSummary = data.audit?.label || (data.audit_period ? `Audit dates: ${data.audit_period.start_date} to ${data.audit_period.end_date} (${data.audit_period.timezone}).` : 'Current readiness uses America/Denver dates.');

  return <main className="contractor-compliance-page">
    <PageHeader title="Contractor Compliance" subtitle={subtitle} actions={<div className="contractor-inline-actions"><button type="button" className="btn btn-secondary" onClick={() => navigate('/contractors/audits')}>Insurance audits</button>{employee?.role === 'admin' || employee?.role === 'office' ? <button type="button" className="btn btn-secondary" onClick={() => navigate('/contractors/tax-readiness')}>W-9 readiness</button> : null}</div>}>
      <p className="contractor-page-note">{auditSummary} This is warning-only; it does not block work or payments.</p>
    </PageHeader>
    <section className="contractor-kpis" aria-label="Compliance counts">
      <KpiCard label="Ready" value={kpis.ready} tone="ready" />
      <KpiCard label="Needs review" value={kpis.needs_review} tone="review" />
      <KpiCard label="At risk" value={(kpis.expiring || 0) + (kpis.expired || 0) + (kpis.gap || 0)} tone="risk" />
      <KpiCard label="Missing" value={kpis.missing} tone="missing" />
    </section>
    <section className="contractor-toolbar" aria-label="Contractor filters">
      <SearchInput value={searchValue} onChange={setSearchValue} placeholder="Search contractor, trade, owner…" />
      <label className="contractor-filter-label">Status<select className="input" value={status} onChange={(event) => { setStatus(event.target.value); setPage(0); }}>
        {FILTERS.map((entry) => <option key={entry || 'all'} value={entry}>{entry ? entry.replace(/_/g, ' ') : 'All statuses'}</option>)}
      </select></label>
      <fieldset className="contractor-audit-controls"><legend>Readiness view</legend><label><input type="radio" name="readiness-view" checked={auditMode === 'current'} onChange={() => { setAuditMode('current'); setPage(0); }} /> Current</label><label><input type="radio" name="readiness-view" checked={auditMode === 'audit'} onChange={() => { setAuditMode('audit'); setPage(0); }} /> Audit period</label>{auditMode === 'audit' ? <span className="contractor-date-range"><input className="input" type="date" aria-label="Audit period start" value={auditStart} onChange={(event) => { setAuditStart(event.target.value); setPage(0); }} /><input className="input" type="date" aria-label="Audit period end" value={auditEnd} min={auditStart || undefined} onChange={(event) => { setAuditEnd(event.target.value); setPage(0); }} /></span> : null}</fieldset>
    </section>
    {!auditRangeValid ? <p className="contractor-inline-notice" role="alert">Choose a start and end date in the same calendar year, with the end on or after the start.</p> : null}
    {query.error && !hasStaleRows ? <ErrorState message={query.error.message} onRetry={query.refetch} /> : null}
    {query.error && hasStaleRows ? <p className="contractor-inline-notice" role="status">Couldn’t refresh — showing last-loaded contractors. <button type="button" className="btn btn-ghost btn-sm" onClick={query.refetch}>Try again</button></p> : null}
    {query.isPending ? <div className="loading-page"><div className="spinner" /><span>Loading contractor compliance…</span></div> : null}
    {!query.isPending && !query.error && !rows.length ? <EmptyState icon="✓" title={search || status ? 'No contractors match these filters' : 'No subcontractors yet'} sub={search || status ? 'Try a different search or status.' : 'Subcontractor contacts will appear here when available.'} /> : null}
    {rows.length ? <section className="contractor-matrix" aria-label="Contractor compliance matrix">
      <div className="contractor-matrix-head"><span>Contractor</span>{REQUIREMENTS.map(([, label]) => <span key={label}>{label}</span>)}<span>Earliest expiration</span><span>Owner / last request</span><span>Actions</span></div>
      {rows.map((row) => <article className="contractor-row" key={row.contractor_id || row.id}>
        <div><strong>{row.contractor_name || row.name || 'Unnamed contractor'}</strong><small>{row.trade || row.trade_specialty || 'No trade recorded'}</small><ComplianceStatus status={row.overall_status} /></div>
        {REQUIREMENTS.map(([key, label]) => <div key={key} data-label={label}><ComplianceStatus status={row.requirements?.[key]?.status || row[`${key}_status`]} /></div>)}
        <div data-label="Earliest expiration">{dateLabel(row.earliest_expiration)}</div>
        <div data-label="Owner / last request"><span>{row.assigned_owner_name || 'Unassigned'}</span><small>{row.last_request_at ? `Requested ${dateLabel(row.last_request_at)}` : 'No request sent'}</small></div>
        <div data-label="Actions"><button type="button" className="btn btn-secondary btn-sm" onClick={() => {
          const detailSuffix = auditMode === 'audit' ? `?audit_start=${auditStart}&audit_end=${auditEnd}` : '';
          const returnParams = new URLSearchParams({
            search: searchValue,
            status,
            page: String(page),
            view: auditMode,
            audit_start: auditStart,
            audit_end: auditEnd,
          });
          navigate(`/contractors/${row.contractor_id || row.contact_id || row.id}${detailSuffix}`, {
            state: {
              contractorReturnTo: `/contractors?${returnParams}`,
            },
          });
        }}>View</button></div>
      </article>)}
    </section> : null}
    {total > PAGE_SIZE ? <nav className="contractor-pagination" aria-label="Contractor pages"><button className="btn btn-secondary btn-sm" type="button" disabled={page === 0 || query.isFetching} onClick={() => setPage((current) => current - 1)}>Previous</button><span>Page {page + 1} of {pageCount}</span><button className="btn btn-secondary btn-sm" type="button" disabled={page + 1 >= pageCount || query.isFetching} onClick={() => setPage((current) => current + 1)}>Next</button></nav> : null}
  </main>;
}
