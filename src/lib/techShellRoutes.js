/**
 * ════════════════════════════════════════════════
 * FILE: techShellRoutes.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Translates an office page address into the matching field (PWA) page address.
 *   Notifications store one absolute office path and have no idea who will open it
 *   or on what, so this is the single place that knows "the field version of this
 *   screen lives here".
 *
 *   Two callers use it, and they must never disagree:
 *     - src/App.jsx      — sends field techs to the field screen by role.
 *     - NotificationBell — keeps ANYONE already inside the field shell there, which
 *                          is what role alone cannot do. Admins and supervisors work
 *                          out of the field PWA too, and the bell is mounted in the
 *                          field dash header as well as the office nav. Without this,
 *                          an admin standing in the field app taps the bell and gets
 *                          thrown into the office inbox.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  @/components/tech/v2/nav (jobHref)
 *
 * NOTES / GOTCHAS:
 *   - Only DETAIL screens map. `/claims` and `/jobs` index routes deliberately do
 *     not: bouncing someone off a list they opened on purpose is its own bug.
 *   - Jobs resolve through jobHref() rather than a hardcoded `/tech/jobs/`, so the
 *     Job Hub cutover stays the one-constant flip the tech-v2 manifest requires.
 *   - Returns null when there is no field equivalent. Callers must treat null as
 *     "leave the path alone", never as an error.
 * ════════════════════════════════════════════════
 */

import { jobHref } from '@/components/tech/v2/nav';

/** True when this path is already a field-shell path. */
export function isTechPath(pathname = '') {
  return pathname === '/tech' || pathname.startsWith('/tech/');
}

/**
 * @param {string} pathname an office path, e.g. "/jobs/<uuid>"
 * @returns {string|null} the field equivalent, or null if there isn't one
 */
export function officeToTechPath(pathname = '') {
  if (!pathname || isTechPath(pathname)) return null;

  if (pathname === '/conversations') return '/tech/conversations';
  if (pathname === '/schedule') return '/tech/schedule';

  const job = pathname.match(/^\/jobs\/([^/]+)$/);
  if (job) return jobHref(job[1]);

  const claim = pathname.match(/^\/claims\/([^/]+)$/);
  if (claim) return `/tech/claims/${claim[1]}`;

  return null;
}

/**
 * Rewrite a stored notification link for someone already inside the field shell.
 * Preserves query and hash — message links carry `?c=<conversationId>`, and losing
 * it would open the inbox on the wrong thread.
 *
 * @param {string} link      the stored link, possibly with ?query#hash
 * @param {string} currentPathname where the user is standing right now
 */
export function linkForCurrentShell(link, currentPathname) {
  if (!link || !isTechPath(currentPathname)) return link;
  const [pathname, rest = ''] = [
    link.split(/[?#]/)[0],
    link.slice(link.split(/[?#]/)[0].length),
  ];
  const techPath = officeToTechPath(pathname);
  return techPath ? `${techPath}${rest}` : link;
}
