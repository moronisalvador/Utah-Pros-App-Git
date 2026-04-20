import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

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

function IconChevronRight(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

/* ── Row component ── */

function MoreRow({ item, isLast }) {
  const rowStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '14px 16px',
    minHeight: 56,
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
    }}>Soon</span>
  ) : (
    <>
      {item.badge != null && item.badge > 0 && (
        <span style={{
          minWidth: 22, height: 22, padding: '0 7px',
          borderRadius: 'var(--radius-full)',
          background: '#ef4444', color: '#fff',
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
  const { db, employee, isFeatureEnabled } = useAuth();
  const [taskCount, setTaskCount] = useState(0);

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

  const sections = [
    {
      title: 'Work',
      items: [
        { key: 'tasks', label: 'Tasks', Icon: IconChecklist, path: '/tech/tasks', badge: taskCount },
        ...(isFeatureEnabled('tool:oop_pricing')
          ? [{ key: 'oop_pricing', label: 'OOP Pricing', Icon: IconCalculator, path: '/tech/tools/oop-pricing' }]
          : []),
        { key: 'collections', label: 'Collections', Icon: IconDollar, comingSoon: true },
        { key: 'time', label: 'Time Tracking', Icon: IconClock, comingSoon: true },
      ],
    },
    {
      title: 'Resources',
      items: [
        { key: 'training', label: 'Training Docs', Icon: IconBook, comingSoon: true },
        { key: 'checklists', label: 'Checklists', Icon: IconClipboard, comingSoon: true },
        { key: 'demosheet', label: 'Demosheet Tool', Icon: IconDocument, comingSoon: true },
      ],
    },
  ];

  return (
    <div className="tech-page" style={{ padding: 0 }}>
      <div style={{ padding: 'var(--space-4) var(--space-4) var(--space-6)' }}>
        <div className="tech-page-header" style={{ marginBottom: 'var(--space-5)' }}>
          <div className="tech-page-title">More</div>
          <div className="tech-page-subtitle">Additional tools</div>
        </div>

        {sections.map(section => (
          <div key={section.title} style={{ marginBottom: 'var(--space-5)' }}>
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
