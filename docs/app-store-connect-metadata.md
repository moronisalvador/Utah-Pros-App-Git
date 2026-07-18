# App Store Connect Submission Packet — UPR (Utah Pros Restoration)

Draft content for App Store Connect's "Prepare for Submission" page, assembled from the
`app-store-readiness` masterplan's research (see `docs/app-store-readiness-roadmap.md`). This is
copy-paste-ready text so the owner isn't starting from a blank form once the Apple Developer /
Apple Business Manager enrollment completes. **Nothing here has been entered into App Store Connect
yet** — this is prep only.

## Distribution decision (confirm before submitting — see roadmap §0)

Recommended: **Apple Business Manager → Custom Apps** (private distribution to UPR's own
employees). If the owner instead chooses the public App Store, everything below still applies
except the submission type selected in App Store Connect and the review-notes framing (§ below).

## App Information

- **Name:** UPR
- **Subtitle (30 char max):** Field Ops for Utah Pros
- **Bundle ID:** `com.utahprosrestoration.upr`
- **Primary category:** Business
- **Secondary category (optional):** Productivity
- **Age rating questionnaire:** no objectionable content, no user-generated public content, no
  gambling/contests — answer "No" throughout; expect **4+**.
- **Privacy Policy URL:** `https://utahpros.app/privacy` (live — `src/pages/Legal.jsx`)
- **Support URL:** `https://utahpros.app/support` (new this phase — `src/pages/Legal.jsx`)
- **Marketing URL:** optional, skip (no consumer marketing push for this app).

## Description (App Store Connect "Description" field)

> UPR is Utah Pros Restoration's internal field-operations app for our own technicians and staff.
> It's used to manage job scheduling, insurance claims, time tracking, photo documentation, and
> billing for restoration work. UPR is private software for Utah Pros Restoration employees and
> contractors only — it is not available for public sign-up.

## Keywords (100 char max, comma-separated, no spaces after commas)

`field service,restoration,job scheduling,time tracking,claims,dispatch,internal tools`

## Export compliance

Already declared in code (`ITSAppUsesNonExemptEncryption = false`, shipped in PR #451/Phase F1) —
standard HTTPS/TLS only, no custom encryption. App Store Connect's per-build questionnaire: answer
**"No"** to using non-exempt encryption.

## App Privacy ("nutrition label") — draft answers

All data below is **collected** and **linked to identity** (the employee's authenticated account),
per the masterplan research: Apple's "linked to you" definition is about identity generally, not
specifically a consumer end-user — see roadmap §1 for the live-code evidence behind each row.

| Data Type | Collected | Linked to identity | Used for tracking | Purpose |
|---|---|---|---|---|
| Location (Precise) | Yes | Yes | No | App Functionality (clock-in geofencing) |
| Photos/Videos | Yes | Yes | No | App Functionality (job documentation) |
| Contact Info | Yes | Yes | No | App Functionality (staff + customer records) |
| User Content | Yes | Yes | No | App Functionality (notes, documents) |
| Identifiers (device push token) | Yes | Yes | No | App Functionality (push notifications) |
| Usage Data | No | — | — | No analytics SDK in the app |
| Financial Info | No (device-side) | — | — | Shown via first-party backend only; no client-side Stripe/QBO calls |
| Diagnostics | No | — | — | No crash/analytics SDK bundled |

Not used for tracking or third-party advertising (no ad SDKs present in the app).

## Review notes (paste into App Review Information)

> UPR is Utah Pros Restoration's internal business app, used only by our own employees and
> contractors — there is no public sign-up. [If submitting via ABM Custom Apps: delete the next
> sentence.] [If submitting to the public App Store: "This app supports our field-service workforce
> and is intended for our own staff's use; it is not offered to the general public for sign-up."]
> A demo/test account is provided below for review.

- **Demo account:** _(owner to provide a real employee login + password here before submission —
  do not commit real credentials to this repo)._
- **Account deletion:** the app includes an in-app "Delete my account" request flow (Settings →
  My Account), shipped in PR #454/Phase B, satisfying Guideline 5.1.1(v).

## Screenshots

**Not producible from this (Linux, no Xcode/simulator) environment.** Once the owner has a real
Xcode build running in Simulator or on a device: capture at minimum one 6.9" (or 6.7" fallback)
iPhone screenshot set of the tech dashboard/schedule; iPad screenshots only if iPad support is
kept (F1's orientation work only touched iPhone). 3–5 screens is typical (Dashboard, Schedule,
Job detail, Time tracking).

## Status

- [x] Support URL page live (`/support`)
- [x] Privacy Policy / Terms live (`/privacy`, `/terms`)
- [x] Export compliance key set (F1)
- [x] Account deletion flow shipped (Phase B)
- [x] Nutrition label content drafted (this doc)
- [ ] Distribution-model decision confirmed (owner)
- [ ] Apple Developer Program / Apple Business Manager enrollment complete (owner)
- [ ] Demo account credentials prepared (owner, not committed to git)
- [ ] Screenshots captured (owner, needs a real Xcode/Simulator build)
- [ ] Data entered into App Store Connect (owner)
