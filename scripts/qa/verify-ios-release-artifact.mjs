/**
 * ════════════════════════════════════════════════
 * FILE: scripts/qa/verify-ios-release-artifact.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Rejects an iOS release artifact unless its identity, signing,
 *   provisioning, privacy manifest, push entitlement, encryption declaration,
 *   and build number match the release request. It emits a sanitized JSON
 *   evidence report only after every check passes.
 *
 * DEPENDS ON:
 *   Packages:  Node.js built-ins
 *   Platform:  macOS /usr/bin/codesign, security, plutil, unzip, ditto,
 *              and xcodebuild
 *   Data:      reads  → a signed IPA and optionally its source .xcarchive
 *              writes → one caller-selected JSON report and temporary files
 *
 * NOTES / GOTCHAS:
 *   - This script never uploads, deploys, signs, or contacts Apple.
 *   - The report omits certificates, profile contents, and signing secrets.
 *   - Manifest presence and structure are verified; truthfulness of Apple's
 *     collected-data declarations remains a separate privacy-owner review.
 * ════════════════════════════════════════════════
 */
import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  validateCapgoV2PublicKey,
} from '../lib/capgo-public-key.mjs';

const VALUE_ARGUMENTS = new Map([
  ['--archive', 'archive'],
  ['--ipa', 'ipa'],
  ['--report', 'report'],
  ['--expected-bundle-id', 'expectedBundleId'],
  ['--expected-team-id', 'expectedTeamId'],
  ['--expected-marketing-version', 'expectedMarketingVersion'],
  ['--expected-build-number', 'expectedBuildNumber'],
  ['--expected-release-variant', 'expectedReleaseVariant'],
  ['--expected-native-api-origin', 'expectedNativeApiOrigin'],
  ['--expected-native-ota-enabled', 'expectedNativeOtaEnabled'],
  ['--expected-native-push-enabled', 'expectedNativePushEnabled'],
  ['--expected-retire-dev-token', 'expectedRetireDevToken'],
  ['--expected-apns-environment', 'expectedApnsEnvironment'],
  ['--expected-release-sha', 'expectedReleaseSha'],
]);

const REQUIRED_ARGUMENTS = [
  'ipa',
  'report',
  'expectedBundleId',
  'expectedTeamId',
  'expectedMarketingVersion',
  'expectedBuildNumber',
];

const NATIVE_RELEASE_ARGUMENTS = [
  'expectedReleaseVariant',
  'expectedNativeApiOrigin',
  'expectedNativeOtaEnabled',
  'expectedNativePushEnabled',
  'expectedRetireDevToken',
  'expectedApnsEnvironment',
  'expectedReleaseSha',
];

export function parseVerifierArguments(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const key = VALUE_ARGUMENTS.get(argument);
    if (!key) {
      throw new Error(`Unknown verifier argument: ${argument}`);
    }

    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for verifier argument: ${argument}`);
    }

    parsed[key] = value;
    index += 1;
  }

  for (const key of REQUIRED_ARGUMENTS) {
    if (!parsed[key]) {
      throw new Error(`Missing required verifier argument: ${key}`);
    }
  }

  const nativeReleaseArgumentCount = NATIVE_RELEASE_ARGUMENTS.filter(
    (key) => parsed[key],
  ).length;
  if (
    nativeReleaseArgumentCount !== 0 &&
    nativeReleaseArgumentCount !== NATIVE_RELEASE_ARGUMENTS.length
  ) {
    throw new Error(
      'Native release verifier arguments must be provided as one complete set',
    );
  }
  if (
    nativeReleaseArgumentCount === NATIVE_RELEASE_ARGUMENTS.length &&
    !['true', 'false'].includes(parsed.expectedNativeOtaEnabled)
  ) {
    throw new Error(
      'expectedNativeOtaEnabled must be exactly true or false',
    );
  }
  if (
    nativeReleaseArgumentCount === NATIVE_RELEASE_ARGUMENTS.length &&
    !['true', 'false'].includes(parsed.expectedNativePushEnabled)
  ) {
    throw new Error(
      'expectedNativePushEnabled must be exactly true or false',
    );
  }
  if (
    nativeReleaseArgumentCount === NATIVE_RELEASE_ARGUMENTS.length &&
    !['true', 'false'].includes(parsed.expectedRetireDevToken)
  ) {
    throw new Error(
      'expectedRetireDevToken must be exactly true or false',
    );
  }

  return parsed;
}

export function assertSafeArchiveEntries(entries) {
  assertCondition(entries.length > 0, 'IPA contains no archive entries');

  for (const entry of entries) {
    const normalized = entry.replaceAll('\\', '/');
    const segments = normalized.split('/');
    assertCondition(!normalized.includes('\0'), 'IPA contains a NUL byte in an entry name');
    assertCondition(!path.posix.isAbsolute(normalized), 'IPA contains an absolute path');
    assertCondition(!segments.includes('..'), 'IPA contains a path traversal entry');
  }
}

export function validateNativeReleaseManifest(manifest, expected, label) {
  assertCondition(
    manifest && typeof manifest === 'object' && !Array.isArray(manifest),
    `${label} native release manifest is not an object`,
  );
  assertCondition(
    manifest.schemaVersion === 1,
    `${label} native release manifest schema is unsupported`,
  );
  assertCondition(
    manifest.variant === expected.variant,
    `${label} native release variant does not match`,
  );
  assertCondition(
    manifest.bundleIdentifier === expected.bundleIdentifier,
    `${label} native release bundle identifier does not match`,
  );
  assertCondition(
    manifest.apiOrigin === expected.apiOrigin,
    `${label} native API origin does not match`,
  );
  assertCondition(
    manifest.nativeOtaEnabled === expected.nativeOtaEnabled,
    `${label} native OTA mode does not match`,
  );
  assertCondition(
    manifest.nativePushEnabled === expected.nativePushEnabled,
    `${label} native Push mode does not match`,
  );
  assertCondition(
    manifest.retireDevToken === expected.retireDevToken,
    `${label} dev-token retirement mode does not match`,
  );
  assertCondition(
    manifest.apnsEnvironment === expected.apnsEnvironment,
    `${label} native APNs environment does not match`,
  );
  assertCondition(
    manifest.sourceCommit === expected.sourceCommit,
    `${label} native source commit does not match`,
  );
  return manifest;
}

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function requireFile(filePath, label) {
  assertCondition(existsSync(filePath), `${label} does not exist`);
  assertCondition(statSync(filePath).isFile(), `${label} is not a file`);
}

function requireDirectory(directoryPath, label) {
  assertCondition(existsSync(directoryPath), `${label} does not exist`);
  assertCondition(statSync(directoryPath).isDirectory(), `${label} is not a directory`);
}

function commandFailureText(result) {
  const combined = `${result.stderr || ''}\n${result.stdout || ''}`.trim();
  return combined.slice(0, 1200) || 'no diagnostic output';
}

function runCommand(command, args, label) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });

  if (result.error) {
    throw new Error(`${label} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `${label} exited ${result.status}: ${commandFailureText(result)}`,
    );
  }

  return result;
}

function readPlistJson(plistPath, label) {
  const result = runCommand(
    '/usr/bin/plutil',
    ['-convert', 'json', '-o', '-', plistPath],
    `read ${label}`,
  );

  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`${label} could not be decoded as a property list`);
  }
}

function readPlistJsonKey(plistPath, keyPath, label) {
  const result = runCommand(
    '/usr/bin/plutil',
    ['-extract', keyPath, 'json', '-o', '-', plistPath],
    `read ${label}`,
  );

  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`${label} could not be decoded as JSON`);
  }
}

function readPlistRawKey(plistPath, keyPath, label) {
  return runCommand(
    '/usr/bin/plutil',
    ['-extract', keyPath, 'raw', '-o', '-', plistPath],
    `read ${label}`,
  ).stdout.trim();
}

function plistHasKey(plistPath, keyPath) {
  const result = spawnSync(
    '/usr/bin/plutil',
    ['-type', keyPath, plistPath],
    {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    },
  );

  if (result.error) {
    throw new Error(
      `inspect provisioning profile key failed to start: ${result.error.message}`,
    );
  }
  return result.status === 0;
}

function extractPlistXml(result, label) {
  const combined = `${result.stdout || ''}\n${result.stderr || ''}`;
  const xmlStart = combined.indexOf('<?xml');
  const plistStart = combined.indexOf('<plist');
  const start = xmlStart >= 0 ? xmlStart : plistStart;
  const end = combined.lastIndexOf('</plist>');

  assertCondition(start >= 0 && end > start, `${label} did not return a plist`);
  return combined.slice(start, end + '</plist>'.length);
}

function readSignedEntitlements(appPath, temporaryDirectory, label) {
  const result = runCommand(
    '/usr/bin/codesign',
    ['--display', '--entitlements', ':-', '--xml', appPath],
    `read ${label} signed entitlements`,
  );
  const entitlementsPath = path.join(
    temporaryDirectory,
    `${label}-signed-entitlements.plist`,
  );
  writeFileSync(entitlementsPath, extractPlistXml(result, `${label} entitlements`));
  return readPlistJson(entitlementsPath, `${label} signed entitlements`);
}

function readProvisioningProfile(appPath, temporaryDirectory, label) {
  const embeddedProfilePath = path.join(appPath, 'embedded.mobileprovision');
  requireFile(embeddedProfilePath, `${label} embedded provisioning profile`);

  const result = runCommand(
    '/usr/bin/security',
    ['cms', '-D', '-i', embeddedProfilePath],
    `decode ${label} provisioning profile`,
  );
  const decodedProfilePath = path.join(
    temporaryDirectory,
    `${label}-provisioning-profile.plist`,
  );
  writeFileSync(decodedProfilePath, result.stdout);

  return {
    Entitlements: readPlistJsonKey(
      decodedProfilePath,
      'Entitlements',
      `${label} provisioning entitlements`,
    ),
    TeamIdentifier: readPlistJsonKey(
      decodedProfilePath,
      'TeamIdentifier',
      `${label} provisioning team identifier`,
    ),
    ExpirationDate: readPlistRawKey(
      decodedProfilePath,
      'ExpirationDate',
      `${label} provisioning expiration`,
    ),
    ProvisionsAllDevices: plistHasKey(
      decodedProfilePath,
      'ProvisionsAllDevices',
    )
      ? readPlistJsonKey(
          decodedProfilePath,
          'ProvisionsAllDevices',
          `${label} all-device provisioning flag`,
        )
      : undefined,
    ProvisionedDevices: plistHasKey(decodedProfilePath, 'ProvisionedDevices')
      ? readPlistJsonKey(
          decodedProfilePath,
          'ProvisionedDevices',
          `${label} provisioned devices`,
        )
      : undefined,
  };
}

function requireNonEmptyString(value, label) {
  assertCondition(typeof value === 'string' && value.trim() !== '', `${label} is missing`);
  return value;
}

function findSingleApp(directoryPath, label) {
  requireDirectory(directoryPath, label);
  const candidates = readdirSync(directoryPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('.app'))
    .map((entry) => path.join(directoryPath, entry.name));

  assertCondition(candidates.length === 1, `${label} must contain exactly one .app`);
  return candidates[0];
}

export const EXPECTED_COLLECTED_DATA_TYPES = Object.freeze([
  'NSPrivacyCollectedDataTypeCustomerSupport',
  'NSPrivacyCollectedDataTypeDeviceID',
  'NSPrivacyCollectedDataTypeEmailAddress',
  'NSPrivacyCollectedDataTypeEmailsOrTextMessages',
  'NSPrivacyCollectedDataTypeName',
  'NSPrivacyCollectedDataTypeOtherFinancialInfo',
  'NSPrivacyCollectedDataTypeOtherUserContent',
  'NSPrivacyCollectedDataTypePhoneNumber',
  'NSPrivacyCollectedDataTypePhotosorVideos',
  'NSPrivacyCollectedDataTypePhysicalAddress',
  'NSPrivacyCollectedDataTypePreciseLocation',
  'NSPrivacyCollectedDataTypeUserID',
]);

export function validatePrivacyManifest(privacyManifest, label) {
  assertCondition(
    privacyManifest.NSPrivacyTracking === false,
    `${label} must explicitly disable tracking`,
  );
  assertCondition(
    Array.isArray(privacyManifest.NSPrivacyTrackingDomains),
    `${label} tracking domains must be an array`,
  );
  assertCondition(
    privacyManifest.NSPrivacyTrackingDomains.length === 0,
    `${label} cannot declare tracking domains while tracking is disabled`,
  );
  assertCondition(
    Array.isArray(privacyManifest.NSPrivacyCollectedDataTypes),
    `${label} collected data types must be an array`,
  );
  assertCondition(
    Array.isArray(privacyManifest.NSPrivacyAccessedAPITypes),
    `${label} accessed API types must be an array`,
  );

  const collectedTypes = privacyManifest.NSPrivacyCollectedDataTypes;
  const collectedTypeNames = collectedTypes
    .map((entry) => entry?.NSPrivacyCollectedDataType)
    .sort();
  assertCondition(
    JSON.stringify(collectedTypeNames) ===
      JSON.stringify(EXPECTED_COLLECTED_DATA_TYPES),
    `${label} collected data types do not match the reviewed disclosure`,
  );
  for (const entry of collectedTypes) {
    const type = entry.NSPrivacyCollectedDataType;
    assertCondition(
      entry.NSPrivacyCollectedDataTypeLinked === true,
      `${label} ${type} must be linked to identity`,
    );
    assertCondition(
      entry.NSPrivacyCollectedDataTypeTracking === false,
      `${label} ${type} cannot be used for tracking`,
    );
    assertCondition(
      Array.isArray(entry.NSPrivacyCollectedDataTypePurposes) &&
        entry.NSPrivacyCollectedDataTypePurposes.length === 1 &&
        entry.NSPrivacyCollectedDataTypePurposes[0] ===
          'NSPrivacyCollectedDataTypePurposeAppFunctionality',
      `${label} ${type} must be used only for app functionality`,
    );
  }

  const userDefaultsDeclaration = privacyManifest.NSPrivacyAccessedAPITypes.find(
    (entry) =>
      entry?.NSPrivacyAccessedAPIType ===
      'NSPrivacyAccessedAPICategoryUserDefaults',
  );
  assertCondition(
    Array.isArray(userDefaultsDeclaration?.NSPrivacyAccessedAPITypeReasons) &&
      userDefaultsDeclaration.NSPrivacyAccessedAPITypeReasons.includes('CA92.1'),
    `${label} must declare the reviewed UserDefaults reason CA92.1`,
  );

  return {
    tracking: privacyManifest.NSPrivacyTracking,
    trackingDomainCount: privacyManifest.NSPrivacyTrackingDomains.length,
    collectedDataTypeCount: privacyManifest.NSPrivacyCollectedDataTypes.length,
    accessedApiCategories: privacyManifest.NSPrivacyAccessedAPITypes.map(
      (entry) => entry.NSPrivacyAccessedAPIType,
    ).sort(),
  };
}

function validateReleaseApp({
  appPath,
  expectedBundleId,
  expectedTeamId,
  expectedMarketingVersion,
  expectedBuildNumber,
  expectedReleaseVariant,
  expectedNativeApiOrigin,
  expectedNativeOtaEnabled,
  expectedNativePushEnabled,
  expectedRetireDevToken,
  expectedApnsEnvironment,
  expectedReleaseSha,
  temporaryDirectory,
  label,
}) {
  requireDirectory(appPath, `${label} app`);

  runCommand(
    '/usr/bin/codesign',
    ['--verify', '--deep', '--strict', '--verbose=2', appPath],
    `verify ${label} code signature`,
  );

  const infoPath = path.join(appPath, 'Info.plist');
  const privacyPath = path.join(appPath, 'PrivacyInfo.xcprivacy');
  requireFile(infoPath, `${label} Info.plist`);
  requireFile(privacyPath, `${label} PrivacyInfo.xcprivacy`);

  let nativeRelease = null;
  let otaPublicKeySha256 = null;
  if (expectedReleaseVariant) {
    const nativeReleasePath = path.join(
      appPath,
      'public',
      'upr-native-release.json',
    );
    requireFile(nativeReleasePath, `${label} native release manifest`);
    let nativeReleaseManifest;
    try {
      nativeReleaseManifest = JSON.parse(
        readFileSync(nativeReleasePath, 'utf8'),
      );
    } catch {
      throw new Error(`${label} native release manifest is not valid JSON`);
    }
    nativeRelease = validateNativeReleaseManifest(
      nativeReleaseManifest,
      {
        variant: expectedReleaseVariant,
        bundleIdentifier: expectedBundleId,
        apiOrigin: expectedNativeApiOrigin,
        nativeOtaEnabled: expectedNativeOtaEnabled === 'true',
        nativePushEnabled: expectedNativePushEnabled === 'true',
        retireDevToken: expectedRetireDevToken === 'true',
        apnsEnvironment: expectedApnsEnvironment,
        sourceCommit: expectedReleaseSha,
      },
      label,
    );

    const capacitorConfigPath = path.join(appPath, 'capacitor.config.json');
    requireFile(capacitorConfigPath, `${label} Capacitor configuration`);
    let nativeCapacitorConfig;
    try {
      nativeCapacitorConfig = JSON.parse(
        readFileSync(capacitorConfigPath, 'utf8'),
      );
    } catch {
      throw new Error(`${label} Capacitor configuration is not valid JSON`);
    }
    const updater = nativeCapacitorConfig?.plugins?.CapacitorUpdater;
    assertCondition(
      nativeCapacitorConfig.appId === expectedBundleId,
      `${label} Capacitor app identifier does not match`,
    );
    assertCondition(
      updater?.appId === expectedBundleId,
      `${label} updater app identifier does not match`,
    );
    assertCondition(
      updater?.autoUpdate === (expectedNativeOtaEnabled === 'true'),
      `${label} updater auto-update mode does not match`,
    );
    assertCondition(
      updater?.directUpdate === false,
      `${label} updater direct-update mode must remain disabled`,
    );
    if (expectedNativeOtaEnabled === 'true') {
      assertCondition(
        expectedReleaseVariant === 'dev',
        `${label} OTA-enabled release must use the isolated dev variant`,
      );
      assertCondition(
        updater.defaultChannel === 'upr-dev-canary',
        `${label} updater channel is not the isolated dev canary`,
      );
      assertCondition(
        updater.allowSetDefaultChannel === false
          && updater.allowModifyAppId === false
          && updater.allowModifyUrl === false,
        `${label} updater mutation controls are not locked`,
      );
      otaPublicKeySha256 = validateCapgoV2PublicKey(
        updater.publicKey,
        { label: `${label} updater public verification key` },
      ).sha256;
    } else {
      assertCondition(
        updater.publicKey === undefined
          && updater.defaultChannel === undefined,
        `${label} updater-off artifact must not contain Capgo key or channel material`,
      );
    }
  }

  const info = readPlistJson(infoPath, `${label} Info.plist`);
  const privacy = validatePrivacyManifest(
    readPlistJson(privacyPath, `${label} PrivacyInfo.xcprivacy`),
    `${label} PrivacyInfo.xcprivacy`,
  );
  const entitlements = readSignedEntitlements(appPath, temporaryDirectory, label);
  const profile = readProvisioningProfile(appPath, temporaryDirectory, label);
  const profileEntitlements = profile.Entitlements;

  assertCondition(
    info.CFBundleIdentifier === expectedBundleId,
    `${label} bundle identifier does not match the release request`,
  );
  assertCondition(
    String(info.CFBundleVersion) === expectedBuildNumber,
    `${label} build number does not match the release request`,
  );
  const version = requireNonEmptyString(
    info.CFBundleShortVersionString,
    `${label} marketing version`,
  );
  assertCondition(
    version === expectedMarketingVersion,
    `${label} marketing version does not match the release request`,
  );
  assertCondition(
    info.ITSAppUsesNonExemptEncryption === false,
    `${label} must declare ITSAppUsesNonExemptEncryption=false`,
  );

  for (const usageDescriptionKey of [
    'NSCameraUsageDescription',
    'NSPhotoLibraryUsageDescription',
    'NSPhotoLibraryAddUsageDescription',
    'NSLocationWhenInUseUsageDescription',
    // Apple ITMS-90683 (build 1.0.0 (1), 2026-07-29): the Capacitor geolocation
    // plugin references the Always API, so this purpose string must ship even
    // though the app only requests when-in-use.
    'NSLocationAlwaysAndWhenInUseUsageDescription',
    'NSFaceIDUsageDescription',
  ]) {
    requireNonEmptyString(
      info[usageDescriptionKey],
      `${label} ${usageDescriptionKey}`,
    );
  }

  const executableName = requireNonEmptyString(
    info.CFBundleExecutable,
    `${label} executable name`,
  );
  assertCondition(
    path.basename(executableName) === executableName,
    `${label} executable name is unsafe`,
  );
  requireFile(path.join(appPath, executableName), `${label} app executable`);

  const expectedApplicationIdentifier = `${expectedTeamId}.${expectedBundleId}`;
  assertCondition(
    entitlements['application-identifier'] === expectedApplicationIdentifier,
    `${label} signed application identifier does not match`,
  );
  assertCondition(
    entitlements['com.apple.developer.team-identifier'] === expectedTeamId,
    `${label} signed team identifier does not match`,
  );
  assertCondition(
    entitlements['aps-environment'] === 'production',
    `${label} push entitlement is not production`,
  );
  assertCondition(
    entitlements['get-task-allow'] === false ||
      entitlements['get-task-allow'] === undefined,
    `${label} is debug-signable`,
  );

  assertCondition(
    profileEntitlements &&
      typeof profileEntitlements === 'object' &&
      !Array.isArray(profileEntitlements),
    `${label} provisioning profile entitlements are missing`,
  );
  assertCondition(
    profileEntitlements['application-identifier'] === expectedApplicationIdentifier,
    `${label} provisioning application identifier does not match`,
  );
  assertCondition(
    profileEntitlements['aps-environment'] === 'production',
    `${label} provisioning push environment is not production`,
  );
  assertCondition(
    profileEntitlements['get-task-allow'] === false,
    `${label} provisioning profile permits debugging`,
  );
  assertCondition(
    Array.isArray(profile.TeamIdentifier) &&
      profile.TeamIdentifier.includes(expectedTeamId),
    `${label} provisioning team identifier does not match`,
  );
  assertCondition(
    profile.ProvisionsAllDevices !== true &&
      !Array.isArray(profile.ProvisionedDevices),
    `${label} is not using an App Store distribution profile`,
  );

  const expirationTimestamp = Date.parse(profile.ExpirationDate);
  assertCondition(
    Number.isFinite(expirationTimestamp) && expirationTimestamp > Date.now(),
    `${label} provisioning profile is expired or has no valid expiration`,
  );

  return {
    bundleIdentifier: info.CFBundleIdentifier,
    version,
    buildNumber: String(info.CFBundleVersion),
    teamIdentifier: expectedTeamId,
    pushEnvironment: entitlements['aps-environment'],
    debugSigningAllowed: false,
    nonExemptEncryption: info.ITSAppUsesNonExemptEncryption,
    privacy,
    nativeRelease,
    otaPublicKeySha256,
  };
}

function compareAppSummaries(archiveSummary, ipaSummary) {
  for (const key of [
    'bundleIdentifier',
    'version',
    'buildNumber',
    'teamIdentifier',
    'pushEnvironment',
    'debugSigningAllowed',
    'nonExemptEncryption',
  ]) {
    assertCondition(
      archiveSummary[key] === ipaSummary[key],
      `Archive and IPA differ for ${key}`,
    );
  }

  assertCondition(
    JSON.stringify(archiveSummary.privacy) === JSON.stringify(ipaSummary.privacy),
    'Archive and IPA privacy manifests differ',
  );
  assertCondition(
    JSON.stringify(archiveSummary.nativeRelease) ===
      JSON.stringify(ipaSummary.nativeRelease),
    'Archive and IPA native release manifests differ',
  );
  assertCondition(
    archiveSummary.otaPublicKeySha256 === ipaSummary.otaPublicKeySha256,
    'Archive and IPA OTA public-key fingerprints differ',
  );
}

async function sha256File(filePath) {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

async function verifyReleaseArtifact(rawArguments) {
  assertCondition(process.platform === 'darwin', 'iOS artifact verification requires macOS');
  const argumentsMap = parseVerifierArguments(rawArguments);
  const ipaPath = path.resolve(argumentsMap.ipa);
  const reportPath = path.resolve(argumentsMap.report);
  const archivePath = argumentsMap.archive
    ? path.resolve(argumentsMap.archive)
    : null;
  requireFile(ipaPath, 'IPA');

  const temporaryDirectory = mkdtempSync(
    path.join(tmpdir(), 'upr-ios-release-verification-'),
  );

  try {
    runCommand('/usr/bin/unzip', ['-tqq', ipaPath], 'test IPA archive');
    const archiveEntries = runCommand(
      '/usr/bin/unzip',
      ['-Z1', ipaPath],
      'list IPA archive',
    ).stdout
      .split(/\r?\n/)
      .filter(Boolean);
    assertSafeArchiveEntries(archiveEntries);

    const ipaExtractionDirectory = path.join(temporaryDirectory, 'ipa');
    mkdirSync(ipaExtractionDirectory);
    runCommand(
      '/usr/bin/ditto',
      ['-x', '-k', ipaPath, ipaExtractionDirectory],
      'extract IPA',
    );

    const ipaAppPath = findSingleApp(
      path.join(ipaExtractionDirectory, 'Payload'),
      'IPA Payload',
    );
    const validationInputs = {
      expectedBundleId: argumentsMap.expectedBundleId,
      expectedTeamId: argumentsMap.expectedTeamId,
      expectedMarketingVersion: argumentsMap.expectedMarketingVersion,
      expectedBuildNumber: argumentsMap.expectedBuildNumber,
      expectedReleaseVariant: argumentsMap.expectedReleaseVariant,
      expectedNativeApiOrigin: argumentsMap.expectedNativeApiOrigin,
      expectedNativeOtaEnabled: argumentsMap.expectedNativeOtaEnabled,
      expectedNativePushEnabled: argumentsMap.expectedNativePushEnabled,
      expectedRetireDevToken: argumentsMap.expectedRetireDevToken,
      expectedApnsEnvironment: argumentsMap.expectedApnsEnvironment,
      expectedReleaseSha: argumentsMap.expectedReleaseSha,
      temporaryDirectory,
    };
    const ipaSummary = validateReleaseApp({
      ...validationInputs,
      appPath: ipaAppPath,
      label: 'ipa',
    });

    if (archivePath) {
      requireDirectory(archivePath, 'xcarchive');
      const archiveAppPath = findSingleApp(
        path.join(archivePath, 'Products', 'Applications'),
        'xcarchive Products/Applications',
      );
      const archiveSummary = validateReleaseApp({
        ...validationInputs,
        appPath: archiveAppPath,
        label: 'archive',
      });
      compareAppSummaries(archiveSummary, ipaSummary);
    }

    const xcodeVersion = runCommand(
      '/usr/bin/xcodebuild',
      ['-version'],
      'read Xcode version',
    ).stdout.trim().split(/\r?\n/);
    const report = {
      schemaVersion: 1,
      verifiedAt: new Date().toISOString(),
      sourceCommit:
        ipaSummary.nativeRelease?.sourceCommit ||
        process.env.GITHUB_SHA ||
        null,
      artifact: {
        fileName: path.basename(ipaPath),
        sha256: await sha256File(ipaPath),
        archiveCrossChecked: Boolean(archivePath),
      },
      identity: {
        bundleIdentifier: ipaSummary.bundleIdentifier,
        teamIdentifier: ipaSummary.teamIdentifier,
        version: ipaSummary.version,
        buildNumber: ipaSummary.buildNumber,
      },
      security: {
        codeSignatureVerified: true,
        provisioningProfileVerified: true,
        debugSigningAllowed: ipaSummary.debugSigningAllowed,
        pushEnvironment: ipaSummary.pushEnvironment,
        nonExemptEncryption: ipaSummary.nonExemptEncryption,
      },
      privacy: {
        manifestBundled: true,
        ...ipaSummary.privacy,
      },
      nativeRelease: ipaSummary.nativeRelease,
      otaPublicKeySha256: ipaSummary.otaPublicKeySha256,
      toolchain: {
        xcode: xcodeVersion,
        node: process.version,
      },
    };

    mkdirSync(path.dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
      mode: 0o600,
    });
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

const isDirectInvocation =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectInvocation) {
  verifyReleaseArtifact(process.argv.slice(2)).catch((error) => {
    console.error(`iOS release verification failed: ${error.message}`);
    process.exitCode = 1;
  });
}
