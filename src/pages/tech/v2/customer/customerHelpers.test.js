/**
 * ════════════════════════════════════════════════
 * FILE: customerHelpers.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the rules behind the field customer screen. Most of these are about
 *   what a save is NOT allowed to do: it may never touch the record of whether a
 *   customer agreed to be texted, and it may never send a field the technician
 *   did not change.
 *
 * NOTES / GOTCHAS:
 *   - The consent cases are the point of this file. AGENTS.md §14 makes consent
 *     the highest-consequence code in the repository, and TCPA penalties are per
 *     message — a stray `opt_in_status` write from a phone is not a cosmetic bug.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import {
  buildContactPatch,
  buildJobInsurancePatch,
  splitJobContacts,
  canRemoveLink,
  isLikelySharedContact,
  CONSENT_COLUMNS,
  EDITABLE_CONTACT_FIELDS,
  EDITABLE_CONTACT_INSURANCE_FIELDS,
} from './customerHelpers.js';

describe('buildContactPatch — consent columns', () => {
  const original = { name: 'Ana', phone: '+18015550100', opt_in_status: false, dnd: false };

  it('never emits a consent column, even when the form carries one', () => {
    const form = {
      name: 'Ana Reyes',
      opt_in_status: true,
      opt_out_at: null,
      dnd: true,
      dnd_reason: 'nope',
    };
    const patch = buildContactPatch(form, original);
    expect(patch).toEqual({ name: 'Ana Reyes' });
    for (const column of CONSENT_COLUMNS) {
      expect(patch).not.toHaveProperty(column);
    }
  });

  it('refuses a consent column even if a caller passes one in `allowed`', () => {
    // Belt and braces: the guard is in the loop, not only in the default list,
    // so a future caller cannot widen its way past it.
    const patch = buildContactPatch(
      { opt_in_status: true, name: 'Ana Reyes' },
      original,
      ['name', 'opt_in_status'],
    );
    expect(patch).toEqual({ name: 'Ana Reyes' });
  });

  it('has no consent column in either editable list', () => {
    for (const field of [...EDITABLE_CONTACT_FIELDS, ...EDITABLE_CONTACT_INSURANCE_FIELDS]) {
      expect(CONSENT_COLUMNS).not.toContain(field);
    }
  });
});

describe('buildContactPatch — what actually changed', () => {
  const original = { name: 'Ana', phone: '+18015550100', email: 'a@x.com', company: null };

  it('omits fields the technician did not change', () => {
    const patch = buildContactPatch(
      { name: 'Ana', phone: '(801) 555-0100', email: 'a@x.com', company: '' },
      original,
    );
    // Two people editing one shared adjuster must not clobber each other's
    // untouched fields.
    expect(patch).toEqual({});
  });

  it('normalizes a typed phone to the stored form before comparing', () => {
    const patch = buildContactPatch({ phone: '801-555-0199' }, original);
    expect(patch).toEqual({ phone: '+18015550199' });
  });

  it('clears a field to NULL, never to an empty string', () => {
    const patch = buildContactPatch({ email: '   ' }, original);
    expect(patch).toEqual({ email: null });
  });

  it('treats an original empty string as already-null', () => {
    expect(buildContactPatch({ company: '' }, { company: '' })).toEqual({});
  });
});

describe('buildJobInsurancePatch', () => {
  const job = { insurance_company: 'State Farm', policy_number: 'P-1', claim_number: null };

  it('sends only the changed insurance columns', () => {
    const patch = buildJobInsurancePatch(
      { insurance_company: 'State Farm', policy_number: 'P-2', claim_number: 'C-9' },
      job,
    );
    expect(patch).toEqual({ policy_number: 'P-2', claim_number: 'C-9' });
  });

  it('cannot write anything outside the three job insurance columns', () => {
    const patch = buildJobInsurancePatch(
      { insurance_company: 'Allstate', phase: 'completed', deductible: 0, total: 1 },
      job,
    );
    expect(patch).toEqual({ insurance_company: 'Allstate' });
  });
});

describe('splitJobContacts', () => {
  const contacts = [
    { id: 'c1', link_id: 'l1', is_primary: true, name: 'Ana' },
    { id: 'c2', link_id: 'l2', role: 'adjuster', name: 'Bo' },
  ];

  it('leads with the contact in the URL, not the job primary', () => {
    // A tech who tapped the adjuster expects the adjuster, not a silent
    // redirect to the homeowner.
    const { current, others } = splitJobContacts(contacts, 'c2');
    expect(current.name).toBe('Bo');
    expect(others.map((c) => c.id)).toEqual(['c1']);
  });

  it('returns a null current when the contact is not on this job', () => {
    const { current, others } = splitJobContacts(contacts, 'c9');
    expect(current).toBeNull();
    expect(others).toHaveLength(2);
  });

  it('survives a missing contacts array', () => {
    expect(splitJobContacts(undefined, 'c1')).toEqual({ current: null, others: [] });
  });
});

describe('canRemoveLink', () => {
  it('never offers Remove on the primary link', () => {
    // The Hub hero reads it for the headline name and the conversation picker
    // resolves a job's thread through it — detaching it from a phone would
    // quietly break both.
    expect(canRemoveLink({ link_id: 'l1', is_primary: true })).toBe(false);
  });

  it('offers Remove on any other link', () => {
    expect(canRemoveLink({ link_id: 'l2', is_primary: false })).toBe(true);
    expect(canRemoveLink({ link_id: 'l3' })).toBe(true);
  });
});

describe('isLikelySharedContact', () => {
  it('flags the roles that are shared by nature', () => {
    expect(isLikelySharedContact({ role: 'adjuster' })).toBe(true);
    expect(isLikelySharedContact({ contact_role: 'property_manager' })).toBe(true);
  });

  it('does not flag a homeowner', () => {
    expect(isLikelySharedContact({ role: 'primary_client' })).toBe(false);
    expect(isLikelySharedContact(null)).toBe(false);
  });
});
