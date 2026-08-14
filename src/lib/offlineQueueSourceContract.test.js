/**
 * ════════════════════════════════════════════════
 * FILE: offlineQueueSourceContract.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Keeps the initial production release at zero automatic offline command
 *   admission/replay. Every field mutation must stay explicitly online-only.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  offlineDb, syncRunner, field workflow sources
 *   Data:      reads → repository source files only
 * ════════════════════════════════════════════════
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { PRODUCTION_QUEUE_TYPES } from './offlineDb.js';

const SRC_ROOT = path.resolve(import.meta.dirname, '..');
const OFFLINE_DB_FILE = path.resolve(import.meta.dirname, 'offlineDb.js');
const SYNC_RUNNER_FILE = path.resolve(import.meta.dirname, 'syncRunner.js');
const OFFLINE_HOOK_FILE = path.resolve(
  import.meta.dirname,
  '../hooks/useOfflineQueue.js',
);

function productionSourceFiles(directory = SRC_ROOT) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionSourceFiles(target);
    if (!/\.(?:js|jsx)$/.test(entry.name)) return [];
    if (/\.(?:test|spec)\.(?:js|jsx)$/.test(entry.name)) return [];
    return [target];
  });
}

function relative(file) {
  return path.relative(SRC_ROOT, file).split(path.sep).join('/');
}

describe('offline queue production source contract', () => {
  it('admits no automatic command in the initial online-first release', () => {
    expect([...PRODUCTION_QUEUE_TYPES]).toEqual([]);
  });

  it('keeps a complete, reviewable census of production admission callsites', () => {
    const admissions = [];
    const pattern = /\b(?:enqueue|enqueueOfflineOperation)\s*\(\s*\{[\s\S]{0,500}?\btype\s*:\s*['"]([^'"]+)['"]/g;

    for (const file of productionSourceFiles()) {
      const source = fs.readFileSync(file, 'utf8');
      for (const match of source.matchAll(pattern)) {
        admissions.push(`${relative(file)}:${match[1]}`);
      }
    }

    expect(admissions.sort()).toEqual([]);
    expect(admissions.every((entry) => (
      PRODUCTION_QUEUE_TYPES.includes(entry.slice(entry.lastIndexOf(':') + 1))
    ))).toBe(true);

    const hookSource = fs.readFileSync(OFFLINE_HOOK_FILE, 'utf8');
    expect(hookSource).not.toMatch(/\benqueueItem\b/);
    expect(hookSource).not.toMatch(/\bretryQueueItem\b/);
  });

  it('has no automatic dispatcher path for any historical command type', () => {
    const source = fs.readFileSync(SYNC_RUNNER_FILE, 'utf8');

    expect(source).not.toMatch(/\bdispatchPhoto\b/);
    expect(source).not.toMatch(/\bdispatchEquipmentRemove\b/);
    expect(source).not.toMatch(/\bdispatchReading\b/);
    expect(source).not.toMatch(/\bdispatchEquipmentPlace\b/);
    expect(source).not.toMatch(/case\s+['"]reading\.insert['"]/);
    expect(source).not.toMatch(/case\s+['"]equipment\.place['"]/);
    expect(source).not.toMatch(/case\s+['"]photo\.upload['"]/);
    expect(source).not.toMatch(/case\s+['"]equipment\.remove['"]/);
  });

  it('has no production photo-blob persistence caller', () => {
    const callers = productionSourceFiles()
      .filter((file) => file !== OFFLINE_DB_FILE)
      .filter((file) => /\bsavePhotoBlob\b/.test(
        fs.readFileSync(file, 'utf8'),
      ))
      .map(relative);

    expect(callers).toEqual([]);
  });

  it('fails every field photo upload clearly before its first network write', () => {
    // The five album surfaces route through the shared usePhotoUpload hook
    // (compression + Storage + insert_job_document — perf-budget.md §2's one
    // upload helper), so the raw storage URL appears only in the three
    // snap-first quick-capture surfaces. The hook itself lives outside
    // pages/tech/ and is checked separately below.
    const rawUploaders = productionSourceFiles()
      .filter((file) => relative(file).startsWith('pages/tech/'))
      .filter((file) => fs.readFileSync(file, 'utf8').includes(
        'storage/v1/object/job-files',
      ));

    expect(rawUploaders.map(relative).sort()).toEqual([
      'pages/tech/TechAppointment.jsx',
      'pages/tech/v2/dash/PhotoCaptureButton.jsx',
      'pages/tech/v2/hub/HubDock.jsx',
    ]);
    for (const file of rawUploaders) {
      const source = fs.readFileSync(file, 'utf8');
      const offlineGuard = source.indexOf('navigator.onLine === false');
      const firstWrite = source.indexOf('storage/v1/object/job-files');
      expect(
        offlineGuard,
        `${relative(file)} is missing its explicit offline failure`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        offlineGuard,
        `${relative(file)} checks connectivity after starting persistence`,
      ).toBeLessThan(firstWrite);
      expect(firstWrite - offlineGuard).toBeLessThan(2_000);
      expect(source).toContain(
        'Photo uploads require an internet connection. Reconnect and try again.',
      );
    }

    // Hook-based uploaders: the offline refusal fires inside each page's
    // per-file uploadOne, before the shared hook (and therefore before any
    // network write) is invoked.
    const hookUploaders = [
      'pages/tech/TechClaimAlbum.jsx',
      'pages/tech/TechClaimDetail.jsx',
      'pages/tech/TechJobAlbum.jsx',
      'pages/tech/TechJobDetail.jsx',
      'pages/tech/TechRoomDetail.jsx',
    ];
    for (const rel of hookUploaders) {
      const source = fs.readFileSync(path.join(SRC_ROOT, rel), 'utf8');
      const offlineGuard = source.indexOf('navigator.onLine === false');
      const hookCall = source.indexOf('uploadPhotoShared(');
      expect(
        offlineGuard,
        `${rel} is missing its explicit offline failure`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        hookCall,
        `${rel} no longer routes through the shared usePhotoUpload hook`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        offlineGuard,
        `${rel} checks connectivity after starting persistence`,
      ).toBeLessThan(hookCall);
      expect(source).toContain(
        'Photo uploads require an internet connection. Reconnect and try again.',
      );
      // No page-level raw Storage POST may creep back in beside the hook.
      expect(
        source.includes('storage/v1/object/job-files'),
        `${rel} hand-rolls a Storage write beside the shared hook`,
      ).toBe(false);
    }
  });

  it('fails every field equipment removal before calling the RPC', () => {
    const removers = productionSourceFiles()
      .filter((file) => relative(file).startsWith('pages/tech/'))
      .filter((file) => fs.readFileSync(file, 'utf8').includes(
        "db.rpc('remove_equipment'",
      ));

    expect(removers.map(relative).sort()).toEqual([
      'pages/tech/TechAppointment.jsx',
      'pages/tech/v2/hub/HubTools.jsx',
    ]);
    for (const file of removers) {
      const source = fs.readFileSync(file, 'utf8');
      const firstWrite = source.indexOf("db.rpc('remove_equipment'");
      const offlineGuard = source.lastIndexOf(
        'navigator.onLine === false',
        firstWrite,
      );
      expect(
        offlineGuard,
        `${relative(file)} is missing its explicit offline failure`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        offlineGuard,
        `${relative(file)} checks connectivity after starting persistence`,
      ).toBeLessThan(firstWrite);
      expect(firstWrite - offlineGuard).toBeLessThan(1_500);
      expect(source).toContain(
        'Equipment removal requires an internet connection. Reconnect and try again.',
      );
    }
  });

  it('fails every field reading and placement before calling its RPC', () => {
    const fieldTools = [
      path.join(SRC_ROOT, 'pages/tech/TechAppointment.jsx'),
      path.join(SRC_ROOT, 'pages/tech/v2/hub/HubTools.jsx'),
    ];
    for (const file of fieldTools) {
      const source = fs.readFileSync(file, 'utf8');
      for (const [rpc, message] of [
        [
          "db.rpc('insert_reading'",
          'Moisture readings require an internet connection. Reconnect and try again.',
        ],
        [
          "db.rpc('place_equipment'",
          'Equipment placement requires an internet connection. Reconnect and try again.',
        ],
      ]) {
        const firstWrite = source.indexOf(rpc);
        const offlineGuard = source.lastIndexOf(
          'navigator.onLine === false',
          firstWrite,
        );
        expect(firstWrite).toBeGreaterThanOrEqual(0);
        expect(offlineGuard).toBeGreaterThanOrEqual(0);
        expect(firstWrite - offlineGuard).toBeLessThan(2_500);
        expect(source).toContain(message);
      }
    }
  });
});
