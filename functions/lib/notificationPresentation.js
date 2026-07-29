/**
 * ════════════════════════════════════════════════
 * FILE: notificationPresentation.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Converts each trusted notification event into event-specific iPhone
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
 *   - Native and PWA may use the same event-approved variables. Values are
 *     still derived from trusted server context, never arbitrary APNs inputs.
 *   - The admin presentation editor consumes the same event catalog below.
 *     Every surface may use only its explicit variables and route ids.
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

export function buildGenericNativeNotificationPresentation(typeKey, body = {}) {
  const internalPresentation = INTERNAL_PRESENTATIONS[typeKey];
  if (internalPresentation) {
    return {
      title: cleanText(
        internalPresentation.title(body),
        GENERIC_TITLE,
        MAX_ALERT_TITLE_LENGTH,
      ),
      body: cleanText(
        internalPresentation.body(body),
        GENERIC_BODY,
        MAX_ALERT_BODY_LENGTH,
      ),
      url: internalPresentation.route(body),
    };
  }

  const presentation = PRESENTATIONS[typeKey];
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

export function buildNativeNotificationPresentation(typeKey, body = {}) {
  if (!PRESENTATIONS[typeKey]) {
    return buildGenericNativeNotificationPresentation(typeKey, body);
  }
  return buildConfiguredDefaultNativePresentation(typeKey, body)
    || buildGenericNativeNotificationPresentation(typeKey, body);
}

// ─── SECTION: Admin-configurable presentation contract ──────────────────────

export const NOTIFICATION_PRESENTATION_CONTRACT_VERSION = 1;
export const NOTIFICATION_PRESENTATION_SURFACES = Object.freeze([
  'bell',
  'pwa_push',
  'native_push',
]);

const TEMPLATE_TOKEN = /{{([a-z][a-z0-9_]*)}}/g;
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SURFACE_LIMITS = Object.freeze({
  bell: Object.freeze({ title: 120, body: 500 }),
  pwa_push: Object.freeze({ title: 80, body: 180 }),
  native_push: Object.freeze({ title: 80, body: 180 }),
});

function safeId(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return SAFE_ID.test(text) ? text : '';
}

function contextValue(value, maxLength = 160) {
  if (value === null || value === undefined) return '';
  return cleanText(String(value), '', maxLength);
}

function formatMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '';
  return amount.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDurationMinutes(value) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes < 0) return '';
  if (minutes < 60) return `${Math.round(minutes)} minutes`;
  return `${(minutes / 60).toFixed(1)} hours`;
}

function presentationContext(typeKey, body = {}) {
  const explicit = body.presentation_context && typeof body.presentation_context === 'object'
    ? body.presentation_context
    : {};
  const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};
  const data = body.data && typeof body.data === 'object' ? body.data : {};
  const context = {};
  switch (typeKey) {
    case 'message.inbound':
      context.sender_name = contextValue(explicit.sender_name);
      context.message_preview = contextValue(explicit.message_preview, 180);
      break;
    case 'appointment.assigned':
    case 'appointment.updated':
    case 'appointment.canceled':
      context.appointment_title = contextValue(explicit.appointment_title);
      context.appointment_when = contextValue(explicit.appointment_when);
      break;
    case 'estimate.accepted':
      context.estimate_number = contextValue(explicit.estimate_number);
      context.amount = contextValue(explicit.amount || formatMoney(payload.amount));
      context.customer_name = contextValue(explicit.customer_name);
      break;
    case 'payment.received':
      context.amount = formatMoney(payload.amount);
      context.payment_source = contextValue(payload.source);
      context.payment_reference = contextValue(payload.reference);
      context.invoice_number = contextValue(explicit.invoice_number);
      break;
    case 'lead.new':
      context.lead_source = contextValue(explicit.lead_source || payload.source_type);
      context.customer_name = contextValue(explicit.customer_name);
      break;
    case 'esign.signed':
      context.signer_name = contextValue(explicit.signer_name || payload.signer_name);
      context.document_name = contextValue(explicit.document_name || payload.doc_type);
      context.job_number = contextValue(explicit.job_number);
      break;
    case 'feedback.submitted':
      context.feedback_type = contextValue(payload.feedback_type);
      context.employee_name = contextValue(explicit.employee_name);
      break;
    case 'timesheet.change_requested':
      context.employee_name = contextValue(explicit.employee_name);
      break;
    case 'timesheet.change_reviewed':
      context.review_outcome = payload.approved === true
        ? 'approved'
        : payload.approved === false ? 'rejected' : '';
      break;
    case 'clock.abandoned':
      context.employee_name = contextValue(explicit.employee_name);
      context.duration = formatDurationMinutes(payload.minutes);
      break;
    case 'meld.received':
      context.meld_type = contextValue(explicit.meld_type);
      context.meld_number = contextValue(explicit.meld_number || body.entity_id);
      break;
    case 'feedback.resolved':
      context.feedback_type = contextValue(payload.feedback_type);
      break;
    case 'ops.health':
      context.condition = contextValue(payload.condition);
      context.severity = contextValue(payload.severity);
      context.count = Number.isFinite(Number(payload.count)) ? String(Number(payload.count)) : '';
      break;
    default:
      break;
  }
  context.conversation_id = safeId(data.conversation_id || (
    body.entity_type === 'conversation' ? body.entity_id : ''
  ));
  context.appointment_id = safeId(body.appointment_id || (
    body.entity_type === 'appointment' ? body.entity_id : ''
  ));
  context.estimate_id = safeId(body.estimate_id || (
    body.entity_type === 'estimate' ? body.entity_id : ''
  ));
  context.invoice_id = safeId(body.invoice_id || (
    body.entity_type === 'invoice' ? body.entity_id : ''
  ));
  context.lead_id = safeId(data.lead_id || (
    body.entity_type === 'inbound_lead' ? body.entity_id : ''
  ));
  context.job_id = safeId(body.job_id || (
    body.entity_type === 'job' ? body.entity_id : ''
  ));
  return context;
}

const ROUTES = Object.freeze({
  'office.home': Object.freeze({
    label: 'Office home',
    resolve: () => '/',
  }),
  'field.home': Object.freeze({
    label: 'Field home',
    resolve: (_ctx, surface) => surface === 'native_push' ? '/' : '/tech',
  }),
  'conversation.thread': Object.freeze({
    label: 'Exact conversation',
    resolve: (ctx, surface) => ctx.conversation_id
      ? `${surface === 'bell' ? '/conversations' : '/tech/conversations'}?c=${encodeURIComponent(ctx.conversation_id)}`
      : '',
  }),
  'appointment.detail': Object.freeze({
    label: 'Exact appointment',
    resolve: (ctx, surface) => ctx.appointment_id
      ? `${surface === 'bell' ? '/schedule/appointment' : '/tech/appointment'}/${ctx.appointment_id}`
      : '',
  }),
  'estimate.detail': Object.freeze({
    label: 'Exact estimate',
    resolve: (ctx) => ctx.estimate_id ? `/estimates/${ctx.estimate_id}` : '',
  }),
  'invoice.detail': Object.freeze({
    label: 'Exact invoice',
    resolve: (ctx) => ctx.invoice_id ? `/invoices/${ctx.invoice_id}` : '',
  }),
  'collections.home': Object.freeze({
    label: 'Collections',
    resolve: () => '/collections',
  }),
  'crm.lead': Object.freeze({
    label: 'Exact CRM lead',
    resolve: (ctx) => ctx.lead_id
      ? `/crm/leads?lead=${encodeURIComponent(ctx.lead_id)}`
      : '',
  }),
  'job.detail': Object.freeze({
    label: 'Exact job',
    resolve: (ctx, surface) => ctx.job_id
      ? `${surface === 'native_push' ? '/tech/job' : '/jobs'}/${ctx.job_id}`
      : '',
  }),
  'feedback.inbox': Object.freeze({
    label: 'Feedback inbox',
    resolve: () => '/settings/feedback',
  }),
  'field.feedback': Object.freeze({
    label: 'Field feedback',
    resolve: () => '/tech/feedback',
  }),
  'time_tracking.home': Object.freeze({
    label: 'Time tracking',
    resolve: () => '/time-tracking',
  }),
  'melds.home': Object.freeze({
    label: 'Melds',
    resolve: () => '/melds',
  }),
  'dev_tools.home': Object.freeze({
    label: 'Developer tools',
    resolve: () => '/devtools',
  }),
});

const VARIABLE_META = Object.freeze({
  sender_name: Object.freeze({ label: 'Sender name', sample: 'Jordan Lee' }),
  message_preview: Object.freeze({ label: 'Message preview', sample: 'I can meet tomorrow morning.' }),
  appointment_title: Object.freeze({ label: 'Appointment title', sample: 'Moisture check' }),
  appointment_when: Object.freeze({ label: 'Appointment time', sample: 'Fri, Jul 31 · 9:00 AM – 11:00 AM' }),
  estimate_number: Object.freeze({ label: 'Estimate number', sample: 'EST-1042' }),
  amount: Object.freeze({ label: 'Amount', sample: '$1,250.00' }),
  customer_name: Object.freeze({ label: 'Customer name', sample: 'Jordan Lee' }),
  payment_source: Object.freeze({ label: 'Payment source', sample: 'Credit card' }),
  payment_reference: Object.freeze({ label: 'Payment reference', sample: 'Charge #ch_demo' }),
  invoice_number: Object.freeze({ label: 'Invoice number', sample: 'INV-1042' }),
  lead_source: Object.freeze({ label: 'Lead source', sample: 'Website form' }),
  signer_name: Object.freeze({ label: 'Signer name', sample: 'Jordan Lee' }),
  document_name: Object.freeze({ label: 'Document name', sample: 'Work authorization' }),
  job_number: Object.freeze({ label: 'Job number', sample: 'JOB-1042' }),
  feedback_type: Object.freeze({ label: 'Feedback type', sample: 'Bug report' }),
  employee_name: Object.freeze({ label: 'Employee name', sample: 'Alex Morgan' }),
  review_outcome: Object.freeze({ label: 'Review outcome', sample: 'approved' }),
  duration: Object.freeze({ label: 'Clock duration', sample: '4.5 hours' }),
  meld_type: Object.freeze({ label: 'Meld type', sample: 'Emergency water loss' }),
  meld_number: Object.freeze({ label: 'Meld number', sample: 'M-1042' }),
  condition: Object.freeze({ label: 'Condition', sample: 'Notification backlog' }),
  severity: Object.freeze({ label: 'Severity', sample: 'warning' }),
  count: Object.freeze({ label: 'Count', sample: '3' }),
});

function surface(defaultTitle, defaultBody, variableKeys, routeIds, defaultRouteId, {
  copyEditable = true,
} = {}) {
  return Object.freeze({
    defaultTitle,
    defaultBody,
    variableKeys: Object.freeze(variableKeys),
    routeIds: Object.freeze(routeIds),
    defaultRouteId,
    copyEditable,
  });
}

function browserAndNative({
  title,
  body,
  variables = [],
  bellRoutes,
  pwaRoutes,
  nativeRoute,
}) {
  return Object.freeze({
    bell: surface(title, body, variables, bellRoutes, bellRoutes[0]),
    pwa_push: surface(title, body, variables, pwaRoutes, pwaRoutes[0]),
    native_push: surface(title, body, variables, [nativeRoute], nativeRoute),
  });
}

const CONFIGURABLE_PRESENTATIONS = Object.freeze({
  'message.inbound': browserAndNative({
    title: 'New text from {{sender_name}}',
    body: '{{message_preview}}',
    variables: ['sender_name', 'message_preview'],
    bellRoutes: ['conversation.thread', 'office.home'],
    pwaRoutes: ['conversation.thread', 'field.home'],
    nativeRoute: 'conversation.thread',
  }),
  'appointment.assigned': browserAndNative({
    title: 'New appointment · {{appointment_title}}',
    body: '{{appointment_when}}',
    variables: ['appointment_title', 'appointment_when'],
    bellRoutes: ['appointment.detail', 'office.home'],
    pwaRoutes: ['appointment.detail', 'field.home'],
    nativeRoute: 'appointment.detail',
  }),
  'appointment.updated': browserAndNative({
    title: 'Appointment updated · {{appointment_title}}',
    body: '{{appointment_when}}',
    variables: ['appointment_title', 'appointment_when'],
    bellRoutes: ['appointment.detail', 'office.home'],
    pwaRoutes: ['appointment.detail', 'field.home'],
    nativeRoute: 'appointment.detail',
  }),
  'appointment.canceled': browserAndNative({
    title: 'Appointment canceled · {{appointment_title}}',
    body: '{{appointment_when}}',
    variables: ['appointment_title', 'appointment_when'],
    bellRoutes: ['appointment.detail', 'office.home'],
    pwaRoutes: ['appointment.detail', 'field.home'],
    nativeRoute: 'appointment.detail',
  }),
  'estimate.accepted': browserAndNative({
    title: 'Estimate {{estimate_number}} accepted',
    body: '{{amount}} · {{customer_name}}',
    variables: ['estimate_number', 'amount', 'customer_name'],
    bellRoutes: ['estimate.detail', 'office.home'],
    pwaRoutes: ['estimate.detail', 'field.home'],
    nativeRoute: 'field.home',
  }),
  'payment.received': browserAndNative({
    title: 'Payment received',
    body: '{{amount}} recorded via {{payment_source}} · {{payment_reference}}',
    variables: ['amount', 'payment_source', 'invoice_number', 'payment_reference'],
    bellRoutes: ['invoice.detail', 'collections.home', 'office.home'],
    pwaRoutes: ['invoice.detail', 'collections.home', 'field.home'],
    nativeRoute: 'field.home',
  }),
  'lead.new': browserAndNative({
    title: 'New lead · {{customer_name}}',
    body: 'Source: {{lead_source}}',
    variables: ['customer_name', 'lead_source'],
    bellRoutes: ['crm.lead', 'office.home'],
    pwaRoutes: ['crm.lead', 'field.home'],
    nativeRoute: 'field.home',
  }),
  'esign.signed': browserAndNative({
    title: '{{signer_name}} signed {{document_name}}',
    body: 'Job {{job_number}}',
    variables: ['signer_name', 'document_name', 'job_number'],
    bellRoutes: ['job.detail', 'office.home'],
    pwaRoutes: ['job.detail', 'field.home'],
    nativeRoute: 'job.detail',
  }),
  'feedback.submitted': browserAndNative({
    title: 'New {{feedback_type}}',
    body: 'Submitted by {{employee_name}}',
    variables: ['feedback_type', 'employee_name'],
    bellRoutes: ['feedback.inbox', 'office.home'],
    pwaRoutes: ['feedback.inbox', 'field.home'],
    nativeRoute: 'field.home',
  }),
  'timesheet.change_requested': browserAndNative({
    title: 'Timesheet change requested',
    body: '{{employee_name}} requested a correction.',
    variables: ['employee_name'],
    bellRoutes: ['time_tracking.home', 'office.home'],
    pwaRoutes: ['time_tracking.home', 'field.home'],
    nativeRoute: 'field.home',
  }),
  'timesheet.change_reviewed': browserAndNative({
    title: 'Timesheet change {{review_outcome}}',
    body: 'Open Utah Pros to review your request.',
    variables: ['review_outcome'],
    bellRoutes: ['time_tracking.home', 'field.home'],
    pwaRoutes: ['time_tracking.home', 'field.home'],
    nativeRoute: 'field.home',
  }),
  'clock.abandoned': browserAndNative({
    title: 'Clock needs attention',
    body: '{{employee_name}} has been clocked in for {{duration}}.',
    variables: ['employee_name', 'duration'],
    bellRoutes: ['time_tracking.home', 'office.home'],
    pwaRoutes: ['time_tracking.home', 'field.home'],
    nativeRoute: 'field.home',
  }),
  'meld.received': browserAndNative({
    title: 'New {{meld_type}} meld',
    body: 'Meld {{meld_number}}',
    variables: ['meld_type', 'meld_number'],
    bellRoutes: ['melds.home', 'office.home'],
    pwaRoutes: ['melds.home', 'field.home'],
    nativeRoute: 'field.home',
  }),
  'feedback.resolved': browserAndNative({
    title: '{{feedback_type}} resolved',
    body: 'Tap to review your feedback.',
    variables: ['feedback_type'],
    bellRoutes: ['field.feedback', 'field.home'],
    pwaRoutes: ['field.feedback', 'field.home'],
    nativeRoute: 'field.feedback',
  }),
  'ops.health': browserAndNative({
    title: 'Ops alert · {{condition}}',
    body: '{{severity}} · {{count}} affected',
    variables: ['condition', 'severity', 'count'],
    bellRoutes: ['dev_tools.home', 'office.home'],
    pwaRoutes: ['dev_tools.home', 'field.home'],
    nativeRoute: 'field.home',
  }),
});

function templateTokens(template) {
  const tokens = [];
  TEMPLATE_TOKEN.lastIndex = 0;
  let match;
  while ((match = TEMPLATE_TOKEN.exec(template)) !== null) tokens.push(match[1]);
  return tokens;
}

function hasTemplateControlCharacters(value) {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (
      (code >= 0 && code <= 8)
      || code === 11
      || code === 12
      || (code >= 14 && code <= 31)
      || code === 127
    ) {
      return true;
    }
  }
  return false;
}

export function validateNotificationPresentationConfig(typeKey, surfaceKey, config) {
  const definition = CONFIGURABLE_PRESENTATIONS[typeKey]?.[surfaceKey];
  if (!definition) return { ok: false, error: 'Unsupported event or surface' };
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { ok: false, error: 'Invalid presentation configuration' };
  }
  const allowedFields = new Set(['title_template', 'body_template', 'route_id', 'contract_version']);
  if (Object.keys(config).some((key) => !allowedFields.has(key))) {
    return { ok: false, error: 'Unsupported presentation field' };
  }
  if (config.contract_version !== NOTIFICATION_PRESENTATION_CONTRACT_VERSION) {
    return { ok: false, error: 'Presentation contract version mismatch' };
  }
  const title = typeof config.title_template === 'string' ? config.title_template : '';
  const body = typeof config.body_template === 'string' ? config.body_template : '';
  const limits = SURFACE_LIMITS[surfaceKey];
  if (!title.trim() || !body.trim() || title.length > limits.title || body.length > limits.body) {
    return { ok: false, error: 'Presentation copy is empty or too long' };
  }
  if (hasTemplateControlCharacters(`${title}${body}`)) {
    return { ok: false, error: 'Presentation copy contains control characters' };
  }
  if (!definition.copyEditable && (
    title !== definition.defaultTitle || body !== definition.defaultBody
  )) {
    return { ok: false, error: 'Presentation copy is code-owned for this surface' };
  }
  const scrubbed = `${title}\n${body}`.replace(TEMPLATE_TOKEN, '');
  if (scrubbed.includes('{{') || scrubbed.includes('}}')) {
    return { ok: false, error: 'Malformed template token' };
  }
  const allowedVariables = new Set(definition.variableKeys);
  if (templateTokens(`${title}\n${body}`).some((key) => !allowedVariables.has(key))) {
    return { ok: false, error: 'Template uses a variable not allowed for this event' };
  }
  if (!definition.routeIds.includes(config.route_id)) {
    return { ok: false, error: 'Route is not allowed for this event and surface' };
  }
  return {
    ok: true,
    config: {
      title_template: title,
      body_template: body,
      route_id: config.route_id,
      contract_version: config.contract_version,
    },
  };
}

function renderTemplate(template, values) {
  let missing = false;
  TEMPLATE_TOKEN.lastIndex = 0;
  const rendered = template.replace(TEMPLATE_TOKEN, (_token, key) => {
    const value = values[key];
    if (!value) missing = true;
    return value || '';
  });
  return missing ? null : rendered;
}

function boundedRenderedNativeText(value, maxLength) {
  const cleaned = cleanText(value, '', maxLength + 1);
  return cleaned && cleaned.length <= maxLength ? cleaned : null;
}

function defaultConfig(definition) {
  return {
    title_template: definition.defaultTitle,
    body_template: definition.defaultBody,
    route_id: definition.defaultRouteId,
    contract_version: NOTIFICATION_PRESENTATION_CONTRACT_VERSION,
  };
}

function buildConfiguredDefaultNativePresentation(typeKey, body) {
  const definition = CONFIGURABLE_PRESENTATIONS[typeKey]?.native_push;
  if (!definition) return null;
  const values = presentationContext(typeKey, body);
  const title = renderTemplate(definition.defaultTitle, values);
  const renderedBody = renderTemplate(definition.defaultBody, values);
  const url = ROUTES[definition.defaultRouteId]?.resolve(values, 'native_push');
  if (!title || !renderedBody || !url) return null;
  const boundedTitle = boundedRenderedNativeText(
    title,
    SURFACE_LIMITS.native_push.title,
  );
  const boundedBody = boundedRenderedNativeText(
    renderedBody,
    SURFACE_LIMITS.native_push.body,
  );
  if (!boundedTitle || !boundedBody) return null;
  return {
    title: boundedTitle,
    body: boundedBody,
    url,
  };
}

function projectCatalogDefinition(typeKey, eventDefinition) {
  const surfaces = {};
  for (const [surfaceKey, definition] of Object.entries(eventDefinition)) {
    surfaces[surfaceKey] = {
      key: surfaceKey,
      copy_editable: definition.copyEditable,
      limits: SURFACE_LIMITS[surfaceKey],
      default_config: defaultConfig(definition),
      variables: definition.variableKeys.map((key) => ({
        key,
        ...VARIABLE_META[key],
      })),
      routes: definition.routeIds.map((routeId) => ({
        id: routeId,
        label: ROUTES[routeId].label,
      })),
    };
  }
  return { type_key: typeKey, surfaces };
}

export function getNotificationPresentationCatalog() {
  return Object.entries(CONFIGURABLE_PRESENTATIONS)
    .map(([typeKey, definition]) => projectCatalogDefinition(typeKey, definition));
}

export function previewNotificationPresentation(typeKey, surfaceKey, config) {
  const checked = validateNotificationPresentationConfig(typeKey, surfaceKey, config);
  if (!checked.ok) return checked;
  const definition = CONFIGURABLE_PRESENTATIONS[typeKey][surfaceKey];
  const samples = Object.fromEntries(
    definition.variableKeys.map((key) => [key, VARIABLE_META[key].sample]),
  );
  const title = renderTemplate(checked.config.title_template, samples);
  const body = renderTemplate(checked.config.body_template, samples);
  const route = ROUTES[checked.config.route_id]?.resolve(
    {
      conversation_id: 'conversation-demo',
      appointment_id: 'appointment-demo',
      estimate_id: 'estimate-demo',
      invoice_id: 'invoice-demo',
      lead_id: 'lead-demo',
      job_id: 'job-demo',
    },
    surfaceKey,
  );
  if (!title || !body || !route) return { ok: false, error: 'Preview could not be rendered' };
  return { ok: true, presentation: { title, body, url: route } };
}

export async function resolveConfiguredNotificationPresentation({
  db,
  typeKey,
  surfaceKey,
  body = {},
  fallback,
  renderFailureFallback = fallback,
}) {
  const definition = CONFIGURABLE_PRESENTATIONS[typeKey]?.[surfaceKey];
  if (!definition || !db) return fallback;
  let rows;
  try {
    rows = await db.select(
      'notification_presentation_overrides',
      `type_key=eq.${encodeURIComponent(typeKey)}&surface=eq.${surfaceKey}`
        + '&select=title_template,body_template,route_id,contract_version&limit=1',
    );
  } catch {
    return fallback;
  }
  const row = rows?.[0];
  if (!row) return fallback;
  const checked = validateNotificationPresentationConfig(typeKey, surfaceKey, {
    title_template: row.title_template,
    body_template: row.body_template,
    route_id: row.route_id,
    contract_version: row.contract_version,
  });
  if (!checked.ok) return fallback;
  const values = presentationContext(typeKey, body);
  const title = renderTemplate(checked.config.title_template, values);
  const renderedBody = renderTemplate(checked.config.body_template, values);
  const url = ROUTES[checked.config.route_id]?.resolve(values, surfaceKey);
  if (!title || !renderedBody || !url) return renderFailureFallback;
  if (surfaceKey === 'native_push') {
    const boundedTitle = boundedRenderedNativeText(
      title,
      SURFACE_LIMITS.native_push.title,
    );
    const boundedBody = boundedRenderedNativeText(
      renderedBody,
      SURFACE_LIMITS.native_push.body,
    );
    if (!boundedTitle || !boundedBody) return renderFailureFallback;
    return { title: boundedTitle, body: boundedBody, url };
  }
  return { title, body: renderedBody, url };
}
