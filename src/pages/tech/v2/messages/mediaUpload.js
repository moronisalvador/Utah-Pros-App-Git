/**
 * ════════════════════════════════════════════════
 * FILE: mediaUpload.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Keeps the tech pane's established import path while delegating uploads and
 *   upload to the shared private message-media helper.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (helper module)
 *   Rendered by:  n/a — imported by useComposerAttachments (Phase B2)
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  @/lib/messageMedia
 *   Data:      writes → private message media through an authenticated Worker
 *
 * NOTES / GOTCHAS:
 *   - This was the named public-bucket swap target. It now returns opaque private
 *     references and never constructs a public customer-photo URL.
 * ════════════════════════════════════════════════
 */
export {
  uploadConversationMedia,
} from '@/lib/messageMedia';
