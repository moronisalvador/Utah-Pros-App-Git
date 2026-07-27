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
const archiveJob = section(workflow, '  archive:', '  publish:');
const publishJob = workflow.slice(workflow.indexOf('  publish:'));
const fastfile = readRepositoryFile('ios/fastlane/Fastfile');
const archiveLane = section(fastfile, '  lane :archive do', '  desc "Upload');
const uploadLane = fastfile.slice(fastfile.indexOf('  lane :upload do'));
const appfile = readRepositoryFile('ios/fastlane/Appfile');
const project = readRepositoryFile('ios/App/App.xcodeproj/project.pbxproj');
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
const iosGitignore = readRepositoryFile('ios/.gitignore');
const nativeBuildScript = readRepositoryFile('scripts/build-native.mjs');
const verifier = readRepositoryFile('scripts/qa/verify-ios-release-artifact.mjs');
const capacitorConfig = JSON.parse(readRepositoryFile('capacitor.config.json'));

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
    expect(workflow).toContain('bundler: 4.0.16');
    expect(readFileSync(repositoryFile('ios/.ruby-version'), 'utf8').trim())
      .toBe('3.3.12');
    expect(readFileSync(repositoryFile('ios/Gemfile'), 'utf8'))
      .toContain('ruby "3.3.12"');
    expect(gemfile).toContain('gem "fastlane", "2.237.0"');
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
  it('archives the real project with explicit manual distribution signing', () => {
    expect(fastfile).toContain('File.join(IOS_ROOT, "App", "App.xcodeproj")');
    expect(archiveLane).toContain('project: XCODE_PROJECT');
    expect(archiveLane).not.toContain('workspace:');
    expect(archiveLane).toContain('CODE_SIGN_STYLE');
    expect(archiveLane).toContain('"Manual"');
    expect(archiveLane).toContain('"Apple Distribution"');
    expect(archiveLane).toContain('PROVISIONING_PROFILE_SPECIFIER');
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
        '--expected-build-number',
        '42.1',
      ]),
    ).toEqual({
      ipa: 'UPR.ipa',
      report: 'report.json',
      expectedBundleId: 'com.example.app',
      expectedTeamId: 'TEAM123',
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
