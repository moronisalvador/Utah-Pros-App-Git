/**
 * ════════════════════════════════════════════════
 * FILE: probe-encircle-hydro.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Asks Encircle, read-only, whether their "Hydro" drying-log data is
 *   available to us yet. Our reference document says that part of their API is
 *   "6-9 months out", but that note is old and Hydro has since launched
 *   publicly, so this checks reality instead of trusting the note. It only ever
 *   READS. It never creates, changes or deletes anything in Encircle.
 *
 * WHY IT IS A SCRIPT AND NOT AN AGENT ACTION:
 *   Encircle sells no sandbox, so any call is a live call. The API key lives in
 *   Cloudflare and in the RLS-locked integration_credentials row, and is
 *   deliberately not reachable from a local agent session. The owner runs this;
 *   the key is read from the environment and is never printed or logged.
 *
 * USAGE:
 *   ENCIRCLE_API_KEY=... node scripts/qa/probe-encircle-hydro.mjs [claimId]
 *
 *   With no claimId it lists recent claims and probes the newest one.
 *
 * DEPENDS ON:
 *   Packages:  none (native fetch, Node 18+)
 *   Internal:  none
 *   Data:      reads → Encircle API only. Touches no UPR database.
 *
 * NOTES / GOTCHAS:
 *   - GET only. There is no code path here that can write to Encircle.
 *   - `GET /v1/organizations` takes NO query parameters; `?limit=1` returns 400.
 *     That trap is recorded in functions/lib/encircle-credential.js and cost a
 *     shipped bug once already.
 *   - Output is a shape report: status code, and for a 200 the record count plus
 *     the field names of the first record. Values are NOT printed, because these
 *     are real customer claims.
 * ════════════════════════════════════════════════
 */

const BASE = 'https://api.encircleapp.com';
const KEY = process.env.ENCIRCLE_API_KEY;

if (!KEY) {
  console.error('ENCIRCLE_API_KEY is not set. Run:');
  console.error('  ENCIRCLE_API_KEY=<key> node scripts/qa/probe-encircle-hydro.mjs');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${KEY}`,
  Accept: 'application/json',
  'X-Encircle-Attribution': 'UtahProsRestorationApp',
};

/** GET one path and report only its shape — never its values. */
async function probe(label, path) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, { method: 'GET', headers });
  } catch (e) {
    console.log(`  ${label.padEnd(34)} NETWORK ERROR  ${e.message}`);
    return null;
  }

  if (!res.ok) {
    // 404 here is the interesting answer: the endpoint does not exist yet.
    let hint = '';
    try {
      const body = await res.text();
      hint = body.slice(0, 120).replace(/\s+/g, ' ');
    } catch { /* body is optional context, not required */ }
    console.log(`  ${label.padEnd(34)} ${String(res.status).padEnd(5)} ${hint}`);
    return null;
  }

  const json = await res.json();
  const list = Array.isArray(json?.list) ? json.list : null;
  if (list) {
    const fields = list.length ? Object.keys(list[0]).join(', ') : '(no records)';
    console.log(`  ${label.padEnd(34)} 200   ${list.length} record(s)`);
    if (list.length) console.log(`  ${''.padEnd(34)}       fields: ${fields}`);
  } else {
    console.log(`  ${label.padEnd(34)} 200   fields: ${Object.keys(json || {}).join(', ')}`);
  }
  return json;
}

console.log('\nEncircle Hydro availability probe — READ ONLY\n');

console.log('Credential check:');
const orgs = await probe('GET /v1/organizations', '/v1/organizations');
if (!orgs) {
  console.error('\nCredential did not validate. Nothing further attempted.');
  process.exit(1);
}

let claimId = process.argv[2];
if (!claimId) {
  console.log('\nFinding a claim to probe:');
  const claims = await probe('GET /v1/property_claims', '/v1/property_claims?limit=5');
  claimId = claims?.list?.[0]?.id;
  if (!claimId) {
    console.error('\nNo claim available to probe. Pass one: node ... <claimId>');
    process.exit(1);
  }
}
console.log(`\nProbing Hydro endpoints for claim ${claimId}:`);

// The four reading types Encircle models separately — the whole reason UPR's
// single flat moisture_readings table cannot express a real drying log.
await probe('affected_atmosphere_readings', `/v2/property_claims/${claimId}/affected_atmosphere_readings`);
await probe('unaffected_atmosphere_readings', `/v2/property_claims/${claimId}/unaffected_atmosphere_readings`);
await probe('material_readings', `/v2/property_claims/${claimId}/material_readings`);
await probe('equipment_readings', `/v2/property_claims/${claimId}/equipment_readings`);

console.log('\nSupporting shapes:');
await probe('GET /v2/equipment', '/v2/equipment?limit=5');
await probe('GET /v2/equipment_specs', '/v2/equipment_specs?limit=5');

console.log('\nReading: 200 = live and usable. 404 = not built for us yet.');
console.log('403 = exists but our key lacks the scope — worth asking Encircle for.\n');
