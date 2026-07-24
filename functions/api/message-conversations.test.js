/**
 * ════════════════════════════════════════════════
 * FILE: message-conversations.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves contact search and direct-thread creation stay behind messaging
 *   authorization, remain bounded, and never accept arbitrary contact IDs.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  functions/api/message-conversations.js
 *   Data:      none (authorization and database calls are mocked)
 * ════════════════════════════════════════════════
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ auth: null, db: null }));
vi.mock('../lib/messaging-auth.js', () => ({
  requireMessagingAccess: (...args) => h.auth(...args),
}));
vi.mock('../lib/supabase.js', () => ({
  supabase: () => h.db,
}));

import {
  buildContactSearchQuery,
  onRequestGet,
  onRequestPost,
} from './message-conversations.js';

const CONTACT_ID = '11111111-1111-4111-8111-111111111111';

function request({ query = '', body = {} } = {}) {
  return {
    url: `https://app.test/api/message-conversations${query}`,
    headers: new Headers({ Authorization: 'Bearer test-token' }),
    json: vi.fn(async () => body),
  };
}

beforeEach(() => {
  h.auth = vi.fn(async () => ({
    employee: { id: 'employee-1', role: 'field_tech' },
  }));
  h.db = {
    select: vi.fn(async () => [{
      id: CONTACT_ID,
      name: 'Test Contact',
      phone: '+13855550100',
      company: 'Test Company',
      email: 'private@example.test',
      opt_in_status: 'opted_in',
    }]),
    rpc: vi.fn(async () => ({
      id: '22222222-2222-4222-8222-222222222222',
      type: 'direct',
    })),
  };
});

describe('GET /api/message-conversations', () => {
  it('rejects unauthorized callers before searching', async () => {
    h.auth.mockResolvedValue({ error: 'Forbidden', status: 403 });

    const response = await onRequestGet({
      request: request({ query: '?q=test' }),
      env: {},
    });

    expect(response.status).toBe(403);
    expect(h.db.select).not.toHaveBeenCalled();
  });

  it.each(['', 'a', 'a'.repeat(81)])('rejects an unsafe search length: %s', async (q) => {
    const response = await onRequestGet({
      request: request({ query: `?q=${encodeURIComponent(q)}` }),
      env: {},
    });

    expect(response.status).toBe(400);
    expect(h.db.select).not.toHaveBeenCalled();
  });

  it.each(['__', '%%', 'a*', 'a,b', 'a)b', 'a\\\\b'])(
    'rejects PostgREST grammar or wildcard input: %s',
    async (q) => {
      const response = await onRequestGet({
        request: request({ query: `?q=${encodeURIComponent(q)}` }),
        env: {},
      });

      expect(response.status).toBe(400);
      expect(h.db.select).not.toHaveBeenCalled();
    },
  );

  it('searches only safe fields with a hard result cap', async () => {
    const response = await onRequestGet({
      request: request({ query: '?q=Test%20Contact' }),
      env: {},
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const query = h.db.select.mock.calls[0][1];
    expect(query).toBe(buildContactSearchQuery('Test Contact'));
    expect(query).toContain('select=id,name,phone,company');
    expect(query).toContain('limit=25');
    expect(query).not.toContain('email');
    expect(query).not.toContain('dnd');
    expect(await response.json()).toEqual({
      ok: true,
      contacts: [{
        id: CONTACT_ID,
        name: 'Test Contact',
        phone: '+13855550100',
        company: 'Test Company',
      }],
    });
  });
});

describe('POST /api/message-conversations', () => {
  it('rejects unauthorized callers before parsing or creating', async () => {
    h.auth.mockResolvedValue({ error: 'Forbidden', status: 403 });
    const req = request({ body: { contact_id: CONTACT_ID } });

    const response = await onRequestPost({ request: req, env: {} });

    expect(response.status).toBe(403);
    expect(req.json).not.toHaveBeenCalled();
    expect(h.db.rpc).not.toHaveBeenCalled();
  });

  it.each(['', 'not-a-uuid', '11111111-1111-1111-1111-111111111111'])(
    'rejects an invalid contact id: %s',
    async (contactId) => {
      const response = await onRequestPost({
        request: request({ body: { contact_id: contactId } }),
        env: {},
      });

      expect(response.status).toBe(400);
      expect(h.db.rpc).not.toHaveBeenCalled();
    },
  );

  it('uses the service-only idempotent RPC and does not send anything', async () => {
    const response = await onRequestPost({
      request: request({ body: { contact_id: CONTACT_ID } }),
      env: {},
    });

    expect(response.status).toBe(200);
    expect(h.db.rpc).toHaveBeenCalledWith('find_or_create_conversation', {
      p_contact_id: CONTACT_ID,
    });
    expect(await response.json()).toMatchObject({
      ok: true,
      conversation: { type: 'direct' },
    });
  });
});
