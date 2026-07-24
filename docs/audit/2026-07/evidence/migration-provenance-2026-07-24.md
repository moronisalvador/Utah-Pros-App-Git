# Migration provenance recapture — 2026-07-24 22:38 UTC

Read-only recapture taken while reconciling concurrent GPT Codex and Claude Code sessions. It
supersedes `migration-provenance-2026-07-23.json` as the gate's default evidence
(`scripts/check-migration-provenance.mjs` `DEFAULT_EVIDENCE`). The 2026-07-23 capture is retained
unchanged as the prior dated snapshot.

- Project ref: `glsmljpabrwonfiltiqm` (one project backs both `dev` and production).
- Capture base commit: `d516ccd2883dbeef1999a8c118ae4f6bf5084625`.
- Method: Supabase migration ledger plus read-only `pg_proc` / `pg_policies` catalog queries.
- **No migration was applied and no SQL mutated the shared project during this reconciliation.**

## What this recapture closed

Three migrations were live in shared production with **no source reachable from `origin/dev` or
`origin/main`**. Both open PRs held that source; neither had merged.

| Live version | Name | Source landed by | Reviewed origin |
|---|---|---|---|
| `20260724181945` | `crm_lead_notes` | PR #515 | `0463f3e443ee3b0dd4a0f9077a31bb1470779cd6` |
| `20260724190829` | `qbo_attachments` | PR #516 | `f46e50f2d650708273e957ed9184d6a457dac475` |
| `20260724190848` | `qbo_payments_sync_cron` | PR #516 | `f46e50f2d650708273e957ed9184d6a457dac475` |

The drift was **interleaved, not a ledger tail**: the two newest live rows
(`20260724195329`, `20260724200321`) were already in `dev` and sorted *above* the three drifted
rows. Walking the ledger downward from the newest row until reaching source present in `dev` finds
zero drift and is not a valid detection method. Reachability must be established by set comparison
over the whole window at or above `ledgerFloorVersion`.

Ledger versions also do not equal migration filename prefixes — Supabase assigns the version at
apply time. Seven rows in this window differ, and for `harden_find_or_create_conversation` the file
prefix (`20260724173000`) is *later* than its live version (`20260724152530`). Match by name.

## Repair was verified before merging, not assumed

Every drifted object was compared against the live catalog using the gate's own fingerprint
functions. All five functions defined by the drifted migrations are **semantically identical** to the
unmerged source; two differ only by comments/whitespace, the class the manifest already accepts.

| Function | raw | semantic |
|---|---|---|
| `add_lead_note(uuid,text,uuid)` | match | match |
| `get_lead_notes(uuid)` | match | match |
| `get_lead_activity(uuid)` | match | match |
| `get_contact_activity(uuid)` | comment/whitespace drift | match |
| `qbo_payments_sync_poll()` | comment/whitespace drift | match |

`get_contact_activity(uuid)` retains its signature and return shape at **24 arms**
(`get_lead_activity` at 5), matching the independent regression guards on
`claude/gifted-sammet-22e7d1`. The documented near-miss — a body-only replace rebuilt from a stale
ancestor dropping live arms — did **not** recur.

## Two additional gaps found and closed

**1. The manifest was five rows behind live.** `ledgerMappings` stopped at `20260724152614`, so it
omitted the three drifted rows *and* `bind_callrail_outbound_mms_identity` /
`accept_frozen_callrail_mms_media_shape`, which had landed source in `dev` without a manifest
update. The gate's `Unmapped live ledger row` check could not fire because the stale evidence
snapshot's `ledgerTail` predated those rows. A passing gate against stale evidence is therefore not
evidence of zero drift — the evidence window is load-bearing. Mappings now cover all 19 rows at or
above the floor.

**2. A pinned function fingerprint had gone stale.**
`project_callrail_outbound_event(uuid,uuid)` was pinned via `expectedFingerprints` to the body as of
`20260724174000_fix_callrail_outbound_phone_identity.sql`. Two later reviewed migrations replaced
that body and nobody updated the pin, so the pin described a version that is no longer live.

Verified chain: the live raw fingerprint `8c01603d00daee79554fc9a4ad75b6d7` is a **byte-exact** match
for the definition in `20260724195802_accept_frozen_callrail_mms_media_shape.sql`, the last migration
to replace it, and the old pin `f4c5573e935e94964e5c616542cb6a84` is a byte-exact match for the
earlier `20260724174000` version. The pin was correct when written and went stale by omission.

Root cause: `extractFunctionBodies` only recognised `$function$`-quoted bodies, so a `$$`-quoted
function could only be covered by a hand-maintained pin. The extractor now accepts either tag with a
backreferenced closing tag, and this entry uses **real source comparison instead of a pin** —
strictly stronger, and it removes the whole stale-pin failure mode. Its 13 unit tests still pass.

## Gate result on the reconciled tree

```
WARN set_lead_caller_name(uuid,text,boolean): raw body differs, comment-only semantic hash matches
WARN claim_callrail_provider_event(...): raw body differs, comment/whitespace-normalized semantic hash matches
WARN get_contact_activity(uuid): raw body differs, comment/whitespace-normalized semantic hash matches
WARN qbo_payments_sync_poll(): raw body differs, comment/whitespace-normalized semantic hash matches
Migration provenance: PASS; ref=d516ccd2883dbeef1999a8c118ae4f6bf5084625; ledger=19; functions=21; policies=5.
```

Supporting gates on the same tree: `npm run build` clean; `npm test` 762 unit + 1079 worker + 16 qa
= **1857 passed, 0 unexpected skips**; `npx eslint` on changed JS **0 errors**, 2 warnings both
proven pre-existing and unchanged (one raw `upr:toast` dispatch each in `EstimateEditor.jsx` /
`InvoiceEditor.jsx`, untouched by this change).

## Live behavior confirmed, not inferred

- `upr_qbo_payments_sync_hourly` (`17 * * * *`) is **running in production** and healthy: four
  consecutive `succeeded` runs from 19:17 UTC, reaching `https://utahpros.app/api/qbo-payments-sync`
  — a worker already deployed in `main` — with HTTP 200 `{"ok":true,"scanned":1,...}`. It ran for
  roughly three hours from source in no branch; that reproducibility gap is what this closed. No
  outage resulted.
- `crm_lead_notes`: RLS enabled, **zero policies and zero `anon`/`authenticated` table grants** —
  deny-all, reachable only through its `SECURITY DEFINER` RPCs. Correct least-privilege posture.
- `qbo_attachments`: RLS enabled with one `authenticated` SELECT policy. **Advisory:**
  `authenticated` also holds an unused table-level `INSERT` grant with no INSERT policy. RLS denies
  the write, so this is not an exposure, but belt-and-suspenders would `REVOKE INSERT`. Left as-is —
  it needs its own additive migration and owner-authorized apply window.

## Still unapplied — do not treat as done

`supabase/migrations/20260724200000_payments_qbo_dedup_index.sql` is authored and **not** in the live
ledger; the index `payments_qbo_payment_invoice_uniq` does not exist. It is written **without
`CONCURRENTLY`**, so it takes an exclusive lock on the hot `payments` table, and it will fail
outright if duplicate rows already exist. Applying it requires a duplicate pre-check and a separate
owner-authorized window.

## Known hazard — colliding filenames holding rejected designs

Two parked worktrees carry `supabase/migrations/20260724014423_attest_prior_sms_consent.sql` at the
**same filename** as the applied migration but with a **rejected design** — `contacts.p2p_sms_consent_*`
columns instead of the live `service_sms_consents` / `service_sms_consent_attestations` tables. Live
confirms no `p2p_sms_consent%` column exists anywhere. Sizes differ (222 and 183 lines vs the applied
590). A third worktree carries an untracked `20260723183330_messaging_transport_foundation.sql` that
drops and recreates four live `messages` RLS policies, superseded by the two applied
`20260723215926` / `20260723220207` migrations.

None is reachable from `dev` or `main` and none affects the gate. They are a **future mistaken-apply
hazard only**. They were deliberately left in place rather than deleted, pending owner disposition.
