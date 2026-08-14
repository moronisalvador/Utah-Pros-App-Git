// @vitest-environment happy-dom
/**
 * ════════════════════════════════════════════════
 * FILE: useComposerAttachments.test.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The reported field bug, end to end: a technician lines up a photo, the thread
 *   closes and re-opens the way it does after the phone has been put down for half a
 *   minute, and the photo is still waiting — with its thumbnail still usable, because
 *   nothing threw it away on the way out. Sending clears it.
 *
 * DEPENDS ON:
 *   Packages:  react, react-dom/client, vitest
 *   Internal:  ./useComposerAttachments, ./composerAttachmentStore
 *   Data:      reads  → none (the upload is a test double)
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - The hook is exercised through a tiny probe component rather than a rendered
 *     Composer: the contract under test is the tray surviving unmount, not markup.
 * ════════════════════════════════════════════════
 */
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useComposerAttachments } from './useComposerAttachments';
import { discardAllStagedAttachments, readStagedAttachments } from './composerAttachmentStore';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ db: { rpc: vi.fn() } }) }));
vi.mock('./mediaUpload', () => ({
  uploadConversationMedia: vi.fn(async () => ({ url: 'upr-storage://media/uploaded' })),
}));
vi.mock('@/lib/toast', () => ({ toast: vi.fn(), ok: vi.fn(), err: vi.fn() }));

let container;
let root;
let latest;
let revokeObjectURL;
let createdPreviews;

// The hook's return value is published from an effect, never assigned during render:
// a render-phase write to module scope is the impurity react-hooks/globals bans, and
// act() flushes effects before it resolves, so `latest` is current at every assertion.
function Probe({ convId }) {
  const api = useComposerAttachments(convId);
  useEffect(() => { latest = api; });
  return null;
}

function photo(name = 'basement.jpg') {
  return { name, type: 'image/jpeg', size: 1024 };
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  createdPreviews = [];
  revokeObjectURL = vi.fn();
  let previewSequence = 0;
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => {
      previewSequence += 1;
      const preview = `blob:preview-${previewSequence}`;
      createdPreviews.push(preview);
      return preview;
    }),
    revokeObjectURL,
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  document.body.replaceChildren();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  discardAllStagedAttachments();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('the staged tray across a thread close and re-open', () => {
  it('still holds the uploaded photo, with a live preview, after a full remount', async () => {
    await act(async () => { root.render(<Probe convId="conversation-1" />); });
    await act(async () => { await latest.addFiles([photo()]); });

    expect(latest.attachments).toHaveLength(1);
    expect(latest.readyUrls).toEqual(['upr-storage://media/uploaded']);
    expect(latest.uploading).toBe(false);
    const staged = latest.attachments[0];

    // The hide-and-re-prove cycle: ThreadView unmounts, then mounts again keyed by
    // the same conversation id.
    await act(async () => { root.unmount(); });
    expect(revokeObjectURL).not.toHaveBeenCalled();

    root = createRoot(container);
    await act(async () => { root.render(<Probe convId="conversation-1" />); });

    expect(latest.attachments).toEqual([staged]);
    expect(latest.readyUrls).toEqual(['upr-storage://media/uploaded']);
    // The thumbnail the tile renders is still a valid object URL, not a revoked one.
    expect(createdPreviews).toContain(latest.attachments[0].localPreview);
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it('does not hand one conversation the tray of another', async () => {
    await act(async () => { root.render(<Probe convId="conversation-1" />); });
    await act(async () => { await latest.addFiles([photo()]); });

    await act(async () => { root.render(<Probe convId="conversation-2" />); });

    expect(latest.attachments).toEqual([]);
    expect(latest.readyUrls).toEqual([]);
    expect(readStagedAttachments('conversation-1')).toHaveLength(1);
  });

  it('lands an upload that only finishes after the thread has closed', async () => {
    let finishUpload;
    const { uploadConversationMedia } = await import('./mediaUpload');
    uploadConversationMedia.mockImplementationOnce(
      () => new Promise((resolve) => { finishUpload = resolve; }),
    );

    await act(async () => { root.render(<Probe convId="conversation-1" />); });
    let staging;
    await act(async () => { staging = latest.addFiles([photo()]); });
    expect(latest.uploading).toBe(true);

    await act(async () => { root.unmount(); });
    await act(async () => {
      finishUpload({ url: 'upr-storage://media/late' });
      await staging;
    });

    root = createRoot(container);
    await act(async () => { root.render(<Probe convId="conversation-1" />); });

    expect(latest.uploading).toBe(false);
    expect(latest.readyUrls).toEqual(['upr-storage://media/late']);
  });
});

describe('the staged tray is emptied when it should be', () => {
  it('clears and revokes on send', async () => {
    await act(async () => { root.render(<Probe convId="conversation-1" />); });
    await act(async () => { await latest.addFiles([photo()]); });
    const preview = latest.attachments[0].localPreview;

    await act(async () => { latest.clearAttachments(); });

    expect(latest.attachments).toEqual([]);
    expect(readStagedAttachments('conversation-1')).toEqual([]);
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(preview);
  });

  it('revokes exactly once when a tile is removed by hand', async () => {
    await act(async () => { root.render(<Probe convId="conversation-1" />); });
    await act(async () => { await latest.addFiles([photo()]); });
    const { clientId, localPreview } = latest.attachments[0];

    await act(async () => { latest.removeAttachment(clientId); });
    await act(async () => { latest.removeAttachment(clientId); });
    await act(async () => { latest.clearAttachments(); });

    expect(latest.attachments).toEqual([]);
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(localPreview);
  });

  it('honours the one-photo provider cap against a restored tray, not a fresh count', async () => {
    await act(async () => { root.render(<Probe convId="conversation-1" />); });
    await act(async () => { await latest.addFiles([photo('first.jpg')]); });

    await act(async () => { root.unmount(); });
    root = createRoot(container);
    await act(async () => { root.render(<Probe convId="conversation-1" />); });
    await act(async () => { await latest.addFiles([photo('second.jpg')]); });

    expect(latest.attachments).toHaveLength(1);
    expect(latest.attachments[0].name).toBe('first.jpg');
  });

  it('marks a failed upload without dropping the tile', async () => {
    const { uploadConversationMedia } = await import('./mediaUpload');
    uploadConversationMedia.mockRejectedValueOnce(new Error('offline'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await act(async () => { root.render(<Probe convId="conversation-1" />); });
    await act(async () => { await latest.addFiles([photo()]); });

    expect(latest.attachments).toHaveLength(1);
    expect(latest.attachments[0]).toMatchObject({ uploading: false, error: true, url: null });
    expect(latest.readyUrls).toEqual([]);
    expect(readStagedAttachments('conversation-1')).toHaveLength(1);
  });
});
