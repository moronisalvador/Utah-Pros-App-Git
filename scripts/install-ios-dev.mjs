/**
 * ════════════════════════════════════════════════
 * FILE: scripts/install-ios-dev.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   One command that puts the UPR Dev app on the owner's iPhone: builds the
 *   dev web bundle, compiles the "UPR Dev" scheme with the stable Xcode
 *   command-line toolchain, then installs and launches it on the connected
 *   phone over Wi-Fi or cable.
 *
 * DEPENDS ON:
 *   Platform:  xcodebuild + xcrun devicectl (xcode-select toolchain), npm
 *   Internal:  scripts/build-native.mjs (via npm run build:ios:dev),
 *              ios/App/App.xcodeproj ("UPR Dev" scheme, Dev configuration)
 *   Data:      reads  → source tree, connected-device list
 *              writes → ios/build/devapp/ (gitignored)
 *
 * NOTES / GOTCHAS:
 *   - Deliberately uses the CLI toolchain, NEVER the Xcode GUI: the GUI on
 *     this Mac is the Xcode 27 beta, whose iOS 27 SDK traps the app at launch
 *     (see docs/mobile/dev-app-variant.md caveats).
 *   - Device selection: single connected physical device is auto-picked;
 *     set UPR_DEV_DEVICE_UDID to disambiguate when several are connected.
 *   - Signing is automatic under the paid team; first run on a new device
 *     may need the phone unlocked and the developer trusted.
 * ════════════════════════════════════════════════
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const derivedData = path.join('ios', 'build', 'devapp');
const appPath = path.join(derivedData, 'Build', 'Products', 'Dev-iphoneos', 'App.app');
const BUNDLE_ID = 'com.utahprosrestoration.upr.dev';

function run(label, command, args, opts = {}) {
  console.log(`\n▸ ${label}`);
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    stdio: opts.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    console.error(`${label} failed (exit ${result.status}).`);
    process.exit(result.status ?? 1);
  }
  return result.stdout ?? '';
}

function pickDevice() {
  const override = (process.env.UPR_DEV_DEVICE_UDID || '').trim();
  if (override) return override;
  const listing = run('Finding connected iPhone', 'xcrun', ['devicectl', 'list', 'devices'], { capture: true });
  const uuidPattern = /[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/i;
  const physical = listing
    .split('\n')
    .filter((line) => line.includes('physical') && line.includes('connected'))
    .map((line) => line.match(uuidPattern)?.[0])
    .filter(Boolean);
  if (physical.length === 0) {
    console.error('No connected physical iPhone found. Plug in or join the same Wi-Fi, unlock the phone, then retry.');
    process.exit(1);
  }
  if (physical.length > 1) {
    console.error(`Multiple physical devices connected (${physical.join(', ')}). Set UPR_DEV_DEVICE_UDID to choose one.`);
    process.exit(1);
  }
  return physical[0];
}

run('Building dev web bundle (dev origin, sandbox push)', 'npm', ['run', 'build:ios:dev']);
run('Compiling UPR Dev with the stable CLI toolchain', 'xcodebuild', [
  '-project', 'ios/App/App.xcodeproj',
  '-scheme', 'UPR Dev',
  '-destination', 'generic/platform=iOS',
  '-derivedDataPath', derivedData,
  '-allowProvisioningUpdates',
  'build',
]);
const device = pickDevice();
run('Installing on the phone', 'xcrun', ['devicectl', 'device', 'install', 'app', '--device', device, appPath]);
run('Launching UPR Dev', 'xcrun', ['devicectl', 'device', 'process', 'launch', '--device', device, BUNDLE_ID]);
console.log('\n✓ UPR Dev is installed and running.');
