/**
 * ════════════════════════════════════════════════
 * FILE: oop-pricing.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Opens the real OOP calculator inside a local test page. The query string
 *   selects its desk or field-tech form, while the QA runner supplies only
 *   made-up account and price-list data.
 *
 * WHERE IT LIVES:
 *   Route:        local QA fixture only
 *   Rendered by:  tests/qa/fixtures/oop-pricing.html
 *
 * DEPENDS ON:
 *   Packages:  react, react-dom, react-router-dom
 *   Internal:  src/components/oop/ConfiguredOopPricingCalculator.jsx, src/index.css
 *   Data:      reads  → synthetic fixture state only
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - The calculator is real; only its AuthContext and native keyboard hook
 *     are replaced by exact Vite aliases in the QA runner.
 * ════════════════════════════════════════════════
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, useNavigate } from 'react-router-dom';
import ConfiguredOopPricingCalculator from '@/components/oop/ConfiguredOopPricingCalculator';
import useUnsavedNavigationGuard from '@/hooks/useUnsavedNavigationGuard';

const query = new URLSearchParams(window.location.search);
const tech = query.get('variant') !== 'desktop';
const guardDirty = query.get('guardDirty') === '1';

export function NavigationGuardHarness({ dirty }) {
  const navigate = useNavigate();
  const {
    pendingNavigation,
    stay,
    confirmNavigation,
  } = useUnsavedNavigationGuard({ dirty, navigate });

  if (!pendingNavigation) return null;
  return (
    <div role="alert" data-qa-navigation-guard style={{ position: 'fixed', zIndex: 1000, inset: 'var(--space-3) var(--space-3) auto', padding: 'var(--space-3)', background: 'var(--warning-bg)', border: '1px solid var(--warning-border)' }}>
      <span>Synthetic unsaved navigation was blocked.</span>
      <button type="button" onClick={stay}>Stay</button>
      <button type="button" onClick={confirmNavigation}>Confirm discard</button>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <NavigationGuardHarness dirty={guardDirty} />
      {guardDirty ? (
        <main><h1>OOP Pricing Calculator</h1></main>
      ) : tech ? (
        <div className="tech-layout">
          <main className="tech-content">
            <ConfiguredOopPricingCalculator variant="tech" />
          </main>
        </div>
      ) : (
        <ConfiguredOopPricingCalculator variant="desktop" />
      )}
    </BrowserRouter>
  </React.StrictMode>,
);
