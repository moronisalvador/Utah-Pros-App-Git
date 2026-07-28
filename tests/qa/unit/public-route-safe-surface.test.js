/**
 * SAFE-02 — every public native route declares a safe surface.
 *
 * /login, /sign/:token, /s/:code, /set-password, /privacy, /terms and /support
 * are registered outside TechRoutes, so none of them was inside `.tech-layout`
 * — the only element applying a top inset. `rg 'safe-area-inset'` across
 * SignPage, Legal, Login and SetPassword returned ZERO hits: not one public
 * route consumed it, and on a Dynamic Island device the signing header
 * collided with the Island.
 *
 * The value of this test is forward-looking: it fails when someone adds an
 * EIGHTH public route without a surface, which is how this regresses.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const app = read('src/App.jsx');
const nativeRoutes = app.slice(
  app.indexOf('function NativeRoutes()'),
  app.indexOf('function WebRoutes()'),
);
// Everything before TechRoutes() is the public half of the native tree.
const publicHalf = nativeRoutes.slice(0, nativeRoutes.indexOf('{TechRoutes()}'));

describe('SAFE-02 — public native routes have a safe surface', () => {
  it('wraps every public route in the shell', () => {
    const routes = [...publicHalf.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
    expect(routes.length).toBeGreaterThanOrEqual(7);
    for (const path of routes) {
      const at = publicHalf.indexOf(`path="${path}"`);
      const line = publicHalf.slice(at, publicHalf.indexOf('/>', at));
      expect(line, `${path} is not inside PublicNativeShell`).toContain('<PublicNativeShell');
    }
  });

  it('declares an explicit surface on each, never relying on the default', () => {
    const wraps = [...publicHalf.matchAll(/<PublicNativeShell surface="(light|dark)">/g)];
    expect(wraps.length).toBeGreaterThanOrEqual(7);
  });

  it('gives the dark-chrome routes dark surfaces and the rest light', () => {
    const surfaceFor = (path) => {
      const at = publicHalf.indexOf(`path="${path}"`);
      const line = publicHalf.slice(at, publicHalf.indexOf('/>', at));
      return line.match(/surface="(light|dark)"/)?.[1];
    };
    // Login and signing render their own dark chrome; light icons on a dark
    // header, dark icons on the light legal/password pages.
    expect(surfaceFor('/login')).toBe('dark');
    expect(surfaceFor('/sign/:token')).toBe('dark');
    expect(surfaceFor('/s/:code')).toBe('dark');
    expect(surfaceFor('/set-password')).toBe('light');
    expect(surfaceFor('/privacy')).toBe('light');
    expect(surfaceFor('/terms')).toBe('light');
    expect(surfaceFor('/support')).toBe('light');
  });

  it('stamps the native root marker before first paint', () => {
    // In an effect this would land one frame late and the route would visibly
    // jump under the Dynamic Island.
    expect(app).toMatch(/if \(IS_NATIVE && typeof document !== 'undefined'\) \{/);
    expect(app).toContain("document.documentElement.setAttribute('data-native', 'true')");
    expect(app).not.toMatch(/useEffect\([^)]*setAttribute\('data-native'/);
  });

  it('hands the status strip back on unmount rather than pinning a style', () => {
    const shell = read('src/components/PublicNativeShell.jsx');
    expect(shell).toContain('pushStatusBarSurface(surface)');
    expect(shell).toContain('return () => restoreStatusBarBase()');
    // Navigating login -> privacy -> back must not strand the previous style.
    expect(shell).toMatch(/\}, \[surface\]\)/);
  });
});
