/**
 * MORE-BADGE-01 — the field shell must not poll a backgrounded phone.
 *
 * page-lifecycle.md §4: "Every setInterval has a cleanup return AND an
 * `if (document.hidden) return` guard." The "More" tab's task-count badge had the
 * cleanup and not the guard, so `get_assigned_tasks` kept firing every 60s on a
 * phone in a tech's pocket overnight — battery and RPC volume for a badge nobody
 * was looking at. §2 separately bans a hand-rolled visibilitychange listener in a
 * page or shell; TechLayout had one of those too, for toast expiry.
 *
 * Both now go through useResumeRefetch, so this guard checks two things: that the
 * shell delegates, and that the thing it delegates to actually carries the guard.
 * Delegation to an unguarded helper would satisfy the first half and none of the
 * intent.
 *
 * Source-contract assertions — vitest runs `node` in this lane with no jsdom, so
 * TechLayout cannot be rendered.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const layout = read('src/components/TechLayout.jsx');
const resumeHook = read('src/hooks/useResumeRefetch.js');

describe('MORE-BADGE-01 — the shell owns no unguarded timer', () => {
  it('has no setInterval of its own left', () => {
    // The badge poll was the last one. A new bare setInterval here is exactly the
    // defect this test exists to catch — route it through useResumeRefetch's
    // pollMs instead, which pauses while hidden.
    expect(layout).not.toContain('setInterval');
  });

  it('registers no hand-rolled visibility listener', () => {
    // page-lifecycle.md §2. The toast-expiry restore was the last one of these.
    expect(layout).not.toContain("addEventListener('visibilitychange'");
    expect(layout).not.toContain('addEventListener("visibilitychange"');
  });

  it('drives the badge refresh through the shared resume hook', () => {
    expect(layout).toContain('pollMs: TASK_BADGE_POLL_MS');
    expect(layout).toContain("import { useResumeRefetch } from '@/hooks/useResumeRefetch.js'");
  });

  it('still loads the badge once on mount, outside the hidden guard', () => {
    // The guard belongs on the REPEAT, not the cold load: a shell that first
    // mounts hidden (a backgrounded PWA restore) must still end up with a correct
    // badge rather than an empty one until the next visible tick.
    expect(layout).toContain('const count = await fetchTodayTaskCount(db, employeeId);');
  });

  it('keeps the poll silent — no toast, no loading flag', () => {
    // page-lifecycle.md §4: a background poll never toasts. The badge fetch's
    // catch swallows deliberately; if someone adds err()/ok() to it, a tech gets
    // an error toast every 60s for a network blip they cannot act on.
    const badge = layout.slice(layout.indexOf('async function fetchTodayTaskCount'));
    const block = badge.slice(0, badge.indexOf('const TABS'));
    expect(block).not.toMatch(/\berr\(|\bok\(|setLoading/);
  });
});

describe('MORE-BADGE-01 — the hook it delegates to really is guarded', () => {
  it('skips its poll while the document is hidden', () => {
    // Mirrors usePolledRpc.js:62, the pattern page-lifecycle.md §4 cites.
    expect(resumeHook).toContain('if (doc.hidden) return;');
  });

  it('clears its interval on teardown', () => {
    expect(resumeHook).toContain('if (intervalId) clearInterval(intervalId);');
  });
});
