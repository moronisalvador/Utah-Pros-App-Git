import { useState } from 'react';

// ═══════════════════════════════════════════════════════════════════════
// HELP & GUIDES — employee tutorials. Currently: Invoicing & Financials.
// Reachable from the sidebar by every logged-in user (not role-gated).
// The downloadable PDF is served from /public.
// ═══════════════════════════════════════════════════════════════════════

const PDF_URL = '/UPR-Invoicing-Financials-Guide.pdf';

const ACCENT = 'var(--accent)';

function Card({ children, style }) {
  return (
    <div style={{
      background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
      borderRadius: 'var(--radius-lg)', padding: '20px 22px', marginBottom: 16,
      ...style,
    }}>
      {children}
    </div>
  );
}

function SectionTitle({ n, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
      <span style={{
        flexShrink: 0, width: 26, height: 26, borderRadius: 'var(--radius-full)',
        background: 'var(--accent-light)', color: ACCENT, fontWeight: 700, fontSize: 13,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>{n}</span>
      <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>{children}</h2>
    </div>
  );
}

function Steps({ items }) {
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((t, i) => (
        <li key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <span style={{
            flexShrink: 0, width: 22, height: 22, borderRadius: 'var(--radius-full)',
            background: ACCENT, color: '#fff', fontWeight: 700, fontSize: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 1,
          }}>{i + 1}</span>
          <span style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--text-secondary)' }}
                dangerouslySetInnerHTML={{ __html: t }} />
        </li>
      ))}
    </ol>
  );
}

function Bullets({ items, color }) {
  return (
    <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map((t, i) => (
        <li key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
          <span style={{ color: color || ACCENT, fontWeight: 800, lineHeight: 1.4 }}>•</span>
          <span dangerouslySetInnerHTML={{ __html: t }} />
        </li>
      ))}
    </ul>
  );
}

function Callout({ children, tone = 'green' }) {
  const tones = {
    green: { bg: '#f0fdf4', border: '#bbf7d0' },
    amber: { bg: '#fffbeb', border: '#fde68a' },
    blue:  { bg: 'var(--accent-light)', border: '#bfdbfe' },
  };
  const t = tones[tone] || tones.green;
  return (
    <div style={{
      background: t.bg, border: `1px solid ${t.border}`, borderRadius: 'var(--radius-md)',
      padding: '10px 14px', fontSize: 13.5, lineHeight: 1.5, color: 'var(--text-primary)',
    }} dangerouslySetInnerHTML={{ __html: children }} />
  );
}

const GLOSSARY = [
  ['Estimated', 'What we expected the job to be worth early on.'],
  ['Approved', 'What the carrier approved.'],
  ['Invoiced', 'Total <b>pushed to QuickBooks</b>. What we’ve officially billed.'],
  ['Collected', 'Payments you’ve <b>logged</b> as received.'],
  ['Balance', 'Invoiced − Collected. What’s still owed.'],
  ['Deductible Owed', 'The customer’s deductible that hasn’t been collected yet.'],
  ['Insurance A/R', 'What insurance still owes after the deductible.'],
];

const FAQ = [
  ['The Collections balance still shows an old number.',
   'That job probably predates this system. <b>Older jobs keep their existing numbers</b> and don’t need re-invoicing. Only jobs with a freshly <b>pushed</b> invoice switch to the new figures.'],
  ['I logged a payment but Invoiced didn’t change.',
   'Correct — logging a payment changes <b>Collected</b> and <b>Balance</b>, never <b>Invoiced</b>. Invoiced only changes when you push or adjust the invoice itself.'],
  ['Does QuickBooks payment info flow back automatically?',
   'Not yet. <b>For now, log payments by hand</b> in Collections. Automatic QuickBooks payment sync is planned for a later update.'],
  ['I got a red “Error” badge.',
   'Hover it to see why — usually the contact needs to be linked to a QuickBooks customer first. Fix that, then <b>Push to QuickBooks</b> again.'],
  ['Can I undo a push?',
   'Yes — <b>Remove from QuickBooks</b> pulls it back so you can correct the amount and re-push.'],
];

export default function Help() {
  const [openFaq, setOpenFaq] = useState(null);

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '24px 20px 60px' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: 'var(--text-primary)' }}>
            Invoicing &amp; Financials
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: 15, color: 'var(--text-secondary)' }}>
            How we create invoices, push them to QuickBooks, and track collections in UPR.
          </p>
        </div>
        <a href={PDF_URL} target="_blank" rel="noopener noreferrer" className="btn btn-primary"
           style={{ textDecoration: 'none', whiteSpace: 'nowrap' }}>
          ⬇ Download PDF
        </a>
      </div>

      {/* 1. Big picture */}
      <Card>
        <SectionTitle n="1">The Big Picture</SectionTitle>
        <div style={{
          background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-md)', padding: '12px 14px', marginBottom: 14,
          fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--text-primary)', lineHeight: 1.8,
          overflowX: 'auto',
        }}>
          JOB&nbsp; → &nbsp;CREATE INVOICE&nbsp; → &nbsp;PUSH TO QUICKBOOKS&nbsp; → &nbsp;COLLECTIONS<br />
          <span style={{ color: 'var(--text-tertiary)' }}>(the work)&nbsp;&nbsp;&nbsp;(draft in UPR)&nbsp;&nbsp;&nbsp;(real QBO invoice)&nbsp;&nbsp;&nbsp;(get paid + track)</span>
        </div>
        <Bullets items={[
          '<b>One invoice per job — and a job is one division.</b> A claim with Mitigation and Reconstruction is two jobs = two invoices. Insurance pays each category on a separate check, so each check matches its own invoice.',
          '<b>“Invoiced” means pushed to QuickBooks.</b> A new invoice starts as a <b>draft</b> and doesn’t count as billed yet. The moment you <b>Push to QuickBooks</b>, it becomes real, the balance clock starts, and it appears in Collections.',
          '<b>QuickBooks is the official record. UPR is where you build the invoice and chase payment.</b>',
          '<b>The financial numbers come straight from your invoices.</b> Once a job has a pushed invoice, its Invoiced / Balance update automatically — you don’t type them by hand.',
        ]} />
      </Card>

      {/* 2. Who can do what */}
      <Card>
        <SectionTitle n="2">Who Can Do What</SectionTitle>
        <Bullets items={[
          '<b>Create invoices, set amounts, push to QuickBooks, log payments:</b> Admins, Managers, Project Managers, Supervisors.',
          '<b>Everyone else:</b> can see the info (read-only). The edit buttons simply won’t show.',
        ]} />
      </Card>

      {/* 3. Create an invoice */}
      <Card>
        <SectionTitle n="3">Create &amp; Send an Invoice</SectionTitle>
        <p style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--text-secondary)' }}>
          <b>Where:</b> Open the <b>Claim</b>, then find the <b>Billing</b> section.
          <span style={{ color: 'var(--text-tertiary)' }}> (Desktop: the “Billing” card near the bottom. Phone: tap <b>Billing</b> to expand.)</span>
        </p>
        <Steps items={[
          'Open the claim (from Claims, or a job’s “View Job”).',
          'Go to <b>Billing</b>. You’ll see one row per job/division, e.g. “Reconstruction · J-1042”.',
          'Click <b>Create invoice</b>. The row shows a draft with an invoice number and status <b>draft</b>.',
          'Type the amount and click <b>Save amount</b>.',
          '<b>Double-check the amount</b> — this is what goes to QuickBooks.',
          'Click <b>Push to QuickBooks</b>.',
          'Confirm the green <b>QuickBooks #…</b> badge appears. That means it’s officially invoiced.',
        ]} />
        <div style={{ marginTop: 12 }}>
          <Callout tone="amber">
            <b>Fixing mistakes:</b> A red <b>Error</b> badge? Hover to read why (usually the customer isn’t linked in QuickBooks yet) — fix it and push again. Pushed the wrong amount? Click <b>Remove from QuickBooks</b>, correct the amount, and push again.
          </Callout>
        </div>
      </Card>

      {/* 4. Collections */}
      <Card>
        <SectionTitle n="4">Track Payments &amp; Collections</SectionTitle>
        <p style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--text-secondary)' }}>
          <b>Where:</b> <b>Collections</b> in the main menu → click the claim.
        </p>
        <Steps items={[
          '<b>A payment comes in?</b> Click <b>+ Log Payment</b>, choose the source (insurance, deductible, homeowner/out-of-pocket), enter the amount and date, and save. The Balance updates automatically.',
          '<b>Deductible collected?</b> Click the amber <b>“○ $X owed”</b> button by Deductible — it flips to green <b>“✓ Rcvd”</b>.',
          '<b>Update the A/R status:</b> Open → Invoiced → Partial → Paid (or Disputed / Written Off).',
          '<b>Log every follow-up</b> with <b>📝 Notes</b> — this builds the Collections Log so anyone can pick up where you left off.',
        ]} />
      </Card>

      {/* 5. Reading the numbers */}
      <Card>
        <SectionTitle n="5">Reading the Numbers</SectionTitle>
        <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
          {GLOSSARY.map(([term, def], i) => (
            <div key={term} style={{
              display: 'grid', gridTemplateColumns: '150px 1fr', gap: 12,
              padding: '9px 14px', fontSize: 13.5, alignItems: 'start',
              background: i % 2 ? 'var(--bg-secondary)' : 'var(--bg-primary)',
              borderBottom: i < GLOSSARY.length - 1 ? '1px solid var(--border-light)' : 'none',
            }}>
              <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{term}</div>
              <div style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }} dangerouslySetInnerHTML={{ __html: def }} />
            </div>
          ))}
        </div>
        <p style={{ margin: '12px 0 0', fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Rule of thumb: <b>Invoiced − Collected = Balance.</b> If the Balance looks wrong, it’s almost always an invoice that wasn’t pushed, or a payment that wasn’t logged.
        </p>
      </Card>

      {/* 6. Good practices */}
      <Card>
        <SectionTitle n="6">Good Practices</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
          <div>
            <div style={{ fontWeight: 700, color: '#16a34a', marginBottom: 8, fontSize: 14 }}>✓ DO</div>
            <Bullets color="#16a34a" items={[
              'One invoice per division (Mitigation and Reconstruction each get their own).',
              'Only push when the amount is <b>final</b> — pushing creates the real QuickBooks invoice and starts the A/R clock. Not sure yet? Leave it a saved draft.',
              'Verify the amount before pushing; confirm the green badge after.',
              'Log payments the day they arrive, with the correct source.',
              'Mark the deductible received as soon as it’s collected.',
              'Keep the Collections Log current — note every follow-up.',
            ]} />
          </div>
          <div>
            <div style={{ fontWeight: 700, color: '#dc2626', marginBottom: 8, fontSize: 14 }}>✕ DON’T</div>
            <Bullets color="#dc2626" items={[
              'Don’t make several invoices for the same job — create it once and edit the amount.',
              'Don’t push a guess. A pushed invoice is a real bill in QuickBooks.',
              'Don’t hand-edit the old Revenue numbers on a job that already has a real invoice — the invoice is the source of truth.',
              'Don’t “Remove from QuickBooks” unless you mean to pull it back to correct and re-push.',
            ]} />
          </div>
        </div>
      </Card>

      {/* 7. FAQ */}
      <Card>
        <SectionTitle n="7">FAQ &amp; Troubleshooting</SectionTitle>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {FAQ.map(([q, a], i) => (
            <div key={i} style={{ border: '1px solid var(--border-light)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
              <button
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
                style={{
                  width: '100%', textAlign: 'left', padding: '10px 14px', cursor: 'pointer',
                  background: openFaq === i ? 'var(--bg-secondary)' : 'var(--bg-primary)',
                  border: 'none', font: 'inherit', fontSize: 14, fontWeight: 600,
                  color: 'var(--text-primary)', display: 'flex', justifyContent: 'space-between',
                  alignItems: 'center', gap: 10,
                }}>
                <span>{q}</span>
                <span style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}>{openFaq === i ? '−' : '+'}</span>
              </button>
              {openFaq === i && (
                <div style={{ padding: '0 14px 12px', fontSize: 13.5, lineHeight: 1.5, color: 'var(--text-secondary)' }}
                     dangerouslySetInnerHTML={{ __html: a }} />
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* 8. Cheat sheet */}
      <Card style={{ marginBottom: 0 }}>
        <SectionTitle n="8">Quick Cheat-Sheet</SectionTitle>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Callout tone="blue"><b>To bill a job:</b> Claim → Billing → <i>Create invoice</i> → enter amount → <i>Save amount</i> → <i>Push to QuickBooks</i> → confirm green badge.</Callout>
          <Callout tone="green"><b>To collect:</b> Collections → open claim → <i>+ Log Payment</i> (and mark the deductible Rcvd) → update A/R status → add a Notes entry.</Callout>
        </div>
      </Card>

    </div>
  );
}
