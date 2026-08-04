/**
 * ════════════════════════════════════════════════
 * FILE: conversation-notification-subscription-foundation.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Reads the new migration as text and checks the safety promises that can run
 *   without database credentials. Database behavior still belongs in the db lane.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path
 *   Internal:  conversation notification foundation migration and rollback
 *   Data:      reads  → migration source files
 *              writes → none
 * ════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');
const migration = read(
  'supabase/migrations/20260803233020_conversation_notification_subscription_foundation.sql',
);
const rollback = read(
  'supabase/rollbacks/20260803233020_conversation_notification_subscription_foundation.rollback.sql',
);
const isolatedProof = read(
  'supabase/tests/conversation_participant_scoping_isolated.sql',
);
const normalized = migration.toLowerCase().replace(/\s+/g, ' ');
const getMembersFunction = normalized.slice(
  normalized.indexOf(
    'create or replace function public.get_conversation_notification_members(',
  ),
  normalized.indexOf(
    'create or replace function public.set_conversation_notification_override(',
  ),
);
const setOverrideFunction = normalized.slice(
  normalized.indexOf(
    'create or replace function public.set_conversation_notification_override(',
  ),
  normalized.indexOf(
    'alter function public.get_conversation_notification_members(uuid)',
  ),
);

describe('conversation notification subscription foundation', () => {
  it('requires the exact participant and unread predecessor train', () => {
    expect(normalized).toContain("'conversation_participant_scoping'");
    expect(normalized).toContain("'conversation_unread_state_compatibility'");
    expect(normalized).toContain(
      "'conversation_assignment_authority_containment'",
    );
    expect(normalized).toContain(
      "'public.get_my_conversation_access_snapshot(uuid[])'",
    );
    expect(normalized).toContain(
      "'public.set_my_conversation_unread_state(uuid[],boolean)'",
    );
  });

  it('keeps access and notification decisions as separate named predicates', () => {
    expect(normalized).toContain(
      'function public.messaging_employee_can_view_conversation(',
    );
    expect(normalized).toContain(
      'function public.messaging_employee_should_notify_for_conversation(',
    );
    expect(normalized).toMatch(
      /conversation\.type = 'direct' and conversation\.status <> 'archived' then true/,
    );
    expect(normalized).toContain(
      'public.messaging_employee_has_conversations_capability(p_employee_id)',
    );
    expect(normalized).toContain("employee.role::text <> 'crm_partner'");
    expect(normalized).toContain(
      'else public.messaging_employee_can_access_conversation(',
    );
    expect(normalized).toMatch(
      /function public\.get_my_conversation_access_snapshot\([\s\S]*public\.messaging_employee_can_view_conversation\(/,
    );
    expect(normalized).toMatch(
      /function public\.set_my_conversation_unread_state\([\s\S]*public\.messaging_employee_can_view_conversation\(/,
    );
  });

  it('keeps private tables forced-RLS and unavailable to browser roles', () => {
    for (const table of [
      'conversation_notification_capability_versions',
      'conversation_notification_subscriptions',
    ]) {
      expect(normalized).toContain(`alter table public.${table} force row level security`);
    }
    expect(normalized).toMatch(
      /revoke all on table public\.conversation_notification_capability_versions, public\.conversation_notification_subscriptions from public, anon, authenticated, service_role/,
    );
    expect(normalized).toMatch(
      /grant select, insert, update, delete on table public\.conversation_notification_capability_versions, public\.conversation_notification_subscriptions to service_role/,
    );
  });

  it('requires the admin actor to retain effective Messages access before reads or writes', () => {
    for (const functionSource of [getMembersFunction, setOverrideFunction]) {
      expect(functionSource).toContain(
        'where employee.auth_user_id = auth.uid() and employee.is_active and not employee.is_external',
      );
      expect(functionSource).toContain(
        'not public.is_active_internal_admin()',
      );
      expect(functionSource).toContain(
        'not public.messaging_employee_can_view_conversation( v_actor_id, p_conversation_id )',
      );
    }

    expect(getMembersFunction.indexOf('employee.auth_user_id = auth.uid()')).toBeLessThan(
      getMembersFunction.indexOf('select coalesce(jsonb_agg('),
    );
    expect(
      getMembersFunction.indexOf(
        'not public.messaging_employee_can_view_conversation(',
      ),
    ).toBeLessThan(getMembersFunction.indexOf('select coalesce(jsonb_agg('));
    expect(setOverrideFunction.indexOf('employee.auth_user_id = auth.uid()')).toBeLessThan(
      setOverrideFunction.indexOf('if p_subscribed is null then'),
    );
    expect(
      setOverrideFunction.indexOf(
        'not public.messaging_employee_can_view_conversation(',
      ),
    ).toBeLessThan(setOverrideFunction.indexOf('if p_subscribed is null then'));
  });

  it('preserves the frozen admin RPC signatures, return type, and browser-only grant', () => {
    expect(getMembersFunction).toMatch(
      /get_conversation_notification_members\( p_conversation_id uuid \) returns jsonb/,
    );
    expect(setOverrideFunction).toMatch(
      /set_conversation_notification_override\( p_conversation_id uuid, p_employee_id uuid, p_subscribed boolean \) returns jsonb/,
    );
    expect(normalized).toMatch(
      /revoke all on function public\.get_conversation_notification_members\(uuid\), public\.set_conversation_notification_override\(uuid, uuid, boolean\) from public, anon, authenticated, service_role; grant execute on function public\.get_conversation_notification_members\(uuid\), public\.set_conversation_notification_override\(uuid, uuid, boolean\) to authenticated;/,
    );
  });

  it('defaults office leaders on, technicians off, and lets an explicit choice win', () => {
    expect(normalized).toMatch(
      /when exists \(select 1 from explicit_choice\) then/,
    );
    expect(normalized).toContain(
      "when actor.role in ( 'admin', 'office', 'project_manager', 'supervisor' ) then true",
    );
    expect(normalized).toMatch(/else false end from actor/);
    expect(normalized).toContain('when not choice.subscribed then false');
    expect(normalized).toContain(
      'when choice.eligibility_version = current_version.version then true',
    );
  });

  it('subscribes only a genuine creator or a durable successful message author', () => {
    expect(normalized).toContain("if v_created then");
    expect(normalized).toContain("'conversation_created'");
    expect(normalized).toContain(
      "new.type = 'internal_note' or ( new.type = 'sms_outbound' and new.status in ('queued', 'sent', 'delivered', 'read')",
    );
    expect(normalized).not.toMatch(
      /new\.type = 'sms_outbound'[\s\S]{0,160}new\.status = 'failed'/,
    );
  });

  it('never overwrites an explicit mute during automatic subscription', () => {
    expect(normalized).toMatch(
      /on conflict \(conversation_id, employee_id\) do update[\s\S]*?where conversation_notification_subscriptions\.subscribed and conversation_notification_subscriptions\.eligibility_version < excluded\.eligibility_version/,
    );
  });

  it('invalidates stale field subscriptions when capability authority changes', () => {
    expect(normalized).toContain(
      'conversation_notification_employee_capability_version',
    );
    expect(normalized).toContain(
      'conversation_notification_page_access_capability_version',
    );
    expect(normalized).toContain(
      'conversation_notification_role_capability_version',
    );
    expect(normalized).toContain(
      'conversation_notification_flag_capability_version',
    );
  });

  it('ships a rollback that restores the previous recipient resolver', () => {
    const rollbackNormalized = rollback.toLowerCase().replace(/\s+/g, ' ');
    expect(rollbackNormalized).toMatch(
      /required order:[\s\S]*31220100 → 31220000[\s\S]*31213100 → 31213000 → 40338 → 40337/,
    );
    expect(rollbackNormalized).toContain(
      'create or replace function public.get_conversation_notification_recipients(',
    );
    expect(rollbackNormalized).toContain(
      'public.messaging_employee_can_access_conversation(',
    );
    expect(rollbackNormalized).toMatch(
      /function public\.get_my_conversation_access_snapshot\([\s\S]*public\.messaging_employee_can_access_conversation\(/,
    );
    expect(rollbackNormalized).toMatch(
      /function public\.set_my_conversation_unread_state\([\s\S]*public\.messaging_employee_can_access_conversation\(/,
    );
    expect(rollbackNormalized).toContain(
      'drop table if exists public.conversation_notification_subscriptions',
    );
    expect(rollbackNormalized).toContain(
      'drop table if exists public.conversation_notification_capability_versions',
    );
  });

  it('has a governed isolated proof for subscription, revocation, and rollback behavior', () => {
    expect(isolatedProof).toContain(
      'opening an existing direct conversation created an implicit subscription',
    );
    expect(isolatedProof).toContain(
      'failed outbound message created a notification subscription',
    );
    expect(isolatedProof).toContain(
      'durable message overwrote an explicit mute',
    );
    expect(isolatedProof).toContain(
      'regrant restored stale technician notification authority',
    );
    expect(isolatedProof).toContain(
      'new durable action did not refresh a regranted technician subscription',
    );
    expect(isolatedProof).toContain(
      'foundation rollback did not restore membership-derived browser access',
    );
    expect(isolatedProof).toContain(
      'admin with employee Messages override disabled cannot clear notification overrides',
    );
    expect(isolatedProof).toContain(
      'globally disabled Messages capability blocks admin notification override deletion',
    );
    expect(isolatedProof).toContain(
      'inactive admin cannot clear notification overrides',
    );
    expect(isolatedProof).toContain(
      'external admin cannot clear notification overrides',
    );
    expect(isolatedProof).toContain(
      '\\ir ../migrations/20260731220000_scheduled_message_delivery_compatibility.sql',
    );
    expect(isolatedProof).toContain(
      '\\ir ../migrations/20260731220100_scheduled_message_delivery_enforcement.sql',
    );
  });

  it('replays every migration as owner before switching to service behavior', () => {
    const notificationApply = isolatedProof.indexOf(
      '\\ir ../migrations/20260803233020_conversation_notification_subscription_foundation.sql',
    );
    const notificationOwnerReset = isolatedProof.lastIndexOf(
      'RESET ROLE;',
      notificationApply,
    );
    const notificationServiceRole = isolatedProof.indexOf(
      'SET LOCAL ROLE service_role;',
      notificationApply,
    );
    expect(notificationOwnerReset).toBeGreaterThanOrEqual(0);
    expect(notificationOwnerReset).toBeLessThan(notificationApply);
    expect(notificationServiceRole).toBeGreaterThan(notificationApply);

    const notificationRollback = isolatedProof.lastIndexOf(
      '\\ir ../rollbacks/20260803233020_conversation_notification_subscription_foundation.rollback.sql',
    );
    const notificationRollbackOwnerReset = isolatedProof.lastIndexOf(
      'RESET ROLE;',
      notificationRollback,
    );
    expect(notificationRollbackOwnerReset).toBeGreaterThanOrEqual(0);
    expect(notificationRollbackOwnerReset).toBeLessThan(notificationRollback);

    const scheduledApply = isolatedProof.indexOf(
      '\\ir ../migrations/20260731220000_scheduled_message_delivery_compatibility.sql',
    );
    const scheduledEnforcement = isolatedProof.indexOf(
      '\\ir ../migrations/20260731220100_scheduled_message_delivery_enforcement.sql',
    );
    const scheduledOwnerReset = isolatedProof.lastIndexOf(
      'RESET ROLE;',
      scheduledApply,
    );
    const serviceRoleInsideScheduledReplay = isolatedProof
      .slice(scheduledOwnerReset, scheduledEnforcement)
      .includes('SET LOCAL ROLE service_role;');
    expect(scheduledOwnerReset).toBeGreaterThanOrEqual(0);
    expect(scheduledOwnerReset).toBeLessThan(scheduledApply);
    expect(scheduledApply).toBeLessThan(scheduledEnforcement);
    expect(serviceRoleInsideScheduledReplay).toBe(false);
  });
});
