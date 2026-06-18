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
story.append(Paragraph("How we create invoices, push them to QuickBooks, and track collections inside the UPR app.", s_sub))

# 1
h2("1. The Big Picture")
box("<font name='Courier'>JOB &nbsp;&rarr;&nbsp; CREATE INVOICE &nbsp;&rarr;&nbsp; SYNCS TO QUICKBOOKS &nbsp;&rarr;&nbsp; COLLECTIONS</font><br/>"
    "<font name='Courier' size='8' color='#5f6672'>(the work)&nbsp;&nbsp;&nbsp;&nbsp;(draft in UPR)&nbsp;&nbsp;&nbsp;&nbsp;(real QBO invoice)&nbsp;&nbsp;&nbsp;&nbsp;(get paid + track)</font>",
    colors.HexColor("#f8f9fb"), LINE)
bullets([
    "<b>One invoice per job &mdash; and a job is one division.</b> A claim with Mitigation and Reconstruction is two jobs = two invoices. Insurance pays each category on a separate check, so each check matches its own invoice.",
    "<b>“Invoiced” means it’s in QuickBooks.</b> A new invoice starts as a <b>draft</b> ($0, local). The moment you enter an amount it <b>syncs to QuickBooks automatically</b> &mdash; then it’s real, the balance “clock” starts, and it appears in Collections.",
    "<b>QuickBooks is the official record. UPR is where you build the invoice and chase payment.</b>",
    "<b>The financial numbers come straight from your invoices.</b> Once a job has a synced invoice, its Invoiced / Balance update automatically &mdash; you don’t type them by hand.",
])

# 2
h2("2. Who Can Do What")
bullets([
    "<b>Create &amp; price invoices (they auto-sync to QuickBooks), log payments:</b> Admins, Managers, Project Managers, Supervisors.",
    "<b>Everyone else:</b> can see the info (read-only). Edit buttons simply won’t show.",
])

# 3
h2("3. Create &amp; Send an Invoice")
story.append(Paragraph("<b>Where:</b> Open the <b>Claim</b>, then find the <b>Billing</b> section. (Desktop: the “Billing” card near the bottom. Phone: tap <b>Billing</b> to expand.)", s_body))
steps([
    "Open the claim (from Claims, or a job’s “View Job”).",
    "Go to <b>Billing</b>. You’ll see one row per job/division, e.g. <i>“Reconstruction · J-1042”</i>.",
    "Click <b>Create invoice</b>. The row shows a draft with an invoice number.",
    "Type the amount and click away (or press Enter). <b>It saves and syncs to QuickBooks automatically</b> &mdash; no buttons to press.",
    "Watch the status chip go <b>Syncing…</b> &rarr; green <b>QuickBooks #…</b>. That means it’s officially invoiced.",
    "Need to change it later? Just edit the amount &mdash; it re-syncs to QuickBooks instantly.",
])
box("<b>Fixing mistakes:</b> A red <b>Error</b> badge? Hover to read why (usually the customer isn’t linked in QuickBooks yet) &mdash; fix it and re-enter the amount to retry. Wrong amount? Just retype it; the invoice re-syncs automatically. To pull it out of QuickBooks entirely, use <b>Remove from QuickBooks</b>.",
    colors.HexColor("#fffbeb"), colors.HexColor("#fde68a"))

# 4
h2("4. Track Payments &amp; Collections")
story.append(Paragraph("<b>Where:</b> <b>Collections</b> in the main menu &rarr; click the claim.", s_body))
steps([
    "<b>A payment comes in?</b> Click <b>+ Log Payment</b>, choose the source (insurance, deductible, homeowner/out-of-pocket), enter amount and date, and save. The Balance updates automatically.",
    "<b>Deductible collected?</b> Click the amber <b>“○ $X owed”</b> button by <i>Deductible</i> &mdash; it flips to green <b>“✓ Rcvd”</b>.",
    "<b>Update the A/R status:</b> Open &rarr; Invoiced &rarr; Partial &rarr; Paid (or Disputed / Written Off).",
    "<b>Log every follow-up</b> with <b>Notes</b> &mdash; this builds the Collections Log so anyone can pick up where you left off.",
])

# 5
h2("5. Reading the Numbers")
rows = [
    [Paragraph("Term", s_cellh), Paragraph("What it means", s_cellh)],
    [Paragraph("<b>Estimated</b>", s_cell), Paragraph("What we expected the job to be worth early on.", s_cell)],
    [Paragraph("<b>Approved</b>", s_cell), Paragraph("What the carrier approved.", s_cell)],
    [Paragraph("<b>Invoiced</b>", s_cell), Paragraph("Total synced to QuickBooks. What we’ve officially billed.", s_cell)],
    [Paragraph("<b>Collected</b>", s_cell), Paragraph("Payments you’ve logged as received.", s_cell)],
    [Paragraph("<b>Balance</b>", s_cell), Paragraph("Invoiced − Collected. What’s still owed.", s_cell)],
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
story.append(Paragraph("Rule of thumb: <b>Invoiced − Collected = Balance.</b> If the Balance looks wrong, it’s almost always an invoice with no amount entered yet, or a payment that wasn’t logged.", s_body))

# 6
h2("6. Good Practices")
story.append(Paragraph("<font color='#16a34a'><b>DO</b></font>", s_h3))
bullets([
    "One invoice per division (Mitigation and Reconstruction each get their own).",
    "Enter the amount only when it’s final &mdash; saving an amount creates the real QuickBooks invoice and starts the A/R clock. Not sure yet? Leave the draft at $0.",
    "Double-check the amount; confirm the green badge appears.",
    "Log payments the day they arrive, with the correct source.",
    "Mark the deductible received as soon as it’s collected.",
    "Keep the Collections Log current &mdash; note every follow-up.",
])
story.append(Paragraph("<font color='#dc2626'><b>DON’T</b></font>", s_h3))
bullets([
    "Don’t try to make several invoices for the same job &mdash; create it once and edit the amount.",
    "Don’t enter a guess. Saving an amount sends a real bill to QuickBooks; leave the draft at $0 until you know the number.",
    "Don’t hand-edit the old Revenue numbers on a job that already has a real invoice &mdash; the invoice is the source of truth.",
    "Don’t “Remove from QuickBooks” just to fix an amount &mdash; edit the amount instead (it re-syncs). Only remove it if it shouldn’t be in QuickBooks at all.",
])

# 7
h2("7. FAQ / Troubleshooting")
faq = [
    ("Q: The Collections balance still shows an old number.",
     "That job probably predates this system. Older jobs keep their existing numbers and don’t need re-invoicing. Only jobs with a freshly pushed invoice switch to the new figures."),
    ("Q: I logged a payment but Invoiced didn’t change.",
     "Correct &mdash; logging a payment changes Collected and Balance, never Invoiced. Invoiced only changes when you push or adjust the invoice itself."),
    ("Q: Does QuickBooks payment info flow back automatically?",
     "Not yet. For now, log payments by hand in Collections. Automatic QuickBooks payment sync is planned for a later update."),
    ("Q: I got a red “Error” badge.",
     "Hover it to see why &mdash; usually the contact needs to be linked to a QuickBooks customer first. Fix that, then re-enter the amount to retry."),
    ("Q: Can I undo a push?",
     "Yes &mdash; Remove from QuickBooks pulls it out of QuickBooks entirely. (Just fixing an amount? You don’t need to remove it &mdash; editing the amount re-syncs automatically.)"),
]
for q, a in faq:
    story.append(Paragraph(q, s_q))
    story.append(Paragraph(a, s_body))

# 8
h2("8. Quick Cheat-Sheet")
box("<b>To bill a job:</b> Claim &rarr; Billing &rarr; <i>Create invoice</i> &rarr; type the amount &rarr; it saves &amp; syncs to QuickBooks automatically (green badge = done).",
    colors.HexColor("#f0fdf4"), colors.HexColor("#bbf7d0"))
box("<b>To collect:</b> Collections &rarr; open claim &rarr; <i>+ Log Payment</i> (and mark the deductible Rcvd) &rarr; update A/R status &rarr; add a Notes entry.",
    colors.HexColor("#f0fdf4"), colors.HexColor("#bbf7d0"))

story.append(Spacer(1, 10))
story.append(HRFlowable(width="100%", thickness=0.75, color=LINE, spaceAfter=4))
story.append(Paragraph("Questions, or something doesn’t match your screen? Send a note to Moroni. · Utah Pros Restoration &mdash; internal use.", s_foot))

doc.build(story)
print("WROTE", OUT)
