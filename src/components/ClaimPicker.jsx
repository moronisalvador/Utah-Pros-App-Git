import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Combined typeahead / text input for the OOP Pricing Calculator.
 * - Typing a name shows a dropdown of matching existing claims
 * - Selecting a claim bubbles up (insured_name, address, claim row)
 * - Typing freely just updates `value` — no selection required (OOP quotes
 *   for new customers don't need a claim yet)
 *
 * Works on mobile (inline dropdown below the input, 48px min-tap rows)
 * and desktop (same layout, slightly tighter typography).
 */
export default function ClaimPicker({
  label,
  value,
  onChangeText,
  onSelectClaim,
  linkedClaim,
  onUnlink,
  placeholder = 'Type homeowner name or search claims…',
  compact = false,   // true → desktop (smaller padding)
}) {
  const { db } = useAuth();
  const [open, setOpen] = useState(false);
  const [allClaims, setAllClaims] = useState([]);
  const [loaded, setLoaded] = useState(false);

  // Lazy-load the full claim list once; only 20–200 rows so client-side filter is fine
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await db.rpc('get_claims_list', {});
        if (!cancelled) { setAllClaims(rows || []); setLoaded(true); }
      } catch {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [db]);

  const filtered = useMemo(() => {
    if (!value || value.length < 1) return [];
    const q = value.toLowerCase();
    const selectedId = linkedClaim?.id;
    return allClaims
      .filter(c => c.id !== selectedId && (
        (c.insured_name || '').toLowerCase().includes(q) ||
        (c.claim_number || '').toLowerCase().includes(q) ||
        (c.loss_city    || '').toLowerCase().includes(q) ||
        (c.loss_address || '').toLowerCase().includes(q)
      ))
      .slice(0, 6);
  }, [value, allClaims, linkedClaim]);

  const showDropdown = open && value && filtered.length > 0;
  const showNoMatch  = open && value && loaded && filtered.length === 0 && !linkedClaim;

  const inputPad = compact ? '10px 12px' : '0 14px';
  const inputFontSize = compact ? 14 : 16;  // 16px mobile → no iOS auto-zoom
  const inputMinHeight = compact ? 36 : 'var(--tech-min-tap)';

  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, position: 'relative' }}>
      <span style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)',
      }}>
        <span>{label}</span>
        {linkedClaim && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)',
            color: 'var(--accent)',
            padding: '2px 8px',
            borderRadius: 'var(--radius-full)',
            background: 'var(--accent-light)',
            border: '1px solid #bfdbfe',
          }}>
            {linkedClaim.claim_number || 'Linked'}
            <button
              type="button"
              onClick={e => { e.preventDefault(); e.stopPropagation(); onUnlink?.(); }}
              onMouseDown={e => e.preventDefault()}
              aria-label="Unlink claim"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: 0, display: 'flex', color: 'var(--accent)',
                WebkitTapHighlightColor: 'transparent',
              }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </span>
        )}
      </span>

      <input
        type="text"
        value={value}
        onChange={e => { onChangeText(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}   // delay so click-on-option wins
        placeholder={placeholder}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="words"
        style={{
          minHeight: inputMinHeight, padding: inputPad,
          fontSize: inputFontSize, fontFamily: 'var(--font-sans)',
          border: '1px solid var(--border-color)',
          borderRadius: compact ? 'var(--radius-md)' : 'var(--tech-radius-button)',
          background: 'var(--bg-primary)', color: 'var(--text-primary)',
          outline: 'none', boxSizing: 'border-box', width: '100%',
          WebkitAppearance: 'none',
        }}
      />

      {(showDropdown || showNoMatch) && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30,
          marginTop: 4, maxHeight: 320, overflowY: 'auto',
          background: 'var(--bg-primary)',
          border: '1px solid var(--border-color)',
          borderRadius: compact ? 'var(--radius-md)' : 'var(--tech-radius-button)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
        }}>
          {showNoMatch && (
            <div style={{
              padding: '12px 14px', fontSize: 13,
              color: 'var(--text-tertiary)',
            }}>
              No matching claims. Keep typing for a new customer.
            </div>
          )}
          {showDropdown && filtered.map((c, idx) => (
            <button
              key={c.id}
              type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={() => { onSelectClaim(c); setOpen(false); }}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '10px 14px', minHeight: 48,
                background: 'var(--bg-primary)', color: 'var(--text-primary)',
                border: 'none',
                borderBottom: idx < filtered.length - 1 ? '1px solid var(--border-light)' : 'none',
                cursor: 'pointer', fontFamily: 'var(--font-sans)',
                WebkitTapHighlightColor: 'transparent',
              }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
                {c.insured_name || '(no name)'}
              </div>
              <div style={{
                marginTop: 2, fontSize: 12, color: 'var(--text-tertiary)',
                display: 'flex', gap: 8, flexWrap: 'wrap',
              }}>
                {c.claim_number && (
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>
                    {c.claim_number}
                  </span>
                )}
                {(c.loss_address || c.loss_city) && (
                  <span>
                    {c.loss_address || ''}{c.loss_address && c.loss_city ? ', ' : ''}{c.loss_city || ''}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </label>
  );
}
