# App Store Readiness & iOS Native Capabilities — Roadmap

**Plan of record.** Committed 2026-07-17. Owner: Moroni Salvador. Slug: `app-store-readiness`.
Read scope for any session touching this initiative: `CLAUDE.md` + this file's phase block +
[`.claude/rules/app-store-readiness-wave-ownership.md`](../.claude/rules/app-store-readiness-wave-ownership.md).

Execution model for this initiative: **run in-session via the Workflow tool** (parallel subagents
in isolated git worktrees, orchestrated from one Claude Code session), not separate cold sessions —
so there is no separate dispatch doc; this file is the single source of truth.

## 0. The distribution-model decision (read this first)

Apple Guideline 3.2 ("Business") is reviewer boilerplate used to reject apps "designed for a
specific business or organization... not for general distribution" on the **public** App Store.
Live-verified 2026-07: the guideline's published text does not name internal apps explicitly — this
is a real but **inconsistently enforced** risk, not codified law. Counter-evidence: Walmart's
"Me@Walmart" app (employee-only login, no public sign-up) is live on the public Store today with
UPR's identical fact pattern. Recommendation stands regardless of which way this goes:

| | Public App Store | Apple Business Manager → Custom Apps |
|---|---|---|
| Risk | Real, inconsistent 3.2 rejection risk | Built for this exact case, no 3.2 exposure |
| Discoverability | Public search/install | Invisible on Store; org-assigned install (Apple ID/MDM) |
| Enrollment | Paid Developer Program — **D-U-N-S still shown as required** on developer.apple.com as of 2026-07 | ABM itself now accepts an EIN (US) per the April 2026 "Apple Business" platform unification — but the *Developer Program* piece (needed either way to sign/publish) still shows D-U-N-S; verify live at signup |

**Recommendation: Apple Business Manager Custom Apps.** No unpredictable rejection risk, matches a
field-tech workforce with no need for App Store discoverability. **Decision fork:** if the owner
prefers public discoverability enough to accept the residual 3.2 risk, the phases below are
IDENTICAL either way (entitlements/icons/privacy-manifest/account-deletion don't change with the
distribution channel) — only the App Store Connect submission type and review-notes framing differ,
so no phase is blocked on this decision.

**Unconditional regardless of the decision above:** in-app account deletion (Guideline 5.1.1(v)) —
challenge-pass-verified, no ABM/enterprise exemption exists (unlike Sign-in-with-Apple's 4.8, which
DOES have one and correctly does not apply to UPR's email/password-only auth).

## 1. Gap audit (live-verified 2026-07-17)

| Area | Verdict | Evidence |
|---|---|---|
| Distribution model | DECISION NEEDED | §0 |
| App icon / splash | MISSING — stock Capacitor placeholder | `ios/App/App/Assets.xcassets/{AppIcon.appiconset,Splash.imageset}` — confirmed byte-identical placeholder PNGs, zero UPR branding |
| Entitlements / Push capability | BLOCKER | No `ios/App/App.entitlements` file exists anywhere; Push Notifications capability not enabled at the Xcode project level |
| APNs push (native) | PARTIAL — wired but dormant + 2 bugs | Registration wired into real login (`AuthContext.jsx:224-225`); `functions/api/send-push.js` has no owner/admin auth check and doesn't prune `400 BadDeviceToken`; `AppDelegate.swift` has zero push-delegate code |
| `device_tokens` RLS | BLOCKER (security) | `supabase/migrations/20260708_dbf_p3_anon_policy_closure.sql:108-109` — policy named "Own tokens or admin read" is `USING (true)`, every employee can read every device token |
| App-target Privacy Manifest | MISSING | Capacitor's bundled `PrivacyInfo.xcprivacy` is an empty declaration (verified by direct read) — app target needs its own |
| Capgo OTA pipeline | BROKEN, silent | `markBundleReady()` exists in `src/lib/nativeUpdater.js` but has zero call sites anywhere — docs falsely claim it's wired on `App.jsx` mount. Policy-wise the OTA pattern itself is Apple-compliant (Guideline 4.7 carve-out) |
| Account deletion (5.1.1v) | MISSING, required either way | No in-app deletion flow exists; no ABM/enterprise exemption found |
| Sign in with Apple (4.8) | N/A, compliant | Email/password only, no social login offered |
| Export compliance | 1-line fix | `ITSAppUsesNonExemptEncryption` absent — standard HTTPS-only use is the exempt case |
| App Privacy nutrition label | Content drafted, not yet entered | Full data-type table produced this session (location/photos/contact/identifiers — all "linked to identity") |
| Legal pages | READY | Real Privacy Policy + Terms at `/privacy`, `/terms` |
| CI/signing automation | MISSING | No fastlane/Gymfile/Matchfile/`xcodebuild` anywhere; fully manual Xcode, no committed `DEVELOPMENT_TEAM` |
| App Store Connect metadata | NOT STARTED | Screenshots, support URL, category, pricing, age rating, demo credentials |
| tech-v2 UI readiness | N/A to submission | Legacy UI (flags off) ships; functional with known-but-partially-mitigated bugs; unrelated to the owner's separate on-device bake-off gate (`tech-v2-roadmap.md`) |
| Landscape orientation | Likely unreviewed default | iPhone allows landscape; no landscape layouts exist in `src/pages/tech/` |

## 2. Phase design (reordered per the adversarial challenge pass)

Nothing here is a classic parallel wave the way CRM/settings waves are — most native-iOS work
collides on the same handful of files (`Info.plist`, `project.pbxproj`, entitlements), so it's
inherently one lane, not fan-out-able. The genuinely parallel-safe slice is real but smaller than
total effort. **Disjointness independently proven**: F1 owns all of `ios/App/App/**` +
`project.pbxproj`; A/B/D touch zero overlapping files; `MyAccount.jsx` ownership confirmed released
(Settings Overhaul P4 merged 2026-07-05, no active claim).

```
Day 0 (owner, ~30 min, zero engineering cost — not a build phase)
  └─ Kick off Apple Developer Program + ABM enrollment (EIN in hand) — longest lead time,
     nothing downstream should wait on it STARTING (only on it COMPLETING for submission).

Wave 1 (parallel, run via Workflow in one session, isolated worktrees)
  ├─ Phase F1 — Signing & Push Foundation      (Opus — can't be compile-verified in this
  │                                              Linux env; extra rigor matters)
  ├─ Phase A  — Backend hardening               (Opus — shared-prod RLS security fix)
  ├─ Phase B  — Account deletion compliance     (Opus — compliance-sensitive)
  └─ Phase D  — CI/fastlane scaffold            (Sonnet — mechanical)

Milestone: TestFlight-internal working — real native app on the owner's/team's phones,
weeks before public/ABM submission completes, no App Review needed for internal testing.

Wave 2 (after distribution-model decision + Wave 1 merges + owner Xcode-side build-verify)
  └─ Phase F2 — Polish (real icon/splash art, orientation-lock decision) + App Store
                Connect / ABM metadata assembly — ships last, blocks nothing else.
```

**2026-07-17 update — F2's non-Xcode-gated slice done ahead of the gate, per owner direction**
("get everything we can that doesn't need Xcode; I'll handle Xcode separately"). Orientation-lock
was already shipped in F1. This session additionally shipped, on branch `app-store-f2-polish-metadata`:
- Real UPR-branded app icon (`AppIcon-512@2x.png`, 1024×1024, RGB/no-alpha) and splash screen
  (`splash-2732x2732*.png`) — rendered from the real brand mark in `public/favicon.svg` (headless
  Chromium via Playwright, alpha channel stripped with `pngjs` since Apple's icon format forbids
  transparency), replacing the stock Capacitor placeholder.
- A public `/support` page (`src/pages/Legal.jsx` + `src/App.jsx`) — App Store Connect requires a
  Support URL and none existed.
- `docs/app-store-connect-metadata.md` — the full submission packet drafted (description, keywords,
  category, age rating, nutrition-label table, export-compliance answer, review notes) so the owner
  pastes into App Store Connect rather than starting blank.
Still genuinely owner-gated (nobody else can do these): the distribution-model decision (§0), Apple
Developer Program / ABM enrollment, demo reviewer credentials, screenshots (needs a real Xcode/
Simulator build), and the actual App Store Connect data entry.

### Phase F1 — Signing & Push Foundation
> **Branch:** `app-store-f1-signing-push` · **Model · effort:** Opus · high · **Read scope:** this
> block + `.claude/rules/app-store-readiness-wave-ownership.md`

- Create `ios/App/App.entitlements` declaring `aps-environment` (`development`).
- Register it in `ios/App/App.xcodeproj/project.pbxproj` (`CODE_SIGN_ENTITLEMENTS` build setting on
  both Debug/Release configs) and enable the Push Notifications capability.
- `ios/App/App/AppDelegate.swift`: add `didRegisterForRemoteNotificationsWithDeviceToken` /
  `didFailToRegisterForRemoteNotificationsWithError`, bridged via Capacitor's
  `NotificationCenter.default.post` pattern so the JS `registration`/`registrationError` listeners in
  `src/lib/pushNotifications.js` actually resolve.
- `ios/App/App/Info.plist`: add `ITSAppUsesNonExemptEncryption` = `false`; **decision fork** on
  `UISupportedInterfaceOrientations` — default to locking iPhone to Portrait only (no landscape
  layouts exist anywhere in `src/pages/tech/`; ship as a fix unless the owner wants landscape kept).
- Add app-target `ios/App/App/PrivacyInfo.xcprivacy` declaring `NSPrivacyAccessedAPICategoryUserDefaults`
  with reason `CA92.1` (no App Group sharing) — covers Capacitor's/Cordova's transitive UserDefaults use.
- **Caveat that MUST ship in the PR description:** none of this can be compile-verified in this
  (Linux, no Xcode) environment. The owner must open the project in real Xcode, confirm it builds,
  archives, and signs before this reaches any device — flag exactly like the existing
  "owner on-device iPhone check" items elsewhere in this repo.
- Close-out: no `npm test`/`build` coverage possible for native-only files (say so); `upr-pattern-checker`
  on any non-native files touched; PR into `dev`, stop.

### Phase A — Backend hardening
> **Branch:** `app-store-a-backend-hardening` · **Model · effort:** Opus · high · **Read scope:**
> this block + `.claude/rules/database-standard.md`

- One additive migration narrowing `device_tokens`' `"Own tokens or admin read"` policy to actually
  mean that (`employee_id = auth-resolved employee` OR an admin-role check), replacing the current
  `USING (true)`. Rollback note: re-apply the prior `USING (true)` policy (documented, not executed
  unless asked).
- `functions/api/send-push.js`: add an owner/admin role check on the caller before allowing a push
  to an arbitrary `employee_id`; prune `device_tokens` on `400 BadDeviceToken`, not just `410 Gone`.
- `src/App.jsx`: call `nativeUpdater.markBundleReady()` on mount, guarded by
  `Capacitor.isNativePlatform()` (no-op on web).
- Close-out: `npm run test` + `build` + `eslint` (changed files) → `migration-safety-checker` +
  `anon-grant-auditor` (mandatory, this ships a migration) → `upr-pattern-checker` → apply + verify
  the migration live via Supabase MCP → update `UPR-Web-Context.md` → PR into `dev`, stop.

### Phase B — Account deletion compliance
> **Branch:** `app-store-b-account-deletion` · **Model · effort:** Opus · high · **Read scope:**
> this block

- New `SECURITY DEFINER` RPC (e.g. `request_account_deletion(p_employee_id)`) — `GRANT EXECUTE TO
  authenticated, service_role`, RLS-safe, additive migration, rollback note. Given accounts are
  admin-provisioned (not self-service), the compliant pattern is a **request-and-confirm** flow
  (parallel to Guideline 5.1.1(ix)'s regulated-industry customer-service pattern): the employee
  submits the deletion request in-app; it's actioned (data erasure/anonymization) with an admin
  confirmation step, not silent immediate self-deletion of a shared business record.
- UI: a "Delete My Account" section in `src/pages/settings/MyAccount.jsx` (confirmed unowned by any
  active initiative — Settings Overhaul P4 merged 2026-07-05). Two-click confirm per Rule 2, no modal.
- Close-out: full gauntlet since this touches a live page — `npm run test` + `build` + `eslint` →
  `upr-pattern-checker` + `design-consistency-checker` + `page-behavior-checker` → minimize/resume
  test + 390px mobile check (`close-out-standard.md`) → `migration-safety-checker` +
  `anon-grant-auditor` → PR into `dev`, stop.

### Phase D — CI/fastlane scaffold
> **Branch:** `app-store-d-ci-scaffold` · **Model · effort:** Sonnet · medium · **Read scope:** this block

- New `ios/fastlane/{Fastfile,Appfile}` scaffold (archive + sign + TestFlight upload lanes),
  parameterized so `DEVELOPMENT_TEAM`/signing identity come from CI secrets not yet set (placeholder
  names documented, filled in once the Developer Program/ABM enrollment completes).
- New `.github/workflows/ios-release.yml` — `workflow_dispatch`-only (manual) until signing secrets
  exist, mirroring `capgo-deploy.yml`'s current paused-safe pattern.
- Touches zero existing files — zero collision risk with F1/A/B.
- Close-out: no runtime test possible (no signing creds yet — say so explicitly) → PR into `dev`, stop.

## 3. Dependency graph

```
Day0 (owner, external, ABM/Developer enrollment) ── unblocks nothing downstream (independent lane)
F1 ─┐
A  ─┼─ independent, parallel, worktree-isolated ──> Wave 1 merges ──> owner Xcode build-verify (F1)
B  ─┤                                                                        │
D  ─┘                                                                        v
                                                              TestFlight-internal milestone
                                                                        │
                                                        distribution-model decision (§0)
                                                                        v
                                                              F2 (polish + ASC/ABM metadata)
```

## 4. What changed after the adversarial challenge pass

- Guideline 3.2 downgraded from "hard bar" to "real, inconsistently-enforced risk" (Walmart
  counter-precedent found) — now a decision fork, not a mandate.
- Account deletion promoted from "maybe contingent on distribution model" to a flat requirement
  either way (no ABM exemption found, unlike 4.8's confirmed exemption).
- Privacy manifest necessity independently confirmed (Capacitor's bundled manifest read directly —
  it's an empty declaration, not a superset).
- Icon/splash polish demoted from Foundation-blocking to final, non-blocking (F2) — it gates nothing.
- Added the TestFlight-internal fast milestone the first pass didn't call out.
- ABM's EIN-vs-D-U-N-S claim confirmed but scoped: applies to Apple Business enrollment itself, not
  confirmed for the separate paid Developer Program (still shows D-U-N-S) — verify live at signup.

## 5. What resisted maximum parallelism

Most native-iOS work collides on the same handful of files (`Info.plist`, `project.pbxproj`,
entitlements) — F1/F2 can't be meaningfully split across sessions, they're one lane by nature. App
Store Connect metadata and the ABM/Developer enrollment itself are pure owner/ops work, not
delegatable to a coding session at all. F1 cannot be build-verified in this environment (no
Xcode/macOS) — every native change carries an explicit owner on-device/Xcode verification gate,
same convention as this repo's other "owner-gated" items.

## 6. Status

- [x] Phase F1 — code shipped 2026-07-17, PR #451 merged into `dev`; **still owner-gated** on Xcode build-verify (cannot be compile-verified in the Linux env — see §5 / F1 block)
- [x] Phase A — built 2026-07-17, PR #452 merged: `device_tokens` RLS scoped to own-row-or-admin (migration applied live to the shared Supabase + verified), `send-push.js` admin-role-gated + `400 BadDeviceToken` pruning, guarded `markBundleReady()` on App mount.
- [x] Phase B — dispatched 2026-07-17, PR #454 merged (migration applied live)
- [x] Phase D — dispatched 2026-07-17, PR #453 merged
- [x] Phase F2 (non-Xcode slice) — icon/splash + `/support` page + ASC metadata packet, 2026-07-17, PR #455 merged
- [ ] Owner: kick off Apple Developer Program + ABM enrollment
- [ ] Owner: distribution-model decision (§0)
- [ ] Owner: Xcode build-verify of F1 before any real device sees it
- [ ] Owner: merge PRs #451/#452/#453/#454 into `dev`
- [ ] Owner: screenshots + demo credentials + App Store Connect data entry
