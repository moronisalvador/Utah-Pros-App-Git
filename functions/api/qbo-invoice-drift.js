/**
 * ════════════════════════════════════════════════
 * FILE: qbo-invoice-drift.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Compares every invoice in UPR against the same invoice in QuickBooks and
 *   reports the ones that disagree. Invoices only ever get pushed from UPR to
 *   QuickBooks — nothing pulls invoice amounts back — so if somebody edits an
 *   invoice inside QuickBooks, or edits one here and forgets to press Save,
 *   the two systems quietly drift apart and nothing notices. This finds those.
 *
 *   It changes no money and no invoice in either system. Because it is the one
 *   place that reads EVERY linked QuickBooks invoice, it also writes down what
 *   QuickBooks says about emailing each one (see the email-mirror note below).
 *
 * WHERE IT LIVES:
 *   Route:  GET /api/qbo-invoice-drift
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ../lib/cors.js, ../lib/auth.js, ../lib/supabase.js,
 *              ../lib/quickbooks.js, ../lib/worker-runs.js,
 *              ../lib/qbo-invoice-email-mirror.js
 *   Data:      reads  → invoices (UPR), QuickBooks Invoice entities
 *              writes → worker_runs (its own telemetry row) and the three
 *                       invoices email-observation columns ONLY
 *                       (qbo_email_status, qbo_bill_email, qbo_email_checked_at)
 *
 * NOTES / GOTCHAS:
 *   - EMAIL MIRROR: this sweep is the ONLY path that reaches an invoice created
 *     inside QuickBooks and never saved from UPR — precisely the invoice whose
 *     email state UPR could not see (INV-000065, 2026-08-07). The two extra
 *     projected fields ride on a query it already runs, so the mirror adds zero
 *     provider calls. It writes no money column and no trigger-owned column, and
 *     a failure is swallowed so it can never turn a clean report into an error.
 *     Re-running this sweep is what refreshes the invoice "Emailed" field in bulk.
 *     It is operator-invoked only — the handler takes a human bearer session and has
 *     no checkCronSecret branch, so it cannot be put on a cron without adding one
 *     (stashing a human credential to fake it would be worse than leaving it manual).
 *   - ONE QuickBooks invoice can back SEVERAL UPR invoices. A combined QBO bill
 *     is routinely split into a mitigation row and a reconstruction row here, so
 *     totals MUST be summed per qbo_invoice_id before comparing. Comparing row
 *     by row reports every split invoice as drifted. As of 2026-08-05 seven QBO
 *     invoices are backed by two UPR rows each and all reconcile in aggregate.
 *   - Money is compared in integer cents. Floats do not compare reliably.
 *   - `pending_push` is a different condition from drift: UPR is ahead of
 *     QuickBooks because an edit was never saved. That is the case that let two
 *     invoices sit un-synced for a day in Aug 2026 — the UI gives no signal.
 *   - A drifted invoice is NOT automatically a defect. A line is sometimes moved to a
 *     different job on purpose, and whoever moved it usually explains why in the line
 *     description. The report therefore returns those descriptions IN FULL for anything
 *     it flags — read them before "fixing" anything.
 *   - QuickBooks caps a query response, so ids are fetched in chunks.
 *   - Trigger-owned columns are read, never written (CLAUDE.md Rule 15).
 * ════════════════════════════════════════════════
 */

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { requireRole } from '../lib/auth.js';
import { supabase } from '../lib/supabase.js';
import { getConnection, qboFetch } from '../lib/quickbooks.js';
import { requireQboProviderTraffic, isQboProviderTrafficDisabled } from '../lib/qbo-provider-traffic.js';
import { qboProviderTrafficDisabledRouteResponse } from './qbo-provider-traffic-response.js';
import { mirrorQboInvoiceEmail, readEmailObservations } from '../lib/qbo-invoice-email-mirror.js';
import { withRunRecording } from '../lib/worker-runs.js';

const WORKER = 'qbo-invoice-drift';
const MINOR_VERSION = '70';
const CHUNK = 40;

// STALE, and deliberately left alone here (2026-08-07): this does NOT mirror
// src/lib/claimUtils.BILLING_EDIT_ROLES, which the owner widened on 2026-08-04 to
// ['admin','office','project_manager']. 'manager' is not a value of the
// public.employee_role enum at all, so this list is effectively ['admin'] and the
// endpoint is admin-only. It fails CLOSED (under-permissive), and the identical
// stale pair lives in qbo-charge.js, qbo-attach.js and stripe-pay-link.js — plus
// workers-standard.md §1 still quotes ['admin','manager'] as its example, which is
// what keeps regrowing it. Correcting all four against one shared constant is its
// own reviewed change (it widens who can read money data), not a rider on the
// email-mirror work. The mirror is unaffected: qbo-invoice.js and the payment
// webhook cover the office/project_manager paths.
const BILLING_ROLES = ['admin', 'manager'];

// ─── SECTION: Helpers ──────────────

const cents = (v) => Math.round(Number(v || 0) * 100);
const dollars = (c) => Number((c / 100).toFixed(2));

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function fetchQboInvoices(env, ids, expectedRealmId) {
  const found = new Map();
  for (const group of chunk(ids, CHUNK)) {
    const list = group.map((id) => `'${String(id).replace(/'/g, "''")}'`).join(',');
    // EmailStatus + BillEmail feed the email mirror. BillEmail is an object-valued
    // top-level property, the same shape as MetaData, which this projection has
    // always selected successfully — and both MUST be selected together, or the
    // mirror would read a missing BillEmail as "no billing address".
    const q = `SELECT Id, DocNumber, TotalAmt, Balance, MetaData, EmailStatus, BillEmail FROM Invoice WHERE Id IN (${list}) MAXRESULTS ${CHUNK + 10}`;
    let res;
    try {
      res = await qboFetch(env, `/query?query=${encodeURIComponent(q)}&minorversion=${MINOR_VERSION}`, {
        method: 'GET', expectedRealmId,
      });
    } catch (cause) {
      if (isQboProviderTrafficDisabled(cause)) throw cause;
      const error = new Error('QuickBooks invoice read is temporarily unavailable.');
      error.code = cause?.code === 'qbo-realm-mismatch' ? 'qbo_realm_mismatch' : 'qbo_invoice_read_unavailable';
      error.intuitTid = cause?.intuitTid || null;
      throw error;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = new Error(res.status >= 400 && res.status < 500
        ? 'QuickBooks rejected the invoice read.'
        : 'QuickBooks invoice read is temporarily unavailable.');
      error.code = res.status >= 400 && res.status < 500 ? 'qbo_invoice_read_rejected' : 'qbo_invoice_read_unavailable';
      error.status = res.status;
      error.intuitTid = res.headers.get('intuit_tid') || null;
      throw error;
    }
    for (const inv of data?.QueryResponse?.Invoice || []) found.set(String(inv.Id), inv);
  }
  return found;
}

// ─── SECTION: Handler ──────────────

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const db = supabase(env);

  const auth = await requireRole(request, env, db, BILLING_ROLES);
  if (auth.error) return jsonResponse({ error: auth.error }, auth.status, request, env);
  // Money data is never exposed to an external collaborator account.
  if (auth.employee?.is_external) return jsonResponse({ error: 'Insufficient role' }, 403, request, env);
  try { await requireQboProviderTraffic(env); } catch (error) { if (isQboProviderTrafficDisabled(error)) return qboProviderTrafficDisabledRouteResponse(request, env); throw error; }

  const conn = await getConnection(env);
  if (!conn || !conn.refresh_token) {
    return jsonResponse({ error: 'QuickBooks not connected' }, 409, request, env);
  }

  try {
    const result = await withRunRecording(db, WORKER, async () => {
      const rows = await db.select(
        'invoices',
        'qbo_invoice_id=not.is.null&select=id,invoice_number,qbo_doc_number,qbo_invoice_id,contact_id,total,amount_paid,balance_due,status,updated_at,qbo_synced_at&order=invoice_number.asc',
      );

      // Group UPR rows by the QuickBooks invoice they mirror. A combined QBO bill
      // legitimately backs more than one UPR invoice; only the SUM is comparable.
      const byQbo = new Map();
      for (const r of rows || []) {
        const key = String(r.qbo_invoice_id);
        if (!byQbo.has(key)) byQbo.set(key, []);
        byQbo.get(key).push(r);
      }

      const qbo = await fetchQboInvoices(env, [...byQbo.keys()], conn.realm_id);
      const drifted = [];
      const pendingPush = [];

      for (const [qboId, group] of byQbo) {
        const remote = qbo.get(qboId);

        if (!remote) {
          drifted.push({
            kind: 'missing_in_quickbooks',
            qbo_invoice_id: qboId,
            upr: group.map((g) => g.invoice_number),
            upr_total: dollars(group.reduce((s, g) => s + cents(g.total), 0)),
            note: 'UPR references a QuickBooks invoice that no longer exists (deleted or wrong id).',
          });
          continue;
        }

        const uprTotal = group.reduce((s, g) => s + cents(g.total), 0);
        const uprPaid = group.reduce((s, g) => s + cents(g.amount_paid), 0);
        const qboTotal = cents(remote.TotalAmt);
        const qboPaid = cents(remote.TotalAmt) - cents(remote.Balance);

        if (uprTotal !== qboTotal || uprPaid !== qboPaid) {
          // Did the QuickBooks side change AFTER we last pushed to it? That — not
          // MetaData.LastModifiedByRef — is the reliable "edited outside UPR" test.
          // LastModifiedByRef names the Intuit user the OAuth connection is bound to,
          // so a Worker push, an API call and a human UI edit all stamp the SAME id.
          // It is kept below as context only; it cannot discriminate.
          const qboUpdated = remote?.MetaData?.LastUpdatedTime ? new Date(remote.MetaData.LastUpdatedTime) : null;
          const lastPush = group
            .map((g) => (g.qbo_synced_at ? new Date(g.qbo_synced_at) : null))
            .filter(Boolean)
            .sort((a, b) => b - a)[0] || null;
          const externalEdit = !!(qboUpdated && lastPush && qboUpdated > lastPush);

          drifted.push({
            kind: uprTotal !== qboTotal ? 'total_mismatch' : 'paid_mismatch',
            qbo_invoice_id: qboId,
            doc_number: remote.DocNumber || null,
            contact_id: group[0]?.contact_id || null,
            upr: group.map((g) => g.invoice_number),
            upr_rows: group.length,
            upr_total: dollars(uprTotal),
            qbo_total: dollars(qboTotal),
            total_delta: dollars(uprTotal - qboTotal),
            upr_paid: dollars(uprPaid),
            qbo_paid: dollars(qboPaid),
            paid_delta: dollars(uprPaid - qboPaid),
            // true  => QuickBooks changed after our last push: someone edited it there.
            // false => the difference originated in UPR (unpushed edit or bad mirror).
            external_edit: externalEdit,
            qbo_last_updated: remote?.MetaData?.LastUpdatedTime || null,
            upr_last_synced: lastPush ? lastPush.toISOString() : null,
            qbo_last_modified_by: remote?.MetaData?.LastModifiedByRef?.value || null,
          });
        }

        // Not drift: UPR edited after its last successful push. Someone changed an
        // invoice here and never pressed Save, so QuickBooks has not seen it yet.
        for (const g of group) {
          if (g.updated_at && g.qbo_synced_at && new Date(g.updated_at) > new Date(g.qbo_synced_at)) {
            pendingPush.push({
              invoice_number: g.invoice_number,
              doc_number: g.qbo_doc_number,
              qbo_invoice_id: qboId,
              updated_at: g.updated_at,
              qbo_synced_at: g.qbo_synced_at,
            });
          }
        }
      }

      // ─── Email mirror ───
      // Record what QuickBooks says about emailing each invoice we just read. This
      // is the whole book in one pass, so it is what makes the invoice "Emailed"
      // field truthful for invoices UPR never sent itself. Chunked rather than
      // serial (workers-standard.md §5); only rows whose email state actually
      // changed are written, so a steady-state sweep writes nothing at all.
      //
      // ONE batched read up front, not one per invoice: it also answers whether
      // migration 20260807190000 has been applied at all. Null means the columns
      // do not exist yet, and the entire mirror is skipped rather than attempting
      // a write per invoice that would 400 every time.
      let emailMirrored = 0;
      const mirrorWork = [...byQbo].filter(([qboId]) => qbo.has(qboId));
      const observed = await readEmailObservations(db, (rows || []).map((r) => r.id));
      if (observed) {
        for (const batch of chunk(mirrorWork, 10)) {
          const written = await Promise.all(batch.map(([qboId, group]) => mirrorQboInvoiceEmail(
            db, group.map((g) => g.id), qbo.get(qboId), { stored: observed },
          ).then((r) => r.written)));
          emailMirrored += written.reduce((sum, n) => sum + n, 0);
        }
      }

      // ─── Reallocation signature ───
      // Two drifted invoices for the SAME customer whose total deltas cancel exactly
      // are almost never two independent defects — they are one line moved from one
      // invoice to the other. That is a deliberate re-attribution to verify, NOT
      // something to repair. This exact shape (+1,005.63 / -1,005.63 on one customer)
      // was "repaired" this session and had to be reverted; the pair summed correctly
      // either way, which is precisely why the error looked right.
      const byContact = new Map();
      for (const d of drifted) {
        if (!d.contact_id) continue;
        if (!byContact.has(d.contact_id)) byContact.set(d.contact_id, []);
        byContact.get(d.contact_id).push(d);
      }
      for (const peers of byContact.values()) {
        for (let i = 0; i < peers.length; i += 1) {
          for (let j = i + 1; j < peers.length; j += 1) {
            if (cents(peers[i].total_delta) + cents(peers[j].total_delta) === 0
                && cents(peers[i].total_delta) !== 0) {
              for (const [a, b] of [[i, j], [j, i]]) {
                peers[a].reallocation_suspected = true;
                peers[a].cancels_with = peers[b].qbo_invoice_id;
                peers[a].severity = 'informational';
              }
            }
          }
        }
      }
      for (const d of drifted) {
        if (!d.severity) d.severity = d.external_edit ? 'actionable' : 'review';
      }

      // Attach the UPR line descriptions to anything drifted. A disagreement is not
      // automatically a defect: a line may have been deliberately re-attributed to a
      // different job, and whoever did it usually says so IN THE DESCRIPTION. Reading
      // that field truncated is exactly how this session "repaired" an intentional
      // regrouping. Descriptions are sent whole, deliberately — drift is rare, and a
      // clipped note is worse than a long one.
      const driftedIds = [...new Set(drifted.flatMap((d) => byQbo.get(d.qbo_invoice_id).map((g) => g.id)))];
      if (driftedIds.length) {
        const lines = await db.select(
          'invoice_line_items',
          `invoice_id=in.(${driftedIds.join(',')})&select=invoice_id,description,quantity,unit_price,sort_order&order=sort_order.asc`,
        );
        const byInvoice = new Map();
        for (const l of lines || []) {
          if (!byInvoice.has(l.invoice_id)) byInvoice.set(l.invoice_id, []);
          byInvoice.get(l.invoice_id).push({
            description: l.description || null,
            quantity: l.quantity,
            unit_price: l.unit_price,
          });
        }
        for (const d of drifted) {
          d.upr_lines = byQbo.get(d.qbo_invoice_id).map((g) => ({
            invoice_number: g.invoice_number,
            lines: byInvoice.get(g.id) || [],
          }));
        }
      }

      const payload = {
        checked_upr_invoices: (rows || []).length,
        checked_qbo_invoices: byQbo.size,
        drifted_count: drifted.length,
        pending_push_count: pendingPush.length,
        // Rows whose QuickBooks email state was newly recorded or had changed.
        email_mirrored: emailMirrored,
        drifted,
        pending_push: pendingPush,
      };

      // withRunRecording reads these two keys off the return value for the
      // worker_runs row; the counts are what make a scheduled run reviewable
      // without re-reading the whole response.
      return {
        recordsProcessed: byQbo.size,
        meta: {
          drifted: drifted.length,
          pending_push: pendingPush.length,
          upr_rows: (rows || []).length,
          email_mirrored: emailMirrored,
        },
        payload,
      };
    });

    return jsonResponse({ ok: true, ...result.payload }, 200, request, env);
  } catch (e) {
    if (isQboProviderTrafficDisabled(e)) {
      return qboProviderTrafficDisabledRouteResponse(request, env);
    }
    console.error(`${WORKER}:`, { code: 'qbo_invoice_drift_failed', intuit_tid: e?.intuitTid || null });
    return jsonResponse({
      error: 'QuickBooks invoice drift check could not be completed.',
      code: 'qbo_invoice_drift_failed',
      intuit_tid: e?.intuitTid || null,
    }, 500, request, env);
  }
}
