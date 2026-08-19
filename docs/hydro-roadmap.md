# UPR Hydro — drying documentation that competes with Encircle

**Created:** 2026-08-17 · **Status:** F1/F2 AUTHORED AND UNAPPLIED. Everything else is plan only.
**Owner goal, stated 2026-08-16:** *"create something very similar to Encircle but with easier,
faster, and better UI and UX."*
**Ownership:** [`.claude/rules/hydro-wave-ownership.md`](../.claude/rules/hydro-wave-ownership.md)
**Cold-session dispatch:** [`hydro-dispatch.md`](hydro-dispatch.md)
**Predecessor:** [`handoff/hydro-rebuild-and-wave2-state-2026-08-16.md`](handoff/hydro-rebuild-and-wave2-state-2026-08-16.md)

**Authorization state:** authoring is done for F1/F2. Applying either migration, flipping a flag,
deploying, calling a provider and promoting to `main` are each separate owner actions and none is
requested by this document.

---

## 1. The one thing to do before anything else

**Keep `page:tech_moisture` and `page:tech_equipment` OUT of the wave-2 five-flag widening.**

The wave-2 rollout lists five flags to widen together. Two of them expose the current moisture and
equipment screens, which means exposing:

- a 4-step-per-reading wizard, and
- **GPP values that are ~15% low** (§3).

Zero readings exist today, so no wrong number has ever reached an adjuster. Widening those two
flags is the event that ends that sentence. The other three — `page:tech_job_hub`,
`page:tech_rooms`, `page:water_loss_report` — are unaffected and can widen freely.

---

## 2. Evidence ledger

Measured 2026-08-16 and 2026-08-17 against live production and the live Encircle API.

| Capability | State | Evidence |
|---|---|---|
| Psychrometric math | **HAVE** (defective — §3) | `src/lib/psychrometric.js`, ASHRAE-consistent, cited, correctly rejects the "2700" shorthand |
| Offline outbox | **HAVE** — a real asset | 6 dispatchers in `src/lib/dispatchers/` with `operationId`, owner-lease, temp-UUID room resolution |
| Rooms with dimensions | **HAVE** | `rooms.area_sqft`, `ceiling_height_ft`, `encircle_room_id`, `encircle_structure_id` |
| Water-loss report | **HAVE** — stronger than assumed | `functions/api/generate-water-loss-report.js`, 1,254 lines: cover, peak-GPP and equipment-day tiles, per-room photos, equipment log |
| Reading RPCs | **HAVE** | `insert_reading` / `place_equipment` / `get_job_readings`; `search_path` pinned, `anon` EXECUTE revoked 2026-07-08 |
| Reading model | **PARTIAL** | One flat `moisture_readings` row; `is_affected` boolean stands in for four kinds |
| Drying chamber | **MISSING** | No S500 category/class, no target envelope, no drying lifecycle — §4 |
| Equipment output readings | **MISSING** | The 4th Encircle type has no representation |
| Monitoring points | **MISSING** | No durable point identity, so no per-location trend |
| OCR capture / S500 sizing / alerts / daily log / moisture map | **MISSING** | — |
| **Zero readings in production** | **VERIFIED** 2026-08-17 | `moisture_readings` returns `[]`. Re-verified, not inherited |
| Encircle Hydro API | **LIVE, GET-ONLY** | §5 |

### Defects found, all free to fix at zero rows

1. **P0 — GPP is ~15% low everywhere UPR works** (§3).
2. **P1 — `USING (true)` on both legacy hydro tables.** Any authenticated identity — `crm_partner`,
   estimator, external, inactive — can read and **DELETE** every reading and equipment record.
3. **P1 — `insert_reading` and `place_equipment` are `SECURITY DEFINER` with no caller check.**
   Any authenticated session can write to any job. (`search_path` *is* pinned and `anon` *is*
   revoked — those two were checked and are fine.)
4. **Minor — `reading_date` is a live timezone bug.** `DATE DEFAULT CURRENT_DATE`, never set by
   `insert_reading`, so it buckets in the database session's timezone against
   `database-standard.md` §7. Already worked around by `dryingSummary` bucketing on `taken_at`.
   The new model simply has no such column.

F2 closes 2 and 3. F1 avoids 4 by construction. §3 closes 1.

---

## 3. The altitude defect

`src/lib/psychrometric.js` hard-codes `ATM_PRESSURE_INHG = 29.92` — sea level — and its own header
flags "no altitude correction in v1". UPR works on the Wasatch Front.

| Site | Elevation | True pressure | GPP error |
|---|---|---|---|
| Sea level | 0 ft | 29.92 inHg | — |
| Salt Lake City | 4,226 ft | 25.63 inHg | **−14.6%** |
| Provo | 4,551 ft | 25.32 inHg | −15.6% |
| Park City | 7,000 ft | 23.09 inHg | −22% |

Measured across 75°F/45%, 80°F/55%, 90°F/30% and 70°F/60% — the error is ~14.6% at SLC in every
case, because it is a pressure-ratio effect, not a temperature artefact.

GPP differential **is** the drying log. A systematically wrong headline number is the opposite of
the "defensible documentation" this product is for.

**The fix has two halves, and the second is the important one:**

1. The drying chamber carries `site_elevation_ft`, so pressure comes from the real site.
2. **Every reading stores the `atmospheric_pressure_inhg` actually used, plus
   `psychrometric_version`.** A reading must re-derive to the same number in five years when an
   adjuster disputes it — even after the elevation is corrected or the formula is improved.
   Encircle independently confirms this design: its API returns a stored `specific_humidity`
   beside its inputs rather than deriving on read.

---

## 4. What Encircle's model actually is

Read from the live OpenAPI spec (`https://api.encircleapp.com/openapi_v3.json`, public) on
2026-08-17, not from marketing pages.

```
Claim → Structure → Drying Chamber → Room → Moisture Point → Reading
```

**The drying chamber is the spine and UPR had no equivalent.** Required fields: `status`
(`in_drying｜in_stabilization｜dry`), `water_category` (`category1｜2｜3｜special_situation`),
`water_class` (`class1｜2｜3｜4`), `temperature_min/max`, `relative_humidity_min/max`,
`dew_point_differential`, `drying_started`, `drying_ended`.

That is the IICRC S500 classification plus the target envelope, declared **before** readings are
taken. It is what makes a drying log defensible instead of a pile of numbers, and it is exactly how
"alert when drying conditions are not met" works — compare reading to envelope.

**Four reading types, and three of them share one shape:**

| Type | Distinguishing fields |
|---|---|
| `affected_atmosphere_readings` | `temperature`, `relative_humidity`, `specific_humidity` |
| `unaffected_atmosphere_readings` | same + **`type`** (`interior｜interior_hvac｜exterior`), `timezone` |
| `material_readings` | `material_type` (17 values), `moisture_point_number`, `moisture_point_id`, `meter`, `moisture_content`, `dry_standard` |
| `dehumidifier_readings` | `equipment_id`, `used_disposable_equipment`, `temperature`, `relative_humidity`, `specific_humidity` |

Three details worth carrying:

- **The control reading is a 3-way enum, not a boolean.** Exterior air, unaffected interior air and
  HVAC supply are different references and are not interchangeable. UPR's `is_affected` cannot
  express this.
- **Moisture points are durable objects.** A material reading is a *re-reading of a known point*.
- **Units are Kelvin.** UPR deliberately stores °F/inHg — what technicians read off meters — and
  converts at the import boundary.

---

## 5. The Encircle API answer

Probed 2026-08-17 under owner authorization, read-only.

- **Live.** `affected_atmosphere_readings`, `unaffected_atmosphere_readings`, `material_readings`
  and `drying_chambers` all return 200 with cursor pagination. The reference doc's
  *"FUTURE — 6-9 months out"* stamp was stale and is now corrected in
  `ENCIRCLE_API_REFERENCE.md` §7.
- **The 4th endpoint is `dehumidifier_readings`, not `equipment_readings`.** The documented path
  did not exist.
- **GET-only.** No POST, PATCH or DELETE on any Hydro path. **UPR can never write drying data back
  to Encircle at any price.** Inbound webhooks do exist for add/update/delete of every reading type.
- **UPR holds no Hydro data** — zero drying chambers on real water claims. Nothing to import.

**Consequence for strategy:** there is no "keep the data in Encircle and sync" option. Either UPR
owns drying data or nobody does.

---

## 6. Why this beats Encircle, stated honestly

An earlier draft of this plan claimed durable "monitoring routes" as the differentiator. **That was
wrong** — `moisture_point_id` proves Encircle already has durable points. Corrected:

1. **Interaction, not concept.** Confirm-a-route with a gloved-hand keypad and live envelope
   feedback as the tech types. Encircle has the points; whether its capture UX is route-first is
   unknown until someone sees the app (§10).
2. **Genuinely offline.** A basement has no signal. UPR already owns the outbox with owner-lease
   and temp-UUID resolution; Encircle's OCR implies a cloud round trip.
3. **The structural one Encircle cannot match: Hydro is a silo.** UPR already owns the job, the
   equipment, the timesheet, the invoice, the QBO push, the photos and the water-loss report.
   Drying data *inside* UPR joins equipment-days straight to billing and lets the report assemble
   itself. Encircle can only ever hand back a PDF — and, per §5, will not even accept UPR's data.

Item 3 does not depend on out-designing anyone and is the real case for building this.

---

## 7. Phases

### F1 — the spine · **AUTHORED, UNAPPLIED**

`supabase/migrations/20260817010000_hydro_drying_spine.sql` + paired rollback +
`tests/qa/unit/hydro-drying-spine.test.js`.

Creates `hydro_drying_chambers`, `hydro_chamber_rooms`, `hydro_monitoring_points`,
`hydro_readings`, five enums, `public.hydro_access()`, and four RPCs
(`hydro_upsert_chamber`, `hydro_upsert_point`, `hydro_insert_reading`, `get_hydro_log`).

**Design decisions and why:**

- **New table, not an extension of `moisture_readings`.** Zero rows means nothing is migrated or
  abandoned. Extending would require making `material` nullable (no atmosphere reading has a
  material), living with a name describing one of four kinds, and keeping the `reading_date`
  timezone bug. Extending remains defensible if minimum change is ever preferred; it was rejected
  on those three counts, not on principle.
- **One discriminated table, not Encircle's four endpoints.** Three of four share a shape, "every
  reading on this job today" would otherwise be a four-way UNION, and one table keeps ONE
  `client_id` idempotency space — which the existing outbox already depends on. A per-kind CHECK
  constraint is what keeps a single table honest.
- **No browser write path at all.** `authenticated` gets SELECT; every write is a definer RPC that
  validates the caller. Strictly stricter than the legacy tables.
- **`get_job_readings` is deliberately untouched.** It still reads the legacy table and returns its
  exact shape, so the shipped Dry Logs card and `HubTools` keep working. Re-pointing it belongs to
  Phase C, with the UI that writes the new model.

**Access scope, and the risk that shaped it:** `hydro_access()` is "any active internal employee
except `crm_partner`", not "the crew assigned to this job". A drying log is an operational record a
PM, an estimator writing the supplement and a covering technician all legitimately read — and
narrowing by crew is exactly the change that locked every field technician out of every
conversation for four days on 2026-08-01. This is still a large tightening versus `USING (true)`.

### F2 — close the legacy holes · **AUTHORED, UNAPPLIED**

`supabase/migrations/20260817020000_hydro_legacy_access_hardening.sql` + paired rollback.
Depends on F1 (`hydro_access()`); apply in timestamp order.

Replaces both always-true policies with scoped reads, revokes the `anon` and write grants, and
adds a caller gate to `insert_reading` and `place_equipment` — body-only, signatures frozen so
`readingDispatcher.js` and `equipmentDispatcher.js` keep working.

**Traced, not assumed:** every path to those tables is a `SECURITY DEFINER` RPC, and definers
bypass RLS. A repo-wide search found no direct `db.select('moisture_readings')`-style call. So the
policies being replaced protect nothing today and are reachable only by a hand-written PostgREST
request.

**Its drift guard is marker-based, not md5** — deliberately. The house pattern pins `md5(prosrc)`,
which is stronger, but this session had no production SQL access and a *guessed* md5 would abort
every apply. Whoever applies it should read the live bodies first; converting the markers to real
md5 pins is a strict improvement.

### C — capture (the competitive core)

Route-confirm flow, one-number-at-a-time keypad, live envelope feedback at point of entry, offline
through the existing outbox. Re-points or replaces `get_job_readings`. Route the design through
`upr-interface-craft` + `impeccable`; the persona is `.claude/rules/tech-mobile-ux.md`.

### E — equipment

Dehumidifier output readings (the 4th kind, already modelled in F1), and an S500 sizing calculator
from room volume — `rooms` already carries `area_sqft` and `ceiling_height_ft`.

### L — daily log

Folds in [`job-hub-h2e-daily-logs-plan-2026-08-16.md`](job-hub-h2e-daily-logs-plan-2026-08-16.md)
H2-e2, already owner-decided as **authored by a technician**. It becomes the narrative layer over
the chamber rather than a standalone table design.

### R — reports

Extend the existing 1,254-line PDF into Encircle's two tiers (Full / Summary) plus psychrometric
trend charts per monitoring point. Extend, do not replace.

### S — OCR spike (parallel, gated, never load-bearing)

7-segment LCD meter displays are hard for general OCR. On-device iOS Vision beats cloud OCR here:
free, offline, no customer data leaving the phone. **The capture flow in C must not depend on it.**

---

## 8. Dependency graph

```
F1 ──► F2 ──► C ──► E ──► (alerts, folded into C/E once the envelope has readings to judge)
 └────────────► L
 └────────────► R  (R also wants E for equipment-day accuracy)
S ── independent, joins C when and if it proves out
```

F1 blocks everything: every reading references a chamber. Nothing else may run concurrently with
F1 because every later phase's schema assumptions come from it.

---

## 9. Verification contract

Both migrations already pass: `check-migration-hygiene` (0 failures across 63 checked),
`migration-version-uniqueness` (4/4), and `tests/qa/unit/hydro-drying-spine.test.js` (28/28).

**Still required before either may be applied — this is the open gate:**

- **`database-standard.md` §5b behavioural proof** on a disposable local stack
  (`qualify-*-local.mjs` pattern; template `scripts/qa/qualify-estimate-create-boundary-local.mjs`).
  Per-role **ALLOW and DENY**, including roles the change is not about: admin, office,
  project_manager, field_tech, estimator, supervisor, `crm_partner`, inactive, external, unmapped,
  and the **claimless-session NULL case**. F2 additionally needs a proof that a field technician's
  direct `DELETE` on `moisture_readings` affects **zero rows** afterwards, and that the rollback
  genuinely re-opens it.
- Reviewers: `migration-safety-checker`, `anon-grant-auditor`.

The static test proves **intent, not effect**. Never present it as the behavioural proof.

---

## 10. Open unknowns

1. **Nobody has seen Hydro's actual screens.** The capture pipeline is proven —
   `screencapture -x -o -l<windowid>` grabs the iPhone Mirroring window even when occluded, no
   focus theft — and needs only a locked iPhone and Connect. Until then, §6's claim about
   Encircle's capture UX stays explicitly unverified.
2. **UPR's meter fleet is unknown.** Bluetooth meters would beat OCR outright.
3. **`elevation_ft` default is 4500.** Within ~250 ft of SLC/Provo/Orem/Sandy (<1% GPP error), but
   wrong for Park City and St. George. Ideally derived from the job address; a per-job lookup is
   not built.

---

## 11. Challenge findings

Recorded per `masterplan` §7 so they are not re-derived.

- **The zero-readings premise was inherited from a handoff and is now independently verified.** It
  is load-bearing: if readings exist when F1 is finally applied, the "free redesign" argument
  collapses and the plan needs revisiting. **Re-verify immediately before applying.**
- **`is_affected = false` currently means "this reading sets the material dry standard"** — real
  IICRC logic that a naive port to "control atmosphere" would silently destroy. F1 keeps material
  dry standards (on the point) *and* adds control air as a separate kind. They are different
  things wearing one boolean today.
- **The offline dispatcher's temp-UUID resolution handles rooms only.** A dehumidifier reading
  references an equipment placement that may itself still be queued. Phase C must extend the
  resolution, not discover this in the field.
- **`src/index.css` is near its blocking ceiling.** Every phase ships a route-lazy stylesheet
  (contractor-compliance precedent), never a global addition.
- **F2's marker-based drift guard is weaker than an md5 pin.** Named in §7 rather than hidden.
