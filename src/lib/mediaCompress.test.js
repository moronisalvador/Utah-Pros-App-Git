/**
 * ════════════════════════════════════════════════
 * FILE: mediaCompress.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks every pure helper in mediaCompress.js — the sizing math never
 *   enlarges a photo, filenames can't smuggle in slashes or weird characters,
 *   storage paths come out in the right shape, the file-count/size/duration
 *   limits reject exactly what they should, and legacy bucket prefixes get
 *   stripped correctly.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/mediaCompress.js
 *   Data:      reads  → none · writes → none (pure unit tests, no network)
 *
 * NOTES / GOTCHAS:
 *   - Deliberately does NOT test compressImage/probeVideo — those live below
 *     the Browser-only SECTION marker and need canvas/<video> DOM APIs.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import {
  MAX_FILES, MAX_VIDEOS, MAX_VIDEO_SECONDS, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES,
  isImage, isVideo, fitWithin, sanitizeFilename, buildStoragePath,
  stripBucketPrefix, validateFile, validateSelection, checkVideoDuration,
  formatBytes, formatDuration,
} from './mediaCompress.js';

const img = (name, size = 1000) => ({ name, type: 'image/jpeg', size });
const vid = (name, size = 1000) => ({ name, type: 'video/mp4', size });

describe('caps', () => {
  it('exports the agreed limits', () => {
    expect(MAX_FILES).toBe(5);
    expect(MAX_VIDEOS).toBe(1);
    expect(MAX_VIDEO_SECONDS).toBe(90);
    expect(MAX_IMAGE_BYTES).toBe(25 * 1024 * 1024);
    expect(MAX_VIDEO_BYTES).toBe(50 * 1024 * 1024);
  });
});

describe('isImage / isVideo', () => {
  it('classifies by MIME prefix', () => {
    expect(isImage('image/jpeg')).toBe(true);
    expect(isImage('image/heic')).toBe(true);
    expect(isImage('video/mp4')).toBe(false);
    expect(isVideo('video/quicktime')).toBe(true);
    expect(isVideo('image/png')).toBe(false);
  });
  it('tolerates junk input', () => {
    expect(isImage(null)).toBe(false);
    expect(isImage(undefined)).toBe(false);
    expect(isVideo(42)).toBe(false);
    expect(isVideo('')).toBe(false);
  });
});

describe('fitWithin', () => {
  it('never upscales — smaller images come back unchanged', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1920, 1080)).toEqual({ width: 1920, height: 1080 });
  });
  it('downscales the long edge to the cap, preserving aspect ratio', () => {
    expect(fitWithin(3840, 2160)).toEqual({ width: 1920, height: 1080 });
    expect(fitWithin(2160, 3840)).toEqual({ width: 1080, height: 1920 }); // portrait
    expect(fitWithin(4000, 4000)).toEqual({ width: 1920, height: 1920 });
  });
  it('respects a custom maxEdge', () => {
    expect(fitWithin(1000, 500, 100)).toEqual({ width: 100, height: 50 });
  });
  it('rounds to whole pixels and never hits zero', () => {
    const out = fitWithin(10000, 3, 1920);
    expect(out.width).toBe(1920);
    expect(out.height).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(out.height)).toBe(true);
  });
  it('passes through invalid dimensions untouched', () => {
    expect(fitWithin(null, 500)).toEqual({ width: null, height: 500 });
    expect(fitWithin(0, 0)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(NaN, 100)).toEqual({ width: NaN, height: 100 });
  });
});

describe('sanitizeFilename', () => {
  it('keeps ordinary names', () => {
    expect(sanitizeFilename('photo.jpg')).toBe('photo.jpg');
    expect(sanitizeFilename('IMG_1234.HEIC')).toBe('IMG_1234.HEIC');
  });
  it('drops path segments (no traversal into storage)', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('C:\\Users\\me\\shot.png')).toBe('shot.png');
    expect(sanitizeFilename('a/b/c.jpg')).toBe('c.jpg');
  });
  it('collapses spaces and URL-hostile characters', () => {
    expect(sanitizeFilename('my cool photo (1).jpg')).toBe('my-cool-photo-1-.jpg');
    expect(sanitizeFilename('höla?&#.png')).toBe('h-la-.png');
  });
  it('never returns empty and strips leading/trailing dots', () => {
    expect(sanitizeFilename('')).toBe('file');
    expect(sanitizeFilename('???')).toBe('file');
    expect(sanitizeFilename('...hidden')).toBe('hidden');
  });
  it('caps length while keeping the extension', () => {
    const long = 'x'.repeat(200) + '.jpeg';
    const out = sanitizeFilename(long);
    expect(out.length).toBeLessThanOrEqual(80);
    expect(out.endsWith('.jpeg')).toBe(true);
  });
});

describe('buildStoragePath', () => {
  it('is bucket-less and shaped feedback/{employeeId}/{ts}-{name}', () => {
    const path = buildStoragePath('emp-1', 'shot.jpg', 1700000000000);
    expect(path).toBe('feedback/emp-1/1700000000000-shot.jpg');
    expect(path.startsWith('job-files/')).toBe(false);
  });
  it('sanitizes the filename inside the path', () => {
    expect(buildStoragePath('emp-1', '../evil.jpg', 5)).toBe('feedback/emp-1/5-evil.jpg');
  });
  it('defaults ts to now', () => {
    const before = Date.now();
    const path = buildStoragePath('emp-1', 'a.jpg');
    const ts = Number(path.split('/')[2].split('-')[0]);
    expect(ts).toBeGreaterThanOrEqual(before);
  });
});

describe('stripBucketPrefix', () => {
  it('strips a leading job-files/', () => {
    expect(stripBucketPrefix('job-files/feedback/e/1-a.jpg')).toBe('feedback/e/1-a.jpg');
  });
  it('leaves bucket-less paths alone', () => {
    expect(stripBucketPrefix('feedback/e/1-a.jpg')).toBe('feedback/e/1-a.jpg');
  });
  it('only strips at the start, and tolerates junk', () => {
    expect(stripBucketPrefix('feedback/job-files/x.jpg')).toBe('feedback/job-files/x.jpg');
    expect(stripBucketPrefix(null)).toBe('');
    expect(stripBucketPrefix('')).toBe('');
  });
});

describe('validateFile', () => {
  it('accepts images and videos inside their size caps', () => {
    expect(validateFile(img('a.jpg', MAX_IMAGE_BYTES)).ok).toBe(true);
    expect(validateFile(vid('a.mp4', MAX_VIDEO_BYTES)).ok).toBe(true);
  });
  it('rejects oversize files with a human reason', () => {
    const bigImg = validateFile(img('big.jpg', MAX_IMAGE_BYTES + 1));
    expect(bigImg.ok).toBe(false);
    expect(bigImg.reason).toContain('25 MB');
    const bigVid = validateFile(vid('big.mp4', MAX_VIDEO_BYTES + 1));
    expect(bigVid.ok).toBe(false);
    expect(bigVid.reason).toContain('50 MB');
  });
  it('rejects non-media types and missing files', () => {
    expect(validateFile({ name: 'a.pdf', type: 'application/pdf', size: 10 }).ok).toBe(false);
    expect(validateFile(null).ok).toBe(false);
  });
});

describe('validateSelection', () => {
  it('accepts a normal mixed pick', () => {
    const { accepted, rejected } = validateSelection([], [img('a.jpg'), img('b.jpg'), vid('c.mp4')]);
    expect(accepted.length).toBe(3);
    expect(rejected.length).toBe(0);
  });
  it('enforces the 5-file total including what is already attached', () => {
    const existing = [{ mime: 'image/jpeg' }, { mime: 'image/jpeg' }, { mime: 'image/jpeg' }, { mime: 'image/jpeg' }];
    const { accepted, rejected } = validateSelection(existing, [img('e.jpg'), img('f.jpg')]);
    expect(accepted.map(f => f.name)).toEqual(['e.jpg']);
    expect(rejected.length).toBe(1);
    expect(rejected[0].reason).toContain('Maximum 5');
  });
  it('enforces the 1-video cap across existing + incoming', () => {
    const one = validateSelection([{ mime: 'video/mp4' }], [vid('two.mp4')]);
    expect(one.accepted.length).toBe(0);
    expect(one.rejected[0].reason).toContain('1 video');

    const twoInPick = validateSelection([], [vid('a.mp4'), vid('b.mp4')]);
    expect(twoInPick.accepted.map(f => f.name)).toEqual(['a.mp4']);
    expect(twoInPick.rejected.length).toBe(1);
  });
  it('per-file failures reject that file but keep the rest', () => {
    const { accepted, rejected } = validateSelection([], [img('ok.jpg'), img('huge.jpg', MAX_IMAGE_BYTES + 1)]);
    expect(accepted.map(f => f.name)).toEqual(['ok.jpg']);
    expect(rejected[0].file.name).toBe('huge.jpg');
  });
  it('a rejected file does not consume a slot', () => {
    const existing = [{ mime: 'image/jpeg' }, { mime: 'image/jpeg' }, { mime: 'image/jpeg' }, { mime: 'image/jpeg' }];
    // First incoming is oversize (rejected on its own), second should still fit slot #5.
    const { accepted } = validateSelection(existing, [img('huge.jpg', MAX_IMAGE_BYTES + 1), img('ok.jpg')]);
    expect(accepted.map(f => f.name)).toEqual(['ok.jpg']);
  });
  it('honors caps overrides', () => {
    const { accepted, rejected } = validateSelection([], [img('a.jpg'), img('b.jpg')], { maxFiles: 1 });
    expect(accepted.length).toBe(1);
    expect(rejected.length).toBe(1);
  });
  it('tolerates null/empty inputs', () => {
    expect(validateSelection(null, null)).toEqual({ accepted: [], rejected: [] });
  });
});

describe('checkVideoDuration', () => {
  it('accepts durations up to 90s', () => {
    expect(checkVideoDuration(89.9).ok).toBe(true);
    expect(checkVideoDuration(90).ok).toBe(true);
  });
  it('rejects longer videos with the limit in the message', () => {
    const out = checkVideoDuration(90.1);
    expect(out.ok).toBe(false);
    expect(out.reason).toContain('90');
  });
  it('tolerates null/unknown durations (probe failed → do not block)', () => {
    expect(checkVideoDuration(null).ok).toBe(true);
    expect(checkVideoDuration(undefined).ok).toBe(true);
    expect(checkVideoDuration(NaN).ok).toBe(true);
    expect(checkVideoDuration(Infinity).ok).toBe(true); // live streams report Infinity
  });
  it('honors a custom max', () => {
    expect(checkVideoDuration(31, 30).ok).toBe(false);
    expect(checkVideoDuration(29, 30).ok).toBe(true);
  });
});

describe('formatBytes', () => {
  it('picks the right unit', () => {
    expect(formatBytes(302)).toBe('302 B');
    expect(formatBytes(812 * 1024)).toBe('812 KB');
    expect(formatBytes(10.4 * 1024 * 1024)).toBe('10.4 MB');
  });
  it('tolerates junk', () => {
    expect(formatBytes(null)).toBe('');
    expect(formatBytes(-5)).toBe('');
    expect(formatBytes(NaN)).toBe('');
  });
});

describe('formatDuration', () => {
  it('formats m:ss', () => {
    expect(formatDuration(92)).toBe('1:32');
    expect(formatDuration(5)).toBe('0:05');
    expect(formatDuration(600)).toBe('10:00');
  });
  it('null-safe like probeVideo output', () => {
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(undefined)).toBeNull();
    expect(formatDuration(Infinity)).toBeNull();
    expect(formatDuration(-1)).toBeNull();
  });
});
