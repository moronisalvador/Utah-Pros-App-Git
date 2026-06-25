/**
 * ════════════════════════════════════════════════
 * FILE: usePipeline.js — "Production pipeline" card data (job count per active
 *   stage). Reads RPC get_pipeline_summary. The greyed future lanes are static
 *   design placeholders (from tokens) and stay as-is.
 * ════════════════════════════════════════════════
 */
import { useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { PLACEHOLDER } from '../tokens';
import { usePolledRpc } from './usePolledRpc';

export function usePipeline() {
  const { db } = useAuth();
  const load = useCallback(async () => {
    const r = await db.rpc('get_pipeline_summary');
    const stages = Array.isArray(r?.stages) ? r.stages : [];
    const max = Math.max(...stages.map(s => Number(s.count) || 0), 1);
    const active = stages.map(s => {
      const count = Number(s.count) || 0;
      return { label: s.label, count, pct: max > 0 ? (count / max) * 100 : 0, kind: s.label === 'Paid' ? 'success' : 'info' };
    });
    return { active, future: PLACEHOLDER.pipeline.future };
  }, [db]);
  return usePolledRpc(load);
}
