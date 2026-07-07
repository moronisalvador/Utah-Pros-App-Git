/**
 * ════════════════════════════════════════════════
 * FILE: TechMore.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The "More" screen in the field-tech app — a simple menu of extra tools and
 *   resources grouped under headings. Each row links to another screen (like
 *   Tasks or the pricing calculator); rows that aren't built yet show a "Soon"
 *   tag and don't tap through. The Tasks row shows a red badge with how many of
 *   today's tasks are still open.
 *
 * WHERE IT LIVES:
 *   Route:        /tech/more
 *   Rendered by:  src/App.jsx (inside the TechLayout shell)
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom, react-i18next
 *   Internal:  @/contexts/AuthContext
 *   Data:      All access goes through the db client from useAuth.
 *              reads  → appointment_crew, appointments, contacts, job_tasks,
 *                        jobs (get_assigned_tasks — only the today count is used)
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - The "OOP Pricing" row only appears when the "tool:oop_pricing" feature
 *     flag is on for the current user; the route itself is also flag-gated.
 *   - The task-count fetch fails silently — a hiccup there must never break the
 *     menu, the badge just stays at 0.
 *   - "Coming soon" rows render as a plain div (no Link) so they're not tappable.
 * ════════════════════════════════════════════════
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import {
  canAccessAdminMobile,
  ADMIN_MOBILE_FLAG,
  adminDashHref,
  adminCollectionsHref,
  adminEstimateEditorHref,
  adminLeadsHref,
  AmIcons,
} from '@/components/admin-mobile';

// ─── SECTION: Helpers ──────────────
/* ── Row icons ── */

function IconChecklist(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

function IconDollar(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

function IconClock(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 14" />
    </svg>
  );
}

function IconBook(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

function IconClipboard(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" />
    </svg>
  );
}

function IconDocument(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="14" y2="17" />
    </svg>
  );
}

function IconCalculator(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <line x1="8" y1="6" x2="16" y2="6" />
      <line x1="8" y1="10" x2="8" y2="10.01" />
      <line x1="12" y1="10" x2="12" y2="10.01" />
      <line x1="16" y1="10" x2="16" y2="10.01" />
      <line x1="8" y1="14" x2="8" y2="14.01" />
      <line x1="12" y1="14" x2="12" y2="14.01" />
      <line x1="16" y1="14" x2="16" y2="14.01" />
      <line x1="8" y1="18" x2="12" y2="18" />
      <line x1="16" y1="18" x2="16" y2="18.01" />
    </svg>
  );
}

function IconSettings(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function IconChevronRight(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

/* ── Row component ── */

function MoreRow({ item, isLast }) {
  const { t } = useTranslation('common');
  const rowStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '14px 16px',
    minHeight: 'var(--tech-row-height)',
    borderBottom: isLast ? 'none' : '1px solid var(--border-light)',
    textDecoration: 'none',
    color: 'var(--text-primary)',
    background: 'var(--bg-primary)',
    opacity: item.comingSoon ? 0.55 : 1,
    cursor: item.comingSoon ? 'default' : 'pointer',
    WebkitTapHighlightColor: 'transparent',
  };

  const iconWrap = (
    <div style={{
      width: 38, height: 38, borderRadius: 10,
      background: 'var(--accent-light)', color: 'var(--accent)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
    }}>
      <item.Icon width={20} height={20} />
    </div>
  );

  const label = (
    <div style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 500 }}>
      {item.label}
    </div>
  );

  const trailing = item.comingSoon ? (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: '3px 9px',
      borderRadius: 'var(--radius-full)',
      background: 'var(--bg-tertiary)', color: 'var(--text-tertiary)',
      border: '1px solid var(--border-light)',
      textTransform: 'uppercase', letterSpacing: '0.04em',
      flexShrink: 0,
    }}>{t('soon')}</span>
  ) : (
    <>
      {item.badge != null && item.badge > 0 && (
        <span style={{
          minWidth: 22, height: 22, padding: '0 7px',
          borderRadius: 'var(--radius-full)',
          background: 'var(--status-needs-response)', color: 'var(--accent-text)',
          fontSize: 12, fontWeight: 700,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>{item.badge}</span>
      )}
      <IconChevronRight width={18} height={18} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
    </>
  );

  if (item.comingSoon) {
    return (
      <div style={rowStyle}>
        {iconWrap}
        {label}
        {trailing}
      </div>
    );
  }

  return (
    <Link to={item.path} style={rowStyle}>
      {iconWrap}
      {label}
      {trailing}
    </Link>
  );
}

/* ── TechMore page ── */

export default function TechMore() {
  const { t } = useTranslation('more');
  const { db, employee, isFeatureEnabled } = useAuth();

  // ─── SECTION: State & hooks ──────────────
  const [taskCount, setTaskCount] = useState(0);

  // ─── SECTION: Data fetching ──────────────
  // Fetch today's incomplete task count for the Tasks row badge
  useEffect(() => {
    if (!employee?.id || !db) return;
    let cancelled = false;
    const load = async () => {
      try {
        const tasks = await db.rpc('get_assigned_tasks', { p_employee_id: employee.id });
        if (cancelled) return;
        setTaskCount((tasks || []).filter(t => t.is_today).length);
      } catch { /* ignore */ }
    };
    load();
    return () => { cancelled = true; };
  }, [db, employee?.id]);

  // Admin group — visible ONLY to an admin with the page:admin_mobile flag on
  // (dark-launched, owner-only until flipped). Mirrors the tool:oop_pricing
  // conditional-group pattern; labels are plain English (admin-only surface).
  const showAdmin = canAccessAdminMobile({
    role: employee?.role,
    flagEnabled: isFeatureEnabled(ADMIN_MOBILE_FLAG),
  });

  const sections = [
    ...(showAdmin ? [{
      key: 'admin',
      title: 'Admin',
      items: [
        { key: 'admin_dash', label: 'Dashboard', Icon: AmIcons.IconGauge, path: adminDashHref() },
        { key: 'admin_collections', label: 'Collections', Icon: AmIcons.IconMoney, path: adminCollectionsHref() },
        { key: 'admin_new_estimate', label: 'New Estimate', Icon: AmIcons.IconEstimate, path: adminEstimateEditorHref() },
        { key: 'admin_leads', label: 'Lead Center', Icon: AmIcons.IconLeads, path: adminLeadsHref() },
      ],
    }] : []),
    {
      key: 'work',
      title: t('sectionWork'),
      items: [
        { key: 'tasks', label: t('rowTasks'), Icon: IconChecklist, path: '/tech/tasks', badge: taskCount },
        ...(isFeatureEnabled('tool:oop_pricing')
          ? [{ key: 'oop_pricing', label: t('rowOopPricing'), Icon: IconCalculator, path: '/tech/tools/oop-pricing' }]
          : []),
        { key: 'collections', label: t('rowCollections'), Icon: IconDollar, comingSoon: true },
        { key: 'time', label: t('rowTimeTracking'), Icon: IconClock, comingSoon: true },
      ],
    },
    {
      key: 'resources',
      title: t('sectionResources'),
      items: [
        { key: 'help', label: t('rowHelp'), Icon: IconBook, path: '/tech/help' },
        { key: 'checklists', label: t('rowChecklists'), Icon: IconClipboard, comingSoon: true },
        { key: 'demosheet', label: t('rowScopeSheet'), Icon: IconDocument, comingSoon: true },
      ],
    },
    {
      key: 'preferences',
      title: t('sectionPreferences'),
      items: [
        { key: 'settings', label: t('rowSettings'), Icon: IconSettings, path: '/tech/settings' },
      ],
    },
  ];

  // ─── SECTION: Render ──────────────
  return (
    <div className="tech-page" style={{ padding: 0 }}>
      <div style={{ padding: 'var(--space-4) var(--space-4) var(--space-6)' }}>
        <div className="tech-page-header" style={{ marginBottom: 'var(--space-5)' }}>
          <div className="tech-page-title">{t('title')}</div>
          <div className="tech-page-subtitle">{t('subtitle')}</div>
        </div>

        {sections.map(section => (
          <div key={section.key} style={{ marginBottom: 'var(--space-5)' }}>
            <div style={{
              fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)',
              textTransform: 'uppercase', letterSpacing: '0.06em',
              padding: '0 4px 8px',
            }}>
              {section.title}
            </div>
            <div style={{
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border-color)',
              overflow: 'hidden',
              background: 'var(--bg-primary)',
            }}>
              {section.items.map((item, idx) => (
                <MoreRow
                  key={item.key}
                  item={item}
                  isLast={idx === section.items.length - 1}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
