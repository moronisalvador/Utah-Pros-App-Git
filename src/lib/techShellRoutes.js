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
 *   Internal:  @/components/tech/v2/nav (apptHref, customerHref, jobHref)
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

import { apptHref, customerHref, jobHref } from '@/components/tech/v2/nav';

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

  // The office customer page is a desk surface — a tile grid, tabs and modals.
  // Sending a field tech there ejects them from the shell on web and hits the
  // catch-all on native, so it maps to the field customer screen instead.
  const customer = pathname.match(/^\/customers\/([^/]+)$/);
  if (customer) return customerHref(customer[1]);

  // Through apptHref for the same reason jobs go through jobHref — one
  // constructor, no second opinion about where an appointment opens. An office
  // path carries no job id, so this necessarily returns the legacy URL; the
  // /tech/appointment guard (LegacyAppointmentRedirect) resolves the job and
  // finishes the trip for a Hub viewer.
  const appt = pathname.match(/^\/schedule\/appointment\/([^/]+)$/);
  if (appt) return apptHref(appt[1]);

  return null;
}

/**
 * The reverse: a field path back to its office equivalent.
 *
 * Needed because `notify.js` stored `/tech/appointment/<id>` directly for months —
 * at the time that was the ONLY appointment screen in the app, so there was no
 * office path to store. Those rows are still in `notifications`, and a stored field
 * path is otherwise untranslatable: a dispatcher on desktop clicking the bell got
 * dropped into the phone UI. Forward-fixing the writer does nothing for rows that
 * already exist, so the office shell translates on read instead of a data backfill.
 *
 * Only appointments map. A tech claim/job/conversation path is NOT reversed here:
 * those office screens are materially different pages rather than the same screen
 * in another shell, and silently retargeting them would be its own bug.
 *
 * @param {string} pathname a field path, e.g. "/tech/appointment/<uuid>"
 * @returns {string|null} the office equivalent, or null if there isn't one
 */
export function techToOfficePath(pathname = '') {
  if (!pathname || !isTechPath(pathname)) return null;

  const appt = pathname.match(/^\/tech\/appointment\/([^/]+)$/);
  if (appt) return `/schedule/appointment/${appt[1]}`;

  return null;
}

/**
 * Rewrite a stored notification link for the shell the reader is standing in.
 * Preserves query and hash — message links carry `?c=<conversationId>`, and losing
 * it would open the inbox on the wrong thread.
 *
 * Translates BOTH directions. Field-shell readers get the field screen, which is
 * what this function originally did. Office-shell readers now get the office
 * screen, which they previously did not: stored `/tech/appointment/<id>` links
 * sent a dispatcher on desktop into the phone UI.
 *
 * @param {string} link      the stored link, possibly with ?query#hash
 * @param {string} currentPathname where the user is standing right now
 */
export function linkForCurrentShell(link, currentPathname) {
  if (!link) return link;
  const [pathname, rest = ''] = [
    link.split(/[?#]/)[0],
    link.slice(link.split(/[?#]/)[0].length),
  ];
  const target = isTechPath(currentPathname)
    ? officeToTechPath(pathname)
    : techToOfficePath(pathname);
  return target ? `${target}${rest}` : link;
}
