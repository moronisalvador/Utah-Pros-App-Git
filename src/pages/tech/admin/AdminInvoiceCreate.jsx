/**
 * ════════════════════════════════════════════════
 * FILE: AdminInvoiceCreate.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Helps an authorized office user find a customer, choose one of that
 *   customer's jobs, and open its new invoice. It keeps the search and job
 *   choices on one phone-sized screen and gives clear loading and error
 *   feedback. A new invoice starts without any charges, so a person must add
 *   and save each charge separately.
 *
 * WHERE IT LIVES:
 *   Route:        /tech/admin/invoice/new
 *   Rendered by:  src/App.jsx (native build route) and
 *                 src/pages/tech/admin/AdminMobileRoutes.jsx (web subroute)
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  @/contexts/AuthContext, @/lib/toast,
 *              @/components/TabLoading, @/components/ui/ErrorState,
 *              @/components/ui/SearchInput,
 *              @/components/admin-mobile/AdminMobilePage,
 *              @/components/admin-mobile/href,
 *              @/components/admin-mobile/icons, @/lib/nativeHaptics
 *   Data:      reads  → contacts (search_contacts_for_job); contacts, claims,
 *                        and jobs (get_customer_detail); jobs and existing
 *                        invoices (create_invoice_for_job)
 *              writes → invoices (create_invoice_for_job)
 *
 * NOTES / GOTCHAS:
 *   - create_invoice_for_job returns the job's existing invoice when one has
 *     already been made, preventing a second invoice from a repeated tap.
 *   - This page creates no invoice-line item. Charges are added later through
 *     the separate, human-confirmed QuickBooks save flow.
 *   - The billing feature switch prevents searching, loading jobs, and opening
 *     invoices when billing is unavailable.
 * ════════════════════════════════════════════════
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { err } from '@/lib/toast';
import TabLoading from '@/components/TabLoading';
import ErrorState from '@/components/ui/ErrorState';
import SearchInput from '@/components/ui/SearchInput';
import AdminMobilePage from '@/components/admin-mobile/AdminMobilePage';
import { adminInvoiceHref } from '@/components/admin-mobile/href';
import { IconChevronRight } from '@/components/admin-mobile/icons';
import { impact, notify, selection } from '@/lib/nativeHaptics';

const back = '/tech/admin/collections?tab=invoices';
export default function AdminInvoiceCreate() {
  const navigate = useNavigate(); const { db, isFeatureEnabled, employee } = useAuth(); const billingEnabled = isFeatureEnabled('feature:billing');
  const searchTimer = useRef(null); const searchInputRef = useRef(null); const jobsHeadingRef = useRef(null); const createRef = useRef(false); const createTokenRef = useRef(0); const searchRef = useRef(0); const jobRef = useRef(0); const routeRef = useRef({ epoch: 0, mounted: true });
  const [search, setSearch] = useState(''); const [results, setResults] = useState([]); const [searching, setSearching] = useState(false); const [searchStatus, setSearchStatus] = useState(''); const [searchError, setSearchError] = useState(''); const [customer, setCustomer] = useState(null); const [claims, setClaims] = useState([]); const [loadingJobs, setLoadingJobs] = useState(false); const [loadError, setLoadError] = useState(''); const [busyJob, setBusyJob] = useState(null);
  useEffect(() => () => { clearTimeout(searchTimer.current); createTokenRef.current += 1; routeRef.current = { ...routeRef.current, mounted: false, epoch: routeRef.current.epoch + 1 }; }, []);
  useEffect(() => { if (customer) jobsHeadingRef.current?.focus(); else searchInputRef.current?.focus(); }, [customer]);
  const searchCustomers = useCallback(async (query) => { if (!billingEnabled) return; const request = ++searchRef.current; setSearching(true); setSearchError(''); setSearchStatus('Searching customers…'); try { const rows = await db.rpc('search_contacts_for_job', { p_query: query.trim() }); if (request === searchRef.current && routeRef.current.mounted) { const next = Array.isArray(rows) ? rows : []; setResults(next); setSearchStatus(next.length ? `${next.length} customer${next.length === 1 ? '' : 's'} found.` : 'No customers found.'); } } catch { if (request === searchRef.current && routeRef.current.mounted) { setResults([]); setSearchStatus(''); setSearchError('Customer search failed. Try again.'); } } finally { if (request === searchRef.current && routeRef.current.mounted) setSearching(false); } }, [billingEnabled, db]);
  const chooseCustomer = async (next) => { if (!billingEnabled) return; selection(); const request = ++jobRef.current; setCustomer(next); setResults([]); setSearch(''); setLoadingJobs(true); setLoadError(''); try { const detail = await db.rpc('get_customer_detail', { p_contact_id: next.id }); if (request !== jobRef.current || !routeRef.current.mounted) return; setClaims(detail?.claims || []); } catch (error) { if (request !== jobRef.current || !routeRef.current.mounted) return; setClaims([]); setLoadError(error?.message || 'Could not load this customer’s jobs.'); } finally { if (request === jobRef.current && routeRef.current.mounted) setLoadingJobs(false); } };
  const create = async (job) => { if (!billingEnabled || createRef.current) return; const epoch = routeRef.current.epoch; const token = ++createTokenRef.current; const jobId = job.id; createRef.current = true; setBusyJob(jobId); impact('light'); const current = () => routeRef.current.mounted && routeRef.current.epoch === epoch && createTokenRef.current === token; try { const result = await db.rpc('create_invoice_for_job', { p_job_id: jobId, p_created_by: employee?.id || null }); if (!current()) return; const row = Array.isArray(result) ? result[0] : result; if (!row?.id) throw new Error('Could not open the invoice.'); notify('success'); navigate(adminInvoiceHref(row.id), { replace: true }); } catch (error) { if (!current()) return; notify('error'); err(`Failed to create invoice: ${error?.message || error}`); createRef.current = false; setBusyJob(null); } };
  const changeSearch = (value) => { setSearch(value); clearTimeout(searchTimer.current); setSearchError(''); if (value.trim().length >= 2) searchTimer.current = setTimeout(() => searchCustomers(value), 300); else { searchRef.current += 1; setResults([]); setSearchStatus(''); setSearching(false); } };
  const changeCustomer = () => { selection(); jobRef.current += 1; createTokenRef.current += 1; createRef.current = false; setCustomer(null); setClaims([]); setLoadingJobs(false); setLoadError(''); setBusyJob(null); setSearchStatus(''); setSearchError(''); };
  if (!billingEnabled) return <AdminMobilePage title="New invoice" back={back}><div className="am-stub">Billing is turned off (feature flag <code>feature:billing</code>).</div></AdminMobilePage>;
  return <AdminMobilePage title="New invoice" back={back}>
    <section className="am-section am-document-create" aria-labelledby="invoice-customer-search"><div className="am-section-heading"><h2 id="invoice-customer-search" className="am-section-label">Customer</h2></div>{!customer ? <><label className="am-invline-label" htmlFor="invoice-customer-input">Search customers</label><SearchInput ref={searchInputRef} id="invoice-customer-input" inputClassName="am-invline-input" value={search} placeholder="Name, phone, or email…" aria-label="Search customers" autoFocus onChange={changeSearch} onClear={() => changeSearch('')} />{searchStatus && <p className="am-document-note" role="status" aria-live="polite" aria-atomic="true">{searchStatus}</p>}{searchError && <div className="am-document-note" role="alert">{searchError} <button type="button" className="am-line-tool" onClick={() => searchCustomers(search)}>Retry search</button></div>}<div className="am-document-results" aria-busy={searching}>{results.map((result) => <button type="button" key={result.id} className="am-data-row am-data-row--link" aria-label={`Choose customer ${result.name}${result.email ? `, ${result.email}` : result.phone ? `, ${result.phone}` : ''}`} onClick={() => chooseCustomer(result)}><div className="am-data-row-main"><strong>{result.name}</strong><span>{result.email || result.phone || 'No contact detail'}</span></div><IconChevronRight width={18} height={18} aria-hidden="true" /></button>)}</div></> : <div className="am-document-selected"><div><strong>{customer.name}</strong><span>{customer.email || customer.phone || 'Customer selected'}</span></div><button type="button" className="am-line-tool" disabled={Boolean(busyJob)} onClick={changeCustomer}>Change</button></div>}</section>
    {customer && <section className="am-section" aria-labelledby="invoice-job-select"><div className="am-section-heading"><h2 ref={jobsHeadingRef} tabIndex={-1} id="invoice-job-select" className="am-section-label">Choose a job</h2></div>{loadingJobs && <TabLoading />}{loadError && <ErrorState message={loadError} onRetry={() => chooseCustomer(customer)} />}{!loadingJobs && !loadError && claims.flatMap((claim) => claim.jobs || []).length === 0 && <div><p className="am-document-note">This customer has no jobs to invoice.</p><Link className="am-data-row am-data-row--link" to="/tech/new-job" aria-label="Create a new job" onClick={() => selection()}><div className="am-data-row-main"><strong>Create a new job</strong><span>Then return here to start its invoice.</span></div><IconChevronRight width={18} height={18} aria-hidden="true" /></Link></div>}{claims.map((claim) => <div key={claim.id} className="am-document-job-group"><div className="am-document-note">{claim.claim_number || 'Claim'}{claim.insurance_carrier ? ` · ${claim.insurance_carrier}` : ''}</div>{(claim.jobs || []).map((job) => <button key={job.id} type="button" className="am-data-row am-data-row--link" disabled={Boolean(busyJob)} aria-label={`Open invoice for job ${job.job_number || 'unnumbered'}, ${job.division?.replaceAll('_', ' ') || 'job'}`} onClick={() => create(job)}><div className="am-data-row-main"><strong>{job.job_number || 'Job'}</strong><span>{job.division?.replaceAll('_', ' ') || 'Job'}</span></div><strong className="am-data-row-money">{busyJob === job.id ? 'Opening…' : 'Open'}</strong></button>)}</div>)}</section>}
  </AdminMobilePage>;
}
