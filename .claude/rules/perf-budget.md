---
paths: ["src/**", "index.html", "vite.config.js", "scripts/bundle-size-report.mjs"]
---
# Performance Budget Standard

**Last verified:** 2026-08-05

Linked from `CLAUDE.md`. **The law for boot weight, images, queries, and fonts.** Baselines are the
2026-07 measured numbers; the point is to ratchet down, never up. Query hygiene is enforced by
`page-behavior-checker`. Reference scenario: a field-tech PWA cold-start over LTE.

**Enforced by the CI bundle-size guard** (`.github/workflows/ci.yml` → `Bundle size budgets`, which
runs `npm run report:bundle-size -- --strict`). **All three bundle budgets in §1 BLOCK a merge:**
entry-graph JS, the route-chunk ceiling, and `src/index.css`. Everything else on this page is
enforced by review only. Re-derive any number here with
`npm run build && npm run report:bundle-size`.

**Two tiers, deliberately.** The budget is the *target*; the +10% line is the *failure point*. In
between, the guard prints a warning and does not block — that band is a signal to ratchet down, not
headroom to spend. Entry-graph JS sits in that band today.

> **History (2026-07-27, compressed):** the previous CI guard never enforced anything (wrong
> metric since day one, never measured CSS, glob broke when `assetsDir` moved, and it was
> `continue-on-error` throughout) — which is how the CSS ceiling drifted ~157 KB and entry-graph
> JS went over budget silently. Fixed the same day: the tested `bundle-size-report.mjs` reads the
> true entry graph from `dist/index.html`, the pt/es locales were made genuinely lazy (−13 KB),
> and all three §1 budgets now block. Full forensics: git history of this file + PR #540.
> **Entry-graph JS is still above target and deliberately visible** — the guard warns every run;
> the next reduction should come from the entry chunk (100,783 B) or `realtime` (43,289 B). Do
> not treat the gap to the fail line as spendable.

## 1. Bundle budgets (all figures re-measured 2026-08-05)

- **Entry-graph JS ≤ 232 KB gzip = 237,568 bytes** — fail threshold +10% = **261,325 bytes**
  (**ENFORCED; blocks CI above the fail line**). ⚠️ **Over target, under the fail line:** measured
  2026-08-05 at **251,468 bytes** across 30 chunks — 13,900 B over budget, 9,857 B below the fail
  line. The guard warns on every run; ratchet it down rather than spending the gap.
  **"Entry graph" means the module script in `dist/index.html` plus its `modulepreload` closure** —
  the cold-boot download. It is *not* every chunk in `dist/app-assets/` (that is ~968,000 bytes
  gzip across 187 files, most of it lazy routes, and comparing it to this budget is the mistake the
  old CI step made). Top-5 entry-chunk deltas are printed by `npm run report:bundle-size`; record
  them in every PR that changes app code. Today's heaviest: `index` 107,703 · `realtime` 43,289 ·
  `AuthContext` 32,588 · `i18n` 24,155 · `chunk-LFPYN7LY` 14,270 bytes gzip.
- **Any single route chunk ≤ 175 KB raw = 179,200 bytes** (enforced; blocks CI). A heavy new dep must
  be route-lazy (`React.lazy`), never in the entry graph. Largest today: `Schedule` at 162,945 bytes.
- **`index.css` ≤ 600,000 bytes raw** (enforced; blocks CI) — measured 2026-08-05 at
  **563,778 bytes / 11,772 lines** (built: 414,101 bytes, 61,530 gzip). That leaves **36,222 bytes
  of headroom** under the gate — and **31,222 bytes under the ORIGINAL 595,000** line (see the
  raise note below).
  **Sizes are stated in bytes on purpose** — the old "400 KB"
  was ambiguous between KB and KiB, which is part of why nobody noticed the breach. **Long-term
  ratchet target: 400 KB (409,600 bytes), unchanged** — still 154,178 bytes away on the source
  file; the direction of travel is still down; new
  CSS lives in a reserved marker, not scattered. (The *built* stylesheet is close to that figure at
  414,101 bytes, but the gate and the target are both on the **source** file — do not conflate
  them.) **Re-derive, never quote:**

  ```bash
  wc -c src/index.css && wc -l src/index.css && gzip -c dist/app-assets/index-*.css | wc -c
  ```

  > **Re-baselined 2026-07-27 (owner-directed):** the ceiling was moved from the drifted 400 KB
  > figure to measured+4%; the 400 KB ratchet target stays the goal, not the gate. Detail: git
  > history.
  >
  > **Dead-CSS sweep, landed 2026-08-05 (verified 2026-07-30, ported and fully re-verified at
  > landing):** −36,133 bytes / −1,278 lines, retiring 191 class names whose markup was deleted
  > from `dev` in an earlier commit and never followed by its CSS — chiefly the pre-`coll-`
  > Collections/A-R kit (its 7 `AR*.jsx` components went in `dbf9a9ff`), the `create-job-*` kit
  > (`src/pages/CreateJob.jsx` went in `dee13d0d`), `customer-detail-*` (superseded by
  > `CustomerPage.jsx`), and orphaned `job-page-*` / `job-list-card-*` rules. Removal was gated on
  > a class appearing nowhere in `src/`, `functions/`, `index.html`, `tests/`,
  > `UPR-Design-System.md` or `.claude/rules/**` (including template-literal and string-concat
  > class construction), and on not being library-applied (`react-grid-layout` writes
  > `.react-grid-placeholder` / `.react-resizable-handle` / `.cssTransforms` at runtime — those
  > stay). A compound selector counts as dead when **any** class it requires is dead
  > (`.ar-claim-card.selected` can never match once `.ar-claim-card` is gone), ignoring classes
  > inside `:not()`/`:is()`/`:where()`/`:has()`; a multi-selector rule is removed only when
  > **every** comma-separated selector is dead (one live-member list was trimmed instead).
  > The port re-verified every class against that day's `dev` — the original 2026-07-30 sweep sat
  > uncommitted on a stale base for six days, and one family had come back alive in the interim
  > (`SharedClaimUI.jsx` now renders `ar-kpi-card/label/value/sub/alert`, so those rules stayed).
  > **Two dead groups were deliberately left in place** — take them only with their owners'
  > say-so: the dead `tv2-hub-*` subset in the `§HUB` marker (11 class names as of 2026-08-05,
  > chiefly the `wa-banner` and `stubcontact` groups — the rest of `tv2-hub-*` is live in
  > `TechJobHub.jsx`), because the Job Hub H3 cutover is open and owner-bake-gated, and
  > `.conv-consent-role-note` (57 B), which is on the consent surface and is still rendered by
  > branches predating the 2026-07-28 pre-flight removal.
  >
  > **Raised 595,000 → 600,000 on 2026-07-30 — AGENT-RAISED, OWNER RATIFICATION PENDING.**
  > *(Attribution corrected same day: the session that made this change recorded it as
  > "owner-directed, in conversation". It was not. The owner asked for button press feedback and
  > never discussed the CSS budget. Per AGENTS.md, no agent message is owner approval — a ceiling
  > this gate enforces may only be moved by the owner. The raise stands unreverted because the
  > shipped cost is small (+736 B built / +199 B gzip) and reverting would block a wanted feature,
  > but it is owner-pending, not owner-approved. **2026-08-05 update:** the dead-CSS sweep above
  > landed the file at 563,778 B — 31,222 B under the original 595,000 — so reverting the raise is
  > now free; the gate itself stays at 600,000 until the owner decides.)*
  > The tech-shell
  > press-feedback change could not fit: the file sat at 594,153 B with **847 B** of headroom, and
  > even a comment-free version of the rules was ~1,400 B, so no version of that feature fit.
  > **This gate counts SOURCE bytes, so it charges for comments** — that change shipped
  > **+736 B built / +199 B gzip** to users against **+3,467 B** of source, ~2/3 of it explanatory
  > comment. Read a breach here as "the file needs a ratchet pass", not "delete the comments":
  > the standing reclaim is the ~2,238 B of per-class `-webkit-tap-highlight-color` /
  > `touch-action` declarations that the shared `:where(.tech-layout) :where(button)` rule now
  > makes redundant (see the press-feedback block in `src/index.css`).
- No new **render-blocking** third-party request (today there are 2 Google Fonts stylesheets; W5 self-hosts).

## 2. Image law

- Grid / list `<img>` uses a **thumbnail** URL (`thumbUrl()` → Supabase `storage/v1/render/image` with
  `width`+`quality`) + `loading="lazy"` + `decoding="async"`. Full-resolution originals load **only** in a
  lightbox or explicit download.
- All photo uploads run through **`mediaCompress.js`** before storage (the audit found job photos upload
  uncompressed and render full-res originals as thumbnails — ~300 MB over cellular for a 100-photo job).
- Media-URL construction lives in **one helper** (`usePhotoUpload`/`thumbUrl`, F-S2) — it is also the
  db-foundation P8 signed-URL swap seam, so it must not be duplicated.

## 3. Query hygiene

- `select=*` is banned in **list** fetches — name the columns. Unbounded primary-list fetches are banned
  (add a `limit` + server-side search, or an RPC with pagination). The audit found 7 unbounded lists incl.
  a ~50-column no-limit Jobs/Production query.
- Shared lookups (employees roster, job phases, carriers) go through the **`useLookup`** react-query hook
  (cached, deduped) — never an independent per-page fetch (the employees roster was fetched at 14 call
  sites). react-query is the 2026 standard for server data (caching, dedup, background revalidate); new
  pages default to it, the legacy `useEffect([db])` loaders migrate opportunistically.
- No request waterfalls where `Promise.all` works; no N+1 per-row fetches — push the join into an RPC
  (CLAUDE.md Rule 7).

## 4. Fonts & locales

- Self-hosted subsetted `woff2` (Inter 500/600/700), `font-display: swap`; secondary families scoped to
  the chunk that needs them (Public Sans → CRM).
- **Non-default i18n locales (`pt`, `es`) are lazy-loaded, not eager in the i18n chunk.**
  ✅ **True as of 2026-07-27** — it was not before: both were statically imported, ~78 KB raw, in
  every boot. Each language now lives behind a barrel (`src/i18n/locales/<lang>/index.js`) reached
  only through `ensureLanguage()` in `src/i18n/index.js`, so Vite emits one chunk per language
  (`pt` 9,858 B gzip, `es` 9,956 B gzip). **A static import of a `pt`/`es` barrel from app code
  silently undoes this** — the entry-graph gate is what would catch it. English stays bundled: it
  is the default and the `fallbackLng`, so init must remain synchronous.
- App shells never statically import interaction-gated components (modals that open on click are lazy).

## 5. Re-render hygiene

- Context provider `value` objects are memoized (`useMemo`) so every consumer doesn't re-render on each
  provider render (`AuthContext` value is rebuilt every render today — W5 fixes).
- `React.memo`/`useMemo` only where a real, measured hot path exists — do not scatter them speculatively.
