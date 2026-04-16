import { useState } from 'react';

/*
  ReconAgreementContent
  ─────────────────────
  Renders the middle content (below header, above signature block) of the
  signer page when doc_type === 'recon_agreement'.

  Differences from the classic SignPage renderer:
    - Expandable summary cards (property info, authorizations, scope, payment)
    - Full 16-section legal text in an expandable drawer
    - Four separately-attested consent checkboxes
    - Amber branding (reconstruction) vs blue (mitigation)

  Caller owns:
    - Name input, signature pad, submit button (SignPage.jsx)
    - consents state + onConsentChange handler (this component only flips them)
    - submission via /api/submit-esign

  Props
    job              — job row from get_sign_request_by_token
    templates        — array of 16 document_templates rows (sort_order 1-16)
    consents         — { terms, commitment, esign, authority } booleans
    onConsentChange  — (key, bool) => void
    submitting       — disable consent toggles during submit
*/

/* ─── Inline SVG icons (lucide-react replacements) ─────────────────── */
function Icon({ d, children, size = 18, ...p }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      {children || <path d={d} />}
    </svg>
  );
}
const IconCheck         = (p) => <Icon d="M20 6L9 17l-5-5" {...p} />;
const IconChevronDown   = (p) => <Icon d="M6 9l6 6 6-6" {...p} />;
const IconChevronUp     = (p) => <Icon d="M18 15l-6-6-6 6" {...p} />;
const IconFileText      = (p) => (
  <Icon {...p}>
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="16" y1="13" x2="8" y2="13"/>
    <line x1="16" y1="17" x2="8" y2="17"/>
    <polyline points="10 9 9 9 8 9"/>
  </Icon>
);
const IconShield        = (p) => <Icon d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" {...p} />;
const IconHammer        = (p) => (
  <Icon {...p}>
    <path d="M15 12l-8.5 8.5a2.12 2.12 0 01-3-3L12 9"/>
    <path d="M17.64 15L22 10.64"/>
    <path d="M20.91 11.7l-1.25-1.25a2.12 2.12 0 010-3l1.1-1.1a2.12 2.12 0 013 0l1.25 1.25"/>
  </Icon>
);
const IconClipboardList = (p) => (
  <Icon {...p}>
    <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
    <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/>
    <line x1="12" y1="11" x2="16" y2="11"/>
    <line x1="12" y1="16" x2="16" y2="16"/>
    <line x1="8" y1="11" x2="8.01" y2="11"/>
    <line x1="8" y1="16" x2="8.01" y2="16"/>
  </Icon>
);

/* ─── Minimal markdown renderer (paragraphs + **bold**) ────────────── */
function renderBody(text) {
  if (!text) return null;
  return text.split('\n').map((line, i) => {
    if (!line.trim()) return <div key={i} style={{ height: 8 }} />;
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    const rendered = parts.map((p, j) =>
      p.startsWith('**') && p.endsWith('**')
        ? <strong key={j}>{p.slice(2, -2)}</strong>
        : p
    );
    return (
      <p key={i} style={{ margin: '0 0 8px', fontSize: 13, color: '#4b5563', lineHeight: 1.65 }}>
        {rendered}
      </p>
    );
  });
}

/* ─── Expandable card ──────────────────────────────────────────────── */
function Expandable({ title, icon, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{
      border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff',
      marginBottom: 12, overflow: 'hidden',
    }}>
      <button onClick={() => setOpen(!open)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: 16, background: 'transparent', border: 'none', cursor: 'pointer',
          textAlign: 'left', fontFamily: 'inherit',
        }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            padding: 6, borderRadius: 8, background: '#fef3c7', color: '#d97706',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {icon}
          </div>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#1f2937' }}>{title}</span>
        </div>
        {open ? <IconChevronUp size={18} color="#9ca3af" /> : <IconChevronDown size={18} color="#9ca3af" />}
      </button>
      {open && (
        <div style={{ padding: '0 16px 16px', borderTop: '1px solid #f3f4f6' }}>
          {children}
        </div>
      )}
    </div>
  );
}

/* ─── Info row (key/value) ─────────────────────────────────────────── */
function InfoRow({ label, value }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f9fafb' }}>
      <span style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 500, color: '#1f2937', textAlign: 'right', maxWidth: '60%' }}>{value}</span>
    </div>
  );
}

/* ─── Authorization bullet ─────────────────────────────────────────── */
function AuthItem({ text }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '6px 0' }}>
      <div style={{
        marginTop: 2, flexShrink: 0, width: 16, height: 16, borderRadius: '50%',
        background: '#d1fae5', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <IconCheck size={10} color="#059669" />
      </div>
      <span style={{ fontSize: 13, color: '#374151', lineHeight: 1.55 }}>{text}</span>
    </div>
  );
}

/* ─── Consent checkbox (attested acknowledgment) ───────────────────── */
function ConsentCheck({ checked, onChange, disabled, children }) {
  return (
    <label style={{
      display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 0',
      cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1,
    }}>
      <div
        onClick={() => !disabled && onChange(!checked)}
        style={{
          marginTop: 2, flexShrink: 0, width: 20, height: 20, borderRadius: 4,
          border: `2px solid ${checked ? '#f59e0b' : '#d1d5db'}`,
          background: checked ? '#f59e0b' : '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all 0.12s',
        }}>
        {checked && <IconCheck size={13} color="#fff" />}
      </div>
      <span style={{ fontSize: 13, color: '#374151', lineHeight: 1.55 }}>{children}</span>
    </label>
  );
}

/* ─── Highlight box (amber accent) ─────────────────────────────────── */
function AmberNote({ title, children }) {
  return (
    <div style={{ background: '#fffbeb', borderRadius: 8, padding: 12, marginBottom: 10 }}>
      <p style={{ fontSize: 12, fontWeight: 600, color: '#92400e', marginBottom: 4, margin: 0 }}>{title}</p>
      <p style={{ fontSize: 12, color: '#b45309', lineHeight: 1.55, margin: '4px 0 0' }}>{children}</p>
    </div>
  );
}
function PlainNote({ title, children }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <p style={{ fontSize: 12, fontWeight: 600, color: '#1f2937', marginBottom: 4, margin: 0 }}>{title}</p>
      <p style={{ fontSize: 12, color: '#4b5563', lineHeight: 1.55, margin: '4px 0 0' }}>{children}</p>
    </div>
  );
}

/* ─── Main component ───────────────────────────────────────────────── */
export default function ReconAgreementContent({ job, templates, consents, onConsentChange, submitting }) {
  const address =
    [job?.address, job?.city, job?.state].filter(Boolean).join(', ') +
    (job?.zip ? ` ${job.zip}` : '');

  const dateOfLoss = job?.date_of_loss
    ? new Date(job.date_of_loss + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : '';

  return (
    <>
      {/* ── Intro ── */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <div style={{
            padding: 8, borderRadius: 12, background: '#fef3c7',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <IconHammer size={20} color="#d97706" />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#111827' }}>Reconstruction Agreement</h1>
            <p style={{ margin: 0, fontSize: 12, color: '#6b7280' }}>Property Repair &amp; Reconstruction Services</p>
          </div>
        </div>
        <p style={{ fontSize: 14, color: '#4b5563', lineHeight: 1.6, marginTop: 12, marginBottom: 0 }}>
          This agreement authorizes us to prepare a reconstruction estimate, negotiate with your insurance company, and perform the approved repairs to your property.
        </p>
      </div>

      {/* ── Property & Insurance Info ── */}
      <Expandable title="Property & Insurance Info" icon={<IconFileText size={16} />} defaultOpen>
        <div style={{ marginTop: 8 }}>
          <InfoRow label="Address" value={address} />
          <InfoRow label="Homeowner" value={job?.insured_name} />
          <InfoRow label="Phone" value={job?.client_phone} />
          <InfoRow label="Email" value={job?.client_email} />
          <InfoRow label="Insurance" value={job?.insurance_company} />
          <InfoRow label="Claim #" value={job?.claim_number} />
          <InfoRow label="Date of Loss" value={dateOfLoss} />
          <InfoRow label="Job #" value={job?.job_number} />
        </div>
      </Expandable>

      {/* ── What You're Authorizing ── */}
      <Expandable title="What You're Authorizing" icon={<IconCheck size={16} />} defaultOpen>
        <div style={{ marginTop: 8 }}>
          <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 8, margin: 0 }}>By signing, you authorize Utah Pros to:</p>
          <AuthItem text="Prepare a detailed Xactimate reconstruction estimate for your property" />
          <AuthItem text="Submit the estimate to your insurance carrier and negotiate for full scope approval" />
          <AuthItem text="Perform reconstruction and repair work per the approved estimate" />
          <AuthItem text="Submit supplements for additional or hidden damage found during reconstruction" />
          <AuthItem text="Pull required permits and schedule inspections" />
          <AuthItem text="Use qualified subcontractors as needed" />
          <AuthItem text="Photograph and document property conditions throughout the project" />
          <AuthItem text="File a Preliminary Notice on the property per Utah lien law (§38-1a)" />
        </div>
      </Expandable>

      {/* ── Scope & Estimate summary ── */}
      <Expandable title="Scope & Estimate" icon={<IconClipboardList size={16} />} defaultOpen>
        <div style={{ marginTop: 8 }}>
          <AmberNote title="How It Works">
            We'll prepare a detailed Xactimate estimate covering all reconstruction work, submit it to your insurance company, and negotiate on your behalf to get the full scope approved. That estimate becomes part of this agreement.
          </AmberNote>
          <PlainNote title="Your Commitment">
            By signing, you're committing to use Utah Pros for the reconstruction work. We invest significant time writing detailed estimates and negotiating with adjusters — this commitment ensures we're both invested in a successful project.
          </PlainNote>
          <PlainNote title="Change Orders">
            Any changes to the approved scope must be documented in a written Change Order signed by both parties. If hidden damage is found, we'll document it and submit a supplement to your insurer.
          </PlainNote>
        </div>
      </Expandable>

      {/* ── Payment summary ── */}
      <Expandable title="Payment" icon={<IconShield size={16} />} defaultOpen>
        <div style={{ marginTop: 8 }}>
          <AmberNote title="Direction to Pay">
            You irrevocably direct your insurance company to pay all covered reconstruction amounts directly to Utah Pros at 1055 N State St, Orem, UT 84057. If a joint check is issued, you will endorse and deliver it within 5 business days.
          </AmberNote>
          <PlainNote title="Your Responsibility">
            You are responsible for your deductible (if not already paid during mitigation), depreciation, and any amounts not covered by insurance. If your carrier hasn't paid within 30 days of estimate approval, you accept responsibility to pursue payment and pay Utah Pros within 60 days of invoice.
          </PlainNote>
          <PlainNote title="Selections & Upgrades">
            Insurance covers repair to pre-loss condition. If you choose upgraded materials or fixtures beyond what insurance allows, you're responsible for the difference. Upgrade costs are due before installation.
          </PlainNote>
          <PlainNote title="Late Payments">
            Unpaid balances accrue interest at 1.5%/month. Utah Pros may recover attorney fees and collection costs.
          </PlainNote>
        </div>
      </Expandable>

      {/* ── Full Terms & Conditions (16 sections from DB) ── */}
      <Expandable
        title={`Terms & Conditions (${templates?.length || 0} Sections)`}
        icon={<IconFileText size={16} />}
      >
        <div style={{ marginTop: 12 }}>
          {(templates || []).map(t => (
            <div key={t.id || t.sort_order} style={{ marginBottom: 18 }}>
              <p style={{
                fontSize: 13, fontWeight: 700, color: '#1f2937',
                marginTop: 0, marginBottom: 6, paddingBottom: 4,
                borderBottom: '1px solid #fde68a',
              }}>
                {t.heading}
              </p>
              {renderBody(t.body)}
            </div>
          ))}
        </div>
      </Expandable>

      {/* ── Consents ── */}
      <div style={{
        background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12,
        padding: 16, marginBottom: 16, marginTop: 16,
      }}>
        <p style={{
          fontSize: 11, fontWeight: 600, color: '#6b7280',
          textTransform: 'uppercase', letterSpacing: '0.05em',
          marginTop: 0, marginBottom: 10,
        }}>
          Required Acknowledgments
        </p>
        <ConsentCheck
          checked={consents.terms} disabled={submitting}
          onChange={(v) => onConsentChange('terms', v)}
        >
          I have read and agree to the <strong style={{ color: '#b45309' }}>Terms &amp; Conditions</strong> attached to this agreement.
        </ConsentCheck>
        <ConsentCheck
          checked={consents.commitment} disabled={submitting}
          onChange={(v) => onConsentChange('commitment', v)}
        >
          I understand that I am <strong style={{ color: '#b45309' }}>committing to use Utah Pros for reconstruction</strong> and that cancellation after the estimate is prepared is subject to the fees outlined in Section 1 of the Terms &amp; Conditions.
        </ConsentCheck>
        <ConsentCheck
          checked={consents.esign} disabled={submitting}
          onChange={(v) => onConsentChange('esign', v)}
        >
          I consent to <strong style={{ color: '#b45309' }}>electronic signature</strong> under the Utah UETA and federal E-SIGN Act. My electronic signature has the same legal effect as a handwritten signature.
        </ConsentCheck>
        <ConsentCheck
          checked={consents.authority} disabled={submitting}
          onChange={(v) => onConsentChange('authority', v)}
        >
          I confirm I am the <strong style={{ color: '#b45309' }}>property owner or authorized representative</strong> with authority to authorize reconstruction and payment terms.
        </ConsentCheck>
      </div>
    </>
  );
}
