/**
 * STAT-01 — status-bar style semantics.
 *
 * Capacitor's enum names the STYLE, not the text colour, and its own
 * definitions file documents:
 *   Style.Dark  = "Light text for dark backgrounds"
 *   Style.Light = "Dark text for light backgrounds"
 *
 * The previous helpers named the TEXT colour (statusBarDark = "dark text") and
 * mapped straight onto the same-sounding enum member, so both were inverted:
 * light theme painted white-on-white and dark theme dark-on-dark, on every
 * native route. This pins the mapping against Capacitor's real contract, so a
 * future rename cannot quietly flip it back.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('STAT-01 — status bar surface mapping', () => {
  it('still matches what Capacitor actually documents', () => {
    // If a Capacitor upgrade ever reverses these, the app is wrong again and
    // this is the test that says so.
    const defs = read('node_modules/@capacitor/status-bar/dist/esm/definitions.d.ts');
    expect(defs).toMatch(/Light text for dark backgrounds[\s\S]{0,120}Dark = "DARK"/);
    expect(defs).toMatch(/Dark text for light backgrounds[\s\S]{0,120}Light = "LIGHT"/);
  });

  it('maps a light surface to dark text and a dark surface to light text', () => {
    const source = read('src/lib/nativeAppearance.js');
    expect(source).toMatch(/light:\s*Style\.Light/);
    expect(source).toMatch(/dark:\s*Style\.Dark/);
  });

  it('keys the API on the SURFACE, never on the text colour', () => {
    // The old names are what caused the inversion; they must not come back.
    const source = read('src/lib/nativeAppearance.js');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '');   // strip the doc block
    expect(code).not.toMatch(/export function statusBarDark/);
    expect(code).not.toMatch(/export function statusBarLight/);
    expect(code).toContain('export function setStatusBarBase');
    expect(code).toContain('export function pushStatusBarSurface');
    expect(code).toContain('export function restoreStatusBarBase');
  });

  it('keeps the theme as the sole owner of the base style', () => {
    const theme = read('src/contexts/ThemeContext.jsx');
    expect(theme).toContain('setStatusBarBase');
    // Screens override and restore; only the theme sets the base.
    for (const hero of [
      'src/pages/tech/TechAppointment.jsx',
      'src/pages/tech/TechClaimDetail.jsx',
      'src/pages/tech/TechJobDetail.jsx',
    ]) {
      const source = read(hero);
      expect(source, hero).not.toContain('setStatusBarBase');
      expect(source, hero).toContain("pushStatusBarSurface('dark')");
    }
  });

  it('restores to the theme, not to a hardcoded style, on hero unmount', () => {
    // Restoring a fixed light-surface style stranded dark-on-dark after leaving
    // a hero screen in dark mode: the theme effect does not re-run, because the
    // theme itself never changed.
    for (const hero of [
      'src/pages/tech/TechAppointment.jsx',
      'src/pages/tech/TechClaimDetail.jsx',
      'src/pages/tech/TechJobDetail.jsx',
    ]) {
      const source = read(hero);
      expect(source, hero).toContain('return () => restoreStatusBarBase();');
    }
  });

  it('stays a no-op on web, so the PWA is untouched', () => {
    const source = read('src/lib/nativeAppearance.js');
    expect(source).toContain('const isNative = () => Capacitor.isNativePlatform();');
    expect(source).toMatch(/function apply\(surface\) \{\s*\n\s*if \(!isNative\(\)\) return;/);
  });
});
