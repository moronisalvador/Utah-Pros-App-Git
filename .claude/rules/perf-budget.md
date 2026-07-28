# Performance Budget Standard

**Last verified:** 2026-07-27

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

> **FIXED 2026-07-27 — and what it exposed.** The guard never enforced anything, for three
> separate reasons, and it is worth separating them because only one is recent:
>
> 1. **Wrong metric from day one** (added `20e12a8f`, 2026-07-13). It concatenated **all** chunks
>    and gzipped them — ~961,000 bytes across 185 files, most of it lazy routes — then compared
>    that to a **232 KB entry-graph** budget. Those are different quantities; the comparison could
>    never have been meaningful.
> 2. **It never measured CSS at all.** That is the actual reason the `index.css` figure below
>    drifted ~157 KB unseen — not the glob.
> 3. **The glob broke on 2026-07-27, hours before this fix.** Commit `03638752` moved Vite's
>    `assetsDir` to `app-assets` for the iOS cache un-poisoning, so `dist/assets/*.js` suddenly
>    matched nothing and the step printed **20 bytes**, the gzip header of empty input, with no
>    error. *(The warning recorded here earlier that day in `db09a6cd` implied this had been the
>    state all along; it had been true for hours. The step was equally useless before, for
>    reasons 1 and 2.)*
>
> Throughout all of it the step was `continue-on-error: true`, so even a correct number could not
> have gated a merge.
>
> Fixing it exposed a second drift the same day: **entry-graph JS measured 264,072 B gzip against
> a 261,325 B fail threshold** — over budget, silently, exactly like the CSS, and invisible for as
> long as reason 1 above stood. The replacement reads the true entry graph — the module script in
> `dist/index.html` plus its `modulepreload` closure — and sums each file gzipped **separately**,
> because that is how they travel; concatenating first understates transfer weight by ~9 KB.
>
> **Asked to resolve the JS overage on 2026-07-27, the owner chose to gate CSS and route-chunk
> first** rather than turn `dev` red for unrelated merges or re-baseline a real budget the way the
> CSS ceiling was re-baselined earlier that day — then to trim the entry graph and switch the JS
> gate on in a follow-up. **Both landed the same day.**
>
> **RESOLVED — the trim, 2026-07-27.** The `pt` and `es` locales were **statically imported** (19
> namespaces each), so every English-speaking phone downloaded ~78 KB raw of words nobody had
> chosen. §4 below had required them lazy-loaded all along; the code simply did not match the rule,
> and defect 1 above is why no measurement ever said so. Routing each language through a barrel
> module and importing it dynamically cut **13,078 B** off the entry graph
> (**264,029 → 250,951 B**) and emitted `pt` (9,858 B gzip) and `es` (9,956 B gzip) as separate
> chunks. `BLOCKING.entryJsGzip` is now `true`.
>
> **Still above target, and deliberately visible:** 250,951 B is 13,383 B over the 237,568 B
> budget, and 10,374 B below the fail line. The guard warns every run. Do not treat that gap as
> spendable — the next reduction should come from the entry chunk itself (100,783 B) or `realtime`
> (43,289 B).

## 1. Bundle budgets (all figures re-measured 2026-07-27 by the fixed CI guard)

- **Entry-graph JS ≤ 232 KB gzip = 237,568 bytes** — fail threshold +10% = **261,325 bytes**
  (**ENFORCED; blocks CI above the fail line**). ⚠️ **Over target, under the fail line:** measured
  2026-07-27 at **250,951 bytes** across 27 chunks — 13,383 B over budget, 10,374 B of headroom.
  The guard warns on every run; ratchet it down rather than spending the gap.
  **"Entry graph" means the module script in `dist/index.html` plus its `modulepreload` closure** —
  the cold-boot download. It is *not* every chunk in `dist/app-assets/` (that is ~968,000 bytes
  gzip across 187 files, most of it lazy routes, and comparing it to this budget is the mistake the
  old CI step made). Top-5 entry-chunk deltas are printed by `npm run report:bundle-size`; record
  them in every PR that changes app code. Today's heaviest: `index` 100,783 · `realtime` 43,289 ·
  `AuthContext` 35,866 · `i18n` 23,085 · `chunk-LFPYN7LY` 14,273 bytes gzip.
- **Any single route chunk ≤ 175 KB raw = 179,200 bytes** (enforced; blocks CI). A heavy new dep must
  be route-lazy (`React.lazy`), never in the entry graph. Largest today: `Schedule` at 163,349 bytes.
- **`index.css` ≤ 595,000 bytes raw** (enforced; blocks CI) — measured 2026-07-27 at
  **574,596 bytes / 12,623 lines** (built: 423,398 bytes, 62,503 gzip; re-measured later the same
  day by the CI-guard fix, which is why it is ~2.6 KB above the first figure recorded below).
  The ceiling sits ~4% above current, the same headroom the
  original 400 KB / 384 KB pair had. **Sizes are stated in bytes on purpose** — the old "400 KB"
  was ambiguous between KB and KiB, which is part of why nobody noticed the breach. **Long-term
  ratchet target: 400 KB (409,600 bytes), unchanged** — the direction of travel is still down; new
  CSS lives in a reserved marker, not scattered. **Re-derive, never quote:**

  ```bash
  wc -c src/index.css && wc -l src/index.css && gzip -c dist/app-assets/index-*.css | wc -c
  ```

  > **RE-BASELINED 2026-07-27 (owner-directed).** This bullet read "≤ 400 KB raw (today 384 KB /
  > 11,446 lines)" — a 2026-07-13 measurement that had drifted ~157 KB out of date, leaving the
  > stated budget and reality far enough apart that the rule could not catch a real regression.
  > Asked to resolve it on 2026-07-27, the owner chose re-baseline-to-measured over declaring an
  > open breach, keeping the 400 KB ratchet target as the goal rather than the gate. Recorded in
  > the `db-foundation-wave-ownership.md` §8 format so the loosened ceiling is attributable rather
  > than silent. **The owner's direction is also what authorized this edit**, which lands inside the
  > `.claude/**` writer lease that `upr-engineering-foundation-wave-ownership.md` §6 still marks
  > ACTIVE for `codex/mobile-readiness-current-origin-review`. The JS and font bullets around it
  > were **not** re-measured and keep their 2026-07-13 provenance.
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
