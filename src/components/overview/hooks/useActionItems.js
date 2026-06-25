/**
 * ════════════════════════════════════════════════
 * FILE: useActionItems.js — "Action required" list (documents awaiting signature,
 *   oldest first). Reads RPC get_dashboard_action_items. Each row carries the
 *   customer name + job address (so the owner can tell who a row is for at a
 *   glance) and jobId so rows deep-link to /jobs/:id. Grows as more action
 *   sources come online.
 * ════════════════════════════════════════════════
 */
import { useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { usePolledRpc } from './usePolledRpc';

const GLYPH = { esign: '✎', warning: '!', success: '✓', danger: '↑' };
const KIND_TINT = { esign: 'info', warning: 'warning', success: 'success', danger: 'danger' };

export function useActionItems() {
  const { db } = useAuth();
  const load = useCallback(async () => {
    const raw = await db.rpc('get_dashboard_action_items', { p_limit: 8 });
    const list = Array.isArray(raw) ? raw : [];
    const items = list.map(a => ({
      jobId: a.job_id || null,
      job: a.job || '—',
      client: a.client || '',
      address: a.address || '',
      glyph: GLYPH[a.kind] || '!',
      kind: KIND_TINT[a.kind] || 'warning',
      text: a.text,
      sub: a.sub,
    }));
    return { items, summary: `${items.length} open task${items.length === 1 ? '' : 's'}` };
  }, [db]);
  return usePolledRpc(load);
}
