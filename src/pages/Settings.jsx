import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';

const errToast  = (msg) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type: 'error'   } }));
const okToast   = (msg) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type: 'success' } }));

/* ═══ ICONS ═══ */
function IconPlus(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>);}
function IconTrash(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>);}
function IconEdit(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>);}
function IconCheck(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="20 6 9 17 4 12"/></svg>);}
function IconX(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>);}
function IconSearch(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>);}
function IconShield(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>);}
function IconUsers(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>);}
function IconFileText(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>);}
function IconEye(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>);}
function IconEyeOff(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>);}
function IconRefresh(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.1"/></svg>);}

/* ═══ NAV GROUPS ═══ */
const SETTINGS_NAV = [
  { group: 'Lookup Tables', tabs: [
    { key: 'carriers',  label: 'Insurance Carriers', icon: IconShield },
    { key: 'referrals', label: 'Referral Sources',   icon: IconUsers  },
  ]},
  { group: 'Documents', tabs: [
    { key: 'templates', label: 'Document Templates', icon: IconFileText },
  ]},
];

/* ═══ REFERRAL SOURCE CATEGORIES ═══ */
const REF_CATEGORIES = [
  { value: 'insurance',   label: 'Insurance' },
  { value: 'trade',       label: 'Trade' },
  { value: 'real_estate', label: 'Real Estate' },
  { value: 'digital',     label: 'Digital / Marketing' },
  { value: 'traditional', label: 'Traditional' },
  { value: 'personal',    label: 'Personal' },
  { value: 'program',     label: 'Program / Network' },
  { value: 'emergency',   label: 'Emergency' },
  { value: 'other',       label: 'Other' },
];

/* ═══ DOCUMENT TEMPLATE CONSTANTS ═══ */
const DOC_TYPE_TABS = [
  { key: 'coc',           label: 'Certificate of Completion', short: 'CoC'          },
  { key: 'work_auth',     label: 'Work Authorization',        short: 'Work Auth'     },
  { key: 'direction_pay', label: 'Direction of Pay',          short: 'Dir. to Pay'   },
  { key: 'change_order',  label: 'Change Order',              short: 'Change Order'  },
];

const DIVISION_META = {
  water:          { emoji: '💧', label: 'Water Damage Mitigation'  },
  mold:           { emoji: '🧫', label: 'Mold Remediation'          },
  reconstruction: { emoji: '🏗️', label: 'Repairs & Reconstruction' },
  fire:           { emoji: '🔥', label: 'Fire & Smoke Restoration'  },
  contents:       { emoji: '📦', label: 'Contents Restoration'      },
};

const TEMPLATE_VARIABLES = [
  { key: '{{client_name}}',       label: 'Client Name'   },
  { key: '{{job_number}}',        label: 'Job #'         },
  { key: '{{address}}',           label: 'Address'       },
  { key: '{{city}}',              label: 'City'          },
  { key: '{{state}}',             label: 'State'         },
  { key: '{{date_of_loss}}',      label: 'Date of Loss'  },
  { key: '{{insurance_company}}', label: 'Ins. Company'  },
  { key: '{{claim_number}}',      label: 'Claim #'       },
  { key: '{{policy_number}}',     label: 'Policy #'      },
  { key: '{{adjuster_name}}',     label: 'Adjuster'      },
  { key: '{{company_name}}',      label: 'Company Name'  },
  { key: '{{date}}',              label: "Today's Date"  },
];

const DEFAULT_TEMPLATES = {
  coc: [
    { division: 'water',          sort_order: 1, heading: 'Water Damage Mitigation',   body: 'I confirm that all water mitigation services performed by {{company_name}} at the above property have been completed to my satisfaction. The work was performed in a professional manner and is 100% complete. I have no outstanding complaints or concerns.' },
    { division: 'mold',           sort_order: 2, heading: 'Mold Remediation',           body: 'I confirm that all mold remediation services performed by {{company_name}} have been completed to my satisfaction. The affected areas have been properly contained, treated, and cleared. The work is 100% complete and I have no outstanding complaints or concerns.' },
    { division: 'reconstruction', sort_order: 3, heading: 'Repairs & Reconstruction',  body: 'I confirm that all repairs and reconstruction performed by {{company_name}} have been completed to my satisfaction. The repaired portions of the property are in equal or better condition than prior to the loss. The work is 100% complete and I have no outstanding complaints or concerns.' },
    { division: 'fire',           sort_order: 4, heading: 'Fire & Smoke Restoration',  body: 'I confirm that all fire and smoke restoration services performed by {{company_name}} have been completed to my satisfaction. The work was performed in a professional manner and is 100% complete. I have no outstanding complaints or concerns.' },
    { division: 'contents',       sort_order: 5, heading: 'Contents Restoration',      body: 'I confirm that {{company_name}} has returned all salvageable contents items in satisfactory condition. I have had the opportunity to inspect the returned items. The work is 100% complete and I have no outstanding complaints or concerns.' },
  ],
  work_auth: [
    { division: null, sort_order: 1, heading: 'Work Authorization & Service Agreement',
      body: `I, {{client_name}}, hereby authorize {{company_name}} to perform all necessary restoration and mitigation services at the property located at {{address}}, {{city}}, {{state}}.

I understand and agree to the following terms:

1. SCOPE OF WORK: I authorize {{company_name}} to perform all labor, equipment, and material necessary to properly restore and mitigate the damage at the above property, including any emergency services required to prevent further damage.

2. PAYMENT: I assign my right to insurance proceeds for this loss directly to {{company_name}} (Direction to Pay). I remain personally responsible for any amounts not covered by insurance, including my deductible of record.

3. INSURANCE COOPERATION: I authorize {{company_name}} to communicate directly with my insurance company, {{insurance_company}}, regarding Claim #{{claim_number}}, and to provide documentation necessary for proper claim settlement.

4. ACCESS: I grant {{company_name}} and its authorized representatives access to the property at reasonable hours to perform all authorized work.

5. SUPPLEMENTS: I authorize {{company_name}} to submit supplemental claims to my insurance company for any additional work required that was not included in the original scope.

I understand this authorization will remain in effect until all work is completed and the final invoice is settled.` },
  ],
  direction_pay: [
    { division: null, sort_order: 1, heading: 'Assignment of Benefits / Direction to Pay',
      body: `I, {{client_name}}, hereby irrevocably assign, transfer, and set over to {{company_name}} all of my rights, title, interest, and benefits under my insurance policy with {{insurance_company}} (Policy #{{policy_number}}) for losses sustained at {{address}}, {{city}}, {{state}}, on or about {{date_of_loss}} (Claim #{{claim_number}}).

ASSIGNMENT OF BENEFITS: This assignment includes, but is not limited to, the right to: (a) receive payment directly from the insurance company for all covered restoration services; (b) file, negotiate, and settle claims on my behalf; (c) bring legal action if necessary to obtain payment.

DIRECTION TO PAY: I hereby direct {{insurance_company}} to make all payments, including any and all insurance proceeds related to the above-referenced loss and claim, payable directly to {{company_name}} as the service provider of record.

DEDUCTIBLE OBLIGATION: I understand that I remain responsible for payment of my deductible as required under my policy. This assignment does not relieve me of my deductible obligation.

This direction to pay shall remain in full force and effect until {{company_name}} has received full and final payment for all services rendered.` },
  ],
  change_order: [
    { division: null, sort_order: 1, heading: 'Change Order Authorization',
      body: `This Change Order modifies the original Work Authorization for the property located at {{address}}, {{city}}, {{state}} (Job #{{job_number}}).

I, {{client_name}}, hereby authorize {{company_name}} to perform the additional work described below. I understand this change order modifies the total contract amount and that all terms of the original Work Authorization remain in effect.

ADDITIONAL SCOPE:
[Describe additional work here]

REASON FOR CHANGE:
[Reason for additional work]

I acknowledge that this change order has been explained to me, I understand the additional scope of work, and I authorize {{company_name}} to proceed.` },
  ],
};

/* ═══ PREVIEW VARIABLE SUBSTITUTION ═══ */
const SAMPLE_JOB = {
  insured_name: 'John Smith', job_number: 'UPR-2024-001',
  address: '123 Main St', city: 'Salt Lake City', state: 'UT', zip: '84101',
  date_of_loss: '2024-01-15T12:00:00', insurance_company: 'State Farm',
  claim_number: 'SF-12345678', policy_number: 'HO-987654321', adjuster_name: 'Jane Doe',
};

function substituteVarsPreview(text, job = SAMPLE_JOB) {
  if (!text) return '';
  const m = {
    '{{client_name}}':       job.insured_name || 'John Smith',
    '{{job_number}}':        job.job_number   || 'UPR-2024-001',
    '{{address}}':           job.address      || '123 Main St',
    '{{city}}':              job.city         || 'Salt Lake City',
    '{{state}}':             job.state        || 'UT',
    '{{zip}}':               job.zip          || '84101',
    '{{date_of_loss}}':      job.date_of_loss
      ? new Date(job.date_of_loss).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      : 'January 15, 2024',
    '{{insurance_company}}': job.insurance_company || 'State Farm',
    '{{claim_number}}':      job.claim_number      || 'SF-12345678',
    '{{policy_number}}':     job.policy_number     || 'HO-987654321',
    '{{adjuster_name}}':     job.adjuster_name     || 'Jane Doe',
    '{{company_name}}':      'Utah Pros Restoration',
    '{{date}}':              new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
  };
  return Object.entries(m).reduce((t, [k, v]) => t.replaceAll(k, v), text);
}

/* ═══ MAIN ═══ */
export default function Settings() {
  const { db } = useAuth();
  const [tab, setTab] = useState('carriers');
  const [carriers, setCarriers] = useState([]);
  const [referrals, setReferrals] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [c, r] = await Promise.all([
        db.rpc('get_insurance_carriers').catch(() => []),
        db.rpc('get_referral_sources').catch(() => []),
      ]);
      setCarriers(c);
      setReferrals(r);
    } catch (err) {
      console.error('Settings load error:', err);
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => { load(); }, [load]);

  /* ── Carrier CRUD ── */
  const saveCarrier = async (item) => {
    try {
      const params = { p_name: item.name, p_short_name: item.short_name || null, p_sort_order: item.sort_order || 999 };
      if (item.id) params.p_id = item.id;
      await db.rpc('upsert_insurance_carrier', params);
      await load();
      return true;
    } catch (err) {
      errToast('Failed to save: ' + err.message);
      return false;
    }
  };

  const deleteCarrier = async (id) => {
    try {
      await db.rpc('delete_insurance_carrier', { p_id: id });
      setCarriers(prev => prev.filter(c => c.id !== id));
      return true;
    } catch (err) {
      errToast('Failed to delete: ' + err.message);
      return false;
    }
  };

  /* ── Referral CRUD ── */
  const saveReferral = async (item) => {
    try {
      const params = { p_name: item.name, p_category: item.category || 'other', p_sort_order: item.sort_order || 999 };
      if (item.id) params.p_id = item.id;
      await db.rpc('upsert_referral_source', params);
      await load();
      return true;
    } catch (err) {
      errToast('Failed to save: ' + err.message);
      return false;
    }
  };

  const deleteReferral = async (id) => {
    try {
      await db.rpc('delete_referral_source', { p_id: id });
      setReferrals(prev => prev.filter(r => r.id !== id));
      return true;
    } catch (err) {
      errToast('Failed to delete: ' + err.message);
      return false;
    }
  };

  if (loading) return <div className="loading-page"><div className="spinner" /></div>;

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Manage lookup tables, company preferences, and system configuration.</p>
      </div>

      <div className="settings-body">
        {/* Sidebar nav — grouped */}
        <div className="settings-nav">
          {SETTINGS_NAV.map(({ group, tabs }) => (
            <div key={group}>
              <div className="settings-nav-label">{group}</div>
              {tabs.map(t => (
                <button
                  key={t.key}
                  className={`settings-nav-item${tab === t.key ? ' active' : ''}`}
                  onClick={() => setTab(t.key)}
                >
                  <t.icon style={{ width: 16, height: 16 }} />
                  {t.label}
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* Content */}
        <div className="settings-content">
          {tab === 'carriers' && (
            <LookupTable
              title="Insurance Carriers"
              subtitle={`${carriers.length} carriers`}
              items={carriers}
              onSave={saveCarrier}
              onDelete={deleteCarrier}
              columns={[
                { key: 'name',       label: 'Carrier Name', flex: 3, required: true },
                { key: 'short_name', label: 'Code',         flex: 1, placeholder: 'SF' },
                { key: 'sort_order', label: 'Order',        flex: 0.5, type: 'number', placeholder: '999' },
              ]}
              newItemDefaults={{ name: '', short_name: '', sort_order: 999 }}
            />
          )}
          {tab === 'referrals' && (
            <LookupTable
              title="Referral Sources"
              subtitle={`${referrals.length} sources`}
              items={referrals}
              onSave={saveReferral}
              onDelete={deleteReferral}
              columns={[
                { key: 'name',       label: 'Source Name', flex: 3, required: true },
                { key: 'category',   label: 'Category',    flex: 2, type: 'select', options: REF_CATEGORIES },
                { key: 'sort_order', label: 'Order',       flex: 0.5, type: 'number', placeholder: '999' },
              ]}
              newItemDefaults={{ name: '', category: 'other', sort_order: 999 }}
            />
          )}
          {tab === 'templates' && (
            <DocumentTemplatesPanel db={db} />
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   DOCUMENT TEMPLATES PANEL
   ═══════════════════════════════════════════════════════════════════ */
function DocumentTemplatesPanel({ db }) {
  const [dbTemplates,  setDbTemplates]  = useState({});
  const [localEdits,   setLocalEdits]   = useState({});
  const [loading,      setLoading]      = useState(true);
  const [saving,       setSaving]       = useState(false);
  const [activeType,   setActiveType]   = useState('coc');
  const [dirty,        setDirty]        = useState(false);
  const [preview,      setPreview]      = useState(false);
  const lastFocused = useRef(null); // { el, docType, division, field }

  useEffect(() => { loadTemplates(); }, []);

  const loadTemplates = async () => {
    setLoading(true);
    try {
      const rows = await db.rpc('get_document_templates').catch(() => []);
      const map = {};
      for (const row of rows || []) {
        const k = `${row.doc_type}::${row.division || '_'}`;
        map[k] = { heading: row.heading, body: row.body, sort_order: row.sort_order };
      }
      setDbTemplates(map);
      setLocalEdits({ ...map });
      // If DB is empty, start dirty so user can populate from defaults
      setDirty((rows || []).length === 0);
    } finally {
      setLoading(false);
    }
  };

  const getEdit = (docType, division) => {
    const k = `${docType}::${division || '_'}`;
    if (localEdits[k]) return localEdits[k];
    // Fall back to DEFAULT_TEMPLATES constant
    const def = (DEFAULT_TEMPLATES[docType] || []).find(t => t.division === division);
    return def ? { heading: def.heading, body: def.body, sort_order: def.sort_order } : { heading: '', body: '', sort_order: 0 };
  };

  const setField = (docType, division, field, value) => {
    const k = `${docType}::${division || '_'}`;
    setLocalEdits(prev => ({
      ...prev,
      [k]: { ...getEdit(docType, division), [field]: value },
    }));
    setDirty(true);
  };

  const insertVar = (varKey) => {
    if (!lastFocused.current) return;
    const { el, docType, division, field } = lastFocused.current;
    if (!el) return;
    const start   = el.selectionStart  ?? el.value.length;
    const end     = el.selectionEnd    ?? el.value.length;
    const newVal  = el.value.substring(0, start) + varKey + el.value.substring(end);
    setField(docType, division, field, newVal);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + varKey.length, start + varKey.length);
    });
  };

  /* Save ALL doc types at once */
  const handleSave = async () => {
    setSaving(true);
    try {
      const allSections = Object.entries(DEFAULT_TEMPLATES).flatMap(([dt, secs]) =>
        secs.map(def => ({
          docType:   dt,
          division:  def.division,
          sortOrder: def.sort_order,
          ...getEdit(dt, def.division),
        }))
      );
      await Promise.all(allSections.map(s =>
        db.rpc('upsert_document_template', {
          p_doc_type:   s.docType,
          p_division:   s.division,
          p_heading:    s.heading,
          p_body:       s.body,
          p_sort_order: s.sortOrder,
        })
      ));
      // Sync DB snapshot
      const newDb = {};
      for (const s of allSections) {
        newDb[`${s.docType}::${s.division || '_'}`] = { heading: s.heading, body: s.body, sort_order: s.sortOrder };
      }
      setDbTemplates(newDb);
      setDirty(false);
      okToast('Templates saved successfully');
    } catch (err) {
      errToast('Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  /* Reset active type to built-in defaults */
  const handleReset = () => {
    const sections = DEFAULT_TEMPLATES[activeType] || [];
    setLocalEdits(prev => {
      const next = { ...prev };
      for (const def of sections) {
        next[`${activeType}::${def.division || '_'}`] = { heading: def.heading, body: def.body, sort_order: def.sort_order };
      }
      return next;
    });
    setDirty(true);
  };

  const onFocus = (el, docType, division, field) => {
    lastFocused.current = { el, docType, division, field };
  };

  // Build preview sections from current edits
  const previewSections = (DEFAULT_TEMPLATES[activeType] || []).map(def => ({
    ...def,
    heading: getEdit(activeType, def.division).heading,
    body:    getEdit(activeType, def.division).body,
  }));

  if (loading) return <div style={{ padding: 32, display: 'flex', justifyContent: 'center' }}><div className="spinner" /></div>;

  return (
    <div className="lookup-table">
      {/* ── Header ── */}
      <div className="lookup-header">
        <div>
          <h2 className="lookup-title">Document Templates</h2>
          <p className="lookup-subtitle">Edit the legal language shown on each signing document type.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {dirty && (
            <span style={{ fontSize: 11, color: '#d97706', fontWeight: 600 }}>● Unsaved changes</span>
          )}
          <button className="btn btn-ghost btn-sm" onClick={handleReset} title="Reset active tab to built-in defaults" style={{ gap: 4 }}>
            <IconRefresh style={{ width: 12, height: 12 }} /> Reset
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setPreview(p => !p)}
            style={{ gap: 4 }}
          >
            {preview
              ? <><IconEyeOff style={{ width: 14, height: 14 }} /> Edit</>
              : <><IconEye    style={{ width: 14, height: 14 }} /> Preview</>}
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save All'}
          </button>
        </div>
      </div>

      {/* ── Doc type tabs ── */}
      <div style={{ display: 'flex', gap: 4, paddingBottom: 16, borderBottom: '1px solid var(--border-light)', marginBottom: 16, flexWrap: 'wrap' }}>
        {DOC_TYPE_TABS.map(t => (
          <button
            key={t.key}
            className={`btn btn-sm${activeType === t.key ? ' btn-primary' : ' btn-ghost'}`}
            onClick={() => { setActiveType(t.key); setPreview(false); }}
            style={{ fontSize: 12 }}
          >
            {t.short}
          </button>
        ))}
      </div>

      {preview ? (
        /* ── Preview ── */
        <TemplatePreview docType={activeType} sections={previewSections} />
      ) : (
        <>
          {/* ── Variable chip bar ── */}
          <div style={{ marginBottom: 16, padding: '10px 14px', background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border-light)' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
              Insert variable at cursor — click any chip below
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {TEMPLATE_VARIABLES.map(v => (
                <button
                  key={v.key}
                  onClick={() => insertVar(v.key)}
                  style={{
                    fontSize: 11, fontFamily: 'monospace', cursor: 'pointer',
                    background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
                    borderRadius: 4, padding: '3px 8px', color: 'var(--brand-primary)',
                    fontWeight: 600, lineHeight: 1.4,
                  }}
                  title={`Insert ${v.key}`}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>

          {/* ── Section editors ── */}
          {(DEFAULT_TEMPLATES[activeType] || []).map(def => {
            const ed      = getEdit(activeType, def.division);
            const divMeta = def.division ? DIVISION_META[def.division] : null;
            return (
              <SectionEditor
                key={`${activeType}::${def.division || '_'}`}
                docType={activeType}
                division={def.division}
                divMeta={divMeta}
                heading={ed.heading}
                body={ed.body}
                onHeadingChange={v => setField(activeType, def.division, 'heading', v)}
                onBodyChange={v => setField(activeType, def.division, 'body', v)}
                onFocus={onFocus}
                isLong={activeType !== 'coc'}
              />
            );
          })}
        </>
      )}
    </div>
  );
}

/* ═══ SECTION EDITOR ═══ */
function SectionEditor({ docType, division, divMeta, heading, body, onHeadingChange, onBodyChange, onFocus, isLong }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div style={{ marginBottom: 12, border: '1px solid var(--border-light)', borderRadius: 8, overflow: 'hidden' }}>
      {/* Collapsible header (only for CoC sections) */}
      {divMeta && (
        <button
          onClick={() => setExpanded(p => !p)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 14px', background: 'var(--bg-secondary)', border: 'none',
            cursor: 'pointer', textAlign: 'left',
            borderBottom: expanded ? '1px solid var(--border-light)' : 'none',
          }}
        >
          <span style={{ fontSize: 16 }}>{divMeta.emoji}</span>
          <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{divMeta.label}</span>
          <span style={{ marginLeft: 'auto', color: 'var(--text-tertiary)', fontSize: 11 }}>{expanded ? '▾' : '▸'}</span>
        </button>
      )}

      {(expanded || !divMeta) && (
        <div style={{ padding: 14 }}>
          <div style={{ marginBottom: 10 }}>
            <label style={tplLbl}>Section Heading</label>
            <input
              className="input"
              value={heading}
              onChange={e => onHeadingChange(e.target.value)}
              onFocus={e => onFocus(e.target, docType, division, 'heading')}
              style={{ height: 34, fontSize: 13 }}
            />
          </div>
          <div>
            <label style={tplLbl}>Body Text</label>
            <textarea
              className="input textarea"
              value={body}
              onChange={e => onBodyChange(e.target.value)}
              onFocus={e => onFocus(e.target, docType, division, 'body')}
              rows={isLong ? 14 : 4}
              style={{ fontSize: 13, lineHeight: 1.6, resize: 'vertical', minHeight: isLong ? 220 : 72, fontFamily: 'inherit' }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══ TEMPLATE PREVIEW ═══ */
function TemplatePreview({ docType, sections }) {
  return (
    <div style={{ border: '1px solid var(--border-light)', borderRadius: 8, overflow: 'hidden' }}>
      {/* Mock header */}
      <div style={{ background: '#1e293b', padding: '12px 18px' }}>
        <div style={{ fontWeight: 700, color: '#fff', fontSize: 14 }}>Utah Pros Restoration</div>
        <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 2 }}>Licensed · Insured · Utah</div>
      </div>

      <div style={{ padding: '24px 28px', background: '#f8fafc', maxHeight: 600, overflowY: 'auto' }}>
        {/* Doc title */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 700, color: '#0f172a' }}>
            {DOC_TYPE_TABS.find(t => t.key === docType)?.label || docType}
          </h3>
          <div style={{ width: 60, height: 3, background: '#2563eb', margin: '0 auto', borderRadius: 2 }} />
        </div>

        {/* Job info grid */}
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: '12px 16px', marginBottom: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px' }}>
          {[['Client','John Smith'],['Job #','UPR-2024-001'],['Property','123 Main St, Salt Lake City, UT'],['Insurance','State Farm'],['Claim #','SF-12345678'],['Date of Loss','January 15, 2024']].map(([l,v])=>(
            <div key={l}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{l}</div>
              <div style={{ fontSize: 13, color: '#0f172a', fontWeight: 500, marginTop: 2 }}>{v}</div>
            </div>
          ))}
        </div>

        {/* Rendered sections */}
        {sections.map((s, i) => (
          <div key={i} style={{ marginBottom: 16, background: '#fff', padding: '14px 16px', borderRadius: 6, border: '1px solid #e2e8f0' }}>
            <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#1e293b' }}>
              {substituteVarsPreview(s.heading)}
            </p>
            <p style={{ margin: 0, fontSize: 13, color: '#334155', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
              {substituteVarsPreview(s.body)}
            </p>
          </div>
        ))}

        {/* Auth / sig placeholder */}
        <div style={{ padding: '12px 16px', background: '#fff', borderRadius: 6, border: '1px solid #e2e8f0', borderLeft: '3px solid #2563eb' }}>
          <p style={{ margin: 0, fontSize: 12, color: '#64748b', fontStyle: 'italic' }}>
            Authorization clause, full-name field, signature pad, and agreement checkbox appear below this content in the actual document.
          </p>
        </div>
      </div>
    </div>
  );
}

const tplLbl = {
  display: 'block', fontSize: 10, fontWeight: 700,
  color: 'var(--text-tertiary)', letterSpacing: '0.06em',
  textTransform: 'uppercase', marginBottom: 4,
};

/* ═══════════════════════════════════════════════════════════════════
   LOOKUP TABLE — Generic CRUD table for any lookup data
   ═══════════════════════════════════════════════════════════════════ */
function LookupTable({ title, subtitle, items, onSave, onDelete, columns, newItemDefaults }) {
  const [search,          setSearch]          = useState('');
  const [editingId,       setEditingId]       = useState(null);
  const [editForm,        setEditForm]        = useState({});
  const [saving,          setSaving]          = useState(false);
  const [validationError, setValidationError] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const nameRef = useRef(null);

  const filtered = search.trim()
    ? items.filter(item => columns.some(col => {
        const val = item[col.key];
        return val && String(val).toLowerCase().includes(search.toLowerCase());
      }))
    : items;

  const startEdit = (item) => {
    setEditingId(item.id);
    const form = {};
    for (const col of columns) form[col.key] = item[col.key] ?? '';
    form.id = item.id;
    setEditForm(form);
    setTimeout(() => nameRef.current?.focus(), 50);
  };

  const startAdd = () => {
    setEditingId('new');
    setEditForm({ ...newItemDefaults });
    setTimeout(() => nameRef.current?.focus(), 50);
  };

  const cancelEdit = () => { setEditingId(null); setEditForm({}); };

  const handleSave = async () => {
    const required = columns.filter(c => c.required);
    for (const col of required) {
      if (!editForm[col.key]?.toString().trim()) { setValidationError(`${col.label} is required`); return; }
    }
    setValidationError('');
    setSaving(true);
    const item = { ...editForm };
    if (editingId === 'new') delete item.id;
    if (item.sort_order !== undefined) item.sort_order = parseInt(item.sort_order) || 999;
    const ok = await onSave(item);
    setSaving(false);
    if (ok) cancelEdit();
  };

  const handleDelete = async (id) => { await onDelete(id); setConfirmDeleteId(null); };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); handleSave(); }
    if (e.key === 'Escape') cancelEdit();
  };

  const set = (key, val) => setEditForm(prev => ({ ...prev, [key]: val }));

  return (
    <div className="lookup-table">
      {/* Header */}
      <div className="lookup-header">
        <div>
          <h2 className="lookup-title">{title}</h2>
          <p className="lookup-subtitle">{subtitle}</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={startAdd} disabled={editingId === 'new'}>
          <IconPlus style={{ width: 14, height: 14 }} /> Add
        </button>
      </div>

      {/* Search */}
      <div className="lookup-search-wrap">
        <IconSearch style={{ width: 14, height: 14 }} className="lookup-search-icon" />
        <input
          className="input lookup-search"
          placeholder={`Search ${title.toLowerCase()}...`}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Table */}
      <div className="lookup-table-wrap">
        {/* Header row */}
        <div className="lookup-row lookup-row-header">
          {columns.map(col => (
            <div key={col.key} className="lookup-cell" style={{ flex: col.flex || 1 }}>{col.label}</div>
          ))}
          <div className="lookup-cell lookup-cell-actions" style={{ width: 80 }}>Actions</div>
        </div>

        {/* Add new row */}
        {editingId === 'new' && (
          <>
            <div className="lookup-row lookup-row-editing">
              {columns.map(col => (
                <div key={col.key} className="lookup-cell" style={{ flex: col.flex || 1 }}>
                  {col.type === 'select' ? (
                    <select className="input lookup-input" value={editForm[col.key] || ''} onChange={e => set(col.key, e.target.value)} style={{ cursor: 'pointer' }}>
                      {col.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : (
                    <input
                      ref={col.required ? nameRef : undefined}
                      className="input lookup-input"
                      type={col.type || 'text'}
                      value={editForm[col.key] ?? ''}
                      onChange={e => { set(col.key, e.target.value); setValidationError(''); }}
                      onKeyDown={handleKeyDown}
                      placeholder={col.placeholder || col.label}
                    />
                  )}
                </div>
              ))}
              <div className="lookup-cell lookup-cell-actions" style={{ width: 80 }}>
                <button className="lookup-action-btn save" onClick={handleSave} disabled={saving} title="Save"><IconCheck style={{ width: 14, height: 14 }} /></button>
                <button className="lookup-action-btn cancel" onClick={cancelEdit} title="Cancel"><IconX style={{ width: 14, height: 14 }} /></button>
              </div>
            </div>
            {validationError && (
              <div style={{ padding: '6px 12px', fontSize: 12, color: '#ef4444', background: '#fef2f2', borderBottom: '1px solid #fecaca' }}>{validationError}</div>
            )}
          </>
        )}

        {/* Data rows */}
        {filtered.length === 0 && editingId !== 'new' ? (
          <div className="lookup-empty">
            {search ? `No results for "${search}"` : 'No items yet. Click "Add" to create one.'}
          </div>
        ) : (
          filtered.map(item => (
            editingId === item.id ? (
              <>
                <div key={item.id} className="lookup-row lookup-row-editing">
                  {columns.map(col => (
                    <div key={col.key} className="lookup-cell" style={{ flex: col.flex || 1 }}>
                      {col.type === 'select' ? (
                        <select className="input lookup-input" value={editForm[col.key] || ''} onChange={e => set(col.key, e.target.value)} style={{ cursor: 'pointer' }}>
                          {col.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      ) : (
                        <input
                          ref={col.required ? nameRef : undefined}
                          className="input lookup-input"
                          type={col.type || 'text'}
                          value={editForm[col.key] ?? ''}
                          onChange={e => { set(col.key, e.target.value); setValidationError(''); }}
                          onKeyDown={handleKeyDown}
                          placeholder={col.placeholder || col.label}
                        />
                      )}
                    </div>
                  ))}
                  <div className="lookup-cell lookup-cell-actions" style={{ width: 80 }}>
                    <button className="lookup-action-btn save" onClick={handleSave} disabled={saving} title="Save"><IconCheck style={{ width: 14, height: 14 }} /></button>
                    <button className="lookup-action-btn cancel" onClick={cancelEdit} title="Cancel"><IconX style={{ width: 14, height: 14 }} /></button>
                  </div>
                </div>
                {validationError && (
                  <div style={{ padding: '6px 12px', fontSize: 12, color: '#ef4444', background: '#fef2f2', borderBottom: '1px solid #fecaca' }}>{validationError}</div>
                )}
              </>
            ) : (
              <div key={item.id} className="lookup-row">
                {columns.map(col => (
                  <div key={col.key} className="lookup-cell" style={{ flex: col.flex || 1 }}>
                    {col.type === 'select'
                      ? (col.options?.find(o => o.value === item[col.key])?.label || item[col.key] || '—')
                      : (item[col.key] ?? '—')
                    }
                  </div>
                ))}
                <div className="lookup-cell lookup-cell-actions" style={{ width: confirmDeleteId === item.id ? 140 : 80 }}>
                  {confirmDeleteId === item.id ? (
                    <>
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginRight: 4 }}>Delete?</span>
                      <button className="lookup-action-btn save" onClick={() => handleDelete(item.id)} title="Confirm" style={{ background: '#fef2f2', color: '#ef4444' }}><IconCheck style={{ width: 14, height: 14 }} /></button>
                      <button className="lookup-action-btn cancel" onClick={() => setConfirmDeleteId(null)} title="Cancel"><IconX style={{ width: 14, height: 14 }} /></button>
                    </>
                  ) : (
                    <>
                      <button className="lookup-action-btn edit"   onClick={() => startEdit(item)}          title="Edit"><IconEdit  style={{ width: 14, height: 14 }} /></button>
                      <button className="lookup-action-btn delete" onClick={() => setConfirmDeleteId(item.id)} title="Delete"><IconTrash style={{ width: 14, height: 14 }} /></button>
                    </>
                  )}
                </div>
              </div>
            )
          ))
        )}
      </div>
    </div>
  );
}
