/**
 * ════════════════════════════════════════════════
 * FILE: useComposerAttachments.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Runs the photo-attachment tray under the reply box. When a tech picks photos it
 *   caps them at five, shows each as a thumbnail while it uploads, and swaps in the
 *   real uploaded photo when it's ready (or an error mark if the upload failed). It
 *   hands back the finished photo links so Send can attach them, and cleans up when
 *   the tech switches to another conversation.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (React hook)
 *   Rendered by:  src/pages/tech/v2/messages/Composer.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (db), ./mediaUpload (the ONE upload helper),
 *              @/lib/mediaCompress (MAX_FILES, validateFile)
 *   Data:      writes → Supabase Storage (via mediaUpload)
 *
 * NOTES / GOTCHAS:
 *   - Copy-in of Conversations.jsx:673-716 (handleFilesSelected / removeAttachment),
 *     re-homed against the pane's own state so the shared screen is never edited.
 *   - A local object-URL preview shows instantly (snap-first); it is revoked on remove
 *     and on unmount so the webview never leaks blob URLs.
 *   - A photo can send with no caption — the worker (send-message.js) accepts a
 *     media-only send once the upload has finished (no text required).
 * ════════════════════════════════════════════════
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { MAX_FILES, validateFile } from '@/lib/mediaCompress';
import { uploadConversationMedia } from './mediaUpload';

function emitToast(message, type = 'info') {
  window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type } }));
}

export function useComposerAttachments(convId) {
  const { db } = useAuth();
  const [attachments, setAttachments] = useState([]);
  const counter = useRef(0);
  const attachmentsRef = useRef([]);
  // Mirror the latest attachments into a ref FROM AN EFFECT (never during render) so the
  // unmount cleanup can revoke previews without stale-closure risk.
  useEffect(() => { attachmentsRef.current = attachments; }, [attachments]);

  const revoke = (a) => { if (a?.localPreview) { try { URL.revokeObjectURL(a.localPreview); } catch { /* ignore */ } } };

  // Reset (and revoke previews) when the conversation changes or the hook unmounts.
  useEffect(() => {
    return () => { attachmentsRef.current.forEach(revoke); };
  }, [convId]);

  const addFiles = useCallback(async (fileList) => {
    const files = Array.from(fileList || []);
    if (!convId || files.length === 0) return;
    // Track the running count locally (seeded from the last committed render) so the
    // ≤MAX_FILES cap holds across the async loop without reading a ref during render.
    let count = attachmentsRef.current.length;
    for (const file of files) {
      if (count >= MAX_FILES) {
        emitToast(`Up to ${MAX_FILES} photos per message`, 'info');
        break;
      }
      const check = validateFile(file);
      if (!check.ok) { emitToast(check.reason, 'error'); continue; }
      count += 1;

      const clientId = `att-${++counter.current}`;
      let localPreview = null;
      try { localPreview = URL.createObjectURL(file); } catch { /* non-fatal */ }
      const tile = { clientId, name: file.name, url: null, localPreview, uploading: true, error: false };
      setAttachments((prev) => [...prev, tile]);

      try {
        const { url } = await uploadConversationMedia(db, convId, file);
        setAttachments((prev) => prev.map((a) => (a.clientId === clientId ? { ...a, uploading: false, url } : a)));
      } catch (err) {
        console.error('Attachment upload error:', err);
        setAttachments((prev) => prev.map((a) => (a.clientId === clientId ? { ...a, uploading: false, error: true } : a)));
        emitToast(`Couldn't attach ${file.name}`, 'error');
      }
    }
  }, [convId, db]);

  const removeAttachment = useCallback((clientId) => {
    setAttachments((prev) => {
      const gone = prev.find((a) => a.clientId === clientId);
      revoke(gone);
      return prev.filter((a) => a.clientId !== clientId);
    });
  }, []);

  const clearAttachments = useCallback(() => {
    setAttachments((prev) => { prev.forEach(revoke); return []; });
  }, []);

  const readyUrls = attachments.filter((a) => a.url).map((a) => a.url);
  const uploading = attachments.some((a) => a.uploading);

  return { attachments, addFiles, removeAttachment, clearAttachments, readyUrls, uploading };
}

export default useComposerAttachments;
