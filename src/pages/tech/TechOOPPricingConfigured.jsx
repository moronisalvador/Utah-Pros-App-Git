/**
 * ════════════════════════════════════════════════
 * FILE: TechOOPPricingConfigured.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Opens the configured out-of-pocket calculator inside the mobile field shell.
 *   The shared calculator keeps the same pricing while using phone-friendly controls.
 *
 * WHERE IT LIVES:
 *   Route:        /tech/tools/oop-pricing
 *   Rendered by:  src/routes/buildTargetPages.web.jsx and buildTargetPages.native.jsx
 *
 * DEPENDS ON:
 *   Packages:  React JSX runtime
 *   Internal:  ConfiguredOopPricingCalculator
 *   Data:      reads  → none directly; the rendered calculator uses OOP pricing RPCs
 *              writes → none directly; the rendered calculator saves through OOP quote RPCs
 *
 * NOTES / GOTCHAS:
 *   - This wrapper always selects the tech visual, navigation, tap, and haptic variant.
 *   - It is included in both the web and native field-tech registries.
 * ════════════════════════════════════════════════
 */
import ConfiguredOopPricingCalculator from '@/components/oop/ConfiguredOopPricingCalculator';

export default function TechOOPPricingConfigured() {
  return <ConfiguredOopPricingCalculator variant="tech" />;
}
