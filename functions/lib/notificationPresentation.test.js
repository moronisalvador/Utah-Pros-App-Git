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
  getNotificationPresentationCatalog,
  NATIVE_NOTIFICATION_TYPE_KEYS,
  NOTIFICATION_PRESENTATION_CONTRACT_VERSION,
  previewNotificationPresentation,
  resolveConfiguredNotificationPresentation,
  validateNotificationPresentationConfig,
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

describe('admin notification presentation contract', () => {
  it('projects every schema-seeded type without exposing native variables', () => {
    const catalog = getNotificationPresentationCatalog();

    expect(catalog.map((event) => event.type_key).sort()).toEqual(catalogTypeKeys());
    for (const event of catalog) {
      expect(event.surfaces.native_push.copy_editable).toBe(false);
      expect(event.surfaces.native_push.variables).toEqual([]);
    }
  });

  it('allows customer name and amount only on the typed estimate browser surfaces', () => {
    const estimate = getNotificationPresentationCatalog()
      .find((event) => event.type_key === 'estimate.accepted');
    const variableKeys = estimate.surfaces.bell.variables.map((variable) => variable.key);

    expect(variableKeys).toEqual(expect.arrayContaining([
      'estimate_number',
      'amount',
      'customer_name',
    ]));
    expect(estimate.surfaces.native_push.variables).toEqual([]);
  });

  it.each([
    ['{{payload}}', 'Open details'],
    ['{{customer.name}}', 'Open details'],
    ['{{#if amount}}Paid{{/if}}', 'Open details'],
    ['{{amount', 'Open details'],
  ])('rejects unsafe or malformed template syntax: %s', (title, body) => {
    expect(validateNotificationPresentationConfig(
      'estimate.accepted',
      'bell',
      {
        title_template: title,
        body_template: body,
        route_id: 'estimate.detail',
        contract_version: NOTIFICATION_PRESENTATION_CONTRACT_VERSION,
      },
    )).toMatchObject({ ok: false });
  });

  it('rejects a native copy override even when the route is allowed', () => {
    expect(validateNotificationPresentationConfig(
      'payment.received',
      'native_push',
      {
        title_template: 'Jordan paid $1,250',
        body_template: 'Private reference INV-1042',
        route_id: 'field.home',
        contract_version: NOTIFICATION_PRESENTATION_CONTRACT_VERSION,
      },
    )).toEqual({
      ok: false,
      error: 'Native lock-screen copy is privacy-locked',
    });
  });

  it('previews with synthetic values and a code-resolved route', () => {
    expect(previewNotificationPresentation(
      'estimate.accepted',
      'bell',
      {
        title_template: 'Estimate {{estimate_number}} accepted',
        body_template: '{{customer_name}} approved {{amount}}',
        route_id: 'estimate.detail',
        contract_version: NOTIFICATION_PRESENTATION_CONTRACT_VERSION,
      },
    )).toEqual({
      ok: true,
      presentation: {
        title: 'Estimate EST-1042 accepted',
        body: 'Jordan Lee approved $1,250.00',
        url: '/estimates/estimate-demo',
      },
    });
  });

  it('uses a valid stored override and safely falls back on missing context', async () => {
    const validDb = {
      select: async () => [{
        title_template: 'Payment {{amount}} received',
        body_template: 'Recorded via {{payment_source}}',
        route_id: 'invoice.detail',
        contract_version: NOTIFICATION_PRESENTATION_CONTRACT_VERSION,
      }],
    };
    const fallback = { title: 'Fallback', body: 'Fallback body', url: '/' };

    await expect(resolveConfiguredNotificationPresentation({
      db: validDb,
      typeKey: 'payment.received',
      surfaceKey: 'bell',
      body: {
        entity_type: 'invoice',
        entity_id: 'invoice-1',
        payload: { amount: 1250, source: 'Credit card' },
      },
      fallback,
    })).resolves.toEqual({
      title: 'Payment $1,250.00 received',
      body: 'Recorded via Credit card',
      url: '/invoices/invoice-1',
    });

    await expect(resolveConfiguredNotificationPresentation({
      db: validDb,
      typeKey: 'payment.received',
      surfaceKey: 'bell',
      body: { payload: { amount: 1250 } },
      fallback,
    })).resolves.toEqual(fallback);
  });

  it('falls back without exposing a failed or timed-out configuration lookup', async () => {
    const fallback = { title: 'Fallback', body: 'Fallback body', url: '/' };
    const timedOutDb = {
      select: async () => {
        throw new DOMException('Timed out', 'TimeoutError');
      },
    };

    await expect(resolveConfiguredNotificationPresentation({
      db: timedOutDb,
      typeKey: 'payment.received',
      surfaceKey: 'bell',
      body: {},
      fallback,
    })).resolves.toEqual(fallback);
  });
});
