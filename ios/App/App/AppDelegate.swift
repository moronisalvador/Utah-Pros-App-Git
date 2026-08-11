// ════════════════════════════════════════════════
// FILE: AppDelegate.swift
// ════════════════════════════════════════════════
//
// WHAT THIS DOES (plain language):
//   Starts the Capacitor iOS shell and forwards APNs plus fallback deep-link
//   callbacks. SceneDelegate owns each visible window and its privacy shield.
//
// DEPENDS ON:
//   Frameworks: UIKit, Capacitor
//   Data:       no business data; lifecycle-only UI and callback forwarding
//
// NOTES / GOTCHAS:
//   - Scene callbacks own visible-window lifecycle on iOS 13 and newer. Keep
//     URL forwarding here as a fallback for non-scene delivery paths.
// ════════════════════════════════════════════════
import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
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
