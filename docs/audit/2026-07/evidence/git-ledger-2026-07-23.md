<!--
FILE: docs/audit/2026-07/evidence/git-ledger-2026-07-23.md
PURPOSE: Exact Git reachability inventory for commits and branch tips dated 2026-07-23 MDT.
LAST VERIFIED: 2026-07-23
-->

# Git ledger — 2026-07-23

Captured after `git fetch origin --prune` with `origin/dev=b6d7092a` and `origin/main=891804a2`. The date window is 2026-07-23 00:00:00 through 23:59:59 MDT, plus explicitly requested unreferenced object `3841056` from 2026-07-22. “Branch-only” means not reachable from either release branch; it does not mean the work should be merged.

## Commit inventory

| Commit | Committed (MDT) | Reachability | Disposition note | Subject |
|---|---|---|---|---|
| `b6d7092a` | 2026-07-23T18:12:12-06:00 | dev only | documented by phase/evidence ledger | fix(security): make public form RPC worker-only |
| `3b598c6f` | 2026-07-23T18:08:12-06:00 | dev only | documented by phase/evidence ledger | Merge pull request #505 from moronisalvador/codex/messaging-post-recovery |
| `221a41a9` | 2026-07-23T18:06:22-06:00 | dev only | documented by phase/evidence ledger | docs(messaging): record CallRail recovery evidence |
| `bf3b0b9d` | 2026-07-23T17:52:55-06:00 | dev only | documented by phase/evidence ledger | docs(qa): close isolated foundation decisions |
| `69076d10` | 2026-07-23T17:45:58-06:00 | dev only | documented by phase/evidence ledger | docs(registry): track messaging verification tails |
| `25da8365` | 2026-07-23T17:45:47-06:00 | dev only | documented by phase/evidence ledger | docs(messaging): reconcile live transport state |
| `43fdcba6` | 2026-07-23T17:45:33-06:00 | dev only | documented by phase/evidence ledger | docs(worker): mark CallRail webhook public boundary |
| `94b2e9f1` | 2026-07-23T17:30:29-06:00 | dev only | documented by phase/evidence ledger | Merge pull request #504 from moronisalvador/codex/callrail-webhook-id-drift |
| `2fbf7552` | 2026-07-23T17:28:10-06:00 | dev only | documented by phase/evidence ledger | fix(messaging): tolerate missing CallRail event id |
| `b33220f2` | 2026-07-23T17:28:10-06:00 | branch-only | rebased duplicate; integrated as 2fbf7552 | fix(messaging): tolerate missing CallRail event id |
| `fc21d6d2` | 2026-07-23T17:25:11-06:00 | dev only | documented by phase/evidence ledger | Merge pull request #503 from moronisalvador/codex/callrail-live-contract-fix |
| `3e2c4c4b` | 2026-07-23T17:23:21-06:00 | dev only | documented by phase/evidence ledger | docs: record Encircle rollout readiness |
| `4799feb3` | 2026-07-23T17:22:49-06:00 | dev only | documented by phase/evidence ledger | fix(db): keep Encircle rollback least privileged |
| `d22a6926` | 2026-07-23T17:22:43-06:00 | dev only | documented by phase/evidence ledger | fix(messaging): handle live CallRail contracts |
| `2f26c1dd` | 2026-07-23T17:07:00-06:00 | dev only | documented by phase/evidence ledger | fix(ci): fetch provenance history |
| `da31168d` | 2026-07-23T17:03:44-06:00 | dev only | documented by phase/evidence ledger | docs: add F2 provenance handoff |
| `e07cf111` | 2026-07-23T17:03:35-06:00 | dev only | documented by phase/evidence ledger | docs: close Foundation F2 provenance phase |
| `90c48e9f` | 2026-07-23T17:03:22-06:00 | dev only | documented by phase/evidence ledger | docs(db): record F2 provenance evidence |
| `8c3fc051` | 2026-07-23T16:59:05-06:00 | dev only | documented by phase/evidence ledger | fix(db): harden provenance release gate |
| `2cef07bd` | 2026-07-23T16:51:57-06:00 | dev only | documented by phase/evidence ledger | ci: enforce migration provenance evidence |
| `047ac505` | 2026-07-23T16:51:27-06:00 | dev only | documented by phase/evidence ledger | test(db): add migration provenance gate |
| `62616016` | 2026-07-23T16:48:54-06:00 | dev only | documented by phase/evidence ledger | chore(db): restore reviewed CRM migration provenance |
| `891804a2` | 2026-07-23T16:57:16-06:00 | main release anchor | documented by phase/evidence ledger | Merge pull request #502 from moronisalvador/dev |
| `0723833b` | 2026-07-23T16:52:42-06:00 | dev + main | documented by phase/evidence ledger | Merge pull request #501 from moronisalvador/codex/messaging-setup-ui |
| `5df64d29` | 2026-07-23T16:45:47-06:00 | dev + main | documented by phase/evidence ledger | feat(settings): add messaging setup panel |
| `5115455e` | 2026-07-23T16:45:35-06:00 | dev + main | documented by phase/evidence ledger | feat(messaging): add admin setup contract |
| `367b4650` | 2026-07-23T16:40:29-06:00 | dev + main | documented by phase/evidence ledger | docs: mark critical SQL finding contained |
| `f0cdf975` | 2026-07-23T16:40:09-06:00 | dev + main | documented by phase/evidence ledger | docs: close foundation containment phase |
| `0d4f39b8` | 2026-07-23T16:39:49-06:00 | dev + main | documented by phase/evidence ledger | docs: preserve service-only SQL boundary |
| `d4a15f5a` | 2026-07-23T16:39:30-06:00 | dev + main | documented by phase/evidence ledger | docs: update database containment boundary |
| `842adf71` | 2026-07-23T16:39:12-06:00 | dev + main | documented by phase/evidence ledger | docs: record exec_read_sql containment apply |
| `06c02ff7` | 2026-07-23T16:08:45-06:00 | main release anchor | documented by phase/evidence ledger | Merge pull request #500 from moronisalvador/dev |
| `1875e63a` | 2026-07-23T16:05:40-06:00 | dev + main | documented by phase/evidence ledger | Merge pull request #499 from moronisalvador/codex/messaging-live-migration-fix |
| `eb27dd51` | 2026-07-23T16:03:27-06:00 | dev + main | documented by phase/evidence ledger | fix(messaging): reconcile live transport schema |
| `cb7918d4` | 2026-07-23T15:46:35-06:00 | dev + main | documented by phase/evidence ledger | Merge pull request #498 from moronisalvador/dev |
| `ff76e01f` | 2026-07-23T15:42:59-06:00 | dev + main | documented by phase/evidence ledger | chore: retire repository SEO tooling |
| `01c567cc` | 2026-07-23T15:35:24-06:00 | dev + main | documented by phase/evidence ledger | test: isolate tooling governance runner |
| `b8836215` | 2026-07-23T15:33:28-06:00 | dev + main | documented by phase/evidence ledger | test: fix secret hook CI fixture |
| `ef856583` | 2026-07-23T15:28:24-06:00 | dev + main | documented by phase/evidence ledger | chore: govern repository skills agents and tooling |
| `8e1928ba` | 2026-07-23T15:22:23-06:00 | dev + main | documented by phase/evidence ledger | fix(messaging): close recovery and recipient claim races |
| `1d1618c0` | 2026-07-23T15:14:11-06:00 | dev + main | documented by phase/evidence ledger | docs(messaging): add Twilio RCS readiness contract |
| `3d7da538` | 2026-07-23T15:13:50-06:00 | dev + main | documented by phase/evidence ledger | feat(messaging): build disabled provider-neutral transport |
| `285467d1` | 2026-07-23T15:22:23-06:00 | branch-only | rebased duplicate; integrated as 8e1928ba | fix(messaging): close recovery and recipient claim races |
| `1566323f` | 2026-07-23T15:14:11-06:00 | branch-only | rebased duplicate; integrated as 1d1618c0 | docs(messaging): add Twilio RCS readiness contract |
| `241915f7` | 2026-07-23T15:13:50-06:00 | branch-only | rebased duplicate; integrated as 3d7da538 | feat(messaging): build disabled provider-neutral transport |
| `5cf546b3` | 2026-07-23T15:07:31-06:00 | dev + main | documented by phase/evidence ledger | fix: contain exec_read_sql to service role |
| `a5b3c9da` | 2026-07-23T14:51:04-06:00 | dev + main | documented by phase/evidence ledger | docs: add QA access and test foundation roadmap |
| `5c22e94a` | 2026-07-23T14:51:45-06:00 | dev + main | documented by phase/evidence ledger | docs: add engineering foundation roadmap |
| `d974de5b` | 2026-07-23T15:07:31-06:00 | branch-only | rebased duplicate; integrated as 5cf546b3 | fix: contain exec_read_sql to service role |
| `b5e4799c` | 2026-07-23T14:51:45-06:00 | branch-only | rebased duplicate; integrated as 5c22e94a | docs: add engineering foundation roadmap |
| `ad2a2748` | 2026-07-23T14:51:04-06:00 | branch-only | rebased duplicate; integrated as a5b3c9da | docs: add QA access and test foundation roadmap |
| `0a06a212` | 2026-07-23T14:43:57-06:00 | dev + main | documented by phase/evidence ledger | feat: add managed Encircle credentials |
| `a6cd6528` | 2026-07-23T12:26:32-06:00 | branch-only | superseded transport branch tip; evolved implementation integrated in dev | Add provider-neutral messaging transport foundation |
| `b55008f6` | 2026-07-23T09:50:27-06:00 | dev + main | documented by phase/evidence ledger | Merge pull request #497 from moronisalvador/dev |
| `3b1f6021` | 2026-07-23T09:48:09-06:00 | dev + main | documented by phase/evidence ledger | docs: audit development capabilities and handoff rules |
| `d3fd17ad` | 2026-07-23T17:47:29-06:00 | branch-only | temporary recovery code; live recovery completed and all deployments/branch deleted; never merge | ops(messaging): add bounded CallRail history recovery |
| `38410565` | 2026-07-22T17:08:45-06:00 | branch-only | shared-production QA proposal superseded by isolated-QA addendum bf3b0b9d; never merge | docs: plan of record for repairing the integration test suite's auth |

## Branch-tip inventory

Remote pruning confirmed `origin/codex/callrail-history-recovery-once` is absent. Current July 23 tips are:

| Ref | Tip | Date | Subject |
|---|---|---|---|
| `codex/callrail-live-contract-fix` | `b33220f` | 2026-07-23T17:28:10-06:00 | fix(messaging): tolerate missing CallRail event id |
| `codex/callrail-webhook-id-drift` | `2fbf755` | 2026-07-23T17:28:23-06:00 | fix(messaging): tolerate missing CallRail event id |
| `codex/exec-read-sql-containment` | `d974de5` | 2026-07-23T15:07:31-06:00 | fix: contain exec_read_sql to service role |
| `codex/foundation-roadmap` | `b5e4799` | 2026-07-23T14:51:45-06:00 | docs: add engineering foundation roadmap |
| `codex/message-notification-outbox-scheduler` | `b6d7092` | 2026-07-23T18:12:22-06:00 | fix(security): make public form RPC worker-only |
| `codex/messaging-live-migration-fix` | `eb27dd5` | 2026-07-23T16:03:27-06:00 | fix(messaging): reconcile live transport schema |
| `codex/messaging-setup-ui` | `5df64d2` | 2026-07-23T16:49:55-06:00 | feat(settings): add messaging setup panel |
| `codex/messaging-transport-build` | `a6cd652` | 2026-07-23T12:26:32-06:00 | Add provider-neutral messaging transport foundation |
| `codex/messaging-transport-integration` | `285467d` | 2026-07-23T15:22:23-06:00 | fix(messaging): close recovery and recipient claim races |
| `codex/messaging-transport-phase-1` | `a6cd652` | 2026-07-23T12:26:32-06:00 | Add provider-neutral messaging transport foundation |
| `codex/qa-access-roadmap` | `ad2a274` | 2026-07-23T14:51:04-06:00 | docs: add QA access and test foundation roadmap |
| `codex/tooling-governance` | `cb7918d` | 2026-07-23T15:46:35-06:00 | Merge pull request #498 from moronisalvador/dev |
| `dev` | `b6d7092` | 2026-07-23T18:12:22-06:00 | fix(security): make public form RPC worker-only |
| `origin` | `b6d7092` | 2026-07-23T18:12:22-06:00 | fix(security): make public form RPC worker-only |
| `origin/codex/callrail-live-contract-fix` | `d22a692` | 2026-07-23T17:22:43-06:00 | fix(messaging): handle live CallRail contracts |
| `origin/codex/callrail-webhook-id-drift` | `2fbf755` | 2026-07-23T17:28:23-06:00 | fix(messaging): tolerate missing CallRail event id |
| `origin/codex/messaging-live-migration-fix` | `eb27dd5` | 2026-07-23T16:03:27-06:00 | fix(messaging): reconcile live transport schema |
| `origin/codex/messaging-setup-ui` | `5df64d2` | 2026-07-23T16:49:55-06:00 | feat(settings): add messaging setup panel |
| `origin/codex/messaging-transport-phase-1` | `a6cd652` | 2026-07-23T12:26:32-06:00 | Add provider-neutral messaging transport foundation |
| `origin/dev` | `b6d7092` | 2026-07-23T18:12:22-06:00 | fix(security): make public form RPC worker-only |
| `origin/main` | `891804a` | 2026-07-23T16:57:16-06:00 | Merge pull request #502 from moronisalvador/dev |

## Interpretation

- Main-only merge anchors `06c02ff7` and `891804a2` are GitHub release merges; their content ancestors are represented separately.
- Rebased duplicate and superseded branch commits are historical provenance, not missing delivery.
- `d3fd17a` is both branch-only historical evidence and superseded. Reintroducing it would violate the documented cleanup of the bounded CallRail recovery route.
- `3841056` is both branch-only historical evidence and superseded by the isolated-QA decision package.
- Branch/worktree deletion remains an owner/release cleanup action; this evidence does not authorize deletion.
