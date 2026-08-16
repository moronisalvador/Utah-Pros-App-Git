/**
 * ════════════════════════════════════════════════
 * FILE: customerHelpers.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The small, pure decisions behind the field customer screen — the ones worth
 *   testing on their own rather than through a rendered page. Which of the job's
 *   people is "the customer" and which are the extra contacts; what a saved edit
 *   is actually allowed to change; and how a person's role reads on screen.
 *
 *   The most important one is the smallest: building the patch that a save
 *   sends. It only ever names the fields a technician edited. It can never name
 *   the columns that record whether a customer agreed to be texted — those are a
 *   legal record, not a form field, and nothing on this screen may touch them.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (helper module for /tech/customer/:contactId)
 *   Rendered by:  n/a — imported by the customer screen's components
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  @/lib/phone (normalizePhone — the app's one phone normalizer)
 *   Data:      none (pure functions — the caller supplies the data)
 *
 * NOTES / GOTCHAS:
 *   - CONSENT_COLUMNS is enforced, not documented: buildContactPatch strips any
 *     key in it, and a test asserts a hostile form object cannot smuggle one
 *     through. AGENTS.md §14 — consent code is the highest-consequence code in
 *     this repository, and an accidental `opt_in_status` write from a phone is a
 *     per-message TCPA exposure.
 *   - Empty strings become NULL, matching the office CustomerPage tile exactly,
 *     so the two screens cannot disagree about what "cleared" means.
 *   - A field the technician did not change is not in the patch at all. That is
 *     what keeps two people editing one shared adjuster from clobbering each
 *     other's untouched fields.
 * ════════════════════════════════════════════════
 */
import { normalizePhone } from '@/lib/phone';

/**
 * Columns this screen may NEVER write. Consent and do-not-disturb state is
 * changed by the customer (inbound STOP/START), by the attestation flow, or by
 * the provider webhook — never by a technician editing a phone number.
 */
export const CONSENT_COLUMNS = Object.freeze([
  'opt_in_status',
  'opt_in_at',
  'opt_in_source',
  'opt_out_at',
  'opt_out_source',
  'dnd',
  'dnd_at',
  'dnd_reason',
]);

/** The contact fields a technician may edit from the field. */
export const EDITABLE_CONTACT_FIELDS = Object.freeze([
  'name', 'phone', 'email', 'company',
]);

/** The contact-level insurance fields (contact mode's defaults). */
export const EDITABLE_CONTACT_INSURANCE_FIELDS = Object.freeze([
  'insurance_carrier', 'policy_number',
]);

/**
 * The job's denormalized insurance copy — the same three columns the office
 * JobPage edits. Deliberately NOT mirrored onto the claim: claim and policy
 * numbers are not synced between jobs and claims today, that drift is
 * pre-existing, and inventing a client-side double-write here would make this
 * screen the only place in the app with a different opinion.
 */
export const EDITABLE_JOB_INSURANCE_FIELDS = Object.freeze([
  'insurance_company', 'policy_number', 'claim_number',
]);

/** Trim a string field down to a value or NULL (never an empty string). */
function trimOrNull(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Build the PATCH body for a contact edit.
 *
 * @param {object} form - the edited values, keyed by column
 * @param {object} original - the row as loaded, so unchanged fields are omitted
 * @param {string[]} [allowed] - which columns this form may write
 * @returns {object} the patch — `{}` when nothing actually changed
 */
export function buildContactPatch(form, original = {}, allowed = EDITABLE_CONTACT_FIELDS) {
  const patch = {};
  for (const key of allowed) {
    // Belt and braces: a consent column can never be written even if a caller
    // passes one in `allowed`.
    if (CONSENT_COLUMNS.includes(key)) continue;
    if (!(key in form)) continue;
    const next = key === 'phone' ? (normalizePhone(form[key]) || null) : trimOrNull(form[key]);
    const prev = original[key] == null || original[key] === '' ? null : original[key];
    if (next !== prev) patch[key] = next;
  }
  return patch;
}

/**
 * Build the PATCH body for the job's insurance fields.
 * @param {object} form
 * @param {object} job - the job row as loaded
 * @returns {object}
 */
export function buildJobInsurancePatch(form, job = {}) {
  const patch = {};
  for (const key of EDITABLE_JOB_INSURANCE_FIELDS) {
    if (!(key in form)) continue;
    const next = trimOrNull(form[key]);
    const prev = job[key] == null || job[key] === '' ? null : job[key];
    if (next !== prev) patch[key] = next;
  }
  return patch;
}

/**
 * The job's people, split into "this customer" and "everyone else".
 *
 * The screen is contact-scoped, so the contact in the URL leads even when the
 * job's primary is somebody else — a technician who tapped an adjuster expects
 * the adjuster, not a silent redirect to the homeowner.
 *
 * @param {Array<object>} contacts - get_job_hub's contacts[] (get_job_contacts shape)
 * @param {string} contactId - the contact in the URL
 * @returns {{ current: object|null, others: Array<object> }}
 */
export function splitJobContacts(contacts, contactId) {
  const list = Array.isArray(contacts) ? contacts : [];
  const current = list.find((c) => c.id === contactId) || null;
  const others = list.filter((c) => c.id !== contactId);
  return { current, others };
}

/**
 * Whether a link row may be removed from the job.
 *
 * The primary link is load-bearing elsewhere — the Hub hero reads it for the
 * headline name, and the conversation picker resolves a job's thread through it
 * (primaryJobContactId). Removing it from a phone would quietly break both, so
 * the control is not offered at all rather than offered and refused.
 *
 * @param {object} link - a contact row carrying is_primary
 * @returns {boolean}
 */
export function canRemoveLink(link) {
  return !!link && !link.is_primary;
}

/** A person's role as a label key fragment ('adjuster', 'homeowner', …). */
export function linkRoleOf(contact) {
  if (!contact) return null;
  return contact.role || contact.contact_role || null;
}

/**
 * True when this person is attached to more than the job in front of us, so an
 * edit here changes them everywhere.
 *
 * We cannot count a contact's other jobs from the hub payload, so this keys on
 * the role instead: an adjuster or a property manager is shared by nature, a
 * homeowner or tenant generally is not. It drives a hint, never a block — the
 * office page has the identical global-edit semantics and says nothing at all.
 *
 * @param {object} contact
 * @returns {boolean}
 */
export function isLikelySharedContact(contact) {
  const role = linkRoleOf(contact);
  return role === 'adjuster' || role === 'property_manager' || role === 'agent';
}
