# App Store submission strategy — TestFlight now, submit when the gap closes

**Last verified:** 2026-07-30 · Owner decision 2026-07-29 (in conversation).

## The decision

Technicians run on **internal TestFlight** starting 2026-07-30. **App Store submission is
deferred** until the field-documentation suite ships: **dry logs** (with local/offline
storage), the **rooms tool** (documentation, notes, photos), and the finished **Job Hub** —
so post-approval updates are minor fixes, not full feature releases under review each time.
The mobile PWA remains live and liked; it is the fallback channel throughout.

## Why this is right (and one stronger reason)

1. **Iteration speed.** Internal TestFlight has no Apple review; every build is available to
   testers minutes after processing. Building dry logs/rooms against App Review cycles would
   add days per release for zero benefit.
2. **The stronger reason — guideline 3.2/4.2 risk.** UPR is an employees-only internal
   business app. Apple routinely rejects such apps from the PUBLIC App Store and redirects
   them to enterprise channels. When the gap closes, the right submission is likely
   **Unlisted App Distribution** (full App Store infrastructure, hidden from search,
   install-by-link; requires a one-time request form to Apple) or an Apple Business Manager
   Custom App — not a standard public listing. Decide this BEFORE writing metadata; an
   unlisted app needs no marketing screenshots polish and its review focuses on function.
3. **Update mechanics.** Post-approval, every App Store update goes through review
   (usually <48 h, still a queue). Entering that regime with a stable feature set is
   materially less painful.

## TestFlight operating rules (while this strategy is active)

- Builds expire after **90 days** — ship a fresh build well before expiry; never let the
  field crew's install lapse (the PWA fallback softens but does not excuse this).
- Internal testers = App Store Connect team members (cap 100). Invite each tech's Apple ID;
  no beta review needed. External groups WOULD need beta review — stay internal.
- Every build still goes through the full `ios-release.yml` verification (signing, privacy
  manifest, OTA disabled, production APNs entitlement) — TestFlight is not a quality bypass.

## The gap to close before submission (maps to existing plans)

| Piece | Where it stands (2026-07-29) |
|---|---|
| Job Hub H3 cutover | Open, owner-bake-gated (`.claude/rules/initiative-status.md`); one bounded session; unblocks db-foundation P8 |
| db-foundation P8 — signed URLs for job files | Hard-gated on H3; a **prerequisite for photos/documentation done right** (private media, no public bucket reads) |
| Rooms tool | `phase1_rooms` / `phase1_rooms_claim_scoped` / `phase2_hydro` schema applied since April; UI unbuilt |
| Dry logs + offline/local storage | Unbuilt; mobile-readiness contracts exist (`docs/mobile/data-contracts.md`, offline-replay evidence). The offline queue/replay design is the highest-risk piece — masterplan it first |
| Report generation | Depends on the three above |

Suggested order: **H3 bake verdict → P8 signed URLs → rooms UI → dry logs + offline →
reports** — H3 and P8 are gates for everything after them, and offline is the piece that
deserves a `/masterplan` before code.

## Already-true facts a future submission session should not re-derive

- Export compliance: `ITSAppUsesNonExemptEncryption=false` in `ios/App/App/Info.plist`,
  asserted by `scripts/qa/verify-ios-release-artifact.mjs` — HTTPS-only exemption.
- Privacy disclosure: `ios/App/App/PrivacyInfo.xcprivacy` is the reviewed source of truth;
  the verifier pins the exact collected-data-type set (`EXPECTED_COLLECTED_DATA_TYPES`,
  13 types incl. precise location, photos/videos, messages). The ASC App Privacy
  questionnaire must MIRROR the manifest, never contradict it.
- App record `6795664765` exists; metadata/screenshots incomplete by design until the gap
  closes (`docs/app-store-readiness-roadmap.md`).

## Still owner-only at submission time

- The Unlisted Distribution request (or Custom App setup) with Apple.
- A **review demo account** (real login for Apple's reviewer, least-privilege tech role,
  seeded with presentable non-customer data) — created by the owner, never stored in the repo.
- Screenshots/metadata copy sign-off, and the App Privacy questionnaire submission itself.
