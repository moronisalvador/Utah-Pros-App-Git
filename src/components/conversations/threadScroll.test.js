import { describe, expect, it } from 'vitest';
import {
  captureVisibleMessageAnchor,
  countNewCanonicalMessages,
  findOptimisticMessageMatchIndex,
  mergeNewestMessages,
  repinThreadAfterLayout,
  restoreVisibleMessageAnchor,
} from './threadScroll.js';

describe('repinThreadAfterLayout', () => {
  it('follows delayed attachment growth when the reader was at the bottom', () => {
    const scrollElement = { scrollTop: 375, scrollHeight: 1042 };

    expect(repinThreadAfterLayout({
      scrollElement,
      wasAtBottom: true,
      isPrepending: false,
    })).toBe(true);
    expect(scrollElement.scrollTop).toBe(1042);
  });

  it('does not pull a reader away from older messages', () => {
    const scrollElement = { scrollTop: 180, scrollHeight: 1042 };

    expect(repinThreadAfterLayout({
      scrollElement,
      wasAtBottom: false,
      isPrepending: false,
    })).toBe(false);
    expect(scrollElement.scrollTop).toBe(180);
  });

  it('does not interfere with a load-earlier prepend anchor', () => {
    const scrollElement = { scrollTop: 12, scrollHeight: 1042 };

    expect(repinThreadAfterLayout({
      scrollElement,
      wasAtBottom: true,
      isPrepending: true,
    })).toBe(false);
    expect(scrollElement.scrollTop).toBe(12);
  });

  it('fails closed without a mounted scroller', () => {
    expect(repinThreadAfterLayout({
      scrollElement: null,
      wasAtBottom: true,
      isPrepending: false,
    })).toBe(false);
  });
});

describe('visible message anchoring', () => {
  it('restores the same visible message after content above it grows', () => {
    const rect = { top: 180, bottom: 240 };
    const visible = { getBoundingClientRect: () => rect };
    const hidden = { getBoundingClientRect: () => ({ top: 40, bottom: 80 }) };
    const scrollElement = {
      scrollTop: 320,
      getBoundingClientRect: () => ({ top: 100 }),
      querySelectorAll: () => [hidden, visible],
      contains: (element) => element === visible || element === hidden,
    };
    const anchor = captureVisibleMessageAnchor(scrollElement);

    rect.top += 96;
    rect.bottom += 96;

    expect(restoreVisibleMessageAnchor(scrollElement, anchor)).toBe(true);
    expect(scrollElement.scrollTop).toBe(416);
  });

  it('does not move when delayed layout occurs below the visible message', () => {
    const visible = { getBoundingClientRect: () => ({ top: 180, bottom: 240 }) };
    const scrollElement = {
      scrollTop: 320,
      getBoundingClientRect: () => ({ top: 100 }),
      querySelectorAll: () => [visible],
      contains: (element) => element === visible,
    };
    const anchor = captureVisibleMessageAnchor(scrollElement);

    expect(restoreVisibleMessageAnchor(scrollElement, anchor)).toBe(true);
    expect(scrollElement.scrollTop).toBe(320);
  });

  it('uses a scroller-relative offset when the whole pane moves', () => {
    let scrollerTop = 100;
    let messageTop = 180;
    const visible = {
      getBoundingClientRect: () => ({ top: messageTop, bottom: messageTop + 60 }),
    };
    const scrollElement = {
      scrollTop: 320,
      getBoundingClientRect: () => ({ top: scrollerTop }),
      querySelectorAll: () => [visible],
      contains: () => true,
    };
    const anchor = captureVisibleMessageAnchor(scrollElement);

    scrollerTop += 80;
    messageTop += 80;

    expect(restoreVisibleMessageAnchor(scrollElement, anchor)).toBe(true);
    expect(scrollElement.scrollTop).toBe(320);
  });
});

describe('newest-page resume merge', () => {
  it('keeps loaded history, patches known rows, appends missed rows, and removes an optimistic twin', () => {
    const current = [
      { id: 'old', type: 'sms_inbound', body: 'old', created_at: '2026-07-23T10:00:00Z' },
      { id: 'known', type: 'sms_outbound', body: 'sent', status: 'sent', created_at: '2026-07-23T11:00:00Z' },
      { id: 'request-1', _clientId: 'request-1', _pending: true, type: 'sms_outbound', body: 'confirmed', created_at: '2026-07-23T12:00:00Z' },
    ];
    const newest = [
      { id: 'known', type: 'sms_outbound', body: 'sent', status: 'delivered', created_at: '2026-07-23T11:00:00Z' },
      { id: 'real', type: 'sms_outbound', body: 'confirmed', status: 'sent', created_at: '2026-07-23T12:01:00Z' },
      { id: 'missed', type: 'sms_inbound', body: 'new', status: 'received', created_at: '2026-07-23T12:02:00Z' },
    ];

    const merged = mergeNewestMessages(current, newest);

    expect(merged.map((message) => message.id)).toEqual(['old', 'known', 'real', 'missed']);
    expect(merged.find((message) => message.id === 'known')?.status).toBe('delivered');
  });

  it('reconciles identical optimistic sends one-for-one', () => {
    const current = [
      { id: 'pending-1', _pending: true, type: 'sms_outbound', body: 'same', created_at: '2026-07-23T12:00:00Z' },
      { id: 'pending-2', _pending: true, type: 'sms_outbound', body: 'same', created_at: '2026-07-23T12:00:01Z' },
    ];
    const newest = [
      { id: 'real-1', type: 'sms_outbound', body: 'same', created_at: '2026-07-23T12:00:02Z' },
    ];

    expect(mergeNewestMessages(current, newest).map((message) => message.id))
      .toEqual(['pending-2', 'real-1']);
  });

  it('reserves an out-of-order durable confirmation for the correct identical send', () => {
    const current = [
      { id: 'pending-1', _clientId: 'pending-1', _pending: true, type: 'sms_outbound', body: 'same', created_at: '2026-07-23T12:00:00Z' },
      { id: 'pending-2', _clientId: 'pending-2', _pending: true, type: 'sms_outbound', body: 'same', created_at: '2026-07-23T12:00:01Z' },
    ];
    const confirmed = [{
      id: 'real-2',
      client_request_id: 'pending-2',
      type: 'sms_outbound',
      body: 'same',
      created_at: '2026-07-23T12:00:02Z',
    }];
    expect(mergeNewestMessages(current, confirmed).map((message) => message.id))
      .toEqual(['pending-1', 'real-2']);
  });

  it('does not fallback when a durable confirmation conflicts with the loaded optimistic row', () => {
    const pending = [{
      id: 'pending-1',
      _clientId: 'pending-1',
      _pending: true,
      type: 'sms_outbound',
      body: 'same',
      created_at: '2026-07-23T12:00:00Z',
    }];
    const other = {
      id: 'real-2',
      client_request_id: 'pending-2',
      type: 'sms_outbound',
      body: 'same',
      created_at: '2026-07-23T12:00:02Z',
    };
    expect(findOptimisticMessageMatchIndex(pending, other)).toBe(-1);
  });

  it('does not hide a new send behind a recent older identical canonical row', () => {
    const current = [{
      id: 'pending-1',
      _clientId: 'pending-1',
      _pending: true,
      type: 'sms_outbound',
      body: 'same',
      created_at: '2026-07-23T12:05:00Z',
    }];
    const older = [{
      id: 'old',
      type: 'sms_outbound',
      body: 'same',
      created_at: '2026-07-23T12:04:00Z',
    }];
    expect(mergeNewestMessages(current, older).map((message) => message.id))
      .toEqual(['old', 'pending-1']);
  });
});

describe('new-message count', () => {
  it('counts every canonical row after the previous tail', () => {
    const messages = [
      { id: 'old' },
      { id: 'new-1' },
      { id: 'pending', _pending: true },
      { id: 'new-2' },
    ];
    expect(countNewCanonicalMessages(messages, 'old')).toBe(2);
  });

  it('falls back to one when the previous tail is no longer loaded', () => {
    expect(countNewCanonicalMessages([{ id: 'new-1' }], 'missing')).toBe(1);
  });
});
