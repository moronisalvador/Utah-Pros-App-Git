/**
 * ════════════════════════════════════════════════
 * FILE: PeriodSwitch.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A small row of pill buttons for picking a time window — like "MTD", "Last 30",
 *   "QTD", "YTD" — on the admin dashboard and collections screens. Tapping one
 *   highlights it and tells the screen which period to show numbers for.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (a shared control)
 *   Rendered by:  the admin-mobile dashboard / collections screens
 *
 * DEPENDS ON:
 *   Packages:  react (JSX)
 *   Internal:  none
 *   Data:      reads → none · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Controlled component: the parent owns `value` and updates it in `onChange`.
 *   - `options` is [{ value, label }]; a sensible default set of periods is
 *     exported as ADMIN_PERIODS for screens that want the standard four.
 * ════════════════════════════════════════════════
 */

// eslint-disable-next-line react-refresh/only-export-components -- a shared constant colocated with its sole consumer
export const ADMIN_PERIODS = [
  { value: 'mtd', label: 'MTD' },
  { value: 'last30', label: 'Last 30' },
  { value: 'qtd', label: 'QTD' },
  { value: 'ytd', label: 'YTD' },
];

export default function PeriodSwitch({ value, onChange, options = ADMIN_PERIODS }) {
  return (
    <div className="am-period" role="tablist" aria-label="Time period">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="tab"
          aria-selected={value === opt.value}
          className={`am-period-btn${value === opt.value ? ' am-period-btn--active' : ''}`}
          onClick={() => onChange?.(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
