/**
 * ════════════════════════════════════════════════
 * FILE: ConfiguredOopPricingCalculator.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Shows desktop and mobile-shell out-of-pocket calculators from one published price list.
 *   It keeps every saved quote tied to the exact prices used when it was created.
 *
 * WHERE IT LIVES:
 *   Route:        /tools/oop-pricing and /tech/tools/oop-pricing
 *   Rendered by:  OOPPricingConfigured.jsx and TechOOPPricingConfigured.jsx
 *
 * DEPENDS ON:
 *   Packages:  React, react-router-dom
 *   Internal:  AuthContext, ClaimPicker, pricing engine/config, shared UI states,
 *              nativeHaptics, native keyboard inset
 *   Data:      reads  → get_oop_pricing_config, get_oop_quote_v2, legacy get_oop_quote,
 *                        jobs, claims, and get_claim_jobs
 *              writes → upsert_oop_quote_v2, legacy upsert_oop_quote,
 *                        convert_oop_quote_to_estimate, delete_oop_quote
 *
 * NOTES / GOTCHAS:
 *   - Missing v2 RPCs alone enable the frozen legacy fallback. Permission,
 *     validation, and network failures fail closed.
 *   - The request id is reused after an uncertain save outcome for idempotency.
 *   - Resume refreshes are silent and never replace unsaved local changes.
 * ════════════════════════════════════════════════
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './oop-pricing.css';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import ClaimPicker from '@/components/ClaimPicker';
import PullToRefresh from '@/components/PullToRefresh';
import TabLoading from '@/components/TabLoading';
import { ErrorState, IconButton, PageHeader, StatusPill } from '@/components/ui';
import { SkeletonList } from '@/components/tech/v2/skeletons';
import { jobHref } from '@/components/tech/v2/nav';
import { useAuth } from '@/contexts/AuthContext';
import { useResumeRefetch } from '@/hooks/useResumeRefetch';
import { useTwoClickConfirm } from '@/hooks/useTwoClickConfirm';
import useUnsavedNavigationGuard from '@/hooks/useUnsavedNavigationGuard';
import { canEditBilling } from '@/lib/claimUtils';
import {
  BLANK,
  calcPricingQuote,
  calcQuote,
  divisionToJobType,
  legacyFormFromInputs,
  paramsForPricingQuoteV2,
  paramsForUpsert,
  tierFor,
  toNum,
} from '@/lib/oopPricing';
import {
  LEGACY_PRICING_CONFIG,
  isPricingConfigRpcUnavailable,
} from '@/lib/oopPricingConfig';
import {
  defaultPricingInputs,
  normalizePricingEnvelope,
  pricingSaveFingerprint,
  quotePricingState,
} from '@/lib/oopPricingRuntime';
import { impact, notify, selection } from '@/lib/nativeHaptics';
import useNativeKeyboardInset from '@/lib/useNativeKeyboardInset';
// ─── SECTION: Helpers ──────────────
import { err, ok } from '@/lib/toast';

const JOB_FIELDS = 'id,job_number,insured_name,address,division,city,state';
const emptyMeta = () => ({ jobType: 'water', insuredName: '', address: '', notes: '' });
const unwrap = (value) => Array.isArray(value) ? value[0] : value;
const money = (value) => Number(value || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const numericText = (value) => value === '' || /^\d*\.?\d*$/.test(value);
const pagePath = (tech) => tech ? '/tech/tools/oop-pricing' : '/tools/oop-pricing';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IS_NATIVE_BUILD = import.meta.env.VITE_BUILD_TARGET === 'native';

function requestId() {
  if (!globalThis.crypto?.randomUUID) throw new Error('Secure request identifiers are unavailable in this browser.');
  return globalThis.crypto.randomUUID();
}

function metaFromQuote(row) {
  return {
    jobType: row?.job_type === 'mold' ? 'mold' : 'water',
    insuredName: row?.insured_name || '',
    address: row?.address || '',
    notes: row?.notes || '',
  };
}

function quoteIdentity(row) {
  return row ? {
    ...row,
    id: row.id,
    quote_number: row.quote_number,
    updated_at: row.updated_at || null,
  } : null;
}

function snapshot(meta, inputs, quote, linkedJobId = null) {
  return JSON.stringify({
    meta,
    inputs,
    linkedJobId: linkedJobId || null,
    quoteId: quote?.id || null,
    updatedAt: quote?.updated_at || null,
  });
}

async function loadJob(db, id) {
  if (!id) return null;
  if (!UUID.test(id)) throw new Error('Invalid job link.');
  const jobs = await db.select('jobs', `id=eq.${id}&select=${JOB_FIELDS}`);
  return jobs?.[0] || null;
}

async function loadQuote(db, id) {
  try {
    return unwrap(await db.rpc('get_oop_quote_v2', { p_id: id }));
  } catch (error) {
    if (!isPricingConfigRpcUnavailable(error)) throw error;
    return unwrap(await db.rpc('get_oop_quote', { p_id: id }));
  }
}

function hintForItem(item) {
  const parts = [];
  if (item.formula === 'percentage') parts.push(`${(item.standardRate * 100).toFixed(2).replace(/\.?0+$/, '')}%`);
  else if (item.formula === 'cost_plus') parts.push(`${item.standardRate}× input`);
  else parts.push(`${money(item.standardRate)}${item.unit ? ` / ${item.unit}` : ''}`);
  if (item.minimumQuantity > 0) parts.push(`minimum ${item.minimumQuantity} ${item.unit || 'units'}`);
  if (item.minimumCharge > 0) parts.push(`${money(item.minimumCharge)} line minimum`);
  return parts.join(' · ');
}

function Section({ title, hint, children, tech }) {
  return (
    <section className={`card oop-section${tech ? ' oop-section--tech' : ''}`} style={{
      padding: tech ? 'var(--space-3)' : 'var(--space-4)',
      border: '1px solid var(--border-color)',
      borderRadius: tech ? 'var(--tech-radius-card)' : 'var(--radius-lg)',
      background: 'var(--bg-primary)',
      boxShadow: tech ? 'var(--tech-shadow-card)' : 'none',
      display: 'grid',
      gap: 'var(--space-3)',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
        <strong style={{ color: 'var(--text-primary)', fontSize: tech ? 'var(--tech-text-label)' : 'var(--text-sm)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</strong>
        {hint && <span style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)', textAlign: 'right' }}>{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function TextInput({ label, value, onChange, placeholder, tech, multiline = false }) {
  const style = {
    width: '100%',
    minHeight: tech ? 'var(--tech-min-tap)' : 'var(--oop-control-height, 40px)',
    padding: multiline ? 'var(--space-2) var(--space-3)' : '0 var(--space-3)',
    border: '1px solid var(--border-color)',
    borderRadius: tech ? 'var(--tech-radius-button)' : 'var(--radius-md)',
    background: 'var(--bg-primary)',
    color: 'var(--text-primary)',
    font: 'inherit',
    fontSize: tech ? 'var(--text-lg)' : 'var(--text-base)',
    boxSizing: 'border-box',
    resize: multiline ? 'vertical' : undefined,
  };
  return (
    <label style={{ display: 'grid', gap: 'var(--space-1)', color: 'var(--text-secondary)', fontSize: 'var(--text-xs)', fontWeight: 600 }}>
      {label}
      {multiline
        ? <textarea className={`input oop-input${tech ? ' oop-input--tech' : ''}`} rows={3} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} style={style} />
        : <input className={`input oop-input${tech ? ' oop-input--tech' : ''}`} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} style={style} />}
    </label>
  );
}

function JobSelect({ jobs, value, onChange, loading, error, onRetry, tech }) {
  const placeholder = loading
    ? 'Loading jobs…'
    : jobs.length > 1 ? 'Choose a job…'
      : jobs.length === 1 ? 'Choose this job…' : 'No jobs available';
  return (
    <div className="oop-job-choice">
      <label style={{ display: 'grid', gap: 'var(--space-1)', color: 'var(--text-secondary)', fontSize: 'var(--text-xs)', fontWeight: 600 }}>
        Job for this quote and estimate
        <select
          className={`input oop-input oop-job-select${tech ? ' oop-input--tech' : ''}`}
          value={value || ''}
          disabled={loading || Boolean(error) || jobs.length === 0}
          onChange={(event) => onChange(event.target.value)}
          style={{
            width: '100%',
            minHeight: tech ? 'var(--tech-min-tap)' : 'var(--oop-control-height, 40px)',
            padding: '0 var(--space-3)',
            border: '1px solid var(--border-color)',
            borderRadius: tech ? 'var(--tech-radius-button)' : 'var(--radius-md)',
            background: 'var(--bg-primary)',
            color: 'var(--text-primary)',
            font: 'inherit',
            fontSize: tech ? 'var(--text-lg)' : 'var(--text-base)',
            boxSizing: 'border-box',
          }}
        >
          <option value="">{placeholder}</option>
          {jobs.map((job) => (
            <option key={job.id} value={job.id}>
              {[job.job_number || 'Job', job.division, job.address].filter(Boolean).join(' · ')}
            </option>
          ))}
        </select>
      </label>
      {error && <div className="oop-job-choice__error" role="alert">
        <span>Jobs for this claim could not be loaded.</span>
        <button type="button" className={`btn btn-secondary btn-sm${tech ? ' oop-tech-action' : ''}`} onClick={onRetry}>Retry</button>
      </div>}
      {!loading && !error && jobs.length > 1 && !value && <div className="oop-job-choice__hint" role="status">Choose the job that should receive the quote and estimate.</div>}
      {!loading && !error && jobs.length === 0 && <div className="oop-job-choice__hint" role="status">This claim has no jobs. Choose a different claim, or unlink it to save a quote without a job.</div>}
    </div>
  );
}

function NumberInput({ label, value, onChange, hint, tech, ariaLabel }) {
  return (
    <label style={{ display: 'grid', gap: 'var(--space-1)', minWidth: 0 }}>
      <span style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)', color: 'var(--text-secondary)', fontSize: 'var(--text-xs)', fontWeight: 600 }}>
        <span>{label}</span>{hint && <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>{hint}</span>}
      </span>
      <input
        className={`input oop-input oop-number-input${tech ? ' oop-input--tech' : ''}`}
        aria-label={ariaLabel || label}
        type="text"
        inputMode="decimal"
        pattern="[0-9.]*"
        value={value ?? ''}
        onChange={(event) => { if (numericText(event.target.value)) onChange(event.target.value); }}
        style={{
          width: '100%',
          minHeight: tech ? 'var(--tech-min-tap)' : 'var(--oop-control-height, 40px)',
          padding: '0 var(--space-3)',
          border: '1px solid var(--border-color)',
          borderRadius: tech ? 'var(--tech-radius-button)' : 'var(--radius-md)',
          background: 'var(--bg-primary)',
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-mono)',
          fontSize: tech ? 'var(--text-lg)' : 'var(--text-base)',
          boxSizing: 'border-box',
        }}
      />
    </label>
  );
}

function Stepper({ item, value, onChange, tech, label = `Quantity (${item.unit || 'units'})`, ariaLabel = item.label }) {
  const count = toNum(value);
  const button = (disabled) => ({
    width: '100%', height: '100%', minWidth: 0, borderRadius: 0,
    border: 0, background: 'transparent',
    color: disabled ? 'var(--text-tertiary)' : 'var(--text-primary)',
    fontSize: tech ? 'var(--tech-text-heading)' : 'var(--text-xl)', cursor: disabled ? 'not-allowed' : 'pointer',
  });
  return (
    <div style={{ display: 'grid', gap: 'var(--space-1)' }}>
      <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-xs)', fontWeight: 600 }}>{label}</span>
      <div className="oop-stepper" style={{ display: 'grid', gridTemplateColumns: `${tech ? 'var(--tech-min-tap)' : 'var(--oop-control-height)'} 1fr ${tech ? 'var(--tech-min-tap)' : 'var(--oop-control-height)'}`, alignItems: 'center', border: '1px solid var(--border-color)', borderRadius: tech ? 'var(--tech-radius-button)' : 'var(--radius-md)', overflow: 'hidden', background: 'var(--bg-tertiary)' }}>
        <IconButton label={`Decrease ${ariaLabel}`} size="lg" disabled={count <= 0} style={button(count <= 0)} onClick={() => onChange(String(Math.max(0, count - 1)))}>−</IconButton>
        <input
          className="oop-stepper-value"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          aria-label={`${ariaLabel} value`}
          value={value === '' || value == null ? '' : String(value)}
          onChange={(event) => {
            if (/^\d*$/.test(event.target.value)) onChange(event.target.value);
          }}
          onBlur={() => onChange(String(count))}
        />
        <IconButton label={`Increase ${ariaLabel}`} size="lg" style={button(false)} onClick={() => onChange(String(count + 1))}>+</IconButton>
      </div>
    </div>
  );
}

function PricingInput({ item, input, line, onInput, tech }) {
  if (item.formula === 'percentage') {
    const base = item.percentageBase === 'prior_subtotal' ? 'the prior subtotal'
      : item.percentageBase === 'final_total' ? 'the final total'
        : item.percentageBase?.startsWith('item:') ? item.percentageBase.slice(5).replaceAll('_', ' ') : 'its configured base';
    return (
      <div style={{ padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)', background: 'var(--bg-secondary)', color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
        Calculated automatically as {(item.standardRate * 100).toFixed(2).replace(/\.?0+$/, '')}% of {base}.
      </div>
    );
  }
  if (item.formula === 'fixed') {
    return (
      <button type="button" className={`${toNum(input.quantity) > 0 ? 'btn btn-primary' : 'btn btn-secondary'}${tech ? ' oop-tech-action' : ''}`} onClick={() => { if (tech) impact('light'); onInput('quantity', toNum(input.quantity) > 0 ? '' : '1'); }}>
        {toNum(input.quantity) > 0 ? 'Included' : 'Add to quote'}
      </button>
    );
  }
  const quantityLabel = ['cost_plus', 'pass_through'].includes(item.formula) ? `Input cost (${item.unit || 'cost'})` : `Quantity (${item.unit || 'units'})`;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: item.formula === 'duration' ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)', gap: 'var(--space-3)' }}>
      {tech && item.formula === 'duration'
        ? <Stepper tech={tech} item={item} value={input.quantity} onChange={(value) => onInput('quantity', value)} />
        : <NumberInput tech={tech} label={quantityLabel} value={input.quantity} onChange={(value) => onInput('quantity', value)} ariaLabel={`${item.label} quantity`} />}
      {item.formula === 'duration' && (tech
        ? <Stepper tech={tech} item={item} label="Days" ariaLabel={`${item.label} days`} value={input.days} onChange={(value) => onInput('days', value)} />
        : <NumberInput tech={tech} label="Days" value={input.days} onChange={(value) => onInput('days', value)} ariaLabel={`${item.label} days`} />)}
      {item.priceOverrideAllowed && <NumberInput tech={tech} label={item.formula === 'cost_plus' ? 'Markup multiplier' : `Price per ${item.unit || 'unit'}`} value={input.rateOverride} onChange={(value) => onInput('rateOverride', value)} ariaLabel={`${item.label} price override`} />}
      {(line?.customer > 0 || (!item.customerVisible && line?.internal > 0)) && <div style={{ alignSelf: 'end', textAlign: 'right', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{item.customerVisible ? money(line.customer) : `Internal ${money(line.internal)}`}</div>}
    </div>
  );
}

function PricingItem({ item, input, line, onInput, tech }) {
  return (
    <div style={{ display: 'grid', gap: 'var(--space-2)', paddingTop: 'var(--space-2)', borderTop: '1px dashed var(--border-light)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
        <div>
          <div style={{ color: 'var(--text-primary)', fontSize: 'var(--text-sm)', fontWeight: 700 }}>{item.label}</div>
          <div style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}>{item.helpText || hintForItem(item)}</div>
        </div>
        {!item.customerVisible && <StatusPill tone="neutral" label="Internal only" />}
      </div>
      <PricingInput item={item} input={input} line={line} onInput={onInput} tech={tech} />
    </div>
  );
}

function BreakdownRow({ label, value, strong = false }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', padding: 'var(--space-1) 0', color: strong ? 'var(--text-primary)' : 'var(--text-secondary)', fontSize: strong ? 'var(--text-base)' : 'var(--text-sm)', fontWeight: strong ? 700 : 400 }}>
      <span>{label}</span><span style={{ fontFamily: 'var(--font-mono)', fontWeight: strong ? 800 : 600 }}>{money(value)}</span>
    </div>
  );
}

function TechLiveTotal({ calculation }) {
  return (
    <div className="oop-tech-header-total">
      <div>
        <div className="oop-tech-header-total__label">Live total</div>
        <div className="oop-tech-header-total__value">{money(calculation.quote)}</div>
      </div>
      <span className="oop-tech-header-total__hint">Updates live</span>
    </div>
  );
}

function Breakdown({ calculation, pricing, quote, meta, linkedJob, tech }) {
  const { itemLines, quote: total, projectMinimumAdjustment, internal } = calculation;
  const customerLines = itemLines.filter((line) => line.customerVisible && line.customer > 0);
  const internalLines = itemLines.filter((line) => line.internal > 0);
  const tier = tierFor(internal.netMarginPct);
  return (
    <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
      <section className={`card oop-section${tech ? ' oop-section--tech' : ''}`} style={{ padding: tech ? 'var(--space-4)' : 'var(--space-5)', border: '1px solid var(--border-color)', borderRadius: tech ? 'var(--tech-radius-card)' : 'var(--radius-xl)', background: 'var(--bg-primary)', boxShadow: tech ? 'var(--tech-shadow-card)' : 'var(--shadow-md)' }}>
        <div style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Customer quote</div>
        <div style={{ margin: 'var(--space-2) 0 var(--space-4)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: tech ? 'var(--tech-text-hero)' : 'var(--text-2xl)', fontWeight: 800 }}>{money(total)}</div>
        {customerLines.map((line) => <BreakdownRow key={line.key} label={line.label} value={line.customer} />)}
        {projectMinimumAdjustment > 0 && <BreakdownRow label="Project minimum adjustment" value={projectMinimumAdjustment} />}
        <div style={{ borderTop: '1px solid var(--border-color)', marginTop: 'var(--space-2)', paddingTop: 'var(--space-2)' }}><BreakdownRow label="Total" value={total} strong /></div>
        {(quote?.quote_number || pricing.revisionNumber || pricing.id) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
            {quote?.quote_number && <StatusPill tone="info" label={quote.quote_number} />}
            <StatusPill tone="neutral" label={pricing.source === 'legacy_fallback' ? 'Legacy compatibility pricing' : `Pricing revision ${pricing.revisionNumber || pricing.id || 'saved'}`} />
          </div>
        )}
        <div className="oop-print-only" style={{ marginTop: 'var(--space-4)', color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
          <div>{meta.insuredName}</div><div>{meta.address}</div>
          {linkedJob && <div>Job {linkedJob.job_number}</div>}
        </div>
      </section>
      {tech ? (
        <details className="oop-internal-details oop-no-print">
          <summary>Internal economics <StatusPill tone={tier === 'green' ? 'success' : tier === 'amber' ? 'warning' : tier === 'red' ? 'danger' : 'neutral'} label={internal.netMarginPct == null ? 'No revenue' : `${internal.netMarginPct.toFixed(1)}%`} /></summary>
          <div className="oop-internal-details__body">
            {internalLines.map((line) => <BreakdownRow key={line.key} label={line.label} value={line.internal} />)}
            <div style={{ borderTop: '1px solid var(--border-color)', marginTop: 'var(--space-2)', paddingTop: 'var(--space-2)' }}>
              <BreakdownRow label="Total internal cost" value={internal.totalDirectCost} strong />
              <BreakdownRow label="Net profit" value={internal.netProfit} strong />
            </div>
            {tier === 'red' && <div role="status" style={{ marginTop: 'var(--space-3)', padding: 'var(--space-2)', border: '1px solid var(--danger-border)', borderRadius: 'var(--radius-md)', background: 'var(--danger-bg)', color: 'var(--danger)', fontSize: 'var(--text-xs)' }}>Margin is below 10%. Reprice or decline before presenting this quote.</div>}
            {tier === 'amber' && <div role="status" style={{ marginTop: 'var(--space-3)', padding: 'var(--space-2)', border: '1px solid var(--warning-border)', borderRadius: 'var(--radius-md)', background: 'var(--warning-bg)', color: 'var(--warning)', fontSize: 'var(--text-xs)' }}>Margin is below the 20% target.</div>}
          </div>
        </details>
      ) : (
        <section className="oop-no-print" style={{ padding: 'var(--space-4)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-secondary)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
          <strong style={{ fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)' }}>Internal margin</strong>
          <StatusPill tone={tier === 'green' ? 'success' : tier === 'amber' ? 'warning' : tier === 'red' ? 'danger' : 'neutral'} label={internal.netMarginPct == null ? 'No revenue' : `${internal.netMarginPct.toFixed(1)}%`} />
        </div>
        {internalLines.map((line) => <BreakdownRow key={line.key} label={line.label} value={line.internal} />)}
        <div style={{ borderTop: '1px solid var(--border-color)', marginTop: 'var(--space-2)', paddingTop: 'var(--space-2)' }}>
          <BreakdownRow label="Total internal cost" value={internal.totalDirectCost} strong />
          <BreakdownRow label="Net profit" value={internal.netProfit} strong />
        </div>
        {tier === 'red' && <div role="status" style={{ marginTop: 'var(--space-3)', padding: 'var(--space-2)', border: '1px solid var(--danger-border)', borderRadius: 'var(--radius-md)', background: 'var(--danger-bg)', color: 'var(--danger)', fontSize: 'var(--text-xs)' }}>Margin is below 10%. Reprice or decline before presenting this quote.</div>}
        {tier === 'amber' && <div role="status" style={{ marginTop: 'var(--space-3)', padding: 'var(--space-2)', border: '1px solid var(--warning-border)', borderRadius: 'var(--radius-md)', background: 'var(--warning-bg)', color: 'var(--warning)', fontSize: 'var(--text-xs)' }}>Margin is below the 20% target.</div>}
        </section>
      )}
    </div>
  );
}

// ─── SECTION: State & hooks ──────────────
export default function ConfiguredOopPricingCalculator({ variant = 'desktop' }) {
  const tech = variant === 'tech';
  // Native-only keyboard observation. The hook returns 0 and attaches nothing
  // on web, while Capacitor can reveal focused fields in this long form.
  const kbInset = useNativeKeyboardInset();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const { db, employee, isFeatureEnabled } = useAuth();
  const jobId = search.get('jobId') || null;
  const quoteId = search.get('quoteId') || null;
  const basePath = pagePath(tech);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [converting, setConverting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [meta, setMeta] = useState(emptyMeta);
  const [inputs, setInputs] = useState({});
  const [pricing, setPricing] = useState(null);
  const [quote, setQuote] = useState(null);
  const [linkedJob, setLinkedJob] = useState(null);
  const [linkedClaim, setLinkedClaim] = useState(null);
  const [claimJobs, setClaimJobs] = useState([]);
  const [claimJobsLoading, setClaimJobsLoading] = useState(false);
  const [claimJobsError, setClaimJobsError] = useState('');
  const baselineRef = useRef('');
  const saveRequestRef = useRef(null);
  const skipLocationLoadRef = useRef(null);
  const mountedRef = useRef(false);
  const refreshRequestRef = useRef(0);
  const loadRequestRef = useRef(0);
  const claimLoadRequestRef = useRef(0);
  const conversionRequestRef = useRef(0);
  const locationRef = useRef('');
  const liveSnapshotRef = useRef('');
  const refreshContextRef = useRef({ quoteId: null, locationKey: '' });
  const { isArmed, arm, cancel } = useTwoClickConfirm();
  const locationKey = `${quoteId || ''}|${jobId || ''}`;
  const estimateRouteAvailable = IS_NATIVE_BUILD
    ? employee?.role === 'admin'
    : isFeatureEnabled('page:estimates');
  const canConvertToEstimate = estimateRouteAvailable && canEditBilling(employee?.role);
  const convertedEstimateId = quote?.converted_estimate_id || null;
  const jobSelectionRequired = Boolean(linkedClaim && !linkedJob);
  const estimateHref = (estimateId) => IS_NATIVE_BUILD
    ? `${basePath}/estimate/${estimateId}`
    : `/estimates/${estimateId}`;

  const invalidateRefresh = useCallback(() => {
    refreshRequestRef.current += 1;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      conversionRequestRef.current += 1;
      invalidateRefresh();
    };
  }, [invalidateRefresh]);

  useEffect(() => {
    if (locationRef.current !== locationKey) {
      conversionRequestRef.current += 1;
      setConverting(false);
    }
    locationRef.current = locationKey;
    refreshContextRef.current = { quoteId: quote?.id || null, locationKey };
    invalidateRefresh();
  }, [invalidateRefresh, locationKey, quote?.id]);

  // ─── SECTION: Data fetching ──────────────
  const loadCurrentPricing = useCallback(async () => {
    try {
      return normalizePricingEnvelope(await db.rpc('get_oop_pricing_config', { p_revision_id: null }));
    } catch (error) {
      if (!isPricingConfigRpcUnavailable(error)) throw error;
      return { id: null, revisionNumber: 1, config: LEGACY_PRICING_CONFIG, source: 'legacy_fallback' };
    }
  }, [db]);

  const hydrateQuote = useCallback(async (row, job = null) => {
    const nextPricing = quotePricingState(row);
    const nextMeta = metaFromQuote(row);
    const nextQuote = quoteIdentity(row);
    setPricing(nextPricing);
    setInputs(nextPricing.inputs);
    setMeta(nextMeta);
    setQuote(nextQuote);
    setLinkedJob(job);
    baselineRef.current = snapshot(nextMeta, nextPricing.inputs, nextQuote, job?.id);
  }, []);

  const load = useCallback(async () => {
    const requestedLocationKey = locationKey;
    const requestVersion = loadRequestRef.current + 1;
    loadRequestRef.current = requestVersion;
    setRefreshing(true);
    const current = () => mountedRef.current
      && loadRequestRef.current === requestVersion
      && locationRef.current === requestedLocationKey;
    try {
      if (quoteId) {
        const row = await loadQuote(db, quoteId);
        if (!current()) return;
        if (!row) {
          err('Quote not found.');
          navigate(basePath, { replace: true });
          return;
        }
        const job = await loadJob(db, row.job_id);
        if (!current()) return;
        await hydrateQuote(row, job);
      } else {
        const [nextPricing, job] = await Promise.all([loadCurrentPricing(), loadJob(db, jobId)]);
        if (!current()) return;
        const nextMeta = {
          ...emptyMeta(),
          ...(job ? {
            jobType: divisionToJobType(job.division),
            insuredName: job.insured_name || '',
            address: [job.address, job.city, job.state].filter(Boolean).join(', '),
          } : {}),
        };
        const nextInputs = defaultPricingInputs(nextPricing.config);
        setPricing(nextPricing);
        setInputs(nextInputs);
        setMeta(nextMeta);
        setQuote(null);
        setLinkedJob(job);
        baselineRef.current = snapshot(nextMeta, nextInputs, null, job?.id);
      }
      if (current()) setLoadError('');
    } catch (error) {
      if (current()) setLoadError(error?.message || 'The calculator could not be loaded.');
    } finally {
      if (current()) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [basePath, db, hydrateQuote, jobId, loadCurrentPricing, locationKey, navigate, quoteId]);
  useEffect(() => {
    if (skipLocationLoadRef.current === locationKey) {
      skipLocationLoadRef.current = null;
      return;
    }
    load();
  }, [load, locationKey]);

  const currentSnapshot = useMemo(
    () => snapshot(meta, inputs, quote, linkedJob?.id),
    [inputs, linkedJob?.id, meta, quote],
  );
  const dirty = baselineRef.current !== '' && currentSnapshot !== baselineRef.current;

  useEffect(() => {
    liveSnapshotRef.current = currentSnapshot;
  }, [currentSnapshot]);
  const {
    pendingNavigation,
    stay: stayOnCalculator,
    confirmNavigation: confirmGuardedNavigation,
    leaveBack,
  } = useUnsavedNavigationGuard({ dirty, navigate });

  const refreshSaved = useCallback(async () => {
    if (!quote?.id || dirty) return;
    const requestedQuoteId = quote.id;
    const requestedLocationKey = locationKey;
    const requestVersion = refreshRequestRef.current + 1;
    const requestedBaseline = baselineRef.current;
    const requestedSnapshot = liveSnapshotRef.current;
    refreshRequestRef.current = requestVersion;
    try {
      const row = await loadQuote(db, requestedQuoteId);
      if (!row) return;
      const job = await loadJob(db, row.job_id);
      const currentContext = refreshContextRef.current;
      if (
        !mountedRef.current
        || refreshRequestRef.current !== requestVersion
        || currentContext.quoteId !== requestedQuoteId
        || currentContext.locationKey !== requestedLocationKey
        || baselineRef.current !== requestedBaseline
        || liveSnapshotRef.current !== requestedSnapshot
        || liveSnapshotRef.current !== baselineRef.current
      ) return;
      await hydrateQuote(row, job);
    } catch {
      // Silent by design: resume/pull refresh keeps the last good quote visible.
    }
  }, [db, dirty, hydrateQuote, locationKey, quote?.id]);

  useResumeRefetch({ onResume: refreshSaved, enabled: Boolean(quote?.id) });

  const calculationState = useMemo(() => {
    if (!pricing) return { value: null, error: null };
    try {
      return { value: calcPricingQuote({ config: pricing.config, jobType: meta.jobType, inputs, configRevisionId: pricing.id, configRevision: pricing.revisionNumber }), error: null };
    } catch (error) {
      return { value: null, error: error?.message || 'The quote inputs are invalid.' };
    }
  }, [inputs, meta.jobType, pricing]);
  const calculation = calculationState.value;

  const visibleItems = useMemo(() => pricing?.config.items
    .filter((item) => item.active && item.jobTypes.includes(meta.jobType))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key)) || [], [meta.jobType, pricing]);
  const sections = useMemo(() => {
    const grouped = new Map();
    visibleItems.forEach((item) => {
      if (!grouped.has(item.section)) grouped.set(item.section, []);
      grouped.get(item.section).push(item);
    });
    return [...grouped.entries()];
  }, [visibleItems]);
  const lines = useMemo(() => new Map((calculation?.itemLines || []).map((line) => [line.key, line])), [calculation]);

  // ─── SECTION: Event handlers ──────────────
  const setMetaField = (key) => (value) => setMeta((current) => ({ ...current, [key]: value }));
  const handleJobTypeChange = (value) => {
    if (value === meta.jobType) return;
    if (tech) selection();
    setMetaField('jobType')(value);
  };
  const setItemInput = (item, field, value) => setInputs((current) => {
    const next = { ...(current[item.key] || {}), [field]: value };
    if (field === 'quantity' && item.formula === 'duration' && toNum(value) > 0 && toNum(next.days) <= 0) {
      next.days = String(item.defaultDays || 3);
    }
    return { ...current, [item.key]: next };
  });

  const handleInsuredChange = (value) => {
    claimLoadRequestRef.current += 1;
    setMetaField('insuredName')(value);
    setLinkedClaim(null);
    setLinkedJob(null);
    setClaimJobs([]);
    setClaimJobsLoading(false);
    setClaimJobsError('');
  };

  const handleClaimSelect = async (claim) => {
    if (tech) selection();
    const requestVersion = claimLoadRequestRef.current + 1;
    claimLoadRequestRef.current = requestVersion;
    setLinkedClaim(claim);
    setLinkedJob(null);
    setClaimJobs([]);
    setClaimJobsLoading(true);
    setClaimJobsError('');
    setMeta((current) => ({
      ...current,
      insuredName: claim.insured_name || '',
      address: [claim.loss_address, claim.loss_city, claim.loss_state].filter(Boolean).join(', ') || current.address,
    }));
    try {
      const result = await db.rpc('get_claim_jobs', { p_claim_id: claim.id });
      if (!mountedRef.current || claimLoadRequestRef.current !== requestVersion) return;
      const jobs = Array.isArray(result?.jobs) ? result.jobs : [];
      setClaimJobs(jobs);
      setLinkedJob(jobs.length === 1 ? jobs[0] : null);
      const job = jobs.length === 1 ? jobs[0] : null;
      if (job && ['water', 'mold'].includes(job.division)) setMetaField('jobType')(divisionToJobType(job.division));
    } catch (error) {
      if (mountedRef.current && claimLoadRequestRef.current === requestVersion) {
        setClaimJobsError(error?.message || 'Jobs for this claim are unavailable.');
        err('Claim selected, but its linked job could not be loaded. You can keep pricing this claim.');
      }
    } finally {
      if (mountedRef.current && claimLoadRequestRef.current === requestVersion) setClaimJobsLoading(false);
    }
  };

  const handleJobSelect = (jobId) => {
    if (tech) selection();
    const job = claimJobs.find((candidate) => candidate.id === jobId) || null;
    setLinkedJob(job);
    if (job && ['water', 'mold'].includes(job.division)) setMetaField('jobType')(divisionToJobType(job.division));
  };

  const saveLegacy = async () => {
    const form = legacyFormFromInputs(inputs, {
      ...BLANK,
      jobType: meta.jobType,
      insuredName: meta.insuredName,
      address: meta.address,
      notes: meta.notes,
    });
    const legacyCalculation = calcQuote(form);
    return db.rpc('upsert_oop_quote', paramsForUpsert({
      form,
      quoteId: quote?.id,
      jobId: linkedJob?.id,
      calc: legacyCalculation,
      employeeId: employee?.id,
    }));
  };

  const saveQuote = async () => {
    let row;
    if (pricing.source === 'legacy_fallback') {
      row = await saveLegacy();
    } else {
      const draftParams = paramsForPricingQuoteV2({
        quoteId: quote?.id,
        jobId: linkedJob?.id,
        jobType: meta.jobType,
        insuredName: meta.insuredName,
        address: meta.address,
        notes: meta.notes,
        pricingRevisionId: pricing.source === 'legacy_quote' ? null : pricing.id,
        inputs,
        expectedUpdatedAt: quote?.updated_at || null,
        requestId: 'pending',
      });
      const fingerprint = pricingSaveFingerprint(draftParams);
      if (!saveRequestRef.current || saveRequestRef.current.fingerprint !== fingerprint) {
        saveRequestRef.current = { fingerprint, id: requestId() };
      }
      const params = { ...draftParams, p_request_id: saveRequestRef.current.id };
      try {
        row = await db.rpc('upsert_oop_quote_v2', params);
      } catch (error) {
        if (pricing.source !== 'legacy_quote' || !isPricingConfigRpcUnavailable(error)) throw error;
        row = await saveLegacy();
      }
    }
    row = unwrap(row);
    const nextQuote = quoteIdentity(row);
    if (row?.pricing_config_snapshot && row?.pricing_inputs) {
      const nextPricing = quotePricingState(row);
      setPricing(nextPricing);
      setInputs(nextPricing.inputs);
    }
    setQuote(nextQuote);
    baselineRef.current = snapshot(meta, row?.pricing_inputs || inputs, nextQuote, linkedJob?.id);
    saveRequestRef.current = null;
    return row;
  };

  const handleSave = async () => {
    if (saving || converting || !pricing || !calculation || convertedEstimateId) return;
    if (jobSelectionRequired) {
      if (tech) notify('error');
      err('Choose a job for this claim before saving the quote.');
      return;
    }
    if (calculation.quote <= 0) {
      if (tech) notify('error');
      err('Add at least one priced item before saving.');
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      if (tech) notify('error');
      err('An internet connection is required to save this quote.');
      return;
    }
    setSaving(true);
    try {
      const row = await saveQuote();
      if (tech) notify('success');
      ok(quote?.id ? 'Quote updated.' : `Quote saved as ${row.quote_number}.`);
      if (!quoteId) {
        skipLocationLoadRef.current = `${row.id}|`;
        navigate(`${basePath}?quoteId=${row.id}`, { replace: true });
      }
    } catch (error) {
      const message = String(error?.message || error);
      if (tech) notify('error');

      if (message.includes('quote_conflict')) err('This quote changed elsewhere. Refresh it before saving again.');
      else err(`Could not save the quote: ${message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleConvertToEstimate = async () => {
    if (saving || converting || !canConvertToEstimate || !pricing || !calculation) return;
    if (!linkedJob?.id) {
      if (tech) notify('error');
      err('Link this quote to a job before creating an estimate.');
      return;
    }
    if (calculation.quote <= 0) {
      if (tech) notify('error');
      err('Add at least one priced item before creating an estimate.');
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      if (tech) notify('error');
      err('An internet connection is required to create an estimate.');
      return;
    }
    const requestedLocationKey = locationKey;
    const requestVersion = conversionRequestRef.current + 1;
    conversionRequestRef.current = requestVersion;
    const current = () => mountedRef.current
      && conversionRequestRef.current === requestVersion
      && locationRef.current === requestedLocationKey;
    setConverting(true);
    try {
      let savedQuote;
      try {
        savedQuote = await saveQuote();
      } catch (saveError) {
        // If an earlier conversion committed but its response was lost, the
        // frozen quote refuses this pre-save. Continue to the retry-safe RPC so
        // it can return the already-linked estimate instead of dead-ending.
        if (!quote?.id || !String(saveError?.message || saveError).includes('oop_quote_already_converted')) {
          throw saveError;
        }
        savedQuote = quote;
      }
      const result = unwrap(await db.rpc('convert_oop_quote_to_estimate', { p_quote_id: savedQuote.id }));
      if (!current()) return;
      if (!result?.estimate_id) throw new Error('The estimate was not returned.');
      if (tech) notify('success');
      ok(result.created ? 'Estimate created from this quote.' : 'This quote already has an estimate.');
      navigate(estimateHref(result.estimate_id));
    } catch (error) {
      if (!current()) return;
      const message = String(error?.message || error);
      if (tech) notify('error');
      if (message.includes('quote_conflict')) err('This quote changed elsewhere. Refresh it before creating the estimate.');
      else if (message.includes('oop_quote_snapshot_required')) err('Save this quote with the current price list, then try again.');
      else err(`Could not create the estimate: ${message}`);
    } finally {
      if (current()) setConverting(false);
    }
  };

  const handleBack = () => {
    if (converting) return;
    if (dirty && !isArmed('back')) {
      arm('back');
      return;
    }
    cancel();
    leaveBack();
  };

  const confirmPendingNavigation = () => {
    if (converting) return;
    cancel();
    if (tech) impact('light');
    confirmGuardedNavigation();
  };

  const handleReset = async () => {
    if (converting) return;
    if (!isArmed('reset')) { arm('reset'); return; }
    cancel();
    invalidateRefresh();
    try {
      const nextPricing = await loadCurrentPricing();
      claimLoadRequestRef.current += 1;
      const nextMeta = emptyMeta();
      const nextInputs = defaultPricingInputs(nextPricing.config);
      setPricing(nextPricing);
      setMeta(nextMeta);
      setInputs(nextInputs);
      setQuote(null);
      setLinkedJob(null);
      setLinkedClaim(null);
      setClaimJobs([]);
      setClaimJobsLoading(false);
      setClaimJobsError('');
      baselineRef.current = snapshot(nextMeta, nextInputs, null);
      if (locationKey !== '|') skipLocationLoadRef.current = '|';
      if (tech) notify('success');
      navigate(basePath, { replace: true });
    } catch (error) {
      if (tech) notify('error');
      err(`Could not start a new quote: ${error?.message || error}`);
    }
  };

  const handleDelete = async () => {
    if (!quote?.id || converting) return;
    if (!isArmed('delete')) { arm('delete'); return; }
    cancel();
    invalidateRefresh();
    setDeleting(true);
    try {
      await db.rpc('delete_oop_quote', { p_id: quote.id });
      claimLoadRequestRef.current += 1;
      ok('Quote deleted.');
      skipLocationLoadRef.current = '|';
      navigate(basePath, { replace: true });
      const nextPricing = await loadCurrentPricing();
      const nextMeta = emptyMeta();
      const nextInputs = defaultPricingInputs(nextPricing.config);
      setPricing(nextPricing);
      setMeta(nextMeta);
      setInputs(nextInputs);
      setQuote(null);
      setLinkedJob(null);
      setLinkedClaim(null);
      setClaimJobs([]);
      setClaimJobsLoading(false);
      setClaimJobsError('');
      baselineRef.current = snapshot(nextMeta, nextInputs, null);
      if (tech) notify('success');
    } catch (error) {
      if (tech) notify('error');
      err(`Could not delete the quote: ${error?.message || error}`);
    } finally {
      setDeleting(false);
    }
  };

  // ─── SECTION: Render ──────────────
  if (loading) return tech ? <div className="oop-tech-loading"><SkeletonList rows={6} /></div> : <TabLoading label="Loading OOP pricing…" />;
  if (loadError) return <ErrorState className={tech ? 'oop-tech-error' : ''} message={refreshing ? 'Retrying the calculator…' : loadError} onRetry={refreshing ? undefined : () => { if (tech) impact('light'); load(); }} secondary={<button type="button" className="btn btn-secondary" onClick={() => { if (tech) impact('light'); handleBack(); }}>Back</button>} />;
  if (!pricing || !calculation) {
    return <ErrorState className={tech ? 'oop-tech-error' : ''} message={refreshing ? 'Retrying the calculator…' : calculationState.error || 'No usable pricing configuration is available.'} onRetry={refreshing ? undefined : () => { if (tech) impact('light'); load(); }} />;
  }

  const headerSubtitle = `${pricing.config.name}${dirty ? ' · Unsaved changes' : ''}`;
  const techHeaderEl = (
    <header className="oop-header oop-header--tech oop-no-print">
      <div className="oop-tech-header-main">
        <button type="button" className={`${isArmed('back') ? 'btn btn-danger btn-sm' : 'btn btn-ghost btn-sm'} oop-tech-action`} disabled={converting} onBlur={cancel} onClick={() => { impact('light'); handleBack(); }}>{isArmed('back') ? 'Confirm discard' : '← Back'}</button>
        <div className="oop-tech-header-heading">
          <h1 className="page-title">OOP Pricing Calculator</h1>
          <div>{headerSubtitle}</div>
        </div>
      </div>
      <TechLiveTotal calculation={calculation} />
      <div className="oop-tech-header-actions">
        <button type="button" className={`${isArmed('reset') ? 'btn btn-danger btn-sm' : 'btn btn-secondary btn-sm'} oop-tech-action`} disabled={converting} onBlur={cancel} onClick={() => { impact('light'); handleReset(); }}>{isArmed('reset') ? 'Confirm new quote' : 'New quote'}</button>
        {quote?.id && !convertedEstimateId && <button type="button" className={`${isArmed('delete') ? 'btn btn-danger btn-sm' : 'btn btn-secondary btn-sm'} oop-tech-action`} disabled={deleting || converting} onBlur={cancel} onClick={() => { impact('light'); handleDelete(); }}>{isArmed('delete') ? 'Confirm delete' : 'Delete'}</button>}
        {!convertedEstimateId && <button type="button" className={`${canConvertToEstimate ? 'btn btn-secondary' : 'btn btn-primary'} btn-sm oop-tech-action`} disabled={saving || converting || jobSelectionRequired || Boolean(calculationState.error)} onClick={() => { impact('light'); handleSave(); }}>{saving ? 'Saving…' : quote?.id ? 'Save changes' : 'Save quote'}</button>}
        {canConvertToEstimate && !convertedEstimateId && <button type="button" className="btn btn-primary btn-sm oop-tech-action" disabled={saving || converting || jobSelectionRequired || Boolean(calculationState.error)} onClick={() => { impact('light'); handleConvertToEstimate(); }}>{converting ? 'Creating…' : 'Create estimate'}</button>}
        {estimateRouteAvailable && convertedEstimateId && <button type="button" className="btn btn-primary btn-sm oop-tech-action" onClick={() => { impact('light'); navigate(estimateHref(convertedEstimateId)); }}>View estimate</button>}
      </div>
    </header>
  );
  const desktopHeaderEl = (
    <PageHeader
      className="oop-no-print"
      title="OOP Pricing Calculator"
      subtitle={headerSubtitle}
      actions={(
        <>
          <button type="button" className={isArmed('back') ? 'btn btn-danger btn-sm' : 'btn btn-ghost btn-sm'} disabled={converting} onBlur={cancel} onClick={handleBack}>{isArmed('back') ? 'Confirm discard' : '← Back'}</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => window.print()}>Print</button>
          <button type="button" className={isArmed('reset') ? 'btn btn-danger btn-sm' : 'btn btn-secondary btn-sm'} disabled={converting} onBlur={cancel} onClick={handleReset}>{isArmed('reset') ? 'Confirm new quote' : 'New quote'}</button>
          {quote?.id && !convertedEstimateId && <button type="button" className={isArmed('delete') ? 'btn btn-danger btn-sm' : 'btn btn-secondary btn-sm'} disabled={deleting || converting} onBlur={cancel} onClick={handleDelete}>{isArmed('delete') ? 'Confirm delete' : 'Delete'}</button>}
          {!convertedEstimateId && <button type="button" className={`${canConvertToEstimate ? 'btn btn-secondary' : 'btn btn-primary'} btn-sm`} disabled={saving || converting || jobSelectionRequired || Boolean(calculationState.error)} onClick={handleSave}>{saving ? 'Saving…' : quote?.id ? 'Save changes' : 'Save quote'}</button>}
          {canConvertToEstimate && !convertedEstimateId && <button type="button" className="btn btn-primary btn-sm" disabled={saving || converting || jobSelectionRequired || Boolean(calculationState.error)} onClick={handleConvertToEstimate}>{converting ? 'Creating…' : 'Create estimate'}</button>}
          {estimateRouteAvailable && convertedEstimateId && <button type="button" className="btn btn-primary btn-sm" onClick={() => navigate(estimateHref(convertedEstimateId))}>View estimate</button>}
        </>
      )}
    />
  );
  const navigationGuardEl = pendingNavigation ? (
    <div role="alert" className="card oop-no-print" style={{ margin: '0 auto var(--space-4)', maxWidth: tech ? 720 : 1400, borderColor: 'var(--warning-border)', background: 'var(--warning-bg)' }}>
      <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <span style={{ flex: '1 1 240px', color: 'var(--text-primary)' }}>You have unsaved quote changes. Discard them and leave the calculator?</span>
        <button type="button" className={`btn btn-secondary btn-sm${tech ? ' oop-tech-action' : ''}`} onClick={() => { if (tech) impact('light'); cancel(); stayOnCalculator(); }}>Stay</button>
        <button type="button" className={`btn btn-danger btn-sm${tech ? ' oop-tech-action' : ''}`} disabled={converting} onClick={confirmPendingNavigation}>Confirm discard</button>
      </div>
    </div>
  ) : null;
  const body = (
    <>
      {calculationState.error && <div role="alert" className="oop-no-print" style={{ marginBottom: 'var(--space-4)', padding: 'var(--space-3)', border: '1px solid var(--danger-border)', borderRadius: 'var(--radius-md)', background: 'var(--danger-bg)', color: 'var(--danger)' }}>{calculationState.error}</div>}
      {convertedEstimateId && <div role="status" className="oop-no-print" style={{ marginBottom: 'var(--space-4)', padding: 'var(--space-3)', border: '1px solid var(--success-border)', borderRadius: 'var(--radius-md)', background: 'var(--success-bg)', color: 'var(--success)' }}>This quote is locked because it has been converted to an official estimate.</div>}
      <div className={`oop-layout${tech ? ' oop-layout--tech' : ''}`} style={{ display: 'grid', gridTemplateColumns: tech ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) minmax(320px, 420px)', gap: 'var(--space-5)', alignItems: 'start' }}>
        <section className="oop-form oop-no-print" aria-label="Quote inputs">
          <fieldset disabled={Boolean(convertedEstimateId) || converting} style={{ display: 'grid', gap: 'var(--space-4)', minWidth: 0, margin: 0, padding: 0, border: 0 }}>
          <Section title="Job type" tech={tech}>
            <div className={`ui-seg oop-job-type-seg${tech ? ' oop-job-type-seg--tech' : ''}`} data-job-type={meta.jobType} role="group" aria-label="Job type">
              <span className="ui-seg-indicator" aria-hidden="true" />
              {[['water', 'Water mitigation'], ['mold', 'Mold remediation']].map(([value, label]) => <button type="button" className={`ui-seg-btn${tech ? ' oop-tech-action' : ''}`} data-active={meta.jobType === value} aria-pressed={meta.jobType === value} key={value} onClick={() => handleJobTypeChange(value)}>{label}</button>)}
            </div>
          </Section>
          <Section title="Customer" tech={tech}>
            <ClaimPicker label="Claim / insured name" value={meta.insuredName} onChangeText={handleInsuredChange} onSelectClaim={handleClaimSelect} linkedClaim={linkedClaim} onUnlink={() => { claimLoadRequestRef.current += 1; if (tech) selection(); setLinkedClaim(null); setLinkedJob(null); setClaimJobs([]); setClaimJobsLoading(false); setClaimJobsError(''); }} placeholder="Type homeowner name or search claims…" compact={!tech} tech={tech} />
            <TextInput tech={tech} label="Address" value={meta.address} onChange={setMetaField('address')} placeholder="123 Main St, Salt Lake City, UT" />
            {linkedClaim && <JobSelect
              jobs={claimJobs}
              value={linkedJob?.id || ''}
              loading={claimJobsLoading}
              error={claimJobsError}
              onChange={handleJobSelect}
              onRetry={() => handleClaimSelect(linkedClaim)}
              tech={tech}
            />}
            {linkedJob && <div className={`oop-linked-job${tech ? ' oop-linked-job--tech' : ''}`}>Estimate job: {converting
              ? <span aria-disabled="true">{linkedJob.job_number || 'job'}</span>
              : <Link className={tech ? 'oop-tech-link-press' : undefined} to={tech ? jobHref(linkedJob.id) : `/jobs/${linkedJob.id}`} onClick={() => { if (tech) impact('light'); }}>{linkedJob.job_number || 'job'}</Link>}
              {!linkedClaim && <button type="button" className={`btn btn-ghost btn-sm${tech ? ' oop-tech-action' : ''}`} onClick={() => { claimLoadRequestRef.current += 1; if (tech) selection(); setLinkedJob(null); }}>Unlink</button>}
            </div>}
          </Section>
          {sections.map(([section, items]) => (
            <Section key={section} title={section || 'Pricing'} hint={`${items.length} line item${items.length === 1 ? '' : 's'}`} tech={tech}>
              {items.map((item) => <PricingItem key={item.key} item={item} input={inputs[item.key] || {}} line={lines.get(item.key)} onInput={(field, value) => setItemInput(item, field, value)} tech={tech} />)}
            </Section>
          ))}
          <Section title="Notes" tech={tech}><TextInput tech={tech} multiline label="Scope and special conditions" value={meta.notes} onChange={setMetaField('notes')} placeholder="Scope, access, and special conditions…" /></Section>
          </fieldset>
        </section>
        {!tech && <aside className="oop-breakdown" style={{ position: 'sticky', top: 'var(--space-4)' }}><Breakdown calculation={calculation} pricing={pricing} quote={quote} meta={meta} linkedJob={linkedJob} /></aside>}
      </div>
      {tech && <Breakdown calculation={calculation} pricing={pricing} quote={quote} meta={meta} linkedJob={linkedJob} tech />}
    </>
  );

  if (tech) {
    // Tech header remains outside PullToRefresh so a pull only moves calculator content.
    return (
      <div className="oop-page oop-page--tech">
        <div className="oop-tech-sticky-header oop-no-print" style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg-secondary)' }}><div className="oop-tech-header-inner" style={{ maxWidth: 720, margin: '0 auto', padding: 'var(--space-3) var(--space-3) 0' }}>{techHeaderEl}</div></div>
        {navigationGuardEl}
        <PullToRefresh onRefresh={refreshSaved}><div className="oop-tech-refresh-body" style={{ maxWidth: 720, margin: '0 auto', padding: kbInset > 0 ? `var(--space-4) var(--space-3) calc(var(--space-6) + ${kbInset}px)` : 'var(--space-4) var(--space-3) max(var(--space-6), env(safe-area-inset-bottom, 0px))' }}>{body}</div></PullToRefresh>
      </div>
    );
  }
  return <div className="oop-page" style={{ maxWidth: 1400, margin: '0 auto', padding: 'var(--space-5)' }}>{desktopHeaderEl}{navigationGuardEl}{body}</div>;
}
