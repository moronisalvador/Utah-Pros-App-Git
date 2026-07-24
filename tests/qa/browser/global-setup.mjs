/**
 * ════════════════════════════════════════════════
 * FILE: global-setup.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Starts the synthetic loopback fixture inside the Playwright controller and closes it afterward.
 *   Keeping ownership in one process avoids orphan servers and makes a busy port fail the suite.
 *
 * DEPENDS ON:
 *   Packages:  Playwright setup lifecycle
 *   Internal:  scripts/qa/serve-browser-fixture.mjs
 *   Data:      reads  → synthetic fixture only
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - A server already using the governed port is a refusal, not something this setup reuses.
 * ════════════════════════════════════════════════
 */

import { createFixtureServer } from '../../../scripts/qa/serve-browser-fixture.mjs';

export default async function globalSetup() {
  const running = await createFixtureServer();
  return async () => {
    await running.close();
  };
}
