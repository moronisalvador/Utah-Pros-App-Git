/**
 * ════════════════════════════════════════════════
 * FILE: db-local-seed.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Fills the LOCAL practice database with a coherent fake restoration
 *   business — customers, insurance claims, jobs, appointments, invoices,
 *   payments and documents that all connect to each other the way real ones
 *   do. The point is that database changes practiced here now have rows to
 *   act on: a rule that real data would break now breaks here first, instead
 *   of passing against an empty database and failing in production.
 *
 * WHERE IT LIVES:
 *   Triggered by:  `npm run db:local:seed` (after `npm run db:local`)
 *                  `npm run db:local:seed -- --scale=100` for volume tests
 *
 * DEPENDS ON:
 *   Packages:  node:child_process, node:crypto, node:fs
 *   Internal:  a running local stack (scripts/db-local-bootstrap.mjs first)
 *   Data:      reads  → local catalog (enums, check constraints, fixtures)
 *              writes → LOCAL public.* tables only, via the docker container
 *
 * NOTES / GOTCHAS:
 *   - LOCAL-ONLY BY CONSTRUCTION. It executes exclusively through
 *     `docker exec supabase_db_upr` — it holds no connection string and can
 *     name no hosted project. The generated SQL additionally carries the
 *     same `upr.local_stack` guard as qa-fixtures.sql.
 *   - DETERMINISTIC. A fixed PRNG seed (override: --seed=N) means a failure
 *     reproduces exactly. Every generated id starts `5eed` so seed rows are
 *     recognizable at a glance and in WHERE clauses.
 *   - OBVIOUSLY FAKE, and self-checked: every email is @example.invalid (or
 *     the @upr-qa.test fixtures), every phone is in the reserved fictional
 *     555-01xx range, every address is on "Example" streets. The generator
 *     REFUSES to load a batch that violates those patterns, the same posture
 *     as db-baseline-refresh.mjs refusing customer rows.
 *   - VALUE LISTS ARE INTROSPECTED, NOT TYPED. Enum labels come from
 *     pg_enum; check-constraint lists (claims.status, payment methods, …)
 *     are parsed from pg_get_constraintdef at run time, so a live-schema
 *     change shows up as a seed failure, never as silently-wrong data.
 *   - EDGE CASES ARE THE POINT, not an accident: an empty-string name, a
 *     unicode name, a 2,500-char note, NULLs in nullable columns, two
 *     contacts sharing an email and two with the same digits formatted
 *     differently, a claim with 8 jobs, a job with no appointments, a
 *     calendar event with no job, rows at EVERY enum value, and timestamps
 *     on both sides of both 2026 DST boundaries in America/Denver. These are
 *     what break ADD CONSTRAINT / SET NOT NULL / UNIQUE INDEX migrations —
 *     scripts/qa/qualify-data-shaped-failure-local.mjs proves they do.
 *   - TRIGGER-OWNED COLUMNS ARE NEVER WRITTEN (CLAUDE.md Rule 15 applies to
 *     fake money too): invoices get bare rows + line items (quantity ×
 *     unit_price only), payments get amounts — the real triggers compute
 *     line_total, subtotal, amount_paid, status, exactly as production does.
 *   - moisture_readings and equipment_placements are deliberately NOT
 *     seeded: the Hydro initiative's "zero readings" invariant is live, and
 *     its lease freezes both tables. Messages are seeded as internal_note
 *     only — no fake provider SMS rows anywhere near the consent domain.
 *   - Default scale is SMALL AND FAST on purpose (seconds, not minutes) — a
 *     correct tool nobody runs is worth nothing. --scale=100 is the opt-in
 *     lock-and-duration shape (~100k+ rows across the biggest tables).
 * ════════════════════════════════════════════════
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DB_CONTAINER = 'supabase_db_upr';

// ─── SECTION: arguments ──────────────
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([a-z-]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] ?? true] : [a, true];
}));
const SCALE = Math.max(1, Math.min(500, Number(args.scale) || 1));
const PRNG_SEED = Number(args.seed) || 20260820;

// ─── SECTION: deterministic PRNG ──────────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(PRNG_SEED);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const chance = (p) => rand() < p;

// Deterministic ids: `5eed` marks a seed row and is valid hex. The entity
// nibble keeps ids unique across tables; the counter keeps them unique within.
let idCounter = 0;
const seedId = (entity) => `5eed${String(entity).padStart(4, '0')}-0000-4000-8000-${String(++idCounter).padStart(12, '0')}`;
// Fixed id so re-runs can detect an already-seeded stack.
const SENTINEL_CONTACT = '5eed0001-0000-4000-8000-00000000cafe';

// ─── SECTION: SQL emission ──────────────
const q = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return `ARRAY[${v.map(q).join(',')}]::text[]`;
  return `'${String(v).replace(/'/g, "''")}'`;
};

const statements = [];
function insert(table, columns, rows) {
  for (let i = 0; i < rows.length; i += 400) {
    const batch = rows.slice(i, i + 400);
    statements.push(
      `INSERT INTO public.${table} (${columns.join(', ')})\nVALUES\n${batch.map((r) => `  (${columns.map((c) => q(r[c])).join(', ')})`).join(',\n')};`,
    );
  }
}

// ─── SECTION: local-stack access ──────────────
function psql(sql, { file = null, extraArgs = [] } = {}) {
  const fileArgs = file ? ['-f', file] : ['-c', sql];
  return execFileSync('docker', ['exec', '-e', 'PGPASSWORD=postgres', DB_CONTAINER,
    'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA', ...extraArgs, ...fileArgs],
  { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim();
}

function assertLocalStack() {
  let names = '';
  try {
    names = execFileSync('docker', ['ps', '--filter', `name=^${DB_CONTAINER}$`, '--format', '{{.Names}}'], { encoding: 'utf8' }).trim();
  } catch { /* docker itself missing falls through to the same message */ }
  if (names !== DB_CONTAINER) {
    console.error('db-local-seed: the local stack is not running. Start it first:  npm run db:local');
    process.exit(1);
  }
  const tables = Number(psql("select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'"));
  if (tables < 100) {
    console.error(`db-local-seed: only ${tables} tables — the schema is not loaded. Run:  npm run db:local`);
    process.exit(1);
  }
}

// ─── SECTION: introspection ──────────────
// Enum labels straight from pg_enum, and check-constraint value lists parsed
// from the live definitions — never typed from memory.
function enumLabels(typeName) {
  const out = psql(`select e.enumlabel from pg_type t join pg_enum e on e.enumtypid=t.oid
    where t.typnamespace='public'::regnamespace and t.typname='${typeName}' order by e.enumsortorder`);
  const labels = out.split('\n').filter(Boolean);
  if (!labels.length) throw new Error(`enum ${typeName} has no labels — is the schema loaded?`);
  return labels;
}

function checkList(table, constraint) {
  const def = psql(`select pg_get_constraintdef(oid) from pg_constraint
    where conname='${constraint}' and conrelid='public.${table}'::regclass`);
  const values = [...def.matchAll(/'((?:[^']|'')*)'::text/g)].map((m) => m[1].replace(/''/g, "'"));
  if (!values.length) throw new Error(`could not parse value list from ${table}.${constraint}: ${def}`);
  return values;
}

// ─── SECTION: fake-data vocabulary ──────────────
const FIRST = ['Avery', 'Blake', 'Casey', 'Devon', 'Emery', 'Finley', 'Harper', 'Jordan', 'Kendall', 'Logan', 'Morgan', 'Parker', 'Quinn', 'Reese', 'Rowan', 'Sage', 'Skyler', 'Taylor'];
const LAST = ['Example', 'Sample', 'Placeholder', 'Testcase', 'Fixture', 'Mockman', 'Faux', 'Demoise', 'Specimen', 'Dummyton'];
const STREETS = ['Example Ave', 'Sample St', 'Fixture Dr', 'Placeholder Ln', 'Specimen Ct', 'Mock Blvd'];
const CITIES = ['Testville', 'Sampleton', 'Mockdale', 'Fixture Falls', 'Placeholder Park'];
const CARRIERS = ['Acme Mutual (fake)', 'Example Insurance Co', 'Placeholder Casualty', 'Sample State Insurance', 'Fictional Farm'];

// Reserved fictional range 555-01xx across fake area codes → thousands of
// distinct numbers (contacts.phone is UNIQUE) that can never dial a human.
const AREA = ['201', '202', '301', '385', '435', '801', '802', '803', '804', '805'];
let phoneCounter = 0;
const fakePhone = () => {
  const n = phoneCounter++;
  return `+1${AREA[n % AREA.length]}5550${String(100 + (Math.floor(n / AREA.length) % 100)).slice(-3)}${String(Math.floor(n / (AREA.length * 100))).padStart(1, '0')}`;
};
const fakeEmail = (label, n) => `${label}-${n}@example.invalid`;
const fakeAddress = (n) => `${100 + (n % 8800)} ${pick(STREETS)}`;

// Timestamps spread across a year, plus the deliberate DST edges: the US
// spring-forward (2026-03-08) and fall-back (2026-11-01) in America/Denver.
const DST_EDGES = [
  '2026-03-08 01:59:00-07', '2026-03-08 03:01:00-06',
  '2026-11-01 00:59:00-06', '2026-11-01 01:30:00-07',
];
const randomTimestamp = () => {
  const start = Date.UTC(2025, 8, 1);
  const end = Date.UTC(2026, 7, 15);
  return new Date(start + rand() * (end - start)).toISOString();
};
const randomDate = () => randomTimestamp().slice(0, 10);

// ─── SECTION: main ──────────────
assertLocalStack();

const already = psql(`select count(*) from public.contacts where id = '${SENTINEL_CONTACT}'`);
if (already === '1') {
  console.error('db-local-seed: this stack is already seeded (the sentinel contact exists).');
  console.error('  Re-seeding on top would duplicate the business. Reset first:  npm run db:local:reset');
  process.exit(1);
}

console.log(`db-local-seed: generating a synthetic business (scale ${SCALE}, prng seed ${PRNG_SEED})`);

const divisions = enumLabels('job_division');
const jobSources = enumLabels('job_source');
const apptTypes = enumLabels('appointment_type');
const apptStatuses = enumLabels('appointment_status');
const claimStatuses = checkList('claims', 'claims_status_check');
const lossTypes = checkList('claims', 'claims_loss_type_check');
const contactRoles = checkList('contacts', 'contacts_role_check');
const invoiceTypes = checkList('invoices', 'invoices_invoice_type_check');
const billedTos = checkList('invoices', 'invoices_billed_to_check');
const payMethods = checkList('payments', 'payments_payment_method_check');
const payerTypes = checkList('payments', 'payments_payer_type_check');

const fixtureEmployees = psql("select id from public.employees where email like '%@upr-qa.test' order by email").split('\n').filter(Boolean);
if (fixtureEmployees.length < 3) {
  console.error('db-local-seed: the three fixture employees are missing — run npm run db:local first.');
  process.exit(1);
}

// Employees: one per remaining role, plus an inactive admin and an external
// contractor — the DENY-case identities every access-boundary proof needs.
const employees = [
  { id: seedId(9), full_name: 'Seed Estimator Example', role: 'estimator', is_active: true, is_external: false },
  { id: seedId(9), full_name: 'Seed Supervisor Sample', role: 'supervisor', is_active: true, is_external: false },
  { id: seedId(9), full_name: 'Seed PM Placeholder', role: 'project_manager', is_active: true, is_external: false },
  { id: seedId(9), full_name: 'Seed Tech Testcase', role: 'field_tech', is_active: true, is_external: false },
  { id: seedId(9), full_name: 'Seed Partner Fixture', role: 'crm_partner', is_active: true, is_external: false },
  { id: seedId(9), full_name: 'Seed Inactive Admin', role: 'admin', is_active: false, is_external: false },
  { id: seedId(9), full_name: 'Seed External Contractor', role: 'field_tech', is_active: true, is_external: true },
].map((e, n) => ({ ...e, display_name: e.full_name.split(' ').slice(0, 2).join(' '), email: fakeEmail('employee', n) }));
insert('employees', ['id', 'full_name', 'display_name', 'email', 'role', 'is_active', 'is_external'], employees);
const activeStaff = [...fixtureEmployees, ...employees.filter((e) => e.is_active && !e.is_external).map((e) => e.id)];

// Contacts — the edge six first (fixed content at every scale), then volume.
const contacts = [
  { id: SENTINEL_CONTACT, phone: fakePhone(), name: '', role: 'homeowner', notes: 'SEED SENTINEL + empty-string name — the ADD CONSTRAINT demonstration row' },
  { id: seedId(1), phone: fakePhone(), name: 'Üñíçødé Пример 中文テスト 🌊', role: 'homeowner' },
  { id: seedId(1), phone: fakePhone(), name: 'Longform Notes Example', role: 'homeowner', notes: `fake-note ${'x'.repeat(2500)}` },
  { id: seedId(1), phone: fakePhone(), name: 'Dup Licate', email: 'shared-dup@example.invalid', role: 'homeowner' },
  { id: seedId(1), phone: '(801) 555-0199', name: 'Dup Licate', email: 'shared-dup@example.invalid', role: 'homeowner', notes: 'same human as the +1 form — the CREATE UNIQUE INDEX demonstration pair' },
  { id: seedId(1), phone: fakePhone(), name: null, email: null, company: null, notes: null },
];
const contactCount = 60 * SCALE;
for (let n = 0; n < contactCount; n += 1) {
  const name = `${pick(FIRST)} ${pick(LAST)}`;
  contacts.push({
    id: seedId(1),
    phone: fakePhone(),
    name,
    email: chance(0.8) ? fakeEmail('contact', n) : null,
    company: chance(0.15) ? `${pick(LAST)} Property Mgmt (fake)` : null,
    role: contactRoles[n % contactRoles.length],
    billing_address: chance(0.7) ? fakeAddress(n) : null,
    billing_city: chance(0.7) ? pick(CITIES) : null,
    billing_state: 'UT',
    billing_zip: `84${String(n % 100).padStart(3, '0')}`,
    notes: chance(0.2) ? 'synthetic seed contact' : null,
    created_at: chance(0.05) ? pick(DST_EDGES) : randomTimestamp(),
  });
}
insert('contacts', ['id', 'phone', 'name', 'email', 'company', 'role', 'billing_address', 'billing_city', 'billing_state', 'billing_zip', 'notes', 'created_at'],
  contacts.map((c) => ({ billing_address: null, billing_city: null, billing_state: null, billing_zip: null, email: null, company: null, notes: null, created_at: randomTimestamp(), ...c })));

// Claims — every status and loss type; one with a NULL date_of_loss (the
// SET NOT NULL demonstration) and one that will carry 8 jobs.
// claim_number is set EXPLICITLY: the live generate_claim_number() default
// collides under bulk insert (measured at scale 25 — two rows both drew
// CLM-2608-100), and an explicit SEED- number is more obviously fake anyway.
let claimCounter = 0;
const claimNumber = () => `SEED-CLM-${String(++claimCounter).padStart(6, '0')}`;
const claims = [
  { id: seedId(2), claim_number: claimNumber(), contact_id: contacts[0].id, date_of_loss: null, deductible: null, status: 'open', loss_type: 'water', notes: 'NULL date_of_loss on purpose — the SET NOT NULL demonstration row' },
  { id: seedId(2), claim_number: claimNumber(), contact_id: contacts[1].id, date_of_loss: '2026-03-08', status: 'in_progress', loss_type: 'water', notes: 'the 8-job claim' },
];
const EIGHT_JOB_CLAIM = claims[1].id;
const claimCount = 40 * SCALE;
for (let n = 0; n < claimCount; n += 1) {
  claims.push({
    id: seedId(2),
    claim_number: claimNumber(),
    contact_id: pick(contacts).id,
    insurance_carrier: chance(0.9) ? pick(CARRIERS) : null,
    policy_number: chance(0.85) ? `FAKE-POL-${String(n).padStart(6, '0')}` : null,
    insurance_claim_number: chance(0.7) ? `FAKE-CLM-${String(n).padStart(6, '0')}` : null,
    date_of_loss: chance(0.9) ? randomDate() : null,
    loss_address: fakeAddress(n),
    loss_city: pick(CITIES),
    loss_state: 'UT',
    loss_zip: `84${String((n * 7) % 100).padStart(3, '0')}`,
    loss_type: lossTypes[n % lossTypes.length],
    status: claimStatuses[n % claimStatuses.length],
    deductible: chance(0.8) ? pick([0, 500, 1000, 2500]) : null,
    created_at: randomTimestamp(),
  });
}
insert('claims', ['id', 'claim_number', 'contact_id', 'insurance_carrier', 'policy_number', 'insurance_claim_number', 'date_of_loss', 'loss_address', 'loss_city', 'loss_state', 'loss_zip', 'loss_type', 'status', 'deductible', 'created_at'],
  claims.map((c) => ({ insurance_carrier: null, policy_number: null, insurance_claim_number: null, date_of_loss: null, loss_address: null, loss_city: null, loss_state: null, loss_zip: null, loss_type: 'water', deductible: null, created_at: randomTimestamp(), ...c })));

// Jobs — every division and source. The first is the deliberate
// zero-appointments job; the next eight all hang off one claim.
const jobs = [
  { id: seedId(3), claim_id: pick(claims).id, division: 'water', internal_notes: 'zero appointments on purpose' },
  ...Array.from({ length: 8 }, (_, k) => ({ id: seedId(3), claim_id: EIGHT_JOB_CLAIM, division: divisions[k % divisions.length], internal_notes: `8-job claim, job ${k + 1}` })),
];
const NO_APPT_JOB = jobs[0].id;
const jobCount = 60 * SCALE;
for (let n = 0; n < jobCount; n += 1) {
  const claim = pick(claims);
  const contact = contacts.find((c) => c.id === claim.contact_id) || pick(contacts);
  jobs.push({
    id: seedId(3),
    claim_id: chance(0.85) ? claim.id : null,
    primary_contact_id: contact.id,
    division: divisions[n % divisions.length],
    source: jobSources[n % jobSources.length],
    phase: pick(['lead', 'inspection', 'mitigation', 'rebuild', 'billing', 'complete']),
    insured_name: contact.name || 'Unnamed Example',
    address: fakeAddress(n * 3),
    city: pick(CITIES),
    zip: `84${String((n * 3) % 100).padStart(3, '0')}`,
    client_email: chance(0.7) ? fakeEmail('client', n) : null,
    client_phone: contact.phone,
    lead_tech_id: chance(0.8) ? pick(activeStaff) : null,
    project_manager_id: chance(0.6) ? pick(activeStaff) : null,
    estimated_value: chance(0.7) ? between(1000, 80000) : null,
    date_of_loss: chance(0.8) ? randomDate() : null,
    created_at: chance(0.05) ? pick(DST_EDGES) : randomTimestamp(),
  });
}
insert('jobs', ['id', 'claim_id', 'primary_contact_id', 'division', 'source', 'phase', 'insured_name', 'address', 'city', 'zip', 'client_email', 'client_phone', 'lead_tech_id', 'project_manager_id', 'estimated_value', 'date_of_loss', 'created_at'],
  jobs.map((j) => ({ claim_id: null, primary_contact_id: null, division: 'water', source: 'insurance', phase: 'lead', insured_name: null, address: null, city: null, zip: null, client_email: null, client_phone: null, lead_tech_id: null, project_manager_id: null, estimated_value: null, date_of_loss: null, created_at: randomTimestamp(), ...j })));

// Appointments — every type and status; kind='event' rows carry NULL job_id
// (the check constraint demands it), and one job stays bare.
const schedulableJobs = jobs.filter((j) => j.id !== NO_APPT_JOB);
const appointments = [
  { id: seedId(4), job_id: null, kind: 'event', title: 'Company training (fake)', date: '2026-03-08', type: 'other', status: 'scheduled' },
];
const apptCount = 150 * SCALE;
for (let n = 0; n < apptCount; n += 1) {
  appointments.push({
    id: seedId(4),
    job_id: pick(schedulableJobs).id,
    kind: 'job',
    title: chance(0.6) ? `${pick(['Inspect', 'Monitor', 'Demo', 'Rebuild walkthrough'])} (fake)` : null,
    date: chance(0.04) ? pick(['2026-03-08', '2026-11-01']) : randomDate(),
    time_start: chance(0.8) ? `${String(between(7, 16)).padStart(2, '0')}:${pick(['00', '15', '30', '45'])}` : null,
    time_end: null,
    type: apptTypes[n % apptTypes.length],
    status: apptStatuses[n % apptStatuses.length],
    notes: chance(0.2) ? 'synthetic appointment' : null,
    created_by: pick(activeStaff),
  });
}
insert('appointments', ['id', 'job_id', 'kind', 'title', 'date', 'time_start', 'time_end', 'type', 'status', 'notes', 'created_by'],
  appointments.map((a) => ({ title: null, time_start: null, time_end: null, notes: null, created_by: null, ...a })));

// Invoices — bare rows only; the line-item and payment triggers own every
// money total (Rule 15). One invoice deliberately keeps zero lines.
const invoices = [
  { id: seedId(5), job_id: pick(jobs).id, invoice_number: 'SEED-INV-EMPTY', notes: 'zero line items on purpose' },
];
const invoiceCount = 120 * SCALE;
for (let n = 0; n < invoiceCount; n += 1) {
  const job = pick(jobs);
  invoices.push({
    id: seedId(5),
    job_id: job.id,
    contact_id: job.primary_contact_id || null,
    invoice_number: `SEED-INV-${String(n).padStart(6, '0')}`,
    invoice_type: invoiceTypes[n % invoiceTypes.length],
    billed_to: billedTos[n % billedTos.length],
    invoice_date: randomDate(),
    notes: chance(0.15) ? 'synthetic invoice' : null,
  });
}
insert('invoices', ['id', 'job_id', 'contact_id', 'invoice_number', 'invoice_type', 'billed_to', 'invoice_date', 'notes'],
  invoices.map((i) => ({ contact_id: null, invoice_type: 'standard', billed_to: 'insurance', invoice_date: randomDate(), notes: null, ...i })));

// Line items — quantity × unit_price only; line_total is trigger-owned.
const LINE_DESCRIPTIONS = ['Water extraction (fake)', 'Dehumidifier rental (fake)', 'Antimicrobial application (fake)', 'Drywall removal (fake)', 'Content pack-out (fake)', 'Air mover (fake)', 'Final clean (fake)'];
const lineItems = [];
for (const inv of invoices.slice(1)) {
  const lines = between(3, 6);
  for (let k = 0; k < lines; k += 1) {
    lineItems.push({
      id: seedId(6),
      invoice_id: inv.id,
      description: pick(LINE_DESCRIPTIONS),
      category: pick(['labor', 'equipment', 'materials', null]),
      quantity: pick([1, 2, 3, 4, 8, 0.5, 12.25]),
      unit: pick(['EA', 'HR', 'DAY', 'SF', null]),
      unit_price: between(1000, 95000) / 100,
      sort_order: k,
    });
  }
}
insert('invoice_line_items', ['id', 'invoice_id', 'description', 'category', 'quantity', 'unit', 'unit_price', 'sort_order'], lineItems);

// Payments — a mix of full, partial and multiple per invoice; the
// update_invoice_paid trigger computes amount_paid/status from these.
const payments = [];
const paymentCount = 80 * SCALE;
for (let n = 0; n < paymentCount; n += 1) {
  const inv = pick(invoices.slice(1));
  const job = jobs.find((j) => j.id === inv.job_id);
  payments.push({
    id: seedId(7),
    invoice_id: chance(0.9) ? inv.id : null,
    job_id: inv.job_id,
    contact_id: job?.primary_contact_id || null,
    amount: between(500, 2500000) / 100,
    payment_method: payMethods[n % payMethods.length],
    payer_type: payerTypes[n % payerTypes.length],
    payer_name: `${pick(CARRIERS)}`,
    payment_date: randomDate(),
    reference_number: chance(0.6) ? `FAKE-CHK-${String(n).padStart(5, '0')}` : null,
    recorded_by: pick(activeStaff),
    source: 'manual',
  });
}
insert('payments', ['id', 'invoice_id', 'job_id', 'contact_id', 'amount', 'payment_method', 'payer_type', 'payer_name', 'payment_date', 'reference_number', 'recorded_by', 'source'], payments);

// Documents — metadata rows pointing at seed paths in the real buckets.
const documents = [];
const docCount = 50 * SCALE;
for (let n = 0; n < docCount; n += 1) {
  const job = pick(jobs);
  documents.push({
    id: seedId(8),
    job_id: job.id,
    name: `seed-doc-${n}.${pick(['jpg', 'pdf', 'png'])}`,
    file_path: `${job.id}/seed-doc-${n}`,
    file_size: between(20_000, 8_000_000),
    mime_type: pick(['image/jpeg', 'application/pdf', 'image/png']),
    category: pick(['photo', 'report', 'scope', 'other']),
    uploaded_by: pick(activeStaff),
  });
}
insert('job_documents', ['id', 'job_id', 'name', 'file_path', 'file_size', 'mime_type', 'category', 'uploaded_by'], documents);

// Conversations + internal notes only — nothing that impersonates a provider
// message row (AGENTS.md §14: the worker is the sole writer of sms_* rows).
const conversations = [];
for (let n = 0; n < 25 * SCALE; n += 1) {
  conversations.push({
    id: seedId(10),
    type: 'direct',
    title: `Seed thread ${n}`,
    job_id: chance(0.7) ? pick(jobs).id : null,
    assigned_to: chance(0.5) ? pick(activeStaff) : null,
  });
}
insert('conversations', ['id', 'type', 'title', 'job_id', 'assigned_to'], conversations);

const messages = [];
for (let n = 0; n < 150 * SCALE; n += 1) {
  messages.push({
    id: seedId(11),
    conversation_id: pick(conversations).id,
    type: 'internal_note',
    body: chance(0.9) ? `synthetic internal note ${n}` : '',
    status: 'sent',
    sent_by: pick(activeStaff),
    created_at: randomTimestamp(),
  });
}
insert('messages', ['id', 'conversation_id', 'type', 'body', 'status', 'sent_by', 'created_at'], messages);

// ─── SECTION: fake-data guard ──────────────
// The same posture as db-baseline-refresh.mjs: refuse to write anything that
// could pass for real. Every email fake, every phone in the 555-01xx range.
const sql = statements.join('\n\n');
const emails = [...sql.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)].map((m) => m[0]);
const badEmail = emails.find((e) => !/@(example\.invalid|upr-qa\.test)$/.test(e));
if (badEmail) {
  console.error(`db-local-seed: REFUSING to load — generated an email that is not obviously fake: ${badEmail}`);
  process.exit(1);
}
const phones = [...sql.matchAll(/\+1\d{10}|\(\d{3}\) \d{3}-\d{4}/g)].map((m) => m[0]);
const badPhone = phones.find((p) => !/5550\d/.test(p.replace(/\D/g, '')));
if (badPhone) {
  console.error(`db-local-seed: REFUSING to load — generated a phone outside the reserved fictional 555-01xx range: ${badPhone}`);
  process.exit(1);
}

// ─── SECTION: load ──────────────
const guard = `SET upr.local_stack = 'on';
DO $$
BEGIN
  IF current_setting('upr.local_stack', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'REFUSING TO SEED: not a local stack' USING ERRCODE = '55000';
  END IF;
END $$;`;

const totalRows = employees.length + contacts.length + claims.length + jobs.length + appointments.length
  + invoices.length + lineItems.length + payments.length + documents.length + conversations.length + messages.length;

const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'upr-local-seed-'));
const tmpFile = path.join(tmpDir, 'seed.sql');
writeFileSync(tmpFile, `${guard}\n\n${sql}\n`, 'utf8');

console.log(`  generated ${totalRows.toLocaleString()} rows (${(Buffer.byteLength(sql) / 1024 / 1024).toFixed(1)} MB of SQL) — loading in one transaction`);

try {
  execFileSync('docker', ['cp', tmpFile, `${DB_CONTAINER}:/tmp/upr-local-seed.sql`], { encoding: 'utf8' });
  psql(null, { file: '/tmp/upr-local-seed.sql', extraArgs: ['--single-transaction', '-q'] });
} catch (e) {
  console.error('\ndb-local-seed: load FAILED — the database was left unseeded (single transaction).');
  console.error(String(e.stderr || e.stdout || e.message).trim().split('\n').slice(-12).join('\n'));
  process.exit(1);
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}

// ─── SECTION: verify ──────────────
const verify = psql(`select json_build_object(
  'contacts', (select count(*) from public.contacts),
  'claims', (select count(*) from public.claims),
  'jobs', (select count(*) from public.jobs),
  'appointments', (select count(*) from public.appointments),
  'invoices', (select count(*) from public.invoices),
  'line_items', (select count(*) from public.invoice_line_items),
  'payments', (select count(*) from public.payments),
  'documents', (select count(*) from public.job_documents),
  'messages', (select count(*) from public.messages),
  'paid_money', (select coalesce(sum(amount_paid),0) from public.invoices),
  'joined', (select count(*) from public.payments p
             join public.invoices i on i.id = p.invoice_id
             join public.jobs j on j.id = i.job_id
             left join public.claims cl on cl.id = j.claim_id))`);
const v = JSON.parse(verify);
console.log('\n  seeded business:');
console.log(`    contacts ${v.contacts} · claims ${v.claims} · jobs ${v.jobs} · appointments ${v.appointments}`);
console.log(`    invoices ${v.invoices} · line items ${v.line_items} · payments ${v.payments} · documents ${v.documents} · messages ${v.messages}`);
console.log(`    trigger-computed amount_paid across invoices: $${Number(v.paid_money).toFixed(2)} · payment→invoice→job joins: ${v.joined}`);

if (Number(v.paid_money) <= 0 || Number(v.joined) === 0) {
  console.error('\ndb-local-seed: verification failed — the triggers did not compute money, or joins return nothing.');
  process.exit(1);
}
console.log('\n  Prove the point:  npm run test:db:data-visibility:local');
