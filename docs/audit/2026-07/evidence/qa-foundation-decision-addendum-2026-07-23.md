<!--
FILE: docs/audit/2026-07/evidence/qa-foundation-decision-addendum-2026-07-23.md

WHAT THIS DOES (plain language):
  Records the repository-safe decisions and unresolved owner/external gates for the isolated QA
  foundation before any test runner, account, hosted project, credential, or deployment is created.

DEPENDS ON:
  Internal: docs/upr-agent-qa-access-roadmap.md,
            docs/upr-agent-qa-access-dispatch.md,
            .claude/rules/upr-agent-qa-access-ownership.md,
            docs/testing-and-deployment.md
  Data:     reads → repository configuration and prior read-only environment evidence
            writes → documentation only

NOTES / GOTCHAS:
  - This addendum authorizes no external resource, credential, identity, provider call, or live write.
  - dev.utahpros.app and production still share project glsmljpabrwonfiltiqm.
-->

# Isolated QA Foundation — P0 Decision Addendum

**Captured:** 2026-07-23

**Repository base:** `dev` at `69076d1`

**Phase outcome:** repository decision package complete; P1/P2a implementation ownership and every
hosted/external action remain gated

**External mutations:** none

## Decision record

| Decision | Repository-safe disposition | Status / owner gate |
|---|---|---|
| Supabase/Auth/Storage isolation | Use a dedicated hosted QA project for deployed browser/Auth/Storage tests. A clean local Supabase stack may be used for migration/RLS/RPC contracts. Both runners must reject the shared project ref `glsmljpabrwonfiltiqm`, missing sentinels, and unknown targets. | Architecture accepted. Budget, project creation, billing owner, region, retention, and project owners remain **owner/external** gates before P2b. |
| Cloudflare QA | Use a separate QA Pages project and exact QA hostname with bindings that cannot resolve production provider credentials. Preview/Production separation must be verified from live configuration. | Architecture accepted. Project/domain creation, binding ownership, and exact hostname remain **owner/external** gates before P3. |
| Credential-free localhost browser lane | Proposed exact origins are `http://127.0.0.1:5173` for Vite, `http://127.0.0.1:4173` for preview, and `http://127.0.0.1:8788` for Wrangler. The mocked P1 lane permits no other network target, redirects, popups, workers, WebSockets, downloads, or uploads. Production and `dev` origins are excluded. | Safe default recorded. Runner host, whether all three ports are needed, process-level egress enforcement, and retained-artifact duration remain **owner** gates before P1 is opened. |
| QA identities | First hosted set: `qa_admin` (never owner), `qa_office`, `qa_pm`, `qa_tech`, `qa_restricted`, `qa_no_employee`, `qa_inactive`, and per-run expired/revoked state. Add supervisor/estimator only after core coverage. No real identity or production copy is allowed. | Fixture design accepted. Identity TTL, revocation SLA, Auth owner, and hosted account creation remain **owner/external** gates before P2b. |
| Provider posture/order | P1–P4 use deny/simulate only. Later activation remains one provider per explicit phase: Resend test recipients, Twilio test path, Stripe test mode, Intuit/QBO Development sandbox. Encircle stays mocked/excluded until its separate sandbox/mock decision. | Mock-only repository posture accepted. Every account, credential, callback, sink, provider call, and cost remains **owner/external** gated. |
| Telemetry | P1 may retain only locally generated, privacy-scanned test reports with no Auth state or secrets. Before write-capable P3, select first-party or vendor-backed durable telemetry with redacted schema, access control, alert owner, retention, deletion, DPA/privacy, and failure behavior. Missing telemetry must deny side effects. | Local no-credential posture accepted. Durable system/vendor, retention, privacy review, and alert destination remain **owner/legal/external** gates. |
| GitHub | P1 should need no secrets. Future hosted lanes use a protected QA environment with exact QA-only secrets, least-privilege workflow permissions, concurrency limits, redacted artifacts, and no fork secret access. | Contract accepted. Protected-environment configuration, required checks, secret owners, and artifact retention remain **owner/external** gates before P2b/P3/P6. |
| Accessibility/device target | Repository target is WCAG 2.2 AA for automated/static/browser coverage, with keyboard, reduced-motion, 200% zoom/reflow, desktop, and 390px matrices. Chromium emulation is not iOS proof. | Engineering target accepted. Legal conformance position and real iPhone/Safari/WKWebView/VoiceOver device ownership remain **owner/legal/device** gates. |
| Encircle boundary | Preserve the current dark rollout: shared migration unapplied, feature flag OFF, credentials unchanged, and no QA provider call. Repository readiness evidence is `encircle-managed-credential-readiness-2026-07-23.md`. | Freeze accepted. Any apply, flag, candidate, provider smoke, rotation/revocation, or sandbox/mock choice remains a separate **owner/external** gate. |

## Test-auth plan disposition

Commit `3841056` is **superseded, not merged**. Its diagnosis remains useful: the historical
integration suites use the anonymous client and can self-skip or pass vacuously. Its proposed remedy
is not adopted because it deliberately keeps mutation-heavy tests on the shared production project
behind a TEST-organization rail. A row marker is not an isolation boundary.

The replacement contract is:

1. `test:unit` and mocked Worker/browser lanes make no network or database calls.
2. `test:db` requires an explicit local or dedicated-QA sentinel and refuses the known shared
   project before test discovery or authentication.
3. Missing isolated credentials produce a deliberate lane-not-configured result; a configured DB
   lane permits zero unexpected skips.
4. Authentication proof-of-life, representative-role coverage, deterministic seed/reset, and
   residual checks run only inside the isolated target.
5. No existing `supabase/tests/` file is bulk-converted until the isolated runner and refusal tests
   are accepted.

The branch containing `3841056` is not deleted by this phase. Branch/worktree cleanup remains an
owner/release action.

## Phase readiness

| Phase | Repository readiness | Gate that remains |
|---|---|---|
| P1 credential-free localhost | **ready for an exact ownership checkpoint** | Assign package/lock, new test config, `.gitignore`, CI, and fixture paths; approve runner host/ports/artifact duration. |
| P2a local database contracts | **ready for an exact ownership checkpoint** | Confirm local Supabase runtime/container support and assign only new runner/fixture/seed paths; reconcile migration-from-zero feasibility. |
| P2b hosted isolated data | **blocked external** | Create/approve dedicated project, budget, region, owners, retention, secrets, and identity lifecycle. |
| P3 isolated deployment | **blocked external/owner** | Dedicated Cloudflare project/domain, side-effect/telemetry design, bindings, and shared-hotspot ownership. |
| P4–P6 | **blocked on predecessors** | Complete and accept the preceding isolation, containment, and external gates. |

## Verification boundary

This phase inspected current repository configuration and initiative documents only. It did not:

- run mutation-heavy database tests;
- create or authenticate an identity;
- create a Supabase or Cloudflare resource;
- read or change secrets;
- apply a migration or write to the shared project;
- call a provider, send a message, move money, deploy, or delete a branch/worktree.

P0 is complete as a repository decision package. It is not evidence that any paid/external resource
exists or that P1/P2 implementation ownership has been opened.
