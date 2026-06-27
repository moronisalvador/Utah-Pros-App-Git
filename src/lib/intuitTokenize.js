/**
 * ════════════════════════════════════════════════
 * FILE: intuitTokenize.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Turns a credit card a staff member keys in (number, expiry, security code, ZIP)
 *   into a one-time "token" by sending it straight from the browser to QuickBooks.
 *   The actual card number never touches our servers — only the harmless token does,
 *   which our /api/qbo-charge worker then uses to charge the card. Keeping the card
 *   off our servers is what keeps us in the light PCI compliance tier (SAQ A-EP).
 *
 * WHERE IT LIVES:
 *   Route:        n/a (helper module)
 *   Rendered by:  n/a — imported by src/pages/InvoiceEditor.jsx (Charge a card)
 *
 * DEPENDS ON:
 *   Packages:  none (uses the browser fetch + crypto.randomUUID)
 *   Internal:  none
 *   Data:      none directly — POSTs card data to Intuit's tokens endpoint and
 *              returns the opaque token; no Supabase tables touched here.
 *
 * NOTES / GOTCHAS:
 *   - The Intuit tokens endpoint takes NO OAuth/Authorization header — that is by
 *     design so the browser can call it directly without exposing our credentials.
 *     (Confirmed against Intuit's Payments SDKs, which exclude /payments/tokens from
 *     bearer auth.) DO NOT add an Authorization header or route this through our API.
 *   - The returned token is single-use and short-lived (~15 min). Tokenize right
 *     before charging; never store the token or the raw card.
 *   - Host depends on the QBO environment: api.intuit.com (production) vs
 *     sandbox.api.intuit.com (sandbox). Pass `environment` from
 *     get_qbo_connection_status() so sandbox testing hits the sandbox tokenizer.
 *   - This call is cross-origin (browser → api.intuit.com). Intuit's tokens endpoint
 *     is the documented client-side tokenization path; if a browser CORS error ever
 *     appears, it surfaces as a clear "couldn't reach the card processor" message
 *     rather than silently charging — verify CORS during the sandbox test.
 * ════════════════════════════════════════════════
 */

const TOKENS_HOST = {
  production: 'https://api.intuit.com',
  sandbox: 'https://sandbox.api.intuit.com',
};

const TOKENS_PATH = '/quickbooks/v4/payments/tokens';

// ─── SECTION: Helpers ──────────────

// Parse a typed "MM/YY", "MM / YYYY", "MM-YY" etc. into { expMonth: 'MM', expYear: 'YYYY' }.
// Returns null if it can't be read as a valid month + year.
export function parseExpiry(raw) {
  if (!raw) return null;
  const m = String(raw).match(/^\s*(\d{1,2})\s*[/\-.\s]?\s*(\d{2}|\d{4})\s*$/);
  if (!m) return null;
  const month = Number(m[1]);
  if (!(month >= 1 && month <= 12)) return null;
  const year = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
  return { expMonth: String(month).padStart(2, '0'), expYear: String(year) };
}

// ─── SECTION: Tokenize ──────────────

/**
 * Tokenize a card client-side via Intuit's Payments Tokens API.
 * @param {Object} card  { number, exp ('MM/YY'), cvc, zip, name?, region?, country? }
 * @param {Object} opts  { environment: 'production' | 'sandbox' }
 * @returns {Promise<string>} the opaque single-use token (the `value` field)
 * @throws {Error} on invalid input or a tokenization failure
 */
export async function tokenizeCard(card = {}, { environment = 'production' } = {}) {
  const number = String(card.number || '').replace(/[\s-]+/g, '');
  const cvc = String(card.cvc || '').trim();
  const zip = String(card.zip || '').trim();
  const exp = parseExpiry(card.exp);

  if (!/^\d{13,19}$/.test(number)) throw new Error('Enter a valid card number.');
  if (!exp) throw new Error('Enter the expiry as MM/YY.');
  if (!/^\d{3,4}$/.test(cvc)) throw new Error('Enter the 3- or 4-digit security code.');

  const address = {};
  if (zip) address.postalCode = zip;
  if (card.region) address.region = String(card.region).trim();
  if (card.country) address.country = String(card.country).trim();

  const payload = {
    card: {
      number,
      expMonth: exp.expMonth,
      expYear: exp.expYear,
      cvc,
      ...(card.name ? { name: String(card.name).trim() } : {}),
      ...(Object.keys(address).length ? { address } : {}),
    },
  };

  const base = TOKENS_HOST[environment] || TOKENS_HOST.production;

  let res;
  try {
    res = await fetch(`${base}${TOKENS_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Request-Id': (crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`),
      },
      body: JSON.stringify(payload),
    });
  } catch {
    // Network / CORS failure — never silently proceed to a charge.
    throw new Error('Couldn’t reach the card processor. Check your connection and try again.');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.value) {
    const apiMsg = data?.errors?.[0]?.message || data?.errors?.[0]?.detail;
    throw new Error(apiMsg || 'The card couldn’t be verified. Double-check the number, expiry, and security code.');
  }
  return data.value;
}
