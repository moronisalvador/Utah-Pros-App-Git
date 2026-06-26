/**
 * ════════════════════════════════════════════════
 * FILE: usePageTransition.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Gives a page a gentle left/right slide when you move between a list and a
 *   detail screen. It looks at whether you went "forward" (clicked into something)
 *   or "back" (the Back button) and hands back the matching CSS class, so the page
 *   slides in from the right going forward and from the left coming back. It stays
 *   still on the very first load / refresh so the app doesn't slide when it opens.
 *
 * WHERE IT LIVES:
 *   Used by:  src/pages/Collections.jsx, InvoiceEditor.jsx, EstimateEditor.jsx,
 *             ClaimCollectionPage.jsx — each puts the returned class on its root div.
 *
 * DEPENDS ON:
 *   Packages:  react-router-dom (useNavigationType)
 *   Internal:  the CSS classes .page-slide-fwd / .page-slide-back in src/index.css
 *
 * Exports:
 *   usePageTransition() → '' | 'page-slide-fwd' | 'page-slide-back'
 *
 * NOTES / GOTCHAS:
 *   - Direction comes from react-router's navigation type: PUSH = forward,
 *     POP = back, REPLACE = no slide (tab-param updates / redirects).
 *   - A module-level flag suppresses the slide on the first navigation of the
 *     session (cold load / hard refresh) so only in-app navigation animates.
 *   - Put the SAME returned class on both the loading and loaded return of a page,
 *     so the skeleton→content swap reuses the DOM node and the slide runs once.
 * ════════════════════════════════════════════════
 */

import { useEffect } from 'react';
import { useNavigationType } from 'react-router-dom';

// Shared across all callers: false until the first in-app navigation commits, so a
// cold load / refresh doesn't animate — only later list↔detail moves do.
let appHasNavigated = false;

export function usePageTransition() {
  const navType = useNavigationType(); // 'PUSH' | 'POP' | 'REPLACE'
  const first = !appHasNavigated;
  useEffect(() => { appHasNavigated = true; }, []);
  if (first || navType === 'REPLACE') return '';
  return navType === 'POP' ? 'page-slide-back' : 'page-slide-fwd';
}

export default usePageTransition;
