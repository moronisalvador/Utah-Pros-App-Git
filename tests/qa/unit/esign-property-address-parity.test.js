/**
 * ════════════════════════════════════════════════
 * FILE: esign-property-address-parity.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Documents print the property address by pasting together four fields —
 *   street, city, state, ZIP. When one of them is blank the old code still
 *   printed its comma, so a job with no city said "1234 Example Rd, United
 *   States, , UT" on a page a customer signs. This checks the fix works, and
 *   that the signing screen, the saved PDF and the office template preview all
 *   build the address the same way — three separate programs that must agree.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/propertyAddress.js (behaviour),
 *              functions/api/submit-esign.js (the separate worker copy),
 *              src/pages/SignPage.jsx and
 *              src/pages/settings/templates/templateData.jsx (both consume it)
 *   Data:      reads  → application source text; no database
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - `functions/` is a separate Cloudflare bundle and cannot import from
 *     `src/`, so the helper genuinely exists twice. Both copies are executed
 *     here against the same table of cases — this is real behavioural parity,
 *     not a text comparison.
 *   - The regression guard that matters most is "a fully populated job renders
 *     exactly as before". This was a rendering repair on live legal wording, so
 *     it must be invisible on every job that was already correct.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  collapseAddressGroups as srcCollapse,
  formatPropertyAddress as srcFormat,
} from '../../../src/lib/propertyAddress.js';
import {
  collapseAddressGroups as fnCollapse,
  formatPropertyAddress as fnFormat,
} from '../../../functions/api/submit-esign.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

/** The real job the flow was verified against — every field populated. */
const COMPLETE = { address: '1055 N State St', city: 'Provo', state: 'Utah', zip: '84606' };
/** The shape that produced the defect: the whole address in one field. */
const NO_CITY  = { address: '1234 Example Rd, United States', city: '', state: 'UT', zip: '' };

const IMPLEMENTATIONS = [
  ['src/lib/propertyAddress.js',      srcFormat, srcCollapse],
  ['functions/api/submit-esign.js',   fnFormat,  fnCollapse],
];

describe.each(IMPLEMENTATIONS)('formatPropertyAddress — %s', (_label, format) => {
  it('renders a fully populated job exactly as before the fix', () => {
    expect(format(COMPLETE)).toBe('1055 N State St, Provo, Utah 84606');
  });

  it('drops the comma for a missing city instead of printing ", ,"', () => {
    expect(format(NO_CITY)).toBe('1234 Example Rd, United States, UT');
    expect(format(NO_CITY)).not.toContain(', ,');
  });

  it('omits the ZIP when asked, for the templates whose group has no {{zip}}', () => {
    expect(format(COMPLETE, { includeZip: false })).toBe('1055 N State St, Provo, Utah');
  });

  it('keeps the same UT default the {{state}} token has', () => {
    expect(format({ address: '5 Elm St', city: 'Orem', state: '', zip: '84057' }))
      .toBe('5 Elm St, Orem, UT 84057');
  });

  it('handles a job with nothing but a state', () => {
    expect(format({})).toBe('UT');
  });

  it('trims padded fields rather than treating whitespace as present', () => {
    expect(format({ address: '  7 Oak Ave ', city: '   ', state: ' UT ', zip: ' 84003 ' }))
      .toBe('7 Oak Ave, UT 84003');
  });
});

describe.each(IMPLEMENTATIONS)('collapseAddressGroups — %s', (_label, _format, collapse) => {
  const WITH_ZIP    = 'inspected the property at {{address}}, {{city}}, {{state}} {{zip}} (Job No. {{job_number}})';
  const WITHOUT_ZIP = 'services at the property located at {{address}}, {{city}}, {{state}} ("Property")';

  it('rewrites the four-part group used by the situational templates', () => {
    expect(collapse(WITH_ZIP, NO_CITY))
      .toBe('inspected the property at 1234 Example Rd, United States, UT (Job No. {{job_number}})');
  });

  it('rewrites the three-part group WITHOUT inventing a ZIP', () => {
    // work_auth / direction_pay / change_order write the group without {{zip}}.
    // Adding one would change legally reviewed wording, not just repair it.
    expect(collapse(WITHOUT_ZIP, COMPLETE))
      .toBe('services at the property located at 1055 N State St, Provo, Utah ("Property")');
  });

  it('leaves every other token untouched', () => {
    expect(collapse('{{client_name}} at {{address}}, {{city}}, {{state}} on {{date}}', COMPLETE))
      .toBe('{{client_name}} at 1055 N State St, Provo, Utah on {{date}}');
  });

  it('does not touch a lone {{address}} outside the group', () => {
    expect(collapse('mail to {{address}} please', COMPLETE)).toBe('mail to {{address}} please');
  });

  it('rewrites every occurrence, not just the first', () => {
    const twice = `${WITH_ZIP} and again {{address}}, {{city}}, {{state}} {{zip}}`;
    expect(collapse(twice, NO_CITY)).not.toContain('{{city}}');
  });

  it('is safe on empty input', () => {
    expect(collapse('', COMPLETE)).toBe('');
    expect(collapse(null, COMPLETE)).toBe('');
  });
});

describe('the two copies agree exactly', () => {
  const CASES = [
    COMPLETE,
    NO_CITY,
    {},
    { address: 'A', city: 'B', state: 'C', zip: 'D' },
    { address: '', city: 'Provo', state: '', zip: '84601' },
    { address: 'X', city: '', state: '', zip: '' },
  ];

  it('formatPropertyAddress returns identical text for every case', () => {
    for (const job of CASES) {
      expect(fnFormat(job)).toBe(srcFormat(job));
      expect(fnFormat(job, { includeZip: false })).toBe(srcFormat(job, { includeZip: false }));
    }
  });

  it('collapseAddressGroups returns identical text for every case', () => {
    const body = 'at {{address}}, {{city}}, {{state}} {{zip}} and at {{address}}, {{city}}, {{state}}.';
    for (const job of CASES) {
      expect(fnCollapse(body, job)).toBe(srcCollapse(body, job));
    }
  });
});

describe('all three renderers consume the helper', () => {
  it('the signing screen collapses the group before substituting tokens', () => {
    const src = read('src/pages/SignPage.jsx');
    expect(src).toContain("from '@/lib/propertyAddress'");
    expect(src).toContain('collapseAddressGroups(text, job)');
    expect(src).toContain("'{{property_address}}':   formatPropertyAddress(job)");
  });

  it('the PDF builder collapses the group before substituting tokens', () => {
    const src = read('functions/api/submit-esign.js');
    expect(src).toContain('return collapseAddressGroups(body, job)');
    expect(src).toContain('.replace(/\\{\\{property_address\\}\\}/g,  formatPropertyAddress(job))');
  });

  it('the office template preview collapses it too, so staff tune against the real output', () => {
    const src = read('src/pages/settings/templates/templateData.jsx');
    expect(src).toContain("from '@/lib/propertyAddress'");
    expect(src).toContain('collapseAddressGroups(text, job)');
  });

  it('{{property_address}} is accepted by custom-document validation', () => {
    // Offering the chip in the composer while the worker rejects the token
    // would refuse every document that used it.
    expect(read('functions/lib/esign-custom-doc.js')).toContain("'property_address'");
    expect(read('src/lib/customDocSnippets.js')).toContain('{{property_address}}');
    expect(read('src/pages/settings/templates/templateData.jsx')).toContain('{{property_address}}');
  });
});
