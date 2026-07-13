# docs/archive/

Finished, historical one-shot artifacts relocated from the repo root during the
2026-07-13 root-cleanup. These are **completed** — kept for provenance/history,
not for active work. Nothing in `src/`, `functions/`, CI, or `package.json`
references them; moving them changed no runtime behavior.

| File | What it was | Why archived |
|---|---|---|
| `AUDIT-REPORT.md` | 2026-06-24 full-platform re-audit | Superseded — its open items migrated into `docs/db-foundation-roadmap.md` |
| `TECH-MOBILE-AUDIT-REPORT.md` | Tech-mobile UX audit snapshot | Findings folded into the tech-v2 / UX-quality initiatives; no inbound refs |
| `TIME-TRACKING-PR7-HANDOFF.md` | Time-tracking PR7 handoff | Handoff completed; no inbound refs |

**Not archived (deliberately kept at repo root):** living reference docs
(`BILLING-CONTEXT.md`, `UPR-Web-Context.md`, `UPR-Design-System.md`,
`ENCIRCLE_API_REFERENCE.md`, …), active reconciliation punch-lists
(`BILLING-AR-CONSUMER-CHAIN.md`, `Q2-*`, `RECONCILIATION-HANDOFF.md`), and
dormant-but-referenced plans still pointed to as "(repo root)" by
`UPR-Web-Context.md` (`DASHBOARD-PARTB-PLAN.md`, `DASHBOARD-PHASE4-PLAN.md`,
`QBO-PHASE-2-PLAN.md`, `CLAIM-ESTIMATE-HIERARCHY-PLAN.md`).

One-off data-fix / codemod scripts from the repo root were relocated to
`scripts/one-off/` in the same cleanup.
