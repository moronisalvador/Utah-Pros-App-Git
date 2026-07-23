/**
 * ════════════════════════════════════════════════
 * FILE: exec_read_sql_containment.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the containment script removes browser access without changing the database helper or
 *   breaking the owner-only MCP. It also prevents a future browser caller from quietly depending on
 *   this free-form query path.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path
 *   Internal:  containment migration, upr-mcp/src/tools.js, upr-mcp/src/supabase.js
 *   Data:      reads  → repository files and mocked HTTP only
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This is a local contract test; live role behavior is verified during the apply window with the
 *     companion preflight/post-apply SQL and short-lived REST tokens.
 * ════════════════════════════════════════════════
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TOOLS } from '../../upr-mcp/src/tools.js';

const root = resolve(import.meta.dirname, '../..');
const migrationName = '20260723205127_exec_read_sql_containment.sql';
const migration = readFileSync(resolve(root, 'supabase/migrations', migrationName), 'utf8');

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:js|jsx|ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('exec_read_sql containment migration', () => {
  it('revokes every browser role and preserves only the verified server role', () => {
    const executableSql = migration
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');

    expect(migration).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.exec_read_sql\(text\)\s+FROM PUBLIC, anon, authenticated;/i,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.exec_read_sql\(text\) TO service_role;/i,
    );
    expect(executableSql).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.exec_read_sql\(text\) TO (?:PUBLIC|anon|authenticated)/i,
    );
  });

  it('does not drop, replace, rename, or change the live function signature', () => {
    expect(migration).not.toMatch(/\bDROP\s+FUNCTION\b/i);
    expect(migration).not.toMatch(/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i);
    expect(migration).not.toMatch(/\bALTER\s+FUNCTION\b/i);
    expect(migration).toContain('public.exec_read_sql(text)');
  });

  it('fails closed if the reviewed live function or role contract drifts before apply', () => {
    expect(migration).toContain("v_search_path IS DISTINCT FROM ARRAY['search_path=public']::text[]");
    expect(migration).toContain("v_result_type IS DISTINCT FROM 'jsonb'");
    expect(migration).toContain(
      "v_definition_md5 IS DISTINCT FROM '3ba5b4885b4147206e4791124f23bddc'",
    );
    expect(migration).toContain('v_anon_can_execute IS DISTINCT FROM false');
    expect(migration).toContain('v_authenticated_can_execute IS DISTINCT FROM true');
    expect(migration).toContain('v_service_role_can_execute IS DISTINCT FROM true');
  });

  it('contains the exact rollback for the one removed live grant', () => {
    expect(migration).toMatch(
      /ROLLBACK:[\s\S]*GRANT EXECUTE ON FUNCTION public\.exec_read_sql\(text\) TO authenticated;/i,
    );
  });

  it('has no application or Pages Worker runtime caller', () => {
    const browserAndWorkerFiles = [
      ...sourceFiles(resolve(root, 'src')),
      ...sourceFiles(resolve(root, 'functions')),
    ];
    const callers = browserAndWorkerFiles.filter((file) =>
      readFileSync(file, 'utf8').includes('exec_read_sql'),
    );
    expect(callers).toEqual([]);
  });
});

describe('upr-mcp owner-tool compatibility', () => {
  it('still calls the exact RPC with the service-role credential', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ ok: 1 }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await TOOLS.upr_sql.run(
      {
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-role',
      },
      { sql: 'select 1 as ok' },
    );

    expect(result).toEqual([{ ok: 1 }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.supabase.co/rest/v1/rpc/exec_read_sql');
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe('Bearer test-service-role');
    expect(options.headers.apikey).toBe('test-service-role');
    expect(JSON.parse(options.body)).toEqual({ p_query: 'select 1 as ok' });
  });
});
