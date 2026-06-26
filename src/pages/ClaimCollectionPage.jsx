import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import '@/claim-page.css';
import { errToast, fmtK, fmtDate, fmtPh, DIV_EMOJI, getBalances, withJobFinancials, canEditBilling } from '@/lib/claimUtils';
import { StatusBadge, KPI } from '@/components/claim/SharedClaimUI';
import ClaimBilling from '@/components/ClaimBilling';
import usePageTransition from '@/hooks/usePageTransition';
import { Skel } from '@/components/collections/collKit';

// ═══════════════════════════════════════════════════════════════════════
// CLAIM A/R WORKSPACE — /collections/:claimId
// The dedicated collections desk for one claim: client/carrier header, A/R KPIs,
// and the invoice-centric Invoices & Payments panel covering every job in the claim
// at once (create/send invoices, record payments → QuickBooks). Drilled into from the
// global Collections dashboard and the claim "Financials" button.
// ═══════════════════════════════════════════════════════════════════════
export default function ClaimCollectionPage() {
  const { claimId } = useParams();
  const navigate = useNavigate();
  const { db, employee: currentUser, isFeatureEnabled } = useAuth();
  const canEdit = canEditBilling(currentUser?.role);   // A/R edits — admin + manager only
  const slide = usePageTransition();

  const [claim,   setClaim]   = useState(null);
  const [jobs,    setJobs]    = useState([]);
  const [contact, setContact] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const data = await db.rpc('get_claim_detail', { p_claim_id: claimId });
        if (!alive) return;
        if (!data?.claim) { navigate('/collections', { replace: true }); return; }
        setClaim(data.claim);
        setJobs(await withJobFinancials(db, data.jobs || []));
        setContact(data.contact || null);
      } catch (e) {
        errToast('Failed to load claim: ' + (e.message || e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [claimId, db, navigate]);

  const totals = useMemo(() => {
    let invoiced = 0, collected = 0, balance = 0, ded_total = 0, ded_owed = 0;
    for (const j of jobs) {
      const b = getBalances(j);
      invoiced += b.invoiced; collected += b.collected; balance += b.balance;
      ded_owed += b.ded_owed; ded_total += b.deductible;
    }
    return { invoiced, collected, balance, ded_total, ded_owed };
  }, [jobs]);

  if (loading) return <div className={`claim-page ${slide}`}><ClaimCollectionSkeleton /></div>;
  if (!claim)  return null;

  const openBalance = jobs.filter(j => getBalances(j).balance > 0).length;
  const dedUnpaid   = jobs.filter(j => Number(j.deductible) > 0 && !j.deductible_collected).length;
  const insuredName = contact?.name || jobs[0]?.insured_name || 'Unknown';
  const carrier     = claim.insurance_carrier || jobs[0]?.insurance_company || 'Out of pocket';
  const isInsurance = !!claim.insurance_carrier;
  const collectedPct = totals.invoiced > 0 ? Math.round((totals.collected / totals.invoiced) * 100) + '% of billed' : '—';

  return (
    <div className={`claim-page ${slide}`}>
      {/* ── TOP BAR ── */}
      <div className="claim-topbar">
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/collections')} style={{ gap: 4 }}>← Collections</button>
        <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/claims/${claimId}`)} style={{ gap: 5, height: 32, fontSize: 12 }}>
          View Operations →
        </button>
      </div>

      {/* ── HEADER ── */}
      <div className="claim-header">
        <div className="claim-header-left">
          <div className="claim-number">{claim.claim_number}</div>
          <div className="claim-client">{insuredName}</div>
          <div className="claim-meta">
            <span>{carrier}</span>
            {claim.date_of_loss && <><span className="claim-meta-sep">·</span><span>Loss: {fmtDate(claim.date_of_loss)}</span></>}
            {claim.loss_type && <><span className="claim-meta-sep">·</span><span style={{ textTransform: 'capitalize' }}>{claim.loss_type}</span></>}
            {claim.insurance_claim_number && <><span className="claim-meta-sep">·</span><span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>Ins# {claim.insurance_claim_number}</span></>}
          </div>
        </div>
        <div className="claim-header-right">
          <StatusBadge status={claim.status} />
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4, textAlign: 'right' }}>
            {jobs.length} job{jobs.length !== 1 ? 's' : ''}
            {jobs.length > 0 && <span style={{ marginLeft: 4 }}>· {jobs.map(j => DIV_EMOJI[j.division] || '📁').join(' ')}</span>}
          </div>
        </div>
      </div>

      {/* ── CONTACT QUICK ACTIONS ── */}
      {contact && (contact.phone || contact.email) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '12px 0 0' }}>
          {contact.phone && <a href={`tel:${contact.phone}`} className="btn btn-secondary btn-sm" style={{ textDecoration: 'none' }}>📞 {fmtPh(contact.phone)}</a>}
          {contact.phone && <button className="btn btn-secondary btn-sm" onClick={() => navigate('/conversations', { state: { contactId: contact.id } })}>💬 Text</button>}
          {contact.email && <a href={`mailto:${contact.email}`} className="btn btn-secondary btn-sm" style={{ textDecoration: 'none' }}>✉️ Email</a>}
        </div>
      )}

      {/* ── A/R KPIs ── */}
      <div className="claim-kpi-strip" style={{ marginTop: 12 }}>
        <KPI label="Balance"   value={fmtK(totals.balance)}   sub={`${openBalance} open invoice${openBalance !== 1 ? 's' : ''}`} color={totals.balance > 0 ? '#dc2626' : '#059669'} alert={totals.balance > 5000} />
        <KPI label="Collected" value={fmtK(totals.collected)} sub={collectedPct} color="#059669" />
        <KPI label="Invoiced"  value={fmtK(totals.invoiced)}  sub={`${jobs.length} job${jobs.length !== 1 ? 's' : ''}`} color="var(--accent)" />
        {isInsurance && totals.ded_total > 0 && <KPI label="Deductible Owed" value={fmtK(totals.ded_owed)} sub={`${dedUnpaid} uncollected`} color="#d97706" />}
      </div>

      {/* ── INVOICES & PAYMENTS ── */}
      <div className="claim-body" style={{ paddingTop: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)', marginBottom: 10 }}>
          {'Invoices & Payments'}
        </div>
        {isFeatureEnabled('feature:billing')
          ? <ClaimBilling jobs={jobs} db={db} canEdit={canEdit} hideSummary />
          : <div style={{ padding: 16, color: 'var(--text-tertiary)', fontSize: 13, border: '1px dashed var(--border-color)', borderRadius: 'var(--radius-md)' }}>Billing is turned off (feature flag <code>feature:billing</code>).</div>}
      </div>
    </div>
  );
}

// Loading skeleton — mirrors the claim A/R workspace (topbar → header → KPI strip → body)
// using the page's own layout classes so the slide reveals shape, not a spinner.
function ClaimCollectionSkeleton() {
  return (
    <>
      <div className="claim-topbar">
        <Skel w={110} h={32} r={8} />
        <Skel w={140} h={32} r={8} />
      </div>
      <div className="claim-header">
        <div className="claim-header-left">
          <Skel w={150} h={22} />
          <Skel w={200} h={16} style={{ marginTop: 8 }} />
          <Skel w={260} h={12} style={{ marginTop: 8 }} />
        </div>
        <div className="claim-header-right">
          <Skel w={90} h={22} r={999} />
          <Skel w={70} h={12} style={{ marginTop: 8 }} />
        </div>
      </div>
      <div className="claim-kpi-strip" style={{ marginTop: 12 }}>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i}><Skel w="60%" h={10} /><Skel w="80%" h={22} style={{ marginTop: 8 }} /><Skel w="50%" h={10} style={{ marginTop: 8 }} /></div>
        ))}
      </div>
      <div className="claim-body" style={{ paddingTop: 16 }}>
        <Skel w={160} h={12} />
        <Skel w="100%" h={180} r={10} style={{ marginTop: 12 }} />
      </div>
    </>
  );
}
