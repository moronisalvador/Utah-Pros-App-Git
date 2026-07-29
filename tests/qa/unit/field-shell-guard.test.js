/**
 * AUTH-01 — every /tech/* route sits behind the field-shell role gate.
 *
 * Credential-free source contract. Before this guard, ProtectedRoute checked
 * only `isAuthenticated`, so any signed-in account — including the external
 * crm_partner identity — could render every field screen by typing the URL,
 * tapping a notification, or following a Universal Link. The only role logic
 * was getAccountLandingPath, which fires on '/' and nothing else.
 *
 * Slices TechRoutes the same way native-bundle-boundary.test.js does; that
 * test keeps passing as long as both function names survive.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('AUTH-01 — field shell route gate', () => {
  const source = read('src/App.jsx');
  const techRoutes = source.slice(
    source.indexOf('function TechRoutes()'),
    source.indexOf('function NativeRoutes()'),
  );

  it('wraps the tech shell in FieldShellRoute, inside ProtectedRoute', () => {
    expect(techRoutes).toContain('<FieldShellRoute>');
    expect(techRoutes).toContain('<TechLayout');
    // Order matters: authentication resolves first, so a signed-out visitor
    // gets /login rather than a "wrong account type" screen.
    expect(techRoutes.indexOf('<ProtectedRoute>'))
      .toBeLessThan(techRoutes.indexOf('<FieldShellRoute>'));
    expect(techRoutes.indexOf('<FieldShellRoute>'))
      .toBeLessThan(techRoutes.indexOf('<TechLayout'));
  });

  it('imports the guard', () => {
    expect(source).toMatch(/import FieldShellRoute from '@\/components\/FieldShellRoute'/);
  });

  it('renders a recoverable screen rather than redirecting', () => {
    // The native catch-all sends '*' to /tech, so <Navigate to="/tech"> for a
    // refused account would bounce forever. A rendered screen is escapable.
    const guard = read('src/components/FieldShellRoute.jsx');
    // Assert the IMPORT, not the string: the file's own docstring explains why
    // <Navigate> is wrong here, so a bare substring check matches the comment.
    expect(guard).not.toMatch(/import\s*\{[^}]*\bNavigate\b/);
    expect(guard).toContain('getAccountLandingPath');
    expect(guard).toContain('<Link');
  });

  it('derives the allowlist from authBootstrap, not a local copy', () => {
    const guard = read('src/components/FieldShellRoute.jsx');
    expect(guard).toContain("from '@/contexts/authBootstrap'");
    expect(guard).toContain('canUseFieldShell');
    // A second hard-coded role list is how the gate and the landing rule drift.
    expect(guard).not.toMatch(/\[\s*'field_tech'/);
  });

  it('does not weaken ProtectedRoute, which the office tree also uses', () => {
    const protectedRoute = read('src/components/ProtectedRoute.jsx');
    expect(protectedRoute).toContain('isAuthenticated');
    expect(protectedRoute).not.toContain('canUseFieldShell');
    expect(protectedRoute).not.toContain('role');
  });
});
