/**
 * ════════════════════════════════════════════════
 * FILE: AppVersionSection.test.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Verifies the installed-version card presents real bundle identity or an
 *   honest unavailable state without inventing fallback metadata.
 *
 * DEPENDS ON:
 *   Packages:  react-dom, vitest
 *   Internal:  AppVersionSection.jsx
 *   Data:      none
 * ════════════════════════════════════════════════
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppVersionDetails } from './AppVersionSection.jsx';

describe('AppVersionDetails', () => {
  it('shows the installed marketing version and build together', () => {
    const output = renderToStaticMarkup(
      <AppVersionDetails
        info={{ state: 'ready', version: '1.0.0', build: '42.1' }}
      />,
    );

    expect(output).toContain('Version 1.0.0 (42.1)');
  });

  it('shows an honest unavailable state', () => {
    const output = renderToStaticMarkup(
      <AppVersionDetails info={{ state: 'unavailable' }} />,
    );

    expect(output).toContain('Version unavailable');
    expect(output).not.toContain('package.json');
  });
});
