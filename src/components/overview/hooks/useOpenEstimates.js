/**
 * ════════════════════════════════════════════════
 * FILE: useOpenEstimates.js — "Open estimates" donut data (count + $ of not-yet-
 *   decided estimates, split by division). Reads RPC get_open_estimates_summary.
 *   Empty until estimates are used. Donut slice %s derived from each bucket's share.
 * ════════════════════════════════════════════════
 */
import { useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { DIV } from '../tokens';
import { fmtK, fmtFull } from './dashUtils';
import { usePolledRpc } from './usePolledRpc';

const META = {
  mitigation:     { label: 'Mitigation',     sub: 'water / fire / contents', color: DIV.mitigation },
  reconstruction: { label: 'Reconstruction', sub: 'reconstruction',          color: DIV.reconstruction },
  mold:           { label: 'Mold',           sub: 'remediation',             color: DIV.mold },
  remodeling:     { label: 'Remodel',        sub: 'homeowner-pay',           color: DIV.remodeling },
};
const ORDER = ['mitigation', 'mold', 'reconstruction', 'remodeling'];

export function useOpenEstimates() {
  const { db } = useAuth();
  const load = useCallback(async () => {
    const r = await db.rpc('get_open_estimates_summary');
    const total = Number(r?.total_count) || 0;
    const byKey = Object.fromEntries((r?.segments || []).map(s => [s.key, s]));
    let acc = 0;
    const slices = [];
    for (const key of ORDER) {
      const seg = byKey[key];
      const count = Number(seg?.count) || 0;
      if (count <= 0) continue;
      const frac = total > 0 ? (count / total) * 100 : 0;
      const m = META[key];
      slices.push({ key, label: m.label, sub: m.sub, count, value: fmtK(Number(seg.value) || 0), color: m.color, from: acc, to: acc + frac });
      acc += frac;
    }
    return { total, totalValue: fmtFull(Number(r?.total_value) || 0), slices };
  }, [db]);
  return usePolledRpc(load);
}
