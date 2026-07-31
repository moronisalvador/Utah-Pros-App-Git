/**
 * ════════════════════════════════════════════════
 * FILE: OopPricingBuilder.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Lets administrators build the price list used by the out-of-pocket calculator.
 *   They can change rates and minimums, add or archive items, reorder them, save a draft, and publish it.
 *
 * WHERE IT LIVES:
 *   Route:        /settings/oop-pricing
 *   Rendered by:  src/App.jsx inside SettingsLayout and AdminRoute
 *
 * DEPENDS ON:
 *   Packages:  React
 *   Internal:  AuthContext, pricing-config helpers, Settings primitives, toast
 *   Data:      reads  → get_oop_pricing_admin_state RPC
 *              writes → save_oop_pricing_draft and publish_oop_pricing_draft RPCs
 *
 * NOTES / GOTCHAS:
 *   - Editing a draft never changes a quote. Publishing creates the
 *     next current revision; saved quotes remain pinned to their snapshots.
 *   - Request ids survive uncertain retries and are reset only after success or
 *     a payload change.
 * ════════════════════════════════════════════════
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import '@/components/oop/oop-pricing.css';
import TabLoading from '@/components/TabLoading';
import SettingsPageHeader from '@/components/settings/SettingsPageHeader';
import SettingsSection from '@/components/settings/SettingsSection';
import { EmptyState, ErrorState, StatusPill } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import { useTwoClickConfirm } from '@/hooks/useTwoClickConfirm';
import useUnsavedNavigationGuard from '@/hooks/useUnsavedNavigationGuard';
import {
  addPricingItem,
  archivePricingItem,
  movePricingItem,
  normalizePricingConfig,
  restorePricingItem,
  updatePricingItem,
  validatePricingConfig,
} from '@/lib/oopPricingConfig';
import { err, ok } from '@/lib/toast';
// ─── SECTION: Helpers ──────────────

const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 'var(--space-3)' };
const labelStyle = { display: 'grid', gap: 'var(--space-1)', color: 'var(--text-secondary)', fontSize: 'var(--text-xs)', fontWeight: 600 };
const controlStyle = { width: '100%' };
const FORMULAS = [
  ['quantity', 'Quantity × rate'],
  ['duration', 'Quantity × days × rate'],
  ['fixed', 'Fixed charge'],
  ['cost_plus', 'Input cost × multiplier'],
  ['percentage', 'Percentage of another amount'],
  ['pass_through', 'Pass-through input'],
];
const COST_BASES = [
  ['none', 'No internal cost'],
  ['units', 'Quantity / duration units'],
  ['input', 'Raw input cost'],
  ['percentage_base', 'Percentage base'],
  ['final_total', 'Final customer total'],
];

const unwrap = (value) => Array.isArray(value) ? value[0] : value;

function requestId() {
  if (!globalThis.crypto?.randomUUID) throw new Error('Secure request identifiers are unavailable in this browser.');
  return globalThis.crypto.randomUUID();
}

function revisionRow(value) {
  if (!value) return null;
  return {
    id: value.id,
    revisionNumber: value.revisionNumber ?? value.revision_number,
    lockVersion: value.lockVersion ?? value.lock_version,
    config: value.config ? normalizePricingConfig(value.config) : null,
    contentHash: value.contentHash ?? value.content_hash,
    publishedAt: value.publishedAt ?? value.published_at,
    updatedAt: value.updatedAt ?? value.updated_at,
  };
}

function adminEnvelope(value) {
  const input = unwrap(value);
  return { published: revisionRow(input?.published), draft: revisionRow(input?.draft) };
}

function stableRequest(ref, fingerprint) {
  if (!ref.current || ref.current.fingerprint !== fingerprint) {
    ref.current = { fingerprint, id: requestId() };
  }
  return ref.current.id;
}

function Field({ text, value, onChange, type = 'text', readOnly = false }) {
  const handle = (event) => {
    const next = event.target.value;
    onChange(type === 'number' && next !== '' ? Number(next) : next);
  };
  return (
    <label style={labelStyle}>
      {text}
      <input className="input" style={controlStyle} type={type} min={type === 'number' ? 0 : undefined} step={type === 'number' ? 'any' : undefined} value={value ?? ''} readOnly={readOnly} onChange={handle} />
    </label>
  );
}

function SelectField({ text, value, onChange, options }) {
  return (
    <label style={labelStyle}>
      {text}
      <select className="input" style={controlStyle} value={value ?? ''} onChange={(event) => onChange(event.target.value)}>
        {options.map(([key, optionLabel]) => <option key={key} value={key}>{optionLabel}</option>)}
      </select>
    </label>
  );
}

function Toggle({ text, checked, onChange }) {
  return (
    <label className="oop-pricing-toggle" style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
      <input type="checkbox" checked={Boolean(checked)} onChange={(event) => onChange(event.target.checked)} />
      {text}
    </label>
  );
}

function ItemCard({ item, busy, allItems, canMoveUp, canMoveDown, onUpdate, onArchive, onRestore, onMove }) {
  const archived = item.active === false;
  const { isArmed, arm, cancel } = useTwoClickConfirm();
  const set = (field) => (value) => onUpdate({ [field]: value });
  const jobTypes = item.jobTypes || [];
  const toggleJob = (type) => (checked) => onUpdate({ jobTypes: checked ? [...new Set([...jobTypes, type])] : jobTypes.filter((value) => value !== type) });
  const compareOrder = (left, right) => Number(left.sortOrder) - Number(right.sortOrder) || String(left.key).localeCompare(String(right.key));
  const percentageOptions = [
    ['prior_subtotal', 'Prior customer subtotal'],
    ['final_total', 'Final customer total'],
    ...allItems
      .filter((candidate) => compareOrder(candidate, item) < 0)
      .sort(compareOrder)
      .map((candidate) => [`item:${candidate.key}`, candidate.label || candidate.key]),
  ];
  const changeFormula = (formula) => {
    const leavingPercentage = item.formula === 'percentage' && formula !== 'percentage';
    const enteringPercentage = item.formula !== 'percentage' && formula === 'percentage';
    onUpdate({
      formula,
      percentageBase: enteringPercentage ? 'prior_subtotal' : leavingPercentage ? null : item.percentageBase,
      internalCostBasis: leavingPercentage && ['percentage_base', 'final_total'].includes(item.internalCostBasis) ? 'none' : item.internalCostBasis,
    });
  };
  const archive = () => {
    if (!isArmed('archive')) { arm('archive'); return; }
    cancel();
    onArchive();
  };

  return (
    <article className="card oop-pricing-item-card" style={{ opacity: archived ? 0.72 : 1 }}>
      <div className="card-body">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)', marginBottom: 'var(--space-3)', flexWrap: 'wrap' }}>
        <div>
          <strong>{item.label || 'New pricing item'}</strong>
          <div style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{item.key}</div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-secondary" disabled={busy || archived || !canMoveUp} onClick={() => onMove('up')}>Move up</button>
          <button type="button" className="btn btn-secondary" disabled={busy || archived || !canMoveDown} onClick={() => onMove('down')}>Move down</button>
          <button
            type="button"
            className={archived ? 'btn btn-secondary' : isArmed('archive') ? 'btn btn-danger' : 'btn btn-secondary'}
            disabled={busy}
            onBlur={cancel}
            onClick={archived ? onRestore : archive}
          >
            {archived ? 'Restore' : isArmed('archive') ? 'Confirm archive' : 'Archive'}
          </button>
        </div>
      </div>
      <div style={grid}>
        <Field text="Item key" value={item.key} readOnly onChange={() => {}} />
        <Field text="Label" value={item.label} onChange={set('label')} />
        <Field text="Help text" value={item.helpText} onChange={set('helpText')} />
        <Field text="Section" value={item.section} onChange={set('section')} />
        <Field text="Unit" value={item.unit} onChange={set('unit')} />
        <SelectField text="Formula" value={item.formula} onChange={changeFormula} options={FORMULAS} />
        <Field text={item.formula === 'percentage' ? 'Customer percentage (decimal)' : item.formula === 'cost_plus' ? 'Standard multiplier' : 'Standard rate'} type="number" value={item.standardRate} onChange={set('standardRate')} />
        <Field text="Internal rate / multiplier" type="number" value={item.internalRate} onChange={set('internalRate')} />
        <SelectField text="Internal cost basis" value={item.internalCostBasis} onChange={set('internalCostBasis')} options={COST_BASES} />
        <Field text="Minimum quantity" type="number" value={item.minimumQuantity} onChange={set('minimumQuantity')} />
        <Field text="Minimum line charge" type="number" value={item.minimumCharge} onChange={set('minimumCharge')} />
        <Field text="Default quantity" type="number" value={item.defaultQuantity} onChange={set('defaultQuantity')} />
        <Field text="Default days" type="number" value={item.defaultDays} onChange={set('defaultDays')} />
        {item.formula === 'percentage' && <SelectField text="Percentage base" value={item.percentageBase} onChange={set('percentageBase')} options={percentageOptions} />}
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap', marginTop: 'var(--space-3)' }}>
        <Toggle text="Water" checked={jobTypes.includes('water')} onChange={toggleJob('water')} />
        <Toggle text="Mold" checked={jobTypes.includes('mold')} onChange={toggleJob('mold')} />
        <Toggle text="Customer visible" checked={item.customerVisible} onChange={set('customerVisible')} />
        <Toggle text="Allow price override" checked={item.priceOverrideAllowed} onChange={set('priceOverrideAllowed')} />
      </div>
      </div>
    </article>
  );
}

// ─── SECTION: State & hooks ──────────────
export default function OopPricingBuilder() {
  const navigate = useNavigate();
  const { db } = useAuth();
  const [adminState, setAdminState] = useState({ published: null, draft: null });
  const [config, setConfig] = useState(null);
  const [baseline, setBaseline] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const saveRequestRef = useRef(null);
  const publishRequestRef = useRef(null);
  const { isArmed, arm, cancel } = useTwoClickConfirm();

  const dirty = Boolean(config) && JSON.stringify(config) !== JSON.stringify(baseline);
  const {
    pendingNavigation,
    stay: stayOnPage,
    confirmNavigation,
  } = useUnsavedNavigationGuard({ dirty, navigate });
  const errors = useMemo(() => config ? validatePricingConfig(config) : [], [config]);
  const activeItems = config?.items?.filter((item) => item.active !== false) || [];
  const archivedItems = config?.items?.filter((item) => item.active === false) || [];

  // ─── SECTION: Data fetching ──────────────
  const fetchState = useCallback(async () => adminEnvelope(await db.rpc('get_oop_pricing_admin_state')), [db]);
  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const next = await fetchState();
      const nextConfig = next.draft?.config || next.published?.config || null;
      setAdminState(next);
      setConfig(nextConfig);
      setBaseline(nextConfig);
      setLoadError('');
    } catch (error) {
      setLoadError(error?.message || 'OOP pricing settings could not be loaded.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchState]);

  useEffect(() => { load(); }, [load]);
  // ─── SECTION: Event handlers ──────────────
  const mutate = (fn) => {
    if (!busy && config) setConfig((current) => fn(current));
  };
  const onItem = (item, patch) => mutate((current) => updatePricingItem(current, item.key, patch));

  const save = async () => {
    if (busy || !config) return;
    if (errors.length) { err('Fix the pricing validation errors before saving.'); return; }
    if (!adminState.draft?.lockVersion) { err('A saved draft is required before this configuration can be updated.'); return; }
    const normalized = normalizePricingConfig(config);
    const fingerprint = JSON.stringify({ lockVersion: adminState.draft.lockVersion, config: normalized });
    setBusy(true);
    try {
      const result = revisionRow(await db.rpc('save_oop_pricing_draft', {
        p_expected_lock_version: adminState.draft.lockVersion,
        p_config: normalized,
        p_request_id: stableRequest(saveRequestRef, fingerprint),
      }));
      const draft = { ...adminState.draft, ...result, config: result?.config || normalized };
      setAdminState((current) => ({ ...current, draft }));
      setConfig(draft.config);
      setBaseline(draft.config);
      saveRequestRef.current = null;
      ok('OOP pricing draft saved.');
    } catch (error) {
      err(error?.message || 'Could not save the OOP pricing draft.');
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    if (busy || !adminState.draft || dirty) { err(dirty ? 'Save the draft before publishing.' : 'A saved draft is required before publishing.'); return; }
    if (errors.length) { err('Fix the pricing validation errors before publishing.'); return; }
    if (!isArmed('publish')) { arm('publish'); return; }
    const fingerprint = JSON.stringify({ lockVersion: adminState.draft.lockVersion, contentHash: adminState.draft.contentHash });
    setBusy(true);
    try {
      await db.rpc('publish_oop_pricing_draft', {
        p_expected_lock_version: adminState.draft.lockVersion,
        p_request_id: stableRequest(publishRequestRef, fingerprint),
      });
      publishRequestRef.current = null;
      cancel();
      ok('OOP pricing draft published.');
      try {
        const next = await fetchState();
        const nextConfig = next.draft?.config || null;
        setAdminState(next);
        setConfig(nextConfig);
        setBaseline(nextConfig);
      } catch {
        err('Pricing was published, but the refreshed revision could not be loaded. Reload Settings before editing again.');
      }
    } catch (error) {
      err(error?.message || 'Could not publish the OOP pricing draft.');
    } finally {
      setBusy(false);
    }
  };

  // ─── SECTION: Render ──────────────
  if (loading) return <TabLoading label="Loading OOP pricing settings…" />;
  if (loadError) return <ErrorState message={refreshing ? 'Retrying OOP pricing settings…' : loadError} onRetry={refreshing ? undefined : load} />;
  if (!config) return <EmptyState icon="⌁" title="No OOP pricing configuration" sub="A pricing draft has not been created yet." />;

  return (
    <div className="oop-pricing-builder">
      <SettingsPageHeader
        title="OOP Pricing"
        subtitle="Build versioned pricing rules for both OOP calculator experiences."
        actions={(
          <div className="oop-pricing-builder-actions">
            <StatusPill tone={dirty ? 'warning' : 'success'} label={dirty ? 'Unsaved changes' : 'Saved'} />
            <button type="button" className="btn btn-secondary" disabled={busy || !dirty} onClick={save}>Save draft</button>
            <button type="button" className={isArmed('publish') ? 'btn btn-danger' : 'btn btn-primary'} disabled={busy} onBlur={cancel} onClick={publish}>{isArmed('publish') ? 'Confirm publish' : 'Publish'}</button>
          </div>
        )}
      />
      {errors.length > 0 && (
        <div role="alert" className="card" style={{ borderColor: 'var(--danger-border)', background: 'var(--danger-bg)', marginBottom: 'var(--space-4)' }}>
          <div className="card-body">
            <strong>Fix before saving</strong>
            <ul>{errors.map((message) => <li key={message}>{message}</li>)}</ul>
          </div>
        </div>
      )}
      {isArmed('publish') && (
        <div className="card" style={{ borderColor: 'var(--warning-border)', background: 'var(--warning-bg)', marginBottom: 'var(--space-4)' }}>
          <div className="card-body">
            <strong>Publish this saved draft?</strong>
            <p style={{ margin: 'var(--space-2) 0 0', color: 'var(--text-secondary)' }}>Revision {adminState.draft?.revisionNumber || '—'} will become active for new quotes with {activeItems.length} active line items.</p>
          </div>
        </div>
      )}
      {pendingNavigation && (
        <div className="card" style={{ borderColor: 'var(--warning-border)', background: 'var(--warning-bg)', marginBottom: 'var(--space-4)' }}>
          <div className="card-body">
            <strong>Discard unsaved pricing changes?</strong>
            <p style={{ margin: 'var(--space-2) 0 0', color: 'var(--text-secondary)' }}>Confirm below to leave this draft without saving.</p>
            <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-danger" onClick={() => { cancel(); confirmNavigation(); }}>Confirm discard</button>
              <button type="button" className="btn btn-secondary" onClick={() => { cancel(); stayOnPage(); }}>Keep editing</button>
            </div>
          </div>
        </div>
      )}
      <SettingsSection title="Project minimums" description="Minimum customer charges applied only when a quote has a positive subtotal.">
        <div style={grid}>
          <Field text="Configuration name" value={config.name} onChange={(name) => mutate((current) => ({ ...current, name }))} />
          <Field text="Water project minimum" type="number" value={config.projectMinimums?.water} onChange={(water) => mutate((current) => ({ ...current, projectMinimums: { ...current.projectMinimums, water } }))} />
          <Field text="Mold project minimum" type="number" value={config.projectMinimums?.mold} onChange={(mold) => mutate((current) => ({ ...current, projectMinimums: { ...current.projectMinimums, mold } }))} />
        </div>
      </SettingsSection>
      <SettingsSection
        title="Draft line items"
        description="Standard pricing, cost logic, minimums, defaults, and visibility. Archive instead of deleting so prior pricing stays traceable."
        actions={<button type="button" className="btn btn-secondary" disabled={busy} onClick={() => mutate((current) => addPricingItem(current))}>Add item</button>}
      >
        <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
          {activeItems.map((item, index) => (
            <ItemCard
              key={item.key}
              item={item}
              busy={busy}
              allItems={config.items}
              canMoveUp={index > 0}
              canMoveDown={index < activeItems.length - 1}
              onUpdate={(patch) => onItem(item, patch)}
              onArchive={() => mutate((current) => archivePricingItem(current, item.key))}
              onRestore={() => mutate((current) => restorePricingItem(current, item.key))}
              onMove={(direction) => mutate((current) => movePricingItem(current, item.key, direction))}
            />
          ))}
        </div>
      </SettingsSection>
      {archivedItems.length > 0 && (
        <SettingsSection title="Archived line items" description="Excluded from new quotes, retained for history, and available to restore.">
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            {archivedItems.map((item) => (
              <ItemCard
                key={item.key}
                item={item}
                busy={busy}
                allItems={config.items}
                canMoveUp={false}
                canMoveDown={false}
                onUpdate={(patch) => onItem(item, patch)}
                onArchive={() => {}}
                onRestore={() => mutate((current) => restorePricingItem(current, item.key))}
                onMove={() => {}}
              />
            ))}
          </div>
        </SettingsSection>
      )}
      <SettingsSection title="Published snapshot" description="The immutable revision currently used by new quotes.">
        <div className="card">
          <div className="card-body">
            {adminState.published ? (
              <>
                <StatusPill tone="success" label={`Revision ${adminState.published.revisionNumber || '—'} published`} />
                <p style={{ color: 'var(--text-secondary)', marginBottom: 0 }}>
                  Published {adminState.published.publishedAt ? new Date(adminState.published.publishedAt).toLocaleString() : 'date unavailable'} · {adminState.published.config?.items?.length || 0} total line items
                </p>
              </>
            ) : <span style={{ color: 'var(--text-secondary)' }}>No published pricing revision yet.</span>}
          </div>
        </div>
      </SettingsSection>
    </div>
  );
}
