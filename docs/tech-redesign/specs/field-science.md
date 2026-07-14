# FIELD SCIENCE — Component Family Spec

**Direction B "Apple Field Pro" · locked system · spec of record for the drying/moisture/equipment
instrument components.** Sources of truth: `hydro-b.html` (drying module), `refine-b-jobhub.html`
(job hub), `direction-b.html` (dashboard). Every value below is lifted verbatim from those files
unless marked **DESIGNED HERE** (extensions this spec introduces, in the same hand). Tokens are the
locked Direction B set (`--ink/--ink2/--ink3`, `--surface/--surface2/--ground`, `--hair`, the five
status pairs `--amber/--amber-bg` etc., `--sh-card/--sh-hero`); components never hardcode theme
color — both themes come free through the token swap.

**Family thesis.** Readings are quiet ink; color exists only for state. A number a tech compares
visit-to-visit is set at glance size (17px) in `--ink` at weight 650, tabular; everything that
merely locates or timestamps it is 13px `--ink3`. One chromatic tone carries one meaning across the
whole family: **amber = needs action on this visit** (reading Due, equipment Pull today, material
Wet, material stalled), **green = confirmed good** (In range, Dry), **gray = neutral/terminal**
(Control, Pulled, Day N), **red = escalation** (drying failing, condensation risk — the designed
tier in section 2.4). Status is never color alone: every chip pairs its tone with a glyph and a
word (persona law: readable from 3 feet, survives grayscale).

Persona floors bind every component here: rows that navigate are full-width targets well above
48px; 44px is the documented-secondary floor (a comment required at the use site); the 11px size
appears only on non-actionable micro-labels (table column headers, badge numerals); all numerals
`font-variant-numeric: tabular-nums`. No emoji, no text arrows, anywhere.

---

## 1. Shared grammar

### 1.1 `.dnum` — the field-science numeral

```css
.dnum { font-weight:650; font-variant-numeric:tabular-nums; color:var(--ink); }
```

- Wraps the **number only** — never its unit. `<span class="dnum">72.4</span>°F` — the unit
  inherits the host line's quiet color/weight, so the number pops one step and the unit recedes.
- Legal hosts: the 17px `.row-vals` line, 13px `.row-m` / `.chm-meta` / `.attn-m` meta lines,
  the `hero-next` footer. Same markup at every size; the host sets the size.
- In an out-of-tolerance row (2.4) the offending `.dnum` may take the state color
  (`color:var(--amber)` or `var(--red)`) as **redundant** reinforcement of the chip — never as
  the only encoding.

### 1.2 `.nb` — the no-break measurement group

```css
.nb { white-space:nowrap; }
```

One `.nb` wraps one complete measurement (number + unit + optional trend glyph):
`<span class="nb"><span class="dnum">45</span> gpp</span>`. Wrapping may occur only at the
`·` separators between measurements, never inside one.

### 1.3 `.row-vals` — the reading value line

```css
.row-vals {
  font-size:17px; font-weight:500; color:var(--ink3); letter-spacing:-0.005em;
  margin-top:2px; font-variant-numeric:tabular-nums;
}
.row-vals + .row-m { margin-top:2px; }
```

- Sits between the 15px `.row-t` title and the 13px `.row-m` timestamp. 17px is deliberate: the
  numbers a tech compares visit-to-visit read at glance size, never at the timestamp's meta scale.
- **Fixed measurement order:** temperature, then relative humidity, then GPP —
  `72.4°F · 38% RH · 45 gpp`. Separator is ` · ` (space, middle dot, space). Units: `°F`
  (no space before), `% RH` (percent tight to number, space before RH), ` gpp` (space,
  lowercase). Each measurement is one `.nb`; each number is one `.dnum`.
- The timestamp line below is exactly `Read h:mm AM` in `.row-m`.

### 1.4 Trend glyph — `#i-trend` + `.dtrend`

Symbol (verbatim, duotone-rounded family hand, 2px stroke round caps):

```html
<symbol id="i-trend" viewBox="0 0 24 24">
  <path d="M4.6 8.4l5.6 5.6 3.2-3.2 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M19.4 12.4v4.4H15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</symbol>
```

```css
.row-m .dtrend, .row-vals .dtrend {
  display:inline-block; color:var(--green); vertical-align:-2px; margin-left:2px;
}
```

(`display:inline-block` deliberately beats the global `.ic { display:block }` wherever a trend
glyph sits inside running text.)

**Usage rules (law):**

1. The glyph rides **inside the `.nb` of the value it qualifies**, after the unit — it can never
   wrap away from its number. Size 14px in the 17px `.row-vals` line; 13px inside a chip; 12px
   in a 13px meta line.
2. Green, falling = **the desired direction** (GPP or MC dropping; drying is working). This is
   the only self-colored element allowed on an otherwise in-range line.
3. **DESIGNED HERE — adverse variant:** the same symbol mirrored vertically
   (`transform:scaleY(-1)`) in `color:var(--red)` = rising when it should fall. Appears **only**
   inside the red out-of-tolerance tier (2.4) — never as free-floating decoration.
4. Never on a Control row (a control has no goal, therefore no desired direction). Never on a
   timestamp or a count. A trend the system cannot assert is **omitted**, not grayed — an ink
   trend glyph does not exist.
5. At most one green glyph per value line in the normal case; in an out-of-tolerance row each
   offending value may carry its own adverse glyph.

---

## 2. Reading row (psychrometric)

Host: the standard `.card.rowcard` list idiom — `.row` flex, gap 12, padding `12px 16px`,
hairline `.row + .row` top border, `:active { background:var(--surface2) }`, whole row tappable
(opens the point's reading history). Leading `.lnk-ic` neutral icon tile (36px, radius 12,
`--surface2` bg, `--ink2` icon at 19px). Trailing `.chip` (12px/600, pill, 13px glyph).

Icon assignment: `#i-gauge` affected-area reading, `#i-therm` control/reference reading,
`#i-air` HVAC/airflow reading, `#i-dehu` dehumidifier reading.

### 2.1 State A — affected, in range

```html
<div class="row" role="button" tabindex="0">
  <span class="lnk-ic"><svg class="ic" width="19" height="19" aria-hidden="true"><use href="#i-gauge"/></svg></span>
  <div class="row-body">
    <div class="row-t">Affected · Kitchen</div>
    <div class="row-vals"><span class="nb"><span class="dnum">72.4</span>°F</span> · <span class="nb"><span class="dnum">38</span>% RH</span> · <span class="nb"><span class="dnum">45</span> gpp<svg class="ic dtrend" width="14" height="14" aria-hidden="true"><use href="#i-trend"/></svg></span></div>
    <div class="row-m">Read 9:46 AM</div>
  </div>
  <span class="chip chip-green"><svg class="ic" width="13" height="13" aria-hidden="true"><use href="#i-check"/></svg>In range</span>
</div>
```

Title grammar: `{Point kind} · {Room}`. Chip: green, `#i-check`, "In range".

### 2.2 State B — control / reference

Same anatomy; icon `#i-therm`; title `Control · Outside` (or the reference room). Chip: gray,
`#i-dotring`, "Control". **No trend glyph, ever** (rule 1.4-4). The control's values line renders
identically — the tech mentally differences affected against control, so both must sit in the
same grammar at the same size.

### 2.3 State C — due / missing this visit (`.row--due`)

```css
.row--due .row-t { color:var(--ink2); }
.row--due .lnk-ic { color:var(--ink3); }
```

- **The row stays quiet** (no reading yet = nothing to read): title steps down to `--ink2`, icon
  to `--ink3`, and there is **no `.row-vals` line at all** — the meta line reads
  `No reading this visit`.
- The chip is **amber, `#i-clock`, "Due"** — the single family-wide encoding for "needs action on
  this visit", shared verbatim with the equipment Pull chips. The chip is the only loud element;
  a due row must never shout with red or with colored values it does not have.
- Row remains tappable (leads to capture / history).

### 2.4 State D — out of tolerance (**DESIGNED HERE**)

The three shipped states cover capture status; this variant covers a captured reading whose
values are bad. Two tiers, both keeping the row's quiet anatomy — only the chip and the offending
number(s) change:

**Amber tier — "Out of range"** (value outside the chamber's target band; correctable this
visit — close the window, adjust HVAC, add a unit):

- Chip: `chip-amber` + `#i-warn` (13px) + label `Out of range`.
- Value-line treatment: **only the offending `.dnum` takes `color:var(--amber)`**; its unit and
  every other measurement stay in the quiet grammar. Multiple offenders each color, but the row
  carries exactly one chip.
- Meta line may append the tolerance for instant context, tabular:
  `Read 9:46 AM · target 70–80°F`.

```html
<div class="row-vals"><span class="nb"><span class="dnum" style="color:var(--amber)">84.1</span>°F</span> · <span class="nb"><span class="dnum">38</span>% RH</span> · <span class="nb"><span class="dnum">45</span> gpp</span></div>
```

(Shown inline for clarity; ship it as a class, e.g. `.dnum--warn { color:var(--amber) }`,
`.dnum--crit { color:var(--red) }` — no inline styles in production CSS.)

**Red tier — "Not drying"** (drying dynamics failing: affected GPP flat or rising against the
prior visit, or dew point within condensation distance of surface temperature — the reading says
the job is going backwards):

- Chip: `chip-red` + the **adverse trend glyph** (mirrored `#i-trend`, 13px) + label
  `Not drying` (or `Rising` where the offending value is a single climber).
- Value-line treatment: offending `.dnum` in `var(--red)` and its `.nb` carries the adverse glyph
  (`scaleY(-1)`, `--red`, 14px) immediately after the unit.
- Meta line carries the comparison that justifies the escalation, tabular:
  `Read 9:46 AM · was 41 gpp yesterday`.

Rules: red is reserved for **failed drying dynamics**, never for a merely-out-of-band comfort
value (that is amber). Both tiers keep the row background and title untouched — state lives in
the chip and the number, not in washes or side stripes (side-stripe accents are banned
system-wide). Color never appears without the chip's glyph + word.

### 2.5 Reading-row chip vocabulary (complete)

| State | Chip class | Glyph | Label |
|---|---|---|---|
| Affected, in range | `chip-green` | `#i-check` | In range |
| Control / reference | `chip-gray` | `#i-dotring` | Control |
| Due this visit | `chip-amber` | `#i-clock` | Due |
| Out of range (amber tier) | `chip-amber` | `#i-warn` | Out of range |
| Not drying (red tier) | `chip-red` | adverse `#i-trend` | Not drying |

---

## 3. Moisture-points micro-table

The one true table in the system: material moisture points against goals, per room. Real table
semantics (`role="table"` / `row` / `columnheader` / `cell`) laid onto the div grid — no layout
cost for the a11y.

### 3.1 Geometry

```css
.mp-title { display:flex; align-items:baseline; justify-content:space-between; padding:14px 16px 0; }
.mp-name  { font-size:16px; font-weight:600; letter-spacing:-0.005em; }
.mp-cols  { display:grid; grid-template-columns:1fr 46px 46px 76px; gap:10px; align-items:center; }
.mp-head  { padding:10px 16px 6px; font-size:11px; font-weight:600; color:var(--ink3); }
.mp-head .c { text-align:right; font-variant-numeric:tabular-nums; }
.mp-row   { padding:11px 16px; border-top:1px solid var(--hair); min-height:52px;
            cursor:pointer; transition:background 120ms ease-out; }
.mp-row:active { background:var(--surface2); }
.mp-mat   { font-size:15px; font-weight:600; letter-spacing:-0.005em; min-width:0; }
.mp-mc    { text-align:right; font-size:15px; font-weight:650; color:var(--ink);  font-variant-numeric:tabular-nums; }
.mp-goal  { text-align:right; font-size:15px; font-weight:500; color:var(--ink3); font-variant-numeric:tabular-nums; }
.mp-row .chip { justify-self:end; }
```

- Card title: `Moisture points · {Room}` at 16/600 in `.mp-title`.
- **Column headers at 11px/600 `--ink3`** — the system's absolute type floor, legal here because
  headers are non-actionable. Columns: `Material` (left, 1fr) · `MC` (right, 46px) ·
  `Goal` (right, 46px) · `Status` (right, 76px). Numeric headers right-align (`.c`) so they sit
  over their digits.
- **MC and Goal are fixed-width right-aligned tabular columns** — every MC digit and every Goal
  digit lands in the same vertical channel down the card; this column alignment IS the instrument.
  MC = 15/650 `--ink` (the fact); Goal = 15/500 `--ink3` (the reference). Values render as bare
  percents (`22%`) — no `.dnum` span needed, the column styles carry the weight.
- Rows are tappable (open point history — the same affordance as reading rows) and hairline-
  separated; `min-height:52px` keeps the target honest.

### 3.2 Status chip column

| State | Chip | Glyph | Label |
|---|---|---|---|
| At/below goal | `chip-green` | `#i-check` | Dry |
| Above goal | `chip-amber` | `#i-drop` | Wet |

Amber, not red: a wet material is normal mid-job work ("needs action" tone), consistent with Due
and Pull today. Escalation for a wet material is not a red chip here — it is the **stalled
sub-meta** below, and above the module it escalates through the dashboard attention rows (7).

### 3.3 Stalled sub-meta (`.mp-stall`)

```css
.mp-stall {
  display:inline-flex; align-items:center; gap:4px; margin-top:1px;
  font-size:13px; font-weight:600; color:var(--amber); font-variant-numeric:tabular-nums;
}
.mp-stall .ic { flex:none; }
```

```html
<div class="mp-mat" role="cell">Wood Subfloor
  <div class="mp-stall"><svg class="ic" width="12" height="12" aria-hidden="true"><use href="#i-clock"/></svg>2d stalled</div>
</div>
```

The decision-critical fact reads from 3 feet: amber 13/600 + a 12px `#i-clock` glyph under the
material name — never buried as `--ink3` meta. Grammar: `{N}d stalled`. Definition (per the data
model): latest reading for the room + material pair flagged `is_stalled`.

Material vocabulary (fixed, 13): Drywall, Wood Subfloor, Wood Framing, Hardwood, Engineered
Wood, Concrete, Carpet, Carpet Pad, Tile, Laminate, Vinyl, Insulation, Other.

---

## 4. Chamber card

A chamber groups reading rows under a shared target band.

### 4.1 Expanded header (`.chm-head`)

```css
.chm-head  { padding:14px 16px 12px; border-bottom:1px solid var(--hair); }
.chm-title { font-size:16px; font-weight:600; letter-spacing:-0.005em; }
.chm-meta  { font-size:13px; font-weight:500; color:var(--ink3); margin-top:1px; font-variant-numeric:tabular-nums; }
```

- Title grammar: `Chamber {N} · {primary room(s)}` — e.g. `Chamber 1 · Kitchen`,
  `Chamber 2 · Basement + Master Bath` (multiple rooms joined with ` + `).
- **Tolerance meta** grammar: `Target {lo}–{hi}°F · Rooms: {list}` (en dash in the range,
  tabular numerals). The tolerance line is what the amber "Out of range" tier (2.4) is judged
  against — it must be visible wherever those chips can appear.
- The header sits inside a standard `.card.rowcard`; reading rows follow beneath the hairline.

### 4.2 Collapsed chamber row

A chamber whose readings are not currently expanded renders as a single tappable row inside its
own card (`margin-top:12px` between chamber cards):

```html
<section class="card rowcard" aria-label="Chamber 2, collapsed" style="margin-top:12px">
  <div class="row" role="button" tabindex="0" aria-expanded="false">
    <div class="row-body">
      <div class="chm-title">Chamber 2 · Basement + Master Bath</div>
      <div class="chm-meta">Target 70–80°F · Final readings due — Master Bathroom</div>
    </div>
    <svg class="ic" width="20" height="20" aria-hidden="true"
         style="color:var(--ink3); transform:scaleX(-1); flex:none"><use href="#i-chev-l"/></svg>
  </div>
</section>
```

- The meta line doubles as the **pending-work line**: when work is outstanding inside the
  collapsed chamber, append ` · {what is due} — {where}` after the target. A collapsed chamber
  may hide its rows but never its obligations.
- Trailing 20px chevron in `--ink3` (the shipped file mirrors `#i-chev-l`; where the rightward
  `#i-chev` symbol is present, use it directly). `aria-expanded` reflects state; expanding swaps
  the row for the 4.1 header + rows in place.
- View switching between Chambers and Rooms grouping is the module's `.seg` segmented control —
  a high-frequency control, selection is **instant** by design (no sliding indicator; press
  scale only). The seg is a sibling system component; consumed here, specced with the controls.

---

## 5. Hydro summary numbers

The module summary is **one quiet numbers card** — the dashboard's numbers-grid idiom,
deliberately NOT Encircle's six tiles, not stat cards, no gradients, no per-cell cards.

```css
.numbers   { margin-top:14px; padding:14px 16px; }   /* on .card */
.num-cells { display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; }
.num-cell .v { font-size:22px; font-weight:650; letter-spacing:-0.015em;
               font-variant-numeric:tabular-nums; color:var(--ink2); line-height:1.1; }
.num-cell .l { font-size:12px; font-weight:500; color:var(--ink3); margin-top:2px; }
.num-cell--em .v { color:var(--ink); font-weight:700; }
.num-cell .v .of { font-size:15px; font-weight:600; color:var(--ink3); letter-spacing:0; }
```

- Three cells for hydro: **Materials dry** (emphasized: `--ink` 700, value as
  `2<span class="of"> of 3</span>` — the big numeral is the achievement, the ` of 3` shrinks to
  15/600 `--ink3`), **Units on site**, **Chambers**.
- Exactly one `--em` cell per card: the number the visit is judged by. Values are `--ink2` by
  default so the emphasized cell genuinely leads.
- **Mirror integrity (law):** these are the same numbers the hub's gateway row shows (6). The two
  surfaces read from one source; a summary that disagrees with its gateway is a defect (the
  shipped files disclose exactly one such conflict, inherited on purpose, to be resolved when the
  hub revision lands).

---

## 6. Equipment rows

Standard `.row` anatomy inside a `.card.rowcard`, under a `Equipment` section title. Icons:
`#i-air` (air movers / airflow units), `#i-dehu` (dehumidifiers — the most consequential unit on
a pull day earns its own silhouette). Both are family-hand duotone symbols in `hydro-b.html`.

- Title grammar: `{Unit type} ×{count}` — `Air movers ×3`, `LGR dehumidifier ×1`. The multiply
  sign is the × character, tight to the count.
- Meta grammar: `{Chamber/Room} · day {N}` (13/500 `--ink3`, tabular). Day N is the billing
  number (days on site + 1) — it must always be visible on a running unit.

### 6.1 States

| State | Chip | Glyph | Label |
|---|---|---|---|
| Running, nothing due | none | — | (day count lives in the meta) |
| **Pull today** | `chip-amber` | `#i-clock` | Pull today |
| Pulled (terminal) | `chip-gray` | `#i-check` | Pulled 11:05 AM |

- **Running units carry NO chip** — no state, no color (the family thesis). The quiet row with
  its day counter is the steady state.
- **Pull today** is the same amber "needs action on this visit" encoding as the reading Due chip
  — one tone, one meaning, everywhere.
- **Pulled** is terminal gray with the timestamp inside the chip label (`Pulled h:mm AM`,
  tabular). When the hub's checked pull tasks reconcile into the module, the amber chip flips to
  this gray state and the unit leaves the on-site count.

### 6.2 Justification footer (`.hero-next` inside a rowcard)

When an action seems to contradict the instruments (the shipped tension: subfloor still wet, yet
both units chip Pull today), the card carries the office's justification as the quiet one-line
footer idiom — the hub's `.hero-next`, positionally adapted:

```css
.hero-next {
  display:flex; align-items:center; gap:7px; margin-top:8px; padding-top:12px;
  border-top:1px solid var(--hair);
  font-size:13px; font-weight:500; color:var(--ink2); font-variant-numeric:tabular-nums;
}
.hero-next .ic { color:var(--ink3); flex:none; margin-top:1px; }
.hero-next strong { color:var(--ink); font-weight:600; }
/* disclosed positional override when hosted in a rowcard (the hub's lives in a padded hero card) */
.rowcard .hero-next { margin:0 16px; padding-bottom:14px; align-items:flex-start; }
```

Content grammar: `<strong>{Source}</strong> · {one-sentence justification}` with a 15px `#i-note`
glyph. The contradiction is resolved on-screen, not hidden — a tech should never have to trust a
chip against the evidence without the "why".

---

## 7. Gateway rows — the glance-and-gate pattern (IA law)

**The hub glances; the module goes deep.** This is the family's information-architecture law:

1. **A module's full instrument never renders inside the hub.** The hub shows one **gateway row**
   per module: leading `.lnk-ic` module icon, `.row-t` module name, `.row-m` aggregate readouts
   in the `.dnum` grammar, trailing 16px `--ink3` chevron. Tapping gates into the module screen.
2. **Gateway rows never carry a status chip** — a chip on the gate would double-encode state that
   belongs to the escalation row. The chevron is the gateway's only trailing element.
3. **At most one escalation row** (the worst offender) may sit directly beneath the gateway,
   inside the same card. It uses the ordinary chip-bearing row anatomy and deep-links to the
   exact instrument (the specific material's history), not to the module root.
4. **The gate destination owns all actions.** The hub never hosts Add reading / Place equipment;
   those live in the module's docked action bar (one primary black pill — Add reading — plus one
   quiet secondary). Capture on the hub is the hub dock's own concern.
5. **Mirror integrity:** the aggregates on the gateway are the module summary's numbers (5),
   verbatim.

Shipped reference (hub, section `Drying · Day 4`):

```html
<div class="row" role="button" tabindex="0">
  <span class="lnk-ic"><svg class="ic" width="19" height="19" aria-hidden="true"><use href="#i-gauge"/></svg></span>
  <div class="row-body">
    <div class="row-t">Readings &amp; equipment</div>
    <div class="row-m"><span class="dnum">2</span> of <span class="dnum">3</span> materials dry · <span class="dnum">4</span> units on site · <span class="nb">read 9:46 AM</span></div>
  </div>
  <svg class="ic chev" width="16" height="16" aria-hidden="true"><use href="#i-chev"/></svg>
</div>
<div class="row" role="button" tabindex="0"><!-- escalation row -->
  <span class="lnk-ic"><svg class="ic" width="19" height="19" aria-hidden="true"><use href="#i-drop"/></svg></span>
  <div class="row-body">
    <div class="row-t">Wood Subfloor · Kitchen</div>
    <div class="row-m"><span class="dnum">22%</span> · goal 15% · 2d stalled</div>
  </div>
  <span class="chip chip-amber"><svg class="ic" width="13" height="13" aria-hidden="true"><use href="#i-drop"/></svg>Wet</span>
</div>
```

Gateway meta grammar: `{X} of {Y} materials dry · {N} units on site · read {h:mm AM}` — counts as
`.dnum`, the freshness stamp as an `.nb`. Escalation meta grammar:
`{MC%} · goal {G%} · {N}d stalled` — the reading value in `.dnum`, goal and stall in quiet ink.

The module's compact pinned header completes the pattern in the other direction: module title
20/700, `.hub-sub` = `#{job} · {customer}` (the way back is always labeled), and a gray
`Day {N}` chip (`#i-cal`, 13px) placing the visit inside the drying timeline.

---

## 8. Attention rows — dashboard stalled widget

The third altitude. Dashboard = cross-job attention; hub = per-job glance; module = instrument.
The dashboard surfaces only what is going wrong, in the attention strip (present only when
needed).

```css
.attn      { padding:16px 16px 8px; margin-top:8px; }   /* on .card */
.attn-head { display:flex; align-items:center; gap:9px; font-size:15px; font-weight:600; padding-bottom:12px; }
.attn-head .ic { color:var(--amber); flex:none; }
.attn-row  { display:flex; align-items:center; gap:12px; padding:12px 0;
             border-top:1px solid var(--hair); cursor:pointer; border-radius:12px;
             transition:background 120ms ease-out; }
.attn-row:active { background:var(--surface2); }
.attn-ic   { width:36px; height:36px; flex:none; border-radius:12px;
             background:var(--amber-bg); color:var(--amber); display:grid; place-items:center; }
.attn-body { flex:1; min-width:0; }
.attn-t    { font-size:15px; font-weight:600; }
.attn-m    { font-size:13px; font-weight:500; color:var(--ink3); font-variant-numeric:tabular-nums; }
.attn-m strong { color:var(--ink); font-weight:700; }
.attn-row .chev { color:var(--ink3); flex:none; }
```

- **Header:** 20px `#i-warn` in `--amber` + the count sentence at 15/600 ink:
  `{N} materials stalled across {M} jobs` (the jobs clause only when more than one job).
- **Row anatomy:** the `.attn-ic` tile is the amber twin of `.lnk-ic` — `--amber-bg` fill,
  `--amber` 19px `#i-drop` glyph. This is the one place the leading tile itself is chromatic:
  the whole strip exists to be the exception, and the tile replaces a chip (attention rows carry
  a chevron, not a chip — the destination shows the full state).
- **Title grammar:** `{Material} · {Room}` (15/600 ink).
- **Meta grammar:** `#{job} · <strong>{MC%}</strong> · goal {G%} · {N}d stalled` — the reading
  value is the bold ink element (`strong` at 700), job number and goal stay quiet, all tabular.
- Tap target is the full row; it deep-links toward the offending job's latest visit.
- Behavior notes for the builder: the strip renders only when at least one row exists; long lists
  collapse (show 3 + a `Show all (N)` control); this widget is flag-gated
  (`page:tech_moisture`) and silently absent on failure.

---

## 9. Thermal-image thumbnail variant (**DESIGNED HERE**)

For photo grids where a frame is a thermal/IR capture (moisture mapping evidence). Base tile is
the shipped `.ph` grid cell (3-column, `gap:8px`, `aspect-ratio:1`, `border-radius:12px`,
`--surface2`, centered 26px duotone `#i-photo` when a drawn placeholder).

```css
.ph { position:relative; }
.ph-thermal-tag {
  position:absolute; top:6px; left:6px;
  width:22px; height:22px; border-radius:8px;
  background:var(--surface); color:var(--ink2);
  display:grid; place-items:center;
  box-shadow:0 1px 2px rgba(16,17,20,.10);
}
```

```html
<div class="ph">
  <svg class="ic" width="26" height="26" aria-hidden="true"><use href="#i-photo"/></svg>
  <span class="ph-thermal-tag" aria-hidden="true">
    <svg class="ic" width="14" height="14"><use href="#i-therm"/></svg>
  </span>
</div>
```

Rules:

1. The marker is a 22px rounded-square tag, top-left, `--surface` on the image with a single
   soft 1px shadow — solid, never frosted (the one-glass budget is spent on the tab bar), inner
   radius 8 (inner < outer 12, per the radius family).
2. Glyph is the family `#i-therm` at 14px in `--ink2`. Neutral ink, not amber — being thermal is
   a **kind**, not a state; state stays with chips and readings.
3. **No fake FLIR treatment**: no rainbow/gradient washes, no orange tints on the tile or
   placeholder (gradients are banned; drawn placeholders stay the neutral abstraction).
4. The tag is decorative redundancy (`aria-hidden`); the tile's accessible name/caption carries
   it in words — caption grammar `Thermal · {Room} — {detail}` wherever captions render.
5. Lightbox and album views keep the same tag at the same size on the corner of the full frame's
   chrome, and the caption leads with `Thermal ·`.
6. In a mixed grid, thermal frames sort with their capture time like any photo — no segregated
   thermal section; the tag does the work.

---

## 10. Encircle mapping note (data model behind the family)

The family mirrors the Encircle Hydro hierarchy so synced jobs read the same way in both tools:

- **Chambers** contain **rooms**; chamber-level **psychrometric readings** (affected, control,
  HVAC, dehu) are the reading rows (2); rooms contain **materials** as moisture points with
  per-visit MC against a dry goal — the micro-table (3); **equipment** is placed per chamber/room
  with days on site — the equipment rows (6).
- **UPR-side tables (per the context pack): `moisture_readings`** (room + material + MC% +
  `drying_goal_pct` + affected flag + location + `is_stalled` on the latest room+material
  reading), **`equipment_placements`** (room + type + nickname/serial + `days_onsite`; the
  displayed Day N = `days_onsite + 1`, the billing number), **`rooms`** (per job; quick-pick
  template names; `get_job_rooms`). Writes go through `insert_reading`, `place_equipment`,
  `remove_equipment` (each with an offline-queue fork). The job links to Encircle via
  `encircle_claim_id`; Encircle room import exists on the scope-sheet flow.
- **Chambers are not a UPR table today** — chamber grouping is the Encircle-side structure. The
  module's `Chambers | Rooms` segmented control is the honest seam: **Rooms is the UPR-native
  grouping and the guaranteed fallback; Chambers renders when chamber data exists** (synced or
  future-native). Nothing in this spec requires a chamber row to exist for the instrument to
  work — a room-grouped card uses the same chamber-card anatomy with the room as the title.
- Builder discipline: these names are from the survey pack, not a live schema dump — **verify
  live column names before implementation** (CLAUDE.md Rule 7 posture: never assume from a doc
  list). Visibility is flag-gated: `page:tech_moisture`, `page:tech_equipment`,
  `page:tech_rooms`; the dashboard stalled widget rides `page:tech_moisture`.

---

## 11. Family-wide invariants (checklist for the style-guide builder)

1. Numbers a tech compares are 17px+/650 tabular ink; locators and timestamps are 13px/500 ink3.
2. Amber means "act this visit" in every component here; green means confirmed good; gray means
   neutral or terminal; red means drying is failing. One tone never carries two meanings.
3. Every chromatic signal ships glyph + word inside a chip (or the amber tile + text pair in the
   attention strip); grayscale must lose nothing.
4. Quiet rows for absent data (`.row--due`): no values line, stepped-down ink, one amber chip.
5. Trend glyphs only where direction is meaningful; green falling = good, red rising (mirrored)
   = escalation only; never on controls, timestamps, or counts.
6. Tables right-align tabular numeric columns under 11px non-actionable headers; the alignment
   channel is the instrument.
7. Summaries are one quiet numbers card with exactly one emphasized cell; gateway rows mirror the
   same numbers verbatim and carry chevrons, never chips.
8. Contradictions between instruments and instructions are resolved on-screen via the
   justification footer, never left implicit.
9. No side-stripe accents, no gradients, no second frosted surface, no emoji, no text arrows.
10. All rows that navigate are full-width tap targets; two-tap confirm for destructive equipment
    removal; reduced-motion collapses the 120ms press transitions.
