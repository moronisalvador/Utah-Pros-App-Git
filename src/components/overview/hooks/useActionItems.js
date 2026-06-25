/**
 * ════════════════════════════════════════════════
 * FILE: useActionItems.js — "Action required" list (documents awaiting signature,
 *   oldest first). Reads RPC get_dashboard_action_items. Carries jobId so rows can
 *   deep-link to /jobs/:id. Designed to grow as more action sources come online.
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
      glyph: GLYPH[a.kind] || '!',
      kind: KIND_TINT[a.kind] || 'warning',
      text: a.text,
      sub: a.sub,
    }));
    return { items, summary: `${items.length} open task${items.length === 1 ? '' : 's'}` };
  }, [db]);
  return usePolledRpc(load);
}
