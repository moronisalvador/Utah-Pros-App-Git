/**
 * ════════════════════════════════════════════════
 * FILE: DetailRow.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   One labeled line (e.g. "Phone: 801-555-…") inside a Claim or Job details
 *   panel. If there's no value it shows nothing. The value can be a tappable
 *   link (call / email), monospaced (for ID numbers), capitalized, or wrapped
 *   across multiple lines (for notes).
 *
 * WHERE IT LIVES:
 *   Route:        n/a (reusable row component)
 *   Rendered by:  TechJobDetail.jsx, TechClaimDetail.jsx
 *
 * DEPENDS ON:
 *   Packages:  none (React 19 automatic JSX runtime)
 *   Internal:  none
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - Props: label, value, href (tel:/mailto:), mono, capitalize, multiline.
 *   - Renders null when value is falsy — callers don't need to guard.
 * ════════════════════════════════════════════════
 */
export default function DetailRow({ label, value, href, mono, capitalize, multiline }) {
  if (!value) return null;
  const valueStyle = {
    fontSize: 14, color: 'var(--text-primary)', fontWeight: 500,
    fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
    textTransform: capitalize ? 'capitalize' : 'none',
    textAlign: 'right', flex: 1, minWidth: 0,
    whiteSpace: multiline ? 'pre-wrap' : 'nowrap',
    overflow: multiline ? 'visible' : 'hidden',
    textOverflow: multiline ? 'clip' : 'ellipsis',
    wordBreak: multiline ? 'break-word' : 'normal',
  };
  // ─── SECTION: Render ──────────────
  return (
    <div style={{
      display: 'flex', alignItems: multiline ? 'flex-start' : 'center',
      gap: 10, padding: '8px 0',
      borderBottom: '1px solid var(--border-light)',
      minHeight: 36,
    }}>
      <span style={{
        fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)',
        flexShrink: 0, minWidth: 100,
      }}>
        {label}
      </span>
      {href ? (
        <a href={href} style={{ ...valueStyle, color: 'var(--accent)', textDecoration: 'none' }}>{value}</a>
      ) : (
        <span style={valueStyle}>{value}</span>
      )}
    </div>
  );
}
