/**
 * ════════════════════════════════════════════════
 * FILE: scripts/ios-release-workflow.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Locks the source-level iOS release safety contract: manual main-only
 *   execution, archive/upload separation, explicit signing, verified privacy
 *   resources, disabled OTA, pinned tools, temporary secrets, and fail-closed
 *   artifact checks.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  iOS project/release files and native QA scripts
 *   Data:      reads  → repository source files
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - These are credential-free source checks; they do not build, sync, sign,
 *     upload, invoke Xcode, or prove a real-device release.
 * ════════════════════════════════════════════════
 */
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  EXPECTED_COLLECTED_DATA_TYPES,
  assertSafeArchiveEntries,
  parseVerifierArguments,
  validatePrivacyManifest,
} from './qa/verify-ios-release-artifact.mjs';

function repositoryFile(relativePath) {
  return fileURLToPath(new URL(`../${relativePath}`, import.meta.url));
}

function readRepositoryFile(relativePath) {
  return readFileSync(repositoryFile(relativePath), 'utf8');
}

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

const workflow = readRepositoryFile('.github/workflows/ios-release.yml');
const capgoWorkflow = readRepositoryFile('.github/workflows/capgo-deploy.yml');
const archiveJob = section(workflow, '  archive:', '  publish:');
const publishJob = workflow.slice(workflow.indexOf('  publish:'));
const fastfile = readRepositoryFile('ios/fastlane/Fastfile');
const archiveLane = section(fastfile, '  lane :archive do', '  desc "Upload');
const uploadLane = fastfile.slice(fastfile.indexOf('  lane :upload do'));
const appfile = readRepositoryFile('ios/fastlane/Appfile');
const project = readRepositoryFile('ios/App/App.xcodeproj/project.pbxproj');
const versionConfig = readRepositoryFile('ios/App/Version.xcconfig');
const debugConfig = readRepositoryFile('ios/debug.xcconfig');
const privacyManifestSource = readRepositoryFile(
  'ios/App/App/PrivacyInfo.xcprivacy',
);
const debugBuildConfiguration = section(
  project,
  '504EC3171FED79650016851F /* Debug */',
  '504EC3181FED79650016851F /* Release */',
);
const releaseBuildConfiguration = section(
  project,
  '504EC3181FED79650016851F /* Release */',
  '/* End XCBuildConfiguration section */',
);
const debugEntitlements = readRepositoryFile('ios/App/App/App.entitlements');
const releaseEntitlements = readRepositoryFile(
  'ios/App/App/App.Release.entitlements',
);
const gemfile = readRepositoryFile('ios/Gemfile');
const gemfileLock = readRepositoryFile('ios/Gemfile.lock');
const iosGitignore = readRepositoryFile('ios/.gitignore');
const nativeBuildScript = readRepositoryFile('scripts/build-native.mjs');
const verifier = readRepositoryFile('scripts/qa/verify-ios-release-artifact.mjs');
const ownedSubprocessRunner = readRepositoryFile(
  'scripts/qa/run-owned-subprocess.mjs',
);
const capacitorConfig = JSON.parse(readRepositoryFile('capacitor.config.json'));
const ownedSubprocessRunnerPath = repositoryFile(
  'scripts/qa/run-owned-subprocess.mjs',
);

function runOwnedCommand(
  timeoutMs,
  command,
  args,
  {
    termGraceMs = 50,
    safeEnv = false,
    parentEnv = process.env,
  } = {},
) {
  const runnerArgs = [
    ownedSubprocessRunnerPath,
    '--timeout-ms',
    String(timeoutMs),
    '--term-grace-ms',
    String(termGraceMs),
    '--cwd',
    repositoryFile('.'),
    ...(safeEnv ? ['--safe-env'] : []),
    '--',
    command,
    ...args,
  ];
  return spawnSync(
    process.execPath,
    runnerArgs,
    {
      cwd: repositoryFile('.'),
      encoding: 'utf8',
      env: parentEnv,
      timeout: 5_000,
    },
  );
}

function runOwnedSubprocess(timeoutMs, childSource, options) {
  return runOwnedCommand(
    timeoutMs,
    process.execPath,
    ['-e', childSource],
    options,
  );
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

describe('iOS release workflow authorization boundary', () => {
  it('remains manual-only and defaults provider publication to false', () => {
    expect(workflow).toMatch(/^\s{2}workflow_dispatch:\s*$/m);
    expect(workflow).not.toMatch(/^\s{2}(push|pull_request|schedule):/m);
    expect(workflow).toMatch(
      /publish_to_testflight:[\s\S]*?default:\s*false[\s\S]*?type:\s*boolean/,
    );
  });

  it('uses read-only repository permission and serializes release runs', () => {
    expect(workflow).toMatch(/permissions:\s*\n\s{2}contents:\s*read/);
    expect(workflow).toMatch(/concurrency:[\s\S]*?cancel-in-progress:\s*false/);
    expect(workflow).toContain('persist-credentials: false');
    expect(archiveJob).toContain('environment: ios-signing');
  });

  it('refuses any source ref other than main before signing material is handled', () => {
    const sourceGuardIndex = archiveJob.indexOf(
      'Enforce production source and locked Ruby dependencies',
    );
    const signingDecodeIndex = archiveJob.indexOf(
      'Decode signing assets into runner temporary storage',
    );
    expect(sourceGuardIndex).toBeGreaterThanOrEqual(0);
    expect(signingDecodeIndex).toBeGreaterThan(sourceGuardIndex);
    expect(archiveJob).toContain('refs/heads/main');
  });

  it('never references the secrets context in an if expression', () => {
    expect(workflow).not.toMatch(/^\s+if:.*\bsecrets\./m);
  });

  it('pins the macOS/Xcode, Node, Ruby, Bundler, and fastlane versions', () => {
    expect(workflow).toContain('runs-on: macos-26');
    expect(workflow).toContain(
      'DEVELOPER_DIR: /Applications/Xcode_26.6.app/Contents/Developer',
    );
    expect(workflow).toContain('Build version 17F113');
    expect(workflow).toContain('node-version: 22.23.1');
    expect(workflow).toContain('ruby-version: 3.3.12');
    expect(workflow).toContain('bundler: 2.5.22');
    expect(readFileSync(repositoryFile('ios/.ruby-version'), 'utf8').trim())
      .toBe('3.3.12');
    expect(readFileSync(repositoryFile('ios/Gemfile'), 'utf8'))
      .toContain('ruby "3.3.12"');
    expect(gemfile).toContain('gem "fastlane", "2.237.0"');
    expect(gemfileLock).toMatch(/BUNDLED WITH\s+2\.5\.22\s*$/);
  });

  it('fails closed until a reviewed Ruby lockfile is committed', () => {
    const lockfileExists = existsSync(repositoryFile('ios/Gemfile.lock'));
    expect(
      lockfileExists ||
        archiveJob.includes(
          'ios/Gemfile.lock is required before any signing material is handled.',
        ),
    ).toBe(true);
  });

  it('keeps archive creation separate from environment-gated provider upload', () => {
    expect(archiveJob).toContain('bundle exec fastlane ios archive');
    expect(archiveJob).not.toContain('ASC_KEY_');
    expect(archiveJob).not.toContain('fastlane ios upload');

    expect(publishJob).toContain('needs: archive');
    expect(publishJob).toContain('if: ${{ inputs.publish_to_testflight }}');
    expect(publishJob).toContain('environment: ios-testflight');
    expect(publishJob).toContain('bundle exec fastlane ios upload');
    expect(publishJob).toContain('ASC_KEY_CONTENT_BASE64');
  });

  it('presents native Push while the signed app is in the foreground', () => {
    expect(capacitorConfig.plugins.PushNotifications?.presentationOptions)
      .toEqual(['badge', 'sound', 'alert']);
  });

  it('bounds Xcode and provider subprocesses with owned cleanup and pinned raised budgets', () => {
    // Owner-authorized 2026-07-29: the archive (30 min) and upload (15 min)
    // steps opt into a raised total-runtime budget via --total-runtime-ms;
    // the five-minute default law stays for every other consumer, and the
    // 45-minute job timeout remains the outer bound.
    for (const job of [archiveJob, publishJob]) {
      expect(job).toContain('scripts/qa/run-owned-subprocess.mjs');
    }
    expect(archiveJob).toContain('--total-runtime-ms 1800000');
    expect(archiveJob).toContain('--timeout-ms 1792000');
    expect(publishJob).toContain('--total-runtime-ms 900000');
    expect(publishJob).toContain('--timeout-ms 892000');
    expect(ownedSubprocessRunner).toContain('const MAX_TOTAL_RUNTIME_MS = 300_000');
    expect(ownedSubprocessRunner).toContain('const ABSOLUTE_TOTAL_RUNTIME_CEILING_MS = 2_700_000');
    expect(ownedSubprocessRunner).toContain('const MAX_COMMAND_TIMEOUT_MS');
    expect(ownedSubprocessRunner).toContain('detached: true');
    expect(ownedSubprocessRunner).toContain("process.kill(-pid, signal)");
    expect(ownedSubprocessRunner).toContain('verifyProcessGroupGone(pid)');
  });

  it('rejects a total-runtime raise above the 45-minute ceiling before any child starts', () => {
    // Validation happens pre-spawn, so this probe is platform-independent.
    const rejected = spawnSync(
      process.execPath,
      [
        ownedSubprocessRunnerPath,
        '--total-runtime-ms', '2700001',
        '--', process.execPath, '-e', 'process.exit(0)',
      ],
      { encoding: 'utf8' },
    );
    expect(rejected.status).not.toBe(0);
    expect(`${rejected.stderr}${rejected.stdout}`).toContain('--total-runtime-ms');
  });

  // The two live subprocess probes below depend on POSIX semantics (/bin/sh,
  // process-group kill via negative PID, timeout exit code 124) and cannot pass
  // on Windows. They guard in-body rather than via it.skip because the lane
  // runner fails on any skipped test; CI (Linux) is the enforcing environment.
  it('dynamically cleans successful and timed-out owned process groups', () => {
    if (process.platform === 'win32') return;
    const success = runOwnedSubprocess(500, 'process.exit(0)');
    expect(success.status).toBe(0);
    expect(success.stderr).toContain('Verified owned process group');

    // A POSIX shell keeps this process-tree proof lightweight and deterministic
    // even while Vitest is running the full parallel unit lane.
    const descendant = runOwnedCommand(
      800,
      '/bin/sh',
      [
        '-c',
        'sleep 30 & child_pid=$!; printf "%s" "$child_pid"; wait',
      ],
    );
    expect(descendant.status).toBe(124);
    expect(descendant.stderr).toContain('Verified owned process group');
    const descendantPid = Number(descendant.stdout);
    expect(Number.isInteger(descendantPid)).toBe(true);
    expect(processExists(descendantPid)).toBe(false);
  });

  it('scrubs caller credentials when a QA command selects the safe environment', () => {
    const syntheticSecretName = 'UPR_QA_SYNTHETIC_SECRET';
    const scrubbed = runOwnedSubprocess(
      500,
      `process.stdout.write(process.env.${syntheticSecretName} || 'absent')`,
      {
        safeEnv: true,
        parentEnv: {
          ...process.env,
          [syntheticSecretName]: 'must-not-cross',
        },
      },
    );

    expect(scrubbed.status).toBe(0);
    expect(scrubbed.stdout).toBe('absent');
    expect(scrubbed.stderr).toContain('Verified owned process group');
  });

  it('SIGKILLs TERM-resistant children inside the five-minute total deadline', () => {
    if (process.platform === 'win32') return; // POSIX-only — see the comment above
    const startedAt = Date.now();
    const resistant = runOwnedSubprocess(
      800,
      "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);",
    );
    const elapsedMs = Date.now() - startedAt;

    expect(resistant.status).toBe(124);
    expect(resistant.stderr).toContain('Verified owned process group');
    expect(elapsedMs).toBeLessThan(3_000);
  });

  it('reverifies the transported IPA before the provider lane', () => {
    const verifyIndex = publishJob.indexOf('Reverify downloaded IPA');
    const uploadIndex = publishJob.indexOf('Upload the reverified IPA');
    expect(verifyIndex).toBeGreaterThanOrEqual(0);
    expect(uploadIndex).toBeGreaterThan(verifyIndex);
  });

  it('keeps native web build and Capacitor sync as separate commands', () => {
    expect(archiveJob).toContain('run: node scripts/build-native.mjs');
    expect(archiveJob).toContain('run: node_modules/.bin/cap sync ios');
    expect(archiveJob).toContain('git diff --exit-code -- ios/App');
    expect(nativeBuildScript).toContain("VITE_BUILD_TARGET: 'native'");
    expect(nativeBuildScript).not.toMatch(
      /spawnSync\([\s\S]*?['"]cap(?:acitor)?['"][\s\S]*?['"]sync['"]/,
    );
  });

  it('pins TestFlight API traffic and release identity to production', () => {
    expect(workflow).toContain(
      'VITE_NATIVE_API_ORIGIN: https://utahpros.app',
    );
    expect(workflow).toContain('VITE_RELEASE_SHA: "${{ github.sha }}"');
    expect(archiveJob).toContain(
      '"$VITE_NATIVE_API_ORIGIN" != "https://utahpros.app"',
    );
    expect(archiveJob).toContain(
      '"$VITE_RELEASE_SHA" != "$GITHUB_SHA"',
    );
  });

  it('keeps OTA disabled and pins each dormant channel to its API origin', () => {
    expect(capgoWorkflow).toContain('if: ${{ false }}');
    expect(capgoWorkflow).toContain(
      'echo "api_origin=https://utahpros.app" >> "$GITHUB_OUTPUT"',
    );
    expect(capgoWorkflow).toContain(
      'echo "api_origin=https://dev.utahpros.app" >> "$GITHUB_OUTPUT"',
    );
    expect(capgoWorkflow).toContain(
      'VITE_NATIVE_API_ORIGIN: ${{ steps.channel.outputs.api_origin }}',
    );
    expect(capgoWorkflow).toContain('VITE_RELEASE_SHA: ${{ github.sha }}');
    expect(capgoWorkflow).toContain(
      '"$CHANNEL" = "production" ] && [ "$VITE_NATIVE_API_ORIGIN" != "https://utahpros.app"',
    );
    expect(capgoWorkflow).toContain(
      '"$CHANNEL" = "beta" ] && [ "$VITE_NATIVE_API_ORIGIN" != "https://dev.utahpros.app"',
    );
  });

  it('fails closed unless the archived native bundle enables push exactly', () => {
    const inputValidation = section(
      archiveJob,
      '      - name: Validate archive inputs',
      '      - name: Select and verify Xcode 26.6',
    );
    const nativeBuild = section(
      archiveJob,
      '      - name: Build the native web bundle',
      '      - name: Synchronize the iOS platform',
    );

    expect(inputValidation).toContain(
      'VITE_NATIVE_PUSH_ENABLED: ${{ secrets.VITE_NATIVE_PUSH_ENABLED }}',
    );
    expect(inputValidation).toContain(
      'VITE_APNS_ENV: ${{ secrets.VITE_APNS_ENV }}',
    );
    expect(inputValidation).toContain(
      'if [[ "$VITE_NATIVE_PUSH_ENABLED" != "true" ]]',
    );
    expect(inputValidation).toContain(
      'if [[ "$VITE_APNS_ENV" != "production" ]]',
    );
    expect(nativeBuild).toContain(
      'VITE_NATIVE_PUSH_ENABLED: ${{ secrets.VITE_NATIVE_PUSH_ENABLED }}',
    );
    expect(nativeBuild).toContain(
      'VITE_APNS_ENV: ${{ secrets.VITE_APNS_ENV }}',
    );
  });

  it('owns one three-part marketing version and verifies it in both release jobs', () => {
    expect(versionConfig).toMatch(/^MARKETING_VERSION = \d+\.\d+\.\d+$/m);
    expect(debugConfig).toContain('#include "App/Version.xcconfig"');
    expect(debugBuildConfiguration).not.toContain('MARKETING_VERSION =');
    expect(releaseBuildConfiguration).not.toContain('MARKETING_VERSION =');
    expect(releaseBuildConfiguration).toContain(
      'baseConfigurationReference = B91C4E122E5A4B7C9F1032D4',
    );
    expect(archiveJob).toContain('ios/App/Version.xcconfig');
    expect(publishJob).toContain('ios/App/Version.xcconfig');
    expect(archiveJob).toContain(
      '--expected-marketing-version "$marketing_version"',
    );
    expect(publishJob).toContain(
      '--expected-marketing-version "$marketing_version"',
    );
  });

  it('decodes signing files only under runner temporary storage and cleans them', () => {
    expect(archiveJob).toContain('$RUNNER_TEMP/upr-signing-certificate.p12');
    expect(archiveJob).toContain('$RUNNER_TEMP/upr-signing-profile.mobileprovision');
    expect(archiveJob).toContain('chmod 600');
    expect(archiveJob).toContain('Remove decoded signing assets');
    expect(archiveJob).not.toContain('$GITHUB_ENV');
    expect(archiveJob).not.toMatch(/>\s*signing_(certificate|profile)/);
    expect(iosGitignore).toContain('/signing_certificate.p12');
    expect(iosGitignore).toContain('/signing_profile.mobileprovision');
  });

  it('does not expose signing secrets to dependency installation or tests', () => {
    const jobHeader = section(archiveJob, '    runs-on:', '    steps:');
    const repositoryTests = section(
      archiveJob,
      '      - name: Install JavaScript dependencies',
      '      - name: Build the native web bundle',
    );
    expect(jobHeader).not.toContain('APPLE_CERTIFICATE');
    expect(jobHeader).not.toContain('APPLE_PROVISIONING_PROFILE');
    expect(repositoryTests).not.toContain('APPLE_CERTIFICATE');
    expect(repositoryTests).not.toContain('APPLE_PROVISIONING_PROFILE');
  });
});

describe('Fastlane signing and provider contracts', () => {
  it('keeps manual distribution signing scoped to the app target', () => {
    expect(fastfile).toContain('File.join(IOS_ROOT, "App", "App.xcodeproj")');
    expect(archiveLane).toContain('project: XCODE_PROJECT');
    expect(archiveLane).not.toContain('workspace:');
    expect(archiveLane).not.toContain(
      'xcode_assignment("PROVISIONING_PROFILE_SPECIFIER"',
    );
    expect(archiveLane).not.toContain(
      'xcode_assignment("CODE_SIGN_STYLE"',
    );
    expect(archiveLane).not.toContain('codesigning_identity:');
    expect(archiveLane).toContain(
      'xcode_assignment("UPR_RELEASE_PROFILE_NAME", provisioning_profile_name)',
    );
    expect(archiveLane).toContain('signingStyle: "manual"');
    expect(archiveLane).toContain('signingCertificate: "Apple Distribution"');
    expect(archiveLane).toContain('APP_IDENTIFIER => provisioning_profile_name');
    expect(releaseBuildConfiguration).toContain(
      'CODE_SIGN_IDENTITY = "Apple Distribution";',
    );
    expect(releaseBuildConfiguration).toContain('CODE_SIGN_STYLE = Manual;');
    expect(releaseBuildConfiguration).toContain(
      'PROVISIONING_PROFILE_SPECIFIER = "$(UPR_RELEASE_PROFILE_NAME)";',
    );
    expect(debugBuildConfiguration).toContain('CODE_SIGN_STYLE = Automatic;');
    expect(debugBuildConfiguration).not.toContain(
      'PROVISIONING_PROFILE_SPECIFIER',
    );
    expect(archiveLane).toContain('CURRENT_PROJECT_VERSION');
    expect(archiveLane).not.toContain('latest_testflight_build_number');
  });

  it('always attempts to delete its temporary signing keychain', () => {
    expect(archiveLane).toContain('ensure');
    expect(archiveLane).toContain('delete_keychain(name: keychain_name)');
    expect(archiveLane).toContain('default_keychain: false');
  });

  it('does not expose provider authentication to the archive lane', () => {
    expect(archiveLane).not.toContain('app_store_connect_api_key');
    expect(archiveLane).not.toContain('upload_to_testflight');
    expect(uploadLane).toContain('app_store_connect_api_key');
    expect(uploadLane).toContain('is_key_content_base64: true');
    expect(uploadLane).toContain('upload_to_testflight');
    expect(appfile).not.toContain('apple_id');
  });
});

describe('native release artifact safety contract', () => {
  it('registers PrivacyInfo.xcprivacy in the app group and Resources phase', () => {
    expect(project).toMatch(
      /PBXFileReference; lastKnownFileType = text\.xml; path = PrivacyInfo\.xcprivacy;/,
    );
    expect(project.match(/PrivacyInfo\.xcprivacy in Resources/g)).toHaveLength(2);
    expect(project).toMatch(
      /504EC3061FED79650016851F[\s\S]*PrivacyInfo\.xcprivacy[\s\S]*path = App;/,
    );
  });

  it('keeps the source privacy manifest aligned with the reviewed 12-type disclosure', () => {
    const sourceTypes = [
      ...privacyManifestSource.matchAll(
        /<string>(NSPrivacyCollectedDataType(?!Purpose)[A-Za-z]+)<\/string>/g,
      ),
    ].map((match) => match[1]).sort();

    expect(EXPECTED_COLLECTED_DATA_TYPES).toContain(
      'NSPrivacyCollectedDataTypeOtherFinancialInfo',
    );
    expect(sourceTypes).toEqual(EXPECTED_COLLECTED_DATA_TYPES);
  });

  it('fails closed unless the signed privacy manifest matches the reviewed disclosure', () => {
    const reviewedEntry = (type) => ({
      NSPrivacyCollectedDataType: type,
      NSPrivacyCollectedDataTypeLinked: true,
      NSPrivacyCollectedDataTypeTracking: false,
      NSPrivacyCollectedDataTypePurposes: [
        'NSPrivacyCollectedDataTypePurposeAppFunctionality',
      ],
    });
    const manifest = {
      NSPrivacyTracking: false,
      NSPrivacyTrackingDomains: [],
      NSPrivacyCollectedDataTypes:
        EXPECTED_COLLECTED_DATA_TYPES.map(reviewedEntry),
      NSPrivacyAccessedAPITypes: [{
        NSPrivacyAccessedAPIType:
          'NSPrivacyAccessedAPICategoryUserDefaults',
        NSPrivacyAccessedAPITypeReasons: ['CA92.1'],
      }],
    };

    expect(() => validatePrivacyManifest(
      manifest,
      'fixture manifest',
    )).not.toThrow();
    expect(() => validatePrivacyManifest(
      {
        ...manifest,
        NSPrivacyCollectedDataTypes:
          manifest.NSPrivacyCollectedDataTypes.slice(1),
      },
      'fixture manifest',
    )).toThrow(/reviewed disclosure/);
    expect(() => validatePrivacyManifest(
      {
        ...manifest,
        NSPrivacyCollectedDataTypes: [
          {
            ...manifest.NSPrivacyCollectedDataTypes[0],
            NSPrivacyCollectedDataTypeTracking: true,
          },
          ...manifest.NSPrivacyCollectedDataTypes.slice(1),
        ],
      },
      'fixture manifest',
    )).toThrow(/cannot be used for tracking/);
  });

  it('reads only security-relevant provisioning metadata', () => {
    expect(verifier).toContain(
      "readPlistJsonKey(\n      decodedProfilePath,\n      'Entitlements'",
    );
    expect(verifier).toContain(
      "readPlistRawKey(\n      decodedProfilePath,\n      'ExpirationDate'",
    );
    expect(verifier).not.toContain("'DeveloperCertificates'");
    expect(verifier).not.toContain("'DER-Encoded-Profile'");
  });

  it('uses development push only for Debug and production push for Release', () => {
    expect(debugBuildConfiguration).toContain(
      'CODE_SIGN_ENTITLEMENTS = App/App.entitlements;',
    );
    expect(releaseBuildConfiguration).toContain(
      'CODE_SIGN_ENTITLEMENTS = App/App.Release.entitlements;',
    );
    expect(debugEntitlements).toMatch(
      /<key>aps-environment<\/key>\s*<string>development<\/string>/,
    );
    expect(releaseEntitlements).toMatch(
      /<key>aps-environment<\/key>\s*<string>production<\/string>/,
    );
    expect(verifier).toContain("'aps-environment'] === 'production'");
  });

  it('keeps automatic and direct OTA updates disabled pending the dedicated gate', () => {
    const updater = capacitorConfig.plugins.CapacitorUpdater;
    expect(updater.autoUpdate).toBe(false);
    expect(updater.directUpdate).toBe(false);
    expect(updater.resetWhenUpdate).toBe(true);
    expect(updater).not.toHaveProperty('defaultChannel');
  });

  it('parses explicit verifier inputs and rejects malformed invocations', () => {
    expect(
      parseVerifierArguments([
        '--ipa',
        'UPR.ipa',
        '--report',
        'report.json',
        '--expected-bundle-id',
        'com.example.app',
        '--expected-team-id',
        'TEAM123',
        '--expected-marketing-version',
        '1.0.0',
        '--expected-build-number',
        '42.1',
      ]),
    ).toEqual({
      ipa: 'UPR.ipa',
      report: 'report.json',
      expectedBundleId: 'com.example.app',
      expectedTeamId: 'TEAM123',
      expectedMarketingVersion: '1.0.0',
      expectedBuildNumber: '42.1',
    });
    expect(() => parseVerifierArguments(['--ipa', 'UPR.ipa'])).toThrow(
      /Missing required verifier argument/,
    );
    expect(() => parseVerifierArguments(['--unknown', 'value'])).toThrow(
      /Unknown verifier argument/,
    );
  });

  it('rejects unsafe IPA entry paths before extraction', () => {
    expect(() =>
      assertSafeArchiveEntries(['Payload/App.app/Info.plist']),
    ).not.toThrow();
    expect(() =>
      assertSafeArchiveEntries(['Payload/../../escaped']),
    ).toThrow(/path traversal/);
    expect(() => assertSafeArchiveEntries(['/absolute/path'])).toThrow(
      /absolute path/,
    );
  });

  it('verifies signatures, provisioning, privacy, push, build identity, and hashes', () => {
    for (const requiredContract of [
      "'/usr/bin/codesign'",
      "'--verify'",
      "'/usr/bin/security'",
      "'cms'",
      "'PrivacyInfo.xcprivacy'",
      "'aps-environment'] === 'production'",
      "'get-task-allow'] === false",
      'profile.ProvisionedDevices',
      'ITSAppUsesNonExemptEncryption === false',
      "createHash('sha256')",
    ]) {
      expect(verifier).toContain(requiredContract);
    }
  });
});
