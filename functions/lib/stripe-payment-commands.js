/**
 * ════════════════════════════════════════════════
 * FILE: stripe-payment-commands.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Wraps the private record of every accounting action a Stripe payment
 *   triggers. Each action is written down before QuickBooks is called, together
 *   with the request number QuickBooks will see, so that if the connection drops
 *   the retry reuses the same number and QuickBooks recognises it as the same
 *   request instead of creating a second payment.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ./intuit.js (sha256hex)
 *   Data:      reads/writes → stripe_payment_commands, through service-only RPCs
 *
 * NOTES / GOTCHAS:
 *   - Every function here needs the service-role client. The RPCs refuse anyone
 *     else with 42501; there is no browser path into this table by design.
 *   - JSON is sorted recursively before hashing, so a Postgres jsonb readback
 *     cannot change an intent fingerprint merely by reordering keys.
 *   - `deriveRequestId` must stay deterministic. Intuit dedups on `requestid`,
 *     so a retry that computes a different one creates a duplicate rather than
 *     being recognised. Never mix a timestamp or random value into it.
 * ════════════════════════════════════════════════
 */

import { sha256hex } from './intuit.js';

/** Accounting actions a Stripe object can trigger. Mirrors the CHECK constraint. */
export const STRIPE_COMMAND_ACTIONS = Object.freeze([
  'record_payment',
  'book_fee',
  'transfer_payout',
  'reverse_payment',
]);

/** Statuses from which no further provider work should be attempted. */
const TERMINAL_STATUSES = new Set(['succeeded', 'rejected']);

/** Short codes keep the Intuit request id inside its 50-character limit. */
const ACTION_CODE = Object.freeze({
  record_payment: 'p',
  book_fee: 'f',
  transfer_payout: 't',
  reverse_payment: 'r',
});

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, sortJson(value[key])]),
    );
  }
  return value;
}

export function stableJsonStringify(value) {
  return JSON.stringify(sortJson(value));
}

export async function hashStripeCommandIntent(intent) {
  return sha256hex(stableJsonStringify(intent));
}

/**
 * The frozen provider request id.
 *
 * Derived only from the Stripe object id, the action and the realm — all three
 * stable for the life of the operation — so every retry recomputes the identical
 * value. `upr-s-` distinguishes these from the invoice worker's `upr-i-` ids.
 * Capped well inside Intuit's 50-character limit.
 */
export async function deriveStripeRequestId({ stripeObjectId, action, realmId }) {
  const code = ACTION_CODE[action];
  if (!code) throw new Error(`Unknown Stripe command action: ${action}`);
  const digest = await sha256hex(stableJsonStringify({
    action,
    realm_id: String(realmId),
    stripe_object_id: String(stripeObjectId),
  }));
  return `upr-s-${code}-${digest.slice(0, 40)}`;
}

function rpcObject(value) {
  return Array.isArray(value) ? value[0] : value;
}

export function isTerminalStripeCommand(row) {
  return !!row && TERMINAL_STATUSES.has(row.status);
}

export async function getStripePaymentCommand(db, { stripeObjectId, action }) {
  return rpcObject(await db.rpc('get_stripe_payment_command', {
    p_stripe_object_id: stripeObjectId,
    p_action: action,
  }));
}

/**
 * Claim (object, action) and freeze the request id.
 *
 * Returns the EXISTING row when one is present rather than erroring, so a
 * redelivered Stripe event and a retry after an ambiguous failure both converge
 * on the original frozen identity. Callers must inspect `.status` before doing
 * provider work — a terminal row means the action already completed.
 */
export async function reserveStripePaymentCommand(db, {
  stripeObjectId,
  stripeEventId = null,
  action,
  realmId,
  intent,
  invoiceId = null,
  paymentId = null,
}) {
  if (!STRIPE_COMMAND_ACTIONS.includes(action)) {
    throw new Error(`Unknown Stripe command action: ${action}`);
  }
  const [providerRequestId, intentHash] = await Promise.all([
    deriveStripeRequestId({ stripeObjectId, action, realmId }),
    hashStripeCommandIntent(intent),
  ]);

  return rpcObject(await db.rpc('reserve_stripe_payment_command', {
    p_stripe_object_id: stripeObjectId,
    p_action: action,
    p_realm_id: String(realmId),
    p_provider_request_id: providerRequestId,
    p_intent_hash: intentHash,
    p_intent_payload: intent,
    p_invoice_id: invoiceId,
    p_payment_id: paymentId,
    p_stripe_event_id: stripeEventId,
  }));
}

/** Mark the provider call as in flight. Returns null if the row was not in a startable state. */
export async function startStripePaymentCommand(db, commandId) {
  return rpcObject(await db.rpc('start_stripe_payment_command', {
    p_command_id: commandId,
  }));
}

export async function finalizeStripePaymentCommand(db, commandId, {
  status,
  providerTargetId = null,
  error = null,
  intuitRequestId = null,
  responsePayload = null,
  paymentId = null,
}) {
  return rpcObject(await db.rpc('finalize_stripe_payment_command', {
    p_command_id: commandId,
    p_status: status,
    p_provider_target_id: providerTargetId,
    p_error: error ? String(error).slice(0, 500) : null,
    p_intuit_request_id: intuitRequestId,
    p_response_payload: responsePayload,
    p_payment_id: paymentId,
  }));
}

/**
 * Classify a provider failure.
 *
 * A definitive 4xx means QuickBooks refused and nothing was created — safe to
 * mark rejected. Anything else (timeout, 5xx, network drop) means the call may
 * have LANDED and we simply never saw the answer, so the command stays
 * `ambiguous` and must be retried under the SAME frozen request id. Treating an
 * ambiguous failure as a rejection is precisely how a duplicate QuickBooks
 * Payment gets created.
 */
export function classifyProviderFailure(err) {
  const status = Number(err?.status);
  if (Number.isFinite(status) && status >= 400 && status < 500 && status !== 408 && status !== 429) {
    return 'rejected';
  }
  return 'ambiguous';
}
