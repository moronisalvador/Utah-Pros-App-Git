/**
 * ════════════════════════════════════════════════
 * FILE: employeeDirectory.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the shared employee roster loader uses the safe directory contract
 *   and that historical message-author names are loaded/joined without changing
 *   unrelated messages.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  employeeDirectory.js
 *   Data:      none (in-memory fakes only)
 * ════════════════════════════════════════════════
 */
import { describe, expect, it, vi } from 'vitest';
import {
  attachEmployeeDirectory,
  employeeDirectoryMap,
  loadEmployeeDirectory,
  loadMessageAuthorDirectory,
  missingMessageAuthorMessageIds,
} from './employeeDirectory.js';

const MESSAGE_A = '10000000-0000-4000-8000-000000000001';
const MESSAGE_Z = '10000000-0000-4000-8000-000000000099';

describe('loadEmployeeDirectory', () => {
  it('calls the selector-safe RPC with an explicit inactive flag', async () => {
    const rows = [{ id: 'employee-a', full_name: 'Employee A' }];
    const db = { rpc: vi.fn().mockResolvedValue(rows) };

    await expect(loadEmployeeDirectory(db)).resolves.toBe(rows);
    expect(db.rpc).toHaveBeenCalledWith('get_employee_directory', {
      p_include_inactive: false,
    });

    await expect(
      loadEmployeeDirectory(db, { includeInactive: true }),
    ).resolves.toBe(rows);
    expect(db.rpc).toHaveBeenLastCalledWith('get_employee_directory', {
      p_include_inactive: true,
    });
  });

  it('normalizes non-array success bodies without hiding RPC failures', async () => {
    const emptyDb = { rpc: vi.fn().mockResolvedValue(null) };
    await expect(loadEmployeeDirectory(emptyDb)).resolves.toEqual([]);

    const denied = new Error('permission denied');
    const deniedDb = { rpc: vi.fn().mockRejectedValue(denied) };
    await expect(loadEmployeeDirectory(deniedDb)).rejects.toBe(denied);
  });
});

describe('loadMessageAuthorDirectory', () => {
  it('deduplicates loaded internal-note message IDs before the bounded RPC', async () => {
    const rows = [{ id: 'employee-z', full_name: 'Former Employee' }];
    const db = { rpc: vi.fn().mockResolvedValue(rows) };

    await expect(loadMessageAuthorDirectory(db, [
      MESSAGE_Z,
      MESSAGE_A,
      MESSAGE_Z,
      '',
      null,
      'pending-1',
    ])).resolves.toEqual(rows);
    expect(db.rpc).toHaveBeenCalledWith('get_message_author_directory', {
      p_message_ids: [MESSAGE_A, MESSAGE_Z],
    });
  });

  it('skips empty calls and preserves authorization failures', async () => {
    const emptyDb = { rpc: vi.fn() };
    await expect(loadMessageAuthorDirectory(emptyDb, [])).resolves.toEqual([]);
    expect(emptyDb.rpc).not.toHaveBeenCalled();

    const denied = new Error('permission denied');
    const deniedDb = { rpc: vi.fn().mockRejectedValue(denied) };
    await expect(
      loadMessageAuthorDirectory(deniedDb, [MESSAGE_Z]),
    ).rejects.toBe(denied);
  });

  it('chunks long loaded histories without weakening the server cap', async () => {
    const messageIds = Array.from(
      { length: 201 },
      (_, index) => (
        `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
      ),
    );
    const author = { id: 'employee-z', full_name: 'Former Employee' };
    const db = {
      rpc: vi.fn()
        .mockResolvedValueOnce([author])
        .mockResolvedValueOnce([author]),
    };

    await expect(
      loadMessageAuthorDirectory(db, messageIds),
    ).resolves.toEqual([author]);
    expect(db.rpc).toHaveBeenCalledTimes(2);
    expect(db.rpc.mock.calls[0][1].p_message_ids).toHaveLength(200);
    expect(db.rpc.mock.calls[1][1].p_message_ids).toHaveLength(1);
  });
});

describe('missingMessageAuthorMessageIds', () => {
  it('requests only loaded unresolved internal notes in stable order', () => {
    expect(missingMessageAuthorMessageIds([
      { id: MESSAGE_Z, type: 'internal_note', sent_by: 'employee-z' },
      { id: MESSAGE_A, type: 'sms_outbound', sent_by: 'employee-y' },
      { id: MESSAGE_A, type: 'internal_note', sent_by: 'employee-a' },
      { id: MESSAGE_Z, type: 'internal_note', sent_by: 'employee-z' },
      { id: 'pending-1', type: 'internal_note', sent_by: 'employee-z', _pending: true },
      { id: MESSAGE_A, type: 'internal_note', sent_by: null },
    ], [
      { id: 'employee-a', full_name: 'Active Employee' },
    ])).toEqual([MESSAGE_Z]);
  });
});

describe('employeeDirectoryMap', () => {
  it('indexes valid employee rows and ignores entries without an ID', () => {
    const employeeA = { id: 'employee-a', full_name: 'Employee A' };
    const employeeB = { id: 'employee-b', full_name: 'Employee B' };
    const directory = employeeDirectoryMap([
      employeeA,
      null,
      { full_name: 'Missing ID' },
      employeeB,
    ]);

    expect([...directory.entries()]).toEqual([
      ['employee-a', employeeA],
      ['employee-b', employeeB],
    ]);
  });
});

describe('attachEmployeeDirectory', () => {
  it('attaches only the non-sensitive sender name expected by message callers', () => {
    const message = { id: 'message-a', sent_by: 'employee-a', body: 'hello' };
    const directory = employeeDirectoryMap([
      {
        id: 'employee-a',
        full_name: 'Employee A',
        email: 'must-not-be-attached@example.invalid',
      },
    ]);

    expect(attachEmployeeDirectory(message, directory)).toEqual({
      ...message,
      employees: { full_name: 'Employee A' },
    });
  });

  it('preserves the original object when no join is needed or allowed', () => {
    const existing = {
      id: 'message-a',
      sent_by: 'employee-a',
      employees: { full_name: 'Existing Name' },
    };
    const missingSender = { id: 'message-b', sent_by: null };
    const unknownSender = { id: 'message-c', sent_by: 'employee-c' };
    const directory = employeeDirectoryMap([
      { id: 'employee-a', full_name: 'Employee A' },
    ]);

    expect(attachEmployeeDirectory(existing, directory)).toBe(existing);
    expect(attachEmployeeDirectory(missingSender, directory))
      .toBe(missingSender);
    expect(attachEmployeeDirectory(unknownSender, directory))
      .toBe(unknownSender);
    expect(attachEmployeeDirectory(null, directory)).toBeNull();
  });
});
