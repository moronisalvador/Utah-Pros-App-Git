/**
 * ════════════════════════════════════════════════
 * FILE: device-token-apns-topic.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Locks the safety promises of the per-app notification-topic change. It
 *   keeps the change additive, proves the already-shipped app can still call
 *   the registration function, and prevents later edits from exposing tokens
 *   or widening who may call it.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  migration and rollback SQL source, functions/lib/apns.js,
 *              src/lib/pushNotifications.js
 *   Data:      reads  → repository files
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This is the CI-visible SOURCE contract (intent, not live effect). The
 *     behavioral proof runs in the db lane against an isolated database.
 *   - The deployed-caller guarantee is structural: exactly one function of
 *     this name may exist (a second overload makes the shipped two-argument
 *     named-parameter call ambiguous to PostgREST), and every added parameter
 *     must carry a DEFAULT.
 * ════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260730170000_device_token_apns_topic.sql',
  'utf8',
);
const rollback = readFileSync(
  'supabase/rollbacks/20260730170000_device_token_apns_topic.rollback.sql',
  'utf8',
);
const apnsLib = readFileSync('functions/lib/apns.js', 'utf8');
const pushClient = readFileSync('src/lib/pushNotifications.js', 'utf8');
const grantStatements = (sql) => sql.match(/\bGRANT\b[^;]*;/gi) || [];

describe('device token apns topic migration', () => {
  it('adds the column additively and validates it with millisecond locks', () => {
    expect(migration).toContain('ADD COLUMN apns_topic text');
    expect(migration).not.toContain('ADD COLUMN IF NOT EXISTS');
    expect(migration).toContain(') NOT VALID;');
    expect(migration).toContain(
      'VALIDATE CONSTRAINT device_tokens_apns_topic_check',
    );
    expect(migration).not.toMatch(/UPDATE\s+public\.device_tokens/i);
    expect(migration).not.toMatch(/\bDROP\s+(TABLE|COLUMN|POLICY)\b/i);
  });

  it('keeps the deployed two-argument caller resolving after the replace', () => {
    // Exactly one DROP, of the exact prior identity, recreated in the same
    // transactional file — never a second overload.
    const drops = migration.match(/\bDROP FUNCTION\b[^;]*;/gi) || [];
    expect(drops).toHaveLength(1);
    expect(drops[0]).toContain(
      'public.upsert_my_native_device_token(text, text)',
    );
    const signature = migration.match(
      /CREATE FUNCTION public\.upsert_my_native_device_token\(([\s\S]*?)\)\s*RETURNS jsonb/,
    )?.[1] || '';
    expect(signature).toContain('p_token text');
    expect(signature).toContain('p_apns_environment text');
    // Every parameter beyond the shipped two MUST carry a DEFAULT.
    expect(signature).toContain('p_apns_topic text DEFAULT NULL');
    expect(signature).not.toContain('p_employee_id');
    // The postcondition proves the same fact against the live catalog.
    expect(migration).toContain('pronargdefaults = 1');
    expect(migration).toContain('employee.auth_user_id = auth.uid()');
  });

  it('refuses drift: the live body must match the reviewed prior definition', () => {
    expect(migration).toContain("'27cedf4fb5c1a0786b1a29befbbdaadd'");
    expect(migration).toContain(
      'device token apns topic preflight: additive column/constraint already exists',
    );
    expect(migration).toContain(
      'device token apns topic preflight: overload drift',
    );
  });

  it('validates the topic and never lets an old client erase a recorded one', () => {
    expect(migration).toContain(
      "p_apns_topic !~ '^[A-Za-z0-9][A-Za-z0-9.-]{0,254}$'",
    );
    expect(migration).toContain(
      'apns_topic = COALESCE(EXCLUDED.apns_topic, device_tokens.apns_topic)',
    );
  });

  it('returns redacted metadata and stays least-privileged', () => {
    const returned = migration.match(
      /RETURN jsonb_build_object\(([\s\S]*?)\);\s*END;\s*\$function\$;/,
    )?.[1] || '';
    expect(returned).not.toMatch(/['"]token['"]/);
    expect(migration).toContain(
      'REVOKE EXECUTE ON FUNCTION public.upsert_my_native_device_token(text, text, text)\n  FROM PUBLIC, anon, authenticated, service_role;',
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.upsert_my_native_device_token(text, text, text)\n  TO authenticated, service_role;',
    );
    // REVOKE must precede GRANT (the managed project re-grants PUBLIC on
    // every new function at ddl_command_end).
    expect(migration.indexOf('REVOKE EXECUTE ON FUNCTION'))
      .toBeLessThan(migration.indexOf('GRANT EXECUTE ON FUNCTION'));
    expect(grantStatements(migration).join('\n'))
      .not.toMatch(/\bTO\s+(?:PUBLIC|anon)\b/i);
  });

  it('rolls back to the prior body without breaking either deployed caller', () => {
    // Same three-parameter signature (a new client passing the topic keeps
    // enrolling), prior body semantics (topic no longer written or returned).
    expect(rollback).toContain('p_apns_topic text DEFAULT NULL');
    expect(rollback).not.toContain('COALESCE(EXCLUDED.apns_topic');
    expect(rollback).not.toMatch(/'apns_topic',/);
    expect(rollback).not.toMatch(/\bDROP\s+(TABLE|COLUMN|POLICY|CONSTRAINT)\b/i);
    expect(grantStatements(rollback).join('\n'))
      .not.toMatch(/\bTO\s+(?:PUBLIC|anon)\b/i);
    expect(rollback.indexOf('REVOKE EXECUTE ON FUNCTION'))
      .toBeLessThan(rollback.indexOf('GRANT EXECUTE ON FUNCTION'));
  });
});

describe('per-token topic consumers stay legacy-safe', () => {
  it('the delivery worker selects the per-row topic and keeps the env fallback', () => {
    expect(apnsLib).toContain('apns_topic');
    // Legacy rows (NULL topic) must still be addressed with APNS_TOPIC —
    // removing the fallback would silence every pre-migration registration.
    expect(apnsLib).toContain('config.topic');
    expect(apnsLib).toContain("if (!env.APNS_TOPIC) missing.push('APNS_TOPIC');");
  });

  it('the client passes the topic as an OPTIONAL named parameter only', () => {
    expect(pushClient).toContain('p_apns_topic');
    // The client must tolerate an unresolvable bundle id by sending null —
    // never by refusing enrollment (the worker fallback covers NULL rows).
    expect(pushClient).toMatch(/p_apns_topic:\s*\w*[Tt]opic\w*/);
  });
});
