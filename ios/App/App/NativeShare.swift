/**
 * ════════════════════════════════════════════════
 * FILE: NativeShare.swift
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Opens Apple's own share sheet from inside the iPhone app. A tech can save
 *   a job photo straight to their Photos library, AirDrop it, text it, or send
 *   a PDF to another app — the same sheet they get everywhere else on iOS,
 *   with all their usual destinations already in it. The web app can't do
 *   this; it only exists inside the installed app.
 *
 * Exports (to JS via Capacitor):
 *   NativeShare.share({ url?, text?, title?, x?, y? })
 *     → resolves { completed: Bool, activity: String? } once the sheet closes.
 *       `url` is downloaded to a temp file first so the sheet offers real
 *       actions ("Save Image") instead of just "Copy Link".
 *
 * DEPENDS ON:
 *   Packages:  Capacitor (bridge), UIKit
 *   Internal:  registered by AppViewController.capacitorDidLoad()
 *   Data:      reads  → the URL it is handed (signed/public HTTPS)
 *              writes → one file in NSTemporaryDirectory(), deleted after the
 *                       sheet closes
 *
 * NOTES / GOTCHAS:
 *   - iPad REQUIRES a popover anchor; without one UIActivityViewController
 *     throws. The optional x/y pin it to the tapped control, and we fall back
 *     to the screen centre so it can never crash.
 *   - The temp file keeps the real filename+extension from the URL. iOS picks
 *     the available actions from that extension, so a stripped name silently
 *     loses "Save Image".
 *   - The JS side feature-detects this plugin, so an older installed binary
 *     without it degrades to the web behaviour.
 * ════════════════════════════════════════════════
 */
import UIKit
import Capacitor

@objc(NativeSharePlugin)
public class NativeSharePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeSharePlugin"
    public let jsName = "NativeShare"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "share", returnType: CAPPluginReturnPromise),
    ]

    @objc func share(_ call: CAPPluginCall) {
        let text = call.getString("text")
        let title = call.getString("title")
        let urlString = call.getString("url")

        // Nothing to share is a caller bug, not a user-facing state.
        guard urlString != nil || text != nil else {
            call.reject("url or text required")
            return
        }

        guard let remote = urlString.flatMap({ URL(string: $0) }) else {
            presentSheet(items: [text].compactMap { $0 }, tempFile: nil, call: call)
            return
        }

        // Download first. Handing UIActivityViewController a remote URL offers
        // only "Copy Link"; handing it a local file offers Save Image / Save to
        // Files / Print — which is the whole point of the feature.
        let task = URLSession.shared.dataTask(with: remote) { [weak self] data, _, error in
            guard let self else { return }
            guard let data, error == nil else {
                DispatchQueue.main.async { call.reject("download failed") }
                return
            }
            let name = Self.safeFilename(from: remote)
            let dest = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(name)
            do {
                try data.write(to: dest, options: .atomic)
            } catch {
                DispatchQueue.main.async { call.reject("could not stage file") }
                return
            }
            var items: [Any] = [dest]
            if let text { items.append(text) }
            DispatchQueue.main.async {
                self.presentSheet(items: items, tempFile: dest, call: call, title: title)
            }
        }
        task.resume()
    }

    // MARK: - Helpers

    /// Last path component, sanitised, with a sensible fallback extension.
    /// The extension is load-bearing — iOS derives the offered actions from it.
    static func safeFilename(from url: URL) -> String {
        let raw = url.deletingPathExtension().lastPathComponent
        let ext = url.pathExtension.isEmpty ? "jpg" : url.pathExtension
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_ "))
        let cleaned = raw.unicodeScalars.filter { allowed.contains($0) }.map(String.init).joined()
        let base = cleaned.isEmpty ? "UPR-file" : String(cleaned.prefix(60))
        return "\(base).\(ext)"
    }

    private func presentSheet(items: [Any], tempFile: URL?, call: CAPPluginCall, title: String? = nil) {
        guard let presenter = bridge?.viewController else {
            call.reject("no presenting view controller")
            return
        }
        guard !items.isEmpty else {
            call.reject("nothing to share")
            return
        }

        let sheet = UIActivityViewController(activityItems: items, applicationActivities: nil)
        if let title { sheet.setValue(title, forKey: "subject") }

        // iPad: a popover with no anchor throws. Pin to the tapped control when
        // the caller told us where it was, else the screen centre.
        if let popover = sheet.popoverPresentationController {
            popover.sourceView = presenter.view
            let x = call.getDouble("x") ?? Double(presenter.view.bounds.midX)
            let y = call.getDouble("y") ?? Double(presenter.view.bounds.midY)
            popover.sourceRect = CGRect(x: x, y: y, width: 1, height: 1)
            popover.permittedArrowDirections = [.any]
        }

        sheet.completionWithItemsHandler = { activity, completed, _, _ in
            if let tempFile { try? FileManager.default.removeItem(at: tempFile) }
            call.resolve([
                "completed": completed,
                "activity": activity?.rawValue ?? "",
            ])
        }

        presenter.present(sheet, animated: true)
    }
}
