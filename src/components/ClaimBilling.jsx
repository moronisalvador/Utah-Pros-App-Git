import { useState, useEffect, useCallback } from 'react';
import { getAuthHeader } from '@/lib/realtime';

const toast = (m, t = 'success') => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: m, type: t } }));
const fmt$ = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Claim-page billing section: one invoice per job (= per division), pushed to
// QuickBooks. Create draft → type the amount → it saves and syncs to QuickBooks
// automatically (auto-push, Phase 0.5). Editing a synced invoice re-syncs it.
export default function ClaimBilling({ jobs, db, canEdit }) {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);            // id currently acting on
  const [amounts, setAmounts] = useState({});        // invoice_id -> input value

  const jobIds = (jobs || []).map(j => j.id);
  const jobIdsKey = jobIds.join(',');

  const load = useCallback(async () => {
    if (!jobIdsKey) { setInvoices([]); setLoading(false); return; }
    setLoading(true);
    try {
      const rows = await db.select('invoices', `job_id=in.(${jobIdsKey})&select=*&order=created_at.asc`);
      setInvoices(rows || []);
    } catch {
      toast('Failed to load invoices', 'error');
    } finally {
      setLoading(false);
    }
  }, [db, jobIdsKey]);

  useEffect(() => { load(); }, [load]);

  const invByJob = {};
  invoices.forEach(inv => { if (!invByJob[inv.job_id]) invByJob[inv.job_id] = inv; });

  const createInvoice = async (jobId) => {
    setBusy(jobId);
    try {
      await db.rpc('create_invoice_for_job', { p_job_id: jobId });
      await load();
      toast('Draft invoice created — enter an amount to sync it to QuickBooks');
    } catch (e) { toast('Failed to create invoice: ' + (e.message || e), 'error'); }
    finally { setBusy(null); }
  };

  // Low-level call to the QBO worker (create/update auto-detected server-side; or delete).
  const postInvoice = async (inv, body) => {
    const auth = await getAuthHeader();
    const res = await fetch('/api/qbo-invoice', {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoice_id: inv.id, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  };

  // Autosave + auto-push: fired on blur / Enter. Saves the amount, then pushes to
  // QBO (creating or updating). A $0 draft is saved locally but not sent to QBO.
  const saveAndSync = async (inv) => {
    const raw = amounts[inv.id];
    if (raw == null || raw === '') return;
    const amt = Number(raw);
    if (!(amt >= 0)) { toast('Enter a valid amount', 'error'); return; }

    const changed = Number(inv.total) !== amt;
    const synced = !!inv.qbo_invoice_id;
    if (!changed && synced && !inv.qbo_sync_error) {     // nothing to do
      setAmounts(a => { const n = { ...a }; delete n[inv.id]; return n; });
      return;
    }

    setBusy(inv.id);
    try {
      if (changed) await db.update('invoices', `id=eq.${inv.id}`, { subtotal: amt, total: amt });
      setAmounts(a => { const n = { ...a }; delete n[inv.id]; return n; });
      if (amt > 0) {
        const data = await postInvoice(inv, {});
        toast(data.mode === 'updated' ? 'Updated in QuickBooks' : `Pushed to QuickBooks (#${data.qbo_invoice_id})`);
      } else {
        toast('Saved as draft — enter an amount above $0 to sync to QuickBooks');
      }
      await load();
    } catch (e) {
      toast('QuickBooks: ' + e.message, 'error');
      await load();                                       // surface qbo_sync_error
    } finally {
      setBusy(null);
    }
  };

  const removeFromQbo = async (inv) => {
    setBusy(inv.id);
    try {
      await postInvoice(inv, { action: 'delete' });
      toast('Removed from QuickBooks');
      await load();
    } catch (e) { toast('QuickBooks: ' + e.message, 'error'); }
    finally { setBusy(null); }
  };

  if (loading) return <div style={{ padding: 12, color: 'var(--text-tertiary)', fontSize: 13 }}>Loading billing…</div>;
  if (!jobs?.length) return <div style={{ padding: 12, color: 'var(--text-tertiary)', fontSize: 13 }}>No jobs on this claim yet.</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {jobs.map(job => {
        const inv = invByJob[job.id];
        const synced = !!inv?.qbo_invoice_id;
        const isBusy = busy === inv?.id;
        const division = job.division ? String(job.division).replace(/_/g, ' ') : 'Job';

        // Status chip (Syncing → Error → Synced → Draft)
        const chip = isBusy
          ? { label: 'Syncing…', bg: 'var(--accent-light)', color: 'var(--accent)', border: '#bfdbfe' }
          : inv?.qbo_sync_error
            ? { label: 'Error', bg: '#fef2f2', color: '#dc2626', border: '#fecaca', title: inv.qbo_sync_error }
            : synced
              ? { label: `QuickBooks #${inv.qbo_invoice_id}`, bg: '#f0fdf4', color: '#16a34a', border: '#bbf7d0' }
              : inv
                ? { label: 'Draft', bg: 'var(--bg-tertiary)', color: 'var(--text-tertiary)', border: 'var(--border-light)' }
                : null;

        return (
          <div key={job.id} style={{ border: '1px solid var(--border-light)', borderRadius: 'var(--radius-md)', padding: '10px 12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', textTransform: 'capitalize' }}>
                  {division} · {job.job_number || '—'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
                  {inv ? `${inv.invoice_number} · ${fmt$(inv.total)} · ${inv.status}` : 'No invoice yet'}
                </div>
              </div>
              {chip && (
                <span title={chip.title} style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 'var(--radius-full)', background: chip.bg, color: chip.color, border: `1px solid ${chip.border}`, cursor: chip.title ? 'help' : 'default', whiteSpace: 'nowrap' }}>
                  {chip.label}
                </span>
              )}
            </div>

            {canEdit && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                {!inv ? (
                  <button className="btn btn-secondary btn-sm" disabled={busy === job.id} onClick={() => createInvoice(job.id)}>
                    {busy === job.id ? 'Creating…' : 'Create invoice'}
                  </button>
                ) : (
                  <>
                    <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>$</span>
                    <input
                      type="number" inputMode="decimal" placeholder={String(inv.total || 0)}
                      value={amounts[inv.id] ?? ''} disabled={isBusy}
                      onChange={e => setAmounts(a => ({ ...a, [inv.id]: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                      onBlur={() => saveAndSync(inv)}
                      style={{ width: 120, padding: '6px 8px', fontSize: 13, border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
                    />
                    {synced && (
                      <button className="btn btn-secondary btn-sm" disabled={isBusy} onClick={() => removeFromQbo(inv)}>
                        {isBusy ? '…' : 'Remove from QuickBooks'}
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}

      {canEdit && (
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', padding: '2px 2px 0' }}>
          Amounts save and sync to QuickBooks automatically — edits to a synced invoice update it in QuickBooks.
        </div>
      )}
    </div>
  );
}
