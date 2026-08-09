# UPR Skills, Agents, Plugins, and Tooling Governance

**Status:** owner-approved project law
**Last verified:** 2026-08-03
**Scope:** repository-local instructions, hooks, permissions, validation, and runtime adapters

This document is the implementation addendum to
`docs/audit/2026-07/tooling-capability-review.md`. The audit remains a dated evidence snapshot and is
not rewritten here.

## 1. Provenance and canonical ownership

- `tooling/capabilities.json` and its listed neutral sources are canonical for the capabilities
  migrated into the cross-runtime pilot. Their `.claude/`, `.agents/`, and `.codex/` adapters are
  generated outputs and must not be edited directly.
- The tracked `.claude/` tree remains canonical for entrypoints, hooks, rules, and shared Claude
  settings not yet listed in the neutral capability manifest.
- `AGENTS.md`, `CLAUDE.md`, and applicable `.claude/rules/` are project law. A skill, agent, vendor
  bundle, plugin prompt, hook, permission allowlist, or generated adapter cannot override them.
- UPR-authored entrypoints are owned by UPR platform engineering. Vendor-derived entrypoints retain
  their upstream author/license and are advisory within their stated lane; UPR overrides must be
  explicit and narrow.
- Only `.claude/`, `.agents/`, and `.codex/` files declared as outputs in
  `tooling/capabilities.json` (plus the renderer's deterministic Codex skill-interface companion)
  are governed generated adapters. Unrelated files in those candidate trees remain
  non-authoritative until inventoried, reconciled, and added to the manifest.
- `.claude/tooling-governance.json` is validation policy and review metadata.
  `tooling/capabilities.json` is the neutral source registry; neither file contains the instruction
  bodies themselves.

Tracked inventory after the interface-craft capability migration: **26 skill entrypoints,
16 agent entrypoints, 16 rules, and 4 hooks**. The validator treats these as reviewed counts and
requires this inventory stamp to change when tracked capability entrypoints are deliberately added
or removed.

## 2. Instruction and trigger precedence

When instructions conflict, use this order:

1. Current owner instruction and the authority actually granted for this task.
2. `AGENTS.md`, `CLAUDE.md`, and applicable `.claude/rules/`.
3. An active initiative ownership manifest that does not conflict with levels 1–2.
4. UPR-native dispatcher skill for the task.
5. UPR reviewer agents for their named review lane.
6. Vendor and optional specialist skills as advisory references.

One dispatcher owns each broad domain. `db-migration` owns UPR database-change workflow;
`new-feature` owns ordinary feature workflow; `masterplan` owns initiative planning; `seo` is the
only broad SEO dispatcher; `mobile-readiness-wave` owns the bounded `UPRF-MOB-001` production-
readiness program rather than ordinary responsive feature work. Supabase, Postgres, design, motion,
Playwright, marketing, and provider skills are specialists selected by a dispatcher or explicit
request. A specialist does not independently expand scope or authorize a write.

`upr-interface-craft` is the UPR supporting specialist for substantial interface work. `new-feature`
remains the ordinary implementation dispatcher and `masterplan` remains the redesign-program
dispatcher. Impeccable owns visual direction inside that specialist lane; Apple and Emil skills are
conditional advisory taste layers, subordinate to project design, lifecycle, motion, accessibility,
and performance law.

## 3. Risk tiers and authorization

| Tier | Examples | Default posture |
|---|---|---|
| **Red** | shared-database SQL/migrations, auth/RLS, secrets, money/payroll/QBO/Stripe, outbound SMS/email, deployment, destructive Git/filesystem/provider actions | Read-only inspection is allowed when in scope. Authoring requires an implementation request. Live apply, money movement, outbound communication, permission change, deployment, commit, push, or PR requires the owner to authorize that delivery action. |
| **Amber** | repository edits, dependency installation, paid/read provider calls, browser control, write-capable UI automation | Keep within the requested task. Confirm dependencies, account, cost, data boundary, and write scope before provider or foreground actions. |
| **Green** | local search, static analysis, read-only reviewers, builds, deterministic tests | May run when relevant to the task. Report actual results and limitations. |

A hook or persistent permission is defense in depth, not evidence of user intent. A tool being
installed, cached, authenticated, or allowlisted does not authorize its use for a particular task.

Database work has four separate states:

1. **Plan:** repository and approved read-only evidence only.
2. **Author:** write a migration and tests in the repository when implementation is requested.
3. **Apply:** requires separate explicit owner authorization, reviewed-commit provenance, an apply
   window, rollback, and post-apply verification because one Supabase serves staging and production.
4. **Publish:** commit/push/PR/deploy are separate delivery actions and are never implied by authoring
   or applying.

## 4. Review policy

Blocking reviewers enforce project law:

- `migration-safety-checker` and `anon-grant-auditor` for migrations, grants, RLS, or worker-auth
  boundaries.
- `consent-path-auditor` for outbound-message paths.
- Server-side authorization review for money, payroll, PII, credential, campaign, and administrative
  workers. A UI gate is never sufficient.
- `upr-pattern-checker` for applicable non-negotiables and `page-behavior-checker` for lifecycle
  regressions.
- `interface-accessibility-reviewer` for semantic controls, forms, keyboard/focus, touch targets,
  gesture alternatives, safe areas, zoom, resilient content, locale handling, and accessible
  feedback on changed pages/components.
- For `UPRF-MOB-001`, `mobile-readiness-security-reviewer`,
  `mobile-readiness-contract-tester`, and `mobile-readiness-release-auditor` enforce the program
  security, claimed-evidence, and close-out boundaries. `mobile-readiness-mapper` is read-only
  orientation, not an approval.

Design taste, copy quality, SEO ideas, performance suggestions without an accepted budget, and
provider recommendations are advisory unless an applicable project standard makes a specific
finding blocking. Reviewers report evidence and minimal fixes; they do not mutate the files they
review.

## 5. Conditional providers and plugins

Optional provider skills remain conditional or unavailable until their exact local dependency,
connected account, permission mode, data boundary, and cost model are verified. Missing capability
must produce an unavailable result, not an improvised fallback that claims provider evidence.
External writes—including messages, submissions, uploads, CMS publication, index notifications,
account changes, purchases, and plugin installation—require explicit authorization.

### Retired repository SEO suite

On 2026-07-23, the owner confirmed that this repository does not own the public website and does
not need a repository-local SEO provider suite. The 31 tracked SEO skill bundles and 18 tracked SEO
agent entrypoints (250 files total) were therefore retired rather than promoted into the governed
tooling surface. The historical capability review and Git history preserve the evidence and prior
implementation. Reintroduction belongs in the repository that owns the public website and requires
fresh dependency, credential, permission, and trigger review.

Deprecation is evidence-led: mark a capability conditional, unavailable, superseded, or archive
candidate; record owner, reason, replacement, and observation date; then obtain owner approval before
removal. Do not mass-delete optional bundles.

#### AMENDED 2026-07-26 (owner-approved) — the untracked SEO mirrors are removed

**Amends §1's "not copied, promoted, deleted, edited, or validated" for exactly this one set.**
§1 and §5 did not literally contradict each other — §5 scoped its retirement to the **tracked**
bundles, and `ff76e01` deleted only those, while §1 protected the **untracked** trees. The conflict
was on *effect*: the owner's recorded finding that this repository does not need a repository-local
SEO suite was **unrealised for Codex**, because `.agents/skills` and `.codex/agents` are Codex's real
discovery roots. Claude loaded 0 SEO capabilities; Codex loaded 49.

- **Owner:** Moroni Salvador · **Approved:** 2026-07-26 · **Observed:** 2026-07-26
- **Removed:** 31 `.agents/skills/seo*` bundles (232 files, 1,540,210 B) and 18
  `.codex/agents/seo*.toml` (64,912 B).
- **Reason:** they are stale mirrors of content this document already retired. Deleting them realises
  the 2026-07-23 decision for both runtimes instead of one.
- **Evidence requirement — already satisfied, which is why removal beats quarantine.** §5 above states
  that "the historical capability review and Git history preserve the evidence and prior
  implementation." Verified: **93 SEO `SKILL.md` files are recoverable from history**, retired by
  `ff76e01`. Quarantining would have committed ~1.6 MB to preserve what Git already holds.
- **Replacement:** none in this repository. Reintroduction belongs in the repository that owns the
  public website, per §5, and requires fresh dependency, credential, permission and trigger review.
- **Measured effect:** Codex's skill-description budget drops from **17,439 to 10,671 chars** against
  a documented **8,000-char cap** — SEO was 38% of the overage. Still over; the remaining gap includes
  the coverage work (12 of 44 tracked capability entrypoints are now neutral-governed), not this
  deletion. Recorded so the improvement is not mistaken for a fix.

**This amendment does not weaken §1.** Its prohibition stands for every other capability in those
trees, and "do not mass-delete optional bundles" stands as written. This is a single named set, with
owner approval, a recorded rationale, and evidence preserved independently — the exact conditions §5's
deprecation paragraph requires.

## 6. Validation and known owner gates

Run:

```text
npm run generate:tooling
npm run check:tooling-generated
npm run preflight:mobile
npm run validate:tooling
npm run test:tooling
```

The validator checks entrypoint metadata, governed local references, broad-dispatcher collisions,
neutral-source portability, generated Claude/Codex adapter drift, reviewer parity for migrated
capabilities, and dangerous or secret-bearing shared permission patterns. Tooling tests exercise
runtime metadata rendering, trigger decisions, mobile preflight branch/foundation rules, and exact
generated drift. Broken references, generated drift, runtime-specific language in a neutral source,
and unsafe shared permissions are blocking. Optional/conditional bundle reference debt is reported
as non-blocking so it can be repaired deliberately rather than mass-rewritten.

The formerly tracked `.claude/settings.local.json` is now untracked, but CAP-SEC-001 and CAP-GOV-001
remain external owner gates: untracking did not rotate a credential or clean repository history.
The owner must still rotate/revoke the credential, review history, sanitize the machine-local file,
and reset local approvals.

## 7. Neutral Claude/Codex adapter model

The owner approved this direction on 2026-07-23 and authorized the first implementation on
2026-07-24. Claude Code and Codex share the same project law and both route to the tracked
`.claude/rules/` standards. The first tranche migrated the four interacting UPR dispatchers
(`new-feature`, `masterplan`, `db-migration`, and `new-crm-module`) plus
`upr-pattern-checker`, `worker-security-reviewer`, and `db-foundation-phase-reviewer`. The mobile
tranche adds `mobile-readiness-wave` plus its mapper, security reviewer, contract tester, and
release auditor:

- one capability manifest naming the neutral source and every generated output;
- one neutral instruction body using repository-root symbolic references rather than
  runtime-specific `.claude`/`.codex` paths;
- small deterministic renderers for Claude skill/agent frontmatter and Codex adapter formats;
- generated-file headers with source hashes, exact drift checks, path validation, and
  cross-runtime safety/trigger decision fixtures;
- adapters containing pointers where the runtime supports them, with content duplication only when
  required and always generated.

The mobile instructions now live only under `tooling/skills/` and `tooling/agents/`. The standard
renderer generates both runtimes, and the retired mobile-only manifest/renderer no longer forms a
second source of truth. `tooling/capabilities.json` retains the prior runtime choices: Claude tools,
model, effort, and `maxTurns`; Codex model, reasoning effort, and sandbox. The mapper, security
reviewer, and release auditor are green/read-only. The amber contract tester alone retains
`workspace-write` for bounded local caches and test artifacts.

The interface-craft tranche adds the UPR-authored `upr-interface-craft` supporting skill and
`interface-accessibility-reviewer` in both runtimes. Its redesign reference is the first governed
skill resource copied by the neutral renderer; resource paths are confined to the skill source
directory and cannot overwrite `SKILL.md` or Codex interface metadata. The skill remains subordinate
to the existing `new-feature` and `masterplan` dispatchers, so it improves interface decisions
without creating another broad workflow owner.

`maxTurns` remains explicitly Claude-only. The retired custom Codex adapter never emitted a turn
cap, and the governed Codex configuration surface has no verified per-agent turn-cap key. The
cross-runtime five-minute subprocess bound remains in the neutral instructions rather than being
silently translated into an unsupported configuration field. The skill remains implicitly
invocable in both runtimes; red classifies its potential blast radius and does not authorize a live
action.

This is an incremental migration, not a silent port of all repository tooling. Broader promotion
remains open under `GOV-001`; quality gates and project-law precedence must stay identical before
another domain is added.

Run `npm run generate:tooling` after changing a neutral source, then
`npm run check:tooling-generated`, `npm run validate:tooling`, and `npm run test:tooling`.
Do not hand-edit a generated adapter. Expansion beyond the pilot is incremental: inventory the
candidate, preserve provenance/license, add the neutral source and manifest entry, generate both
runtimes, and prove equivalent decisions before declaring it authoritative. Quality gates and
project-law precedence remain identical in Claude Code and Codex.
