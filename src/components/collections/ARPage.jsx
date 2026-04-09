import { useState, useEffect, useCallback, useMemo } from 'react';
import ARKpiStrip from './ARKpiStrip';
import ARFilterBar from './ARFilterBar';
import ARClaimCard from './ARClaimCard';
import ARDetailPanel from './ARDetailPanel';
import ARPaymentSheet from './ARPaymentSheet';

const toast = (msg, type = 'success') =>
  window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type } }));

export default function ARPage({ db, navigate }) {
  const [billingData, setBillingData] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState('all');
  const [selectedClaimId, setSelectedClaimId] = useState(null);
  const [expandedClaimId, setExpandedClaimId] = useState(null);
  const [paymentTarget, setPaymentTarget] = useState(null); // { job, claim }

  const load = useCallback(async () => {
    try {
      const [billing, recentPayments] = await Promise.all([
        db.select('billing_overview', 'order=outstanding.desc'),
        db.select('payments', 'order=created_at.desc&limit=25&select=*,jobs(job_number,insured_name,division)'),
      ]);
      setBillingData(billing || []);
      setPayments(recentPayments || []);
    } catch (e) {
      toast('Failed to load collections data', 'error');
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => { load(); }, [load]);

  // KPI aggregation
  const kpis = useMemo(() => {
    const sum = (key) => billingData.reduce((s, r) => s + Number(r[key] || 0), 0);
    const invoiced = sum('total_invoiced');
    const collected = sum('total_collected');
    const outstanding = sum('outstanding');
    return {
      outstanding,
      invoiced,
      collected,
      rate: invoiced > 0 ? Math.round((collected / invoiced) * 100) : 0,
      mitOutstanding: sum('mit_invoiced') - sum('mit_collected'),
      reconOutstanding: sum('recon_invoiced') - sum('recon_collected'),
      claimCount: billingData.length,
    };
  }, [billingData]);

  // Filtering
  const filtered = useMemo(() => {
    let result = billingData;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(r =>
        (r.client || '').toLowerCase().includes(q) ||
        (r.claim_number || '').toLowerCase().includes(q) ||
        (r.carrier || '').toLowerCase().includes(q)
      );
    }
    if (filterMode === 'needs_attention') result = result.filter(r => Number(r.outstanding) > 0);
    if (filterMode === 'paid') result = result.filter(r => Number(r.outstanding) <= 0);
    return result;
  }, [billingData, search, filterMode]);

  const selectedClaim = billingData.find(c => c.claim_id === selectedClaimId) || null;

  const handleCardClick = (claim) => {
    // Mobile: toggle expand. Desktop: open detail panel.
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
      setExpandedClaimId(expandedClaimId === claim.claim_id ? null : claim.claim_id);
    } else {
      setSelectedClaimId(selectedClaimId === claim.claim_id ? null : claim.claim_id);
      setExpandedClaimId(claim.claim_id);
    }
  };

  const openPaymentForm = (job, claim) => {
    setPaymentTarget({ job, claim });
  };

  const handlePaymentSubmit = async (payload) => {
    try {
      const { _jobNumber, ...dbPayload } = payload;
      await db.insert('payments', dbPayload);
      const jobNum = payload._jobNumber || '';
      const amt = Number(payload.amount);
      const fmtAmt = '$' + amt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      toast(`Payment of ${fmtAmt} recorded for ${jobNum}`);
      setPaymentTarget(null);
      await load();
    } catch (e) {
      toast('Failed to record payment: ' + (e.message || e), 'error');
      throw e;
    }
  };

  const handlePaymentDelete = async (paymentId) => {
    try {
      await db.delete('payments', `id=eq.${paymentId}`);
      toast('Payment deleted');
      await load();
    } catch (e) {
      toast('Failed to delete payment', 'error');
    }
  };

  // Get payments for a specific claim's jobs
  const getClaimPayments = useCallback((claim) => {
    if (!claim || !claim.jobs) return [];
    const jobs = typeof claim.jobs === 'string' ? JSON.parse(claim.jobs) : claim.jobs;
    const jobIds = new Set(jobs.map(j => j.job_id));
    return payments.filter(p => jobIds.has(p.job_id));
  }, [payments]);

  if (loading) {
    return (
      <div className="collections-page">
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>Loading collections...</div>
      </div>
    );
  }

  return (
    <div className="collections-page">
      <div className="ar-v2-header">
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, margin: 0 }}>Collections</h1>
      </div>

      <ARKpiStrip kpis={kpis} onFilter={setFilterMode} activeFilter={filterMode} />

      <ARFilterBar
        search={search}
        onSearch={setSearch}
        filter={filterMode}
        onFilter={setFilterMode}
        counts={{ all: billingData.length, needs_attention: billingData.filter(r => Number(r.outstanding) > 0).length, paid: billingData.filter(r => Number(r.outstanding) <= 0).length }}
      />

      <div className="ar-v2-body">
        <div className={`ar-v2-card-area${selectedClaim ? ' has-panel' : ''}`}>
          {filtered.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>
              No claims match your filters
            </div>
          ) : (
            <div className="ar-claim-grid">
              {filtered.map(claim => (
                <ARClaimCard
                  key={claim.claim_id}
                  claim={claim}
                  isSelected={selectedClaimId === claim.claim_id}
                  isExpanded={expandedClaimId === claim.claim_id}
                  onClick={() => handleCardClick(claim)}
                  onRecordPayment={(job) => openPaymentForm(job, claim)}
                  onJobClick={(jobId) => navigate(`/jobs/${jobId}`)}
                />
              ))}
            </div>
          )}
        </div>

        {selectedClaim && (
          <ARDetailPanel
            claim={selectedClaim}
            payments={getClaimPayments(selectedClaim)}
            onRecordPayment={(job) => openPaymentForm(job, selectedClaim)}
            onJobClick={(jobId) => navigate(`/jobs/${jobId}`)}
            onDeletePayment={handlePaymentDelete}
            onClose={() => { setSelectedClaimId(null); }}
          />
        )}
      </div>

      {paymentTarget && (
        <ARPaymentSheet
          job={paymentTarget.job}
          claim={paymentTarget.claim}
          onSubmit={handlePaymentSubmit}
          onClose={() => setPaymentTarget(null)}
        />
      )}
    </div>
  );
}
