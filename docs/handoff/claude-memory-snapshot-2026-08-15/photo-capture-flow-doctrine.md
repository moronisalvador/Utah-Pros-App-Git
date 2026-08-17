---
name: photo-capture-flow-doctrine
description: "Owner rulings 2026-08-14 — photo buttons open the camera INSTANTLY (never a choose-first prompt); one IDENTICAL camera on all 8 buttons; shutter = shoot-&-save-instantly (WhatsApp review tray may be revisited)"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 04079c15-7817-476d-a3a8-a47371436a5d
  modified: 2026-08-14T18:58:34.042Z
---

**Owner feedback (2026-08-14, after using the shipped CameraSource.Prompt flow):** "We should not
be prompted to choose between taking a picture and album every time we tap the button. Just do
like every app does and open the camera, but have an icon on top that opens the album… or even
something like WhatsApp — recent photos on screen along with the camera buttons, and an album icon
that opens the native multi-select."

**Why:** the chooser taxes the MOST frequent action (snap a jobsite photo, tens per shift) to
serve the less common one (album upload). It violates the spirit of tech-mobile-ux.md snap-first.
The 2026-08-14 release (PR #628 `CameraSource.Prompt`, PR #633 `AddPhotoSourceSheet`) shipped
choose-first sheets on every photo entry point — owner explicitly rejected that UX the same day.

**How to apply:** any photo entry point opens the CAMERA immediately on tap. Album/multi-select is
reached from a visible affordance (icon on the camera screen WhatsApp-style, or an adjacent album
icon-button on the surface) — never a modal/sheet/OS-prompt asking "which source?" first. Built as
`NativeCameraExperience.swift` ([[swift-native-plugin-pattern]]), landed in dev via PR #639.

**Same-day unification rulings (owner, in conversation, later on 2026-08-14 — PR #640):**
- **Every photo button gets the IDENTICAL camera** — `openNativeCameraExperience({ allowMultiple:
  true, onCapturedFile })` on all 8 surfaces; no quick-capture/album split in the camera itself
  (only page chrome differs: album surfaces carry the adjacent album icon + `multiple` web input).
  Reason given: the 3 quick-capture buttons are likely to be retired anyway; consistency wins.
- **Shutter = "shoot & save instantly":** each shutter tap streams a `photoCaptured` event and the
  page uploads it IMMEDIATELY in the background while the camera stays open ("N saved" counter);
  ✕ after shooting = done (empty resolve), never a cancel. This satisfies the snap-first law
  verbatim (upload on capture, no blocking step).
- **Owner explicitly reserved the right to switch to the WhatsApp-style review tray later**
  ("I might change to the whatsapp style later… gives more control"). The Swift camera's
  confirm-bar path is the deliberate seam: accumulate capture URLs and finish() them instead of
  streaming. Do NOT treat shoot-&-save as immutable doctrine — ask which mode when rebuilding.
- Shutter capture has NEVER run on real hardware (sim has no camera) — the on-device pass via a
  UPR Dev dispatch is the standing owner gate before trusting the capture path.

**Composer [+] menu amendment (owner, in conversation, also 2026-08-14):** the Messages
composer's [+] is the ONE surface where a menu precedes the camera — the owner asked for
Apple-native rows there: "keep the take photo for camera and photo library for directly opening
the photo selection. But then when using the take photo button, we open our custom camera we
built." Built as the generic `NativeActionMenu` app-local Swift plugin — **landed in dev via
PR #642 (merge 8869479b, 2026-08-14)**: Take Photo → OUR camera experience (the streaming
onCapturedFile contract), Photo Library → OS multi-select picker, Templates, Internal note
(✓ state). Menu only when BOTH plugins answer availability; web/older binaries keep the
web-drawn sheet with the camera-first attach flow. In-thread eyeball still owner-gated on a
sim/device sign-in as of landing.
Scoped by test: `album-multi-photo-select.test.js` bans `presentNativeActionMenu` on every
other photo surface — extending the menu elsewhere needs another stated owner amendment.
