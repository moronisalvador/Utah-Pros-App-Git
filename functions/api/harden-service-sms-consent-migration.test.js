import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function migration(name) {
  return readFileSync(fileURLToPath(new URL(
    `../../supabase/migrations/${name}`,
    import.meta.url,
  )), 'utf8').replace(/\r\n/g, '\n');
}

const foundation = migration('20260724014423_attest_prior_sms_consent.sql');
const hardening = migration('20260724043000_harden_service_sms_consent.sql');

function md5(value) {
  return createHash('md5').update(value).digest('hex');
}

function guardedSourceMatches(definition, expectedHash, expectedBytes, needles) {
  if (md5(definition) !== expectedHash || Buffer.byteLength(definition) !== expectedBytes) return false;
  return needles.every((needle) => definition.split(needle).length - 1 === 1);
}

describe('service-SMS consent hardening migration contract', () => {
  it('patches both exact live function definitions and fails on source drift', () => {
    expect(hardening.match(/pg_get_functiondef\(/g)).toHaveLength(2);
    expect(hardening).toContain("md5(v_status_definition) <> '891963fb670ffffc47652154b2181c02'");
    expect(hardening).toContain('octet_length(v_status_definition) <> 4470');
    expect(hardening).toContain("md5(v_attest_definition) <> 'a579ea7ed3a1a97b45e5256e13e821a4'");
    expect(hardening).toContain('octet_length(v_attest_definition) <> 7721');
    expect(hardening.match(/\/ length\(v_needle\) <> 1 THEN/g)).toHaveLength(7);
    expect(hardening).toContain('status phone-lock patch did not match reviewed foundation');
    expect(hardening).toContain('attestation phone-lock patch did not match reviewed foundation');
    expect(hardening).toContain('status STOP chronology patch did not match reviewed foundation');
    expect(hardening).toContain('attestation STOP chronology patch did not match reviewed foundation');
  });

  it('rejects non-anchor drift and duplicate patch anchors', () => {
    const reviewed = 'reviewed definition with one PATCH anchor';
    const hash = md5(reviewed);
    const bytes = Buffer.byteLength(reviewed);
    expect(guardedSourceMatches(reviewed, hash, bytes, ['PATCH'])).toBe(true);
    expect(guardedSourceMatches(
      reviewed.replace('definition', 'definitioN'),
      hash,
      bytes,
      ['PATCH'],
    )).toBe(false);
    expect(guardedSourceMatches(`${reviewed} PATCH`, hash, bytes, ['PATCH'])).toBe(false);
  });

  it('pins and revalidates the contact phone after the advisory boundary', () => {
    expect(hardening).toContain('v_locked_phone_key <> v_phone_key');
    expect(hardening).toContain("''code'', ''CONTACT_PHONE_CHANGED''");
    expect(hardening).toContain("E'  WHERE id = p_contact_id\\n'");
    expect(hardening).toContain("E'  FOR SHARE;\\n\\n'");
    expect(hardening).toContain("E'  FOR UPDATE;\\n\\n'");
  });

  it('holds the authorizing employee row against concurrent role revocation', () => {
    expect(hardening).toContain("v_needle := E'  WHERE id = p_actor_id\\n  LIMIT 1;'");
    expect(hardening).toContain("E'  WHERE id = p_actor_id\\n  LIMIT 1\\n  FOR SHARE;'");
    expect(hardening).toContain('attestation actor-lock patch must match exactly once');
  });

  it('lets only a strictly later processed START supersede pending STOP', () => {
    expect(hardening).toContain('later_event.occurred_at > e.occurred_at');
    expect(hardening).not.toContain('later_event.occurred_at >= e.occurred_at');
    expect(hardening).toContain("later_event.processing_state = ''processed''");
    expect(hardening).toContain(
      "ARRAY[''start'', ''unstop'', ''subscribe'', ''yes'']",
    );
  });

  it('matches both pending-STOP tails in the applied foundation source', () => {
    const target = [
      "      AND regexp_replace(lower(trim(COALESCE(e.content, ''))), '[^a-z0-9]', '', 'g')",
      "        = ANY (ARRAY['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit'])",
      '  ) THEN',
    ].join('\n');
    expect(foundation.split(target)).toHaveLength(3);
  });

  it('reasserts invoker rights, empty search paths, and service-only execution', () => {
    expect(hardening.match(/SECURITY INVOKER/g)).toHaveLength(2);
    expect(hardening.match(/SET search_path = ''/g)).toHaveLength(2);
    expect(hardening.match(/FROM PUBLIC, anon, authenticated, service_role;/g)).toHaveLength(2);
    expect(hardening.match(/TO service_role;/g)).toHaveLength(2);
  });
});
