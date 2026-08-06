/**
 * ════════════════════════════════════════════════
 * FILE: qbo-receive-payment.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Lets an active internal administrator record one customer payment against
 *   several open invoices. It creates one matching QuickBooks payment, checks
 *   what QuickBooks saved, and then records the same allocations in UPR.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  cors, qbo-auth, supabase, quickbooks, worker-runs, qbo-receipt
 *   Data:      reads  → contacts, invoices, integration_credentials, QuickBooks
 *              writes → payment receipt service RPCs, worker_runs, QuickBooks Payment
 *
 * NOTES / GOTCHAS:
 *   - The route is admin-only and requires both the database feature flag and
 *     QBO_RECEIVE_PAYMENT_ENABLED=true before any QuickBooks work.
 *   - A durable attempt and Intuit request ID are created before the provider write.
 *   - A timeout is an unknown outcome, never proof that QuickBooks rejected the payment.
 * ════════════════════════════════════════════════
 */
import { handleOptions, jsonResponse } from '../lib/cors.js';
import { authorizeQboBrowserRequest } from '../lib/qbo-auth.js';
import { supabase } from '../lib/supabase.js';
import { fetchWithTimeout } from '../lib/http.js';
import { getConnection, getQboInvoice, getQboPayment, listQboDepositAccounts, listQboPaymentMethods, createAllocatedPayment } from '../lib/quickbooks.js';
import { recordWorkerRun } from '../lib/worker-runs.js';
import {
  intuitRequestId,
  isReceivePaymentsGateOpen,
  normalizeQboPaymentMethod,
  qboBalanceCents,
  receiptFingerprint,
  validateReceiptRequest,
} from '../lib/qbo-receipt.js';

function receiptRow(result) { return Array.isArray(result) ? result[0] : result; }
function fail(message, httpStatus = 400) {
  const error = new Error(message);
  error.httpStatus = httpStatus;
  error.safeToExpose = true;
  return error;
}

function publicReceiptError(error) {
  if (error?.safeToExpose === true) return String(error.message || 'Unable to receive payment.');
  if (error?.receiptOutcome === 'unknown') {
    return 'QuickBooks may have accepted this payment. Retry the unchanged request so UPR can recover the original result.';
  }
  if (Number(error?.status) >= 400 && Number(error?.status) < 500) {
    return 'QuickBooks rejected the payment. Review the payment details and try again.';
  }
  return 'Unable to receive payment. Use the reference ID when asking an administrator to investigate.';
}

async function localContact(db, contactId) {
  return (await db.select('contacts', `id=eq.${encodeURIComponent(contactId)}&select=id,name,qbo_customer_id&limit=1`))?.[0] || null;
}

async function localInvoices(db, contactId, ids = null) {
  const filter = ids
    ? `id=in.(${ids.map(encodeURIComponent).join(',')})&contact_id=eq.${encodeURIComponent(contactId)}`
    : `contact_id=eq.${encodeURIComponent(contactId)}&qbo_invoice_id=not.is.null&select=id,invoice_number,qbo_invoice_id,balance_due,status,contact_id,job_id`;
  const query = ids
    ? `${filter}&select=id,invoice_number,qbo_invoice_id,balance_due,status,contact_id,job_id`
    : filter;
  return db.select('invoices', query);
}

// Job identity for the allocation rows — number, type, address, date of loss —
// so an allocator can tell a property manager's nine open invoices apart.
// Best-effort by design: a lookup failure degrades the rows to bare invoice
// numbers and must never block receiving money.
async function jobContextForInvoices(db, invoices) {
  try {
    const jobIds = [...new Set(invoices.map((invoice) => invoice.job_id).filter(Boolean))];
    if (!jobIds.length) return new Map();
    const jobs = (await db.select(
      'jobs',
      `id=in.(${jobIds.map(encodeURIComponent).join(',')})&select=id,job_number,address,city,division,claim_id`,
    )) || [];
    const claimIds = [...new Set(jobs.map((job) => job.claim_id).filter(Boolean))];
    const claims = claimIds.length
      ? (await db.select(
        'claims',
        `id=in.(${claimIds.map(encodeURIComponent).join(',')})&select=id,date_of_loss`,
      )) || []
      : [];
    const lossByClaim = new Map(claims.map((claim) => [String(claim.id), claim.date_of_loss || null]));
    return new Map(jobs.map((job) => [String(job.id), {
      job_number: job.job_number || null,
      job_division: job.division || null,
      job_address: [job.address, job.city].filter(Boolean).join(', ') || null,
      date_of_loss: job.claim_id ? (lossByClaim.get(String(job.claim_id)) || null) : null,
    }]));
  } catch (error) {
    console.error('qbo-receive-payment: job context lookup failed', error?.message || error);
    return new Map();
  }
}

async function requireFreshAllocations(env, db, requestData, contact, { requireOpenBalance = true } = {}) {
  const ids = requestData.allocations.map((row) => row.invoice_id);
  const invoices = await localInvoices(db, requestData.contact_id, ids);
  if (invoices.length !== ids.length) throw fail('Every selected invoice must belong to the selected contact', 409);
  if (invoices.some((invoice) => !invoice.qbo_invoice_id)) throw fail('Every selected invoice must be synced to QuickBooks', 409);
  const byId = new Map(invoices.map((invoice) => [String(invoice.id), invoice]));
  let customerId = null, currency = null;
  const allocations = [];
  for (const allocation of requestData.allocations) {
    const invoice = byId.get(allocation.invoice_id);
    const qboInvoice = await getQboInvoice(env, invoice.qbo_invoice_id);
    const qboCustomerId = qboInvoice.CustomerRef?.value ? String(qboInvoice.CustomerRef.value) : null;
    const qboCurrency = qboInvoice.CurrencyRef?.value || 'USD';
    const balanceCents = qboBalanceCents(qboInvoice);
    if (!qboCustomerId || balanceCents == null) throw fail(`Invoice ${invoice.invoice_number || invoice.id} has an unreadable QuickBooks balance`, 409);
    if (requireOpenBalance && balanceCents < allocation.amount_cents) throw fail(`Invoice ${invoice.invoice_number || invoice.id} no longer has the requested open balance`, 409);
    if (customerId && customerId !== qboCustomerId) throw fail('All selected invoices must belong to the same QuickBooks customer', 409);
    if (currency && currency !== qboCurrency) throw fail('All selected invoices must use the same QuickBooks currency', 409);
    if (qboCurrency !== 'USD') throw fail('Only USD QuickBooks invoices are supported for receipt allocation', 409);
    customerId = qboCustomerId;
    currency = qboCurrency;
    allocations.push({ ...allocation, qbo_invoice_id: String(invoice.qbo_invoice_id), qbo_balance_cents: balanceCents });
  }
  if (String(contact.qbo_customer_id || '') !== customerId) throw fail('UPR contact no longer matches the QuickBooks invoice customer', 409);
  return { customerId, allocations, invoices };
}

async function qboOptions(env) {
  // Token refreshes roll the refresh token forward, so keep these provider reads
  // sequential instead of racing two refreshes against the same stored token.
  const methods = await listQboPaymentMethods(env);
  const accounts = await listQboDepositAccounts(env);
  return {
    methods: methods.map((row) => ({
      id: String(row.Id),
      name: String(row.Name || 'Other'),
      type: normalizeQboPaymentMethod(row.Name),
    })),
    accounts: accounts.map((row) => ({
      id: String(row.Id),
      name: String(row.Name || row.Id),
      account_type: row.AccountType || null,
    })),
  };
}

function selectedOptions(input, options) {
  const method = options.methods.find((row) => row.id === input.qbo_payment_method_id);
  const account = options.accounts.find((row) => row.id === input.deposit_account_id);
  if (!method) throw fail('The selected QuickBooks payment method is no longer active', 409);
  if (!account) throw fail('The selected QuickBooks deposit account is no longer active', 409);
  if (input.payment_method !== method.type) throw fail('The selected QuickBooks payment method changed; reload and review the payment', 409);
  if (method.type === 'check' && !input.reference_number) throw fail('A check number is required', 400);
  return { method, account };
}

function exactQboCents(value) {
  const amount = Number(value);
  const amountCents = Math.round(amount * 100);
  return Number.isFinite(amount) && Math.abs(amount * 100 - amountCents) < 1e-7
    ? amountCents
    : null;
}

function providerReceipt(input, conn, qboPayment, fresh, actorEmployeeId, selected) {
  const expected = new Map(fresh.allocations.map((row) => [row.qbo_invoice_id, row.amount_cents]));
  const actual = new Map();
  for (const line of qboPayment.Line || []) {
    const linked = (line.LinkedTxn || []).filter((txn) => txn.TxnType === 'Invoice');
    if (linked.length !== 1 || actual.has(String(linked[0].TxnId))) {
      throw fail('QuickBooks returned an unexpected payment allocation shape', 502);
    }
    const lineCents = exactQboCents(line.Amount);
    if (lineCents == null) throw fail('QuickBooks returned a fractional-cent payment allocation', 502);
    actual.set(String(linked[0].TxnId), lineCents);
  }
  if (String(qboPayment.CustomerRef?.value || '') !== fresh.customerId || expected.size !== actual.size
      || [...expected].some(([id, amount]) => actual.get(id) !== amount)) {
    throw fail('QuickBooks returned a payment that does not match the requested allocations', 502);
  }
  const totalCents = fresh.allocations.reduce((sum, row) => sum + row.amount_cents, 0);
  if (exactQboCents(qboPayment.TotalAmt) !== totalCents || exactQboCents(qboPayment.UnappliedAmt || 0) !== 0) {
    throw fail('QuickBooks returned a payment total or unapplied amount that does not match the request', 502);
  }
  if ((qboPayment.CurrencyRef?.value || 'USD') !== 'USD'
      || qboPayment.TxnDate !== input.payment_date
      || String(qboPayment.PaymentMethodRef?.value || '') !== input.qbo_payment_method_id
      || String(qboPayment.DepositToAccountRef?.value || '') !== input.deposit_account_id
      || String(qboPayment.PaymentRefNum || '') !== String(input.reference_number || '')) {
    throw fail('QuickBooks did not preserve the reviewed date, method, reference, or deposit account', 502);
  }
  return {
    ...input, qbo_realm_id: String(conn.realm_id), qbo_payment_id: String(qboPayment.Id), qbo_customer_id: fresh.customerId,
    txn_date: qboPayment.TxnDate || input.payment_date, total_cents: totalCents, applied_cents: totalCents, unapplied_cents: 0,
    source: 'upr', actor_employee_id: actorEmployeeId, qbo_sync_token: qboPayment.SyncToken || null,
    qbo_payment_method_id: qboPayment.PaymentMethodRef?.value || input.qbo_payment_method_id,
    qbo_payment_method_name: qboPayment.PaymentMethodRef?.name || selected.method.name,
    reference_number: qboPayment.PaymentRefNum || input.reference_number,
    deposit_account_id: qboPayment.DepositToAccountRef?.value || input.deposit_account_id,
    deposit_account_name: qboPayment.DepositToAccountRef?.name || selected.account.name,
    qbo_created_at: qboPayment.MetaData?.CreateTime || null, qbo_updated_at: qboPayment.MetaData?.LastUpdatedTime || null,
    normalized_snapshot: qboPayment,
  };
}

async function verifyInvoiceBalanceReadback(env, fresh) {
  const after = await Promise.all(fresh.allocations.map((row) => getQboInvoice(env, row.qbo_invoice_id)));
  for (let index = 0; index < fresh.allocations.length; index += 1) {
    const allocation = fresh.allocations[index];
    const expected = allocation.qbo_balance_cents - allocation.amount_cents;
    if (qboBalanceCents(after[index]) !== expected) {
      throw fail('QuickBooks accepted the payment but an invoice balance readback did not match; reconciliation is required', 502);
    }
  }
}

async function finalizeReceipt(db, reserve, input, conn, payment, fresh, actorEmployeeId, selected) {
  const receipt = providerReceipt(input, conn, payment, fresh, actorEmployeeId, selected);
  return receiptRow(await db.rpc('finalize_qbo_payment_receipt', {
    p_attempt_id: reserve.attempt_id,
    p_receipt: receipt,
    p_allocations: fresh.allocations.map((row) => ({ invoice_id: row.invoice_id, amount_cents: row.amount_cents, qbo_invoice_id: row.qbo_invoice_id, payer_type: input.payer_type })),
  }));
}

export async function onRequestOptions(context) { return handleOptions(context.request, context.env); }

export async function onRequestGet(context) {
  const { request, env } = context;
  const db = supabase(env, fetchWithTimeout);
  const auth = await authorizeQboBrowserRequest(request, env, db, fetchWithTimeout);
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status, request, env);
  if (!(await isReceivePaymentsGateOpen(env, db))) return jsonResponse({ error: 'Receive payments is disabled' }, 503, request, env);
  const contactId = new URL(request.url).searchParams.get('contact_id');
  try {
    if (!contactId) {
      const contacts = await db.select('contacts', 'qbo_customer_id=not.is.null&select=id,name,qbo_customer_id&order=name.asc&limit=500');
      return jsonResponse({ ok: true, contacts: (contacts || []).map(({ id, name }) => ({ id, name })) }, 200, request, env);
    }
    const contact = await localContact(db, contactId);
    if (!contact?.qbo_customer_id) return jsonResponse({ error: 'QBO-linked contact not found' }, 404, request, env);
    const invoices = await localInvoices(db, contactId);
    // The list renders from UPR's own invoice mirror — one database read, no
    // per-invoice QuickBooks round trips (a nine-invoice customer used to pay
    // 9 provider calls just to see the screen; owner-reported slow 2026-08-06).
    // Money exactness is unchanged: reservation re-reads every allocated
    // invoice live from QuickBooks (requireFreshAllocations) and the created
    // Payment plus post-write balance deltas are verified before finalizing,
    // so a stale mirror row can only produce a clear refusal at submit, never
    // a wrong payment.
    const freshInvoices = [];
    for (const invoice of invoices || []) {
      const balanceCents = Math.round(Number(invoice.balance_due || 0) * 100);
      if (Number.isFinite(balanceCents) && balanceCents > 0) {
        freshInvoices.push({
          id: invoice.id,
          invoice_number: invoice.invoice_number,
          balance_cents: balanceCents,
          job_id: invoice.job_id || null,
        });
      }
    }
    const jobContext = await jobContextForInvoices(db, freshInvoices);
    const options = await qboOptions(env);
    return jsonResponse({
      ok: true,
      contact: { id: contact.id, name: contact.name },
      invoices: freshInvoices.map(({ job_id: jobId, ...invoice }) => ({
        ...invoice,
        ...(jobContext.get(String(jobId)) || {}),
      })),
      payment_methods: options.methods,
      deposit_accounts: options.accounts,
    }, 200, request, env);
  } catch (error) {
    // Failure-only telemetry: a device-side "Could not load payment options"
    // otherwise leaves no server-side trace to diagnose.
    await recordWorkerRun(db, {
      workerName: 'qbo-receive-payment',
      status: 'error',
      errorMessage: `GET options: ${error?.message || 'unknown'}`,
      meta: { phase: 'options_get', qbo_code: error?.qboCode || null },
    });
    return jsonResponse({
      error: publicReceiptError(error),
      intuit_tid: error.intuitTid || null,
    }, 502, request, env);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const startedAt = new Date().toISOString();
  const db = supabase(env, fetchWithTimeout);
  const auth = await authorizeQboBrowserRequest(request, env, db, fetchWithTimeout);
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status, request, env);
  if (!(await isReceivePaymentsGateOpen(env, db))) return jsonResponse({ error: 'Receive payments is disabled' }, 503, request, env);
  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid JSON' }, 400, request, env); }
  let input;
  try { input = validateReceiptRequest(body); } catch (error) { return jsonResponse({ error: error.message }, 400, request, env); }
  try {
    const conn = await getConnection(env);
    if (!conn?.refresh_token || !conn.realm_id) return jsonResponse({ error: 'QuickBooks not connected' }, 409, request, env);
    const contact = await localContact(db, input.contact_id);
    if (!contact?.qbo_customer_id) return jsonResponse({ error: 'QBO-linked contact not found' }, 404, request, env);
    const requestFingerprint = await receiptFingerprint(input);
    const requestId = intuitRequestId(input.client_request_id);
    const reserve = receiptRow(await db.rpc('reserve_qbo_payment_receipt', {
      p_client_request_id: input.client_request_id,
      p_intuit_request_id: requestId,
      p_realm_id: String(conn.realm_id),
      p_request_fingerprint: requestFingerprint,
      p_request: input,
      p_actor_employee_id: auth.employee.id,
    }));
    if (!reserve?.attempt_id) throw new Error('Receipt reservation did not return an attempt id');
    if (reserve.qbo_payment_id && reserve.receipt_id && ['locally_finalized', 'reconciled'].includes(reserve.status)) {
      return jsonResponse({ ok: true, resumed: true, qbo_payment_id: reserve.qbo_payment_id, receipt_id: reserve.receipt_id }, 200, request, env);
    }
    if (['conflict', 'voided', 'deleted'].includes(reserve.status)) {
      const label = reserve.status === 'conflict'
        ? 'requires QuickBooks reconciliation'
        : `was ${reserve.status} in QuickBooks`;
      return jsonResponse({
        error: `This payment ${label}; the original request cannot be submitted again.`,
        outcome: reserve.status,
        retry_unchanged: false,
      }, 409, request, env);
    }
    const verifyBalanceDelta = !reserve.replayed || reserve.status === 'rejected';
    let fresh;
    let qboPayment;
    let providerMutationStarted = false;
    try {
      const options = await qboOptions(env);
      const selected = selectedOptions(input, options);
      fresh = await requireFreshAllocations(env, db, input, contact, {
        requireOpenBalance: verifyBalanceDelta,
      });
      if (reserve.qbo_payment_id) {
        qboPayment = await getQboPayment(env, reserve.qbo_payment_id);
      } else {
        providerMutationStarted = true;
        qboPayment = await createAllocatedPayment(env, {
          customerId: fresh.customerId,
          allocations: fresh.allocations.map((row) => ({ qboInvoiceId: row.qbo_invoice_id, amountCents: row.amount_cents })),
          txnDate: input.payment_date,
          paymentMethodId: input.qbo_payment_method_id,
          paymentRefNum: input.reference_number,
          depositAccountId: input.deposit_account_id,
          privateNote: `UPR receipt ${input.client_request_id}`,
          requestId,
        });
      }
      if (!qboPayment?.Id) throw fail('QuickBooks did not return the created payment', 502);
      if (!reserve.qbo_payment_id) {
        const marked = receiptRow(await db.rpc('mark_qbo_payment_receipt_created', {
          p_attempt_id: reserve.attempt_id, p_qbo_payment_id: String(qboPayment.Id), p_provider_snapshot: qboPayment,
        }));
        if (marked?.conflict === true || marked?.status === 'conflict') {
          const conflict = fail('QuickBooks payment is already claimed by another receipt; reconciliation is required', 409);
          conflict.receiptConflict = true;
          throw conflict;
        }
        if (marked?.ignored_terminal === true || ['voided', 'deleted'].includes(marked?.status)) {
          const terminal = fail(`QuickBooks reports that this payment was ${marked.status}; the receipt cannot be finalized`, 409);
          terminal.receiptTerminal = true;
          terminal.receiptOutcome = marked.status;
          throw terminal;
        }
      }
      if (verifyBalanceDelta) await verifyInvoiceBalanceReadback(env, fresh);
      const finalized = await finalizeReceipt(db, reserve, input, conn, qboPayment, fresh, auth.employee.id, selected);
      await recordWorkerRun(db, { workerName: 'qbo-receive-payment', status: 'completed', recordsProcessed: fresh.allocations.length, startedAt, meta: { receipt_id: finalized?.receipt_id || null } });
      return jsonResponse({ ok: true, qbo_payment_id: String(qboPayment.Id), receipt_id: finalized?.receipt_id || reserve.receipt_id || null }, 200, request, env);
    } catch (error) {
      const deterministicProviderRejection = providerMutationStarted
        && Number(error?.status) >= 400
        && Number(error?.status) < 500
        && ![408, 409, 425, 429].includes(Number(error.status));
      const unknownOutcome = !!qboPayment?.Id || !!reserve.qbo_payment_id
        || (providerMutationStarted && !deterministicProviderRejection);
      if (deterministicProviderRejection && !error.httpStatus) error.httpStatus = 409;
      if (!error.receiptConflict && !error.receiptTerminal) {
        await db.rpc('fail_qbo_payment_receipt_attempt', {
          p_attempt_id: reserve.attempt_id,
          p_status: unknownOutcome ? 'unknown_outcome' : 'rejected',
          p_error_code: error.qboCode ? String(error.qboCode) : null,
          p_error_message: String(error.message || error).slice(0, 500),
        }).catch(() => {});
        error.receiptOutcome = unknownOutcome ? 'unknown' : 'rejected';
      }
      throw error;
    }
  } catch (error) {
    await recordWorkerRun(db, {
      workerName: 'qbo-receive-payment',
      status: 'error',
      errorMessage: String(error.message || error).slice(0, 500),
      startedAt,
    });
    return jsonResponse({
      error: publicReceiptError(error),
      conflict: error.receiptConflict || undefined,
      outcome: error.receiptOutcome || null,
      retry_unchanged: error.receiptOutcome === 'unknown',
      intuit_tid: error.intuitTid || null,
    }, error.httpStatus || (error.receiptOutcome === 'unknown' ? 502 : 500), request, env);
  }
}
