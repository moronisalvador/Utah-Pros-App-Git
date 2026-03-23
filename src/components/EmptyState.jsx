// EmptyState — shared empty state component
// Usage: <EmptyState icon="📋" title="No jobs found" subtitle="Try adjusting your filters" action={{ label: '+ New Job', onClick: ... }} />

export default function EmptyState({ icon, title, subtitle, action, style }) {
  return (
    <div className="empty-state" style={style}>
      {icon && <div className="empty-state-icon">{icon}</div>}
      {title && <div className="empty-state-title">{title}</div>}
      {subtitle && <div className="empty-state-sub">{subtitle}</div>}
      {action && (
        <button className="btn btn-primary btn-sm" onClick={action.onClick} style={{ marginTop: 16 }}>
          {action.label}
        </button>
      )}
    </div>
  );
}
