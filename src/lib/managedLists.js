/**
 * ════════════════════════════════════════════════
 * FILE: managedLists.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The registry that powers the "Lists & Values" settings page. Each entry
 *   describes one option-list (like Insurance Carriers or Referral Sources) —
 *   its title, its table columns, and which database functions load, save,
 *   and delete its rows. Adding a future list to the page means adding one
 *   entry here, not building a new page.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (a plain data module)
 *   Rendered by:  n/a — imported by src/pages/settings/ListsAndValues.jsx
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      reads → none · writes → none (the RPC names are consumed by
 *              the page, which does the actual db.rpc() calls)
 *
 * NOTES / GOTCHAS:
 *   - toUpsertParams maps a LookupTable row to the exact RPC param shape,
 *     since each list's RPC has different parameter names.
 *   - Behavior-identical port of the old Carriers.jsx / Referrals.jsx logic
 *     (Settings Overhaul P10).
 * ════════════════════════════════════════════════
 */

const REFERRAL_CATEGORIES = [
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

export const MANAGED_LISTS = [
  {
    key: 'carriers',
    title: 'Insurance Carriers',
    noun: 'carriers',
    getRpc: 'get_insurance_carriers',
    upsertRpc: 'upsert_insurance_carrier',
    deleteRpc: 'delete_insurance_carrier',
    columns: [
      { key: 'name', label: 'Carrier Name', flex: 3, required: true },
      { key: 'short_name', label: 'Code', flex: 1, placeholder: 'SF' },
      { key: 'sort_order', label: 'Order', flex: 0.5, type: 'number', placeholder: '999' },
    ],
    newItemDefaults: { name: '', short_name: '', sort_order: 999 },
    toUpsertParams: (item) => {
      const p = { p_name: item.name, p_short_name: item.short_name || null, p_sort_order: item.sort_order || 999 };
      if (item.id) p.p_id = item.id;
      return p;
    },
  },
  {
    key: 'referrals',
    title: 'Referral Sources',
    noun: 'sources',
    getRpc: 'get_referral_sources',
    upsertRpc: 'upsert_referral_source',
    deleteRpc: 'delete_referral_source',
    columns: [
      { key: 'name', label: 'Source Name', flex: 3, required: true },
      { key: 'category', label: 'Category', flex: 2, type: 'select', options: REFERRAL_CATEGORIES },
      { key: 'sort_order', label: 'Order', flex: 0.5, type: 'number', placeholder: '999' },
    ],
    newItemDefaults: { name: '', category: 'other', sort_order: 999 },
    toUpsertParams: (item) => {
      const p = { p_name: item.name, p_category: item.category || 'other', p_sort_order: item.sort_order || 999 };
      if (item.id) p.p_id = item.id;
      return p;
    },
  },
];
