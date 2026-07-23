<!--
FILE: docs/architecture.md

WHAT THIS DOES (plain language):
  Describes the durable shape of the UPR system, where each major part runs, and which boundaries
  must be respected when the system changes. It is current project knowledge, not a dated audit.

DEPENDS ON:
  Internal: CLAUDE.md, AGENTS.md, docs/database-schema.md, docs/auth-and-authorization.md,
            docs/integrations.md, docs/testing-and-deployment.md
  Data:     reads → documentation only
            writes → documentation only

NOTES / GOTCHAS:
  - Update this file in the same commit as an architectural or cross-cutting change.
  - Live Supabase was last inspected read-only on 2026-07-22; configuration can drift afterward.
-->

# Architecture

## Purpose and authority

This is the canonical architectural overview for UPR. `CLAUDE.md` and applicable `.claude/rules/`
remain the engineering law. Dated audit findings live under `docs/audit/<year-month>/` and must not
be treated as current architecture without re-verification.

## System boundaries

| Boundary | Implementation | Responsibility |
|---|---|---|
| Web/PWA client | React 19, React Router 7 and Vite in `src/` | UI, route composition, authenticated user experience and device-side caching |
| Browser data access | `src/lib/supabase.js`, AuthContext and realtime helpers | Authenticated PostgREST/RPC/Storage calls and realtime subscriptions |
| Privileged/API layer | Cloudflare Pages Functions in `functions/api/`, shared code in `functions/lib/` | Provider secrets, service-role data access, webhooks, scheduled work and company side effects |
| Database | Supabase Postgres/Auth/Storage/Realtime | Durable data, RLS, RPCs, triggers, constraints and database-owned invariants |
| Native shell | Capacitor iOS project in `ios/` | Camera, geolocation, biometrics, push, safe areas and OTA/native lifecycle |
| Owner automation | `upr-mcp/` | Guarded owner-only operations and repository/provider tooling |
| Delivery | GitHub Actions, Cloudflare Pages, Capgo and Apple systems | Build, staging, production, native delivery and release evidence |

## Runtime flow

1. `src/main.jsx` initializes the client, persistent query cache and native/web bootstrap.
2. `src/App.jsx` defines lazy routes plus authentication, role, permission, feature and error gates.
3. `src/contexts/AuthContext.jsx` restores the Supabase session, resolves the employee and supplies
   an authenticated data client, permissions, feature flags and employee overrides.
4. The browser calls Supabase directly only with the current user identity and calls `/api/*` for
   privileged operations or external integrations.
5. Workers validate the caller or webhook, use server-held credentials, perform bounded/idempotent
   side effects, write durable state and record operational outcomes.
6. Database triggers/RPCs own invariants that must hold regardless of which UI or Worker initiated
   the change.

## Deployment topology

- `dev` is the staging application and `main` is production.
- Both application environments currently use one shared Supabase project. A database migration is
  therefore a production change as soon as it is applied.
- Applied migration source must be reachable from the designated release branch (or an immediately
  reconciled owner-authorized emergency commit); otherwise the live backend is not reproducible
  from the deployed branch.
- Cloudflare dashboard variables, provider consoles, GitHub protection, Capgo and Apple signing are
  external configuration. Repository files describe intent but do not prove deployed state.
- The iOS application packages the same web route system and adds native integrations; web success
  alone is not native verification.

## Design boundaries

- Authentication, authorization and rollout are separate concerns. A feature flag is not a
  substitute for a Worker role check or RLS policy.
- The browser never receives service-role/provider secrets. Privileged access stays in Workers or
  service-only database objects.
- Business invariants live at the lowest reliable shared boundary: database for cross-client data
  integrity, server for provider/secret side effects, client for presentation and interaction.
- Preserve deployed frontend/RPC/Worker contracts across independently timed client and schema
  releases.
- Reuse shared auth, HTTP, database, telemetry, consent and provider libraries instead of local
  substitutes.
- Staff-to-customer messaging keeps one browser contract (`POST /api/send-message`) and places
  provider request/response details behind a server transport seam. Consent, DND, conversations and
  message ownership remain above that seam; scheduled/automated/campaign paths are not implicitly
  provider-selectable.
- Public forms, e-signature, status and login bootstrap use purpose-built minimal
  capability/Worker contracts. They are explicit public exceptions, not a general anonymous table
  or privileged-RPC access pattern.
- Owner automation that needs cross-table analysis stays behind a service-only role/non-exposed
  boundary; read-only dynamic SQL is still privileged and must not be browser-callable.

## Cross-cutting change checklist

Before changing a shared boundary, trace routes, callers, Workers, RPCs, tables, policies, triggers,
tests, native behavior and operational configuration. Document the enforcement boundary and update:

- schema/data flow → `docs/database-schema.md`;
- identity/access → `docs/auth-and-authorization.md`;
- business invariants → `docs/business-rules.md`;
- provider or secret boundary → `docs/integrations.md`;
- test, CI or release behavior → `docs/testing-and-deployment.md`.

## Known risk record

Current dated risks and remediation priorities are recorded in
`docs/audit/2026-07/executive-summary.md` and `docs/audit/2026-07/remediation-backlog.md`. Re-verify a
snapshot finding against the current checkout and external systems before acting on it.
