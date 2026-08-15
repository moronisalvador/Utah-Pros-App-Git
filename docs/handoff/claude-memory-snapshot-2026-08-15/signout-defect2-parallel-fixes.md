---
name: signout-defect2-parallel-fixes
description: Unified sign-out revival guard landed on dev 2026-07-30; plus the .env.local unit-lane env leak that made its tests environment-dependent
metadata: 
  node_type: memory
  type: project
  originSessionId: 131adc85-fcd0-41e8-8e1f-652276210dbd
  modified: 2026-07-30T11:52:06.666Z
---

The 2026-07-29 native sign-out revival defect is CLOSED on dev (2026-07-30, `b346e256`): unified fix = always-complete logout contract + session_id-keyed ended-session registry (`src/lib/endedSessionGuard.js`), four security-review passes. Remaining owner gates at the time: on-device account-switch check; decoding one real access token to confirm the `session_id` claim shape.

**Reusable gotcha:** running vitest from the MAIN checkout loads `.env.local`, so `import.meta.env.VITE_SUPABASE_URL` is DEFINED in unit tests there but UNDEFINED in worktrees — code branching on Vite env produced 4 deterministic main-checkout-only test failures that got a dev merge dropped overnight.

**Why:** vite/vitest auto-load `.env.local` from the config root; the credential-free lane strips process env but not the dotenv file.

**How to apply:** any test whose subject reads `import.meta.env.*` must be verified in BOTH regimes (`vi.stubEnv` one way, ambient the other), or the code made env-robust. A green worktree run is not proof the main checkout is green.
