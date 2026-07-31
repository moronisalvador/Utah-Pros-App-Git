/**
 * ════════════════════════════════════════════════
 * FILE: notification-catalog-hardening.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Reads two migrations as text and checks they still say what they are meant
 *   to say. No database needed.
 *
 *   One locks down the list of alert types so nobody can quietly switch off the
 *   system-health warnings. The other makes sure nobody ever gets an email for
 *   every incoming customer text.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path
 *   Internal:  supabase/migrations/20260726210000_notification_types_rpc_only.sql
 *              supabase/migrations/20260726211000_message_inbound_email_not_an_option.sql
 *              + both rollbacks
 *   Data:      reads  → migration + rollback source text
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Proves INTENT, not EFFECT (close-out-standard.md step 2b). The behavioral
 *     JavaScript lane runs against hosted qa-staging; live apply evidence remains
 *     a separate owner-authorized step.
 *   - The service_role assertion is the important one. Revoking service_role by
 *     mistake would silently stop every notification, because
 *     functions/api/notify.js:370 reads this table with the service-role client.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const M = (n) => join(ROOT, 'supabase', 'migrations', n);
const R = (n) => join(ROOT, 'supabase', 'rollbacks', n);

const TYPES_MIG = M('20260726210000_notification_types_rpc_only.sql');
const TYPES_RB = R('20260726210000_notification_types_rpc_only.rollback.sql');
const EMAIL_MIG = M('20260726211000_message_inbound_email_not_an_option.sql');
const EMAIL_RB = R('20260726211000_message_inbound_email_not_an_option.rollback.sql');

/**
 * Executable SQL only, with `--` comment lines stripped.
 *
 * Assertions about what a migration DOES must not read its prose. The evidence
 * block in these headers quotes live values like `push_default=true`, and a
 * naive whole-file match on that string fails against a migration that never
 * touches push at all.
 */
const code = (p) =>
  readFileSync(p, 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();

describe('notification_types RPC-only closure (1.1)', () => {
  const sql = code(TYPES_MIG);

  it('ships with a rollback', () => {
    expect(existsSync(TYPES_MIG)).toBe(true);
    expect(existsSync(TYPES_RB)).toBe(true);
  });

  it('drops the always-true policy and keeps RLS on', () => {
    expect(sql).toContain('drop policy if exists notification_types_all');
    expect(sql).toContain('alter table public.notification_types enable row level security');
  });

  it('revokes browser roles including anon', () => {
    // anon has no policy today, but it holds all 7 privileges — one policy away
    // from live exposure.
    expect(sql).toContain('revoke all on table public.notification_types from public, anon, authenticated');
  });

  it('does NOT revoke service_role — that would silence every notification', () => {
    expect(sql).not.toMatch(/revoke[^;]*service_role/);
  });

  it('rollback restores the prior grants and policy', () => {
    const rb = code(TYPES_RB);
    expect(rb).toContain('grant select, insert, update, delete, references, trigger, truncate on table public.notification_types to anon, authenticated');
    expect(rb).toContain('create policy notification_types_all');
    expect(rb).toContain('using (true) with check (true)');
  });
});

describe('inbound-text email is not an option (owner decision 2026-07-26)', () => {
  const sql = code(EMAIL_MIG);

  it('ships with a rollback', () => {
    expect(existsSync(EMAIL_MIG)).toBe(true);
    expect(existsSync(EMAIL_RB)).toBe(true);
  });

  it('disables AND un-offers the email channel for message.inbound', () => {
    expect(sql).toContain('update public.notification_role_defaults');
    expect(sql).toContain('set enabled = false, user_customizable = false');
    expect(sql).toContain("where type_key = 'message.inbound' and channel = 'email'");
  });

  it('is not scoped to field_tech only, so a future role cannot inherit it', () => {
    // The live landmine was a field_tech row, but scoping the UPDATE to that role
    // would let a later office/PM email row slip through.
    const updateClause = sql.slice(sql.indexOf('update public.notification_role_defaults'));
    expect(updateClause.slice(0, updateClause.indexOf(';'))).not.toContain("role = 'field_tech'");
  });

  it('also pins the catalog default off', () => {
    expect(sql).toContain('update public.notification_types');
    expect(sql).toContain('set email_default = false');
  });

  it('leaves bell and push alone', () => {
    expect(sql).not.toContain("channel = 'push'");
    expect(sql).not.toContain("channel = 'bell'");
    expect(sql).not.toContain('push_default');
    expect(sql).not.toContain('bell_default');
  });
});
