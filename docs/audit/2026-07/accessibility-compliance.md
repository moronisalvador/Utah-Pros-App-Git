# July 2026 Accessibility and Compliance Findings

Audit date: 2026-07-22
Evidence commit: `0a7c61c`

This is engineering evidence, not legal advice or certification. Live operations, contracts,
provider configuration, real devices/accounts and qualified legal review are required for formal
compliance conclusions.

## Finding ACC-001 — No repeatable accessibility conformance evidence exists

- **Severity:** Medium
- **Confidence:** confirmed
- **Evidence:** `package.json:6-12`; `package.json:42-53`; `.github/workflows/ci.yml:44-84`; `eslint.config.js:1-60`; repository census found no direct axe/jest-axe/jsx-a11y dependency, accessibility test lane or checked-in WCAG test report.
- **Affected workflow:** all public, office, CRM, technician and native UI; keyboard, screen-reader, zoom, contrast and motion use.
- **Observed behavior:** accessibility is implemented ad hoc in components but not measured by automated checks or a recorded manual matrix.
- **Realistic failure scenario:** a custom card, modal, date picker, drag/drop board or icon-only control becomes keyboard-inaccessible or unlabeled, and the regression is not detected before release.
- **Business impact:** employees/contractors cannot complete work, increased ADA/WCAG risk, App Review friction and expensive late remediation.
- **Recommended remediation:** define target WCAG 2.2 AA, add jsx-a11y/static lint and axe checks to component/browser tests, and manually test critical workflows with keyboard plus VoiceOver on iOS/Safari. Inventory color contrast, focus order, dialogs, status announcements, drag alternatives and reduced motion.
- **Regression test / verification:** blocking axe smoke tests have no serious/critical violations on critical routes; manual matrix records keyboard and VoiceOver outcomes with issue IDs; representative 200% zoom/reflow and contrast tests pass.
- **Estimated effort:** L for baseline/remediation (2–6 weeks), S–M for initial harness.
- **Dependencies:** TEST-001, MAINT-001/PERF-002 for safe UI refactors.
- **External evidence required:** real devices, VoiceOver, user workflows and legal/product conformance target.

## Finding COMP-001 — Privacy notice is too general to serve as complete data-practice evidence

- **Severity:** Medium
- **Confidence:** likely
- **Evidence:** `src/pages/Legal.jsx:33-60`; `docs/app-store-connect-metadata.md:50-67`.
- **Affected workflow:** public privacy notice, employee/customer transparency, App Store privacy review and vendor/data-retention governance.
- **Observed behavior:** the notice lists broad data categories, purposes, third parties and an open-ended retention statement. It names Intuit and generic messaging/email providers but does not enumerate other repository-evidenced processors/integrations, precise retention schedules, diagnostics, location/push/native handling, deletion mechanics, effective contact details by right, or jurisdiction-specific disclosures.
- **Realistic failure scenario:** actual production processing—such as precise location, Google/Meta/CallRail/Twilio/Resend/Stripe or future diagnostics—exceeds what a reviewer or data subject can reasonably infer from the notice.
- **Business impact:** inaccurate App Store answers, customer/employee trust issues, vendor/privacy review failure and regulatory exposure depending on applicable law.
- **Recommended remediation:** build a verified data inventory (category, subject, purpose, processor, storage, role access, retention, deletion, transfer), reconcile it with live configuration, and have counsel update the notice and internal retention policy. Keep App Store answers generated/reviewed from the same inventory.
- **Regression test / verification:** quarterly owner/legal sign-off compares dependency/provider/config inventory to notice and App Store label; every new integration includes a privacy-impact checklist.
- **Estimated effort:** M–L (1–3 weeks across engineering, operations and counsel).
- **Dependencies:** OBS-001 and COMP-004.
- **External evidence required:** provider contracts/configuration, actual retention/deletion operations, applicable law and counsel.

## Finding COMP-002 — Repository contains deletion requests but not a discoverable fulfillment workflow

- **Severity:** Medium
- **Confidence:** likely
- **Evidence:** `src/pages/settings/MyAccount.jsx:222-330`; `supabase/migrations/20260717_account_deletion_requests.sql:32-91`; `supabase/migrations/20260717_account_deletion_requests.sql:155-183`; repository-wide search found request/read code but no admin queue/processor UI.
- **Affected workflow:** employee account deletion, App Store Guideline 5.1.1(v), login deactivation, retained-record handling and request audit trail.
- **Observed behavior:** the user can submit one pending request and admins receive notifications. The table supports `actioned`/`denied`, but no application code in the inspected repository exposes a queue or performs Auth-user deletion/deactivation, anonymization, denial reason, completion notification or SLA tracking.
- **Realistic failure scenario:** a request remains pending in a bell notification; the user believes deletion is underway, but no owner/process closes it or records what was retained.
- **Business impact:** unmet deletion expectation, App Review/compliance failure, orphaned access and operational inconsistency.
- **Recommended remediation:** first document the current manual owner/SLA. Then add an admin queue or operational runbook that verifies identity, revokes sessions/access, applies retention/anonymization rules, records actor/timestamps/notes, notifies the requester and supports audit export. Do not delete shared financial/job evidence contrary to policy.
- **Regression test / verification:** seeded request proceeds through pending→actioned/denied under an admin test account; unauthorized roles cannot process it; Auth access is actually revoked; retained/anonymized data matches approved policy.
- **Estimated effort:** M–L (3–10 days plus policy/legal decisions).
- **Dependencies:** DB-002, COMP-001.
- **External evidence required:** an external/manual process may already exist; verify it, its SLA and Apple acceptability before treating this as an active breach.

## Finding COMP-003 — App Store submission has unresolved external gates

- **Severity:** Medium
- **Confidence:** confirmed
- **Evidence:** `docs/app-store-connect-metadata.md:69-105`.
- **Affected workflow:** public iOS submission and review.
- **Observed behavior:** repository metadata leaves the demo account blank and records incomplete Developer enrollment, screenshots and App Store Connect data entry. Screenshots require a real Xcode/simulator environment.
- **Realistic failure scenario:** a build is technically ready but review cannot log in, metadata/privacy answers are incomplete, screenshots are invalid, or the public-vs-Custom-App model triggers rejection.
- **Business impact:** release delay/rejection and repeated review work.
- **Recommended remediation:** assign owners/dates for enrollment, distribution model, reviewer account, screenshots, privacy label, export answers and review notes; test the exact reviewer account from a clean device and preserve evidence outside Git.
- **Regression test / verification:** release checklist includes successful TestFlight install/login and core workflow with the reviewer account, valid screenshots for required device sizes and confirmed App Store Connect fields.
- **Estimated effort:** M (several owner days, calendar time depends on Apple).
- **Dependencies:** COMP-001, COMP-002, ACC-001.
- **External evidence required:** Apple Developer/App Store Connect/TestFlight access and test credentials.

## Finding COMP-004 — “Financial Info: No” App Store answer needs authoritative review

- **Severity:** Medium
- **Confidence:** hypothesis
- **Evidence:** `docs/app-store-connect-metadata.md:50-67`; `functions/api/qbo-charge.js:1-14`; `functions/api/stripe-pay-link.js:1-8`; `src/pages/InvoiceEditor.jsx:886-930`.
- **Affected workflow:** Apple App Privacy nutrition label and payment/invoice UI.
- **Observed behavior:** draft metadata says Financial Info is not collected because payment calls are backend/device-side, while the product displays invoices/payments and supports card tokenization/checkout workflows. Apple’s classification depends on what the app/company collects and links, not only where an SDK call originates.
- **Realistic failure scenario:** App Review interprets linked invoice/payment or card-interaction data as Financial Information and rejects or requires a corrected label.
- **Business impact:** review delay and inaccurate public privacy disclosure.
- **Recommended remediation:** map each payment datum from device to provider/backend, use current Apple definitions, and have the App Store/privacy owner or counsel approve the answer with written rationale. Update the privacy notice consistently.
- **Regression test / verification:** signed privacy questionnaire references the current data inventory and production flow; reviewer account exercise confirms exactly what the app collects/displays.
- **Estimated effort:** S–M (0.5–2 days plus owner/legal review).
- **Dependencies:** COMP-001.
- **External evidence required:** current Apple definitions, App Store Connect questionnaire and live payment architecture.
