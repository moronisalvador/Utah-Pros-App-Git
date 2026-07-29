/**
 * ════════════════════════════════════════════════
 * FILE: notificationPresentation.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves every live notification type has explicit privacy-conscious native
 *   copy and that only supported field-app routes are selected.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./notificationPresentation.js
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - These are pure tests. No provider, database, or real employee is used.
 * ════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildNativeNotificationPresentation,
  NATIVE_NOTIFICATION_TYPE_KEYS,
} from './notificationPresentation.js';

const CATALOG_MIGRATIONS = [
  '../../supabase/migrations/20260703_notify_f2_foundation.sql',
  '../../supabase/migrations/20260708_meld_received_notification_type.sql',
  '../../supabase/migrations/20260714_feedback_resolved_notification_type.sql',
  '../../supabase/migrations/20260725190000_ops_health_alerting.sql',
];

function catalogTypeKeys() {
  const keys = CATALOG_MIGRATIONS.flatMap((relativePath) => {
    const sql = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
    return [...sql.matchAll(
      /\(\s*'([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)'\s*,/g,
    )].map((match) => match[1]);
  });
  return [...new Set(keys)].sort();
}

describe('native notification presentation catalog', () => {
  it('has one explicit presentation for every schema-seeded notification type', () => {
    expect([...NATIVE_NOTIFICATION_TYPE_KEYS].sort())
      .toEqual(catalogTypeKeys());
  });

  it('keeps customer-message content and identifiers off the lock screen', () => {
    const presentation = buildNativeNotificationPresentation(
      'message.inbound',
      {
        title: 'New text from Ada Lovelace',
        body: 'My claim number is 01742 and my phone is +18015550123',
        entity_type: 'conversation',
        entity_id: 'conversation-1',
      },
    );

    expect(presentation).toEqual({
      title: 'New customer message',
      body: 'Tap to open the conversation.',
      url: '/tech/conversations?c=conversation-1',
    });
    expect(JSON.stringify(presentation)).not.toContain('Ada Lovelace');
    expect(JSON.stringify(presentation)).not.toContain('01742');
    expect(JSON.stringify(presentation)).not.toContain('+18015550123');
  });

  it.each([
    ['appointment.assigned', 'New appointment'],
    ['appointment.updated', 'Appointment updated'],
    ['appointment.canceled', 'Appointment canceled'],
  ])('routes %s to the exact native appointment', (typeKey, title) => {
    expect(buildNativeNotificationPresentation(typeKey, {
      appointment_id: 'appt-1',
      body: 'Ada Lovelace · +18015550123 · 1 Main Street',
    })).toEqual({
      title,
      body: typeKey === 'appointment.updated'
        ? 'Tap to review the changes.'
        : 'Tap to review the appointment.',
      url: '/tech/appointment/appt-1',
    });
  });

  it('routes a signed document to the native Job Hub', () => {
    expect(buildNativeNotificationPresentation('esign.signed', {
      job_id: 'job-1',
      title: 'Ada signed the work authorization',
      body: 'Job 123 · 1 Main Street',
    })).toEqual({
      title: 'Document signed',
      body: 'Tap to open the job.',
      url: '/tech/job/job-1',
    });
  });

  it('keeps office-only event destinations at the native home fallback', () => {
    for (const typeKey of [
      'estimate.accepted',
      'payment.received',
      'lead.new',
      'feedback.submitted',
      'timesheet.change_requested',
      'timesheet.change_reviewed',
      'clock.abandoned',
      'meld.received',
      'ops.health',
    ]) {
      expect(buildNativeNotificationPresentation(typeKey, {
        link: '/untrusted-office-path',
        data: { url: '/tech/appointment/forged' },
      }).url).toBe('/');
    }
  });

  it('falls back safely for an unknown future event', () => {
    expect(buildNativeNotificationPresentation('future.unknown', {
      title: 'Forged title',
      body: 'Forged body',
      link: '/tech/appointment/forged',
    })).toEqual({
      title: 'Utah Pros notification',
      body: 'Open Utah Pros for details.',
      url: '/',
    });
  });

  it('keeps the owner diagnostic presentation fixed and field-safe', () => {
    expect(buildNativeNotificationPresentation('owner.native_push_test', {
      title: 'Arbitrary title',
      body: 'Private body',
      data: { url: '/admin' },
    })).toEqual({
      title: 'UPR notifications are ready',
      body: 'This iPhone can receive UPR alerts.',
      url: '/tech/settings',
    });
  });
});
