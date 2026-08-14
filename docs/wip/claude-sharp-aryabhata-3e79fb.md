---
branch: claude/sharp-aryabhata-3e79fb
ships: true
opened: 2026-08-14
---

# What

Persist the tech Messages composer's staged photo tray per conversation, in memory, so it
survives the ThreadView remount. New `composerAttachmentStore.js` owns the trays and every
object URL; `useComposerAttachments` reads it through `useSyncExternalStore` and no longer
revokes on unmount. Cleared on send, on a proven access denial (via a new `cause` argument to
`purgeConversationAccess`), and on an account-generation change.

# Why it matters

A tech who picked photos, got interrupted for 35s and came back found the tray empty — the
access lease had aged out, the thread remounted, and the unmount cleanup revoked the previews.
The photos were usually already uploaded, so the upload was orphaned and had to be redone in a
basement on cellular. Expiry now keeps the tray; only a real denial destroys it.

# Next action

Run close-out gauntlet, then PR into dev (do not merge)
