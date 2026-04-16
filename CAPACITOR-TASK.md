# CAPACITOR-TASK — Ship Tech App to iOS App Store

**Created:** 2026-04-16
**Goal:** Wrap the existing `/tech/*` React app in a Capacitor iOS shell, publish to TestFlight, then App Store. Keep the web app intact — the same codebase serves web admin and the native tech app.
**Future direction:** A native SwiftUI rewrite is planned post-launch for a fully fluid, native feel. This Capacitor build is the bridge — it ships fast, validates App Store workflow, and gets techs on a real native app while the Swift version is designed.

---

## Confirmed Decisions (2026-04-16)

- **Bundle ID:** `com.utahprosrestoration.upr`
- **Display name:** `UPR` (placeholder until a better app name is chosen)
- **App icon:** Custom, designed via Gemini (Moroni producing)
- **Push provider:** APNs direct (not OneSignal) — keeps customer data in-house, no third-party dependency
- **Live updates:** Yes, Capgo (free, OSS)
- **Native app audience:** ALL users (admins + techs) get the tech view on mobile. Admin views are browser-only. No role-based routing branches inside the native app.
- **Build machine:** Moroni's MacBook

---

## Strategy

The tech app (`/tech/*` routes) loads inside a native iOS WKWebView container provided by Capacitor. Admin pages (`/admin`, `/settings`, etc.) stay web-only — the native app only exposes the tech routes, regardless of the user's role. Admins who need admin functionality use the browser. The same `dev` branch builds both:
- `npm run build` → Cloudflare Pages (web, unchanged)
- `npm run build && npx cap sync ios` → native iOS app

**Everyone gets the tech view on mobile.** No role checks, no admin menu in the app. Simpler code, clearer product: mobile = field work, browser = admin.

**Critical constraint:** Apple requires the app to provide meaningful native value beyond a web wrapper (Guideline 4.2). We satisfy this by using native camera, push notifications, geolocation, haptics, and biometric auth — not just loading a URL.

---

## Phase 1 — Install Capacitor & iOS Scaffold

**Goal:** Get `npx cap run ios` opening the tech app in the iOS Simulator.

1. Install Capacitor core + iOS platform:
   ```
   npm i @capacitor/core @capacitor/ios @capacitor/cli
   ```
2. Initialize Capacitor config:
   ```
   npx cap init "UPR" com.utahprosrestoration.upr --web-dir=dist
   ```
3. Create `capacitor.config.json` with:
   - `appId: com.utahprosrestoration.upr`
   - `appName: UPR`
   - `webDir: dist`
   - `ios.contentInset: always`
   - `ios.backgroundColor: #ffffff`
   - `server.androidScheme: https` (future-proof even though we're iOS-only)
4. Build once, then add iOS platform:
   ```
   npm run build
   npx cap add ios
   ```
5. Verify `ios/App/App.xcworkspace` opens in Xcode (requires Mac).
6. Test in Simulator: `npx cap run ios`

**Completion check:** App boots, lands on `/login`, tech can log in and see TechDash.

---

## Phase 2 — Route the Native Shell to `/tech` (everyone)

**Goal:** Native app only ever shows tech routes. Admin routes don't exist here. Admins who log in on the app land on TechDash just like techs — they use the browser for admin work.

1. Add a `VITE_BUILD_TARGET` env var: `web` (default) vs `native`.
2. In `src/App.jsx`, when `VITE_BUILD_TARGET === 'native'`:
   - After successful login, redirect EVERY user to `/tech` regardless of role
   - Remove admin/settings/devtools routes from the router tree entirely — they don't render in native build
   - Lock navigation: `/login` → `/tech/*` only
3. Add build script to `package.json`:
   ```
   "build:ios": "VITE_BUILD_TARGET=native vite build && cap sync ios"
   ```
4. Add `Capacitor.isNativePlatform()` check in `AuthContext` to:
   - Skip loading admin-only permissions/feature-flags on native (optional, minor perf win)
   - Suppress any admin nav links even if a stray component renders one

**Completion check:** Log in as Moroni (admin) on the iOS app → lands on TechDash. No way to reach `/settings` or `/admin` inside the app. Open Safari on the same phone, log in as Moroni → full admin app works as before.

---

## Phase 3 — Native Camera (replace `<input capture>`)

**Goal:** Snap-first photo flow uses native camera API — faster, higher quality, no browser chrome.

1. Install:
   ```
   npm i @capacitor/camera
   npx cap sync ios
   ```
2. Create `src/lib/nativeCamera.js` wrapper:
   - `takePhoto()` → returns `{ blob, filename }` for upload
   - Falls back to `<input type=file capture>` when `!Capacitor.isNativePlatform()`
3. Update photo flows in:
   - `TechDash.jsx` (dashboard quick photo)
   - `TechAppointment.jsx` (appointment photo button)
4. Add `NSCameraUsageDescription` + `NSPhotoLibraryUsageDescription` to `ios/App/App/Info.plist`:
   - "UPR Tech uses the camera to document job site conditions, damage, and progress."
   - "UPR Tech saves job photos to document work for insurance claims."

**Completion check:** Tapping Photo on TechDash opens native iOS camera, snap triggers upload to `job_documents` via existing `insert_job_document` RPC.

---

## Phase 4 — Push Notifications (APNs)

**Goal:** Techs get push notifications for new assignments, schedule changes, and messages.

1. Install:
   ```
   npm i @capacitor/push-notifications
   npx cap sync ios
   ```
2. In Apple Developer portal:
   - Create App ID `com.utahprosrestoration.tech` with Push Notifications capability
   - Generate APNs Auth Key (.p8 file) — save to 1Password
3. Add device token storage:
   - New table `device_tokens` (employee_id, token, platform, updated_at)
   - RPC `upsert_device_token(p_employee_id, p_token, p_platform)`
4. Register for push on login in `AuthContext`:
   - Request permission
   - Capture token
   - Send to Supabase via RPC
5. New Cloudflare Worker `functions/api/send-push.js`:
   - Accepts `{ employee_id, title, body, data }`
   - Looks up device tokens, posts to APNs HTTP/2 endpoint
6. Wire push triggers:
   - New appointment assigned → push to tech
   - Appointment time changed → push
   - Inbound SMS on a conversation tech owns → push

**Completion check:** Assigning an appointment to a tech in admin triggers a lock-screen push on their phone.

---

## Phase 5 — Geolocation (OMW button accuracy)

**Goal:** "On My Way" captures actual tech location, enables ETA + route validation.

1. Install:
   ```
   npm i @capacitor/geolocation
   npx cap sync ios
   ```
2. Add `NSLocationWhenInUseUsageDescription` to Info.plist:
   - "UPR Tech uses your location to timestamp arrivals and generate accurate travel logs."
3. On OMW tap in `TechAppointment.jsx`:
   - Request location
   - Pass `{ lat, lng, accuracy }` to `clock_appointment_action` RPC (extend RPC signature with optional coords)
4. Store in new columns on `job_time_entries`:
   - `travel_start_lat NUMERIC, travel_start_lng NUMERIC`
   - `clock_in_lat NUMERIC, clock_in_lng NUMERIC`

**Completion check:** Hitting OMW logs coords; admin can see start/arrival points on job detail.

---

## Phase 6 — Haptics + Native Polish

**Goal:** App feels responsive, not web-shaped. Smooth transitions, tactile feedback.

1. Install:
   ```
   npm i @capacitor/haptics @capacitor/status-bar @capacitor/splash-screen
   ```
2. Add haptic triggers:
   - Swipe-to-complete task → `Haptics.impact({ style: 'medium' })`
   - Clock In / Clock Out → `Haptics.notification({ type: 'success' })`
   - Two-click confirm delete (first click) → `Haptics.impact({ style: 'light' })`
   - Photo capture → `Haptics.impact({ style: 'light' })`
3. Status bar: match hero gradient on appointment screens, white on list screens.
4. Splash screen: UPR logo on `--bg-primary`, fade to app.
5. Disable bounce/overscroll on body (keep pull-to-refresh working):
   - `ios.scrollEnabled: false` at the body level, enable per-scroll-container.
6. Review all CSS transitions — ensure `transform` + `opacity` only (GPU), no layout-triggering props.

**Completion check:** Tapping anywhere important vibrates. No jank on scroll. Splash → app transition is seamless.

---

## Phase 7 — Biometric Auth (Face ID)

**Goal:** Tech opens app → Face ID → instantly on TechDash. No re-login.

1. Install:
   ```
   npm i @capacitor-community/privacy-screen @aparajita/capacitor-biometric-auth
   ```
2. Store Supabase refresh token in iOS Keychain via plugin (never AsyncStorage).
3. On app launch:
   - If refresh token exists → prompt Face ID → exchange for session → redirect to `/tech`
   - If not → show `/login`
4. Add `NSFaceIDUsageDescription` to Info.plist:
   - "UPR Tech uses Face ID to keep your account secure while letting you skip repeated sign-ins."
5. Add "Sign out" button in tech profile/settings that clears keychain.

**Completion check:** Kill app, reopen → Face ID prompt → straight to dashboard, no login screen.

---

## Phase 8 — App Store Submission Prep

**Goal:** Binary uploaded to App Store Connect, TestFlight build live.

1. Assets needed:
   - App icon 1024×1024 (UPR logo on `--bg-primary`)
   - Launch screen (storyboard or static)
   - Screenshots: 6.7" iPhone (required) — 5 screens: Dash, Schedule, Appointment, Tasks, Claims
   - App Store description, keywords, support URL, privacy policy URL
2. Privacy Manifest (`PrivacyInfo.xcprivacy`):
   - Declare camera, photos, location, push token usage
   - Declare data types collected (name, email, photos, location, device ID)
3. Apple Developer account:
   - Enroll ($99/yr) — already in progress
   - Create App Store Connect app record: `com.utahprosrestoration.tech`
4. Xcode:
   - Set signing team
   - Archive → Distribute → App Store Connect
5. TestFlight:
   - Add Moroni as internal tester
   - Add 2–3 field techs as external testers
   - Gather feedback for 1 week before public submission

**Completion check:** App passes App Store review, available on public App Store.

---

## Phase 9 — Over-the-Air Updates via Capgo

**Goal:** Push web bundle updates without resubmitting to Apple every time.

Apple allows apps to update their JavaScript/CSS/HTML without re-review, as long as no new native code is introduced. This means UI tweaks, bug fixes, and feature additions in the React layer ship instantly. Only native plugin changes (adding a new Capacitor plugin, changing Info.plist) require a fresh App Store submission.

We use **Capgo** (free, OSS, self-hostable) instead of Ionic's paid live-updates service.

1. Install:
   ```
   npm i @capgo/capacitor-updater
   npx cap sync ios
   ```
2. Sign up at capgo.app (free tier) OR self-host the Capgo server on Cloudflare Workers (long-term plan).
3. Configure in `capacitor.config.json` under `plugins.CapacitorUpdater`.
4. Set up auto-deploy pipeline:
   - Push to `dev` → GitHub Actions runs `VITE_BUILD_TARGET=native vite build`
   - `npx @capgo/cli bundle upload --channel production`
   - On next app launch, Capgo downloads new bundle, applies on restart
5. Document rollback: Capgo dashboard has one-click revert to previous bundle.

**Completion check:** Push a text change to a Tech screen → wait 60 seconds → close/reopen app → change is live, no App Store update.

---

## App Icon Spec (for Gemini design)

When generating the app icon, give Gemini these constraints:
- **Size:** 1024×1024 px, PNG, no transparency (Apple rejects transparent app icons)
- **Safe area:** Keep important elements within the center 800×800 px — iOS may mask corners into a squircle
- **No text:** App icons should not contain the app name (Apple HIG) — the name "UPR" appears under the icon automatically
- **Flat, not skeuomorphic:** Modern iOS icons are geometric, bold, readable at 60×60 px on a home screen
- **High contrast:** Should work on both light and dark home screen wallpapers
- **Brand-aligned:** Use the UPR accent blue (`#2563eb`) or the existing logo mark. A monogram (stylized "U" or "UPR") often works better than a wordmark at small sizes

Once generated, run it through [appicon.co](https://appicon.co) or `xcrun actool` to produce all required sizes for `ios/App/App/Assets.xcassets/AppIcon.appiconset/`.

---

## Completion Checklist

When all phases are done, update `UPR-Web-Context.md` with:
- New table: `device_tokens`
- New columns on `job_time_entries`: `travel_start_lat/lng`, `clock_in_lat/lng`
- New RPCs: `upsert_device_token`, extended `clock_appointment_action` signature
- New Worker: `send-push.js`
- New env var: `VITE_BUILD_TARGET`
- New build script: `build:ios`
- Note: iOS app is live on App Store, source in `ios/` directory, Capacitor config in `capacitor.config.json`

Then:
```
git rm CAPACITOR-TASK.md
git commit -m "docs: update UPR-Web-Context.md, remove completed CAPACITOR-TASK.md"
```

---

## Future: Native SwiftUI Rewrite

Once Capacitor is shipping and stable, we begin the parallel SwiftUI build. Approach:
- New Xcode project, SwiftUI + Swift 6
- Reuse Supabase REST endpoints — all our RPCs already work via HTTP
- Match existing design tokens (tech-text-*, tech-radius-*, status palette) as SwiftUI constants
- Rebuild screens one at a time: TechDash → TechSchedule → TechAppointment → TechTasks → TechClaims
- Use SwiftUI transitions, matchedGeometryEffect, and ScrollView fluidity for the "native feel" that WKWebView can't match
- Ship Swift app as a separate App Store listing or replace the Capacitor binary when ready

The Capacitor build is not wasted work — it validates the data flow, push infrastructure, and App Store process. The Swift build inherits all of that, only the UI layer changes.
