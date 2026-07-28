// ════════════════════════════════════════════════
// FILE: AppDelegate.swift
// ════════════════════════════════════════════════
//
// WHAT THIS DOES (plain language):
//   Boots the Capacitor iOS shell, forwards APNs and deep-link callbacks, and
//   covers the app with an opaque privacy shield before iOS captures an
//   app-switcher snapshot.
//
// DEPENDS ON:
//   Frameworks: UIKit, Capacitor
//   Data:       no business data; lifecycle-only UI and callback forwarding
//
// NOTES / GOTCHAS:
//   - Keep the privacy shield native. JavaScript can be suspended before it has
//     time to hide sensitive content during backgrounding.
//   - The shield protects app-switcher snapshots; it does not claim to disable
//     deliberate screenshots while the app is active.
// ════════════════════════════════════════════════
import UIKit
import WebKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?
    private var privacyShield: UIView?
    /// How long the shield takes to dissolve on foreground (RES-01).
    private static let shieldFadeDuration: TimeInterval = 0.18
    /// Hard backstop: the shield is force-removed after this even if the fade
    /// never completes. A stranded shield is an unusable app, so the timeout
    /// matters more than the animation.
    private static let shieldFadeTimeout: TimeInterval = 0.6

    /// Last appearance the web layer reported, captured while the app is live.
    ///
    /// `.systemBackground` follows the PHONE's light/dark setting, but the app
    /// runs its own theme (ThemeContext -> [data-theme] in index.css). A
    /// dark-themed app on a light-mode phone therefore flashed a white shield
    /// over dark content. Reading the real theme needs no plugin: the WebView is
    /// alive whenever the app is active, so ask then and reuse the answer when
    /// backgrounding, which is exactly when it is too late to ask.
    private var lastKnownAppearance: UIColor = .systemBackground

    private var bridgeWebView: WKWebView? {
        (window?.rootViewController as? CAPBridgeViewController)?.webView
    }

    /// Ask the web layer what theme it is showing and remember it.
    private func captureAppAppearance() {
        guard let webView = bridgeWebView else { return }
        webView.evaluateJavaScript(
            "document.documentElement.getAttribute('data-theme')"
        ) { [weak self] result, _ in
            guard let self else { return }
            // Anything unexpected keeps the previous value rather than guessing.
            guard let theme = result as? String else { return }
            switch theme {
            case "dark":  self.lastKnownAppearance = UIColor(red: 0.07, green: 0.07, blue: 0.08, alpha: 1)
            case "light": self.lastKnownAppearance = .white
            default:      break
            }
        }
    }

    private func showPrivacyShield() {
        guard let window else { return }

        if let privacyShield {
            // A re-show during a fade must cancel it, or the shield keeps
            // dissolving while the app sits in the switcher showing content.
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

    /// Remove the shield with a short dissolve instead of a hard cut (RES-01).
    ///
    /// The synchronous `removeFromSuperview()` this replaces produced the abrupt
    /// unmatched-appearance handoff the audit reproduced. The fade also gives the
    /// WebView a runloop turn to present a laid-out frame before it is revealed.
    ///
    /// Honours Reduce Motion, and force-removes on a timeout so a dropped
    /// animation callback can never strand an opaque view over the whole app.
    private func hidePrivacyShield() {
        guard let shield = privacyShield else { return }
        privacyShield = nil                      // no second hide can race this

        let finish = { [weak shield] in
            shield?.layer.removeAllAnimations()
            shield?.removeFromSuperview()
        }

        guard !UIAccessibility.isReduceMotionEnabled else { finish(); return }

        // One runloop turn so the revealed frame is laid out, not mid-paint.
        DispatchQueue.main.async {
            shield.layer.removeAllAnimations()
            UIView.animate(
                withDuration: Self.shieldFadeDuration,
                delay: 0,
                options: [.curveEaseOut, .beginFromCurrentState, .allowUserInteraction],
                animations: { shield.alpha = 0 },
                completion: { _ in finish() },
            )
        }

        // Backstop — runs regardless of whether the animation ever completed.
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.shieldFadeTimeout) {
            finish()
        }
    }

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Cover before the system captures the app-switcher snapshot.
        showPrivacyShield()
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Defensive repeat for lifecycle paths that skip or reorder callbacks.
        showPrivacyShield()
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        hidePrivacyShield()
        // Refresh the cached appearance while the WebView is alive, so the NEXT
        // background covers with a colour that matches the app's own theme.
        captureAppAppearance()
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        // APNs registration succeeded. Forward the device token to Capacitor's
        // PushNotifications plugin, which listens on this NotificationCenter name
        // and resolves the JS 'registration' event (src/lib/pushNotifications.js).
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // APNs registration failed. Forward the error to Capacitor's PushNotifications
        // plugin, which resolves the JS 'registrationError' event.
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
