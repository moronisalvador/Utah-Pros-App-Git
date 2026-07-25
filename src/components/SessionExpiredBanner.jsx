/**
 * ════════════════════════════════════════════════
 * FILE: SessionExpiredBanner.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Shows a red bar across the top of the screen when the app has been signed
 *   out behind your back — the login normally renews itself quietly in the
 *   background, and this appears only when that renewal genuinely failed.
 *   Without it, the app looked completely normal while every save silently
 *   failed. The bar explains what happened and gives you a button to sign in
 *   again.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (app-wide, always mounted)
 *   Rendered by:  src/contexts/AuthContext.jsx (inside AuthProvider, so ONE
 *                 instance covers the office, tech and CRM shells)
 *
 * DEPENDS ON:
 *   Packages:  react-router-dom
 *   Internal:  @/contexts/AuthContext (sessionExpired, logout)
 *   Data:      reads  → none
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Renders null unless `sessionExpired` is true, so it costs nothing on the
 *     normal path. AuthContext sets that flag ONLY after a refresh attempt has
 *     actually failed — a JWT that renews itself never reaches here.
 *   - Hidden on /login and /set-password: on those screens the page itself is
 *     already the message, and the bar would cover the form.
 *   - Inline styles on purpose — this mirrors the offline banner in Layout.jsx
 *     (the established pattern for a fixed app-wide status bar) and keeps the
 *     component out of index.css, which is carved into per-initiative reserved
 *     markers.
 *   - THEME-INDEPENDENT BY CONSTRUCTION, and it has to be. Dark mode re-tones
 *     the tinted `--danger-bg`/`--danger-border` tokens only under
 *     `[data-theme="dark"] .tech-layout` (index.css:4617). This banner mounts
 *     OUTSIDE every shell (see "Rendered by"), so it would never match that
 *     selector and a tinted background would stay light-pink over a dark tech
 *     app. It therefore paints a solid `--danger` bar with `--accent-text` on
 *     it — both are `:root`-level and deliberately NOT re-toned for dark, so
 *     the contrast holds in either theme. Same trick as the offline banner,
 *     which hardcodes a dark bar with light text for exactly this reason.
 *     Do not "improve" this to `--danger-bg`; that reintroduces the bug.
 *   - z-index 10002 deliberately outranks the offline banner (10001) and toasts
 *     (10000): a dead session is the most important thing on screen.
 * ════════════════════════════════════════════════
 */
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

// Screens where the banner would be noise (or would cover the form it points at).
const AUTH_PATHS = ['/login', '/set-password'];

export default function SessionExpiredBanner() {
  const { sessionExpired, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  if (!sessionExpired) return null;
  if (AUTH_PATHS.some((p) => location.pathname.startsWith(p))) return null;

  const signInAgain = async () => {
    // Clear the dead session first so the login screen starts from a clean slate
    // (logout() also drops the expired flag, which unmounts this banner).
    try { await logout(); } catch { /* already signed out — fall through to /login */ }
    navigate('/login', { replace: true });
  };

  return (
    <div
      role="alert"
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 10002,
        background: 'var(--danger)',
        color: 'var(--accent-text)',
        padding: 'calc(env(safe-area-inset-top, 0px) + 10px) 16px 10px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 12, flexWrap: 'wrap', textAlign: 'center',
        fontSize: 'var(--text-sm)', fontWeight: 600, letterSpacing: '0.01em',
      }}
    >
      <span>Your session expired — changes can't be saved until you sign in again</span>
      <button
        onClick={signInAgain}
        style={{
          // 44px, not the 48px field-action floor: this is a rare recovery
          // action, not a gloved-hand primary control (tech-mobile-ux.md).
          minHeight: 44, padding: '0 16px',
          border: 'none', borderRadius: 'var(--radius-md)',
          background: 'var(--accent-text)', color: 'var(--danger)',
          fontSize: 'var(--text-sm)', fontWeight: 700, cursor: 'pointer',
          touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent',
        }}
      >
        Sign in again
      </button>
    </div>
  );
}
