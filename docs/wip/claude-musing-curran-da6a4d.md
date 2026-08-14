---
branch: claude/musing-curran-da6a4d
ships: true
opened: 2026-08-14
---

# What

NativeActionMenu — app-local Swift plugin presenting Apple's own action sheet — wired to the
tech Messages composer's [+]: Take Photo (our custom camera), Photo Library (OS multi-select),
Templates, Internal note (✓ state). Owner-amended attach-flow contract; builds on
claude/confident-bardeen-bb7118's camera-first attach (merged in).

# Why it matters

The owner saw WebKit's file-input chooser in the composer and wants that native look for the
[+] actions — the OS popover isn't extensible, so this is the equivalent we own. The menu's
source rows are an owner-directed, composer-scoped amendment to the camera-first doctrine.

# Next action

Sim-verify the menu on the booted iPhone (waiting for the composer camera session's
"simulator free" signal), then close-out gauntlet and PR into dev.
