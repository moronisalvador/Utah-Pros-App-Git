# Scope Sheet — feedback-driven content proposals (STAGED, not shipped)

**Created:** 2026-07-14 · From technician feedback (Juani Sajtroch, 2026-07-08). **Status: proposal
for owner review — nothing here is published to the live schema yet.**

The scope-sheet content is data in the active **v3** schema (`demo_sheet_schemas`, id
`d7f78022-f444-46d1-8131-b68eb23be089`), edited in **Settings → Scope Sheets**
(`/settings/scope-sheets`). All three additions below use **field types the builder already
supports** (`select`, `multi-chip`, `list`, `stepper`, `computed`) — **no app code change is
needed.** Ship path per `.claude/rules/scope-sheet-rollback.md`: seed a **v4 DRAFT**
(`is_active=false`) → review → `publish_demo_schema(v4_id)`. One shared Supabase backs dev + prod,
so a publish is live for everyone immediately.

---

## ② Baseboard & door-casing SIZES (Juani)

> "Add an option to select the size of the baseboards and door casings … so the estimate reflects
> the correct materials."

**Today:** the **Baseboard & Trim** section (`key: "trim"`) has a 3-col row of steppers —
`baseboardLF`, `casingLF`, `quarterRoundLF` (linear feet only; no size/profile).

**Proposal:** add two `select` (Dropdown) fields to the same `trim` row (or a new row beneath it),
so size is captured alongside the LF:

```jsonc
{ "key": "baseboardSize", "type": "select", "label": "Baseboard size",
  "options": ["", "2¼\"", "3¼\"", "4¼\"", "5¼\"", "5½\"", "7¼\""], "summaryKey": "baseboardSize" },
{ "key": "casingSize",    "type": "select", "label": "Door casing size",
  "options": ["", "2¼\"", "3¼\"", "3½\""], "summaryKey": "casingSize" }
```

**Open question for owner:** confirm the exact size list UPR actually stocks/bills (the values above
are common millwork sizes, placeholders). If sizes should drive a price, that's a billing-mapping
follow-up (the sheet captures the value; the estimate side consumes it).

---

## ③a PPE line items (Juani)

> "Include PPE such as gloves, Tyvek suits, shoe covers, different mask types, respirator
> cartridges, and GP … document each job in greater detail."

**Today:** no PPE anywhere in the scope-sheet schema. (The `OOPPricing` PPE list is a separate
pricing calculator, unrelated.)

**Proposal:** a new **job-level** section (PPE is per-visit, not per-room) — add to the schema's
`jobSections`. For billable accuracy use a **`list`** (repeating item + qty), so each PPE line has a
count, not just a yes/no:

```jsonc
{ "key": "ppe", "icon": "🧤", "label": "PPE Used", "alwaysOn": true, "doneFlag": "ppeDone",
  "fields": [
    { "key": "ppeList", "type": "list", "addLabel": "Add PPE", "itemLabel": "PPE",
      "itemFields": [
        { "key": "type", "type": "single-chip", "label": "Item",
          "options": ["Gloves", "Tyvek suit", "Shoe covers", "N95 mask", "Half-face respirator",
                      "Full-face respirator", "Respirator cartridges"] },
        { "key": "qty", "type": "stepper", "unit": "ea", "label": "Qty", "step": 1 }
      ] } ] }
```

(A lighter alternative is a single `multi-chip` "PPE used" with no counts — cheaper to fill, less
billing detail. Recommend the `list` for estimate accuracy, matching the request.)

**Open question for owner:** what is **"GP"**? (General-purpose cleaner? A specific product?) Left
out of the list above pending your confirmation. Also confirm the mask/respirator taxonomy matches
what you bill.

---

## ③b Tension poles — verify billing (Juani)

> "Review the tension poles. I'm not sure they're being accounted for correctly."

**Findings (live v3 schema, `containment` section):**
- `tensionPosts` (stepper, "ea") **is** captured, and `daysInPlace` (stepper, "days").
- A `computed` field `postDays = tensionPosts × daysInPlace` rolls up to the summary
  (`summaryKey: "postDays"`).
- **Gap 1:** the raw `tensionPosts` **count** has **no `summaryKey`**, so only *post-days* surfaces
  in the summary, not the number of posts. If billing needs the material count (posts purchased)
  distinct from the rental/duration (post-days), add `"summaryKey": "tensionPosts"` to that field.
- **Gap 2:** the whole `containment` section is **gated** (`alwaysOn: false`, `gateField:
  "containment"`) — tension posts are only captured if the tech toggles "Containment & Barriers?" on.
  If posts are commonly used without that toggle, they'll be missed.

**Proposal:** (a) add `summaryKey: "tensionPosts"` so the count surfaces; (b) owner decision on
whether containment should be `alwaysOn` or the gate is correct. Both are schema-only edits.

---

## Suggested next step

On owner confirmation of the open questions (baseboard/casing size list, "GP", tension-pole billing
intent), the fastest path is: seed these as a **v4 DRAFT** via the Scope Sheets builder → preview →
publish. Happy to generate the exact v4 `definition` JSON ready to seed on your go-ahead.
