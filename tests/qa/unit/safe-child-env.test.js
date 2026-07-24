/**
 * ════════════════════════════════════════════════
 * FILE: safe-child-env.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves QA child processes inherit operating-system basics but no ambient credentials.
 *
 * DEPENDS ON:
 *   Internal: scripts/qa/safe-child-env.mjs
 *   Data: reads → synthetic environment fixture; writes → none
 * ════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';

import { safeChildEnv } from '../../../scripts/qa/safe-child-env.mjs';

describe('safeChildEnv', () => {
  it('keeps only named OS variables and explicit lane values', () => {
    const result = safeChildEnv({
      PATH: 'synthetic-path',
      TEMP: 'synthetic-temp',
      FIGMA_ACCESS_TOKEN: 'forbidden',
      GITHUB_TOKEN: 'forbidden',
      AWS_SECRET_ACCESS_KEY: 'forbidden',
      DATABASE_URL: 'forbidden',
      TWILIO_ACCOUNT_SID: 'forbidden',
    }, { UPR_TEST_LANE: 'qa' });

    expect(result).toEqual({
      PATH: 'synthetic-path',
      TEMP: 'synthetic-temp',
      UPR_TEST_LANE: 'qa',
    });
  });
});
