/**
 * ════════════════════════════════════════════════
 * FILE: scripts/assert-native-dist.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Refuses to copy the wrong kind of build into the iPhone app. There are two
 *   builds of this site: the one for the website, and the one for the app. They
 *   look identical, but putting the website build inside the app quietly breaks
 *   notification links and exposes office screens the app is supposed to keep
 *   out — with no error message at all. This checks which one was built last and
 *   stops the copy if it was the website one.
 *
 * DEPENDS ON:
 *   Internal:  scripts/build-native.mjs writes the marker this reads
 *   Data:      reads  → dist/upr-native-build.json
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Wired into `npm run sync:ios`, so it covers build:ios, build:ios:dev and
 *     build:ios:dev:capgo. CI is unaffected: both iOS workflows run
 *     `node scripts/build-native.mjs` and then call `cap sync ios` directly, so
 *     they are already native by construction.
 *   - Vite empties dist/ on every build, so a stale marker cannot survive a
 *     later web build. Absent marker means "not a native build", never "unknown".
 *   - This is deliberately a BUILD-time gate, not a runtime one. A runtime
 *     refusal could brick a shipped app on a bad deploy; the mistake this
 *     prevents happens on a developer machine, so it fails there instead.
 * ════════════════════════════════════════════════
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const HELP = [
  '',
  '  Build the native bundle first:',
  '',
  '    npm run build:ios        # native bundle + cap sync ios',
  '    npm run build:ios:dev    # same, with APNs sandbox + native push',
  '',
  '  `npm run build` produces the WEB bundle. Inside the native shell that',
  '  bundle sets IS_NATIVE_BUILD=false, which silently disables every deep',
  '  link and ships the office/CRM/admin surface the native allowlist exists',
  '  to exclude. Neither failure reports anything at runtime.',
  '',
].join('\n');

export function assertNativeDist(root = repositoryRoot) {
  const distDir = path.join(root, 'dist');
  const markerPath = path.join(distDir, 'upr-native-build.json');

  if (!existsSync(distDir)) {
    throw new Error(`No dist/ directory — nothing has been built yet.\n${HELP}`);
  }
  if (!existsSync(markerPath)) {
    throw new Error(
      `dist/ was NOT produced by the native build target.\n${HELP}`,
    );
  }

  let marker;
  try {
    marker = JSON.parse(readFileSync(markerPath, 'utf8'));
  } catch (error) {
    throw new Error(
      `dist/upr-native-build.json is unreadable (${error?.message || error}).\n${HELP}`,
    );
  }
  if (marker?.target !== 'native') {
    throw new Error(
      `dist/ declares build target "${marker?.target}", expected "native".\n${HELP}`,
    );
  }
  return true;
}

// Only act as a gate when run directly, so the assertion stays importable.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assertNativeDist();
    console.log('assert-native-dist: dist/ is a native bundle');
  } catch (error) {
    console.error(`\nassert-native-dist: ${error.message}`);
    process.exit(1);
  }
}
