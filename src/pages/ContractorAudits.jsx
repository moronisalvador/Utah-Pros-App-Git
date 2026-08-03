/**
 * ════════════════════════════════════════════════
 * FILE: ContractorAudits.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Builds named insurance-audit periods, snapshots the contractor roster and
 *   coverage evidence, and exports a clean auditor checklist without tax files.
 *
 * WHERE IT LIVES:
 *   Route: /contractors/audits
 *
 * DEPENDS ON:
 *   Packages: react, @tanstack/react-query, react-router-dom
 *   Internal: AuthContext, shared UI, ComplianceStatus, toast
 *   Data: contractor compliance audit RPCs
 *
 * NOTES / GOTCHAS:
 *   - "Current active" is a roster seed, not proof of period activity/payment.
 *   - Locking is irreversible in this slice and requires inline confirmation.
 * ════════════════════════════════════════════════
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { EmptyState, ErrorState, PageHeader, SearchInput } from '@/components/ui';
import ComplianceStatus from '@/components/contractor-compliance/ComplianceStatus';
import { err, ok } from '@/lib/toast';
import './ContractorCompliance.css';

const PAGE_SIZE = 25;

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(filename, headings, rows) {
  const csv = [headings, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function factLabel(value) {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  return 'Unknown';
}

export default function ContractorAudits() {
  const { db, employee } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [urlParams, setUrlParams] = useSearchParams();
  const canManage = employee?.role === 'admin' || employee?.role === 'office';
  const initialSearch = urlParams.get('search') || '';
  const [selectedId, setSelectedId] = useState(urlParams.get('audit') || '');
  const [searchValue, setSearchValue] = useState(initialSearch);
  const [search, setSearch] = useState(initialSearch);
  const [status, setStatus] = useState(urlParams.get('status') || 'all');
  const [paid, setPaid] = useState(urlParams.get('paid') || 'all');
  const [active, setActive] = useState(urlParams.get('active') || 'all');
  const [page, setPage] = useState(Number(urlParams.get('page')) || 0);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmLock, setConfirmLock] = useState(false);
  const [form, setForm] = useState({ name: '', start: '', end: '', basis: 'current_active_profiles' });

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchValue);
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchValue]);

  const periodsQuery = useQuery({
    queryKey: ['contractor-compliance', 'audit-periods'],
    queryFn: () => db.rpc('get_contractor_compliance_audit_periods'),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const periods = useMemo(
    () => (Array.isArray(periodsQuery.data) ? periodsQuery.data : []),
    [periodsQuery.data],
  );
  const effectiveSelectedId = selectedId || periods[0]?.id || '';
  const selected = periods.find((period) => period.id === effectiveSelectedId);
  useEffect(() => {
    const params = new URLSearchParams();
    if (effectiveSelectedId) params.set('audit', effectiveSelectedId);
    if (searchValue) params.set('search', searchValue);
    if (status !== 'all') params.set('status', status);
    if (canManage && paid !== 'all') params.set('paid', paid);
    if (canManage && active !== 'all') params.set('active', active);
    if (page) params.set('page', String(page));
    setUrlParams(params, { replace: true });
  }, [active, canManage, effectiveSelectedId, page, paid, searchValue, setUrlParams, status]);

  const manifestQuery = useQuery({
    queryKey: ['contractor-compliance', 'audit-manifest', effectiveSelectedId, search, status, paid, active, page],
    queryFn: () => db.rpc('get_contractor_compliance_audit_manifest', {
      p_audit_period_id: effectiveSelectedId,
      p_search: search || null,
      p_status: status,
      p_paid_filter: paid,
      p_active_filter: active,
      p_limit: PAGE_SIZE,
      p_offset: page * PAGE_SIZE,
    }),
    enabled: Boolean(effectiveSelectedId && selected?.materialized_at),
    placeholderData: (previous) => previous,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const manifest = manifestQuery.data || {};
  const items = Array.isArray(manifest.items) ? manifest.items : [];
  const total = manifest.total || 0;

  const refreshAll = async () => {
    await queryClient.invalidateQueries({ queryKey: ['contractor-compliance', 'audit-periods'] });
    await queryClient.invalidateQueries({ queryKey: ['contractor-compliance', 'audit-manifest'] });
  };

  const createMutation = useMutation({
    mutationFn: () => db.rpc('contractor_compliance_create_audit_period', {
      p_name: form.name.trim(),
      p_start_date: form.start,
      p_end_date: form.end,
      p_inclusion_basis: form.basis,
    }),
    onSuccess: async (result) => {
      setShowCreate(false);
      setForm({ name: '', start: '', end: '', basis: 'current_active_profiles' });
      setSelectedId(result.id);
      await refreshAll();
      ok('Audit period created. Materialize it when the roster is ready.');
    },
    onError: (error) => err(error.message),
  });
  const materializeMutation = useMutation({
    mutationFn: () => db.rpc('contractor_compliance_materialize_audit_period', {
      p_audit_period_id: effectiveSelectedId,
    }),
    onSuccess: async () => {
      await refreshAll();
      ok('Audit evidence snapshot refreshed.');
    },
    onError: (error) => err(error.message),
  });
  const lockMutation = useMutation({
    mutationFn: () => db.rpc('contractor_compliance_lock_audit_period', {
      p_audit_period_id: effectiveSelectedId,
    }),
    onSuccess: async () => {
      setConfirmLock(false);
      await refreshAll();
      ok('Audit period locked.');
    },
    onError: (error) => err(error.message),
  });

  const exportManifest = async () => {
    try {
      const rows = [];
      let offset = 0;
      let expected = 0;
      do {
        const result = await db.rpc('get_contractor_compliance_audit_manifest', {
          p_audit_period_id: effectiveSelectedId,
          p_search: search || null,
          p_status: status,
          p_paid_filter: paid,
          p_active_filter: active,
          p_limit: 100,
          p_offset: offset,
        });
        const batch = Array.isArray(result.items) ? result.items : [];
        expected = result.total || 0;
        rows.push(...batch);
        offset += batch.length;
        if (!batch.length) break;
      } while (offset < expected);
      downloadCsv(
        `contractor-insurance-audit-${selected?.start_date || 'period'}.csv`,
        [
          'Contractor', 'Company', 'Trade', 'Overall', 'Workers comp',
          'General liability', 'Active in period', 'Paid in period',
          'Roster source', 'External source', 'External ID', 'Reconciliation',
          'Request count', 'Last request', 'Coverage and gaps',
        ],
        rows.map((row) => [
          row.name,
          row.company,
          row.trade_specialty,
          row.overall_status,
          row.workers_comp_status,
          row.general_liability_status,
          factLabel(row.active_in_period),
          factLabel(row.paid_in_period),
          row.inclusion_source,
          row.external_source,
          row.source_external_id,
          row.reconciliation_state,
          row.request_count,
          row.last_request_at,
          (row.evidence || []).map((entry) => (
            `${entry.requirement_group}:${entry.interval_kind}:${entry.start_date}..${entry.end_date}`
          )).join('; '),
        ]),
      );
      ok(`Exported ${rows.length} audit row${rows.length === 1 ? '' : 's'}.`);
    } catch (error) {
      err(error.message);
    }
  };

  const createInvalid = !form.name.trim() || !form.start || !form.end || form.end < form.start;

  return <main className="contractor-compliance-page">
    <Link className="contractor-back" to="/contractors">← Contractor Compliance</Link>
    <PageHeader
      title="Annual Insurance Audits"
      subtitle="Named, point-in-time workers’ compensation and general liability evidence"
      actions={canManage ? <button type="button" className="btn btn-primary" onClick={() => setShowCreate((value) => !value)}>New audit period</button> : null}
    >
      <p className="contractor-page-note">Current active profiles seed a roster only. Paid-in-period and active-in-period remain unknown until an office user or future verified import supplies them.</p>
    </PageHeader>

    {showCreate ? <section className="contractor-panel contractor-annual-form card" aria-label="Create audit period">
      <h2>Create audit period</h2>
      <label>Name<input className="input" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="2026 insurance audit" /></label>
      <label>Start<input className="input" type="date" value={form.start} onChange={(event) => setForm((current) => ({ ...current, start: event.target.value }))} /></label>
      <label>End<input className="input" type="date" min={form.start || undefined} value={form.end} onChange={(event) => setForm((current) => ({ ...current, end: event.target.value }))} /></label>
      <label>Roster basis<select className="input" value={form.basis} onChange={(event) => setForm((current) => ({ ...current, basis: event.target.value }))}><option value="current_active_profiles">Current active profiles</option><option value="manual_external">Manual / future verified import</option></select></label>
      <div className="contractor-inline-actions"><button type="button" className="btn btn-primary" disabled={createInvalid || createMutation.isPending} onClick={() => createMutation.mutate()}>Create</button><button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button></div>
    </section> : null}

    {periodsQuery.isPending ? <div className="loading-page"><div className="spinner" /><span>Loading audit periods…</span></div> : null}
    {periodsQuery.error ? <ErrorState message={periodsQuery.error.message} onRetry={periodsQuery.refetch} /> : null}
    {!periodsQuery.isPending && !periodsQuery.error && !periods.length ? <EmptyState icon="◫" title="No audit periods yet" sub={canManage ? 'Create a named period to capture insurance evidence.' : 'An office user must create and materialize an audit period.'} /> : null}

    {periods.length ? <>
      <section className="contractor-toolbar contractor-audit-workspace-toolbar" aria-label="Audit period controls">
        <label className="contractor-filter-label">Audit period<select className="input" value={effectiveSelectedId} onChange={(event) => { setSelectedId(event.target.value); setPage(0); setConfirmLock(false); }}>{periods.map((period) => <option key={period.id} value={period.id}>{period.name} · {period.status}</option>)}</select></label>
        {canManage && selected?.status !== 'locked' && selected?.status !== 'closed' ? <button type="button" className="btn btn-secondary" disabled={materializeMutation.isPending} onClick={() => materializeMutation.mutate()}>{selected?.materialized_at ? 'Refresh snapshot' : 'Materialize snapshot'}</button> : null}
        {canManage && selected?.status === 'open' ? (confirmLock ? <span className="contractor-inline-confirm"><span>Locking makes this snapshot immutable.</span><button type="button" className="btn btn-danger btn-sm" disabled={lockMutation.isPending} onClick={() => lockMutation.mutate()}>Confirm lock</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmLock(false)}>Cancel</button></span> : <button type="button" className="btn btn-secondary" onClick={() => setConfirmLock(true)}>Lock audit</button>) : null}
        {canManage && selected?.materialized_at ? <button type="button" className="btn btn-secondary" onClick={exportManifest}>Export checklist CSV</button> : null}
      </section>

      {!selected?.materialized_at ? <EmptyState icon="◫" title="Snapshot not materialized" sub={canManage ? 'Materialize the period after its roster basis is ready.' : 'An office user must materialize this audit period.'} /> : <>
        <section className="contractor-toolbar" aria-label="Audit manifest filters">
          <SearchInput value={searchValue} onChange={setSearchValue} placeholder="Search contractor or trade…" />
          <label className="contractor-filter-label">Status<select className="input" value={status} onChange={(event) => { setStatus(event.target.value); setPage(0); }}><option value="all">All</option><option value="gap">Gap</option><option value="ready">Ready</option></select></label>
          {canManage ? <><label className="contractor-filter-label">Paid in period<select className="input" value={paid} onChange={(event) => { setPaid(event.target.value); setPage(0); }}><option value="all">All</option><option value="yes">Yes</option><option value="no">No</option><option value="unknown">Unknown</option></select></label><label className="contractor-filter-label">Active in period<select className="input" value={active} onChange={(event) => { setActive(event.target.value); setPage(0); }}><option value="all">All</option><option value="yes">Yes</option><option value="no">No</option><option value="unknown">Unknown</option></select></label></> : null}
        </section>
        {manifestQuery.isPending ? <div className="loading-page"><div className="spinner" /><span>Loading audit evidence…</span></div> : null}
        {manifestQuery.error && !items.length ? <ErrorState message={manifestQuery.error.message} onRetry={manifestQuery.refetch} /> : null}
        {manifestQuery.error && items.length ? <p className="contractor-inline-notice" role="status">Couldn’t refresh — showing the last-loaded manifest.</p> : null}
        {!manifestQuery.isPending && !manifestQuery.error && !items.length ? <EmptyState icon="✓" title="No contractors match" sub="Try a different filter or refresh the snapshot." /> : null}
        {items.length ? <section className={`contractor-audit-table${canManage ? '' : ' contractor-audit-table--viewer'}`} aria-label="Insurance audit manifest">
          <div className="contractor-audit-table-head"><span>Contractor</span><span>Workers’ comp</span><span>General liability</span>{canManage ? <><span>Period facts</span><span>Requests</span></> : null}<span>Evidence</span><span>Actions</span></div>
          {items.map((row) => <article className="contractor-audit-row" key={row.contractor_id}>
            <div><strong>{row.name}</strong><small>{[row.company, row.trade_specialty].filter(Boolean).join(' · ') || 'No trade recorded'}</small><ComplianceStatus status={row.overall_status} /></div>
            <div data-label="Workers’ comp"><ComplianceStatus status={row.workers_comp_status} /></div>
            <div data-label="General liability"><ComplianceStatus status={row.general_liability_status} /></div>
            {canManage ? <><div data-label="Period facts"><small>Active: {factLabel(row.active_in_period)}</small><small>Paid: {factLabel(row.paid_in_period)}</small></div><div data-label="Requests"><strong>{row.request_count || 0}</strong><small>{row.last_request_at ? new Date(row.last_request_at).toLocaleDateString() : 'None sent'}</small></div></> : null}
            <div data-label="Evidence"><strong>{(row.evidence || []).filter((entry) => entry.interval_kind === 'coverage').length} coverage interval(s)</strong><small>{(row.evidence || []).filter((entry) => entry.interval_kind === 'gap').length} gap interval(s)</small></div>
            <div data-label="Actions"><button type="button" className="btn btn-secondary btn-sm" onClick={() => {
              const returnParams = new URLSearchParams({
                audit: effectiveSelectedId,
                search: searchValue,
                status,
                paid,
                active,
                page: String(page),
              });
              const detailParams = new URLSearchParams({
                audit_start: selected.start_date,
                audit_end: selected.end_date,
              });
              navigate(`/contractors/${row.contractor_id}?${detailParams}`, {
                state: {
                  contractorReturnTo: `/contractors/audits?${returnParams}`,
                },
              });
            }}>View</button></div>
          </article>)}
        </section> : null}
        {total > PAGE_SIZE ? <nav className="contractor-pagination" aria-label="Audit manifest pages"><button className="btn btn-secondary btn-sm" type="button" disabled={page === 0 || manifestQuery.isFetching} onClick={() => setPage((value) => value - 1)}>Previous</button><span>Page {page + 1} of {Math.ceil(total / PAGE_SIZE)}</span><button className="btn btn-secondary btn-sm" type="button" disabled={(page + 1) * PAGE_SIZE >= total || manifestQuery.isFetching} onClick={() => setPage((value) => value + 1)}>Next</button></nav> : null}
      </>}
    </> : null}
  </main>;
}
