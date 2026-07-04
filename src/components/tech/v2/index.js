/**
 * ════════════════════════════════════════════════
 * FILE: index.js  (tech v2 primitives barrel)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   One import point for the shared v2 tech building blocks so screens can pull
 *   what they need from a single path. Foundation owns everything exported here;
 *   wave sessions import from it and do not edit these files.
 *
 * DEPENDS ON:
 *   Internal:  StatusChip, ApptListRow, TechV2Page, TechPane, skeletons, nav
 * ════════════════════════════════════════════════
 */
export { default as StatusChip } from './StatusChip.jsx';
export { default as ApptListRow } from './ApptListRow.jsx';
export { default as TechV2Page } from './TechV2Page.jsx';
export { default as TechPane } from './TechPane.jsx';
export { SkeletonBlock, SkeletonRow, SkeletonList } from './skeletons.jsx';
export { apptHref, jobHref, setHubNav, isHubNav } from './nav.js';
