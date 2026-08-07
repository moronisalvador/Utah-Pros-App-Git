/**
 * ════════════════════════════════════════════════
 * FILE: esign-situational-authorizations.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks the six new documents a client can sign — emergency removal,
 *   emergency demolition, coverage-not-confirmed, declined services, early
 *   equipment removal, and property access. It confirms the wording stored in
 *   the database is character-for-character the same as the copy kept in the
 *   app's code, that none of them contains text that would print wrong, and
 *   that every screen calls each document by the same name. Reads files as
 *   text; no database required.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path
 *   Internal:  supabase/migrations/20260807200000_esign_situational_authorization_templates.sql
 *              and its rollback, plus the seven label surfaces
 *   Data:      reads  → migration, rollback and application source text
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This proves INTENT, not EFFECT. It cannot prove the rows are actually in
 *     the database — that is the apply-window postflight (database-standard.md
 *     §5). What it does prove is that if they ARE applied, they say what the
 *     code thinks they say.
 *   - The JS/SQL body parity check is the important one. templateData.jsx is
 *     only the Settings editor's fallback; the SIGNING path reads the database.
 *     If they drift, staff edit one document and clients sign a different one.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const MIGRATION = read('supabase/migrations/20260807200000_esign_situational_authorization_templates.sql');
const ROLLBACK  = read('supabase/rollbacks/20260807200000_esign_situational_authorization_templates.rollback.sql');
const TEMPLATE_DATA = read('src/pages/settings/templates/templateData.jsx');

const stripSqlComments = (sql) =>
  sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const MIGRATION_CODE = stripSqlComments(MIGRATION);

const SITUATIONAL_KEYS = [
  'cat3_removal', 'emergency_demo', 'coverage_unconfirmed',
  'service_declined', 'equipment_early_removal', 'access_release',
];

/** Every doc type and the ONE label string all seven surfaces must use. */
const DOC_TYPE_LABELS = {
  coc:                     'Certificate of Completion',
  work_auth:               'Work Authorization',
  direction_pay:           'Direction of Pay',
  change_order:            'Change Order',
  recon_agreement:         'Reconstruction Agreement',
  cat3_removal:            'Emergency Removal Authorization',
  emergency_demo:          'Emergency Demolition Authorization',
  coverage_unconfirmed:    'Coverage Not Confirmed Acknowledgment',
  service_declined:        'Declination of Recommended Services',
  equipment_early_removal: 'Early Equipment Removal',
  access_release:          'Property Access Authorization',
  other:                   'Custom Authorization',
};

const LABEL_SURFACES = [
  'src/pages/SignPage.jsx',
  'src/pages/JobPage.jsx',
  'src/pages/tech/TechJobDocuments.jsx',
  'src/pages/settings/templates/templateData.jsx',
  'functions/api/send-esign.js',
  'functions/api/resend-esign.js',
  'functions/api/submit-esign.js',
];

/** Pull (heading, body) per doc type out of the migration's VALUES list. */
function sqlBodies() {
  const out = {};
  const re = /\(\s*\n\s*'([a-z0-9_]+)',\s*\n\s*'([^']*)',\s*\n\s*\$body\$([\s\S]*?)\$body\$\s*\n\s*\)/g;
  let m;
  while ((m = re.exec(MIGRATION)) !== null) out[m[1]] = { heading: m[2], body: m[3] };
  return out;
}

/** Pull (heading, body) per doc type out of DEFAULT_TEMPLATES. */
function jsBodies() {
  const out = {};
  for (const key of SITUATIONAL_KEYS) {
    const m = TEMPLATE_DATA.match(
      new RegExp(`\\n  ${key}: \\[\\{ division: null, sort_order: 1,\\s*\\n\\s*heading: '([^']*)',\\s*\\n\\s*body: \`([\\s\\S]*?)\` \\}\\],`),
    );
    if (m) out[key] = { heading: m[1], body: m[2] };
  }
  return out;
}

describe('situational authorization templates — migration', () => {
  const sql = sqlBodies();

  it('seeds exactly the six expected doc types', () => {
    expect(Object.keys(sql).sort()).toEqual([...SITUATIONAL_KEYS].sort());
  });

  it.each(SITUATIONAL_KEYS)('%s is seeded exactly once', (key) => {
    // SignPage renders EVERY document_templates row for a doc type while the PDF
    // builder reads only templates[0].body. Two rows = the client reads two
    // sections and signs one.
    const occurrences = MIGRATION_CODE.split(`'${key}'`).length - 1;
    expect(occurrences, `${key} should appear twice in code (VALUES row + NOT EXISTS guard is correlated)`).toBeGreaterThan(0);
    const valueRows = [...MIGRATION.matchAll(new RegExp(`\\n    '${key}',`, 'g'))];
    expect(valueRows).toHaveLength(1);
  });

  it('is idempotent through a correlated NOT EXISTS, not ON CONFLICT', () => {
    // document_templates has no unique constraint on (doc_type, division) —
    // recon_agreement legitimately holds 16 NULL-division rows — so ON CONFLICT
    // DO NOTHING would never fire and a re-apply would duplicate every row.
    expect(MIGRATION_CODE).toContain('WHERE NOT EXISTS');
    expect(MIGRATION_CODE).toContain('d.doc_type = t.doc_type');
    expect(MIGRATION_CODE).not.toContain('ON CONFLICT');
  });

  it('stays additive — no destructive DDL, no function, no grant', () => {
    for (const forbidden of ['DROP TABLE', 'DROP COLUMN', 'ALTER COLUMN', 'RENAME', 'DROP POLICY', 'CREATE POLICY', 'SET NOT NULL']) {
      expect(MIGRATION_CODE, `must not contain ${forbidden}`).not.toContain(forbidden);
    }
    // Statement-level, not word-level: the access_release body legitimately
    // contains the English word "grant" ("authorized to grant access to it"),
    // and a case-insensitive \bGRANT\b would flag the document's own wording.
    const statements = MIGRATION_CODE.split('\n').map((l) => l.trim());
    for (const line of statements) {
      expect(line, `unexpected DDL: ${line}`).not.toMatch(/^(GRANT|REVOKE|CREATE\s+OR\s+REPLACE\s+FUNCTION|ALTER\s+TABLE)\b/);
    }
  });

  it('ships a rollback scoped to exactly these six doc types', () => {
    for (const key of SITUATIONAL_KEYS) expect(ROLLBACK).toContain(`'${key}'`);
    expect(ROLLBACK).toContain('DELETE FROM public.document_templates');
    // Must not delete anything else in the table.
    expect(ROLLBACK).toContain('division IS NULL');
    for (const live of ['work_auth', 'coc', 'direction_pay', 'change_order', 'recon_agreement']) {
      expect(ROLLBACK.match(new RegExp(`'${live}'`)), `rollback must not touch ${live}`).toBeNull();
    }
  });
});

describe('situational authorization templates — wording', () => {
  const sql = sqlBodies();
  const js  = jsBodies();

  it.each(SITUATIONAL_KEYS)('%s: database wording matches the code copy exactly', (key) => {
    expect(js[key], `${key} missing from DEFAULT_TEMPLATES`).toBeTruthy();
    expect(sql[key], `${key} missing from the migration`).toBeTruthy();
    expect(js[key].heading).toBe(sql[key].heading);
    // Character-for-character. templateData.jsx is the Settings editor's
    // fallback; the database row is what the client actually signs.
    expect(js[key].body).toBe(sql[key].body);
  });

  it.each(SITUATIONAL_KEYS)('%s never uses {{insurance_section}}', (key) => {
    // It expands to a full irrevocable assignment of insurance benefits, and it
    // expands DIFFERENTLY in SignPage.jsx than in submit-esign.js — so the
    // client would read one version and sign another.
    expect(sql[key].body).not.toContain('{{insurance_section}}');
    expect(js[key].body).not.toContain('{{insurance_section}}');
  });

  it.each(SITUATIONAL_KEYS)('%s has no unfilled [bracketed] prompt', (key) => {
    // A bracketed prompt in a global template prints VERBATIM on the signed PDF.
    // The change_order template has shipped for months telling customers
    // "[Describe the additional work authorized here]". Do not add a second.
    const bracketed = sql[key].body.match(/\[[^\]\n]{6,}\]/);
    expect(bracketed, `${key} still contains ${bracketed?.[0]}`).toBeNull();
  });

  it.each(SITUATIONAL_KEYS)('%s only uses tokens BOTH renderers resolve', (key) => {
    const allowed = new Set([
      'client_name', 'job_number', 'address', 'city', 'state', 'zip',
      'date_of_loss', 'insurance_company', 'claim_number', 'policy_number',
      'adjuster_name', 'company_name', 'date',
    ]);
    for (const m of sql[key].body.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)) {
      expect(allowed.has(m[1].toLowerCase()), `${key} uses unsupported {{${m[1]}}}`).toBe(true);
    }
  });
});

describe('doc type labels agree across every surface', () => {
  it.each(LABEL_SURFACES)('%s names all twelve doc types identically', (surface) => {
    const src = read(surface);
    for (const [key, label] of Object.entries(DOC_TYPE_LABELS)) {
      // Tolerates both the spaced style and JobPage.jsx's minified one-liner.
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`['"]?${key}['"]?\\s*:\\s*'${escaped}'`);
      expect(src, `${surface} is missing or disagrees on ${key} → "${label}"`).toMatch(re);
    }
  });

  it('every PDF title is short enough not to run off the page', () => {
    // submit-esign.js draws DOC_TITLES[doc_type] with an UNWRAPPED drawText at
    // 18pt into a 500pt column. Helvetica-Bold at 18pt averages ~10pt/char.
    for (const label of Object.values(DOC_TYPE_LABELS)) {
      expect(label.length, `"${label}" is too long for the PDF title`).toBeLessThanOrEqual(45);
    }
  });
});

describe('countersignature block', () => {
  const SUBMIT = read('functions/api/submit-esign.js');

  it('covers the authorizations where the company is a party', () => {
    const m = SUBMIT.match(/const CO_SIGNED_DOC_TYPES = new Set\(\[([\s\S]*?)\]\)/);
    expect(m, 'CO_SIGNED_DOC_TYPES not found').toBeTruthy();
    const listed = [...m[1].matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]);
    for (const key of ['work_auth', 'change_order', 'recon_agreement', 'cat3_removal', 'emergency_demo', 'equipment_early_removal', 'service_declined']) {
      expect(listed, `${key} should be co-signed`).toContain(key);
    }
  });

  it('excludes pure acknowledgments and free text', () => {
    const m = SUBMIT.match(/const CO_SIGNED_DOC_TYPES = new Set\(\[([\s\S]*?)\]\)/);
    const listed = [...m[1].matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]);
    // 'other' especially: the block asserts the Director of Operations
    // pre-authorized the wording, which is false for text composed ad hoc.
    for (const key of ['coverage_unconfirmed', 'access_release', 'other', 'coc']) {
      expect(listed, `${key} must NOT be co-signed`).not.toContain(key);
    }
  });
});

describe('{{date}} renders the same on screen and in the PDF', () => {
  it('both substituteVars implementations resolve {{date}}', () => {
    // Before 2026-08-07 only SignPage did: a template using {{date}} showed the
    // real date on screen and the literal "{{date}}" in the signed PDF.
    expect(read('src/pages/SignPage.jsx')).toContain('{{date}}');
    const submit = read('functions/api/submit-esign.js');
    expect(submit).toMatch(/\\\{\\\{date\\\}\\\}/);
    // Threaded the real signing timestamp rather than a fresh Date() per call.
    expect(submit).toMatch(/function substituteVars\(body, job, signedAt = new Date\(\)\)/);
    expect(submit).toContain('substituteVars(templates[0].body, job, signedAt)');
  });

  it('the document label is HTML-escaped in every outbound email', () => {
    expect(read('functions/api/submit-esign.js')).not.toMatch(/<strong>\$\{docLabel\}<\/strong>/);
    expect(read('functions/api/send-esign.js')).not.toMatch(/<strong>\$\{doc_label\}<\/strong>/);
    expect(read('functions/api/submit-esign.js')).toContain('escHtml(docLabel)');
    expect(read('functions/api/send-esign.js')).toContain('escHtml(doc_label)');
  });
});
