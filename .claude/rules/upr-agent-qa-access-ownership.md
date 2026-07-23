# UPR Agent QA Access — Ownership and Isolation Manifest

Last-verified: 2026-07-23

This manifest is binding for the proposed UPR Agent QA Access and Test Foundation. The plan of record
is `docs/upr-agent-qa-access-roadmap.md`; cold-session prompts are in
`docs/upr-agent-qa-access-dispatch.md`.

## 1. Current state: planning only

The initiative currently owns only:

- `docs/upr-agent-qa-access-roadmap.md`
- `docs/upr-agent-qa-access-dispatch.md`
- `.claude/rules/upr-agent-qa-access-ownership.md`

No application, test configuration, dependency, CI, migration, canonical knowledge file, external
resource, or live state is owned or authorized yet.

## 2. Encircle landed baseline and freeze

Encircle implementation is now committed and pushed to `origin/dev` at `0a06a21`. The owner reports
CI and Cloudflare staging passed. Its shared migration remains unapplied, its rollout flag remains
OFF, and credentials remain unchanged. The legacy Netlify Demo Sheet is owner-confirmed obsolete and
unsupported; it is not a supported QA target or credential-cutover dependency.

This handoff permits the three planning artifacts to be rebased and committed. It does not authorize
QA implementation, the pending migration, a flag change, credential entry/rotation, Netlify cleanup,
or write-capable automation. Until a later phase receives exact ownership, this QA initiative must
not edit:

- any Encircle page, component, Worker, library, migration, test, reference, or configuration;
- `src/contexts/AuthContext.jsx`, `src/App.jsx`, or shared layouts;
- `functions/lib/{auth,http,worker-runs,supabase,cors,credentials}.js`;
- provider adapters or money/messaging Workers;
- `package.json`, `package-lock.json`, Vite/Vitest/Playwright configuration, `.gitignore`, or CI;
- Supabase migrations/tests, Cloudflare configuration, or existing canonical docs.

Before P1 or later, reverify the live/deployed Encircle state read-only and explicitly reserve every
shared hotspot from the `0a06a21` baseline. Source presence is not proof that its migration, flag, or
credential cutover is live. “Different branch” is not proof of disjointness.

## 3. Proposed future ownership by phase

The paths below are reservations to approve later, not current edit permission.

| Phase | Proposed exclusive ownership | Must coordinate / frozen |
|---|---|---|
| P0 | QA decision/addendum docs only | all runtime and external state |
| P1 | new Vitest/Playwright configs; new `tests/qa/**`; new browser/CDP guard/launcher; test artifact ignores; assigned scripts/CI block | package/lock, `.gitignore`, Vite, CI require explicit Encircle handoff |
| P2a | new local isolated-DB runner/fixtures/seed/cleanup/tests | all shared/live migrations and existing DB initiative files |
| P2b | new hosted-QA Auth/Storage/role fixtures and hosted seed/cleanup tests | shared project, production identities/data, and live migrations |
| P3 | new side-effect-policy and QA telemetry modules/tests; narrow assigned auth/provider caller changes; QA deployment declarations | auth, credentials, provider adapters, workers, Cloudflare variables are shared RED hotspots |
| P4 | representative browser workflows/fixtures only; minimal assigned product hooks if unavoidable | product pages/components remain owned by their current initiatives |
| P5 | exactly one provider adapter/test seam per session | every other provider and Encircle frozen |
| P6 | assigned CI/release/native QA files | production deployment, Apple, Capgo, branch protection external |

If a phase needs an unlisted file, stop and obtain ownership. Do not self-expand the phase.

## 4. Database and environment ownership

- Project `glsmljpabrwonfiltiqm` is the shared production project and is never a write-test target.
- Local Supabase and a dedicated QA project are separate lanes with explicit project-ref sentinels.
- A QA runner refuses missing/unknown sentinels and the known shared project ref.
- No migration is applied to any project without separate owner authorization and normal project law.
- QA seed/cleanup uses immutable `qa_run_id` ownership; no fuzzy prefixes or broad delete.
- Production and `dev` smoke remain read-only.

## 5. Browser/CDP ownership

- Only the dedicated ephemeral test browser profile and pipe-based CDP channel are owned.
- TCP CDP is a fallback requiring an authenticated broker or process ACL; loopback alone is not
  isolation from other local processes.
- Human Chrome profiles, existing tabs/sessions, extensions, passwords, and cookies are never in scope.
- Exact navigation and network-egress lists are phase inputs; wildcards are forbidden.
- Automated production smoke is public-only and uses a versioned semantic allowlist until a
  production-specific read-only identity/capability exists; authenticated production smoke is manual.
- Auth state lives outside the repository and is never retained as an artifact.

## 6. Side-effect ownership

No phase owns permission to send, charge, pay, refund, upload, schedule, deploy, or call a provider
unless the owner explicitly opens the exact sandbox phase.

The later shared side-effect policy owns the decision before credential resolution; provider adapters
own the second enforcement; queues/schedulers/webhooks own durable-lineage rechecks. No layer may
fall back to production on missing QA configuration.

Encircle calls remain mocked/excluded until the owner approves a sandbox/mock strategy and verifies
the intended rollout state.

## 7. Merge and sequencing

```text
P0 -> P1
P0 -> P2a -> P2b
P1 + P2b -> P3
P3 -> P4
P4 -> P5 (one provider at a time)
P5 -> P6
```

P1 and P2a may run in parallel only after the post-`0a06a21` Encircle state and their assigned files
are verified disjoint. P3 is a shared-hotspot serialization gate. Provider sessions do not overlap.

## 8. Phase close-out

Every phase reports:

- exact branch/commit base and working-tree state;
- exact changed files and ownership justification;
- build/test/lint/browser/database commands actually run;
- unexpected skips and environment/project sentinel evidence;
- secret/PII/artifact scan result;
- provider call count and business-mutation count for denial tests;
- seed/cleanup residual count where applicable;
- external/owner gates;
- documentation updated;
- no commit, push, deployment, migration apply, provider action, or publication unless requested.

Any ownership, environment, credential, lineage, provider-mode, telemetry, or cleanup ambiguity is a
stop condition.
