/**
 * ════════════════════════════════════════════════
 * FILE: AdminMobileRoute.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The doorman for every admin screen inside the field-tech app. If the person
 *   isn't an admin, or the "Admin Mobile" switch is off for them, it quietly
 *   sends them back to the tech home screen instead of showing the admin page.
 *   Only an admin with the switch on gets through.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (a route guard wrapper)
 *   Rendered by:  src/pages/tech/admin/AdminMobileRoutes.jsx (wraps the subrouter)
 *
 * DEPENDS ON:
 *   Packages:  react-router-dom (Navigate)
 *   Internal:  @/contexts/AuthContext (useAuth), ./adminMobileAccess
 *   Data:      reads → none (role + flag come from AuthContext) · writes → none
 *
 * NOTES / GOTCHAS:
 *   - The decision itself lives in the pure canAccessAdminMobile() so it can be
 *     unit-tested without rendering; this component only wires it to auth state.
 *   - Redirects to "/tech" (never "/") so a denied field-tech lands back in the
 *     PWA shell they belong to, not the office dashboard.
 * ════════════════════════════════════════════════
 */
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { canAccessAdminMobile, ADMIN_MOBILE_FLAG } from './adminMobileAccess';

export default function AdminMobileRoute({ children }) {
  const { employee, isFeatureEnabled } = useAuth();
  const allowed = canAccessAdminMobile({
    role: employee?.role,
    flagEnabled: isFeatureEnabled(ADMIN_MOBILE_FLAG),
  });
  if (!allowed) return <Navigate to="/tech" replace />;
  return children;
}
