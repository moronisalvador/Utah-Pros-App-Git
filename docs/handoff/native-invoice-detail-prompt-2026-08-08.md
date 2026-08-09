# Cold-session prompt — native invoice detail

Owner asked for this on 2026-08-08, twice, after finding that Collections rows on the phone are
dead taps: *"I can't tap a name or invoice from the list to open the invoice, look at it, edit,
send it to customer or collect payment"* and *"I thought we made this possible because invoices and
estimates are practically the same thing"* — which is fair, since `AdminEstimateEditor` and
`AdminEstimateDetail` both ship natively today.

Paste everything below the line.

---

Port `AdminInvoiceDetail` to the UPR iOS app so an invoice row in native Collections opens, views,
sends and collects payment — the gap the owner hit on 2026-08-08.

Read first: `.claude/rules/initiative-status.md` ("Native office surfaces"), `BILLING-CONTEXT.md`,
`.claude/rules/database-standard.md`. Do not re-derive their evidence.

WHY IT WAS DEFERRED — two concrete blockers, both verified 2026-08-08, both fixable:

1. **No idempotency key on the payment insert.** `src/components/admin-mobile/invoice/recordPayment.js`
   says so in its own header at line 26: *"there is no insert-level idempotency key, so a second
   call while one is [in flight]"*. AGENTS.md §15 requires a **stable content-derived or
   client-supplied** key for any money mutation — **never `Date.now()`**. On a phone with one bar in
   a driveway, a retried tap is a double-posted payment. This is the real reason the estimate screens
   shipped and this one did not; they send a document, this one moves money.

2. **`AdminInvoiceDetail.jsx:48` imports from the BARREL** — `from '@/components/admin-mobile'`.
   The native build aliases that barrel to `nativeAdminMobileShim.js`, which exports no components,
   so `AdminMobilePage` and `MoneyStatCard` arrive `undefined` and the screen renders **BLANK with
   the build green and the module-graph guard silent**. Six files had this exact defect on
   2026-08-08. Convert to concrete paths and check `PaymentSheet.jsx` and the rest of the
   `invoice/` subtree for the same thing before building.

DO THIS, IN ORDER:

1. **The idempotency key first, with its test.** Derive it from content that is stable across a
   retry of the SAME payment and different for a genuinely new one — invoice id + amount in cents +
   the payment date + method, not a timestamp taken at call time. Prove a double-submit lands one
   row. `recordPayment.test.js` exists; extend it rather than starting a second file.

2. **Trace the server side before trusting the client.** Verify what `recordPayment` actually
   writes and which trigger owns which column — `amount_paid`, `line_total`, `status` and `paid_at`
   are **trigger-owned and must never be written directly** (AGENTS.md §15). Check whether the
   QuickBooks path is reachable from this screen and whether the human Save-to-QuickBooks gate is
   preserved; no automated path may call `/api/qbo-invoice`.

3. **Deep imports, then the carve-out.** `AdminInvoiceDetail.jsx` into `NATIVE_PAGE_ALLOWLIST`
   (97 today) and `invoice/{PaymentSheet.jsx,invoiceMath.js,recordPayment.js}` into
   `NATIVE_ADMIN_MOBILE_ALLOWLIST` (33 today). SORTED — both arrays are asserted against their own
   `.sort()`, and TWO files pin them with CI running both:
   `tests/qa/unit/native-bundle-boundary.test.js` AND `scripts/native-bundle-boundary.node-test.mjs`.
   `AdminInvoiceDetail` and `recordPayment.js` are currently in the boundary test's explicit DENY
   list — remove them from it in the same change.

4. **Re-open the deep links.** `src/components/admin-mobile/collections/collFormat.js` nulls
   `invoiceHref` when `VITE_BUILD_TARGET === 'native'` precisely because this route did not resolve.
   That guard comes out once the route exists. Three row builders route through it; there is a test
   pinning the null behaviour — update it, do not delete it.

5. **Run `npm run build:ios`** and let it name transitive modules you missed. Add each individually
   with a reason, never by prefix.

DESIGN: match the shell it lands in. `AdminMobilePage`, `AmListRow`, `MoneyStatCard`, the `am-*`
class family, the card rhythm Collections and Lead Center already use. `PaymentSheet` is a sheet —
`apple-design` for the sheet feel, `motion-standard.md` for the non-negotiables
(`prefers-reduced-motion` on every transition and keyframe, press feedback from the ONE shared
`:where(.tech-layout) :where(button)` rule — restating a scale compounds it and
`tests/qa/unit/tech-press-feedback.test.js` will fail you). Invoke `review-animations` by name at
close-out; it does not auto-fire.

VERIFY: `npm run build:ios` + `node scripts/assert-native-dist.mjs` (NEVER `npm run build`),
`npm test` (set `UPR_TEST_LANE`; `tests/qa/unit` is the qa lane), `npm run test:tooling`,
`npm run report:bundle-size`, then the SIMULATOR on BOTH accounts. Build the `.dev` app, not `.upr`:

```
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Dev -sdk iphonesimulator \
  -destination 'id=<udid>' -derivedDataPath <dd> build
xcrun simctl install <udid> <dd>/Build/Products/Dev-iphonesimulator/App.app
xcrun simctl launch <udid> com.utahprosrestoration.upr.dev
```

Screenshots via `xcrun simctl io <udid> screenshot --type=png out.png` — the MCP simulator panel
crashes. **An agent must not sign in**; the logged-in checks are owner-gated.

MONEY TESTING: the narrow test-customer exception (AGENTS.md §15, owner-directed 2026-08-05) allows
driving a real save/receive-payment end to end ONLY against a QuickBooks customer whose numeric
`CustomerRef` is in the `BILLING-CONTEXT.md` §0 allowlist, ONLY under $10, and ONLY if you delete
every record you created before the session ends. Match by **QBO customer ID, never display name**.

SHARED CHECKOUT: `git fetch` first and confirm `git rev-parse --abbrev-ref HEAD` says `dev` — a
session switched the main folder to another branch on 2026-08-08 and commits landed there silently.
Stage by explicit path; reconcile by merge, never rebase. A red `npm test` may be another session
writing mid-run — re-run before believing it.

OUT OF SCOPE: the QuickBooks sync protocol itself; `Collections.jsx` (the office screen) — this is
the native detail only.
