# Handoff: Fix Google Maps address autofill (suggestions don't appear)

**Repo:** `moronisalvador/Utah-Pros-App-Git`
**Symptom:** In the field-tech app, typing a street address shows **no suggestion dropdown**. No
visible error — the field just behaves like a plain text input.
**Goal:** Make the Google Places suggestion dropdown appear again (type 3+ chars → list → pick →
city/state/zip auto-fill).

> Paste this whole file as the opening brief for the dedicated session. It is self-contained.

---

## 0. The two facts that make this easy to diagnose

1. **The component is identical on `main` and `dev`.** `src/components/AddressAutocomplete.jsx` is
   byte-for-byte the same on both branches. It uses the **Places API (New)** classes
   (`AutocompleteSuggestion.fetchAutocompleteSuggestions`, `AutocompleteSessionToken`,
   `placePrediction`, `place.toPlace()`, `place.fetchFields`).
2. **Only the *loader* differs between branches** (`src/lib/googleMaps.js` + `package.json`):

   | | `main` (production · utahpros.app) | `dev` (staging · dev.utahpros.app) |
   |---|---|---|
   | `@googlemaps/js-api-loader` | **`1.16.8`** (pinned) | **`2.0.2`** |
   | loader code | v1 class: `new Loader({ apiKey, version:'weekly', libraries:['places'] }).importLibrary('places')` | v2 functional: `setOptions({ key, v:'weekly' })` then `importLibrary('places')` |
   | API key env var | `VITE_GOOGLE_MAPS_API_KEY` | `VITE_GOOGLE_MAPS_API_KEY` (same key, same Google Cloud project) |

   The v2 migration on `dev` was done to fix a **crash** (`The Loader class is no longer available in
   this version` — v2 removed the `Loader` class the v1 code imported). `main` was instead pinned back
   to `1.16.8` to keep the v1 code working. So the crash is gone on both, but **suggestions** are the
   open question.

Because the component + API key are identical, **comparing production vs dev isolates the cause**:
- Works on **production**, broken on **dev** → it's the **v2 loader** (code). → Fix A.
- Broken on **both** → it's **Google Cloud / Cloudflare config** (key, API enablement, referrers,
  env var). → Fix B.

---

## 1. STEP 1 — Capture the real error (it's currently swallowed)

Two places hide the failure today, which is why you see "nothing":

- `src/lib/googleMaps.js` → `loadPlaces()` has `.catch((err) => { … console.warn('[googleMaps]
  Failed to load Places library:', …); return null; })`. If the library fails to load, the component
  never enables and renders a plain input.
- `src/components/AddressAutocomplete.jsx` → `fetchSuggestions()` ends with
  `catch (err) { setSuggestions([]); setOpen(false); }` — **a failed API call is silently eaten.**

**Do this:** open the field-tech app on the environment in question (real device or Chrome DevTools
device mode), open the **Console** and **Network** tabs, type ~5 characters of a street address, and
read the signals:

| What you see | Meaning | Go to |
|---|---|---|
| Console: `[googleMaps] VITE_GOOGLE_MAPS_API_KEY is not set …` | Env var missing in **this** environment's build | Fix B-1 |
| Console: `[googleMaps] Failed to load Places library: …` | The Maps JS bootstrap failed (loader bug, blocked script, or key/referrer rejected at load) | Fix A (if dev-only) or B-2/B-3 |
| **No** googleMaps warning, but **no dropdown** | Library loaded + component enabled, but the autocomplete **request** failed or returned empty | Fix B-2 (most likely "Places API (New)" / billing / quota) — confirm with the temp log below |

**Temp log to un-swallow the request error** — in `AddressAutocomplete.jsx`, change the catch in
`fetchSuggestions` to log, deploy/preview, reproduce, then read the console:

```js
} catch (err) {
  console.error('[AddressAutocomplete] fetchAutocompleteSuggestions failed:', err);
  setSuggestions([]);
  setOpen(false);
}
```

Also watch the **Network** tab for a request to `places.googleapis.com` (New API) — a **403 /
PERMISSION_DENIED** there = config (Fix B); **no request at all** = the library/`AutocompleteSuggestion`
isn't there (Fix A). Revert this temp log before shipping.

---

## 2. STEP 2 — Decide: code (Fix A) or config (Fix B)

Reproduce on **production** (utahpros.app, v1/1.16.8) AND **dev** (dev.utahpros.app, v2/2.0.2), same
account, same address:

- **Works on production, broken on dev** → **Fix A** (the v2 loader is the problem).
- **Broken on both** → **Fix B** (Google Cloud / Cloudflare config). The loader version is a red herring.

---

## 3. Fix A — the v2 loader (only if prod works but dev doesn't)

`dev`'s `src/lib/googleMaps.js` uses the v2 functional API. The known-good baseline is **what's on
`main` right now**: v1 loader pinned to `1.16.8`. Two options:

**A-1 (recommended, lowest-risk): bring `main`'s proven loader to `dev`.** On a branch off `dev`:
- `package.json`: set `"@googlemaps/js-api-loader": "1.16.8"` (exact, no caret).
- Replace `src/lib/googleMaps.js` with `main`'s version (`git checkout origin/main -- src/lib/googleMaps.js`).
- `npm install` (refresh `package-lock.json`), `npm run build`, push to `dev`, verify on dev.utahpros.app.
- This makes `dev` match `main` — one loader across both environments, no more v1/v2 drift.

**A-2 (only if you specifically want to stay on v2): debug the v2 bootstrap.** In `loadPlaces()`, after
`importLibrary('places')`, log the resolved object:
`importLibrary('places').then(p => { console.log('[gmaps] places lib keys:', Object.keys(p)); … })`.
Confirm `AutocompleteSuggestion`, `AutocompleteSessionToken`, `Place` are present. If `importLibrary`
rejects, the message tells you why (often the same config issues as Fix B). Given v1/1.16.8 already works
on `main`, A-1 is almost always the better use of time.

---

## 4. Fix B — Google Cloud + Cloudflare config (if broken on both)

There is an existing companion doc on `dev`, **`GOOGLE-INTEGRATIONS-HANDOFF.md`** — read its
"External config checklist." The autocomplete-relevant pieces:

**B-1. Cloudflare Pages env var (cheapest, check first).** `VITE_GOOGLE_MAPS_API_KEY` is **build-time**
(Vite inlines it). Cloudflare Pages keeps **separate Production and Preview** variable sets:
- Confirm `VITE_GOOGLE_MAPS_API_KEY` is set in **BOTH** Production (→ main) and Preview (→ dev +
  branch previews). A key present in Production but missing in Preview = "works on prod, dead on dev"
  with zero code involved.
- After adding/changing it you **must redeploy** that environment (build-time inlining).

**B-2. Enable "Places API (New)" in Google Cloud Console.** The component calls
`AutocompleteSuggestion.fetchAutocompleteSuggestions`, which is **Places API (New)** — a *different*
product from the legacy "Places API". In the project that owns the key, enable: **Maps JavaScript API**
*and* **Places API (New)**. Also confirm the project has an **active billing account** (the New Places
API returns permission/quota errors without one).

**B-3. API key restrictions.** On the key used for `VITE_GOOGLE_MAPS_API_KEY`:
- **Application restrictions → HTTP referrers** must include every host that serves the app:
  `https://utahpros.app/*`, `https://dev.utahpros.app/*`, the Pages preview wildcard
  `https://*.utah-pros-app-git.pages.dev/*`, and `http://localhost:5173/*` for local dev. A missing
  `dev`/preview referrer = rejected only on those hosts.
- **API restrictions** must allow **Maps JavaScript API** + **Places API (New)** (and Picker, if Drive
  uses the same key — see the companion doc).

---

## 5. STEP 3 — Verify the fix

On the fixed environment, in the field-tech New Job / New Customer / appointment address fields:
1. Type 3+ characters of a real street → dropdown of suggestions appears (debounced ~150ms).
2. Tap a suggestion → the street fills, and **city / state / zip auto-populate** (via
   `place.fetchFields(['addressComponents','formattedAddress'])` → `parseAddressComponents`).
3. Console is clean (no `[googleMaps] …` warnings, no `fetchAutocompleteSuggestions failed`).
4. Remove any temporary `console.error`/`console.log` you added, rebuild, and ship the normal way
   (branch → `dev` → verify → `dev → main` PR; never push `main` directly — CLAUDE.md Rule 5).

---

## 6. Key files & exact references

- `src/components/AddressAutocomplete.jsx` — the dropdown component (identical on main & dev).
  - `useEffect` (~line 37): `if (!hasPlacesKey()) return;` → silent disable when key missing.
  - `fetchSuggestions` (~line 75): the New-API call; **catch at ~line 109 swallows errors**.
  - `pickSuggestion` (~line 131): `toPlace()` + `fetchFields` → `onSelect(parsed)`.
- `src/lib/googleMaps.js` — the loader. **This is the file that differs between main (v1) and dev (v2).**
  - `loadPlaces()` `.catch` (~line 35) prints `[googleMaps] Failed to load Places library`.
  - `parseAddressComponents()` — unchanged; maps Google components → `{address,city,state,zip}`.
- `package.json` line ~26 — `@googlemaps/js-api-loader` version (main `1.16.8`, dev `2.0.2`).
- `GOOGLE-INTEGRATIONS-HANDOFF.md` (on `dev`) — full external-config checklist (Cloud APIs, OAuth,
  Cloudflare env-var table). The Maps note there: *"silently falls back to a plain input when the key
  is missing — which is why it looks absent."*
- `.env.example` line 13 — `VITE_GOOGLE_MAPS_API_KEY=` (documents the var name).

## 7. Most-likely-cause ranking (start at the top)

1. **`VITE_GOOGLE_MAPS_API_KEY` missing/blank in the Cloudflare *Preview* var set** (dev only) — or not
   redeployed after being added. (Fix B-1) — cheapest, check first.
2. **"Places API (New)" not enabled / billing inactive** on the Google Cloud project — breaks both
   environments. (Fix B-2)
3. **HTTP-referrer restriction** on the key missing `dev.utahpros.app` / the `*.pages.dev` preview host.
   (Fix B-3)
4. **v2 loader (`2.0.2`) regression on `dev`** — if and only if production works but dev doesn't.
   (Fix A — revert dev to main's v1/1.16.8 loader.)
