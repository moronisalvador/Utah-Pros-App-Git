// Native geolocation wrapper for iOS (Capacitor).
// On web, callers should either skip the coord capture or fall back to browser
// navigator.geolocation — we expose getCurrentCoords() for both paths.

import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';

export function isNativeGeo() {
  return Capacitor.isNativePlatform();
}

// Returns { lat, lng, accuracy } or null on failure / denial.
// Never throws — the caller should treat null as "proceed without coords".
export async function getCurrentCoords(opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 8000;
  const highAccuracy = opts.highAccuracy ?? true;
  try {
    if (isNativeGeo()) {
      // Capacitor plugin: iOS prompts on first call if permission undetermined
      const perm = await Geolocation.checkPermissions();
      if (perm.location !== 'granted' && perm.location !== 'prompt-with-rationale') {
        const req = await Geolocation.requestPermissions();
        if (req.location !== 'granted') return null;
      }
      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: highAccuracy,
        timeout: timeoutMs,
        maximumAge: 10_000,
      });
      return {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      };
    }
    // Web fallback — browser Geolocation API
    if (typeof navigator !== 'undefined' && navigator.geolocation?.getCurrentPosition) {
      return await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), timeoutMs);
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            clearTimeout(timer);
            resolve({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
            });
          },
          () => { clearTimeout(timer); resolve(null); },
          { enableHighAccuracy: highAccuracy, timeout: timeoutMs, maximumAge: 10_000 },
        );
      });
    }
    return null;
  } catch (err) {
    console.warn('Geolocation failed:', err?.message || err);
    return null;
  }
}

// Haversine distance in meters between two {lat, lng} points.
// Both inputs must be numbers. Returns NaN if either point is missing.
export function distanceMeters(a, b) {
  if (!a || !b || a.lat == null || a.lng == null || b.lat == null || b.lng == null) return NaN;
  const R = 6371000; // Earth radius in meters
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
