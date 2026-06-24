/**
 * ════════════════════════════════════════════════
 * FILE: useActionItems.js
 * ════════════════════════════════════════════════
 * WHAT THIS DOES: Feeds the "Action required" list. Today it surfaces documents
 *   awaiting signature (CoC, work auth, direction-to-pay, recon agreement), oldest
 *   first. Designed to grow as more action sources come online.
 * RENDERED BY: Widgets.jsx (ActionRequired) via Dashboard.jsx
 * DEPENDS ON: react · @/contexts/AuthContext
 *   Data: reads → RPC get_dashboard_action_items (sign_requests + jobs) · writes → none
 * ════════════════════════════════════════════════
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';

const POLL_MS = 60000;
const GLYPH = { esign: '✎', warning: '!', success: '✓', danger: '↑' };
const KIND_TINT = { esign: 'info', warning: 'warning', success: 'success', danger: 'danger' };

export function useActionItems() {
  const { db } = useAuth();
  const [state, setState] = useState({ data: null, loading: true, error: null });

  const load = useCallback(async () => {
    try {
      const raw = await db.rpc('get_dashboard_action_items', { p_limit: 8 });
      const list = Array.isArray(raw) ? raw : [];
      const items = list.map(a => ({
        job: a.job || '—',
        glyph: GLYPH[a.kind] || '!',
        kind: KIND_TINT[a.kind] || 'warning',
        text: a.text,
        sub: a.sub,
      }));
      setState({
        data: { items, summary: `${items.length} open task${items.length === 1 ? '' : 's'}` },
        loading: false,
        error: null,
      });
    } catch (e) {
      setState(s => ({ ...s, loading: false, error: e }));
    }
  }, [db]);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  return state;
}
