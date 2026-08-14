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

PR into dev is open (merge #641 first — this branch is based on it). Remaining owner gate:
the sim's stored login is dead (pre-existing — identical on the pre-change build), so the
in-thread [+] menu UI pass needs an owner sign-in on the sim or a phone; everything else
(3 lanes, gauntlet, web+iOS builds, plugin-in-binary) is verified.
