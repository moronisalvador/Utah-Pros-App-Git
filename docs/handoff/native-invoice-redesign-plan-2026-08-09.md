# Historical plan — native invoice screen redesign + the missing payment notification

**Written:** 2026-08-09 · **Status:** superseded by Admin Mobile P4c · **Tier:** historical context only

> Do not implement this plan as current direction. The reviewed P4c contract in
> `docs/admin-mobile-roadmap.md` and `docs/admin-mobile-p4c-production-runbook.md` replaces its
> proposed gradient-hero/payment presentation while retaining the relevant historical evidence.

Cold-session usable: everything needed is below, with file:line evidence. Nothing here depends on the
conversation that produced it.

---

## Context

Two problems, both found by the owner using the app on 2026-08-09, right after the invoice screen was
ported to iOS ([PR #623](https://github.com/moronisalvador/Utah-Pros-App-Git/pull/623)).

**1. It isn't a top-tier payment surface.** Owner: *"I don't think we need a huge send to customer
button… I don't feel like this is a top tier invoice and payment collection screen for a mobile
app."* And decisively: *"why are we not using some of the existing record payment flow?… if we're
going from the invoice to receive a payment, then we shouldn't have an option to split it."*

That last sentence is the whole diagnosis. The app already owns a POS-style payment flow built to the
owner's mobile doctrine — `ReceivePaymentMobileFlow` — and this screen ignores it for a long inline
form that predates it. The screen isn't merely plain; it is **off-pattern from a better pattern we
already have.**

**2. Recording a payment fires no notification.** Owner: *"you enter the payment… but it didn't
trigger a push notification."* Correct, and it isn't broken plumbing —
`functions/lib/qbo-payment-sync.js:899-902` says it outright: `payment.received` fires for money
learned **from** QuickBooks, and *"a payment UPR itself recorded was never announced."* The intent was
"don't ping the person who did it"; it shipped as "don't ping anyone", so no other admin ever learns.

## Decisions taken (owner, in conversation 2026-08-09)

| Question | Decision |
|---|---|
| Redesign scope | Invoice screen **+ extract a shared `am-*` kit**, so `AdminEstimateDetail` is a cheap follow-up |
| Money path | **Adopt the Receive Payment path** — one money path, real server-side ledger |
| Flow shape | **Full-screen pushed flow**, not a sheet |
| Notification audience | **All admins except whoever recorded it** |
| Visual reference | The Job Hub screen shipped 2026-08-08 |

---

## The decisive finding: adopting the money path is what makes the notification possible

Today the mobile screen writes `payments` **directly from the browser via PostgREST**, which is
exactly why no notification exists — a client must never be trusted to announce a money event, and the
repo enforces that hard: `notify.js:1231-1240` rejects every Bearer-dispatched type except
`estimate.accepted`, and `notify_emit` is `service_role`-only. There is nowhere legitimate to emit
from. That gap was a **recorded, accepted decision**, not an oversight
(`docs/notify-roadmap.md:299-303`, restated in `UPR-Web-Context.md:30-31`) — both need updating.

Switching to `POST /api/qbo-receive-payment` moves the write into an **authenticated Worker that
already carries the actor** (`actor_employee_id` on the receipt attempt). That is the correct place
for the emit.

**But it does not come for free.** The grouped receipt path *also* stays silent today:
`qbo-payment-sync.js:648` computes `source = 'upr'` for a UPR-initiated receipt, and the emit gate at
`:709` requires `source === 'qbo'`. Adopting the path relocates the emit somewhere legitimate; a
deliberate one-condition change is still needed to fire it.

This **supersedes part of PR #623**: the client-side idempotency key added there is replaced by the
worker's `reserve_`/`mark_`/`finalize_qbo_payment_receipt` ledger keyed on `client_request_id`.

**The one capability this costs:** recording a payment against an invoice not yet in QuickBooks.
Record payment becomes gated on `qbo_invoice_id`, exactly as Send already is, reusing the existing
"Draft — save it to QuickBooks on desktop first" hint.

---

## Two money paths (the evidence behind that decision)

| | **A. Invoice screen** (`recordPayment.js`) | **B. Receive Payment** (`ReceivePaymentMobileFlow`) |
|---|---|---|
| Writes | `INSERT payments` direct via PostgREST | `POST /api/qbo-receive-payment` |
| Order | UPR row first, **then** mirrors to QBO | **QBO Payment first**, then finalises in UPR |
| Idempotency | Client-side only (the key added in #623) | **Server-side ledger** keyed on `client_request_id` |
| Produces | a `payments` row | a `payments` row **plus** `payment_receipts` / `payment_receipt_attempts` |
| Unsynced invoice | Works — records in UPR, reports `qboSkipped` | **Cannot work** — no QBO invoice to pay |

---

## Design direction

### What "match the Job Hub" can and cannot mean

Job Hub is a **Tech Mobile** surface: `tv2-hub-*` classes, `--tech-*` tokens, dark-mode capable.
Admin Mobile is, by explicit design-system rule, a **Main/Shared `.am-*` composition** that is
*"accepted light-only until its `.am-*` tokens receive a separately reviewed dark-theme contract"*
(`UPR-Design-System.md:218`). So copy Job Hub's **structure, hierarchy and idioms** into the `am-*`
vocabulary — do **not** borrow its class names. Dark mode stays a known, untouched gap.

Usefully, `/tech/admin/*` renders **inside** the tech shell, so `--status-*`, `--tech-min-tap`,
`--tech-radius-card` and `--tech-nav-height` already cascade and can be used directly.

### The Job Hub DNA worth copying

1. **Full-bleed hairline sections, not floating cards** — `padding: var(--space-4); border-top: 1px
   solid var(--border-light)`. No radius, no shadow, no margin. Borders, not elevation.
2. **Micro-labels for section titles** — `12px/700/uppercase/0.06em/--text-tertiary`.
   `job-hub.css:360` says this one rule is *"what makes every section read as part of the app."*
3. **A saturated division-gradient hero with white ink**, one dominant 26px/700/-0.02em line.
4. **Icon-only 36×36 actions top-right of the hero** — exactly the slot the owner asked for.
5. **One full-width fixed accent bar in the thumb zone** for the single primary action.
6. **Status urgency via a red-tinted alert card above everything else** (`.tv2-hub-wa-alert`).
7. **Near-motionless** — four transitions in the whole stylesheet; press feedback inherited from the
   shared shell rule at `index.css:10894-10898` (never restated, or it compounds).

### The redesigned invoice screen

**Hero** (gradient from the job's division — the same `DIV_GRADIENTS` in `techConstants.js:72-79`):
- back chevron 48×48 left; **paper-plane Send, 36×36, top-right** — the owner's actual request.
  `AdminMobilePage` **already accepts an `action` prop** rendered in exactly that slot
  (`AdminMobilePage.jsx:51`, `.am-page-action` at `index.css:5054`), so this needs no new shell
  plumbing — just a new `IconSend` in the already-native-allowlisted `icons.jsx`.
- customer name, 26px/700 white — the dominant line
- sub-line: doc number · job number · division
- white status pill with division ink (Job Hub's exact outlier pattern)
- translucent 40px pills for **Customer · Claim**, replacing two meta rows

**Overdue alert** — when past due, a `--status-paused-*` tinted card directly under the hero reading
"5 days overdue". Today that urgency is lost on arrival: the Collections row says "5d overdue" and the
detail screen only says "Due Aug 4, 2026".

**Money** — balance due as the hero number (tabular-nums); Invoiced and Collected demoted to a quiet
two-up of jobstat-style tiles (`job-hub.css:330-339`). Today all three are near-equal cards; on a
collections screen the balance *is* the screen.

**Primary action** — **Record payment** as the fixed full-width accent bar, `min-height: 56px`, at
`bottom: calc(var(--tech-nav-height) + max(12px, env(safe-area-inset-bottom)))`, scroll region padded
to clear it. Send is no longer a button at all.

**Collapsed by default** — Details (due, emailed, In QuickBooks, address) and Line items (count on the
label). Payments history stays open; it is the second reason to open this screen.

### The payment flow — new route `/tech/admin/invoice/:invoiceId/pay`

Three steps instead of Receive Payment's four; the customer and invoice are already known, which is
exactly the split step the owner said shouldn't be there.

| Step | Content |
|---|---|
| `amount` | Pre-filled with the full balance. The common path is one tap through. |
| `method` | Method chips + reference, with **More options** (date, payer, deposit account) behind a disclosure |
| `confirm` | Amount as a hero, two-tap arm-then-fire |

Lift verbatim from `ReceivePaymentMobileFlow.jsx`:
- the **hoisted `Step` wrapper** (`:174-196`) — WAAPI slide, imperative `prefers-reduced-motion`
  check, ancestor scroll reset (the tech shell scrolls, not `window`), and **no `fill: 'forwards'`**
  (a resting transform makes the wrapper a containing block and breaks the fixed footer —
  `motion-standard.md` §5)
- the pinned footer (`:119-128`): **`position: fixed`, never `sticky`** — sticky floated mid-list
  inside the tech shell and the owner caught it 2026-08-06
- `nextRequestIdentity()` (`paymentAllocation.js:56-66`) — canonical-payload UUID that survives an
  unchanged retry; this is what makes the server ledger idempotent
- the exhaustive disarm list; `shouldDisarmReviewOnBlur` where a field sits near the confirm button
- the deposit-account default chain (valid current → remembered in `localStorage` → first Bank)

**Data:** reuse `GET /api/qbo-receive-payment?contact_id=…` and filter to this invoice. It
over-fetches the customer's other open invoices, which we discard — the method and deposit pickers
are only available from that call. A `?invoice_id=` variant would be tidier but is a worker change;
not worth it in this pass.

**Watch out:** `onSelectContact`/`onClearContact` hardcode the `/collections/receive-payment` route,
and the flow has no success screen of its own (the page replaces its whole render). Both need
handling in a new host.

### The shared kit (owner-chosen)

Extract as `am-*` primitives so estimate detail is a follow-up, not a rewrite. `am-inv-*` is used by
exactly two files today, so the blast radius is contained.

`am-doc-hero` (gradient hero + pills + icon action) · `am-alert` (status-tinted) · `am-section`
(hairline + micro-label head) · `am-money` (tabular hero number) · `am-dock` (fixed primary action) ·
`am-sheet` (bottom sheet on `useDialogLifecycle`, modelled on `HubMoreSheet` — **not** `AdminJobMenu`,
which has no entry animation and no dialog lifecycle).

---

## Item 2 — the notification, concretely

Reuse `notifyPaymentReceived` (`functions/lib/qbo-payment-sync.js:103-152`) — already exported and
already serving `qbo-charge.js` and `stripe-webhook.js`, so a fourth source is idiomatic. Do **not**
write a second producer.

- **Actor exclusion needs no `notify.js` change at all.** `body.exclude_employee_id` already exists
  and is applied on the role-fallback branch `payment.received` uses (`notify.js:335`). Precedents:
  `feedback-notify.js:139` (catalog audience literally reads *"Admins minus the submitter"*) and
  `send-message.js:455`. Thread a `recordedBy` param into `notifyPaymentReceived` and set
  `exclude_employee_id`. Source the id **server-side, never from the request**:
  `trustedAttempt.actor_employee_id` for a receipt (`qbo-payment-sync.js:647`), `payments.recorded_by`
  otherwise — the latter is RLS-pinned to `auth.uid()`'s employee
  (`20260804120100_billing_editor_role_boundary.sql:111-124`), so it is trustworthy by construction.
- **Occurrence identity:** `payments.id` for a per-invoice payment;
  `` `upr:${realmId}:${qboPaymentId}:${allocation.invoice_id}` `` for a receipt, mirroring the QBO
  side so one alert lands per invoice. Non-guarded types don't need a UUID; its real job is the APNs
  `apns-collapse-id`, so retries merge.
- **Idempotency comes from the emit GATE, not the key.** A scar worth respecting —
  `qbo-payment-sync.js:651-658` records that on 2026-08-06 a sweep *"announced 14 already-recorded
  payments to every admin because only `existingReceipt` was checked."*
- **Failure stays non-fatal** (`:104`/`:151`) — a lost notification must never lose a payment.

### Two things this must not break

1. **The QBO webhook arrives seconds later for the same payment.** It must still land on the
   `'already-synced'` skip (`:771`) or the payment is announced twice — once by us, once by the
   mirror. `qbo-charge.js:126-128` documents relying on exactly this.
2. **`payment.voided` symmetry.** The retraction is deliberately filtered to `source === 'qbo'`
   (`:899-902`, `:927`) *because* UPR-recorded payments were never announced. The moment they are,
   that filter is wrong and you get an announced payment whose void is never retracted — the exact
   asymmetry the 2026-08-07 work existed to fix. **It is pinned by source-text assertions in
   `tests/qa/unit/payment-voided-notification.test.js:93-103`, so the void side and those tests change
   in the same commit.** This is the part of item 2 that is bigger than it looks.

### ⚠️ A consequence worth an owner decision

`payment.received` is one of only three types with `email_default = true`
(`20260703_notify_f2_foundation.sql:143`). Switching this on doesn't just push — it **emails every
admin on every recorded payment.** If payments get recorded often that is real inbox noise. Decide
before shipping.

---

## Sequencing

Three phases, serialized — they share `qbo-payment-sync.js` and the invoice screen, so there is no
honest concurrency here.

1. **Notification** — smallest, independently shippable, no UI risk. Emit gate + `recordedBy`
   exclusion + the `payment.voided` symmetry fix and its test pins. **It fixes the gap for the
   grouped receive-payment flow already in use today**, before the invoice screen changes at all.
2. **The shared `am-*` kit + the redesigned invoice screen**, still on the current money path. Pure
   presentation; if the money-path swap slips, this still lands and the screen is already better.
3. **The payment flow swap** — new pushed route, receive-payment path, `recordPayment.js` retired.
   Highest risk, goes last, behind the same money-test discipline as #623.

**Artifact tier 1 — this document only.** No roadmap, dispatch doc or ownership manifest: one
initiative, sequenced work, on files no other active lease claims.

## Files

**Redesign:** `src/pages/tech/admin/AdminInvoiceDetail.jsx` · new
`src/pages/tech/admin/AdminInvoicePay.jsx` · new step components under
`src/components/admin-mobile/invoice/` · `src/components/admin-mobile/icons.jsx` (add `IconSend`) ·
the `§ADMIN-MOBILE: INVOICE` block in `src/index.css` (7,258 B at lines 5441-5548; 54,260 B of
headroom under the 595,000 B gate).

**Wiring:** `src/App.jsx` · `src/routes/buildTargetPages.native.jsx` ·
`scripts/native-bundle-boundary.mjs` **and both pinning files** — deny-by-default, sorted arrays,
`tests/qa/unit/native-bundle-boundary.test.js` + `scripts/native-bundle-boundary.node-test.mjs` must
change together.

**Notification:** `functions/lib/qbo-payment-sync.js` (emit gate, `recordedBy`, **and the
`payment.voided` retraction filter**) · `tests/qa/unit/payment-voided-notification.test.js` ·
`docs/notify-roadmap.md` and `UPR-Web-Context.md:30-31`, which both document the silence as accepted.
**`functions/api/notify.js` needs no change.**

**Superseded:** `recordPayment.js` and `PaymentSheet.jsx` lose their caller. Delete only after the new
path is verified — and check `InvoiceEditor.jsx:486-491` and `ClaimBilling.jsx:123` first, which carry
their own copies of the same direct insert.

## Verification

1. `npm run build:ios` — **zero boundary violations**; `node scripts/assert-native-dist.mjs`.
2. `npm test` (all three lanes), `npm run test:tooling`, eslint on changed files.
3. `npm run report:bundle-size` — all three blocking budgets; record entry-graph and `index.css`
   deltas measured against a stashed clean tree.
4. **Simulator, signed in, on real data** — and **grep the installed bundle for a marker string
   before tapping** (`grep -rl '<marker>' "$(xcrun simctl get_app_container <udid>
   com.utahprosrestoration.upr.dev)/public"`). A stale reinstall cost a full cycle on 2026-08-09.
5. **A real payment end to end** against QBO customer `548`/`565`, under $10 (AGENTS.md §15) — verify
   the `payment_receipts` row, the trigger-updated balance, **the push arriving on a second admin's
   device and NOT on the actor's**, then delete everything created.
6. Reviewers: `worker-security-reviewer`, `design-consistency-checker`,
   `interface-accessibility-reviewer`, `page-behavior-checker`, and **`review-animations` by name** —
   it does not auto-fire and this change is motion-bearing.

## Out of scope

Estimate detail's own redesign (the kit makes it cheap later) · the desktop `InvoiceEditor` · dark
mode for `am-*` · a `?invoice_id=` variant of the receive-payment worker · re-enabling
convert-to-invoice natively.
