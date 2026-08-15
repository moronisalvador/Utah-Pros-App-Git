/**
 * ════════════════════════════════════════════════
 * FILE: QboAttachments.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Shows the metadata for files already associated with an invoice or estimate
 *   in QuickBooks. Attachment changes are deliberately unavailable while durable
 *   QuickBooks reconciliation is completed.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (embedded)
 *   Rendered by:  src/pages/InvoiceEditor.jsx, src/pages/EstimateEditor.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext, @/components/collections/{collKit,collTokens}
 *   Data:      reads → qbo_attachments (via db.select)
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This is intentionally a read-only containment seam for P4c. Do not add an
 *     upload, delete, worker request, or client-side mutation here without an
 *     explicitly reviewed reconciliation design.
 * ════════════════════════════════════════════════
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { CollCard, Skel } from '@/components/collections/collKit';
import { C, STATUS } from '@/components/collections/collTokens';

const fmtSize = (n) => {
  const b = Number(n || 0);
  if (b <= 0) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
};

export default function QboAttachments({ entityType, entityId }) {
  const { db } = useAuth();
  const dbRef = useRef(db);
  dbRef.current = db;

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const requestEpochRef = useRef(0);
  const mountedRef = useRef(true);
  const filterCol = entityType === 'estimate' ? 'estimate_id' : 'invoice_id';

  const load = useCallback(async ({ epoch = requestEpochRef.current } = {}) => {
    const isCurrent = () => mountedRef.current && epoch === requestEpochRef.current;
    if (!entityId) {
      if (!isCurrent()) return;
      setRows([]);
      setLoadError(false);
      setLoading(false);
      return;
    }
    try {
      const data = await dbRef.current.select('qbo_attachments', `${filterCol}=eq.${entityId}&order=created_at.desc`);
      if (!isCurrent()) return;
      setRows(data || []);
      setLoadError(false);
    } catch {
      if (!isCurrent()) return;
      // A failed load must never become the successful empty state.
      setLoadError(true);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [entityId, filterCol]);

  useEffect(() => {
    const epoch = ++requestEpochRef.current;
    // Route-owned state must not leak into the next invoice/estimate while its
    // metadata request is still in flight.
    setRows([]);
    setLoadError(false);
    setLoading(true);
    load({ epoch });
  }, [load]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestEpochRef.current += 1;
    };
  }, []);

  return (
    <CollCard style={{ marginTop: 2 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: C.faint }}>
          Attachments
        </div>
      </div>

      <p role="status" style={{ fontSize: 12.5, color: C.muted, margin: '0 0 10px' }}>
        Attachment changes are temporarily unavailable while durable QuickBooks reconciliation is completed.
      </p>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '2px 0' }}>
          <Skel w="100%" h={16} />
          <Skel w="70%" h={16} />
        </div>
      ) : loadError ? (
        <div role="alert" style={{ fontSize: 12.5, color: STATUS.danger.text, background: STATUS.danger.tint, border: `1px solid ${STATUS.danger.border}`, borderRadius: 9, padding: '8px 11px' }}>
          Couldn’t load attachments. <button type="button" onClick={load} style={{ border: 'none', background: 'none', color: STATUS.danger.text, textDecoration: 'underline', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, padding: 0 }}>Retry</button>
        </div>
      ) : rows.length === 0 ? (
        <div style={{ fontSize: 12.5, color: C.faint, padding: '2px 0' }}>
          No attachment metadata is available for this {entityType}.
        </div>
      ) : (
        <div aria-label="QuickBooks attachment metadata" style={{ border: `1px solid ${C.hairline}`, borderRadius: 10, overflow: 'hidden' }}>
          {rows.map((r, i) => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', fontSize: 12.5, borderTop: i === 0 ? 'none' : `1px solid ${C.hairline}` }}>
              <span aria-hidden="true">📎</span>
              <span style={{ flex: 1, minWidth: 0, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.file_name}>
                {r.file_name}
                {r.file_size ? <span style={{ color: C.faint }}> · {fmtSize(r.file_size)}</span> : null}
              </span>
              <span style={{ fontSize: 11, color: r.include_on_send ? STATUS.success.text : C.faint, whiteSpace: 'nowrap' }}>
                {r.include_on_send ? 'Included when sent' : 'In QuickBooks only'}
              </span>
            </div>
          ))}
        </div>
      )}
    </CollCard>
  );
}
