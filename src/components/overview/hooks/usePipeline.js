/**
 * ════════════════════════════════════════════════
 * FILE: usePipeline.js
 * ════════════════════════════════════════════════
 * WHAT THIS DOES: Feeds the "Production pipeline" card — how many jobs sit in each
 *   active stage. The greyed future lanes (Contents/Reconstruction/Remodeling) are
 *   static design placeholders and stay as-is.
 * RENDERED BY: Widgets.jsx (ProductionPipeline) via Dashboard.jsx
 * DEPENDS ON: react · @/contexts/AuthContext · ../tokens
 *   Data: reads → RPC get_pipeline_summary (jobs + invoices) · writes → none
 * ════════════════════════════════════════════════
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { PLACEHOLDER } from '../tokens';

const POLL_MS = 60000;

export function usePipeline() {
  const { db } = useAuth();
  const [state, setState] = useState({ data: null, loading: true, error: null });

  const load = useCallback(async () => {
    try {
      const r = await db.rpc('get_pipeline_summary');
      const stages = Array.isArray(r?.stages) ? r.stages : [];
      const max = Math.max(...stages.map(s => Number(s.count) || 0), 1);
      const active = stages.map(s => {
        const count = Number(s.count) || 0;
        return { label: s.label, count, pct: max > 0 ? (count / max) * 100 : 0, kind: s.label === 'Paid' ? 'success' : 'info' };
      });
      setState({ data: { active, future: PLACEHOLDER.pipeline.future }, loading: false, error: null });
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
