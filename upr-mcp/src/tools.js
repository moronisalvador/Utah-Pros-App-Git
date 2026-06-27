// Tool registry for the QBO MCP server.
//
// Conventions:
//   - Every WRITE tool requires `confirm: true`. Called without it, the tool does
//     NOT touch QBO; it returns a { preview } describing exactly what it would do.
//     This is the per-call write-confirmation guard.
//   - Reads never mutate and don't need confirm.
//   - Every call (read + write, preview + execute) is audit-logged by the caller.

import { qboQuery, qboGet, qboCreate, qboSparseUpdate, qboDelete, qboReport, qboSend } from './qbo.js';
import { encircleGetClaim, encircleListClaims } from './encircle.js';
import { supabase } from './supabase.js';

const n = (v) => (v == null ? v : Number(v));
const esc = (s) => String(s).replace(/'/g, "\\'");

function buildInvoiceLines(lines) {
  return (lines || []).map((l) => ({
    DetailType: 'SalesItemLine',
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

  // ── Encircle (claims source-of-truth) — read-only ───────────────────────────
  encircle_get_claim: {
    write: false,
    description: 'Fetch a single Encircle property claim by its Encircle id (jobs.encircle_claim_id). Returns the full claim incl. created_at — the true date the claim was filed in Encircle — plus date_of_loss, status, full_address, policyholder. Use this to recover real claim dates the UPR import did not persist.',
    inputSchema: { type: 'object', properties: { claim_id: { type: 'string' } }, required: ['claim_id'] },
    run: (env, a) => encircleGetClaim(env, a.claim_id),
  },
  encircle_list_claims: {
    write: false,
    description: 'List recent Encircle property claims (newest first). Each includes id, created_at, date_of_loss, status, full_address.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number' }, order: { type: 'string' } } },
    run: (env, a) => encircleListClaims(env, { limit: a.limit, order: a.order }),
  },

  // ── UPR (Supabase) — read + write the app's own database ─────────────────────
  upr_select: {
    write: false,
    description: 'Read rows from a UPR (Supabase) table via a PostgREST query string. Example: table="jobs", query="status=eq.active&select=*&order=created_at.desc&limit=20".',
    inputSchema: { type: 'object', properties: { table: { type: 'string' }, query: { type: 'string' } }, required: ['table'] },
    run: (env, a) => supabase(env).select(a.table, a.query || ''),
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
  upr_insert: {
    write: true,
    description: 'Insert row(s) into a UPR table. data is an object or an array of objects.',
    inputSchema: { type: 'object', properties: { table: { type: 'string' }, data: {}, confirm: { type: 'boolean' } }, required: ['table', 'data'] },
    run: async (env, a) => {
      if (!a.confirm) return preview(`Insert into ${a.table}.`, a.data);
      return supabase(env).insert(a.table, a.data);
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
        destructiveHint: readOnly ? false : /delete|relink|send|update|rpc/i.test(name),
        openWorldHint: true,
      },
    };
  });
}
