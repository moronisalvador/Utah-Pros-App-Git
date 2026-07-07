/**
 * ════════════════════════════════════════════════
 * FILE: AdminDash.render.test.jsx  (Admin Mobile — F-2 render-gate smoke test)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Renders the REAL admin dashboard page two ways — once as an admin WITHOUT
 *   financial access, once WITH it — and proves the money cards' titles only
 *   appear in the second case. It also proves that merely drawing the page runs
 *   no database calls (each card fetches only after it is on screen), so a
 *   non-privileged admin's money RPCs are never even reached. This is the
 *   component-level half of finding F-2 (the data half lives in ./dashPlan.test.js).
 *
 * DEPENDS ON:
 *   Packages:  vitest, react-dom/server (renderToStaticMarkup — no jsdom here),
 *              react-router-dom (MemoryRouter for the card footer <Link>s)
 *   Internal:  the real AdminDash page (AuthContext is mocked to control canAccess)
 *   Data:      reads → none · writes → none (db.rpc is a spy that must stay unused)
 *
 * NOTES / GOTCHAS:
 *   - Named F-2 test — do not weaken. Mirrors the P2 gate posture: a gated card is
 *     never mounted, so it neither renders nor fetches.
 *   - renderToStaticMarkup does not run effects, so the spy staying at zero calls
 *     is the honest proof that render alone triggers no fetch.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

// Controllable auth: the tests flip `canFin` and inspect the rpc spy.
const rpc = vi.fn(async () => ({}));
let canFin = false;
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ canAccess: () => canFin, db: { rpc } }),
}));

// Imported AFTER the mock is registered.
const { default: AdminDash } = await import('@/pages/tech/admin/AdminDash');

const FINANCIAL_TITLES = ['Revenue recognized', 'Payments received', 'Avg ticket', 'Collections'];
const render = () => renderToStaticMarkup(<MemoryRouter><AdminDash /></MemoryRouter>);

beforeEach(() => { rpc.mockClear(); });

describe('AdminDash financial gate (finding F-2)', () => {
  it('hides every money card — and fetches nothing — for an admin without financial access', () => {
    canFin = false;
    const out = render();
    for (const t of FINANCIAL_TITLES) expect(out).not.toContain(t);
    // operational cards are still on screen
    expect(out).toContain('New jobs closed');
    expect(out).toContain('Employee status');
    // rendering alone reached no RPC
    expect(rpc).not.toHaveBeenCalled();
  });

  it('shows the money cards for an admin WITH financial access', () => {
    canFin = true;
    const out = render();
    for (const t of FINANCIAL_TITLES) expect(out).toContain(t);
  });

  it('always shows the period switch', () => {
    canFin = false;
    expect(render()).toContain('MTD');
  });
});
