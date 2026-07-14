# SVG Icon System — Direction B "Apple Field Pro"

Spec of record for the /tech/* greenfield icon family. Thesis alignment: icons are drawn in INK
(`currentColor`) and inherit whatever the surrounding text color is — an icon never carries its own
hex. Chromatic color reaches an icon only when its container is a status/semantic surface (the
attention strip's amber, a status chip's green); the glyph itself is colorless.

Sources of truth: the three screens of record —
`docs/tech-redesign/mockups/direction-b.html` (dashboard), `docs/tech-redesign/mockups/refine-b-jobhub.html` (job hub),
`docs/tech-redesign/mockups/hydro-b.html` (drying module). Every shipped symbol below was extracted verbatim from
those files. The style-guide builder draws the gap icons in Section 4 in this exact hand.

No emoji, ever — every pictograph in the product (including the legacy `TYPE_CONFIG` emoji and the
primitive defaults like ErrorState's warning glyph) is replaced by an icon from this system.

---

## 1. System rules (the family hand)

1. **Grid:** `viewBox="0 0 24 24"`, always. Live area sits inside roughly x/y 3.8 to 20.5 — glyphs
   never touch the viewBox edge. Optical centering beats mathematical centering (the play triangle,
   the back chevron shift slightly toward visual balance).
2. **Stroke:** `1.8` for every icon that has a silhouette (body + outline). Round caps
   (`stroke-linecap="round"`) and round joins (`stroke-linejoin="round"`) everywhere a cap or join
   is visible. **Micro-glyphs — pure line marks with no silhouette (check, chevrons, trend) — use
   stroke `2`** so they hold weight at 13px (1.8 at a 13px render is under 1 device px). The FAB
   plus is the one sanctioned heavier outlier at `2.2` (it must read as THE primary create action).
3. **Duotone construction:** two stacked layers sharing one path —
   - Layer 1 (body): `fill="currentColor" style="opacity:var(--duo,.16)"` — the silhouette fill.
   - Layer 2 (outline): `fill="none" stroke="currentColor" stroke-width="1.8"` — the same path,
     stroked.
   - Detail strokes (clock hands, note lines, camera lens) are additional stroke-only paths on top.
   - Tiny solid accents (the help dot, the gauge needle hub, the photo-mountain sun) are small
     `fill="currentColor"` shapes at FULL opacity — they are punctuation, kept under ~2px radius.
   - `--duo` is the single tuning knob: default `.16` (contexts may set `.14`), the active tab bar
     raises it to `.9` (see rule 7). Never bake an opacity literal into the fill layer.
4. **Solid exceptions (no duo layer):** pure-geometry marks are solid fills with no outline —
   `i-pause` (two rounded bars), `i-dots-h` / `i-dots-v` (dot triads), and small punctuation dots.
   Pure-line exceptions (no fill layer at all): `i-check`, `i-chev`, `i-chev-l`, `i-trend`,
   `i-plus`, `i-air` (airflow is drawn as three breeze lines with curled ends — a fill would kill
   the lightness).
5. **Corner character:** friendly and generous. Rounded rects carry `rx` 2.8 to 3.6 (calendar 2.8,
   note card 3.6, photo frame 3.0, dehumidifier 3.0); bars and pills use full-round `rx` (pause bars
   `rx=1.5`). Organic forms (drop, chat, pin, flag) use soft continuous curves — no sharp interior
   angles. Nothing in the family has a square corner.
6. **Optical sizing (render sizes, not separate drawings — one 24-grid master scales):**
   - **13px — chip/meta glyphs** (inside status chips, meta rows, count pills). Observed range
     12 to 15. Only micro-glyphs and the simplest duotones (clock, dotring, check, drop, cal) may
     render this small; a detailed icon (camera, doc) at 13px is a spec violation.
   - **16 to 19px — row and list icons** (action rows, attention strip, tool rows, detail rows).
     Observed range 16 to 20; canonical 19.
   - **22 to 26px — tab bar, header icon buttons, dock actions.** Observed: header icon buttons 23,
     tab bar 25, back chevron 24, dock photo 26.
   - Consumers pass the size; the artwork never changes. If a glyph muddies at its floor size,
     simplify the drawing, do not thicken the stroke per-instance.
7. **State duality without second drawings:** the active tab does NOT swap to a filled variant.
   It raises the fill layer: `.tab { --duo:.14 } .tab.active { --duo:.9; color:var(--ink) }`.
   This is the system's replacement for the legacy `filled/outline` icon pairs — one drawing,
   one custom property. Any future "emphasized" icon state uses the same mechanism.
8. **Accessibility:** decorative icons always carry `aria-hidden="true"`; an icon that is the sole
   content of a button relies on the button's `aria-label` (IconButton's required-label contract).
   Icons never shrink a hit target — the 48px/44px target law lives on the button, not the glyph.
9. **Out of scope:** the iOS status-bar chrome (signal bars, wifi, battery drawn inline in the
   mockups) is device chrome, not part of this system. CrewAvatars remain typographic initials,
   not icons. Division/loss icons keep their keyed-API surface (Section 5.4) but are redrawn in
   this hand.

---

## 2. Inventory — the shipped core set (29 canonical glyphs, 30 symbol ids)

Every `<symbol>` across the three screens of record, deduped by id. All identical-id copies are
byte-identical across files EXCEPT `i-drop` (see Section 3).

Legend for Style: **duo** = duotone (fill layer + outline), **line** = pure stroke, **solid** =
pure fill.

| id | Purpose | Where used (screen · context · observed px) | Style |
|---|---|---|---|
| `i-house` | Dash tab; home/property | all three · tab bar 25 · hub property row 19 | duo |
| `i-folder` | Claims tab; claim/job file | all three · tab bar 25 · hub claim row 19 | duo |
| `i-cal` | Schedule tab; dates | all three · tab bar 25 · date chips 13 · visit rows 25 | duo |
| `i-chat` | Messages tab; message action | all three · tab bar 25 · dock/action 20 | duo |
| `i-dots-h` | More tab; overflow (horizontal) | all three · tab bar 25 | solid |
| `i-dots-v` | Kebab menu (vertical) | dashboard · header menu button 23 | solid |
| `i-bell` | Notifications | dashboard · header icon button 23 | duo |
| `i-help` | Help and guides ("?") | dashboard · header icon button 23 | duo |
| `i-warn` | Warning/attention | dashboard · attention strip 20 · stalled chip 13 | duo |
| `i-check` | Done/confirm; task complete | all three · chips 13 · task rows 16 · status cue 19 | line (stroke 2) |
| `i-chev` | Chevron right (drill-in) | dashboard+hub · row trailing 14 to 16 | line (stroke 2) |
| `i-chev-l` | Chevron left (back) | hub+hydro · header back button 24 | line (stroke 2) |
| `i-plus` | Create (FAB) | dashboard · FAB 24 | line (stroke 2.2) |
| `i-clock` | Time; scheduled/duration | all three · meta chips 12 to 15 | duo |
| `i-dotring` | "Now/next" status cue (ring + dot) | all three · status shape-redundancy mark 13 to 14 | ring stroke .4 opacity + solid dot |
| `i-pause` | Paused status; pause action | dashboard+hub · status cue / clock button 19 | solid |
| `i-flag` | Event; milestone flag | dashboard+hub · event rows 15 to 19 | duo |
| `i-pin` | Map pin; address | dashboard+hub · address rows 18 | duo |
| `i-camera` | Capture photo (action) | dashboard+hub · hero photo button 18 to 22 | duo |
| `i-photo` | Photos/gallery (content) | hub · dock 26 · photo section rows | duo |
| `i-note` | Note; add note | all three · note rows 15 to 20 | duo |
| `i-doc` | Document; PDF; report | hub · documents rows 19 | duo |
| `i-person` | Person; crew member; contact | hub · contacts row 19 | duo |
| `i-phone` | Call | hub · dock call action 20 | duo |
| `i-drop` | Water/moisture; mitigation | all three · attention strip 19 · drying chips 13 | duo (canonical v2, see Section 3) |
| `i-air` | Air mover; airflow | hub+hydro · equipment rows 19 to 20 | line |
| `i-dehu` | Dehumidifier | hydro · equipment rows 19 | duo |
| `i-therm` | Thermometer; temperature | hydro · reading rows 19 | duo |
| `i-gauge` | Gauge; moisture reading; meter | hub+hydro · readings 19 to 20 | duo |
| `i-trend` | Trend line (readings trajectory) | hub+hydro · drying trend chip 14 | line (stroke 2) |

### 2.1 Exact SVG source (canonical — verbatim from the screens of record)

```html
<symbol id="i-house" viewBox="0 0 24 24">
  <path fill="currentColor" style="opacity:var(--duo,.16)" d="m4.4 10.6 7.6-6.4 7.6 6.4V19a1.9 1.9 0 0 1-1.9 1.9H6.3A1.9 1.9 0 0 1 4.4 19Z"/>
  <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="m4.4 10.6 7.6-6.4 7.6 6.4V19a1.9 1.9 0 0 1-1.9 1.9H6.3A1.9 1.9 0 0 1 4.4 19Z"/>
</symbol>

<symbol id="i-folder" viewBox="0 0 24 24">
  <path fill="currentColor" style="opacity:var(--duo,.16)" d="M4 7.6A2.4 2.4 0 0 1 6.4 5.2h3.5l1.9 2.2h5.8A2.4 2.4 0 0 1 20 9.8v6.6a2.4 2.4 0 0 1-2.4 2.4H6.4A2.4 2.4 0 0 1 4 16.4Z"/>
  <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M4 7.6A2.4 2.4 0 0 1 6.4 5.2h3.5l1.9 2.2h5.8A2.4 2.4 0 0 1 20 9.8v6.6a2.4 2.4 0 0 1-2.4 2.4H6.4A2.4 2.4 0 0 1 4 16.4Z"/>
</symbol>

<symbol id="i-cal" viewBox="0 0 24 24">
  <rect x="4" y="5.6" width="16" height="14.4" rx="2.8" fill="currentColor" style="opacity:var(--duo,.16)"/>
  <rect x="4" y="5.6" width="16" height="14.4" rx="2.8" fill="none" stroke="currentColor" stroke-width="1.8"/>
  <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M8 3.8v3.2M16 3.8v3.2M4.4 10.4h15.2"/>
</symbol>

<symbol id="i-chat" viewBox="0 0 24 24">
  <path fill="currentColor" style="opacity:var(--duo,.16)" d="M12 4.4c4.7 0 8.4 3.2 8.4 7.2s-3.7 7.2-8.4 7.2c-1 0-1.9-.1-2.8-.4L5 20l.9-3.3c-1.4-1.3-2.3-3-2.3-5.1 0-4 3.7-7.2 8.4-7.2Z"/>
  <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M12 4.4c4.7 0 8.4 3.2 8.4 7.2s-3.7 7.2-8.4 7.2c-1 0-1.9-.1-2.8-.4L5 20l.9-3.3c-1.4-1.3-2.3-3-2.3-5.1 0-4 3.7-7.2 8.4-7.2Z"/>
</symbol>

<symbol id="i-dots-h" viewBox="0 0 24 24">
  <circle cx="5.6" cy="12" r="1.9" fill="currentColor"/><circle cx="12" cy="12" r="1.9" fill="currentColor"/><circle cx="18.4" cy="12" r="1.9" fill="currentColor"/>
</symbol>

<symbol id="i-dots-v" viewBox="0 0 24 24">
  <circle cx="12" cy="5.6" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="18.4" r="1.7" fill="currentColor"/>
</symbol>

<symbol id="i-bell" viewBox="0 0 24 24">
  <path fill="currentColor" style="opacity:var(--duo,.16)" d="M12 3.6c-3.1 0-5.4 2.4-5.4 5.5v3.2l-1.6 2.8c-.4.8.1 1.7 1 1.7h12c.9 0 1.4-.9 1-1.7l-1.6-2.8V9.1c0-3.1-2.3-5.5-5.4-5.5Z"/>
  <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M12 3.6c-3.1 0-5.4 2.4-5.4 5.5v3.2l-1.6 2.8c-.4.8.1 1.7 1 1.7h12c.9 0 1.4-.9 1-1.7l-1.6-2.8V9.1c0-3.1-2.3-5.5-5.4-5.5Z"/>
  <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M10.1 19.6a2 2 0 0 0 3.8 0"/>
</symbol>

<symbol id="i-help" viewBox="0 0 24 24">
  <circle cx="12" cy="12" r="8.4" fill="currentColor" style="opacity:var(--duo,.16)"/>
  <circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" stroke-width="1.8"/>
  <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M9.8 9.6c.3-1.2 1.2-1.9 2.4-1.9 1.3 0 2.3.9 2.3 2 0 1-.6 1.5-1.4 2-.7.5-1.1.9-1.1 1.7"/>
  <circle cx="12" cy="16.4" r="1.1" fill="currentColor"/>
</symbol>

<symbol id="i-warn" viewBox="0 0 24 24">
  <path fill="currentColor" style="opacity:var(--duo,.16)" d="M10.6 4.9 3.5 17.4c-.6 1.1.2 2.5 1.4 2.5h14.2c1.2 0 2-1.4 1.4-2.5L13.4 4.9c-.6-1.1-2.2-1.1-2.8 0Z"/>
  <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M10.6 4.9 3.5 17.4c-.6 1.1.2 2.5 1.4 2.5h14.2c1.2 0 2-1.4 1.4-2.5L13.4 4.9c-.6-1.1-2.2-1.1-2.8 0Z"/>
  <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M12 9.6v4"/>
  <circle cx="12" cy="16.6" r="1.1" fill="currentColor"/>
</symbol>

<symbol id="i-check" viewBox="0 0 24 24">
  <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m5.6 12.8 4.1 4.1 8.7-9.4"/>
</symbol>

<symbol id="i-chev" viewBox="0 0 24 24">
  <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m9.4 6.2 5.8 5.8-5.8 5.8"/>
</symbol>

<symbol id="i-chev-l" viewBox="0 0 24 24">
  <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M14.6 6.2 8.8 12l5.8 5.8"/>
</symbol>

<symbol id="i-plus" viewBox="0 0 24 24">
  <path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M12 5.4v13.2M5.4 12h13.2"/>
</symbol>

<symbol id="i-clock" viewBox="0 0 24 24">
  <circle cx="12" cy="12" r="8.2" fill="currentColor" style="opacity:var(--duo,.16)"/>
  <circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" stroke-width="1.8"/>
  <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M12 7.8V12l3 1.9"/>
</symbol>

<symbol id="i-dotring" viewBox="0 0 24 24">
  <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.8" opacity=".4"/>
  <circle cx="12" cy="12" r="4.2" fill="currentColor"/>
</symbol>

<symbol id="i-pause" viewBox="0 0 24 24">
  <rect x="7.6" y="6.6" width="3" height="10.8" rx="1.5" fill="currentColor"/>
  <rect x="13.4" y="6.6" width="3" height="10.8" rx="1.5" fill="currentColor"/>
</symbol>

<symbol id="i-flag" viewBox="0 0 24 24">
  <path fill="currentColor" style="opacity:var(--duo,.16)" d="M6.2 5.2c2-1.2 3.9-1.2 5.8 0s3.8 1.2 5.8 0v8.4c-2 1.2-3.9 1.2-5.8 0s-3.8-1.2-5.8 0Z"/>
  <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M6.2 5.2c2-1.2 3.9-1.2 5.8 0s3.8 1.2 5.8 0v8.4c-2 1.2-3.9 1.2-5.8 0s-3.8-1.2-5.8 0"/>
  <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M6.2 21V5.2"/>
</symbol>

<symbol id="i-pin" viewBox="0 0 24 24">
  <path fill="currentColor" style="opacity:var(--duo,.16)" d="M12 21.2c-4-3.8-6.4-7-6.4-10.3A6.4 6.4 0 0 1 12 4.4a6.4 6.4 0 0 1 6.4 6.5c0 3.3-2.4 6.5-6.4 10.3Z"/>
  <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M12 21.2c-4-3.8-6.4-7-6.4-10.3A6.4 6.4 0 0 1 12 4.4a6.4 6.4 0 0 1 6.4 6.5c0 3.3-2.4 6.5-6.4 10.3Z"/>
  <circle cx="12" cy="10.9" r="2.3" fill="none" stroke="currentColor" stroke-width="1.8"/>
</symbol>

<symbol id="i-camera" viewBox="0 0 24 24">
  <path fill="currentColor" style="opacity:var(--duo,.16)" d="M8.6 6.8 9.8 5h4.4l1.2 1.8h2.6A2.5 2.5 0 0 1 20.5 9.3v7.2A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5V9.3A2.5 2.5 0 0 1 6 6.8Z"/>
  <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M8.6 6.8 9.8 5h4.4l1.2 1.8h2.6A2.5 2.5 0 0 1 20.5 9.3v7.2A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5V9.3A2.5 2.5 0 0 1 6 6.8Z"/>
  <circle cx="12" cy="12.6" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/>
</symbol>

<symbol id="i-photo" viewBox="0 0 24 24">
  <rect x="3.8" y="5.2" width="16.4" height="13.6" rx="3" fill="currentColor" style="opacity:var(--duo,.16)"/>
  <rect x="3.8" y="5.2" width="16.4" height="13.6" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/>
  <circle cx="8.7" cy="9.7" r="1.5" fill="currentColor"/>
  <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="m6.4 18.2 4.4-4.6 2.9 2.9 2.4-2.4 3.5 4"/>
</symbol>

<symbol id="i-note" viewBox="0 0 24 24">
  <rect x="4.2" y="4.4" width="15.6" height="15.6" rx="3.6" fill="currentColor" style="opacity:var(--duo,.16)"/>
  <rect x="4.2" y="4.4" width="15.6" height="15.6" rx="3.6" fill="none" stroke="currentColor" stroke-width="1.8"/>
  <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M8.4 9.6h7.2M8.4 12.8h7.2M8.4 16h4.4"/>
</symbol>

<symbol id="i-doc" viewBox="0 0 24 24">
  <path fill="currentColor" style="opacity:var(--duo,.16)" d="M7 3.8h6.2l4.4 4.4v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5.8a2 2 0 0 1 2-2Z"/>
  <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M7 3.8h6.2l4.4 4.4v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5.8a2 2 0 0 1 2-2Z"/>
  <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M13.2 4.2v4h4"/>
  <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M8.6 13.2h6.8M8.6 16.2h4.4"/>
</symbol>

<symbol id="i-person" viewBox="0 0 24 24">
  <circle cx="12" cy="8.4" r="3.4" fill="currentColor" style="opacity:var(--duo,.16)"/>
  <circle cx="12" cy="8.4" r="3.4" fill="none" stroke="currentColor" stroke-width="1.8"/>
  <path fill="currentColor" style="opacity:var(--duo,.16)" d="M5.6 19.4c.7-3.1 3.3-5 6.4-5s5.7 1.9 6.4 5Z"/>
  <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M5.6 19.4c.7-3.1 3.3-5 6.4-5s5.7 1.9 6.4 5"/>
</symbol>

<symbol id="i-phone" viewBox="0 0 24 24">
  <path fill="currentColor" style="opacity:var(--duo,.16)" d="M7.2 4.3c.8-.4 1.8 0 2.2.8l.9 2c.3.7.1 1.5-.5 2l-1 .9a11.8 11.8 0 0 0 5.2 5.2l.9-1c.5-.6 1.3-.8 2-.5l2 .9c.8.4 1.2 1.4.8 2.2l-.8 1.6c-.4.8-1.2 1.3-2.1 1.2C10.4 18.9 5.1 13.6 4.4 7.2c-.1-.9.4-1.7 1.2-2.1Z"/>
  <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M7.2 4.3c.8-.4 1.8 0 2.2.8l.9 2c.3.7.1 1.5-.5 2l-1 .9a11.8 11.8 0 0 0 5.2 5.2l.9-1c.5-.6 1.3-.8 2-.5l2 .9c.8.4 1.2 1.4.8 2.2l-.8 1.6c-.4.8-1.2 1.3-2.1 1.2C10.4 18.9 5.1 13.6 4.4 7.2c-.1-.9.4-1.7 1.2-2.1Z"/>
</symbol>

<symbol id="i-drop" viewBox="0 0 24 24">
  <path d="M12 3.8c3.1 3.9 5.5 6.8 5.5 9.9a5.5 5.5 0 1 1-11 0c0-3.1 2.4-6 5.5-9.9Z" fill="currentColor" style="opacity:var(--duo,.16)"/>
  <path d="M12 3.8c3.1 3.9 5.5 6.8 5.5 9.9a5.5 5.5 0 1 1-11 0c0-3.1 2.4-6 5.5-9.9Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
</symbol>

<symbol id="i-air" viewBox="0 0 24 24">
  <path d="M4 8.6h8.6a2.3 2.3 0 1 0-2.3-2.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  <path d="M4 12.8h13.2a2.5 2.5 0 1 1-2.5 2.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  <path d="M4 17h6.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
</symbol>

<symbol id="i-dehu" viewBox="0 0 24 24">
  <rect x="5" y="4.6" width="14" height="14.8" rx="3" fill="currentColor" style="opacity:var(--duo,.16)"/>
  <rect x="5" y="4.6" width="14" height="14.8" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/>
  <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M8.2 7.9h7.6"/>
  <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M12 10.6c1.2 1.5 2.1 2.6 2.1 3.8a2.1 2.1 0 1 1-4.2 0c0-1.2.9-2.3 2.1-3.8Z"/>
</symbol>

<symbol id="i-therm" viewBox="0 0 24 24">
  <path fill="currentColor" style="opacity:var(--duo,.16)" d="M9.8 6.7a2.2 2.2 0 0 1 4.4 0v6.6a4.1 4.1 0 1 1-4.4 0Z"/>
  <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M9.8 6.7a2.2 2.2 0 0 1 4.4 0v6.6a4.1 4.1 0 1 1-4.4 0Z"/>
  <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M12 16.4v-6"/>
  <circle cx="12" cy="16.6" r="1.7" fill="currentColor"/>
</symbol>

<symbol id="i-gauge" viewBox="0 0 24 24">
  <path d="M4.6 15.9a7.9 7.9 0 1 1 14.8 0Z" fill="currentColor" style="opacity:var(--duo,.16)"/>
  <path d="M4.6 15.9a7.9 7.9 0 1 1 14.8 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  <path d="M12 15.6l3.4-4.9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  <circle cx="12" cy="15.6" r="1.7" fill="currentColor"/>
</symbol>

<symbol id="i-trend" viewBox="0 0 24 24">
  <path d="M4.6 8.4l5.6 5.6 3.2-3.2 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M19.4 12.4v4.4H15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</symbol>
```

---

## 3. Near-duplicates that must merge

1. **`i-drop` — two drawings under one id (MUST merge).**
   - v1 (dashboard `direction-b.html`): wider drop (`M12 3.8s6.2 6.4 6.2 10.7...`) with an interior
     highlight arc (`M9.4 14.6a2.7 2.7 0 0 0 2.4 2.6`).
   - v2 (job hub + `hydro-b.html`, identical in both): narrower, cleaner drop
     (`M12 3.8c3.1 3.9 5.5 6.8 5.5 9.9...`), no highlight arc.
   - **Canonical: v2** (Section 2.1 above). It is the later refinement, is already duplicated
     verbatim across two screens, and reads better at 13px (the v1 highlight arc muddies below
     16px). The dashboard's two `i-drop` uses re-point to v2 with no other change.
2. **`i-trend` naming caveat (no merge, one clarification).** The drawn path descends left-to-right
   with the arrow at bottom-right — semantically "trending down." In the drying module a falling
   reading is GOOD (drying progress). The style-guide builder ships this exact drawing as
   `i-trend-down` and adds the mirrored `i-trend-up` (Section 4); `i-trend` remains as an alias of
   `i-trend-down` until the screens are re-pointed.
3. **`i-camera` vs `i-photo` — NOT duplicates, both stay.** Camera = the capture ACTION; photo
   (framed mountain) = photo CONTENT/gallery. The census's snap-first law makes this distinction
   load-bearing: capture buttons always use `i-camera`, gallery/album entry points always `i-photo`.
4. **`i-note` vs `i-doc` — NOT duplicates, both stay.** Note = rounded card with text lines
   (notes, scope-sheet fields); doc = folded-corner file (documents, PDFs, e-sign). Never swap.
5. **`i-dots-h` vs `i-dots-v` — both stay** with fixed roles: `dots-h` is the More tab and admin
   overflow ("..." reading), `dots-v` is the in-header kebab menu. Do not rotate one into the other
   (dot radii differ deliberately: 1.9 vs 1.7).

---

## 4. Gap list — icons the full /tech/* surface needs (not yet drawn)

Derived from the shell census (design-context.md, survey:shell): every screen, sheet, header, row
type, and the emoji/inline-SVG debt it inventories. Grouped by consumer. Each brief is drawable
under Section 1's rules; "duo" means duotone construction (rule 3), "line" means pure stroke at 2
(micro-glyph rule), sizes name the primary render tier.

### 4.1 Navigation, chrome, and list furniture

| Name | Brief |
|---|---|
| `i-search` | duo. Circle lens centered upper-left (cx 10.5, cy 10.5, r about 5.6) with duo fill + 1.8 outline; handle a single round-capped 1.8 stroke from the rim to about (19.4, 19.4). Consumers: schedule header toggle, claims/tasks/messages search bars, SearchInput primitive. 19 to 23px. |
| `i-filter` | line. Three horizontal round-capped strokes (y 7.2 / 12 / 16.8) stepping shorter toward the bottom, each carrying one small solid knob circle (r 1.7) at a staggered x — the "sliders" reading, friendlier than a funnel. Consumers: schedule filter toggle. 23px. |
| `i-gear` | duo. Eight-lobe rounded gear silhouette (lobes are soft bumps, never teeth) with duo fill + outline; center hole a 1.8-stroked circle r 2.3. Consumers: Settings page, More row. 19 to 25px. |
| `i-x` | line. Two crossing round-capped strokes from (6.6, 6.6) to (17.4, 17.4) and mirror. Consumers: sheet dismiss, toast dismiss, lightbox close, clear chips. 16 to 24px. |
| `i-x-circle` | duo. Circle r 8.2 (clock geometry) duo fill + outline; inner x drawn at stroke 1.8, arms about 3.2 units. Consumers: input clear affordances (SearchInput clear-button glyph), remove-attachment tiles. 16 to 19px. |
| `i-info` | duo. Circle r 8.4 (help geometry twin); solid dot (r 1.1) at (12, 8.2), stem stroke from (12, 11.2) to (12, 16). Deliberately the inverse layout of `i-help`. Consumers: thread info disclosure, hint rows. 16 to 19px. |
| `i-diamond` | solid. Rounded-corner diamond (square rotated 45 degrees, rx about 2) centered, about 11 units across. The milestone marker (replaces the diamond text character in schedule rows). 12 to 13px. |

### 4.2 Actions (rows, docks, sheets, editors)

| Name | Brief |
|---|---|
| `i-pencil` | duo. Slanted pencil body (rounded rect about 4.5 wide) from upper-right to lower-left at 45 degrees, duo fill + outline; chisel tip as a join to a point at (5, 19); tiny baseline stroke under the tip. Consumers: Edit visit, edit checklist, edit appointment. 16 to 20px. |
| `i-trash` | duo. Rounded-shoulder can (body rect rx 2, tapering slightly) duo fill + outline; lid stroke across y 7 with a small handle arc above; two interior vertical strokes. Consumers: appointment delete, equipment remove, OOP delete, attachment remove. 16 to 20px. |
| `i-share` | duo. iOS idiom: rounded rect tray (rx 3, open top) duo fill + outline occupying the lower two-thirds; vertical stroke rising from center to y 4.6 with a round-capped upward arrowhead. Consumers: share/copy-link in documents, lightbox share. 19 to 23px. |
| `i-download` | duo. The tray of `i-share` (identical geometry, keeps the pair related); center stroke pointing DOWN into the tray with a downward arrowhead. Consumers: open signed PDF, save report. 19px. |
| `i-copy` | duo. Two rounded rects (rx 2.4) offset diagonally; the back one outline-only at reduced presence (its fill layer omitted), the front one full duo fill + outline. Consumers: copy link (e-sign rows). 16 to 19px. |
| `i-external` | line. Rounded-rect three-quarter frame (rx 2.4, gap at top-right) at stroke 1.8; from the gap, a diagonal round-capped stroke to (19.5, 4.5) with arrowhead. Consumers: open in Maps, open external doc. 16px. |
| `i-send` | duo. Paper plane: soft-cornered triangle nose pointing upper-right, duo fill + outline; one interior fold stroke from tail to mid. Consumers: composer send button (replaces legacy IconSend). 20 to 23px. |
| `i-attach` | line. Paperclip: rounded elongated U doubling back inside itself, single continuous 1.8 stroke, round caps, tilted about 30 degrees. Consumers: composer tools, feedback attachments. 19 to 20px. |
| `i-navigate` | duo. Map-navigation arrow: plump kite/arrowhead pointing upper-right (notched tail), duo fill + outline, optically centered. Consumers: ActionBar and HubDock Navigate. 20 to 26px. |
| `i-refresh` | line. Two opposing 1.8 arcs forming a broken circle (r about 7.2), each ending in a small round-capped arrowhead; gaps at 10 and 4 o'clock. Consumers: retry buttons, PTR indicator, resend link. 16 to 20px. |
| `i-logout` | duo. Door frame: rounded rect (rx 2.4) with its right edge open, duo fill on the panel; arrow stroke exiting right through the opening with arrowhead at x about 20. Consumers: Sign Out (header menu). 19px. |
| `i-play` | solid. Rounded-corner triangle (rx feel about 1.5) pointing right, optically shifted about 0.8 right of center; about 11 units tall. The Resume counterpart of `i-pause`. Consumers: Resume button, video tiles. 19px. |
| `i-plus-circle` | duo. Circle r 8.2 duo fill + outline; interior plus at stroke 1.8, arms 3.6 units. Consumers: inline add-task row, add-reading, schedule-new-visit row (the FAB keeps bare `i-plus`). 19 to 20px. |
| `i-minus` | line. Single horizontal round-capped stroke, y 12, from x 5.4 to 18.6, stroke 2.2 (matches `i-plus` weight — they are a stepper pair). Consumers: OOP steppers, quantity fields. 16 to 19px. |
| `i-check-circle` | duo. Circle r 8.2 duo fill + outline; interior check at stroke 1.8 scaled from `i-check` (start about (8.2, 12.4)). Consumers: Mark all read, success rows, completion summary. 16 to 20px. |

### 4.3 Communication and sync state

| Name | Brief |
|---|---|
| `i-bell-off` | duo. The exact `i-bell` geometry plus one 1.8 round-capped slash from (5, 4.6) to (19, 19.4); the fill layer keeps duo opacity. Consumers: DND state in thread info, DND banner, muted rows. 16 to 19px. |
| `i-people` | duo. Front person = `i-person` geometry shifted left and down-scaled about 85 percent; behind-right, a second head circle and shoulder arc outline-only (no fill layer) peeking out. Consumers: group/broadcast conversation avatar, crew rows. 19 to 25px. |
| `i-cloud` | duo. Plump two-lobe cloud (flat bottom y about 16.4, rounded ends), duo fill + outline. Base glyph of the offline family — ships with the three variants below as separate symbols sharing this exact cloud path. 16 to 19px. |
| `i-cloud-sync` | `i-cloud` plus two small opposing refresh arcs (from `i-refresh`, scaled about 45 percent) centered in the cloud body. Consumer: OfflineStatusPill "Syncing N" (amber context). |
| `i-cloud-off` | `i-cloud` plus one 1.8 slash from (5, 4.6) to (19, 19.4). Consumer: OfflineStatusPill failed state (red context), offline banners. |
| `i-cloud-check` | `i-cloud` plus interior `i-check` scaled about 50 percent, stroke 1.8. Consumer: OfflineStatusPill "Synced" flash (green context). |
| `i-mail` | duo. Rounded envelope rect (rx 2.8, cal-family proportions) duo fill + outline; flap as a single stroke V from top corners meeting at (12, 12.6). Consumers: one-tap email in contacts, email-a-link in e-sign sheet. 16 to 19px. |
| `i-device` | duo. Upright smartphone rounded rect (rx 3, about 10.4 wide by 16.8 tall) duo fill + outline; short home-indicator stroke near the bottom inside. Consumers: push-devices list (settings), install banner. 19px. |

### 4.4 Security, signing, media

| Name | Brief |
|---|---|
| `i-lock` | duo. Rounded-square body (rx 2.8) from y 10.6 down, duo fill + outline; shackle a 1.8 stroke arc entering the body top; solid keyhole dot r 1.4 at body center. Consumers: private-visit badge, admin-only rows. 13 to 16px (must survive 13). |
| `i-signature` | duo. Pen nib: soft teardrop-pointed nib (duo fill + outline) angled toward lower-left with a split stroke down its middle; beneath it a wavy round-capped baseline stroke from x 5 to 19. Consumers: work-auth pill, Request signature, e-sign hub. 16 to 20px. |
| `i-video` | duo. Camcorder: rounded rect body (rx 2.8, left two-thirds) duo fill + outline; right-facing rounded lens wedge joined at mid-height. Consumers: feedback video attachment, media tiles. 19px. |
| `i-key` | duo. Round bow (circle r 3.4, duo fill + outline, upper-left) with a straight round-capped shaft to lower-right ending in two short downward teeth strokes. Consumers: tenant contact-type card (replaces emoji). 19 to 25px. |
| `i-briefcase` | duo. Case body rounded rect (rx 2.8) duo fill + outline; handle a small stroke arc on top; one horizontal seam stroke at mid-body. Consumers: adjuster contact-type card (replaces emoji). 19 to 25px. |

### 4.5 Domain and tools (More menu, feedback, settings, equipment, divisions)

| Name | Brief |
|---|---|
| `i-checklist` | duo. The `i-note` rounded card geometry; interior = two rows, each a small 2-stroke check plus a text stroke, third row an empty circle outline plus text stroke. Consumers: Tasks row in More, checklists row. 19 to 25px. |
| `i-clipboard` | duo. Board rounded rect (rx 2.8) duo fill + outline; top clip a small rounded tab rect overlapping the top edge; two interior text strokes. Consumers: Scope Sheet entry points, forms. 19 to 25px. |
| `i-dollar` | duo. Circle r 8.2 duo fill + outline; interior S-spine dollar drawn as a 1.8 stroke S-curve with a vertical stroke through it (glyph height about 9 units). Consumers: Collections rows, price/margin readouts. 19px. |
| `i-calc` | duo. Upright rounded rect (rx 2.8, about 12 wide by 16 tall) duo fill + outline; top quarter a display stroke line; below, a 2 by 2 grid of solid dots r 1.1. Consumers: OOP Pricing entry points. 19 to 25px. |
| `i-hammer` | duo. Head: rounded-rect mallet head angled 45 degrees upper-left, duo fill + outline; handle: single thick round-capped stroke to lower-right. Consumers: reconstruction division/type (replaces emoji). 16 to 20px. |
| `i-eye` | duo. Almond eye outline (two arcs meeting at points softened by round joins), duo fill; iris circle 1.8 stroke r 2.6, solid pupil r 1.2. Consumers: inspection type (replaces emoji), visibility toggles. 16 to 19px. |
| `i-pulse` | line. Horizontal baseline at y 12 interrupted by one sharp heartbeat excursion (up to y 6.2, down to y 17.8, back), single continuous 2 stroke, round caps/joins. Consumers: monitoring type (replaces emoji), reading trends. 16 to 19px. |
| `i-fan` | duo. Circle housing r 8.2 duo fill + outline; inside, three soft teardrop blades radiating from a solid hub dot r 1.7. Consumers: air scrubber in EquipmentPlacementSheet grid. 19 to 20px. |
| `i-door` | duo. Door leaf: upright rounded rect (rx 2.4) duo fill + outline, hinged left; solid knob dot r 1.2 at right edge mid-height; a 1.8 floor stroke under it. Consumers: AddRoomSheet, RoomCard fallback, room chips. 16 to 19px. |
| `i-bug` | duo. Plump rounded beetle body (vertical ellipse, duo fill + outline) with a center seam stroke; two short antenna strokes up, three short leg strokes per side, all round-capped. Consumers: Feedback "Bug Report" card. 19 to 25px. |
| `i-bulb` | duo. Bulb dome (circle r 5.6, duo fill + outline) necking into a small base of two horizontal strokes; three short round-capped rays above. Consumers: Feedback "Improvement" card. 19 to 25px. |
| `i-globe` | duo. Circle r 8.2 duo fill + outline; one vertical ellipse meridian and one horizontal equator stroke, both 1.8. Consumers: Language section (settings). 19px. |
| `i-sun` | duo. Core circle r 3.8 duo fill + outline; eight short round-capped rays at 45-degree steps, length about 2.4, gap 1.6 from the core. Consumers: Appearance light option. 19px. |
| `i-moon` | duo. Crescent (circle r 8 minus an offset circle bite from upper-right), duo fill + outline, opening toward upper-right. Consumers: Appearance dark option. 19px. |
| `i-trend-up` | line. Vertical mirror of the shipped `i-trend` (path climbs left-to-right, arrow at top-right, stroke 2). Consumers: rising-reading warnings, admin stats. 14 to 16px. |

**Deliberately NOT drawn (no census consumer):** star/favorite, microphone, printer, wifi
(status-bar chrome only), generic "grid/list view" toggles. Add them only when a real surface
lands, through this spec.

**Covered by rotation, not new drawings:** chevron-down/up for collapsible panels = `i-chev`
rotated 90/-90 degrees via CSS transform on the consuming element (sanctioned); "jump to latest"
down-arrow = `i-chev` rotated 90 degrees inside its pill.

Gap total: **50 new symbol ids** (7 + 15 + 8 + 5 + 15 rows above), of which **47 are original
drawings** and 3 (`i-cloud-sync`/`-off`/`-check`) are compositions layered on the `i-cloud` base
path.

---

## 5. Consumption contract

### 5.1 The component (replaces `src/components/Icons.jsx` pattern)

One new module (working name `src/components/tech/icons.jsx`) with **named per-icon exports** —
the survey:architecture contract (named exports, 24 viewBox, `currentColor`, props-spread) is
honored, extended with explicit `size`/`strokeWidth` props:

```jsx
// The factory every icon is built from (module-internal):
function makeIcon(name, paths, { micro = false } = {}) {
  function Icon({ size = 24, strokeWidth, ...props }) {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size}
           aria-hidden={props['aria-label'] ? undefined : true} {...props}>
        {paths(strokeWidth ?? (micro ? 2 : 1.8))}
      </svg>
    );
  }
  Icon.displayName = name;
  return Icon;
}

export const IconCamera = makeIcon('IconCamera', ...);   // duo icon
export const IconCheck  = makeIcon('IconCheck', ..., { micro: true }); // line icon
```

Contract points (binding):

- **`size` prop** (number, default 24) sets `width`/`height` together. Callers pass the optical
  tier from rule 6: `size={13}` chips, `size={19}` rows, `size={25}` tabs. CSS-rule sizing
  (`.tech-nav-tab svg { width/height }`) remains legal — props still spread onto the root svg,
  and an explicitly passed `width`/`height` attribute wins over `size`.
- **`strokeWidth` prop** (default 1.8; micro-glyphs default 2) exists for the rare documented
  exception (the FAB plus at 2.2). Never used to compensate for rendering an icon below its
  size floor.
- **Color:** everything is `currentColor`. No `color` prop — set `color` on the container.
- **Duotone knob:** the fill layer is always `fill="currentColor" style={{opacity:'var(--duo,.16)'}}`.
  Emphasis states are CSS: a container sets `--duo` (tab bar active raises to `.9`; a muted
  context may lower to `.14`). Components never receive a `filled` prop — the legacy
  filled/outline duality is retired in favor of the `--duo` raise (one drawing per icon).
- **A11y:** `aria-hidden="true"` by default (decorative); suppressed automatically if the caller
  passes `aria-label`. Icon-only buttons keep using the `IconButton` primitive (required label).
- **Sprite parity:** the same artwork is also emitted as a `<symbol>` sprite (ids `i-*` exactly as
  in Sections 2 and 4) for non-React surfaces (static HTML mocks, email-free PDF surfaces). The
  React components and the sprite are generated from ONE source of path data — never hand-kept in
  two places.

### 5.2 Keyed domain API (replaces `DivisionIcons.jsx` and `techConstants.TYPE_CONFIG` emoji)

Keep the keyed-API seam, redraw the artwork, delete the inline hexes:

```jsx
<TypeIcon type="mitigation" size={19}/>   // keyed registry: mitigation=IconDrop,
                                          // reconstruction=IconHammer, inspection=IconEye,
                                          // monitoring=IconPulse, estimate=IconClipboard,
                                          // other=IconFolder
```

Colors do NOT live in the registry: the consumer's container carries the division/status token
class, and the icon inherits `currentColor`. `DIVISION_CONFIG`/`LOSS_CONFIG`/`TYPE_CONFIG` hex and
emoji maps are deleted; their color roles move to CSS tokens per the architecture survey's
KEEP/REPLACE ruling.

### 5.3 Tab bar

The nav registry keeps its `{ key, label, path, Icon, exact }` shape; `Icon` becomes the shared
component (`IconHouse`, `IconFolder`, `IconCal`, `IconChat`, `IconDotsH`) rendered at `size={25}`
with active state expressed purely in CSS (`.tab.active { --duo:.9; color:var(--ink) }`), exactly
as proven in the three screens of record. The six module-local `TechLayout.jsx` icon components
and their `filled` prop are deleted.

### 5.4 Replacement plan for the legacy sets (sequenced)

1. **Ship the new module + sprite** with the 29 core glyphs and the 50 gap symbols, plus a
   render-contract test (every export renders, honors `size`, carries default `aria-hidden`).
2. **Shell first:** TechLayout tab bar and header buttons (deletes the 6 local nav icons and the
   filled/outline duality), toast type glyphs (replaces the emoji defaults), OfflineStatusPill
   (cloud family), ErrorState/EmptyState default glyphs (`i-warn`/contextual, replacing the
   warning emoji and x characters).
3. **Per-surface sweeps riding the reskin waves:** the census counts 176 ad-hoc inline `<svg>`
   occurrences across 43 files under `src/pages/tech/` — each wave replaces its own screens'
   inline SVGs with named imports as it restyles them (never a big-bang codemod; the wave's
   reviewer checks no raw `<svg>` remains in touched files).
4. **Keyed registries:** swap `DivisionIcons.jsx` internals and `TYPE_CONFIG` per 5.2 (API
   signatures preserved so call sites do not churn).
5. **Legacy `src/components/Icons.jsx`** (16 exports, shared with desktop): tech surfaces stop
   importing it; the file itself stays untouched for desktop until the desktop reskin — the two
   sets must never mix on one screen.
6. **Emoji purge gate:** at each wave's close-out, grep the touched files for emoji codepoints and
   raw `<svg>`; both must be zero in redesigned surfaces.

---

Counts of record: **30 shipped symbol ids / 29 canonical glyphs** (after the `i-drop` merge) ·
**50 gap symbol ids (47 original drawings** plus 3 cloud-base compositions) · projected full set
**79 canonical glyphs**.
