# Performance Budget Standard

Linked from `CLAUDE.md`. **The law for boot weight, images, queries, and fonts.** Baselines are the
2026-07 measured numbers; the point is to ratchet down, never up. Enforced by the CI bundle-size guard
(`.github/workflows/ci.yml`) + `page-behavior-checker` (query hygiene). Reference scenario: a field-tech
PWA cold-start over LTE.

## 1. Bundle budgets (measured 2026-07-13)

- **Entry-graph JS ≤ 232 KB gzip** — CI fails at +10% (255 KB). Record the top-5 chunk deltas from
  `npm run build` in every PR that changes app code.
- **Any single route chunk ≤ 175 KB raw.** A heavy new dep must be route-lazy (`React.lazy`), never in
  the entry graph.
- **`index.css` ≤ 400 KB raw** (today 384 KB / 11,446 lines) with ratchet-down intent — new CSS lives in
  a reserved marker, not scattered.
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
