// Small date/time + file helpers shared by tech pages.

export function formatTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 || 12;
  return `${hh}:${String(m).padStart(2, '0')} ${period}`;
}

export function relativeDate(dateStr) {
  if (!dateStr) return '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T12:00:00'); target.setHours(0, 0, 0, 0);
  const diff = Math.round((target - today) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return target.toLocaleDateString('en-US', { weekday: 'long' });
  return target.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Insurance + timeline-friendly: always absolute date + time, rendered as
// two lines by callers (date + time).
export function photoDateTime(isoStr) {
  if (!isoStr) return { date: '', time: '' };
  const d = new Date(isoStr);
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
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
