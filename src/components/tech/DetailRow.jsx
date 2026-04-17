// One line inside a collapsed details panel (Claim / Job).
// Hides itself when value is empty. Supports optional tappable href
// (tel:, mailto:), mono formatting (for ID numbers), capitalize,
// and multiline (for notes).
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
