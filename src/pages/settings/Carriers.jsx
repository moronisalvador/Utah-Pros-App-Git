/**
 * ════════════════════════════════════════════════
 * FILE: Carriers.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The "Insurance Carriers" settings screen — the master list of insurance
 *   companies used across claims and jobs. Add, edit, search, or remove a
 *   carrier. Loads the list when the screen opens and saves changes to the
 *   database.
 *
 * WHERE IT LIVES:
 *   Route:        /settings/carriers
 *   Rendered by:  src/App.jsx (inside SettingsLayout)
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (db), @/components/settings/LookupTable,
 *              @/components/TabLoading
 *   Data:      reads  → get_insurance_carriers (RPC)
 *              writes → upsert_insurance_carrier / delete_insurance_carrier (RPCs)
 *
 * NOTES / GOTCHAS:
 *   - Behavior-identical extraction of the old Settings.jsx "Carriers" tab
 *     (Settings Overhaul Phase F).
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import LookupTable from '@/components/settings/LookupTable';
import TabLoading from '@/components/TabLoading';

const errToast = (msg) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type: 'error' } }));

export default function Carriers() {
  const { db } = useAuth();
  const [carriers, setCarriers] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const c = await db.rpc('get_insurance_carriers').catch(() => []);
      setCarriers(c || []);
    } catch (err) { console.error('Carriers load error:', err); }
    finally { setLoading(false); }
  }, [db]);
  useEffect(() => { load(); }, [load]);

  const saveCarrier = async (item) => {
    try {
      const p = { p_name: item.name, p_short_name: item.short_name || null, p_sort_order: item.sort_order || 999 };
      if (item.id) p.p_id = item.id;
      await db.rpc('upsert_insurance_carrier', p); await load(); return true;
    } catch (err) { errToast('Failed to save: ' + err.message); return false; }
  };
  const deleteCarrier = async (id) => {
    try { await db.rpc('delete_insurance_carrier', { p_id: id }); setCarriers(prev => prev.filter(c => c.id !== id)); return true; }
    catch (err) { errToast('Failed to delete: ' + err.message); return false; }
  };

  if (loading) return <TabLoading />;

  return (
    <LookupTable
      title="Insurance Carriers"
      subtitle={`${carriers.length} carriers`}
      items={carriers}
      onSave={saveCarrier}
      onDelete={deleteCarrier}
      columns={[
        { key: 'name', label: 'Carrier Name', flex: 3, required: true },
        { key: 'short_name', label: 'Code', flex: 1, placeholder: 'SF' },
        { key: 'sort_order', label: 'Order', flex: 0.5, type: 'number', placeholder: '999' },
      ]}
      newItemDefaults={{ name: '', short_name: '', sort_order: 999 }}
    />
  );
}
