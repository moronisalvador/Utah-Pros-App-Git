/**
 * ════════════════════════════════════════════════
 * FILE: target-policy.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the local QA lane accepts only its named loopback targets. It also proves production
 *   database targets, production websites, provider endpoints, and unsafe browser modes are denied.
 *
 * DEPENDS ON:
 *   Packages:  Node.js built-ins, vitest
 *   Internal:  tests/qa/lib/target-policy.mjs
 *   Data:      reads  → none
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - These are structural denial tests. They never contact any URL named in the fixtures.
 * ════════════════════════════════════════════════
 */

import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  LOCAL_BROWSER_ORIGIN,
  LOCAL_SUPABASE_ORIGIN,
  PRODUCTION_PROJECT_REF,
  assertBrowserTarget,
  assertCdpLaunchPolicy,
  assertLocalDatabaseTarget,
} from '../lib/target-policy.mjs';

describe('isolated QA target policy', () => {
  it('accepts only the exact governed local browser origin', () => {
    expect(assertBrowserTarget(`${LOCAL_BROWSER_ORIGIN}/qa?state=empty`)).toMatchObject({
      origin: LOCAL_BROWSER_ORIGIN,
      environment: 'local-fixture',
    });

    for (const target of [
      'http://localhost:4173/qa',
      'http://127.0.0.1:5173/qa',
      'https://dev.utahpros.app/',
      'https://utahpros.app/',
      'https://preview.pages.dev/',
      'data:text/html,test',
      'file:///tmp/test.html',
    ]) {
      expect(() => assertBrowserTarget(target), target).toThrow(/QA target denied/);
    }
  });

  it('rejects production Supabase identity and every non-local database origin', () => {
    expect(
      assertLocalDatabaseTarget({
        mode: 'local',
        projectRef: 'upr-local-qa',
        supabaseUrl: LOCAL_SUPABASE_ORIGIN,
      }),
    ).toMatchObject({ mode: 'local', origin: LOCAL_SUPABASE_ORIGIN });

    for (const target of [
      {
        mode: 'local',
        projectRef: PRODUCTION_PROJECT_REF,
        supabaseUrl: `https://${PRODUCTION_PROJECT_REF}.supabase.co`,
      },
      {
        mode: 'local',
        projectRef: 'upr-local-qa',
        supabaseUrl: `https://${PRODUCTION_PROJECT_REF}.supabase.co`,
      },
      {
        mode: 'hosted',
        projectRef: 'upr-local-qa',
        supabaseUrl: LOCAL_SUPABASE_ORIGIN,
      },
      {
        mode: 'local',
        projectRef: 'upr-local-qa',
        supabaseUrl: 'http://localhost:54321',
      },
      { mode: '', projectRef: '', supabaseUrl: '' },
    ]) {
      expect(() => assertLocalDatabaseTarget(target)).toThrow(/QA database target denied/);
    }
  });

  it('rejects provider and production egress even when the request is read-only', () => {
    for (const target of [
      'https://api.twilio.com/2010-04-01/Accounts.json',
      'https://api.stripe.com/v1/customers',
      'https://api.quickbooks.com/v3/company/1/query',
      'https://api.encircleapp.com/v1/organizations',
      `https://${PRODUCTION_PROJECT_REF}.supabase.co/rest/v1/employees`,
      'wss://dev.utahpros.app/realtime/v1/websocket',
    ]) {
      expect(() => assertBrowserTarget(target), target).toThrow(/QA target denied/);
    }
  });

  it('permits pipe-only ephemeral browser launches and denies TCP/profile reuse', () => {
    const repositoryRoot = path.join(os.tmpdir(), 'upr-qa-repository');
    const ephemeralProfile = path.join(os.tmpdir(), 'upr-qa-browser', 'run-123');
    const repositoryProfile = path.join(repositoryRoot, '.profile');
    const humanProfile = path.join(
      path.parse(repositoryRoot).root,
      'Users',
      'person',
      'AppData',
      'Local',
      'Google',
      'Chrome',
      'User Data',
    );

    expect(
      assertCdpLaunchPolicy({
        transport: 'pipe',
        userDataDir: ephemeralProfile,
        repositoryRoot,
      }),
    ).toMatchObject({ transport: 'pipe' });

    for (const target of [
      {
        transport: 'tcp',
        userDataDir: ephemeralProfile,
        repositoryRoot,
      },
      {
        transport: 'pipe',
        userDataDir: repositoryProfile,
        repositoryRoot,
      },
      {
        transport: 'pipe',
        userDataDir: humanProfile,
        repositoryRoot,
      },
    ]) {
      expect(() => assertCdpLaunchPolicy(target)).toThrow(/CDP launch denied/);
    }
  });
});
