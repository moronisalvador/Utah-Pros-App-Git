# Native iOS — Ownership and Isolation Manifest

**Plan of record:** `docs/native-ios/README.md`
**Prepared:** 2026-07-25
**Current state:** planning ready; application implementation not started

This manifest is binding for work performed under the native iOS initiative. It records proposed
phase ownership; it does not grant standing permission to edit files, apply database changes,
configure external systems, sign, deploy, or release. Every phase begins with a fresh ownership
checkpoint against all active initiatives.

## 1. Frozen until a phase is explicitly opened

- Existing React/PWA/Capacitor application: `src/**`, `public/**`, `capacitor.config.*`, `ios/**`.
- Backend and shared libraries: `functions/**`, `upr-mcp/**`.
- Database: `supabase/**` and the shared Supabase project.
- Deployment/release configuration: `.github/workflows/**`, Cloudflare, Capgo, Apple Developer,
  App Store Connect, APNs, provider consoles, credentials, signing, and branch protection.
- Existing canonical documents outside the exact updates assigned by a phase.
- Files owned by another live initiative.

The current planning phase owns only `docs/native-ios/**`, this manifest, and the exact canonical
cross-references included in the reviewed planning diff.

## 2. Proposed phase lanes

| Lane | Bounded responsibility | Proposed exclusive paths | Must coordinate |
|---|---|---|---|
| O | Orchestration, decisions, integration, contradiction resolution | roadmap/status/ADR and exact integration files | every lane; sole final normalization owner |
| D | Native design foundation and accessibility | future native design package, previews, design docs/tests | product owner; no backend interpretation |
| A | App architecture, navigation, state, dependency policy | future native project shell/core modules | D, C, P; Xcode project files serialized |
| C | Data contracts and generated models | contract registry, DTO fixtures/generation adapter | sole Supabase interpretation lane; DB/security owner |
| S | Security, privacy, Auth, local protection | future native security modules/threat models/tests | C and existing server/DB authority |
| R | Offline, sync, caching, uploads, resilience | future persistence/sync modules/tests | C, S, domain owner |
| P | Apple platform capabilities | future camera/location/push/documents/deep-link adapters | A, S, R; entitlements/project file serialized |
| Q | Test automation, simulator/device evidence, performance | future native test targets/scripts/evidence | all lanes; no production test identity |
| L | Signing, TestFlight, App Store, rollout/rollback | future release automation/docs | owner-controlled external state |

Exact paths do not exist yet and must be named when the architecture decision creates the project.
No lane self-expands into an unlisted shared file.

## 3. Sequencing

```text
Owner discovery + ADRs
        |
        v
QA/environment gate + contract bootstrap + architecture/design foundations
        |
        v
One thin vertical slice (A + D + C + S + R + Q, serialized at shared seams)
        |
        v
Owner field review and foundation correction
        |
        v
Bounded workflow waves + platform capabilities
        |
        v
Hardening -> TestFlight -> phased release -> separately approved cutover
```

The data-contract lane is singular. Multiple agents must not perform broad, unbounded Supabase
discovery or independently classify the same RPC/policy. Xcode project files, entitlements,
Info.plist/privacy manifests, package resolution, and signing settings are serial hotspots.

## 4. Database and environment boundary

- The known shared production project is not a native mutation-test target.
- Source, migrations, generated reports, and read-only live catalog evidence are distinct evidence.
- A governed local database may prove migrations/contracts; a separately provisioned hosted QA
  project proves Auth/Storage/Realtime/deployed behavior.
- Missing/unknown project identity or sentinel fails closed.
- No migration, policy, grant, RPC, trigger, Storage, Realtime, Auth, or data change is implied by a
  native phase. It requires a separate reviewed backend phase and explicit apply authorization.
- The mobile binary receives no service-role or provider secret.

## 5. Agent rules

Every agent receives:

- bounded scope and exact paths;
- base branch/SHA and active ownership conflicts;
- common evidence and severity language;
- production/data/provider read-only restriction;
- required output structure and acceptance criteria;
- instructions to distinguish verified, source-confirmed, inferred, blocked, and owner-gated facts;
- no application-code edits outside the explicitly opened phase;
- no competing canonical roadmap.

Temporary notes are allowed only when the orchestrator will normalize or remove them before
close-out.

## 6. Runtime safety

Every development server, browser task, simulator automation, subprocess, and validation attempt:

- has an explicit maximum timeout of five minutes;
- guarantees cleanup in `defer`, `finally`, or equivalent;
- terminates its spawned process tree;
- reports cleanup result;
- fails gracefully when authentication, device access, signing, provider access, or environmental
  limitations prevent verification.

One optional runtime check never blocks unrelated plan or documentation close-out.

## 7. Phase close-out

Report:

- exact base, branch, commit, timestamp, and clean/dirty state;
- exact changed files and ownership justification;
- decisions, contracts, risks, and canonical documents updated;
- commands/tests run, timeouts, results, cleanup, skips, and blocks;
- simulator versus real-device versus external evidence;
- secret/PII/artifact scan;
- database/provider/business mutation counts where applicable;
- compatibility and rollback status;
- owner/external gates.

Inspect the entire Git diff. Every changed file must be an intended phase artifact. Commit, push,
merge, PR, deployment, migration apply, provider action, signing, submission, and release remain
separate user-authorized steps.
