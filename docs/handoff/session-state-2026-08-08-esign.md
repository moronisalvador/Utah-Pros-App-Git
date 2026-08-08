# Session state — e-sign verification and defect repair (2026-08-08)

Continues [`session-state-2026-08-07-esign.md`](session-state-2026-08-07-esign.md). Everything
below was read back off git, the live catalog or a produced artifact — not remembered.

**Status: four commits pushed to `dev`. Production promotion is blocked on ONE thing, named in §5.**

---

## 1. Landed

| SHA | What |
|---|---|
| `e9a2840c` | `database-standard.md` §2 — both public e-sign RPCs named (owner-authorized) |
| `b57c7365` | the signed PDF says what the signing screen said — bold runs + address group |
| `44a02857` | send errors scroll into view, both pickers |
| `39996e84` | follow two retired migrations to `docs/archive/migrations` (repairs another session's red `dev`) |

All four are on `origin/dev`. Nothing is on `main`.

---

## 2. The defect this session existed to find

Signing a `cat3_removal` from the native tech shell and **reading the stored PDF back** showed:

> …is `**Category 3 — grossly contaminated**` under the IICRC S500 standard

Literal asterisks, on a signed legal document. `drawWrapped` split on `' '` and drew every body
word in `fReg`, parsing nothing, while `SignPage` rendered the same phrase bold.

**It was mine.** The six situational templates added 2026-08-07 are the only `document_templates`
rows containing `**` — the live `work_auth` row uses capitals, confirmed against a real signed PDF
from July with zero stray asterisks. The custom-document skeletons carry `**` too.

`npm test` at 5,298, eslint, and migration hygiene had all passed over it. **Only reading a
produced PDF caught it.** Do that again before trusting any change to the PDF path.

Fixed in the renderer (`parseBoldRuns` / `stripBoldMarkers`, duplicated across bundles and pinned
by `tests/qa/unit/esign-bold-run-parity.test.js`, which EXECUTES both copies rather than comparing
source text). No migration; also covers office-written custom documents.

Same commit fixes the doubled comma: the address GROUP is collapsed before token substitution, so
the live `work_auth` / `direction_pay` / `change_order` rows are repaired too **without a migration
that edits legally reviewed wording**. A fully populated job renders byte-identical to before.

---

## 3. Verified — and how

- **Full sign-through from the native tech shell**, drawn signature, on the correct native bundle.
  Closes both gaps the previous handoff listed as NOT verified.
- **Text delivery**: `messages` row `status=sent`, provider id `SCI019fdf17bd0279fbb2d02857e8d3be22`,
  correct label, short link.
- **Email delivery**: three Resend messages all `delivered` — the signing link, the signer's copy of
  the signed PDF, and the office notification.
- **A client with no app**: loaded the SMS link in a plain browser — full document, signature pad,
  submit button. The app only intercepts because `/sign/*` and `/s/*` are in the live
  `apple-app-site-association`.
- **dev-vs-production links**: the simulator build sets no `VITE_NATIVE_API_ORIGIN` and defaults to
  dev deliberately. Production is hard-pinned and `capgo-deploy.yml:47` **fails the build** if a
  production channel carries anything else. Unverified: whether Cloudflare's Production variable set
  defines `APP_URL` (it would win over the request origin).

### NOT verified

- **The bold fix on a real produced PDF.** Proven in tests; the worker only runs on Cloudflare, and
  the simulator MCP service crashed before a post-deploy sign-through. **Do this first next session** —
  it is the same method that found the bug.

---

## 4. Two things I reported and then corrected

- **"Consent columns are empty on every signed document"** — WRONG. They are
  `recon_agreement`-specific by design (`submit-esign.js`: *"NULL for other doc types"*); that type
  has four separate checkboxes and its own PDF acknowledgments block. The one signed
  `recon_agreement` (Angela Duty, 2026-04-16) has all four `true` with `consents_signed_at` set. My
  first query ordered by `signed_at DESC LIMIT 8` and simply missed it. **No gap.**
- **"The OOP grouped-lines migration is unapplied"** — stale. It applied as ledger
  `20260808020606` while this session ran. All five migrations behind `dev` are applied; the
  database is AHEAD of production code, which is an argument for promoting, not against.

---

## 5. Production promotion — blocked on provenance, nothing else

`dev` is 29 commits ahead of `main`, carrying e-sign, OOP grouped lines, the QBO email mirror, the
voided-payment fix, the native build guard and the tech hub route guard.

**CI fails on `Validate migration provenance — release freshness`**, not on tests or build:

```
Migration provenance: FAIL; ref=378a5be4; ledger=85; functions=32; policies=8.
```

Locally it PASSES with `WARN Live evidence is 9h old`. CI runs `--strict-freshness`, which rejects
evidence older than six hours. Five migrations applied since the last capture:

`20260807181353_payment_voided_notification_type` · `20260807225846_esign_custom_authorization_snapshot` ·
`20260807230037_esign_situational_authorization_templates` · `20260808020606_oop_estimate_grouped_lines` ·
`20260808034430_invoice_qbo_email_mirror`

**The playbook is known and must not be raced** — `initiative-status.md` records the identical
situation on 2026-08-05 and says explicitly: do NOT promote by waiting for the 6-hour window to
re-open on stale evidence, because the gate would then pass while blind to the applied migrations.

Do this instead:
1. `node scripts/capture-migration-provenance.mjs --print-sql`, run it read-only (the `upr_sql`
   path works; it is SELECT-only), `--assemble` into
   `docs/audit/2026-07/evidence/migration-provenance-2026-08-08.json`, and bump `DEFAULT_EVIDENCE`
   in `check-migration-provenance.mjs`.
2. **Measure drift against live before rewriting any pin** — compare all 32 tracked function bodies
   and 8 policies, and only repoint a hash you can name the cause of. The 2026-08-05 refresh found
   exactly one moved policy and correctly predicted which migration moved it.
3. Add the five `ledgerMapping` entries, each with a `path` that resolves on the release ref.
4. `node scripts/check-migration-provenance.mjs --strict-freshness`, then open the PR.

Three of the five unmapped ledgers belong to other sessions. Capture close to when CI will run —
`capturedAt` starts the six-hour clock.

---

## 6. Open

| # | Item |
|---|---|
| 12 | **Signing-link view tracking** (owner-requested). Half-built already: `link_clicked_at` exists and nothing writes it; `email_opened_at`/`email_open_count` work via `functions/api/track-open.js` and already render on `JobPage.jsx:761`. Full design, including both owner-raised traps, is in the task description. |
| — | **`get_sign_request_by_token`** — token only, no status or expiry predicate, returns claim + policy numbers permanently. Now named in §2 of the standard; narrowing it is a small migration. |
| — | **`job-files` is public-read.** Every signed customer contract PDF is fetchable by anyone with the path. Two orphaned test PDFs from this session still return HTTP 200 (their rows are deleted; I have no storage-delete path). Known debt in §2; deserves its own session. |
| — | **Simulator MCP is dead** — "stopped retrying after repeated crashes". The panel needs reopening before any further native driving. `xcrun simctl io … screenshot` still works; taps do not. |

### Test cleanup done

All four test sign requests deleted along with their `job_documents`, job notes and 8 notifications.
**`system_events` refuses DELETE (`42501`)** — append-only audit, correct design, 6 rows remain. The
two storage PDFs could not be removed and are still public.

---

## 7. Where the new code lives

| Concern | File |
|---|---|
| Bold-run parsing (screen) | `src/lib/signMarkdown.js` |
| Bold-run parsing (PDF) | `functions/api/submit-esign.js` — duplicated, pinned by test |
| Address joining | `src/lib/propertyAddress.js` + the copy in `submit-esign.js` |
| Parity tests | `tests/qa/unit/esign-bold-run-parity.test.js`, `esign-property-address-parity.test.js` |

**Three duplications now exist across the bundle boundary** (labels, roles, and these two helpers).
Every one is pinned by a test that runs both copies or compares both sources. `functions/` cannot
import from `src/`; that is the reason, and the tests are what make it safe.
