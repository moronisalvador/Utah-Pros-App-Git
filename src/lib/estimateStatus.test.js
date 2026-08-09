/**
 * ════════════════════════════════════════════════
 * FILE: estimateStatus.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves that an estimate is only ever called "Sent" once it has actually been
 *   emailed to the customer, and that the three screens showing estimate status all
 *   read that answer from one place instead of each deciding for themselves.
 *
 * DEPENDS ON:
 *   Packages:  node:fs, node:path, node:url, vitest
 *   Internal:  src/lib/estimateStatus.js + the three surfaces that consume it
 *   Data:      reads → repository source only · writes → none
 *
 * NOTES / GOTCHAS:
 *   - The `does not resurrect` cases are the regression guard: the pre-2026-08-07
 *     rule was `if (qbo_estimate_id) return 'sent'`, which mislabelled 46 of 57 live
 *     estimates. If anyone reintroduces it on any surface, the source-contract block
 *     at the bottom fails.
 * ════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ESTIMATE_FILTER_OPTIONS,
  ESTIMATE_STATUS_TIERS,
  estimateStatusKind,
  estimateStatusLabel,
  estimateStatusTier,
  matchesEstimateFilter,
} from './estimateStatus';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => readFileSync(path.join(repositoryRoot, relative), 'utf8');

// Shapes mirror real get_estimates() rows.
const draft = { qbo_estimate_id: null, qbo_emailed_at: null, converted_invoice_id: null };
const saved = { qbo_estimate_id: 'QBO-1', qbo_emailed_at: null, converted_invoice_id: null };
const sent = { qbo_estimate_id: 'QBO-1', qbo_emailed_at: '2026-08-01T10:00:00Z', converted_invoice_id: null };
const converted = { qbo_estimate_id: 'QBO-1', qbo_emailed_at: '2026-08-01T10:00:00Z', converted_invoice_id: 'INV-1' };

describe('estimateStatusTier — the lifecycle', () => {
  it('calls an estimate that is not in QuickBooks a draft', () => {
    expect(estimateStatusTier(draft)).toBe('draft');
  });

  it('calls an estimate in QuickBooks but never emailed SAVED, not sent', () => {
    expect(estimateStatusTier(saved)).toBe('saved');
  });

  it('calls an estimate SENT only once qbo_emailed_at is set', () => {
    expect(estimateStatusTier(sent)).toBe('sent');
  });

  it('calls a converted estimate converted, whatever else is true', () => {
    expect(estimateStatusTier(converted)).toBe('converted');
  });

  it('treats a missing/!null row as a draft rather than throwing', () => {
    expect(estimateStatusTier(undefined)).toBe('draft');
    expect(estimateStatusTier({})).toBe('draft');
  });
});

describe('estimateStatusKind — what the screen shows', () => {
  it('overlays a sync error on top of the saved/sent tiers', () => {
    expect(estimateStatusKind({ ...saved, qbo_sync_error: 'boom' })).toBe('error');
    expect(estimateStatusKind({ ...sent, qbo_sync_error: 'boom' })).toBe('error');
  });

  it('lets converted outrank a stale sync error', () => {
    expect(estimateStatusKind({ ...converted, qbo_sync_error: 'boom' })).toBe('converted');
  });

  it('agrees with the tier when there is no error', () => {
    for (const row of [draft, saved, sent, converted]) {
      expect(estimateStatusKind(row)).toBe(estimateStatusTier(row));
    }
  });

  it('labels every kind, and unknown kinds render empty rather than throwing', () => {
    expect(estimateStatusLabel(estimateStatusKind(saved))).toBe('Saved');
    expect(estimateStatusLabel(estimateStatusKind(sent))).toBe('Sent');
    expect(estimateStatusLabel('nonsense')).toBe('');
  });
});

describe('matchesEstimateFilter — the filter tabs', () => {
  it('separates saved from sent, so unsent estimates are findable', () => {
    expect(matchesEstimateFilter(saved, 'saved')).toBe(true);
    expect(matchesEstimateFilter(saved, 'sent')).toBe(false);
    expect(matchesEstimateFilter(sent, 'sent')).toBe(true);
    expect(matchesEstimateFilter(sent, 'saved')).toBe(false);
  });

  it('keeps a sync-errored estimate inside a tab instead of hiding it from all of them', () => {
    const errored = { ...saved, qbo_sync_error: 'boom' };
    expect(estimateStatusKind(errored)).toBe('error');
    expect(matchesEstimateFilter(errored, 'saved')).toBe(true);
  });

  it('lets All match everything', () => {
    for (const row of [draft, saved, sent, converted]) {
      expect(matchesEstimateFilter(row, 'all')).toBe(true);
    }
  });

  it('offers the tabs in lifecycle order, with a Saved tab between Drafts and Sent', () => {
    expect(ESTIMATE_FILTER_OPTIONS.map((o) => o.value))
      .toEqual(['all', 'draft', 'saved', 'sent', 'converted']);
    expect(ESTIMATE_FILTER_OPTIONS.map((o) => o.label))
      .toEqual(['All', 'Drafts', 'Saved', 'Sent', 'Converted']);
  });

  it('has a tab for every lifecycle tier — no tier is unreachable', () => {
    const tabs = new Set(ESTIMATE_FILTER_OPTIONS.map((o) => o.value));
    for (const tier of ESTIMATE_STATUS_TIERS) expect(tabs.has(tier), tier).toBe(true);
  });
});

// The point of this module is that there is exactly ONE definition. These assertions
// fail if a surface grows its own copy back — which is precisely how the bug spread to
// three screens in the first place (collFormat.js called itself a "mirror" of
// EstimatesList.estStatus, and inherited its defect).
describe('source contract — no surface re-derives the status', () => {
  // src/pages/Estimates.jsx was the THIRD surface until 2026-08-08, when it was
  // deleted: unrouted, absent from the web registry, imported by nothing. The two
  // that remain are the live ones — the office Collections estimates tab and the
  // admin-mobile formatter. Removing a name here is only safe because the file is
  // gone; a surface that still exists must stay listed.
  const SURFACES = [
    'src/components/collections/EstimatesList.jsx',
    'src/components/admin-mobile/collections/collFormat.js',
  ];

  it('has every estimate surface consume @/lib/estimateStatus', () => {
    for (const relative of SURFACES) {
      expect(read(relative), relative).toMatch(/@\/lib\/estimateStatus/);
    }
  });

  it('does not resurrect "has a QuickBooks id therefore sent" on any surface', () => {
    for (const relative of SURFACES) {
      const source = read(relative);
      expect(source, relative).not.toMatch(/qbo_estimate_id\s*\)?\s*return\s*\{?\s*label:\s*'Sent'/);
      expect(source, relative).not.toMatch(/if\s*\(r\??\.qbo_estimate_id\)\s*return\s*'sent'/);
    }
  });

  it('keeps qbo_emailed_at the only source of "Sent"', () => {
    const source = read('src/lib/estimateStatus.js');
    expect(source).toMatch(/qbo_emailed_at\s*\?\s*'sent'\s*:\s*'saved'/);
  });
});
