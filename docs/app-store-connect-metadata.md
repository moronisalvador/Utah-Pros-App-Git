<!--
FILE: docs/app-store-connect-metadata.md

WHAT THIS DOES (plain language):
  Prepares the owner-facing text and privacy answers for a future UPR App Store Connect submission.
  It records current source facts and keeps Apple account, signing, screenshot, and submission work
  as separate owner actions.

DEPENDS ON:
  Internal: src/pages/Legal.jsx, src/pages/tech/TechSettings.jsx,
            src/components/settings/AccountDeletionPanel.jsx,
            ios/App/App/PrivacyInfo.xcprivacy, docs/app-store-readiness-roadmap.md
  Data:     reads → repository source and owner distribution decision
            writes → documentation only

NOTES / GOTCHAS:
  - Nothing in this file authorizes or proves an App Store Connect change.
  - Privacy answers require final owner/legal review against the exact signed build.
-->

# App Store Connect Submission Packet — UPR (Utah Pros Restoration)

Draft content for App Store Connect's "Prepare for Submission" page, assembled from the
`app-store-readiness` masterplan's research (see `docs/app-store-readiness-roadmap.md`). This is
a working packet so the owner is not starting from a blank form once the Apple Developer / Apple
Business Manager enrollment completes. Recheck every field, display-size requirement, privacy
answer, and URL against the exact signed build and current App Store Connect form. **Nothing here
has been entered into App Store Connect yet** — this is prep only.

## Distribution decision (confirm before submitting — see roadmap §0)

**Owner direction (2026-07-18): public App Store**, with Utah Pros Restoration's own roadmap
to eventually open UPR to other restoration companies (multi-tenant) strengthening the case that
this is a real, growing business app rather than a one-off internal tool (the Guideline 3.2/4.2
risk area). Everything else in this packet is written for that path. The original ABM Custom Apps
recommendation (§0 of the roadmap) remains documented as the fallback if App Review pushes back —
switching later only changes the App Store Connect submission type and the review-notes wording
below, nothing in the shipped code changes either way.

## App Information

- **Name:** UPR
- **Subtitle (30 char max):** Field Ops for Utah Pros
- **Bundle ID:** `com.utahprosrestoration.upr`
- **Primary category:** Business
- **Secondary category (optional):** Productivity
- **Age rating questionnaire:** no objectionable content, no user-generated public content, no
  gambling/contests — answer "No" throughout; expect **4+**.
- **Privacy Policy URL:** `https://utahpros.app/privacy` (route exists in source; verify the release
  deployment immediately before submission)
- **Support URL:** `https://utahpros.app/support` (route exists in source; verify the release
  deployment immediately before submission)
- **Marketing URL:** optional, skip (no consumer marketing push for this app).

## Description (App Store Connect "Description" field)

> UPR is a field-operations platform built by Utah Pros Restoration to run restoration and repair
> work — job scheduling, insurance claims, time tracking, photo documentation, and company
> messaging. Today UPR runs Utah Pros Restoration's own field team; the platform is being built to
> extend to other restoration businesses over time. Accounts are provisioned by the operating
> company — there is no public self-service sign-up in the app today. Office, CRM, and billing
> tools remain in UPR's browser product and are not included in this field-only iPhone build.

## Keywords (100 char max, comma-separated, no spaces after commas)

`field service,restoration,job scheduling,time tracking,claims,dispatch,internal tools`

## Export compliance

Already declared in code (`ITSAppUsesNonExemptEncryption = false`, shipped in PR #451/Phase F1) —
standard HTTPS/TLS only, no custom encryption. App Store Connect's per-build questionnaire: answer
**"No"** to using non-exempt encryption.

## App Privacy ("nutrition label") — conservative draft answers

The 12 collected data types below are declared as **linked to identity** (the employee's
authenticated account), non-tracking App Functionality in the current app-target privacy manifest.
The exact signed build, provider configuration, retention practice, and App Store Connect answers
still require owner/privacy review before entry.

| Data Type | Collected | Linked to identity | Used for tracking | Purpose |
|---|---|---|---|---|
| Location (Precise) | Yes | Yes | No | App Functionality (clock-in geofencing) |
| Photos/Videos | Yes | Yes | No | App Functionality (job documentation) |
| Contact Info — name | Yes | Yes | No | App Functionality (staff + customer records) |
| Contact Info — email address | Yes | Yes | No | App Functionality (staff + customer records) |
| Contact Info — phone number | Yes | Yes | No | App Functionality (staff + customer records) |
| Contact Info — physical address | Yes | Yes | No | App Functionality (job + customer records) |
| Identifiers — user ID | Yes | Yes | No | App Functionality (authenticated account) |
| User Content — emails or text messages | Yes | Yes | No | App Functionality (company communication) |
| User Content — customer support | Yes | Yes | No | App Functionality (feedback and support) |
| User Content — other | Yes | Yes | No | App Functionality (notes, documents) |
| Identifiers — device ID (push token) | Yes | Yes | No | App Functionality (push notifications when enabled) |
| Financial Info — other | Yes | Yes | No | App Functionality (saved OOP quote costs, totals, and margin) |
| Usage Data | No | — | — | No analytics SDK in the app |
| Diagnostics | No | — | — | No crash/analytics SDK bundled |

Not used for tracking or third-party advertising (no ad SDKs present in the app).

The field-only native graph excludes Stripe/QBO/billing screens, but includes the saved
out-of-pocket quote calculator. That route transmits and retains material costs, PRV invoice cost,
totals, margin, and related pricing inputs through `upsert_oop_quote`.
[Apple's current App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/)
defines Other Financial Info broadly, including any other financial information. Treat
**Financial Info → Other Financial Info** as collected, linked, non-tracking App Functionality.
Do not answer “No” merely because QuickBooks and payment-card entry are absent. The owner/privacy
reviewer must still verify the exact signed-build practices before App Store Connect entry.

The app-target `PrivacyInfo.xcprivacy` also declares the required UserDefaults accessed-API reason
`CA92.1`. The release artifact verifier fails unless tracking is false, tracking domains are empty,
all 12 data types above have the exact linked/non-tracking/App Functionality flags, and the
UserDefaults reason is present.

## Review notes (paste into App Review Information)

> UPR is a field-service management platform operated by Utah Pros Restoration. It currently runs
> Utah Pros Restoration's field workforce; the wider browser product also serves office staff. The
> platform is being extended to support other restoration businesses over time — accounts are
> provisioned by the operating company rather than a public self-service sign-up. A field demo/test
> account is provided below for review.
>
> (Fallback if this draws a Guideline 3.2/4.2 rejection: resubmit via Apple Business Manager's
> Custom Apps program instead of the public Store — see `docs/app-store-readiness-roadmap.md` §0.
> No app code changes either way.)

- **Demo account:** _(owner to provide a real employee login + password here before submission —
  do not commit real credentials to this repo)._
- **Account deletion:** the source includes the same two-step, administrator-reviewed "Delete my
  account" request flow in desktop My Account and field `/tech/settings`. It explains that login/app
  access is deactivated while shared legal/accounting/job records may be retained. Final compliance
  still depends on the owner-approved fulfillment/SLA/retention process and the exact released
  build.

## Screenshots

No App Store screenshot set was captured in this source-only session. Prior unsigned simulator
build/install/launch evidence is not a submission asset. From the exact reviewed release build,
capture at minimum one current required large-iPhone screenshot set of the field
dashboard/schedule; confirm App Store Connect's then-current display-size requirements rather than
freezing them here. Capture iPad screenshots only if iPad support remains in the submitted build.
Use 3–5 representative field screens (Dashboard, Schedule, Job detail, Time tracking).

## Status

- [x] Support route/source exists (`/support`)
- [x] Privacy Policy / Terms route/source exists (`/privacy`, `/terms`)
- [x] Export compliance key is declared in source
- [x] Account deletion request UI exists in both desktop and field settings
- [x] Exact 12-type nutrition-label draft matches the app privacy manifest/verifier source,
  including Other Financial Info for saved OOP quote/pricing data
- [ ] Privacy/legal owner confirms the exact signed-build declarations and retention language
- [ ] Account deletion fulfillment/SLA/retention process is approved and exercised
- [x] Distribution-model decision — public App Store (owner, 2026-07-18); ABM Custom Apps kept as documented fallback
- [x] Apple Developer Program team `H6ZUT739T9` active (owner)
- [ ] Apple Business Manager enrollment, only if the eventual distribution route requires it
- [ ] Demo account credentials prepared (owner, not committed to git)
- [ ] Screenshots captured from the exact reviewed release build (owner)
- [ ] Data entered into App Store Connect (owner)
