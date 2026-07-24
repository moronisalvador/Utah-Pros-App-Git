<!--
FILE: docs/audit/2026-07/evidence/isolated-qa-figma-internal-foundation-2026-07-23.md

WHAT THIS DOES (plain language):
  Records the repository-only P1/Foundation F3a isolated-QA delivery and disconnected Figma
  prerequisite work, including executed verification and the exact external gates left open.

DEPENDS ON:
  Internal: docs/upr-agent-qa-access-roadmap.md, docs/upr-figma-governance-and-handoff.md,
            package.json, vitest.config.js, playwright.config.js, tests/qa/, scripts/qa/
  Data:     reads  → local synthetic fixtures and repository state only
            writes → dated documentation evidence only

NOTES / GOTCHAS:
  - This is not hosted-QA, production, provider, native-device, or real-account evidence.
  - No local database execution is claimed; the missing governed runtime is an explicit gate.
-->

# Isolated QA and Figma Internal Foundation Evidence — 2026-07-23

## Boundary and source

- Started from clean `dev` at `848230dc6d1226cd43f69f7d1d1ccac12e4a9c08`.
- Rebased twice as reviewed messaging/tech-message work landed on `origin/dev`; no stale duplicate or
  conflicting UI edit was carried forward.
- Preserved unrelated untracked `.agents/` and `.codex/`.
- Scope was repository-internal test/governance code, configuration, CI, and documentation only.

No shared-Supabase migration/apply, hosted project, Auth identity, credential entry/rotation/
revocation, provider call, outbound message, money action, business-data mutation, Cloudflare/Apple/
Figma account change, plugin installation/connection, paid seat, production promotion, or `main`
push occurred.

## Delivered QA foundation

- `vitest.config.js` and `scripts/qa/run-vitest-lane.mjs` split pure-unit, Worker-contract,
  QA-policy, and future database lanes; credential-free lanes scrub provider/hosted environment
  variables, block network APIs, require non-empty discovery, and fail on every skip/todo.
- `tests/qa/lib/target-policy.mjs` permits only the exact synthetic browser origin
  `http://127.0.0.1:4173` and exact future local database origin
  `http://127.0.0.1:54321` with sentinel `upr-local-only-v1`. It refuses the shared production
  project reference, production Supabase URLs, ambiguous localhost origins, provider origins,
  TCP/CDP attachment, repository profiles, and human browser profiles.
- The Playwright launcher uses a fresh temporary profile outside the repository and pipe transport.
  The deterministic desktop 1440×1000 and mobile 390×844 fixture covers loading, error, empty,
  stale, ready, resume, input/route preservation, focus trap/return, overflow, reduced motion, and
  serious/critical axe checks.
- Browser negatives cover production database navigation, provider requests, writes, popups,
  WebSockets, downloads, and direct production navigation. The retained-artifact scanner rejects
  Auth headers/state, cookies, tokens, private keys, production identifiers, and realistic identity
  fixtures without printing captured content.
- CI validates disconnected Figma governance, installs Chromium, and runs the browser/artifact lane.

This is synthetic fixture evidence only. It does not claim real UPR route/auth behavior, pinned-Linux
visual baselines, zoom/reflow manual evidence, iOS Safari/WKWebView, real devices, or providers.

## Executed verification on final reconciled tree

| Command | Result |
|---|---|
| `npm test` | PASS before reviewer remediation: unit 703/703 in 58 files; Worker 924/924 in 76 files; final QA policy 16/16 in 4 files; zero unexpected skips in all three lanes |
| `npm run test:browser` | PASS: 12/12 across desktop-1440 and mobile-390; zero unexpected skips; retained-artifact scan found 0 unsafe files |
| `npm run build` | PASS: Vite 8.0.1, 658 modules transformed |
| changed QA/Figma JavaScript ESLint | PASS with `--max-warnings 0` |
| `npm run validate:figma-governance` | PASS: 0 errors; disconnected |
| `npm run test:figma-governance` | PASS after fail-closed scope/authority/unknown-field hardening: 7/7; zero skips |
| `npm run test:browser:list` / `test:browser:launcher` | PASS: 12 discovered with zero skips; ephemeral pipe browser verified; both use the minimal child environment |
| `npm run validate:tooling` | PASS: 0 errors; two existing time-bounded CAP-GOV-001/CAP-SEC-001 warnings |
| `npm run test:tooling` | PASS: 6 passed; one explicit environment skip because Bash is unavailable locally and CI owns that fixture |
| `npm run validate:provenance` | PASS: eight ledger rows, 11 functions, one policy; existing comment-only semantic warning |
| `npm run test:provenance` | PASS: 8/8; zero skips |
| `npm run test:db:local` | EXPECTED REFUSAL: missing exact `upr-local-only-v1` sentinel; no test was silently skipped |
| `npm run lint -- --quiet` | BASELINE RED: 2,610 errors across existing repository/untracked skill/product files; no changed QA/Figma JavaScript finding remains |

The Worker suite emitted expected stderr from negative/failure-injection fixtures. No test called a
provider because the credential-free runner blocks network and the Worker tests use injected mocks.

## Database gate

P2a execution is not complete. The repository has no governed `supabase/config.toml`, approved local
Supabase CLI/runtime, migration-from-zero fingerprint, deterministic `qa_run_id` seed/cleanup, or
representative role fixtures. The runner refuses to start without the exact local sentinel and
target. A future P2a session must open ownership of those exact resources and must achieve zero
unexpected skips and zero cleanup residuals; it must never fall back to the shared project.

P2b remains separately gated on a dedicated hosted Supabase/Auth/Storage project, owner-approved
budget/region/retention, non-production identities and credentials, and proof that no production
row/object/provider binding exists.

## Delivered Figma prerequisites and remaining gate

`.claude/figma-governance.json` is disconnected with an empty scope and denies install/connect,
seat purchase, auto-sync, code generation, public publish, broad import, and silent repository
writes. `docs/upr-figma-governance-and-handoff.md` defines repository-versus-Figma authority,
version/exit/handoff rules, a token/component/page inventory, and a representative desktop/390px
capture matrix.

The inventory recorded 165 page files, 204 component files, 112 route declarations, 212 CSS
custom-property definitions/170 distinct names, and ten `src/components/ui` files including seven
runtime primitives. The 49-file Admin Mobile system is a Main/Shared `.am-*` composition under
`/tech/admin/*`; Conversations remains a composition within the consuming Main/Shared or Tech kit.

Figma remains external/owner-gated on:

- reconciliation/release of dirty overlapping messaging worktrees without deleting user work;
- CAP-SEC-001 credential rotation/history decision and CAP-GOV-001 permission containment;
- exact workspace/file/action scope, collaborators, permission label, and any paid seat;
- a dedicated authenticated read-only staging browser session and approved role matrix;
- actual redacted/synthetic UPR desktop/390 screenshots and immutable SHA-based manifest.

No Figma action was taken and the repository remains the runtime/design-system authority.
