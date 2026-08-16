/**
 * ════════════════════════════════════════════════
 * FILE: scripts/assert-native-dist.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Refuses to copy a broken build into the iPhone app. It checks two things.
 *   First, which build this is: there are two builds of this site, one for the
 *   website and one for the app, and they look identical — but putting the
 *   website build inside the app quietly breaks notification links and exposes
 *   office screens the app is supposed to keep out. Second, what address the
 *   app was told to call: if the build was pointed at the developer's own
 *   laptop, the app works perfectly on that laptop and cannot log anyone in on
 *   a real phone. Neither mistake reports anything at all at runtime, so this
 *   stops the copy instead.
 *
 * DEPENDS ON:
 *   Internal:  scripts/build-native.mjs writes the marker this reads
 *   Data:      reads  → dist/upr-native-build.json, dist/**  (text assets)
 *              writes → none
 *
 * EXPORTS:
 *   assertNativeDist(root)     → true, or throws if dist/ is not a native build
 *   assertNoLoopbackHost(root) → true, or throws if a loopback URL is baked in
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
 *   - **The loopback patterns were MEASURED, not guessed** (2026-08-16), by
 *     building the same commit twice and grepping both bundles — once with
 *     `.env.local` pointed at the local stack and once at production. A correct
 *     native bundle contains `localhost` THREE times, all in vendored library
 *     code: gotrue-js's `http://localhost:9999` default, react-router's
 *     `http://localhost` base fallback, and a WebAuthn `=== 'localhost'`
 *     hostname check. So matching bare `localhost` — or even `://localhost` —
 *     fails a GOOD build, and a guard that cries wolf gets switched off. The
 *     patterns below scored ZERO on the clean bundle and 13 hits across 6 files
 *     on the broken one. Re-measure before widening any of them.
 *   - The marker deliberately carries no environment data, so the baked URL
 *     cannot be checked there: `build-native.mjs` keeps it byte-reproducible
 *     because the release workflow rejects Capacitor project drift. Scanning
 *     the emitted assets is what is left, and it is the stronger check anyway —
 *     it sees a loopback address baked in from ANY source, not just from
 *     `VITE_SUPABASE_URL`.
 * ════════════════════════════════════════════════
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

// ─── SECTION: Loopback-host guard (2026-08-16) ──────────────
//
// THE INCIDENT: a TestFlight build failed at sign-in with "load failed" on a
// real iPhone. `.env.local` held VITE_SUPABASE_URL=http://127.0.0.1:54321, Vite
// baked it into the bundle, and on the phone 127.0.0.1 IS the phone — nothing
// is listening. The simulator had passed, because it runs on the Mac where
// loopback reaches the Mac's own stack: the one device class that CANNOT
// reproduce this bug is the one used to verify it.
//
// assertNativeDist() above was green throughout — it was a genuine native
// build, with the wrong address compiled inside it. Same shape as every entry
// in `initiative-status.md`'s defect list: the check was green because of what
// it did not execute.

const LOOPBACK_PATTERNS = [
  // The whole 127.0.0.0/8 block, not just .1 — 127.0.0.2 is equally the phone.
  { label: 'an IPv4 loopback address', re: /\b127\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/ },
  // "all interfaces" on the build machine; unroutable from a phone.
  { label: 'the 0.0.0.0 wildcard address', re: /\b0\.0\.0\.0\b/ },
  // A URL's IPv6 loopback is always bracketed. Matching bare `::1` would be a
  // substring of ordinary minified code.
  { label: 'the IPv6 loopback [::1]', re: /\[::1\]/ },
  // `localhost` alone is NOT matchable — see the header. Only a localhost URL
  // carrying one of this repository's local dev ports is unambiguous: Supabase
  // API/db/Studio/Mailpit (54321-54324), Vite (5173), wrangler (8787/8788).
  {
    label: 'a localhost dev-server URL',
    re: /:\/\/localhost:(?:5432[1-4]|5173|878[78]|3000)\b/,
  },
];

// Skip files whose bytes are not text. Reading a PNG as utf8 cannot match the
// patterns above, but scanning megabytes of it wastes the developer's time.
const BINARY = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.pdf', '.mp4', '.mov', '.mp3', '.zip',
]);

function textFilesIn(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) textFilesIn(full, found);
    else if (!BINARY.has(path.extname(entry.name).toLowerCase())) found.push(full);
  }
  return found;
}

const LOOPBACK_HELP = [
  '',
  '  Your .env.local is pointed at the TIER 1 local stack. That is the right',
  '  setting for `npm run dev` and the wrong one for anything that goes on a',
  '  phone: Vite compiles VITE_* values INTO the bundle, and on a device a',
  '  loopback address resolves to the device itself.',
  '',
  '  Rebuild against a reachable origin:',
  '',
  '    VITE_SUPABASE_URL=https://<project>.supabase.co npm run build:ios',
  '',
  '  or swap the tier block in .env.local back to the hosted values. The',
  '  simulator will NOT catch this — it reaches your Mac over loopback, so a',
  '  broken bundle passes there and fails on the first real device.',
  '',
].join('\n');

/**
 * Refuse a native bundle that carries a loopback address.
 *
 * Build-time only, like the marker check above: this stops a bad bundle from
 * being copied into ios/App/App/public, and never runs on a shipped app.
 *
 * @throws {Error} listing every offending file when a loopback host is found
 */
export function assertNoLoopbackHost(root = repositoryRoot) {
  const distDir = path.join(root, 'dist');
  if (!existsSync(distDir)) {
    throw new Error(`No dist/ directory — nothing has been built yet.\n${HELP}`);
  }

  const offences = [];
  for (const file of textFilesIn(distDir)) {
    let source;
    try {
      source = readFileSync(file, 'utf8');
    } catch {
      continue; // unreadable is not evidence of a loopback host
    }
    for (const { label, re } of LOOPBACK_PATTERNS) {
      const match = source.match(re);
      if (match) {
        offences.push({
          file: path.relative(root, file),
          label,
          found: match[0],
        });
      }
    }
  }

  if (offences.length) {
    const lines = offences.map(
      (o) => `    ${o.file} — ${o.label} (${o.found})`,
    );
    throw new Error(
      `dist/ has ${offences.length} loopback reference(s) compiled in, so this ` +
      `bundle cannot reach anything from a phone:\n${lines.join('\n')}\n${LOOPBACK_HELP}`,
    );
  }
  return true;
}

// Only act as a gate when run directly, so the assertions stay importable.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assertNativeDist();
    assertNoLoopbackHost();
    console.log('assert-native-dist: dist/ is a native bundle with no loopback host');
  } catch (error) {
    console.error(`\nassert-native-dist: ${error.message}`);
    process.exit(1);
  }
}
