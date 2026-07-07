/**
 * ════════════════════════════════════════════════
 * FILE: NotificationPrefsMatrix.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Shows a grid of notification choices: one row per kind of notification
 *   (a new text, an appointment change, …) and one checkbox per channel
 *   (in-app bell, phone push, email). The person ticks the boxes to choose how
 *   they want to hear about each thing. Rows an administrator has locked show a
 *   greyed, un-tickable box with a small lock note. It works for both the office
 *   Settings page and the field-tech Settings screen — the caller passes a
 *   `variant` to pick the right look and, for techs, a short list of which
 *   categories to show.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (rendered inside /settings and /tech/settings)
 *   Rendered by:  src/pages/Settings.jsx (NotificationsPanel) and
 *                 src/components/tech/settings/NotificationsSection.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/lib/toast (toast)
 *   Data:      reads  → get_my_notification_prefs RPC (via the passed-in db)
 *              writes → set_my_notification_pref RPC (via the passed-in db)
 *
 * NOTES / GOTCHAS:
 *   - Reads THROUGH the frozen resolver (get_my_notification_prefs →
 *     get_effective_notification_prefs), so only LIVE types (enabled=true) ever
 *     appear. Until Session B flips a type on, the grid can legitimately be empty
 *     — that's the honest state, and we render an empty note.
 *   - Toggles are optimistic: the box flips immediately, and reverts with a toast
 *     if the save fails (e.g. the row was locked between load and click).
 *   - Locked cells (user_customizable=false) render a disabled box + lock hint;
 *     the server ALSO rejects a locked write, so this is defence-in-depth, not the
 *     only guard.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from '@/lib/toast';

const CHANNELS = ['bell', 'push', 'email'];

// Group the flat resolver rows (one per type×channel) into one row per type with
// a { bell, push, email } cell map. Preserves the resolver's sort order.
function groupByType(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.type_key)) {
      map.set(r.type_key, {
        type_key: r.type_key, label: r.label, category: r.category, cells: {},
      });
    }
    map.get(r.type_key).cells[r.channel] = {
      enabled: !!r.enabled,
      customizable: r.user_customizable !== false,
    };
  }
  return [...map.values()];
}

export default function NotificationPrefsMatrix({
  db,
  employeeId,
  variant = 'office',          // 'office' | 'tech'
  categoryFilter = null,       // array of category keys to keep, or null = all
  typeFilter = null,           // array of type_keys to ALSO keep (union with categoryFilter) — lets a
                               // caller surface one type from an otherwise-hidden category
  labels = {},
}) {
  const L = {
    channelBell: 'Bell', channelPush: 'Push', channelEmail: 'Email',
    empty: 'No notification types are turned on for your account yet.',
    locked: 'Locked by an administrator',
    loadError: 'Could not load your notification preferences.',
    saveError: 'Could not save that change — please try again.',
    ...labels,
  };

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);       // grouped-by-type
  const [savingKey, setSavingKey] = useState(null); // `${type}:${channel}` in flight

  const load = useCallback(async () => {
    if (!employeeId) { setLoading(false); return; }
    setLoading(true);
    try {
      const raw = await db.rpc('get_my_notification_prefs', { p_employee_id: employeeId });
      setRows(groupByType(raw || []));
    } catch {
      toast(L.loadError, 'error');
      setRows([]);
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, employeeId]);
  useEffect(() => { load(); }, [load]);

  const visibleRows = useMemo(() => {
    if (!categoryFilter && !typeFilter) return rows;
    const cats = categoryFilter ? new Set(categoryFilter) : null;
    const types = typeFilter ? new Set(typeFilter) : null;
    // Keep a row if its category is allowed OR its specific type is allowed.
    return rows.filter(r => (cats && cats.has(r.category)) || (types && types.has(r.type_key)));
  }, [rows, categoryFilter, typeFilter]);

  const toggle = async (typeKey, channel, current) => {
    const key = `${typeKey}:${channel}`;
    setSavingKey(key);
    // Optimistic flip.
    setRows(prev => prev.map(r => r.type_key === typeKey
      ? { ...r, cells: { ...r.cells, [channel]: { ...r.cells[channel], enabled: !current } } }
      : r));
    try {
      await db.rpc('set_my_notification_pref', {
        p_employee_id: employeeId, p_type_key: typeKey, p_channel: channel, p_enabled: !current,
      });
    } catch {
      // Revert on failure.
      setRows(prev => prev.map(r => r.type_key === typeKey
        ? { ...r, cells: { ...r.cells, [channel]: { ...r.cells[channel], enabled: current } } }
        : r));
      toast(L.saveError, 'error');
    } finally { setSavingKey(null); }
  };

  const cls = variant === 'tech' ? 'notif-matrix notif-matrix--tech' : 'notif-matrix';

  if (loading) return <div className="notif-matrix-loading">…</div>;
  if (!visibleRows.length) return <div className="notif-matrix-empty">{L.empty}</div>;

  // ─── Render ──────────────
  return (
    <div className={cls} role="table" aria-label="Notification preferences">
      <div className="notif-matrix-head" role="row">
        <div className="notif-matrix-type-h" role="columnheader" />
        {CHANNELS.map(ch => (
          <div key={ch} className="notif-matrix-ch-h" role="columnheader">
            {ch === 'bell' ? L.channelBell : ch === 'push' ? L.channelPush : L.channelEmail}
          </div>
        ))}
      </div>

      {visibleRows.map(row => (
        <div key={row.type_key} className="notif-matrix-row" role="row">
          <div className="notif-matrix-type" role="cell">{row.label}</div>
          {CHANNELS.map(ch => {
            const cell = row.cells[ch] || { enabled: false, customizable: true };
            const locked = !cell.customizable;
            const busy = savingKey === `${row.type_key}:${ch}`;
            return (
              <div key={ch} className="notif-matrix-cell" role="cell">
                <label className={`notif-check${locked ? ' notif-check--locked' : ''}`}
                       title={locked ? L.locked : undefined}>
                  <input
                    type="checkbox"
                    checked={cell.enabled}
                    disabled={locked || busy}
                    onChange={() => toggle(row.type_key, ch, cell.enabled)}
                    aria-label={`${row.label} — ${ch}${locked ? ` (${L.locked})` : ''}`}
                  />
                  {locked && <span className="notif-lock" aria-hidden="true">🔒</span>}
                </label>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
