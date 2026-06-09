import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/lib/toast';
import { impact } from '@/lib/nativeHaptics';

/**
 * GenerateReportButton — renders a compact "Reports" section with existing
 * water-loss-report PDFs for this job plus a button to generate a new one.
 *
 * POSTs to `/api/generate-water-loss-report`, waits for the worker to
 * return, then refreshes the list. Previously-generated reports open in a
 * new tab via signed Supabase Storage URLs.
 *
 * Props:
 *   jobId — string (required)
 *   jobNumber — optional, displayed in the download name
 */
export default function GenerateReportButton({ jobId, jobNumber }) {
  const { db, employee, isFeatureEnabled } = useAuth();
  const enabled = isFeatureEnabled('page:water_loss_report');

  const [reports, setReports] = useState([]);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    if (!enabled || !jobId) { setReports([]); return; }
    try {
      const rows = await db.select(
        'job_documents',
        `job_id=eq.${jobId}&category=eq.water_loss_report&select=id,name,file_path,created_at&order=created_at.desc`,
      );
      setReports(Array.isArray(rows) ? rows : []);
    } catch {
      setReports([]);
    }
  }, [db, jobId, enabled]);

  useEffect(() => { load(); }, [load]);

  const handleGenerate = async () => {
    if (generating || !jobId) return;
    setGenerating(true);
    try {
      const res = await fetch('/api/generate-water-loss-report', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${db.apiKey}`,
        },
        body: JSON.stringify({
          p_job_id: jobId,
          requested_by: employee?.id || null,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}${text ? ': ' + text.slice(0, 200) : ''}`);
      }
      const data = await res.json();
      impact('medium');
      toast(
        `Report generated${data?.photo_count_included ? ` (${data.photo_count_included} photos)` : ''}`,
        'success',
      );
      await load();
    } catch (err) {
      toast('Report failed: ' + (err?.message || 'unknown'), 'error');
    } finally {
      setGenerating(false);
    }
  };

  if (!enabled) return null;

  return (
    <div style={{ padding: 'var(--space-4)', borderTop: '1px solid var(--border-light)' }}>
      <div
        className="tech-section-header-sticky"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <span>
          Reports
          {reports.length > 0 && (
            <span style={{
              fontSize: 12, fontWeight: 400, color: 'var(--text-secondary)',
              letterSpacing: 'normal', textTransform: 'none', marginLeft: 6,
            }}>
              {reports.length}
            </span>
          )}
        </span>
        <button
          className="btn btn-primary btn-sm"
          onClick={handleGenerate}
          disabled={generating}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            minHeight: 32, opacity: generating ? 0.7 : 1,
          }}
        >
          {generating ? (
            <>
              <span className="spinner" style={{ width: 12, height: 12 }} />
              Generating…
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              Water Loss Report
            </>
          )}
        </button>
      </div>

      {reports.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-tertiary)', padding: '8px 0' }}>
          No reports generated yet. Tap "Water Loss Report" to create one from the
          rooms, readings, and equipment logged on this job.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {reports.map(r => (
            <a
              key={r.id}
              href={`${db.baseUrl}/storage/v1/object/public/${r.file_path}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                minHeight: 48, padding: '10px 12px',
                borderRadius: 10, background: 'var(--bg-primary)',
                border: '1px solid var(--border-light)',
                textDecoration: 'none', color: 'var(--text-primary)',
                fontFamily: 'var(--font-sans)',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <div style={{
                width: 32, height: 32, borderRadius: 6,
                background: '#fef2f2', color: '#dc2626',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 800, letterSpacing: '0.04em',
              }}>
                PDF
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 13, fontWeight: 600,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {r.name || 'Water Loss Report'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                  {new Date(r.created_at).toLocaleString('en-US', {
                    month: 'short', day: 'numeric', year: 'numeric',
                    hour: 'numeric', minute: '2-digit',
                  })}
                  {jobNumber ? ` · ${jobNumber}` : ''}
                </div>
              </div>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
