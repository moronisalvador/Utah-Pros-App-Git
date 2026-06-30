/**
 * ════════════════════════════════════════════════
 * FILE: Help.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The in-app "Help & Guides" centre, reached from the ? button in the top bar
 *   (and the sidebar). It opens on a menu of guides; pick one to read it. Two
 *   guides live here today: "How UPR Works" (the big picture — how customers,
 *   claims, jobs and invoices fit together, how a job flows from first call to
 *   paid, and a tour of every main screen) and "Invoicing & Financials" (how we
 *   bill, save to QuickBooks, take payments and track collections). Every
 *   logged-in user can see it.
 *
 * WHERE IT LIVES:
 *   Route:        /help
 *   Rendered by:  src/App.jsx (inside SettingsLayout's <Outlet/>)
 *
 * DEPENDS ON:
 *   Packages:  react (useState, useEffect)
 *   Internal:  none
 *   Data:      reads → none · writes → none (static content only)
 *
 * NOTES / GOTCHAS:
 *   - Which guide is open is kept in the URL hash (#how-it-works / #invoicing) so
 *     it survives refresh and can be deep-linked. The ? button navigates to /help
 *     with no hash, so it always lands on the menu. A hashchange listener keeps
 *     the view in sync with the browser back/forward buttons.
 *   - Both guides reuse the same little UI primitives (Card / SectionTitle /
 *     Steps / Bullets / Callout) so they stay visually consistent.
 *   - Printable/shareable handouts are served from /public: the invoicing PDF and
 *     the hierarchy diagram HTML. Keep those files in sync if the content changes.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect } from 'react';

const ACCENT = 'var(--accent)';
const PDF_URL = '/UPR-Invoicing-Financials-Guide.pdf';
const DIAGRAM_URL = '/UPR-Hierarchy-Diagram.html';

// ─── SECTION: Shared UI primitives ──────────────
function Card({ children, style, id }) {
  return (
    <div id={id} style={{
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

// ─── SECTION: Guide registry (the menu) ──────────────
const GUIDES = [
  {
    id: 'how-it-works',
    title: 'How UPR Works',
    tag: 'Start here',
    icon: '🧭',
    accent: '#2563eb',
    blurb: 'The big picture — how customers, claims, jobs and invoices fit together, how a job flows from first call to paid, and a tour of every main screen.',
  },
  {
    id: 'invoicing',
    title: 'Invoicing & Financials',
    tag: 'Billing',
    icon: '🧾',
    accent: '#16a34a',
    blurb: 'Build invoices line by line, save them to QuickBooks, take payments (including card pay-links), and track what you’re owed in Collections.',
  },
];

// ─── SECTION: Hub menu ──────────────
function HelpHub({ onOpen }) {
  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 20px 60px' }}>
      <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: 'var(--text-primary)' }}>Help &amp; Guides</h1>
      <p style={{ margin: '4px 0 22px', fontSize: 15, color: 'var(--text-secondary)' }}>
        Short, plain-language guides to how UPR works and how to get things done. Pick one to start.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        {GUIDES.map(g => (
          <button
            key={g.id}
            onClick={() => onOpen(g.id)}
            style={{
              textAlign: 'left', cursor: 'pointer', font: 'inherit',
              background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-lg)', padding: '20px 20px 18px',
              boxShadow: 'var(--shadow-sm)', display: 'flex', flexDirection: 'column', gap: 12,
              borderTop: `3px solid ${g.accent}`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{
                width: 42, height: 42, borderRadius: 'var(--radius-md)', flex: 'none',
                background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
              }}>{g.icon}</span>
              <span style={{
                fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase',
                color: g.accent, background: 'var(--bg-secondary)', border: '1px solid var(--border-light)',
                padding: '3px 9px', borderRadius: 'var(--radius-full)',
              }}>{g.tag}</span>
            </div>
            <div>
              <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>{g.title}</div>
              <p style={{ margin: '5px 0 0', fontSize: 13.5, lineHeight: 1.5, color: 'var(--text-secondary)' }}>{g.blurb}</p>
            </div>
            <span style={{ marginTop: 'auto', fontSize: 13.5, fontWeight: 600, color: g.accent }}>Open guide →</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── SECTION: "How UPR Works" guide ──────────────
const DIVISIONS = [
  ['Water',          'WTR', '#2563eb', '#eff6ff', '#bfdbfe', 'mitigation & drying'],
  ['Reconstruction', 'REC', '#7c3aed', '#faf5ff', '#ddd6fe', 'repair & rebuild'],
  ['Mold',           'MOL', '#16a34a', '#f0fdf4', '#bbf7d0', 'remediation'],
  ['Fire',           'FIR', '#dc2626', '#fef2f2', '#fecaca', 'cleanup & restore'],
  ['Remodeling',     'RM',  '#d97706', '#fffbeb', '#fde68a', 'upgrades'],
  ['Contents',       'CNT', '#0d9488', '#f0fdfa', '#99f6e4', 'pack-out & restore'],
  ['General',        'GEN', '#64748b', '#f1f5f9', '#cbd5e1', 'everything else'],
];

const AREAS = [
  ['🏠', 'Home', 'A daily snapshot — what needs attention, recent activity, and key numbers at a glance.'],
  ['💬', 'Inbox', 'Two-way texting with customers (templated replies and scheduled messages). Labelled “Conversations” on phones.'],
  ['🛡️', 'Claims', 'Every insurance loss. Open one to see its jobs, contacts, documents, photos and money in one place.'],
  ['🔧', 'Jobs', 'Every job (one division of work). Open one for its phase, schedule, photos, costs and invoice.'],
  ['📊', 'Production', 'The work-in-progress board — jobs grouped by phase so nothing stalls.'],
  ['👥', 'Customers', 'People (homeowners & adjusters). A customer page rolls up all their claims, jobs and balances.'],
  ['📅', 'Schedule', 'The calendar. Book appointments and assign the crew; reusable templates speed up common visits.'],
  ['💰', 'My Money', 'Accounts-receivable: invoices, estimates, payments and aging. (Full how-to in the Invoicing guide.)'],
  ['📝', 'Estimates', 'Pre-sale quotes, built with the same line-item builder. A won estimate converts into the job’s invoice.'],
  ['⏱️', 'Time', 'Field labor hours (travel + on-site) that feed job costs and billing.'],
];

const TASKS = [
  ['Start a new claim / job', 'Claims → New — or pull it in from <b>Encircle Import</b>.'],
  ['See everything for one customer', 'Customers → open their page (claims, jobs and financials together).'],
  ['Schedule a crew', 'Schedule → pick a day → add the appointment and assign techs.'],
  ['Check a job’s progress', 'Jobs or Production → open the job — its <b>phase</b> shows where it is.'],
  ['Bill a job', 'My Money → <b>+ New invoice</b> (step-by-step in the Invoicing &amp; Financials guide).'],
  ['Take a payment', 'Open the invoice → <b>Receive payment</b>, or <b>Create pay link</b> for a card.'],
  ['Text a customer', 'Inbox → open the conversation, or message straight from the claim / customer.'],
];

const TERMS = [
  ['Customer (Contact)', 'A person we deal with — usually the homeowner, sometimes the adjuster or a vendor.'],
  ['Claim', 'One insurance loss event (one date of loss, one carrier claim #). The umbrella over all the work for that loss.'],
  ['Job', 'One division of work on a claim. Has its own number, crew, schedule and invoice.'],
  ['Division', 'The trade a job belongs to (water, reconstruction, …). A job is always exactly one division.'],
  ['Phase', 'Where a job is in its life: Lead → Job received → In progress → Completed.'],
  ['Appointment', 'A scheduled visit on the calendar with a crew assigned. Jobs are scheduled through appointments.'],
  ['Estimate', 'A pre-sale quote. When it’s accepted it converts into the job’s invoice.'],
  ['Invoice', 'The bill for one job — built line by line and saved to QuickBooks.'],
];

function Tier({ n, color, title, desc, idfmt }) {
  return (
    <div style={{
      width: '100%', maxWidth: 520, background: 'var(--bg-primary)',
      border: '1px solid var(--border-color)', borderLeft: `4px solid ${color}`,
      borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', padding: '13px 16px',
      display: 'grid', gridTemplateColumns: '38px 1fr auto', gap: 14, alignItems: 'center',
    }}>
      <div style={{
        width: 38, height: 38, borderRadius: 'var(--radius-full)', background: color, color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 16,
      }}>{n}</div>
      <div>
        <div style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.45 }}
             dangerouslySetInnerHTML={{ __html: desc }} />
      </div>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-tertiary)',
        background: 'var(--bg-tertiary)', padding: '4px 8px', borderRadius: 'var(--radius-md)', whiteSpace: 'nowrap',
      }}>{idfmt}</div>
    </div>
  );
}

function Fan({ children, tone }) {
  const c = tone === 'green'
    ? { col: '#16a34a', bg: '#f0fdf4', bd: '#bbf7d0' }
    : { col: ACCENT, bg: 'var(--accent-light)', bd: '#bfdbfe' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '4px 0' }}>
      <div style={{ width: 2, height: 12, background: 'var(--border-color)' }} />
      <div style={{
        fontSize: 11.5, fontWeight: 700, color: c.col, background: c.bg,
        border: `1px solid ${c.bd}`, padding: '3px 11px', borderRadius: 'var(--radius-full)',
      }}>
        <span style={{ marginRight: 5 }}>▾</span>{children}
      </div>
      <div style={{ width: 2, height: 12, background: 'var(--border-color)' }} />
    </div>
  );
}

function JobRow({ name, code, divIdx, invoice }) {
  const [, , col, bg, bd] = DIVISIONS[divIdx];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '5px 0' }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 9, background: bg, border: `1px solid ${bd}`,
        borderRadius: 'var(--radius-md)', padding: '6px 11px',
      }}>
        <span style={{ width: 9, height: 9, borderRadius: 2, background: col, flex: 'none' }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{name}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-tertiary)' }}>{code}</span>
      </span>
      <span style={{ color: 'var(--text-tertiary)', fontWeight: 700, fontSize: 13 }}>→</span>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, background: '#f0fdf4', border: '1px solid #bbf7d0',
        color: '#15803d', borderRadius: 'var(--radius-md)', padding: '6px 10px', fontSize: 12.5, fontWeight: 600,
      }}>
        🧾 {invoice}
      </span>
    </div>
  );
}

function HierarchyVisual() {
  return (
    <div>
      {/* The four-level chain */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <Tier n="1" color="#0f172a" title="Customer" idfmt="contacts"
              desc="The homeowner (or business) we’re doing the work for." />
        <Fan>one customer can have <b>many claims</b></Fan>
        <Tier n="2" color={ACCENT} title="Claim" idfmt="CLM-2606-001"
              desc="One insurance loss — one date, one claim number. The umbrella that holds all the work for that loss." />
        <Fan>one claim splits into <b>many jobs</b></Fan>
        <Tier n="3" color="#7c3aed" title="Job" idfmt="WTR-2606-001"
              desc="One trade/division of the work — and a job is exactly <b>one</b> division." />
        <Fan tone="green">each job gets <b>exactly one invoice</b></Fan>
        <Tier n="4" color="#16a34a" title="Invoice" idfmt="INV-001000"
              desc="The bill for that one job. Saved to QuickBooks and sent to the customer." />
      </div>

      {/* Worked example */}
      <div style={{
        marginTop: 20, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-md)', padding: '16px 18px',
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 12 }}>
          A real example
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <span style={{ fontSize: 18 }}>👤</span>
          <span style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--text-primary)' }}>Sarah Johnson</span>
          <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>· one customer</span>
        </div>

        <div style={{ marginLeft: 9, paddingLeft: 18, borderLeft: '2px solid var(--border-color)' }}>
          {/* Claim 1 */}
          <div style={{ paddingTop: 10 }}>
            <div style={{ fontSize: 13.5, color: 'var(--text-primary)' }}>
              🛡️ <b>Burst pipe in the basement</b>
              <span style={{ color: 'var(--text-secondary)' }}> — Jan 12 · State Farm · </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-tertiary)' }}>CLM-2606-018</span>
            </div>
            <div style={{ marginLeft: 6, paddingLeft: 16, borderLeft: '2px solid var(--border-light)', marginTop: 2 }}>
              <JobRow name="Water Mitigation" code="WTR-2606-031" divIdx={0} invoice="INV-001042" />
              <JobRow name="Reconstruction" code="REC-2606-009" divIdx={1} invoice="INV-001043" />
            </div>
          </div>
          {/* Claim 2 */}
          <div style={{ paddingTop: 12 }}>
            <div style={{ fontSize: 13.5, color: 'var(--text-primary)' }}>
              🛡️ <b>Kitchen fire</b>
              <span style={{ color: 'var(--text-secondary)' }}> (a separate loss, months later) — Mar 3 · Allstate · </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-tertiary)' }}>CLM-2604-002</span>
            </div>
            <div style={{ marginLeft: 6, paddingLeft: 16, borderLeft: '2px solid var(--border-light)', marginTop: 2 }}>
              <JobRow name="Fire Cleanup" code="FIR-2604-005" divIdx={3} invoice="INV-001051" />
              <JobRow name="Contents" code="CNT-2604-002" divIdx={5} invoice="INV-001052" />
            </div>
          </div>
        </div>

        <p style={{ margin: '14px 0 0', fontSize: 13, lineHeight: 1.55, color: 'var(--text-secondary)' }}>
          One customer, <b>two separate losses</b> → two claims. The basement claim needed two trades, so it became
          <b> two jobs</b> (water + reconstruction). Every job carries <b>one division</b> and produces <b>one invoice</b>.
          The claim is just the umbrella — its “total” is simply the sum of its jobs’ invoices.
        </p>
      </div>
    </div>
  );
}

function HowItWorksGuide() {
  return (
    <>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: 'var(--text-primary)' }}>How UPR Works</h1>
          <p style={{ margin: '4px 0 0', fontSize: 15, color: 'var(--text-secondary)' }}>
            The whole app in one read — how the pieces fit together, how a job flows from first call to paid, and where to find everything.
          </p>
        </div>
        <a href={DIAGRAM_URL} target="_blank" rel="noopener noreferrer" className="btn btn-secondary"
           style={{ textDecoration: 'none', whiteSpace: 'nowrap' }}>
          ⬇ Printable diagram
        </a>
      </div>

      {/* 1. The mental model */}
      <Card id="mental-model">
        <SectionTitle n="1">The Mental Model</SectionTitle>
        <p style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--text-secondary)' }}>
          Almost everything in UPR hangs off one simple chain. Read it top to bottom — each level can hold several of the level below it.
        </p>
        <HierarchyVisual />
      </Card>

      {/* 2. The rules in plain English */}
      <Card>
        <SectionTitle n="2">The Rules, in Plain English</SectionTitle>
        <Bullets items={[
          '<b>A customer can have many claims.</b> Each claim is a different loss event. Sarah’s pipe and her fire are two unrelated claims under the same person.',
          '<b>A claim is everything for one specific loss.</b> One date of loss, one carrier claim number — it groups together all the work that came out of that single event.',
          '<b>A claim can have many jobs.</b> The work is split by trade — mitigation, reconstruction, mold, contents — so each crew and each scope is tracked on its own.',
          '<b>A job is exactly one division.</b> A job is never “water and reconstruction” — those are two jobs. The division sets the crew, the job-number prefix, and the QuickBooks category.',
          '<b>A job has one invoice.</b> Each job is billed as its own unit, because insurance pays each category on its own check. (A supplement is the rare exception that adds a second.)',
        ]} />
      </Card>

      {/* 3. Lifecycle */}
      <Card>
        <SectionTitle n="3">How a Job Flows — First Call to Paid</SectionTitle>
        <p style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--text-secondary)' }}>
          The same path every job walks, and the phase it’s in along the way (<b>Lead → Job received → In&nbsp;progress → Completed</b>):
        </p>
        <Steps items={[
          'A loss comes in — a homeowner calls or the claim is imported from <b>Encircle</b>. We log the <b>customer</b> and open a <b>claim</b> for that loss.',
          'We open a <b>job</b> for each division the loss needs — say one for <b>Water</b> mitigation and another for <b>Reconstruction</b>. Each job starts at <b>Lead → Job received</b>.',
          'The job is <b>scheduled</b>: an appointment goes on the calendar with a <b>crew</b> assigned.',
          'In the field the crew works from their phones — <b>clock in</b>, snap <b>photos</b>, add <b>notes</b>, tick off <b>tasks</b>, take <b>readings</b>. The phase moves to <b>…in progress</b>.',
          'When the work is done the job is marked <b>Completed</b> and its labor &amp; costs are tallied.',
          'We <b>build the invoice</b> for the job (or convert its estimate), <b>Save</b> it to QuickBooks, and <b>send</b> it to the customer.',
          'Payments come in and get recorded; <b>My&nbsp;Money</b> (Collections) tracks the balance until it’s paid in full.',
        ]} />
        <div style={{ marginTop: 12 }}>
          <Callout tone="blue">
            <b>Why split a loss into jobs?</b> Different divisions have different crews, timelines and insurance line items — and each is billed separately. Keeping them as separate jobs is what lets every check match its own invoice.
          </Callout>
        </div>
      </Card>

      {/* 4. Creating a new job */}
      <Card id="creating-a-job">
        <SectionTitle n="4">Creating a New Job</SectionTitle>
        <p style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--text-secondary)' }}>
          Most claims start here. Open <b>+ New → New Claim</b> in the top bar (or <b>+ New job</b> from a customer’s page) to open the <b>New Job</b> window. One trip through it creates the <b>customer</b>, the <b>claim</b>, and the first <b>job</b> together.
        </p>
        <Steps items={[
          '<b>Client</b> — search by name, phone, or email <i>first</i>. If they come up (you’ll see how many jobs they already have), pick them. New to us? Click <b>+ New</b> to add them. <i>(If the phone is already on file, it quietly reuses that customer instead of making a duplicate.)</i>',
          '<b>Division</b> — pick the one trade this job is: 💧 Water, 🦠 Mold, 🏗️ Recon, 🔨 Remodel, 🔥 Fire, or 📦 Contents. A job is always <b>one</b> division.',
          '<b>Loss / Service Address</b> — this prefills from the customer’s billing address. <b>Change it if the loss is at a different property.</b>',
          '<b>Claim details</b> — set the <b>Date of Loss</b> and <b>Type of Loss</b>, and choose the <b>Insurance Carrier</b> (required). Add the <b>Claim #</b> when you have it. No insurance? Pick <b>Out of pocket / No insurance</b> — that switches the work authorization to the private-pay clause that protects UPR if they file a claim later.',
          '<b>Notes</b> (optional) — loss details, gate codes, special instructions.',
          'Click <b>Create Job</b>. It creates the customer + claim + job and pushes the claim to <b>Encircle</b> (you get a toast either way).',
        ]} />
        <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
          <div>
            <div style={{ fontWeight: 700, color: '#16a34a', marginBottom: 8, fontSize: 14 }}>✓ DO</div>
            <Bullets color="#16a34a" items={[
              '<b>Search for the customer first.</b> Reuse the existing record so you don’t split their history across duplicates.',
              '<b>One job per division.</b> Need water mitigation <i>and</i> a rebuild? Make the water job now and add the reconstruction job separately — each gets its own job and invoice.',
              'Fill in <b>Date</b> and <b>Type of Loss</b> — they flow into the claim and the paperwork.',
              'Pick the <b>real carrier</b>, or <b>Out of pocket</b> for cash jobs — it sets the right work authorization.',
              'Double-check the <b>service address</b> when the loss isn’t at the billing address.',
            ]} />
          </div>
          <div>
            <div style={{ fontWeight: 700, color: '#dc2626', marginBottom: 8, fontSize: 14 }}>✕ DON’T</div>
            <Bullets color="#dc2626" items={[
              'Don’t create a new customer before searching — duplicates split a person’s history.',
              'Don’t pile two divisions into one job — make a second job instead.',
              'Don’t hand-type claim or job numbers — they’re assigned for you (<b>CLM-…</b>, <b>WTR-…</b>).',
              'Don’t skip the carrier — it’s required, and a fake one for a cash job creates the wrong paperwork (use <b>Out of pocket</b>).',
            ]} />
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <Callout tone="blue">
            <b>What one click sets up:</b> New Job creates the <b>customer</b> (if new), the <b>claim</b> for that loss, and the <b>first job</b> under it — then syncs the claim to Encircle. Another division for the same loss is just <b>another job on the same claim</b>.
          </Callout>
        </div>
      </Card>

      {/* 5. Tour of the app */}
      <Card>
        <SectionTitle n="5">A Tour of the Main Screens</SectionTitle>
        <p style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--text-secondary)' }}>
          What each area of the menu is for. (You’ll only see the areas your role and turned-on features allow.)
        </p>
        <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
          {AREAS.map(([icon, name, desc], i) => (
            <div key={name} style={{
              display: 'grid', gridTemplateColumns: '34px 130px 1fr', gap: 12, alignItems: 'start',
              padding: '11px 14px', fontSize: 13.5,
              background: i % 2 ? 'var(--bg-secondary)' : 'var(--bg-primary)',
              borderBottom: i < AREAS.length - 1 ? '1px solid var(--border-light)' : 'none',
            }}>
              <span style={{ fontSize: 18, textAlign: 'center' }}>{icon}</span>
              <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{name}</span>
              <span style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>{desc}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* 6. The divisions */}
      <Card>
        <SectionTitle n="6">The Seven Divisions</SectionTitle>
        <p style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--text-secondary)' }}>
          Every job is one of these. The division sets the crew, the job-number prefix, and the QuickBooks category.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
          {DIVISIONS.map(([name, prefix, col, bg, bd, note]) => (
            <div key={prefix} style={{
              display: 'flex', alignItems: 'center', gap: 11, padding: '9px 12px',
              background: bg, border: `1px solid ${bd}`, borderRadius: 'var(--radius-md)',
            }}>
              <span style={{ width: 13, height: 13, borderRadius: 4, background: col, flex: 'none' }} />
              <span style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--text-primary)' }}>{name}</span>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>— {note}</span>
              <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-tertiary)' }}>{prefix}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* 7. Where do I…? */}
      <Card>
        <SectionTitle n="7">“I want to… → go here”</SectionTitle>
        <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
          {TASKS.map(([want, where], i) => (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '210px 1fr', gap: 12, alignItems: 'start',
              padding: '10px 14px', fontSize: 13.5,
              background: i % 2 ? 'var(--bg-secondary)' : 'var(--bg-primary)',
              borderBottom: i < TASKS.length - 1 ? '1px solid var(--border-light)' : 'none',
            }}>
              <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{want}</div>
              <div style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }} dangerouslySetInnerHTML={{ __html: where }} />
            </div>
          ))}
        </div>
      </Card>

      {/* 8. Glossary */}
      <Card>
        <SectionTitle n="8">Words We Use</SectionTitle>
        <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
          {TERMS.map(([term, def], i) => (
            <div key={term} style={{
              display: 'grid', gridTemplateColumns: '150px 1fr', gap: 12,
              padding: '9px 14px', fontSize: 13.5, alignItems: 'start',
              background: i % 2 ? 'var(--bg-secondary)' : 'var(--bg-primary)',
              borderBottom: i < TERMS.length - 1 ? '1px solid var(--border-light)' : 'none',
            }}>
              <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{term}</div>
              <div style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>{def}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* On a phone */}
      <Card style={{ marginBottom: 0 }}>
        <SectionTitle n="★">On a Phone? (Field Crews)</SectionTitle>
        <p style={{ margin: '0 0 10px', fontSize: 14, color: 'var(--text-secondary)' }}>
          Techs in the field don’t use these office screens — they use the <b>mobile tech app</b>, built for one-tap use with gloves on:
        </p>
        <Bullets items={[
          '<b>Today’s work</b> — the day’s appointments, with the customer, address and a tap to navigate or call.',
          '<b>One continuous timer</b> — tap <b>On My Way</b>, then <b>Start Work</b>; travel and on-site time are tracked for you.',
          '<b>Snap-first photos</b> — the camera saves the photo immediately; adding a note is optional and never blocks you.',
          '<b>Tasks &amp; readings</b> — check off the job’s tasks and log moisture readings right from the appointment.',
        ]} />
      </Card>
    </>
  );
}

// ─── SECTION: "Invoicing & Financials" guide ──────────────
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

function InvoicingGuide() {
  const [openFaq, setOpenFaq] = useState(null);

  return (
    <>
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
      <Card id="build-and-save">
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
    </>
  );
}

// ─── SECTION: Controller (menu ⇄ guide, synced to the URL hash) ──────────────
const GUIDE_IDS = GUIDES.map(g => g.id);
// Parse the hash as "guide[/section]" — backward compatible with a bare
// "#how-it-works"; the optional "/section" lets a feature screen deep-link
// straight to a section (it gets scrolled into view on open).
function readHash() {
  const raw = (typeof window !== 'undefined' ? window.location.hash : '').replace(/^#/, '');
  const [guide, section] = raw.split('/');
  return GUIDE_IDS.includes(guide) ? { view: guide, section: section || null } : { view: 'hub', section: null };
}

export default function Help() {
  const [{ view, section }, setState] = useState(readHash);

  // Keep the view in sync with the URL hash (deep links + browser back/forward).
  useEffect(() => {
    const onHash = () => setState(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // When a contextual link targets a section (#guide/section), scroll to it
  // once the guide view has mounted.
  useEffect(() => {
    if (view === 'hub' || !section) return;
    const raf = requestAnimationFrame(() => {
      document.getElementById(section)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => cancelAnimationFrame(raf);
  }, [view, section]);

  const open = (id) => { window.location.hash = id; setState({ view: id, section: null }); };
  const back = () => {
    // Drop the hash without adding a history entry, then show the menu.
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    setState({ view: 'hub', section: null });
  };

  if (view === 'hub') return <HelpHub onOpen={open} />;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '20px 20px 60px' }}>
      <button
        onClick={back}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 16,
          background: 'none', border: 'none', cursor: 'pointer', font: 'inherit',
          fontSize: 13.5, fontWeight: 600, color: 'var(--text-secondary)', padding: 0,
        }}
      >
        ← All guides
      </button>
      {view === 'how-it-works' ? <HowItWorksGuide /> : <InvoicingGuide />}
    </div>
  );
}
