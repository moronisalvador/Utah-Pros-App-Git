/**
 * ════════════════════════════════════════════════
 * FILE: FieldShellRoute.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Decides whether the signed-in person is allowed to see the phone ("field")
 *   app at all. Being signed in was previously enough, so anyone with an account
 *   — including an outside partner — could open any field screen by typing the
 *   address, tapping a notification, or following a link. If the account is not
 *   a field-app account, this shows a short, friendly explanation and a button
 *   back to the screen they actually use.
 *
 * WHERE IT LIVES:
 *   Route:        wraps every /tech/* route
 *   Rendered by:  src/App.jsx (inside ProtectedRoute, which handles signed-out)
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom, react-i18next
 *   Internal:  @/contexts/AuthContext, @/contexts/authBootstrap
 *              (canUseFieldShell + getAccountLandingPath), @/components/ui
 *   Data:      none — reads the already-loaded employee from context
 *
 * NOTES / GOTCHAS:
 *   - It shows a screen instead of redirecting ON PURPOSE. In the native build
 *     the catch-all route sends '*' to /tech, so a <Navigate to="/tech"> for a
 *     blocked account would bounce forever with no way out. A rendered screen
 *     with one explicit link is always escapable.
 *   - Authentication is NOT re-checked here; ProtectedRoute already did it. This
 *     only answers "is this the right shell for this role?".
 *   - This is a PRESENTATION gate. It does not authorize data — the server-side
 *     boundary is the RPC grant surface (audit finding DATA-01).
 * ════════════════════════════════════════════════
 */
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { canUseFieldShell, getAccountLandingPath } from '@/contexts/authBootstrap';
import { EmptyState } from '@/components/ui';

export default function FieldShellRoute({ children }) {
  const { employee } = useAuth();
  const { t } = useTranslation(['tech', 'common']);

  if (canUseFieldShell(employee?.role)) return children;

  const home = getAccountLandingPath(employee?.role);

  return (
    <div className="loading-page">
      <EmptyState
        icon="📱"
        title={t('fieldShell.blockedTitle')}
        sub={t('fieldShell.blockedSub')}
        action={(
          <Link className="btn btn-primary" to={home} replace>
            {t('fieldShell.blockedAction')}
          </Link>
        )}
      />
    </div>
  );
}
