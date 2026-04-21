import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import PullToRefresh from '@/components/PullToRefresh';
import ClaimPicker from '@/components/ClaimPicker';
import { fmt$ } from '@/lib/claimUtils';
import { toast } from '@/lib/toast';
import {
  RATES, BLANK, calcQuote, tierFor, TIER_COLORS,
  divisionToJobType, formFromQuoteRow, paramsForUpsert,
  toNum, isDecimal, isInt,
} from '@/lib/oopPricing';

/* ── Icons ────────────────────────────────────────────────────────────── */
function IconBack(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="15 18 9 12 15 6"/></svg>);}
function IconMinus(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="5" y1="12" x2="19" y2="12"/></svg>);}
function IconPlus(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>);}
function IconX(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>);}
function IconTrash(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>);}

/* ── Main page ────────────────────────────────────────────────────────── */
export default function TechOOPPricing() {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const { db, employee } = useAuth();

  const jobId = search.get('jobId') || null;
  const quoteId = search.get('quoteId') || null;

  const [loading, setLoading] = useState(!!(jobId || quoteId));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [form, setForm] = useState(BLANK);
  const [linkedJob, setLinkedJob] = useState(null);
  const [linkedClaim, setLinkedClaim] = useState(null);
  const [quote, setQuote] = useState(null);

  const loadJob = async (id) => {
    const jobs = await db.select('jobs', `id=eq.${id}&select=id,job_number,insured_name,address,division,city,state`);
    return jobs?.[0] || null;
  };

  /* Load: prefill from job or hydrate from quote */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (quoteId) {
          const row = await db.rpc('get_oop_quote', { p_id: quoteId });
          if (cancelled) return;
          if (!row) {
            toast('Quote not found', 'error');
            navigate('/tech/tools/oop-pricing', { replace: true });
            return;
          }
          setForm(formFromQuoteRow(row));
          setQuote({ id: row.id, quote_number: row.quote_number });
          if (row.job_id) {
            const job = await loadJob(row.job_id);
            if (!cancelled && job) setLinkedJob(job);
          }
        } else if (jobId) {
          const job = await loadJob(jobId);
          if (cancelled) return;
          if (job) {
            setLinkedJob(job);
            const addr = [job.address, job.city, job.state].filter(Boolean).join(', ');
            setForm(f => ({
              ...f,
              jobType: divisionToJobType(job.division),
              insuredName: job.insured_name || '',
              address: addr,
            }));
          }
        }
      } catch (e) {
        if (!cancelled) toast('Failed to load: ' + (e.message || e), 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, quoteId]);

  /* Refresh handler — re-fetches the saved quote (if any) from DB */
  const handleRefresh = async () => {
    if (!quote?.id) return;
    try {
      const row = await db.rpc('get_oop_quote', { p_id: quote.id });
      if (row) {
        setForm(formFromQuoteRow(row));
        setQuote({ id: row.id, quote_number: row.quote_number });
      }
    } catch {
      /* silent */
    }
  };

  const calc = useMemo(() => calcQuote(form), [form]);
  const isMold = form.jobType === 'mold';
  const marginTier = tierFor(calc.internal.netMarginPct);
  const tierColors = TIER_COLORS[marginTier];

  // Accepts either a plain value or a functional updater (prev => next) so
  // rapid taps on the +/− steppers read fresh state instead of the closure.
  const setField = (key) => (valOrFn) =>
    setForm(f => ({ ...f, [key]: typeof valOrFn === 'function' ? valOrFn(f[key]) : valOrFn }));

  /* Claim picker handlers ─────────────────────────────────────────────── */
  const handleInsuredChange = (v) => {
    // Manual typing → no longer tied to any selected claim/job
    setForm(f => ({ ...f, insuredName: v }));
    if (linkedClaim) setLinkedClaim(null);
    if (linkedJob)   setLinkedJob(null);
  };

  const handleClaimSelect = async (claim) => {
    const addr = [claim.loss_address, claim.loss_city, claim.loss_state].filter(Boolean).join(', ');
    setForm(f => ({ ...f, insuredName: claim.insured_name || '', address: addr || f.address }));
    setLinkedClaim(claim);
    // Pull jobs under this claim — link the first one + use its division for jobType
    try {
      const res = await db.rpc('get_claim_jobs', { p_claim_id: claim.id });
      const firstJob = res?.jobs?.[0];
      if (firstJob) {
        setLinkedJob({
          id: firstJob.id,
          job_number: firstJob.job_number,
          insured_name: firstJob.insured_name,
          address: firstJob.address,
          division: firstJob.division,
        });
        if (firstJob.division === 'water' || firstJob.division === 'mold') {
          setForm(f => ({ ...f, jobType: divisionToJobType(firstJob.division) }));
        }
      }
    } catch { /* silent — linking is best-effort */ }
  };

  const handleUnlinkClaim = () => {
    setLinkedClaim(null);
    setLinkedJob(null);
  };

  /* Save */
  const handleSave = async () => {
    if (saving) return;
    if (!form.techHours || toNum(form.techHours) <= 0) {
      toast('Tech hours must be greater than 0', 'error');
      return;
    }
    setSaving(true);
    try {
      const params = paramsForUpsert({
        form,
        quoteId: quote?.id,
        jobId: linkedJob?.id,
        calc,
        employeeId: employee?.id,
      });
      const row = await db.rpc('upsert_oop_quote', params);
      setQuote({ id: row.id, quote_number: row.quote_number });
      toast(quote?.id ? 'Quote updated' : `Saved as ${row.quote_number}`);
      if (!quoteId) {
        navigate(`/tech/tools/oop-pricing?quoteId=${row.id}`, { replace: true });
      }
    } catch (e) {
      toast('Save failed: ' + (e.message || e), 'error');
    } finally {
      setSaving(false);
    }
  };

  /* Delete */
  const handleDelete = async () => {
    if (!quote?.id) return;
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setConfirmDelete(false);
    setDeleting(true);
    try {
      await db.rpc('delete_oop_quote', { p_id: quote.id });
      toast('Quote deleted');
      setForm(BLANK);
      setQuote(null);
      setLinkedJob(null);
      navigate('/tech/tools/oop-pricing', { replace: true });
    } catch (e) {
      toast('Delete failed: ' + (e.message || e), 'error');
    } finally {
      setDeleting(false);
    }
  };

  /* Reset */
  const handleReset = () => {
    if (!confirmReset) { setConfirmReset(true); return; }
    setConfirmReset(false);
    setForm(BLANK);
    setQuote(null);
    setLinkedJob(null);
    navigate('/tech/tools/oop-pricing', { replace: true });
  };

  if (loading) {
    return (
      <div className="tech-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '50dvh' }}>
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="tech-page" style={{ padding: 0 }}>
      {/* ── Sticky top header ─────────────────────────────────────────── */}
      <div style={{
        position: 'sticky',
        top: 0, left: 0, right: 0,
        zIndex: 20,
        background: 'var(--bg-primary)',
        borderBottom: '1px solid var(--border-light)',
        padding: '10px 12px',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <button
          onClick={() => navigate(-1)}
          aria-label="Back"
          style={{
            minWidth: 'var(--tech-min-tap)', minHeight: 'var(--tech-min-tap)',
            background: 'transparent', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-primary)',
            WebkitTapHighlightColor: 'transparent',
          }}>
          <IconBack width={22} height={22} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>OOP Pricing</div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {quote?.quote_number && (
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--accent)' }}>
                {quote.quote_number}
              </span>
            )}
            {linkedJob && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Link to={`/tech/jobs/${linkedJob.id}`} style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>
                  · {linkedJob.job_number}
                </Link>
                <button
                  onClick={() => setLinkedJob(null)}
                  aria-label="Unlink job"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex', color: 'var(--text-tertiary)' }}
                >
                  <IconX width={12} height={12} />
                </button>
              </span>
            )}
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            minHeight: 40, padding: '0 16px',
            background: 'var(--accent)', color: '#fff',
            border: 'none', borderRadius: 'var(--tech-radius-button)',
            fontSize: 14, fontWeight: 700, cursor: 'pointer',
            fontFamily: 'var(--font-sans)',
            WebkitTapHighlightColor: 'transparent',
            opacity: saving ? 0.5 : 1,
          }}>
          {saving ? '…' : (quote?.id ? 'Update' : 'Save')}
        </button>
      </div>

      {/* ── Scrollable content (pull-to-refresh wraps BELOW the sticky header) ── */}
      <PullToRefresh onRefresh={handleRefresh}>
        <div style={{
          padding: '12px 12px calc(var(--tech-nav-height) + 40px + env(safe-area-inset-bottom))',
          display: 'flex', flexDirection: 'column', gap: 12,
        }}>

          {/* ── Live total strip at top (compact, for orientation while editing) ── */}
          <LiveTotalStrip calc={calc} tierColors={tierColors} />

          {/* ── Job Type ────────────────────────────────────────────── */}
          <Section label="Job type">
            <PillToggle
              value={form.jobType}
              onChange={setField('jobType')}
              options={[
                { value: 'water', label: '💧 Water' },
                { value: 'mold',  label: '🧫 Mold' },
              ]}
            />
          </Section>

          {/* ── Customer ────────────────────────────────────────────── */}
          <Section label="Customer">
            <ClaimPicker
              label="Claim / Insured name"
              value={form.insuredName}
              onChangeText={handleInsuredChange}
              onSelectClaim={handleClaimSelect}
              linkedClaim={linkedClaim}
              onUnlink={handleUnlinkClaim}
              placeholder="Type homeowner name or search claims…"
            />
            <TextField label="Address" value={form.address} onChange={setField('address')} placeholder="Street, city, state" />
          </Section>

          {/* ── Labor ───────────────────────────────────────────────── */}
          <Section label="Labor" hint="4-hour min per mobilization">
            <NumField label="Tech hours" value={form.techHours} onChange={setField('techHours')} suffix={`× $${form.billRate || 92}`} placeholder="0" />
            <NumField label="Bill rate ($/hr)" value={form.billRate} onChange={setField('billRate')} placeholder="92" />
            <LineHint total={calc.lines.laborLine} />
          </Section>

          {/* ── Equipment ───────────────────────────────────────────── */}
          <Section label="Equipment">
            <StepperRow label="Air movers" rate={RATES.airMover}
              countField="airMoverCount" daysField="airMoverDays"
              form={form} setForm={setForm} />
            <StepperRow label="LGR dehu" rate={RATES.lgr}
              countField="lgrCount" daysField="lgrDays"
              form={form} setForm={setForm} />
            <StepperRow label="XLGR dehu" rate={RATES.xlgr}
              countField="xlgrCount" daysField="xlgrDays"
              form={form} setForm={setForm} />
            <StepperRow label="Air scrubber" rate={RATES.airScrubber}
              countField="airScrubberCount" daysField="airScrubberDays"
              form={form} setForm={setForm} />
            {isMold && (
              <StepperRow label="Neg. air setup" rate={RATES.negAir}
                countField="negAirCount" daysField="negAirDays"
                form={form} setForm={setForm}
                sub="includes scrubber" />
            )}
            <LineHint total={calc.lines.equipment} label="Equipment total" />
          </Section>

          {/* ── Materials & Fees ────────────────────────────────────── */}
          <Section label="Materials & Fees">
            <NumField label="Materials cost ($)" value={form.materialsActualCost} onChange={setField('materialsActualCost')} placeholder="0.00" hint="Charged at 1.25×" />
            <NumField label="Antimicrobial (sqft)" value={form.antimicrobialSqft} onChange={setField('antimicrobialSqft')} placeholder="0" hint={`$${RATES.antimicrobialPerSqft.toFixed(2)}/sqft`} />
            <NumField label="Disposal trips" value={form.disposalTrips} onChange={setField('disposalTrips')} placeholder="0" hint={`$${RATES.disposalPerTrip}/trip`} intOnly />
          </Section>

          {/* ── Mold add-ons (conditional) ──────────────────────────── */}
          {isMold && (
            <Section label="Mold add-ons" accent="#be185d">
              <NumField label="Containment (lft)" value={form.containmentLinearFt} onChange={setField('containmentLinearFt')} placeholder="0" hint={`$${RATES.containmentPerLft.toFixed(2)}/lft`} />
              <NumField label="PRV invoice ($)" value={form.prvInvoiceCost} onChange={setField('prvInvoiceCost')} placeholder="0.00" hint="Pass-through (internal only)" />
            </Section>
          )}

          {/* ── Notes ───────────────────────────────────────────────── */}
          <Section label="Notes">
            <textarea
              value={form.notes}
              onChange={e => setField('notes')(e.target.value)}
              rows={3}
              placeholder="Scope, access, special conditions…"
              style={{
                width: '100%', padding: '12px',
                fontSize: 16, // 16px to prevent iOS auto-zoom
                fontFamily: 'var(--font-sans)',
                border: '1px solid var(--border-color)', borderRadius: 'var(--tech-radius-button)',
                background: 'var(--bg-primary)', color: 'var(--text-primary)',
                outline: 'none', resize: 'vertical', boxSizing: 'border-box',
                minHeight: 72,
              }}
            />
          </Section>

          {/* ── Full breakdown + internal margin at the bottom ──────── */}
          <TotalCard calc={calc} marginTier={marginTier} tierColors={tierColors} />
          <InternalPanel calc={calc} marginTier={marginTier} />

          {/* ── Danger zone ─────────────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
            <button
              onClick={handleReset}
              onBlur={() => setConfirmReset(false)}
              style={{
                minHeight: 'var(--tech-min-tap)',
                padding: '0 16px',
                background: confirmReset ? '#fef2f2' : 'var(--bg-primary)',
                color:      confirmReset ? '#dc2626' : 'var(--text-secondary)',
                border:     `1px solid ${confirmReset ? '#fecaca' : 'var(--border-color)'}`,
                borderRadius: 'var(--tech-radius-button)',
                fontSize: 14, fontWeight: 600, cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
                WebkitTapHighlightColor: 'transparent',
              }}>
              {confirmReset ? 'Tap again to clear form' : 'Start new quote'}
            </button>

            {quote?.id && (
              <button
                onClick={handleDelete}
                onBlur={() => setConfirmDelete(false)}
                disabled={deleting}
                style={{
                  minHeight: 'var(--tech-min-tap)',
                  padding: '0 16px',
                  background: confirmDelete ? '#fef2f2' : 'var(--bg-primary)',
                  color:      confirmDelete ? '#dc2626' : '#dc2626',
                  border:     `1px solid ${confirmDelete ? '#fecaca' : 'var(--border-light)'}`,
                  borderRadius: 'var(--tech-radius-button)',
                  fontSize: 14, fontWeight: 600, cursor: 'pointer',
                  fontFamily: 'var(--font-sans)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  WebkitTapHighlightColor: 'transparent',
                }}>
                <IconTrash width={15} height={15} />
                {confirmDelete ? 'Tap again to delete' : 'Delete quote'}
              </button>
            )}
          </div>

        </div>
      </PullToRefresh>
    </div>
  );
}

/* ── Sub-components ───────────────────────────────────────────────────── */

/* Compact non-tappable strip shown at the top so the tech can see the
   live quote while filling fields. Full breakdown lives at the bottom. */
function LiveTotalStrip({ calc, tierColors }) {
  const pct = calc.internal.netMarginPct;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 12, padding: '10px 14px',
      background: 'var(--bg-primary)',
      border: '1px solid var(--border-color)',
      borderRadius: 'var(--tech-radius-card)',
      boxShadow: 'var(--tech-shadow-card)',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{
          fontSize: 'var(--tech-text-label)', fontWeight: 600,
          textTransform: 'uppercase', letterSpacing: '0.06em',
          color: 'var(--text-tertiary)',
        }}>Live quote</div>
        <div style={{
          fontSize: 'var(--tech-text-heading)', fontWeight: 800,
          color: 'var(--text-primary)', fontFamily: 'var(--font-mono)',
          letterSpacing: '-0.02em', lineHeight: 1.1,
        }}>
          {fmt$(calc.quote)}
        </div>
      </div>
      <div style={{
        padding: '6px 12px', borderRadius: 'var(--radius-full)',
        background: tierColors.bg, color: tierColors.fg,
        border: `1px solid ${tierColors.border}`,
        fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)',
        flexShrink: 0,
      }}>
        {pct == null ? '—' : `${pct.toFixed(1)}%`}
      </div>
    </div>
  );
}

/* Large total card at the bottom — always expanded, includes warning
   banners. Paired with InternalPanel below. */
function TotalCard({ calc, marginTier, tierColors }) {
  const pct = calc.internal.netMarginPct;
  return (
    <div style={{
      background: 'var(--bg-primary)',
      border: '1px solid var(--border-color)',
      borderRadius: 'var(--tech-radius-card)',
      padding: '16px',
      boxShadow: 'var(--tech-shadow-card)',
      marginTop: 12,
    }}>
      <div style={{
        fontSize: 'var(--tech-text-label)', fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '0.06em',
        color: 'var(--text-tertiary)',
      }}>Customer quote</div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 6, gap: 12 }}>
        <div style={{
          fontSize: 'var(--tech-text-hero)', fontWeight: 800,
          color: 'var(--text-primary)', fontFamily: 'var(--font-mono)',
          letterSpacing: '-0.02em', lineHeight: 1.1,
        }}>
          {fmt$(calc.quote)}
        </div>
        <div style={{
          padding: '6px 12px', borderRadius: 'var(--radius-full)',
          background: tierColors.bg, color: tierColors.fg,
          border: `1px solid ${tierColors.border}`,
          fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)',
          flexShrink: 0,
        }}>
          {pct == null ? '—' : `${pct.toFixed(1)}%`}
        </div>
      </div>
      {marginTier === 'red' && (
        <div style={{
          marginTop: 12, padding: '8px 10px',
          fontSize: 12, color: '#991b1b',
          background: '#fef2f2', border: '1px solid #fecaca',
          borderRadius: 'var(--radius-md)', fontWeight: 500,
        }}>
          ⚠ Margin below 10% — decline or reprice
        </div>
      )}
      {marginTier === 'amber' && (
        <div style={{
          marginTop: 12, padding: '8px 10px',
          fontSize: 12, color: '#92400e',
          background: '#fffbeb', border: '1px solid #fde68a',
          borderRadius: 'var(--radius-md)',
        }}>
          ⚠ Below 20% target
        </div>
      )}
    </div>
  );
}

function InternalPanel({ calc, marginTier }) {
  const { lines, internal } = calc;
  return (
    <div style={{
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border-color)',
      borderRadius: 'var(--tech-radius-card)',
      padding: 14,
      display: 'flex', flexDirection: 'column', gap: 2,
    }}>
      <div style={{ fontSize: 'var(--tech-text-label)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', marginBottom: 6 }}>
        Customer-facing lines
      </div>
      <BR label="Labor" value={lines.laborLine} />
      <BR label="Equipment" value={lines.equipment} />
      <BR label="Materials (×1.25)" value={lines.materialsLine} />
      <BR label="Antimicrobial" value={lines.antimicrobialLine} />
      <BR label="Disposal" value={lines.disposalLine} />
      {lines.containmentLine > 0 && <BR label="Containment" value={lines.containmentLine} />}
      {lines.ppeLine > 0 && <BR label="PPE" value={lines.ppeLine} />}

      <div style={{ borderTop: '1px solid var(--border-color)', marginTop: 8, paddingTop: 8 }} />
      <div style={{ fontSize: 'var(--tech-text-label)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', marginBottom: 6 }}>
        Internal costs
      </div>
      <BR label="Direct labor ($51/hr)" value={internal.directLaborCost} small />
      <BR label="Materials (cost)"      value={internal.materialsCost}   small />
      {internal.antimicrobialCost > 0 && <BR label="Antimicrobial (cost)" value={internal.antimicrobialCost} small />}
      {internal.disposalCost > 0 &&      <BR label="Disposal (cost)"      value={internal.disposalCost}      small />}
      {internal.containmentCost > 0 &&   <BR label="Containment (cost)"   value={internal.containmentCost}   small />}
      {internal.ppeCost > 0 &&           <BR label="PPE (cost)"           value={internal.ppeCost}           small />}
      {internal.prvCost > 0 &&           <BR label="PRV (pass-through)"   value={internal.prvCost}           small />}
      <BR label="Overhead (33%)"  value={internal.overheadAlloc}   small />
      <div style={{ borderTop: '1px solid var(--border-light)', marginTop: 6, paddingTop: 6 }} />
      <BR label="Total cost + OH" value={internal.totalDirectCost + internal.overheadAlloc} strong />
      <BR label="Net profit" value={internal.netProfit} strong
          color={internal.netProfit >= 0 ? '#059669' : '#dc2626'} />
    </div>
  );
}

function BR({ label, value, small, strong, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '2px 0' }}>
      <span style={{ fontSize: small ? 12 : 13, color: 'var(--text-secondary)', fontWeight: strong ? 600 : 400 }}>{label}</span>
      <span style={{ fontSize: small ? 12 : 13, fontWeight: strong ? 700 : 500, color: color || 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
        {fmt$(value)}
      </span>
    </div>
  );
}

function Section({ label, hint, accent, children }) {
  return (
    <div style={{
      background: 'var(--bg-primary)',
      border: '1px solid var(--border-color)',
      borderLeft: accent ? `3px solid ${accent}` : '1px solid var(--border-color)',
      borderRadius: 'var(--tech-radius-card)',
      padding: 12,
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div style={{
          fontSize: 'var(--tech-text-label)', fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '0.06em',
          color: 'var(--text-tertiary)',
        }}>{label}</div>
        {hint && <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function PillToggle({ value, onChange, options }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: `repeat(${options.length}, 1fr)`,
      gap: 4, padding: 4,
      background: 'var(--bg-tertiary)', borderRadius: 'var(--tech-radius-button)',
    }}>
      {options.map(o => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            style={{
              minHeight: 44,
              background: active ? 'var(--bg-primary)' : 'transparent',
              color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
              border: 'none', borderRadius: 10,
              fontSize: 15, fontWeight: 600, cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
              boxShadow: active ? 'var(--shadow-sm)' : 'none',
              WebkitTapHighlightColor: 'transparent',
            }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function TextField({ label, value, onChange, placeholder }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>{label}</span>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={inputStyle}
      />
    </label>
  );
}

function NumField({ label, value, onChange, placeholder, hint, suffix, intOnly }) {
  const handle = (e) => {
    const v = e.target.value;
    if (intOnly ? isInt(v) : isDecimal(v)) onChange(v);
  };
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
        <span>{label} {suffix && <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}>{suffix}</span>}</span>
        {hint && <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}>{hint}</span>}
      </span>
      <input
        type="text"
        inputMode="decimal"
        pattern="[0-9.]*"
        value={value}
        onChange={handle}
        placeholder={placeholder}
        style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
      />
    </label>
  );
}

/* Stepper row: big +/− buttons around a count + a days input, for gloved hands. */
function StepperRow({ label, rate, countField, daysField, form, setForm, sub }) {
  const count = toNum(form[countField]);
  const days  = toNum(form[daysField]);
  const line  = count * days * rate;

  // Single setForm call so rapid taps see fresh state AND the days-default
  // check runs against the same snapshot. OOP jobs default to 3 drying days
  // on first increment of any equipment — tech can still override after.
  const incCount = () => setForm(f => {
    const nextCount = toNum(f[countField]) + 1;
    const daysEmpty = !f[daysField] || f[daysField] === '';
    return {
      ...f,
      [countField]: String(nextCount),
      ...(daysEmpty ? { [daysField]: '3' } : {}),
    };
  });
  const decCount = () => setForm(f => ({
    ...f,
    [countField]: String(Math.max(0, toNum(f[countField]) - 1)),
  }));

  const handleDaysChange = (e) => {
    const v = e.target.value;
    if (isInt(v)) setForm(f => ({ ...f, [daysField]: v }));
  };

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr)',
      gap: 8,
      padding: '8px 4px',
      borderTop: '1px dashed var(--border-light)',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
          ${rate}/day{sub ? ` · ${sub}` : ''}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 88px 72px', gap: 8, alignItems: 'center' }}>
        {/* Count stepper */}
        <div style={{
          display: 'grid', gridTemplateColumns: '44px 1fr 44px',
          alignItems: 'center',
          background: 'var(--bg-tertiary)',
          borderRadius: 'var(--tech-radius-button)',
          overflow: 'hidden',
          border: '1px solid var(--border-color)',
        }}>
          <button
            type="button"
            onClick={decCount}
            disabled={count <= 0}
            aria-label={`Decrease ${label}`}
            style={stepBtnStyle(count <= 0)}>
            <IconMinus width={18} height={18} />
          </button>
          <div style={{ textAlign: 'center', fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
            {count}
          </div>
          <button
            type="button"
            onClick={incCount}
            aria-label={`Increase ${label}`}
            style={stepBtnStyle(false)}>
            <IconPlus width={18} height={18} />
          </button>
        </div>
        {/* Days input */}
        <input
          type="text" inputMode="numeric" pattern="[0-9]*"
          value={form[daysField]}
          onChange={handleDaysChange}
          placeholder="days"
          aria-label={`${label} days`}
          style={{ ...inputStyle, textAlign: 'center', fontFamily: 'var(--font-mono)' }}
        />
        {/* Line total */}
        <div style={{ textAlign: 'right', fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', color: line > 0 ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
          {line > 0 ? fmt$(line) : '—'}
        </div>
      </div>
    </div>
  );
}

function LineHint({ total, label }) {
  if (!total || total <= 0) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 4px' }}>
      <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{label || 'Section total'}</span>
      <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{fmt$(total)}</span>
    </div>
  );
}

const inputStyle = {
  minHeight: 'var(--tech-min-tap)',
  padding: '0 14px',
  fontSize: 16,                              // 16px — prevents iOS Safari auto-zoom
  fontFamily: 'var(--font-sans)',
  border: '1px solid var(--border-color)',
  borderRadius: 'var(--tech-radius-button)',
  background: 'var(--bg-primary)',
  color: 'var(--text-primary)',
  outline: 'none',
  boxSizing: 'border-box',
  width: '100%',
  WebkitAppearance: 'none',
};

const stepBtnStyle = (disabled) => ({
  minHeight: 44, minWidth: 44,
  background: 'transparent', border: 'none',
  color: disabled ? 'var(--text-tertiary)' : 'var(--text-primary)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  cursor: disabled ? 'not-allowed' : 'pointer',
  WebkitTapHighlightColor: 'transparent',
});
