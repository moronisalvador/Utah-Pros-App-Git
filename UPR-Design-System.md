# UPR Platform — Design System Reference
**Last updated:** March 27, 2026
**For:** Claude Code — read this before building any new page, component, or modal.

This document reflects the actual UI patterns extracted from the live codebase. Follow these patterns exactly. Do not invent new layouts, colors, or component structures — match what already exists.

---

## Core Principles

- **Dense and functional.** This is an internal tool for field techs and admins. No decorative elements.
- **Mobile-first.** Every page must work on iPhone. Field techs use this on-site.
- **Consistent.** Every page follows the same header → filters → content → empty state pattern.
- **CSS variables only.** Never hardcode colors or spacing. Always use `var(--token)`.
- **Touch-friendly.** Minimum 44px tap targets. 36px is acceptable for secondary actions.

---

## Design Tokens

### Colors
```css
/* Backgrounds */
--bg-primary: #ffffff
--bg-secondary: #f8f9fb      /* page background, section backgrounds */
--bg-tertiary: #f1f3f5       /* hover states, tags, secondary fills */
--bg-elevated: #ffffff

/* Borders */
--border-color: #e2e5e9      /* standard border */
--border-light: #f0f1f3      /* subtle dividers inside cards */

/* Text */
--text-primary: #111318      /* headings, primary content */
--text-secondary: #5f6672    /* labels, secondary content */
--text-tertiary: #8b929e     /* placeholders, timestamps, metadata */
--text-inverse: #f1f5f9      /* text on dark backgrounds */

/* Accent (primary blue) */
--accent: #2563eb
--accent-hover: #1d4ed8
--accent-light: #eff6ff      /* accent tint backgrounds */
--accent-text: #ffffff

/* Status colors */
--status-needs-response: #ef4444
--status-needs-response-bg: #fef2f2
--status-waiting: #f59e0b
--status-waiting-bg: #fffbeb
--status-resolved: #10b981
--status-resolved-bg: #ecfdf5
--status-active: #3b82f6
--status-active-bg: #eff6ff
```

### Status Color Palette (inline style pattern)
These are used for badges, pills, and flags. Always use the full triplet: bg + color + border.

```js
// Green (success, active, paid, linked)
bg: '#f0fdf4', color: '#16a34a', border: '#bbf7d0'

// Red (error, urgent, needs response, force-disabled)
bg: '#fef2f2', color: '#dc2626', border: '#fecaca'

// Yellow/Amber (warning, pending, dev-only)
bg: '#fffbeb', color: '#d97706', border: '#fde68a'

// Blue (info, active, in-progress)
bg: '#eff6ff', color: '#2563eb', border: '#bfdbfe'

// Purple (feature flags, schedule mode)
bg: '#faf5ff', color: '#7c3aed', border: '#ddd6fe'

// Gray (inactive, closed, default)
bg: '#f1f3f5', color: '#6b7280', border: '#e2e5e9'
```

### Division Colors
```js
// From DivisionIcons.jsx — import DIVISION_COLORS from '@/components/DivisionIcons'
water:          '#2563eb'
mold:           '#9d174d'
reconstruction: '#d97706'
fire:           '#dc2626'
contents:       '#059669'
general:        '#6b7280'

// Division badges (data-division CSS attribute)
water:          bg #dbeafe, color #1e40af
mold:           bg #fce7f3, color #9d174d
reconstruction: bg #fef3c7, color #92400e
fire:           bg #fee2e2, color #b91c1c
contents:       bg #d1fae5, color #065f46
```

### Phase/Status Colors
Used consistently across Jobs, Production, CustomerPage, JobPage:
```js
// Red — urgent
lead, emergency_response, job_received: bg #fef2f2 / #fff7ed, color #ef4444 / #ea580c

// Yellow — pending / waiting
estimate_submitted, supplement_*, waiting_*: bg #fffbeb, color #d97706

// Blue — active work
mitigation_*, drying, monitoring, reconstruction_in_progress: bg #eff6ff, color #2563eb

// Green — complete
completed, estimate_approved, work_authorized, paid: bg #ecfdf5, color #10b981 / #059669

// Gray — neutral / closed
closed, on_hold, cancelled: bg #f1f3f5, color #6b7280
```

### Typography
```css
--font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif
--font-mono: 'JetBrains Mono', 'Fira Code', monospace

--text-xs:   11px   /* labels, badges, metadata, uppercase section headers */
--text-sm:   13px   /* body text, table rows, card content */
--text-base: 14px   /* default, card titles */
--text-lg:   16px   /* modal titles, section headers */
--text-xl:   18px   /* page subheadings */
--text-2xl:  22px   /* page titles */
```

### Spacing
```css
--space-1: 4px   --space-2: 8px   --space-3: 12px
--space-4: 16px  --space-5: 20px  --space-6: 24px  --space-8: 32px
```

### Radius
```css
--radius-sm: 4px   --radius-md: 6px   --radius-lg: 8px
--radius-xl: 12px  --radius-full: 9999px
```

### Shadows
```css
--shadow-xs: 0 1px 2px rgba(0,0,0,0.04)
--shadow-sm: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)
--shadow-md: 0 4px 6px -1px rgba(0,0,0,0.06), 0 2px 4px -2px rgba(0,0,0,0.04)
--shadow-lg: 0 10px 15px -3px rgba(0,0,0,0.06), 0 4px 6px -4px rgba(0,0,0,0.04)
```

---

## Utility Classes (already in index.css — use these, don't recreate)

### Buttons
```jsx
<button className="btn btn-primary">Primary</button>
<button className="btn btn-secondary">Secondary</button>
<button className="btn btn-ghost">Ghost</button>
<button className="btn btn-sm">Small (30px)</button>
<button className="btn btn-lg">Large (44px)</button>
```
- Default height: 36px. Small: 30px. Large: 44px.
- Always include `disabled` attribute when loading — never just `opacity`.

### Inputs
```jsx
<input className="input" />
<textarea className="input textarea" />
<select className="input" />
<label className="label">Label text</label>
```
- Height: 40px for inputs.
- On mobile inputs must have `font-size: 16px` (already enforced via CSS for `.input` class, but watch for inline overrides).

### Status Badges (with dot indicator)
```jsx
<span className="status-badge status-needs-response">Urgent</span>
<span className="status-badge status-waiting">Waiting</span>
<span className="status-badge status-resolved">Resolved</span>
<span className="status-badge status-active">Active</span>
```

### Division Badges
```jsx
<span className="division-badge" data-division={job.division}>{job.division}</span>
```

### Priority Tags
```jsx
<span className="priority-tag priority-urgent">URGENT</span>
<span className="priority-tag priority-high">HIGH</span>
```

### Empty State
```jsx
<div className="empty-state">
  <div className="empty-state-icon">📋</div>
  <div className="empty-state-text">No items found</div>
  <div className="empty-state-sub">Try adjusting your filters</div>
</div>
```

### Loading Spinner
```jsx
<div className="loading-page"><div className="spinner" /></div>
```

### Card
```jsx
<div className="card">
  <div className="card-header">
    <span className="card-title">Title</span>
    <button className="btn btn-secondary btn-sm">Action</button>
  </div>
  <div className="card-body">content</div>
</div>
```

---

## Page Layout Patterns

### Standard List Page (Customers, ClaimsList pattern)
```jsx
<div className="customers-page">          {/* page wrapper — padding: var(--space-5), max-width: 1200px */}
  <div className="customers-header">       {/* flex, space-between, margin-bottom: space-4 */}
    <div>
      <h1 className="page-title">Title</h1>
      <p className="page-subtitle">N items</p>
    </div>
    {/* optional action buttons */}
  </div>

  <div className="customers-filters">     {/* flex, gap: space-2, margin-bottom: space-4 */}
    <div className="customers-search-wrap">
      <IconSearch style={{ position: 'absolute', left: 10, top: 9 }} />
      <input className="input" style={{ paddingLeft: 32 }} placeholder="Search..." />
    </div>
    {/* optional dropdowns */}
    {activeFilter && <button className="btn btn-ghost btn-sm">Clear</button>}
  </div>

  <PullToRefresh onRefresh={load} className="customers-list">  {/* flex column, gap: space-2 */}
    {items.length === 0 ? <EmptyState /> : items.map(item => <Card key={item.id} />)}
  </PullToRefresh>
</div>
```

### Full-Viewport Page with Sticky Header (Jobs, Production pattern)
Use when the page needs to fill height exactly and scroll only the content area, not the whole page.
```jsx
<div className="jobs-page">              {/* flex column, height: 100dvh, overflow: hidden */}
  <div className="jobs-header">           {/* flex, space-between, margin-bottom: space-4, flex-shrink: 0 */}
    <div>
      <h1 className="page-title">Jobs</h1>
      <p className="page-subtitle">{count} of {total} jobs</p>
    </div>
    {/* sort/view controls */}
  </div>

  {/* optional division tabs */}
  <div className="division-tabs">
    {TABS.map(tab => (
      <button className={`division-tab${active === tab.key ? ' active' : ''}`}>
        {tab.label} <span className="division-tab-count">{count}</span>
      </button>
    ))}
  </div>

  <div className="jobs-filters">           {/* flex, gap: space-3, flex-shrink: 0 */}
    <div className="jobs-search-wrap">
      <IconSearch />
      <input className="input jobs-search" />
    </div>
    <select className="input jobs-filter-select" />
    {active && <button className="btn btn-ghost btn-sm">Clear</button>}
  </div>

  <PullToRefresh onRefresh={load} className="job-card-list">  {/* flex col, flex: 1, overflow-y: auto */}
    {items.map(item => <JobListCard key={item.id} />)}
  </PullToRefresh>
</div>
```

### Tabbed Detail Page (JobPage, CustomerPage, Admin pattern)
```jsx
<div className="job-page">               {/* flex column, height: 100dvh, overflow: hidden */}
  <div className="job-page-topbar">       {/* sticky top bar — back button + actions */}
    <button className="btn btn-ghost btn-sm">← Back</button>
    <div className="job-page-topbar-actions">{/* action buttons */}</div>
  </div>

  <div className="job-page-header">       {/* title area with division icon + client info */}
    <div className="job-page-header-left">
      <div className="job-page-division-icon">{/* emoji or DivisionIcon */}</div>
      <div>
        <div className="job-page-jobnumber">JOB-001</div>
        <div className="job-page-client">Client Name</div>
        <div className="job-page-address">123 Main St</div>
      </div>
    </div>
    <div className="job-page-header-right">{/* phase badge + action buttons */}</div>
  </div>

  <div className="job-page-tabs">         {/* horizontal tab strip, overflow-x: auto */}
    {TABS.map(tab => (
      <button className={`job-page-tab${active === tab.key ? ' active' : ''}`}>
        {tab.label}
        {tab.count > 0 && <span className="job-page-tab-count">{tab.count}</span>}
      </button>
    ))}
  </div>

  <PullToRefresh className="job-page-content">  {/* flex: 1, overflow-y: auto, padding: space-5 space-6 */}
    {activeTab === 'overview' && <OverviewTab />}
    {activeTab === 'other' && <OtherTab />}
  </PullToRefresh>
</div>
```

### Two-Column Settings/Admin Page
```jsx
<div className="settings-page">          {/* flex column, height: 100%, overflow: hidden */}
  <div className="settings-header">       {/* padding: space-5 space-6 */}
    <h1 className="page-title">Settings</h1>
  </div>
  <div className="settings-body">         {/* flex, flex: 1, overflow: hidden */}
    <nav className="settings-nav">        {/* 210px wide sidebar — horizontal scroll strip on mobile */}
      <div className="settings-nav-label">Section</div>
      <button className={`settings-nav-item${active === 'key' ? ' active' : ''}`}>Item</button>
    </nav>
    <div className="settings-content">    {/* flex: 1, overflow-y: auto, padding: space-5 space-6 */}
      {/* content */}
    </div>
  </div>
</div>
```

### Simple Page (Dashboard pattern)
For pages that don't need full-viewport control:
```jsx
<div className="page">                   {/* padding: space-6, max-width: 1400px */}
  <div className="page-header">          {/* margin-bottom: space-6 */}
    <h1 className="page-title">Dashboard</h1>
    <p className="page-subtitle">Subtitle text</p>
  </div>
  {/* content */}
</div>
```

---

## Card Patterns

### Job List Card (Jobs page)
Left colored border = division color. Quick-view button on right.
```jsx
<div className="job-list-card" onClick={onClick}
  style={{ borderLeft: `3px solid ${divColor}`, borderRadius: 'var(--radius-md)' }}>
  <div className="job-list-card-body">
    {/* Row 1: name + priority + phase badge */}
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
      <span className="job-list-card-name">{job.insured_name}</span>
      {priority && <span style={flagStyle}>{priority.label}</span>}
      <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: phase.bg, color: phase.color }}>{phase.label}</span>
    </div>
    {/* Row 2: job number + flags */}
    {/* Row 3: address */}
    {/* Row 4: meta line (insurer · loss date · value) */}
  </div>
  <button className="job-card-open-btn" onClick={e => { e.stopPropagation(); onQuickView(); }}>
    <IconSearch style={{ width: 14, height: 14 }} />
  </button>
</div>
```

### Customer/Contact Card (Customers page)
Avatar circle + body + right-side badge.
```jsx
<div className="customer-card" onClick={onClick}>
  <div className="customer-card-avatar">{initials}</div>
  <div className="customer-card-body">
    <div className="customer-card-name">{name}</div>
    <div className="customer-card-meta">
      <span>{phone}</span>
      <span>{email}</span>
    </div>
    <div className="customer-card-jobs">
      {jobs.slice(0, 3).map(j => (
        <span className="customer-card-job-pill"
          style={{ borderLeftColor: DIVISION_COLORS[j.division], borderLeftWidth: 2 }}>
          {j.job_number}
        </span>
      ))}
    </div>
  </div>
  <div className="customer-card-right">
    <span className="customer-card-role-badge">{role}</span>
    <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{count} jobs</span>
  </div>
</div>
```

### Pipeline Card (Production kanban)
```jsx
<div className="pipeline-card">
  <div className="pipeline-card-title">{job.job_number || job.insured_name}</div>
  <div className="pipeline-card-meta">{job.insured_name}</div>
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
    <span className="division-badge" data-division={job.division}>{job.division}</span>
    <button className="job-card-open-btn"><IconOpenPage /></button>
  </div>
</div>
```

### Stat Card (Dashboard)
```jsx
<div className="stat-card">
  <div className="stat-label">Active Jobs</div>
  <div className="stat-value" style={alert ? { color: 'var(--status-needs-response)' } : {}}>
    {value}
  </div>
</div>
```

### Info Row (inside JobPage sections)
```jsx
<div className="job-page-info-row">
  <span className="job-page-info-label">Insurance</span>
  <span className="job-page-info-value">{value || '—'}</span>
</div>
```

---

## Modal/Panel Patterns

### Centered Modal (Admin)
```jsx
<div className="admin-modal-overlay" onClick={onClose}>
  <div className="admin-modal" onClick={e => e.stopPropagation()}>
    <div className="admin-modal-header">
      <h3>Modal Title</h3>
      <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
    </div>
    <div className="admin-modal-body">{/* content */}</div>
    <div className="admin-modal-footer">
      <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" onClick={onSave}>Save</button>
    </div>
  </div>
</div>
```
- On mobile (`@media max-width: 768px`): becomes a **bottom sheet** via CSS (`admin-modal-overlay` aligns to flex-end, `admin-modal` gets `border-radius: 16px 16px 0 0`).
- For smaller confirms: add `admin-modal-sm` class (max-width: 420px).

### Bottom Sheet Modal (any new modal)
New modals should follow the admin-modal pattern — centered on desktop, bottom sheet on mobile. Add these CSS classes:
```css
/* In your component's inline styles or via new CSS classes */
.my-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: var(--space-4); }
.my-modal { background: var(--bg-primary); border-radius: var(--radius-xl); width: 100%; max-width: 560px; max-height: 90vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: var(--shadow-lg); }
@media (max-width: 768px) {
  .my-modal-overlay { align-items: flex-end; padding: 0; }
  .my-modal { border-radius: 16px 16px 0 0; max-height: 90dvh; max-width: 100%; padding-bottom: env(safe-area-inset-bottom, 0px); }
}
```

### Slide-Out Panel (JobDetailPanel, CustomerPage side panel)
```jsx
<div className="job-detail-overlay" onClick={onClose}>
  <div className="job-detail-panel" onClick={e => e.stopPropagation()}>
    <div className="job-detail-header">
      <div>
        <div className="job-detail-jobnumber">Title</div>
        <div className="job-detail-client">Subtitle</div>
      </div>
      <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
    </div>
    {/* sections with dividers */}
    <div className="job-detail-section">
      <div className="job-detail-section-title">Section Name</div>
      {/* rows */}
    </div>
    <div className="job-detail-divider" />
  </div>
</div>
```

---

## Tab Bar Patterns

### Underline Tabs (JobPage, Admin, DevTools)
```jsx
<div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--border-color)', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
  {TABS.map(tab => (
    <button key={tab.key} onClick={() => setActive(tab.key)} style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '9px 14px', border: 'none', background: 'none',
      borderBottom: `2px solid ${active === tab.key ? 'var(--accent)' : 'transparent'}`,
      color: active === tab.key ? 'var(--accent)' : 'var(--text-secondary)',
      fontFamily: 'var(--font-sans)', fontSize: 13,
      fontWeight: active === tab.key ? 600 : 400,
      cursor: 'pointer', whiteSpace: 'nowrap', marginBottom: -1,
    }}>
      <TabIcon style={{ width: 14, height: 14 }} />
      {tab.label}
    </button>
  ))}
</div>
```

### Pill Tabs (IntegrityTab, MessagingTab sub-tabs, filter bars)
```jsx
{TABS.map(tab => (
  <button key={tab.key} onClick={() => setActive(tab.key)} style={{
    padding: '6px 14px', borderRadius: 'var(--radius-full)', border: '1px solid',
    fontSize: 12, fontWeight: active === tab.key ? 600 : 400, cursor: 'pointer',
    background: active === tab.key ? 'var(--accent)' : 'var(--bg-tertiary)',
    color: active === tab.key ? '#fff' : 'var(--text-secondary)',
    borderColor: active === tab.key ? 'var(--accent)' : 'var(--border-color)',
  }}>{tab.label}</button>
))}
```

### Segmented Control (toggle between 2–3 options)
```jsx
<div style={{ display: 'flex', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
  {OPTIONS.map((opt, i, arr) => (
    <button key={opt.key} onClick={() => setActive(opt.key)} style={{
      fontSize: 12, fontWeight: 500, padding: '5px 14px',
      border: 'none', background: active === opt.key ? 'var(--accent-light)' : 'var(--bg-primary)',
      cursor: 'pointer', color: active === opt.key ? 'var(--accent)' : 'var(--text-tertiary)',
      fontFamily: 'var(--font-sans)', fontWeight: active === opt.key ? 600 : 400,
      borderRight: i < arr.length - 1 ? '1px solid var(--border-color)' : 'none',
    }}>{opt.label}</button>
  ))}
</div>
```

---

## Table Patterns

### Admin Table (desktop, with mobile card fallback)
```jsx
{/* Desktop */}
<div className="admin-table-wrap">        {/* border, border-radius, overflow-x: auto */}
  <table className="admin-table">
    <thead>
      <tr>
        <th>Name</th>
        <th className="admin-th-num">Amount</th>
        <th className="admin-th-actions">Actions</th>
      </tr>
    </thead>
    <tbody>
      {rows.map(row => (
        <tr key={row.id}>
          <td>{row.name}</td>
          <td className="admin-td-num">${row.amount}</td>
          <td className="admin-td-actions">
            <button className="admin-action-btn">Edit</button>
            <button className="admin-action-btn admin-action-btn-danger">Delete</button>
          </td>
        </tr>
      ))}
    </tbody>
  </table>
</div>
{/* Mobile cards hidden on desktop via .admin-cards-mobile { display: none } */}
```

### DevTools-style table (data tables inside panels)
```jsx
<div style={{ borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
  {/* Header row */}
  <div style={{
    display: 'grid', gridTemplateColumns: '1fr 1fr 120px',
    padding: '8px 16px', background: 'var(--bg-secondary)',
    borderBottom: '1px solid var(--border-color)',
    fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)',
    letterSpacing: '0.06em', textTransform: 'uppercase',
  }}>
    <span>Column A</span><span>Column B</span><span>Column C</span>
  </div>
  {/* Data rows */}
  {rows.map((row, i) => (
    <div key={row.id} style={{
      display: 'grid', gridTemplateColumns: '1fr 1fr 120px',
      alignItems: 'center', padding: '10px 16px',
      borderBottom: i < rows.length - 1 ? '1px solid var(--border-light)' : 'none',
      background: 'var(--bg-primary)',
    }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{row.a}</span>
      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{row.b}</span>
      <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{row.c}</span>
    </div>
  ))}
</div>
```

---

## Badge/Pill Patterns

### Status pill (inline)
```jsx
<span style={{
  fontSize: 11, fontWeight: 700, padding: '2px 8px',
  borderRadius: 'var(--radius-full)',
  background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0',
}}>Active</span>
```

### Monospace code badge (keys, IDs, job numbers)
```jsx
<code style={{
  fontSize: 11, fontFamily: 'var(--font-mono)',
  color: 'var(--text-tertiary)', background: 'var(--bg-tertiary)',
  padding: '1px 5px', borderRadius: 3,
}}>page:marketing</code>
```

### Section header label (above grouped content)
```jsx
<div style={{
  fontSize: 11, fontWeight: 600, letterSpacing: '0.06em',
  textTransform: 'uppercase', color: 'var(--text-tertiary)',
  marginBottom: 10,
}}>Section Name</div>
```

### Role badge (Admin page pattern)
```jsx
<span className={`admin-role-badge role-${emp.role}`}>{roleLabel}</span>
```
Available: `role-admin`, `role-project_manager`, `role-office`, `role-supervisor`, `role-field_tech`

---

## Form Patterns

### Standard form field
```jsx
<div style={{ marginBottom: 'var(--space-3)' }}>
  <label style={{
    display: 'block', fontSize: 11, fontWeight: 600,
    color: 'var(--text-tertiary)', textTransform: 'uppercase',
    letterSpacing: '0.06em', marginBottom: 5,
  }}>
    Field Label
  </label>
  <input className="input" value={val} onChange={e => setVal(e.target.value)} />
</div>
```

### Two-column form grid
```jsx
<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
  <div>{/* field */}</div>
  <div>{/* field */}</div>
</div>
```
On mobile, use `flex-direction: column` inside a `@media (max-width: 768px)` rule, or use the `admin-form-grid` class.

### Toggle switch (existing CSS classes)
```jsx
<button
  className={`admin-toggle${enabled ? ' on' : ''}`}
  onClick={toggle}
  disabled={saving}
>
  <span className="admin-toggle-dot" />
</button>
```

### Two-click confirm (REQUIRED for destructive actions — never use alert/confirm)
```jsx
const [confirmDel, setConfirmDel] = useState(null);

const handleDelete = async (item) => {
  if (confirmDel !== item.id) { setConfirmDel(item.id); return; }
  setConfirmDel(null);
  // ... execute delete
};

<button
  onClick={() => handleDelete(item)}
  onBlur={() => setConfirmDel(null)}
  style={{
    background: confirmDel === item.id ? '#fef2f2' : 'var(--bg-tertiary)',
    color:      confirmDel === item.id ? '#dc2626' : 'var(--text-tertiary)',
    border:     `1px solid ${confirmDel === item.id ? '#fecaca' : 'var(--border-light)'}`,
    padding: '4px 10px', borderRadius: 'var(--radius-md)', fontSize: 11,
    fontWeight: confirmDel === item.id ? 600 : 400, cursor: 'pointer',
    transition: 'all 0.12s',
  }}
>
  {confirmDel === item.id ? 'Confirm Delete' : 'Delete'}
</button>
```

---

## Navigation Patterns

### Sidebar
- Background: `--sidebar-bg: #111318` (dark)
- Width: 240px desktop, 280px mobile (slide-over)
- Active link: `sidebar-active` class (blue tint + blue text)
- Section labels: uppercase, 11px, 0.6 opacity
- Minimum touch target: 40px height per link

### Bottom Bar (mobile only)
4 tabs + "More" opens sidebar. Shown only on `@media (max-width: 768px)`.
Height: `--bottom-bar-h: 72px` + safe area.

### Page content with bottom bar
Always use `PullToRefresh` as the scrollable wrapper. The bottom bar padding is automatically added via `.app-content { padding-bottom: calc(var(--bottom-bar-h) + var(--safe-bottom)); }`.

---

## Toast Notifications (NEVER use alert/confirm)
```js
// Success
window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: 'Saved!', type: 'success' } }));

// Error
window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: 'Failed to save', type: 'error' } }));
```

---

## Mobile-Specific Rules

1. **All inputs must have `font-size: 16px` on mobile** — iOS auto-zooms on anything smaller. The `.input` class handles this via `@media (max-width: 768px) { input { font-size: 16px !important; } }`. Never override with smaller size.

2. **Safe areas** — use `env(safe-area-inset-bottom, 0px)` for anything near the bottom. Already baked into `.bottom-bar`, modal footers, etc.

3. **Modals become bottom sheets** on mobile. Add the CSS pattern from the Modal section above.

4. **Tap targets: 44px minimum** for primary actions. 36px for secondary. Never below 32px.

5. **No hover-only interactions** — mobile has no hover. Show important actions visibly. Use `onBlur` to cancel two-click confirm states.

6. **`PullToRefresh` wrapper** — wrap scrollable content in `<PullToRefresh onRefresh={loadFn}>`. This enables pull-to-refresh on iOS.

7. **CSS transforms cause clipping on real iPhone** — use `display` toggling instead for show/hide.

8. **`100dvh` not `100vh`** for full-screen pages — handles iOS Safari's dynamic viewport.

---

## Existing CSS Classes by Category

### Page shells
`.page` `.page-header` `.page-title` `.page-subtitle`
`.jobs-page` `.job-page` `.customers-page` `.admin-page` `.settings-page` `.tt-page` `.collections-page` `.create-job-page`

### Navigation
`.sidebar` `.sidebar-link` `.sidebar-link.active` `.sidebar-nav` `.sidebar-footer` `.sidebar-badge`
`.bottom-bar` `.bottom-tab` `.bottom-tab.active` `.bottom-tab-badge`

### Cards
`.card` `.card-header` `.card-title` `.card-body`
`.stat-card` `.stat-label` `.stat-value`
`.job-list-card` `.job-list-card-body` `.job-list-card-name` `.job-list-card-address`
`.customer-card` `.customer-card-avatar` `.customer-card-body` `.customer-card-name`
`.customer-card-job-pill` `.customer-card-role-badge`
`.pipeline-card` `.pipeline-card-title` `.pipeline-card-meta`
`.macro-card` `.macro-card-emoji` `.macro-card-count` `.macro-card-label`

### Buttons
`.btn` `.btn-primary` `.btn-secondary` `.btn-ghost` `.btn-sm` `.btn-lg`
`.admin-action-btn` `.admin-action-btn-warning` `.admin-action-btn-danger` `.admin-action-btn-success`
`.job-card-open-btn`

### Forms
`.input` `.textarea` `.label` `.form-group`
`.admin-toggle` `.admin-toggle.on` `.admin-toggle-dot`
`.admin-form-grid` `.admin-field` `.admin-field-hint`

### Badges/Pills
`.status-badge` `.status-needs-response` `.status-waiting` `.status-resolved` `.status-active`
`.division-badge` (with `data-division` attribute)
`.priority-tag` `.priority-urgent` `.priority-high`
`.admin-role-badge` `.role-admin` `.role-field_tech` `.role-supervisor` `.role-project_manager` `.role-office`
`.admin-status-pill` `.admin-status-pill.active` `.admin-status-pill.inactive`

### Tables
`.admin-table-wrap` `.admin-table` `.admin-th-num` `.admin-td-num` `.admin-th-actions` `.admin-td-actions`

### Modals
`.admin-modal-overlay` `.admin-modal` `.admin-modal-sm` `.admin-modal-header` `.admin-modal-body` `.admin-modal-footer`

### Job/Detail pages
`.job-page-tabs` `.job-page-tab` `.job-page-tab.active` `.job-page-tab-count`
`.job-page-content` `.job-page-grid` `.job-page-section` `.job-page-section-title`
`.job-page-info-row` `.job-page-info-label` `.job-page-info-value`

### Lookup tables (Settings)
`.lookup-table` `.lookup-header` `.lookup-row` `.lookup-cell` `.lookup-action-btn`

### Pipeline
`.pipeline` `.pipeline-column` `.pipeline-column-header` `.pipeline-cards`
`.division-tabs` `.division-tab` `.division-tab.active`
`.job-card-list`

### Misc
`.loading-page` `.spinner`
`.empty-state` `.empty-state-icon` `.empty-state-text` `.empty-state-sub`
`.create-menu-container` `.create-menu-fab` `.create-menu-popup`

---

## Component Imports

```jsx
// Always available
import { useAuth } from '@/contexts/AuthContext';       // { db, employee, canAccess, isFeatureEnabled, featureFlags }
import { DivisionIcon, DIVISION_COLORS } from '@/components/DivisionIcons';
import PullToRefresh from '@/components/PullToRefresh';
import ErrorBoundary from '@/components/ErrorBoundary';
import { IconSearch, IconOpenPage } from '@/components/Icons';
import { LookupSelect } from '@/components/AddContactModal';  // searchable dropdown
import JobDetailPanel from '@/components/JobDetailPanel';
```

---

## Anti-Patterns (do not do these)

- ❌ `alert()` or `confirm()` — use toast events + two-click confirm
- ❌ Import `db` directly — always `const { db } = useAuth()`
- ❌ Hardcoded colors (`#2563eb`) in new code — use `var(--accent)`
- ❌ Hardcoded spacing (`16px`) in new code — use `var(--space-4)`
- ❌ `localStorage` for state — use React state
- ❌ CSS transforms for show/hide on mobile — use display toggling
- ❌ `window.confirm` for destructive actions — use two-click confirm pattern
- ❌ Font size < 16px on mobile inputs — triggers iOS auto-zoom
- ❌ Redefining constants that are imported (e.g. DIVISION_COLORS, LOSS_CONFIG) — causes build errors
- ❌ Creating new CSS files — all styles go in `index.css` or inline styles
- ❌ New utility classes without checking if they already exist in index.css
- ❌ `100vh` for full-screen pages — use `100dvh` (handles iOS Safari toolbar)
