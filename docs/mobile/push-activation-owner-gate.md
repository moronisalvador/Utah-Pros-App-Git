# Native push — what is built, and the four owner-only steps left

**Last verified:** 2026-07-28

Native push is wired end to end in the repository. It does not work yet, and the
only reasons are four actions that require an Apple Developer account and the
Cloudflare dashboard. **Nothing below can be done by an agent**, which is why this
is a handoff rather than a task.

## Already built — do not rebuild

| Piece | Where | State |
|---|---|---|
| Plugin | `@capacitor/push-notifications` in `package.json` + `ios/App/CapApp-SPM/Package.swift` | wired |
| Debug entitlement | `ios/App/App/App.entitlements` → `aps-environment: development` | correct |
| Release entitlement | `ios/App/App/App.Release.entitlements` → `aps-environment: production` | correct |
| Per-config wiring | `project.pbxproj` — Debug uses `App.entitlements`, Release uses `App.Release.entitlements` | correct |
| Registration | `src/lib/pushNotifications.js` → `registerPushForEmployee()` | fail-closed |
| Tap → route | `resolveNativePushActionTarget()` + `NativeNavigationBridge` | wired |
| Token storage | `device_tokens` via `upsert_device_token` | wired |
| Sender | `functions/api/send-push.js` (APNs HTTP/2, JWT-signed) | wired |
| Deep link | `functions/api/notify.js` writes `data.url` per notification | fixed 2026-07-27 (PUSH-01) |
| Unenroll | `detachNativePushDevice()` on logout / account switch | wired |

The **Release entitlement detail matters more than it looks**. A TestFlight build
is signed with a distribution profile and must carry `aps-environment: production`;
a build that ships `development` registers against APNs sandbox and every push
silently fails. The two-file split above is what prevents that, so do not collapse
them back into one.

## The four owner-only steps

### 1. Create the APNs Auth Key (Apple Developer portal)

Certificates, Identifiers & Profiles → **Keys** → **+** → enable **Apple Push
Notifications service (APNs)** → Continue → Register → **Download the `.p8`**.

Apple lets you download this file **once**. Store it in the password manager
immediately. Note the **Key ID** (10 chars) shown on that page, and the **Team ID**
(`H6ZUT739T9`).

### 2. Put four secrets in Cloudflare — BOTH variable sets

Cloudflare Pages keeps **Production and Preview variables separately**. A secret
added to only one leaves push broken on the other, which reads as "push is flaky"
rather than "push is unconfigured".

| Variable | Value |
|---|---|
| `APNS_P8_KEY` | full contents of the `.p8`, newlines preserved |
| `APNS_KEY_ID` | the 10-character Key ID from step 1 |
| `APNS_TEAM_ID` | `H6ZUT739T9` |
| `APNS_TOPIC` | `com.utahprosrestoration.upr` |
| `APNS_ENV` | `sandbox` for TestFlight, `production` for the App Store |

Then **redeploy** — Pages Functions pick up new variables only on a new deployment.

### 3. Turn enrollment on

`VITE_NATIVE_PUSH_ENABLED` must be exactly the string `true`. It is `false` in
`.env.example` and the check is deliberately fail-closed
(`isNativePushEnrollmentEnabled`), so any other value — `TRUE`, `1`, unset — keeps
enrollment off. This is a build-time Vite variable, so it also needs a redeploy.

Leave it `false` until step 2 is done. Enrolling devices against a sender that
cannot send just fills `device_tokens` with tokens nothing will ever use.

### 4. Prove it on a real device

The simulator cannot receive push at all — APNs needs real hardware. Install on a
physical iPhone, accept the permission prompt, confirm a row appears in
`device_tokens`, then trigger a real notification and confirm both the banner and
that **tapping it lands on the right screen** (the PUSH-01 fix means an appointment
push should open `/tech/appointment/<id>`, not the dashboard).

## What is deliberately NOT done

- No key was generated, downloaded, or stored.
- No Cloudflare variable was set, in either environment.
- `VITE_NATIVE_PUSH_ENABLED` is untouched and remains `false`.
- No test push was sent.

Each of those is either owner-only or a live external action needing its own
authorization.
