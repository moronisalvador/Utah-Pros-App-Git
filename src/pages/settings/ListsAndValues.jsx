/**
 * ════════════════════════════════════════════════
 * FILE: ListsAndValues.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The "Lists & Values" settings screen — one place to manage the small
 *   option-lists that fill in the app's dropdowns (right now: Insurance
 *   Carriers and Referral Sources). Each list works exactly like it did on
 *   its own page: add, edit, search, or remove an entry. This screen just
 *   stacks them together and reads which lists to show from a small
 *   registry, so a future list can be added without a new page.
 *
 * WHERE IT LIVES:
 *   Route:        /settings/lists
 *   Rendered by:  src/App.jsx (inside SettingsLayout)
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (db), @/lib/managedLists (MANAGED_LISTS),
 *              @/components/settings/LookupTable, @/components/TabLoading
 *   Data:      reads  → get_insurance_carriers, get_referral_sources (RPCs,
 *                        per MANAGED_LISTS entry)
 *              writes → upsert_insurance_carrier / delete_insurance_carrier,
 *                        upsert_referral_source / delete_referral_source
 *                        (RPCs, per MANAGED_LISTS entry)
 *
 * NOTES / GOTCHAS:
 *   - Replaces the standalone Carriers.jsx + Referrals.jsx pages
 *     (Settings Overhaul P10). Old URLs permanently redirect here.
 *   - Each section manages its own load/save/delete independently — one
 *     list's error doesn't affect another's.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { MANAGED_LISTS } from '@/lib/managedLists';
import LookupTable from '@/components/settings/LookupTable';
import TabLoading from '@/components/TabLoading';

const errToast = (msg) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type: 'error' } }));

function ManagedListSection({ list }) {
  const { db } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const rows = await db.rpc(list.getRpc).catch(() => []);
      setItems(rows || []);
    } catch (err) { console.error(`${list.key} load error:`, err); }
    finally { setLoading(false); }
  }, [db, list]);
  useEffect(() => { load(); }, [load]);

  const saveItem = async (item) => {
    try {
      await db.rpc(list.upsertRpc, list.toUpsertParams(item));
      await load();
      return true;
    } catch (err) { errToast('Failed to save: ' + err.message); return false; }
  };
  const deleteItem = async (id) => {
    try {
      await db.rpc(list.deleteRpc, { p_id: id });
      setItems(prev => prev.filter(i => i.id !== id));
      return true;
    } catch (err) { errToast('Failed to delete: ' + err.message); return false; }
  };

  if (loading) return <TabLoading />;

  return (
    <LookupTable
      title={list.title}
      subtitle={`${items.length} ${list.noun}`}
      items={items}
      onSave={saveItem}
      onDelete={deleteItem}
      columns={list.columns}
      newItemDefaults={list.newItemDefaults}
    />
  );
}

export default function ListsAndValues() {
  return (
    <div className="lists-and-values">
      <div className="settings-home-header">
        <h1 className="page-title">Lists &amp; Values</h1>
        <p className="page-subtitle">The option-lists that fill in dropdowns across the app.</p>
      </div>
      {MANAGED_LISTS.map(list => (
        <div key={list.key} className="lists-and-values-section">
          <ManagedListSection list={list} />
        </div>
      ))}
    </div>
  );
}
