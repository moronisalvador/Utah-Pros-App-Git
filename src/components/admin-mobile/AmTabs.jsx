/**
 * ════════════════════════════════════════════════
 * FILE: AmTabs.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A horizontal strip of tabs for switching between related views on one admin
 *   screen — for example Collections' "AR aging · Invoices · Estimates · Payments".
 *   Tapping a tab highlights it and tells the screen which view to show. The strip
 *   scrolls sideways if the tabs don't all fit.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (a shared control)
 *   Rendered by:  the admin-mobile screens with multiple sub-views
 *
 * DEPENDS ON:
 *   Packages:  react (JSX)
 *   Internal:  none
 *   Data:      reads → none · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Controlled component: the parent owns `value` and updates it in `onChange`.
 *   - `tabs` is [{ value, label, badge? }]; `badge` shows a small count pill.
 * ════════════════════════════════════════════════
 */

export default function AmTabs({ tabs = [], value, onChange }) {
  return (
    <div className="am-tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          className={`am-tab${value === tab.value ? ' am-tab--active' : ''}`}
          onClick={() => onChange?.(tab.value)}
        >
          <span>{tab.label}</span>
          {tab.badge != null && tab.badge > 0 && (
            <span className="am-tab-badge">{tab.badge}</span>
          )}
        </button>
      ))}
    </div>
  );
}
