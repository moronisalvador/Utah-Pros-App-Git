import { setOptions, importLibrary } from '@googlemaps/js-api-loader';

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

let placesPromise = null;
let warned = false;
let configured = false;

export function hasPlacesKey() {
  return Boolean(API_KEY);
}

export function loadPlaces() {
  if (!API_KEY) {
    if (!warned) {
      warned = true;
      console.warn('[googleMaps] VITE_GOOGLE_MAPS_API_KEY is not set — address autocomplete will fall back to plain input.');
    }
    return Promise.resolve(null);
  }
  if (placesPromise) return placesPromise;

  // @googlemaps/js-api-loader v2 functional API: configure once with setOptions(),
  // then importLibrary() loads the Maps JS API on first call. (The old `new Loader()`
  // class was removed in v2 — calling it throws "Loader is no longer available".)
  if (!configured) {
    setOptions({ key: API_KEY, v: 'weekly' });
    configured = true;
  }

  placesPromise = importLibrary('places')
    .then((places) => ({
      AutocompleteSuggestion: places.AutocompleteSuggestion,
      AutocompleteSessionToken: places.AutocompleteSessionToken,
      Place: places.Place,
    }))
    .catch((err) => {
      placesPromise = null;
      console.warn('[googleMaps] Failed to load Places library:', err?.message || err);
      return null;
    });

  return placesPromise;
}

export function parseAddressComponents(components) {
  const out = { address: '', city: '', state: '', zip: '' };
  if (!Array.isArray(components)) return out;

  let streetNumber = '';
  let route = '';

  for (const c of components) {
    const types = c.types || [];
    if (types.includes('street_number')) streetNumber = c.shortText || c.longText || '';
    else if (types.includes('route')) route = c.longText || c.shortText || '';
    else if (types.includes('locality')) out.city = c.longText || c.shortText || '';
    else if (!out.city && types.includes('sublocality_level_1')) out.city = c.longText || c.shortText || '';
    else if (!out.city && types.includes('postal_town')) out.city = c.longText || c.shortText || '';
    else if (types.includes('administrative_area_level_1')) out.state = c.shortText || c.longText || '';
    else if (types.includes('postal_code')) out.zip = c.longText || c.shortText || '';
  }

  out.address = [streetNumber, route].filter(Boolean).join(' ').trim();
  return out;
}
