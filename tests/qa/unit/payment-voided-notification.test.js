// ═════════════════════════════════════════════════════════════════════════════
// FILE: payment-voided-notification.test.js
// WHAT: CI-visible source contract for the "Payment voided" notification type
//       and the invoice-Activity payment events (2026-08-07). Proves the
//       migration is a single additive catalog seed with a paired rollback,
//       that the producer is wired into BOTH removal paths, that the retraction
//       is gated so it can only fire for a payment that was actually announced
//       and actually removed, and that the Activity events need no migration at
//       all (the table, its writer RPC and its reader are already applied —
//       ledger 20260805005619 — and event_type is free text, 1–64 chars).
//
//       Origin: on 2026-08-07 QBO Payment #6059 ($2,797.82, A2Z Properties) was
//       recorded and voided 26 seconds later. UPR mirrored both actions
//       correctly, but only the first was announced, leaving a "Payment
//       received" alert pointing at an invoice with no payment on it.
//
// SCOPE HONESTY: this asserts INTENT from source text, not live effect — the
//       catalog row is not applied to any hosted database by this test. The
//       behavioral proof of the producer's gating (retract only what was
//       announced, never on a re-delivered webhook, never lose a removal to a
//       notifier failure) is functions/lib/qbo-payment-sync.test.js, which is
//       credential-free and runs in the worker lane today.
// ═════════════════════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');

// Strip `--` comments so the required header prose (which necessarily discusses
// DELETE / UPDATE / ON DELETE RESTRICT) doesn't trip the executable-SQL asserts.
const executable = (sql) => sql
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');

const migration = read(
  '../../../supabase/migrations/20260807180000_payment_voided_notification_type.sql',
);
const rollback = read(
  '../../../supabase/rollbacks/20260807180000_payment_voided_notification_type.rollback.sql',
);
const sync = read('../../../functions/lib/qbo-payment-sync.js');
const presentation = read('../../../functions/lib/notificationPresentation.js');
const activityUi = read('../../../src/components/invoice/InvoiceActivity.jsx');

describe('payment.voided migration', () => {
  it('is additive-only — one INSERT, no DDL/UPDATE/DELETE/GRANT/REVOKE', () => {
    const sql = executable(migration);
    expect(sql.match(/INSERT INTO/gi)).toHaveLength(1);
    expect(sql).toContain("'payment.voided'");
    expect(sql.match(/ON CONFLICT[^;]*DO NOTHING/gi)).toHaveLength(1);
    expect(sql).not.toMatch(/\b(?:DROP|RENAME|ALTER\s+TABLE|ALTER\s+COLUMN)\b/i);
    expect(sql).not.toMatch(/\b(?:UPDATE|DELETE)\s/i);
    expect(sql).not.toMatch(/\b(?:GRANT|REVOKE|CREATE\s+POLICY)\b/i);
    expect(sql).not.toMatch(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION/i);
    // A migration must never seed a real secret (database-standard.md §4).
    expect(sql).not.toMatch(/notification_types[\s\S]*(?:token|secret|api_key)/i);
  });

  // A retraction reaching fewer people than the claim it retracts is worse than
  // no retraction, so these must match payment.received's (true, true, true).
  it('ships bell + push + email ON, enabled, sorted directly under payment.received', () => {
    // (bell_default, push_default, email_default, enabled, sort_order)
    expect(migration).toMatch(/true,\s*true,\s*true,\s*true,\s*41/);
    expect(migration).toMatch(/'billing'/);
  });

  it('ships a paired rollback that clears the RESTRICT-ing audit FK first', () => {
    const sql = executable(rollback);
    const audit = sql.indexOf('notification_presentation_audit');
    const type = sql.indexOf('DELETE FROM public.notification_types');
    expect(audit).toBeGreaterThan(-1);
    expect(type).toBeGreaterThan(-1);
    expect(audit).toBeLessThan(type);
    expect(sql).toContain("'payment.voided'");
    // The forward migration seeds no role-default row, so none may be deleted.
    expect(sql).not.toMatch(/DELETE\s+FROM\s+public\.notification_role_defaults/i);
  });
});

describe('payment.voided producer wiring', () => {
  it('dispatches the payment.voided type key', () => {
    expect(sync).toMatch(/typeKey:\s*'payment\.voided'/);
  });

  // Both halves are fire-and-forget: an alert must never cost a payment removal.
  it('wraps the producer so a notify failure can never break a removal', () => {
    const fn = sync.slice(sync.indexOf('export async function notifyPaymentVoided'));
    expect(fn).toMatch(/catch\s*\{[^}]*never breaks payment removal/);
  });

  it('retracts only a payment that QuickBooks originated', () => {
    // payment.received fires only for source 'qbo'; a payment UPR recorded
    // itself was never announced, so voiding it must not send a retraction.
    expect(sync).toMatch(/snapshot\.filter\(\(r\) => r\?\.source === 'qbo'\)/);
  });

  it('retracts only when a projection was actually removed', () => {
    // A re-delivered Void/Delete webhook removes nothing and must not re-announce.
    expect(sync).toMatch(/if \(removedReceipt \|\| rows\.length\)/);
  });

  it('snapshots the payment rows before they are deleted', () => {
    const removal = sync.slice(sync.indexOf('export async function removeQboPaymentFromUpr'));
    const snapshot = removal.indexOf('reference_number');
    const rpcRemoval = removal.indexOf('remove_qbo_payment_receipt');
    const legacyDelete = removal.indexOf("db.delete('payments'");
    expect(snapshot).toBeGreaterThan(-1);
    expect(snapshot).toBeLessThan(rpcRemoval);
    expect(snapshot).toBeLessThan(legacyDelete);
  });

  it('registers presentation for every surface payment.received uses', () => {
    // Without all three entries the bell/push copy silently falls back to generic.
    expect(presentation.match(/'payment\.voided'/g)?.length).toBe(3);
    expect(presentation).toMatch(/case 'payment\.voided':/);
  });
});

describe('invoice Activity payment events', () => {
  it('records both a payment and its removal through the service-only writer', () => {
    expect(sync).toMatch(/eventType:\s*'payment_recorded'/);
    expect(sync).toMatch(/eventType:\s*'payment_removed'/);
    expect(sync).toMatch(/db\.rpc\('record_invoice_activity'/);
  });

  // The invoice_activity CHECK constraint rejects an object carrying any of
  // token/secret/password/authorization/body/message.
  it('never puts a constraint-rejected key in safe_metadata', () => {
    const helper = sync.slice(
      sync.indexOf('async function recordInvoiceActivity'),
      sync.indexOf('export async function notifyPaymentReceived'),
    );
    expect(helper).toContain('p_safe_metadata');
    for (const banned of ['token', 'secret', 'password', 'authorization']) {
      expect(sync).not.toMatch(new RegExp(`metadata:\\s*\\{[^}]*\\b${banned}\\b`, 'i'));
    }
  });

  // QuickBooks does not report WHICH human recorded or voided a payment
  // (MetaData.LastModifiedByRef names the OAuth connection), so inventing an
  // actor would be a lie the reader cannot detect.
  it('attributes payment activity to no employee rather than guessing', () => {
    const helper = sync.slice(
      sync.indexOf('async function recordInvoiceActivity'),
      sync.indexOf('export async function notifyPaymentReceived'),
    );
    expect(helper).toMatch(/p_actor_employee_id:\s*null/);
  });

  it('labels both new event types in the UI instead of showing the raw key', () => {
    expect(activityUi).toMatch(/payment_recorded:\s*'/);
    expect(activityUi).toMatch(/payment_removed:\s*'/);
  });

  // These events need no migration: the table, its writer RPC and its reader are
  // already applied (ledger 20260805005619) and event_type is free text.
  it('adds no migration for the Activity half', () => {
    expect(executable(migration)).not.toMatch(/invoice_activity/i);
  });
});
