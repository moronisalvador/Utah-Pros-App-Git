/**
 * ════════════════════════════════════════════════
 * FILE: notificationPresentation.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Converts each trusted notification event into privacy-conscious iPhone
 *   lock-screen copy and one field-app destination. This is deliberately a
 *   typed catalog: arbitrary caller copy and arbitrary paths never flow
 *   directly into APNs.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - PWA/bell/email keep their richer server-derived copy. Native lock screens
 *     use this smaller disclosure budget because they are visible while locked.
 *   - Unsupported office-only destinations return `/`; the native app is still
 *     field-only. The APNs layer performs the final route allowlist validation.
 *   - Keep this registry exhaustive with notification_types. A new event safely
 *     falls back to generic copy and `/` until it receives an explicit entry.
 * ════════════════════════════════════════════════
 */

const GENERIC_TITLE = 'Utah Pros notification';
const GENERIC_BODY = 'Open Utah Pros for details.';
const MAX_ALERT_TITLE_LENGTH = 80;
const MAX_ALERT_BODY_LENGTH = 180;

function cleanText(value, fallback, maxLength) {
  if (typeof value !== 'string') return fallback;
  let printable = '';
  for (const character of value) {
    const code = character.charCodeAt(0);
    printable += code <= 31 || code === 127 ? ' ' : character;
  }
  const cleaned = printable
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return fallback;
  return cleaned.slice(0, maxLength);
}

function appointmentRoute(body) {
  const appointmentId = body.appointment_id
    || (body.entity_type === 'appointment' ? body.entity_id : null);
  return appointmentId ? `/tech/appointment/${appointmentId}` : '/tech/schedule';
}

function conversationRoute(body) {
  const conversationId = body.data?.conversation_id
    || (body.entity_type === 'conversation' ? body.entity_id : null);
  return conversationId
    ? `/tech/conversations?c=${encodeURIComponent(conversationId)}`
    : '/tech/conversations';
}

function jobRoute(body) {
  const jobId = body.job_id
    || (body.entity_type === 'job' ? body.entity_id : null);
  return jobId ? `/tech/job/${jobId}` : '/tech';
}

const PRESENTATIONS = Object.freeze({
  'message.inbound': {
    title: () => 'New customer message',
    body: () => 'Tap to open the conversation.',
    route: conversationRoute,
  },
  'appointment.assigned': {
    title: () => 'New appointment',
    body: () => 'Tap to review the appointment.',
    route: appointmentRoute,
  },
  'appointment.updated': {
    title: () => 'Appointment updated',
    body: () => 'Tap to review the changes.',
    route: appointmentRoute,
  },
  'appointment.canceled': {
    title: () => 'Appointment canceled',
    body: () => 'Tap to review the appointment.',
    route: appointmentRoute,
  },
  'estimate.accepted': {
    title: () => 'Estimate accepted',
    body: () => 'Open Utah Pros to review the estimate.',
    route: () => '/',
  },
  'payment.received': {
    title: () => 'Payment received',
    body: () => 'Open Utah Pros to review payment details.',
    route: () => '/',
  },
  'lead.new': {
    title: () => 'New lead',
    body: () => 'Open Utah Pros to review the lead.',
    route: () => '/',
  },
  'esign.signed': {
    title: () => 'Document signed',
    body: () => 'Tap to open the job.',
    route: jobRoute,
  },
  'feedback.submitted': {
    title: () => 'New feedback',
    body: () => 'Open Utah Pros to review the feedback.',
    route: () => '/',
  },
  'timesheet.change_requested': {
    title: () => 'Timesheet change requested',
    body: () => 'Open Utah Pros to review the request.',
    route: () => '/',
  },
  'timesheet.change_reviewed': {
    title: (body) => (
      String(body.title || '').toLowerCase().includes('approved')
        ? 'Timesheet change approved'
        : String(body.title || '').toLowerCase().includes('rejected')
          ? 'Timesheet change rejected'
          : 'Timesheet change reviewed'
    ),
    body: () => 'Open Utah Pros to review your request.',
    route: () => '/',
  },
  'clock.abandoned': {
    title: () => 'Clock needs attention',
    body: () => 'Open Utah Pros to review your time.',
    route: () => '/',
  },
  'meld.received': {
    title: (body) => (
      String(body.title || '').toLowerCase().includes('emergency')
        ? 'Emergency meld received'
        : 'New meld received'
    ),
    body: () => 'Open Utah Pros to review the meld.',
    route: () => '/',
  },
  'feedback.resolved': {
    title: (body) => (
      String(body.title || '').toLowerCase().includes('bug')
        ? 'Bug report resolved'
        : 'Feedback resolved'
    ),
    body: () => 'Tap to review your feedback.',
    route: () => '/tech/feedback',
  },
  'ops.health': {
    title: () => 'Operations alert',
    body: () => 'Open Utah Pros to review system health.',
    route: () => '/',
  },
});

const INTERNAL_PRESENTATIONS = Object.freeze({
  'owner.native_push_test': {
    title: () => 'UPR notifications are ready',
    body: () => 'This iPhone can receive UPR alerts.',
    route: () => '/tech/settings',
  },
});

export const NATIVE_NOTIFICATION_TYPE_KEYS = Object.freeze(
  Object.keys(PRESENTATIONS),
);

export function buildNativeNotificationPresentation(typeKey, body = {}) {
  const presentation = PRESENTATIONS[typeKey]
    || INTERNAL_PRESENTATIONS[typeKey];
  if (!presentation) {
    return {
      title: GENERIC_TITLE,
      body: GENERIC_BODY,
      url: '/',
    };
  }

  return {
    title: cleanText(
      presentation.title(body),
      GENERIC_TITLE,
      MAX_ALERT_TITLE_LENGTH,
    ),
    body: cleanText(
      presentation.body(body),
      GENERIC_BODY,
      MAX_ALERT_BODY_LENGTH,
    ),
    url: presentation.route(body),
  };
}
