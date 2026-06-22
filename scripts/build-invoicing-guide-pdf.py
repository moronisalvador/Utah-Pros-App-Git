#!/usr/bin/env python3
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, ListFlowable,
                                ListItem, Table, TableStyle, HRFlowable)

OUT = "/home/user/Utah-Pros-App-Git/public/UPR-Invoicing-Financials-Guide.pdf"

ACCENT = colors.HexColor("#1d4ed8")
INK    = colors.HexColor("#111318")
MUTE   = colors.HexColor("#5f6672")
LINE   = colors.HexColor("#e2e5e9")

doc = SimpleDocTemplate(OUT, pagesize=letter,
                        leftMargin=0.7*inch, rightMargin=0.7*inch,
                        topMargin=0.7*inch, bottomMargin=0.7*inch,
                        title="UPR Invoicing & Financials — Employee Guide",
                        author="Utah Pros Restoration")
CW = doc.width  # content width

def style(name, **kw):
    base = dict(fontName="Helvetica", fontSize=10.5, leading=15, textColor=INK,
                spaceAfter=6)
    base.update(kw)
    return ParagraphStyle(name, **base)

s_h1   = style("h1", fontName="Helvetica-Bold", fontSize=21, leading=24, textColor=ACCENT, spaceAfter=2)
s_sub  = style("sub", fontSize=10.5, textColor=MUTE, spaceAfter=14)
s_h2   = style("h2", fontName="Helvetica-Bold", fontSize=14, leading=17, textColor=ACCENT, spaceBefore=14, spaceAfter=2)
s_h3   = style("h3", fontName="Helvetica-Bold", fontSize=11, leading=14, textColor=INK, spaceBefore=8, spaceAfter=3)
s_body = style("body")
s_bodyw= style("bodyw", textColor=colors.white)
s_q    = style("q", fontName="Helvetica-Bold", textColor=INK, spaceBefore=6, spaceAfter=1)
s_mono = style("mono", fontName="Courier", fontSize=9.5, leading=14)
s_foot = style("foot", fontSize=9, textColor=colors.HexColor("#8b929e"))
s_cell = style("cell", spaceAfter=0)
s_cellh= style("cellh", fontName="Helvetica-Bold", textColor=ACCENT, spaceAfter=0)

story = []

def h2(txt):
    story.append(Paragraph(txt, s_h2))
    story.append(HRFlowable(width="100%", thickness=1.4, color=LINE, spaceBefore=2, spaceAfter=6))

def bullets(items, style_=s_body):
    flow = [ListItem(Paragraph(t, style_), leftIndent=14, value="•") for t in items]
    story.append(ListFlowable(flow, bulletType="bullet", start="•", leftIndent=10,
                              bulletColor=ACCENT, bulletFontSize=9))

def steps(items):
    flow = [ListItem(Paragraph(t, s_body), leftIndent=16) for t in items]
    story.append(ListFlowable(flow, bulletType="1", leftIndent=12,
                              bulletColor=ACCENT, bulletFontName="Helvetica-Bold"))

def box(html, bg, border, pad=8):
    t = Table([[Paragraph(html, s_body)]], colWidths=[CW])
    t.setStyle(TableStyle([
        ("BACKGROUND",(0,0),(-1,-1), bg),
        ("BOX",(0,0),(-1,-1), 0.75, border),
        ("LEFTPADDING",(0,0),(-1,-1),pad),("RIGHTPADDING",(0,0),(-1,-1),pad),
        ("TOPPADDING",(0,0),(-1,-1),6),("BOTTOMPADDING",(0,0),(-1,-1),6),
    ]))
    story.append(t)
    story.append(Spacer(1, 8))

# ── Title ──
story.append(Paragraph("UPR Invoicing &amp; Financials", s_h1))
story.append(Paragraph("Employee Guide", s_h1))
story.append(Paragraph("How we build invoices, send them to QuickBooks, take payments, and track collections inside the UPR app.", s_sub))

# 1
h2("1. The Big Picture")
box("<font name='Courier'>JOB &nbsp;&rarr;&nbsp; BUILD INVOICE &nbsp;&rarr;&nbsp; SEND TO QUICKBOOKS &nbsp;&rarr;&nbsp; GET PAID &nbsp;&rarr;&nbsp; COLLECTIONS</font><br/>"
    "<font name='Courier' size='8' color='#5f6672'>(the work)&nbsp;&nbsp;(line items in UPR)&nbsp;&nbsp;(real QBO invoice)&nbsp;&nbsp;(payments sync to QBO)&nbsp;&nbsp;(track A/R)</font>",
    colors.HexColor("#f8f9fb"), LINE)
bullets([
    "<b>One invoice per job &mdash; and a job is one division.</b> A claim with Mitigation and Reconstruction is two jobs = two invoices. Insurance pays each category on a separate check, so each check matches its own invoice.",
    "<b>Invoices are built line by line.</b> On the invoice editor each line carries a QuickBooks <b>Item</b> + <b>Class</b>, a description, and quantity × rate. The invoice total adds itself up &mdash; there’s no single lump-sum box.",
    "<b>“Invoiced” means it’s in QuickBooks.</b> A new invoice starts as a <b>draft</b> in UPR. You add the lines, then click <b>Send to QuickBooks</b> &mdash; now it’s real, the balance clock starts, and it appears in Collections.",
    "<b>Everything flows one way: UPR &rarr; QuickBooks.</b> QuickBooks is the official record; UPR is where you build, send, take payment, and chase the balance. Nobody edits invoices or payments directly in QuickBooks.",
    "<b>Payments you record in UPR post to QuickBooks automatically</b>, applied against the invoice.",
    "<b>The financial numbers come straight from your invoices</b> &mdash; once a job has a sent invoice, its Invoiced / Balance update on their own.",
])

# 2
h2("2. Who Can Do What")
bullets([
    "<b>Build invoices, send to QuickBooks, record payments, manage Payment Settings:</b> Admins and Managers.",
    "<b>Everyone else:</b> can see the info (read-only). Edit buttons simply won’t show.",
    "Billing is also behind the <b>Billing</b> feature switch &mdash; if it’s off, the billing areas are hidden for everyone.",
])

# 3
h2("3. Start an Invoice")
story.append(Paragraph("Two ways to begin &mdash; both open the same invoice editor. <b>One invoice per job</b>: if the job already has one, you land right back on it (never a duplicate).", s_body))
bullets([
    "<b>“+ New invoice” button</b> &mdash; on a <b>Customer’s page</b> (top) or on the <b>Collections</b> screen. Pick the job to bill and it opens the editor.",
    "<b>From the claim or customer</b> &mdash; open the claim’s <b>Invoices &amp; Payments</b> panel (or a customer’s <b>Financial</b> tab) and click <b>Create invoice</b> on the job’s row.",
])

# 4
h2("4. Build &amp; Send to QuickBooks")
story.append(Paragraph("<b>Where:</b> the invoice editor (the page that opens after you start an invoice).", s_body))
steps([
    "Click <b>+ Add line</b>. Choose the QuickBooks <b>Item</b> and <b>Class</b>, type a <b>description</b>, then <b>quantity</b> and <b>rate</b>. The line amount and invoice <b>Total</b> fill in automatically.",
    "Add as many lines as the job needs. <b>Line edits save by themselves</b> &mdash; no save button.",
    "When the total is right, click <b>Send to QuickBooks</b>. Status goes <b>Draft &rarr; Sent</b> with a green <b>QuickBooks #</b> &mdash; now it’s officially invoiced and shows in Collections.",
    "Need to change it after sending? Edit the lines and click <b>Update in QuickBooks</b> to re-push.",
    "The <b>Item</b> and <b>Class</b> lists come live from QuickBooks, so QuickBooks must be connected.",
])
box("<b>Fixing mistakes:</b> A red <b>Error</b> badge? Hover to read why (usually the customer isn’t linked in QuickBooks yet) &mdash; fix it and click <b>Send / Update</b> again. Sent the wrong thing? Edit the lines and <b>Update</b>, or use <b>Remove from QuickBooks</b> to pull it out. An unsent draft can be removed with <b>Delete draft</b>.",
    colors.HexColor("#fffbeb"), colors.HexColor("#fde68a"))

# 5
h2("5. Get Paid")
story.append(Paragraph("<b>Where:</b> the claim’s <b>Invoices &amp; Payments</b> panel, a customer’s <b>Financial</b> tab, or <b>Collections</b> &rarr; open the claim.", s_body))
steps([
    "<b>A payment comes in?</b> Click <b>+ Record payment</b>, enter the amount and date, choose who paid (insurance / homeowner / other) and the method, add a reference, and save.",
    "The payment <b>posts to QuickBooks automatically</b>, applied to that invoice &mdash; a green <b>✓ QB</b> appears. (A <b>! QB</b> means the invoice isn’t in QuickBooks yet &mdash; send it first.)",
    "<b>Collected</b> and <b>Balance</b> update right away; <b>Invoiced</b> doesn’t change (it only reflects the invoice itself).",
])
box("<b>Card payments (Stripe pay-link):</b> On the invoice editor click <b>Create pay link</b> to make a secure Stripe link for the balance, then send it to the customer. When they pay by card, the payment is recorded and synced to QuickBooks automatically &mdash; including the processing fee, which is booked for you. <i>Available once Stripe is connected (Collections &rarr; Payment Settings).</i>",
    colors.HexColor("#eff6ff"), colors.HexColor("#bfdbfe"))

# 6
h2("6. Collections &amp; the Numbers")
story.append(Paragraph("<b>Collections</b> in the menu has two tabs: <b>A/R · Outstanding</b> (totals, aging buckets, overdue worklist) and <b>Payments</b> (cash-in history). Click any row to open that claim’s A/R workspace. The same detail lives on each claim’s <b>Invoices &amp; Payments</b> panel and each customer’s <b>Financial</b> tab.", s_body))
rows = [
    [Paragraph("Term", s_cellh), Paragraph("What it means", s_cellh)],
    [Paragraph("<b>Invoiced</b>", s_cell), Paragraph("Total of the invoice’s line items, once it’s sent to QuickBooks. What we’ve officially billed.", s_cell)],
    [Paragraph("<b>Collected</b>", s_cell), Paragraph("Payments you’ve recorded as received (they also post to QuickBooks).", s_cell)],
    [Paragraph("<b>Balance</b>", s_cell), Paragraph("Invoiced − Collected. What’s still owed.", s_cell)],
    [Paragraph("<b>Aging</b>", s_cell), Paragraph("How overdue the balance is vs. the due date — Current, 1–30, 31–60, 61–90, 90+ days.", s_cell)],
    [Paragraph("<b>Deductible Owed</b>", s_cell), Paragraph("The customer’s deductible not yet collected.", s_cell)],
    [Paragraph("<b>Insurance A/R</b>", s_cell), Paragraph("What insurance still owes after the deductible.", s_cell)],
]
t = Table(rows, colWidths=[1.5*inch, CW-1.5*inch])
t.setStyle(TableStyle([
    ("BACKGROUND",(0,0),(-1,0), colors.HexColor("#eff6ff")),
    ("LINEBELOW",(0,0),(-1,0), 0.75, colors.HexColor("#bfdbfe")),
    ("GRID",(0,0),(-1,-1), 0.5, LINE),
    ("LEFTPADDING",(0,0),(-1,-1),7),("RIGHTPADDING",(0,0),(-1,-1),7),
    ("TOPPADDING",(0,0),(-1,-1),5),("BOTTOMPADDING",(0,0),(-1,-1),5),
    ("VALIGN",(0,0),(-1,-1),"TOP"),
]))
story.append(t)
story.append(Spacer(1, 6))
story.append(Paragraph("Rule of thumb: <b>Invoiced − Collected = Balance.</b> If the Balance looks wrong, it’s almost always an invoice that wasn’t sent, or a payment that wasn’t recorded.", s_body))

# 7
h2("7. Good Practices")
story.append(Paragraph("<font color='#16a34a'><b>DO</b></font>", s_h3))
bullets([
    "One invoice per division (Mitigation and Reconstruction each get their own).",
    "Build the lines with the right <b>Item + Class</b> so the numbers land in the correct QuickBooks buckets.",
    "Only <b>Send to QuickBooks</b> when the total is final &mdash; sending creates the real bill and starts the A/R clock. Not ready? Leave it a draft.",
    "Record payments the day they arrive, with the correct payer and method.",
    "Use the card <b>pay link</b> for deductibles / out-of-pocket &mdash; it reconciles itself.",
    "Mark the deductible received as soon as it’s collected.",
])
story.append(Paragraph("<font color='#dc2626'><b>DON’T</b></font>", s_h3))
bullets([
    "Don’t try to make a second invoice for the same job &mdash; open the existing one and edit its lines.",
    "Don’t send a guess. A sent invoice is a real bill in QuickBooks.",
    "Don’t enter invoices or payments directly in QuickBooks &mdash; always do it in UPR so the two stay in sync.",
    "Don’t “Remove from QuickBooks” unless you mean to pull it back to correct and re-send.",
])

# 8
h2("8. FAQ / Troubleshooting")
faq = [
    ("Q: How do I take a card payment from a customer?",
     "Open the invoice editor and click <b>Create pay link</b> &mdash; a secure Stripe link for the balance. Send it; when they pay, the payment is recorded and synced to QuickBooks automatically. (Available once Stripe is connected in Payment Settings.)"),
    ("Q: I recorded a payment — did it reach QuickBooks?",
     "Yes, automatically &mdash; as long as the invoice was already sent to QuickBooks. A green ✓ QB shows next to it. A ! QB means the invoice isn’t in QuickBooks yet; send it first."),
    ("Q: The Collections balance still shows an old number.",
     "That job probably predates this system. Older jobs keep their existing numbers and don’t need re-invoicing. Only jobs with a freshly sent invoice switch to the new figures."),
    ("Q: I got a red “Error” badge.",
     "Hover it to see why &mdash; usually the customer needs to be linked to a QuickBooks customer first. Fix that, then Send / Update to QuickBooks again."),
    ("Q: Can I undo a send?",
     "Yes &mdash; on the invoice editor, Remove from QuickBooks pulls it out entirely. Just fixing line items? Edit the lines and click Update in QuickBooks."),
    ("Q: Why don’t I see the Item / Class dropdowns?",
     "They load live from QuickBooks, so QuickBooks must be connected (Dev Tools &rarr; Integrations)."),
]
for q, a in faq:
    story.append(Paragraph(q, s_q))
    story.append(Paragraph(a, s_body))

# Cheat sheet
h2("Quick Cheat-Sheet")
box("<b>To bill a job:</b> <i>+ New invoice</i> (or Claim &rarr; Invoices &amp; Payments &rarr; <i>Create invoice</i>) &rarr; add line items (Item + Class, qty × rate) &rarr; <i>Send to QuickBooks</i> (green QuickBooks # = done).",
    colors.HexColor("#eff6ff"), colors.HexColor("#bfdbfe"))
box("<b>To collect:</b> Collections &rarr; open claim &rarr; <i>+ Record payment</i> (it posts to QuickBooks) &mdash; or open the invoice and <i>Create pay link</i> for a card payment.",
    colors.HexColor("#f0fdf4"), colors.HexColor("#bbf7d0"))

story.append(Spacer(1, 10))
story.append(HRFlowable(width="100%", thickness=0.75, color=LINE, spaceAfter=4))
story.append(Paragraph("Questions, or something doesn’t match your screen? Send a note to Moroni. · Utah Pros Restoration &mdash; internal use.", s_foot))

doc.build(story)
print("WROTE", OUT)
