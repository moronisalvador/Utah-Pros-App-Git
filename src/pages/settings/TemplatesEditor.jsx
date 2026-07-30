/**
 * ════════════════════════════════════════════════
 * FILE: TemplatesEditor.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The route that opens one document template for editing (reached from the
 *   Templates grid). It loads that document's current wording when the screen
 *   opens, shows the editor, and warns you before you navigate away with unsaved
 *   changes.
 *
 * WHERE IT LIVES:
 *   Route:        /settings/templates/:docType
 *   Rendered by:  src/App.jsx (inside SettingsLayout)
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom (useParams, useNavigate)
 *   Internal:  @/contexts/AuthContext (db), ./templates/templateData,
 *              ./templates/TemplateEditor, @/components/TabLoading
 *   Data:      reads  → get_document_templates (RPC, own fetch on mount)
 *              writes → document_templates (via TemplateEditor's
 *                       upsert_document_template calls)
 *
 * NOTES / GOTCHAS:
 *   - The editor used to be an inline panel inside Settings.jsx whose only
 *     unsaved-changes guard was the in-component "Documents" breadcrumb. As a
 *     real route it guards the Back exit with an inline confirm banner when
 *     there are unsaved changes, plus a beforeunload handler for full-page
 *     reloads / tab close. (Note: the app uses a plain BrowserRouter, so React
 *     Router's useBlocker() is NOT available — it throws "must be used within a
 *     data router"; that is why the Back button is guarded manually rather than
 *     via a router-level blocker.)
 *   - An unknown :docType redirects back to the templates grid.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import TabLoading from '@/components/TabLoading';
import { DOC_TYPES, buildTemplateSections } from './templates/templateData';
import TemplateEditor from './templates/TemplateEditor';
import { ok, err } from '@/lib/toast';


export default function TemplatesEditor() {
  const { db } = useAuth();
  const { docType } = useParams();
  const navigate = useNavigate();

  const docMeta = DOC_TYPES.find(d => d.key === docType);
  const [initialSections, setInitialSections] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [pendingLeave, setPendingLeave] = useState(false);

  // Own fetch on mount: pull the saved overrides, fall back to built-in defaults.
  useEffect(() => {
    if (!docMeta) { navigate('/settings/templates', { replace: true }); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        // LES-01 (loading-error-states.md §1): this used to end in
        // `.catch(() => [])`. `db.rpc` THROWS on any non-OK response, so a
        // failed read handed `buildTemplateSections` an empty override set and
        // the editor opened showing the BUILT-IN DEFAULTS as if they were the
        // saved template. Saving from that screen would have overwritten the
        // real saved copy with defaults. It now rejects.
        const rows = await db.rpc('get_document_templates');
        if (!cancelled) setInitialSections(buildTemplateSections(rows, docType));
      } catch (e) {
        console.error('TemplatesEditor load failed:', e?.message || e);
        // Leave `initialSections` null — the editor stays gated and cannot save
        // defaults over a template it never managed to read.
        if (!cancelled) { setLoadError('Failed to load this template'); err('Failed to load this template — nothing was changed'); }
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [db, docType, docMeta, navigate, reloadKey]);

  // Full-page reload / tab close guard.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // In-app unsaved-changes guard for the Back exit. (The app uses a plain
  // BrowserRouter, not a data router, so useBlocker() is unavailable — it throws
  // "useBlocker must be used within a data router". We guard the Back button
  // ourselves and show an inline confirm banner instead.)
  const goBack = () => {
    if (dirty) { setPendingLeave(true); return; }
    navigate('/settings/templates');
  };

  if (!docMeta) return null;
  // LES-01 (loading-error-states.md §1): a failed read must not sit on
  // <TabLoading/> forever. `initialSections` stays null so the editor can never
  // save built-in defaults over a template it did not manage to read.
  if (loadError) {
    return (
      <div style={{ padding: 'var(--space-6)', textAlign: 'center' }}>
        <div style={{ fontWeight: 600, fontSize: 'var(--text-base)', marginBottom: 4 }}>{loadError}</div>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>
          Your saved template was not changed. Reload to try again.
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'center' }}>
          <button className="btn btn-sm" onClick={() => navigate('/settings/templates')}>Back</button>
          <button className="btn btn-sm btn-primary" onClick={() => setReloadKey(k => k + 1)}>Retry</button>
        </div>
      </div>
    );
  }
  if (loading || !initialSections) return <TabLoading />;

  return (
    <>
      {pendingLeave && (
        <div style={{ marginBottom: 16, padding: '12px 16px', background: 'var(--status-waiting-bg)', border: '1px solid #fde68a', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 'var(--text-sm)', color: '#92400e', flex: 1 }}>You have unsaved changes. Leave this document anyway?</span>
          <button className="btn btn-sm" onClick={() => { setDirty(false); setPendingLeave(false); navigate('/settings/templates'); }} style={{ background: 'var(--status-needs-response-bg)', color: 'var(--status-needs-response)', border: '1px solid #fecaca', fontSize: 12 }}>Discard &amp; leave</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setPendingLeave(false)} style={{ fontSize: 12 }}>Keep editing</button>
        </div>
      )}
      <TemplateEditor
        db={db}
        docType={docType}
        docMeta={docMeta}
        initialSections={initialSections}
        onDirtyChange={setDirty}
        onBack={goBack}
        onSaved={() => { ok('Template saved'); goBack(); }}
      />
    </>
  );
}
