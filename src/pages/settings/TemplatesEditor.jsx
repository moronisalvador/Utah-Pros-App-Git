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
 *   Packages:  react, react-router-dom (useParams, useNavigate, useBlocker)
 *   Internal:  @/contexts/AuthContext (db), ./templates/templateData,
 *              ./templates/TemplateEditor, @/components/TabLoading
 *   Data:      reads  → get_document_templates (RPC, own fetch on mount)
 *              writes → document_templates (via TemplateEditor's
 *                       upsert_document_template calls)
 *
 * NOTES / GOTCHAS:
 *   - The editor used to be an inline panel inside Settings.jsx whose only
 *     unsaved-changes guard was the in-component "Documents" breadcrumb. As a
 *     real route it now ALSO installs a router-level guard (useBlocker) so
 *     clicking away via the hub rail / back button prompts too. A beforeunload
 *     handler covers full-page reloads.
 *   - An unknown :docType redirects back to the templates grid.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useBlocker } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import TabLoading from '@/components/TabLoading';
import { DOC_TYPES, buildTemplateSections } from './templates/templateData';
import TemplateEditor from './templates/TemplateEditor';

const okToast = (msg) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type: 'success' } }));

export default function TemplatesEditor() {
  const { db } = useAuth();
  const { docType } = useParams();
  const navigate = useNavigate();

  const docMeta = DOC_TYPES.find(d => d.key === docType);
  const [initialSections, setInitialSections] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);

  // Own fetch on mount: pull the saved overrides, fall back to built-in defaults.
  useEffect(() => {
    if (!docMeta) { navigate('/settings/templates', { replace: true }); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const rows = await db.rpc('get_document_templates').catch(() => []);
        if (!cancelled) setInitialSections(buildTemplateSections(rows, docType));
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [db, docType, docMeta, navigate]);

  // Router-level unsaved-changes guard: block in-app navigations while dirty.
  const blocker = useBlocker(useCallback(
    ({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname,
    [dirty],
  ));

  // Full-page reload / tab close guard.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const goBack = () => navigate('/settings/templates');

  if (!docMeta) return null;
  if (loading || !initialSections) return <TabLoading />;

  return (
    <>
      {blocker.state === 'blocked' && (
        <div style={{ marginBottom: 16, padding: '12px 16px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: '#92400e', flex: 1 }}>You have unsaved changes. Leave this document anyway?</span>
          <button className="btn btn-sm" onClick={() => { setDirty(false); blocker.proceed(); }} style={{ background: '#fef2f2', color: '#ef4444', border: '1px solid #fecaca', fontSize: 12 }}>Discard &amp; leave</button>
          <button className="btn btn-ghost btn-sm" onClick={() => blocker.reset()} style={{ fontSize: 12 }}>Keep editing</button>
        </div>
      )}
      <TemplateEditor
        db={db}
        docType={docType}
        docMeta={docMeta}
        initialSections={initialSections}
        onDirtyChange={setDirty}
        onBack={goBack}
        onSaved={() => { okToast('Template saved'); goBack(); }}
      />
    </>
  );
}
