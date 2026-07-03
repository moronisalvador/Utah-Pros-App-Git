import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getAuthHeader } from '@/lib/realtime';
import {
  isPushSupported, isPushConfigured, pushPermission,
  getExistingSubscription, enablePush, disablePush,
} from '@/lib/webPushClient';

const errToast = (msg) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type: 'error'   } }));
const okToast  = (msg) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type: 'success' } }));

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
function IconChevronLeft(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="15 18 9 12 15 6"/></svg>);}
function IconDrive(p){return(<svg viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M7.71 3.5 1.15 15l3.43 5.94 6.56-11.37L7.71 3.5zM22.85 15 16.29 3.5H9.43l6.56 11.5h6.86zM4.93 16.06 8.36 22h11.49l-3.43-5.94H4.93z"/></svg>);}
function IconPercent(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>);}
function IconBell(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>);}

/* ═══ NAV GROUPS ═══ */
const SETTINGS_NAV = [
  { group: 'Lookup Tables', tabs: [
    { key: 'carriers',  label: 'Insurance Carriers', icon: IconShield   },
    { key: 'referrals', label: 'Referral Sources',   icon: IconUsers    },
  ]},
  { group: 'Documents', tabs: [
    { key: 'templates', label: 'Document Templates', icon: IconFileText },
  ]},
  { group: 'Payroll', tabs: [
    { key: 'commissions', label: 'Commissions', icon: IconPercent },
  ]},
  { group: 'Integrations', tabs: [
    { key: 'integrations', label: 'Google Drive', icon: IconDrive },
  ]},
  { group: 'Notifications', tabs: [
    { key: 'notifications', label: 'Notifications', icon: IconBell },
  ]},
];

const REF_CATEGORIES = [
  { value: 'insurance',   label: 'Insurance'           },
  { value: 'trade',       label: 'Trade'               },
  { value: 'real_estate', label: 'Real Estate'         },
  { value: 'digital',     label: 'Digital / Marketing' },
  { value: 'traditional', label: 'Traditional'         },
  { value: 'personal',    label: 'Personal'            },
  { value: 'program',     label: 'Program / Network'   },
  { value: 'emergency',   label: 'Emergency'           },
  { value: 'other',       label: 'Other'               },
];

/* ═══ DOC TYPE METADATA ═══ */
const DOC_TYPES = [
  { key: 'work_auth',     label: 'Work Authorization',        description: 'Scope consent, IICRC standards, equipment terms, payment, and liability.', icon: '📋', sections: 1 },
  { key: 'direction_pay', label: 'Direction to Pay',          description: 'Assignment of insurance benefits directing payment to Utah Pros.',           icon: '💳', sections: 1 },
  { key: 'coc',           label: 'Certificate of Completion', description: 'Per-division completion confirmations signed by the homeowner.',             icon: '✅', sections: 5 },
  { key: 'change_order',  label: 'Change Order',              description: 'Authorization for additional scope outside the original work auth.',          icon: '🔄', sections: 1 },
];

const DIVISION_META = {
  water:          { emoji: '💧', label: 'Water Damage Mitigation'  },
  mold:           { emoji: '🧫', label: 'Mold Remediation'          },
  reconstruction: { emoji: '🏗️', label: 'Repairs & Reconstruction' },
  remodeling:     { emoji: '🔨', label: 'Remodeling'              },
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
  { key: '{{insurance_section}}', label: 'Insurance/Pay §', special: true },
];

/* ═══ DEFAULT TEMPLATE BODIES ═══ */
const DEFAULT_TEMPLATES = {
  coc: [
    { division: 'water',          sort_order: 1, heading: 'Water Damage Mitigation',   body: 'I confirm that all water mitigation services performed by {{company_name}} at the above property have been completed to my satisfaction. The work was performed in a professional manner consistent with IICRC S500 standards and is 100% complete. I have no outstanding complaints or concerns.' },
    { division: 'mold',           sort_order: 2, heading: 'Mold Remediation',           body: 'I confirm that all mold remediation services performed by {{company_name}} have been completed to my satisfaction. The affected areas have been properly contained, treated, and cleared in accordance with IICRC S520 standards. The work is 100% complete and I have no outstanding complaints or concerns.' },
    { division: 'reconstruction', sort_order: 3, heading: 'Repairs & Reconstruction',  body: 'I confirm that all repairs and reconstruction performed by {{company_name}} have been completed to my satisfaction. The repaired portions of the property are in equal or better condition than prior to the loss. The work is 100% complete and I have no outstanding complaints or concerns.' },
    { division: 'fire',           sort_order: 4, heading: 'Fire & Smoke Restoration',  body: 'I confirm that all fire and smoke restoration services performed by {{company_name}} have been completed to my satisfaction. The work was performed in a professional manner and is 100% complete. I have no outstanding complaints or concerns.' },
    { division: 'contents',       sort_order: 5, heading: 'Contents Restoration',      body: 'I confirm that {{company_name}} has returned all salvageable contents items in satisfactory condition. I have had the opportunity to inspect the returned items. The work is 100% complete and I have no outstanding complaints or concerns.' },
    { division: 'remodeling',     sort_order: 6, heading: 'Remodeling',                body: 'I confirm that all remodeling and finish work performed by {{company_name}} has been completed to my satisfaction. The work is 100% complete, in equal or better condition than agreed, and I have no outstanding complaints or concerns.' },
  ],
  work_auth: [{ division: null, sort_order: 1,
    heading: 'Work Authorization & Service Agreement',
    body: `## AUTHORIZATION TO PERFORM SERVICES

I, {{client_name}}, the undersigned homeowner, policy holder, or authorized agent, hereby authorize {{company_name}} ("Company") to perform all necessary restoration, mitigation, remediation, and repair services at the property located at {{address}}, {{city}}, {{state}} ("Property").

## SCOPE OF WORK
I authorize the Company to perform all labor, equipment, and material necessary to properly restore and mitigate damage at the Property, including emergency services required to prevent further loss. The scope of work includes removal of non-salvageable material per IICRC S500 standards, and proper cleaning, treating, sanitizing, drying, and sealing of non-porous surfaces where applicable.

## CHEMICAL USE & SAFETY
The Company will use EPA-registered antimicrobials and sanitizers following IICRC standards. I agree to notify the Company of any known chemical sensitivities prior to commencement of work so that appropriate adjustments can be made.

## DRYING EQUIPMENT
I understand that high-velocity air movers and commercial dehumidifiers will be installed to accelerate the drying process. I will not turn off, unplug, or remove drying equipment without prior authorization from the Company. Target relative humidity is 25–35%. I will not open windows or doors unless instructed by the Company.

## EQUIPMENT RESPONSIBILITY
I am responsible for the safekeeping of drying equipment while in my care and custody. I agree to take reasonable precautions to prevent loss or theft of any equipment installed at the Property.

## STOP WORK / HOLD HARMLESS
If I instruct the Company to stop work before completion or remove drying equipment prematurely, I agree to release, indemnify, and hold harmless the Company, its officers, employees, and agents from any and all claims or liability arising from incomplete procedures or resulting secondary damage.

## PAYMENT TERMS
Payment is due within 30 days of invoice issuance. Any balance unpaid after 45 days will accrue a monthly finance charge of 1.5% (18% per annum). I agree to report any defects or concerns within seven (7) days of project completion. I am responsible for all costs not covered by insurance, including my deductible, withheld depreciation, and non-covered line items.

{{insurance_section}}

## GOVERNING LAW
This Agreement is governed by the laws of the State of Utah. Any dispute shall first be submitted to non-binding mediation. If mediation fails, the dispute shall be resolved by binding arbitration pursuant to the Utah Uniform Arbitration Act (Utah Code Ann. § 78B-11-101 et seq.). The prevailing party shall be entitled to recover reasonable attorney fees and costs.

By signing below, I confirm I have read and agree to all terms, and that I am authorized to execute this Agreement on behalf of the property owner.` }],

  direction_pay: [{ division: null, sort_order: 1,
    heading: 'Assignment of Benefits / Direction to Pay',
    body: `I, {{client_name}}, the undersigned insured or authorized representative, hereby irrevocably assign to {{company_name}} ("Company") all rights, title, and interest in insurance benefits payable under my property insurance policy with {{insurance_company}} (Policy No. {{policy_number}}) for the loss at {{address}}, {{city}}, {{state}}, on or about {{date_of_loss}} (Claim No. {{claim_number}}).

## SCOPE OF ASSIGNMENT
This assignment applies to all insurance proceeds attributable to restoration, mitigation, remediation, and repair services performed by the Company, including emergency services, water mitigation, mold remediation, structural repairs, contents restoration, and any supplemental amounts approved by the carrier.

## DIRECTION TO PAY
I hereby irrevocably direct {{insurance_company}} to issue all payments for covered restoration services payable to {{company_name}} as the authorized service provider. Checks issued solely in my name for covered services shall be promptly endorsed over to the Company.

## RIGHT TO NEGOTIATE & SUPPLEMENT
I authorize the Company to communicate directly with {{insurance_company}} and its representatives to negotiate, supplement, and finalize the claim on my behalf.

## DEDUCTIBLE OBLIGATION
This assignment does not relieve me of my obligation to pay the deductible required under my policy. My deductible is due directly to the Company.

## WITHHELD DEPRECIATION
I authorize the Company to collect any released recoverable depreciation directly from the carrier upon satisfactory completion of repairs and submission of required documentation.

This Direction to Pay shall remain in full force until the Company has received full and final payment for all authorized services. Any disputes shall be resolved through binding arbitration under the Utah Uniform Arbitration Act (Utah Code Ann. § 78B-11-101 et seq.).` }],

  change_order: [{ division: null, sort_order: 1,
    heading: 'Change Order Authorization',
    body: `This Change Order amends the original Work Authorization for the property at {{address}}, {{city}}, {{state}} (Job No. {{job_number}}).

I, {{client_name}}, hereby authorize {{company_name}} ("Company") to perform the additional scope of work described below. I understand this Change Order modifies the total contract value and that all other terms of the original Work Authorization remain in full force and effect.

## ADDITIONAL SCOPE OF WORK
[Describe the additional work authorized here]

## REASON FOR CHANGE
[State the reason — e.g., hidden damage discovered, scope expansion, supplemental approval]

## ACKNOWLEDGMENT
I confirm the additional scope has been explained to me in full, that I understand the nature of the work, and that I voluntarily authorize the Company to proceed. Payment for this additional scope is subject to the same payment terms as the original agreement.` }],
};

/* ═══ MARKDOWN RENDERER — handles ## Heading, **bold**, empty lines ═══ */
export function renderMarkdown(text) {
  if (!text) return null;
  return text.split('\n').map((line, i) => {
    if (line.startsWith('## ')) {
      return <div key={i} style={{ fontWeight: 700, fontSize: 12, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: i === 0 ? 0 : 14, marginBottom: 3 }}>{line.slice(3)}</div>;
    }
    if (!line.trim()) return <div key={i} style={{ height: 6 }} />;
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    const rendered = parts.map((p, j) => p.startsWith('**') && p.endsWith('**') ? <strong key={j}>{p.slice(2, -2)}</strong> : p);
    return <div key={i} style={{ fontSize: 13, color: '#334155', lineHeight: 1.65 }}>{rendered}</div>;
  });
}

/* ═══ PREVIEW VARIABLE SUBSTITUTION ═══ */
const SAMPLE_JOB = {
  insured_name: 'Dorothy Killian', job_number: 'UPR-2024-001',
  address: '1295 Oquirrh Dr', city: 'Provo', state: 'UT',
  date_of_loss: '2024-01-15', insurance_company: 'State Farm',
  claim_number: 'SF-12345678', policy_number: 'HO-987654321', adjuster_name: 'Jane Doe',
};

function substituteVarsPreview(text, withInsurance = true) {
  if (!text) return '';
  const co  = 'Utah Pros Restoration';
  const job = withInsurance ? SAMPLE_JOB : { ...SAMPLE_JOB, insurance_company: '', claim_number: '', policy_number: '' };

  const insuranceSection = job.insurance_company
    ? `## INSURANCE & DIRECTION TO PAY\nI authorize ${co} as the designated payee for all insurance proceeds. I authorize and direct ${job.insurance_company} (Claim No. ${job.claim_number}) to issue payment jointly or directly to ${co}. I agree to promptly endorse any insurance checks that include the Company's name. I remain responsible for my deductible and any amounts not covered by my carrier.`
    : `## PRIVATE PAY & CONDITIONAL ASSIGNMENT OF BENEFITS\nAt the time of signing, no insurance claim has been filed for the loss that is the subject of this Agreement. I agree to pay ${co} directly for all services rendered. All invoices are payable within 30 days of issuance.\n\n**SUBSEQUENT INSURANCE CLAIM:** If I file, or cause to be filed, an insurance claim related to the damage or loss described herein at any time — before, during, or after completion of the work — I hereby irrevocably pre-assign to ${co} all insurance proceeds attributable to the restoration, mitigation, and repair services performed under this Agreement. This pre-assignment is effective retroactively from the date of this Agreement. I agree to: (a) notify ${co} in writing within three (3) business days of filing any such claim; (b) execute a Direction to Pay and/or Assignment of Benefits in favor of ${co} immediately upon request; and (c) direct my insurance carrier to issue all applicable payments jointly or directly to ${co}. My obligation to pay ${co} in full for all authorized services is not contingent upon the filing, approval, or payment of any insurance claim.`;

  const m = {
    '{{insurance_section}}':  insuranceSection,
    '{{client_name}}':        job.insured_name,
    '{{job_number}}':         job.job_number,
    '{{address}}':            job.address,
    '{{city}}':               job.city,
    '{{state}}':              job.state,
    '{{date_of_loss}}':       'January 15, 2024',
    '{{insurance_company}}':  job.insurance_company || '',
    '{{claim_number}}':       job.claim_number      || '',
    '{{policy_number}}':      job.policy_number     || '',
    '{{adjuster_name}}':      job.adjuster_name     || '',
    '{{company_name}}':       co,
    '{{date}}':               new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
  };
  return Object.entries(m).reduce((t, [k, v]) => t.replaceAll(k, v), text);
}

/* ═══════════════════════════════════════════════════════════════════
   COMMISSIONS PANEL — set each person's sales-commission rate
   ═══════════════════════════════════════════════════════════════════ */
// One number drives commissions: a % of the job's invoice, OR a flat $ per sale
// (flat wins when both are set; see get_commissions). A rate set = that person
// is a salesperson; cleared = they earn nothing. Reads/writes via the
// get_employee_commissions / upsert_employee_commission RPCs.
const ROLE_LABELS = { admin: 'Admin', project_manager: 'Project Manager', supervisor: 'Supervisor', field_tech: 'Field Tech', office: 'Office' };

function rowFromEmployee(e) {
  // Derive the editable shape: flat wins over percent (matches get_commissions).
  const type = e.commission_flat != null ? 'flat' : e.commission_percent != null ? 'percent' : 'none';
  const value = type === 'flat' ? String(e.commission_flat) : type === 'percent' ? String(e.commission_percent) : '';
  return { type, value };
}

function CommissionsPanel({ db }) {
  const [employees, setEmployees] = useState([]);
  const [draft, setDraft] = useState({});        // { [id]: { type, value } }
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [showInactive, setShowInactive] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await db.rpc('get_employee_commissions');
      setEmployees(rows || []);
      setDraft(Object.fromEntries((rows || []).map(e => [e.id, rowFromEmployee(e)])));
    } catch (err) { errToast('Failed to load commissions: ' + (err.message || err)); }
    finally { setLoading(false); }
  }, [db]);
  useEffect(() => { load(); }, [load]);

  const isDirty = (e) => {
    const o = rowFromEmployee(e), d = draft[e.id] || o;
    return d.type !== o.type || (d.type !== 'none' && d.value.trim() !== o.value);
  };
  const setRow = (id, patch) => setDraft(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const save = async (e) => {
    const d = draft[e.id];
    const num = d.type === 'none' ? null : Number(d.value);
    if (d.type !== 'none' && (!Number.isFinite(num) || num < 0)) { errToast('Enter a valid rate (0 or more)'); return; }
    setSavingId(e.id);
    try {
      await db.rpc('upsert_employee_commission', {
        p_employee_id: e.id,
        p_percent: d.type === 'percent' ? num : null,
        p_flat:    d.type === 'flat'    ? num : null,
      });
      okToast(`Saved ${e.full_name}'s commission`);
      await load();
    } catch (err) { errToast('Failed to save: ' + (err.message || err)); }
    finally { setSavingId(null); }
  };

  if (loading) return <div className="settings-panel"><div className="spinner" /></div>;

  const visible = employees.filter(e => showInactive || e.is_active !== false);
  const earners = employees.filter(e => e.commission_percent != null || e.commission_flat != null).length;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 4 }}>
        <div>
          <h2 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>Commissions</h2>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
            {earners} {earners === 1 ? 'person earns' : 'people earn'} commission · paid first payroll of the month, for everything sold the previous month
          </p>
        </div>
      </div>

      <div style={{
        background: 'var(--accent-light)', border: '1px solid #bfdbfe', borderRadius: 'var(--radius-md)',
        padding: '10px 14px', fontSize: 12.5, lineHeight: 1.5, color: 'var(--text-primary)', margin: '12px 0 16px',
      }}>
        Set a <b>Percent</b> of the job’s invoice (e.g. 8 = 8%) <b>or</b> a <b>Flat</b> amount per sale (e.g. 250). A flat amount
        wins if both could apply. Leave it <b>None</b> for anyone who isn’t a salesperson. Full details in
        <b> Help → Estimates, Jobs, Sales &amp; Commissions</b>.
      </div>

      {/* Header row */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1.6fr 1fr 1.1fr 1.2fr auto', gap: 12, alignItems: 'center',
        padding: '8px 14px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md) var(--radius-md) 0 0',
        border: '1px solid var(--border-color)', borderBottom: 'none',
        fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase',
      }}>
        <span>Employee</span><span>Role</span><span>Type</span><span>Rate</span><span />
      </div>

      <div style={{ border: '1px solid var(--border-color)', borderRadius: '0 0 var(--radius-md) var(--radius-md)', overflow: 'hidden' }}>
        {visible.map((e, i) => {
          const d = draft[e.id] || { type: 'none', value: '' };
          const dirty = isDirty(e);
          const inactive = e.is_active === false;
          return (
            <div key={e.id} style={{
              display: 'grid', gridTemplateColumns: '1.6fr 1fr 1.1fr 1.2fr auto', gap: 12, alignItems: 'center',
              padding: '9px 14px', background: 'var(--bg-primary)',
              borderBottom: i < visible.length - 1 ? '1px solid var(--border-light)' : 'none',
              opacity: inactive ? 0.55 : 1,
            }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)' }}>
                {e.full_name}{inactive ? ' (inactive)' : ''}
              </span>
              <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{ROLE_LABELS[e.role] || e.role || '—'}</span>
              <select
                value={d.type}
                onChange={ev => setRow(e.id, { type: ev.target.value, value: ev.target.value === 'none' ? '' : d.value })}
                style={{
                  fontSize: 13, padding: '6px 8px', borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)',
                }}
              >
                <option value="none">None</option>
                <option value="percent">Percent %</option>
                <option value="flat">Flat $</option>
              </select>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {d.type === 'flat' && <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>$</span>}
                <input
                  type="number" min="0" step="any" inputMode="decimal"
                  disabled={d.type === 'none'}
                  value={d.type === 'none' ? '' : d.value}
                  placeholder={d.type === 'none' ? '—' : d.type === 'flat' ? '250' : '8'}
                  onChange={ev => setRow(e.id, { value: ev.target.value })}
                  style={{
                    width: 90, fontSize: 13, padding: '6px 8px', borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)', background: d.type === 'none' ? 'var(--bg-tertiary)' : 'var(--bg-primary)',
                    color: 'var(--text-primary)',
                  }}
                />
                {d.type === 'percent' && <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>%</span>}
              </div>
              <button
                className="btn btn-primary btn-sm"
                disabled={!dirty || savingId === e.id}
                onClick={() => save(e)}
                style={{ opacity: dirty ? 1 : 0.4, cursor: dirty ? 'pointer' : 'default', whiteSpace: 'nowrap' }}
              >
                {savingId === e.id ? 'Saving…' : 'Save'}
              </button>
            </div>
          );
        })}
        {visible.length === 0 && (
          <div style={{ padding: '20px 14px', textAlign: 'center', fontSize: 13, color: 'var(--text-tertiary)' }}>No employees.</div>
        )}
      </div>

      <button
        onClick={() => setShowInactive(v => !v)}
        style={{ marginTop: 12, background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', fontSize: 12.5, fontWeight: 600, color: 'var(--accent)', padding: 0 }}
      >
        {showInactive ? 'Hide inactive employees' : 'Show inactive employees'}
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   NOTIFICATIONS PANEL — enable/disable Web Push on THIS device (Phase F1)
   ═══════════════════════════════════════════════════════════════════
   Skeleton for the Notification Center: F1 ships one working control — "Enable
   push on this device" — behind feature:web_push. The full per-event×channel
   preferences matrix arrives in later phases (C fills it out). No modals; inline
   two-click confirm for turn-off; feedback via toasts (CLAUDE.md rule 2). */
function NotificationsPanel({ db }) {
  const { isFeatureEnabled } = useAuth();
  const flagOn    = isFeatureEnabled('feature:web_push');
  const supported = isPushSupported();
  const configured = isPushConfigured();

  const [loading, setLoading]   = useState(true);
  const [subscribed, setSubscribed] = useState(false);
  const [permission, setPermission] = useState('default');
  const [busy, setBusy]         = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setPermission(pushPermission());
      const sub = await getExistingSubscription();
      setSubscribed(!!sub);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  // iOS exposes Push only inside an installed PWA. Detect "iOS Safari, not
  // installed" so we can show the Add-to-Home-Screen guidance instead of a
  // dead Enable button.
  const isIOS = typeof navigator !== 'undefined' && /iP(hone|ad|od)/.test(navigator.userAgent || '');
  const isStandalone = typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator?.standalone === true);

  const enable = async () => {
    setBusy(true);
    try {
      const res = await enablePush(db);
      if (res.ok) { okToast('Push enabled on this device'); await refresh(); }
      else if (res.reason === 'denied') errToast('Notifications are blocked. Enable them in your browser/OS settings, then try again.');
      else if (res.reason === 'unconfigured') errToast('Push isn’t configured yet on the server.');
      else if (res.reason === 'unsupported') errToast('This device/browser can’t receive web push.');
      else errToast('Could not enable push — please try again.');
    } finally { setBusy(false); }
  };

  const disable = async () => {
    if (!confirmOff) { setConfirmOff(true); return; }
    setConfirmOff(false);
    setBusy(true);
    try {
      const res = await disablePush(db);
      if (res.ok) { okToast('Push disabled on this device'); await refresh(); }
      else errToast('Could not fully disable push — please try again.');
    } finally { setBusy(false); }
  };

  return (
    <div>
      <div style={{ marginBottom: 'var(--space-5)' }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Notifications</h2>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', margin: '4px 0 0' }}>
          Get push notifications on this device — even when the app is closed.
          More notification options are coming; for now you can turn device push on or off.
        </p>
      </div>

      {/* Enable-push row */}
      <div style={{
        border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-5)', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', gap: 'var(--space-4)', flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <IconBell style={{ width: 24, height: 24, color: 'var(--text-secondary)' }} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 'var(--text-base)' }}>Push on this device</div>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
              {loading ? 'Checking…'
                : subscribed ? 'Enabled — this device will receive push notifications.'
                : 'Not enabled on this device yet.'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          {!loading && subscribed && (
            <button
              className="btn btn-sm"
              onClick={disable}
              onBlur={() => setConfirmOff(false)}
              disabled={busy}
              style={{
                background: confirmOff ? '#fef2f2' : 'var(--bg-tertiary)',
                color:      confirmOff ? '#dc2626' : 'var(--text-secondary)',
                border:     `1px solid ${confirmOff ? '#fecaca' : 'var(--border-light)'}`,
              }}
            >
              {confirmOff ? 'Confirm turn off' : busy ? 'Working…' : 'Turn off'}
            </button>
          )}
          {!loading && !subscribed && (
            <button
              className="btn btn-primary btn-sm"
              onClick={enable}
              disabled={busy || !flagOn || !supported || !configured || permission === 'denied'}
            >
              {busy ? 'Enabling…' : 'Enable push on this device'}
            </button>
          )}
        </div>
      </div>

      {/* Contextual guidance */}
      {!flagOn && (
        <p style={{ marginTop: 12, fontSize: 12.5, color: 'var(--text-tertiary)' }}>
          Web push is being rolled out and isn’t enabled for your account yet.
        </p>
      )}
      {flagOn && !supported && isIOS && !isStandalone && (
        <div style={{
          marginTop: 12, padding: '12px 16px', background: 'var(--bg-secondary)',
          border: '1px solid var(--border-light)', borderRadius: 'var(--radius-md)',
          fontSize: 12.5, lineHeight: 1.6, color: 'var(--text-secondary)',
        }}>
          To get push on your iPhone, add this app to your Home Screen first:
          tap <b>Share</b> → <b>Add to Home Screen</b>, then open it from the Home
          Screen and enable push here.
        </div>
      )}
      {flagOn && !supported && !isIOS && (
        <p style={{ marginTop: 12, fontSize: 12.5, color: 'var(--text-tertiary)' }}>
          This browser can’t receive web push notifications.
        </p>
      )}
      {flagOn && supported && !configured && (
        <p style={{ marginTop: 12, fontSize: 12.5, color: 'var(--text-tertiary)' }}>
          Push isn’t configured on the server yet — check back soon.
        </p>
      )}
      {flagOn && supported && configured && permission === 'denied' && (
        <p style={{ marginTop: 12, fontSize: 12.5, color: 'var(--text-tertiary)' }}>
          Notifications are blocked for this site. Re-allow them in your
          browser/OS settings, then reload this page.
        </p>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   MAIN SETTINGS PAGE
   ═══════════════════════════════════════════════════════════════════ */
export default function Settings() {
  const { db } = useAuth();
  const [tab,       setTab]       = useState('carriers');
  const [carriers,  setCarriers]  = useState([]);
  const [referrals, setReferrals] = useState([]);
  const [loading,   setLoading]   = useState(true);

  const load = useCallback(async () => {
    try {
      const [c, r] = await Promise.all([
        db.rpc('get_insurance_carriers').catch(() => []),
        db.rpc('get_referral_sources').catch(() => []),
      ]);
      setCarriers(c); setReferrals(r);
    } catch (err) { console.error('Settings load error:', err); }
    finally { setLoading(false); }
  }, [db]);
  useEffect(() => { load(); }, [load]);

  // Google Drive OAuth redirect lands back here as ?gdrive=<status>. Toast the
  // result, switch to the Integrations tab, and strip the param from the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gdrive = params.get('gdrive');
    if (!gdrive) return;
    if (gdrive === 'connected')     okToast('Google connected (Drive + Calendar)');
    else if (gdrive === 'badstate') errToast('Google connect failed: state mismatch — try again');
    else                            errToast('Google connect failed' + (params.get('msg') ? `: ${params.get('msg')}` : ''));
    setTab('integrations');
    params.delete('gdrive'); params.delete('msg');
    window.history.replaceState({}, '', window.location.pathname + (params.toString() ? `?${params}` : ''));
  }, []);

  const saveCarrier = async (item) => {
    try {
      const p = { p_name: item.name, p_short_name: item.short_name || null, p_sort_order: item.sort_order || 999 };
      if (item.id) p.p_id = item.id;
      await db.rpc('upsert_insurance_carrier', p); await load(); return true;
    } catch (err) { errToast('Failed to save: ' + err.message); return false; }
  };
  const deleteCarrier = async (id) => {
    try { await db.rpc('delete_insurance_carrier', { p_id: id }); setCarriers(prev => prev.filter(c => c.id !== id)); return true; }
    catch (err) { errToast('Failed to delete: ' + err.message); return false; }
  };
  const saveReferral = async (item) => {
    try {
      const p = { p_name: item.name, p_category: item.category || 'other', p_sort_order: item.sort_order || 999 };
      if (item.id) p.p_id = item.id;
      await db.rpc('upsert_referral_source', p); await load(); return true;
    } catch (err) { errToast('Failed to save: ' + err.message); return false; }
  };
  const deleteReferral = async (id) => {
    try { await db.rpc('delete_referral_source', { p_id: id }); setReferrals(prev => prev.filter(r => r.id !== id)); return true; }
    catch (err) { errToast('Failed to delete: ' + err.message); return false; }
  };

  if (loading) return <div className="loading-page"><div className="spinner" /></div>;

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Manage lookup tables, company preferences, and system configuration.</p>
      </div>
      <div className="settings-body">
        <div className="settings-nav">
          {SETTINGS_NAV.map(({ group, tabs }) => (
            <div key={group}>
              <div className="settings-nav-label">{group}</div>
              {tabs.map(t => (
                <button key={t.key} className={`settings-nav-item${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>
                  <t.icon style={{ width: 16, height: 16 }} />{t.label}
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="settings-content">
          {tab === 'carriers'  && <LookupTable title="Insurance Carriers" subtitle={`${carriers.length} carriers`}  items={carriers}  onSave={saveCarrier}  onDelete={deleteCarrier}  columns={[{key:'name',label:'Carrier Name',flex:3,required:true},{key:'short_name',label:'Code',flex:1,placeholder:'SF'},{key:'sort_order',label:'Order',flex:0.5,type:'number',placeholder:'999'}]} newItemDefaults={{name:'',short_name:'',sort_order:999}}/>}
          {tab === 'referrals' && <LookupTable title="Referral Sources"   subtitle={`${referrals.length} sources`}  items={referrals} onSave={saveReferral} onDelete={deleteReferral} columns={[{key:'name',label:'Source Name',flex:3,required:true},{key:'category',label:'Category',flex:2,type:'select',options:REF_CATEGORIES},{key:'sort_order',label:'Order',flex:0.5,type:'number',placeholder:'999'}]} newItemDefaults={{name:'',category:'other',sort_order:999}}/>}
          {tab === 'templates' && <DocumentTemplatesPanel db={db} />}
          {tab === 'commissions' && <CommissionsPanel db={db} />}
          {tab === 'integrations' && <GoogleDriveIntegrationPanel db={db} />}
          {tab === 'notifications' && <NotificationsPanel db={db} />}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   GOOGLE INTEGRATION PANEL — per-user connect / disconnect (Drive + Calendar)
   ═══════════════════════════════════════════════════════════════════ */
function GoogleDriveIntegrationPanel({ db }) {
  const [status,     setStatus]     = useState(null);   // { connected, google_email, connected_at }
  const [cal,        setCal]        = useState(null);   // { connected, synced_count, error_count }
  const [loading,    setLoading]    = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [syncing,    setSyncing]    = useState(false);
  const [confirmDisc, setConfirmDisc] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [drive, calendar] = await Promise.all([
        db.rpc('get_google_drive_status').catch(() => []),
        db.rpc('get_google_calendar_status').catch(() => []),
      ]);
      setStatus(Array.isArray(drive) ? (drive[0] || { connected: false }) : (drive || { connected: false }));
      setCal(Array.isArray(calendar) ? (calendar[0] || { connected: false }) : (calendar || { connected: false }));
    } finally { setLoading(false); }
  }, [db]);
  useEffect(() => { load(); }, [load]);

  const connect = async () => {
    setConnecting(true);
    try {
      const auth = await getAuthHeader();
      const res = await fetch('/api/google-drive-connect', { method: 'GET', headers: auth });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || res.statusText);
      window.location.href = data.url;
    } catch (e) {
      errToast('Could not start Google connect: ' + e.message);
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    if (!confirmDisc) { setConfirmDisc(true); return; }
    setConfirmDisc(false);
    try {
      const auth = await getAuthHeader();
      const res = await fetch('/api/google-drive-disconnect', { method: 'POST', headers: auth });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
      okToast('Google disconnected');
      load();
    } catch (e) {
      errToast('Failed to disconnect: ' + e.message);
    }
  };

  // Push the signed-in user's upcoming appointments to Google Calendar now.
  const syncCalendar = async () => {
    setSyncing(true);
    try {
      const auth = await getAuthHeader();
      const res = await fetch('/api/google-calendar-resync', { method: 'POST', headers: auth });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      okToast(`Synced ${data.synced || 0} of ${data.appointments || 0} appointments to Google Calendar`);
      load();
    } catch (e) {
      errToast('Calendar sync failed: ' + e.message);
    } finally { setSyncing(false); }
  };

  if (loading) return <div style={{ padding: 32, display: 'flex', justifyContent: 'center' }}><div className="spinner" /></div>;

  const connected    = status?.connected;
  const calConnected = cal?.connected;

  return (
    <div>
      <div style={{ marginBottom: 'var(--space-5)' }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Google</h2>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', margin: '4px 0 0' }}>
          Connect your Google account once to attach files to jobs from your Drive and
          push the appointments you're assigned to into your Google Calendar.
          Your connection is private to you.
        </p>
      </div>

      {/* Account connection card */}
      <div style={{
        border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-5)', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', gap: 'var(--space-4)', flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <IconDrive style={{ width: 24, height: 24, color: 'var(--text-secondary)' }} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 'var(--text-base)' }}>
              {connected ? 'Connected' : 'Not connected'}
            </div>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
              {connected
                ? `${status.google_email || 'Google account'}${status.connected_at ? ` · since ${new Date(status.connected_at).toLocaleDateString()}` : ''}`
                : 'No Google account linked yet.'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          {connected && (
            <button
              className="btn btn-sm"
              onClick={disconnect}
              onBlur={() => setConfirmDisc(false)}
              style={{
                background: confirmDisc ? '#fef2f2' : 'var(--bg-tertiary)',
                color:      confirmDisc ? '#dc2626' : 'var(--text-secondary)',
                border:     `1px solid ${confirmDisc ? '#fecaca' : 'var(--border-light)'}`,
              }}
            >
              {confirmDisc ? 'Confirm Disconnect' : 'Disconnect'}
            </button>
          )}
          <button className="btn btn-primary btn-sm" onClick={connect} disabled={connecting}>
            {connecting ? 'Opening Google…' : connected ? 'Reconnect' : 'Connect Google'}
          </button>
        </div>
      </div>

      {/* Calendar feature row */}
      <div style={{
        marginTop: 'var(--space-3)',
        border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-5)', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', gap: 'var(--space-4)', flexWrap: 'wrap',
      }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 'var(--text-base)' }}>Calendar sync</div>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
            {calConnected
              ? `Appointments you're assigned to sync to your Google Calendar · ${cal.synced_count || 0} synced${cal.error_count ? ` · ${cal.error_count} errored` : ''}`
              : connected
                ? 'Reconnect to grant calendar access.'
                : 'Connect Google above to enable.'}
          </div>
        </div>
        {calConnected && (
          <button className="btn btn-sm" onClick={syncCalendar} disabled={syncing}>
            {syncing ? 'Syncing…' : 'Sync my appointments'}
          </button>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   DOCUMENT TEMPLATES PANEL — card list → click to open editor
   ═══════════════════════════════════════════════════════════════════ */
function DocumentTemplatesPanel({ db }) {
  const [dbTemplates, setDbTemplates] = useState({});
  const [loading,     setLoading]     = useState(true);
  const [openDoc,     setOpenDoc]     = useState(null);

  useEffect(() => { loadTemplates(); }, []);

  const loadTemplates = async () => {
    setLoading(true);
    try {
      const rows = await db.rpc('get_document_templates').catch(() => []);
      const map  = {};
      for (const row of rows || []) {
        map[`${row.doc_type}::${row.division || '_'}`] = { heading: row.heading, body: row.body, sort_order: row.sort_order };
      }
      setDbTemplates(map);
    } finally { setLoading(false); }
  };

  const getTemplate = (docType, division) => {
    const k     = `${docType}::${division || '_'}`;
    const saved = dbTemplates[k];
    if (saved) return saved;
    const def = (DEFAULT_TEMPLATES[docType] || []).find(t => t.division === division);
    return def ? { heading: def.heading, body: def.body, sort_order: def.sort_order } : { heading: '', body: '', sort_order: 0 };
  };

  const handleSaved = (docType, updates) => {
    setDbTemplates(prev => {
      const next = { ...prev };
      for (const u of updates) next[`${docType}::${u.division || '_'}`] = { heading: u.heading, body: u.body, sort_order: u.sort_order };
      return next;
    });
    setOpenDoc(null);
    okToast('Template saved');
  };

  if (loading) return <div style={{ padding: 32, display: 'flex', justifyContent: 'center' }}><div className="spinner" /></div>;

  if (openDoc) {
    const docMeta = DOC_TYPES.find(d => d.key === openDoc);
    const defs    = DEFAULT_TEMPLATES[openDoc] || [];
    const initial = defs.map(def => ({ division: def.division, sort_order: def.sort_order, ...getTemplate(openDoc, def.division) }));
    return <TemplateEditor db={db} docType={openDoc} docMeta={docMeta} initialSections={initial} onBack={() => setOpenDoc(null)} onSaved={(u) => handleSaved(openDoc, u)} />;
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>Document Templates</h2>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
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
                    <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>{doc.label}</span>
                    {hasCustom && <span style={{ fontSize: 10, fontWeight: 700, background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe', borderRadius: 9999, padding: '1px 7px' }}>Custom</span>}
                  </div>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{doc.description}</p>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, paddingTop: 12, borderTop: '1px solid var(--border-light)' }}>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{doc.sections} {doc.sections === 1 ? 'section' : 'sections'}</span>
                <button className="btn btn-secondary btn-sm" onClick={() => setOpenDoc(doc.key)} style={{ gap: 5, fontSize: 12 }}>
                  <IconEdit style={{ width: 12, height: 12 }} /> Edit Document
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 20, padding: '12px 16px', background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border-light)', fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
        💡 Use <code style={{ background: 'var(--bg-tertiary)', padding: '1px 5px', borderRadius: 3 }}>{'{{variable}}'}</code> for job data · <code style={{ background: 'var(--bg-tertiary)', padding: '1px 5px', borderRadius: 3, color: '#1d4ed8' }}>{'{{insurance_section}}'}</code> in Work Authorization auto-switches between insurance DTP and private-pay+conditional-assignment language
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   TEMPLATE EDITOR
   ═══════════════════════════════════════════════════════════════════ */
function TemplateEditor({ db, docType, docMeta, initialSections, onBack, onSaved }) {
  const [sections,    setSections]    = useState(() => initialSections.map(s => ({ ...s })));
  const [dirty,       setDirty]       = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [preview,     setPreview]     = useState(false);
  const [confirmBack, setConfirmBack] = useState(false);
  const lastFocused = useRef(null);

  const update = (idx, field, value) => {
    setSections(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
    setDirty(true);
  };

  const insertVar = (varKey) => {
    if (!lastFocused.current) return;
    const { el, idx, field } = lastFocused.current;
    if (!el) return;
    const start  = el.selectionStart ?? el.value.length;
    const end    = el.selectionEnd   ?? el.value.length;
    const newVal = el.value.substring(0, start) + varKey + el.value.substring(end);
    update(idx, field, newVal);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + varKey.length, start + varKey.length); });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await Promise.all(sections.map(s => db.rpc('upsert_document_template', {
        p_doc_type: docType, p_division: s.division, p_heading: s.heading, p_body: s.body, p_sort_order: s.sort_order,
      })));
      onSaved(sections);
    } catch (err) { errToast('Save failed: ' + err.message); }
    finally { setSaving(false); }
  };

  const handleReset = () => { setSections((DEFAULT_TEMPLATES[docType] || []).map(d => ({ ...d }))); setDirty(true); };
  const handleBack  = () => { if (dirty) { setConfirmBack(true); return; } onBack(); };
  const isLong = docType !== 'coc';

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn btn-ghost btn-sm" onClick={handleBack} style={{ gap: 4, padding: '0 8px', height: 30 }}>
            <IconChevronLeft style={{ width: 14, height: 14 }} /> Documents
          </button>
          <span style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>/</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{docMeta?.icon} {docMeta?.label}</span>
          {dirty && <span style={{ fontSize: 11, color: '#d97706', fontWeight: 600 }}>● Unsaved</span>}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-ghost btn-sm" onClick={handleReset} style={{ gap: 4 }} title="Reset to built-in defaults"><IconRefresh style={{ width: 12, height: 12 }} /> Reset</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setPreview(p => !p)} style={{ gap: 4 }}>
            {preview ? <><IconEyeOff style={{ width: 14, height: 14 }} /> Edit</> : <><IconEye style={{ width: 14, height: 14 }} /> Preview</>}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={handleBack}>Discard</button>
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>

      {confirmBack && (
        <div style={{ marginBottom: 16, padding: '12px 16px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: '#92400e', flex: 1 }}>You have unsaved changes. Discard them?</span>
          <button className="btn btn-sm" onClick={onBack} style={{ background: '#fef2f2', color: '#ef4444', border: '1px solid #fecaca', fontSize: 12 }}>Discard changes</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setConfirmBack(false)} style={{ fontSize: 12 }}>Keep editing</button>
        </div>
      )}

      {preview ? (
        <TemplatePreview docType={docType} sections={sections} />
      ) : (
        <>
          <div style={{ marginBottom: 12, padding: '10px 14px', background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border-light)' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Insert variable at cursor</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {TEMPLATE_VARIABLES.map(v => (
                <button key={v.key} onClick={() => insertVar(v.key)} style={{
                  fontSize: 11, fontFamily: 'monospace', cursor: 'pointer',
                  background: v.special ? '#eff6ff' : 'var(--bg-primary)',
                  border: `1px solid ${v.special ? '#bfdbfe' : 'var(--border-color)'}`,
                  borderRadius: 4, padding: '3px 8px',
                  color: v.special ? '#1d4ed8' : 'var(--brand-primary)',
                  fontWeight: 600, lineHeight: 1.4,
                }} title={v.special ? 'Smart: renders insurance DTP or private-pay+conditional-assignment paragraph based on job' : `Insert ${v.key}`}>
                  {v.label}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 6 }}>
              <strong style={{ color: '#1d4ed8' }}>Insurance/Pay §</strong> — insurance job: DTP paragraph · out-of-pocket: private-pay + pre-assignment clause if claim is ever filed later
            </div>
          </div>

          <div style={{ marginBottom: 12, fontSize: 11, color: 'var(--text-tertiary)' }}>
            Formatting: <code style={{ background: 'var(--bg-tertiary)', padding: '1px 4px', borderRadius: 3 }}>## Heading</code> for section titles &nbsp;·&nbsp;
            <code style={{ background: 'var(--bg-tertiary)', padding: '1px 4px', borderRadius: 3 }}>**bold**</code> for emphasis &nbsp;·&nbsp; Ctrl+B = bold
          </div>

          {sections.map((sec, idx) => {
            const divMeta = sec.division ? DIVISION_META[sec.division] : null;
            return (
              <SectionEditor key={idx} idx={idx} divMeta={divMeta} heading={sec.heading} body={sec.body}
                onHeadingChange={v => update(idx, 'heading', v)}
                onBodyChange={v => update(idx, 'body', v)}
                onFocus={(el, field) => { lastFocused.current = { el, idx, field }; }}
                isLong={isLong}
              />
            );
          })}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8, paddingTop: 16, borderTop: '1px solid var(--border-light)' }}>
            <button className="btn btn-secondary btn-sm" onClick={handleBack}>Discard</button>
            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </>
      )}
    </div>
  );
}

/* ═══ RICH TEXT AREA ═══ */
function RichTextArea({ value, onChange, onFocus, isLong }) {
  const ref = useRef(null);

  const wrapSelection = (marker) => {
    const el = ref.current; if (!el) return;
    const start  = el.selectionStart; const end = el.selectionEnd;
    const sel    = el.value.substring(start, end);
    const newVal = el.value.substring(0, start) + marker + sel + marker + el.value.substring(end);
    onChange(newVal);
    requestAnimationFrame(() => {
      el.focus();
      const pos = sel.length > 0 ? start + marker.length + sel.length + marker.length : start + marker.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const toggleHeading = () => {
    const el = ref.current; if (!el) return;
    const start     = el.selectionStart;
    const lineStart = el.value.lastIndexOf('\n', start - 1) + 1;
    const rest      = el.value.substring(lineStart);
    const isH       = rest.startsWith('## ');
    onChange(el.value.substring(0, lineStart) + (isH ? rest.slice(3) : '## ' + rest));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + (isH ? -3 : 3), start + (isH ? -3 : 3)); });
  };

  const handleKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') { e.preventDefault(); wrapSelection('**'); }
  };

  const tbBtn = { fontSize: 11, fontWeight: 700, padding: '2px 8px', height: 24, background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 4, cursor: 'pointer', color: 'var(--text-secondary)', lineHeight: 1, display: 'inline-flex', alignItems: 'center' };

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, padding: '4px 6px', background: 'var(--bg-secondary)', borderRadius: '6px 6px 0 0', border: '1px solid var(--border-light)', borderBottom: 'none' }}>
        <button type="button" onClick={() => wrapSelection('**')} style={{ ...tbBtn, fontWeight: 900, fontSize: 13 }} title="Bold (Ctrl+B)">B</button>
        <button type="button" onClick={toggleHeading}             style={tbBtn}                                        title="Section Heading (## )">H</button>
        <span style={{ fontSize: 10, color: 'var(--text-tertiary)', alignSelf: 'center', marginLeft: 4 }}>Ctrl+B = bold</span>
      </div>
      <textarea ref={ref} className="input textarea" value={value} onChange={e => onChange(e.target.value)} onFocus={e => { onFocus?.(e.target); }} onKeyDown={handleKeyDown}
        rows={isLong ? 20 : 4} style={{ fontSize: 13, lineHeight: 1.65, resize: 'vertical', minHeight: isLong ? 280 : 72, fontFamily: 'monospace', borderRadius: '0 0 6px 6px' }} />
    </div>
  );
}

/* ═══ SECTION EDITOR ═══ */
function SectionEditor({ idx, divMeta, heading, body, onHeadingChange, onBodyChange, onFocus, isLong }) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div style={{ marginBottom: 12, border: '1px solid var(--border-light)', borderRadius: 8, overflow: 'hidden' }}>
      {divMeta && (
        <button onClick={() => setExpanded(p => !p)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--bg-secondary)', border: 'none', cursor: 'pointer', textAlign: 'left', borderBottom: expanded ? '1px solid var(--border-light)' : 'none' }}>
          <span style={{ fontSize: 16 }}>{divMeta.emoji}</span>
          <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{divMeta.label}</span>
          <span style={{ marginLeft: 'auto', color: 'var(--text-tertiary)', fontSize: 11 }}>{expanded ? '▾' : '▸'}</span>
        </button>
      )}
      {(expanded || !divMeta) && (
        <div style={{ padding: 14 }}>
          <div style={{ marginBottom: 10 }}>
            <label style={tplLbl}>Section Heading</label>
            <input className="input" value={heading} onChange={e => onHeadingChange(e.target.value)} onFocus={e => onFocus(e.target, 'heading')} style={{ height: 34, fontSize: 13 }} />
          </div>
          <div>
            <label style={tplLbl}>Body Text</label>
            <RichTextArea value={body} onChange={onBodyChange} onFocus={el => onFocus(el, 'body')} isLong={isLong} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══ TEMPLATE PREVIEW ═══ */
const DOC_TYPE_LABELS = { coc: 'Certificate of Completion', work_auth: 'Work Authorization', direction_pay: 'Direction of Pay', change_order: 'Change Order' };

function TemplatePreview({ docType, sections }) {
  const [oop, setOop] = useState(false);
  return (
    <div>
      {docType === 'work_auth' && (
        <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Preview as:</span>
          <button className={`btn btn-sm ${!oop ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setOop(false)} style={{ fontSize: 11 }}>Insurance job</button>
          <button className={`btn btn-sm ${oop  ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setOop(true)}  style={{ fontSize: 11 }}>Out-of-pocket job</button>
        </div>
      )}
      <div style={{ border: '1px solid var(--border-light)', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ background: '#1e293b', padding: '12px 18px' }}>
          <div style={{ fontWeight: 700, color: '#fff', fontSize: 14 }}>Utah Pros Restoration</div>
          <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 2 }}>Licensed · Insured · Utah</div>
        </div>
        <div style={{ padding: '24px 28px', background: '#f8fafc', maxHeight: 620, overflowY: 'auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 700, color: '#0f172a' }}>{DOC_TYPE_LABELS[docType] || docType}</h3>
            <div style={{ width: 60, height: 3, background: '#2563eb', margin: '0 auto', borderRadius: 2 }} />
          </div>
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: '12px 16px', marginBottom: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px' }}>
            {(oop
              ? [['Client','Dorothy Killian'],['Job #','UPR-2024-001'],['Property','1295 Oquirrh Dr, Provo, UT']]
              : [['Client','Dorothy Killian'],['Job #','UPR-2024-001'],['Property','1295 Oquirrh Dr, Provo, UT'],['Insurance','State Farm'],['Claim #','SF-12345678'],['Date of Loss','January 15, 2024']]
            ).map(([l,v]) => (
              <div key={l}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{l}</div>
                <div style={{ fontSize: 13, color: '#0f172a', fontWeight: 500, marginTop: 2 }}>{v}</div>
              </div>
            ))}
          </div>
          {sections.map((s, i) => (
            <div key={i} style={{ marginBottom: 16, background: '#fff', padding: '14px 16px', borderRadius: 6, border: '1px solid #e2e8f0' }}>
              <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#1e293b' }}>
                {substituteVarsPreview(s.heading, !oop)}
              </p>
              <div>{renderMarkdown(substituteVarsPreview(s.body, !oop))}</div>
            </div>
          ))}
          <div style={{ padding: '12px 16px', background: '#fff', borderRadius: 6, border: '1px solid #e2e8f0', borderLeft: '3px solid #2563eb' }}>
            <p style={{ margin: 0, fontSize: 12, color: '#64748b', fontStyle: 'italic' }}>Authorization clause, full-name field, signature pad, and agreement checkbox appear here in the actual document.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

const tplLbl = { display: 'block', fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 };

/* ═══════════════════════════════════════════════════════════════════
   LOOKUP TABLE — Generic CRUD
   ═══════════════════════════════════════════════════════════════════ */
function LookupTable({ title, subtitle, items, onSave, onDelete, columns, newItemDefaults }) {
  const [search,          setSearch]          = useState('');
  const [editingId,       setEditingId]       = useState(null);
  const [editForm,        setEditForm]        = useState({});
  const [saving,          setSaving]          = useState(false);
  const [validationError, setValidationError] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const nameRef = useRef(null);

  const filtered    = search.trim() ? items.filter(item => columns.some(col => { const val = item[col.key]; return val && String(val).toLowerCase().includes(search.toLowerCase()); })) : items;
  const startEdit   = (item) => { setEditingId(item.id); const form = {}; for (const col of columns) form[col.key] = item[col.key] ?? ''; form.id = item.id; setEditForm(form); setTimeout(() => nameRef.current?.focus(), 50); };
  const startAdd    = () => { setEditingId('new'); setEditForm({ ...newItemDefaults }); setTimeout(() => nameRef.current?.focus(), 50); };
  const cancelEdit  = () => { setEditingId(null); setEditForm({}); };
  const handleSave  = async () => {
    const required = columns.filter(c => c.required);
    for (const col of required) { if (!editForm[col.key]?.toString().trim()) { setValidationError(`${col.label} is required`); return; } }
    setValidationError(''); setSaving(true);
    const item = { ...editForm }; if (editingId === 'new') delete item.id;
    if (item.sort_order !== undefined) item.sort_order = parseInt(item.sort_order) || 999;
    const ok = await onSave(item); setSaving(false); if (ok) cancelEdit();
  };
  const handleDelete  = async (id) => { await onDelete(id); setConfirmDeleteId(null); };
  const handleKeyDown = (e) => { if (e.key === 'Enter') { e.preventDefault(); handleSave(); } if (e.key === 'Escape') cancelEdit(); };
  const set           = (key, val) => setEditForm(prev => ({ ...prev, [key]: val }));

  const RowCells = () => columns.map(col => (
    <div key={col.key} className="lookup-cell" style={{ flex: col.flex || 1 }}>
      {col.type === 'select'
        ? <select className="input lookup-input" value={editForm[col.key] || ''} onChange={e => set(col.key, e.target.value)} style={{ cursor: 'pointer' }}>{col.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        : <input ref={col.required ? nameRef : undefined} className="input lookup-input" type={col.type || 'text'} value={editForm[col.key] ?? ''} onChange={e => { set(col.key, e.target.value); setValidationError(''); }} onKeyDown={handleKeyDown} placeholder={col.placeholder || col.label} />
      }
    </div>
  ));

  return (
    <div className="lookup-table">
      <div className="lookup-header">
        <div><h2 className="lookup-title">{title}</h2><p className="lookup-subtitle">{subtitle}</p></div>
        <button className="btn btn-primary btn-sm" onClick={startAdd} disabled={editingId === 'new'}><IconPlus style={{ width: 14, height: 14 }} /> Add</button>
      </div>
      <div className="lookup-search-wrap">
        <IconSearch style={{ width: 14, height: 14 }} className="lookup-search-icon" />
        <input className="input lookup-search" placeholder={`Search ${title.toLowerCase()}...`} value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      <div className="lookup-table-wrap">
        <div className="lookup-row lookup-row-header">
          {columns.map(col => <div key={col.key} className="lookup-cell" style={{ flex: col.flex || 1 }}>{col.label}</div>)}
          <div className="lookup-cell lookup-cell-actions" style={{ width: 80 }}>Actions</div>
        </div>
        {editingId === 'new' && (
          <>
            <div className="lookup-row lookup-row-editing"><RowCells /><div className="lookup-cell lookup-cell-actions" style={{ width: 80 }}><button className="lookup-action-btn save" onClick={handleSave} disabled={saving}><IconCheck style={{ width: 14, height: 14 }} /></button><button className="lookup-action-btn cancel" onClick={cancelEdit}><IconX style={{ width: 14, height: 14 }} /></button></div></div>
            {validationError && <div style={{ padding: '6px 12px', fontSize: 12, color: '#ef4444', background: '#fef2f2', borderBottom: '1px solid #fecaca' }}>{validationError}</div>}
          </>
        )}
        {filtered.length === 0 && editingId !== 'new'
          ? <div className="lookup-empty">{search ? `No results for "${search}"` : 'No items yet. Click "Add" to create one.'}</div>
          : filtered.map(item => editingId === item.id ? (
            <>
              <div key={item.id} className="lookup-row lookup-row-editing"><RowCells /><div className="lookup-cell lookup-cell-actions" style={{ width:80 }}><button className="lookup-action-btn save" onClick={handleSave} disabled={saving}><IconCheck style={{ width: 14, height: 14 }} /></button><button className="lookup-action-btn cancel" onClick={cancelEdit}><IconX style={{ width: 14, height: 14 }} /></button></div></div>
              {validationError && <div style={{ padding: '6px 12px', fontSize: 12, color: '#ef4444', background: '#fef2f2', borderBottom: '1px solid #fecaca' }}>{validationError}</div>}
            </>
          ) : (
            <div key={item.id} className="lookup-row">
              {columns.map(col => (
                <div key={col.key} className="lookup-cell" style={{ flex: col.flex || 1 }}>
                  {col.type === 'select' ? (col.options?.find(o => o.value === item[col.key])?.label || item[col.key] || '—') : (item[col.key] ?? '—')}
                </div>
              ))}
              <div className="lookup-cell lookup-cell-actions" style={{ width: confirmDeleteId === item.id ? 140 : 80 }}>
                {confirmDeleteId === item.id ? (<>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginRight: 4 }}>Delete?</span>
                  <button className="lookup-action-btn save" onClick={() => handleDelete(item.id)} style={{ background: '#fef2f2', color: '#ef4444' }}><IconCheck style={{ width: 14, height: 14 }} /></button>
                  <button className="lookup-action-btn cancel" onClick={() => setConfirmDeleteId(null)}><IconX style={{ width: 14, height: 14 }} /></button>
                </>) : (<>
                  <button className="lookup-action-btn edit"   onClick={() => startEdit(item)}             title="Edit"><IconEdit  style={{ width: 14, height: 14 }} /></button>
                  <button className="lookup-action-btn delete" onClick={() => setConfirmDeleteId(item.id)} title="Delete"><IconTrash style={{ width: 14, height: 14 }} /></button>
                </>)}
              </div>
            </div>
          ))
        }
      </div>
    </div>
  );
}
