/**
 * NATIVE-API-01 — the wiring, which no other test covers.
 *
 * The rewrite itself is unit-tested in src/lib/nativeApiFetch.test.js, but a
 * perfectly correct rewrite that is never installed fixes nothing — and that is
 * not a hypothetical: it sat committed and uninstalled for two commits. An audit
 * flagged "installNativeApiFetch() has zero call sites" as a gap no test caught.
 *
 * These are source-contract assertions (vitest runs `node` here, no jsdom).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('NATIVE-API-01 — installed at boot', () => {
  const main = read('src/main.jsx');

  it('main.jsx imports and calls it', () => {
    expect(main).toContain("import { installNativeApiFetch } from './lib/nativeApiFetch.js'");
    expect(main).toContain('installNativeApiFetch();');
  });

  it('runs before anything else that could issue a fetch', () => {
    // Order is the whole contract. A call placed after the first request leaves
    // that request going nowhere, which is the failure being fixed.
    const install = main.indexOf('installNativeApiFetch();');
    const diagnostics = main.indexOf('installPwaDiagnostics();');
    const render = main.indexOf('ReactDOM.createRoot');
    expect(install).toBeGreaterThan(-1);
    expect(install).toBeLessThan(diagnostics);
    expect(install).toBeLessThan(render);
  });
});

describe('NATIVE-API-01 — the build refuses a bad origin', () => {
  const config = read('vite.config.js');

  it('validates VITE_NATIVE_API_ORIGIN in the vite config', () => {
    // In vite.config.js specifically, NOT scripts/build-native.mjs, so it covers
    // every path that can emit a native bundle. capgo-deploy.yml runs `npx vite
    // build` directly and would bypass a build-script-only guard; it is dormant
    // today but the owner plans to adopt Capgo, and a guard that quietly stops
    // covering a path the day it is enabled is no guard at all.
    expect(config).toContain("import { parseNativeApiOrigin } from './src/lib/nativeApiOrigin.js'");
    expect(config).toContain('Native build refused');
  });

  it('refuses a present-but-invalid value, and allows a missing one', () => {
    // Missing is a deliberate default (dev), so throwing on absence would break
    // a plain local native build and dead-code the default.
    const at = config.indexOf('const nativeApiOrigin =');
    const block = config.slice(at, config.indexOf('}', config.indexOf('Native build refused')));
    expect(block).toContain("buildTarget === 'native'");
    expect(block).toContain('&& nativeApiOrigin &&');
    expect(block).toContain('!parseNativeApiOrigin(nativeApiOrigin)');
  });
});

describe('NATIVE-API-01 — the web build is not affected', () => {
  it('gates the install on the native platform inside the helper', () => {
    // main.jsx calls it unconditionally, so the guard has to live in the helper.
    // If this ever moves, the PWA gets a patched global fetch.
    const lib = read('src/lib/nativeApiFetch.js');
    expect(lib).toContain('if (!platform?.isNativePlatform?.()) return noop;');
  });

  it('only rewrites /api paths, so bundle assets are never sent to the network', () => {
    const lib = read('src/lib/nativeApiFetch.js');
    expect(lib).toContain('if (!isApiPath(url.pathname)) return null;');
  });
});
