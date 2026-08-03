/**
 * ════════════════════════════════════════════════
 * FILE: ContractorTaxReadiness.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Gives admin and office users an annual W-9 checklist and a narrow place to
 *   record QuickBooks/Gusto handoff identifiers after a W-9 is accepted.
 *
 * WHERE IT LIVES:
 *   Route: /contractors/tax-readiness
 *
 * DEPENDS ON:
 *   Packages: react, @tanstack/react-query, react-router-dom
 *   Internal: AuthContext, shared UI, ComplianceStatus, toast
 *   Data: annual W-9 checklist and provider-handoff RPCs
 *
 * NOTES / GOTCHAS:
 *   - This page never handles 1099 forms, reportable amounts, SSNs, or EINs.
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
const CURRENT_DENVER_YEAR = Number(new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Denver',
  year: 'numeric',
}).format(new Date()));

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadChecklist(year, rows) {
  const headings = [
    'Contractor', 'Company', 'Email', 'Trade', 'Tax year', 'W-9 readiness',
    'Last verified', 'Latest accepted W-9 year', 'Last W-9 request',
    'Provider target', 'QuickBooks contractor ID', 'Gusto contractor ID',
    'Handoff status', 'Handoff date', 'Provider reference',
  ];
  const body = rows.map((row) => [
    row.name, row.company, row.email, row.trade_specialty, year, row.w9_status,
    row.last_verified_at, row.latest_accepted_tax_year, row.last_request_at,
    row.provider_target, row.quickbooks_contractor_external_id,
    row.gusto_contractor_external_id, row.handoff_status, row.handoff_date,
    row.provider_reference,
  ]);
  const csv = [headings, ...body].map((row) => row.map(csvCell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `contractor-w9-readiness-${year}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function editValues(row) {
  return {
    contractorId: row.contractor_id,
    providerTarget: row.provider_target || 'unassigned',
    quickbooksId: row.quickbooks_contractor_external_id || '',
    gustoId: row.gusto_contractor_external_id || '',
    handoffStatus: row.handoff_status || 'not_ready',
    handoffDate: row.handoff_date || '',
    providerReference: row.provider_reference || '',
  };
}

export default function ContractorTaxReadiness() {
  const { db } = useAuth();
  const navigate = useNavigate();
  const [urlParams, setUrlParams] = useSearchParams();
  const queryClient = useQueryClient();
  const initialSearch = urlParams.get('search') || '';
  const [year, setYear] = useState(Number(urlParams.get('year')) || CURRENT_DENVER_YEAR);
  const [searchValue, setSearchValue] = useState(initialSearch);
  const [search, setSearch] = useState(initialSearch);
  const [w9Status, setW9Status] = useState(urlParams.get('w9') || 'all');
  const [provider, setProvider] = useState(urlParams.get('provider') || 'all');
  const [handoff, setHandoff] = useState(urlParams.get('handoff') || 'all');
  const [activeOnly, setActiveOnly] = useState(urlParams.get('active') !== 'all');
  const [page, setPage] = useState(Number(urlParams.get('page')) || 0);
  const [editing, setEditing] = useState(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchValue);
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchValue]);
  useEffect(() => {
    const params = new URLSearchParams();
    params.set('year', String(year));
    if (searchValue) params.set('search', searchValue);
    if (w9Status !== 'all') params.set('w9', w9Status);
    if (provider !== 'all') params.set('provider', provider);
    if (handoff !== 'all') params.set('handoff', handoff);
    if (!activeOnly) params.set('active', 'all');
    if (page) params.set('page', String(page));
    setUrlParams(params, { replace: true });
  }, [activeOnly, handoff, page, provider, searchValue, setUrlParams, w9Status, year]);

  const queryArgs = {
    p_tax_year: year,
    p_search: search || null,
    p_w9_status: w9Status,
    p_provider_target: provider,
    p_handoff_status: handoff,
    p_active_only: activeOnly,
  };
  const checklistQuery = useQuery({
    queryKey: ['contractor-compliance', 'w9-checklist', queryArgs, page],
    queryFn: () => db.rpc('get_contractor_w9_tax_year_checklist', {
      ...queryArgs,
      p_limit: PAGE_SIZE,
      p_offset: page * PAGE_SIZE,
    }),
    placeholderData: (previous) => previous,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const data = checklistQuery.data || {};
  const items = useMemo(() => (Array.isArray(data.items) ? data.items : []), [data.items]);
  const counts = data.counts || {};
  const total = data.total || 0;

  const saveMutation = useMutation({
    mutationFn: () => db.rpc('contractor_w9_upsert_provider_handoff', {
      p_contact_id: editing.contractorId,
      p_tax_year: year,
      p_provider_target: editing.providerTarget,
      p_quickbooks_contractor_external_id: editing.quickbooksId || null,
      p_gusto_contractor_external_id: editing.gustoId || null,
      p_handoff_status: editing.handoffStatus,
      p_handoff_date: editing.handoffDate || null,
      p_provider_reference: editing.providerReference || null,
    }),
    onSuccess: async () => {
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: ['contractor-compliance', 'w9-checklist'] });
      ok('Provider handoff updated.');
    },
    onError: (error) => err(error.message),
  });

  const exportAll = async () => {
    try {
      const rows = [];
      let offset = 0;
      let expected = 0;
      do {
        const result = await db.rpc('get_contractor_w9_tax_year_checklist', {
          ...queryArgs,
          p_limit: 100,
          p_offset: offset,
        });
        const batch = Array.isArray(result.items) ? result.items : [];
        expected = result.total || 0;
        rows.push(...batch);
        offset += batch.length;
        if (!batch.length) break;
      } while (offset < expected);
      downloadChecklist(year, rows);
      ok(`Exported ${rows.length} W-9 checklist row${rows.length === 1 ? '' : 's'}.`);
    } catch (error) {
      err(error.message);
    }
  };

  const requiresHandoffProof = editing?.handoffStatus === 'handed_off'
    || editing?.handoffStatus === 'reconciled';
  const invalidEdit = editing && (
    (editing.handoffStatus !== 'not_ready' && editing.providerTarget === 'unassigned')
    || (requiresHandoffProof && (!editing.handoffDate || !editing.providerReference.trim()))
  );

  return <main className="contractor-compliance-page">
    <Link className="contractor-back" to="/contractors">← Contractor Compliance</Link>
    <PageHeader
      title="W-9 & Provider Readiness"
      subtitle={`${total} contractor${total === 1 ? '' : 's'} in the ${year} checklist`}
      actions={<button type="button" className="btn btn-secondary" disabled={checklistQuery.isPending} onClick={exportAll}>Export checklist CSV</button>}
    >
      <p className="contractor-page-note">UPR tracks signed W-9 readiness and handoff references only. QuickBooks or Gusto prepares, files, and sends 1099s.</p>
    </PageHeader>

    <section className="contractor-kpis contractor-tax-kpis" aria-label="W-9 readiness counts">
      <div className="card contractor-kpi contractor-kpi--ready"><span>Valid</span><strong>{counts.valid || 0}</strong></div>
      <div className="card contractor-kpi contractor-kpi--missing"><span>Missing</span><strong>{counts.missing || 0}</strong></div>
      <div className="card contractor-kpi contractor-kpi--review"><span>Needs review</span><strong>{counts.needs_review || 0}</strong></div>
      <div className="card contractor-kpi contractor-kpi--risk"><span>Rejected / previous year</span><strong>{(counts.rejected || 0) + (counts.stale_previous_year || 0)}</strong></div>
    </section>

    <section className="contractor-toolbar" aria-label="W-9 checklist filters">
      <SearchInput value={searchValue} onChange={setSearchValue} placeholder="Search contractor, company, email…" />
      <label className="contractor-filter-label">Tax year<input className="input" type="number" min="2000" max="2200" value={year} onChange={(event) => { setYear(Number(event.target.value)); setPage(0); setEditing(null); }} /></label>
      <label className="contractor-filter-label">W-9 status<select className="input" value={w9Status} onChange={(event) => { setW9Status(event.target.value); setPage(0); }}><option value="all">All</option><option value="valid">Valid</option><option value="missing">Missing</option><option value="needs_review">Needs review</option><option value="rejected">Rejected</option><option value="stale_previous_year">Previous year</option></select></label>
      <label className="contractor-filter-label">Provider<select className="input" value={provider} onChange={(event) => { setProvider(event.target.value); setPage(0); }}><option value="all">All</option><option value="unassigned">Unassigned</option><option value="quickbooks">QuickBooks</option><option value="gusto">Gusto</option><option value="quickbooks_and_gusto">QuickBooks + Gusto</option><option value="other">Other</option></select></label>
      <label className="contractor-filter-label">Handoff<select className="input" value={handoff} onChange={(event) => { setHandoff(event.target.value); setPage(0); }}><option value="all">All</option><option value="not_ready">Not ready</option><option value="ready">Ready</option><option value="handed_off">Handed off</option><option value="reconciled">Reconciled</option></select></label>
      <label className="contractor-check-label"><input type="checkbox" checked={activeOnly} onChange={(event) => { setActiveOnly(event.target.checked); setPage(0); }} /> Active only</label>
    </section>

    {checklistQuery.isPending ? <div className="loading-page"><div className="spinner" /><span>Loading W-9 checklist…</span></div> : null}
    {checklistQuery.error && !items.length ? <ErrorState message={checklistQuery.error.message} onRetry={checklistQuery.refetch} /> : null}
    {checklistQuery.error && items.length ? <p className="contractor-inline-notice" role="status">Couldn’t refresh — showing the last-loaded checklist.</p> : null}
    {!checklistQuery.isPending && !checklistQuery.error && !items.length ? <EmptyState icon="✓" title="No contractors match" sub="Try a different year or filter." /> : null}

    {items.length ? <section className="contractor-tax-list" aria-label="Annual W-9 checklist">
      {items.map((row) => <article className="card contractor-tax-row" key={row.contractor_id}>
        <div className="contractor-tax-summary">
          <div><strong>{row.name}</strong><small>{[row.company, row.trade_specialty].filter(Boolean).join(' · ') || row.email || 'No details recorded'}</small></div>
          <div><span>W-9</span><ComplianceStatus status={row.w9_status} /><small>{row.last_verified_at ? `Verified ${new Date(row.last_verified_at).toLocaleDateString()}` : row.latest_accepted_tax_year ? `Latest accepted: ${row.latest_accepted_tax_year}` : 'Never verified'}</small></div>
          <div><span>Provider handoff</span><ComplianceStatus status={row.handoff_status} /><small>{row.provider_target.replace(/_/g, ' ')}</small></div>
          <div><span>External IDs</span><small>QuickBooks: {row.quickbooks_contractor_external_id || '—'}</small><small>Gusto: {row.gusto_contractor_external_id || '—'}</small></div>
          <div className="contractor-inline-actions"><button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(editValues(row))}>Update handoff</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => {
            const returnParams = new URLSearchParams({
              year: String(year),
              search: searchValue,
              w9: w9Status,
              provider,
              handoff,
              active: activeOnly ? 'only' : 'all',
              page: String(page),
            });
            navigate(`/contractors/${row.contractor_id}`, {
              state: {
                contractorReturnTo: `/contractors/tax-readiness?${returnParams}`,
              },
            });
          }}>View contractor</button></div>
        </div>
        {editing?.contractorId === row.contractor_id ? <div className="contractor-handoff-form">
          <label>Provider<select className="input" value={editing.providerTarget} onChange={(event) => setEditing((current) => ({ ...current, providerTarget: event.target.value }))}><option value="unassigned">Unassigned</option><option value="quickbooks">QuickBooks</option><option value="gusto">Gusto</option><option value="quickbooks_and_gusto">QuickBooks + Gusto</option><option value="other">Other</option></select></label>
          <label>Status<select className="input" value={editing.handoffStatus} onChange={(event) => setEditing((current) => ({ ...current, handoffStatus: event.target.value }))}><option value="not_ready">Not ready</option><option value="ready" disabled={row.w9_status !== 'valid'}>Ready</option><option value="handed_off" disabled={row.w9_status !== 'valid'}>Handed off</option><option value="reconciled" disabled={row.w9_status !== 'valid'}>Reconciled</option></select></label>
          <label>QuickBooks contractor ID<input className="input" value={editing.quickbooksId} onChange={(event) => setEditing((current) => ({ ...current, quickbooksId: event.target.value }))} /></label>
          <label>Gusto contractor ID<input className="input" value={editing.gustoId} onChange={(event) => setEditing((current) => ({ ...current, gustoId: event.target.value }))} /></label>
          <label>Handoff date<input className="input" type="date" value={editing.handoffDate} onChange={(event) => setEditing((current) => ({ ...current, handoffDate: event.target.value }))} /></label>
          <label>Provider reference<input className="input" value={editing.providerReference} onChange={(event) => setEditing((current) => ({ ...current, providerReference: event.target.value }))} /></label>
          <div className="contractor-inline-actions"><button type="button" className="btn btn-primary btn-sm" disabled={invalidEdit || saveMutation.isPending} onClick={() => saveMutation.mutate()}>Save handoff</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>Cancel</button></div>
        </div> : null}
      </article>)}
    </section> : null}
    {total > PAGE_SIZE ? <nav className="contractor-pagination" aria-label="W-9 checklist pages"><button className="btn btn-secondary btn-sm" type="button" disabled={page === 0 || checklistQuery.isFetching} onClick={() => setPage((value) => value - 1)}>Previous</button><span>Page {page + 1} of {Math.ceil(total / PAGE_SIZE)}</span><button className="btn btn-secondary btn-sm" type="button" disabled={(page + 1) * PAGE_SIZE >= total || checklistQuery.isFetching} onClick={() => setPage((value) => value + 1)}>Next</button></nav> : null}
  </main>;
}
