/**
 * ════════════════════════════════════════════════
 * FILE: ClaimBreadcrumb.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A small division-colored card that says "Part of claim CLM-…" and, when
 *   tapped, jumps up to the parent claim. It visually signals that this job
 *   lives inside a claim. Shows nothing when the job has no claim.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (part of /tech/job/:jobId)
 *   Rendered by:  src/pages/tech/v2/TechJobHub.jsx
 *
 * DEPENDS ON:
 *   Packages:  react-router-dom
 *   Internal:  @/pages/tech/techConstants (DIV_PILL_COLORS, DIV_BORDER_COLORS)
 *   Data:      none (claim + division arrive as props)
 * ════════════════════════════════════════════════
 */
import { useNavigate } from 'react-router-dom';
import { DIV_PILL_COLORS, DIV_BORDER_COLORS } from '@/pages/tech/techConstants';

export default function ClaimBreadcrumb({ claim, division }) {
  const navigate = useNavigate();
  if (!claim) return null;
  const pill = DIV_PILL_COLORS[division] || DIV_PILL_COLORS.water;
  const border = DIV_BORDER_COLORS?.[division] || '#3b82f6';

  return (
    <button
      type="button"
      onClick={() => navigate(`/tech/claims/${claim.id}`)}
      style={{
        width: 'calc(100% - 2 * var(--space-4))',
        margin: '12px var(--space-4) 0',
        padding: '12px 14px', minHeight: 56,
        background: pill.bg, borderRadius: 12,
        border: '1px solid var(--border-light)',
        borderLeft: `4px solid ${border}`,
        display: 'flex', alignItems: 'center', gap: 10,
        cursor: 'pointer', fontFamily: 'var(--font-sans)',
        WebkitTapHighlightColor: 'transparent', textAlign: 'left',
      }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={pill.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: pill.color, textTransform: 'uppercase', letterSpacing: '0.12em', lineHeight: 1.2 }}>
          Part of claim
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', marginTop: 2 }}>
          {claim.claim_number}
        </div>
      </div>
      <span style={{ fontSize: 12, color: pill.color, fontWeight: 600, whiteSpace: 'nowrap' }}>
        View →
      </span>
    </button>
  );
}
