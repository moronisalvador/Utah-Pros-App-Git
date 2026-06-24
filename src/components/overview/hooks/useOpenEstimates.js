/**
 * ════════════════════════════════════════════════
 * FILE: useOpenEstimates.js
 * ════════════════════════════════════════════════
 * WHAT THIS DOES: Feeds the "Open estimates" donut — count + dollar value of
 *   not-yet-decided estimates, split by division. Empty until estimates are used.
 * RENDERED BY: Widgets.jsx (OpenEstimates) via Dashboard.jsx
 * DEPENDS ON: react · @/contexts/AuthContext · ../tokens · ./dashUtils
 *   Data: reads → RPC get_open_estimates_summary (estimates + jobs) · writes → none
 * NOTES: donut slice from/to %s are derived from each bucket's share of the count.
 * ════════════════════════════════════════════════
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { DIV } from '../tokens';
import { fmtK, fmtFull } from './dashUtils';

const POLL_MS = 60000;
const META = {
  mitigation:     { label: 'Mitigation',     sub: 'water / fire / contents', color: DIV.mitigation },
  reconstruction: { label: 'Reconstruction', sub: 'reconstruction',          color: DIV.reconstruction },
  mold:           { label: 'Mold',           sub: 'remediation',             color: DIV.mold },
  remodeling:     { label: 'Remodel',        sub: 'homeowner-pay',           color: DIV.remodeling },
};
const ORDER = ['mitigation', 'mold', 'reconstruction', 'remodeling'];

export function useOpenEstimates() {
  const { db } = useAuth();
  const [state, setState] = useState({ data: null, loading: true, error: null });

  const load = useCallback(async () => {
    try {
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
      setState({ data: { total, totalValue: fmtFull(Number(r?.total_value) || 0), slices }, loading: false, error: null });
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
