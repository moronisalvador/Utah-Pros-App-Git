/**
 * ════════════════════════════════════════════════
 * FILE: mobile-personal-ownership-boundary.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Keeps the S1h personal ownership boundary visible in credential-free CI.
 *   It checks repository source only and never connects to Supabase, reads a
 *   business row, registers a device, or changes a notification preference.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node built-ins
 *   Internal:  S1h migration/rollback/catalog proofs, guarded local behavior
 *              scripts, personal-settings callers, and service-role consumers
 *   Data:      reads → repository source only; writes → none
 *
 * NOTES / GOTCHAS:
 *   - Shared-database apply, providers, signing, and device qualification
 *     remain separate owner/external gates.
 * ════════════════════════════════════════════════
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const migration = read(
  'supabase/migrations/20260727022920_mobile_personal_ownership_boundary.sql',
);
const rollback = read(
  'supabase/rollbacks/20260727022920_mobile_personal_ownership_boundary.rollback.sql',
);
const preflight = read(
  'supabase/tests/mobile_personal_ownership_boundary_preflight.sql',
);
const postApply = read(
  'supabase/tests/mobile_personal_ownership_boundary_post_apply.sql',
);
const isolated = read(
  'supabase/tests/mobile_personal_ownership_boundary_isolated.sql',
);
const isolatedWrapper = read(
  'supabase/tests/mobile_personal_ownership_boundary.test.sql',
);
const applyRunbook = read('docs/mobile/s1h-database-apply-runbook.md');
const localDbRunner = read('scripts/qa/run-local-db-tests.mjs');
const authContext = read('src/contexts/AuthContext.jsx');
const pageAccess = read('src/pages/settings/PageAccess.jsx');
const preferenceMatrix = read(
  'src/components/settings/NotificationPrefsMatrix.jsx',
);
const pushDevices = read('src/components/settings/PushDevicesList.jsx');
const webPush = read('src/lib/webPushClient.js');
const nativePush = read('src/lib/pushNotifications.js');
const accountDeviceCleanup = read('src/lib/accountDeviceCleanup.js');
const notifyWorker = read('functions/api/notify.js');
const calendar = read('functions/lib/google-calendar.js');
const apnsWorker = read('functions/lib/apns.js');
const callrail = read('functions/api/callrail-recording.js');
const messaging = read('functions/lib/messaging-auth.js');
const executable = (sql) => sql
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n')
  .replace(/\s+/g, ' ');
const md5 = (value) => createHash('md5').update(value).digest('hex');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const extractAuthoredBody = (name) => {
  const match = migration.match(new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?`
      + 'AS \\$function\\$(\\n[\\s\\S]*?\\n)\\$function\\$;',
  ));
  expect(match, `authored body for ${name}`).not.toBeNull();
  return match[1];
};

const contracts = [
  {
    name: 'get_employee_page_access',
    identity: 'public.get_employee_page_access(uuid)',
    arguments: 'p_employee_id uuid',
    result: 'SETOF employee_page_access',
    bodyMd5: '322bce8cdec88d162720747946378420',
    definitionMd5: 'b960beac5110a92a7242acb5d6f1d637',
  },
  {
    name: 'get_effective_notification_prefs',
    identity: 'public.get_effective_notification_prefs(uuid)',
    arguments: 'p_employee_id uuid',
    result: 'SETOF json',
    bodyMd5: '4225ce3d9a846bc453b9048dcd944bdf',
    definitionMd5: '801a88bb22ef698306c35a6fc7482f7b',
  },
  {
    name: 'get_my_notification_prefs',
    identity: 'public.get_my_notification_prefs(uuid)',
    arguments: 'p_employee_id uuid',
    result: 'SETOF json',
    bodyMd5: 'e5566bb6b37fe209cc800198c20021dd',
    definitionMd5: 'e902db39426544aaf9bb1a73bd664e56',
  },
  {
    name: 'set_my_notification_pref',
    identity:
      'public.set_my_notification_pref(uuid,text,text,boolean)',
    arguments:
      'p_employee_id uuid, p_type_key text, p_channel text, p_enabled boolean',
    result: 'notification_prefs',
    bodyMd5: '5e85d4169bf7174182069c3c05e9f257',
    definitionMd5: 'e06ecc49305feb75c9dba70763e69b57',
  },
  {
    name: 'get_my_push_subscriptions',
    identity: 'public.get_my_push_subscriptions(uuid)',
    arguments: 'p_employee_id uuid',
    result: 'SETOF json',
    bodyMd5: 'aa2f4c86229dc668a7058d48fb19c4a5',
    definitionMd5: '02d9187d640c50b2312a261336cbb14f',
  },
  {
    name: 'upsert_push_subscription',
    identity:
      'public.upsert_push_subscription(text,text,text,text)',
    arguments:
      'p_endpoint text, p_p256dh text, p_auth text, '
      + 'p_user_agent text DEFAULT NULL::text',
    result: 'push_subscriptions',
    bodyMd5: 'ed3dac15ddb19396513a646fb29193ca',
    definitionMd5: 'bf5d76a6459ad0e83fe6032b006c18f7',
  },
  {
    name: 'delete_push_subscription',
    identity: 'public.delete_push_subscription(text)',
    arguments: 'p_endpoint text',
    result: 'void',
    bodyMd5: '045c27bb5197d883db905c48762ae58c',
    definitionMd5: 'ef5705028ced042542267b96cb8d4d0d',
  },
  {
    name: 'upsert_device_token',
    identity: 'public.upsert_device_token(uuid,text,text)',
    arguments: 'p_employee_id uuid, p_token text, p_platform text',
    result: 'device_tokens',
    bodyMd5: '3cead33c27066c96d87611acc511eadc',
    definitionMd5: 'afb394c6c24a628afb61b4383ecca4c0',
  },
  {
    name: 'delete_device_token',
    identity: 'public.delete_device_token(text)',
    arguments: 'p_token text',
    result: 'void',
    bodyMd5: 'ceab81097149a578608962f8229692c9',
    definitionMd5: '9273fd6c8990082cbdac75b9a3e1a0b4',
  },
];

describe('S1h mobile personal ownership boundary', () => {
  it('uses the governed RED migration header and names the real rollback risk', () => {
    expect(migration).toContain(
      '-- WHAT THIS DOES (plain language):',
    );
    expect(migration).toContain(
      '-- RED AUTHORIZATION / NO STRUCTURAL OR DATA CHANGE:',
    );
    expect(migration).toContain(
      '20260727022920_mobile_personal_ownership_boundary.rollback.sql',
    );
    expect(migration).toContain(
      'unsafe restoration of anonymous page',
    );
  });

  it('pins every operator artifact to its current SHA-256', () => {
    for (const path of [
      'supabase/migrations/20260727022920_mobile_personal_ownership_boundary.sql',
      'supabase/tests/mobile_personal_ownership_boundary_preflight.sql',
      'supabase/tests/mobile_personal_ownership_boundary_post_apply.sql',
      'supabase/tests/mobile_personal_ownership_boundary.test.sql',
      'supabase/tests/mobile_personal_ownership_boundary_isolated.sql',
      'supabase/rollbacks/20260727022920_mobile_personal_ownership_boundary.rollback.sql',
    ]) {
      expect(applyRunbook).toContain(sha256(read(path)));
    }
    expect(applyRunbook).toContain('Never use `supabase db push`');
    expect(applyRunbook).toContain(
      '`20260727012825 permission_write_gates`',
    );
  });

  it('preserves exact deployed RPC identities, defaults, results, and callers', () => {
    const sql = executable(migration);

    for (const contract of contracts) {
      for (const proof of [migration, rollback, preflight, postApply]) {
        expect(proof).toContain(contract.identity);
        expect(proof).toContain(contract.arguments);
        expect(proof).toContain(contract.result);
      }
    }

    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.upsert_push_subscription\( p_endpoint text, p_p256dh text, p_auth text, p_user_agent text DEFAULT NULL::text \) RETURNS public\.push_subscriptions/i,
    );
    expect(sql).not.toMatch(
      /\bDROP FUNCTION public\.(?:get_employee_page_access|get_effective_notification_prefs|get_my_notification_prefs|set_my_notification_pref|get_my_push_subscriptions|upsert_push_subscription|delete_push_subscription|upsert_device_token|delete_device_token)\b/i,
    );

    expect(authContext).toContain(
      "rpc('get_employee_page_access', { p_employee_id: employeeId })",
    );
    expect(pageAccess).toContain(
      "db.rpc('get_employee_page_access', { p_employee_id: empId })",
    );
    expect(preferenceMatrix).toContain(
      "db.rpc('get_my_notification_prefs', { p_employee_id: employeeId })",
    );
    expect(preferenceMatrix).toContain(
      "db.rpc('set_my_notification_pref', {",
    );
    expect(pushDevices).toContain(
      "db.rpc('get_my_push_subscriptions', { p_employee_id: employeeId })",
    );
    expect(webPush).toContain("db.rpc('upsert_push_subscription', {");
    expect(webPush).toMatch(
      /await withDeadline\(\s*db\.rpc\('delete_push_subscription', \{\s*p_endpoint: endpoint,\s*\}\),/,
    );
    expect(webPush).toContain("typeof db?.rpc !== 'function'");
    expect(nativePush).toContain(
      "db.rpc('upsert_my_native_device_token', {",
    );
    expect(nativePush).toContain(
      'p_apns_environment: apnsEnvironment',
    );
    expect(nativePush).not.toContain('p_employee_id: employeeId');
  });

  it('reconstructs active internal ownership and keeps the page admin exception narrow', () => {
    const internalRoleAllowlist = [
      'admin',
      'office',
      'project_manager',
      'field_tech',
      'estimator',
      'supervisor',
    ];
    const allowlistPattern = new RegExp(
      String.raw`AND employee\.role::text IN \(\s*`
        + internalRoleAllowlist
          .map((role) => String.raw`'${role}'`)
          .join(String.raw`,\s*`)
        + String.raw`\s*\)`,
      'g',
    );

    expect(migration.match(/auth\.jwt\(\) ->> 'role' = 'service_role'/g))
      .toHaveLength(9);
    expect(migration).not.toMatch(/\bauth\.role\s*\(/i);
    expect(migration).toContain(
      'employee.auth_user_id = auth.uid()',
    );
    expect(migration).toContain('AND employee.is_active');
    expect(migration).toContain('AND NOT employee.is_external');
    expect(migration.match(allowlistPattern)).toHaveLength(4);
    expect(migration).toContain(
      'S1h postcondition active-internal role allowlist drift',
    );
    expect(preflight).toContain("'crm_partner'");
    expect(preflight).toContain(
      "enum_type.typname = 'employee_role'",
    );
    expect(preflight).toContain(') IS DISTINCT FROM 7');
    expect(postApply).toContain("'crm_partner'");
    expect(postApply).toContain(
      'S1h catalog post-apply active-internal role allowlist drift',
    );
    expect(migration).toContain(
      'AND NOT public.is_active_internal_admin() THEN',
    );
    expect(migration.match(
      /NOT public\.is_current_active_internal_employee\(p_employee_id\)/g,
    )).toHaveLength(6);
    expect(migration).toContain(
      "'NOT_AUTHORIZED: own page access or admin only'",
    );
    expect(migration).toContain(
      "'NOT_AUTHORIZED: own notification preferences only'",
    );

    const sql = executable(migration);
    expect(sql).toContain(
      'REVOKE EXECUTE ON FUNCTION public.is_current_active_internal_employee(uuid) FROM PUBLIC, anon, authenticated, service_role;',
    );
    for (const contract of contracts) {
      const spacedIdentity = contract.identity.replaceAll(',', ', ');
      expect(sql).toContain(
        `REVOKE EXECUTE ON FUNCTION ${spacedIdentity} FROM PUBLIC, anon, authenticated, service_role;`,
      );
      expect(sql).toContain(
        `GRANT EXECUTE ON FUNCTION ${spacedIdentity} TO authenticated, service_role;`,
      );
    }
  });

  it('rejects cross-owner browser endpoint and native-token takeover atomically', () => {
    const pushBody = extractAuthoredBody('upsert_push_subscription');
    const tokenBody = extractAuthoredBody('upsert_device_token');
    const authenticatedTokenBranch = tokenBody.split(
      'IF NOT public.is_current_active_internal_employee(p_employee_id) THEN',
    )[1];

    expect(pushBody).toContain(
      'WHERE push_subscriptions.employee_id = EXCLUDED.employee_id',
    );
    expect(pushBody).not.toMatch(
      /DO UPDATE SET\s+employee_id = EXCLUDED\.employee_id/,
    );
    expect(pushBody).toContain(
      'push endpoint belongs to another employee',
    );
    expect(tokenBody).toContain(
      'WHERE device_tokens.employee_id = EXCLUDED.employee_id',
    );
    expect(authenticatedTokenBranch).not.toMatch(
      /DO UPDATE SET\s+employee_id = EXCLUDED\.employee_id/,
    );
    expect(tokenBody).toContain(
      'device token belongs to another employee',
    );
    expect(migration).toContain(
      'browser-executable employee authority mutator',
    );
    expect(postApply).toContain(
      'browser-executable employee authority mutator',
    );
    expect(migration).toContain(
      "name = 'mobile_employee_identity_containment'",
    );
  });

  it('makes all four personal tables RPC-only and preserves service-role consumers', () => {
    const sql = executable(migration);
    for (const table of [
      'employee_page_access',
      'notification_prefs',
      'push_subscriptions',
      'device_tokens',
    ]) {
      expect(sql).toContain(
        `ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY;`,
      );
      expect(sql).toContain(
        `REVOKE ALL PRIVILEGES ON TABLE public.${table} FROM PUBLIC, anon, authenticated;`,
      );
    }
    expect(sql).toContain(
      'DROP POLICY "Own tokens or admin read" ON public.device_tokens;',
    );
    expect(sql).not.toContain(
      'GRANT SELECT ON TABLE public.device_tokens TO authenticated;',
    );

    expect(notifyWorker).toContain(
      "db.rpc('get_effective_notification_prefs', { p_employee_id: recipientId })",
    );
    expect(notifyWorker).toContain(
      "db.select('push_subscriptions'",
    );
    expect(notifyWorker).toContain(
      "db.delete('push_subscriptions'",
    );
    expect(calendar).toContain(
      "db.rpc('get_effective_notification_prefs', { p_employee_id: employeeId })",
    );
    expect(apnsWorker).toContain("'device_tokens'");
    expect(apnsWorker).toContain(
      '`&apns_environment=eq.${config.environment}`',
    );
    expect(apnsWorker).toContain(
      "db.rpc('prune_stale_native_device_token'",
    );
    expect(apnsWorker).toContain(
      'p_observed_updated_at: row.updated_at',
    );
    expect(apnsWorker).toContain(
      'p_apns_environment: config.environment',
    );
    expect(callrail).toContain("'employee_page_access'");
    expect(messaging).toContain("'employee_page_access'");
  });

  it('pins exact function, dependency, table, ACL, and policy fingerprints', () => {
    expect(md5(extractAuthoredBody(
      'is_current_active_internal_employee',
    ))).toBe('fa283855321fd2e67af47311ab28b4c1');

    for (const contract of contracts) {
      expect(md5(extractAuthoredBody(contract.name))).toBe(contract.bodyMd5);
      for (const guard of [migration, rollback, postApply]) {
        expect(guard).toContain(contract.bodyMd5);
        expect(guard).toContain(contract.definitionMd5);
      }
    }

    for (const dependencyHash of [
      'ef9b97f5a64e030b1b1b9dfb779b1db3',
      'b108f96a46006185cf2b6ad4b0a147aa',
    ]) {
      expect(migration).toContain(dependencyHash);
      expect(preflight).toContain(dependencyHash);
    }

    for (const proof of [
      migration,
      rollback,
      preflight,
      postApply,
      isolated,
    ]) {
      expect(proof).toContain('16e440632831b52155d5a9c6ba7b21a3');
      expect(proof).not.toContain('79d6b7e2f231cfa2d0038af1d0464ca0');
      expect(proof).toContain('permission_write_gates');
      expect(proof).toContain('20260726220000');
      expect(proof).toContain('20260727012825');
      expect(proof).toContain(
        'upsert_employee_page_access_provenance_reconciliation',
      );
    }

    for (const fingerprint of [
      '436d8e67577c2494d101e3572da0ed72',
      'b404642ee006aac56488662e309e75b4',
      '5bea678ca4a85697e308b8728d6cc344',
      '8153d07e9417a0718e71f769cea622ba',
      '83c2d83a6d6ac03dda5a44c8f9d0e1e0',
      '5fbbc307824f65aed80ee6fedadb4c40',
      '8dc6b2e929b8fd5d000c97003b786ba4',
      'f7289d520c842200d2960b4f0a5daeed',
      '8984b2ab8e2e155309517c448b08a979',
      'd827ea97e7ee6cf032080729a12e1253',
      '8ee5bdc8ddfa993d319480ab1d1d2d5a',
      'f15c2aa376955f574d81d9bb6cf0c662',
      '5af89d01800b50292cd05f0582531d89',
      'b8b0e1bc6d2009f5341cd784a3a7d0e7',
    ]) {
      expect(migration).toContain(fingerprint);
      expect(rollback).toContain(fingerprint);
    }
    for (const proof of [migration, rollback, preflight, postApply]) {
      expect(proof).toContain('mobile_employee_identity_containment');
      expect(proof).toContain('employees_self_identity_read');
      expect(proof).toContain("qual = '(auth_user_id = auth.uid())'");
      expect(proof).toContain(
        "ARRAY['auth_user_id', 'id', 'is_active', 'role']::text[]",
      );
      expect(proof).not.toContain('allow_authenticated_employees');
      expect(proof).not.toContain('f4e97bfcaee7958a42ff9ca6c0a04a3c');
    }

    expect(isolated).toContain('mobile_employee_identity_containment');
    expect(isolated).toContain('employees_self_identity_read');
    expect(isolated).toContain(
      "has_column_privilege(\n          'authenticated',\n"
        + "          'public.employees',\n          'full_name',",
    );
  });

  it('ships value-free catalog checks and a guarded rollback-only identity matrix', () => {
    const mutatingSql = /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|GRANT|REVOKE|TRUNCATE)\b/i;
    for (const sql of [preflight, postApply]) {
      const code = executable(sql);
      const withoutStrings = code.replace(/'(?:''|[^'])*'/g, "''");
      expect(withoutStrings).not.toMatch(mutatingSql);
      expect(code).not.toMatch(
        /\b(?:PERFORM|CALL)\s+(?:public\.)?(?:get_employee_page_access|get_effective_notification_prefs|get_my_notification_prefs|set_my_notification_pref|get_my_push_subscriptions|upsert_push_subscription|delete_push_subscription|upsert_device_token|delete_device_token)\s*\(/i,
      );
      expect(code).not.toMatch(
        /\bFROM\s+public\.(?:employee_page_access|notification_prefs|push_subscriptions|device_tokens)\b/i,
      );
    }

    expect(isolated).toMatch(/ISOLATED DATABASE ONLY/);
    expect(isolated).toContain('\\if :{?UPR_ISOLATED_DB}');
    expect(isolated).toContain(
      "current_setting('upr.isolated_test_database', true)",
    );
    expect(isolated).toContain("IS DISTINCT FROM 'on'");
    expect(isolated).toContain('\\quit 2');
    expect(isolated).toContain(
      "current_setting('upr.s1h.auth_project_manager')",
    );
    expect(isolated).toContain('$inactive_denials$');
    expect(isolated).toContain('$external_denials$');
    expect(isolated).toContain(
      "'[S1h isolated] CRM partner marker mismatch'",
    );
    expect(isolated).toContain("'crm_partner'");
    expect(isolated).toContain('$crm_partner_marker_mismatch_denials$');
    expect(isolated).toContain('$unmapped_denials$');
    expect(isolated).toContain('$admin_behavior$');
    expect(isolated).toContain('$project_manager_behavior$');
    expect(isolated).toContain('$service_behavior$');
    expect(isolated).toContain('$anonymous_denials$');
    expect(isolated).toContain('__s1h_disabled__');
    expect(isolated).toContain(
      'S1h isolated personal preference precedence failed',
    );
    expect(isolated).toContain(
      'S1h isolated role lock did not override personal data',
    );
    expect(isolated).toContain(
      'S1h isolated service direct-prune contract failed',
    );
    expect(isolated).toContain(
      'S1h isolated own employee identity read failed',
    );
    expect(isolated).toContain(
      'S1h isolated foreign employee identity leaked through RLS',
    );
    expect(isolated).toContain(
      'S1h isolated service employee-read compatibility failed',
    );
    expect(isolated).toContain(
      "'SELECT id FROM public.employees'",
    );
    expect(isolated).toContain(
      "'SELECT * FROM public.employees'",
    );
    expect(isolated).toContain("'s1h-token-delete-own'");
    const markerMismatchMatrix = isolated.match(
      /DO \$crm_partner_marker_mismatch_denials\$[\s\S]*?\$crm_partner_marker_mismatch_denials\$;/,
    )?.[0];
    expect(markerMismatchMatrix).toBeTruthy();
    for (const contract of contracts) {
      expect(
        markerMismatchMatrix.match(
          new RegExp(`public\\.${contract.name}\\s*\\(`, 'g'),
        ),
        `marker-mismatch denial for ${contract.name}`,
      ).toHaveLength(1);
    }
    expect(isolated).toContain('ROLLBACK;');
    expect(executable(isolated)).not.toMatch(/\bCOMMIT\b/i);

    expect(isolatedWrapper).toContain('\\set UPR_ISOLATED_DB 1');
    expect(isolatedWrapper).toContain(
      '\\ir mobile_personal_ownership_boundary_isolated.sql',
    );
    expect(localDbRunner).toContain(
      "'supabase/tests/notification_read_recipient_boundary.test.sql'",
    );
    expect(localDbRunner).toContain(
      "'supabase/tests/mobile_personal_ownership_boundary.test.sql'",
    );
    expect(localDbRunner).toContain("'--local'");
    expect(localDbRunner).toContain(
      "PGOPTIONS: '-cupr.isolated_test_database=on'",
    );
    expect(localDbRunner).not.toContain("'--linked'");
    expect(localDbRunner).not.toContain("'--db-url'");
    expect(existsSync(join(
      root,
      'supabase/tests/notify_c_my_prefs.test.js',
    ))).toBe(false);
  });

  it('fails authenticated bootstrap closed while preserving the CRM-partner carve-out', () => {
    const accessLoader = authContext.match(
      /const loadEmployeePageAccess = async[\s\S]*?\n {2}\};/,
    )?.[0];
    const authBootstrap = authContext.match(
      /const handleAuthUser = async[\s\S]*?\n {2}\};/,
    )?.[0];

    expect(accessLoader).toBeTruthy();
    expect(accessLoader).toContain(
      "dbClient.rpc('get_employee_page_access', { p_employee_id: employeeId })",
    );
    expect(accessLoader).not.toContain('setEmployeePageAccess({})');

    expect(authBootstrap).toBeTruthy();
    expect(authBootstrap).toContain(
      "authenticatedDb.rpc(\n        'get_my_employee_profile',",
    );
    expect(authBootstrap).not.toContain('employeeAuthFilter(');
    expect(authBootstrap).toContain('import.meta.env.DEV');
    expect(authBootstrap).toContain(
      'import.meta.env.VITE_DEV_TEST_EMAIL',
    );
    expect(authBootstrap).toContain('isDedicatedDevAccount');
    expect(authBootstrap).toContain('classifyEmployeeBootstrap(emp, {');
    expect(authBootstrap).toContain('if (!bootstrap.allowed)');
    expect(authBootstrap).toContain('bootstrap.loadPersonalPageAccess');
    expect(authBootstrap).toContain('pageAccessLoad');
    expect(authBootstrap.indexOf('setEmployee(emp);')).toBeGreaterThan(
      authBootstrap.indexOf('await Promise.all(['),
    );
    expect(authBootstrap).toContain('setEmployee(null);');
    expect(authBootstrap).toContain(
      'const cleanupResult = await requireAccountCleanup(',
    );
    expect(authBootstrap.match(
      /await finishRejectedPrincipal\(generation, \{/g,
    )).toHaveLength(2);
    expect(authBootstrap).toContain(
      'Failed to verify employee access. Please sign in and try again.',
    );
    expect(authContext).toContain(
      "typeof employee.is_active === 'boolean'",
    );
    expect(authContext).toContain(
      "typeof employee.is_external === 'boolean'",
    );
    expect(authContext).toContain(
      'SUPPORTED_EMPLOYEE_ROLES.has(employee.role)',
    );
    expect(authContext).toContain(
      "typeof flag.enabled !== 'boolean'",
    );
    expect(authContext).toContain(
      "typeof flag.force_disabled !== 'boolean'",
    );
    expect(authContext).toContain(
      'flag.dev_only_user_id !== null',
    );
    expect(authContext).toContain(
      "typeof row.can_edit !== 'boolean'",
    );
    expect(authContext).toContain(
      "rejectionMessage: (",
    );
    expect(authContext).toContain(
      "postSignOutError: rejectionMessage",
    );
    expect(authContext).toContain(
      "passwordRecovery: true",
    );
    expect(authContext).toContain(
      'finishPasswordRecoveryCleanup(generation)',
    );
  });

  it('removes anonymous employee selection and requires native detach lifecycle', () => {
    expect(authContext).not.toMatch(/\bconst devLogin\b/);
    expect(authContext).not.toContain('devLogin,');
    expect(read('src/pages/Login.jsx')).not.toContain(
      'Dev Mode: Select Employee',
    );
    expect(read('src/pages/Login.jsx')).not.toMatch(
      /\.select\(['"]employees['"]/,
    );
    expect(read('src/pages/Login.jsx')).toContain(
      'Dev Mode: Real Data (test admin)',
    );

    expect(nativePush).toContain(
      "db.rpc('upsert_my_native_device_token', {",
    );
    expect(nativePush).toContain(
      'export async function detachNativePushDevice(db, {',
    );
    expect(nativePush).toContain(
      "db.rpc('delete_my_native_device_token', { p_token: token })",
    );
    expect(nativePush).toContain('PushNotifications.unregister()');
    expect(accountDeviceCleanup).toMatch(
      /import \{\s*detachNativePushDevice,\s*retryPendingNativePushDetach,\s*\} from '\.\/pushNotifications\.js'/,
    );
    expect(accountDeviceCleanup).toContain(
      'detachNative = detachNativePushDevice',
    );
    expect(authContext).toContain(
      'pushCleanup: () => detachAccountPushDevices(',
    );
    expect(authContext).toContain('{ ownerKey: authenticatedOwnerKey }');
  });

  it('guards unsafe rollback fidelity instead of disguising restored exposure', () => {
    const sql = executable(rollback);
    expect(rollback).toContain(
      "current_setting('upr.allow_unsafe_s1h_rollback', true)",
    );
    expect(rollback).toMatch(
      /restores anonymous page-access enumeration, broad browser/i,
    );
    expect(sql).toContain(
      'ALTER TABLE public.employee_page_access NO FORCE ROW LEVEL SECURITY;',
    );
    expect(sql).toContain(
      'ALTER TABLE public.notification_prefs NO FORCE ROW LEVEL SECURITY;',
    );
    expect(sql).toContain(
      'ALTER TABLE public.push_subscriptions NO FORCE ROW LEVEL SECURITY;',
    );
    expect(sql).toContain(
      'ALTER TABLE public.device_tokens NO FORCE ROW LEVEL SECURITY;',
    );
    expect(sql).toContain(
      'GRANT ALL PRIVILEGES ON TABLE public.employee_page_access TO anon, authenticated;',
    );
    expect(sql).toContain(
      'GRANT ALL PRIVILEGES ON TABLE public.notification_prefs TO anon, authenticated;',
    );
    expect(sql).toContain(
      'GRANT ALL PRIVILEGES ON TABLE public.push_subscriptions TO anon, authenticated;',
    );
    expect(sql).toContain(
      'GRANT ALL PRIVILEGES ON TABLE public.device_tokens TO anon, authenticated;',
    );
    expect(sql).toContain(
      'DROP FUNCTION public.is_current_active_internal_employee(uuid);',
    );
    expect(rollback).toContain('aea87dfe07b22c489c0f8401ae03053b');
  });
});
