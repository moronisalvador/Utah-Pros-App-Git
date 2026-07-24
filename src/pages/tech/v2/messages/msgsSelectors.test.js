/**
 * ════════════════════════════════════════════════
 * FILE: msgsSelectors.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the tech messaging thread's pure logic by hand — the pieces most likely to
 *   break silently: merging server pages into the right order, computing the "load
 *   older" cursor, reconciling optimistic "Sending…" bubbles so none linger as ghosts,
 *   grouping messages under day headers, unread math, and folding a deep-linked
 *   conversation into the inbox. These are the named B1 tests (red→green). No DB, no
 *   React — hand-built TEST fixtures only.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, `npm test` / vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./msgsSelectors
 *   Data:      none — fixtures only, never live rows
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import {
  flattenThreadPages, nextThreadCursor, mergeOverlay, reconcileOverlay,
  appendMessageToPages, mergeNewestPage, patchMessageInPages, dayKeyOf, groupMessagesByDay,
  convoUnread, mergeConvoIntoList, hasConversation,
  markPendingByMatch, dropByClientId,
  setConvoUnreadInData, isMultiConversation, recipientCount, summarizeSendResult,
  groupTemplates,
} from './msgsSelectors.js';

// A server row as get_tech_conversations / messages returns it (created_at ISO).
const msg = (id, body, created_at, extra = {}) => ({
  id, type: 'sms_outbound', body, status: 'sent', created_at, ...extra,
});

describe('page-merge + cursor selectors', () => {
  // Pages come back created_at DESC, newest page first.
  const page0 = [msg('m4', 'four', '2026-07-09T10:04:00Z'), msg('m3', 'three', '2026-07-09T10:03:00Z')];
  const page1 = [msg('m2', 'two', '2026-07-09T10:02:00Z'), msg('m1', 'one', '2026-07-09T10:01:00Z')];

  it('flattens pages ascending (oldest→newest) across page boundaries', () => {
    const flat = flattenThreadPages([page0, page1]);
    expect(flat.map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4']);
  });

  it('returns [] for missing/empty pages', () => {
    expect(flattenThreadPages(undefined)).toEqual([]);
    expect(flattenThreadPages([])).toEqual([]);
  });

  it('cursor = oldest created_at of a FULL last page', () => {
    expect(nextThreadCursor(page1, 2)).toBe('2026-07-09T10:01:00Z');
  });

  it('cursor = undefined when the last page was short (no more history)', () => {
    expect(nextThreadCursor([msg('m1', 'one', '2026-07-09T10:01:00Z')], 2)).toBeUndefined();
    expect(nextThreadCursor([], 2)).toBeUndefined();
  });
});

describe('overlay reconcile — dedupe by id / pending-match by type+body / append', () => {
  const server = [msg('s1', 'hi', '2026-07-09T10:00:00Z')];

  it('appends an un-reconciled optimistic bubble after the server list', () => {
    const overlay = [{ id: 'pending-1', _clientId: 'pending-1', _pending: true, type: 'sms_outbound', body: 'new one', created_at: '2026-07-09T10:05:00Z' }];
    const out = mergeOverlay(server, overlay);
    expect(out.map((m) => m.id)).toEqual(['s1', 'pending-1']);
  });

  it('drops an optimistic bubble the server already has by id (dedupe by id)', () => {
    const overlay = [{ id: 's1', _clientId: 'pending-1', _pending: true, type: 'sms_outbound', body: 'hi', created_at: '2026-07-09T10:00:00Z' }];
    expect(mergeOverlay(server, overlay).map((m) => m.id)).toEqual(['s1']);
  });

  it('drops an optimistic ghost matched by type+body when ids differ (lost reconcile)', () => {
    const overlay = [{ id: 'pending-9', _clientId: 'pending-9', _pending: true, type: 'sms_outbound', body: 'hi', created_at: '2026-07-09T10:00:01Z' }];
    // server 's1' has same type+body → the pending twin is a ghost, filtered out.
    expect(mergeOverlay(server, overlay).map((m) => m.id)).toEqual(['s1']);
  });

  it('reconcileOverlay removes the matching entry by _clientId', () => {
    const overlay = [
      { id: 'pending-1', _clientId: 'pending-1', _pending: true, type: 'sms_outbound', body: 'a' },
      { id: 'pending-2', _clientId: 'pending-2', _pending: true, type: 'sms_outbound', body: 'b' },
    ];
    const real = msg('r1', 'a', '2026-07-09T10:06:00Z');
    const out = reconcileOverlay(overlay, real, 'pending-1');
    expect(out.map((o) => o._clientId)).toEqual(['pending-2']);
  });

  it('reconcileOverlay removes a pending entry by type+body when the clientId is unknown', () => {
    const overlay = [{ id: 'pending-1', _clientId: 'pending-1', _pending: true, type: 'sms_outbound', body: 'a', created_at: '2026-07-09T10:05:00Z' }];
    const real = msg('r1', 'a', '2026-07-09T10:06:00Z');
    expect(reconcileOverlay(overlay, real)).toEqual([]);
  });

  it('reconciles identical consecutive sends one-for-one', () => {
    const overlay = [
      { id: 'pending-1', _clientId: 'pending-1', _pending: true, type: 'sms_outbound', body: 'same', created_at: '2026-07-09T10:05:00Z' },
      { id: 'pending-2', _clientId: 'pending-2', _pending: true, type: 'sms_outbound', body: 'same', created_at: '2026-07-09T10:05:01Z' },
    ];
    const real = msg('r1', 'same', '2026-07-09T10:06:00Z', { client_request_id: 'pending-1' });

    expect(reconcileOverlay(overlay, real).map((o) => o.id)).toEqual(['pending-2']);
    expect(mergeOverlay([real], overlay).map((o) => o.id)).toEqual(['pending-2', 'r1']);
  });

  it('does not hide a new send behind an old identical canonical row', () => {
    const old = msg('old', 'same', '2026-07-09T10:04:00Z');
    const pending = {
      id: 'pending-1',
      _clientId: 'pending-1',
      _pending: true,
      type: 'sms_outbound',
      body: 'same',
      created_at: '2026-07-09T10:05:00Z',
    };
    expect(mergeOverlay([old], [pending]).map((o) => o.id)).toEqual(['old', 'pending-1']);
  });

  it('reserves an out-of-order durable confirmation for the correct identical send', () => {
    const overlay = [
      { id: 'pending-1', _clientId: 'pending-1', _pending: true, type: 'sms_outbound', body: 'same', created_at: '2026-07-09T10:05:00Z' },
      { id: 'pending-2', _clientId: 'pending-2', _pending: true, type: 'sms_outbound', body: 'same', created_at: '2026-07-09T10:05:01Z' },
    ];
    const secondConfirmed = msg('real-2', 'same', '2026-07-09T10:05:02Z', {
      client_request_id: 'pending-2',
    });

    expect(mergeOverlay([secondConfirmed], overlay).map((o) => o.id))
      .toEqual(['pending-1', 'real-2']);
  });

  it('normalizes JSON and array media identity for bounded fallback reconciliation', () => {
    const pending = {
      id: 'pending-1',
      _pending: true,
      type: 'sms_outbound',
      body: 'photo',
      media_urls: ['b', 'a'],
      created_at: '2026-07-09T10:05:00Z',
    };
    const real = msg('real', 'photo', '2026-07-09T10:05:02Z', {
      media_urls: '["a","b"]',
    });
    expect(mergeOverlay([real], [pending]).map((o) => o.id)).toEqual(['real']);
  });

  it('orders resumed inbound rows after an older lingering failed overlay', () => {
    const server = [
      msg('old', 'old', '2026-07-09T10:00:00Z'),
      msg('in-1', 'new 1', '2026-07-09T10:07:00Z', { type: 'sms_inbound' }),
      msg('in-2', 'new 2', '2026-07-09T10:08:00Z', { type: 'sms_inbound' }),
    ];
    const failed = [{
      id: 'pending-1',
      _clientId: 'pending-1',
      _failed: true,
      type: 'sms_outbound',
      body: 'failed',
      created_at: '2026-07-09T10:05:00Z',
    }];
    expect(mergeOverlay(server, failed).map((o) => o.id))
      .toEqual(['old', 'pending-1', 'in-1', 'in-2']);
  });

  it('reconcileOverlay never mutates the input', () => {
    const overlay = [{ id: 'pending-1', _clientId: 'pending-1', _pending: true, type: 'sms_outbound', body: 'a' }];
    const copy = JSON.parse(JSON.stringify(overlay));
    reconcileOverlay(overlay, msg('r1', 'a', '2026-07-09T10:06:00Z'), 'pending-1');
    expect(overlay).toEqual(copy);
  });
});

describe('appendMessageToPages / patchMessageInPages', () => {
  const pages = [[msg('m2', 'two', '2026-07-09T10:02:00Z')], [msg('m1', 'one', '2026-07-09T10:01:00Z')]];

  it('prepends a newer message to page 0', () => {
    const out = appendMessageToPages(pages, msg('m3', 'three', '2026-07-09T10:03:00Z'));
    expect(out[0].map((m) => m.id)).toEqual(['m3', 'm2']);
    expect(flattenThreadPages(out).map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('is a no-op (same ref) when the id already exists — dedupe by id', () => {
    const out = appendMessageToPages(pages, msg('m1', 'one', '2026-07-09T10:01:00Z'));
    expect(out).toBe(pages);
  });

  it('creates the first page when none exist', () => {
    expect(appendMessageToPages([], msg('m1', 'one', '2026-07-09T10:01:00Z'))).toEqual([[msg('m1', 'one', '2026-07-09T10:01:00Z')]]);
  });

  it('patches a row by id and preserves the employees embed', () => {
    const withEmp = [[{ ...msg('m2', 'two', '2026-07-09T10:02:00Z'), employees: { full_name: 'Jane' } }]];
    const out = patchMessageInPages(withEmp, { ...msg('m2', 'two', '2026-07-09T10:02:00Z'), status: 'delivered' });
    expect(out[0][0].status).toBe('delivered');
    expect(out[0][0].employees).toEqual({ full_name: 'Jane' });
  });

  it('patch is a no-op (same ref) when the id is not loaded (never refetch)', () => {
    const out = patchMessageInPages(pages, msg('nope', 'x', '2026-07-09T11:00:00Z'));
    expect(out).toBe(pages);
  });

  it('carrier-retry: markPendingByMatch flips a real failed row in place; dropByClientId then clears it', () => {
    const failed = [[{ ...msg('m2', 'two', '2026-07-09T10:02:00Z'), status: 'failed', _failed: true }]];
    const flipped = markPendingByMatch(failed, 'm2', 'm2');
    expect(flipped[0][0]._pending).toBe(true);
    expect(flipped[0][0]._clientId).toBe('m2');
    expect(flipped[0][0].status).toBe('pending');
    // Success arrives with a NEW row → drop the flipped one, append the real row.
    const cleaned = appendMessageToPages(dropByClientId(flipped, 'm2'), msg('m5', 'two', '2026-07-09T10:05:00Z'));
    expect(cleaned.flat().map((m) => m.id)).toEqual(['m5']);
  });

  it('dropByClientId is a no-op (same ref) for the optimistic path (bubbles live in the overlay)', () => {
    expect(dropByClientId(pages, 'pending-1')).toBe(pages);
  });

  it('resume merge patches the newest page without discarding loaded history', () => {
    const loaded = [
      [
        { ...msg('m3', 'three', '2026-07-09T10:03:00Z'), status: 'sent' },
        msg('m2', 'two', '2026-07-09T10:02:00Z'),
      ],
      [msg('m1', 'one', '2026-07-09T10:01:00Z')],
    ];
    const refreshed = [
      msg('m4', 'four', '2026-07-09T10:04:00Z'),
      { ...msg('m3', 'three', '2026-07-09T10:03:00Z'), status: 'delivered' },
    ];

    const merged = mergeNewestPage(loaded, refreshed);

    expect(merged[0].map((message) => message.id)).toEqual(['m4', 'm3', 'm2']);
    expect(merged[0][1].status).toBe('delivered');
    expect(merged[1].map((message) => message.id)).toEqual(['m1']);
  });
});

describe('day-divider grouping', () => {
  it('same local day groups under one header; a new day inserts a divider', () => {
    const items = groupMessagesByDay([
      msg('a', 'morning', '2026-07-08T09:00:00'),
      msg('b', 'noon', '2026-07-08T12:00:00'),
      msg('c', 'next day', '2026-07-09T08:00:00'),
    ]);
    const shape = items.map((i) => (i.type === 'day' ? `DAY:${i.key}` : i.data.id));
    expect(shape).toEqual(['DAY:2026-07-08', 'a', 'b', 'DAY:2026-07-09', 'c']);
  });

  it('dayKeyOf is local-YYYY-MM-DD and tolerates junk', () => {
    expect(dayKeyOf('2026-07-08T09:00:00')).toBe('2026-07-08');
    expect(dayKeyOf('')).toBe('');
    expect(dayKeyOf('not-a-date')).toBe('');
  });

  it('empty input → no items', () => {
    expect(groupMessagesByDay([])).toEqual([]);
  });
});

describe('unread math', () => {
  it('positive unread_count → unread with the count', () => {
    expect(convoUnread({ unread_count: 3 })).toEqual({ isUnread: true, count: 3 });
  });
  it('zero / missing → not unread', () => {
    expect(convoUnread({ unread_count: 0 })).toEqual({ isUnread: false, count: 0 });
    expect(convoUnread({})).toEqual({ isUnread: false, count: 0 });
  });
});

describe('deep-link miss path (mergeConvoIntoList)', () => {
  const list = [
    { id: 'c2', title: 'B', sort_key: '2026-07-09T10:02:00Z' },
    { id: 'c1', title: 'A', sort_key: '2026-07-09T10:01:00Z' },
  ];

  it('hasConversation detects presence/absence', () => {
    expect(hasConversation(list, 'c1')).toBe(true);
    expect(hasConversation(list, 'zzz')).toBe(false);
  });

  it('inserts a fetched conversation missing from the list, keeping sort_key DESC', () => {
    const fetched = { id: 'c3', title: 'C', sort_key: '2026-07-09T10:03:00Z' };
    const out = mergeConvoIntoList(list, fetched);
    expect(out.map((c) => c.id)).toEqual(['c3', 'c2', 'c1']);
  });

  it('replaces in place (no dupe) when already present', () => {
    const out = mergeConvoIntoList(list, { id: 'c1', title: 'A+', sort_key: '2026-07-09T10:01:00Z' });
    expect(out.map((c) => c.id)).toEqual(['c2', 'c1']);
    expect(out.find((c) => c.id === 'c1').title).toBe('A+');
  });
});

// ─── B2 additions ──────────────────────────────────────────────────────────────

describe('B2 · setConvoUnreadInData (mark read/unread + badge)', () => {
  const data = {
    conversations: [
      { id: 'c1', unread_count: 3 },
      { id: 'c2', unread_count: 0 },
    ],
    unread_total: 5, // c1 has 3, other pages carry 2 more
  };

  it('mark-read (0) clears the row and drops unread_total by that delta', () => {
    const out = setConvoUnreadInData(data, 'c1', 0);
    expect(out.conversations.find((c) => c.id === 'c1').unread_count).toBe(0);
    expect(out.unread_total).toBe(2);
  });

  it('mark-unread (1) raises the row and bumps unread_total by the delta', () => {
    const out = setConvoUnreadInData(data, 'c2', 1);
    expect(out.conversations.find((c) => c.id === 'c2').unread_count).toBe(1);
    expect(out.unread_total).toBe(6);
  });

  it('returns the SAME reference when nothing changes (no needless notify)', () => {
    expect(setConvoUnreadInData(data, 'c2', 0)).toBe(data);      // already 0
    expect(setConvoUnreadInData(data, 'missing', 1)).toBe(data); // not present
    expect(setConvoUnreadInData(null, 'c1', 0)).toBe(null);
  });

  it('clamps unread_total at 0', () => {
    const skewed = { conversations: [{ id: 'c1', unread_count: 3 }], unread_total: 1 };
    expect(setConvoUnreadInData(skewed, 'c1', 0).unread_total).toBe(0);
  });
});

describe('B2 · group/broadcast helpers', () => {
  const parts = (n) => Array.from({ length: n }, (_, i) => ({ contact_id: `p${i}`, is_active: true }));

  it('isMultiConversation is true for group/broadcast only', () => {
    expect(isMultiConversation({ type: 'group' })).toBe(true);
    expect(isMultiConversation({ type: 'broadcast' })).toBe(true);
    expect(isMultiConversation({ type: 'direct' })).toBe(false);
    expect(isMultiConversation(null)).toBe(false);
  });

  it('recipientCount counts active participants', () => {
    expect(recipientCount({ conversation_participants: parts(3) })).toBe(3);
    const mixed = { conversation_participants: [{ is_active: true }, { is_active: false }, { is_active: true }] };
    expect(recipientCount(mixed)).toBe(2);
    expect(recipientCount({})).toBe(0);
  });

  it('summarizeSendResult tallies sent / blocked / failed from the twilio[] array', () => {
    const twilio = [
      { sid: 'SM1', contact_id: 'a' },                 // sent
      { skipped: true, code: 'DND_ACTIVE', to: 'b' },  // blocked
      { skipped: true, code: 'NO_CONSENT', to: 'c' },  // blocked
      { error: 'boom', error_code: '30006', to: 'd' }, // failed
    ];
    expect(summarizeSendResult(twilio)).toEqual({ total: 4, sent: 1, blocked: 2, failed: 1 });
    expect(summarizeSendResult([])).toEqual({ total: 0, sent: 0, blocked: 0, failed: 0 });
    expect(summarizeSendResult(undefined)).toEqual({ total: 0, sent: 0, blocked: 0, failed: 0 });
  });
});

describe('B2 · groupTemplates', () => {
  it('groups by category, preserving first-seen order, blank category last-of-its-own', () => {
    const rows = [
      { id: 't1', title: 'A', category: 'Greetings' },
      { id: 't2', title: 'B', category: 'Scheduling' },
      { id: 't3', title: 'C', category: 'Greetings' },
      { id: 't4', title: 'D', category: '' },
    ];
    const groups = groupTemplates(rows);
    expect(groups.map((g) => g.category)).toEqual(['Greetings', 'Scheduling', '']);
    expect(groups[0].items.map((t) => t.id)).toEqual(['t1', 't3']);
    expect(groupTemplates(null)).toEqual([]);
  });
});
