/**
 * ════════════════════════════════════════════════
 * FILE: message-send-attempt-child-fingerprint-key.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks the new database rule that stops the same photo-part from being
 *   written down twice when a technician sends several photos in one go. The
 *   important thing it checks is that the rule is deliberately NARROW: it must
 *   apply only to the photo-split rows and must NOT apply to group texts, where
 *   two different people in the same conversation can legitimately share a phone
 *   number. It also checks the facts elsewhere in the codebase that make that
 *   narrowness safe, so a later edit somewhere else cannot quietly break it.
 *   Reads source files as text; no database required.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path
 *   Internal:  supabase/migrations/20260814190000_message_send_attempt_child_fingerprint_key.sql
 *              supabase/rollbacks/20260814190000_message_send_attempt_child_fingerprint_key.rollback.sql
 *              supabase/migrations/20260723215926_messaging_transport_foundation.sql
 *              supabase/migrations/20260709_sms_f01_drift_capture.sql
 *              functions/lib/messaging-attempts.js, functions/api/send-message.js
 *   Data:      reads  → migration, rollback and application source text
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This proves INTENT, not EFFECT. It cannot tell you the index exists on the
 *     live database — only that the source still asks for the right one. Live
 *     proof is the migration's own preflight guard and postconditions at the
 *     apply window (database-standard.md §5).
 *   - The complementarity case is the point of this file. The forward index and
 *     the foundation's message_send_attempts_parent_recipient_key must partition
 *     the child rows: one owns `recipient_contact_id IS NULL`, the other owns
 *     `IS NOT NULL`. If either predicate drifts they either overlap (harmless)
 *     or leave a gap (a child with no atomic claim — the whole point of the
 *     migration, silently undone).
 *   - conversation_participants.contact_id being NOT NULL is what guarantees a
 *     group child never lands in the new index. It is asserted here because it
 *     lives in a different migration and nothing else would notice it changing.
 *   - CONCURRENTLY is asserted ABSENT on purpose. It cannot run inside a
 *     transaction block, and database-standard.md §5 requires governed migration
 *     files to rely on the Supabase executor's transaction.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const MIGRATION_PATH =
  'supabase/migrations/20260814190000_message_send_attempt_child_fingerprint_key.sql';
const ROLLBACK_PATH =
  'supabase/rollbacks/20260814190000_message_send_attempt_child_fingerprint_key.rollback.sql';
const FOUNDATION_PATH = 'supabase/migrations/20260723215926_messaging_transport_foundation.sql';
const PARTICIPANTS_PATH = 'supabase/migrations/20260709_sms_f01_drift_capture.sql';

const MIGRATION = read(MIGRATION_PATH);
const ROLLBACK = read(ROLLBACK_PATH);
const FOUNDATION = read(FOUNDATION_PATH);
const PARTICIPANTS = read(PARTICIPANTS_PATH);
const ATTEMPTS_LIB = read('functions/lib/messaging-attempts.js');
const SEND_MESSAGE = read('functions/api/send-message.js');

/** Drop `--` line comments so prose can never read as executable SQL. */
const stripComments = (sql) =>
  sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

const MIGRATION_CODE = stripComments(MIGRATION);
const ROLLBACK_CODE = stripComments(ROLLBACK);
const FOUNDATION_CODE = stripComments(FOUNDATION);

const NEW_INDEX = 'message_send_attempts_parent_fingerprint_key';
const SIBLING_INDEX = 'message_send_attempts_parent_recipient_key';

/** The single CREATE UNIQUE INDEX statement, from CREATE through its `;`. */
const indexStatement = (sql, name) => {
  const start = sql.indexOf(`CREATE UNIQUE INDEX ${name}`);
  expect(start, `CREATE UNIQUE INDEX ${name} not found`).toBeGreaterThan(-1);
  const end = sql.indexOf(';', start);
  expect(end, `CREATE UNIQUE INDEX ${name} not terminated`).toBeGreaterThan(start);
  return sql.slice(start, end);
};

const NEW_STATEMENT = indexStatement(MIGRATION_CODE, NEW_INDEX);
const SIBLING_STATEMENT = indexStatement(FOUNDATION_CODE, SIBLING_INDEX);

describe('child send-attempt fingerprint uniqueness — migration shape', () => {
  it('ships a paired rollback (database-standard.md §6)', () => {
    expect(existsSync(join(ROOT, ROLLBACK_PATH))).toBe(true);
  });

  it('creates one partial UNIQUE index on (parent_attempt_id, request_fingerprint)', () => {
    expect(NEW_STATEMENT).toMatch(/ON\s+public\.message_send_attempts\s*\(/);
    expect(NEW_STATEMENT).toMatch(/\(\s*parent_attempt_id\s*,\s*request_fingerprint\s*\)/);
    expect(NEW_STATEMENT).toMatch(/WHERE/);
    // Exactly one index is created by this migration.
    expect(MIGRATION_CODE.match(/CREATE\s+(UNIQUE\s+)?INDEX/gi)).toHaveLength(1);
  });

  it('EXCLUDES contact-bearing children — the narrowing this migration exists for', () => {
    // The load-bearing assertion. Without `recipient_contact_id IS NULL` the
    // index also covers group/broadcast children, whose fingerprints vary only
    // by recipient phone — and two distinct contacts in one conversation may
    // share a number, so a legitimate group send would hit a unique violation.
    expect(NEW_STATEMENT).toMatch(/parent_attempt_id\s+IS\s+NOT\s+NULL/i);
    expect(NEW_STATEMENT).toMatch(/recipient_contact_id\s+IS\s+NULL/i);
    expect(NEW_STATEMENT).not.toMatch(/recipient_contact_id\s+IS\s+NOT\s+NULL/i);
  });

  it('partitions the child rows with the foundation index — no gap, no overlap', () => {
    // The sibling owns children WITH a contact; the new index owns children
    // WITHOUT. If either predicate drifts, some child row ends up with no
    // database-level claim at all, which is precisely what this migration fixes.
    expect(SIBLING_STATEMENT).toMatch(/parent_attempt_id\s+IS\s+NOT\s+NULL/i);
    expect(SIBLING_STATEMENT).toMatch(/recipient_contact_id\s+IS\s+NOT\s+NULL/i);
    expect(SIBLING_STATEMENT).toMatch(/\(\s*parent_attempt_id\s*,\s*recipient_contact_id\s*\)/);
  });

  it('does not drop, rename or replace the foundation index', () => {
    expect(MIGRATION_CODE).not.toMatch(new RegExp(`DROP\\s+INDEX[^;]*${SIBLING_INDEX}`, 'i'));
    expect(MIGRATION_CODE).not.toMatch(/ALTER\s+INDEX/i);
    expect(MIGRATION_CODE).toContain(SIBLING_INDEX); // asserted alive in postconditions
  });

  it('is additive-only (database-standard.md §3)', () => {
    expect(MIGRATION_CODE).not.toMatch(/DROP\s+(TABLE|COLUMN|POLICY|TRIGGER|FUNCTION)/i);
    expect(MIGRATION_CODE).not.toMatch(/\bRENAME\b/i);
    expect(MIGRATION_CODE).not.toMatch(/ALTER\s+COLUMN/i);
    expect(MIGRATION_CODE).not.toMatch(/\b(INSERT|UPDATE|DELETE)\s+(INTO|FROM|public\.)/i);
    // No grant surface change: this table is service-role-only.
    expect(MIGRATION_CODE).not.toMatch(/\bGRANT\b/i);
    expect(MIGRATION_CODE).not.toMatch(/\banon\b/i);
  });

  it('does not use CONCURRENTLY or open its own transaction', () => {
    // CREATE INDEX CONCURRENTLY cannot run inside a transaction block, and §5
    // requires governed files to rely on the executor's transaction.
    expect(MIGRATION_CODE).not.toMatch(/CONCURRENTLY/i);
    expect(MIGRATION_CODE).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im);
    // Fail fast rather than queue behind a long transaction on a live table.
    expect(MIGRATION_CODE).toMatch(/SET\s+LOCAL\s+lock_timeout/i);
  });
});

describe('child send-attempt fingerprint uniqueness — apply-time proof', () => {
  it('refuses to apply if a duplicate already exists', () => {
    // This session could not query the shared project, so the "no existing row
    // violates it" check is enforced mechanically at apply time instead of
    // being claimed here.
    expect(MIGRATION_CODE).toMatch(/GROUP\s+BY\s+parent_attempt_id\s*,\s*request_fingerprint/i);
    expect(MIGRATION_CODE).toMatch(/HAVING\s+count\(\*\)\s*>\s*1/i);
    expect(MIGRATION_CODE).toMatch(/RAISE\s+EXCEPTION/i);
    expect(MIGRATION_CODE).toMatch(/ERRCODE\s*=\s*'55000'/);
    // The guard must scope to the same set the index covers, or it proves nothing.
    const guard = MIGRATION_CODE.slice(
      MIGRATION_CODE.indexOf('DO $guard$'),
      MIGRATION_CODE.indexOf('$guard$;'),
    );
    expect(guard).toMatch(/recipient_contact_id\s+IS\s+NULL/i);
    expect(guard).toMatch(/parent_attempt_id\s+IS\s+NOT\s+NULL/i);
  });

  it('asserts its own postconditions', () => {
    const post = MIGRATION_CODE.slice(MIGRATION_CODE.indexOf('DO $post$'));
    expect(post).toMatch(/indisunique/);
    expect(post).toMatch(/indpred/); // partial, not full-table
    expect(post).toMatch(/recipient_contact_id IS NULL/);
    expect(post).toContain(SIBLING_INDEX); // sibling survives
  });
});

describe('child send-attempt fingerprint uniqueness — rollback', () => {
  it('drops exactly the new index and preserves the foundation sibling', () => {
    expect(ROLLBACK_CODE).toMatch(
      new RegExp(`DROP\\s+INDEX\\s+IF\\s+EXISTS\\s+public\\.${NEW_INDEX}`, 'i'),
    );
    expect(ROLLBACK_CODE.match(/DROP\s+INDEX/gi)).toHaveLength(1);
    expect(ROLLBACK_CODE).not.toMatch(new RegExp(`DROP\\s+INDEX[^;]*${SIBLING_INDEX}`, 'i'));
    // And says so in its own postcondition, rather than only in prose.
    expect(ROLLBACK_CODE).toContain(SIBLING_INDEX);
    expect(ROLLBACK_CODE).toMatch(/ERRCODE\s*=\s*'55000'/);
  });

  it('carries the destructive-approved marker the hygiene gate requires', () => {
    expect(ROLLBACK).toMatch(/--\s*destructive-approved:/i);
  });
});

describe('the caller invariants that make the narrow predicate safe', () => {
  it('claimChildMessageAttempt is the only producer of child attempt rows', () => {
    // If a second producer appears it must be re-checked against both indexes.
    expect(ATTEMPTS_LIB).toMatch(/parent_attempt_id:\s*parentAttemptId/);
    const callers = SEND_MESSAGE.match(/claimChildMessageAttempt\(/g) || [];
    expect(callers.length).toBe(2); // the split loop and the group loop
  });

  it('the split loop claims its parts with a NULL recipient_contact_id', () => {
    // This is what puts split children inside the new index. If a caller starts
    // passing a contact id here, its parts move into the per-contact sibling
    // index instead — where only ONE child per contact is admitted, so every
    // part after the first would be rejected.
    // `completeMessageAttempt` is also called earlier in the file (the single
    // send path), so the closing anchor must be searched FROM the loop start —
    // a bare indexOf finds the earlier one and yields an empty slice that
    // passes nothing and fails everything.
    const splitStart = SEND_MESSAGE.indexOf(
      "provider === 'callrail' && (media_urls?.length || 0) > 1",
    );
    expect(splitStart, 'split loop not found').toBeGreaterThan(-1);
    const splitEnd = SEND_MESSAGE.indexOf('await completeMessageAttempt', splitStart);
    expect(splitEnd, 'split loop end not found').toBeGreaterThan(splitStart);
    const splitLoop = SEND_MESSAGE.slice(splitStart, splitEnd);
    expect(splitLoop).toMatch(/recipientContactId:\s*null/);
    expect(splitLoop).toMatch(/partIndex,/);
  });

  it('partIndex is what distinguishes one split part from another', () => {
    // The fingerprint is the part's stable content-derived identity. Remove
    // partIndex from it and two parts of an identical photo set would hash the
    // same, turning this index from a guard into a false refusal.
    expect(ATTEMPTS_LIB).toMatch(/partIndex:\s*command\.partIndex/);
  });

  it('group children always carry a contact, so they never enter the new index', () => {
    // conversation_participants.contact_id is NOT NULL, and the group loop
    // passes participant.contact_id straight through. That — not the fingerprint
    // — is what keeps duplicate-phone group sends out of this index.
    expect(PARTICIPANTS).toMatch(/contact_id\s+uuid\s+NOT NULL/);
    expect(SEND_MESSAGE).toMatch(/recipientContactId:\s*participant\.contact_id/);
  });

  it('the multi-photo send still requires a client_request_id', () => {
    // The serialization this index is defence-in-depth for. If this refusal is
    // ever relaxed, the index below becomes the only remaining guard — which is
    // the entire reason it exists.
    expect(SEND_MESSAGE).toMatch(/CLIENT_REQUEST_ID_REQUIRED/);
  });
});
