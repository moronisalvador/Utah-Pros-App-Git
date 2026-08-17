# UPR drying logs — where wave 2 stopped, and what a Hydro competitor needs

**Created:** 2026-08-16 · **For:** a fresh session picking up both threads
**Owner goal, stated 2026-08-16:** *"create something very similar to Encircle but with easier,
faster, and better UI and UX."*

Two separate things live in this document. **Part 1** is the finished, shippable work and its open
gates — read it first, because it is nearly closed. **Part 2** is the new initiative, which is
schema-shaped and barely started.

---

# PART 1 — Job Hub wave 2: state

## What is done

- **PR [#669](https://github.com/moronisalvador/Utah-Pros-App-Git/pull/669) merged to `dev`** as
  `9bddb08d` (H2-a/b/c + the tech customer page).
- **PR [#674](https://github.com/moronisalvador/Utah-Pros-App-Git/pull/674) is OPEN, green, and
  unmerged** — branch `claude/job-hub-wave2-fixes-and-drying-summary`, two commits on top of
  `dev`. CI passed on the exact head. **Merging it is an owner action.**

What is in #674:

| Fix | Why it mattered |
|---|---|
| Non-crew techs can clock in again | Owner-reported. The Hub gated the clock on crew membership; the legacy page never did and nothing server-side does, so it removed a real ability while protecting nothing. Now: a notice + **Clock in anyway**. Deliberately does **not** write `appointment_crew`. |
| A failed save keeps the typing | 2 of 3 customer-page write paths closed the edit form over a write that never landed. Both layers were needed — parent rethrows AND child catches. |
| `CONSENT_COLUMNS` repaired | It had **two phantom entries** (`opt_out_source`, `dnd_reason` — neither exists in the schema) and was missing **two real columns** (`dnd_at`, `opt_out_reason`). Verified column-by-column against live. |
| `page:water_loss_report` registered + fail-closed | It existed only as a hand-seeded row. Deleting that row would have turned the Water Loss Report **on for every technician**. |
| Flag-widening order corrected | The runbook said clear dev-only then enable; between those two RPCs the flag is OFF for everyone including the owner. Enable first. |
| H2-e1 — the Dry Logs summary card | See the warning below. |

## The open gates

1. **Merge #674.**
2. **Device bake.** `UPR Dev` (`com.utahprosrestoration.upr.dev`) **is installed on the owner's
   iPhone 17 Pro Max** as of 2026-08-16. Not yet exercised. Priority checks: the non-crew clock
   gate, a real OS background/resume, thumb feel on the 48px section rows, safe-area insets.
3. `dev → main` PR. **Note the gate unique to this hop:** provenance freshness (6h TTL) blocks only
   when the base is `main`.
4. **Associated-domains gate** before any official iOS build — pre-existing, unrelated, physically
   unautomatable. `docs/mobile/testing-and-release.md` → "NAMED GATE".
5. `ios-release.yml` from `main`.
6. **Widen all five flags together** — `page:tech_job_hub` · `page:tech_moisture` ·
   `page:tech_equipment` · `page:tech_rooms` · `page:water_loss_report`. Enable first, then clear
   dev-only.

## ⚠ The finding that reframes everything

**There are ZERO moisture readings and ZERO equipment placements in the entire production
database.** Confirmed by direct query 2026-08-16.

Consequences:

- **The H2-e1 summary card cannot render on any job, for anyone.** `dryingSummary` returns `null`
  with no readings, so the row looks exactly as it did before. That is correct behaviour, not a
  defect — but it means the feature is inert until readings exist, and it **cannot be visually
  verified** on any device today.
- The owner's read is *"we never fully built the readings taking part… I don't think it was really
  usable or comparable to Encircle."*
- **The code tells a slightly different story, and the difference matters.** `ReadingEntrySheet.jsx`
  is 1,016 lines, `insert_reading` and `place_equipment` are **live RPCs in the production schema**,
  and `HubTools.jsx` wires them with full parameters. What has never existed is *access*:
  `page:tech_moisture` and `page:tech_equipment` are both `enabled:false` with `dev_only_user_id`
  set to the owner, so **no technician has ever been able to reach either screen.**
- So it is closer to *built but never released* than *never built* — though the owner's judgment
  that it is not comparable to Encircle stands on its own, and Part 2 explains why.

---

# PART 2 — Building a Hydro competitor

## What Encircle Hydro actually does

Researched 2026-08-16 from Encircle's public material (their help centre 403s to automated
fetching; the product pages do not). Sources at the end.

**Setup**
- An **S500 checklist** walks the tech through establishing the drying foundation (IICRC S500).
- An **S500 equipment calculator** sizes air movers and dehumidifiers from the drying chamber's
  actual conditions.
- A **drying plan** and **dry standard** are established up front — the dry standard is what every
  later reading is judged against.

**Capture — this is the headline UX**
- **Instant Reading Capture**: the tech *photographs the meter* and OCR extracts Temperature and
  Relative Humidity automatically. Encircle's own framing is that this saves time on every
  monitoring visit *and eliminates user input errors*.
- Moisture points and equipment are placed on a **moisture map**.

**Computation**
- Dew point and vapour pressure are **calculated automatically**, not typed.
- The app **alerts when drying conditions are not being met**.

**Oversight**
- Real-time sync; multiple techs on one large loss simultaneously.
- Job alerts let a PM supervise without driving to site.
- Each monitoring visit is a **guided workflow**, not a blank form.

**Output**
- **Hydro Full Report** — all readings, equipment, reading photos and notes.
- **Hydro Summary Report** — dry logs + equipment, first and last two readings only.
- Both are pitched as a *defensible* package for the adjuster: moisture maps, psychrometrics,
  equipment calculations, time-stamped meter photos.

## The gap, precisely

The reason UPR's version is not comparable is **structural**, not cosmetic.

| | Encircle | UPR today |
|---|---|---|
| Reading types | **Four**, separately modelled: affected atmosphere, **unaffected/control** atmosphere, material moisture, equipment output | **One** flat `moisture_readings` row mixing air and material |
| Control readings | A first-class type with its own endpoint | An `is_affected` boolean on the same row |
| Equipment output | Its own reading type | **Does not exist** |
| Capture | Photograph the meter, OCR fills the fields | Type every field by hand |
| Psychrometrics | Dew point + vapour pressure computed | `gpp` / `dew_point_f` columns exist — **verify whether they are computed or typed** |
| Equipment sizing | S500 calculator | Nothing |
| Alerts | Drying conditions not met | Only a `is_stalled` flag on a reading |
| Reports | Two tiers, adjuster-grade | `page:water_loss_report` exists; depth unaudited |

A real drying log is the **differential between affected and control air over time**, plus dehu
performance. **UPR's current shape cannot express that**, which is the root cause — not the UI.

Rooms are in better shape than expected: `public.rooms` carries `area_sqft` + `ceiling_height_ft`
(volume is derivable) and already has `encircle_room_id` / `encircle_structure_id`, so room sync
exists.

## What is NOT known yet, and should be established first

1. **Is Encircle's Hydro API reachable today?** `ENCIRCLE_API_REFERENCE.md` §7 documents the
   endpoints but is stamped *"FUTURE — 6-9 months out, NOT building now."* That stamp may be stale.
   Probing it is an **outbound provider call and needs owner authorization**. If it is live, UPR
   could read real Hydro data for a real claim — by far the best possible spec.
2. **The actual screens.** Nobody in this session has seen Hydro's UI. The help centre blocks
   automated fetching. Options: the owner walks through it on their phone; screenshots; or a
   session with computer-use driving iPhone Mirroring (this session's tools are simulator-only and
   **cannot** drive a physical device).
3. **Whether `gpp`/`dew_point_f` are computed or typed** in the existing UPR flow.
4. **What the existing water-loss report actually contains**, before deciding whether to extend or
   replace it.

## How to route this work

**Not `/new-feature`.** This is schema-first and cross-cutting:

- The reading model is the first decision, and it is a **new table design**, not an alteration —
  `moisture_readings` is live (albeit empty) and additive-only rules apply.
- It touches RLS, grants, and a role-perspective behavioural proof (`database-standard.md` §5b).
- OCR capture is a provider/vendor decision of its own.

Suggested: **`/masterplan`** for the initiative, then **`/db-migration`** per schema slice. Route
the field UI through `upr-interface-craft` + `impeccable` — the owner's whole point is that the UX
must beat Encircle's, and that is a design brief, not an implementation detail.

**Related, already decided:** the daily-log record itself is **authored by a technician** (owner
decision 2026-08-16), designed in
[`docs/job-hub-h2e-daily-logs-plan-2026-08-16.md`](../job-hub-h2e-daily-logs-plan-2026-08-16.md).
That plan predates this Hydro conversation and should be folded into the larger initiative rather
than built separately.

**Also still open and unrelated to Hydro:** the Activity event feed. Two of its premises were
proven false on 2026-08-16 — `system_events` is RLS deny-all with **zero policies** and a live
applied migration **forbids adding one**, so a `SECURITY DEFINER` RPC is the only door; and **clock
actions are not in `system_events`**. Detail in `docs/job-hub-wave2-roadmap.md`.

## Environment notes for whoever picks this up

- This Mac had **no `node` on `PATH`** (`node@20` keg-only). `node@22` was installed 2026-08-16
  because `cap sync` requires ≥22 — use `/opt/homebrew/opt/node@22/bin`.
- **There is no `.env.local` in the wave-2 worktree.** A native build without one compiles
  `127.0.0.1` into the bundle; `assert-native-dist` catches it, and its warning is worth heeding —
  *the simulator will not catch this*, because loopback reaches the Mac.
- `test:tooling` takes several minutes printing only `TAP version 13`. It is not hung.
- The simulator control tool is **simulator-only** and cannot drive a physical device.

## Sources

- [Water Mitigation Documentation & Drying Tools | Encircle](https://www.getencircle.com/solutions/water-mitigation/)
- [Encircle Officially Launches Hydro](https://www.getencircle.com/news/hydro-press-release)
- [Which Moisture Report Should I Use?](https://help.encircleapp.com/hc/en-us/articles/7767038398477-Which-Moisture-Report-Should-I-Use)
- [Introduction to Hydro](https://help.encircleapp.com/hc/en-us/articles/18377208883853-Introduction-to-Hydro) (403 to automated fetch; owner-readable)
