---
name: conversation-push-tap-three-layer-break
description: "Why tapping a conversation push 'goes nowhere' on the native app — three stacked causes diagnosed 2026-08-06, one still outstanding (cold-start drop by design)"
metadata: 
  node_type: memory
  type: project
  originSessionId: ab5c0ae0-482f-4316-ba3c-d14864994f6b
  modified: 2026-08-06T05:22:27.067Z
---

Diagnosed 2026-08-06. Tapping a conversation push on the tech native app dead-ended for three
stacked reasons; know all three before touching this again:

1. **Server lockout (2026-08-01 → 08-04):** the participant-scoping containment (ledger
   `20260801145825`) made conversation access explicit-membership-only — all 3 active field techs
   could access 0 conversations (also silenced their message notifications, same predicate).
   REPAIRED by `20260804230000_conversation_access_default_open.sql` (prod ledger
   `20260805013826`); verified live: all active techs `can_access=true`.
2. **Aug-3 TestFlight build (23:09 UTC) lease purge bug:** deep link arrived with fresh `activeId`
   and no conversation-access lease; resume treated "never proven" as "expired", purged, stripped
   `?c=` → landed on the list. Fixed by `34d0ec9b` (in the **Aug-5 03:40 UTC build**, uploaded to
   TestFlight — techs must UPDATE the app to get it).
3. **Cold-start push taps — FIXED 2026-08-06:** `startNativePushEventListeners` now holds one
   structurally-validated tap (single slot, newest wins, 5-min TTL, memory only) and re-resolves
   it at auth readiness against the verified employee, through `resolveNativePushRoute` (the PUSH
   policy — the security review's blocker was that the old resolver used the app-link policy,
   which accepts `/set-password#…` recovery fragments; fixed with negative tests). Landed dev
   `9ff78f80`, promoted to main in PR #587 (`cc4d225f`), and a fresh iOS release build uploaded to
   TestFlight the same night — **techs must update the app** to get it. The coordinator's own
   pre-ready push refusal stays as defense-in-depth. `docs/app-surface-map.md` §5a documents the
   held-tap contract.

Payload/server side verified healthy: outbox → notify.js → apns.js sends one `data.url`
(`/tech/conversations?c=<id>`) + one `data.recipient` (SHA-256 binding of employeeId) — matches
`resolveNativePushActionTarget` requirements. Techs receive message.inbound/outbound rows again
since the access repair. See [[qbo-payment-sync-single-point-of-failure]] for the payment side of
the same incident cluster.
