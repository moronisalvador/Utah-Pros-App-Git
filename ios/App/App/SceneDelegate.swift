// ════════════════════════════════════════════════
// FILE: SceneDelegate.swift
// ════════════════════════════════════════════════
//
// WHAT THIS DOES (plain language):
//   Owns the app's visible iPhone window under Apple's current scene system.
//   It covers the window before it goes into the app switcher and removes that
//   cover only after the app is active again, so private job data is not shown
//   in the system preview.
//
// DEPENDS ON:
//   Packages:  UIKit, WebKit, Capacitor
//   Internal:  AppDelegate.swift, AppViewController.swift, Main.storyboard
//   Data:      no business data; window lifecycle and link forwarding only
//
// NOTES / GOTCHAS:
//   - Keep the shield native. The web app can be paused before it has time to
//     hide sensitive content while backgrounding.
//   - Main.storyboard creates this scene's AppViewController. Do not manually
//     replace the root controller here or Capacitor plugins will be bypassed.
//   - The shield protects app-switcher snapshots; it does not claim to disable
//     deliberate screenshots while the app is active.
// ════════════════════════════════════════════════
import UIKit
import WebKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    private var privacyShield: UIView?
    /// How long the shield takes to dissolve on foreground (RES-01).
    private static let shieldFadeDuration: TimeInterval = 0.18
    /// Hard backstop: a stranded shield makes the app unusable.
    private static let shieldFadeTimeout: TimeInterval = 0.6

    /// Last web appearance while the window is live. This prevents a white
    /// switcher flash when the app is dark but the phone itself is light.
    private var lastKnownAppearance: UIColor = .systemBackground

    private var bridgeWebView: WKWebView? {
        (window?.rootViewController as? CAPBridgeViewController)?.webView
    }

    // ─── SECTION: Scene lifecycle ──────────────

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        // The configured Main storyboard creates the window and Capacitor root.
        // Forward connection links too: cold starts use these scene options.
        forwardURLContexts(connectionOptions.urlContexts)
        for userActivity in connectionOptions.userActivities {
            forwardUserActivity(userActivity)
        }
    }

    func sceneWillResignActive(_ scene: UIScene) {
        // Cover before the system captures the app-switcher snapshot.
        showPrivacyShield()
    }

    func sceneDidEnterBackground(_ scene: UIScene) {
        // Defensive repeat for lifecycle paths that skip or reorder callbacks.
        showPrivacyShield()
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        hidePrivacyShield()
        // Capture while the WebView is live for the next background snapshot.
        captureAppAppearance()
    }

    // ─── SECTION: Capacitor link forwarding ──────────────

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        forwardURLContexts(URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        forwardUserActivity(userActivity)
    }

    private func forwardURLContexts(_ contexts: Set<UIOpenURLContext>) {
        for context in contexts {
            var options: [UIApplication.OpenURLOptionsKey: Any] = [:]
            if let sourceApplication = context.options.sourceApplication {
                options[.sourceApplication] = sourceApplication
            }
            if let annotation = context.options.annotation {
                options[.annotation] = annotation
            }
            options[.openInPlace] = context.options.openInPlace
            _ = ApplicationDelegateProxy.shared.application(
                UIApplication.shared,
                open: context.url,
                options: options
            )
        }
    }

    private func forwardUserActivity(_ userActivity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(
            UIApplication.shared,
            continue: userActivity,
            restorationHandler: { _ in }
        )
    }

    // ─── SECTION: Privacy shield ──────────────

    private func captureAppAppearance() {
        guard let webView = bridgeWebView else { return }
        webView.evaluateJavaScript(
            "document.documentElement.getAttribute('data-theme')"
        ) { [weak self] result, _ in
            guard let self, let theme = result as? String else { return }
            switch theme {
            case "dark":
                self.lastKnownAppearance = UIColor(red: 0.07, green: 0.07, blue: 0.08, alpha: 1)
            case "light":
                self.lastKnownAppearance = .white
            default:
                break
            }
        }
    }

    private func showPrivacyShield() {
        guard let window else { return }
        if let privacyShield {
            privacyShield.layer.removeAllAnimations()
            privacyShield.alpha = 1
            window.bringSubviewToFront(privacyShield)
            return
        }

        let shield = UIView(frame: window.bounds)
        shield.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        shield.backgroundColor = lastKnownAppearance
        shield.isUserInteractionEnabled = false
        shield.accessibilityIdentifier = "upr-privacy-shield"

        let mark = UILabel()
        mark.translatesAutoresizingMaskIntoConstraints = false
        mark.text = "UPR"
        mark.font = .systemFont(ofSize: 28, weight: .bold)
        mark.textColor = .secondaryLabel
        shield.addSubview(mark)
        NSLayoutConstraint.activate([
            mark.centerXAnchor.constraint(equalTo: shield.centerXAnchor),
            mark.centerYAnchor.constraint(equalTo: shield.centerYAnchor),
        ])

        window.addSubview(shield)
        privacyShield = shield
    }

    private func hidePrivacyShield() {
        guard let shield = privacyShield else { return }
        privacyShield = nil
        let finish = { [weak shield] in
            shield?.layer.removeAllAnimations()
            shield?.removeFromSuperview()
        }

        guard !UIAccessibility.isReduceMotionEnabled else { finish(); return }
        DispatchQueue.main.async {
            shield.layer.removeAllAnimations()
            UIView.animate(
                withDuration: Self.shieldFadeDuration,
                delay: 0,
                options: [.curveEaseOut, .beginFromCurrentState, .allowUserInteraction],
                animations: { shield.alpha = 0 },
                completion: { _ in finish() }
            )
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.shieldFadeTimeout) {
            finish()
        }
    }
}
