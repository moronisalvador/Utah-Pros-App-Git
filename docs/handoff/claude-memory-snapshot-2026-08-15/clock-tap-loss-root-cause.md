---
name: clock-tap-loss-root-cause
description: "Why field techs' clock taps silently vanished (fixed 2026-08-07) + three counterintuitive facts about location, the DB, and offline that were measured, not assumed"
metadata: 
  node_type: memory
  type: project
  originSessionId: ab5c0ae0-482f-4316-ba3c-d14864994f6b
  modified: 2026-08-07T05:20:28.239Z
---

**Fixed 2026-08-07, commit `17f1a5f2`.** Techs reported tapping On My Way / Start / Finish with no time recorded, intermittently. Four client-side causes, none of which left a server trace:

1. **GPS gated the payroll write.** `performClock` awaited `getCurrentCoords()` at its 8s default *before* the RPC, and the native branch was unbounded — `getCurrentPosition`'s `timeout` is advisory on iOS, and `checkPermissions`/`requestPermissions` have **no timeout at all**. If iOS suspended the web view in that window (tech taps "On my way", pockets phone, walks in — the literal use case) the RPC never fired. Now capped at `COORD_BUDGET_MS = 2500`, and `nativeGeolocation.withDeadline` bounds the whole native sequence for every caller.
2. **The Finish two-tap confirm disarmed itself** via `onBlur`, which fires on any incidental focus change (the hub re-renders once a second while the clock runs) — so the second tap RE-ARMED instead of finishing. Now an explicit 6s timer. Same defect existed on AttentionStrip's away-Finish and Return-to-Job.
3. **`loadEntries` swallowed errors** (`catch { /* ignore */ }`), leaving a stale station row after a successful clock → tech re-taps → `clock_in` overwritten, travel inflated.
4. **Failures were toast-only** — gone in seconds, long before a tech who pocketed the phone looks again. Now a persistent `role="alert"` banner with manual Retry (no queue, no auto-replay).

**Three things measured that contradict the obvious guesses — don't re-derive these:**

- **Location IS live and working.** The owner believed it was never built ("we never ask permission"). Wrong: `NSLocationWhenInUseUsageDescription` is in Info.plist, `@capacitor/geolocation` is installed, iOS prompts automatically on first `requestPermissions()` (no settings screen needed), and **271 of 308 entries in 180 days carry GPS coordinates**. The ~12% without were the ones paying the full 8s hang.
- **The database is clean** — 0 open entries >18h, 0 completed appointments with an unclosed entry, 2 auto-splits in 120 days. That cleanliness is *the* diagnostic: it proves the failing taps never reached the server, so the bug was client-side. Detector for the live symptom: crew/appointment pairs on worked-status appointments with no entry for that tech (10 in 14 days vs 64 entries created).
- **Offline was never the silent path.** `db.rpc` throws on network failure and on its 30s timeout, and the handler already toasted it. A tech with no signal *was* told — the practical problem was that 8s GPS + 30s fetch = up to 38s before the error appeared, by which time they'd walked away.

**Retry must not route through a two-tap gate.** Three reviewers independently caught that `doAction('finish')` re-arms rather than acting (because `confirmFinish` is already false by the time a failure lands) — the retry button would have reproduced the exact bug it reports. It calls `performClock` directly.

Offline queue design (deliberately NOT built, recommendation is to wait for field evidence): `docs/offline-clock-queue-proposal.md`.
