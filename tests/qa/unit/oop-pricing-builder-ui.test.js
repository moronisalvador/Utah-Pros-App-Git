/**
 * ════════════════════════════════════════════════
 * FILE: oop-pricing-builder-ui.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks that only administrators can open the price-list builder.
 *   It also guards calculator routes, safe saves, native behavior, and the global rollout control.
 *
 * DEPENDS ON:
 *   Packages:  node:fs, Vitest
 *   Internal:  calculator, builder, routes, navigation, styles, and ClaimPicker source files
 *   Data:      reads  → local source files only
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - These checks inspect source wiring; rendered behavior is verified separately.
 *   - The global rollout assertion covers the control only and never clicks it.
 * ════════════════════════════════════════════════
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(path, 'utf8');

describe('OOP pricing builder UI contract', () => {
  it('keeps Settings admin-only and the calculators feature-gated', () => {
    const app = read('src/App.jsx');
    const nav = read('src/lib/navItems.jsx');
    const techMore = read('src/pages/tech/TechMore.jsx');
    const access = read('src/lib/oopPricingAccess.js');
    expect(app).toContain('path="settings/oop-pricing" element={<AdminRoute>');
    expect(app).toContain('<FeatureRoute flag="tool:oop_pricing">');
    expect(app.match(/<RoleRoute roles={OOP_PRICING_ROLES}>/g)).toHaveLength(2);
    expect(nav).toMatch(/oop_pricing_settings[\s\S]*adminOnly:\s*true/);
    expect(nav).toMatch(/key:\s*'oop_pricing'[\s\S]*allowedRoles:\s*OOP_PRICING_ROLES/);
    expect(techMore).toContain("canUseOopPricing(employee?.role) && isFeatureEnabled('tool:oop_pricing')");
    expect(access).toContain("'estimator'");
    expect(access).toContain("'project_manager'");
  });

  it('routes desktop and tech users to the shared configured runtime', () => {
    const web = read('src/routes/buildTargetPages.web.jsx');
    const native = read('src/routes/buildTargetPages.native.jsx');
    expect(web).toContain("import('@/pages/OOPPricingConfigured')");
    expect(web).toContain("import('@/pages/tech/TechOOPPricingConfigured')");
    expect(native).toContain("import('@/pages/tech/TechOOPPricingConfigured')");
  });

  it('uses versioned RPCs, optimistic concurrency, snapshots, and stable UUIDs', () => {
    const calculator = read('src/components/oop/ConfiguredOopPricingCalculator.jsx');
    const builder = read('src/pages/settings/OopPricingBuilder.jsx');
    expect(calculator).toContain("db.rpc('get_oop_pricing_config'");
    expect(calculator).toContain("db.rpc('get_oop_quote_v2'");
    expect(calculator).toContain("db.rpc('get_oop_quote'");
    expect(calculator).toContain("db.rpc('upsert_oop_quote_v2'");
    expect(calculator).toContain('expectedUpdatedAt: quote?.updated_at || null');
    expect(calculator).toContain('pricing_config_snapshot');
    expect(calculator).toContain('saveRequestRef');
    expect(builder).toContain("db.rpc('save_oop_pricing_draft'");
    expect(builder).toContain("db.rpc('publish_oop_pricing_draft'");
    expect(builder).toContain('Confirm archive');
    expect(`${calculator}\n${builder}`).not.toContain('Date.now()');
  });

  it('falls back only for a missing v2 RPC and keeps other failures visible', () => {
    const calculator = read('src/components/oop/ConfiguredOopPricingCalculator.jsx');
    expect(calculator).toContain('isPricingConfigRpcUnavailable(error)');
    expect(calculator).toContain("source: 'legacy_fallback'");
    expect(calculator).toContain('setLoadError(error?.message');
    expect(calculator).toContain('<ErrorState');
  });
  it('only permits named percentage bases from earlier deterministic line items and rejects crafted job ids', () => {
    const calculator = read('src/components/oop/ConfiguredOopPricingCalculator.jsx');
    const builder = read('src/pages/settings/OopPricingBuilder.jsx');
    expect(calculator).toContain("if (!UUID.test(id)) throw new Error('Invalid job link.')");
    expect(builder).toContain('.filter((candidate) => compareOrder(candidate, item) < 0)');
  });
  it('keeps the tech total above editable sections and the full breakdown below them', () => {
    const calculator = read('src/components/oop/ConfiguredOopPricingCalculator.jsx');
    const liveTotal = calculator.indexOf('{tech && <div className="oop-no-print" style={{ marginBottom: \'var(--space-3)\' }}><TechLiveTotal');
    const editableSections = calculator.indexOf('<section className="oop-form oop-no-print"');
    const bottomBreakdown = calculator.lastIndexOf('{tech && <Breakdown calculation={calculation}');
    expect(liveTotal).toBeGreaterThan(-1);
    expect(editableSections).toBeGreaterThan(liveTotal);
    expect(bottomBreakdown).toBeGreaterThan(editableSections);
  });

  it('retains print hooks and the fixed tech header outside pull-to-refresh', () => {
    const calculator = read('src/components/oop/ConfiguredOopPricingCalculator.jsx');
    const css = read('src/components/oop/oop-pricing.css');
    expect(calculator).toContain('className="oop-page"');
    expect(calculator).toContain('className="oop-breakdown"');
    expect(calculator).toContain('className="oop-tech-sticky-header oop-no-print"');
    expect(calculator.indexOf('oop-tech-sticky-header')).toBeLessThan(calculator.indexOf('<PullToRefresh'));
    expect(calculator).toContain("tech ? jobHref(linkedJob.id)");
    expect(calculator).toContain('className={`ui-seg oop-job-type-seg');
    expect(calculator).toContain('<PageHeader');
    expect(calculator).toContain("gridTemplateColumns: tech ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) minmax(320px, 420px)'");
    expect(css).toContain('.oop-layout');
    expect(css).toContain('.oop-breakdown');
    expect(calculator).toContain("minHeight: tech ? 'var(--tech-min-tap)' : 'var(--oop-control-height, 40px)'");
    expect(calculator).toContain("tech ? 'var(--tech-min-tap)' : 'var(--oop-control-height)'");
    expect(css).toMatch(/\.oop-page--tech \.oop-tech-action\s*\{[\s\S]*min-height:\s*var\(--tech-min-tap\)/);
    expect(css).toMatch(/@media \(max-width: 768px\)\s*\{[\s\S]*\.oop-layout\s*\{\s*grid-template-columns:\s*1fr !important/);
    expect(css).toContain('background: Canvas !important; color-scheme: light;');
    expect(css).toMatch(/\.oop-job-type-seg\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    expect(css).toMatch(/\.oop-job-type-seg\[data-job-type="mold"\] \.ui-seg-indicator\s*\{[\s\S]*translateX/);
    expect(calculator).toContain("import useNativeKeyboardInset from '@/lib/useNativeKeyboardInset'");
    expect(calculator).toContain('const kbInset = useNativeKeyboardInset()');
    expect(calculator).toContain("kbInset > 0 ? `var(--space-4) var(--space-3) calc(var(--space-6) + ${kbInset}px)`");
  });
  it('keeps native haptics tech-only and fire-and-forget', () => {
    const calculator = read('src/components/oop/ConfiguredOopPricingCalculator.jsx');
    const techHeader = calculator.slice(calculator.indexOf('const techHeaderEl'), calculator.indexOf('const desktopHeaderEl'));
    const claimSelect = calculator.slice(calculator.indexOf('const handleClaimSelect'), calculator.indexOf('const saveLegacy'));
    expect(calculator).toContain("import { impact, notify, selection } from '@/lib/nativeHaptics'");
    expect(calculator).toContain("if (tech) impact('light')");
    expect(calculator).toContain("if (tech) selection()");
    expect(calculator).toContain("if (tech) notify('success')");
    expect(calculator).toContain("if (tech) notify('error')");
    expect(claimSelect).toContain("if (tech) selection()");
    expect(calculator).toContain("onUnlink={() => { claimLoadRequestRef.current += 1; if (tech) selection();");
    expect(calculator).toContain("onClick={() => { claimLoadRequestRef.current += 1; if (tech) selection(); setLinkedJob(null); }}>Unlink");
    expect(read('src/components/ClaimPicker.jsx')).toContain("if (tech) impact('light')");
    expect(techHeader).toContain("onClick={() => { impact('light'); handleBack(); }}");
    expect(techHeader).toContain("onClick={() => { impact('light'); handleReset(); }}");
    expect(techHeader).toContain("onClick={() => { impact('light'); handleDelete(); }}");
    expect(techHeader).toContain("onClick={() => { impact('light'); handleSave(); }}");
    expect(calculator).not.toContain("await impact(");
    expect(calculator).not.toContain("await selection(");
    expect(calculator).not.toContain("await notify(");
  });
  it('keeps reset and resume from blanking an already rendered calculator', () => {
    const calculator = read('src/components/oop/ConfiguredOopPricingCalculator.jsx');
    const navigationGuard = read('src/hooks/useUnsavedNavigationGuard.js');
    const reset = calculator.slice(calculator.indexOf('const handleReset'), calculator.indexOf('const handleDelete'));
    const remove = calculator.slice(calculator.indexOf('const handleDelete'), calculator.indexOf('if (loading) return'));
    expect(calculator).toContain("useResumeRefetch({ onResume: refreshSaved, enabled: Boolean(quote?.id) })");
    expect(navigationGuard).toContain("window.addEventListener('beforeunload', guard)");
    expect(calculator).toContain('if (skipLocationLoadRef.current === locationKey)');
    expect(calculator).toContain('skipLocationLoadRef.current = null');
    expect(calculator).toContain("skipLocationLoadRef.current = `${row.id}|`");
    expect(calculator).toContain('const refreshRequestRef = useRef(0)');
    expect(calculator).toContain('refreshRequestRef.current !== requestVersion');
    expect(calculator).toContain('currentContext.quoteId !== requestedQuoteId');
    expect(calculator).toContain('currentContext.locationKey !== requestedLocationKey');
    expect(calculator).toContain('mountedRef.current = false');
    expect(reset).toContain('invalidateRefresh()');
    expect(remove).toContain('invalidateRefresh()');
    expect(reset).not.toContain('setLoading(true)');
  });
  it('keeps failed claim search distinct from a successful empty result', () => {
    const claimPicker = read('src/components/ClaimPicker.jsx');
    expect(claimPicker).toContain("const [loadError, setLoadError] = useState('')");
    expect(claimPicker).toContain("setLoadError(error?.message || 'Claims search is unavailable.')");
    expect(claimPicker).toContain('const showLoadError');
    expect(claimPicker).toContain('loaded && !loadError');
    expect(claimPicker).toContain('>Retry</button>');
  });
  it('keeps the ClaimPicker popup accessible through its tokenized exit', () => {
    const claimPicker = read('src/components/ClaimPicker.jsx');
    const claimPickerCss = read('src/components/ClaimPicker.css');
    expect(claimPicker).toContain('aria-expanded={popupOpen}');
    expect(claimPicker).toContain('const popupPresent = popupOpen || closing');
    expect(claimPicker).toContain("data-state={popupOpen ? 'open' : 'closing'}");
    expect(claimPicker).toContain('!prefersReducedMotion()');
    expect(claimPickerCss).toContain(".claim-picker__menu[data-state='closing']");
    expect(claimPickerCss).toContain("claimPickerIn var(--motion-duration-fast) var(--motion-spring-in)");
    expect(claimPickerCss).toContain('var(--motion-ease-accelerate)');
    expect(claimPickerCss).toContain('.claim-picker:not(.claim-picker--tech) .claim-picker__option:active');
    expect(claimPickerCss).toContain('@media (prefers-reduced-motion: reduce)');
  });
  it('requires a second explicit Back action before discarding dirty calculator edits', () => {
    const calculator = read('src/components/oop/ConfiguredOopPricingCalculator.jsx');
    const navigationGuard = read('src/hooks/useUnsavedNavigationGuard.js');
    const back = calculator.slice(calculator.indexOf('const handleBack'), calculator.indexOf('const handleReset'));
    expect(back).toContain("dirty && !isArmed('back')");
    expect(back).toContain("arm('back')");
    expect(back).toContain('leaveBack()');
    expect(navigationGuard).toContain('navigate(onSentinel ? -2 : -1)');
    expect(calculator).toContain("isArmed('back') ? 'Confirm discard' : '← Back'");
  });
  it('keeps claim fields while making a linked-job lookup failure visible', () => {
    const calculator = read('src/components/oop/ConfiguredOopPricingCalculator.jsx');
    const select = calculator.slice(calculator.indexOf('const handleClaimSelect'), calculator.indexOf('const saveLegacy'));
    expect(select).toContain('setLinkedClaim(claim)');
    expect(select).toContain('setLinkedJob(null)');
    expect(select).toContain("db.rpc('get_claim_jobs'");
    expect(select).toContain("err('Claim selected, but its linked job could not be loaded. You can keep pricing this claim.')");
  });
  it('guards stale calculator loads, refreshes, claim lookups, and dirty internal navigation', () => {
    const calculator = read('src/components/oop/ConfiguredOopPricingCalculator.jsx');
    const builder = read('src/pages/settings/OopPricingBuilder.jsx');
    const navigationGuard = read('src/hooks/useUnsavedNavigationGuard.js');
    const initialLoad = calculator.slice(calculator.indexOf('const load = useCallback'), calculator.indexOf('const currentSnapshot'));
    const refreshStart = calculator.indexOf('const refreshSaved');
    const refresh = calculator.slice(refreshStart, calculator.indexOf('useResumeRefetch', refreshStart));
    const claimSelect = calculator.slice(calculator.indexOf('const handleClaimSelect'), calculator.indexOf('const saveLegacy'));
    expect(calculator).toContain('const loadRequestRef = useRef(0)');
    expect(initialLoad).toContain('locationRef.current === requestedLocationKey');
    expect(initialLoad).toContain('if (!current()) return;');
    expect(initialLoad).not.toContain('setLoading(true)');
    expect(builder.slice(builder.indexOf('const load = useCallback'), builder.indexOf('useEffect(() =>', builder.indexOf('const load = useCallback')))).not.toContain('setLoading(true)');
    expect(refresh).toContain('const requestedBaseline = baselineRef.current');
    expect(refresh).toContain('liveSnapshotRef.current !== requestedSnapshot');
    expect(refresh).toContain('liveSnapshotRef.current !== baselineRef.current');
    expect(claimSelect).toContain('const requestVersion = claimLoadRequestRef.current + 1');
    expect(claimSelect).toContain('claimLoadRequestRef.current !== requestVersion');
    expect(calculator).toContain('useUnsavedNavigationGuard({ dirty, navigate })');
    expect(builder).toContain('useUnsavedNavigationGuard({ dirty, navigate })');
    expect(navigationGuard).toContain("document.addEventListener('click', guardInternalNavigation, true)");
    expect(navigationGuard).toContain("window.addEventListener('popstate', guardHistoryBack)");
    expect(navigationGuard).toContain('window.history.forward()');
    expect(navigationGuard).toContain('event.stopPropagation()');
    expect(navigationGuard).toContain("const HISTORY_KEY = 'uprUnsavedNavigationGuard'");
    expect(navigationGuard).toContain('globalThis.crypto?.randomUUID');
    expect(navigationGuard).toContain("navigate(pending.target, onSentinel ? { replace: true } : undefined)");
    expect(calculator).toContain('Confirm discard');
    expect(builder).toContain('Confirm discard');
  });
  it('keeps the dedicated DevTools action for eligible-role OOP availability guarded by Force Off', () => {
    const devTools = read('src/pages/DevTools.jsx');
    expect(devTools).toContain('Make available to eligible roles');
    expect(devTools).toContain('setGlobalEnabled(flag, true)');
    expect(devTools).toContain("disabled={!!saving || oopState === 'global' || oopState === 'force_disabled'}");
  });
});
