/**
 * ════════════════════════════════════════════════
 * FILE: NativeDocPreview.swift
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Opens a PDF or document in Apple's own Quick Look viewer inside the iPhone
 *   app — the same preview you get from Files or Mail. Techs use it for
 *   estimates, reports and work authorisations: pinch to zoom, scroll pages,
 *   and share straight from the viewer. The web app keeps its own PDF
 *   handling; this only exists inside the installed app.
 *
 * Exports (to JS via Capacitor):
 *   NativeDocPreview.present({ url, title? })
 *     → resolves when the preview is closed.
 *
 * DEPENDS ON:
 *   Packages:  Capacitor (bridge), UIKit, QuickLook
 *   Internal:  registered by AppViewController.capacitorDidLoad()
 *   Data:      reads  → the document URL it is handed (signed/public HTTPS)
 *              writes → one file in a temp subfolder, deleted on dismiss
 *
 * NOTES / GOTCHAS:
 *   - QUICK LOOK ONLY ACCEPTS A LOCAL FILE URL. Handing it an https URL shows
 *     a blank sheet with no error, so the document is always downloaded to a
 *     temp file first. The file EXTENSION decides the renderer, so the name is
 *     preserved (a .pdf saved without its extension previews as nothing).
 *   - Presented inside a UINavigationController wrapped .overFullScreen, NEVER
 *     .fullScreen: fullScreen unmounts the web view underneath, which fires
 *     visibilitychange:hidden into the SPA and makes it tear down live state
 *     (the same trap documented in NativePhotoViewer.swift).
 *   - QLPreviewController holds its data source weakly, so the controller that
 *     owns it must stay retained until dismiss — hence the wrapper class.
 * ════════════════════════════════════════════════
 */
import UIKit
import QuickLook
import Capacitor

// ─── SECTION: Preview host (owns the temp file + the data source) ────────────
final class NativeDocPreviewVC: UIViewController, QLPreviewControllerDataSource, QLPreviewControllerDelegate {
    private let fileURL: URL
    private let displayTitle: String?
    private let workDir: URL
    var onDismiss: (() -> Void)?
    private var didFinish = false

    init(fileURL: URL, workDir: URL, title: String?) {
        self.fileURL = fileURL
        self.workDir = workDir
        self.displayTitle = title
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        let preview = QLPreviewController()
        preview.dataSource = self
        preview.delegate = self
        if let displayTitle { preview.title = displayTitle }
        preview.navigationItem.leftBarButtonItem = UIBarButtonItem(
            barButtonSystemItem: .done, target: self, action: #selector(doneTapped))

        // Embed rather than present, so this wrapper stays alive as the
        // data source for the whole lifetime of the preview.
        let nav = UINavigationController(rootViewController: preview)
        addChild(nav)
        nav.view.frame = view.bounds
        nav.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(nav.view)
        nav.didMove(toParent: self)
    }

    @objc private func doneTapped() {
        dismiss(animated: true) { [weak self] in self?.finish() }
    }

    // Called on both the Done button and an interactive swipe-down dismiss;
    // guarded so the Capacitor call resolves exactly once.
    private func finish() {
        guard !didFinish else { return }
        didFinish = true
        try? FileManager.default.removeItem(at: workDir)
        onDismiss?()
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        if isBeingDismissed || presentingViewController == nil { finish() }
    }

    func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }

    func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
        fileURL as QLPreviewItem
    }
}

// ─── SECTION: Capacitor plugin ──────────────────────────────────────────────
@objc(NativeDocPreviewPlugin)
public class NativeDocPreviewPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeDocPreviewPlugin"
    public let jsName = "NativeDocPreview"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "present", returnType: CAPPluginReturnPromise),
    ]

    @objc func present(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"), let remote = URL(string: urlString) else {
            call.reject("url required")
            return
        }
        let title = call.getString("title")

        let task = URLSession.shared.dataTask(with: remote) { [weak self] data, response, error in
            guard let self else { return }
            guard let data, error == nil else {
                DispatchQueue.main.async { call.reject("download failed") }
                return
            }

            // Each preview gets its own temp folder so the filename can be kept
            // verbatim (it is what Quick Look reads the type from) without
            // colliding with a concurrent preview of a same-named document.
            let workDir = URL(fileURLWithPath: NSTemporaryDirectory())
                .appendingPathComponent("upr-preview-\(UUID().uuidString)")
            let name = Self.previewFilename(remote: remote, response: response)
            let dest = workDir.appendingPathComponent(name)
            do {
                try FileManager.default.createDirectory(at: workDir, withIntermediateDirectories: true)
                try data.write(to: dest, options: .atomic)
            } catch {
                DispatchQueue.main.async { call.reject("could not stage document") }
                return
            }

            DispatchQueue.main.async {
                guard let presenter = self.bridge?.viewController else {
                    try? FileManager.default.removeItem(at: workDir)
                    call.reject("no presenting view controller")
                    return
                }
                let host = NativeDocPreviewVC(fileURL: dest, workDir: workDir, title: title)
                // .overFullScreen — see the file header. .fullScreen would
                // unmount the web view and tear down SPA state underneath.
                host.modalPresentationStyle = .overFullScreen
                host.onDismiss = { call.resolve() }
                presenter.present(host, animated: true)
            }
        }
        task.resume()
    }

    // MARK: - Helpers

    /// Preserve the document's own filename and extension — Quick Look picks its
    /// renderer from the extension, and a name without one previews as blank.
    static func previewFilename(remote: URL, response: URLResponse?) -> String {
        if let suggested = response?.suggestedFilename,
           !suggested.isEmpty,
           !(suggested as NSString).pathExtension.isEmpty {
            return sanitize(suggested)
        }
        let last = remote.lastPathComponent
        if !last.isEmpty, !(last as NSString).pathExtension.isEmpty {
            return sanitize(last)
        }
        return "document.pdf"
    }

    private static func sanitize(_ name: String) -> String {
        let ns = name as NSString
        let ext = ns.pathExtension.isEmpty ? "pdf" : ns.pathExtension
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_ "))
        let base = ns.deletingPathExtension.unicodeScalars
            .filter { allowed.contains($0) }.map(String.init).joined()
        let safeBase = base.isEmpty ? "document" : String(base.prefix(60))
        return "\(safeBase).\(ext)"
    }
}
