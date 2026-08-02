/**
 * ════════════════════════════════════════════════
 * FILE: notificationPresentation.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves every live notification type has typed native copy, trusted
 *   event-specific variables, generic missing-context fallback, and only
 *   supported field-app routes.
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
  buildGenericNativeNotificationPresentation,
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
  '../../supabase/migrations/20260801163000_technician_quiet_time_and_appointment_reminders.sql',
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

  it('renders approved customer-message details from typed server context', () => {
    const presentation = buildNativeNotificationPresentation(
      'message.inbound',
      {
        presentation_context: {
          sender_name: 'Ada Lovelace',
          message_preview: 'I can meet tomorrow morning.',
        },
        entity_type: 'conversation',
        entity_id: 'conversation-1',
      },
    );

    expect(presentation).toEqual({
      title: 'New text from Ada Lovelace',
      body: 'I can meet tomorrow morning.',
      url: '/tech/conversations?c=conversation-1',
    });
  });

  it('ignores arbitrary producer copy when typed message context is absent', () => {
    const presentation = buildNativeNotificationPresentation('message.inbound', {
      title: 'Forged title for Ada Lovelace',
      body: 'secret recovery token',
      entity_type: 'conversation',
      entity_id: 'conversation-1',
    });

    expect(presentation).toEqual({
      title: 'New customer message',
      body: 'Tap to open the conversation.',
      url: '/tech/conversations?c=conversation-1',
    });
    expect(JSON.stringify(presentation)).not.toContain('Ada Lovelace');
    expect(JSON.stringify(presentation)).not.toContain('secret recovery token');
  });

  it.each([
    ['appointment.assigned', 'New appointment', 'Fri, Jul 31 · 9:00 AM – 11:00 AM'],
    ['appointment.updated', 'Appointment updated', 'Fri, Jul 31 · 9:00 AM – 11:00 AM'],
    ['appointment.canceled', 'Appointment canceled', 'Fri, Jul 31 · 9:00 AM – 11:00 AM'],
    ['appointment.reminder', 'Appointment in one hour', 'Jordan Lee · Fri, Jul 31 · 9:00 AM – 11:00 AM'],
  ])('routes %s to the exact native appointment', (typeKey, title, message) => {
    expect(buildNativeNotificationPresentation(typeKey, {
      appointment_id: 'appt-1',
      presentation_context: {
        appointment_title: 'Moisture check',
        appointment_when: 'Fri, Jul 31 · 9:00 AM – 11:00 AM',
        customer_name: 'Jordan Lee',
      },
    })).toEqual({
      title: `${title} · Moisture check`,
      body: message,
      url: '/tech/appointment/appt-1',
    });
  });

  it('routes a signed document to the native Job Hub', () => {
    expect(buildNativeNotificationPresentation('esign.signed', {
      job_id: 'job-1',
      presentation_context: {
        signer_name: 'Ada Lovelace',
        document_name: 'Work authorization',
        job_number: '123',
      },
    })).toEqual({
      title: 'Ada Lovelace signed Work authorization',
      body: 'Job 123',
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

  it.each([
    ['message.inbound', {
      entity_type: 'conversation',
      entity_id: 'conversation-1',
      presentation_context: {
        sender_name: 'Jordan Lee',
        message_preview: 'I can meet tomorrow morning.',
      },
    }, 'New text from Jordan Lee', 'I can meet tomorrow morning.'],
    ['appointment.assigned', {
      appointment_id: 'appointment-1',
      presentation_context: {
        appointment_title: 'Moisture check',
        appointment_when: 'Fri, Jul 31 · 9:00 AM',
      },
    }, 'New appointment · Moisture check', 'Fri, Jul 31 · 9:00 AM'],
    ['appointment.updated', {
      appointment_id: 'appointment-1',
      presentation_context: {
        appointment_title: 'Moisture check',
        appointment_when: 'Fri, Jul 31 · 10:00 AM',
      },
    }, 'Appointment updated · Moisture check', 'Fri, Jul 31 · 10:00 AM'],
    ['appointment.canceled', {
      appointment_id: 'appointment-1',
      presentation_context: {
        appointment_title: 'Moisture check',
        appointment_when: 'Fri, Jul 31 · 10:00 AM',
      },
    }, 'Appointment canceled · Moisture check', 'Fri, Jul 31 · 10:00 AM'],
    ['appointment.reminder', {
      appointment_id: 'appointment-1',
      presentation_context: {
        appointment_title: 'Moisture check',
        appointment_when: 'Fri, Jul 31 · 9:00 AM – 11:00 AM',
        customer_name: 'Jordan Lee',
      },
    }, 'Appointment in one hour · Moisture check', 'Jordan Lee · Fri, Jul 31 · 9:00 AM – 11:00 AM'],
    ['estimate.accepted', {
      payload: { amount: 1250 },
      presentation_context: {
        estimate_number: 'EST-1042',
        customer_name: 'Jordan Lee',
      },
    }, 'Estimate EST-1042 accepted', '$1,250.00 · Jordan Lee'],
    ['payment.received', {
      payload: {
        amount: 1250,
        source: 'Credit card',
        reference: 'Charge #ch_demo',
      },
      presentation_context: {
        invoice_number: 'INV-1042',
        customer_name: 'Jordan Lee',
        job_number: 'JOB-1042',
      },
    }, 'Payment received', '$1,250.00 from Jordan Lee · Job JOB-1042 · via Credit card'],
    ['lead.new', {
      presentation_context: {
        customer_name: 'Jordan Lee',
        lead_source: 'Website form',
      },
    }, 'New lead · Jordan Lee', 'Source: Website form'],
    ['esign.signed', {
      job_id: 'job-1',
      presentation_context: {
        signer_name: 'Jordan Lee',
        document_name: 'Work authorization',
        job_number: 'JOB-1042',
      },
    }, 'Jordan Lee signed Work authorization', 'Job JOB-1042'],
    ['feedback.submitted', {
      payload: { feedback_type: 'bug report' },
      presentation_context: { employee_name: 'Alex Morgan' },
    }, 'New bug report', 'Submitted by Alex Morgan'],
    ['timesheet.change_requested', {
      presentation_context: { employee_name: 'Alex Morgan' },
    }, 'Timesheet change requested', 'Alex Morgan requested a correction.'],
    ['timesheet.change_reviewed', {
      payload: { approved: true },
    }, 'Timesheet change approved', 'Open Utah Pros to review your request.'],
    ['clock.abandoned', {
      payload: { minutes: 270 },
      presentation_context: { employee_name: 'Alex Morgan' },
    }, 'Clock needs attention', 'Alex Morgan has been clocked in for 4.5 hours.'],
    ['meld.received', {
      entity_id: 'M-1042',
      presentation_context: {
        meld_type: 'Emergency water loss',
        meld_number: 'M-1042',
      },
    }, 'New Emergency water loss meld', 'Meld M-1042'],
    ['feedback.resolved', {
      payload: { feedback_type: 'Bug report' },
    }, 'Bug report resolved', 'Tap to review your feedback.'],
    ['ops.health', {
      payload: {
        condition: 'Notification backlog',
        severity: 'warning',
        count: 3,
      },
    }, 'Ops alert · Notification backlog', 'warning · 3 affected'],
  ])('renders the typed native default for %s', (typeKey, body, title, message) => {
    expect(buildNativeNotificationPresentation(typeKey, body)).toMatchObject({
      title,
      body: message,
    });
  });

  it.each(NATIVE_NOTIFICATION_TYPE_KEYS)(
    'uses the immutable generic native fallback when %s lacks typed context',
    (typeKey) => {
      const body = {
        appointment_id: 'appointment-1',
        entity_type: 'conversation',
        entity_id: 'conversation-1',
        job_id: 'job-1',
      };
      expect(buildNativeNotificationPresentation(typeKey, body))
        .toEqual(buildGenericNativeNotificationPresentation(typeKey, body));
    },
  );

  it('uses immutable generic native copy when a typed code default renders over budget', () => {
    const body = {
      entity_type: 'conversation',
      entity_id: 'conversation-1',
      presentation_context: {
        sender_name: 'A'.repeat(160),
        message_preview: 'B'.repeat(180),
      },
    };

    expect(buildNativeNotificationPresentation('message.inbound', body))
      .toEqual(buildGenericNativeNotificationPresentation('message.inbound', body));
  });
});

describe('admin notification presentation contract', () => {
  it('projects every schema-seeded type with the same approved variables as PWA', () => {
    const catalog = getNotificationPresentationCatalog();

    expect(catalog.map((event) => event.type_key).sort()).toEqual(catalogTypeKeys());
    for (const event of catalog) {
      expect(event.surfaces.native_push.copy_editable).toBe(true);
      expect(event.surfaces.native_push.variables.map(({ key }) => key))
        .toEqual(event.surfaces.pwa_push.variables.map(({ key }) => key));
      expect(event.surfaces.native_push.routes).toHaveLength(1);
      expect(previewNotificationPresentation(
        event.type_key,
        'native_push',
        event.surfaces.native_push.default_config,
      )).toMatchObject({ ok: true });
    }
  });

  it('allows customer name and amount on the typed estimate native surface', () => {
    const estimate = getNotificationPresentationCatalog()
      .find((event) => event.type_key === 'estimate.accepted');
    const variableKeys = estimate.surfaces.bell.variables.map((variable) => variable.key);

    expect(variableKeys).toEqual(expect.arrayContaining([
      'estimate_number',
      'amount',
      'customer_name',
    ]));
    expect(estimate.surfaces.native_push.variables.map(({ key }) => key))
      .toEqual(variableKeys);
  });

  it('offers every trusted appointment value, including customer and financial context, on all surfaces', () => {
    const catalog = getNotificationPresentationCatalog();

    for (const typeKey of [
      'appointment.assigned',
      'appointment.updated',
      'appointment.canceled',
    ]) {
      const appointment = catalog.find((event) => event.type_key === typeKey);
      const variableKeys = appointment.surfaces.bell.variables.map((variable) => variable.key);

      expect(variableKeys).toEqual([
        'customer_name',
        'job_number',
        'appointment_title',
        'appointment_when',
        'job_estimated_amount',
        'job_approved_amount',
        'job_invoiced_amount',
        'job_collected_amount',
      ]);
      expect(appointment.surfaces.pwa_push.variables.map(({ key }) => key))
        .toEqual(variableKeys);
      expect(appointment.surfaces.native_push.variables.map(({ key }) => key))
        .toEqual(variableKeys);
    }
  });

  it('previews customer, job, and financial variables for an appointment', () => {
    expect(previewNotificationPresentation(
      'appointment.assigned',
      'native_push',
      {
        title_template: '{{customer_name}} · {{job_approved_amount}}',
        body_template: 'Job {{job_number}} · {{appointment_when}}',
        route_id: 'appointment.detail',
        contract_version: NOTIFICATION_PRESENTATION_CONTRACT_VERSION,
      },
    )).toEqual({
      ok: true,
      presentation: {
        title: 'Jordan Lee · $7,950.00',
        body: 'Job JOB-1042 · Fri, Jul 31 · 9:00 AM – 11:00 AM',
        url: '/tech/appointment/appointment-demo',
      },
    });
  });

  it('offers distinct invoice and payment references on typed payment surfaces', () => {
    const payment = getNotificationPresentationCatalog()
      .find((event) => event.type_key === 'payment.received');
    const variableKeys = payment.surfaces.bell.variables.map((variable) => variable.key);

    expect(variableKeys).toEqual(expect.arrayContaining([
      'amount',
      'customer_name',
      'job_number',
      'payment_source',
      'invoice_number',
      'payment_reference',
    ]));
    expect(payment.surfaces.native_push.variables.map(({ key }) => key))
      .toEqual(variableKeys);
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

  it('allows typed native copy while keeping its route field-only', () => {
    expect(validateNotificationPresentationConfig(
      'payment.received',
      'native_push',
      {
        title_template: 'Payment for {{invoice_number}}',
        body_template: '{{amount}} via {{payment_source}}',
        route_id: 'field.home',
        contract_version: NOTIFICATION_PRESENTATION_CONTRACT_VERSION,
      },
    )).toMatchObject({ ok: true });
    expect(validateNotificationPresentationConfig(
      'payment.received',
      'native_push',
      {
        title_template: 'Payment for {{invoice_number}}',
        body_template: '{{amount}} via {{payment_source}}',
        route_id: 'invoice.detail',
        contract_version: NOTIFICATION_PRESENTATION_CONTRACT_VERSION,
      },
    )).toEqual({
      ok: false,
      error: 'Route is not allowed for this event and surface',
    });
  });

  it('previews native variables while preserving the native home route', () => {
    expect(previewNotificationPresentation(
      'estimate.accepted',
      'native_push',
      {
        title_template: 'Estimate {{estimate_number}} accepted',
        body_template: '{{customer_name}} approved {{amount}}',
        route_id: 'field.home',
        contract_version: NOTIFICATION_PRESENTATION_CONTRACT_VERSION,
      },
    )).toEqual({
      ok: true,
      presentation: {
        title: 'Estimate EST-1042 accepted',
        body: 'Jordan Lee approved $1,250.00',
        url: '/',
      },
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

  it('renders an invoice number from trusted presentation context', async () => {
    const db = {
      select: async () => [{
        title_template: 'Payment for {{invoice_number}}',
        body_template: '{{amount}} via {{payment_source}}',
        route_id: 'invoice.detail',
        contract_version: NOTIFICATION_PRESENTATION_CONTRACT_VERSION,
      }],
    };
    const fallback = { title: 'Fallback', body: 'Fallback body', url: '/' };

    await expect(resolveConfiguredNotificationPresentation({
      db,
      typeKey: 'payment.received',
      surfaceKey: 'bell',
      body: {
        entity_type: 'invoice',
        entity_id: 'invoice-1',
        payload: { amount: 1250, source: 'Credit card' },
        presentation_context: { invoice_number: 'INV-1001' },
      },
      fallback,
    })).resolves.toEqual({
      title: 'Payment for INV-1001',
      body: '$1,250.00 via Credit card',
      url: '/invoices/invoice-1',
    });
  });

  it('honors a deliberately saved generic native override without content heuristics', async () => {
    const db = {
      select: async () => [{
        title_template: 'Payment received',
        body_template: 'Open Utah Pros to review payment details.',
        route_id: 'field.home',
        contract_version: NOTIFICATION_PRESENTATION_CONTRACT_VERSION,
      }],
    };
    const fallback = buildNativeNotificationPresentation('payment.received', {
      payload: {
        amount: 1250,
        source: 'Credit card',
        reference: 'Charge #ch_demo',
      },
      presentation_context: { invoice_number: 'INV-1001' },
    });

    await expect(resolveConfiguredNotificationPresentation({
      db,
      typeKey: 'payment.received',
      surfaceKey: 'native_push',
      body: {
        payload: {
          amount: 1250,
          source: 'Credit card',
          reference: 'Charge #ch_demo',
        },
        presentation_context: { invoice_number: 'INV-1001' },
      },
      fallback,
    })).resolves.toEqual({
      title: 'Payment received',
      body: 'Open Utah Pros to review payment details.',
      url: '/',
    });
  });

  it('uses immutable generic native copy when a valid override is missing one selected value', async () => {
    const db = {
      select: async () => [{
        title_template: 'Payment for {{invoice_number}}',
        body_template: '{{amount}} via {{payment_source}}',
        route_id: 'field.home',
        contract_version: NOTIFICATION_PRESENTATION_CONTRACT_VERSION,
      }],
    };
    const body = {
      payload: {
        amount: 1250,
        source: 'Credit card',
        reference: 'Charge #ch_demo',
      },
    };
    const richDefault = buildNativeNotificationPresentation('payment.received', body);
    const genericFallback = buildGenericNativeNotificationPresentation('payment.received', body);

    await expect(resolveConfiguredNotificationPresentation({
      db,
      typeKey: 'payment.received',
      surfaceKey: 'native_push',
      body,
      fallback: richDefault,
      renderFailureFallback: genericFallback,
    })).resolves.toEqual(genericFallback);
  });

  it('uses immutable generic native copy when token expansion exceeds the rendered limit', async () => {
    const repeatedPreview = Array(9).fill('{{message_preview}}').join('');
    const db = {
      select: async () => [{
        title_template: 'New text from {{sender_name}}',
        body_template: repeatedPreview,
        route_id: 'conversation.thread',
        contract_version: NOTIFICATION_PRESENTATION_CONTRACT_VERSION,
      }],
    };
    const body = {
      entity_type: 'conversation',
      entity_id: 'conversation-1',
      presentation_context: {
        sender_name: 'Jordan Lee',
        message_preview: '🔒'.repeat(90),
      },
    };
    const richDefault = buildNativeNotificationPresentation('message.inbound', body);
    const genericFallback = buildGenericNativeNotificationPresentation('message.inbound', body);

    await expect(resolveConfiguredNotificationPresentation({
      db,
      typeKey: 'message.inbound',
      surfaceKey: 'native_push',
      body,
      fallback: richDefault,
      renderFailureFallback: genericFallback,
    })).resolves.toEqual(genericFallback);
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
