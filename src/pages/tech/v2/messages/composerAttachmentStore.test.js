/**
 * ════════════════════════════════════════════════
 * FILE: composerAttachmentStore.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The photos a technician has lined up under the reply box survive the thread
 *   closing and re-opening, are thrown away when they are sent or when the person
 *   genuinely loses access or signs out, and never leave a photo preview alive twice
 *   or dead too early. It also checks nothing is ever written to browser storage.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./composerAttachmentStore, @/lib/techQuery
 *   Data:      reads  → none (in-memory only)
 *              writes → none (in-memory only)
 *
 * NOTES / GOTCHAS:
 *   - Object URLs do not exist in the node test environment, so revokeObjectURL is
 *     installed as a spy and every assertion counts calls rather than side effects.
 * ════════════════════════════════════════════════
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearTechQueryMemory } from '@/lib/techQuery';
import {
  MAX_STAGED_CONVERSATIONS,
  discardAllStagedAttachments,
  discardStagedAttachments,
  nextStagedAttachmentId,
  readStagedAttachments,
  subscribeStagedAttachments,
  writeStagedAttachments,
} from './composerAttachmentStore';

let revokeObjectURL;

function tile(conversationId, overrides = {}) {
  const clientId = nextStagedAttachmentId();
  return {
    clientId,
    name: `${clientId}.jpg`,
    url: null,
    localPreview: `blob:${conversationId}/${clientId}`,
    uploading: true,
    error: false,
    ...overrides,
  };
}

function stage(conversationId, overrides) {
  const next = tile(conversationId, overrides);
  writeStagedAttachments(conversationId, [...readStagedAttachments(conversationId), next]);
  return next;
}

beforeEach(() => {
  revokeObjectURL = vi.fn();
  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(), revokeObjectURL });
});

afterEach(() => {
  discardAllStagedAttachments();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('staged composer attachments survive a remount', () => {
  it('returns the same tray to a later reader, which is what a thread remount is', () => {
    const staged = stage('conversation-1');

    // ThreadView unmounting does nothing to the store; the next mount reads this.
    expect(readStagedAttachments('conversation-1')).toEqual([staged]);
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it('keeps an upload that finishes after the thread closed', () => {
    const staged = stage('conversation-1');

    writeStagedAttachments('conversation-1', readStagedAttachments('conversation-1').map(
      (attachment) => ({ ...attachment, uploading: false, url: 'upr-storage://media/1' }),
    ));

    expect(readStagedAttachments('conversation-1')).toEqual([{
      ...staged,
      uploading: false,
      url: 'upr-storage://media/1',
    }]);
    // The preview string is unchanged across the update, so it must NOT be revoked.
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it('returns one shared empty snapshot so an external store read cannot loop', () => {
    expect(readStagedAttachments('never-staged')).toBe(readStagedAttachments('other'));
    expect(readStagedAttachments(null)).toBe(readStagedAttachments('never-staged'));
  });

  it('never repeats a client id across conversations or remounts', () => {
    const first = stage('conversation-1');
    const second = stage('conversation-2');

    expect(first.clientId).not.toBe(second.clientId);
  });
});

describe('object URL revocation happens exactly once', () => {
  it('revokes a removed preview once and leaves the survivor alone', () => {
    const removed = stage('conversation-1');
    writeStagedAttachments('conversation-1', []);
    // A second write for the same already-emptied tray must not revoke again.
    writeStagedAttachments('conversation-1', []);
    discardStagedAttachments('conversation-1');

    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith(removed.localPreview);
  });

  it('revokes only the tile that left the tray', () => {
    const kept = stage('conversation-1');
    const dropped = { ...tile('conversation-1'), clientId: 'att-dropped' };
    writeStagedAttachments('conversation-1', [kept, dropped]);

    writeStagedAttachments('conversation-1', [kept]);

    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith(dropped.localPreview);
    expect(readStagedAttachments('conversation-1')).toEqual([kept]);
  });

  it('survives a shell with no object-URL support', () => {
    vi.stubGlobal('URL', {});
    stage('conversation-1');

    expect(() => discardStagedAttachments('conversation-1')).not.toThrow();
    expect(readStagedAttachments('conversation-1')).toEqual([]);
  });
});

describe('destroying staged work', () => {
  it('clears one conversation on send without touching another', () => {
    const kept = stage('conversation-2');
    stage('conversation-1');

    writeStagedAttachments('conversation-1', []); // clearAttachments() on send

    expect(readStagedAttachments('conversation-1')).toEqual([]);
    expect(readStagedAttachments('conversation-2')).toEqual([kept]);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('discards every tray and revokes every preview on an account change', () => {
    const first = stage('conversation-1');
    const second = stage('conversation-2');

    clearTechQueryMemory();

    expect(readStagedAttachments('conversation-1')).toEqual([]);
    expect(readStagedAttachments('conversation-2')).toEqual([]);
    expect(revokeObjectURL.mock.calls.flat().sort()).toEqual(
      [first.localPreview, second.localPreview].sort(),
    );
  });

  it('is a no-op for a conversation that never staged anything', () => {
    discardStagedAttachments('conversation-unknown');

    expect(revokeObjectURL).not.toHaveBeenCalled();
  });
});

describe('memory bound', () => {
  it('evicts the least-recently-written tray whole, rather than leaving a broken tile', () => {
    const conversationIds = Array.from(
      { length: MAX_STAGED_CONVERSATIONS + 1 },
      (_value, index) => `conversation-${index}`,
    );
    const staged = conversationIds.map((conversationId) => stage(conversationId));

    // The oldest tray is gone entirely — not merely stripped of its preview, which
    // would render an unloadable upr-storage:// tile.
    expect(readStagedAttachments(conversationIds[0])).toEqual([]);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith(staged[0].localPreview);
    conversationIds.slice(1).forEach((conversationId, index) => {
      expect(readStagedAttachments(conversationId)).toEqual([staged[index + 1]]);
    });
  });

  it('does not evict the tray it just wrote to', () => {
    const conversationIds = Array.from(
      { length: MAX_STAGED_CONVERSATIONS },
      (_value, index) => `conversation-${index}`,
    );
    conversationIds.forEach((conversationId) => stage(conversationId));

    const refreshed = stage(conversationIds[0]);

    expect(readStagedAttachments(conversationIds[0])).toHaveLength(2);
    expect(readStagedAttachments(conversationIds[0])[1]).toEqual(refreshed);
  });
});

describe('subscribers', () => {
  it('notifies only the subscribed conversation and stops after unsubscribe', () => {
    const onChange = vi.fn();
    const onOther = vi.fn();
    const unsubscribe = subscribeStagedAttachments('conversation-1', onChange);
    subscribeStagedAttachments('conversation-2', onOther);

    stage('conversation-1');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onOther).not.toHaveBeenCalled();

    discardStagedAttachments('conversation-1');
    expect(onChange).toHaveBeenCalledTimes(2);

    unsubscribe();
    stage('conversation-1');
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('keeps notifying the rest when one subscriber throws', () => {
    const healthy = vi.fn();
    subscribeStagedAttachments('conversation-1', () => { throw new Error('stale'); });
    subscribeStagedAttachments('conversation-1', healthy);

    expect(() => stage('conversation-1')).not.toThrow();
    expect(healthy).toHaveBeenCalledTimes(1);
  });
});

describe('never persisted to disk', () => {
  it('writes nothing to localStorage while staging, restoring or discarding', () => {
    const setItem = vi.fn();
    const removeItem = vi.fn();
    vi.stubGlobal('localStorage', { setItem, removeItem, getItem: () => null, key: () => null, length: 0 });
    vi.stubGlobal('URL', { revokeObjectURL, createObjectURL: vi.fn() });

    stage('conversation-1');
    readStagedAttachments('conversation-1');
    discardStagedAttachments('conversation-1');

    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });
});
