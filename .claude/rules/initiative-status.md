# Initiative Status — Live Coordination State

**Last verified:** 2026-07-29 · This is the ONE always-loaded file recording what is currently in
flight, leased, or unapplied. Full initiative manifests live in `docs/archive/rules/` — they are
history, not law. When an initiative completes, delete its row here; when one starts, add a row
and a roadmap. Do not let this file grow past ~1 page — that is how the last rulebook died.

## Active leases (check before touching a shared hotspot)

| Lease | Holder | Scope | State |
|---|---|---|---|
| Mobile current-origin reconciliation (APP-2/APP-3) | `codex/mobile-readiness-current-origin-review` | `.claude/**`, `AGENTS.md`, `CLAUDE.md`, `tooling/**`, mobile integration seams incl. `src/pages/Conversations.jsx`, `src/pages/tech/v2/messages/*`, `TechLayout.jsx` | ACTIVE until the owner accepts the locally verified handback. Sole writer for those seams. |

The 2026-07-27 `dev → main` promotion hold is **RELEASED** (owner-authorized). Promote from a
quiet `dev` and re-check `git rev-list --left-right --count origin/main...origin/dev` immediately
before promoting.

## Authored but NOT applied to the shared database

- `supabase/migrations/20260728000000_sms_consent_opt_out_only.sql` — opt-out-only consent
  (owner-directed 2026-07-28). Until it applies, the database never returns `IMPLIED_CONSENT`, so
  live behaviour is unchanged. Apply is a separate owner-authorized window.

## Standing operational state

- **Consent model:** opt-out-only for staff 1:1 service SMS + named typed transactional notices;
  everything automated/bulk/marketing is global-opt-in-only. Authority:
  `.claude/rules/sms-experience-wave-ownership.md` §13 (kept in place — a CI contract test reads
  it).
- **Staging database:** Supabase branch `qa-staging` (ref `uizgwvkvzyldystqrcsk`) — created,
  **pending the owner schema-only seed** (runbook §2 Path B; the live ledger is not replayable
  and data branches are gated behind PITR + compute upgrades). Once seeded it is the only hosted
  DB agents may iterate against.
- **A2P / live sends / provider webhooks / feature-flag flips:** owner-gated, always.

## Open initiatives (verdicts pending — see `docs/wip-inventory-2026-07.md`)

| Initiative | State | Archived manifest |
|---|---|---|
| Mobile readiness (current-origin) | ACTIVE (lease above) | `docs/archive/rules/upr-engineering-foundation-wave-ownership.md` §6 |
| SMS experience | Tail: unapplied migration above | manifest still in `.claude/rules/` |
| Messaging transport | Built, activation owner-gated | `docs/archive/rules/messaging-transport-wave-ownership.md` |
| Tech v2 Job Hub H3 cutover | Open, owner-bake-gated | `docs/archive/rules/tech-v2-wave-ownership.md` |
| Omni-inbox I/O/U | Unbuilt (O/U absorbed by sms-experience) | `docs/archive/rules/omni-inbox-wave-ownership.md` |
| Schedule Desktop A/B/C | Unstarted | — |
| UX alignment W1–W5 | Stalled since 2026-07-18; owner may restart from scratch | `docs/archive/rules/ux-alignment-wave-ownership.md` |
| DB foundation P2–P8 | Partially done (P3 tranches shipped) | `docs/archive/rules/db-foundation-wave-ownership.md` |
| App-store readiness F1/A/B/D | Planned | `docs/archive/rules/app-store-readiness-wave-ownership.md` |
| Agent QA access P2+ | P1 done; P2a gated on local runtime | `docs/archive/rules/upr-agent-qa-access-ownership.md` |
