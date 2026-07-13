/**
 * ════════════════════════════════════════════════
 * FILE: IconButton.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A small square button that shows only an icon (no visible words) — like a ✕
 *   close or a pencil edit. Because there is no on-screen text, it REQUIRES a
 *   short `label` so screen readers can announce what it does; if you forget one,
 *   it complains in the console during development so the missing label gets
 *   caught before it ships. It also gives a gentle press feedback on tap and, on
 *   the installed phone app, a light haptic tick.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (shared primitive)
 *   Rendered by:  toolbars, card actions, modal close buttons (import from '@/components/ui')
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  src/lib/nativeHaptics (light press tick); styles in src/index.css (.ui-icon-btn)
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - `label` (or an explicit aria-label) is REQUIRED — it becomes the aria-label
 *     AND the title tooltip. Missing → console.error in dev (never throws; the app
 *     must not crash over an a11y lint). This is the a11y contract for the ~108
 *     unlabeled icon buttons W4 migrates onto this primitive.
 *   - Haptic is fire-and-forget and no-ops on desktop web (nativeHaptics handles
 *     the platform + reduced-motion checks). Press-scale is CSS, reduced-motion-safe.
 * ════════════════════════════════════════════════
 */

import { forwardRef } from 'react';
import { impact } from '@/lib/nativeHaptics';

const IconButton = forwardRef(function IconButton(
  { label, children, onClick, className = '', size, disabled = false, type = 'button', ...rest },
  ref,
) {
  const ariaLabel = label || rest['aria-label'];
  if (!ariaLabel && import.meta.env?.DEV) {
    // eslint-disable-next-line no-console
    console.error('IconButton: a `label` (or aria-label) is required for an icon-only button.');
  }

  const handleClick = (e) => {
    impact('light');
    onClick?.(e);
  };

  const sizeClass = size === 'sm' ? ' ui-icon-btn--sm' : '';
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      onClick={handleClick}
      aria-label={ariaLabel}
      title={ariaLabel}
      className={`ui-icon-btn${sizeClass}${className ? ' ' + className : ''}`}
      {...rest}
    >
      {children}
    </button>
  );
});

export default IconButton;
