/**
 * Unit + render smoke-tests for the UX-Quality F-S2 shared hooks.
 * Vitest runs in plain node (no jsdom): pure helpers are tested directly, and the
 * stateful hooks are exercised via renderToStaticMarkup probe components that read
 * their INITIAL return values (renderToStaticMarkup runs the render body but not
 * effects — enough to prove the initial contract).
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// useLookup / usePhotoUpload import the Supabase-backed auth+realtime client at
// module eval; this test exercises only pure helpers + the registry, so stub those
// seams (vi.mock is hoisted above the imports) to avoid needing live Supabase env vars.
vi.mock('@/lib/realtime', () => ({ getAuthHeader: async () => ({}) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ db: {}, employee: null }) }));

import { thumbUrl, publicUrl } from '@/hooks/usePhotoUpload';
import { LOOKUPS } from '@/hooks/useLookup';
import { useTwoClickConfirm } from '@/hooks/useTwoClickConfirm';
import { useResumeRefetch } from '@/hooks/useResumeRefetch';

const BASE = 'https://proj.supabase.co';

describe('usePhotoUpload URL helpers', () => {
  it('thumbUrl builds a render-image URL with width + quality', () => {
    const u = thumbUrl('job123/456-photo.jpg', { width: 300, quality: 55, baseUrl: BASE });
    expect(u).toContain('/storage/v1/render/image/public/job-files/job123/456-photo.jpg');
    expect(u).toContain('width=300');
    expect(u).toContain('quality=55');
  });
  it('thumbUrl strips a legacy job-files/ prefix so it is not doubled', () => {
    const u = thumbUrl('job-files/j/1-a.jpg', { baseUrl: BASE });
    expect(u).toContain('/public/job-files/j/1-a.jpg');
    expect(u).not.toContain('job-files/job-files');
  });
  it('publicUrl builds the full-resolution object URL', () => {
    expect(publicUrl('j/1-a.jpg', BASE)).toBe(`${BASE}/storage/v1/object/public/job-files/j/1-a.jpg`);
  });
  it('both return empty string for a missing path', () => {
    expect(thumbUrl('', { baseUrl: BASE })).toBe('');
    expect(publicUrl(null, BASE)).toBe('');
  });
});

describe('useLookup registry', () => {
  it('exposes the three canonical rosters with column-named selects (no select=*)', () => {
    expect(Object.keys(LOOKUPS).sort()).toEqual(['carriers', 'employees', 'job_phases']);
    for (const spec of Object.values(LOOKUPS)) {
      expect(spec.table).toBeTruthy();
      expect(spec.query).not.toContain('select=*');
    }
    expect(LOOKUPS.employees.query).toContain('is_active=eq.true');
  });
});

// Probe components: read a hook's initial return and print it into the markup.
function ConfirmProbe() {
  const { isArmed, armedKey } = useTwoClickConfirm();
  return <span data-armed={String(armedKey)} data-is-armed={String(isArmed('x'))} />;
}
function ResumeProbe() {
  useResumeRefetch({ onResume: () => {} });
  return <span>ok</span>;
}

describe('stateful hooks initial contract', () => {
  it('useTwoClickConfirm starts disarmed', () => {
    const out = renderToStaticMarkup(<ConfirmProbe />);
    expect(out).toContain('data-armed="null"');
    expect(out).toContain('data-is-armed="false"');
  });
  it('useResumeRefetch renders without throwing and returns nothing (side-effect hook)', () => {
    expect(renderToStaticMarkup(<ResumeProbe />)).toContain('ok');
  });
});
