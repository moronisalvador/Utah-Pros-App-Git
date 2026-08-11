/**
 * ════════════════════════════════════════════════
 * FILE: qbo-advisory-maintenance.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Protects advisory/local work when QBO maintenance starts after a request
 *   was admitted: chat receives an explicit tool result and Xactimate imports
 *   retain their local result while reporting the skipped Class lookup.
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

  it('keeps QBO and unexpected tool faults out of the LLM, browser, and worker-run payloads', async () => {
    const source = await read('collections-chat.js');
    expect(source).toContain('function qboAdvisoryToolResult(error)');
    expect(source).toContain("'qbo_read_unavailable'");
    expect(source).toContain("code: 'tool_unavailable'");
    expect(source).toContain("'collections_chat_unavailable'");
    expect(source).not.toContain("await logRun(db, 'error', 0, e.message");
  });

  it('does not make the local Xactimate import depend on the optional QBO Class lookup', async () => {
    const source = await read('analyze-xactimate.js');
    expect(source).not.toContain('requireQboProviderTraffic(env)');
    expect(source).toContain('let qboMappingUnavailable = null;');
    expect(source).toContain('if (isQboProviderTrafficDisabled(error)) qboMappingUnavailable = error.reason;');
    expect(source).toContain('qbo_mapping_unavailable: qboMappingUnavailable');
    const optionalLookup = source.indexOf('const classId = await findClassId');
    const lineInsert = source.indexOf("await db.insert('invoice_line_items'");
    expect(optionalLookup).toBeGreaterThan(-1);
    expect(lineInsert).toBeGreaterThan(optionalLookup);
  });
});
