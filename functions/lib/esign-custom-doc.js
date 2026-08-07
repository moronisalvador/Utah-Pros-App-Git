/**
 * ════════════════════════════════════════════════
 * FILE: functions/lib/esign-custom-doc.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Everything the server checks before it will let someone send a one-off
 *   "Custom Authorization" for a client to sign: who is allowed to write one,
 *   and whether the text they wrote is safe to put in front of a customer.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ./auth.js, ./http.js
 *   Data:      reads  → employees (through requireRole)
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - THE ROLE GATE IS NOT A SECURITY BOUNDARY, and must never be described as
 *     one. public.sign_requests carries four always-true RLS policies and
 *     create_sign_request is SECURITY DEFINER with no caller check granted to
 *     `authenticated`, so any employee session can already write that table
 *     directly through PostgREST. This gate stops the wrong person reaching for
 *     the wrong button; it does not stop a determined one. Closing that properly
 *     means narrowing the table's policies and adding a caller predicate to
 *     create_sign_request, which is a separate initiative requiring the
 *     per-role ALLOW *and* DENY proof database-standard.md §5b mandates.
 *     The honest sentence is "the worker refuses; the database does not."
 *   - CUSTOM_DOC_ROLES mirrors src/lib/claimUtils.js. functions/ is a separate
 *     Cloudflare bundle and cannot import from src/, so the list is duplicated
 *     on purpose and pinned by
 *     tests/qa/unit/esign-custom-doc-surface-parity.test.js.
 *   - Deliberately NOT a reuse of BILLING_EDIT_ROLES. Same three members today,
 *     different concept — authority to bind the company in writing is not
 *     authority to touch invoices. The repository already learned this lesson
 *     once when payout authority had to be split back out of billing.
 * ════════════════════════════════════════════════
 */

import { requireRole } from './auth.js';
import { fetchWithTimeout } from './http.js';

// ─── SECTION: Constants ──────────────

/** Who may compose and send a free-text Custom Authorization (doc_type='other'). */
export const CUSTOM_DOC_ROLES = ['admin', 'office', 'project_manager'];

export const CUSTOM_DOC_HEADING_MAX = 80;
export const CUSTOM_DOC_BODY_MAX = 8000;

/**
 * The {{tokens}} a custom body may contain.
 *
 * {{insurance_section}} is BANNED, not merely absent, for two independent
 * reasons. It expands to a full irrevocable pre-assignment of insurance
 * benefits — right for a Work Authorization, wrong to smuggle into a narrow
 * one-situation acknowledgment a client thinks is about their carpet. And it
 * expands to materially DIFFERENT text in src/pages/SignPage.jsx than in
 * functions/api/submit-esign.js, so the client would read one version and sign
 * another.
 *
 * {{date}} is allowed: submit-esign.js gained a branch for it on 2026-08-07.
 * Before that it resolved on screen and rendered literally in the PDF.
 */
export const CUSTOM_DOC_ALLOWED_TOKENS = [
  'client_name', 'job_number', 'address', 'city', 'state', 'zip',
  'date_of_loss', 'insurance_company', 'claim_number', 'policy_number',
  'adjuster_name', 'company_name', 'date',
];

const TOKEN_RE = /\{\{\s*([a-z_]+)\s*\}\}/gi;
const SNIPPET_KEY_RE = /^[a-z0-9_]{1,64}$/;

// ─── SECTION: Authorization ──────────────

/**
 * Gate a Custom Authorization send. Mirrors authorizeQboBrowserRequest: collapse
 * requireRole's internal reasons to a stable three-value contract so the worker
 * never leaks why, and add the is_external refusal requireEmployee omits.
 *
 * Callers MUST apply this only when doc_type === 'other'. The other ten document
 * types keep the deployed requireUser-only behaviour — this feature must not
 * quietly narrow who can send a Certificate of Completion.
 */
export async function authorizeCustomDocRequest(
  request,
  env,
  db,
  fetchImpl = fetchWithTimeout,
  roles = CUSTOM_DOC_ROLES,
) {
  const auth = await requireRole(request, env, db, roles, fetchImpl);
  if (auth.error) {
    return {
      ok: false,
      status: auth.status,
      error: auth.status === 401
        ? 'Unauthorized'
        : auth.status === 403
          ? 'Forbidden'
          : 'Authorization check failed',
    };
  }
  // An employee who has left, or an external collaborator, must not be able to
  // author a document that binds the company — whatever role they still carry.
  if (auth.employee.is_external) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  return { ok: true, user: auth.user, employee: auth.employee };
}

// ─── SECTION: Validation ──────────────

/**
 * Validate and normalize the composed text.
 *
 * Returns { ok: true, value: { custom_heading, custom_body, custom_snippet_key } }
 * or { ok: false, error } with a message safe to show the staff member.
 *
 * Blank is refused HERE, at create time, and refused again in submit-esign.js at
 * sign time. That belt-and-braces is deliberate: with no text, both renderers
 * fall through to Certificate-of-Completion boilerplate — SignPage.jsx via
 * buildSectionText() and submit-esign.js via buildCocSections() — and the client
 * would be shown, and would sign, "the work is 100% complete and I have no
 * outstanding complaints." On a document authorizing emergency demolition.
 */
export function validateCustomDocText({ custom_heading, custom_body, custom_snippet_key } = {}) {
  const heading = typeof custom_heading === 'string' ? custom_heading.trim() : '';
  const body = typeof custom_body === 'string' ? custom_body.trim() : '';

  if (!heading) return { ok: false, error: 'A document title is required.' };
  if (heading.length > CUSTOM_DOC_HEADING_MAX) {
    return { ok: false, error: `The document title must be ${CUSTOM_DOC_HEADING_MAX} characters or fewer.` };
  }
  // The heading is drawn into the PDF by an unwrapped drawText call, so a line
  // break would silently overlap the text below it.
  if (/[\r\n]/.test(heading)) {
    return { ok: false, error: 'The document title must be a single line.' };
  }

  if (!body) return { ok: false, error: 'The document text is required.' };
  if (body.length > CUSTOM_DOC_BODY_MAX) {
    return { ok: false, error: `The document text must be ${CUSTOM_DOC_BODY_MAX} characters or fewer.` };
  }

  for (const raw of [heading, body]) {
    TOKEN_RE.lastIndex = 0;
    let match;
    while ((match = TOKEN_RE.exec(raw)) !== null) {
      const token = match[1].toLowerCase();
      if (token === 'insurance_section') {
        return {
          ok: false,
          error: '{{insurance_section}} cannot be used in a custom document — it inserts a full assignment of insurance benefits. Use the Direction to Pay document for that.',
        };
      }
      if (!CUSTOM_DOC_ALLOWED_TOKENS.includes(token)) {
        return { ok: false, error: `{{${match[1]}}} is not a recognized field and would print literally on the signed document.` };
      }
    }
  }

  let snippetKey = null;
  if (custom_snippet_key !== undefined && custom_snippet_key !== null && custom_snippet_key !== '') {
    // Audit metadata only — recorded so we can tell approved wording from a
    // rewrite. Shape-checked rather than matched against the snippet list,
    // because duplicating that list here would drift the moment one is added.
    if (typeof custom_snippet_key !== 'string' || !SNIPPET_KEY_RE.test(custom_snippet_key)) {
      return { ok: false, error: 'Invalid snippet reference.' };
    }
    snippetKey = custom_snippet_key;
  }

  return {
    ok: true,
    value: { custom_heading: heading, custom_body: body, custom_snippet_key: snippetKey },
  };
}
