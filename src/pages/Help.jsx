import { useState } from 'react';

// ═══════════════════════════════════════════════════════════════════════
// HELP & GUIDES — employee tutorials. Currently: Invoicing & Financials.
// Reachable from the sidebar by every logged-in user (not role-gated).
// The downloadable PDF is served from /public.
//
// Reflects the rebuilt line-item invoice/estimate builder (/invoices/:id,
// /estimates/:id) with its top action toolbar (Save · Send to customer ·
// Receive payment · Create pay link · Preview · Manage ▾), the click-to-edit
// payment-history table, the Stripe card pay-link, and the four-tab
// Collections ("My Money") surface. One-way UPR → QuickBooks throughout.
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
  ['Invoiced', 'Total of the invoice’s line items, once you’ve <b>Saved</b> it (which records it in QuickBooks). What we’ve officially billed.'],
  ['Collected', 'Payments you’ve <b>recorded</b> as received (they also post to QuickBooks).'],
  ['Balance', 'Invoiced − Collected. What’s still owed.'],
  ['Aging', 'How overdue the balance is, vs. the invoice due date — Current, 1–30, 31–60, 61–90, 90+ days.'],
  ['Deductible Owed', 'The customer’s deductible that hasn’t been collected yet.'],
  ['Insurance A/R', 'What insurance still owes after the deductible.'],
];

const FAQ = [
  ['What does the “Save” button actually do?',
   'It records the invoice in QuickBooks. The <b>first</b> Save creates the real QuickBooks invoice (the status leaves <b>Draft</b> and the balance clock starts); <b>later</b> Saves update it. You never have to touch QuickBooks yourself — Save handles it in the background. While you’re still building, your line edits save on their own as a <i>draft</i>; nothing reaches QuickBooks until you click <b>Save</b>.'],
  ['How do I email the invoice to the customer?',
   'Click <b>✉ Send to customer</b> in the top toolbar (it appears once the invoice is saved). It emails the customer the QuickBooks-generated PDF. Use <b>⎙ Preview</b> first to see / print exactly what they’ll get.'],
  ['How do I take a card payment from a customer?',
   'Open the invoice and click <b>💳 Create pay link</b> — that makes a secure Stripe link for the balance. Send it to the customer; when they pay, the payment is recorded and synced to QuickBooks automatically. <i>(Available once Stripe is connected in Payment Settings.)</i>'],
  ['I recorded a payment — did it reach QuickBooks?',
   'Yes, automatically — as long as the invoice was already <b>Saved</b> to QuickBooks. A green <b>✓ QB</b> shows next to the payment in the history table. If the invoice isn’t in QuickBooks yet, save it first, then the payment will apply.'],
  ['How do I edit or delete a payment I recorded?',
   'In the <b>Payments</b> card, <b>click the payment’s row</b> — the form reopens with its details. Change it and click <b>Update payment</b>, or click <b>Delete</b> inside that form. Edits re-sync to QuickBooks for you (it removes the old one and re-posts the new amount).'],
  ['Can I undo a Save / pull an invoice back out of QuickBooks?',
   'Yes — use <b>Manage ▾ → Revert to draft</b> on the invoice. It pulls the invoice out of QuickBooks and back to an editable draft. Just fixing line items? You don’t need to revert — edit the lines and click <b>Save</b> again to update.'],
  ['I Saved the invoice but “Invoiced” didn’t change.',
   'Invoiced reflects the <b>line-item total</b> of an invoice that’s in QuickBooks. If it looks off, check the lines add up and the status chip isn’t still <b>Draft</b>.'],
  ['I got a red error / the Save failed.',
   'Read the red banner — it’s usually that the customer needs to be linked to a QuickBooks customer first. Fix that, then click <b>Save</b> again.'],
  ['Why are the Item / Class pickers greyed out?',
   'They load <b>live from QuickBooks</b>, so QuickBooks must be connected (Dev Tools → Integrations) and its credentials present in this environment. Until then the line builder can’t pick Items/Classes.'],
  ['What about estimates?',
   'Estimates use the <b>same builder</b> (the <b>Estimates</b> tab in Collections, or <b>+ New estimate</b>). Build lines, <b>Save</b>, <b>Send to customer</b> — and once it’s accepted, <b>→ Convert to invoice</b> turns it into the job’s invoice in one click (and links it in QuickBooks).'],
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
            How we build invoices in UPR, save them to QuickBooks, take payments, and track collections.
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
          JOB&nbsp; → &nbsp;BUILD LINES&nbsp; → &nbsp;SAVE&nbsp; → &nbsp;SEND TO CUSTOMER&nbsp; → &nbsp;GET PAID&nbsp; → &nbsp;COLLECTIONS<br />
          <span style={{ color: 'var(--text-tertiary)' }}>(the work)&nbsp;&nbsp;(line items in UPR)&nbsp;&nbsp;(records it in QBO)&nbsp;&nbsp;(emails the PDF)&nbsp;&nbsp;(payments sync to QBO)&nbsp;&nbsp;(track A/R)</span>
        </div>
        <Bullets items={[
          '<b>One invoice per job — and a job is one division.</b> A claim with Mitigation and Reconstruction is two jobs = two invoices. Insurance pays each category on a separate check, so each check matches its own invoice.',
          '<b>Invoices are built line by line.</b> In the builder each line carries a QuickBooks <b>Item</b> + <b>Class</b>, a description, and quantity × rate. The <b>Subtotal</b> and <b>Total</b> add themselves up from the lines — there’s no single lump-sum box. A brand-new invoice opens with one blank line ready to fill.',
          '<b>“Save” is what records it in QuickBooks.</b> A new invoice starts as a <b>draft</b> in UPR. You build the lines (they save themselves as you type), then click <b>Save</b> — the first Save creates the real QuickBooks invoice, the balance clock starts, and it appears in Collections. Save again any time to update it.',
          '<b>Everything flows one way: UPR → QuickBooks.</b> QuickBooks is the official record; UPR is where you build the invoice, save it, take payment, and chase the balance. Nobody edits invoices or payments directly in QuickBooks.',
          '<b>Payments you record in UPR post to QuickBooks automatically</b>, applied against the invoice.',
          '<b>The financial numbers come straight from your invoices</b> — once a job has a saved invoice, its Invoiced / Balance update on their own.',
        ]} />
      </Card>

      {/* 2. How UPR & QuickBooks stay in sync */}
      <Card>
        <SectionTitle n="2">How UPR &amp; QuickBooks Stay in Sync</SectionTitle>
        <p style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--text-secondary)' }}>
          You work entirely in UPR. Behind each button, UPR talks to QuickBooks for you — always one direction, <b>UPR → QuickBooks</b>.
        </p>
        <Bullets items={[
          '<b>Save</b> → creates the QuickBooks invoice the first time, and <b>updates</b> it on every Save after. (The buttons say Save, not “send to QuickBooks” — but that’s what Save does.)',
          '<b>Send to customer</b> → asks QuickBooks to email the customer the invoice PDF. The PDF itself is generated by QuickBooks; UPR’s on-screen <b>Preview</b> is a faithful copy you can print.',
          '<b>Record / edit a payment</b> → posts to QuickBooks against the invoice (✓ QB). Editing a payment re-syncs by removing the old one and re-posting the new amount.',
          '<b>Item &amp; Class pickers</b> load <b>live from QuickBooks</b>, so the right buckets are used — QuickBooks must be connected for them to appear.',
          'The <b>customer must be linked</b> to a QuickBooks customer before an invoice or payment can post. If a Save fails, this is the usual reason.',
          '<b>Revert to draft</b> (Manage ▾) pulls an invoice back out of QuickBooks; <b>Delete draft</b> removes one that was never saved.',
          '<b>Golden rule:</b> never add or edit invoices/payments directly in QuickBooks — always do it in UPR so the two never drift apart.',
        ]} />
      </Card>

      {/* 3. Who can do what */}
      <Card>
        <SectionTitle n="3">Who Can Do What</SectionTitle>
        <Bullets items={[
          '<b>Build invoices &amp; estimates, save to QuickBooks, record payments, manage Payment Settings:</b> Admins and Managers.',
          '<b>Everyone else:</b> can see the info (read-only). The edit buttons simply won’t show.',
          'Billing is also behind the <b>Billing</b> feature switch — if it’s off, the billing areas are hidden for everyone.',
        ]} />
      </Card>

      {/* 4. Start an invoice */}
      <Card>
        <SectionTitle n="4">Start an Invoice</SectionTitle>
        <p style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--text-secondary)' }}>
          All paths open the same builder. <b>One invoice per job</b>: if the job already has one, you’ll land right back on it (never a duplicate).
        </p>
        <Bullets items={[
          '<b>“+ New invoice” button</b> — on the <b>Collections</b> (“My Money”) screen or a <b>Customer’s page</b>. Pick the job to bill and it opens the builder.',
          '<b>From the claim or customer</b> — open the claim’s <b>Invoices &amp; Payments</b> panel (or a customer’s <b>Financial</b> tab) and click <b>Create invoice</b> on the job’s row.',
          'The builder opens with the header (customer, claim/job, service address, due date), an empty line ready to fill, and the action toolbar across the top.',
        ]} />
      </Card>

      {/* 5. Build & save */}
      <Card>
        <SectionTitle n="5">Build &amp; Save to QuickBooks</SectionTitle>
        <p style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--text-secondary)' }}>
          <b>Where:</b> the invoice builder (the page that opens after you start an invoice). The action buttons live in the <b>top toolbar</b>, next to “← Back”.
        </p>
        <Steps items={[
          'On the first (blank) line, choose the QuickBooks <b>Item</b> and <b>Class</b>, type a <b>description</b>, then the <b>quantity</b> and <b>rate</b>. The line amount, <b>Subtotal</b> and <b>Total</b> fill in automatically.',
          'Click <b>+ Add line</b> for more lines. Drag the <b>⠿</b> handle to reorder them. <b>Line edits save by themselves</b> as you type (as a draft) — there’s no per-line save.',
          'When the total is right, click <b>Save</b> in the top toolbar. The first Save <b>records the invoice in QuickBooks</b>; the status leaves <b>Draft</b> and it shows in Collections. Click <b>Save</b> again any time to update it.',
          'Click <b>⎙ Preview</b> to see / print exactly what the customer will get, then <b>✉ Send to customer</b> to email it.',
          'The <b>Item</b> and <b>Class</b> lists come live from QuickBooks, so QuickBooks must be connected.',
        ]} />
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Callout tone="amber">
            <b>Fixing mistakes:</b> A red banner on Save usually means the customer isn’t linked in QuickBooks yet — fix it and click <b>Save</b> again. Need to pull an invoice back out of QuickBooks to rework it? Use <b>Manage ▾ → Revert to draft</b>. An invoice that was never saved can be removed with <b>Manage ▾ → Delete draft</b>.
          </Callout>
          <Callout tone="blue">
            <b>Estimates work the same way.</b> Build them in the <b>Estimates</b> tab (or <b>+ New estimate</b>) with the same line builder, <b>Save</b>, and <b>Send to customer</b>. Once it’s accepted, <b>→ Convert to invoice</b> turns it into the job’s invoice and links it in QuickBooks.
          </Callout>
        </div>
      </Card>

      {/* 6. Send & get paid */}
      <Card>
        <SectionTitle n="6">Get Paid</SectionTitle>
        <p style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--text-secondary)' }}>
          <b>Where:</b> the invoice builder’s <b>Payments</b> card (below the lines), or the claim’s <b>Invoices &amp; Payments</b> panel.
        </p>
        <Steps items={[
          '<b>A payment comes in?</b> Click <b>💵 Receive payment</b> in the top toolbar. Enter the amount and date, choose who paid (insurance / homeowner / other) and the method, add a reference (check #, etc.), and save.',
          'The payment <b>posts to QuickBooks automatically</b>, applied to that invoice — a green <b>✓ QB</b> appears next to it in the Payments history. (If the invoice isn’t in QuickBooks yet, save it first.)',
          '<b>Need to fix a payment?</b> Click its row in the Payments history — the form reopens. Change it and <b>Update payment</b>, or <b>Delete</b> it from inside the form. Edits re-sync to QuickBooks.',
          '<b>Collected</b> and <b>Balance</b> update right away; <b>Invoiced</b> doesn’t change (it only reflects the invoice itself).',
        ]} />
        <div style={{ marginTop: 12 }}>
          <Callout tone="blue">
            <b>💳 Card payments (Stripe pay-link):</b> In the toolbar click <b>Create pay link</b> to generate a secure Stripe link for the balance, then send it to the customer. When they pay by card, the payment is recorded and synced to QuickBooks automatically — including the processing fee, which is booked for you. <i>Available once Stripe is connected (Collections → ⚙ Payment Settings).</i>
          </Callout>
        </div>
      </Card>

      {/* 7. Collections & the numbers */}
      <Card>
        <SectionTitle n="7">Collections &amp; the Numbers</SectionTitle>
        <p style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--text-secondary)' }}>
          <b>Collections</b> (“My Money” in the menu) has four tabs: <b>A/R · Outstanding</b> (totals, aging buckets, and an overdue worklist), <b>Invoices</b> (every invoice — click one to open the builder), <b>Estimates</b> (pre-sale quotes), and <b>Payments</b> (cash-in history). The same per-claim detail also lives on each claim’s <b>Invoices &amp; Payments</b> panel and each customer’s <b>Financial</b> tab.
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
          Rule of thumb: <b>Invoiced − Collected = Balance.</b> If the Balance looks wrong, it’s almost always an invoice that wasn’t Saved, or a payment that wasn’t recorded.
        </p>
      </Card>

      {/* 8. Good practices */}
      <Card>
        <SectionTitle n="8">Good Practices</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
          <div>
            <div style={{ fontWeight: 700, color: '#16a34a', marginBottom: 8, fontSize: 14 }}>✓ DO</div>
            <Bullets color="#16a34a" items={[
              'One invoice per division (Mitigation and Reconstruction each get their own).',
              'Build the lines with the right <b>Item + Class</b> so the numbers land in the correct QuickBooks buckets.',
              'Build freely first — line edits save as a draft on their own. Only click <b>Save</b> once the total is <b>final</b>: the first Save creates the real bill in QuickBooks and starts the A/R clock.',
              'Record payments the day they arrive, with the correct payer and method.',
              'Use the card <b>pay link</b> for deductibles / out-of-pocket — it reconciles itself.',
              'Mark the deductible received as soon as it’s collected.',
            ]} />
          </div>
          <div>
            <div style={{ fontWeight: 700, color: '#dc2626', marginBottom: 8, fontSize: 14 }}>✕ DON’T</div>
            <Bullets color="#dc2626" items={[
              'Don’t try to make a second invoice for the same job — open the existing one and edit its lines.',
              'Don’t Save a guess. The first Save is a real bill in QuickBooks.',
              'Don’t enter invoices or payments directly in QuickBooks — always do it in UPR so the two stay in sync.',
              'Don’t use <b>Revert to draft</b> unless you mean to pull the invoice back out of QuickBooks to correct and re-Save.',
            ]} />
          </div>
        </div>
      </Card>

      {/* 9. FAQ */}
      <Card>
        <SectionTitle n="9">FAQ &amp; Troubleshooting</SectionTitle>
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
          <Callout tone="blue"><b>To bill a job:</b> <i>+ New invoice</i> (or Claim → Invoices &amp; Payments → <i>Create invoice</i>) → fill the line items (Item + Class, qty × rate) → <i>Save</i> (records it in QuickBooks) → <i>Send to customer</i> to email it.</Callout>
          <Callout tone="green"><b>To collect:</b> open the invoice → <i>Receive payment</i> (it posts to QuickBooks), or <i>Create pay link</i> for a card payment. Click a payment row to edit it.</Callout>
          <Callout tone="amber"><b>To fix a sent invoice:</b> edit the lines and <i>Save</i> again to update — or <i>Manage ▾ → Revert to draft</i> to pull it out of QuickBooks entirely.</Callout>
        </div>
      </Card>

    </div>
  );
}
