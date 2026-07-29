---
paths: ["src/**", "index.html", "vite.config.js", "scripts/bundle-budget.json"]
---
# Performance Budget Standard

**Last verified:** 2026-07-27

Linked from `CLAUDE.md`. **The law for boot weight, images, queries, and fonts.** Baselines are the
2026-07 measured numbers; the point is to ratchet down, never up. Query hygiene is enforced by
`page-behavior-checker`. Reference scenario: a field-tech PWA cold-start over LTE.

> **These budgets are currently enforced by review, NOT by CI (verified 2026-07-27).** This intro
> used to claim "Enforced by the CI bundle-size guard (`.github/workflows/ci.yml`)". Three things
> are wrong with that: the `Bundle size report` step is `continue-on-error: true` and its own
> comment says "Non-blocking; ... Hard-fail ratchet is a follow-up"; it reads `dist/assets/*.js`
> while Vite emits to `dist/app-assets/`, so it gzips empty input and prints **20 bytes** instead
> of the real 852,798; and it never measures CSS at all. A budget nobody enforces is how the
> `index.css` figure below drifted ~157 KB before anyone noticed. Fix the glob and add a CSS line
> before restoring any "enforced by CI" claim here.

## 1. Bundle budgets (JS measured 2026-07-13 · `index.css` re-baselined 2026-07-27)

- **Entry-graph JS ≤ 232 KB gzip** — CI fails at +10% (255 KB). Record the top-5 chunk deltas from
  `npm run build` in every PR that changes app code.
- **Any single route chunk ≤ 175 KB raw.** A heavy new dep must be route-lazy (`React.lazy`), never in
  the entry graph.
- **`index.css` ≤ 595,000 bytes raw** — measured 2026-07-27 at **571,960 bytes / 12,583 lines**
  (built: 422,482 bytes, 62,391 gzip). The ceiling sits ~4% above current, the same headroom the
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
  the chunk that needs them (Public Sans → CRM). Non-default i18n locales (`pt`, `es`) are **lazy-loaded**,
  not eager in the i18n chunk (~34 KB gz today).
- App shells never statically import interaction-gated components (modals that open on click are lazy).

## 5. Re-render hygiene

- Context provider `value` objects are memoized (`useMemo`) so every consumer doesn't re-render on each
  provider render (`AuthContext` value is rebuilt every render today — W5 fixes).
- `React.memo`/`useMemo` only where a real, measured hot path exists — do not scatter them speculatively.
