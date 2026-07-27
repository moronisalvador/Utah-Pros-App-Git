/**
 * ════════════════════════════════════════════════
 * FILE: buildTargetPages.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Gives tests and editor tools a normal browser default when they resolve
 *   source files without Vite's build-target alias. Real Vite builds replace
 *   this path with the explicit web or native page list.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  src/routes/buildTargetPages.web.jsx
 *   Data:      reads  → none directly
 *              writes → none directly
 *
 * NOTES / GOTCHAS:
 *   - The native graph guard rejects this fallback if alias selection ever
 *     stops working, because it would otherwise pull the web registry into iOS.
 * ════════════════════════════════════════════════
 */
export { default, IS_NATIVE_BUILD } from './buildTargetPages.web.jsx';
