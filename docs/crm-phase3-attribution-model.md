# CRM Phase 3 — Multi-touch attribution model (design decision)

**Model:** Opus 4.8 · High-effort design pass, run *before* any metric code, per the
Phase 3 model note in `docs/crm-roadmap.md`. This file is the committed record of the
attribution decisions the funnel dashboard is built on. A wrong call here misallocates
real ad budget, so the reasoning — not just the conclusion — lives here.

---

## The problem

Three data sources must be joined into one funnel — **spend → lead → estimate → won job
→ revenue** — and each owns exactly one part of the truth:

| Source | Table | Owns | Does **not** know |
|---|---|---|---|
| Ad platforms (Google Ads, Meta) | `ad_spend` | **Spend dollars** by platform/campaign/day | Whether a click became a job, or its $ value |
| CallRail | `inbound_leads` | **Lead counts** (calls + form fills), with source/campaign UTM | Actual job outcome or revenue |
| UPR (QBO-synced) | `jobs` / `estimates` / `invoices` | **Won-job counts + real revenue** | Which ad/source originally drove the lead |

The whole point of the dashboard is to stop these three living in three separate tools.
No number is double-sourced: **counts of leads come from CallRail, counts of won jobs and
revenue come from UPR, spend comes from the ad platforms.** Nothing else.

## Decision 1 — CallRail's "converted" flag vs UPR's won-job truth

CallRail can tag a call/lead as "converted" (its own value/lead tags), and Google/Meta
report their own `platform_conversions`. **Both are manually- or platform-set guesses that
do not know UPR's actual job outcome or the QBO dollar value.**

> **Decision: UPR is the single source of truth for conversions and revenue. A lead
> "converted" iff its contact has a won job in UPR (`jobs.phase <> 'lead'`), full stop.
> CallRail's "converted" flag and `ad_spend.platform_conversions` are shown as
> *informational-only* columns — never fed into ROAS / cost-per-job / cost-per-lead.**

This extends the decision already locked in Phase 2 (`platform_conversions` is
"informational only", `docs/crm-roadmap.md` Phase 2 block). ROAS drives real budget
moves; it must be computed from money that actually landed (QBO-invoiced), not a
telephony tag that disagrees with the books.

## Decision 2 — First- vs last- vs weighted-touch → **last-touch, single-touch (v1)**

When a contact has multiple touches (a Google Ads call in January, a referral call in
March, then books), which channel gets credit for the won job and its revenue?

> **Decision: last-touch, 100% credit to the most recent attributable touch before the
> booking. Every touch is still *stored*, so first-touch or weighted is a future
> re-aggregation, not a schema change.**

Why last-touch is right for *this* business specifically:

1. **Restoration is a near-single-touch, high-intent journey.** A flooded basement is an
   urgent one-call event; the large majority of leads convert on the first and only
   touch. Fractional multi-touch crediting adds real complexity (splitting revenue across
   touches, decay weighting) for a journey shape that is ~single-touch in practice.
2. **Identity-stitching is imperfect, so weighted would manufacture false precision.** We
   match leads to contacts by phone; UTM/campaign strings exist only on paid/tracked
   calls — organic/referral/insurance touches frequently carry no campaign at all. A
   weighted split over a path we can't fully see would invent precise-looking numbers
   that then move real money.
3. **Last-touch matches the question actually being asked** — "which ad/source *booked*
   this job?" The paid channels here (Google Ads via two agencies, Meta) are
   direct-response lead-gen, not brand awareness, so the last touch and the spend it's
   measured against are the same event.
4. **Forward-compatible.** Each touch is a `lead_attribution` row with `channel`,
   `campaign`, `occurred_at`, and a `touch_position`. v1's RPC selects the *last* touch
   per contact; a future first-touch/linear model is additive SQL over the same rows.
   (Same "build it forward-compatible without building the whole thing" discipline as
   Phase 4d.)

**Unattributed / direct:** a won job whose contact has no known source lands in an
`other` (unattributed) bucket — counted in funnel totals so revenue reconciles, but never
credited to a paid channel, so it can never inflate ROAS.

## Decision 3 — The channel dimension (the join seam)

Everything is grouped by a **canonical channel**, aligned to what `ad_spend` can actually
supply spend for:

| Channel | Paid? | Spend source | Example raw sources |
|---|---|---|---|
| `google_ads` | **paid** | `ad_spend.platform='google'` | "Arturo Campaign (Google Ads)", "Michael Campaign (Google Ads)", "Google LSA" |
| `meta_ads` | **paid** | `ad_spend.platform='meta'` | "Facebook", "Instagram" |
| `organic` | zero-spend | — | "SEO / Organic", "Google My Business", "Website Direct" |
| `referral` | zero-spend | — | personal / trade / program / real_estate / emergency sources |
| `insurance` | zero-spend | — | "Insurance Adjuster", "Insurance Carrier Direct", TPA |
| `other` | zero-spend | — | "Other", "Unknown", traditional media, unattributed |

Paid channels have `ad_spend` → cost-per-lead / ROAS / cost-per-job are real numbers.
Zero-spend channels have **spend = 0 → those metrics render `—` (null), never `0` and
never `∞`** (Decision 5).

A lead/contact resolves to a channel via, in priority order:
1. An explicit `lead_attribution` row (last-touch) — CallRail UTM, or manual entry;
2. else the normalized `contacts.referral_source` free-text (`crm_channel_for_source()`);
3. else `other` (unattributed).

`crm_channel_for_source()` maps a raw string to a channel by first resolving it against
`referral_sources.category` (data-driven, not 49 hardcoded names) and then refining the
`digital` category into `google_ads` / `meta_ads` / `organic` by keyword. `ad_spend`
maps directly: `platform='google' → google_ads`, `platform='meta' → meta_ads`.

This means the dashboard works **today** off the sparse `contacts.referral_source` data,
and gets sharper automatically as CallRail leads and explicit `lead_attribution` rows
accumulate — no backfill required to ship.

## Decision 4 — Metric definitions (grain + revenue field)

Attribution grain: **counts of leads at the lead grain** (every call/form is a touch);
**estimates, won jobs, and revenue at the contact grain**, credited to that contact's
last-touch channel. `COUNT(DISTINCT job.id)` guards the 1-contact-→-many-jobs fan-out so
revenue is never double-counted.

- **spend** = `SUM(ad_spend.spend)` for the channel (and campaign) in range; 0 for
  zero-spend channels.
- **leads** = `COUNT(inbound_leads)` attributed to the channel — **CallRail is truth.**
- **estimates** = `COUNT(DISTINCT estimates)` for the channel's contacts with
  `status <> 'draft'` ("estimate sent").
- **won_jobs** = `COUNT(DISTINCT jobs)` for the channel's contacts where
  `phase <> 'lead' AND status <> 'deleted'` — booked work, **UPR truth**.
- **revenue** = `SUM(jobs.invoiced_value)` of those won jobs.

**Revenue field = `jobs.invoiced_value` (QBO-synced *invoiced* total), not cash collected
to date.** `jobs.invoiced_value` is kept in sync from pushed QBO invoices by the
`trg_invoices_sync_job_ar` trigger (`SUM(COALESCE(adjusted_total, total))` where
`qbo_invoice_id IS NOT NULL`), with legacy hand-entered fallback for jobs without invoices
(`UPR-Web-Context.md` AR-mapping section) — i.e. it *is* "the QBO-synced job financials"
the roadmap Phase 3 bullet asks us to join. We deliberately use invoiced (booked) revenue
rather than `invoices.amount_paid` (cash-to-date): insurance jobs pay over months, so
cash-collected lags the actual value of won work and would understate ROAS on exactly the
channels that book big insurance jobs. (If a "collected revenue" view is wanted later, it
is an additive column sourced from `get_job_financials`.)

**"Won job" = `phase <> 'lead'`, not `phase = 'completed'`.** The live funnel transition
is `lead → job_received → …`; a job leaving `lead` phase *is* the booking. Restricting to
`completed` would undercount booked work ~6× against real data and misstate every
conversion rate.

## Decision 5 — The null / zero / div-by-zero rules (the expensive detail)

Three distinct zero-cases, handled differently on purpose:

1. **Zero-SPEND channel** → cost/return metrics are `null` → render `—`.
   0 leads at $0 spend is **not** "$0.00 cost per lead"; showing `0` would falsely imply
   infinitely-efficient free leads and pull budget toward the wrong channel. This is the
   roadmap's "null (not 0) for zero-spend sources" rule.
2. **Zero-DENOMINATOR** in any ratio (e.g. cost-per-lead when leads = 0, ROAS is exempt —
   see below) → `null` (div-by-zero guard).
3. **Zero-NUMERATOR over a positive denominator** → a legitimate value, shown:
   - a conversion **rate** of `0 won / 5 leads` = a real **0%** (meaningful — leads that
     never convert), rendered `0%`, **not** `—`.
   - **ROAS** of `$0 revenue / $100 spend` = a real **0.0×** (wasted spend), **not** null.
     ROAS is null *only* when spend = 0.

Concretely (the pure-JS, unit-tested contract in `src/lib/attribution.js`):

| Metric | Formula | `null` (→ `—`) when |
|---|---|---|
| `costPerLead(spend, leads)` | `spend / leads` | `spend <= 0` **or** `leads <= 0` |
| `roas(revenue, spend)` | `revenue / spend` | `spend <= 0` only |
| `costPerJob(spend, jobs)` | `spend / jobs` | `spend <= 0` **or** `jobs <= 0` |
| `conversionRate(num, denom)` | `num / denom` | `denom <= 0` only (0 num → `0`) |

## Architecture — where each piece lives (and why)

- **SQL RPCs do raw aggregation only** (`get_attribution_rollup` per channel,
  `get_attribution_by_campaign` for the paid-campaign split, `get_crm_revenue_by_division`
  for Reports): counts + sums grouped by channel/campaign/division. No derived money math
  in SQL. The Overview funnel is derived in JS (`rollupTotals` + `funnelStages`) from the
  single `get_attribution_rollup` result — no separate funnel RPC.
- **The money math is pure importable JS** (`src/lib/attribution.js`), so it is
  unit-testable per the Phase 3 test-first mandate (the roadmap notes there is no test
  harness for SQL RPCs, so "pure logic must be authored as importable JS to be
  unit-testable"). The pages call the RPC, pass rows through `deriveChannelMetrics` /
  `rollupTotals`, and render. Every displayed number therefore traces to a tested
  function, and is cross-checked against a hand calc in the close-out.

## Reconciliation summary (one paragraph)

Leads = CallRail (`inbound_leads`). Won jobs + revenue = UPR (`jobs.invoiced_value`,
QBO-synced). Spend = ad platforms (`ad_spend`). CallRail "converted" and
`platform_conversions` are informational columns only, never in the ROAS/CPL/CPJ math.
Attribution is last-touch, single-touch for v1, with every touch stored for a future
first-touch/weighted re-aggregation. Zero-spend channels (Referral / Organic / Insurance)
show `—` for cost/return metrics, not `0`.
