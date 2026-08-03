# What's New — highlight entries

Every file in this folder is one entry on the **Highlights** section of
`/whats-new`, the page the team reads to see what has been built, fixed and
improved.

**Write these for the people who use the app, not the people who build it.**
Most of them are not developers. "Contain QBO receipt service grants" means
nothing to them; "Apply one payment across several invoices" does.

## Adding one

Create `YYYY-MM-DD-short-slug.json`:

```json
{
  "date": "2026-07-31",
  "kind": "New",
  "area": "Billing",
  "sha": "206be74",
  "title": "Apply one payment across several invoices",
  "body": "When a customer pays for more than one job with a single check or card, record that payment once and split it across every invoice it covers — instead of entering it separately on each one."
}
```

**One file per entry, always.** Several sessions work in this repository at the
same time; a single shared list would collide constantly. Separate files never
do.

| Field | Required | Notes |
|---|---|---|
| `date` | yes | `YYYY-MM-DD`. Groups the timeline. |
| `kind` | yes | `New`, `Improved`, or `Fixed`. |
| `area` | yes | `Billing`, `CRM`, `Field App`, `Messaging`, `Mobile App`, `Notifications`, `Scheduling`, `Interface`, `Settings & Access`, `Claims & Jobs`, `Dashboard`, `Translations`, `Platform`. |
| `title` | yes | What someone can now **do**. Short, no jargon, no ticket numbers. |
| `body` | no | One or two plain sentences. Say why it matters. |
| `sha` | no | Short commit sha. See below — this is what keeps the page honest. |
| `status` | no | `testing` or `rolling-out`. Fallback only; prefer `sha`. |

## Why `sha` matters

The page marks an entry **In testing** when its commit has not reached
production yet. That is derived by checking the sha against `origin/main`, so
it corrects itself automatically the next time someone runs
`npm run generate:changelog` after a promotion.

A hand-typed `status` cannot do that — it goes stale the moment the change
ships, and the page starts lying about what the team can actually use. Use
`status` only for something git genuinely cannot see, such as a finished
feature still hidden behind a flag.

Get the sha with:

```bash
git log -1 --format=%h
```

## What does not belong here

Refactors, test changes, documentation, dependency bumps, internal plumbing.
None of it is visible to the team, and every one of them dilutes the entries
that are.

Anything user-visible that nobody writes an entry for still appears in the
**Everything else** section below the highlights — that list is generated from
the project history by `npm run generate:changelog` and needs no upkeep. Missing
a highlight costs detail, never the record itself.
