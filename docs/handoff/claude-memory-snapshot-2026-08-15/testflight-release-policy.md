---
name: testflight-release-policy
description: Owner policy 2026-08-07 — official-app TestFlight builds are FROZEN; dispatch only UPR Dev builds until further notice
metadata: 
  node_type: memory
  type: feedback
  originSessionId: ab5c0ae0-482f-4316-ba3c-d14864994f6b
  modified: 2026-08-07T01:25:18.264Z
---

Owner directive (2026-08-07, in conversation): **stop dispatching official-app TestFlight builds** (`ios-release.yml`). All new native builds go to the **UPR Dev** app only (`ios-dev-testflight.yml` from `dev`, `-f publish_to_testflight=true`) until features are tested there. Last official build: **196.1** (main@d01d19eb, lightbox safe-area fix, delivered 2026-08-07 01:17Z).

**Why:** the official app is stable and in daily field use; everything from here on is new features or testing, which belongs in the dev app first.

**How to apply:** after a dev→main web promotion, do NOT dispatch `ios-release.yml` — web deploys to utahpros.app still happen automatically on merge and are unaffected. When native-visible changes accumulate, tell the owner the official app is drifting behind and let THEM authorize the next official cut; never dispatch it on pattern-match with past sessions. This supersedes the 2026-08-06 "keep both apps equal on TestFlight" practice.
