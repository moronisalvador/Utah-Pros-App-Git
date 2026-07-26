# UPR Skills, Agents, Plugins, and Tooling Governance

**Status:** owner-approved project law
**Last verified:** 2026-07-24
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
  generated adapters. Other files in those candidate trees remain non-authoritative until separately
  inventoried, reconciled, and added to the manifest.
- `.claude/tooling-governance.json` is validation policy and review metadata.
  `tooling/capabilities.json` is the neutral source registry; neither file contains the instruction
  bodies themselves.

Tracked inventory after the owner-approved SEO retirement: **24 skill entrypoints,
15 agent entrypoints, 23 rules, and 2 hooks**. The validator treats these as reviewed counts and
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

## 6. Validation and known owner gates

Run:

```text
npm run validate:tooling
npm run test:tooling
```

The validator checks entrypoint metadata, governed local references, broad-dispatcher collisions,
neutral-source portability, generated Claude/Codex adapter drift, reviewer parity for migrated
capabilities, and dangerous or secret-bearing shared permission patterns. Broken references,
generated drift, runtime-specific language in a neutral source, and unsafe shared permissions are
blocking. Optional/conditional bundle reference debt is reported as non-blocking so it can be
repaired deliberately rather than mass-rewritten.

The tracked `.claude/settings.local.json` remains a known critical owner gate from CAP-SEC-001 and
CAP-GOV-001. This initiative does not alter credentials. The temporary validator waiver expires on
2026-08-06; the owner must rotate/revoke the credential, review history, sanitize/untrack the file,
and reset local approvals before that date.

## 7. Neutral Claude/Codex adapter model

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

Run `npm run generate:tooling` after changing a neutral source, then
`npm run check:tooling-generated`, `npm run validate:tooling`, and `npm run test:tooling`.
Do not hand-edit a generated adapter. Expansion beyond the pilot is incremental: inventory the
candidate, preserve provenance/license, add the neutral source and manifest entry, generate both
runtimes, and prove equivalent decisions before declaring it authoritative. Quality gates and
project-law precedence remain identical in Claude Code and Codex.
