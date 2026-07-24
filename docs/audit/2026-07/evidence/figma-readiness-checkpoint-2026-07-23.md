<!--
FILE: docs/audit/2026-07/evidence/figma-readiness-checkpoint-2026-07-23.md

WHAT THIS DOES (plain language):
  Applies the minimum viable gate for starting a governed Figma design sprint without waiting for
  the entire isolated write-capable QA program.

DEPENDS ON:
  Internal: UPR-Design-System.md, docs/audit/2026-07/tooling-capability-review.md,
            docs/upr-agent-qa-access-roadmap.md, docs/upr-unfinished-work-registry.md
  Data:     reads → repository, Git worktrees, routes, design tokens and current capability evidence
            writes → documentation only

NOTES / GOTCHAS:
  - No Figma plugin was installed or connected and no seat was purchased.
  - Read-only screenshot access does not authorize application writes or browser automation.
-->

# Minimum viable Figma-readiness checkpoint — 2026-07-23

## Verdict

**Owner-blocked; the design sprint has a bounded ready plan but must not start yet.**

Full hosted QA writes, provider sandboxes, and the product backlog are not prerequisites for design.
They remain prerequisites for safe automated rollout. The narrower design-start gate is blocked by
one active shared-UI worktree, CAP-SEC-001/CAP-GOV-001 owner actions, no approved Figma permission
mode/seat, and no demonstrated dedicated authenticated read-only staging browser session.

No Figma installation, connection, file creation, import, external write, or paid-seat action
occurred.

## Gate

| Requirement | Evidence | Status / exact unblock |
|---|---|---|
| 1. No in-flight shared UI/design edits | Worktree audit found six tracked UI files modified in `codex/messaging-transport-build`: `MessageBubble.jsx`, `messageUtils.js`, `src/index.css`, `Conversations.jsx`, `settings/Integrations.jsx`, and tech `useThread.js`. The primary tree has documentation-only changes. | **Blocked internal.** The owning worktree must commit/integrate, explicitly supersede, or preserve and release these edits before a Figma sprint claims any overlapping surface. Do not delete them. |
| 2. CAP-SEC-001/CAP-GOV-001 contained or owner-blocked | The tracked local permission history still contains the redacted live-looking Encircle bearer finding; rotation/history ruling and permission reset require owner/provider action. | **Owner-blocked, explicitly.** Rotate/revoke without reproducing the secret; decide history treatment; stop tracking the local permission file; reset mutation approvals; verify scanner fixtures. |
| 3. Governed Figma/plugin mode and authority | Tooling review recommends connection only after cleanup. No Figma plugin is installed/connected in this checkpoint. | **Owner decision required.** Default proposal: reads/exports may run only in the approved project/file; every Figma write/comment/share/import and every repository change asks; no auto-sync, plugin install, seat purchase, or broad workspace access. |
| 4. Authenticated read-only staging/browser capture | Repository documents a real-login account path, but this checkpoint has no dedicated authenticated browser session, role matrix, or screenshot capture proof. Staging shares production Supabase. | **Owner/session gate.** Provide a dedicated non-human browser profile/session with read-only navigation only. No form submit, mutation, provider action, money action, or human Chrome attachment. |
| 5. Inventory and exact first sprint | Repository inventory: 164 files under `src/pages`, 204 under `src/components`, and 170 distinct CSS custom-property definitions. The design-system kit registry and sprint below constrain the work. | **Ready as plan.** Recount at sprint start after UI worktree clearance. |
| 6. Screenshot/version/handoff acceptance | Rules below define capture metadata, authority, diffs, and acceptance. | **Ready as contract, owner approval pending.** |

## Authority and permission contract

- Figma owns approved design intent, annotated flows, component/variable proposals, and review
  artifacts.
- The repository owns runtime behavior, authorization, accessibility, responsive implementation,
  tokens, component APIs, tests, and the shipped source of truth.
- `UPR-Design-System.md` and `src/components/ui` remain authoritative until a reviewed repository
  change lands. A Figma component or variable does not silently create a new runtime standard.
- One surface uses one existing kit: Main/Shared, Collections, Overview, or Tech Mobile. The first
  sprint does not merge or normalize the four kits.
- Figma-to-code generation, direct repository writes, automatic token synchronization, broad file
  imports, public sharing, and plugin-created mutations are disabled.
- Proposed permission label: read-only browsing/export by default; **ask for every change**. The
  owner must approve the exact workspace, file/project, collaborators, plugin connection, and any
  paid Full-seat month at the external action boundary.

## Representative read-only capture matrix

Capture each approved route at desktop 1440×1000 and mobile 390×844, with account/notification
content redacted or synthetic and without invoking a write:

| Role | Route/surface | Variant represented |
|---|---|---|
| admin | `/` | Overview kit, widget loading/error/restricted variants |
| admin | `/jobs` and one approved read-only job detail | Main/Shared list and tabbed detail |
| billing-capable admin | `/collections` | Collections kit table/cards/filters |
| admin | `/settings` and `/settings/integrations` | Main/Shared settings shell and access-gated rows |
| internal staff | `/conversations` | Messaging desktop/mobile list and thread states |
| field technician | `/tech`, `/tech/schedule`, `/tech/conversations` | Tech Mobile kit, safe areas and bottom navigation |
| CRM partner or approved restricted fixture | `/crm/leads` and `/crm/call-log` | Restricted-role CRM shell and cards |
| any approved role | shared primitive fixture or existing representative surfaces | `Modal` desktop/bottom-sheet, `StatusPill` five tones, `EmptyState`, `ErrorState`, `PageHeader`, `SearchInput`, `IconButton`, light/dark and reduced motion |

If an approved role cannot reach a route without changing feature flags, permissions, or data, record
the state as unavailable; do not mutate production configuration to manufacture the screenshot.

## Exact first design sprint

**Sprint name:** Shared Main-kit list/detail foundation.

**In scope:** design-only audit and proposed Figma components for `PageHeader`, list toolbar/search,
standard card/table row, `StatusPill`, loading skeleton, `EmptyState`, `ErrorState`, `Modal`
desktop/bottom-sheet, and the 390px responsive shell. Use `/jobs` plus an approved read-only job
detail as the representative surface. Include light/dark and keyboard/focus annotations.

**Out of scope:** Collections/Overview/Tech kit consolidation, Conversations or Integrations while
their dirty worktree exists, new product behavior, database/API changes, content/data migrations,
feature-flag changes, automated rollout, provider flows, money paths, and owner-only controls.

The implementation sprint is a later repository phase with exact file ownership, design and
page-behavior reviews, browser evidence, tests, and a normal `dev` release. Figma approval alone
does not authorize it.

## Screenshot, version, and handoff acceptance

- Every baseline names release SHA, environment URL/host, role class, route, viewport, theme,
  capture timestamp, feature flags that affect the surface, and redaction/synthetic-data status.
- Store immutable baseline images and a manifest outside customer data; do not store Auth state,
  bearer material, full customer identities, message bodies, or private documents.
- Figma file versions use `UPR / <surface> / baseline <short-sha> / <YYYY-MM-DD>` and link back to
  the manifest. No “latest” baseline without a SHA.
- Each proposal lists the existing kit, repository token/component mapping, states, responsive
  behavior, focus/keyboard rules, reduced-motion behavior, and known implementation exceptions.
- Handoff requires design owner approval plus engineering acceptance of authorization, behavior,
  accessibility, and responsive constraints. Visual approval cannot waive those boundaries.
- Implementation acceptance requires desktop and 390 screenshots against the same manifest,
  relevant component/page tests, design-consistency and page-behavior reviews, build, changed-file
  lint, and explicit disposition of every intentional visual delta.

## Owner-ready action sequence

1. Resolve or explicitly release the dirty messaging UI worktree without deleting user changes.
2. Complete CAP-SEC-001 rotation/history action and CAP-GOV-001 permission reset.
3. Approve the authority contract, exact Figma workspace/file, read-only-by-default permission mode,
   collaborators, and whether to purchase one Full-seat month.
4. Provide the dedicated authenticated read-only staging browser profile/session and approved role
   access.
5. Recapture the inventory, collect the matrix baselines, and open only the first sprint above.

This checkpoint is sufficient to start design once those exact gates clear; it does not wait for
write-capable hosted QA or the entire product backlog.

## Repository-internal prerequisite addendum — 2026-07-23

The internal contract work is now implemented without connecting Figma:

- `.claude/figma-governance.json` grants zero scopes and denies installation, connection, paid-seat
  purchase, auto-sync, code generation, broad imports, and public publishing;
- its validator and regression tests run in CI, so a scope/action cannot be silently broadened;
- `docs/upr-figma-governance-and-handoff.md` records repository-versus-Figma authority, exit and
  version rules, a handoff manifest, current design-system/token/component/page inventory, and the
  desktop 1440×1000 plus mobile 390×844 capture plan;
- the inventory was recounted as 164 page files, 204 component files, 112 route declarations,
  212 CSS custom-property definitions/170 distinct names, and ten shared `src/components/ui` files
  including seven runtime primitives.

These repository prerequisites change gate 3 from “contract missing” to “contract implemented,
connection scope unapproved.” They do not clear the external boundary. The overlapping messaging
worktrees remain dirty and owner-controlled; CAP-SEC-001/CAP-GOV-001 remain open; no dedicated
authenticated read-only staging session or actual UPR screenshot matrix was supplied; and no
workspace/file/action scope or seat was approved. No plugin was installed or connected, no seat was
purchased, and no Figma/account/repository write occurred through a design tool.
