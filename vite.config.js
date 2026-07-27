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
 *   Internal:  ../.env.local of the MAIN checkout (read, never written)
 *
 * NOTES / GOTCHAS:
 *   - `/api/*` proxies to :8788, which is only alive if the separate
 *     "Cloudflare Pages Functions" launch config is also running. Without it a
 *     worker call silently network-errors (documented in CLAUDE.md).
 *   - The envDir lookup is best-effort: if git is unavailable or this is not a
 *     worktree it falls back to this directory, i.e. Vite's default behavior.
 * ════════════════════════════════════════════════
 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'

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

export default defineConfig({
  envDir: resolveEnvDir(rootDir),
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, './src'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8788',
        changeOrigin: true,
      },
    },
  },
})
