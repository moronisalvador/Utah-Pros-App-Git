// ═════════════════════════════════════════════════════════════════════════════
// FILE: message-outbound-thread-notification.test.js
// WHAT: CI-visible source contract for the "teammate sent a text" alert
//       (2026-08-04). Proves the migration is a single additive catalog seed
//       with a paired rollback, and — the part that actually matters — that the
//       producer can never notify the author of the message or hand the
//       dispatcher its own recipient list. The audience must stay owned by the
//       database's conversation-access predicate.
//
// SCOPE HONESTY: this asserts INTENT from source text, not live effect. The
//       behavioural proof (real recipients, real APNs delivery) belongs to the
//       db lane and an on-device check, per close-out-standard.md §2b.
// ═════════════════════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');

// The blast-radius assertions below are about EXECUTABLE SQL. Both files
// deliberately discuss DROP/UPDATE/DELETE in their required header and ROLLBACK
// prose, so strip `--` comments first or the prose fails its own contract.
const executable = (sql) => sql
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');

const migration = read(
  '../../../supabase/migrations/20260804120000_message_outbound_thread_notification.sql',
);
const rollback = read(
  '../../../supabase/rollbacks/20260804120000_message_outbound_thread_notification.rollback.sql',
);
const notify = read('../../../functions/api/notify.js');
const sendMessage = read('../../../functions/api/send-message.js');
const presentation = read('../../../functions/lib/notificationPresentation.js');

describe('message.outbound migration', () => {
  it('is a single additive catalog seed — no DDL, no grant, no policy change', () => {
    const sql = executable(migration);
    expect(sql.match(/INSERT INTO/gi)).toHaveLength(1);
    expect(sql).toContain("'message.outbound'");
    expect(sql).toContain("'message.note'");
    expect(sql).toContain('ON CONFLICT (type_key) DO NOTHING');
    // Additive-only per database-standard.md §3: nothing here may reshape a live
    // object, and nothing may touch an existing catalog row.
    expect(sql).not.toMatch(/\b(?:DROP|RENAME|ALTER\s+TABLE|ALTER\s+COLUMN)\b/i);
    expect(sql).not.toMatch(/\b(?:UPDATE|DELETE)\s/i);
    expect(sql).not.toMatch(/\b(?:GRANT|REVOKE|CREATE\s+POLICY)\b/i);
    expect(sql).not.toMatch(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION/i);
    // A migration must never seed a real secret (database-standard.md §4).
    expect(sql).not.toMatch(/notification_types[\s\S]*(?:token|secret|api_key)/i);
  });

  it('matches the live message.inbound channel posture: bell + push, email off', () => {
    // Email deliberately off — the same decision already recorded for
    // message.inbound in 20260726211000_message_inbound_email_not_an_option.sql.
    expect(migration).toMatch(/true,\s*true,\s*false,\s*true,\s*11/);
    expect(migration).toMatch(/true,\s*true,\s*false,\s*true,\s*12/);
  });

  it('ships a rollback that clears the RESTRICT-ing audit rows first', () => {
    const sql = executable(rollback);
    const audit = sql.indexOf('notification_presentation_audit');
    const types = sql.indexOf('DELETE FROM public.notification_types');
    expect(audit).toBeGreaterThan(-1);
    // notification_presentation_audit.type_key is ON DELETE RESTRICT, so the
    // type row cannot go first. Every other child FK cascades.
    expect(types).toBeGreaterThan(audit);
    expect(sql).toContain("'message.outbound'");
    // The rollback must not reach beyond this one type: EVERY delete statement
    // carries the message.outbound predicate, so an unscoped wipe cannot ship.
    const deletes = sql.split(';')
      .map((statement) => statement.trim())
      .filter((statement) => /^DELETE FROM/i.test(statement));
    expect(deletes).toHaveLength(2);
    for (const statement of deletes) {
      expect(statement).toMatch(
        /WHERE type_key IN \('message\.outbound', 'message\.note'\)$/,
      );
    }
  });
});

describe('message.outbound audience is owned by the database, not the producer', () => {
  it('resolves through the same conversation-access RPC as message.inbound', () => {
    expect(notify).toMatch(
      /CONVERSATION_AUDIENCE_TYPES = new Set\(\[\s*'message\.inbound',\s*'message\.outbound',\s*'message\.note',/,
    );
    expect(notify).toContain("db.rpc('get_conversation_notification_recipients'");
  });

  it('applies the author exclusion only AFTER the database predicate', () => {
    const resolver = notify.slice(
      notify.indexOf('async function resolveConversationMessageAudience'),
      notify.indexOf('async function loadTimeEntryChangeRequest'),
    );
    const rpcCall = resolver.indexOf('get_conversation_notification_recipients');
    const exclusion = resolver.indexOf('exclude_employee_id');
    expect(rpcCall).toBeGreaterThan(-1);
    // An exclusion applied after the predicate can only narrow the audience.
    // Reordering these would let producer input decide who sees message content.
    expect(exclusion).toBeGreaterThan(rpcCall);
    expect(resolver).toMatch(/filterActiveInternalEmployeeIds/);
  });

  it('never lets the producer hand over a recipient list', () => {
    const producer = sendMessage.slice(
      sendMessage.indexOf('export async function notifyThreadMessageSent'),
      sendMessage.indexOf('export async function onRequestOptions'),
    );
    expect(producer).toContain("isInternalNote ? 'message.note' : 'message.outbound'");
    expect(producer).toContain('exclude_employee_id: senderEmployeeId');
    expect(producer).not.toContain('recipient_ids');
  });

  it('never describes a staff-only note as something the customer received', () => {
    const producer = sendMessage.slice(
      sendMessage.indexOf('export async function notifyThreadMessageSent'),
      sendMessage.indexOf('export async function onRequestOptions'),
    );
    // The note title branch must not borrow the "texted"/"sent a text" wording.
    const noteTitle = producer.slice(
      producer.indexOf('title: isInternalNote'),
      producer.indexOf('body: preview'),
    );
    const noteBranch = noteTitle.slice(0, noteTitle.indexOf(': ('));
    expect(noteBranch).toContain('Note from');
    expect(noteBranch).not.toMatch(/texted|sent a text/);
  });

  it('announces a note only once — replays and race-losers stay silent', () => {
    // The idempotent replay returns before the producer; the race-loser adopts a
    // row another request already announced.
    expect(sendMessage).toMatch(/let noteIsNew = true;/);
    expect(sendMessage).toMatch(/noteIsNew = false;/);
    expect(sendMessage).toMatch(/if \(noteIsNew\) \{\s*await scheduleThreadAlert\(context, \{/);
  });

  it('keeps the alert fire-and-forget and supplies the iOS de-duplication id', () => {
    const producer = sendMessage.slice(
      sendMessage.indexOf('export async function notifyThreadMessageSent'),
      sendMessage.indexOf('export async function onRequestOptions'),
    );
    // A notify failure must never fail a text that already left the building.
    expect(producer).toMatch(/catch\s*\{\s*\/\*[^}]*\*\/\s*\}/);
    // notify.js skips the APNs push outright when this is absent.
    expect(producer).toContain('notification_event_id: messageId');
  });

  it('only announces work done on THIS request', () => {
    // Direct path guards on `sent` (provider accepted). Group path guards on
    // `anyAccepted` AND `anyFreshSend` — a replay recovers every participant's
    // existing row, which satisfies anyAccepted but must not re-announce.
    expect(sendMessage).toMatch(/if \(sent\) \{\s*await scheduleThreadAlert\(context, \{/);
    expect(sendMessage).toMatch(
      /if \(anyAccepted && anyFreshSend\) \{\s*await scheduleThreadAlert\(context, \{/,
    );
    expect(sendMessage).toMatch(/let anyFreshSend = false;/);
  });

  it('defers the alert to the platform instead of blocking the sender', () => {
    // get_conversation_notification_recipients returns every admin/office/PM/
    // supervisor, and dispatchEvent walks them serially — awaiting that inline
    // would put the whole fan-out in front of the composer's response.
    const scheduler = sendMessage.slice(
      sendMessage.indexOf('function scheduleThreadAlert'),
      sendMessage.indexOf('export async function onRequestOptions'),
    );
    expect(scheduler).toContain("typeof context?.waitUntil === 'function'");
    expect(scheduler).toContain('context.waitUntil(pending)');
    // Falls back to awaiting rather than dropping the alert.
    expect(scheduler).toContain('return pending;');
  });
});

describe('presentation reaches every surface for both authored types', () => {
  it.each(['message.outbound', 'message.note'])(
    '%s has bell, PWA push, and native push copy with a thread deep link',
    (typeKey) => {
      expect(presentation).toContain(`'${typeKey}': browserAndNative({`);
      expect(presentation).toMatch(
        new RegExp(`'${typeKey.replace('.', '\\.')}': \\{\\s*title: \\(\\) =>`),
      );
      const configured = presentation
        .slice(presentation.indexOf(`'${typeKey}': browserAndNative({`))
        .slice(0, 400);
      expect(configured).toContain("nativeRoute: 'conversation.thread'");
      expect(configured).toContain('sender_name');
      expect(configured).toContain('customer_name');
      expect(configured).toContain('message_preview');
    },
  );

  it('leads the note copy with "Note from" on every surface', () => {
    const configured = presentation
      .slice(presentation.indexOf("'message.note': browserAndNative({"))
      .slice(0, 400);
    expect(configured).toMatch(/title: 'Note from \{\{sender_name\}\}/);
  });
});
