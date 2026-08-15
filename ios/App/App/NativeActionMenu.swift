/**
 * ════════════════════════════════════════════════
 * FILE: NativeActionMenu.swift
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Shows Apple's own pop-up action menu (the sheet of choices that slides up
 *   from the bottom of an iPhone screen) from inside the app. The web app
 *   tells it which choices to list; the tech taps one and the answer goes
 *   back to the web app, which does the actual work. Built for the Messages
 *   composer's [+] button, but generic — any surface can present a menu.
 *
 * Exports (to JS via Capacitor):
 *   NativeActionMenu.present({ title?, items, cancelTitle?, x?, y?, width?, height? })
 *     items: [{ id, title, checked?, destructive?, disabled? }]
 *     → resolves { selected: "<item id>" } — the key is ABSENT on cancel,
 *       so the JS side reads it as null. Never rejects on cancel.
 *
 * DEPENDS ON:
 *   Packages:  Capacitor (bridge), UIKit
 *   Internal:  registered by AppViewController.capacitorDidLoad();
 *              JS side: src/lib/nativeActionMenu.js
 *   Data:      reads  → none   writes → none (pure UI)
 *
 * NOTES / GOTCHAS:
 *   - UIAlertController manages its own presentation; never force a
 *     full-screen presentation style on it (that unmounts the WKWebView and
 *     fires visibilitychange:hidden into the SPA — motion-standard.md §6).
 *   - iPad presents an action sheet as a popover, which THROWS without an
 *     anchor. x/y/width/height are the trigger's viewport rect in CSS px
 *     (== points, the webview is full-bleed); fallback is the screen centre.
 *   - `checked` renders as a leading ✓ on the item title (public API only —
 *     UIAlertAction's image/checked KVC setters are private and an App Store
 *     rejection risk).
 *   - Resolves exactly once, guarded by `resolved` — tapping outside a
 *     popover fires the cancel action's handler, so cancel and outside-tap
 *     share one path.
 * ════════════════════════════════════════════════
 */
import UIKit
import Capacitor

@objc(NativeActionMenuPlugin)
public class NativeActionMenuPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeActionMenuPlugin"
    public let jsName = "NativeActionMenu"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "present", returnType: CAPPluginReturnPromise),
    ]

    @objc func present(_ call: CAPPluginCall) {
        let items = (call.getArray("items") ?? []).compactMap { $0 as? JSObject }
        guard !items.isEmpty else {
            call.reject("items required")
            return
        }
        let title = call.getString("title")
        let cancelTitle = call.getString("cancelTitle") ?? "Cancel"

        DispatchQueue.main.async { [weak self] in
            guard let self, let presenter = self.bridge?.viewController else {
                call.reject("no presenting view controller")
                return
            }

            let sheet = UIAlertController(title: title, message: nil, preferredStyle: .actionSheet)

            var resolved = false
            let finish: (String?) -> Void = { id in
                guard !resolved else { return }
                resolved = true
                if let id {
                    call.resolve(["selected": id])
                } else {
                    call.resolve([:]) // cancel — JS reads the absent key as null
                }
            }

            for item in items {
                guard let id = item["id"] as? String,
                      let label = item["title"] as? String else { continue }
                let checked = (item["checked"] as? Bool) ?? false
                let destructive = (item["destructive"] as? Bool) ?? false
                let action = UIAlertAction(
                    title: checked ? "✓ \(label)" : label,
                    style: destructive ? .destructive : .default
                ) { _ in finish(id) }
                action.isEnabled = !((item["disabled"] as? Bool) ?? false)
                sheet.addAction(action)
            }
            sheet.addAction(UIAlertAction(title: cancelTitle, style: .cancel) { _ in finish(nil) })

            if let popover = sheet.popoverPresentationController {
                popover.sourceView = presenter.view
                let x = call.getDouble("x") ?? Double(presenter.view.bounds.midX)
                let y = call.getDouble("y") ?? Double(presenter.view.bounds.midY)
                let w = call.getDouble("width") ?? 1
                let h = call.getDouble("height") ?? 1
                popover.sourceRect = CGRect(x: x, y: y, width: max(w, 1), height: max(h, 1))
                popover.permittedArrowDirections = [.up, .down]
            }

            presenter.present(sheet, animated: true)
        }
    }
}
