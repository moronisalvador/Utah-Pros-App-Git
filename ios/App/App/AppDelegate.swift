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
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?
    private var privacyShield: UIView?

    private func showPrivacyShield() {
        guard let window else { return }

        if let privacyShield {
            window.bringSubviewToFront(privacyShield)
            return
        }

        let shield = UIView(frame: window.bounds)
        shield.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        shield.backgroundColor = .systemBackground
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
        privacyShield?.removeFromSuperview()
        privacyShield = nil
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
