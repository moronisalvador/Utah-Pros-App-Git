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
 *   It only ever reads. It never changes an invoice in either system.
 *
 * WHERE IT LIVES:
 *   Route:  GET /api/qbo-invoice-drift
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ../lib/cors.js, ../lib/auth.js, ../lib/supabase.js,
 *              ../lib/quickbooks.js, ../lib/worker-runs.js
 *   Data:      reads  → invoices (UPR), QuickBooks Invoice entities
 *              writes → worker_runs only (its own telemetry row)
 *
 * NOTES / GOTCHAS:
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
import { withRunRecording } from '../lib/worker-runs.js';

const WORKER = 'qbo-invoice-drift';
const MINOR_VERSION = '70';
const CHUNK = 40;

// Mirrors src/lib/claimUtils.BILLING_EDIT_ROLES — the UI gate, enforced here too.
const BILLING_ROLES = ['admin', 'manager'];

// ─── SECTION: Helpers ──────────────

const cents = (v) => Math.round(Number(v || 0) * 100);
const dollars = (c) => Number((c / 100).toFixed(2));

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function fetchQboInvoices(env, ids) {
  const found = new Map();
  for (const group of chunk(ids, CHUNK)) {
    const list = group.map((id) => `'${String(id).replace(/'/g, "''")}'`).join(',');
    const q = `SELECT Id, DocNumber, TotalAmt, Balance, MetaData FROM Invoice WHERE Id IN (${list}) MAXRESULTS ${CHUNK + 10}`;
    const res = await qboFetch(env, `/query?query=${encodeURIComponent(q)}&minorversion=${MINOR_VERSION}`, { method: 'GET' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const fault = data?.Fault?.Error?.[0];
      throw new Error(fault ? `${fault.Message}` : `QBO query ${res.status}`);
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

      const qbo = await fetchQboInvoices(env, [...byQbo.keys()]);
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
        },
        payload,
      };
    });

    return jsonResponse({ ok: true, ...result.payload }, 200, request, env);
  } catch (e) {
    console.error(`${WORKER}:`, e.message);
    return jsonResponse({ error: e.message || 'Drift check failed' }, 500, request, env);
  }
}
