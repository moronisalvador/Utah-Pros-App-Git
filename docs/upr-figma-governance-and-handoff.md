<!--
FILE: docs/upr-figma-governance-and-handoff.md

WHAT THIS DOES (plain language):
  Defines how UPR design work may move between the repository and a future approved Figma file.
  It records the current design inventory and the exact screenshot plan without connecting an account.

DEPENDS ON:
  Internal: .claude/figma-governance.json, UPR-Design-System.md,
            docs/audit/2026-07/evidence/figma-readiness-checkpoint-2026-07-23.md
  Data:     reads  → repository routes, pages, components, tokens and design standards
            writes → documentation only

NOTES / GOTCHAS:
  - Figma is disconnected. This file grants no plugin, account, seat, share, import or write authority.
  - Counts are a 2026-07-23 repository snapshot and must be remeasured at capture or sprint start.
-->

# UPR Figma governance, inventory, and handoff

Status: internal contract complete; external connection and baseline capture blocked

Last verified: 2026-07-23 on `dev` from base `848230d`

Machine-readable permission contract: [`.claude/figma-governance.json`](../.claude/figma-governance.json)

## 1. Current boundary

No Figma plugin is installed or connected, no workspace/file/collaborator is approved, and no paid
seat is authorized. The machine-readable contract therefore remains `disconnected`, with empty exact
workspace/file lists and no wildcard access.

Repository work completed by this checkpoint:

- fail-closed permission and authority contract plus CI validation;
- repository-versus-Figma conflict and handoff rules;
- design-system, token, component and page inventory;
- representative desktop/390 screenshot matrix and manifest schema.

Still external/owner-gated:

- exact Figma workspace and file;
- exact collaborators and permission level;
- plugin installation/connection;
- any paid Full-seat month;
- dedicated authenticated read-only staging browser profile/session;
- resolution/release of overlapping dirty messaging UI worktrees;
- CAP-SEC-001 credential rotation/history ruling and CAP-GOV-001 local-permission reset;
- real UPR baseline capture and the first Figma sprint.

## 2. Permission contract

The JSON contract is the executable repository declaration. Its validator fails CI unless all of the
following remain true:

| Capability | Current rule |
|---|---|
| Install plugin, connect account, purchase seat | deny |
| Read or export | ask for exact workspace/file scope |
| Design write, comment, share, import | ask for every change |
| Repository write from a design tool | ask for every change and normal repository review |
| Automatic token synchronization or code generation | deny |
| Public publish/share | deny |
| Auth state or customer data in repository artifacts | deny |

Approving read/export later does not approve a write, comment, import, share, repository edit or paid
seat. Each external mutation keeps its own action-boundary confirmation.

## 3. Authority and conflict rule

Figma may own approved design intent after the owner approves the exact file. The repository always
owns runtime behavior, authorization, accessibility, responsive implementation, component APIs,
tokens used by shipped code, tests, and deployed source.

`UPR-Design-System.md`, `src/index.css`, and the current component implementations remain authoritative
until a reviewed repository commit changes them. A proposed Figma component or variable is not a new
runtime standard by itself.

If Figma and the repository disagree:

1. preserve shipped repository behavior;
2. record the mismatch in the handoff manifest;
3. classify it as design proposal, implementation defect, intentional platform exception, or stale
   baseline;
4. obtain design-owner approval for intent and engineering acceptance for behavior/safety;
5. land the repository change through normal tests/review;
6. capture a new SHA-bound baseline and then update the Figma version reference.

There is no silent “latest wins” rule and no automatic two-way synchronization.

## 4. Design inventory snapshot

### Measurement

The 2026-07-23 snapshot used repository files only:

```text
rg --files src/pages
rg --files src/components
rg -o --no-filename -- "--[a-zA-Z0-9_-]+\s*:" src/index.css
rg -n "<Route" src/App.jsx
```

Results:

| Inventory | Count |
|---|---:|
| Files under `src/pages` | 165 |
| Files under `src/components` | 204 |
| CSS custom-property definitions in `src/index.css` | 212 |
| Distinct CSS custom-property names in `src/index.css` | 170 |
| `<Route` declarations in `src/App.jsx` | 112 |
| Shared UI files under `src/components/ui` | 10 |

These are file/token/route-declaration counts, not claims that every item is visually distinct or
fully adopted.

### Page inventory by repository area

| Area | Files | Design ownership |
|---|---:|---|
| Root `src/pages` | 35 | Main/Shared except named Collections, Overview and Conversations surfaces |
| `src/pages/settings` | 20 | Main/Shared |
| `src/pages/crm` | 20 | Main/Shared foundation with CRM-specific compositions; do not invent a fifth kit |
| `src/pages/tech` | 90 | Tech Mobile |

### Component inventory by repository area

| Area | Files | Notes |
|---|---:|---|
| Root `src/components` | 50 | Shared/domain components; classify by consuming surface |
| `admin-mobile` | 49 | Main/Shared Admin Mobile composition routed under `/tech/admin/*`; `.am-*` remains its composition boundary, not a fifth kit or Tech Mobile primitive set |
| `tech` | 33 | Tech Mobile |
| `overview` | 18 | Overview Kit only |
| `crm` | 17 | CRM-specific compositions on the Main/Shared foundation |
| `collections` | 10 | Collections Kit only |
| `ui` | 10 | Seven shared primitives, classifier, barrel and render test |
| `settings` | 8 | Main/Shared |
| `conversations` | 5 | Existing messaging shell |
| `admin`, `claim`, `demo-sheet`, `schedule` | 1 each | Domain-specific components |

### Four-kit registry

Do not merge kits during baseline capture or the first design sprint.

| Kit | Owned surfaces | Token/component source | Repository files in primary component folder |
|---|---|---|---:|
| Main / Shared | Customers, Jobs, Claims, Admin, Settings, default surfaces, and the `.am-*` Admin Mobile composition | `:root` tokens, `.btn/.card/.input`, `src/components/ui`, `src/components/admin-mobile/**` | 10 shared primitives plus 49 Admin Mobile composition files |
| Collections | Collections, Time Tracking, Invoice and Estimate editors | `collTokens.js`, `collKit.jsx`, `.coll-*` | 10 |
| Overview | Dashboard/home only | `overview/tokens.js`, cards/widgets, `.ovw-*` | 18 |
| Tech Mobile | `src/pages/tech/**`, `src/components/tech/**` | `.tech-layout` `--tech-*`/`--status-*`, `tv2-*` | 33 |

Conversations is an existing messaging composition used by office and tech routes; it does not
authorize a fifth general-purpose kit.

### Shared primitive map

| Runtime primitive | Design/handoff responsibility |
|---|---|
| `Modal` | desktop dialog plus mobile bottom sheet; focus trap/return, Escape, overlay and reduced motion |
| `StatusPill` | five semantic tones; status-to-tone classifier; dark-safe token use |
| `EmptyState` | successful zero-result state only |
| `ErrorState` | failed-load state plus retry |
| `PageHeader` | title, subtitle and actions composition |
| `SearchInput` | named controlled search plus clear action |
| `IconButton` | mandatory accessible label and minimum target behavior |

The shared folder also contains `statusTone.js`, `index.js`, and `uiPrimitives.render.test.jsx`.

## 5. Screenshot matrix plan

### Capture contract

Each approved route is captured at:

- desktop: 1440 × 1000, DPR 1;
- mobile: 390 × 844, DPR 1, touch behavior noted;
- light theme; Tech Mobile additionally dark where supported;
- reduced-motion end state;
- deterministic clock, locale and synthetic/redacted content;
- loading, error, empty, stale/saved-data and ready states where the surface supports them.

Real UPR screenshots require the dedicated read-only browser session. The synthetic Playwright
foundation validates the capture machinery and state vocabulary only; it is not a real UPR baseline.

### Representative route matrix

| Role class | Route/surface | Kit | Desktop | 390 | Required variants |
|---|---|---|---:|---:|---|
| admin | `/` | Overview | yes | yes | loading, widget error, restricted, ready |
| admin | `/jobs` | Main/Shared | yes | yes | loading, error, empty, filters, ready |
| admin | one approved read-only `/jobs/:jobId` | Main/Shared | yes | yes | tabs, long title, missing/denied state |
| billing-capable admin | `/collections` | Collections | yes | yes | cards/table, filters, empty/error |
| billing-capable admin | one read-only invoice or estimate editor | Collections | yes | yes | line grid, totals, modal/sheet without save |
| admin | `/settings` | Main/Shared | yes | yes | default, restricted row |
| admin | `/settings/integrations` | Main/Shared | yes | yes | disconnected, loading/error; no connect action |
| internal staff | `/conversations` | Main/Shared (Conversations composition) | yes | yes | list, selected thread, empty/error, mobile back state |
| admin | one approved `/tech/admin/*` route | Main/Shared (Admin Mobile `.am-*` composition) | yes | yes | light-only card/list/detail, loading/error/empty, bottom sheet without mutation; manager unavailable by current gate |
| field technician | `/tech` | Tech Mobile | yes | yes | light/dark, loading/error/ready, safe areas |
| field technician | `/tech/schedule` | Tech Mobile | yes | yes | empty/upcoming, assigned rows, resume state |
| field technician | `/tech/conversations` | Tech Mobile (Conversations composition) | yes | yes | list/thread, exact back state |
| restricted fixture | `/crm/leads` | Main/Shared + CRM composition | yes | yes | allowed list, denied direct route, empty/error |
| restricted fixture | `/crm/call-log` | Main/Shared + CRM composition | yes | yes | list/detail, unavailable recording |
| approved fixture | shared primitive fixture or representative routes | Main/Shared | yes | yes | all seven primitives, five status tones, keyboard/focus |

If a role cannot reach a route without a feature-flag, permission, data or provider mutation, record
`unavailable` with the blocker. Do not change production/shared configuration to manufacture a
screenshot.

### Baseline manifest

Every image entry records:

```text
release_sha
environment_origin
role_class
route_without_sensitive_query_values
viewport / DPR / touch
theme / reduced_motion
capture_timestamp_utc
relevant_feature_flags_as_safe_labels
state_variant
synthetic_or_redacted
kit
source_image_sha256
review_status
```

Never retain Auth state, cookies, Authorization headers, customer names, phone/email/address, message
bodies, private documents, signed URLs, provider identifiers, or payment data.

Baseline naming:

```text
UPR / <surface> / baseline <short-sha> / <YYYY-MM-DD>
<role>-<route-slug>-<viewport>-<theme>-<state>.png
```

There is no unversioned “latest” baseline. A new release SHA creates a new manifest/version.

## 6. Handoff requirements

Every proposed Figma component or page specifies:

- current kit and repository component/token mapping;
- states and state transitions;
- desktop and 390 behavior;
- keyboard order, visible focus, dialog trap/return and announcements;
- reduced-motion end state;
- authorization/feature-state assumptions;
- intentional deviations from the captured SHA;
- content/data classification and redaction;
- design owner and engineering owner acceptance.

Engineering acceptance requires build, safe unit/Worker/browser lanes, relevant component/page tests,
changed-file lint, design-consistency review, page-behavior review, desktop/390 screenshots against
the same manifest, and explicit disposition of every visual delta. Figma approval cannot waive
authorization, accessibility, lifecycle, performance or responsive rules.

## 7. First approved sprint after external gates

Sprint: Shared Main-kit list/detail foundation.

Design-only scope: `PageHeader`, list toolbar/search, standard card/table row, `StatusPill`,
the existing Main `TabLoading`/`.loading-page` vocabulary, `EmptyState`, `ErrorState`, `Modal`
desktop/bottom-sheet, and the 390 shell using `/jobs` plus one approved read-only job detail.

Out of scope: kit consolidation, Conversations/Integrations while overlapping worktrees remain dirty,
new behavior, database/API changes, feature flags, provider flows, money, owner-only controls,
automatic code/token synchronization and repository implementation.

The implementation sprint is a separate future repository phase with exact ownership and normal
review/release gates.
