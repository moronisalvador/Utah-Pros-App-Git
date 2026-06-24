# Email Deliverability Runbook — utahpros.app

**Goal:** land transactional email (esign links, scope sheets, invoices via QBO,
billing 2FA) in the **inbox** on Gmail *and* Microsoft (Outlook/Hotmail/MSN).

All app email sends through **Resend** from `restoration@utahpros.app`
(`functions/lib/email.js`; `EMAIL_FROM` / `EMAIL_REPLY_TO` are env-overridable).

---

## 1. Authentication — the trifecta (status: ✅ in place)

DMARC passes when **SPF or DKIM aligns** with the From domain (`utahpros.app`).
Both align here, so DMARC passes.

| Record | Host | Purpose | Status |
|--------|------|---------|--------|
| SPF (sending) | `send.utahpros.app` TXT `v=spf1 include:amazonses.com ~all` | authorizes Resend's send path | ✅ |
| Return-path MX | `send.utahpros.app` MX `feedback-smtp…amazonses.com` | bounce/feedback handling | ✅ |
| DKIM | `resend._domainkey.utahpros.app` TXT (`p=MIG…`) | cryptographic signature | ✅ |
| DMARC | `_dmarc.utahpros.app` TXT `v=DMARC1; p=none; rua=mailto:restoration@utahpros.app; fo=1` | policy + reports | ✅ |

⚠️ **DMARC must be a single `_dmarc` TXT record** — never add a second one.

**DMARC tightening plan:** leave at `p=none` for ~1–2 weeks, confirm aggregate
reports show SPF+DKIM passing for legitimate Resend mail, then tighten to
`p=quarantine` (and later `p=reject`). Stricter policy = more inbox trust,
especially at Microsoft.

---

## 2. Root MX via Cloudflare Email Routing (the missing piece)

`utahpros.app` (root) has **no MX record**. Two reasons to add one through
**Cloudflare Email Routing**:

1. **Replies reach a human.** Reply-To is `restoration@utahpros.app`; Email
   Routing forwards that address to the real inbox.
2. **Microsoft trust.** Outlook/Hotmail are suspicious of a sending domain with
   no MX. Adding one materially helps inbox placement.

### Setup (Cloudflare dashboard → `utahpros.app` zone → **Email → Email Routing**)

1. **Enable Email Routing.** Cloudflare offers to add the required DNS records
   automatically — accept. It adds root **MX** (`route1/2/3.mx.cloudflare.net`)
   and a root **SPF** TXT (`v=spf1 include:_spf.mx.cloudflare.net ~all`).
   - This root SPF is for *receiving/forwarding* and does **not** conflict with
     Resend's sending SPF (which lives on `send.utahpros.app`).
   - ⚠️ A domain may have only **one** SPF (TXT `v=spf1…`) per host. The root had
     none, so this is safe. Never create a second root SPF.
2. **Add a destination address:** Email Routing → *Destination addresses* → add
   the real inbox (e.g. `restoration@utah-pros.com`). Cloudflare emails it a
   verification link — click it. Routing won't deliver until verified.
3. **Create the route:** *Routing rules* → add a custom address
   `restoration@utahpros.app` → forward to the verified destination. (A catch-all
   is optional but handy so DMARC reports + any other alias still arrive.)
4. **Save.** The root MX now exists and replies + DMARC `rua` reports to
   `restoration@utahpros.app` forward to your inbox.

> Note: Email Routing's root MX is for *receiving*; it does not affect Resend
> *sending* (which uses SPF/DKIM, not the From domain's MX). Resend's own
> `send.` MX is a different host and is untouched.

---

## 3. Reputation & sending practices

- **Warm up.** `utahpros.app` is a new sending domain — reputation builds over
  days. Normal transactional volume is fine; don't blast a large batch on day one.
- **Keep complaints/bounces near zero.** Only email valid, expecting recipients;
  one spam complaint on a young domain hurts disproportionately.
- **Consistent identity.** Always send From `restoration@utahpros.app` with the
  same display name; keep Reply-To on the same domain (already enforced in code).

---

## 4. Microsoft (Outlook/Hotmail/MSN) — the strict one

- Weighs SPF + DKIM + **DMARC** alignment heavily → all in place; tighten DMARC.
- Expects a **valid MX** on the sending domain → fixed by step 2.
- IP reputation is Resend's (shared IPs). At higher volume, options are a Resend
  **dedicated IP** (paid) or the structural upgrade below.
- Monitor with **Microsoft SNDS** and **Google Postmaster Tools** (add
  `utahpros.app`); spot-check with https://www.mail-tester.com.

---

## 5. Highest-impact upgrade (if Microsoft still junks mail)

`utahpros.app` is **new** and a **look-alike** of the real `utah-pros.com` — the
two traits spam filters distrust most. The biggest single improvement is to send
from the **established** domain via a subdomain, e.g. **`send.utah-pros.com`**:

1. Verify `send.utah-pros.com` (or `mail.utah-pros.com`) in Resend → add its
   SPF/DKIM records to `utah-pros.com` DNS (a subdomain keeps it isolated from
   Google Workspace's root mail).
2. Set Cloudflare Pages env `EMAIL_FROM=Utah Pros Restoration <restoration@send.utah-pros.com>`
   (+ matching `EMAIL_REPLY_TO`). **No code change** — `email.js` already reads these.

This inherits `utah-pros.com`'s reputation and isn't a look-alike of anything.

---

## 6. Later: BIMI (logo in inbox)

Once DMARC is at `p=quarantine`+, BIMI shows the Utah Pros logo beside emails in
Gmail/Yahoo. Requires a `default._bimi` TXT record and, for Gmail, a paid VMC/CMC
certificate. Optional brand polish — not a deliverability requirement.
