/**
 * Location capability contract.
 *
 * The capability itself was already built and shipped — @capacitor/geolocation is
 * in the SPM package, NSLocationWhenInUseUsageDescription is in Info.plist, and
 * AttentionStrip already uses it to timestamp clock-ins and raise the "you have
 * left the job site" nudge. What it did not have was a test.
 *
 * The property that matters is NEVER-THROWS. Both callers treat a null as "carry
 * on without coordinates": a tech in a basement with no GPS fix must still be able
 * to clock in. If this module ever throws, clock-in breaks in exactly the place
 * location is least likely to work.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const geo = vi.hoisted(() => ({
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  getCurrentPosition: vi.fn(),
}));
const cap = vi.hoisted(() => ({ isNativePlatform: vi.fn(() => true) }));

vi.mock('@capacitor/geolocation', () => ({ Geolocation: geo }));
vi.mock('@capacitor/core', () => ({ Capacitor: cap }));

const { getCurrentCoords, distanceMeters, isNativeGeo } = await import('./nativeGeolocation');

const position = (latitude, longitude, accuracy = 5) => ({ coords: { latitude, longitude, accuracy } });

beforeEach(() => {
  vi.clearAllMocks();
  cap.isNativePlatform.mockReturnValue(true);
});

describe('getCurrentCoords — native', () => {
  it('returns coordinates when permission is already granted', async () => {
    geo.checkPermissions.mockResolvedValue({ location: 'granted' });
    geo.getCurrentPosition.mockResolvedValue(position(40.7608, -111.891, 12));
    await expect(getCurrentCoords()).resolves.toEqual({ lat: 40.7608, lng: -111.891, accuracy: 12 });
    // Already granted — do not re-prompt a tech who has answered.
    expect(geo.requestPermissions).not.toHaveBeenCalled();
  });

  it('asks for permission when it has not been decided', async () => {
    geo.checkPermissions.mockResolvedValue({ location: 'prompt' });
    geo.requestPermissions.mockResolvedValue({ location: 'granted' });
    geo.getCurrentPosition.mockResolvedValue(position(1, 2));
    await expect(getCurrentCoords()).resolves.toMatchObject({ lat: 1, lng: 2 });
    expect(geo.requestPermissions).toHaveBeenCalled();
  });

  it('returns null — not an error — when the tech denies location', async () => {
    // The nudge and the clock-in coordinate are both additive. Denial must
    // degrade to "no coordinates", never to a failed clock-in.
    geo.checkPermissions.mockResolvedValue({ location: 'prompt' });
    geo.requestPermissions.mockResolvedValue({ location: 'denied' });
    await expect(getCurrentCoords()).resolves.toBeNull();
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
  });

  it('swallows a plugin failure and returns null', async () => {
    geo.checkPermissions.mockResolvedValue({ location: 'granted' });
    geo.getCurrentPosition.mockRejectedValue(new Error('kCLErrorDomain 0'));
    await expect(getCurrentCoords()).resolves.toBeNull();
  });

  it('swallows a permission-check failure too', async () => {
    geo.checkPermissions.mockRejectedValue(new Error('plugin not available'));
    await expect(getCurrentCoords()).resolves.toBeNull();
  });

  it('passes the caller timeout through', async () => {
    // AttentionStrip uses 4s on the clock-in path and 6s on the nudge: a tech
    // waiting on a GPS fix to clock in is the thing being avoided.
    geo.checkPermissions.mockResolvedValue({ location: 'granted' });
    geo.getCurrentPosition.mockResolvedValue(position(1, 2));
    await getCurrentCoords({ timeoutMs: 4000 });
    expect(geo.getCurrentPosition).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 4000, enableHighAccuracy: true }),
    );
  });
});

describe('getCurrentCoords — web', () => {
  it('never touches the Capacitor plugin off-native', async () => {
    cap.isNativePlatform.mockReturnValue(false);
    // navigator is a getter-only global in Node, so assigning it throws.
    vi.stubGlobal('navigator', {
      geolocation: { getCurrentPosition: (ok) => ok(position(10, 20, 3)) },
    });
    try {
      await expect(getCurrentCoords()).resolves.toEqual({ lat: 10, lng: 20, accuracy: 3 });
      expect(geo.getCurrentPosition).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns null when the browser refuses', async () => {
    cap.isNativePlatform.mockReturnValue(false);
    vi.stubGlobal('navigator', {
      geolocation: { getCurrentPosition: (_ok, fail) => fail(new Error('denied')) },
    });
    try {
      await expect(getCurrentCoords()).resolves.toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('isNativeGeo', () => {
  it('tracks the platform', () => {
    cap.isNativePlatform.mockReturnValue(true);
    expect(isNativeGeo()).toBe(true);
    cap.isNativePlatform.mockReturnValue(false);
    expect(isNativeGeo()).toBe(false);
  });
});

describe('distanceMeters', () => {
  it('is zero for the same point', () => {
    expect(distanceMeters({ lat: 40.76, lng: -111.89 }, { lat: 40.76, lng: -111.89 })).toBe(0);
  });

  it('measures a known Salt Lake distance', () => {
    // Temple Square to the Utah State Capitol, ~1.1 km.
    const meters = distanceMeters({ lat: 40.7708, lng: -111.8910 }, { lat: 40.7770, lng: -111.8880 });
    expect(meters).toBeGreaterThan(600);
    expect(meters).toBeLessThan(900);
  });

  it('is symmetric', () => {
    const a = { lat: 40.1, lng: -111.7 };
    const b = { lat: 40.3, lng: -111.9 };
    expect(distanceMeters(a, b)).toBeCloseTo(distanceMeters(b, a), 6);
  });

  it('returns NaN rather than 0 for a missing point', () => {
    // 0 would read as "the tech is standing on the job site" and suppress the
    // away-from-site nudge. NaN fails the isFinite check the caller already makes.
    expect(distanceMeters(null, { lat: 1, lng: 2 })).toBeNaN();
    expect(distanceMeters({ lat: 1, lng: 2 }, null)).toBeNaN();
    expect(distanceMeters({ lat: 1 }, { lat: 1, lng: 2 })).toBeNaN();
    expect(distanceMeters({ lat: 1, lng: null }, { lat: 1, lng: 2 })).toBeNaN();
  });
});
