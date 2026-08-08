# Session state — e-sign document expansion (2026-08-07)

Handoff for resuming after a context compaction. Everything below is verified,
not remembered — commit SHAs, ledger versions and test counts were read back off
git and the live catalog at the time of writing.

**Status: shipped to `dev` and applied to the shared database. Four small items open.**

---

## 1. What this was

Started from a real job: a homeowner's carpet was contaminated by Category 3
water, the tech needed a signature before cutting, and UPR could only send five
fixed documents. There was no way to put *that* situation in front of *that*
client.

Shipped in two parts:

- **Phase A — six fixed situational authorizations.** `cat3_removal`,
  `emergency_demo`, `coverage_unconfirmed`, `service_declined`,
  `equipment_early_removal`, `access_release`. Reviewed wording committed to the
  repo and seeded into `document_templates`. Available to field techs.
- **Phase B — one free-text `other` ("Custom Authorization").** Composed by
  office staff, snapshotted onto the request at send time so the wording cannot
  drift after the link is sent. Restricted to admin / office / project_manager.

### Owner decisions — locked, do not re-litigate

1. Both phases, one build.
2. Techs get the six fixed types; free text is admin / office / project_manager.
3. Snippet text lives in **code**, not the database — git history of legal
   wording is worth more here than editability.

---

## 2. Landed

Five commits on `dev`, all pushed:

| SHA | What |
|---|---|
| `fb55419d` | migrations + rollbacks for both phases |
| `a67cb994` | six situational types, custom document, role gate, three drive-by fixes |
| `60a6d70d` | three test files (97 assertions) + `UPR-Web-Context.md` (Rule 9) |
| `227504e8` | missing template must REFUSE, never fall back to CoC text |
| `ad1a788b` | native build-target guard (see §5) |

**Applied to the shared Supabase** (production — one database sits behind both
`dev` and `main`), with postflight:

| Ledger | Postflight |
|---|---|
| `20260807225846_esign_custom_authorization_snapshot` | 3 nullable columns; new RPC SECURITY DEFINER, `search_path` pinned, PUBLIC revoked before GRANT; **`create_sign_request` still a SINGLE overload** |
| `20260807230037_esign_situational_authorization_templates` | 6 rows, one per type, each body **md5-identical** to the committed file; existing 24 rows untouched |

Nothing else of mine is pending apply.

---

## 3. Three defects found and fixed along the way

1. **The obvious design would have taken production down.** Adding parameters to
   `create_sign_request` via `CREATE OR REPLACE` creates a *second* overload, not
   a replacement. `send-esign.js` posts exactly seven named keys, both candidates
   would match, PostgREST answers PGRST203, and **every** e-sign send fails on dev
   and production at once. The migration therefore never touches that function —
   the worker writes the snapshot with a follow-up service-role PATCH.
   `esign-custom-authorization-contract.test.js` asserts the string
   `create_sign_request` never appears in that migration. **Do not "simplify" this.**
2. **A missing template silently produced a completion certificate.** Both readers
   fell through to CoC boilerplate — *"the work is 100% complete and I have no
   outstanding complaints"* — which would have been baked into a signed, stored,
   emailed PDF filed as `category='contract'` on a document authorizing emergency
   demolition. Now a hard refusal on both sides (`ESIGN_TEMPLATE_MISSING`,
   error screen on `SignPage`). `coc` is the one legitimate exception.
3. **I introduced the bracket bug myself.** Four templates had `[Describe…]`
   prompts that print verbatim on the signed PDF — the same flaw `change_order`
   has shipped with for months. Reworded to reference the project record instead,
   which also keeps access codes out of an emailed PDF.

Also fixed: `{{date}}` resolved on screen but printed literally in the PDF;
`escHtml` was not applied to the document label in either confirmation email; and
the CRM timeline labelled every signed document a green **"Work Auth"** pill
(fixed in the frontend from the payload's `doc_type` — no live-RPC replacement).

---

## 4. Verified — and how

- `npm test` **5,298 passed / 0 failed** across the three credential-free lanes.
- `npm run build` clean · migration hygiene 0 failures · **zero lint regressions**
  (`SendEsignModal` improved 6 → 1 by moving style constants above the component).
- **Desktop, real admin session in Chrome:** picker groups render; Cat 3 hides the
  CoC-only scope selector; compose UI with 5 skeletons, counters, 13 token chips;
  bracket guard refuses with the exact prompt named.
- **Signer:** both documents rendered the real text, **not** the CoC boilerplate.
  Signed a Custom Authorization end to end. Pulled the stored PDF and rendered it —
  title, sections and wording **match the screen exactly**, signature block with IP
  and timestamp, and correctly **no** company countersignature.
- **Database after signing:** `status=signed`, IP captured,
  `custom_snippet_key=advised_and_authorized`, body stored with tokens
  **unresolved** as designed, `job_documents` row, one `esign.signed` event.
- **Native iOS, correct bundle, real `field_tech` session:** the six situational
  types render in a clean 2×3 grid at phone width; **"Write a custom document" is
  correctly absent** for the tech (it is present for admin). Role gate confirmed.

### NOT verified

- **Full signature flow from the tech shell** — the sheet was verified, but no
  sign-through was completed from native.
- **Email or text delivery** — never exercised; would message real contacts.
- Drawn signature (typed was used). Production `utahpros.app` is untouched.

---

## 5. The trap that cost the most time

`npm run build` produces the **WEB** bundle. `npm run build:ios` produces the
native one. A web bundle inside the native shell sets `IS_NATIVE_BUILD=false`,
silently disables deep links, and ships the whole office/CRM/admin surface —
**and nothing reports it at runtime.** I hit this exactly: the simulator came up
with Collections, New Estimate and Lead Center, and the owner recognised them as
screens that have never been in the real app.

`ios/App/App/public` is gitignored, so nothing downstream would have caught it;
an Xcode archive from that tree would have shipped the web bundle to TestFlight.

**Fixed in `ad1a788b`:** `scripts/assert-native-dist.mjs` now also runs as a
`capacitor:copy:before` package.json hook, so every route into the app bundle
passes it — including a bare `npx cap sync ios`. Proven by reproducing the
mistake: guard fires, `✖ copy ios - failed!`, "Copying web assets" never runs,
previous native bundle left intact.

**Known gap, deliberately not papered over:** `cap sync` still exits **0** when
its copy step fails.

### Practical simulator notes

- Two accounts: **Moroni Salvador** (admin) and **Moroni Tech** (field_tech).
  Verify both — the tech session is what proves nothing leaked.
- The simulator MCP screenshot service crashes repeatedly.
  `xcrun simctl io <udid> screenshot --type=png out.png` works reliably; taps
  through the MCP control tool are fine. Simulator udid used:
  `09D3CEB3-763A-4E3D-9155-7ED939518137`.

---

## 6. Open items

### Owner-only

1. **`.claude/rules/database-standard.md` §2 needs an allowlist line** for
   `get_sign_request_custom_text`. Only the owner may amend `.claude/rules/`, so
   the grant is applied but not yet legitimate under project law. Suggested:

   ```
   - **public e-sign custom text** → `get_sign_request_custom_text`
     (token + doc_type='other' + pending + unexpired)
   ```

2. **Decide** whether to delete the test-signed Custom Authorization on job
   **W-2607-003** (Moroni Salvador, a test client). Left in place as evidence.

### Work to finish (owner already authorized)

3. **Full signature flow from the tech shell**, plus **email and text delivery**,
   using Moroni Salvador as the test client.
4. **Address doubled comma.** On a job whose `address` field holds the whole
   address with `city` empty, templates render `…United States, , UT`.
   Pre-existing — Work Authorization does the same. Fix is a `{{property_address}}`
   token that joins only non-empty parts, added to BOTH `substituteVars`
   implementations (`SignPage.jsx` and `submit-esign.js`) with a parity test.
5. **Compose validation error renders below the fold** in `SendEsignModal` — the
   user clicks send and appears to get nothing. Should scroll into view.

### Not mine, but red in the tree

The other session's untracked `supabase/tests/oop_estimate_grouped_lines.test.sql`
is missing from the inventory in `tests/qa/unit/db-lane-coverage.test.js`, so that
test fails locally. It will not fail CI (their file is uncommitted). Leave it —
it is their active lease.

---

## 7. Where things live

| Concern | File |
|---|---|
| Template wording (repo copy) | `src/pages/settings/templates/templateData.jsx` → `DEFAULT_TEMPLATES` |
| Template wording (signing path) | `document_templates` rows — **this is what clients actually sign** |
| Free-text skeletons | `src/lib/customDocSnippets.js` (plain `.js`, no JSX — keeps it out of the office chunk) |
| Role list, frontend | `src/lib/claimUtils.js` → `CUSTOM_DOC_ROLES` |
| Role list + validation, server | `functions/lib/esign-custom-doc.js` |
| Send | `functions/api/send-esign.js` |
| Sign / PDF | `functions/api/submit-esign.js` |
| Signer page | `src/pages/SignPage.jsx` |
| Pickers | `src/components/SendEsignModal.jsx`, `src/components/tech/EsignRequestSheet.jsx` |

**Two duplications that must stay in sync,** both pinned by tests:

- Template bodies exist in `templateData.jsx` **and** in the migration.
  `templateData.jsx` is only the Settings editor's fallback; the **database row is
  what gets signed**. `esign-situational-authorizations.test.js` asserts they are
  character-for-character identical.
- `CUSTOM_DOC_ROLES` exists in `src/` **and** `functions/` — `functions/` is a
  separate Cloudflare bundle and cannot import from `src/`.

**Twelve doc types, and the label string for each is duplicated across seven
surfaces.** None imports another; all seven are pinned by
`esign-situational-authorizations.test.js`. Keep labels ≤ 45 characters —
`submit-esign` draws the PDF title with an unwrapped 18pt `drawText` into a
500pt column.

**Honest scope of the role gate:** `sign_requests` carries four always-true RLS
policies and `create_sign_request` is `SECURITY DEFINER` with no caller check
granted to `authenticated`. The accurate sentence is *"the worker refuses; the
database does not."* Never report it as enforced at the database layer. Narrowing
that is its own initiative — `database-standard.md` §5b requires per-role ALLOW
**and** DENY proof on a disposable stack.

---

## 8. Separately authorized — never implied

Migration apply, commit, push, PR, deployment, signed native build, TestFlight
upload, feature-flag flips, provider calls. One Supabase sits behind both `dev`
and `main`, so a migration is a production change the instant it applies.
