/**
 * ════════════════════════════════════════════════
 * FILE: PdfGapsPanel.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A small collapsible box on the Scope Sheet Builder page that lists any
 *   submitted field-tech scope sheet whose PDF never made it into the job's
 *   Files tab. This surfaces a failure that used to be completely silent —
 *   a tech could submit a sheet, the office would never see the PDF, and
 *   nobody would know until a customer asked about it directly.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (rendered inside /settings/scope-sheets)
 *   Rendered by:  src/pages/settings/ScopeSheets.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  none
 *   Data:      reads → get_demo_sheet_pdf_gaps RPC (forms + job_documents,
 *                       read-only comparison — no writes)
 *
 * NOTES / GOTCHAS:
 *   - Loads once on mount (cold-start only, per page-lifecycle.md) — this is
 *     an admin tool a person opens to check, not a live dashboard, so no
 *     polling.
 *   - A failed load shows an inline error, never a false "no gaps" empty
 *     state (loading-error-states.md).
 * ════════════════════════════════════════════════
 */

import { useEffect, useState } from 'react';

export default function PdfGapsPanel({ db, navigate }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [gaps, setGaps] = useState([]);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const rows = await db.rpc('get_demo_sheet_pdf_gaps');
      setGaps(rows || []);
      setLoaded(true);
    } catch (e) {
      setLoadError(e.message || 'Failed to check for gaps');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && !loaded && !loading) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const count = gaps.length;

  return (
    <div style={{
      background: 'var(--bg-primary)', border: `1px solid ${count > 0 && loaded ? 'var(--ss-warning-border, var(--border-color))' : 'var(--border-color)'}`,
      borderRadius: 'var(--radius-lg)', marginBottom: 'var(--space-4)', overflow: 'hidden',
    }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 14px', background: 'transparent', border: 'none', cursor: 'pointer',
          fontFamily: 'var(--font-sans)', textAlign: 'left',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
            Missing PDF attachments
          </span>
          {loaded && count > 0 && (
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999,
              background: 'var(--ss-warning-bg, var(--bg-secondary))', color: 'var(--ss-warning, var(--text-primary))',
              border: '1px solid var(--ss-warning-border, var(--border-color))',
            }}>
              {count}
            </span>
          )}
          {loaded && count === 0 && (
            <span style={{ fontSize: 11, color: 'var(--ss-success, var(--text-tertiary))' }}>none found</span>
          )}
        </div>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{ borderTop: '1px solid var(--border-light)', padding: '12px 14px' }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>
            Submitted scope sheets whose PDF never landed on the job's Files tab
            (usually a transient upload failure). Resend from the sheet itself to fix.
          </div>

          {loading && <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Checking…</div>}

          {!loading && loadError && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--ss-danger, #b91c1c)' }}>
              <span>Failed to check: {loadError}</span>
              <button onClick={load} className="btn btn-secondary btn-sm" style={{ padding: '2px 8px', fontSize: 11 }}>Retry</button>
            </div>
          )}

          {!loading && !loadError && loaded && count === 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>No gaps — every submitted sheet has an attached PDF.</div>
          )}

          {!loading && !loadError && count > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {gaps.map(g => (
                <button
                  key={g.form_id}
                  onClick={() => navigate(`/tech/tools/demo-sheet?id=${g.form_id}`)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                    padding: '8px 10px', borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-secondary)', border: '1px solid var(--border-light)',
                    cursor: 'pointer', fontFamily: 'var(--font-sans)', textAlign: 'left',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)' }}>
                      {g.job_number} · {g.insured_name || 'Unknown'}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                      {g.technician_name || 'Unknown tech'} · {new Date(g.submitted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </div>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600, flexShrink: 0 }}>Open →</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
