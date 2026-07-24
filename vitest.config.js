/**
 * ════════════════════════════════════════════════
 * FILE: vitest.config.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Splits credential-free application, Worker, and QA safety checks from database tests. It keeps
 *   build output, generated files, nested worktrees, browser tests, and unrelated lanes undiscovered.
 *
 * DEPENDS ON:
 *   Packages:  vite, vitest
 *   Internal:  tests/qa/setup/block-network.js
 *   Data:      reads  → test source selected by UPR_TEST_LANE
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - The database lane refuses direct invocation unless the local-only runner sets its sentinel.
 *   - Unknown or missing lane names fail closed instead of returning an empty green suite.
 * ════════════════════════════════════════════════
 */

import path from 'node:path';
import process from 'node:process';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

import { LOCAL_DATABASE_SENTINEL } from './tests/qa/lib/target-policy.mjs';

const lane = process.env.UPR_TEST_LANE;
const laneIncludes = {
  unit: [
    'src/**/*.test.{js,jsx}',
    'src/**/*.spec.{js,jsx}',
    'upr-mcp/src/**/*.test.js',
    'scripts/ios-release-workflow.test.js',
  ],
  worker: [
    'functions/**/*.test.js',
    'functions/**/*.spec.js',
  ],
  qa: [
    'tests/qa/unit/**/*.test.js',
    'tests/qa/unit/**/*.spec.js',
  ],
  db: [
    'supabase/tests/**/*.test.js',
  ],
};

if (!Object.hasOwn(laneIncludes, lane)) {
  throw new Error('UPR_TEST_LANE must be exactly unit, worker, qa, or db');
}
if (lane === 'db' && process.env.UPR_QA_CONFIRMED_LOCAL !== LOCAL_DATABASE_SENTINEL) {
  throw new Error('Database test discovery refused: use npm run test:db:local');
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: laneIncludes[lane],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-ssr/**',
      '**/.wrangler/**',
      '**/.claude/worktrees/**',
      '**/.agents/**',
      '**/.codex/**',
      '**/docs/generated/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'tests/qa/browser/**',
    ],
    passWithNoTests: false,
    setupFiles: lane === 'db' ? [] : ['./tests/qa/setup/block-network.js'],
  },
});
