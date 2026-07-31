/**
 * ════════════════════════════════════════════════
 * FILE: sms-consent-opt-out-only.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Reads the 2026-07-28 migration and the send paths as TEXT and checks
 *   they still say what they are supposed to say. It proves INTENT, not effect —
 *   it never touches a database. The behavioural proof belongs in
 *   supabase/tests/, which the `db` lane runs and CI does not (close-out
 *   standard §2b).
 *
 *   The point of this file is to catch someone accidentally widening the change
 *   later: the refusals for Do Not Disturb, explicit opt-out and an unfiled STOP
 *   must survive, and the function must stay locked to service_role.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path
 *   Data:      reads → repository source only. No database, no network.
 * ════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const MIGRATION = 'supabase/migrations/20260728000000_sms_consent_opt_out_only.sql';
const ROLLBACK = 'supabase/rollbacks/20260728000000_sms_consent_opt_out_only.rollback.sql';

describe('sms consent: opt-out-only migration source contract', () => {
  const sql = read(MIGRATION);

  it('keeps the frozen signature and does not touch schema', () => {
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.get_service_sms_consent_status(',
    );
    // Additive/body-only: no table or column surgery anywhere in the file.
    expect(sql).not.toMatch(/\bALTER\s+TABLE\b/i);
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN|POLICY)\b/i);
    expect(sql).not.toMatch(/\bCREATE\s+TABLE\b/i);
  });

  it('guards against applying over a drifted live definition', () => {
    expect(sql).toContain('pg_get_functiondef');
    expect(sql).toMatch(/IF\s+md5\(v_definition\)\s*<>/);
    expect(sql).toContain('RAISE EXCEPTION');
  });

  it('still refuses DND, explicit opt-out and an unfiled STOP', () => {
    // Each refusal must still return allowed=false. These are the three the
    // owner explicitly kept on 2026-07-28 — widening past them is the regression
    // this test exists to catch.
    expect(sql).toContain("'code', 'DND_ACTIVE'");
    expect(sql).toContain("'source', 'explicit_opt_out'");
    expect(sql).toContain("'source', 'pending_stop'");
    expect(sql).toMatch(/opt_out_at IS NOT NULL/);
    expect(sql).toMatch(/'stop',\s*'stopall',\s*'unsubscribe'/);
  });

  it('grants the new implied permission under its own distinct code', () => {
    expect(sql).toContain("'code', 'IMPLIED_CONSENT'");
    expect(sql).toContain("'source', 'no_recorded_objection'");
  });

  it('stays service-role-only, revoking before granting', () => {
    const revokeAt = sql.indexOf('REVOKE ALL ON FUNCTION public.get_service_sms_consent_status');
    const grantAt = sql.indexOf('GRANT EXECUTE ON FUNCTION public.get_service_sms_consent_status');
    expect(revokeAt).toBeGreaterThan(-1);
    expect(grantAt).toBeGreaterThan(revokeAt);
    expect(sql).toMatch(/FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/TO service_role/);
    // anon must never be granted execute on the consent decision.
    expect(sql).not.toMatch(/GRANT EXECUTE[^;]*TO[^;]*\banon\b/);
  });

  it('ships a concrete rollback that restores the refusal', () => {
    const rollback = read(ROLLBACK);
    const createAt = rollback.indexOf(
      'CREATE OR REPLACE FUNCTION public.get_service_sms_consent_status(',
    );
    expect(createAt).toBeGreaterThan(-1);
    // Only the restored FUNCTION BODY matters — the header comment legitimately
    // mentions IMPLIED_CONSENT when explaining the faster code-side revert.
    const body = rollback.slice(createAt);
    expect(body).not.toContain('IMPLIED_CONSENT');
    expect(body).toContain("'code', 'NO_CONSENT'");
    expect(rollback).toContain('pg_get_functiondef');
    expect(rollback).toMatch(/md5\(v_definition\)\s*<>/);
    expect(rollback).toContain("ARRAY['postgres', 'service_role']");
    expect(rollback).toContain("has_function_privilege('anon'");
    expect(rollback).toContain("has_function_privilege('authenticated'");
  });
});

describe('sms consent: send-path accepted-code contract', () => {
  const lib = read('functions/lib/sms-consent.js');

  it('keeps implied permission out of generic automated and scheduled sends', () => {
    for (const name of [
      'STAFF_ACCEPTED_CONSENT_CODES',
      'AUTOMATED_ACCEPTED_CONSENT_CODES',
      'SCHEDULED_ACCEPTED_CONSENT_CODES',
      'TRANSACTIONAL_SERVICE_ACCEPTED_CONSENT_CODES',
    ]) {
      const declAt = lib.indexOf(`export const ${name}`);
      expect(declAt).toBeGreaterThan(-1);
      const block = lib.slice(declAt, lib.indexOf(']', declAt));
      if (
        name === 'STAFF_ACCEPTED_CONSENT_CODES'
        || name === 'TRANSACTIONAL_SERVICE_ACCEPTED_CONSENT_CODES'
      ) {
        expect(block).toContain('IMPLIED_CONSENT');
      } else {
        expect(block).not.toContain('IMPLIED_CONSENT');
      }
    }
  });

  it('never accepts permission from a missing or non-allowed status', () => {
    expect(lib).toMatch(/if \(!status \|\| status\.allowed !== true\) return false;/);
  });

  it('keeps staff-only codes out of automated and scheduled traffic', () => {
    // Slice each DECLARATION (not the header mention) so this cannot pass by
    // accidentally inspecting doc text.
    for (const name of ['AUTOMATED_ACCEPTED_CONSENT_CODES', 'SCHEDULED_ACCEPTED_CONSENT_CODES']) {
      const declAt = lib.indexOf(`export const ${name}`);
      expect(declAt).toBeGreaterThan(-1);
      const block = lib.slice(declAt, lib.indexOf(']', declAt));
      expect(block).toContain('GLOBAL_OPT_IN');
      expect(block).not.toContain('SERVICE_CONSENT');
      expect(block).not.toContain('IMPLIED_CONSENT');
    }
  });

  it('keeps the typed service exception in a reviewed registry', () => {
    const purposeAt = lib.indexOf(
      'export const TRANSACTIONAL_SERVICE_SMS_PURPOSES',
    );
    expect(purposeAt).toBeGreaterThan(-1);
    const purposeBlock = lib.slice(purposeAt, lib.indexOf(']', purposeAt));
    expect(purposeBlock).toContain('appointment_scheduled');
    expect(purposeBlock).toContain('appointment_canceled');
    expect(purposeBlock).toContain('signature_request');

    const acceptedAt = lib.indexOf(
      'export const TRANSACTIONAL_SERVICE_ACCEPTED_CONSENT_CODES',
    );
    const acceptedBlock = lib.slice(acceptedAt, lib.indexOf(']', acceptedAt));
    expect(acceptedBlock).toContain('GLOBAL_OPT_IN');
    expect(acceptedBlock).toContain('SERVICE_CONSENT');
    expect(acceptedBlock).toContain('IMPLIED_CONSENT');
  });

  it('does not let the generic automation API assert a service-purpose bypass', () => {
    const generic = read('functions/lib/automated-send.js');
    expect(generic).toContain('AUTOMATED_ACCEPTED_CONSENT_CODES');
    expect(generic).not.toContain('servicePurpose');
    expect(generic).not.toContain('TRANSACTIONAL_SERVICE_ACCEPTED_CONSENT_CODES');
  });

  it('still fails closed locally on no phone, no opt-in, DND and opt-out', () => {
    expect(lib).toContain('if (!row.phone) return false;');
    expect(lib).toContain('if (!row.opt_in_status) return false;');
    expect(lib).toContain('if (row.dnd) return false;');
    expect(lib).toContain('if (row.opt_out_at) return false;');
  });

  it('routes every send path through the shared accepted-code helper', () => {
    for (const path of [
      'functions/api/send-message.js',
      'functions/api/process-scheduled.js',
      'functions/lib/automated-send.js',
    ]) {
      const src = read(path);
      expect(src).toContain('isAcceptedConsent');
      // No path may re-hardcode its own code comparison and drift from the lists.
      expect(src).not.toMatch(/code !== 'GLOBAL_OPT_IN'/);
    }
  });

  it('keeps implied permission out of group and broadcast sends', () => {
    const staffWorker = read('functions/api/send-message.js');
    expect(staffWorker).toContain(
      "STAFF_ACCEPTED_CONSENT_CODES.filter((code) => code === 'GLOBAL_OPT_IN')",
    );
    expect(staffWorker).toContain(
      "conversation.type === 'direct' && participants.length === 1",
    );
    expect(staffWorker).toContain('DIRECT_PURPOSE_UNSUPPORTED');
  });

  it('keeps scheduled compose fail-closed without restoring thread-open preflight', () => {
    const conversations = read('src/pages/Conversations.jsx');
    expect(conversations).toContain(
      "(showSchedule && !hasGlobalSmsPermission)",
    );
    expect(conversations).toContain(
      'Scheduled SMS requires the contact’s full SMS opt-in',
    );
  });
});

describe('sms consent: the client no longer pre-flights', () => {
  it('does not fetch the consent endpoint on thread open', () => {
    for (const path of [
      'src/pages/Conversations.jsx',
      'src/pages/tech/v2/messages/useServiceSmsConsent.js',
    ]) {
      const src = read(path);
      expect(src).not.toMatch(/fetch\(\s*[`'"]\/api\/attest-sms-consent\?/);
    }
  });

  it('keeps a pending STOP unsurfaced in the shared consent selector', () => {
    const utils = read('src/components/conversations/messageUtils.js');
    const branch = utils.slice(utils.indexOf("status.source === 'pending_stop'"));
    // The pending_stop branch must exit with no copy, ahead of the fallback.
    expect(branch.slice(0, 160)).toContain('suppressionCopy = null');
  });
});

describe('sms consent: canonical caller contract', () => {
  it('documents the typed exception, its hard boundary, and current live truth', () => {
    for (const path of [
      '.claude/rules/sms-consent-model.md',
      'docs/database-schema.md',
      'docs/integrations.md',
    ]) {
      const doc = read(path);
      const normalized = doc.replace(/\s+/g, ' ');
      expect(normalized).toContain('appointment_scheduled');
      expect(normalized).toContain('appointment_canceled');
      expect(normalized).toContain('signature_request');
      expect(normalized).toContain('server-owned appointment or signature record');
      expect(normalized).toContain('stable source-record/event delivery identity');
      expect(normalized).toContain('transactional_service_send_allowed');
      expect(normalized).toMatch(
        /No (?:such )?automated producer (?:for these notices )?is live yet/,
      );
      expect(normalized).toContain('Generic automation');
      expect(normalized).toContain('`GLOBAL_OPT_IN`');
    }
  });
});
