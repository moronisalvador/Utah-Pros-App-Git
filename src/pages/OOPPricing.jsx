import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import ClaimPicker from '@/components/ClaimPicker';
import { fmt$, toast, errToast } from '@/lib/claimUtils';
import {
  RATES, BLANK, calcQuote, tierFor, TIER_COLORS,
  divisionToJobType, formFromQuoteRow, paramsForUpsert,
  toNum, isDecimal, isInt,
} from '@/lib/oopPricing';

/* ═══ ICONS ═══ */
function IconBack(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="15 18 9 12 15 6"/></svg>);}
function IconSave(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>);}
function IconPrint(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>);}
function IconNew(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>);}
function IconX(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>);}
function IconTrash(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>);}

// Back-compat alias for this file's inline number helper usage
const n = toNum;

/* ═══ MAIN PAGE ═══ */
export default function OOPPricing() {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const { db, employee } = useAuth();

  const jobId  = search.get('jobId')  || null;
  const quoteId = search.get('quoteId') || null;

  const [loading, setLoading] = useState(!!(jobId || quoteId));
  const [saving, setSaving]   = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReset,  setConfirmReset]  = useState(false);

  const [form, setForm] = useState(BLANK);
  const [linkedJob, setLinkedJob]   = useState(null); // { id, job_number, ... }
  const [linkedClaim, setLinkedClaim] = useState(null); // { id, claim_number, insured_name, ... }
  const [quote, setQuote] = useState(null);           // saved quote row (id, quote_number, ...)

  /* Prefill from job or load existing quote */
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        if (quoteId) {
          const row = await db.rpc('get_oop_quote', { p_id: quoteId });
          if (cancelled) return;
          if (!row) {
            errToast('Quote not found');
            navigate('/tools/oop-pricing', { replace: true });
            return;
          }
          setForm(formFromQuoteRow(row));
          setQuote({ id: row.id, quote_number: row.quote_number });
          if (row.job_id) {
            const jobs = await db.select('jobs', `id=eq.${row.job_id}&select=id,job_number,insured_name,address,division,city,state`);
            if (!cancelled && jobs?.[0]) setLinkedJob(jobs[0]);
          }
        } else if (jobId) {
          const jobs = await db.select('jobs', `id=eq.${jobId}&select=id,job_number,insured_name,address,division,city,state`);
          if (cancelled) return;
          const job = jobs?.[0];
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
        if (!cancelled) errToast('Failed to load: ' + (e.message || e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [jobId, quoteId, db, navigate]);

  /* Derived values */
  const calc = useMemo(() => calcQuote(form), [form]);
  const isMold = form.jobType === 'mold';
  const marginTier = tierFor(calc.internal.netMarginPct);
  const tierColors = TIER_COLORS[marginTier];

  const setField = (key) => (val) => setForm(f => ({ ...f, [key]: val }));

  /* Claim picker handlers ─────────────────────────────────────────────── */
  const handleInsuredChange = (v) => {
    setForm(f => ({ ...f, insuredName: v }));
    if (linkedClaim) setLinkedClaim(null);
    if (linkedJob)   setLinkedJob(null);
  };

  const handleClaimSelect = async (claim) => {
    const addr = [claim.loss_address, claim.loss_city, claim.loss_state].filter(Boolean).join(', ');
    setForm(f => ({ ...f, insuredName: claim.insured_name || '', address: addr || f.address }));
    setLinkedClaim(claim);
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
    } catch { /* best-effort */ }
  };

  const handleUnlinkClaim = () => {
    setLinkedClaim(null);
    setLinkedJob(null);
  };

  /* Save */
  const handleSave = async () => {
    if (saving) return;
    if (!form.techHours || n(form.techHours) <= 0) {
      errToast('Tech hours must be greater than 0');
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
      toast(quote?.id ? 'Quote updated' : `Quote saved as ${row.quote_number}`);
      if (!quoteId) {
        // Reflect in URL so refresh works
        const nextUrl = `/tools/oop-pricing?quoteId=${row.id}`;
        navigate(nextUrl, { replace: true });
      }
    } catch (e) {
      errToast('Failed to save: ' + (e.message || e));
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
      navigate('/tools/oop-pricing', { replace: true });
      setForm(BLANK);
      setQuote(null);
      setLinkedJob(null);
    } catch (e) {
      errToast('Failed to delete: ' + (e.message || e));
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
    navigate('/tools/oop-pricing', { replace: true });
  };

  if (loading) return <div className="loading-page"><div className="spinner" /></div>;

  return (
    <div className="oop-page" style={{ padding: 'var(--space-5)', maxWidth: 1400, margin: '0 auto' }}>
      {/* ── Topbar ───────────────────────────── */}
      <div className="oop-no-print" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)} style={{ gap: 4 }}>
          <IconBack style={{ width: 14, height: 14 }} /> Back
        </button>
        <div style={{ flex: 1, minWidth: 200 }}>
          <h1 className="page-title" style={{ margin: 0, fontSize: 22 }}>OOP Pricing Calculator</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
            {quote?.quote_number && (
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600,
                padding: '3px 8px', borderRadius: 'var(--radius-full)',
                background: 'var(--accent-light)', color: 'var(--accent)',
                border: '1px solid #bfdbfe',
              }}>{quote.quote_number}</span>
            )}
            {linkedJob && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                fontSize: 12, fontWeight: 500, padding: '3px 8px',
                borderRadius: 'var(--radius-full)',
                background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
                border: '1px solid var(--border-light)',
              }}>
                <Link to={`/jobs/${linkedJob.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                  Linked to {linkedJob.job_number || 'job'}
                </Link>
                <button
                  onClick={() => setLinkedJob(null)}
                  title="Unlink"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: 'var(--text-tertiary)' }}
                >
                  <IconX style={{ width: 12, height: 12 }} />
                </button>
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => window.print()} style={{ gap: 4 }}>
            <IconPrint style={{ width: 13, height: 13 }} /> Print
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleReset}
            onBlur={() => setConfirmReset(false)}
            style={{ gap: 4, background: confirmReset ? '#fef2f2' : undefined, color: confirmReset ? '#dc2626' : undefined, borderColor: confirmReset ? '#fecaca' : undefined }}
          >
            <IconNew style={{ width: 13, height: 13 }} /> {confirmReset ? 'Confirm reset' : 'New quote'}
          </button>
          {quote?.id && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleDelete}
              onBlur={() => setConfirmDelete(false)}
              disabled={deleting}
              style={{ gap: 4, background: confirmDelete ? '#fef2f2' : undefined, color: confirmDelete ? '#dc2626' : undefined, borderColor: confirmDelete ? '#fecaca' : undefined }}
            >
              <IconTrash style={{ width: 13, height: 13 }} /> {confirmDelete ? 'Confirm delete' : 'Delete'}
            </button>
          )}
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving} style={{ gap: 4 }}>
            <IconSave style={{ width: 13, height: 13 }} /> {saving ? 'Saving…' : (quote?.id ? 'Save changes' : 'Save quote')}
          </button>
        </div>
      </div>

      {/* ── Body: 2-column grid ───────────────── */}
      <div className="oop-layout" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(320px, 420px)', gap: 'var(--space-5)', alignItems: 'start' }}>

        {/* LEFT — Inputs */}
        <div className="oop-no-print" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>

          {/* Job type toggle */}
          <Section title="Job Type">
            <PillToggle
              value={form.jobType}
              onChange={setField('jobType')}
              options={[
                { value: 'water', label: 'Water Mitigation' },
                { value: 'mold',  label: 'Mold Remediation' },
              ]}
            />
          </Section>

          {/* Customer */}
          <Section title="Customer">
            <ClaimPicker
              label="Claim / Insured name"
              value={form.insuredName}
              onChangeText={handleInsuredChange}
              onSelectClaim={handleClaimSelect}
              linkedClaim={linkedClaim}
              onUnlink={handleUnlinkClaim}
              placeholder="Type homeowner name or search claims…"
              compact
            />
            <TextField label="Address" value={form.address} onChange={setField('address')} placeholder="123 Main St, Salt Lake City, UT" />
          </Section>

          {/* Labor */}
          <Section title="Labor" hint="4-hour minimum per mobilization">
            <NumField label="Tech hours"  value={form.techHours}  onChange={setField('techHours')}  placeholder="0.00" />
            <NumField label={`Bill rate ($/hr)`} value={form.billRate} onChange={setField('billRate')} placeholder="92.00" />
          </Section>

          {/* Equipment */}
          <Section title="Equipment">
            <CountDaysRow label="Air movers"            countField="airMoverCount"     daysField="airMoverDays"     rate={RATES.airMover}     form={form} setForm={setForm} />
            <CountDaysRow label="LGR dehumidifier"      countField="lgrCount"          daysField="lgrDays"          rate={RATES.lgr}          form={form} setForm={setForm} />
            <CountDaysRow label="XLGR dehumidifier"     countField="xlgrCount"         daysField="xlgrDays"         rate={RATES.xlgr}         form={form} setForm={setForm} />
            <CountDaysRow label="Air scrubber (HEPA)"   countField="airScrubberCount"  daysField="airScrubberDays"  rate={RATES.airScrubber}  form={form} setForm={setForm} />
            {isMold && (
              <CountDaysRow label="Negative air setup"  countField="negAirCount"       daysField="negAirDays"       rate={RATES.negAir}       form={form} setForm={setForm} subLabel="includes air scrubber" />
            )}
          </Section>

          {/* Materials & fees */}
          <Section title="Materials & Fees">
            <NumField label="Materials actual cost ($)" value={form.materialsActualCost} onChange={setField('materialsActualCost')} placeholder="0.00" hint="Charged at 1.25× (25% markup)" />
            <NumField label="Antimicrobial (sqft)"      value={form.antimicrobialSqft}   onChange={setField('antimicrobialSqft')}   placeholder="0"     hint={`$${RATES.antimicrobialPerSqft.toFixed(2)}/sqft`} />
            <NumField label="Disposal trips"            value={form.disposalTrips}       onChange={setField('disposalTrips')}       placeholder="0"     hint={`$${RATES.disposalPerTrip}/trip`} intOnly />
          </Section>

          {/* Mold add-ons */}
          {isMold && (
            <Section title="Mold Add-ons" accent="#be185d">
              <NumField label="Containment (linear ft)" value={form.containmentLinearFt} onChange={setField('containmentLinearFt')} placeholder="0" hint={`$${RATES.containmentPerLft.toFixed(2)}/lft`} />
              <NumField label="PRV invoice cost ($)"    value={form.prvInvoiceCost}      onChange={setField('prvInvoiceCost')}      placeholder="0.00" hint="Pass-through — not charged to customer on quote" />
            </Section>
          )}

          {/* Notes */}
          <Section title="Notes">
            <textarea
              value={form.notes}
              onChange={e => setField('notes')(e.target.value)}
              rows={3}
              placeholder="Scope description, special conditions, access notes…"
              style={{
                width: '100%', padding: '10px 12px', fontSize: 14,
                fontFamily: 'var(--font-sans)',
                border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
                background: 'var(--bg-primary)', color: 'var(--text-primary)',
                outline: 'none', resize: 'vertical', boxSizing: 'border-box',
              }}
            />
          </Section>

        </div>

        {/* RIGHT — Breakdown */}
        <div className="oop-breakdown" style={{ position: 'sticky', top: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <BreakdownPanel calc={calc} isMold={isMold} form={form} quote={quote} linkedJob={linkedJob} />
          <InternalPanel calc={calc} marginTier={marginTier} tierColors={tierColors} />
        </div>

      </div>
    </div>
  );
}

/* ═══ SECTION WRAPPER ═══ */
function Section({ title, hint, accent, children }) {
  return (
    <div style={{
      border: '1px solid var(--border-color)',
      borderLeft: accent ? `3px solid ${accent}` : '1px solid var(--border-color)',
      borderRadius: 'var(--radius-lg)',
      background: 'var(--bg-primary)',
      padding: 'var(--space-4)',
      display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)' }}>
          {title}
        </div>
        {hint && <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{hint}</div>}
      </div>
      {children}
    </div>
  );
}

/* ═══ INPUT CONTROLS ═══ */
function TextField({ label, value, onChange, placeholder }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>{label}</span>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          padding: '10px 12px', fontSize: 14, fontFamily: 'var(--font-sans)',
          border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
          background: 'var(--bg-primary)', color: 'var(--text-primary)',
          outline: 'none', boxSizing: 'border-box',
        }}
      />
    </label>
  );
}

function NumField({ label, value, onChange, placeholder, hint, intOnly }) {
  const handle = (e) => {
    const v = e.target.value;
    if (intOnly ? isInt(v) : isDecimal(v)) onChange(v);
  };
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
        <span>{label}</span>
        {hint && <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}>{hint}</span>}
      </span>
      <input
        type="text"
        inputMode="decimal"
        pattern="[0-9.]*"
        value={value}
        onChange={handle}
        placeholder={placeholder}
        style={{
          padding: '10px 12px', fontSize: 14, fontFamily: 'var(--font-mono)',
          border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
          background: 'var(--bg-primary)', color: 'var(--text-primary)',
          outline: 'none', boxSizing: 'border-box',
        }}
      />
    </label>
  );
}

function CountDaysRow({ label, countField, daysField, rate, form, setForm, subLabel }) {
  const count = n(form[countField]);
  const days  = n(form[daysField]);
  const line  = count * days * rate;

  // When user increments count from 0 to 1+ and days is still empty, default
  // days to 3 (typical OOP mitigation drying cycle). Tech can still override.
  const onCountChange = (v) => {
    if (!isInt(v)) return;
    setForm(f => ({
      ...f,
      [countField]: v,
      ...(n(v) > 0 && !f[daysField] ? { [daysField]: '3' } : {}),
    }));
  };
  const onDaysChange = (v) => {
    if (isInt(v)) setForm(f => ({ ...f, [daysField]: v }));
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 90px', gap: 8, alignItems: 'end' }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
          ${rate}/day{subLabel ? ` · ${subLabel}` : ''}
        </div>
      </div>
      <input
        type="text" inputMode="numeric" pattern="[0-9]*"
        value={form[countField]} placeholder="0"
        onChange={e => onCountChange(e.target.value)}
        style={inlineNumInput}
      />
      <input
        type="text" inputMode="numeric" pattern="[0-9]*"
        value={form[daysField]} placeholder="days"
        onChange={e => onDaysChange(e.target.value)}
        style={inlineNumInput}
      />
      <div style={{ textAlign: 'right', fontSize: 13, fontWeight: 600, color: line > 0 ? 'var(--text-primary)' : 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
        {line > 0 ? fmt$(line) : '—'}
      </div>
    </div>
  );
}

const inlineNumInput = {
  padding: '8px 10px', fontSize: 13, fontFamily: 'var(--font-mono)',
  border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
  background: 'var(--bg-primary)', color: 'var(--text-primary)',
  outline: 'none', boxSizing: 'border-box', textAlign: 'center',
};

function PillToggle({ value, onChange, options }) {
  return (
    <div style={{ display: 'inline-flex', gap: 4, padding: 4, background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
      {options.map(o => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          style={{
            padding: '8px 16px', fontSize: 13, fontWeight: 600,
            background: value === o.value ? 'var(--bg-primary)' : 'transparent',
            color: value === o.value ? 'var(--text-primary)' : 'var(--text-secondary)',
            border: 'none', borderRadius: 'var(--radius-sm)',
            cursor: 'pointer', fontFamily: 'var(--font-sans)',
            boxShadow: value === o.value ? 'var(--shadow-sm)' : 'none',
          }}
        >{o.label}</button>
      ))}
    </div>
  );
}

/* ═══ BREAKDOWN (customer-facing) ═══ */
function BreakdownPanel({ calc, isMold, form, quote, linkedJob }) {
  const { lines } = calc;
  return (
    <div style={{
      border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)',
      background: 'var(--bg-primary)', padding: 'var(--space-4)',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', marginBottom: 4 }}>
        Customer Quote
      </div>

      {/* Print-only header */}
      <div className="oop-print-only" style={{ display: 'none', marginBottom: 8 }}>
        {quote?.quote_number && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-secondary)' }}>{quote.quote_number}</div>}
        {form.insuredName && <div style={{ fontSize: 16, fontWeight: 600 }}>{form.insuredName}</div>}
        {form.address && <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{form.address}</div>}
        {linkedJob?.job_number && <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Job {linkedJob.job_number}</div>}
      </div>

      <QuoteRow label={`Labor (${form.techHours || 0}h × $${form.billRate || 92}/hr)`} value={lines.laborLine} />
      <QuoteRow label="Equipment" value={lines.equipment} />
      <QuoteRow label={`Materials (${form.materialsActualCost || 0} × 1.25)`} value={lines.materialsLine} />
      <QuoteRow label="Antimicrobial treatment" value={lines.antimicrobialLine} />
      <QuoteRow label="Disposal fees" value={lines.disposalLine} />
      {isMold && <QuoteRow label="Containment" value={lines.containmentLine} />}
      {isMold && <QuoteRow label="PPE / consumables" value={lines.ppeLine} />}

      <div style={{ borderTop: '2px solid var(--border-color)', marginTop: 8, paddingTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-primary)' }}>Quote Total</span>
        <span style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{fmt$(calc.quote)}</span>
      </div>

      {form.notes && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-light)', fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-tertiary)', marginBottom: 4 }}>Notes</div>
          {form.notes}
        </div>
      )}
    </div>
  );
}

function QuoteRow({ label, value }) {
  const zero = value == null || value === 0;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '4px 0' }}>
      <span style={{ fontSize: 13, color: zero ? 'var(--text-tertiary)' : 'var(--text-primary)' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 500, color: zero ? 'var(--text-tertiary)' : 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
        {zero ? '—' : fmt$(value)}
      </span>
    </div>
  );
}

/* ═══ INTERNAL MARGIN (hidden from print) ═══ */
function InternalPanel({ calc, marginTier, tierColors }) {
  const [open, setOpen] = useState(true);
  const { internal } = calc;
  const pct = internal.netMarginPct;

  return (
    <div className="oop-no-print" style={{
      border: `1px solid ${tierColors.border}`,
      borderRadius: 'var(--radius-lg)',
      background: 'var(--bg-primary)',
      padding: 'var(--space-4)',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)' }}>Internal — Margin</div>
          <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>Not included in customer print</div>
        </div>
        <div style={{
          fontSize: 15, fontWeight: 800, padding: '5px 12px',
          borderRadius: 'var(--radius-full)',
          background: tierColors.bg, color: tierColors.fg,
          border: `1px solid ${tierColors.border}`,
          fontFamily: 'var(--font-mono)',
        }}>
          {pct == null ? '—' : `${pct.toFixed(1)}%`}
        </div>
      </div>

      {marginTier === 'amber' && (
        <div style={{ fontSize: 12, color: '#92400e', padding: '8px 10px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 'var(--radius-md)' }}>
          ⚠ Margin below target (20%). Consider increasing scope or reducing cost.
        </div>
      )}
      {marginTier === 'red' && (
        <div style={{ fontSize: 12, color: '#991b1b', padding: '8px 10px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 'var(--radius-md)', fontWeight: 500 }}>
          ⚠ Margin below 10%. Recommend decline or reprice.
        </div>
      )}

      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
          <IntRow label="Direct labor (@ $51/hr)" value={internal.directLaborCost} />
          <IntRow label="Materials (cost)" value={internal.materialsCost} />
          <IntRow label="Antimicrobial (cost)" value={internal.antimicrobialCost} />
          <IntRow label="Disposal (cost)" value={internal.disposalCost} />
          {internal.containmentCost > 0 && <IntRow label="Containment (cost)" value={internal.containmentCost} />}
          {internal.ppeCost > 0 && <IntRow label="PPE (cost)" value={internal.ppeCost} />}
          {internal.prvCost > 0 && <IntRow label="PRV (pass-through)" value={internal.prvCost} />}
          <div style={{ borderTop: '1px solid var(--border-light)', marginTop: 6, paddingTop: 6 }}>
            <IntRow label="Total direct cost" value={internal.totalDirectCost} strong />
            <IntRow label="Overhead (33%)" value={internal.overheadAlloc} />
            <IntRow label="Net profit" value={internal.netProfit} strong color={internal.netProfit >= 0 ? '#059669' : '#dc2626'} />
          </div>
        </div>
      )}
    </div>
  );
}

function IntRow({ label, value, strong, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: strong ? 600 : 400 }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: strong ? 700 : 500, color: color || 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
        {fmt$(value)}
      </span>
    </div>
  );
}
