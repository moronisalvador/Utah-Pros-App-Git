/**
 * ════════════════════════════════════════════════
 * FILE: Referrals.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The "Referral Sources" settings screen — the master list of where leads come
 *   from (insurance, trade partners, digital, etc.). Add, edit, search, or remove
 *   a source. Loads the list when the screen opens and saves changes to the
 *   database.
 *
 * WHERE IT LIVES:
 *   Route:        /settings/referrals
 *   Rendered by:  src/App.jsx (inside SettingsLayout)
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (db), @/components/settings/LookupTable,
 *              @/components/TabLoading
 *   Data:      reads  → get_referral_sources (RPC)
 *              writes → upsert_referral_source / delete_referral_source (RPCs)
 *
 * NOTES / GOTCHAS:
 *   - Behavior-identical extraction of the old Settings.jsx "Referrals" tab
 *     (Settings Overhaul Phase F).
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import LookupTable from '@/components/settings/LookupTable';
import TabLoading from '@/components/TabLoading';

const errToast = (msg) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type: 'error' } }));

const REF_CATEGORIES = [
  { value: 'insurance',   label: 'Insurance'           },
  { value: 'trade',       label: 'Trade'               },
  { value: 'real_estate', label: 'Real Estate'         },
  { value: 'digital',     label: 'Digital / Marketing' },
  { value: 'traditional', label: 'Traditional'         },
  { value: 'personal',    label: 'Personal'            },
  { value: 'program',     label: 'Program / Network'   },
  { value: 'emergency',   label: 'Emergency'           },
  { value: 'other',       label: 'Other'               },
];

export default function Referrals() {
  const { db } = useAuth();
  const [referrals, setReferrals] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await db.rpc('get_referral_sources').catch(() => []);
      setReferrals(r || []);
    } catch (err) { console.error('Referrals load error:', err); }
    finally { setLoading(false); }
  }, [db]);
  useEffect(() => { load(); }, [load]);

  const saveReferral = async (item) => {
    try {
      const p = { p_name: item.name, p_category: item.category || 'other', p_sort_order: item.sort_order || 999 };
      if (item.id) p.p_id = item.id;
      await db.rpc('upsert_referral_source', p); await load(); return true;
    } catch (err) { errToast('Failed to save: ' + err.message); return false; }
  };
  const deleteReferral = async (id) => {
    try { await db.rpc('delete_referral_source', { p_id: id }); setReferrals(prev => prev.filter(r => r.id !== id)); return true; }
    catch (err) { errToast('Failed to delete: ' + err.message); return false; }
  };

  if (loading) return <TabLoading />;

  return (
    <LookupTable
      title="Referral Sources"
      subtitle={`${referrals.length} sources`}
      items={referrals}
      onSave={saveReferral}
      onDelete={deleteReferral}
      columns={[
        { key: 'name', label: 'Source Name', flex: 3, required: true },
        { key: 'category', label: 'Category', flex: 2, type: 'select', options: REF_CATEGORIES },
        { key: 'sort_order', label: 'Order', flex: 0.5, type: 'number', placeholder: '999' },
      ]}
      newItemDefaults={{ name: '', category: 'other', sort_order: 999 }}
    />
  );
}
