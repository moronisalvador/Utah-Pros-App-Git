/**
 * ════════════════════════════════════════════════
 * FILE: SkeletonBlock.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Renders a quiet, token-colored placeholder block for compact loading states
 *   shared by desktop, PWA, and native surfaces.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (shared UI primitive)
 *   Rendered by:  compact Main/shared loading compositions
 *
 * DEPENDS ON:
 *   Packages:  React (JSX)
 *   Internal:  root design tokens
 *   Data:      reads → none · writes → none
 *
 * NOTES / GOTCHAS:
 *   - The block is intentionally static, so reduced-motion behavior needs no override.
 *   - The parent owns the accessible loading status; this visual is aria-hidden.
 * ════════════════════════════════════════════════
 */
export default function SkeletonBlock({
  width = '100%',
  height = 'var(--space-3)',
  radius = 'var(--radius-sm)',
  style,
}) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'block',
        width,
        height,
        border: '1px solid var(--border-light)',
        borderRadius: radius,
        background: 'var(--bg-tertiary)',
        ...style,
      }}
    />
  );
}
