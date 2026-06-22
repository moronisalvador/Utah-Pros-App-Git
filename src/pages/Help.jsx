import { useState } from 'react';

// ═══════════════════════════════════════════════════════════════════════
// HELP & GUIDES — employee tutorials. Currently: Invoicing & Financials.
// Reachable from the sidebar by every logged-in user (not role-gated).
// The downloadable PDF is served from /public.
//
// Reflects the line-item invoice builder (/invoices/:id), the "+ New invoice"
// job picker, payment recording that syncs to QuickBooks, the Stripe card
// pay-link, and the Collections surfaces.
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
  ['Invoiced', 'Total of the invoice’s line items, once it’s <b>sent to QuickBooks</b>. What we’ve officially billed.'],
  ['Collected', 'Payments you’ve <b>recorded</b> as received (they also post to QuickBooks).'],
  ['Balance', 'Invoiced − Collected. What’s still owed.'],
  ['Aging', 'How overdue the balance is, vs. the invoice due date — Current, 1–30, 31–60, 61–90, 90+ days.'],
  ['Deductible Owed', 'The customer’s deductible that hasn’t been collected yet.'],
  ['Insurance A/R', 'What insurance still owes after the deductible.'],
];

const FAQ = [
  ['How do I take a card payment from a customer?',
   'Open the invoice (the <b>/invoices</b> editor) and click <b>💳 Create pay link</b> — that makes a secure Stripe link for the balance. Send it to the customer; when they pay, the payment is recorded and synced to QuickBooks automatically. <i>(Available once Stripe is connected in Payment Settings.)</i>'],
  ['I recorded a payment — did it reach QuickBooks?',
   'Yes, automatically — as long as the invoice was already <b>sent to QuickBooks</b>. A green <b>✓ QB</b> shows next to the payment. A <b>! QB</b> means the invoice isn’t in QuickBooks yet — send it first, then the payment will apply.'],
  ['The Collections balance still shows an old number.',
   'That job probably predates this system. <b>Older jobs keep their existing numbers</b> and don’t need re-invoicing. Only jobs with a freshly <b>sent</b> invoice switch to the new figures.'],
  ['I sent the invoice but Invoiced didn’t change.',
   'Invoiced reflects the <b>line-item total</b> of an invoice that’s in QuickBooks. If it looks off, check the lines add up and the status chip shows a green <b>QuickBooks #</b> (not Draft).'],
  ['I got a red “Error” badge.',
   'Hover it to see why — usually the customer needs to be linked to a QuickBooks customer first. Fix that, then <b>Send / Update to QuickBooks</b> again.'],
  ['Can I undo a send?',
   'Yes — on the invoice editor, <b>Remove from QuickBooks</b> pulls it out entirely. Just fixing line items? You don’t need to remove it — edit the lines and click <b>Update in QuickBooks</b>.'],
  ['Why don’t I see the Item / Class dropdowns?',
   'They load <b>live from QuickBooks</b>, so QuickBooks must be connected (Dev Tools → Integrations). Until then the line builder can’t pick Items/Classes.'],
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
            How we build invoices, send them to QuickBooks, take payments, and track collections in UPR.
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
          JOB&nbsp; → &nbsp;BUILD INVOICE&nbsp; → &nbsp;SEND TO QUICKBOOKS&nbsp; → &nbsp;GET PAID&nbsp; → &nbsp;COLLECTIONS<br />
          <span style={{ color: 'var(--text-tertiary)' }}>(the work)&nbsp;&nbsp;(line items in UPR)&nbsp;&nbsp;(real QBO invoice)&nbsp;&nbsp;(payments sync to QBO)&nbsp;&nbsp;(track A/R)</span>
        </div>
        <Bullets items={[
          '<b>One invoice per job — and a job is one division.</b> A claim with Mitigation and Reconstruction is two jobs = two invoices. Insurance pays each category on a separate check, so each check matches its own invoice.',
          '<b>Invoices are built line by line.</b> On the invoice editor each line carries a QuickBooks <b>Item</b> + <b>Class</b>, a description, and quantity × rate. The invoice total adds itself up from the lines — there’s no single lump-sum box.',
          '<b>“Invoiced” means it’s in QuickBooks.</b> A new invoice starts as a <b>draft</b> in UPR. You add the lines, then click <b>Send to QuickBooks</b> — now it’s real, the balance clock starts, and it appears in Collections.',
          '<b>Everything flows one way: UPR → QuickBooks.</b> QuickBooks is the official record; UPR is where you build the invoice, send it, take payment, and chase the balance. Nobody edits invoices or payments directly in QuickBooks.',
          '<b>Payments you record in UPR post to QuickBooks automatically</b>, applied against the invoice.',
          '<b>The financial numbers come straight from your invoices</b> — once a job has a sent invoice, its Invoiced / Balance update on their own.',
        ]} />
      </Card>

      {/* 2. Who can do what */}
      <Card>
        <SectionTitle n="2">Who Can Do What</SectionTitle>
        <Bullets items={[
          '<b>Build invoices, send to QuickBooks, record payments, manage Payment Settings:</b> Admins and Managers.',
          '<b>Everyone else:</b> can see the info (read-only). The edit buttons simply won’t show.',
          'Billing is also behind the <b>Billing</b> feature switch — if it’s off, the billing areas are hidden for everyone.',
        ]} />
      </Card>

      {/* 3. Start an invoice */}
      <Card>
        <SectionTitle n="3">Start an Invoice</SectionTitle>
        <p style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--text-secondary)' }}>
          Two ways to begin — both open the same invoice editor. <b>One invoice per job</b>: if the job already has one, you’ll land right back on it (never a duplicate).
        </p>
        <Bullets items={[
          '<b>“+ New invoice” button</b> — on a <b>Customer’s page</b> (top of the page) or on the <b>Collections</b> screen. Pick the job to bill and it opens the editor.',
          '<b>From the claim or customer</b> — open the claim’s <b>Invoices &amp; Payments</b> panel (or a customer’s <b>Financial</b> tab) and click <b>Create invoice</b> on the job’s row.',
        ]} />
      </Card>

      {/* 4. Build & send */}
      <Card>
        <SectionTitle n="4">Build &amp; Send to QuickBooks</SectionTitle>
        <p style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--text-secondary)' }}>
          <b>Where:</b> the invoice editor (the page that opens after you start an invoice).
        </p>
        <Steps items={[
          'Click <b>+ Add line</b>. Choose the QuickBooks <b>Item</b> and <b>Class</b>, type a <b>description</b>, then the <b>quantity</b> and <b>rate</b>. The line amount and the invoice <b>Total</b> fill in automatically.',
          'Add as many lines as the job needs. <b>Line edits save by themselves</b> — no save button.',
          'When the total is right, click <b>Send to QuickBooks</b>. The status goes <b>Draft → Sent</b> and you get a green <b>QuickBooks #</b> — it’s now officially invoiced and shows in Collections.',
          'Need to change it after sending? Edit the lines and click <b>Update in QuickBooks</b> to re-push.',
          'The <b>Item</b> and <b>Class</b> lists come live from QuickBooks, so QuickBooks must be connected.',
        ]} />
        <div style={{ marginTop: 12 }}>
          <Callout tone="amber">
            <b>Fixing mistakes:</b> A red <b>Error</b> badge? Hover to read why (usually the customer isn’t linked in QuickBooks yet) — fix it and click <b>Send / Update</b> again. Sent the wrong thing? Edit the lines and <b>Update</b>, or use <b>Remove from QuickBooks</b> to pull it out entirely. An unsent draft can be removed with <b>Delete draft</b>.
          </Callout>
        </div>
      </Card>

      {/* 5. Get paid */}
      <Card>
        <SectionTitle n="5">Get Paid</SectionTitle>
        <p style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--text-secondary)' }}>
          <b>Where:</b> the claim’s <b>Invoices &amp; Payments</b> panel, a customer’s <b>Financial</b> tab, or <b>Collections</b> → open the claim.
        </p>
        <Steps items={[
          '<b>A payment comes in?</b> Click <b>+ Record payment</b>, enter the amount and date, choose who paid (insurance / homeowner / other) and the method, add a reference (check #, etc.), and save.',
          'The payment <b>posts to QuickBooks automatically</b>, applied to that invoice — a green <b>✓ QB</b> appears next to it. (If you see <b>! QB</b>, the invoice isn’t in QuickBooks yet — send it first.)',
          '<b>Collected</b> and <b>Balance</b> update right away; <b>Invoiced</b> doesn’t change (it only reflects the invoice itself).',
        ]} />
        <div style={{ marginTop: 12 }}>
          <Callout tone="blue">
            <b>💳 Card payments (Stripe pay-link):</b> On the invoice editor click <b>Create pay link</b> to generate a secure Stripe link for the balance, then send it to the customer. When they pay by card, the payment is recorded and synced to QuickBooks automatically — including the processing fee, which is booked for you. <i>Available once Stripe is connected (Collections → ⚙ Payment Settings).</i>
          </Callout>
        </div>
      </Card>

      {/* 6. Collections & the numbers */}
      <Card>
        <SectionTitle n="6">Collections &amp; the Numbers</SectionTitle>
        <p style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--text-secondary)' }}>
          <b>Collections</b> in the menu has two tabs: <b>A/R · Outstanding</b> (totals, aging buckets, and an overdue worklist) and <b>Payments</b> (cash-in history). Click any row to open that claim’s A/R workspace. The same per-invoice detail also lives on each claim’s <b>Invoices &amp; Payments</b> panel and each customer’s <b>Financial</b> tab.
        </p>
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
          Rule of thumb: <b>Invoiced − Collected = Balance.</b> If the Balance looks wrong, it’s almost always an invoice that wasn’t sent, or a payment that wasn’t recorded.
        </p>
      </Card>

      {/* 7. Good practices */}
      <Card>
        <SectionTitle n="7">Good Practices</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
          <div>
            <div style={{ fontWeight: 700, color: '#16a34a', marginBottom: 8, fontSize: 14 }}>✓ DO</div>
            <Bullets color="#16a34a" items={[
              'One invoice per division (Mitigation and Reconstruction each get their own).',
              'Build the lines with the right <b>Item + Class</b> so the numbers land in the correct QuickBooks buckets.',
              'Only <b>Send to QuickBooks</b> when the total is <b>final</b> — sending creates the real bill and starts the A/R clock. Not ready? Leave it a draft.',
              'Record payments the day they arrive, with the correct payer and method.',
              'Use the card <b>pay link</b> for deductibles / out-of-pocket — it reconciles itself.',
              'Mark the deductible received as soon as it’s collected.',
            ]} />
          </div>
          <div>
            <div style={{ fontWeight: 700, color: '#dc2626', marginBottom: 8, fontSize: 14 }}>✕ DON’T</div>
            <Bullets color="#dc2626" items={[
              'Don’t try to make a second invoice for the same job — open the existing one and edit its lines.',
              'Don’t send a guess. A sent invoice is a real bill in QuickBooks.',
              'Don’t enter invoices or payments directly in QuickBooks — always do it in UPR so the two stay in sync.',
              'Don’t “Remove from QuickBooks” unless you mean to pull it back to correct and re-send.',
            ]} />
          </div>
        </div>
      </Card>

      {/* 8. FAQ */}
      <Card>
        <SectionTitle n="8">FAQ &amp; Troubleshooting</SectionTitle>
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

      {/* Cheat sheet */}
      <Card style={{ marginBottom: 0 }}>
        <SectionTitle n="★">Quick Cheat-Sheet</SectionTitle>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Callout tone="blue"><b>To bill a job:</b> <i>+ New invoice</i> (or Claim → Invoices &amp; Payments → <i>Create invoice</i>) → add line items (Item + Class, qty × rate) → <i>Send to QuickBooks</i> (green QuickBooks # = done).</Callout>
          <Callout tone="green"><b>To collect:</b> Collections → open claim → <i>+ Record payment</i> (it posts to QuickBooks) — or open the invoice and <i>Create pay link</i> for a card payment.</Callout>
        </div>
      </Card>

    </div>
  );
}
