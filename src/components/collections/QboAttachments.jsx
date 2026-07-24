/**
 * ════════════════════════════════════════════════
 * FILE: QboAttachments.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The "Attachments" box shown on an invoice or estimate. Staff can attach a file
 *   (a photo, a signed scope, a PDF) that QuickBooks will include on the document it
 *   emails the customer — and the file also shows up on that invoice/estimate inside
 *   QuickBooks. It lists what's already attached and lets an admin/manager remove one.
 *   The file goes straight to QuickBooks through our server; UPR only remembers the
 *   file name and the QuickBooks attachment id (never the file bytes).
 *
 * WHERE IT LIVES:
 *   Route:        n/a (embedded)
 *   Rendered by:  src/pages/InvoiceEditor.jsx, src/pages/EstimateEditor.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext, @/lib/realtime (getAuthHeader), @/lib/toast,
 *              @/hooks/useTwoClickConfirm, @/components/collections/{collKit,collTokens}
 *   Data:      reads  → qbo_attachments (via db.select)
 *              writes → /api/qbo-attach (worker pushes the file to QuickBooks +
 *                       records/removes the qbo_attachments row)
 *
 * NOTES / GOTCHAS:
 *   - Attaching needs the invoice/estimate to already be in QuickBooks (a qbo id);
 *     until then the picker is disabled with a hint.
 *   - Files are pushed with IncludeOnSend=true so they ride along on the QBO email.
 *     Attach BEFORE sending; if already sent, re-send to include a newly-added file.
 *   - Remove uses the two-click confirm (CLAUDE.md Rule 2), never a modal/confirm().
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getAuthHeader } from '@/lib/realtime';
import { ok, err } from '@/lib/toast';
import { useTwoClickConfirm } from '@/hooks/useTwoClickConfirm';
import { CollCard, GhostButton, Skel } from '@/components/collections/collKit';
import { C, STATUS } from '@/components/collections/collTokens';

const MAX_BYTES = 20 * 1024 * 1024; // keep in step with the qbo-attach worker cap
const ACCEPT = 'application/pdf,image/*,.pdf,.jpg,.jpeg,.png,.gif,.heic,.doc,.docx,.xls,.xlsx,.csv,.txt';

const fmtSize = (n) => {
  const b = Number(n || 0);
  if (b <= 0) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
};

const readAsDataUrl = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result || ''));
  r.onerror = () => reject(new Error('Could not read the file'));
  r.readAsDataURL(file);
});

export default function QboAttachments({ entityType, entityId, synced, canEdit }) {
  const { db } = useAuth();
  const dbRef = useRef(db);
  dbRef.current = db;

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  const { isArmed, arm, cancel } = useTwoClickConfirm();

  const filterCol = entityType === 'estimate' ? 'estimate_id' : 'invoice_id';

  const load = useCallback(async () => {
    if (!entityId) return;
    try {
      const data = await dbRef.current.select('qbo_attachments', `${filterCol}=eq.${entityId}&order=created_at.desc`);
      setRows(data || []);
      setLoadError(false);
    } catch {
      // Table not yet migrated, or a transient failure — show a quiet error, never
      // the "no attachments" success-empty state (loading-error-states.md §1).
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [entityId, filterCol]);

  useEffect(() => { load(); }, [load]);

  const pickFile = () => { if (!busy && synced) inputRef.current?.click(); };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_BYTES) { err(`That file is too large (max ${Math.round(MAX_BYTES / 1024 / 1024)} MB).`); return; }
    setBusy(true);
    try {
      const dataUrl = await readAsDataUrl(file);
      const auth = await getAuthHeader();
      const idempotencyKey = crypto?.randomUUID?.() || `att-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const res = await fetch('/api/qbo-attach', {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          entity_type: entityType, id: entityId,
          file_name: file.name, content_type: file.type || 'application/octet-stream',
          file_base64: dataUrl, include_on_send: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      ok(`Attached ${file.name} — QuickBooks will include it when the ${entityType} is sent`);
      await load();
    } catch (e2) {
      err('Couldn’t attach the file: ' + (e2.message || e2));
    } finally {
      setBusy(false);
    }
  };

  const removeAttachment = async (row) => {
    cancel();
    setBusy(true);
    try {
      const auth = await getAuthHeader();
      const res = await fetch('/api/qbo-attach', {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', attachment_id: row.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      ok('Attachment removed');
      await load();
    } catch (e2) {
      err('Couldn’t remove the attachment: ' + (e2.message || e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <CollCard style={{ marginTop: 2 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: C.faint }}>
          Attachments
        </div>
        {canEdit && (
          <GhostButton onClick={pickFile} title={synced ? 'Attach a file to send with this document' : `Save this ${entityType} to QuickBooks first`}
            style={(!synced || busy) ? { opacity: 0.55, pointerEvents: 'none' } : undefined}>
            {busy ? 'Working…' : '📎 Attach file'}
          </GhostButton>
        )}
        <input ref={inputRef} type="file" accept={ACCEPT} style={{ display: 'none' }} onChange={onFile} />
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '2px 0' }}>
          <Skel w="100%" h={16} />
          <Skel w="70%" h={16} />
        </div>
      ) : loadError ? (
        <div style={{ fontSize: 12.5, color: STATUS.danger.text, background: STATUS.danger.tint, border: `1px solid ${STATUS.danger.border}`, borderRadius: 9, padding: '8px 11px' }}>
          Couldn’t load attachments. <button type="button" onClick={() => { setLoading(true); load(); }} style={{ border: 'none', background: 'none', color: STATUS.danger.text, textDecoration: 'underline', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, padding: 0 }}>Retry</button>
        </div>
      ) : rows.length === 0 ? (
        <div style={{ fontSize: 12.5, color: C.faint, padding: '2px 0' }}>
          {synced
            ? 'No files attached. Attach a photo, scope, or PDF to include it when QuickBooks emails this ' + entityType + '.'
            : `Save this ${entityType} to QuickBooks, then attach files to send with it.`}
        </div>
      ) : (
        <div style={{ border: `1px solid ${C.hairline}`, borderRadius: 10, overflow: 'hidden' }}>
          {rows.map((r, i) => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', fontSize: 12.5, borderTop: i === 0 ? 'none' : `1px solid ${C.hairline}` }}>
              <span aria-hidden="true">📎</span>
              <span style={{ flex: 1, minWidth: 0, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.file_name}>
                {r.file_name}
                {r.file_size ? <span style={{ color: C.faint }}> · {fmtSize(r.file_size)}</span> : null}
              </span>
              <span style={{ fontSize: 11, color: r.include_on_send ? STATUS.success.text : C.faint, whiteSpace: 'nowrap' }}>
                {r.include_on_send ? '✓ Sent with document' : 'In QuickBooks only'}
              </span>
              {canEdit && (
                <button type="button" className="coll-ghost" onClick={() => (isArmed(r.id) ? removeAttachment(r) : arm(r.id))} onBlur={cancel} disabled={busy}
                  style={{ fontSize: 12, fontWeight: 600, padding: '4px 9px', whiteSpace: 'nowrap',
                    ...(isArmed(r.id)
                      ? { background: STATUS.danger.tint, color: STATUS.danger.text, border: `1px solid ${STATUS.danger.border}` }
                      : { color: C.muted }) }}>
                  {isArmed(r.id) ? 'Confirm' : 'Remove'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </CollCard>
  );
}
