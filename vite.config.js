/**
 * ════════════════════════════════════════════════
 * FILE: vite.config.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Settings for the local development server and the production build.
 *
 *   The one non-obvious part is where it looks for the local secrets file. That
 *   file (`.env.local`) is deliberately never committed, so it only exists in the
 *   main copy of the project. When someone works in a git "worktree" — a second
 *   folder checked out from the same repo, which is how most agent sessions run —
 *   that folder has no secrets file, so the app used to start with no database
 *   address and die instantly with a blank white page. This config now points the
 *   dev server back at the main copy's secrets file so it works from anywhere.
 *
 * DEPENDS ON:
 *   Packages:  vite, @vitejs/plugin-react, node:child_process, node:path, node:fs
 *   Internal:  ../.env.local of the MAIN checkout (read, never written),
 *              scripts/native-bundle-boundary.mjs, src/routes/buildTargetPages.*,
 *              src/routes/nativeAdminMobileShim.js
 *
 * NOTES / GOTCHAS:
 *   - `/api/*` proxies to :8788, which is only alive if the separate
 *     "Cloudflare Pages Functions" launch config is also running. Without it a
 *     worker call silently network-errors (documented in CLAUDE.md).
 *   - The envDir lookup is best-effort: if git is unavailable or this is not a
 *     worktree it falls back to this directory, i.e. Vite's default behavior.
 *   - Native builds resolve a separate page registry and fail if their completed
 *     module graph contains a web-only page or implementation subtree.
 * ════════════════════════════════════════════════
 */
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'
import process from 'node:process'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'

import {
  assertNativeBundleBoundary,
  resolveBuildTarget,
} from './scripts/native-bundle-boundary.mjs'
import { parseNativeApiOrigin } from './src/lib/nativeApiOrigin.js'

// This config is ESM, so `__dirname` does not exist at runtime — it only worked
// before because Vite transpiles the config file. Deriving it from import.meta
// is the correct ESM form and is also lint-clean.
const rootDir = path.dirname(fileURLToPath(import.meta.url))

/**
 * Where Vite should look for `.env*`.
 *
 * `.env.local` is gitignored, so a git worktree never receives a copy — verified
 * 2026-07-26: all 8 worktrees were missing it. A dev server started in one loaded
 * no VITE_SUPABASE_URL, so `createClient()` threw "supabaseUrl is required." while
 * main.jsx was still evaluating its imports. ReactDOM.createRoot never ran, and
 * because an uncaught ES-module evaluation error does not reach the console
 * capture, the only symptom was a blank page with a clean console — which cost
 * several sessions their visual verification step.
 *
 * `git rev-parse --git-common-dir` resolves to the MAIN checkout's .git even from
 * inside a worktree, so its parent is the main working copy. In the main checkout
 * this returns the same directory Vite would have used anyway, making the change
 * a no-op there.
 */
function resolveEnvDir(here) {
  try {
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: here,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (!common) return here
    const gitDir = path.isAbsolute(common) ? common : path.resolve(here, common)
    const mainRoot = path.dirname(gitDir)
    // Only redirect when the main checkout actually has an env file to offer.
    // Otherwise stay on Vite's default so CI behaves exactly as before.
    if (mainRoot !== here && fs.existsSync(path.join(mainRoot, '.env.local'))) {
      return mainRoot
    }
  } catch {
    // git missing, not a repo, or a permission problem — fall through.
  }
  return here
}

function nativeBundleBoundaryPlugin(repositoryRoot) {
  return {
    name: 'upr-native-bundle-boundary',
    apply: 'build',
    generateBundle(_options, bundle) {
      const moduleRecords = []
      for (const [chunk, output] of Object.entries(bundle)) {
        if (output.type !== 'chunk') continue
        for (const id of Object.keys(output.modules)) {
          moduleRecords.push({ id, chunk })
        }
      }
      assertNativeBundleBoundary(moduleRecords, repositoryRoot)
    },
  }
}

export default defineConfig(({ command, mode }) => {
  const envDir = resolveEnvDir(rootDir)
  const loadedEnv = loadEnv(mode, envDir, '')
  const buildTarget = resolveBuildTarget(
    process.env.VITE_BUILD_TARGET || loadedEnv.VITE_BUILD_TARGET,
  )
  const releaseSha = process.env.VITE_RELEASE_SHA
    || process.env.CF_PAGES_COMMIT_SHA
    || process.env.GITHUB_SHA
    || loadedEnv.VITE_RELEASE_SHA
    || ''
  const governedRelease = command === 'build' && (
    process.env.GITHUB_ACTIONS === 'true'
    || process.env.CF_PAGES === '1'
    || process.env.CI === 'true'
  )

  if (governedRelease && !releaseSha) {
    throw new Error(
      'Governed release build refused: inject VITE_RELEASE_SHA, '
      + 'CF_PAGES_COMMIT_SHA, or GITHUB_SHA.',
    )
  }

  // Where the installed app sends its /api calls. Validated HERE rather than in
  // scripts/build-native.mjs so it covers EVERY path that can produce a native
  // bundle, not just the one script. capgo-deploy.yml already runs `npx vite
  // build` directly and would bypass a build-script-only guard — that workflow
  // is dormant today (no Capgo subscription, and CapacitorUpdater ships with
  // autoUpdate false), but the owner intends to adopt it, and a guard that
  // silently stops covering a path the day it is switched on is worthless.
  //
  // A MISSING value is fine — nativeApiOrigin.js deliberately defaults to dev, so
  // an accident points a build at the test site rather than at production. A
  // PRESENT but untrustworthy value is refused, because silently falling back
  // would mean a release built for production quietly talking to dev.
  const nativeApiOrigin = process.env.VITE_NATIVE_API_ORIGIN
    || loadedEnv.VITE_NATIVE_API_ORIGIN
    || ''
  if (buildTarget === 'native' && nativeApiOrigin && !parseNativeApiOrigin(nativeApiOrigin)) {
    throw new Error(
      `Native build refused: VITE_NATIVE_API_ORIGIN="${nativeApiOrigin}" is not a `
      + 'bare https origin on an allowlisted host (see src/lib/nativeHosts.js). '
      + 'Leave it unset to use the dev default.',
    )
  }

  return {
    envDir,
    define: {
      'import.meta.env.VITE_BUILD_TARGET': JSON.stringify(buildTarget),
      ...(releaseSha
        ? {
          'import.meta.env.VITE_RELEASE_SHA': JSON.stringify(releaseSha),
        }
        : {}),
    },
    plugins: [
      react(),
      ...(buildTarget === 'native' ? [nativeBundleBoundaryPlugin(rootDir)] : []),
    ],
    resolve: {
      alias: [
        {
          find: '@/routes/buildTargetPages',
          replacement: path.resolve(
            rootDir,
            `./src/routes/buildTargetPages.${buildTarget}.jsx`,
          ),
        },
        // The BARREL only. `/href` was shimmed too until 2026-08-07, when the
        // bounded New Estimate slice was admitted: its two pages need real
        // estimate hrefs, and their routes now exist natively. The barrel stays
        // shimmed, which is what keeps TechMore's all-four "Admin" menu off the
        // phone — canAccessAdminMobile() still returns false there. Deeper paths
        // (AdminMobilePage, estimate/*) were never aliased; the module-graph guard
        // is what bounds them, via NATIVE_ADMIN_MOBILE_ALLOWLIST.
        ...(buildTarget === 'native'
          ? [{
            find: /^@\/components\/admin-mobile$/,
            replacement: path.resolve(rootDir, './src/routes/nativeAdminMobileShim.js'),
          }]
          : []),
        {
          find: '@',
          replacement: path.resolve(rootDir, './src'),
        },
      ],
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      // Deliberately NOT the default 'assets'.
      //
      // On 2026-07-27 a deploy race left three hashed files under /assets/
      // cached as text/html with `immutable, max-age=31536000` — a year — on
      // both the Cloudflare edge and end-user devices. Purging the edge fixed
      // the edge. It could not touch the copies already on a phone, and the
      // app's /reset recovery relies on Clear-Site-Data, which Safari does not
      // implement, so an iPhone had no way back at all.
      //
      // Moving the output directory changes every asset URL, so no device can
      // hold a poisoned copy of a path that has never existed. index.html is
      // served no-store, so clients pick up the new paths on the next load
      // with no cache clear, no reinstall, and nothing asked of a technician.
      //
      // This is a ONE-TIME un-poisoning. Do not bump it again as routine
      // practice.
      //
      // Recurrence is prevented by public/404.html, which stops Cloudflare
      // answering a missing file with the app's HTML at 200 OK, plus the boot
      // guard in index.html for devices already holding a bad copy.
      //
      // ⚠️ This comment used to credit "the /assets 404 rule in
      // public/_redirects". No such rule exists — two attempts to write one
      // were ignored by Cloudflare and a third broke real assets, so the file
      // never carried it. Corrected 2026-07-27; see public/_redirects.
      //
      // If you ever DO need to bump this, update public/_headers to match or
      // assets silently lose their immutable caching. Nothing needs to change
      // in public/_redirects: it lists app ROUTES, never asset paths, and a
      // rule matching an asset path would rewrite real assets to HTML.
      assetsDir: 'app-assets',
    },
    server: {
      proxy: {
        '/api': {
          target: 'http://localhost:8788',
          changeOrigin: true,
        },
      },
    },
  }
})
