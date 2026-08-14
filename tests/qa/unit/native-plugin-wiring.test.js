/**
 * ════════════════════════════════════════════════
 * FILE: native-plugin-wiring.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The app-local Swift plugins only work if four separate things line up: the
 *   Swift class exists, it is registered at launch, the file is listed in the
 *   Xcode project, and the JavaScript side asks for it by the same name. Any
 *   one of those being wrong produces a plugin that silently does nothing.
 *   This checks all four for every plugin we ship.
 *
 * DEPENDS ON:
 *   Internal:  ios/App/App/*.swift, ios/App/App.xcodeproj/project.pbxproj,
 *              src/lib/native{PhotoViewer,Share,DocPreview}.js
 *   Data:      reads → none (source text only)
 *
 * NOTES / GOTCHAS:
 *   - The pbxproj check is the one that matters most: a Swift file can exist on
 *     disk, compile locally in an IDE that auto-adds it, and still be missing
 *     from the classic project file — in which case CI builds an app without it.
 *     Each file needs FOUR entries (PBXBuildFile, PBXFileReference, group
 *     children, Sources phase).
 *   - Source-contract assertions: vitest runs `node` here, no simulator.
 *     Runtime behaviour was verified by hand on the iOS simulator.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const PBXPROJ = read('ios/App/App.xcodeproj/project.pbxproj');
const APP_VC = read('ios/App/App/AppViewController.swift');

const PLUGINS = [
  { jsName: 'NativePhotoViewer', swift: 'NativePhotoViewer.swift', cls: 'NativePhotoViewerPlugin', js: 'src/lib/nativePhotoViewer.js' },
  { jsName: 'NativeShare', swift: 'NativeShare.swift', cls: 'NativeSharePlugin', js: 'src/lib/nativeShare.js' },
  { jsName: 'NativeDocPreview', swift: 'NativeDocPreview.swift', cls: 'NativeDocPreviewPlugin', js: 'src/lib/nativeDocPreview.js' },
  { jsName: 'NativeCameraExperience', swift: 'NativeCameraExperience.swift', cls: 'NativeCameraExperiencePlugin', js: 'src/lib/nativeCamera.js' },
];

describe.each(PLUGINS)('$jsName is wired end to end', ({ jsName, swift, cls, js }) => {
  const source = read(`ios/App/App/${swift}`);

  it('declares the Capacitor bridge contract', () => {
    expect(source).toContain(`@objc(${cls})`);
    expect(source).toContain('CAPPlugin, CAPBridgedPlugin');
    // jsName is the string the JS side resolves — a mismatch is a silent no-op.
    expect(source).toContain(`public let jsName = "${jsName}"`);
    expect(source).toContain(`public let identifier = "${cls}"`);
  });

  it('is registered at launch', () => {
    expect(APP_VC).toContain(`registerPluginInstance(${cls}())`);
  });

  it('is listed in the Xcode project at all four insertion points', () => {
    // Asserted structurally rather than by counting the filename — it appears
    // twice inside a single PBXBuildFile line (once as the comment, once in the
    // fileRef comment), so a raw count is misleading.
    const esc = swift.replace('.', '\\.');

    // 1. PBXBuildFile declaration
    expect(PBXPROJ, `${swift}: missing PBXBuildFile`)
      .toMatch(new RegExp(`\\/\\* ${esc} in Sources \\*\\/ = \\{isa = PBXBuildFile`));
    // 2. PBXFileReference declaration
    expect(PBXPROJ, `${swift}: missing PBXFileReference`)
      .toMatch(new RegExp(`= \\{isa = PBXFileReference;[^}]*path = ${esc};`));
    // 3. listed in the group so it shows in the Xcode navigator
    expect(PBXPROJ, `${swift}: missing from group children`)
      .toMatch(new RegExp(`^\\s+[A-F0-9]{24} \\/\\* ${esc} \\*\\/,$`, 'm'));
    // 4. compiled — membership in the Sources build phase (the one that,
    //    if missing, produces an app silently lacking the plugin)
    expect(PBXPROJ, `${swift}: NOT in the Sources build phase`)
      .toMatch(new RegExp(`^\\s+[A-F0-9]{24} \\/\\* ${esc} in Sources \\*\\/,$`, 'm'));
  });

  it('the JS side registers the SAME name and feature-detects it', () => {
    const bridge = read(js);
    expect(bridge).toContain(`registerPlugin('${jsName}')`);
    expect(bridge).toContain(`Capacitor.isPluginAvailable('${jsName}')`);
    // An older installed binary must degrade, never throw.
    expect(bridge).toContain('Capacitor.isNativePlatform()');
    expect(bridge).toMatch(/catch \{\s*return false;/);
  });
});

describe('overlay presentation must not unmount the web view', () => {
  // .fullScreen removes the WKWebView from the hierarchy, which fires
  // visibilitychange:hidden into the SPA and tears down live state underneath
  // (sim-reproduced 2026-08-07: it closed the conversation behind the viewer).
  it.each([
    ['NativePhotoViewer.swift'],
    ['NativeDocPreview.swift'],
    ['NativeCameraExperience.swift'],
  ])('%s presents .overFullScreen, never .fullScreen', (file) => {
    const source = read(`ios/App/App/${file}`);
    expect(source).toContain('.overFullScreen');
    expect(source).not.toMatch(/modalPresentationStyle\s*=\s*\.fullScreen/);
  });
});

describe('camera zoom is hardware-derived and lens-switching', () => {
  const source = read('ios/App/App/NativeCameraExperience.swift');

  it('back camera prefers the virtual multi-lens devices, wide as fallback', () => {
    // Virtual devices are what make pinch/buttons switch physical lenses as
    // videoZoomFactor crosses the switch-over factors. Order must be most
    // capable first, plain wide angle last. Scoped to the backTypes array —
    // the front camera legitimately uses builtInWideAngleCamera elsewhere.
    const chain = source.match(/backTypes: \[AVCaptureDevice\.DeviceType\] = \[([\s\S]*?)\]/)?.[1] ?? '';
    const order = ['builtInTripleCamera', 'builtInDualWideCamera', 'builtInDualCamera', 'builtInWideAngleCamera'];
    const positions = order.map((t) => chain.indexOf(`.${t}`));
    positions.forEach((pos, i) => {
      expect(pos, `${order[i]} missing from the back-camera fallback chain`).toBeGreaterThan(-1);
    });
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('zoom buttons come from the device, never a per-model table', () => {
    expect(source).toContain('virtualDeviceSwitchOverVideoZoomFactors');
    expect(source).toContain('displayVideoZoomFactorMultiplier'); // iOS 18+ display mapping
    // A hardcoded device-model lookup is the trap this contract bans.
    expect(source).not.toMatch(/iPhone1?[0-9],[0-9]/);
  });

  it('zoom writes are clamped and inside lockForConfiguration', () => {
    // Out-of-range videoZoomFactor throws NSRangeException at runtime.
    expect(source).toContain('minAvailableVideoZoomFactor');
    expect(source).toContain('maxAvailableVideoZoomFactor');
    expect(source).toContain('lockForConfiguration()');
    expect(source).toContain('ramp(toVideoZoomFactor:');
  });

  it('pinch gesture drives the same clamped zoom path', () => {
    expect(source).toContain('UIPinchGestureRecognizer');
  });

  it('opens at the wide 1x, not the ultra-wide base of a virtual device', () => {
    // A triple/dual-wide device starts at factor 1.0 = 0.5x field of view;
    // normalizing to the displayed-1x factor keeps the photo buttons
    // capturing what they captured before zoom existed.
    expect(source).toMatch(/wideFactor: CGFloat = 1 \/ multiplier/);
  });

  it('the front camera stays a fixed wide angle', () => {
    expect(source).toMatch(/\.builtInWideAngleCamera, for: \.video, position: \.front/);
  });
});

describe('document preview downloads before previewing', () => {
  const source = read('ios/App/App/NativeDocPreview.swift');

  it('stages a local file — Quick Look cannot read a remote URL', () => {
    // Handing QLPreviewController an https URL shows a blank sheet with no error.
    expect(source).toContain('NSTemporaryDirectory()');
    expect(source).toContain('URLSession.shared.dataTask');
  });

  it('keeps the filename extension, which selects the renderer', () => {
    expect(source).toContain('previewFilename');
    expect(source).toContain('pathExtension');
  });

  it('cleans up the staged file on dismiss', () => {
    expect(source).toContain('removeItem(at: workDir)');
  });
});
