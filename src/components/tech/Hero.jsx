import { DIV_GRADIENTS } from '@/pages/tech/techConstants';
import { DIV_EMOJI } from '@/lib/claimUtils';
import { openMap } from '@/lib/techDateUtils';

// Division-gradient hero used by TechClaimDetail and TechJobDetail.
//
// Props:
//   division        — 'water' | 'fire' | 'mold' | ... (drives gradient + emoji)
//   topLabel        — mono label above title (claim number or job number)
//   title           — big insured name (24/700)
//   address         — tappable address (opens Maps)
//   statusText      — pill text (e.g. 'Open', 'Lead')
//   statusColors    — { color, bg?, border? } for pill text color on white bg
//   meta            — array of strings for the meta row (joined with ' · ')
//   onBack          — function
//   backLabel       — aria-label for back button
//   showMenu        — boolean (admin-only kebab visibility)
//   onMenu          — function
export default function Hero({
  division, topLabel, title, address, statusText, statusColors,
  meta = [], onBack, backLabel = 'Back', showMenu, onMenu,
}) {
  const gradient = DIV_GRADIENTS[division] || DIV_GRADIENTS.water;
  const emoji = DIV_EMOJI[division] || DIV_EMOJI.general;
  const pillColor = statusColors?.color || '#2563eb';

  return (
    <div className="tech-hero" style={{ background: gradient, color: '#fff' }}>
      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px var(--space-4)',
      }}>
        <button
          onClick={onBack}
          aria-label={backLabel}
          style={{
            background: 'none', border: 'none', color: '#fff',
            cursor: 'pointer', padding: '4px 8px', display: 'flex', alignItems: 'center',
            minWidth: 48, minHeight: 48, WebkitTapHighlightColor: 'transparent',
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {statusText && (
            <span style={{
              fontSize: 11, fontWeight: 700, padding: '4px 10px',
              borderRadius: 'var(--radius-full)',
              background: '#fff', color: pillColor,
              textTransform: 'capitalize', letterSpacing: '0.02em',
            }}>
              {statusText}
            </span>
          )}
          {showMenu && (
            <button
              onClick={onMenu}
              aria-label="More actions"
              style={{
                background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff',
                cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                minWidth: 36, minHeight: 36, borderRadius: 'var(--radius-full)',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: '4px var(--space-5) 22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 28, lineHeight: 1 }}>{emoji}</span>
          <span style={{
            fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-mono)',
            color: 'rgba(255,255,255,0.72)', letterSpacing: '0.02em',
          }}>
            {topLabel || '—'}
          </span>
        </div>

        <div style={{
          fontSize: 24, fontWeight: 700, color: '#fff',
          lineHeight: 1.2, marginBottom: 6,
        }}>
          {title || 'Unknown'}
        </div>

        {address && (
          <button
            onClick={() => openMap(address)}
            style={{
              background: 'none', border: 'none', padding: 0,
              color: 'rgba(255,255,255,0.88)', fontSize: 14, fontWeight: 500,
              textAlign: 'left', cursor: 'pointer', textDecoration: 'underline',
              textUnderlineOffset: 3, textDecorationColor: 'rgba(255,255,255,0.4)',
              fontFamily: 'var(--font-sans)', WebkitTapHighlightColor: 'transparent',
              minHeight: 24,
            }}
          >
            {address}
          </button>
        )}

        {meta.length > 0 && (
          <div style={{
            marginTop: 10, fontSize: 12, color: 'rgba(255,255,255,0.72)',
            display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center',
          }}>
            {meta.map((piece, i) => (
              <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {i > 0 && <span>·</span>}
                <span>{piece}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
