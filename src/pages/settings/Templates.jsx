/**
 * ════════════════════════════════════════════════
 * FILE: Templates.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The "Document Templates" settings screen — a grid of the legal documents Utah
 *   Pros generates (Work Authorization, Direction to Pay, Certificate of
 *   Completion, Change Order). Click one to open its editor. A "Custom" badge
 *   shows when a document has been edited away from the built-in default.
 *
 * WHERE IT LIVES:
 *   Route:        /settings/templates  (the editor is /settings/templates/:docType)
 *   Rendered by:  src/App.jsx (inside SettingsLayout)
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom (useNavigate)
 *   Internal:  @/contexts/AuthContext (db), ./templates/templateData
 *   Data:      reads → get_document_templates (RPC, to show Custom badges)
 *              writes → none (editing happens on the editor route)
 *
 * NOTES / GOTCHAS:
 *   - Behavior-identical extraction of the old Settings.jsx "Templates" tab card
 *     list (Settings Overhaul Phase F). The inline editor became its own route
 *     (/settings/templates/:docType) with a router-level unsaved-changes guard.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import TabLoading from '@/components/TabLoading';
import { DOC_TYPES, DEFAULT_TEMPLATES } from './templates/templateData';

function IconEdit(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>);}

export default function Templates() {
  const { db } = useAuth();
  const navigate = useNavigate();
  const [dbTemplates, setDbTemplates] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const rows = await db.rpc('get_document_templates').catch(() => []);
        const map = {};
        for (const row of rows || []) {
          map[`${row.doc_type}::${row.division || '_'}`] = { heading: row.heading, body: row.body, sort_order: row.sort_order };
        }
        if (!cancelled) setDbTemplates(map);
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [db]);

  if (loading) return <TabLoading />;

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--text-primary)' }}>Document Templates</h2>
        <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
          Click a document to open its editor. Changes only take effect after you save inside the editor.
        </p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
        {DOC_TYPES.map(doc => {
          const hasCustom = (DEFAULT_TEMPLATES[doc.key] || []).some(def => dbTemplates[`${doc.key}::${def.division || '_'}`]);
          return (
            <div key={doc.key} style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-light)', borderRadius: 'var(--radius-lg)', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ fontSize: 28, lineHeight: 1 }}>{doc.icon}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontWeight: 700, fontSize: 'var(--text-base)', color: 'var(--text-primary)' }}>{doc.label}</span>
                    {hasCustom && <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700, background: 'var(--accent-light)', color: 'var(--accent)', border: '1px solid #bfdbfe', borderRadius: 9999, padding: '1px 7px' }}>Custom</span>}
                  </div>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{doc.description}</p>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, paddingTop: 12, borderTop: '1px solid var(--border-light)' }}>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{doc.sections} {doc.sections === 1 ? 'section' : 'sections'}</span>
                <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/settings/templates/${doc.key}`)} style={{ gap: 5, fontSize: 12 }}>
                  <IconEdit style={{ width: 12, height: 12 }} /> Edit Document
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 20, padding: '12px 16px', background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border-light)', fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
        💡 Use <code style={{ background: 'var(--bg-tertiary)', padding: '1px 5px', borderRadius: 3 }}>{'{{variable}}'}</code> for job data · <code style={{ background: 'var(--bg-tertiary)', padding: '1px 5px', borderRadius: 3, color: 'var(--accent-hover)' }}>{'{{insurance_section}}'}</code> in Work Authorization auto-switches between insurance DTP and private-pay+conditional-assignment language
      </div>
    </div>
  );
}
