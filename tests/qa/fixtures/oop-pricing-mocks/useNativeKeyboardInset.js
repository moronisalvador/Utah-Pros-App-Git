/**
 * ════════════════════════════════════════════════
 * FILE: useNativeKeyboardInset.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Supplies an optional pretend keyboard height so the local test can check
 *   whether the calculator leaves scroll room below a focused field.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      reads  → local fixture URL only
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This checks page layout composition, not real WKWebView keyboard behavior.
 * ════════════════════════════════════════════════
 */
export default function useNativeKeyboardInset() {
  return new URLSearchParams(window.location.search).get('keyboardInset') === '1' ? 312 : 0;
}
