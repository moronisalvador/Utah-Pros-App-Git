import { useState } from 'react';

const COMPANY = 'Utah Pros Restoration';

const SAMPLE_JOB = {
  insured_name: 'John & Jane Smith',
  job_number: 'UPR-2026-0412',
  address: '1234 Maple Drive',
  city: 'Sandy',
  state: 'UT',
  zip: '84070',
  date_of_loss: '2026-03-15',
  insurance_company: 'State Farm',
  claim_number: 'CLM-98765432',
  policy_number: 'POL-12345678',
  adjuster_name: 'Mike Johnson',
};

function substituteVars(text, job) {
  const hasInsurance = !!job.insurance_company;
  const insuranceSection = hasInsurance
    ? `## INSURANCE & DIRECTION TO PAY\nI authorize ${COMPANY} as the designated payee for all insurance proceeds related to the restoration of this Property. I authorize and direct ${job.insurance_company}${job.claim_number ? ` (Claim No. ${job.claim_number})` : ''} to issue payment jointly or directly to ${COMPANY}. I agree to promptly endorse and forward any insurance checks that include the Company's name. I remain responsible for my deductible and any amounts not covered by my carrier.`
    : `## PRIVATE PAY & CONDITIONAL ASSIGNMENT OF BENEFITS\nAt the time of signing, no insurance claim has been filed for the loss that is the subject of this Agreement. I agree to pay ${COMPANY} directly for all services rendered. All invoices are payable within 30 days of issuance.`;
  const m = {
    '{{insurance_section}}': insuranceSection,
    '{{client_name}}': job.insured_name || '',
    '{{job_number}}': job.job_number || '',
    '{{address}}': job.address || '',
    '{{city}}': job.city || '',
    '{{state}}': job.state || '',
    '{{zip}}': job.zip || '',
    '{{date_of_loss}}': job.date_of_loss
      ? new Date(job.date_of_loss + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      : '',
    '{{insurance_company}}': job.insurance_company || '',
    '{{claim_number}}': job.claim_number || '',
    '{{policy_number}}': job.policy_number || '',
    '{{adjuster_name}}': job.adjuster_name || '',
    '{{company_name}}': COMPANY,
    '{{date}}': new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
  };
  return Object.entries(m).reduce((t, [k, v]) => t.replaceAll(k, v), text);
}

function renderMarkdown(text) {
  if (!text) return null;
  return text.split('\n').map((line, i) => {
    if (line.startsWith('## ')) {
      return <div key={i} style={{ fontWeight: 700, fontSize: 12, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: i === 0 ? 0 : 14, marginBottom: 3 }}>{line.slice(3)}</div>;
    }
    if (!line.trim()) return <div key={i} style={{ height: 6 }} />;
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    const rendered = parts.map((p, j) => p.startsWith('**') && p.endsWith('**') ? <strong key={j}>{p.slice(2, -2)}</strong> : p);
    return <div key={i} style={{ fontSize: 14, color: '#334155', lineHeight: 1.65 }}>{rendered}</div>;
  });
}

const TEMPLATE_BODY = `## AUTHORIZATION TO PERFORM SERVICES

I, {{client_name}}, the undersigned homeowner, policy holder, or authorized agent, hereby authorize {{company_name}} ("Company") to perform all necessary restoration, mitigation, remediation, and repair services at the property located at {{address}}, {{city}}, {{state}} ("Property").

## SCOPE OF WORK
I authorize the Company to perform all labor, equipment, and material necessary to properly restore and mitigate damage at the Property, including emergency services required to prevent further loss. The scope of work includes removal of non-salvageable material per IICRC S500 standards, and proper cleaning, treating, sanitizing, drying, and sealing of non-porous surfaces where applicable.

## CHEMICAL USE & SAFETY
The Company will use EPA-registered antimicrobials and sanitizers following IICRC standards. I agree to notify the Company of any known chemical sensitivities prior to commencement of work so that appropriate adjustments can be made.

## DRYING EQUIPMENT
I understand that high-velocity air movers and commercial dehumidifiers will be installed to accelerate the drying process. I will not turn off, unplug, or remove drying equipment without prior authorization from the Company. Target relative humidity is 25\u201335%. I will not open windows or doors unless instructed by the Company.

## EQUIPMENT RESPONSIBILITY
I am responsible for the safekeeping of drying equipment while in my care and custody. I agree to take reasonable precautions to prevent loss or theft of any equipment installed at the Property.

## STOP WORK / HOLD HARMLESS
If I instruct the Company to stop work before completion or remove drying equipment prematurely, I agree to release, indemnify, and hold harmless the Company, its officers, employees, and agents from any and all claims or liability arising from incomplete procedures or resulting secondary damage.

## PAYMENT TERMS
Payment is due within 30 days of invoice issuance. Any balance unpaid after 45 days will accrue a monthly finance charge of 1.5% (18% per annum). I agree to report any defects or concerns within seven (7) days of project completion. I am responsible for all costs not covered by insurance, including my deductible, withheld depreciation, and non-covered line items.

{{insurance_section}}

## GOVERNING LAW
This Agreement is governed by the laws of the State of Utah. Any dispute shall first be submitted to non-binding mediation. If mediation fails, the dispute shall be resolved by binding arbitration pursuant to the Utah Uniform Arbitration Act (Utah Code Ann. \u00A7 78B-11-101 et seq.). The prevailing party shall be entitled to recover reasonable attorney fees and costs.

By signing below, I confirm I have read and agree to all terms, and that I am authorized to execute this Agreement on behalf of the property owner.`;

export default function WorkAuthDemo() {
  const [oop, setOop] = useState(false);
  const job = oop ? { ...SAMPLE_JOB, insurance_company: '', claim_number: '', policy_number: '' } : SAMPLE_JOB;
  const body = substituteVars(TEMPLATE_BODY, job);

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerInner}>
          <h1 style={styles.company}>{COMPANY}</h1>
          <p style={styles.companySub}>Licensed &middot; Bonded &middot; Insured</p>
        </div>
      </div>

      {/* Content */}
      <div style={styles.content}>
        {/* Demo banner */}
        <div style={styles.demoBanner}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#2563eb', marginBottom: 4 }}>Demo Preview</div>
          <div style={{ fontSize: 13, color: '#475569' }}>This is a preview of the Work Authorization document your customers will receive for e-signature.</div>
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, color: '#64748b' }}>Preview as:</span>
            <button onClick={() => setOop(false)} style={{ ...styles.toggleBtn, ...(oop ? {} : styles.toggleActive) }}>Insurance Job</button>
            <button onClick={() => setOop(true)}  style={{ ...styles.toggleBtn, ...(oop ? styles.toggleActive : {}) }}>Out-of-Pocket</button>
          </div>
        </div>

        {/* Title */}
        <div style={styles.titleBlock}>
          <h2 style={styles.docTitle}>Work Authorization</h2>
          <div style={styles.titleLine} />
        </div>

        {/* Info grid */}
        <div style={styles.infoGrid}>
          <div><span style={styles.infoLabel}>Client</span><span style={styles.infoValue}>{job.insured_name}</span></div>
          <div><span style={styles.infoLabel}>Job #</span><span style={styles.infoValue}>{job.job_number}</span></div>
          <div><span style={styles.infoLabel}>Property</span><span style={styles.infoValue}>{job.address}, {job.city}, {job.state}</span></div>
          <div><span style={styles.infoLabel}>Date of Loss</span><span style={styles.infoValue}>{new Date(job.date_of_loss + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span></div>
          {job.insurance_company && <div><span style={styles.infoLabel}>Insurance</span><span style={styles.infoValue}>{job.insurance_company}</span></div>}
          {job.claim_number && <div><span style={styles.infoLabel}>Claim #</span><span style={styles.infoValue}>{job.claim_number}</span></div>}
        </div>

        {/* Document body */}
        <div style={styles.docBody}>
          {renderMarkdown(body)}
        </div>

        {/* Signature area (demo) */}
        <div style={styles.sigArea}>
          <label style={styles.fieldLabel}>Full Legal Name</label>
          <div style={styles.inputDemo}>{job.insured_name}</div>

          <label style={{ ...styles.fieldLabel, marginTop: 16 }}>Signature</label>
          <div style={styles.sigBox}>
            <span style={{ fontFamily: '"Dancing Script", cursive, serif', fontSize: 36, color: '#94a3b8' }}>Signature appears here</span>
          </div>

          <div style={styles.checkDemo}>
            <div style={{ width: 18, height: 18, border: '2px solid #cbd5e1', borderRadius: 4, flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: '#475569' }}>I have read and agree to all terms above and confirm I am authorized to sign.</span>
          </div>

          <button style={styles.submitBtn} disabled>Submit Signature</button>
        </div>

        <div style={styles.footer}>
          This is a demo preview &middot; No data is collected on this page
        </div>
      </div>
    </div>
  );
}

const styles = {
  page: { minHeight: '100vh', background: '#f1f5f9', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  header: { background: '#1e293b', padding: '20px 24px' },
  headerInner: { maxWidth: 640, margin: '0 auto' },
  company: { margin: 0, fontSize: 18, fontWeight: 700, color: '#fff', letterSpacing: '-0.2px' },
  companySub: { margin: '2px 0 0', fontSize: 12, color: '#94a3b8' },
  content: { maxWidth: 640, margin: '0 auto', padding: '28px 20px 60px' },
  demoBanner: { background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '14px 18px', marginBottom: 24 },
  toggleBtn: { fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', color: '#64748b', cursor: 'pointer' },
  toggleActive: { background: '#2563eb', color: '#fff', borderColor: '#2563eb' },
  titleBlock: { textAlign: 'center', marginBottom: 24 },
  docTitle: { margin: '0 0 8px', fontSize: 22, fontWeight: 700, color: '#0f172a' },
  titleLine: { width: 80, height: 3, background: '#2563eb', borderRadius: 2, margin: '0 auto' },
  infoGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px', marginBottom: 24, padding: '16px 18px', background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0' },
  infoLabel: { display: 'block', fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 },
  infoValue: { display: 'block', fontSize: 13, color: '#1e293b', fontWeight: 500 },
  docBody: { background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: '20px 22px', marginBottom: 24 },
  sigArea: { background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: '20px 22px', marginBottom: 20 },
  fieldLabel: { display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 },
  inputDemo: { width: '100%', padding: '12px 14px', fontSize: 15, borderRadius: 8, border: '1.5px solid #cbd5e1', background: '#f8fafc', color: '#94a3b8', boxSizing: 'border-box' },
  sigBox: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: 140, background: '#f8fafc', border: '1.5px dashed #cbd5e1', borderRadius: 8, marginBottom: 16 },
  checkDemo: { display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 20 },
  submitBtn: { width: '100%', padding: '14px', background: '#94a3b8', color: '#fff', fontSize: 16, fontWeight: 700, border: 'none', borderRadius: 10, fontFamily: 'inherit', letterSpacing: '0.1px', cursor: 'not-allowed' },
  footer: { textAlign: 'center', fontSize: 12, color: '#94a3b8', marginTop: 20 },
};
