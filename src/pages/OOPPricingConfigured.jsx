/**
 * ════════════════════════════════════════════════
 * FILE: OOPPricingConfigured.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Opens the configured out-of-pocket calculator in the main desktop app.
 *   The shared calculator owns the pricing, loading, saving, and display work.
 *
 * WHERE IT LIVES:
 *   Route:        /tools/oop-pricing
 *   Rendered by:  src/routes/buildTargetPages.web.jsx
 *
 * DEPENDS ON:
 *   Packages:  React JSX runtime
 *   Internal:  ConfiguredOopPricingCalculator
 *   Data:      reads  → none directly; the rendered calculator uses OOP pricing RPCs
 *              writes → none directly; the rendered calculator saves through OOP quote RPCs
 *
 * NOTES / GOTCHAS:
 *   - This wrapper always selects the desktop visual and navigation variant.
 *   - Route access remains outside this file in FeatureRoute(tool:oop_pricing).
 * ════════════════════════════════════════════════
 */
import ConfiguredOopPricingCalculator from '@/components/oop/ConfiguredOopPricingCalculator';

export default function OOPPricingConfigured() {
  return <ConfiguredOopPricingCalculator variant="desktop" />;
}
