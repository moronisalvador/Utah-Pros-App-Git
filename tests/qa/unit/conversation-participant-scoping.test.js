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
 *              supabase/migrations/20260731213000_conversation_assignment_authority_containment.sql
 *              supabase/migrations/20260731213100_conversation_participant_policy_enforcement.sql
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
const ASSIGNMENT_CONTAINMENT = path.join(
  ROOT,
  'supabase/migrations/20260731213000_conversation_assignment_authority_containment.sql',
);
const ASSIGNMENT_CONTAINMENT_ROLLBACK = path.join(
  ROOT,
  'supabase/rollbacks/20260731213000_conversation_assignment_authority_containment.rollback.sql',
);
const ENFORCEMENT = path.join(
  ROOT,
  'supabase/migrations/20260731213100_conversation_participant_policy_enforcement.sql',
);
const ENFORCEMENT_ROLLBACK = path.join(
  ROOT,
  'supabase/rollbacks/20260731213100_conversation_participant_policy_enforcement.rollback.sql',
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
  const assignmentContainmentRaw = read(ASSIGNMENT_CONTAINMENT);
  const enforcementRaw = read(ENFORCEMENT);
  const raw = `${foundationRaw}\n${compatibilityRaw}\n${assignmentContainmentRaw}\n${enforcementRaw}`;
  const sql = norm(stripComments(raw));
  const assignmentSql = norm(stripComments(assignmentContainmentRaw));
  const memberAccess = functionBody(
    assignmentSql,
    'messaging_employee_can_access_conversation',
  );
  const capability = functionBody(sql, 'messaging_employee_has_conversations_capability');
  const scopedCreation = functionBody(
    assignmentSql,
    'find_or_create_scoped_conversation',
  );
  const scopedContactSearch = functionBody(
    assignmentSql,
    'search_scoped_conversation_contacts',
  );
  const memberDirectory = functionBody(assignmentSql, 'get_conversation_members');
  const notificationRecipients = functionBody(
    sql,
    'get_conversation_notification_recipients',
  );
  const techInbox = functionBody(sql, 'get_tech_conversations');
  const messageAuthors = functionBody(sql, 'get_message_author_directory');
  const accessSnapshot = functionBody(sql, 'get_my_conversation_access_snapshot');
  const authorizedMessageMedia = functionBody(
    sql,
    'messaging_get_authorized_message_media',
  );

  it('ships a paired rollback and required migration header', () => {
    expect(existsSync(MIGRATION)).toBe(true);
    expect(existsSync(ROLLBACK)).toBe(true);
    expect(existsSync(COMPATIBILITY)).toBe(true);
    expect(existsSync(COMPATIBILITY_ROLLBACK)).toBe(true);
    expect(existsSync(ASSIGNMENT_CONTAINMENT)).toBe(true);
    expect(existsSync(ASSIGNMENT_CONTAINMENT_ROLLBACK)).toBe(true);
    expect(existsSync(ENFORCEMENT)).toBe(true);
    expect(existsSync(ENFORCEMENT_ROLLBACK)).toBe(true);
    expect(raw).toContain('WHAT THIS DOES');
    expect(raw).toContain('ADDITIVE-ONLY');
    expect(raw).toContain('ROLLBACK:');
  });

  it('stages compatible RPCs and trusted assignment correction before policy enforcement', () => {
    const foundationSql = norm(stripComments(foundationRaw));
    const compatibilitySql = norm(stripComments(compatibilityRaw));
    const correctionSql = norm(stripComments(assignmentContainmentRaw));
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
    expect(correctionSql).toContain(
      "where migration.name = 'conversation_participant_scoping'",
    );
    expect(correctionSql).toContain(
      "where migration.name = 'conversation_unread_state_compatibility'",
    );
    expect(correctionSql).toContain(
      'create or replace function public.messaging_employee_can_access_conversation',
    );
    expect(enforcementSql).toContain(
      "where migration.name = 'conversation_assignment_authority_containment'",
    );
    expect(enforcementSql).toContain(
      'alter policy allow_authenticated_conversations on public.conversations to authenticated',
    );
    expect(enforcementSql).toContain(
      'using (public.messaging_can_access_conversation(id)) with check (false)',
    );
    expect(enforcementSql).toContain(
      'revoke all on table public.conversations, public.conversation_participants, public.messages from public, anon, authenticated',
    );
    expect(enforcementSql).toContain(
      'grant select on table public.conversations, public.conversation_participants, public.messages to authenticated',
    );
    expect(authorizedMessageMedia).toContain('security definer');
    expect(authorizedMessageMedia).toContain("auth.role() <> 'service_role'");
    expect(authorizedMessageMedia).toContain(
      'messaging_employee_can_access_conversation',
    );
    expect(enforcementSql).toContain(
      'revoke all on function public.messaging_get_authorized_message_media(uuid, uuid) from public, anon, authenticated, service_role',
    );
    expect(enforcementSql).toContain(
      'grant execute on function public.messaging_get_authorized_message_media(uuid, uuid) to service_role',
    );
    expect(norm(stripComments(read(ENFORCEMENT_ROLLBACK)))).toContain(
      'public.messaging_get_authorized_message_media(uuid, uuid) from public, anon, authenticated, service_role',
    );
    expect(enforcementSql).toContain("policy.cmd = 'all'");
    expect(enforcementSql).not.toContain('drop policy');
    expect(enforcementSql).toContain("policy.roles = array['authenticated']::name[]");
    expect(enforcementSql).toContain(
      "has_table_privilege('authenticated', v_table, v_privilege)",
    );
  });

  it('fails closed when any extra permissive policy would broaden a protected conversation table', () => {
    const enforcementSql = norm(stripComments(enforcementRaw));
    const isolatedRaw = read(
      path.join(ROOT, 'supabase/tests/conversation_participant_scoping_isolated.sql'),
    );
    const expectedPolicies = [
      ['conversations', 'allow_authenticated_conversations'],
      ['conversation_participants', 'allow_authenticated_conversation_participants'],
      ['messages', 'messages_authenticated_select'],
    ];
    const policiesWithInjectedTrueRead = [
      ...expectedPolicies,
      ['messages', 'cps_isolated_unexpected_authenticated_read'],
    ];

    // The isolated suite creates this extra USING (true) policy. Postgres ORs
    // permissive policies, so the migration must reject the four-policy drift
    // baseline rather than merely alter its three named policies.
    expect(policiesWithInjectedTrueRead).toHaveLength(4);
    expect(enforcementSql).toContain('into v_policy_count from pg_catalog.pg_policies policy');
    expect(enforcementSql).toContain("policy.tablename in ( 'conversations', 'conversation_participants', 'messages' )");
    expect(enforcementSql).toContain('if v_policy_count <> 3');
    expect(enforcementSql).toContain(
      "raise exception 'conversation policy enforcement: deployed policy/acl baseline drifted'",
    );
    expect(enforcementSql).toContain(
      "raise exception 'conversation policy enforcement: exhaustive policy postcondition failed'",
    );
    expect(isolatedRaw).toContain(
      'CREATE POLICY cps_isolated_unexpected_authenticated_read',
    );
    expect(isolatedRaw).toContain('SAVEPOINT cps_before_unexpected_policy_apply');
    expect(isolatedRaw).toContain(
      'authorized media lookup returned metadata outside strict membership',
    );
    expect(isolatedRaw).toContain(
      'browser cannot call the service-only authorized media lookup',
    );
    expect(isolatedRaw).toContain(
      '\\ir ../rollbacks/20260731213100_conversation_participant_policy_enforcement.rollback.sql',
    );
    expect(isolatedRaw).toContain(
      '\\ir ../migrations/20260731213100_conversation_participant_policy_enforcement.sql',
    );
    expect(isolatedRaw).toContain('\\set cps_enforcement_apply_failed :ERROR');
    expect(isolatedRaw).toContain('ROLLBACK TO SAVEPOINT cps_before_expected_enforcement_error');
    expect(isolatedRaw).toContain('ROLLBACK TO SAVEPOINT cps_before_unexpected_policy_apply');
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

  it('never trusts browser-writable appointment, job, or claim records as membership', () => {
    for (const body of [
      memberAccess,
      memberDirectory,
      scopedCreation,
      scopedContactSearch,
    ]) {
      expect(body).not.toMatch(
        /\b(?:appointment_crew|appointments|jobs|claims)\b/,
      );
    }
    expect(assignmentSql).toContain(
      "array['employees_self_identity_read']::text[]",
    );
    expect(assignmentSql).toContain(
      "has_table_privilege('authenticated', 'public.employees', 'update')",
    );
    expect(assignmentSql).toContain(
      "md5(replace(procedure.prosrc, chr(13), ''))",
    );
    expect(assignmentSql).toContain(
      'browser-writable assignment source remains',
    );
  });

  it('gives role safety and manual override precedence over default membership', () => {
    const privilegedAt = memberAccess.indexOf("employee_row.role in ('admin', 'office', 'project_manager', 'supervisor')");
    const partnerAt = memberAccess.indexOf("employee_row.role = 'crm_partner'");
    const manualAt = memberAccess.indexOf('exists (select 1 from manual_choice)');
    const defaultAt = memberAccess.indexOf('from public.conversation_default_members default_member');

    expect(privilegedAt).toBeGreaterThanOrEqual(0);
    expect(partnerAt).toBeGreaterThan(privilegedAt);
    expect(manualAt).toBeGreaterThan(partnerAt);
    expect(defaultAt).toBeGreaterThan(manualAt);
    expect(memberAccess).toContain('then (select included from manual_choice)');
    expect(memberAccess).toContain('else false');
    expect(memberDirectory).not.toContain("then 'appointment'");
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
    expect(sql).toContain('revoke all on table public.conversations, public.conversation_participants, public.messages from public, anon, authenticated');
    expect(sql).toContain('grant select on table public.conversations, public.conversation_participants, public.messages to authenticated');
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
    read(ASSIGNMENT_CONTAINMENT_ROLLBACK),
    read(COMPATIBILITY_ROLLBACK),
    read(ROLLBACK),
  ].join('\n');
  const sql = norm(stripComments(raw));

  it('preserves administrator choices and never restores browser-writable authority', () => {
    expect(norm(raw)).toContain('participant choices');
    expect(norm(raw)).toContain('never restored as authorization evidence');
    expect(norm(raw)).toContain('fails closed');
    expect(sql).not.toContain('drop table if exists public.conversation_member_overrides');
    expect(sql).not.toContain('drop table if exists public.conversation_default_members');
    expect(sql).not.toContain('grant all on table public.conversations, public.conversation_participants to authenticated');
  });

  it('uses a fail-closed table and policy recovery posture', () => {
    expect(sql).toContain('alter policy allow_authenticated_conversations on public.conversations to authenticated using (false) with check (false)');
    expect(sql).toContain('alter policy allow_authenticated_conversation_participants on public.conversation_participants to authenticated using (false) with check (false)');
    expect(sql).toContain('alter policy messages_authenticated_select on public.messages to authenticated using (false)');
    expect(sql).toContain('from public, anon, authenticated, service_role');
    expect(sql).toContain('to service_role');
    expect(sql).toContain('fail-closed acl postcondition failed');
    expect(sql).not.toContain('using (true) with check (true)');
    expect(sql).toContain('drop function if exists public.set_my_conversation_unread_state(uuid[], boolean)');
    expect(sql).toContain('drop function if exists public.get_my_conversation_access_snapshot(uuid[])');
  });

  it('pauses every browser-facing inbox, author, and participant RPC', () => {
    expect(sql).toContain('public.get_conversation_members(uuid)');
    expect(sql).toContain('public.set_conversation_member_override(uuid, uuid, boolean)');
    expect(sql).toContain('public.set_default_conversation_member(uuid, boolean)');
    expect(sql).toContain('public.get_message_author_directory(uuid[])');
    expect(sql).toContain('public.get_tech_conversations( integer, timestamp with time zone, uuid, text, text, uuid )');
    expect(sql).toContain('from public, anon, authenticated, service_role');
    expect(sql).toContain('recovery rpc remains executable');
    expect(sql).not.toContain('grant execute on function public.get_tech_conversations');
  });

  it('accepts retained scheduled evidence only after delivery is paused', () => {
    expect(sql).toContain("to_regclass('public.scheduled_message_creation_provenance') is not null");
    expect(sql).toContain("has_function_privilege('service_role', v_function, 'execute')");
    expect(sql).toContain("status = 'pending'");
    expect(sql).toContain('delivery_attempt_id is not null');
    expect(sql).toContain('scheduled delivery recovery posture is not sealed');
  });

  it('accepts the frozen legacy claim only as a harmless invoker no-op', () => {
    for (const rollback of [
      ENFORCEMENT_ROLLBACK,
      ASSIGNMENT_CONTAINMENT_ROLLBACK,
      ROLLBACK,
    ]) {
      const rollbackSql = norm(stripComments(read(rollback)));
      expect(rollbackSql).toContain(
        "procedure.oid = to_regprocedure( 'public.claim_scheduled_message(uuid)' )",
      );
      expect(rollbackSql).toContain('and not procedure.prosecdef');
      expect(rollbackSql).toContain(
        "procedure.prolang = ( select language.oid from pg_catalog.pg_language language where language.lanname = 'plpgsql' )",
      );
      expect(rollbackSql).toContain(
        "procedure.proowner = 'postgres'::regrole",
      );
      expect(rollbackSql).toContain("procedure.provolatile = 'v'");
      expect(rollbackSql).toContain("procedure.proparallel = 'u'");
      expect(rollbackSql).toContain(
        "procedure.proconfig = array['search_path=pg_catalog, public']::text[]",
      );
      expect(rollbackSql).toContain(
        "lower( btrim( regexp_replace( v_legacy_claim_source, '[[:space:]]+', ' ', 'g' ) ) ) <> 'begin return false; end;'",
      );
      expect(rollbackSql).toContain(
        "not has_function_privilege( 'authenticated', 'public.claim_scheduled_message(uuid)', 'execute' )",
      );
      expect(rollbackSql).toContain(
        "has_function_privilege( 'anon', 'public.claim_scheduled_message(uuid)', 'execute' )",
      );
      expect(rollbackSql).toContain(
        "not has_function_privilege( 'service_role', 'public.claim_scheduled_message(uuid)', 'execute' )",
      );
    }
  });

  it('keeps assignment recovery privileged-only and excludes forged sources', () => {
    const access = functionBody(sql, 'messaging_employee_can_access_conversation');
    expect(access).toContain("'admin', 'office', 'project_manager', 'supervisor'");
    expect(access).not.toMatch(/\b(?:appointment_crew|appointments|jobs|claims)\b/);
    expect(norm(raw)).toContain('participant editor/contact-opening surfaces');
    expect(sql).toContain('internal recovery helper unavailable');
  });
});
