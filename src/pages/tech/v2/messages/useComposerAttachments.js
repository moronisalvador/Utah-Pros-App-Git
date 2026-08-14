/**
 * ════════════════════════════════════════════════
 * FILE: useComposerAttachments.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Runs the photo-attachment tray under the reply box. When a tech picks photos it
 *   caps them to the active cross-provider envelope, shows a thumbnail while it uploads, and swaps in the
 *   real uploaded photo when it's ready (or an error mark if the upload failed). It
 *   hands back the finished photo links so Send can attach them. The lined-up photos
 *   are remembered per conversation for as long as the app is open, so closing and
 *   re-opening a thread — which the screen does on its own after the app has been in
 *   the background — finds them exactly where they were.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (React hook)
 *   Rendered by:  src/pages/tech/v2/messages/Composer.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (db), ./mediaUpload, ./composerAttachmentStore,
 *              @/lib/messageMedia, @/lib/toast
 *   Data:      writes → private message media via an authenticated Worker
 *
 * NOTES / GOTCHAS:
 *   - Copy-in of Conversations.jsx:673-716 (handleFilesSelected / removeAttachment),
 *     re-homed against the pane's own state so the shared screen is never edited.
 *   - The tray lives in ./composerAttachmentStore, NOT in this hook's state, and this
 *     hook deliberately does NOT revoke previews on unmount. ThreadView is keyed by
 *     conversation id and unmounts on every thread close — including the brief
 *     hide-and-re-prove cycle after the app is backgrounded past the 30s access lease
 *     — and revoking there is what used to empty the tray under a tech who had merely
 *     looked away. The photos were usually already uploaded, so the upload was
 *     orphaned and had to be redone. The store owns every object URL and revokes each
 *     exactly once, when the preview leaves the tray. This is the same resume law that
 *     keeps the typed draft (accessRevocation's expired-vs-denied split), applied to
 *     the other half of the composer's own state.
 *   - Because the store is the source of truth, an upload that finishes AFTER the
 *     thread closed still lands in the tray the tech comes back to.
 *   - A photo can send with no caption — the worker (send-message.js) accepts a
 *     media-only send once the upload has finished (no text required).
 * ════════════════════════════════════════════════
 */
import { useCallback, useSyncExternalStore } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  MAX_MESSAGE_ATTACHMENTS,
  validateMessageFile,
} from '@/lib/messageMedia';
import { toast, err } from '@/lib/toast';
import {
  nextStagedAttachmentId,
  readStagedAttachments,
  subscribeStagedAttachments,
  writeStagedAttachments,
} from './composerAttachmentStore';
import {
  uploadConversationMedia,
} from './mediaUpload';

export function useComposerAttachments(convId) {
  const { db } = useAuth();

  // The store, not local state, is the source of truth — that is what lets the tray
  // outlive this hook's unmount. useSyncExternalStore re-seeds it on every mount and
  // keeps it live for a write that lands from an async upload after a remount.
  const subscribe = useCallback(
    (onStoreChange) => subscribeStagedAttachments(convId, onStoreChange),
    [convId],
  );
  const getSnapshot = useCallback(() => readStagedAttachments(convId), [convId]);
  const attachments = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const addFiles = useCallback(async (fileList) => {
    const files = Array.from(fileList || []);
    if (!convId || files.length === 0) return;
    for (const file of files) {
      // Read the live tray each pass so the ≤MAX cap holds across the async loop and
      // counts anything restored from a previous mount.
      if (readStagedAttachments(convId).length >= MAX_MESSAGE_ATTACHMENTS) {
        toast(`Up to ${MAX_MESSAGE_ATTACHMENTS} photos per message`, 'info');
        break;
      }
      const check = validateMessageFile(file);
      if (!check.ok) { err(check.reason); continue; }

      const clientId = nextStagedAttachmentId();
      let localPreview = null;
      try { localPreview = URL.createObjectURL(file); } catch { /* non-fatal */ }
      const tile = { clientId, name: file.name, url: null, localPreview, uploading: true, error: false };
      writeStagedAttachments(convId, [...readStagedAttachments(convId), tile]);

      try {
        const { url } = await uploadConversationMedia(db, convId, file);
        writeStagedAttachments(convId, readStagedAttachments(convId).map(
          (a) => (a.clientId === clientId ? { ...a, uploading: false, url } : a),
        ));
      } catch (uploadError) {
        console.error('Attachment upload error:', uploadError);
        writeStagedAttachments(convId, readStagedAttachments(convId).map(
          (a) => (a.clientId === clientId ? { ...a, uploading: false, error: true } : a),
        ));
        err(`Couldn't attach ${file.name}`);
      }
    }
  }, [convId, db]);

  const removeAttachment = useCallback((clientId) => {
    writeStagedAttachments(
      convId,
      readStagedAttachments(convId).filter((a) => a.clientId !== clientId),
    );
  }, [convId]);

  const clearAttachments = useCallback(() => {
    writeStagedAttachments(convId, []);
  }, [convId]);

  const readyUrls = attachments.filter((a) => a.url).map((a) => a.url);
  const uploading = attachments.some((a) => a.uploading);

  return { attachments, addFiles, removeAttachment, clearAttachments, readyUrls, uploading };
}

export default useComposerAttachments;
