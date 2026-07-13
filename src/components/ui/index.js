/**
 * ════════════════════════════════════════════════
 * FILE: components/ui/index.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   One import stop for the shared UI building blocks. Instead of importing each
 *   little piece from its own file, a page can pull what it needs from
 *   '@/components/ui'. These are the app-wide primitives every screen should use
 *   so the whole product looks and behaves as one system.
 *
 * Exports:
 *   Modal, IconButton, StatusPill (+ toneForStatus), EmptyState, ErrorState,
 *   PageHeader, SearchInput
 *
 * NOTES / GOTCHAS:
 *   - Owned by UX-Quality F-S2 (.claude/rules/ux-alignment-wave-ownership.md).
 *     Wave sessions IMPORT these; they do not edit them (a change is an F-S2 follow-up).
 * ════════════════════════════════════════════════
 */

export { default as Modal } from './Modal';
export { default as IconButton } from './IconButton';
export { default as StatusPill } from './StatusPill';
export { toneForStatus } from './statusTone';
export { default as EmptyState } from './EmptyState';
export { default as ErrorState } from './ErrorState';
export { default as PageHeader } from './PageHeader';
export { default as SearchInput } from './SearchInput';
