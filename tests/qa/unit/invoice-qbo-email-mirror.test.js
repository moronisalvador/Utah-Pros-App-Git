/**
 * ════════════════════════════════════════════════
 * FILE: invoice-qbo-email-mirror.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Two guards for the change that lets UPR see QuickBooks' own invoice-email
 *   state. First, it reads the migration file and checks it only ADDS things and
 *   ships an undo. Second, it actually runs the worker helper that copies those
 *   facts in, proving it writes the three harmless columns and never touches the
 *   ones a database trigger owns.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path
 *   Internal:  supabase/migrations + supabase/rollbacks (read as text),
 *              functions/lib/qbo-invoice-email-mirror.js (imported and run)
 *
 * NOTES / GOTCHAS:
 *   - The migration half proves INTENT, not effect (close-out-standard.md §2b):
 *     it reads source in a credential-free lane. It is NOT a behavioral proof
 *     that the columns exist on any database — do not present it as one.
 *   - The mirror half IS behavioral: a fake db records every write, so the
 *     "never writes a trigger-owned column" claim is enforced rather than
 *     asserted. That is the claim worth the most here — writing qbo_emailed_at
 *     from an observation would move invoice status AND CRM lead value.
 * ════════════════════════════════════════════════
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  qboInvoiceEmailObservation,
  emailObservationChanged,
  mirrorQboInvoiceEmail,
  readEmailObservations,
  EMAIL_MIRROR_COLUMNS,
} from '../../../functions/lib/qbo-invoice-email-mirror.js';

const ROOT = join(import.meta.dirname, '../../..');
const NAME = '20260807190000_invoice_qbo_email_mirror';
const migration = readFileSync(join(ROOT, `supabase/migrations/${NAME}.sql`), 'utf8');
const rollback = readFileSync(join(ROOT, `supabase/rollbacks/${NAME}.rollback.sql`), 'utf8');

// Executable statements only. The header comment legitimately QUOTES the rollback
// DDL (documentation-standard.md requires a concrete undo), so asserting "no DROP"
// against the raw file would fail on its own documentation.
const stripComments = (sql) => sql
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');
const migrationDdl = stripComments(migration);

// Columns a database trigger derives, or that carry money. Writing any of these
// from a QuickBooks observation would let a read move UPR's own records:
// qbo_emailed_at feeds trg_invoice_qbo_lifecycle_status (invoice status) and
// crm_invoice_lead_value_sync (CRM lead value); the rest are trigger-owned per
// AGENTS.md §15.
const FORBIDDEN_COLUMNS = [
  'qbo_emailed_at', 'status', 'amount_paid', 'paid_at', 'line_total', 'sent_at',
  'total', 'adjusted_total', 'balance_due', 'updated_at',
];

// ─── SECTION: Migration source contract ──────────────

describe(`${NAME} — migration source contract`, () => {
  it('adds exactly the two new columns, both nullable', () => {
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS qbo_bill_email\s+text/);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS qbo_email_checked_at\s+timestamptz/);
    // A NOT NULL / DEFAULT on a live table is a rewrite, not an additive change.
    expect(migration).not.toMatch(/ADD COLUMN[^;]*NOT NULL/i);
  });

  it('is additive-only — no drop, rename, or column retype', () => {
    expect(migrationDdl).not.toMatch(/\bDROP\s+(TABLE|COLUMN|POLICY|FUNCTION|TRIGGER|CONSTRAINT)\b/i);
    expect(migrationDdl).not.toMatch(/\bRENAME\b/i);
    expect(migrationDdl).not.toMatch(/ALTER COLUMN/i);
  });

  it('changes no policy, grant, trigger, function, or row', () => {
    for (const forbidden of [
      /\bCREATE\s+(OR REPLACE\s+)?(POLICY|FUNCTION|TRIGGER)\b/i,
      /\bGRANT\b/i, /\bREVOKE\b/i,
      /\b(INSERT INTO|UPDATE\s+public\.|DELETE FROM)\b/i,
    ]) {
      expect(migrationDdl, `unexpected ${forbidden}`).not.toMatch(forbidden);
    }
  });

  it('touches no trigger-owned or money column', () => {
    for (const column of FORBIDDEN_COLUMNS) {
      // Word-bounded: `status` must not match inside `qbo_email_status`, which
      // this migration legitimately re-comments, and `total` must not match
      // inside `adjusted_total`.
      expect(migrationDdl, `DDL must not touch ${column}`)
        .not.toMatch(new RegExp(`\\b${column}\\b`));
    }
  });

  it('grants nothing to anon and needs no public allowlist entry', () => {
    expect(migrationDdl).not.toMatch(/\banon\b/);
  });

  it('reloads the PostgREST schema cache so the columns are queryable', () => {
    expect(migration).toContain("NOTIFY pgrst, 'reload schema'");
  });

  it('documents the rollback in the header per documentation-standard.md', () => {
    expect(migration).toContain('ROLLBACK:');
    expect(migration).toMatch(/ADDITIVE-ONLY/i);
  });
});

describe(`${NAME} — rollback contract`, () => {
  it('drops only the two columns this migration introduced', () => {
    expect(rollback).toMatch(/DROP COLUMN IF EXISTS qbo_bill_email/);
    expect(rollback).toMatch(/DROP COLUMN IF EXISTS qbo_email_checked_at/);
  });

  it('never drops qbo_email_status, which predates this migration', () => {
    // 20260624_invoice_qbo_email_status.sql created it and the CRM contact
    // activity projections read it; dropping it would be a contract removal.
    expect(rollback).not.toMatch(/DROP COLUMN IF EXISTS qbo_email_status/);
    expect(rollback).not.toMatch(/DROP COLUMN\s+qbo_email_status/);
  });

  it('restores the original qbo_email_status comment verbatim', () => {
    expect(rollback).toContain("'QBO EmailStatus after the most recent send (e.g. EmailSent).'");
  });

  it('carries the destructive-approved marker the hygiene gate requires', () => {
    expect(rollback).toMatch(/--\s*destructive-approved:\s*\S+/i);
  });

  it('states that application code must be reverted first', () => {
    // One Supabase sits behind dev and production: dropping a column a deployed
    // frontend still selects breaks production the instant it runs.
    expect(rollback).toMatch(/deploy/i);
    expect(rollback).toMatch(/frontend-contract freeze|database-standard\.md §3/i);
  });
});

// ─── SECTION: The worker mirror (behavioral) ──────────────

/** A db whose invoices table already has the mirror columns. */
function fakeDb(storedRows = []) {
  const writes = [];
  return {
    writes,
    select: vi.fn(async () => storedRows),
    update: vi.fn(async (table, filter, patch) => {
      writes.push({ table, filter, patch });
      return [];
    }),
  };
}

/** A db from BEFORE migration 20260807190000 — selecting the columns 400s. */
function preMigrationDb() {
  return {
    select: vi.fn(async () => {
      throw new Error('Supabase SELECT invoices: 400 column invoices.qbo_bill_email does not exist');
    }),
    update: vi.fn(async () => {
      throw new Error('Supabase UPDATE invoices: 400 column invoices.qbo_bill_email does not exist');
    }),
  };
}

describe('qboInvoiceEmailObservation', () => {
  it('reads status and billing address off a QuickBooks invoice', () => {
    expect(qboInvoiceEmailObservation({
      EmailStatus: 'EmailSent',
      BillEmail: { Address: 'invoices@presidiopm.com' },
    })).toEqual({
      qbo_email_status: 'EmailSent',
      qbo_bill_email: 'invoices@presidiopm.com',
    });
  });

  it('treats a missing BillEmail on a full read as "nobody on the envelope"', () => {
    expect(qboInvoiceEmailObservation({ EmailStatus: 'NotSet' })).toEqual({
      qbo_email_status: 'NotSet',
      qbo_bill_email: null,
    });
  });

  // The sparse-projection trap: absence of EmailStatus means "we did not ask",
  // and writing null for it would ERASE a status we already knew.
  it('refuses to observe an entity that carries no EmailStatus', () => {
    expect(qboInvoiceEmailObservation({ Id: '4839', DocNumber: 'W-2606-005' })).toBeNull();
    expect(qboInvoiceEmailObservation({ EmailStatus: '   ' })).toBeNull();
    expect(qboInvoiceEmailObservation(null)).toBeNull();
    expect(qboInvoiceEmailObservation([])).toBeNull();
    expect(qboInvoiceEmailObservation('EmailSent')).toBeNull();
  });
});

describe('emailObservationChanged', () => {
  const seen = { qbo_email_status: 'EmailSent', qbo_bill_email: 'a@b.com' };

  it('always writes the first observation, even when the values already match', () => {
    // An older UPR send wrote qbo_email_status but no checked_at; stamping it is
    // what lets the UI tell "not emailed" apart from "never asked".
    expect(emailObservationChanged({ ...seen, qbo_email_checked_at: null }, seen)).toBe(true);
  });

  it('skips a re-observation that changed nothing', () => {
    expect(emailObservationChanged({ ...seen, qbo_email_checked_at: '2026-08-07T00:00:00Z' }, seen))
      .toBe(false);
  });

  it('detects a status change and a billing-address change independently', () => {
    const stored = { ...seen, qbo_email_checked_at: '2026-08-07T00:00:00Z' };
    expect(emailObservationChanged(stored, { ...seen, qbo_email_status: 'NotSet' })).toBe(true);
    expect(emailObservationChanged(stored, { ...seen, qbo_bill_email: 'other@b.com' })).toBe(true);
    expect(emailObservationChanged(stored, { ...seen, qbo_bill_email: null })).toBe(true);
  });

  it('is false when there is nothing to observe', () => {
    expect(emailObservationChanged({ qbo_email_checked_at: null }, null)).toBe(false);
  });
});

describe('readEmailObservations', () => {
  it('returns a map keyed by invoice id and asks for only its own columns', async () => {
    const db = fakeDb([{ id: 'inv-1', qbo_email_status: 'EmailSent' }]);
    const map = await readEmailObservations(db, ['inv-1']);
    expect(map.get('inv-1').qbo_email_status).toBe('EmailSent');
    expect(db.select).toHaveBeenCalledWith('invoices', `id=in.(inv-1)&select=id,${EMAIL_MIRROR_COLUMNS}`);
  });

  // The pre-apply state. Returning an empty map here would be wrong: callers
  // would read it as "nothing observed yet" and write on every single invoice.
  it('returns null — not an empty map — when the columns do not exist yet', async () => {
    expect(await readEmailObservations(preMigrationDb(), ['inv-1'])).toBeNull();
  });

  it('reads nothing for an empty id list', async () => {
    const db = fakeDb();
    expect(await readEmailObservations(db, [])).toEqual(new Map());
    expect(db.select).not.toHaveBeenCalled();
  });

  it('deduplicates ids so a combined bill does not repeat them', async () => {
    const db = fakeDb([]);
    await readEmailObservations(db, ['inv-1', 'inv-1', 'inv-2']);
    expect(db.select.mock.calls[0][1]).toContain('id=in.(inv-1,inv-2)');
  });

  // The whole invoice book in one `id=in.(...)` would be a multi-kilobyte URL.
  it('chunks a large id list instead of building one enormous filter', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const db = fakeDb([]);
    await readEmailObservations(db, ids);
    expect(db.select).toHaveBeenCalledTimes(3);
    for (const [, filter] of db.select.mock.calls) {
      expect(filter.length).toBeLessThan(4500);
    }
  });

  it('merges every chunk into one map', async () => {
    const pages = [[{ id: 'a' }], [{ id: 'b' }]];
    let call = 0;
    const db = { select: vi.fn(async () => pages[call++] || []) };
    const ids = Array.from({ length: 150 }, (_, i) => `id-${i}`);
    const map = await readEmailObservations(db, ids);
    expect([...map.keys()]).toEqual(['a', 'b']);
  });

  // A partial map would read as "these were never observed" and rewrite them all.
  it('returns null when any chunk fails, never a partial map', async () => {
    let call = 0;
    const db = {
      select: vi.fn(async () => {
        if (call++ === 1) throw new Error('Supabase SELECT invoices: 500');
        return [{ id: 'a' }];
      }),
    };
    const ids = Array.from({ length: 150 }, (_, i) => `id-${i}`);
    expect(await readEmailObservations(db, ids)).toBeNull();
  });
});

describe('mirrorQboInvoiceEmail', () => {
  const qboInvoice = { EmailStatus: 'EmailSent', BillEmail: { Address: 'invoices@presidiopm.com' } };

  it('writes ONLY the three observation columns', async () => {
    const db = fakeDb();
    await mirrorQboInvoiceEmail(db, ['inv-1'], qboInvoice);

    expect(db.writes).toHaveLength(1);
    expect(db.writes[0].table).toBe('invoices');
    expect(Object.keys(db.writes[0].patch).sort())
      .toEqual(['qbo_bill_email', 'qbo_email_checked_at', 'qbo_email_status']);
    expect(db.writes[0].patch.qbo_email_status).toBe('EmailSent');
    expect(db.writes[0].patch.qbo_bill_email).toBe('invoices@presidiopm.com');
    expect(typeof db.writes[0].patch.qbo_email_checked_at).toBe('string');
  });

  // The load-bearing guarantee. qbo_emailed_at drives invoice status and CRM lead
  // value; a QuickBooks read must never be able to move either.
  it('never writes a trigger-owned or money column', async () => {
    const db = fakeDb();
    await mirrorQboInvoiceEmail(db, ['inv-1'], qboInvoice);
    for (const write of db.writes) {
      for (const column of FORBIDDEN_COLUMNS) {
        expect(write.patch, `must not write ${column}`).not.toHaveProperty(column);
      }
    }
  });

  it('scopes each write to one invoice id', async () => {
    const db = fakeDb();
    await mirrorQboInvoiceEmail(db, ['inv-1'], qboInvoice);
    expect(db.writes[0].filter).toBe('id=eq.inv-1');
  });

  it('writes every UPR invoice behind one combined QuickBooks bill', async () => {
    // A combined QBO invoice legitimately backs several UPR rows.
    const db = fakeDb();
    const result = await mirrorQboInvoiceEmail(db, ['inv-1', 'inv-2'], qboInvoice);
    expect(result.written).toBe(2);
    expect(db.writes.map((w) => w.filter)).toEqual(['id=eq.inv-1', 'id=eq.inv-2']);
  });

  it('writes nothing when the observation is unchanged', async () => {
    const db = fakeDb([{
      id: 'inv-1',
      qbo_email_status: 'EmailSent',
      qbo_bill_email: 'invoices@presidiopm.com',
      qbo_email_checked_at: '2026-08-07T00:00:00Z',
    }]);
    const result = await mirrorQboInvoiceEmail(db, ['inv-1'], qboInvoice);
    expect(db.update).not.toHaveBeenCalled();
    expect(result.written).toBe(0);
  });

  it('accepts a pre-read batch instead of reading again', async () => {
    const stored = new Map([['inv-1', {
      id: 'inv-1',
      qbo_email_status: 'EmailSent',
      qbo_bill_email: 'invoices@presidiopm.com',
      qbo_email_checked_at: '2026-08-07T00:00:00Z',
    }]]);
    const db = fakeDb();
    await mirrorQboInvoiceEmail(db, ['inv-1'], qboInvoice, { stored });
    expect(db.select).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('writes nothing when the QuickBooks entity carried no email projection', async () => {
    const db = fakeDb();
    await mirrorQboInvoiceEmail(db, ['inv-1'], { Id: '4839', TotalAmt: 100 });
    expect(db.update).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
  });

  it('ignores empty ids', async () => {
    const db = fakeDb();
    await mirrorQboInvoiceEmail(db, [null, undefined, ''], qboInvoice);
    expect(db.update).not.toHaveBeenCalled();
  });

  // THE PRE-APPLY CONTRACT. This code merges to dev before migration
  // 20260807190000 is applied to the shared project; it must be inert, not noisy.
  it('is a silent no-op before the migration is applied', async () => {
    const db = preMigrationDb();
    const result = await mirrorQboInvoiceEmail(db, ['inv-1', 'inv-2'], qboInvoice);
    expect(result).toEqual({ written: 0, skipped: 2, unavailable: true });
    // Crucially it does NOT fall through to a write that would 400 every time.
    expect(db.update).not.toHaveBeenCalled();
  });

  // Best-effort by contract: every caller sits on a completed money action.
  it('swallows a write failure instead of failing the money action', async () => {
    const db = {
      select: vi.fn(async () => []),
      update: vi.fn(async () => { throw new Error('Supabase UPDATE invoices: 500'); }),
    };
    await expect(mirrorQboInvoiceEmail(db, ['inv-1'], qboInvoice)).resolves
      .toEqual({ written: 0, skipped: 1 });
  });

  it('survives a db client with no methods at all', async () => {
    await expect(mirrorQboInvoiceEmail({}, ['inv-1'], qboInvoice)).resolves
      .toEqual({ written: 0, skipped: 1, unavailable: true });
  });
});

// ─── SECTION: Call sites stay honest ──────────────

describe('call sites', () => {
  // The pre-apply trap: migration 20260807190000 is deliberately unapplied while
  // this code deploys. PostgREST 400s on an unknown column and db.select THROWS,
  // so a caller naming these columns in its OWN select would break outright —
  // qbo-invoice-drift would 500 and adoptInvoiceFromQboEstimate would abort a
  // payment adoption. Only the self-guarding lib may name them.
  it('no caller selects the new columns itself', () => {
    expect(EMAIL_MIRROR_COLUMNS).toBe('qbo_email_status,qbo_bill_email,qbo_email_checked_at');
    const callers = [
      'functions/lib/qbo-payment-sync.js',
      'functions/api/qbo-invoice-drift.js',
      'functions/api/qbo-invoice.js',
    ];
    for (const file of callers) {
      const source = readFileSync(join(ROOT, file), 'utf8');
      const selects = source.split('\n').filter((l) => l.includes('select=') && !l.trimStart().startsWith('//'));
      for (const line of selects) {
        expect(line, `${file} must not select qbo_bill_email`).not.toContain('qbo_bill_email');
        expect(line, `${file} must not select qbo_email_checked_at`).not.toContain('qbo_email_checked_at');
      }
    }
  });

  it('the drift sweep reads observations once, batched, and skips when unavailable', () => {
    const source = readFileSync(join(ROOT, 'functions/api/qbo-invoice-drift.js'), 'utf8');
    // One read for the whole book — not one per invoice (hundreds of round trips).
    expect(source).toMatch(/readEmailObservations\(db, \(rows \|\| \[\]\)\.map\(\(r\) => r\.id\)\)/);
    // Null (columns absent) skips the entire mirror rather than writing per row.
    expect(source).toMatch(/if \(observed\) \{/);
    expect(source).toMatch(/\{ stored: observed \}/);
  });

  it('the drift sweep selects BillEmail alongside EmailStatus', () => {
    // Selecting EmailStatus alone would make the helper read a missing BillEmail
    // as "no billing address" and wipe a known one across the whole book.
    const source = readFileSync(join(ROOT, 'functions/api/qbo-invoice-drift.js'), 'utf8');
    expect(source).toMatch(/SELECT [^`]*EmailStatus, BillEmail FROM Invoice/);
  });

  it('qbo-invoice.js keeps the bill email on the frozen command result', () => {
    // The raw QBO entity is gone on the provider_succeeded crash-recovery path,
    // so both email fields must survive into provider_result.
    const source = readFileSync(join(ROOT, 'functions/api/qbo-invoice.js'), 'utf8');
    expect(source).toContain('bill_email: providerResult.BillEmail?.Address ?? null');
    expect(source).toContain('email_status: providerResult.EmailStatus ?? null');
    expect(source).toMatch(/mirrorQboInvoiceEmail\(db, \[invoiceId\]/);
    // A delete has no invoice left to describe.
    expect(source).toMatch(/if \(action !== 'delete'\) \{\s*await mirrorQboInvoiceEmail/);
  });
});
