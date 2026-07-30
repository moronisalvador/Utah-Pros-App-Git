/**
 * ════════════════════════════════════════════════
 * FILE: reducedMotion.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Answers one question: has this person asked their phone to reduce motion?
 *   Some people get motion sick, dizzy or disoriented from sliding and zooming
 *   animations, so both iOS and every desktop browser offer a setting to turn
 *   them down. This lets the app honour it when it moves the screen itself.
 *
 * Exports:
 *   prefersReducedMotion()   true when the person asked for less motion
 *   scrollBehavior(pref)     'auto' under Reduce Motion, otherwise the argument
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - WHY THIS EXISTS IN JS AT ALL. CSS cannot fix a programmatic scroll:
 *     `scrollIntoView({ behavior: 'smooth' })` names its behaviour explicitly,
 *     and the spec says an explicit argument overrides the CSS `scroll-behavior`
 *     property. So the global reduced-motion block in index.css silences
 *     animations and transitions but is powerless over these seven call sites —
 *     they have to ask. MOTION-02 called this out: "JavaScript scrolling never
 *     checks the preference."
 *   - Read live, never cached. Someone can toggle Reduce Motion in Settings
 *     while the app is suspended and come straight back to a screen that is
 *     about to animate; a value captured at boot would be stale exactly then.
 *     matchMedia is cheap — this is not a per-frame call.
 *   - Fails to "motion is fine" when matchMedia is unavailable (older WebViews,
 *     SSR, a test environment). That matches the platform default and keeps the
 *     app's existing behaviour rather than silently flattening it everywhere.
 * ════════════════════════════════════════════════
 */

/** True when the OS/browser asks for reduced motion. */
export function prefersReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    // A malformed-query throw in an old engine must not break a scroll.
    return false;
  }
}

/**
 * Scroll behaviour to pass to scrollIntoView / scrollTo.
 *
 * Under Reduce Motion the scroll still happens — the destination is the
 * information, and skipping it would lose it. Only the travel is removed.
 */
export function scrollBehavior(preferred = 'smooth') {
  return prefersReducedMotion() ? 'auto' : preferred;
}
