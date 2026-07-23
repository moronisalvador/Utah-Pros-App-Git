# July 2026 Skills, Agents, Plugins and Tooling Review

Audit date: 2026-07-23
Evidence commit: `4042bda`
Review scope: repository-local Claude/Codex skills, repository-local agent definitions,
Claude hooks and permission files, and the development-related Codex plugin/tool surface visible
to this session.

This is a dated evidence snapshot, not permanent project law. It does not activate, install,
remove or rewrite a capability. Recommendations must be reviewed before implementation.

## Executive verdict

The repository has a strong collection of specialized safeguards, but the collection is not ready
to be treated as one coherent automation system.

- The tracked `.claude/` tree is the only demonstrated durable source: 55 skills and 32 agents.
- The untracked `.agents/` and `.codex/` trees are candidate Codex ports. They contain broken path
  substitutions, one missing phase reviewer and about 6 MB of duplicated skill content.
- The highest-value capabilities are the UPR-specific read-only checkers, the planning/build
  workflows, Supabase guidance, Playwright guidance and the UI/design references.
- The highest risks are a credential committed in a local permission file, broad persistent
  command/database permissions, database skills that normalize applying changes to the one shared
  production database, write-capable UI automation, incomplete dependency bundles and overlapping
  broad triggers.
- The marketing and SEO library is potentially valuable, but it should be an explicit, conditional
  toolbox rather than part of the default software-development path. Several provider integrations
  are unavailable, paid, incomplete or path-broken in the current repository.

Recommended policy: keep a small active core, make specialist libraries explicit/conditional,
repair safety and path defects, generate runtime adapters from one canonical source, and deprecate
before archiving. Do not mass-delete the current collection.

## Inventory and coverage

| Group | Discovered | Inspected | Coverage | Notes |
|---|---:|---:|---|---|
| `.claude/skills/*/SKILL.md` | 55 | 55 | Full entrypoint inspection | Supporting references/scripts were inspected by link/path validation and targeted risk review, not line-by-line in every large reference file. |
| `.agents/skills/*/SKILL.md` | 55 | 55 | Full comparison against tracked source | All are untracked; 21 entrypoints differ from `.claude`, mostly unsafe path/runtime substitutions. |
| `.claude/agents/*.md` | 32 | 32 | Full | Tracked Claude definitions. |
| `.codex/agents/*.toml` | 31 | 31 | Full comparison/metadata inspection | Untracked; `db-foundation-phase-reviewer` is absent. |
| `.claude/hooks/*` | 2 active safety hooks | 2 | Full | No committed hook test suite was found. |
| `.claude/settings.json` | 1 | 1 | Full | Tracked shared permissions/hooks. |
| `.claude/settings.local.json` | 1 | 1 | Full, secrets redacted | Despite its name, this file is tracked and has Git history. |
| Codex plugin cache/tool surface | 37 cached manifests found | 37 metadata manifests | Partial operational coverage | Cache presence is not proof of authentication, connection or permission state. No plugin was invoked to inspect private data. |

## Findings

### Finding CAP-SEC-001 — A live-looking bearer credential is committed in a tracked “local” settings file

- **Severity:** Critical
- **Confidence:** confirmed
- **Evidence:** `.claude/settings.local.json:50`; Git history for this file includes commits
  `aa5c729`, `9227fd7`, `163fe87`, `14bdabb` and `ce42e4e`.
- **Affected workflow:** Encircle integration access, repository cloning, Claude local permissions
  and any environment where repository history is available.
- **Observed behavior:** a historical curl permission embeds an `Authorization: Bearer` value
  directly in a tracked file. The credential value is intentionally omitted from this report.
- **Realistic failure scenario:** someone with repository or history access reuses the credential
  against the provider API, reads customer/job information or performs provider actions allowed by
  that token.
- **Business impact:** unauthorized third-party access, customer-data exposure, integration abuse,
  incident-response cost and possible contractual/privacy consequences.
- **Recommended remediation:** revoke/rotate the provider credential immediately; remove the value
  from the current tree; stop tracking `.claude/settings.local.json`; add a sanitized example if
  needed; scan all Git history and coordinate any history rewrite only after rotation and team
  notification. Expand secret detection to generic bearer tokens and provider-specific formats.
- **Regression test / verification:** the old credential is rejected by the provider; the current
  tree and full Git history pass an approved secret scanner; a fixture containing a generic bearer
  token is blocked by the repository secret hook.
- **Estimated effort:** S for rotation/current-tree repair; M if coordinated history rewriting is
  required.
- **Dependencies:** provider-owner access; repository-owner decision on history rewriting.

### Finding CAP-SEC-002 — The secret-writing hook does not detect the credential format that was committed

- **Severity:** High
- **Confidence:** confirmed
- **Evidence:** `.claude/hooks/block-secrets.sh:31-45`;
  `.claude/settings.local.json:50`; no hook tests found by repository search.
- **Affected workflow:** every Claude `Write`/`Edit` action and any future credential/configuration
  change.
- **Observed behavior:** the hook detects a narrow set of service-role, Stripe, AWS, private-key and
  Slack patterns, but not generic bearer tokens or the provider credential already committed.
- **Realistic failure scenario:** a new Twilio, Resend, Encircle, GitHub, Google or generic OAuth
  credential is pasted into code/configuration and the hook permits it.
- **Business impact:** repeated secret exposure despite a false sense of protection.
- **Recommended remediation:** add tested high-confidence patterns for generic authorization
  headers and the providers UPR uses; add entropy/allowlist-aware scanning through a maintained
  scanner such as Gitleaks or TruffleHog in pre-commit/CI; keep public Supabase keys explicitly
  allowlisted.
- **Regression test / verification:** a committed fixture suite proves true positives are blocked
  and public keys/placeholders are allowed; CI scans the complete diff and fails a seeded fake token.
- **Estimated effort:** S–M.
- **Dependencies:** CAP-SEC-001.

### Finding CAP-GOV-001 — Shared and machine-local permission files grant overly broad mutation authority

- **Severity:** High
- **Confidence:** confirmed
- **Evidence:** `.claude/settings.json:63-90`;
  `.claude/settings.local.json:11,45-50`; the local file also contains machine-specific deletion,
  process-kill, Git push/reset and provider command approvals.
- **Affected workflow:** Git delivery, database changes, provider access, local filesystem/process
  control and future unattended agent sessions.
- **Observed behavior:** shared settings allow Git commit/push and Supabase `execute_sql`/
  `apply_migration`; the tracked local file accumulates broad one-off approvals, including commands
  with destructive potential.
- **Realistic failure scenario:** a broadly triggered skill or mistaken instruction performs a
  database or Git mutation without a fresh task-specific approval, or a stale machine path targets
  the wrong workspace.
- **Business impact:** unintended production changes, data loss/corruption, source-history damage and
  weakened accountability.
- **Recommended remediation:** make shared repository permissions read-mostly; require explicit
  approval for commit, push, migrations, arbitrary SQL, provider writes and destructive filesystem
  actions; stop tracking the local file; reset local approvals to a minimal reviewed set.
- **Regression test / verification:** a clean session can read/build/test without prompts, but asks
  before database writes, Git delivery, provider writes and destructive actions.
- **Estimated effort:** S.
- **Dependencies:** CAP-SEC-001.

### Finding CAP-DB-001 — Database skills conflict with the repository’s current owner-authorization law

- **Severity:** High
- **Confidence:** confirmed
- **Evidence:** `.claude/skills/db-migration/SKILL.md:50-58`;
  `.claude/skills/new-crm-module/SKILL.md:10-13`;
  `.claude/skills/new-feature/SKILL.md:34-43`;
  `.claude/skills/supabase/SKILL.md:129-140`;
  `AGENTS.md` “Git and deployment” and “Definition of done” sections.
- **Affected workflow:** every migration, RPC/policy change, CRM phase and Supabase troubleshooting
  task.
- **Observed behavior:** several skills describe applying migrations or using direct SQL as a normal
  workflow. The current root manual says never apply a shared-database migration unless the user
  requested implementation and the apply-window/verification workflow is satisfied.
- **Realistic failure scenario:** an agent follows the lower-level skill literally and applies SQL to
  the shared production database during planning, local experimentation or an implementation task
  that did not include deployment authorization.
- **Business impact:** immediate production outage, authorization regression, locked hot tables or
  migration-history drift.
- **Recommended remediation:** insert an unambiguous UPR override at the top of every database-related
  skill: read-only live inspection is allowed; repository migration authoring is allowed when
  requested; live apply requires separate explicit owner authorization, reviewed commit provenance,
  apply window, rollback and post-apply verification. Never use `execute_sql` for iterative schema
  work on the shared project.
- **Regression test / verification:** prompt evaluations for “plan a migration,” “write a migration,”
  and “apply this migration” produce three distinct behaviors and only the last can reach an apply
  tool after explicit authorization.
- **Estimated effort:** S.
- **Dependencies:** CAP-GOV-001.

### Finding CAP-PORT-001 — The Codex ports are untracked, duplicated and internally broken

- **Severity:** High
- **Confidence:** confirmed
- **Evidence:** 555 files/6,060,230 bytes under tracked `.claude/skills`; 555 files/6,060,173
  bytes under untracked `.agents/skills`; 32 tracked `.claude/agents`; 31 untracked
  `.codex/agents`; 23 Codex files reference nonexistent `.Codex/` paths;
  `.codex/agents/db-foundation-phase-reviewer.toml` is absent.
- **Affected workflow:** every Codex skill invocation and named UPR reviewer.
- **Observed behavior:** the adapter copied the complete skill library, then mechanically replaced
  paths such as `.claude/rules/` with `.Codex/rules/`. That directory does not exist. `AGENTS.md`
  references were also given nonexistent numbered rules.
- **Realistic failure scenario:** a Codex checker silently skips project law, a database workflow
  reads no standard, or a phase closes without its required reviewer.
- **Business impact:** inconsistent Claude/Codex behavior and safety checks that appear installed but
  cannot execute correctly.
- **Recommended remediation:** do not commit the current ports as-is. Declare tracked `.claude/`
  content the temporary authority; design one canonical neutral registry/source and generate
  runtime-specific adapters with path validation. Until generation exists, make the minimal Codex
  adapters point to real `.claude/rules/` and `CLAUDE.md`/`AGENTS.md` authority rather than inventing
  parallel rules.
- **Regression test / verification:** adapter generation is deterministic; a clean checkout produces
  zero missing paths; Claude and Codex evaluation prompts return equivalent safety decisions; all
  required phase reviewers are present.
- **Estimated effort:** M.
- **Dependencies:** owner approval of canonical-source strategy.

### Finding CAP-TRIG-001 — Broad overlapping skills can fire together and produce conflicting process

- **Severity:** Medium
- **Confidence:** confirmed
- **Evidence:** broad descriptions in `.claude/skills/impeccable/SKILL.md:1-13`,
  `.claude/skills/masterplan/SKILL.md:1-4`, `.claude/skills/new-feature/SKILL.md:1-4`,
  `.claude/skills/supabase/SKILL.md:1-4`, `.claude/skills/seo/SKILL.md:1-4`, plus the Apple,
  Emil, animation, CRO, copywriting and specialist SEO entrypoints.
- **Affected workflow:** non-trivial features, UI work, database work, marketing pages and SEO.
- **Observed behavior:** several skills claim the same natural-language requests. No executable
  precedence/collision tests define dispatcher versus specialist behavior.
- **Realistic failure scenario:** a UI change invokes several long design philosophies, a Supabase
  change receives conflicting generic/project guidance, or a small task expands into a full
  masterplan/feature/SEO workflow.
- **Business impact:** slower work, context waste, contradictory output and users learning to bypass
  useful safeguards.
- **Recommended remediation:** define one dispatcher per domain; make specialists explicit or
  dispatcher-selected; add positive, negative and collision prompt evaluations. Hard gates apply to
  money, migrations, auth, outbound messaging, secrets, deployment and destructive actions; most
  style reviews remain on-demand.
- **Regression test / verification:** a fixed prompt suite records exactly which skill(s) should
  trigger and flags unexpected multi-trigger results.
- **Estimated effort:** M.
- **Dependencies:** CAP-PORT-001.

### Finding CAP-DEP-001 — Several capability bundles reference missing files, scripts or integrations

- **Severity:** Medium
- **Confidence:** confirmed
- **Evidence:** five marketing entrypoints link to missing `.claude/CONNECTORS.md`; multiple SEO
  agents call root `scripts/*.py` although scripts live under `.claude/skills/seo/scripts/`;
  extension skills reference missing root `extensions/`; automated link validation found 58 missing
  relative targets, including numerous absent Playwright CI/POM guides.
- **Affected workflow:** marketing research, SEO audits, provider data, Playwright architecture and
  report generation.
- **Observed behavior:** entrypoints advertise commands and resources that cannot resolve from the
  repository root.
- **Realistic failure scenario:** an agent spends time retrying nonexistent commands, silently falls
  back to weaker evidence or claims a provider-backed result without the provider.
- **Business impact:** unreliable output, wasted paid API calls/time and false confidence.
- **Recommended remediation:** validate every entrypoint/reference in CI; use skill-base-relative
  paths; mark provider skills unavailable until their exact tool/account exists; remove or restore
  references omitted from vendor bundles.
- **Regression test / verification:** link/path validator reports zero unexplained missing local
  targets; each conditional provider skill has a failing “dependency absent” evaluation and a
  passing configured evaluation.
- **Estimated effort:** M.
- **Dependencies:** CAP-PORT-001.

### Finding CAP-HOOK-001 — SQL and UI hooks are useful but untested and do not enforce authorization

- **Severity:** Medium
- **Confidence:** confirmed
- **Evidence:** `.claude/hooks/block-destructive-sql.sh:1-61`;
  `.claude/settings.json:16-48`; no committed tests found.
- **Affected workflow:** database tool calls and every Claude source edit.
- **Observed behavior:** the SQL hook blocks a limited destructive-pattern list but permits any
  `DELETE`/`UPDATE` containing a `WHERE`, object drops and all additive DDL. The Impeccable hook runs
  after all writes/edits. Neither hook proves the user authorized the action.
- **Realistic failure scenario:** a narrowly filtered but incorrect production update passes;
  permission allowlists are mistaken for task authorization; a global UI hook adds latency/noise to
  non-UI edits.
- **Business impact:** production data damage or routine work slowed by non-scoped automation.
- **Recommended remediation:** keep hooks as defense-in-depth, not authority; add fixture tests;
  require fresh authorization/provenance for production SQL; scope the UI hook to relevant file
  classes and measure false positives.
- **Regression test / verification:** a matrix of destructive, bounded-data, additive and read-only
  SQL fixtures has expected outcomes; non-UI edits do not run UI analysis.
- **Estimated effort:** S–M.
- **Dependencies:** CAP-GOV-001 and CAP-DB-001.

### Finding CAP-STALE-001 — Several checkers embed dated counts, roadmap state and external SEO facts

- **Severity:** Medium
- **Confidence:** likely
- **Evidence:** `.claude/agents/design-consistency-checker.md:12-16`;
  initiative-specific phase reviewers; dated 2025/2026 search/platform statements throughout
  `.claude/skills/seo-*` and SEO agents.
- **Affected workflow:** design review, phase acceptance grading and SEO recommendations.
- **Observed behavior:** prompts include point-in-time debt counts, roadmap assumptions and external
  platform facts without a common `last_verified`, source or expiry mechanism.
- **Realistic failure scenario:** a checker reports already-remediated debt, applies an obsolete
  roadmap contract or advises against current search-engine behavior.
- **Business impact:** false findings and misprioritized engineering/marketing work.
- **Recommended remediation:** add owner/version/last-verified/retirement fields; move changing facts
  to cited references; require current-source verification for external platform claims; retire
  initiative reviewers after their roadmap closes.
- **Regression test / verification:** quarterly review reports stale entries; closed-roadmap agents
  are no longer default candidates.
- **Estimated effort:** S initially, recurring quarterly.
- **Dependencies:** capability registry.

## Skill-by-skill recommendation

Status meanings:

- **Active:** suitable for normal use after any named repair.
- **Conditional:** retain, but invoke only for a matching explicit task.
- **Unavailable:** retain only as a catalog entry until its dependency/account is verified.
- **Archive candidate:** no current UPR need demonstrated; preserve before removal.

| Skill | Recommendation | Rationale / required repair |
|---|---|---|
| `animation-vocabulary` | Active, explicit | Low-risk terminology reference; do not auto-trigger during ordinary UI implementation. |
| `apple-design` | Conditional | Valuable for gesture/native-quality motion; can conflict with UPR product conventions if treated as the default visual language. |
| `brand-review` | Conditional + repair | Useful for claims/voice review; missing connector reference and cannot substitute for legal review. |
| `campaign-plan` | Conditional + repair | Useful marketing planner; missing connector reference; planning only unless outbound actions are separately authorized. |
| `competitive-brief` | Conditional + repair | Useful with current web evidence; missing connector reference; label estimates/inference. |
| `content-strategy` | Conditional + repair | Useful dispatcher; broad trigger and missing CMS references require cleanup. |
| `copywriting` | Conditional | Good drafting reference; should consume one canonical product/brand context. |
| `cro` | Conditional | Useful for public marketing surfaces, not internal app UI by default. |
| `db-migration` | Active after high-priority repair | Core UPR safety skill; must never normalize unrequested shared-production apply. |
| `email-sequence` | Conditional + repair | Drafting/logic only by default; never enroll/send without consent and explicit external-write authorization; missing connector reference. |
| `emil-design-eng` | Conditional reference | High-quality craft material but overlaps Impeccable/Apple/motion skills; dispatcher-selected, not automatic. |
| `impeccable` | Active after repair | Best UI dispatcher; Codex paths are broken, `npx` should be pinned/avoided, pin/unpin mutations need explicit approval, and hooks need scoping/tests. |
| `improve-animations` | Conditional | Read-only motion audit/roadmap; distinct from implementation and diff review. |
| `masterplan` | Active after repair | Valuable for large initiatives; remove automatic commit/push assumptions, constrain fan-out cost, and use real canonical paths. |
| `new-crm-module` | Conditional after high-priority repair | Useful only for active CRM roadmap phases; live migration apply and automatic status mutation require explicit gates. |
| `new-feature` | Active after repair | Good UPR build loop; branching/commit/PR are delivery steps, not implied by implementation; “committed failing test first” should allow an uncommitted red test when delivery was not requested. |
| `performance-report` | Conditional + repair | Useful only with evidenced metrics; missing connector reference and benchmarks must be labeled as contextual. |
| `playwright-core` | Conditional, retain + repair | Strong future E2E foundation; runner is not installed and many nested references are missing. |
| `product-marketing` | Conditional + repair | Establishes useful context; canonical path and write behavior need an owner-approved repository location. |
| `review-animations` | Conditional | Focused read-only motion gate; keep distinct from the broader audit skill. |
| `seo` | Conditional dispatcher | Keep as the only broad SEO trigger; it should select specialists and state data-source limitations. |
| `seo-audit` | Conditional | Large multi-agent workflow; use only for explicit full audits with crawl/cost scope. |
| `seo-page` | Conditional | Useful low-cost single-page entrypoint. |
| `seo-technical` | Conditional + repair | Useful, but script paths and changing external facts require validation. |
| `seo-content` | Conditional + repair | Useful quality review; changing Google/QRG claims require current sources. |
| `seo-schema` | Conditional + repair | Useful generator/validator; validate supported result types against current Google/Schema.org sources. |
| `seo-images` | Conditional | Useful image/performance audit; transformations must preserve originals and require explicit write scope. |
| `seo-sitemap` | Conditional | Useful audit/generation; publishing remains a separate authorized action. |
| `seo-geo` | Conditional + repair | Emerging/high-drift field; require current citations and clearly label inference. |
| `seo-local` | Conditional | Relevant to Utah Pros’ local-service marketing; provider claims require live evidence. |
| `seo-backlinks` | Conditional + repair | Useful when data sources exist; root script paths and confidence constants need validation. |
| `seo-cluster` | Conditional + repair | Useful content architecture specialist; high SERP-call cost and broken blog/path assumptions. |
| `seo-competitor-pages` | Conditional | Useful only for a deliberate comparison-page initiative with fact verification. |
| `seo-content-brief` | Conditional | Useful after keyword/competitive evidence exists; must not manufacture metrics. |
| `seo-drift` | Conditional | Only valid when a baseline already exists; storage/paths require repair. |
| `seo-ecommerce` | Archive candidate | No current e-commerce requirement demonstrated for UPR; paid marketplace dependencies add noise. |
| `seo-flow` | Consolidate candidate | Framework overlaps the SEO dispatcher and content/CRO workflow; keep as optional methodology, not a second dispatcher. |
| `seo-hreflang` | Archive candidate | No current multilingual/international UPR requirement demonstrated. |
| `seo-maps` | Conditional/unavailable | Potentially useful for local visibility; paid DataForSEO/Maps calls need explicit cost approval. |
| `seo-plan` | Conditional | Useful for a deliberate SEO roadmap, not routine development. |
| `seo-programmatic` | Archive candidate | High publishing/reputation risk and no current scaled-page initiative demonstrated. |
| `seo-sxo` | Conditional | Useful bridge between SERP intent and UX; requires live SERP evidence. |
| `seo-ahrefs` | Unavailable until configured | Paid external MCP absent/unverified; installer paths are missing. |
| `seo-bing` | Unavailable until configured | Credentials/extension absent; IndexNow submission is an external write requiring approval. |
| `seo-dataforseo` | Unavailable until configured | Paid calls and 79+ advertised tools; cost script paths are broken and account is unverified. |
| `seo-firecrawl` | Unavailable until configured | Credit-consuming crawler absent/unverified; use only after crawl scope approval. |
| `seo-google` | Unavailable until configured | Google API credentials/properties are unverified; Indexing API writes and reports need repair. |
| `seo-image-gen` | Unavailable; overlap | Existing system image generation is available; this Gemini-specific paid extension is unnecessary unless deliberately chosen. |
| `seo-profound` | Unavailable until configured | Paid provider/account absent; narrow overlap with GEO/SE Ranking. |
| `seo-seranking` | Unavailable until configured | Paid provider/account absent; narrow overlap with GEO/Profound. |
| `seo-unlighthouse` | Conditional/unavailable | Potentially useful free site-wide checks after package pinning; installer path is absent. |
| `supabase-postgres-best-practices` | Active advisory | Good query/schema performance reference; project database law takes precedence. |
| `supabase` | Active with UPR override | Good current vendor guidance; generic local/direct-SQL advice must never target the shared project. |
| `vercel-composition-patterns` | Active advisory | Useful React composition guidance even though UPR is Vite, not Next.js. |
| `vercel-react-best-practices` | Active with scope filter | Use client/React guidance; ignore Next/server-only rules unless the touched surface actually uses them. |

## Agent-by-agent recommendation

| Agent | Recommendation | Rationale / required repair |
|---|---|---|
| `upr-scout` | Active + repair | Excellent bounded read-only investigator; Codex description incorrectly promises Haiku and points to nonexistent `.Codex/rules`. |
| `upr-pattern-checker` | Active + repair | Core mechanical gate; rule 2 still recommends raw `upr:toast` while rule 8 forbids it. Align to `src/lib/toast.js` and real canonical paths. |
| `design-consistency-checker` | Active + refresh | Valuable UI gate; hardcoded debt counts/future-token assumptions must be refreshed after the new design system. |
| `page-behavior-checker` | Active + repair | Valuable lifecycle gate; fix Codex paths and periodically verify named reference implementations. |
| `migration-safety-checker` | Active + repair | Core SQL gate; project-wide scope should replace CRM-only wording where applicable; fix Codex paths. |
| `anon-grant-auditor` | Active + repair | Core least-privilege gate; clarify Postgres `PUBLIC` defaults versus Supabase role grants and preserve read-only live verification. |
| `consent-path-auditor` | Active + refresh | Core messaging compliance gate; exemptions and frozen paths require periodic verification. |
| `impeccable-manual-edit-applier` | Conditional, high-risk | Keep only behind the explicit human Apply event; write-capable, narrow and unsuitable for ordinary delegation. |
| `admin-mobile-phase-reviewer` | Conditional active | Keep while the roadmap has open phases; archive with the completed roadmap later. |
| `crm-phase-reviewer` | Conditional active | Keep while CRM phases remain open. |
| `db-foundation-phase-reviewer` | Conditional active + port | Tracked Claude reviewer is valuable and currently missing from Codex. |
| `settings-phase-reviewer` | Conditional active | Keep while Settings Overhaul remains open. |
| `sms-experience-phase-reviewer` | Conditional active | Keep while SMS Experience remains open; high-value consent/delivery focus. |
| `tech-phase-reviewer` | Conditional active | Keep while Tech Mobile v2 remains open. |
| `seo-backlinks` | Conditional-disabled | Root script paths/provider dependencies are broken or unverified. |
| `seo-cluster` | Conditional-disabled | Writes outputs and depends on SEO orchestration/data; repair paths first. |
| `seo-content` | Conditional-disabled | Useful specialist after script path and current-source repair. |
| `seo-dataforseo` | Unavailable | Paid MCP/account not verified. |
| `seo-drift` | Conditional-disabled | Requires an existing baseline and repaired storage/script paths. |
| `seo-ecommerce` | Archive candidate | No current UPR need; paid provider dependency. |
| `seo-flow` | Consolidate candidate | Overlaps SEO dispatcher/framework skill. |
| `seo-geo` | Conditional-disabled | High-drift facts and optional paid data require current verification. |
| `seo-google` | Unavailable | Credentials/properties and script paths unverified; can create reports/files. |
| `seo-image-gen` | Conditional-disabled | Plan-only agent is safe, but overlaps built-in image generation and an unavailable extension. |
| `seo-local` | Conditional-disabled | Potentially relevant after SEO stack paths/data sources are repaired. |
| `seo-maps` | Unavailable | Paid/free API dependencies and cost controls are not operationally verified. |
| `seo-performance` | Conditional-disabled | Useful after Playwright/Lighthouse installation and repaired script paths. |
| `seo-schema` | Conditional-disabled | Useful after current schema-source and script-path repair. |
| `seo-sitemap` | Conditional-disabled | Useful after SEO orchestrator/output conventions are repaired. |
| `seo-sxo` | Conditional-disabled | Requires live SERP access and repaired renderer paths. |
| `seo-technical` | Conditional-disabled | Useful after renderer/tool path repair. |
| `seo-visual` | Conditional-disabled | Playwright/Chromium are not yet installed in the repository test foundation. |

## Plugin and tool recommendations

Cache visibility is not proof that an app is connected or authenticated. Permission review should be
performed only for plugins the owner chooses to retain.

| Capability | Recommendation |
|---|---|
| TypeScript LSP | Retain and verify it actually starts; high-value code intelligence, low operational risk. |
| GitHub | Retain; allow reads by default, ask before branch/PR/write/delivery actions. |
| Supabase | Retain; read-only inspection by default, always ask before SQL/migration changes. |
| Figma | Install/connect after this capability cleanup; activate one Professional Full-seat month only when QA inspection prerequisites are ready. |
| Built-in Browser | Retain but leave QA configuration deferred as explicitly requested. |
| Chrome control | Retain but use only with a dedicated UPR QA profile later. |
| Computer Use | Retain as a last-mile Windows tool; foreground/destructive actions require explicit scope. |
| Codex Browser Recorder | Conditional; useful evidence artifact, but not a replacement for Playwright assertions and traces. |
| Third-party `browser-use` | Do not enable while built-in Browser/Chrome cover the need; avoids duplicate control stacks and another data-processing boundary. |
| PDF/Documents/Spreadsheets/Presentations | Retain; directly useful for restoration documents, estimates, reports and extraction/verification. |
| Image generation | Retain built-in capability; do not add the Gemini SEO image extension unless a specific need justifies another paid provider. |
| Visualize | Retain for architecture/workflow communication. |
| Sites | Conditional; useful for standalone prototypes, not the default way to modify/deploy UPR. |
| Gmail/Calendar/Contacts/Drive/Slack | Optional business productivity tools; ask before all external writes/messages. |
| QuickBooks | Highly sensitive conditional tool; only explicit read/verification tasks, never automated money actions. |
| HighLevel | Conditional only while migration/comparison work needs it; avoid treating legacy CRM data as a default development dependency. |
| Asana | Optional; do not duplicate roadmap authority already held in repository docs/GitHub unless the owner adopts it. |
| Webflow | Not needed for the React/Vite UPR application; retain only for a separate Webflow-owned marketing property. |
| AllTrails, grocery/delivery, travel, nutrition, Lowe’s, Ramp/Gusto consumer/business apps | Irrelevant to UPR software development. Do not install/connect for this project; remove only after exact installed status and owner approval are confirmed. |
| Atlassian, Box, Notion, Outlook, SharePoint, Teams | Do not install preemptively. Add only when UPR has an authoritative workflow/data source in that platform. |

## Recommended implementation order

1. Rotate the exposed provider credential and remove tracked local permissions from the repository.
2. Reduce shared/local mutation permissions and add tested secret/SQL safety gates.
3. Declare canonical capability ownership and do not commit the current Codex ports as-is.
4. Repair the active UPR core: `masterplan`, `new-feature`, `db-migration`, Supabase precedence and
   the seven core read-only checkers.
5. Add deterministic path/link and trigger-collision evaluations.
6. Restore/generate the minimal Codex adapters, including the missing DB Foundation reviewer.
7. Keep design specialists with explicit routing under Impeccable; refresh the design checker when
   the new Figma-backed standard is approved.
8. Move marketing/SEO capabilities into an explicit conditional catalog; enable providers only when
   their account, cost and tool path are verified.
9. Review exact installed plugin permissions, then connect Figma.
10. Close this tooling initiative before starting the separately scoped UPR Agent QA Access work.

## Decisions requiring owner or external access

- Rotate/revoke the exposed Encircle credential.
- Decide whether to rewrite Git history after rotation.
- Choose the long-term canonical skill source and adapter-generation strategy.
- Approve removal/deprecation of any capability after one observation period.
- Confirm which external plugins/accounts are actually connected and set their permission mode.
- Purchase the one-month Figma Professional Full seat only when the design sprint is ready to start.
