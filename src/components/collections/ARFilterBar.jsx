const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'needs_attention', label: 'Needs Attention' },
  { key: 'paid', label: 'Paid' },
];

export default function ARFilterBar({ search, onSearch, filter, onFilter, counts }) {
  return (
    <div className="ar-v2-filter-bar">
      <input
        className="input"
        placeholder="Search client, claim #, or carrier..."
        value={search}
        onChange={e => onSearch(e.target.value)}
        style={{ maxWidth: 280, flex: '1 1 200px' }}
      />
      <div className="ar-tabs" style={{ marginLeft: 'auto' }}>
        {FILTERS.map(f => (
          <button
            key={f.key}
            className={`ar-tab${filter === f.key ? ' active' : ''}`}
            onClick={() => onFilter(f.key)}
          >
            {f.label}
            {counts[f.key] != null && (
              <span className="ar-tab-count">{counts[f.key]}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
