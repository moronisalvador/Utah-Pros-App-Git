/**
 * ════════════════════════════════════════════════
 * FILE: aasa-branch-identity.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   There are two UPR iPhone apps — the real one and a "UPR Dev" one — and two
 *   websites, utahpros.app and dev.utahpros.app. Apple decides which app a link
 *   is allowed to open by reading a small file the website publishes. Both
 *   websites are built from the same folder, so both were publishing the same
 *   file, and that file named only the real app. So a link texted from the dev
 *   site opened the REAL app, which then could not find the page and showed an
 *   error. This rewrites that one name as the site is built, so each website
 *   names the app that belongs to it.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  consumed by vite.config.js; the source file it rewrites is
 *              public/.well-known/apple-app-site-association
 *   Data:      reads  → none
 *              writes → none (the caller writes dist/)
 *
 * NOTES / GOTCHAS:
 *   - Only the app IDENTIFIERS are branch-derived. The path list stays in the
 *     checked-in file and is never generated, so there is exactly one place to
 *     edit when a route becomes deep-linkable, and dev cannot silently drift to
 *     a different set of routes than production.
 *   - Apple caches this file through its own CDN and an installed app only
 *     re-reads it on (re)install. Deploying a corrected file does not retroactively
 *     fix a device — the app has to be reinstalled.
 *   - This is only HALF of the association. The app must also claim the domain
 *     in its entitlements; iOS requires both sides to agree. The entitlements
 *     half lives in ios/App/App/App{,.Release,.Dev,.DevRelease}.entitlements.
 * ════════════════════════════════════════════════
 */

/** The App Store app, served from utahpros.app. */
export const PRODUCTION_APP_ID = 'H6ZUT739T9.com.utahprosrestoration.upr';

/** The side-by-side "UPR Dev" build, served from dev.utahpros.app. */
export const DEV_APP_ID = 'H6ZUT739T9.com.utahprosrestoration.upr.dev';

/**
 * Which app a given deploy branch should hand its links to.
 *
 * `main` is the only branch that reaches utahpros.app, so it is the only one
 * that names the production app. Everything else — `dev`, and every preview
 * branch — names the dev app. An absent branch means a local build, which is
 * not a deploy at all; it takes production so `dist/` matches the checked-in
 * file byte for byte and a local build never looks like a change.
 */
export function appIdForBranch(branch) {
  const name = String(branch ?? '').trim();
  if (!name || name === 'main') return PRODUCTION_APP_ID;
  return DEV_APP_ID;
}

/**
 * Rewrite the association file's identifiers for one branch, preserving
 * everything else — paths, ordering, and the empty `apps` array Apple requires.
 *
 * Returns the JSON text to write. Throws if the source is not the shape we
 * expect, because silently emitting a malformed association would disable
 * universal links across the whole domain with no error anywhere.
 */
export function retargetAssociation(sourceText, branch) {
  const appID = appIdForBranch(branch);

  let association;
  try {
    association = JSON.parse(sourceText);
  } catch (error) {
    throw new Error(
      `apple-app-site-association is not valid JSON: ${error?.message || error}`,
    );
  }

  const details = association?.applinks?.details;
  if (!Array.isArray(details) || details.length === 0) {
    throw new Error('apple-app-site-association has no applinks.details entries');
  }

  return `${JSON.stringify({
    ...association,
    applinks: {
      ...association.applinks,
      details: details.map((detail) => ({ ...detail, appID })),
    },
    ...(association.webcredentials ? { webcredentials: { apps: [appID] } } : {}),
  }, null, 2)}\n`;
}
