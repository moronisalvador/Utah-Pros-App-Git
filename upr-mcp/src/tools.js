// Tool registry for the QBO MCP server.
//
// Conventions:
//   - Every WRITE tool requires `confirm: true`. Called without it, the tool does
//     NOT touch QBO; it returns a { preview } describing exactly what it would do.
//     This is the per-call write-confirmation guard.
//   - Reads never mutate and don't need confirm.
//   - Every call (read + write, preview + execute) is audit-logged by the caller.

import { qboQuery, qboGet, qboCreate, qboSparseUpdate, qboDelete, qboReport, qboSend } from './qbo.js';
import {
  encircleGet, encircleRequest, encircleGetClaim, encircleListClaims,
  encircleUpdateClaim, encircleCreateClaim, encircleWebappLink,
} from './encircle.js';
import {
  resendGet, resendRequest, resendSend, resendGetEmail,
  resendListDomains, resendGetDomain, resendVerifyDomain,
} from './resend.js';
import {
  callrailGet, callrailRequest, callrailListCalls, callrailGetCall,
  callrailListFormSubmissions, resolveRecording, deepgramTranscribeUrl,
} from './callrail.js';
import {
  stripeGet, stripeRequest, getBalance as stripeGetBalance, listCharges as stripeListCharges,
  retrieveCharge as stripeRetrieveCharge, listPayouts as stripeListPayouts,
  listExternalAccounts as stripeListExternalAccounts, createPayout as stripeCreatePayout,
  createPaymentLink as stripeCreatePaymentLink,
} from './stripe.js';
import {
  twilioGet, twilioRequest, listMessages as twilioListMessages,
  getMessage as twilioGetMessage, sendMessage as twilioSendMessage,
} from './twilio.js';
import { googleAdsQuery, campaignSpend as googleAdsCampaignSpend } from './googleads.js';
import { metaGet, campaignInsights as metaCampaignInsights } from './metaads.js';
import {
  githubGet, githubRequest, listPulls as githubListPulls, getPull as githubGetPull,
  listIssues as githubListIssues, searchCode as githubSearchCode, createIssue as githubCreateIssue,
  mergePull as githubMergePull, createPull as githubCreatePull, updatePull as githubUpdatePull,
  createBranch as githubCreateBranch, getFile as githubGetFile, commitFile as githubCommitFile,
  listCommits as githubListCommits, getCommit as githubGetCommit, listBranches as githubListBranches,
  addComment as githubAddComment,
} from './github.js';
import { supabase } from './supabase.js';
import { searchCodeContext } from './codeContext.js';

const n = (v) => (v == null ? v : Number(v));
const esc = (s) => String(s).replace(/'/g, "\\'");

function buildInvoiceLines(lines) {
  return (lines || []).map((l) => ({
    DetailType: 'SalesItemLineDetail',
    Amount: n(l.amount),
    ...(l.description ? { Description: l.description } : {}),
    SalesItemLineDetail: {
      ItemRef: { value: String(l.item_id) },
      ...(l.qty != null ? { Qty: n(l.qty) } : {}),
      ...(l.unit_price != null ? { UnitPrice: n(l.unit_price) } : {}),
      ...(l.class_id ? { ClassRef: { value: String(l.class_id) } } : {}),
    },
  }));
}

const preview = (plan, details) => ({ preview: true, note: 'Nothing was changed. Call again with confirm:true to execute.', plan, details });

export const TOOLS = {
  // ── READ ────────────────────────────────────────────────────────────────────
  qbo_query: {
    write: false,
    description: 'Run a read-only QuickBooks SQL SELECT (e.g. "SELECT * FROM Invoice WHERE DocNumber = \'1250\'"). Returns matching rows. Only SELECT is allowed.',
    inputSchema: { type: 'object', properties: { sql: { type: 'string', description: 'A QBO SELECT statement.' } }, required: ['sql'] },
    run: (env, a) => qboQuery(env, a.sql),
  },
  qbo_get: {
    write: false,
    description: 'Fetch a single QBO entity by Id, including its full fields and SyncToken. entity is e.g. Invoice, Payment, Customer, Item.',
    inputSchema: { type: 'object', properties: { entity: { type: 'string' }, id: { type: 'string' } }, required: ['entity', 'id'] },
    run: (env, a) => qboGet(env, a.entity, a.id),
  },
  qbo_list_invoices: {
    write: false,
    description: 'List invoices, optionally filtered by customer_id or doc_number. Returns id, DocNumber, totals, balance, customer, due date.',
    inputSchema: { type: 'object', properties: { customer_id: { type: 'string' }, doc_number: { type: 'string' }, limit: { type: 'number' } } },
    run: async (env, a) => {
      let where = [];
      if (a.customer_id) where.push(`CustomerRef = '${esc(a.customer_id)}'`);
      if (a.doc_number) where.push(`DocNumber = '${esc(a.doc_number)}'`);
      const sql = `SELECT * FROM Invoice${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDERBY TxnDate DESC MAXRESULTS ${Math.min(a.limit || 50, 200)}`;
      const qr = await qboQuery(env, sql);
      return (qr.Invoice || []).map((i) => ({
        id: i.Id, doc_number: i.DocNumber, total: i.TotalAmt, balance: i.Balance,
        paid: Number(i.TotalAmt) - Number(i.Balance), customer: i.CustomerRef, txn_date: i.TxnDate, due_date: i.DueDate,
      }));
    },
  },
  qbo_list_payments: {
    write: false,
    description: 'List payments for a customer, including which invoice(s) each payment is applied to (LinkedTxn). Use this to find payments before re-linking them.',
    inputSchema: { type: 'object', properties: { customer_id: { type: 'string' }, limit: { type: 'number' } }, required: ['customer_id'] },
    run: async (env, a) => {
      const qr = await qboQuery(env, `SELECT * FROM Payment WHERE CustomerRef = '${esc(a.customer_id)}' ORDERBY TxnDate DESC MAXRESULTS ${Math.min(a.limit || 50, 200)}`);
      return (qr.Payment || []).map((p) => ({
        id: p.Id, total: p.TotalAmt, txn_date: p.TxnDate, sync_token: p.SyncToken,
        applied_to: (p.Line || []).flatMap((l) => (l.LinkedTxn || []).filter((t) => t.TxnType === 'Invoice').map((t) => ({ invoice_id: t.TxnId, amount: l.Amount }))),
        unapplied: p.UnappliedAmt,
      }));
    },
  },
  qbo_report: {
    write: false,
    description: 'Run a QBO report: ProfitAndLoss, BalanceSheet, AgedReceivables, AgedReceivableDetail, etc. Optional start_date/end_date (YYYY-MM-DD).',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, start_date: { type: 'string' }, end_date: { type: 'string' } }, required: ['name'] },
    run: (env, a) => qboReport(env, a.name, { ...(a.start_date ? { start_date: a.start_date } : {}), ...(a.end_date ? { end_date: a.end_date } : {}) }),
  },

  // ── WRITE: invoices ──────────────────────────────────────────────────────────
  qbo_create_invoice: {
    write: true,
    description: 'Create an invoice. lines = [{item_id, amount, description?, qty?, unit_price?, class_id?}].',
    inputSchema: { type: 'object', properties: {
      customer_id: { type: 'string' }, lines: { type: 'array' }, doc_number: { type: 'string' },
      due_date: { type: 'string' }, memo: { type: 'string' }, confirm: { type: 'boolean' },
    }, required: ['customer_id', 'lines'] },
    run: async (env, a) => {
      const payload = {
        CustomerRef: { value: String(a.customer_id) },
        Line: buildInvoiceLines(a.lines),
        ...(a.doc_number ? { DocNumber: String(a.doc_number) } : {}),
        ...(a.due_date ? { DueDate: a.due_date } : {}),
        ...(a.memo ? { PrivateNote: a.memo } : {}),
      };
      if (!a.confirm) return preview(`Create invoice for customer ${a.customer_id} with ${payload.Line.length} line(s).`, payload);
      return qboCreate(env, 'Invoice', payload);
    },
  },
  qbo_update_invoice: {
    write: true,
    description: 'Sparse-update an invoice. Provide lines to replace the line set (changes the total), and/or memo/due_date.',
    inputSchema: { type: 'object', properties: {
      invoice_id: { type: 'string' }, lines: { type: 'array' }, due_date: { type: 'string' },
      memo: { type: 'string' }, confirm: { type: 'boolean' },
    }, required: ['invoice_id'] },
    run: async (env, a) => {
      const fields = {
        ...(a.lines ? { Line: buildInvoiceLines(a.lines) } : {}),
        ...(a.due_date ? { DueDate: a.due_date } : {}),
        ...(a.memo ? { PrivateNote: a.memo } : {}),
      };
      if (!a.confirm) return preview(`Update invoice ${a.invoice_id}.`, fields);
      return qboSparseUpdate(env, 'Invoice', a.invoice_id, fields);
    },
  },
  qbo_delete_invoice: {
    write: true,
    description: 'Delete an invoice. GUARDED: refuses if the invoice has any payment applied (balance != total) — re-link or delete its payments first.',
    inputSchema: { type: 'object', properties: { invoice_id: { type: 'string' }, confirm: { type: 'boolean' } }, required: ['invoice_id'] },
    run: async (env, a) => {
      const inv = await qboGet(env, 'Invoice', a.invoice_id);
      if (!inv) throw new Error(`Invoice ${a.invoice_id} not found.`);
      const paid = Number(inv.TotalAmt) - Number(inv.Balance);
      if (paid > 0.005) throw new Error(`Refusing to delete invoice ${inv.DocNumber || a.invoice_id}: it has $${paid.toFixed(2)} in payments applied. Re-link those payments to another invoice first (qbo_relink_payment), then delete.`);
      if (!a.confirm) return preview(`Delete invoice ${inv.DocNumber || a.invoice_id} (total $${inv.TotalAmt}, no payments applied).`, { id: a.invoice_id, doc_number: inv.DocNumber, total: inv.TotalAmt });
      await qboDelete(env, 'Invoice', a.invoice_id);
      return { ok: true, deleted_invoice_id: a.invoice_id, doc_number: inv.DocNumber };
    },
  },

  // ── WRITE: payments ────────────────────────────────────────────────────────
  qbo_create_payment: {
    write: true,
    description: 'Record a customer payment applied to an invoice.',
    inputSchema: { type: 'object', properties: {
      customer_id: { type: 'string' }, invoice_id: { type: 'string' }, amount: { type: 'number' },
      txn_date: { type: 'string' }, memo: { type: 'string' }, confirm: { type: 'boolean' },
    }, required: ['customer_id', 'invoice_id', 'amount'] },
    run: async (env, a) => {
      const payload = {
        CustomerRef: { value: String(a.customer_id) }, TotalAmt: n(a.amount),
        ...(a.txn_date ? { TxnDate: a.txn_date } : {}), ...(a.memo ? { PrivateNote: a.memo } : {}),
        Line: [{ Amount: n(a.amount), LinkedTxn: [{ TxnId: String(a.invoice_id), TxnType: 'Invoice' }] }],
      };
      if (!a.confirm) return preview(`Record $${a.amount} payment from customer ${a.customer_id} applied to invoice ${a.invoice_id}.`, payload);
      return qboCreate(env, 'Payment', payload);
    },
  },
  qbo_relink_payment: {
    write: true,
    description: 'Move an existing payment from one invoice to another (re-applies the payment\'s lines to to_invoice_id). The key tool for fixing a payment recorded against the wrong/duplicate invoice. Optionally restrict to lines currently linked to from_invoice_id.',
    inputSchema: { type: 'object', properties: {
      payment_id: { type: 'string' }, to_invoice_id: { type: 'string' }, from_invoice_id: { type: 'string' }, confirm: { type: 'boolean' },
    }, required: ['payment_id', 'to_invoice_id'] },
    run: async (env, a) => {
      const pay = await qboGet(env, 'Payment', a.payment_id);
      if (!pay) throw new Error(`Payment ${a.payment_id} not found.`);
      const target = await qboGet(env, 'Invoice', a.to_invoice_id);
      if (!target) throw new Error(`Target invoice ${a.to_invoice_id} not found.`);
      if (String(target.CustomerRef?.value) !== String(pay.CustomerRef?.value)) {
        throw new Error(`Customer mismatch: payment customer ${pay.CustomerRef?.value} vs invoice customer ${target.CustomerRef?.value}. A payment can only be applied to invoices of the same customer.`);
      }
      // Re-point each invoice-linked line to the target invoice. Lines with no
      // invoice link (or linked to a different invoice when from_invoice_id is set) are preserved.
      const oldLinks = [];
      const newLine = (pay.Line || []).map((l) => {
        const linked = (l.LinkedTxn || []).map((t) => {
          if (t.TxnType === 'Invoice' && (!a.from_invoice_id || String(t.TxnId) === String(a.from_invoice_id))) {
            oldLinks.push({ from: t.TxnId, amount: l.Amount });
            return { TxnId: String(a.to_invoice_id), TxnType: 'Invoice' };
          }
          return t;
        });
        return { ...l, LinkedTxn: linked };
      });
      // If the payment had nothing applied, apply the full amount to the target.
      if (oldLinks.length === 0) {
        newLine.push({ Amount: n(pay.TotalAmt), LinkedTxn: [{ TxnId: String(a.to_invoice_id), TxnType: 'Invoice' }] });
      }
      const summary = { payment_id: a.payment_id, payment_total: pay.TotalAmt, moved: oldLinks, to_invoice: { id: target.Id, doc_number: target.DocNumber, balance_before: target.Balance } };
      if (!a.confirm) return preview(`Move payment ${a.payment_id} ($${pay.TotalAmt}) onto invoice ${target.DocNumber || a.to_invoice_id}. Target balance is $${target.Balance} now and will drop by the re-applied amount.`, summary);
      const updated = await qboSparseUpdate(env, 'Payment', a.payment_id, { Line: newLine });
      return { ok: true, ...summary, payment_after: { id: updated.Id, applied: (updated.Line || []).flatMap((l) => (l.LinkedTxn || []).map((t) => ({ invoice_id: t.TxnId, amount: l.Amount }))) } };
    },
  },
  qbo_delete_payment: {
    write: true,
    description: 'Delete a payment. The amount becomes un-received (removes the cash-in record). Use with care.',
    inputSchema: { type: 'object', properties: { payment_id: { type: 'string' }, confirm: { type: 'boolean' } }, required: ['payment_id'] },
    run: async (env, a) => {
      const pay = await qboGet(env, 'Payment', a.payment_id);
      if (!pay) throw new Error(`Payment ${a.payment_id} not found.`);
      if (!a.confirm) return preview(`Delete payment ${a.payment_id} ($${pay.TotalAmt}).`, { id: a.payment_id, total: pay.TotalAmt });
      await qboDelete(env, 'Payment', a.payment_id);
      return { ok: true, deleted_payment_id: a.payment_id, total: pay.TotalAmt };
    },
  },

  // ── WRITE: customers / items ─────────────────────────────────────────────────
  qbo_create_customer: {
    write: true,
    description: 'Create a customer.',
    inputSchema: { type: 'object', properties: {
      display_name: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, company: { type: 'string' }, confirm: { type: 'boolean' },
    }, required: ['display_name'] },
    run: async (env, a) => {
      const payload = {
        DisplayName: a.display_name,
        ...(a.company ? { CompanyName: a.company } : {}),
        ...(a.email ? { PrimaryEmailAddr: { Address: a.email } } : {}),
        ...(a.phone ? { PrimaryPhone: { FreeFormNumber: a.phone } } : {}),
      };
      if (!a.confirm) return preview(`Create customer "${a.display_name}".`, payload);
      return qboCreate(env, 'Customer', payload);
    },
  },
  qbo_update_customer: {
    write: true,
    description: 'Sparse-update a customer. fields is a raw QBO Customer patch (e.g. {"PrimaryEmailAddr":{"Address":"x@y.com"}}).',
    inputSchema: { type: 'object', properties: { customer_id: { type: 'string' }, fields: { type: 'object' }, confirm: { type: 'boolean' } }, required: ['customer_id', 'fields'] },
    run: async (env, a) => {
      if (!a.confirm) return preview(`Update customer ${a.customer_id}.`, a.fields);
      return qboSparseUpdate(env, 'Customer', a.customer_id, a.fields);
    },
  },
  qbo_create_item: {
    write: true,
    description: 'Create a product/service item. type is Service or Inventory (default Service). income_account_id is required by QBO for most items.',
    inputSchema: { type: 'object', properties: {
      name: { type: 'string' }, type: { type: 'string' }, income_account_id: { type: 'string' }, confirm: { type: 'boolean' },
    }, required: ['name'] },
    run: async (env, a) => {
      const payload = { Name: a.name, Type: a.type || 'Service', ...(a.income_account_id ? { IncomeAccountRef: { value: String(a.income_account_id) } } : {}) };
      if (!a.confirm) return preview(`Create ${payload.Type} item "${a.name}".`, payload);
      return qboCreate(env, 'Item', payload);
    },
  },

  // ── WRITE: generic power tools (cover any entity) ─────────────────────────────
  qbo_create_entity: {
    write: true,
    description: 'Power tool: create any QBO entity. entity e.g. Invoice/Estimate/Bill/Vendor/Account; payload is the raw QBO object.',
    inputSchema: { type: 'object', properties: { entity: { type: 'string' }, payload: { type: 'object' }, confirm: { type: 'boolean' } }, required: ['entity', 'payload'] },
    run: async (env, a) => {
      if (!a.confirm) return preview(`Create ${a.entity}.`, a.payload);
      return qboCreate(env, a.entity, a.payload);
    },
  },
  qbo_update_entity: {
    write: true,
    description: 'Power tool: sparse-update any QBO entity by Id. fields is the raw patch; SyncToken is handled for you.',
    inputSchema: { type: 'object', properties: { entity: { type: 'string' }, id: { type: 'string' }, fields: { type: 'object' }, confirm: { type: 'boolean' } }, required: ['entity', 'id', 'fields'] },
    run: async (env, a) => {
      if (!a.confirm) return preview(`Update ${a.entity} ${a.id}.`, a.fields);
      return qboSparseUpdate(env, a.entity, a.id, a.fields);
    },
  },
  qbo_delete_entity: {
    write: true,
    description: 'Power tool: delete any QBO entity by Id. SyncToken is handled for you.',
    inputSchema: { type: 'object', properties: { entity: { type: 'string' }, id: { type: 'string' }, confirm: { type: 'boolean' } }, required: ['entity', 'id'] },
    run: async (env, a) => {
      if (!a.confirm) return preview(`Delete ${a.entity} ${a.id}.`, { entity: a.entity, id: a.id });
      return qboDelete(env, a.entity, a.id);
    },
  },

  // ── QBO convenience: send + estimates ────────────────────────────────────────
  qbo_list_estimates: {
    write: false,
    description: 'List QBO estimates, optionally filtered by customer_id.',
    inputSchema: { type: 'object', properties: { customer_id: { type: 'string' }, limit: { type: 'number' } } },
    run: async (env, a) => {
      const where = a.customer_id ? ` WHERE CustomerRef = '${esc(a.customer_id)}'` : '';
      const qr = await qboQuery(env, `SELECT * FROM Estimate${where} ORDERBY TxnDate DESC MAXRESULTS ${Math.min(a.limit || 50, 200)}`);
      return (qr.Estimate || []).map((e) => ({ id: e.Id, doc_number: e.DocNumber, total: e.TotalAmt, status: e.TxnStatus, customer: e.CustomerRef, txn_date: e.TxnDate }));
    },
  },
  qbo_send_invoice: {
    write: true,
    description: 'Email a QBO invoice to the customer (uses the invoice billing email, or send_to to override). If QBO Payments is enabled, the email includes a pay-now link. Sends a real email — confirm carefully.',
    inputSchema: { type: 'object', properties: { invoice_id: { type: 'string' }, send_to: { type: 'string' }, confirm: { type: 'boolean' } }, required: ['invoice_id'] },
    run: async (env, a) => {
      if (!a.confirm) return preview(`Email invoice ${a.invoice_id} to the customer${a.send_to ? ' at ' + a.send_to : ''}.`, { invoice_id: a.invoice_id, send_to: a.send_to || '(billing email on file)' });
      const inv = await qboSend(env, 'invoice', a.invoice_id, a.send_to);
      return { ok: true, sent_invoice_id: a.invoice_id, email_status: inv?.EmailStatus };
    },
  },
  qbo_create_estimate: {
    write: true,
    description: 'Create a QBO estimate. lines = [{item_id, amount, description?, qty?, unit_price?, class_id?}].',
    inputSchema: { type: 'object', properties: { customer_id: { type: 'string' }, lines: { type: 'array' }, memo: { type: 'string' }, confirm: { type: 'boolean' } }, required: ['customer_id', 'lines'] },
    run: async (env, a) => {
      const payload = { CustomerRef: { value: String(a.customer_id) }, Line: buildInvoiceLines(a.lines), ...(a.memo ? { PrivateNote: a.memo } : {}) };
      if (!a.confirm) return preview(`Create estimate for customer ${a.customer_id} with ${payload.Line.length} line(s).`, payload);
      return qboCreate(env, 'Estimate', payload);
    },
  },
  qbo_send_estimate: {
    write: true,
    description: 'Email a QBO estimate to the customer (uses the estimate billing email, or send_to to override). Sends a real email — confirm carefully.',
    inputSchema: { type: 'object', properties: { estimate_id: { type: 'string' }, send_to: { type: 'string' }, confirm: { type: 'boolean' } }, required: ['estimate_id'] },
    run: async (env, a) => {
      if (!a.confirm) return preview(`Email estimate ${a.estimate_id} to the customer${a.send_to ? ' at ' + a.send_to : ''}.`, { estimate_id: a.estimate_id, send_to: a.send_to || '(billing email on file)' });
      const est = await qboSend(env, 'estimate', a.estimate_id, a.send_to);
      return { ok: true, sent_estimate_id: a.estimate_id, email_status: est?.EmailStatus };
    },
  },

  // ── Encircle (claims source-of-truth) — read + guarded write ─────────────────
  encircle_get_claim: {
    write: false,
    description: 'Fetch a single Encircle property claim by its Encircle id (jobs.encircle_claim_id). Returns the full claim incl. date_claim_created — the true date the claim was filed in Encircle (the live API returns date_claim_created, NOT a created_at field) — plus date_of_loss, status, full_address, policyholder, contractor_identifier (our CLM). Use this to recover real claim dates the UPR import did not persist.',
    inputSchema: { type: 'object', properties: { claim_id: { type: 'string' } }, required: ['claim_id'] },
    run: (env, a) => encircleGetClaim(env, a.claim_id),
  },
  encircle_list_claims: {
    write: false,
    description: 'List/search Encircle property claims (newest first → { list, cursor }). Filter by policyholder_name, contractor_identifier (our CLM#), assignment_identifier, or insurer_identifier; page with after (cursor) + limit (max 100).',
    inputSchema: { type: 'object', properties: {
      limit: { type: 'number' }, order: { type: 'string' }, after: { type: 'string' },
      policyholder_name: { type: 'string' }, contractor_identifier: { type: 'string' },
      assignment_identifier: { type: 'string' }, insurer_identifier: { type: 'string' },
    } },
    run: (env, a) => encircleListClaims(env, a),
  },
  encircle_update_claim: {
    write: true,
    description: 'Update an Encircle claim (PATCH). fields is a raw Encircle claim patch — e.g. {"contractor_identifier":"CLM-2606-152"} to write our CLM number back, or date_claim_created / date_of_loss / adjuster_name / full_address. See ENCIRCLE_API_REFERENCE.md "Update Claim" for all fields.',
    inputSchema: { type: 'object', properties: { claim_id: { type: 'string' }, fields: { type: 'object' }, confirm: { type: 'boolean' } }, required: ['claim_id', 'fields'] },
    run: async (env, a) => {
      if (!a.confirm) return preview(`Update Encircle claim ${a.claim_id}.`, a.fields);
      return encircleUpdateClaim(env, a.claim_id, a.fields);
    },
  },
  encircle_create_claim: {
    write: true,
    description: 'Create an Encircle property claim (POST). fields is a raw Encircle claim object — policyholder_name is required; common: full_address, insurance_company_name, policy_number, date_of_loss, type_of_loss, contractor_identifier (our CLM).',
    inputSchema: { type: 'object', properties: { fields: { type: 'object' }, confirm: { type: 'boolean' } }, required: ['fields'] },
    run: async (env, a) => {
      if (!a.confirm) return preview(`Create an Encircle claim for "${a.fields?.policyholder_name || '(no name)'}".`, a.fields);
      return encircleCreateClaim(env, a.fields);
    },
  },
  encircle_list_media: {
    write: false,
    description: "List a claim's media (photos/videos): url, thumbnail_url, source, room_id, when taken. Path: /v1/property_claims/{id}/media.",
    inputSchema: { type: 'object', properties: { claim_id: { type: 'string' }, source: { type: 'string' }, limit: { type: 'number' } }, required: ['claim_id'] },
    run: (env, a) => {
      const qp = new URLSearchParams({ limit: String(Math.min(Number(a.limit) || 50, 100)) });
      if (a.source) qp.set('source', a.source);
      return encircleGet(env, `/v1/property_claims/${encodeURIComponent(String(a.claim_id))}/media?${qp.toString()}`);
    },
  },
  encircle_list_notes: {
    write: false,
    description: "List a claim's notes. Path: /v2/property_claims/{id}/notes.",
    inputSchema: { type: 'object', properties: { claim_id: { type: 'string' }, limit: { type: 'number' } }, required: ['claim_id'] },
    run: (env, a) => encircleGet(env, `/v2/property_claims/${encodeURIComponent(String(a.claim_id))}/notes?limit=${Math.min(Number(a.limit) || 50, 100)}`),
  },
  encircle_create_note: {
    write: true,
    description: 'Add a note to an Encircle claim (POST /v2/property_claims/{id}/notes). text is required; title is optional.',
    inputSchema: { type: 'object', properties: { claim_id: { type: 'string' }, text: { type: 'string' }, title: { type: 'string' }, confirm: { type: 'boolean' } }, required: ['claim_id', 'text'] },
    run: async (env, a) => {
      const body = { text: a.text, ...(a.title ? { title: a.title } : {}) };
      if (!a.confirm) return preview(`Add a note to Encircle claim ${a.claim_id}.`, body);
      return encircleRequest(env, 'POST', `/v2/property_claims/${encodeURIComponent(String(a.claim_id))}/notes`, body);
    },
  },
  encircle_list_assignments: {
    write: false,
    description: "List Encircle users assigned to a claim. Path: /v1/property_claims/{id}/assignments.",
    inputSchema: { type: 'object', properties: { claim_id: { type: 'string' } }, required: ['claim_id'] },
    run: (env, a) => encircleGet(env, `/v1/property_claims/${encodeURIComponent(String(a.claim_id))}/assignments`),
  },
  encircle_assign_user: {
    write: true,
    description: 'Assign an Encircle user (by email) to a claim (POST /v1/property_claims/{id}/assignments). The user must already have an Encircle account.',
    inputSchema: { type: 'object', properties: { claim_id: { type: 'string' }, email_address: { type: 'string' }, confirm: { type: 'boolean' } }, required: ['claim_id', 'email_address'] },
    run: async (env, a) => {
      if (!a.confirm) return preview(`Assign ${a.email_address} to Encircle claim ${a.claim_id}.`, { email_address: a.email_address });
      return encircleRequest(env, 'POST', `/v1/property_claims/${encodeURIComponent(String(a.claim_id))}/assignments`, { email_address: a.email_address });
    },
  },
  encircle_unassign_user: {
    write: true,
    description: 'Remove an Encircle user (by email) from a claim (DELETE /v1/property_claims/{id}/assignments).',
    inputSchema: { type: 'object', properties: { claim_id: { type: 'string' }, email_address: { type: 'string' }, confirm: { type: 'boolean' } }, required: ['claim_id', 'email_address'] },
    run: async (env, a) => {
      if (!a.confirm) return preview(`Unassign ${a.email_address} from Encircle claim ${a.claim_id}.`, { email_address: a.email_address });
      return encircleRequest(env, 'DELETE', `/v1/property_claims/${encodeURIComponent(String(a.claim_id))}/assignments`, { email_address: a.email_address });
    },
  },
  encircle_list_structures: {
    write: false,
    description: "List the structures (buildings) in a claim. Path: /v1/property_claims/{id}/structures.",
    inputSchema: { type: 'object', properties: { claim_id: { type: 'string' } }, required: ['claim_id'] },
    run: (env, a) => encircleGet(env, `/v1/property_claims/${encodeURIComponent(String(a.claim_id))}/structures?limit=100`),
  },
  encircle_list_rooms: {
    write: false,
    description: "List the rooms in a structure. Path: /v1/property_claims/{id}/structures/{structure_id}/rooms.",
    inputSchema: { type: 'object', properties: { claim_id: { type: 'string' }, structure_id: { type: 'string' } }, required: ['claim_id', 'structure_id'] },
    run: (env, a) => encircleGet(env, `/v1/property_claims/${encodeURIComponent(String(a.claim_id))}/structures/${encodeURIComponent(String(a.structure_id))}/rooms?limit=100`),
  },
  encircle_webapp_link: {
    write: false,
    description: 'Get a deep link that opens this claim in the Encircle web app (resolves the webapp_redirect 302 to its URL).',
    inputSchema: { type: 'object', properties: { claim_id: { type: 'string' } }, required: ['claim_id'] },
    run: (env, a) => encircleWebappLink(env, a.claim_id),
  },
  encircle_get: {
    write: false,
    description: 'Power tool: GET any Encircle API path (read-only). e.g. "/v2/property_claims/123/rooms/456", "/v2/equipment", "/v1/organizations". Use for endpoints without a dedicated tool. See ENCIRCLE_API_REFERENCE.md.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    run: (env, a) => encircleGet(env, a.path),
  },
  encircle_request: {
    write: true,
    description: 'Power tool: call any Encircle endpoint with any method (POST/PATCH/PUT/DELETE). method + path + optional body. Covers anything without a dedicated tool (structures, rooms, equipment, webhooks, brands). Guarded — preview unless confirm:true.',
    inputSchema: { type: 'object', properties: { method: { type: 'string' }, path: { type: 'string' }, body: { type: 'object' }, confirm: { type: 'boolean' } }, required: ['method', 'path'] },
    run: async (env, a) => {
      if (!a.confirm) return preview(`${String(a.method).toUpperCase()} ${a.path} on Encircle.`, a.body || {});
      return encircleRequest(env, a.method, a.path, a.body);
    },
  },

  // ── Resend (transactional email) — test + troubleshoot ───────────────────────
  resend_send_test_email: {
    write: true,
    description: 'Send a test email through Resend — the same provider UPR uses for esign links, the scope/demo sheet, the water-loss report, and billing 2FA. From defaults to the verified utahpros.app sender; Reply-To stays on the same domain. Sends a REAL email — confirm carefully.',
    inputSchema: { type: 'object', properties: {
      to: { description: 'recipient — string "a@b.com", {email,name}, or an array of either' },
      subject: { type: 'string' }, html: { type: 'string' }, text: { type: 'string' },
      from: { type: 'string' }, reply_to: { type: 'string' }, confirm: { type: 'boolean' },
    }, required: ['to'] },
    run: async (env, a) => {
      if (!a.confirm) return preview(`Send a test email to ${JSON.stringify(a.to)} (subject: "${a.subject || '(none)'}").`, { to: a.to, subject: a.subject, from: a.from || '(default utahpros.app sender)' });
      const r = await resendSend(env, { to: a.to, subject: a.subject, html: a.html, text: a.text, from: a.from, replyTo: a.reply_to });
      return { ok: true, email_id: r?.id || null };
    },
  },
  resend_get_email: {
    write: false,
    description: 'Look up one sent email by its Resend id to see delivery status (last_event: sent / delivered / delivery_delayed / bounced / complained), recipients, subject, and timestamps. Use to answer "did the customer actually get it?".',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    run: (env, a) => resendGetEmail(env, a.id),
  },
  resend_list_domains: {
    write: false,
    description: 'List Resend sending domains with their verification + DKIM/SPF/DMARC status. First stop when troubleshooting email deliverability (see EMAIL-DELIVERABILITY.md).',
    inputSchema: { type: 'object', properties: {} },
    run: (env) => resendListDomains(env),
  },
  resend_get_domain: {
    write: false,
    description: 'Get one Resend domain by id, including its full DNS record set (DKIM/SPF/DMARC) and each record\'s verification status.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    run: (env, a) => resendGetDomain(env, a.id),
  },
  resend_verify_domain: {
    write: true,
    description: 'Re-trigger verification for a Resend domain (POST /domains/{id}/verify) after fixing DNS records.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, confirm: { type: 'boolean' } }, required: ['id'] },
    run: async (env, a) => {
      if (!a.confirm) return preview(`Re-verify Resend domain ${a.id}.`, { id: a.id });
      return resendVerifyDomain(env, a.id);
    },
  },
  resend_get: {
    write: false,
    description: 'Power tool: GET any Resend API path (read-only). e.g. "/emails/{id}", "/domains", "/api-keys", "/audiences". Use for endpoints without a dedicated tool.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    run: (env, a) => resendGet(env, a.path),
  },
  resend_request: {
    write: true,
    description: 'Power tool: call any Resend endpoint with any method (POST/PATCH/DELETE). method + path + optional body. Covers anything without a dedicated tool (batch send, audiences, broadcasts, api-keys). Guarded — preview unless confirm:true.',
    inputSchema: { type: 'object', properties: { method: { type: 'string' }, path: { type: 'string' }, body: { type: 'object' }, confirm: { type: 'boolean' } }, required: ['method', 'path'] },
    run: async (env, a) => {
      if (!a.confirm) return preview(`${String(a.method).toUpperCase()} ${a.path} on Resend.`, a.body || {});
      return resendRequest(env, a.method, a.path, a.body);
    },
  },

  // ── UPR (Supabase) — read + write the app's own database ─────────────────────
  upr_select: {
    write: false,
    description: 'Read rows from a UPR (Supabase) table via a PostgREST query string. Example: table="jobs", query="status=eq.active&select=*&order=created_at.desc&limit=20".',
    inputSchema: { type: 'object', properties: { table: { type: 'string' }, query: { type: 'string' } }, required: ['table'] },
    run: (env, a) => supabase(env).select(a.table, a.query || ''),
  },
  upr_sql: {
    write: false,
    description: 'Run a READ-ONLY SQL query (SELECT/WITH only) against the UPR database and get JSON rows back. For aggregates, GROUP BY, date_trunc and multi-table joins that PostgREST (upr_select) is clumsy at — e.g. monthly revenue, claim/job counts by created_at date, orphaned-record audits. Enforced read-only: non-SELECT is rejected and it runs in a read-only transaction with a statement timeout (via the exec_read_sql DB function).',
    inputSchema: { type: 'object', properties: { sql: { type: 'string' } }, required: ['sql'] },
    run: (env, a) => {
      const s = String(a.sql || '').trim();
      if (!/^(select|with)\s/i.test(s)) throw new Error('Only SELECT/WITH read-only queries are allowed in upr_sql.');
      return supabase(env).rpc('exec_read_sql', { p_query: s });
    },
  },
  upr_rpc: {
    write: false,
    description: 'Call a UPR Supabase RPC by name. Read functions (names starting get_/list_/search_/preview_/count_/fetch_) run immediately. Any other (mutating) function requires confirm:true and returns a preview first. Every call is audit-logged.',
    inputSchema: { type: 'object', properties: { fn: { type: 'string' }, params: { type: 'object' }, confirm: { type: 'boolean' } }, required: ['fn'] },
    run: async (env, a) => {
      const fn = String(a.fn || '');
      const isRead = /^(get_|list_|search_|preview_|count_|fetch_)/.test(fn);
      if (!isRead && !a.confirm) return preview(`Call mutating RPC ${fn}(...) — this may change data.`, { fn, params: a.params || {} });
      return supabase(env).rpc(fn, a.params || {});
    },
  },
  upr_schema: {
    write: false,
    description: 'Discover what exists in UPR: returns the list of database tables and callable RPC functions (then use upr_select / upr_rpc). Good first call when grabbing info about claims, clients, jobs, schedule, etc.',
    inputSchema: { type: 'object', properties: {} },
    run: async (env) => {
      const doc = await supabase(env).openapi();
      const tables = Object.keys(doc.definitions || {}).sort();
      const functions = Object.keys(doc.paths || {}).filter((p) => p.startsWith('/rpc/')).map((p) => p.slice(5)).sort();
      return { tables, functions };
    },
  },
  upr_describe: {
    write: false,
    description: 'Describe a UPR table (its columns) or an RPC function (its parameters), so you can build correct upr_select/upr_insert/upr_update queries and upr_rpc calls. Pass the exact table or function name.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    run: async (env, a) => {
      const doc = await supabase(env).openapi();
      const name = String(a.name || '');
      const def = (doc.definitions || {})[name];
      if (def && def.properties) {
        return {
          type: 'table', name, required: def.required || [],
          columns: Object.entries(def.properties).map(([col, p]) => ({ name: col, type: p.format || p.type, description: p.description })),
        };
      }
      const rpc = (doc.paths || {})['/rpc/' + name];
      if (rpc && rpc.post) {
        const params = [];
        for (const p of (rpc.post.parameters || [])) {
          if (p.in === 'body' && p.schema) {
            const schema = p.schema.$ref ? (doc.definitions || {})[p.schema.$ref.split('/').pop()] : p.schema;
            for (const [pn, pp] of Object.entries((schema && schema.properties) || {})) params.push({ name: pn, type: pp.format || pp.type });
          } else if (p.name) {
            params.push({ name: p.name, type: p.type, required: !!p.required });
          }
        }
        return { type: 'function', name, parameters: params };
      }
      const tables = Object.keys(doc.definitions || {}).filter((t) => t.toLowerCase().includes(name.toLowerCase())).slice(0, 8);
      const functions = Object.keys(doc.paths || {}).filter((p) => p.startsWith('/rpc/') && p.toLowerCase().includes(name.toLowerCase())).map((p) => p.slice(5)).slice(0, 8);
      return { type: 'not_found', name, suggestions: { tables, functions } };
    },
  },
  upr_search: {
    write: false,
    description: 'Quick cross-entity search by a free-text term: contacts (name/phone/email), jobs (job_number), claims (claim_number). Returns matches grouped by type.',
    inputSchema: { type: 'object', properties: { term: { type: 'string' }, limit: { type: 'number' } }, required: ['term'] },
    run: async (env, a) => {
      const term = String(a.term || '').trim();
      if (!term) throw new Error('term is required');
      const t = encodeURIComponent(term);
      const lim = Math.min(a.limit || 10, 50);
      const db = supabase(env);
      const [contacts, jobs, claims] = await Promise.all([
        db.select('contacts', `or=(name.ilike.*${t}*,phone.ilike.*${t}*,email.ilike.*${t}*)&select=id,name,phone,email&limit=${lim}`).catch(() => []),
        db.select('jobs', `job_number.ilike.*${t}*&select=id,job_number,division,status&limit=${lim}`).catch(() => []),
        db.select('claims', `claim_number.ilike.*${t}*&select=id,claim_number,status&limit=${lim}`).catch(() => []),
      ]);
      return { contacts, jobs, claims };
    },
  },
  upr_code_context: {
    write: false,
    description: 'Map a UPR feature to where it lives in the codebase. Given a plain-English feature (e.g. "invoice payment reconciliation", "tech appointment loading", "scope sheet moisture"), returns a compact map of the relevant pages (src/pages/), components, workers (functions/api/), RPCs, tables, tests, the applicable .claude/rules/ standards, and any gold-standard implementation named in the rules. Read-only, offline curated keyword index (no DB/repo reads at runtime) — regenerate with `npm run build-index`. Great first call before editing an unfamiliar area.',
    inputSchema: { type: 'object', properties: { feature: { type: 'string', description: 'A feature or domain phrase, e.g. "collections dunning" or "encircle claim sync".' }, max_results: { type: 'number', description: 'Optional cap per category (default ~6–12).' } }, required: ['feature'] },
    run: (env, a) => searchCodeContext(a.feature, { maxResults: a.max_results }),
  },
  upr_insert: {
    write: true,
    description: 'Insert row(s) into a UPR table. data is an object or an array of objects.',
    inputSchema: { type: 'object', properties: { table: { type: 'string' }, data: {}, confirm: { type: 'boolean' } }, required: ['table', 'data'] },
    run: async (env, a) => {
      if (!a.confirm) return preview(`Insert into ${a.table}.`, a.data);
      return supabase(env).insert(a.table, a.data);
    },
  },
  upr_upsert: {
    write: true,
    description: 'Upsert row(s) into a UPR table (INSERT … ON CONFLICT merge-duplicates on the primary key). data is an object or array of objects. Use when a row may or may not already exist.',
    inputSchema: { type: 'object', properties: { table: { type: 'string' }, data: {}, confirm: { type: 'boolean' } }, required: ['table', 'data'] },
    run: async (env, a) => {
      if (!a.confirm) return preview(`Upsert into ${a.table} (merge on conflict).`, a.data);
      return supabase(env).upsert(a.table, a.data);
    },
  },
  upr_update: {
    write: true,
    description: 'Update rows in a UPR table. filter is a PostgREST filter string (e.g. "id=eq.<uuid>") and is REQUIRED to avoid table-wide updates. data is the patch.',
    inputSchema: { type: 'object', properties: { table: { type: 'string' }, filter: { type: 'string' }, data: { type: 'object' }, confirm: { type: 'boolean' } }, required: ['table', 'filter', 'data'] },
    run: async (env, a) => {
      if (!a.filter || !/=/.test(a.filter)) throw new Error('A PostgREST filter (e.g. "id=eq.<uuid>") is required for upr_update.');
      if (!a.confirm) return preview(`Update ${a.table} where ${a.filter}.`, a.data);
      return supabase(env).update(a.table, a.filter, a.data);
    },
  },
  upr_delete: {
    write: true,
    description: 'Delete rows from a UPR table. filter is a PostgREST filter string and is REQUIRED to avoid wiping a table.',
    inputSchema: { type: 'object', properties: { table: { type: 'string' }, filter: { type: 'string' }, confirm: { type: 'boolean' } }, required: ['table', 'filter'] },
    run: async (env, a) => {
      if (!a.filter || !/=/.test(a.filter)) throw new Error('A PostgREST filter (e.g. "id=eq.<uuid>") is required for upr_delete.');
      if (!a.confirm) return preview(`Delete from ${a.table} where ${a.filter}.`, { table: a.table, filter: a.filter });
      return supabase(env).delete(a.table, a.filter);
    },
  },

  // ── CallRail (call tracking) + Deepgram (transcription) ──────────────────────
  callrail_list_calls: {
    write: false,
    description: 'List CallRail tracked calls (newest first). Optional start_date/end_date (YYYY-MM-DD), search (matches caller/number), per_page, page. The CallRail account id is resolved automatically.',
    inputSchema: { type: 'object', properties: { start_date: { type: 'string' }, end_date: { type: 'string' }, search: { type: 'string' }, per_page: { type: 'number' }, page: { type: 'number' } } },
    run: (env, a) => callrailListCalls(env, a),
  },
  callrail_get_call: {
    write: false,
    description: 'Fetch one CallRail call by id, with recording/transcription/tags/source fields expanded.',
    inputSchema: { type: 'object', properties: { call_id: { type: 'string' } }, required: ['call_id'] },
    run: (env, a) => callrailGetCall(env, a.call_id),
  },
  callrail_list_form_submissions: {
    write: false,
    description: 'List CallRail web-form submissions (leads captured from forms). Optional start_date/end_date (YYYY-MM-DD), per_page, page.',
    inputSchema: { type: 'object', properties: { start_date: { type: 'string' }, end_date: { type: 'string' }, per_page: { type: 'number' }, page: { type: 'number' } } },
    run: (env, a) => callrailListFormSubmissions(env, a),
  },
  callrail_get_recording: {
    write: false,
    description: "Resolve a CallRail recording URL (from a call's recording field) to a fetchable signed audio URL. Only api.callrail.com URLs are allowed (SSRF guard).",
    inputSchema: { type: 'object', properties: { recording_url: { type: 'string' } }, required: ['recording_url'] },
    run: (env, a) => resolveRecording(env, a.recording_url),
  },
  callrail_transcribe: {
    write: true,
    description: 'Transcribe a CallRail recording to diarized text via Deepgram. GUARDED: Deepgram is a paid per-call API, so this previews unless confirm:true. recording_url must be an api.callrail.com recording URL.',
    inputSchema: { type: 'object', properties: { recording_url: { type: 'string' }, confirm: { type: 'boolean' } }, required: ['recording_url'] },
    run: async (env, a) => {
      if (!a.confirm) return preview(`Transcribe CallRail recording via Deepgram (paid API call).`, { recording_url: a.recording_url });
      return deepgramTranscribeUrl(env, a.recording_url);
    },
  },
  callrail_get: {
    write: false,
    description: 'Power tool: GET any CallRail v3 path (read-only). Account-relative paths (e.g. "/calls.json", "/users.json") get the account id injected; pass account:false or an absolute "/a/{id}/…" path to skip that.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, account: { type: 'boolean' } }, required: ['path'] },
    run: (env, a) => callrailGet(env, a.path, { account: a.account !== false }),
  },
  callrail_request: {
    write: true,
    description: 'Power tool: call any CallRail endpoint with any method (POST/PUT/DELETE). Account id is injected for account-relative paths. Guarded — preview unless confirm:true.',
    inputSchema: { type: 'object', properties: { method: { type: 'string' }, path: { type: 'string' }, body: { type: 'object' }, account: { type: 'boolean' }, confirm: { type: 'boolean' } }, required: ['method', 'path'] },
    run: async (env, a) => {
      if (!a.confirm) return preview(`${String(a.method).toUpperCase()} ${a.path} on CallRail.`, a.body || {});
      return callrailRequest(env, a.method, a.path, a.body, { account: a.account !== false });
    },
  },

  // ── Stripe (card payments + payouts) ─────────────────────────────────────────
  stripe_get_balance: {
    write: false,
    description: "Get UPR's Stripe balance (available, pending, and instant_available totals).",
    inputSchema: { type: 'object', properties: {} },
    run: (env) => stripeGetBalance(env),
  },
  stripe_list_charges: {
    write: false,
    description: 'List recent Stripe charges. Optional customer (Stripe customer id) and limit (max 100).',
    inputSchema: { type: 'object', properties: { customer: { type: 'string' }, limit: { type: 'number' } } },
    run: (env, a) => stripeListCharges(env, a),
  },
  stripe_retrieve_charge: {
    write: false,
    description: 'Retrieve one Stripe charge by id, with its balance_transaction (amount/fee/net) expanded.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    run: (env, a) => stripeRetrieveCharge(env, a.id),
  },
  stripe_list_payouts: {
    write: false,
    description: 'List recent Stripe payouts to the bank/card (limit max 100).',
    inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
    run: (env, a) => stripeListPayouts(env, a),
  },
  stripe_list_external_accounts: {
    write: false,
    description: 'List Stripe payout destinations (bank accounts + debit cards) with their instant-eligibility and default flags.',
    inputSchema: { type: 'object', properties: {} },
    run: (env) => stripeListExternalAccounts(env),
  },
  stripe_create_payout: {
    write: true,
    description: 'Create a Stripe payout (default instant) to an external account. amount_cents required; destination is an external account id (omit for the default). MOVES REAL MONEY — previews unless confirm:true.',
    inputSchema: { type: 'object', properties: { amount_cents: { type: 'number' }, destination: { type: 'string' }, method: { type: 'string' }, confirm: { type: 'boolean' } }, required: ['amount_cents'] },
    run: async (env, a) => {
      if (!a.confirm) return preview(`Create a ${a.method || 'instant'} Stripe payout of $${(Number(a.amount_cents) / 100).toFixed(2)}${a.destination ? ' to ' + a.destination : ' (default destination)'}.`, { amount_cents: a.amount_cents, destination: a.destination, method: a.method || 'instant' });
      return stripeCreatePayout(env, { amountCents: n(a.amount_cents), destination: a.destination, method: a.method || 'instant' });
    },
  },
  stripe_create_payment_link: {
    write: true,
    description: 'Create a Stripe hosted Checkout pay-now link for an amount. amount_cents required; optional description, customer_email, success_url, cancel_url. Returns the session (url). Previews unless confirm:true.',
    inputSchema: { type: 'object', properties: { amount_cents: { type: 'number' }, description: { type: 'string' }, customer_email: { type: 'string' }, success_url: { type: 'string' }, cancel_url: { type: 'string' }, confirm: { type: 'boolean' } }, required: ['amount_cents'] },
    run: async (env, a) => {
      if (!a.confirm) return preview(`Create a Stripe pay-now link for $${(Number(a.amount_cents) / 100).toFixed(2)} (${a.description || 'Payment'}).`, { amount_cents: a.amount_cents, description: a.description });
      return stripeCreatePaymentLink(env, { amountCents: n(a.amount_cents), description: a.description, customerEmail: a.customer_email, successUrl: a.success_url, cancelUrl: a.cancel_url });
    },
  },
  stripe_get: {
    write: false,
    description: 'Power tool: GET any Stripe API path (read-only). e.g. "/customers", "/payment_intents/pi_123". Optional params object becomes the querystring.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, params: { type: 'object' } }, required: ['path'] },
    run: (env, a) => stripeGet(env, a.path, a.params),
  },
  stripe_request: {
    write: true,
    description: 'Power tool: call any Stripe endpoint with any method (POST/DELETE). path + optional params (form-encoded). Covers refunds, invoice items, customer updates, etc. Guarded — preview unless confirm:true.',
    inputSchema: { type: 'object', properties: { method: { type: 'string' }, path: { type: 'string' }, params: { type: 'object' }, confirm: { type: 'boolean' } }, required: ['method', 'path'] },
    run: async (env, a) => {
      if (!a.confirm) return preview(`${String(a.method).toUpperCase()} ${a.path} on Stripe.`, a.params || {});
      return stripeRequest(env, a.method, a.path, a.params);
    },
  },

  // ── Twilio (SMS/MMS) ─────────────────────────────────────────────────────────
  twilio_list_messages: {
    write: false,
    description: 'List recent Twilio messages. Optional to / from (E.164 number) and date_sent (YYYY-MM-DD) filters, page_size (max 200).',
    inputSchema: { type: 'object', properties: { to: { type: 'string' }, from: { type: 'string' }, date_sent: { type: 'string' }, page_size: { type: 'number' } } },
    run: (env, a) => twilioListMessages(env, a),
  },
  twilio_get_message: {
    write: false,
    description: 'Fetch one Twilio message by its SID (SM…/MM…), including status and error details.',
    inputSchema: { type: 'object', properties: { sid: { type: 'string' } }, required: ['sid'] },
    run: (env, a) => twilioGetMessage(env, a.sid),
  },
  twilio_send_sms: {
    write: true,
    description: 'Send an SMS/MMS via Twilio to a phone number. to (E.164) + body required; optional media_urls (array) for MMS. Sends a REAL text (costs money, reaches a person) — previews unless confirm:true.',
    inputSchema: { type: 'object', properties: { to: { type: 'string' }, body: { type: 'string' }, media_urls: { type: 'array' }, confirm: { type: 'boolean' } }, required: ['to', 'body'] },
    run: async (env, a) => {
      if (!a.confirm) return preview(`Send an SMS to ${a.to}: "${String(a.body || '').slice(0, 120)}".`, { to: a.to, body: a.body, media_urls: a.media_urls || [] });
      return twilioSendMessage(env, { to: a.to, body: a.body, mediaUrls: a.media_urls });
    },
  },
  twilio_get: {
    write: false,
    description: 'Power tool: GET any Twilio path under /Accounts/{sid} (read-only). e.g. "/Messages.json", "/Calls.json". Optional params object becomes the querystring.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, params: { type: 'object' } }, required: ['path'] },
    run: (env, a) => twilioGet(env, a.path, a.params),
  },
  twilio_request: {
    write: true,
    description: 'Power tool: call any Twilio endpoint under /Accounts/{sid} with any method (POST/DELETE). path + optional params (form-encoded). Guarded — preview unless confirm:true.',
    inputSchema: { type: 'object', properties: { method: { type: 'string' }, path: { type: 'string' }, params: { type: 'object' }, confirm: { type: 'boolean' } }, required: ['method', 'path'] },
    run: async (env, a) => {
      if (!a.confirm) return preview(`${String(a.method).toUpperCase()} ${a.path} on Twilio.`, a.params || {});
      return twilioRequest(env, a.method, a.path, a.params);
    },
  },

  // ── Google Ads (spend reporting) ─────────────────────────────────────────────
  google_ads_campaign_spend: {
    write: false,
    description: 'Google Ads spend per campaign per day for a date range. start_date + end_date (YYYY-MM-DD). Returns [{campaignId, campaignName, date, spend ($), impressions, clicks, conversions}].',
    inputSchema: { type: 'object', properties: { start_date: { type: 'string' }, end_date: { type: 'string' } }, required: ['start_date', 'end_date'] },
    run: (env, a) => googleAdsCampaignSpend(env, a.start_date, a.end_date),
  },
  google_ads_query: {
    write: false,
    description: 'Run a raw GAQL query against the configured Google Ads customer (searchStream). Read-only. e.g. "SELECT campaign.name, metrics.cost_micros FROM campaign WHERE segments.date DURING LAST_7_DAYS".',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    run: (env, a) => googleAdsQuery(env, a.query),
  },

  // ── Meta Ads (spend reporting) ───────────────────────────────────────────────
  meta_ads_insights: {
    write: false,
    description: 'Meta (Facebook/Instagram) ad spend per campaign per day for a date range. start_date + end_date (YYYY-MM-DD). Returns [{campaignId, campaignName, date, spend ($), impressions, clicks, conversions}].',
    inputSchema: { type: 'object', properties: { start_date: { type: 'string' }, end_date: { type: 'string' } }, required: ['start_date', 'end_date'] },
    run: (env, a) => metaCampaignInsights(env, a.start_date, a.end_date),
  },
  meta_ads_get: {
    write: false,
    description: 'Power tool: GET any Meta Graph API path (read-only) with the account token attached. e.g. "/me/adaccounts", "/act_123/campaigns". Optional params object becomes the querystring.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, params: { type: 'object' } }, required: ['path'] },
    run: (env, a) => metaGet(env, a.path, a.params || {}),
  },

  // ── GitHub (repo / PRs / issues) ─────────────────────────────────────────────
  github_list_prs: {
    write: false,
    description: 'List pull requests in a repo (defaults to GITHUB_DEFAULT_REPO). Optional repo ("owner/name"), state (open/closed/all), per_page.',
    inputSchema: { type: 'object', properties: { repo: { type: 'string' }, state: { type: 'string' }, per_page: { type: 'number' } } },
    run: (env, a) => githubListPulls(env, a),
  },
  github_get_pr: {
    write: false,
    description: 'Fetch one pull request by number (defaults to GITHUB_DEFAULT_REPO). number required; optional repo.',
    inputSchema: { type: 'object', properties: { repo: { type: 'string' }, number: { type: 'number' } }, required: ['number'] },
    run: (env, a) => githubGetPull(env, a),
  },
  github_list_issues: {
    write: false,
    description: 'List issues in a repo (defaults to GITHUB_DEFAULT_REPO). Optional repo, state (open/closed/all), per_page. Note: GitHub returns PRs here too.',
    inputSchema: { type: 'object', properties: { repo: { type: 'string' }, state: { type: 'string' }, per_page: { type: 'number' } } },
    run: (env, a) => githubListIssues(env, a),
  },
  github_search_code: {
    write: false,
    description: 'Search code (scoped to GITHUB_DEFAULT_REPO unless the query already has a repo: qualifier). q required; optional repo.',
    inputSchema: { type: 'object', properties: { q: { type: 'string' }, repo: { type: 'string' } }, required: ['q'] },
    run: (env, a) => githubSearchCode(env, a),
  },
  github_create_issue: {
    write: true,
    description: 'Open a GitHub issue (defaults to GITHUB_DEFAULT_REPO). title required; optional body, labels (array), repo. Previews unless confirm:true.',
    inputSchema: { type: 'object', properties: { repo: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' }, labels: { type: 'array' }, confirm: { type: 'boolean' } }, required: ['title'] },
    run: async (env, a) => {
      if (!a.confirm) return preview(`Open a GitHub issue "${a.title}"${a.repo ? ' in ' + a.repo : ''}.`, { title: a.title, body: a.body, labels: a.labels });
      return githubCreateIssue(env, a);
    },
  },
  github_merge_pr: {
    write: true,
    description: 'Merge a pull request (defaults to GITHUB_DEFAULT_REPO). number required; merge_method = squash (default) | merge | rebase; optional commit_title/commit_message, repo. Merges real code — previews unless confirm:true.',
    inputSchema: { type: 'object', properties: { repo: { type: 'string' }, number: { type: 'number' }, merge_method: { type: 'string' }, commit_title: { type: 'string' }, commit_message: { type: 'string' }, confirm: { type: 'boolean' } }, required: ['number'] },
    run: async (env, a) => {
      if (!a.confirm) return preview(`Merge PR #${a.number}${a.repo ? ' in ' + a.repo : ''} via ${a.merge_method || 'squash'}.`, { number: a.number, merge_method: a.merge_method || 'squash' });
      return githubMergePull(env, a);
    },
  },
  github_create_pr: {
    write: true,
    description: 'Open a pull request (defaults to GITHUB_DEFAULT_REPO). title + head (source branch) + base (target branch) required; optional body, draft, repo. Previews unless confirm:true.',
    inputSchema: { type: 'object', properties: { repo: { type: 'string' }, title: { type: 'string' }, head: { type: 'string' }, base: { type: 'string' }, body: { type: 'string' }, draft: { type: 'boolean' }, confirm: { type: 'boolean' } }, required: ['title', 'head', 'base'] },
    run: async (env, a) => {
      if (!a.confirm) return preview(`Open PR "${a.title}" (${a.head} → ${a.base})${a.repo ? ' in ' + a.repo : ''}.`, { title: a.title, head: a.head, base: a.base, draft: !!a.draft });
      return githubCreatePull(env, a);
    },
  },
  github_update_pr: {
    write: true,
    description: 'Edit a pull request or close/reopen it (defaults to GITHUB_DEFAULT_REPO). number required; optional title, body, state (open/closed), base, repo. Previews unless confirm:true.',
    inputSchema: { type: 'object', properties: { repo: { type: 'string' }, number: { type: 'number' }, title: { type: 'string' }, body: { type: 'string' }, state: { type: 'string' }, base: { type: 'string' }, confirm: { type: 'boolean' } }, required: ['number'] },
    run: async (env, a) => {
      if (!a.confirm) return preview(`Update PR #${a.number}${a.state ? ` (state → ${a.state})` : ''}${a.repo ? ' in ' + a.repo : ''}.`, { number: a.number, title: a.title, state: a.state, base: a.base });
      return githubUpdatePull(env, a);
    },
  },
  github_create_branch: {
    write: true,
    description: 'Create a branch (defaults to GITHUB_DEFAULT_REPO). branch (new name) required; from = base branch or sha (default the repo HEAD); optional repo. Previews unless confirm:true.',
    inputSchema: { type: 'object', properties: { repo: { type: 'string' }, branch: { type: 'string' }, from: { type: 'string' }, confirm: { type: 'boolean' } }, required: ['branch'] },
    run: async (env, a) => {
      if (!a.confirm) return preview(`Create branch "${a.branch}" from ${a.from || 'HEAD'}${a.repo ? ' in ' + a.repo : ''}.`, { branch: a.branch, from: a.from || 'HEAD' });
      return githubCreateBranch(env, a);
    },
  },
  github_get_file: {
    write: false,
    description: 'Read a file from the repo (the REST "pull"). path required; optional ref (branch/tag/sha), repo. Returns GitHub\'s content object incl. the blob sha needed to update it.',
    inputSchema: { type: 'object', properties: { repo: { type: 'string' }, path: { type: 'string' }, ref: { type: 'string' } }, required: ['path'] },
    run: (env, a) => githubGetFile(env, a),
  },
  github_commit_file: {
    write: true,
    description: 'Create or update a file and commit it (the REST "push"). path + content (plain text) + message required; pass sha (the existing file\'s blob sha from github_get_file) to UPDATE, omit to CREATE; optional branch, repo. Previews unless confirm:true.',
    inputSchema: { type: 'object', properties: { repo: { type: 'string' }, path: { type: 'string' }, content: { type: 'string' }, message: { type: 'string' }, branch: { type: 'string' }, sha: { type: 'string' }, confirm: { type: 'boolean' } }, required: ['path', 'content', 'message'] },
    run: async (env, a) => {
      if (!a.confirm) return preview(`${a.sha ? 'Update' : 'Create'} ${a.path}${a.branch ? ' on ' + a.branch : ''}${a.repo ? ' in ' + a.repo : ''} — "${a.message}".`, { path: a.path, branch: a.branch, update: !!a.sha, bytes: String(a.content || '').length });
      return githubCommitFile(env, a);
    },
  },
  github_list_commits: {
    write: false,
    description: 'List commits in a repo (defaults to GITHUB_DEFAULT_REPO). Optional sha (branch/sha to start from), path (commits touching a file), per_page, repo.',
    inputSchema: { type: 'object', properties: { repo: { type: 'string' }, sha: { type: 'string' }, path: { type: 'string' }, per_page: { type: 'number' } } },
    run: (env, a) => githubListCommits(env, a),
  },
  github_get_commit: {
    write: false,
    description: 'Fetch one commit by ref/sha (defaults to GITHUB_DEFAULT_REPO), including its file diffs. ref required; optional repo.',
    inputSchema: { type: 'object', properties: { repo: { type: 'string' }, ref: { type: 'string' } }, required: ['ref'] },
    run: (env, a) => githubGetCommit(env, a),
  },
  github_list_branches: {
    write: false,
    description: 'List branches in a repo (defaults to GITHUB_DEFAULT_REPO). Optional per_page, repo.',
    inputSchema: { type: 'object', properties: { repo: { type: 'string' }, per_page: { type: 'number' } } },
    run: (env, a) => githubListBranches(env, a),
  },
  github_add_comment: {
    write: true,
    description: 'Comment on a pull request or issue (defaults to GITHUB_DEFAULT_REPO). number + body required; optional repo. Previews unless confirm:true.',
    inputSchema: { type: 'object', properties: { repo: { type: 'string' }, number: { type: 'number' }, body: { type: 'string' }, confirm: { type: 'boolean' } }, required: ['number', 'body'] },
    run: async (env, a) => {
      if (!a.confirm) return preview(`Comment on #${a.number}${a.repo ? ' in ' + a.repo : ''}: "${String(a.body || '').slice(0, 120)}".`, { number: a.number, body: a.body });
      return githubAddComment(env, a);
    },
  },
  github_get: {
    write: false,
    description: 'Power tool: GET any GitHub REST path (read-only). e.g. "/repos/{owner}/{repo}/commits", "/user". Use for endpoints without a dedicated tool.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    run: (env, a) => githubGet(env, a.path),
  },
  github_request: {
    write: true,
    description: 'Power tool: call any GitHub endpoint with any method (POST/PATCH/PUT/DELETE). method + path + optional body. Covers comments, labels, reviews, etc. Guarded — preview unless confirm:true.',
    inputSchema: { type: 'object', properties: { method: { type: 'string' }, path: { type: 'string' }, body: { type: 'object' }, confirm: { type: 'boolean' } }, required: ['method', 'path'] },
    run: async (env, a) => {
      if (!a.confirm) return preview(`${String(a.method).toUpperCase()} ${a.path} on GitHub.`, a.body || {});
      return githubRequest(env, a.method, a.path, a.body);
    },
  },
};

export function toolList() {
  return Object.entries(TOOLS).map(([name, t]) => {
    // MCP annotations let Claude classify tools (and enable "Always allow" on reads).
    // upr_rpc is read-capable but can also call mutating functions → not read-only.
    const readOnly = name === 'upr_rpc' ? false : !t.write;
    return {
      name,
      description: (t.write ? '[WRITE] ' : '[read] ') + t.description,
      inputSchema: t.inputSchema,
      annotations: {
        title: name,
        readOnlyHint: readOnly,
        destructiveHint: readOnly ? false : /delete|relink|send|update|rpc|create|payout|payment_link|transcribe|sms|request|merge|commit|comment|branch/i.test(name),
        openWorldHint: true,
      },
    };
  });
}
