/**
 * ════════════════════════════════════════════════
 * FILE: AppViewController.swift
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The app's main screen controller. It is the stock Capacitor web view
 *   with one addition: it registers our app-local native plugins (the photo
 *   viewer, the share sheet and the document previewer) so the web app can
 *   call them.
 *
 * DEPENDS ON:
 *   Packages:  Capacitor, UIKit
 *   Internal:  NativePhotoViewer.swift, NativeShare.swift,
 *              NativeDocPreview.swift; Main.storyboard points its view
 *              controller here (customClass="AppViewController").
 *
 * NOTES / GOTCHAS:
 *   - capacitorDidLoad() is Capacitor's documented hook for registering
 *     plugin INSTANCES that live inside the app target (as opposed to
 *     pod/SPM plugins, which auto-register).
 * ════════════════════════════════════════════════
 */
import UIKit
import Capacitor

class AppViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(NativePhotoViewerPlugin())
        bridge?.registerPluginInstance(NativeSharePlugin())
        bridge?.registerPluginInstance(NativeDocPreviewPlugin())
        bridge?.registerPluginInstance(NativeCameraExperiencePlugin())
    }
}
