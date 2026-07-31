/**
 * ════════════════════════════════════════════════
 * FILE: conversation-participant-scoping.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Reads the participant-controls database change as text and checks that it
 *   keeps customer conversations limited to the right staff members. It also
 *   checks that a matching undo file restores the earlier behavior.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path
 *   Internal:  supabase/migrations/20260731040337_conversation_participant_scoping.sql
 *              supabase/migrations/20260731040338_conversation_unread_state_compatibility.sql
 *              supabase/migrations/20260731040339_conversation_participant_policy_enforcement.sql
 *              supabase/rollbacks/20260731040337_conversation_participant_scoping.rollback.sql
 *   Data:      reads  → migration and rollback source text
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This is CI-visible source-contract coverage for an authored migration. It
 *     proves intended safeguards, not that a shared database has been changed.
 *   - The behavioural database lane must run only against an isolated local or
 *     staging database during the approved apply window.
 * ════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MIGRATION = path.join(
  ROOT,
  'supabase/migrations/20260731040337_conversation_participant_scoping.sql',
);
const ROLLBACK = path.join(
  ROOT,
  'supabase/rollbacks/20260731040337_conversation_participant_scoping.rollback.sql',
);
const COMPATIBILITY = path.join(
  ROOT,
  'supabase/migrations/20260731040338_conversation_unread_state_compatibility.sql',
);
const COMPATIBILITY_ROLLBACK = path.join(
  ROOT,
  'supabase/rollbacks/20260731040338_conversation_unread_state_compatibility.rollback.sql',
);
const ENFORCEMENT = path.join(
  ROOT,
  'supabase/migrations/20260731040339_conversation_participant_policy_enforcement.sql',
);
const ENFORCEMENT_ROLLBACK = path.join(
  ROOT,
  'supabase/rollbacks/20260731040339_conversation_participant_policy_enforcement.rollback.sql',
);

const read = (file) => readFileSync(file, 'utf8');
const norm = (sql) => sql.replace(/\s+/g, ' ').toLowerCase();
const stripComments = (sql) => sql.replace(/--[^\n]*/g, '');
const functionBody = (sql, name) => {
  const start = Math.max(
    sql.indexOf(`create or replace function public.${name}`),
    sql.indexOf(`create function public.${name}`),
  );
  expect(start, `missing ${name}`).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf('$function$;', start);
  expect(end, `unterminated ${name}`).toBeGreaterThan(start);
  return sql.slice(start, end);
};

describe('conversation participant scoping — migration source contract', () => {
  const foundationRaw = read(MIGRATION);
  const compatibilityRaw = read(COMPATIBILITY);
  const enforcementRaw = read(ENFORCEMENT);
  const raw = `${foundationRaw}\n${compatibilityRaw}\n${enforcementRaw}`;
  const sql = norm(stripComments(raw));
  const memberAccess = functionBody(sql, 'messaging_employee_can_access_conversation');
  const capability = functionBody(sql, 'messaging_employee_has_conversations_capability');
  const scopedCreation = functionBody(sql, 'find_or_create_scoped_conversation');
  const scopedContactSearch = functionBody(sql, 'search_scoped_conversation_contacts');
  const notificationRecipients = functionBody(
    sql,
    'get_conversation_notification_recipients',
  );
  const techInbox = functionBody(sql, 'get_tech_conversations');
  const messageAuthors = functionBody(sql, 'get_message_author_directory');
  const accessSnapshot = functionBody(sql, 'get_my_conversation_access_snapshot');

  it('ships a paired rollback and required migration header', () => {
    expect(existsSync(MIGRATION)).toBe(true);
    expect(existsSync(ROLLBACK)).toBe(true);
    expect(existsSync(COMPATIBILITY)).toBe(true);
    expect(existsSync(COMPATIBILITY_ROLLBACK)).toBe(true);
    expect(existsSync(ENFORCEMENT)).toBe(true);
    expect(existsSync(ENFORCEMENT_ROLLBACK)).toBe(true);
    expect(raw).toContain('WHAT THIS DOES');
    expect(raw).toContain('ADDITIVE-ONLY');
    expect(raw).toContain('ROLLBACK:');
  });

  it('stages compatible RPCs before the later browser policy enforcement', () => {
    const foundationSql = norm(stripComments(foundationRaw));
    const compatibilitySql = norm(stripComments(compatibilityRaw));
    const enforcementSql = norm(stripComments(enforcementRaw));
    expect(foundationSql).toContain(
      'create or replace function public.find_or_create_scoped_conversation',
    );
    expect(foundationSql).toContain(
      'create or replace function public.search_scoped_conversation_contacts',
    );
    expect(foundationSql).not.toContain('revoke insert on table public.conversations');
    expect(foundationSql).not.toContain('alter policy allow_authenticated_conversations');
    expect(compatibilitySql).toContain(
      'create function public.set_my_conversation_unread_state',
    );
    expect(compatibilitySql).toContain(
      'grant execute on function public.set_my_conversation_unread_state(uuid[], boolean) to authenticated',
    );
    expect(enforcementSql).toContain(
      'alter policy allow_authenticated_conversations on public.conversations to authenticated',
    );
    expect(enforcementSql).toContain(
      'using (public.messaging_can_access_conversation(id)) with check (false)',
    );
    expect(enforcementSql).toContain(
      'revoke all on table public.conversations, public.conversation_participants from public, anon, authenticated',
    );
    expect(enforcementSql).toContain(
      'grant select on table public.conversations, public.conversation_participants to authenticated',
    );
    expect(enforcementSql).toContain("policy.cmd = 'all'");
    expect(enforcementSql).not.toContain('drop policy');
    expect(enforcementSql).toContain("policy.roles = array['authenticated']::name[]");
    expect(enforcementSql).toContain(
      "has_table_privilege( 'authenticated', 'public.conversations', 'insert' )",
    );
  });

  it('stores manual decisions and defaults in RLS-forced, browser-inaccessible tables', () => {
    for (const table of [
      'conversation_member_overrides',
      'conversation_default_members',
    ]) {
      expect(sql).toContain(`create table public.${table}`);
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`alter table public.${table} force row level security`);
      expect(sql).toContain(`revoke all on table public.${table} from public, anon, authenticated`);
      expect(sql).toContain(`create policy ${table}_service_role_all on public.${table}`);
    }
    expect(sql).toContain('primary key (conversation_id, employee_id)');
    expect(sql).toContain('grant select, insert, update, delete on table public.conversation_member_overrides, public.conversation_default_members to service_role');
  });

  it('uses the approved historical appointment-to-contact path', () => {
    expect(memberAccess).toContain('from public.appointment_crew crew');
    expect(memberAccess).toContain('join public.appointments appointment on appointment.id = crew.appointment_id');
    expect(memberAccess).toContain('join public.jobs job on job.id = appointment.job_id');
    expect(memberAccess).toContain('left join public.claims claim on claim.id = job.claim_id');
    expect(memberAccess).toContain('participant.contact_id = coalesce(job.primary_contact_id, claim.contact_id)');
    expect(memberAccess).toContain('participant.is_active');
    expect(memberAccess).toContain('participant.removed_at is null');
    expect(memberAccess).not.toMatch(/appointment\.(starts_at|ends_at|scheduled_at|date)/);
  });

  it('gives role safety and a manual override precedence over default and appointment membership', () => {
    const privilegedAt = memberAccess.indexOf("employee_row.role in ('admin', 'office', 'project_manager', 'supervisor')");
    const partnerAt = memberAccess.indexOf("employee_row.role = 'crm_partner'");
    const manualAt = memberAccess.indexOf('exists (select 1 from manual_choice)');
    const defaultAt = memberAccess.indexOf('from public.conversation_default_members default_member');
    const appointmentAt = memberAccess.indexOf('from public.appointment_crew crew');

    expect(privilegedAt).toBeGreaterThanOrEqual(0);
    expect(partnerAt).toBeGreaterThan(privilegedAt);
    expect(manualAt).toBeGreaterThan(partnerAt);
    expect(defaultAt).toBeGreaterThan(manualAt);
    expect(appointmentAt).toBeGreaterThan(defaultAt);
    expect(memberAccess).toContain('then (select included from manual_choice)');
  });

  it('scopes conversations, external participants, and individual messages through one predicate', () => {
    expect(sql).toContain(
      'alter policy allow_authenticated_conversations on public.conversations to authenticated using (public.messaging_can_access_conversation(id)) with check (false)',
    );
    expect(sql).toContain('using (public.messaging_can_access_conversation(id))');
    expect(sql).toContain(
      'alter policy allow_authenticated_conversation_participants on public.conversation_participants to authenticated using (public.messaging_can_access_conversation(conversation_id)) with check (false)',
    );
    expect(sql).toContain('using (public.messaging_can_access_conversation(conversation_id))');
    expect(sql).toContain('alter policy messages_authenticated_select');
    expect(sql).toContain('public.messaging_can_access_conversations() and public.messaging_can_access_conversation(conversation_id)');
    expect(sql).toContain('revoke all on table public.conversations, public.conversation_participants from public, anon, authenticated');
    expect(sql).toContain('grant select on table public.conversations, public.conversation_participants to authenticated');
    expect(sql).not.toContain('grant update (unread_count)');
  });

  it('keeps notification delivery aligned with both page capability and membership', () => {
    expect(capability).toContain("page_access.nav_key = 'conversations'");
    expect(capability).toContain("flag.key = 'page:conversations'");
    expect(capability).toContain('employee.is_active');
    expect(capability).toContain('not employee.is_external');
    expect(notificationRecipients).toContain(
      'messaging_employee_has_conversations_capability(employee.id)',
    );
    expect(notificationRecipients).toContain(
      'messaging_employee_can_access_conversation( employee.id, p_conversation_id )',
    );
  });

  it('uses a service-only atomic creation boundary that cannot open an unassigned thread', () => {
    expect(scopedCreation).toContain("current_user <> 'service_role'");
    expect(scopedCreation).toContain(
      'messaging_employee_has_conversations_capability(p_employee_id)',
    );
    expect(scopedCreation).toContain(
      'messaging_employee_can_access_conversation( p_employee_id, v_existing_conversation_id )',
    );
    expect(scopedCreation).toContain(
      'v_conversation := public.find_or_create_conversation(p_contact_id)',
    );
    expect(scopedCreation).toContain(
      'messaging_employee_can_access_conversation( p_employee_id, v_conversation_id )',
    );
  });

  it('keeps the contact picker minimal, bounded, and scoped before returning PII', () => {
    expect(scopedContactSearch).toContain("current_user <> 'service_role'");
    expect(scopedContactSearch).toContain(
      'messaging_employee_has_conversations_capability(p_employee_id)',
    );
    expect(scopedContactSearch).toContain('returns table ( id uuid, name text, phone text, company text )');
    expect(scopedContactSearch).toContain('least(greatest(coalesce(p_limit, 25), 1), 25)');
    expect(scopedContactSearch).toContain(
      'messaging_employee_can_access_conversation( p_employee_id, conversation.id )',
    );
    expect(scopedContactSearch).not.toMatch(/\b(?:email|dnd|auth_user_id)\b/);
  });

  it('scopes the inbox page, unread badge, and status counts instead of filtering only visible rows', () => {
    expect(techInbox).toContain('from public.conversations c where public.messaging_can_access_conversation(c.id)');
    expect(techInbox).toContain('from public.conversations conversation where public.messaging_can_access_conversation(conversation.id)');
    expect(techInbox).toContain('from public.conversations c where public.messaging_can_access_conversation(c.id)');
  });

  it('returns a bounded actor-derived access snapshot without revealing nonexistent ids', () => {
    expect(accessSnapshot).toContain('auth.uid()');
    expect(accessSnapshot).toContain('employee.is_active');
    expect(accessSnapshot).toContain('not employee.is_external');
    expect(accessSnapshot).toContain('messaging_employee_has_conversations_capability(v_actor_id)');
    expect(accessSnapshot).toContain('cardinality(p_conversation_ids) > 200');
    expect(accessSnapshot).toContain('requested.conversation_id is null');
    expect(accessSnapshot).toContain('from unnest(p_conversation_ids) requested(conversation_id)');
    expect(accessSnapshot).toContain('join public.conversations conversation');
    expect(accessSnapshot).toContain('messaging_employee_can_access_conversation( v_actor_id, conversation.id )');
    expect(accessSnapshot).toContain('select distinct conversation.id');
    expect(accessSnapshot).not.toContain("auth.role() = 'service_role'");
  });

  it('resolves authors for every authored message through the same per-conversation gate', () => {
    expect(messageAuthors).toContain("auth.role() = 'service_role'");
    expect(messageAuthors).toContain('public.messaging_can_access_conversations()');
    expect(messageAuthors).toContain('message.sent_by is not null');
    expect(messageAuthors).toContain('public.messaging_can_access_conversation(message.conversation_id)');
    expect(messageAuthors).not.toContain("message.type = 'internal_note'");
    expect(messageAuthors).toContain('cardinality(p_message_ids) > 200');
    expect(messageAuthors).toContain('id uuid, full_name text, display_name text');
    expect(messageAuthors).not.toMatch(/\b(?:email|phone|auth_user_id|hourly_rate|commission_percent)\b/);
  });

  it('keeps membership helpers least-privilege and revokes PUBLIC before grants', () => {
    const functions = [
      ['messaging_employee_has_conversations_capability(uuid)', 'service_role'],
      ['messaging_employee_can_access_conversation(uuid, uuid)', 'service_role'],
      ['messaging_can_access_conversation(uuid)', 'authenticated, service_role'],
      ['get_conversation_members(uuid)', 'authenticated, service_role'],
      ['set_conversation_member_override(uuid, uuid, boolean)', 'authenticated, service_role'],
      ['set_default_conversation_member(uuid, boolean)', 'authenticated, service_role'],
      ['leave_conversation(uuid)', 'authenticated, service_role'],
      ['get_my_conversation_access_snapshot(uuid[])', 'authenticated, service_role'],
      ['set_my_conversation_unread_state(uuid[], boolean)', 'authenticated, service_role'],
      ['find_or_create_scoped_conversation(uuid, uuid)', 'service_role'],
      ['search_scoped_conversation_contacts(uuid, text, integer)', 'service_role'],
      ['get_conversation_notification_recipients(uuid)', 'service_role'],
      ['get_message_author_directory(uuid[])', 'authenticated, service_role'],
    ];

    for (const [signature, grantee] of functions) {
      const revokeAt = sql.indexOf(`revoke all on function public.${signature} from public, anon`);
      const grantAt = sql.indexOf(`grant execute on function public.${signature} to ${grantee}`);
      expect(revokeAt, `missing PUBLIC revoke for ${signature}`).toBeGreaterThanOrEqual(0);
      expect(grantAt, `missing intended grant for ${signature}`).toBeGreaterThan(revokeAt);
    }

    const grants = stripComments(raw).match(/grant[^;]+;/gi) || [];
    for (const grant of grants) {
      expect(norm(grant)).not.toContain(' anon');
      expect(norm(grant)).not.toContain(' to public');
    }
  });

  it('allows a current non-privileged internal member to leave, but never a privileged role', () => {
    const leave = functionBody(sql, 'leave_conversation');
    expect(leave).toContain('auth.uid()');
    expect(leave).toContain('employee.is_active');
    expect(leave).toContain('not employee.is_external');
    expect(leave).toContain("v_actor.role::text in ( 'admin', 'office', 'project_manager', 'supervisor', 'crm_partner' )");
    expect(leave).toContain('cannot leave a conversation');
    expect(leave).toContain('messaging_can_access_conversation(p_conversation_id)');
    expect(leave).toContain('included');
    expect(leave).toContain('false');
  });
});

describe('conversation participant scoping — rollback source contract', () => {
  const raw = [
    read(ENFORCEMENT_ROLLBACK),
    read(COMPATIBILITY_ROLLBACK),
    read(ROLLBACK),
  ].join('\n');
  const sql = norm(stripComments(raw));

  it('warns that rollback discards administrator participant choices', () => {
    expect(norm(raw)).toContain('permanently discards');
    expect(norm(raw)).toContain('technician choice');
  });

  it('restores the prior broad authenticated policies and message read contract', () => {
    expect(sql).toContain('alter policy allow_authenticated_conversations on public.conversations to authenticated using (true) with check (true)');
    expect(sql).toContain('alter policy allow_authenticated_conversation_participants on public.conversation_participants to authenticated using (true) with check (true)');
    expect(sql).toContain('alter policy messages_authenticated_select on public.messages to authenticated using (public.messaging_can_access_conversations())');
    expect(sql).toContain('grant all on table public.conversations, public.conversation_participants to authenticated');
    expect(sql).toContain('drop function if exists public.set_my_conversation_unread_state(uuid[], boolean)');
    expect(sql).toContain('drop function if exists public.get_my_conversation_access_snapshot(uuid[])');
  });

  it('restores the unscoped prior inbox function and its browser grants', () => {
    const inbox = functionBody(sql, 'get_tech_conversations');
    expect(inbox).toContain('from public.conversations c ),');
    expect(inbox).toContain('from public.conversations;');
    expect(inbox).not.toContain('messaging_can_access_conversation');
    expect(sql).toContain('grant execute on function public.get_tech_conversations(int, timestamptz, uuid, text, text, uuid) to authenticated, service_role');
  });

  it('restores the exact earlier internal-note-only author lookup', () => {
    const authors = functionBody(sql, 'get_message_author_directory');
    expect(authors).toContain("auth.jwt() ->> 'role' = 'service_role'");
    expect(authors).toContain("message.type = 'internal_note'");
    expect(authors).not.toContain('messaging_can_access_conversation(message.conversation_id)');
    expect(sql).toContain('alter function public.get_message_author_directory(uuid[]) owner to postgres');
    expect(sql).toContain('grant execute on function public.get_message_author_directory(uuid[]) to authenticated, service_role');
  });

  it('drops functions before the new state tables in dependency-safe order', () => {
    const helperAt = sql.indexOf('drop function if exists public.messaging_employee_can_access_conversation(uuid, uuid)');
    const capabilityAt = sql.indexOf('drop function if exists public.messaging_employee_has_conversations_capability(uuid)');
    const scopedCreationAt = sql.indexOf('drop function if exists public.find_or_create_scoped_conversation(uuid, uuid)');
    const leaveAt = sql.indexOf('drop function if exists public.leave_conversation(uuid)');
    const overridesAt = sql.indexOf('drop table if exists public.conversation_member_overrides');
    const defaultsAt = sql.indexOf('drop table if exists public.conversation_default_members');
    expect(leaveAt).toBeGreaterThanOrEqual(0);
    expect(scopedCreationAt).toBeGreaterThanOrEqual(0);
    expect(helperAt).toBeGreaterThanOrEqual(0);
    expect(helperAt).toBeGreaterThan(leaveAt);
    expect(capabilityAt).toBeGreaterThan(helperAt);
    expect(overridesAt).toBeGreaterThan(capabilityAt);
    expect(defaultsAt).toBeGreaterThan(capabilityAt);
  });
});
