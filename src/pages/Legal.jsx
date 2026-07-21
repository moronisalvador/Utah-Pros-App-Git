// Public legal pages — Privacy Policy & Terms of Service.
// Served at /privacy and /terms (no auth) so they can be linked from the Intuit
// (QuickBooks) app profile and anywhere else a public URL is required.

import { Link } from 'react-router-dom';

const UPDATED       = 'June 18, 2026';
const COMPANY       = 'Utah Pros Restoration';
const CONTACT_EMAIL = 'restoration@utah-pros.com';

const h2 = { fontSize: 18, fontWeight: 700, color: 'var(--text-primary, #111318)', margin: '28px 0 8px' };

function LegalLayout({ title, children }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-secondary, #f8f9fb)', padding: '40px 20px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', background: 'var(--bg-primary, #fff)', border: '1px solid var(--border-color, #e2e5e9)', borderRadius: 12, padding: '40px 44px' }}>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent, #2563eb)', marginBottom: 8 }}>{COMPANY}</div>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 4px', color: 'var(--text-primary, #111318)' }}>{title}</h1>
        <div style={{ fontSize: 13, color: 'var(--text-tertiary, #8b929e)', marginBottom: 28 }}>Last updated: {UPDATED}</div>
        <div style={{ fontSize: 15, lineHeight: 1.7, color: 'var(--text-secondary, #5f6672)' }}>
          {children}
        </div>
        <div style={{ marginTop: 36, paddingTop: 20, borderTop: '1px solid var(--border-light, #f0f1f3)', fontSize: 13, color: 'var(--text-tertiary, #8b929e)' }}>
          Questions? Contact us at <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--accent, #2563eb)' }}>{CONTACT_EMAIL}</a>.
          {' · '}<Link to="/privacy" style={{ color: 'var(--accent, #2563eb)' }}>Privacy</Link>
          {' · '}<Link to="/terms" style={{ color: 'var(--accent, #2563eb)' }}>Terms</Link>
        </div>
      </div>
    </div>
  );
}

export function PrivacyPolicy() {
  return (
    <LegalLayout title="Privacy Policy">
      <p>{COMPANY} ("we," "us," or "our") operates an internal business management platform (the "Platform") used to run our restoration business — managing customers, jobs, insurance claims, scheduling, documents, and billing. This Privacy Policy explains what information the Platform handles and how we protect it.</p>

      <h2 style={h2}>Who this applies to</h2>
      <p>The Platform is private software for use by {COMPANY} and its authorized employees and contractors. It is not a public product and is not offered for sale or public sign-up.</p>

      <h2 style={h2}>Information we handle</h2>
      <p>To operate our business, the Platform stores information including: customer and contact details (names, addresses, phone numbers, email addresses), job and insurance-claim details, photos and documents related to work performed, scheduling and time records, and employee account information.</p>

      <h2 style={h2}>How we use information</h2>
      <p>Information is used solely to operate {COMPANY}'s business — including coordinating work, communicating with customers, generating estimates and invoices, and maintaining accurate financial and project records.</p>

      <h2 style={h2}>Third-party services</h2>
      <p>The Platform connects to trusted third-party services to perform its functions, and shares only the data necessary for each. These include Intuit QuickBooks Online (accounting and customer/invoice synchronization) and providers used for messaging and email. When data is shared with Intuit, it is handled in accordance with Intuit's privacy policy. We do not sell personal information.</p>

      <h2 style={h2}>Data security</h2>
      <p>Data is stored in secured, access-controlled systems. Access is limited to authorized {COMPANY} personnel who need it for their roles, and is protected by authentication and encryption in transit.</p>

      <h2 style={h2}>Data retention</h2>
      <p>We retain business records for as long as necessary to operate our business and to meet legal, tax, and contractual obligations.</p>

      <h2 style={h2}>Your choices</h2>
      <p>Customers may request access to, correction of, or deletion of their personal information — subject to our legal and recordkeeping obligations — by contacting us at the email below.</p>

      <h2 style={h2}>Changes</h2>
      <p>We may update this Privacy Policy from time to time. The "Last updated" date above reflects the most recent revision.</p>
    </LegalLayout>
  );
}

export function TermsOfService() {
  return (
    <LegalLayout title="Terms of Service">
      <p>These Terms of Service ("Terms") govern access to and use of the {COMPANY} internal business management platform (the "Platform").</p>

      <h2 style={h2}>Authorized use</h2>
      <p>The Platform is private software provided for the exclusive use of {COMPANY} and its authorized employees and contractors. Access is granted by {COMPANY} and may be revoked at any time. The Platform is not offered to, or for use by, the general public.</p>

      <h2 style={h2}>Acceptable use</h2>
      <p>Authorized users agree to use the Platform only for legitimate {COMPANY} business purposes, to keep their login credentials confidential, and not to misuse, copy, or attempt to gain unauthorized access to the Platform or its data.</p>

      <h2 style={h2}>Third-party integrations</h2>
      <p>The Platform integrates with third-party services, including Intuit QuickBooks Online. Use of those integrations is also subject to the respective third party's terms and policies. {COMPANY} is not responsible for the availability or accuracy of third-party services.</p>

      <h2 style={h2}>No warranty</h2>
      <p>The Platform is provided "as is" and "as available," without warranties of any kind, express or implied, including fitness for a particular purpose.</p>

      <h2 style={h2}>Limitation of liability</h2>
      <p>To the maximum extent permitted by law, {COMPANY} shall not be liable for any indirect, incidental, or consequential damages arising from use of the Platform.</p>

      <h2 style={h2}>Changes</h2>
      <p>We may update these Terms from time to time. Continued use of the Platform constitutes acceptance of the then-current Terms.</p>
    </LegalLayout>
  );
}

export function Support() {
  return (
    <LegalLayout title="Support">
      <p>{COMPANY} operates an internal business management app (UPR) used by our own employees and contractors to run field-service and restoration work — job scheduling, claims, time tracking, and billing.</p>

      <h2 style={h2}>Getting help</h2>
      <p>If you're an authorized {COMPANY} employee or contractor and need help with the app — a login issue, a bug, or a question about a feature — contact us at <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--accent, #2563eb)' }}>{CONTACT_EMAIL}</a> and we'll get back to you as soon as possible.</p>

      <h2 style={h2}>Account access</h2>
      <p>Accounts are provisioned by {COMPANY} for its own staff — the app is not available for public sign-up. If you need an account, or need an existing account deactivated, contact us at the email above.</p>

      <h2 style={h2}>Related pages</h2>
      <p>See our <Link to="/privacy" style={{ color: 'var(--accent, #2563eb)' }}>Privacy Policy</Link> and <Link to="/terms" style={{ color: 'var(--accent, #2563eb)' }}>Terms of Service</Link> for more on how the app handles data and its terms of use.</p>
    </LegalLayout>
  );
}
