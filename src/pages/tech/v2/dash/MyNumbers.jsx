/**
 * ════════════════════════════════════════════════
 * FILE: MyNumbers.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The tech's own scoreboard for the day: how many hours they've logged today
 *   and this week — always shown as a labeled travel + on-site + total breakdown,
 *   never a bare number — plus how many of today's tasks are done and how many
 *   photos they've taken today. All of it comes from the one dashboard feed.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (section of the dashboard)
 *   Rendered by:  src/pages/tech/v2/TechDashV2.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  ./dashHelpers (hoursBreakdown)
 *   Data:      none (numbers arrive as props from get_tech_dashboard)
 *
 * NOTES / GOTCHAS:
 *   - Hours are Monday-start in America/Denver to match the payroll page
 *     (get_payroll_summary). Travel is shown separately because payroll totals
 *     EXCLUDE travel while billing includes it — the breakdown makes that honest.
 * ════════════════════════════════════════════════
 */
import { useTranslation } from 'react-i18next';
import { hoursBreakdown } from './dashHelpers.js';

// Stable English label (from hoursBreakdown) → translation key. The `=== 'Total'`
// check below stays on the English label so the styling logic never breaks.
const HOURS_LABEL_KEY = { 'Travel': 'travel', 'On-site': 'onSite', 'Total': 'total' };

function HoursCard({ title, bucket }) {
  const { t } = useTranslation('dash');
  const parts = hoursBreakdown(bucket);
  return (
    <div className="tv2-dash-hours">
      <div className="tv2-dash-hours__title">{title}</div>
      <div className="tv2-dash-hours__grid">
        {parts.map((p) => (
          <div key={p.label} className={`tv2-dash-hours__cell${p.label === 'Total' ? ' tv2-dash-hours__cell--total' : ''}`}>
            <div className="tv2-dash-hours__value">{p.value}</div>
            <div className="tv2-dash-hours__label">{t(`hours.${HOURS_LABEL_KEY[p.label] || p.label}`, { defaultValue: p.label })}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatPill({ value, label }) {
  return (
    <div className="tv2-dash-stat">
      <div className="tv2-dash-stat__value">{value}</div>
      <div className="tv2-dash-stat__label">{label}</div>
    </div>
  );
}

/**
 * @param {{ hoursToday: object, hoursWeek: object, tasksDone: number,
 *           tasksTotal: number, photosToday: number }} props
 */
export default function MyNumbers({ hoursToday, hoursWeek, tasksDone, tasksTotal, photosToday }) {
  const { t } = useTranslation('dash');
  return (
    <div className="tv2-dash-numbers">
      <div className="tv2-dash-section-title">{t('myNumbers')}</div>
      <HoursCard title={t('hoursToday')} bucket={hoursToday} />
      <HoursCard title={t('thisWeek')} bucket={hoursWeek} />
      <div className="tv2-dash-stat-row">
        <StatPill value={`${tasksDone}/${tasksTotal}`} label={t('tasksDone')} />
        <StatPill value={photosToday} label={t('photosToday')} />
      </div>
    </div>
  );
}
