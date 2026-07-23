/**
 * ════════════════════════════════════════════════
 * FILE: messaging-auth.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the messaging worker uses the same fail-closed permission priority as
 *   the UI while excluding inactive and external accounts.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./messaging-auth.js, ./auth.js (mocked)
 *   Data:      none
 * ════════════════════════════════════════════════
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ auth: null }));
vi.mock('./auth.js', () => ({
  requireEmployee: (...args) => h.auth(...args),
}));

import { requireMessagingAccess } from './messaging-auth.js';

function dbFor({ flag, override, permission } = {}) {
  return {
    select: vi.fn(async (table) => {
      if (table === 'feature_flags') return flag === undefined ? [] : [flag];
      if (table === 'employee_page_access') return override === undefined ? [] : [override];
      if (table === 'nav_permissions') return permission === undefined ? [] : [permission];
      return [];
    }),
  };
}

beforeEach(() => {
  h.auth = vi.fn(async () => ({
    user: { id: 'user-1' },
    employee: {
      id: 'employee-1',
      role: 'office',
      is_active: true,
      is_external: false,
    },
  }));
});

describe('requireMessagingAccess', () => {
  it('passes through authentication failures without permission reads', async () => {
    h.auth = vi.fn(async () => ({ error: 'Invalid token', status: 401 }));
    const db = dbFor();

    await expect(requireMessagingAccess({}, {}, db)).resolves.toEqual({
      error: 'Invalid token',
      status: 401,
    });
    expect(db.select).not.toHaveBeenCalled();
  });

  it('rejects inactive employees', async () => {
    h.auth = vi.fn(async () => ({
      employee: { id: 'employee-1', role: 'admin', is_active: false, is_external: false },
    }));
    const result = await requireMessagingAccess({}, {}, dbFor());
    expect(result).toMatchObject({ status: 403, code: 'INACTIVE_EMPLOYEE' });
  });

  it('rejects external employees before page permission reads', async () => {
    h.auth = vi.fn(async () => ({
      employee: { id: 'employee-1', role: 'crm_partner', is_active: true, is_external: true },
    }));
    const db = dbFor();
    const result = await requireMessagingAccess({}, {}, db);
    expect(result).toMatchObject({ status: 403, code: 'MESSAGING_NOT_AUTHORIZED' });
    expect(db.select).not.toHaveBeenCalled();
  });

  it('honors a force-disabled page before every allow', async () => {
    h.auth = vi.fn(async () => ({
      employee: { id: 'employee-1', role: 'admin', is_active: true, is_external: false },
    }));
    const result = await requireMessagingAccess({}, {}, dbFor({ flag: { force_disabled: true } }));
    expect(result).toMatchObject({ status: 403, code: 'MESSAGING_DISABLED' });
  });

  it('lets an explicit employee deny override win over admin', async () => {
    h.auth = vi.fn(async () => ({
      employee: { id: 'employee-1', role: 'admin', is_active: true, is_external: false },
    }));
    const result = await requireMessagingAccess(
      {},
      {},
      dbFor({ override: { can_view: false } }),
    );
    expect(result).toMatchObject({ status: 403 });
  });

  it('lets an explicit employee allow override win over a missing role permission', async () => {
    const result = await requireMessagingAccess(
      {},
      {},
      dbFor({ override: { can_view: true } }),
    );
    expect(result.employee.id).toBe('employee-1');
  });

  it('allows an admin when there is no override or force-disable', async () => {
    h.auth = vi.fn(async () => ({
      employee: { id: 'employee-1', role: 'admin', is_active: true, is_external: false },
    }));
    const result = await requireMessagingAccess({}, {}, dbFor());
    expect(result.employee.role).toBe('admin');
  });

  it('allows a role with conversations can_view', async () => {
    const result = await requireMessagingAccess(
      {},
      {},
      dbFor({ permission: { can_view: true } }),
    );
    expect(result.employee.role).toBe('office');
  });

  it('fails closed when the role permission is absent or cannot be read', async () => {
    await expect(requireMessagingAccess({}, {}, dbFor())).resolves.toMatchObject({ status: 403 });

    const db = { select: vi.fn(async () => { throw new Error('db down'); }) };
    await expect(requireMessagingAccess({}, {}, db)).resolves.toEqual({
      error: 'Messaging authorization lookup failed',
      status: 500,
    });
  });
});
