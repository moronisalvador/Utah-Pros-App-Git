/**
 * ════════════════════════════════════════════════
 * FILE: msgDateUtils.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The little date labels the messaging screen shows — the time on each row of the
 *   inbox ("9:41 AM", "Yesterday", "Mon", "Jul 3") and the day headers inside a thread
 *   ("Today", "Yesterday", "Wed, Jul 8"). Everything here follows the tech's chosen
 *   language (English, Portuguese, or Spanish) so nothing is hard-coded — a Portuguese
 *   tech never sees an English "Yesterday". The plain day-bucketing math it builds on
 *   lives in msgsSelectors.js (and is unit-tested there).
 *
 * WHERE IT LIVES:
 *   Route:        n/a (helper module)
 *   Rendered by:  n/a — imported by the messaging list + thread views
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  @/i18n (active language for the "Today/Yesterday" words),
 *              @/lib/techDateUtils (currentLocaleTag), ./msgsSelectors (dayKeyOf)
 *   Data:      reads/writes → none
 *
 * NOTES / GOTCHAS:
 *   - Uses the shared `tech:date.*` keys (today/yesterday) already localized in EN/PT/ES
 *     so we don't re-translate words that already exist. Weekday/month formatting goes
 *     through Intl with currentLocaleTag() — never a hardcoded 'en-US'.
 * ════════════════════════════════════════════════
 */
import i18n from '@/i18n';
import { currentLocaleTag } from '@/lib/techDateUtils';
import { dayKeyOf } from './msgsSelectors';

const td = (key) => i18n.t(`tech:${key}`);

function startOfLocalDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Inbox-row timestamp: today → localized clock time; yesterday → "Yesterday";
 * within the last week → weekday; older → month + day. Mirrors legacy formatListTime,
 * fully localized.
 */
export function listTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const tag = currentLocaleTag();
  const diffDays = Math.round((startOfLocalDay(new Date()) - startOfLocalDay(d)) / 86400000);
  if (diffDays <= 0) return d.toLocaleTimeString(tag, { hour: 'numeric', minute: '2-digit' });
  if (diffDays === 1) return td('date.yesterday');
  if (diffDays < 7) return d.toLocaleDateString(tag, { weekday: 'short' });
  return d.toLocaleDateString(tag, { month: 'short', day: 'numeric' });
}

/**
 * Thread day-divider label for a 'YYYY-MM-DD' day key (from groupMessagesByDay):
 * Today / Yesterday / "Wed, Jul 8". Localized.
 */
export function dayLabel(dayKey) {
  if (!dayKey) return '';
  // Noon avoids any DST/offset slippage when re-parsing a bare date.
  const d = new Date(`${dayKey}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  const todayKey = dayKeyOf(new Date().toISOString());
  const yesterdayKey = dayKeyOf(new Date(Date.now() - 86400000).toISOString());
  if (dayKey === todayKey) return td('date.today');
  if (dayKey === yesterdayKey) return td('date.yesterday');
  return d.toLocaleDateString(currentLocaleTag(), { weekday: 'short', month: 'short', day: 'numeric' });
}
