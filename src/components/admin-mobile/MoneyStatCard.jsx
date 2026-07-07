/**
 * ════════════════════════════════════════════════
 * FILE: MoneyStatCard.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A small card that shows one number that matters — a dollar figure or a count
 *   — with a label under it and, optionally, a little up/down change note. Used
 *   across the admin dashboard and collections screens so every headline stat
 *   looks the same.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (a shared presentational card)
 *   Rendered by:  the admin-mobile dashboard / collections screens
 *
 * DEPENDS ON:
 *   Packages:  react (JSX)
 *   Internal:  none
 *   Data:      reads → none · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Presentational only: the caller formats the value (currency, count, etc.)
 *     and passes the finished string. `trend` is 'up' | 'down' | null and only
 *     tints the delta text — it implies nothing on its own.
 * ════════════════════════════════════════════════
 */

export default function MoneyStatCard({ label, value, delta, trend = null, muted = false }) {
  return (
    <div className={`am-stat-card${muted ? ' am-stat-card--muted' : ''}`}>
      <div className="am-stat-value">{value}</div>
      <div className="am-stat-label">{label}</div>
      {delta != null && (
        <div className={`am-stat-delta${trend ? ` am-stat-delta--${trend}` : ''}`}>{delta}</div>
      )}
    </div>
  );
}
