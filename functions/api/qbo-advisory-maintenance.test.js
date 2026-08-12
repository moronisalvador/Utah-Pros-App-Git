/**
 * ════════════════════════════════════════════════
 * FILE: qbo-advisory-maintenance.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Protects advisory/local work when QBO maintenance starts after a request
 *   was admitted, and proves Xactimate imports remain source-disabled until a
 *   durable operation owns AI egress, retries, and financial-line insertion.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs
 *   Internal:  collections-chat.js, analyze-xactimate.js
 *   Data:      reads  → source files only
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This is a source-contract test; it does not run an external service.
 * ════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const root = new URL('.', import.meta.url);
const read = (name) => readFile(new URL(name, root), 'utf8');

describe('advisory QBO maintenance close-race contracts', () => {
  it('keeps a started chat turn local and serializes a structured maintenance tool result', async () => {
    const source = await read('collections-chat.js');
    expect(source).toContain("qbo_provider_traffic_unavailable: e.reason");
    expect(source).toContain("error: 'QuickBooks maintenance-unavailable: the live lookup was not run.'");
    expect(source).toContain('result = isQboProviderTrafficDisabled(e)');
    // The tool-level handler deliberately absorbs the close-race so the route
    // remains in its completed-conversation path instead of returning 503.
    const toolCatch = source.indexOf('catch (e) {\n          // A QBO maintenance flip');
    const completed = source.indexOf("await logRun(db, 'completed'");
    expect(toolCatch).toBeGreaterThan(-1);
    expect(completed).toBeGreaterThan(toolCatch);
  });

  it('validates provider traces before advisory output can include them', async () => {
    const source = await read('collections-chat.js');
    expect(source).toContain('const INTUIT_TID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;');
    expect(source).toContain('error.intuitTid = safeIntuitTid(intuitTid || cause?.intuitTid);');
    expect(source).not.toContain('error.intuitTid = intuitTid || cause?.intuitTid');
  });

  it('keeps QBO and unexpected tool faults out of the LLM, browser, and worker-run payloads', async () => {
    const source = await read('collections-chat.js');
    expect(source).toContain('function qboAdvisoryToolResult(error)');
    expect(source).toContain("'qbo_read_unavailable'");
    expect(source).toContain("code: 'tool_unavailable'");
    expect(source).toContain("'collections_chat_unavailable'");
    expect(source).not.toContain("await logRun(db, 'error', 0, e.message");
  });

  it('keeps Xactimate behind its durable-operation boundary', async () => {
    const source = await read('analyze-xactimate.js');
    const handler = source.slice(source.indexOf('export async function onRequestPost'));
    expect(handler).toContain('XACTIMATE_IMPORT_DURABLE_BOUNDARY_REQUIRED');
    expect(handler).not.toMatch(/findClassId|invoice_line_items|job_documents|downloadStorage|ANTHROPIC/);
  });
});
