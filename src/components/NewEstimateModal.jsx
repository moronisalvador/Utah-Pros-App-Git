/**
 * ════════════════════════════════════════════════
 * FILE: NewEstimateModal.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The "+ New estimate" picker. You search for a customer, see their claims and the
 *   jobs under each, pick the kind of estimate (initial, supplement, change order,
 *   final), and click a job to start a new estimate and open its builder. Jobs that
 *   already have estimates show them so you can open one instead of making a duplicate.
 *
 * WHERE IT LIVES:
 *   Rendered by:  src/pages/Estimates.jsx (and any "+ New estimate" entry point)
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  @/components/DivisionIcons (DIVISION_COLORS)
 *   Data:      reads  → search_contacts_for_job RPC, get_customer_detail RPC,
 *                       estimates (existing per job)
 *              writes → create_estimate_for_job RPC (inserts a new draft estimate)
 *
 * NOTES / GOTCHAS:
 *   - Unlike invoices (one per job), a job can have MANY estimates — so clicking a job
 *     always creates a NEW draft of the selected type; existing ones are listed to open.
 *   - Mirrors NewInvoiceModal's two modes: customer-scoped (pass { contact, claims })
 *     or global (customer typeahead).
 * ════════════════════════════════════════════════
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { DIVISION_COLORS } from '@/components/DivisionIcons';
import CreateJobModal from '@/components/CreateJobModal';

const toast = (m, t = 'success') => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: m, type: t } }));
const DIVISION_EMOJI = { water: '\u{1F4A7}', mold: '\u{1F9A0}', reconstruction: '\u{1F3D7}️', fire: '\u{1F525}', contents: '\u{1F4E6}' };
const fmtPh = (phone) => { if (!phone) return ''; const d = phone.replace(/\D/g, ''); const n = d.startsWith('1') ? d.slice(1) : d; return n.length === 10 ? `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}` : phone; };
const TYPES = [['initial', 'Initial'], ['supplement', 'Supplement'], ['change_order', 'Change order'], ['final', 'Final']];

function IconSearch(p) { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>); }
function IconUser(p) { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>); }
function IconX(p) { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>); }

export default function NewEstimateModal({ db, onClose, contact = null, claims = null }) {
  const navigate = useNavigate();
  const lockToCustomer = !!contact;

  const [selectedContact, setSelectedContact] = useState(contact);
  const [data, setData] = useState(claims || null);          // claims[] for the selected customer
  const [estByJob, setEstByJob] = useState({});              // job_id → existing estimates[]
  const [estType, setEstType] = useState('initial');
  const [loading, setLoading] = useState(false);
  const [busyJob, setBusyJob] = useState(null);
  const [showCreateJob, setShowCreateJob] = useState(false);   // "customer not in system yet" → full intake

  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [showDrop, setShowDrop] = useState(false);
  const searchRef = useRef(null);
  const timer = useRef(null);

  const loadCustomer = useCallback(async (contactId, preloaded) => {
    setLoading(true);
    try {
      let cls = preloaded;
      if (!cls) {
        const detail = await db.rpc('get_customer_detail', { p_contact_id: contactId });
        cls = detail?.claims || [];
        if (detail?.contact) setSelectedContact(detail.contact);
      }
      setData(cls || []);
      const jobIds = (cls || []).flatMap(c => (c.jobs || []).map(j => j.id)).filter(Boolean);
      if (jobIds.length) {
        const ests = await db.select('estimates', `job_id=in.(${jobIds.join(',')})&select=id,job_id,estimate_number,estimate_type,status,qbo_estimate_id,converted_invoice_id&order=created_at.desc`) || [];
        const m = {}; ests.forEach(e => { (m[e.job_id] ||= []).push(e); });
        setEstByJob(m);
      } else setEstByJob({});
    } catch (e) {
      toast('Failed to load jobs: ' + (e.message || e), 'error');
    } finally { setLoading(false); }
  }, [db]);

  useEffect(() => {
    if (contact?.id) loadCustomer(contact.id, claims);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const h = e => { if (searchRef.current && !searchRef.current.contains(e.target)) setShowDrop(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const doSearch = useCallback(async (q) => {
    if (q.trim().length < 2) { setResults([]); setShowDrop(false); return; }
    setSearching(true);
    try {
      const r = await db.rpc('search_contacts_for_job', { p_query: q.trim() });
      setResults(Array.isArray(r) ? r : []); setShowDrop(true);
    } catch { setResults([]); } finally { setSearching(false); }
  }, [db]);

  const onSearchChange = (e) => {
    const v = e.target.value; setSearch(v); clearTimeout(timer.current);
    if (v.trim().length >= 2) timer.current = setTimeout(() => doSearch(v), 300);
    else { setResults([]); setShowDrop(false); }
  };

  const selectContact = (c) => {
    setSelectedContact(c); setSearch(''); setShowDrop(false); setResults([]); setData(null);
    loadCustomer(c.id, null);
  };
  const changeCustomer = () => { setSelectedContact(null); setData(null); setEstByJob({}); };

  const handleNew = async (job) => {
    setBusyJob(job.id);
    try {
      const created = await db.rpc('create_estimate_for_job', { p_job_id: job.id, p_estimate_type: estType });
      const id = Array.isArray(created) ? created[0]?.id : created?.id;
      if (id) { onClose?.(); navigate(`/estimates/${id}`); }
      else { toast('Could not open the estimate', 'error'); setBusyJob(null); }
    } catch (e) {
      toast('Failed to create estimate: ' + (e.message || e), 'error');
      setBusyJob(null);
    }
  };
  const openExisting = (estId) => { onClose?.(); navigate(`/estimates/${estId}`); };

  // Customer not in the system yet → run the full intake (new contact + claim + job),
  // then open a new estimate of the selected type for that brand-new job.
  const handleJobCreated = (result) => {
    setShowCreateJob(false);
    const jobId = result?.job?.id || result?.id;
    if (jobId) handleNew({ id: jobId });
    else toast('Job created, but couldn’t open an estimate for it', 'error');
  };

  const allClaims = (data || []).filter(c => (c.jobs || []).length > 0);

  return (
    <>
    <div className="conv-modal-backdrop" onClick={onClose}>
      <div className="conv-modal" onClick={e => e.stopPropagation()}
        style={{ maxWidth: 560, height: 'min(86vh, 680px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        <div className="conv-modal-header" style={{ flexShrink: 0 }}>
          <span style={{ fontSize: 'var(--text-lg)', fontWeight: 700 }}>New Estimate</span>
          <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ width: 32, height: 32, padding: 0 }}>
            <IconX style={{ width: 18, height: 18 }} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-3) var(--space-4) var(--space-4)' }}>
          {/* Customer (search in global mode, chip otherwise) */}
          {!selectedContact ? (
            <div ref={searchRef} style={{ position: 'relative', marginBottom: 'var(--space-3)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Customer</div>
              <div style={{ position: 'relative' }}>
                <IconSearch style={{ width: 14, height: 14, position: 'absolute', left: 10, top: 12, color: 'var(--text-tertiary)' }} />
                <input className="input" placeholder="Search name, phone, or email…" value={search} onChange={onSearchChange} autoFocus style={{ paddingLeft: 32, height: 38 }} />
                {searching && <div style={{ position: 'absolute', right: 10, top: 12 }}><div className="spinner" style={{ width: 14, height: 14 }} /></div>}
              </div>
              {showDrop && (
                <div style={{ position: 'absolute', left: 0, right: 0, top: '100%', zIndex: 20, background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', maxHeight: 260, overflowY: 'auto', marginTop: 4 }}>
                  {results.length === 0 ? (
                    <div style={{ padding: 'var(--space-3)' }}>
                      <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: search.trim().length >= 2 ? 8 : 0 }}>{search.trim().length >= 2 ? 'No customers found.' : 'Type 2+ characters'}</div>
                      {search.trim().length >= 2 && <button onClick={() => { setShowDrop(false); setSearch(''); setShowCreateJob(true); }} className="btn btn-secondary btn-sm" style={{ width: '100%', justifyContent: 'center' }}>+ New customer &amp; job</button>}
                    </div>
                  ) : results.map(c => (
                    <button key={c.id} onClick={() => selectContact(c)}
                      style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', width: '100%', padding: 'var(--space-2) var(--space-3)', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-sans)', borderBottom: '1px solid var(--border-light)' }}>
                      <IconUser style={{ width: 15, height: 15, color: 'var(--text-tertiary)', flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{fmtPh(c.phone)}{c.email ? ` · ${c.email}` : ''}</div>
                      </div>
                      {c.job_count > 0 && <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 99, background: 'var(--bg-tertiary)', color: 'var(--text-tertiary)' }}>{c.job_count} job{c.job_count !== 1 ? 's' : ''}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-2) var(--space-3)', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-light)', marginBottom: 'var(--space-3)' }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--brand-primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                {selectedContact.name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{selectedContact.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Pick a job to estimate</div>
              </div>
              {!lockToCustomer && <button className="btn btn-ghost btn-sm" onClick={changeCustomer} style={{ fontSize: 12 }}>Change</button>}
            </div>
          )}

          {/* Estimate type selector */}
          {selectedContact && (
            <div style={{ marginBottom: 'var(--space-3)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>New estimate type</div>
              <div style={{ display: 'flex', gap: 1, background: 'var(--border-color)', borderRadius: 'var(--radius-md)', overflow: 'hidden', width: 'fit-content' }}>
                {TYPES.map(([v, l]) => (
                  <button key={v} onClick={() => setEstType(v)}
                    style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-sans)', cursor: 'pointer', border: 'none', background: estType === v ? 'var(--accent)' : 'var(--bg-primary)', color: estType === v ? '#fff' : 'var(--text-secondary)' }}>{l}</button>
                ))}
              </div>
            </div>
          )}

          {/* Jobs grouped by claim */}
          {selectedContact && (
            loading ? (
              <div style={{ padding: 20, color: 'var(--text-tertiary)', fontSize: 13 }}>Loading jobs…</div>
            ) : allClaims.length === 0 ? (
              <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13, border: '1px dashed var(--border-color)', borderRadius: 'var(--radius-md)' }}>
                No jobs for this customer yet. Create a job first, then estimate it.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {allClaims.map(cl => (
                  <div key={cl.id} style={{ border: '1px solid var(--border-light)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                    <div style={{ padding: '8px 12px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: 12 }}>{cl.claim_number}</span>
                      {cl.insurance_carrier && <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{cl.insurance_carrier}</span>}
                      {cl.loss_address && <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>📍 {cl.loss_address}{cl.loss_city ? `, ${cl.loss_city}` : ''}</span>}
                    </div>
                    <div style={{ padding: 6 }}>
                      {(cl.jobs || []).map(j => {
                        const dc = DIVISION_COLORS[j.division] || '#6b7280';
                        const em = DIVISION_EMOJI[j.division] || '📁';
                        const existing = estByJob[j.id] || [];
                        const isBusy = busyJob === j.id;
                        return (
                          <div key={j.id} style={{ marginBottom: 4, background: 'var(--bg-primary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-light)', borderLeft: `3px solid ${dc}`, overflow: 'hidden' }}>
                            <button onClick={() => handleNew(j)} disabled={isBusy || busyJob != null}
                              style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', width: '100%', padding: '10px 10px', background: 'none', border: 'none', cursor: isBusy || busyJob != null ? 'default' : 'pointer', textAlign: 'left', fontFamily: 'var(--font-sans)', opacity: busyJob != null && !isBusy ? 0.5 : 1 }}>
                              <span style={{ fontSize: 18 }}>{em}</span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <span style={{ fontSize: 13, fontWeight: 700 }}>{j.job_number || 'New job'}</span>
                                  <span style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'capitalize' }}>{(j.division || '').replace(/_/g, ' ')}</span>
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>{existing.length ? `${existing.length} estimate${existing.length !== 1 ? 's' : ''} · click to add another` : 'No estimates yet'}</div>
                              </div>
                              <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 'var(--radius-full)', background: 'var(--bg-tertiary)', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>+ New</span>
                              <span style={{ fontSize: 13, color: 'var(--brand-primary)', fontWeight: 700 }}>{isBusy ? '…' : '→'}</span>
                            </button>
                            {existing.length > 0 && (
                              <div style={{ borderTop: '1px solid var(--border-light)', padding: '4px 10px 6px 40px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                {existing.map(e => (
                                  <button key={e.id} onClick={() => openExisting(e.id)}
                                    style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 'var(--radius-full)', background: e.converted_invoice_id ? '#f0fdf4' : 'var(--accent-light)', color: e.converted_invoice_id ? '#16a34a' : 'var(--accent)', border: `1px solid ${e.converted_invoice_id ? '#bbf7d0' : '#bfdbfe'}`, cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>
                                    {e.estimate_number || 'Draft'}{e.converted_invoice_id ? ' · converted' : ''}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {!selectedContact && (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
              <div style={{ marginBottom: 12 }}>Search for a customer, then pick the job to estimate.</div>
              <button onClick={() => setShowCreateJob(true)} className="btn btn-secondary btn-sm">+ New customer &amp; job</button>
            </div>
          )}
        </div>

        <div style={{ flexShrink: 0, padding: '8px var(--space-4) 12px', borderTop: '1px solid var(--border-color)', background: 'var(--bg-primary)', fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.4 }}>
          A job can have several estimates (initial, supplements, change orders). Clicking a job creates a new one of the selected type; tap an existing estimate to open it.
        </div>
      </div>
    </div>
    {showCreateJob && <CreateJobModal db={db} onClose={() => setShowCreateJob(false)} onCreated={handleJobCreated} />}
    </>
  );
}
