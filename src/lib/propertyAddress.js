/**
 * ════════════════════════════════════════════════
 * FILE: propertyAddress.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Turns a job's address pieces — street, city, state, ZIP — into one line of
 *   text, skipping any piece that is blank. Documents used to write the address
 *   out as four separate fields joined by commas, so a job with no city printed
 *   "1234 Example Rd, United States, , UT" on a page a customer signs. This
 *   joins only the pieces that exist, so the stray comma cannot happen.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none — deliberately dependency-free so the signing page and the
 *              office template editor can both use it without pulling either
 *              one's code into the other's bundle.
 *   Data:      reads  → nothing (pure functions over a job object)
 *              writes → nothing
 *
 * NOTES / GOTCHAS:
 *   - A THIRD copy of this logic lives in functions/api/submit-esign.js. That is
 *     not an oversight: `functions/` is a separate Cloudflare bundle and cannot
 *     import from `src/`. The signed PDF is built there, so if the two ever
 *     disagree the customer reads one address and signs another.
 *     tests/qa/unit/esign-property-address-parity.test.js pins them together.
 *   - `state` falls back to 'UT' to match the {{state}} token's own default. A
 *     job with every field populated renders exactly as it did before this file
 *     existed — verified against W-2607-003.
 *   - collapseAddressGroups MUST run before individual token substitution. Once
 *     {{city}} has been replaced with '' there is no group left to recognise.
 * ════════════════════════════════════════════════
 */

/** Join the address parts that actually exist. */
export function formatPropertyAddress(job = {}, { includeZip = true } = {}) {
  const clean  = (v) => String(v ?? '').trim();
  const street = [clean(job.address), clean(job.city)].filter(Boolean).join(', ');
  const region = [clean(job.state) || 'UT', includeZip ? clean(job.zip) : ''].filter(Boolean).join(' ');
  return [street, region].filter(Boolean).join(', ');
}

/* Every template writes the address out as this exact group. Rewriting the
   group here, rather than switching the templates to {{property_address}},
   repairs the live work_auth / direction_pay / change_order rows too — their
   wording is legally reviewed, and a migration that edits what a customer signs
   is a much larger change than a rendering fix.

   Authors of NEW wording should use {{property_address}} directly. */
const ADDRESS_GROUP_RE = /\{\{address\}\},\s*\{\{city\}\},\s*\{\{state\}\}(\s*\{\{zip\}\})?/g;

export function collapseAddressGroups(body, job) {
  return String(body ?? '').replace(
    ADDRESS_GROUP_RE,
    (_match, zipPart) => formatPropertyAddress(job, { includeZip: Boolean(zipPart) }),
  );
}
