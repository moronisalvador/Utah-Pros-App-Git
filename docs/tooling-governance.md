# UPR Skills, Agents, Plugins, and Tooling Governance

**Status:** owner-approved project law
**Last verified:** 2026-07-26
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
- Only `.agents/` and `.codex/` files named as outputs in `tooling/capabilities.json` are governed
  neutral-pilot adapters. The separately declared mobile-readiness outputs are also governed;
  unrelated files in those candidate trees remain non-authoritative until inventoried and declared.
- `.claude/tooling-governance.json` is validation policy and review metadata.
  `tooling/capabilities.json` is the neutral source registry; neither file contains the instruction
  bodies themselves. `.claude/mobile-readiness-codex-adapters.json` is the narrow mobile pilot
  mapping consumed by its deterministic renderer.

Tracked canonical inventory after the owner-approved mobile pilot: **25 skill entrypoints,
19 agent entrypoints, 23 rules, and 2 hooks**. The validator treats these as reviewed counts and
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
only broad SEO dispatcher. Supabase, Postgres, design, motion, Playwright, marketing, and provider
skills are specialists selected by a dispatcher or explicit request. A specialist does not
independently expand scope or authorize a write.

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
  a documented **8,000-char cap** — SEO was 38% of the overage. Still over; the remaining gap is the
  coverage work (7 of 39 capabilities governed), not this deletion. Recorded so the improvement is not
  mistaken for a fix.

**This amendment does not weaken §1.** Its prohibition stands for every other capability in those
trees, and "do not mass-delete optional bundles" stands as written. This is a single named set, with
owner approval, a recorded rationale, and evidence preserved independently — the exact conditions §5's
deprecation paragraph requires.

## 6. Validation and known owner gates

Run:

```text
npm run generate:tooling
npm run check:tooling-generated
npm run generate:mobile-codex
npm run preflight:mobile
npm run validate:tooling
npm run test:tooling
```

The validator checks entrypoint metadata, governed local references, broad-dispatcher collisions,
neutral-source portability, generated Claude/Codex adapter drift, reviewer parity for migrated
capabilities, dangerous or secret-bearing shared permission patterns, deterministic mobile adapter
drift, and mobile preflight branch/foundation rules. Broken references, generated drift,
runtime-specific language in a neutral source, and unsafe shared permissions are blocking.
Optional/conditional bundle reference debt is reported as non-blocking so it can be repaired
deliberately rather than mass-rewritten.

The formerly tracked `.claude/settings.local.json` is now untracked, but CAP-SEC-001 and CAP-GOV-001
remain external owner gates: untracking did not rotate a credential or clean repository history.
The owner must still rotate/revoke the credential, review history, sanitize the machine-local file,
and reset local approvals.

## 7. Neutral Claude/Codex adapter model and mobile pilot

The owner approved this direction on 2026-07-23 and authorized the first implementation on
2026-07-24. Claude Code and Codex share the same project law and both route to the tracked
`.claude/rules/` standards. The pilot migrates the four interacting UPR dispatchers
(`new-feature`, `masterplan`, `db-migration`, and `new-crm-module`) plus
`upr-pattern-checker`, `worker-security-reviewer`, and `db-foundation-phase-reviewer`:

- one capability manifest naming the neutral source and every generated output;
- one neutral instruction body using repository-root symbolic references rather than
  runtime-specific `.claude`/`.codex` paths;
- small deterministic renderers for Claude skill/agent frontmatter and Codex adapter formats;
- generated-file headers with source hashes, exact drift checks, path validation, and
  cross-runtime safety/trigger decision fixtures;
- adapters containing pointers where the runtime supports them, with content duplication only when
  required and always generated.

The first narrow implementation is now checked in for `mobile-readiness-wave` and its four bounded
roles:

- `.claude/mobile-readiness-codex-adapters.json` declares canonical source, generated target,
  GPT-5.6 Sol/Terra choice, reasoning effort, and sandbox;
- `scripts/render-mobile-readiness-codex-adapters.mjs` generates project `.codex/agents/*.toml` and
  `.agents/skills/mobile-readiness-wave/*`, or fails `--check` when they drift;
- `.codex/config.toml` enables at most three concurrent subagents, excluding the primary;
- generated headers point back to canonical files and tests assert the read-only/workspace-write
  boundaries and no-external-mutation instructions.

This is a pilot, not a silent port of all repository tooling and not yet the fully neutral package
model described above. The canonical `.claude` bodies still contain runtime-shaped metadata, and
cross-runtime safety decision fixtures are limited to the mobile program. Broader promotion remains
open under `GOV-001`; quality gates and project-law precedence must stay identical before another
domain is added.

Run `npm run generate:tooling` after changing a neutral source, then
`npm run check:tooling-generated`, `npm run validate:tooling`, and `npm run test:tooling`.
Do not hand-edit a generated adapter. Expansion beyond the pilot is incremental: inventory the
candidate, preserve provenance/license, add the neutral source and manifest entry, generate both
runtimes, and prove equivalent decisions before declaring it authoritative. Quality gates and
project-law precedence remain identical in Claude Code and Codex.
