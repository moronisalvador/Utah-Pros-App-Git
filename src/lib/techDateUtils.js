// Small date/time + file helpers shared by tech pages.
// Locale-aware: date + relative-time labels follow the active i18n language
// (en/pt/es) so every tech screen localizes without re-implementing formatting.
// The pure duration formatter (fmtElapsed, "1h 5m") stays in clockPrecheck.js —
// its h/m units are language-neutral and it's billing-adjacent, so untouched.
import i18n from '@/i18n';

// Active UI language → BCP-47 tag for Intl / toLocale* formatting.
const LOCALE_TAGS = { en: 'en-US', pt: 'pt-BR', es: 'es' };
export function currentLocaleTag() {
  return LOCALE_TAGS[i18n.language] || 'en-US';
}
const td = (key, opts) => i18n.t(`tech:${key}`, opts);

export function formatTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  // Locale decides 12h (en) vs 24h (pt/es) — the correct localized clock.
  return d.toLocaleTimeString(currentLocaleTag(), { hour: 'numeric', minute: '2-digit' });
}

export function relativeDate(dateStr) {
  if (!dateStr) return '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T12:00:00'); target.setHours(0, 0, 0, 0);
  const diff = Math.round((target - today) / 86400000);
  if (diff === 0) return td('date.today');
  if (diff === 1) return td('date.tomorrow');
  if (diff === -1) return td('date.yesterday');
  if (diff > 1 && diff < 7) return target.toLocaleDateString(currentLocaleTag(), { weekday: 'long' });
  return target.toLocaleDateString(currentLocaleTag(), { month: 'short', day: 'numeric' });
}

// "just now" / "5m ago" / "2h ago" / "Yesterday" / "3d ago" — the relative-time
// helper that was copy-pasted into 4 files; now centralized + localized.
export function relativeTime(isoStr) {
  if (!isoStr) return '';
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return td('date.justNow');
  if (mins < 60) return td('date.minsAgo', { count: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return td('date.hrsAgo', { count: hrs });
  const days = Math.floor(hrs / 24);
  if (days === 1) return td('date.yesterday');
  return td('date.daysAgo', { count: days });
}

// Absolute "Mon 5, 2026"-style date used for loss dates and claim/job meta.
// Was duplicated as formatLossDate/formatDate in 3 tech files.
export function formatLossDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString(currentLocaleTag(), { month: 'short', day: 'numeric', year: 'numeric' });
}

// Insurance + timeline-friendly: always absolute date + time, rendered as
// two lines by callers (date + time).
export function photoDateTime(isoStr) {
  if (!isoStr) return { date: '', time: '' };
  const d = new Date(isoStr);
  const tag = currentLocaleTag();
  const date = d.toLocaleDateString(tag, { month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString(tag, { hour: 'numeric', minute: '2-digit' });
  return { date, time };
}

export function fileUrl(db, filePath) {
  if (!filePath) return null;
  return `${db.baseUrl}/storage/v1/object/public/${filePath}`;
}

export function openMap(address) {
  if (!address) return;
  const encoded = encodeURIComponent(address);
  const url = /iPhone|iPad/.test(navigator.userAgent)
    ? `maps://?q=${encoded}`
    : `https://maps.google.com/?q=${encoded}`;
  window.open(url);
}
