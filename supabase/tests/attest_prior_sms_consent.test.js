/**
 * ════════════════════════════════════════════════
 * FILE: attest_prior_sms_consent.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Reviews the unapplied consent migration as text so its security and audit
 *   promises stay visible in normal tests. It proves browser roles cannot call
 *   the operation, STOP/DND state is never cleared, and the contact update and
 *   consent-history insert live inside the same database transaction.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path, node:url
 *   Internal:  supabase/migrations/20260724014423_attest_prior_sms_consent.sql
 *   Data:      none (the migration is read from disk and is not applied)
 *
 * NOTES / GOTCHAS:
 *   - These are repository contract tests. Representative-role behavior still
 *     requires an isolated database or an owner-authorized post-apply check.
 * ════════════════════════════════════════════════
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  resolve(here, '../migrations/20260724014423_attest_prior_sms_consent.sql'),
  'utf8',
).replace(/\r\n/g, '\n');
const signature = 'public.attest_prior_sms_consent(uuid, uuid, text, date, text, text)';

describe('attest_prior_sms_consent migration contract', () => {
  it('is service-role-only and uses invoker privileges', () => {
    expect(migration).toMatch(/SECURITY INVOKER/i);
    expect(migration).toContain(
      `REVOKE ALL ON FUNCTION ${signature}\n  FROM PUBLIC, anon, authenticated, service_role;`,
    );
    expect(migration).toContain(
      `GRANT EXECUTE ON FUNCTION ${signature}\n  TO service_role;`,
    );
    expect(migration).not.toMatch(
      new RegExp(`GRANT EXECUTE ON FUNCTION ${signature.replace(/[()]/g, '\\$&')}[^;]+TO (?:PUBLIC|anon|authenticated)`, 'i'),
    );
  });

  it('rechecks the active internal admin/office actor in the transaction', () => {
    expect(migration).toContain('v_actor.is_active IS DISTINCT FROM true');
    expect(migration).toContain('v_actor.is_external IS DISTINCT FROM false');
    expect(migration).toContain("v_actor.role::text NOT IN ('admin', 'office')");
    expect(migration).toMatch(/FROM public\.employees[\s\S]+LIMIT 1\s+FOR SHARE;/i);
  });

  it('refuses DND and prior opt-out state without clearing either field', () => {
    expect(migration).toContain('IF v_contact.dnd IS TRUE');
    expect(migration).toContain('IF v_contact.opt_out_at IS NOT NULL');
    expect(migration).toContain('AND dnd IS DISTINCT FROM true');
    expect(migration).toContain('AND opt_out_at IS NULL');
    expect(migration).not.toMatch(/\bSET[\s\S]*\bdnd\s*=\s*false/i);
    expect(migration).not.toMatch(/\bSET[\s\S]*\bopt_out_at\s*=\s*null/i);
  });

  it('records scoped source, consent date, actor, IP, timestamp, and evidence in sms_consent_log', () => {
    expect(migration).toContain("'prior_p2p_consent_attested'");
    expect(migration).toContain("'scope', 'staff_person_to_person'");
    expect(migration).toContain("'consent_obtained_on', p_consent_obtained_on");
    expect(migration).toContain("'evidence_note', v_note");
    expect(migration).toContain('v_actor.id');
    expect(migration).toContain('v_ip_address');
    expect(migration).toContain('ip_address');
    expect(migration).toContain('v_recorded_at');
    expect(migration).toMatch(
      /UPDATE public\.contacts[\s\S]+INSERT INTO public\.sms_consent_log/i,
    );
  });

  it('deduplicates an exact repeated submission without discarding first-time evidence', () => {
    expect(migration).toContain("'evidence_key', v_evidence_key");
    expect(migration).toMatch(/IF NOT EXISTS \([\s\S]+event_type = 'prior_p2p_consent_attested'/i);
    expect(migration).toContain("'audit_recorded', v_audit_recorded");
    expect(migration).not.toMatch(/IF v_contact\.opt_in_status IS TRUE[\s\S]+RETURN/i);
  });

  it('authorizes only person-to-person SMS without widening global opt-in', () => {
    expect(migration).toContain('p2p_sms_consent_at');
    expect(migration).toContain('p2p_sms_consent_source');
    expect(migration).toContain('p2p_sms_consent_phone');
    expect(migration).not.toMatch(/\bSET\s+opt_in_status\s*=\s*true/i);
    expect(migration).not.toMatch(/\bSET[\s\S]*\bopt_in_at\s*=/i);
  });

  it('does not infer permission from contact existence', () => {
    expect(migration).toContain('p_consent_method');
    expect(migration).toContain('p_consent_obtained_on');
    expect(migration).toContain('p_evidence_note');
    expect(migration).toContain('char_length(v_note) < 10');
    expect(migration).not.toContain('contact_exists');
  });
});
