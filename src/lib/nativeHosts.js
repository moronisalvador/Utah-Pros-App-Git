/**
 * ════════════════════════════════════════════════
 * FILE: nativeHosts.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The list of web addresses that belong to us. Anything checking "is this one
 *   of our own sites?" — opening a link inside the app, copying a signing link,
 *   or deciding where the app sends its server requests — reads this one list.
 *
 * Exports:
 *   NATIVE_APP_HTTPS_HOSTS   frozen array of trusted hostnames
 *
 * DEPENDS ON:
 *   Packages:  none — deliberately
 *   Internal:  none
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - ZERO IMPORTS ON PURPOSE. This list used to live in nativeAppLinks.js,
 *     which imports @capacitor/app at module scope and therefore cannot be
 *     loaded by a plain Node script. The native build script needs to validate
 *     its configured API origin against these hosts BEFORE producing a bundle,
 *     so the list had to become importable outside a browser. Duplicating it was
 *     the alternative, and two allowlists that can drift apart is exactly the
 *     failure this file prevents. vite.config.js imports the parser that reads
 *     this list, so the check runs at build time for every native build path.
 *   - nativeAppLinks.js re-exports this, so every existing importer is
 *     unchanged and there is still one definition.
 * ════════════════════════════════════════════════
 */

/** Hostnames the app treats as its own: universal links, signing URLs, API origin. */
export const NATIVE_APP_HTTPS_HOSTS = Object.freeze([
  'utahpros.app',
  'dev.utahpros.app',
]);
