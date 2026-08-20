# job-files Privacy — Roadmap & Cold-Session Dispatch

**Authored:** 2026-08-08 · **Hardened and re-verified:** 2026-08-09 · **Phase 1 shipped:** 2026-08-19
**Phase 2 source complete + proven, UNAPPLIED and UNDEPLOYED:** 2026-08-19

**Status:** **PHASE 1 COMPLETE IN PRODUCTION.** Migration applied (ledger `20260816171231`), code
deployed to `dev` and `main`, and all 32 signed documents moved out of the public bucket on
2026-08-19 under owner authorization. Postflight verified independently of the mover's own output.

**PHASE 2: all source written, the readers migrated, the §5b behavioural proof EXECUTED and
PASSED — and nothing applied.** The bucket is still public. Three owner-gated steps remain and they
are listed in §5.0.

**Initiative row:** `.claude/rules/initiative-status.md` — read it first.

**Every number in §1 was re-read from the live database or real source on 2026-08-09, and
re-measured again on 2026-08-19 — see §1.3, which supersedes §1.1 and §1.2 wherever they disagree.**
Re-measure before acting; do not trust this file's counts if you are reading it more than a few days
later.

---

## 0. The problem, in one paragraph

`job-files` is the only public Supabase bucket this project has. `storage.buckets.public = true`,
so `GET /storage/v1/object/public/job-files/<path>` answers **anyone**, with no login, no token and
no RLS evaluation. Behind that URL sit **24 signed customer authorizations carrying claim and
policy numbers**, 34 scope sheets, 4 Xactimate files, reports, and every job photo. Holding the
path is the entire access control.

**Owner requirement, stated 2026-08-08 and binding on every phase:** *signed documents must stay
accessible from the job Files / Documents surface.* A design that makes the PDFs safe by making
them hard to reach has failed, not succeeded.

**Proof the exposure is real, not theoretical:** on 2026-08-09 a session downloaded three signed
Certificates of Completion over plain HTTPS with no credentials of any kind, read the client names,
property addresses and claim numbers out of them, and did it from a shell. Two were the owner's own
test data; the mechanism does not care.

---

## 1. Evidence ledger

Classification per `masterplan` §2: **HAVE** = proven by current code/catalog · **PARTIAL** = exists
but does not meet acceptance · **MISSING** = proven absent · **UNKNOWN** = not established.

### 1.1 Counts move. Re-measure before you act.

Between 2026-08-08 and 2026-08-09 — one day, no privacy work done — every headline number changed:

| Measure | 2026-08-08 | 2026-08-09 | Why |
|---|---|---|---|
| `esign/` objects | 29 | **27** | 3 agent test PDFs deleted (task #15), 1 new real signing |
| `sign_requests.signed_file_path` | 23 | **24** | one real `cat3_removal` signed |
| `job_documents` rows for `esign/` | 23 | **24** | 1:1 with the above, still exact |
| orphaned `esign/` objects | 6 | **3** | the 3 deleted were the agent tests |
| `job_documents` total | 92 | **93** | |
| bucket objects total | 104 | **102** | |

**The move set is a live query, never a constant.** Every step below drives from a query, not from
a number written here. A plan that hardcodes "29" builds a loop that silently skips or double-counts.

### 1.3 Re-measured 2026-08-19 — supersedes §1.1 and §1.2 where they disagree

Read-only SQL against production. **Two claims that were being carried forward as live are now
false**, and a cold session acting on them would do the wrong work:

| Claim carried forward | Measured 2026-08-19 |
|---|---|
| "~29 signed docs still sit in the public bucket" | **0.** `job-files` holds zero objects matching `esign` |
| "3 orphaned `coc-signed-*.pdf` are still public, owner decision pending" | **0.** All three are gone (94 → 91 objects). §7 is closed |
| `job-files` is public | **still true** — this is the one that holds, and it is all of Phase 2 |

Current state of the bucket, which is what Phase 2 is actually about:

| Measure | 2026-08-19 |
|---|---|
| `job-files` objects | **91**, none of them signed documents |
| `job-documents-private` objects | **32** — Phase 1's move, intact |
| `job_documents` rows on the private bucket | **32** (`contract`) |
| `job_documents` rows with `storage_bucket = NULL` | **89** — 43 `demo_sheet`, 25 `photo`, 15 `note`, 3 `water_loss_report`, 3 `xactimate` |
| `sign_requests.signed_file_path` | 32, 1:1 with the private rows |
| `messages` rows embedding a public job-files URL | **4** (E7 unchanged) · 24 rows use the private `upr-storage://` form |
| largest photo set on any ONE job | **5** |

**That last number matters more than it looks.** §5.2 and R5.3 below were written around a
"50-photo grid" and treated batch-signing plus image transforms as the bulk of the phase. The real
maximum today is five, and — see E16 corrected — the transform route was never in the render path
at all. The perf argument that shaped the old plan does not survive measurement.

### 1.2 The ledger

| # | Claim | State | Evidence (2026-08-09) |
|---|---|---|---|
| E1 | `job-files` is public; the other two buckets are not | **HAVE** | `storage.buckets`: `job-files` true (50 MB) · `contractor-compliance-private` false · `message-attachments` false |
| E2 | Four policies on `storage.objects`, all bucket-wide | **HAVE** | `anon_read_job_files` SELECT `{anon}` · `job_files_select` SELECT `{public}` · `job_files_authenticated_insert` INSERT `{authenticated}` · `job_files_authenticated_delete` DELETE `{authenticated}`. All `USING (bucket_id = 'job-files')` with **no further predicate** |
| E3 | Bucket contents | **HAVE** | 102 objects. `demo-sheets/` 34 · `esign/` 27 (1021 kB) · `xactimate/` 4 (5152 kB) · `conversations/` 4 (907 kB) · `reports/` 3 · the rest loose per-job images |
| E4 | **The signed-PDF email ATTACHES the file; it does not link to the bucket** | **HAVE** | `submit-esign.js:408` and `:443` — `attachments: [{ content: pdfB64, … }]`; **zero** occurrences of `public/job-files` in that file. **This is what makes Phase 1 cheap: making e-sign PDFs private is invisible to customers.** |
| E5 | The anonymous signing page never reads the bucket | **HAVE** | `grep job-files src/pages/SignPage.jsx` → no matches. An anon page could not mint a signed URL, so this had to be checked |
| E6 | **Outbound MMS does NOT require `job-files` to be public** | **HAVE — corrected 2026-08-09** | `MESSAGE_MEDIA_BUCKET = 'message-attachments'` (`message-media.js:9`) — a **private** bucket, 53 objects, live since 2026-03-14 and written as recently as 2026-08-08. See E6b. *The 2026-08-08 ledger said the opposite and it drove the whole of the old Phase 2.* |
| E6b | **A private bucket + signed URL for Twilio is already proven in production** | **HAVE** | `messaging-transport.js:61` — `db.signStorage('message-attachments', item.storagePath, 3600)`. Twilio fetches that signed URL. The pattern Phase 2 was afraid of is already shipped and working |
| E6c | The public `job-files/conversations/` path is a **legacy compatibility branch only** | **HAVE** | `message-media.js:178` — reached only when `outboundMessageMediaPath()` returns null, gated `allowLegacyPublic: provider === 'twilio'`, commented "for already-deployed clients that still upload to UPR's old public conversation folder". `messaging-transport.js:52` `if (item.url) return item.url` is the one line that hands Twilio a **public** URL |
| E6d | The deployed client no longer produces those references | **HAVE** | `messageUtils.js:172` and `MessageBubble.jsx:49` both key on `upr-storage://message-attachments/`. No `src` file writes `conversations/` into `job-files` |
| E7 | The 4 `conversations/` objects are **historical display data**, not a send dependency | **HAVE** | Created 2026-07-10 (×2) and 2026-07-24 (×2). 4 `messages` rows embed their public URLs and render them back to staff in history |
| E9 | An active internal employee's browser can mint its own signed URL | **HAVE — R1 passed 2026-08-09** | On `qa-staging`, a real browser session authenticated (200), uploaded to a disposable private bucket (200), minted through `/object/sign/…` (200, `signedUrl` present), fetched the exact bytes through that URL (200), and failed on the public route (400). A second exact-policy receipt proved an unrelated authenticated identity and `anon` were denied sign/delete while the active internal employee succeeded. See R1 below. |
| E10 | A service-role signing helper exists for workers | **HAVE** | `signStorage(bucket, path, expiresIn = 600, { download })` — `functions/lib/supabase.js:175` |
| E11 | **The existing private-bucket precedent is worker-side, NOT browser-side** | **HAVE — corrects the old E11** | `contractor-compliance-private` and `message-attachments` have **zero** rows in `pg_policies` for `storage.objects`. They are reached only by service-role, which bypasses RLS. So Phase 1's browser-signing design has **no working precedent in this repository** |
| E12 | Every reader of a signed PDF | **HAVE** | `JobPage.jsx` :716–725, :749, :797–798 · `TechJobDocuments.jsx` :200, :383, :389 · write side `submit-esign.js:369`. **Three files** |
| E13 | Both Documents surfaces inline the public URL | **HAVE** | `TechJobDocuments.jsx:200` `pdfUrl()` · `JobPage.jsx:749` `pdfUrl` and `:927` `getFileUrl(doc)` |
| E14 | `job_documents.file_path` has two shapes — **but not in the move set** | **HAVE — narrowed** | 93 rows: 20 prefixed `job-files/`, 73 bare. **Of the 24 e-sign rows, 0 are prefixed.** So the mover needs no prefix logic; the *reader* still does, because it renders every category |
| E15 | The native PDF path is Quick Look, not a share sheet | **HAVE** | `TechJobDocuments.jsx:389` → `previewNativeDoc({ url })` → `NativeDocPreview.present({ url })`. The plugin fetches immediately, so a short TTL is safe, and **no URL is handed to another app** |
| E16 | ~~`thumbUrl()` uses the **public** image-transform route~~ **CORRECTED 2026-08-19: `thumbUrl()` had NO CALLER.** | **HAVE — and it changes the plan** | True as written, and irrelevant: every consumer of `usePhotoUpload` destructured `uploadPhoto` ONLY, so `/render/image/public/` was never in the render path. The grids used `techDateUtils.fileUrl` — a plain object URL. `thumbUrl` and `publicUrl` were deleted rather than migrated, and `hooks.test.jsx` now asserts their absence. **This is why §5.2 step 3, "the bulk of the phase", was mostly not work.** |
| E17 | 11 files inline a public URL instead of using a helper | **CLOSED 2026-08-19** | All migrated to `useSignedUrls` / `jobDocumentUrl`. `grep -rn "object/public" src` now returns comments only, and `tests/qa/unit/job-files-bucket-private.test.js` sweeps the whole tree so it cannot regress. The one permitted hit is `functions/lib/message-media.js`, which PARSES a legacy inbound reference rather than building a reader URL |
| E18 | Whether the legacy MMS branch still fires in production | **RESOLVED → E6c/E6d** | It fires only for a client sending a raw public URL; no deployed client does. Treat as vestigial, but **prove it with a log before relying on it** — see R4 |
| E19 | Whether an external system stores a public job-files URL | **STILL UNKNOWN 2026-08-19** | Unchanged, and it is now the single largest open question in front of the flip. See R5 and §5.0 |
| E20 | **Deleting a job does not delete its storage objects** | **HAVE** | `public.jobs` has no soft-delete column; two jobs were hard-deleted and their `sign_requests`, `job_documents`, appointments and invoices cascaded away while the PDFs survived. This is the mechanism that created every orphan in §7 |

---

## 2. Risks that will make this get built wrong

These are the findings that changed the plan. Each is written as the mistake a competent builder
would make, because that is the form that prevents it.

### R1 — The browser-signing mechanism has no precedent here. Prove it before you build on it.

Phase 1 rests entirely on a logged-in browser being able to `POST /storage/v1/object/sign/…` and get
a URL back. That is standard Supabase behaviour, **and this repository has never done it.** Both
existing private buckets are worker-only with no RLS policies at all (E11).

**Do this first, before writing any Phase 1 code** — it is a 20-minute spike that decides the
architecture:

1. On the **`qa-staging` branch** (`uizgwvkvzyldystqrcsk`, never the shared project), create a
   private bucket and the active-internal-employee SELECT policy from §4.3.
2. From a real logged-in browser session, `POST /storage/v1/object/sign/{bucket}/{key}` with
   `Authorization: Bearer <user JWT>`.
3. Confirm a `signedURL` comes back and that fetching it returns the object.
4. Confirm the same call **fails** with the anon key.

**If step 2 fails, stop and re-plan.** The fallback is a worker (`functions/api/sign-job-document.js`)
using the existing `signStorage` (E10) — which has precedent, costs a round-trip, and requires its
own `requireUser` authorization. Do not discover this after the migration is written.

**R1 receipt — PASSED 2026-08-09.** The spike ran against qa-staging project
`uizgwvkvzyldystqrcsk` from a localhost-only browser harness. The initial mechanism receipt was:
Auth 200 · private upload 200 · sign 200 · `signedUrl` present · signed GET 200 with exact content
`r1-browser-signed-url-spike` · public GET 400 · object delete 200. After security review tightened
the policy, a second browser receipt used the exact active/internal predicate: upload 200 · active
employee sign 200 · signed GET 200 with exact bytes · unrelated authenticated sign 400 · unrelated
authenticated delete 400 · anon sign 400 · active employee delete 200 · public GET 400. A guarded
local SQL behavior test also proved inactive and external employees cannot read. All disposable
users, employee rows, objects, policies and harness/server files were removed; final qa readback was
0 objects, 0 temporary policies, 0 disposable Auth users and 0 disposable employee rows. The empty
private spike bucket remains because Supabase blocks direct SQL bucket deletion. No shared-project
or production state changed.

### R2 — `db.apiKey` is the JWT. The name lies.

`src/lib/supabase.js:163` exports `apiKey: token || SUPABASE_ANON_KEY`. It is the **user's access
token**, not the project API key. `JobPage.jsx:916` therefore sends
`Authorization: Bearer ${db.apiKey}` and that is correct.

**The trap:** a builder who "corrects" this to `SUPABASE_ANON_KEY` makes every signing call
authenticate as `anon`. Against the §4.3 policy that fails closed — and the tempting next "fix" is
to add `anon` to the policy, which reopens the exact hole this initiative exists to close.

**Rule: never add `anon` to a policy to make signing work. If signing fails as `anon`, that is the
policy working.**

### R3 — §4.3's "mirror the job-files posture" would import a known defect

The 2026-08-08 draft said the new bucket's INSERT/DELETE policies should "mirror the job-files
posture the app already relies on." That posture is
`FOR DELETE TO authenticated USING (bucket_id = 'job-files')` — **any authenticated employee can
delete any object in the bucket**, which the same document lists in §8 as a real pre-existing
defect. Those two statements contradict each other.

**Resolution: do not mirror it.** The new bucket is new; there is no legacy to preserve. See §4.3
for the policies to write instead. Carrying a known defect into a new object because the old one has
it is how a security initiative ships a security bug.

### R4 — One line decides whether flipping the bucket breaks MMS

`messaging-transport.js:52`:

```js
if (item.url) return item.url;   // ← the ONLY path that hands Twilio a public job-files URL
```

`item.url` is set only by the legacy branch (E6c). Every current send takes the signed-URL path
(E6b). **Before Phase 2 flips the bucket**, prove the legacy branch is cold: add a counter or log
line to that branch, deploy, and watch it for a week. If it never fires, delete the branch in the
same change that flips the bucket. If it does fire, find out which client is still doing it.

Do **not** flip the bucket and "see if anything breaks" — the failure mode is a customer not
receiving a picture, which nobody reports.

### R5 — E19 is the one genuine unknown left

Nothing proves an external system does not hold a public `job-files` URL. `GoogleDriveButton.jsx`
writes into the bucket. Reports may have been emailed. Before Phase 2:

- grep the repo for `public/job-files` outside `src`/`functions` (docs, templates, seeds);
- check whether any Encircle, Google Drive, or report integration stores a URL rather than a path;
- accept that a URL pasted into an email months ago cannot be recalled — **decide explicitly** that
  breaking it is acceptable, rather than discovering it.

Phase 1 is unaffected: e-sign PDFs are attachments, never links (E4).

### R6 — The move step is per-object or it is a half-broken surface

> **EXECUTED 2026-08-19 and this held.** `scripts/move-signed-docs-private.mjs` implements it, and
> went one step further than the `move` described below: copy → verify → flip the row → delete the
> public copy. `move` leaves a window where the row still says `job-files` and the object is already
> gone; copy-first has no such window. 32/32 moved, zero rows disturbed outside the e-sign set.
> The postflight that mattered was SQL against `storage.objects`, NOT the script's own `--verify` —
> a script confirming itself proves only that it is self-consistent.


`storage_bucket` is what switches the reader. "Move all 24, then backfill all 24" means an
interrupted move leaves every un-moved file 404ing the moment the backfill lands — breaking exactly
the surface the owner requires to keep working.

**Per object: `move` → confirm 200 → `UPDATE job_documents SET storage_bucket = … WHERE …` for that
one row.** Every intermediate state is then consistent and an interrupted run is resumable.

---

## 3. Artifact tier

**Tier 1 — sequenced.** One roadmap carrying both phase contracts and the dispatch block, plus one
row in `.claude/rules/initiative-status.md`.

Downgraded from the 2026-08-08 draft's Tier 2. The two phases are serialized with no second lane, so
there is no concurrency to coordinate and a standalone ownership manifest would be maintenance cost
buying nothing. The one real lease — Phase 1 touches `JobPage.jsx`, a shared hotspot — is stated in
§4.2 and mirrored in the initiative row, which is the file other sessions actually read.

---

## 4. Phase 1 — signed documents to a private bucket

**Outcome:** a signed customer authorization is no longer fetchable by anyone holding its path, and
is still one tap away in job Files/Documents for any active internal employee.

**Prerequisite: R1's staging spike has passed.** Phase 1 does not start until browser signing is
proven or the worker fallback is chosen.

### 4.1 Acceptance criteria

1. An anonymous `GET` of a moved PDF's former public URL returns **400/404**, not the file.
2. An active internal employee opens a signed PDF from **JobPage → Files** and from **TechJobDocuments**,
   **web and native**, and it renders. *(The owner requirement. Criterion 2 for a reason.)*
3. Native Quick Look still opens the PDF in-app (`previewNativeDoc`), not Safari.
4. `submit-esign.js` writes new PDFs to the private bucket, and the customer email is **unchanged
   and still carries the PDF as an attachment** (E4).
5. Deleting a signed document from JobPage still removes the object *and* the `job_documents` row.
6. Every `esign/` object that has a `sign_requests` row is moved; **zero** remain publicly fetchable.
7. A document whose `file_path` carries the `job-files/` prefix still resolves (E14 — none are
   e-sign today, but the reader serves every category).
8. **A signed URL is never written to the database, a log, or a message.** It is minted at render
   and discarded.

### 4.2 Owned files and objects

- New bucket `job-documents-private` (`public: false`), its `storage.objects` policies, and one
  additive `job_documents.storage_bucket` column
- `supabase/migrations/<ts>_job_documents_private_bucket.sql` + paired rollback
- New `src/lib/storageUrl.js` — the single signed-URL helper
- `functions/api/submit-esign.js` — private upload target plus the service-only atomic completion
  wrapper that records `job_documents.storage_bucket` before email/notification work
- `src/pages/JobPage.jsx` (**shared hotspot — re-read at HEAD before editing; stage by explicit
  path; verify `git diff --cached --name-only` before committing**)
- `src/pages/tech/TechJobDocuments.jsx`
- `tests/qa/unit/job-documents-private-bucket.test.js`

**Frozen / forbidden.** The customer email body and its attachment (E4 is load-bearing — do not
"improve" it into a link). `conversations/**`. `thumbUrl()` and the photo path. `message-media.js`
and `messaging-transport.js`. The `job-files` bucket flag and its four policies — **Phase 2 owns
all of that**.

### 4.3 Design

**Bucket.** `job-documents-private`, `public: false`, 50 MB limit to match. **Keys are preserved
byte-for-byte** — `{jobId}/esign/{file}.pdf` — so `sign_requests.signed_file_path` and
`job_documents.file_path` need no data migration. Only the bucket changes.

**Policies.** Least privilege per `database-standard.md` §1. Note this is a *narrowing*: `anon`
appears nowhere, and per **R3** these deliberately do **not** copy the `job-files` posture.

```sql
-- SELECT is what lets an authorized BROWSER mint its own signed URL (E9/R1).
CREATE POLICY job_documents_private_authenticated_read ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id = 'job-documents-private'
    AND EXISTS (
      SELECT 1 FROM public.employees employee
      WHERE employee.auth_user_id = auth.uid()
        AND employee.is_active IS TRUE
        AND employee.is_external IS FALSE
    )
  );

-- INSERT: the worker writes new signed PDFs with the service-role key, which bypasses
-- RLS entirely, so no INSERT policy is required for the write path. Add one only if a
-- browser upload path is actually built — it is not in this phase.

-- DELETE: JobPage's delete button is a browser DELETE, so this is required and uses
-- the same active-internal predicate as SELECT.
CREATE POLICY job_documents_private_authenticated_delete ON storage.objects
  FOR DELETE TO authenticated USING (
    bucket_id = 'job-documents-private'
    AND EXISTS (
      SELECT 1 FROM public.employees employee
      WHERE employee.auth_user_id = auth.uid()
        AND employee.is_active IS TRUE
        AND employee.is_external IS FALSE
    )
  );
```

> **If R1's spike shows browser signing does not work**, the SELECT policy is unnecessary — the
> worker signs with service-role — and the whole bucket becomes policy-free like the other two
> private buckets. Decide from the spike, not from this document.

**Column.** `ALTER TABLE public.job_documents ADD COLUMN IF NOT EXISTS storage_bucket text;`
Additive, nullable. **`NULL` means `job-files`**, so all 93 existing rows keep working untouched and
no deployed frontend contract moves (`database-standard.md` §3). Backfill only the moved rows.

**The helper** — `src/lib/storageUrl.js`, the one place a document URL is built. Read **R2** before
touching the headers.

```js
// Mints a short-lived signed URL. Authorizes via the caller's own JWT against the
// storage.objects SELECT policy — no service-role key ever reaches the browser.
//
// `db.apiKey` is the USER'S JWT, not the project API key (supabase.js:163). This
// mirrors JobPage.jsx:916 exactly. See R2 — do not "fix" it to the anon key.
export async function signedDocUrl(db, path, {
  bucket = 'job-documents-private',
  expiresIn = 600,
} = {}) {
  const key = stripBucketPrefix(path);              // E14 — reader serves every category
  const res = await fetch(`${db.baseUrl}/storage/v1/object/sign/${bucket}/${key}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${db.apiKey}`,
      apikey: db.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ expiresIn }),
  });
  if (!res.ok) throw new Error(`sign ${bucket}/${key}: ${res.status}`);
  const { signedURL, signedUrl } = await res.json();  // Supabase has shipped both spellings
  return new URL(signedURL || signedUrl, db.baseUrl).href;
}
```

**Choosing the bucket per document.** One resolver, beside the helper, so no call site branches:

```js
export const bucketFor = (doc) => doc?.storage_bucket || 'job-files';
```

**New signing metadata.** The deployed completion RPC creates the `job_documents` row but has no
bucket parameter. The migration therefore adds a new-named, service-role-only, SECURITY INVOKER
wrapper, `complete_sign_request_with_private_storage(...)`. It calls the deployed RPC and updates
exactly its returned `job_document_id` to `storage_bucket = 'job-documents-private'` in the same
Postgres transaction. If the assignment is not exactly one row, the transaction rolls back, so a
customer cannot finish signing while leaving a private object with unreachable public-bucket
metadata. `submit-esign.js` fails closed if the wrapper is absent and sends confirmation email,
notification and job note only after the atomic call succeeds.

**Reader changes.** `pdfUrl()` in both Documents surfaces becomes async. A private object has no
truthful durable `href`, so private opens are semantic buttons that mint then open; only legacy
public objects remain links with real destinations. The native branch sends the minted URL to Quick
Look. Web opens a blank tab synchronously to avoid popup blocking and deliberately navigates the
current tab if that popup was refused. Resume refreshes reconcile rows by id with a generation guard
so a background mint/read change cannot replace or reorder the already-visible document list.

**An async URL introduces a state that did not exist.** Per `loading-error-states.md`: a failed mint
must not render as an empty document or a dead link — it needs a visible failure. This is why
`page-behavior-checker` is in §4.6.

### 4.4 Deploy order — inverted, and that is deliberate

1. **Migration** (bucket + policies + column). Inert: nothing reads it yet.
2. **Deploy the code.** Existing rows have `storage_bucket = NULL` and still resolve from
   `job-files`; newly signed PDFs upload privately and the atomic completion wrapper marks their
   document row private before success communications.
3. **Move objects and backfill, per object** (R6), in one low-traffic window.
4. **Verify criterion 1 and criterion 2 on production, in that order.**

Steps 1–2 are safely reversible. Step 3 is the live one.

**Drive the loop from a query, not a number** (§1.1):

```sql
SELECT s.signed_file_path
FROM public.sign_requests s
WHERE s.signed_file_path IS NOT NULL
ORDER BY s.signed_file_path;
```

Each path maps 1:1 to exactly one `job_documents` row (verified 2026-08-09: 24 objects, 24
`sign_requests` values, 24 rows, 0 signed requests without a row). Objects with **no**
`sign_requests` row are **orphans — deletion candidates, not migration candidates**. See §7.

### 4.5 Tests

- `tests/qa/unit/job-documents-private-bucket.test.js` — migration is additive-only; the bucket is
  created `public: false`; **no policy or grant names `anon`**; both policies require an active,
  internal employee; the service-only completion wrapper is atomic; the rollback file exists; the
  `storage_bucket` column is nullable with no default
- `supabase/tests/job_documents_private_bucket.test.sql` — guarded local behavioral proof: active
  internal allowed; anon, unmapped authenticated, inactive and external identities denied. The
  matching Storage-API delete proof is recorded in R1 because Storage blocks raw SQL deletion.
- `signedDocUrl` unit tests — strips a `job-files/` prefix **and** accepts a bare key; throws on
  non-OK; **never puts a key in a query string**; accepts both `signedURL` and `signedUrl`
- `bucketFor` — `NULL` resolves to `job-files`, not to the private bucket (get this backwards and
  every legacy document 404s)
- `submit-esign.test.js` — uploads to the private bucket; **the email still carries an attachment**
  (the one regression here that reaches customers)
- A source-contract test asserting neither Documents surface still contains
  `storage/v1/object/public/job-files`

### 4.6 Reviewers

`migration-safety-checker` + `anon-grant-auditor` (bucket, policies, column) ·
`worker-security-reviewer` (`submit-esign.js`) · `page-behavior-checker` (both Documents surfaces —
§4.3's new async state).

---

## 5. Phase 2 — flip `job-files` private

**Much smaller than the 2026-08-08 draft thought, and smaller again than §5.2 below thought.** The
draft's entire §2.2 — a new public `message-media-public` bucket, moving 4 objects into it,
repointing 4 `messages` rows — rested on E6, which was wrong: outbound MMS already uses a private
bucket and already signs URLs for Twilio (E6b). And §5.2's "bulk of the phase", the batch-signed
image-transform path, rested on E16, which was also wrong: `thumbUrl()` had no caller (§1.3).

### 5.0 Where Phase 2 actually stands — 2026-08-19

**Built, proven, committed, and applied to nothing.**

| Step | State |
|---|---|
| Signed-URL helper layer (`signedDocUrls`, `signedThumbUrl`, `useSignedUrls`) | **DONE**, unit-tested |
| Every reader migrated off `/object/public/` | **DONE** — `grep` returns comments only, swept by a test |
| `jobDocumentUrl` signs BOTH buckets; `publicDocUrl` retired | **DONE** |
| Dead public builders deleted (`thumbUrl`, `publicUrl`, `fileUrl`) | **DONE**, absence asserted |
| R4 soak instrumentation on the legacy MMS branch | **DONE**, not yet deployed, so **no soak data exists** |
| Migration + paired rollback | **AUTHORED, UNAPPLIED** |
| §5b behavioural proof | **EXECUTED AND PASSED** — receipt below |
| Deploy the readers to `dev` | **NOT DONE** — owner gate |
| R4 soak window | **NOT STARTED** — cannot start before the deploy |
| R5 / E19 external-URL decision | **NOT MADE** — owner decision, still the biggest unknown |
| Apply the migration | **NOT DONE** — owner gate |

**Proof receipt.** `npm run test:db:job-files-private:local`, commit `aa37da74`, manifest SHA-256
`ae8ac28edb7a9831c89cd35d5fab881a71680e86ae486900edd1831bf9e060c7`, Supabase CLI 2.111.0. A
disposable loopback-only stack: baseline → seed the live catalog (bucket + all six policies) →
**prove anon CAN read** → migrate → proof → rollback → **prove anon can read again** → re-apply →
proof again → teardown.

What it proves, both passes:

- **KEEPS access** — admin, office, project_manager, field_tech, estimator, supervisor, and
  **crm_partner**. The predicate is *active + internal* and says nothing about job title, which is
  Phase 1's predicate on purpose. crm_partner has its own named case so that narrowing it later is
  a decision somebody makes, not a side effect.
- **LOSES access** — an inactive employee, an external employee, a valid session with no employee
  row, and anonymous.
- **UNTOUCHED** — `job-documents-private` in both directions, and the two out-of-scope write
  policies (§8).

**The pre-state check is the part that makes the DENY cases mean anything.** Without proving anon
could read *before* the migration, "anon sees 0 objects" is equally consistent with an empty
bucket, a missing policy, or a typo in a role name. That is the hollow-harness failure that bit the
payments-realm proof, and it is why the qualifier seeds production's exact catalog rather than
trusting `db/baseline/schema.sql` — which is public-schema only and contains no `storage.` objects
at all.

**Framing worth keeping: nobody gains anything.** Before the flip the bucket answers the whole
internet with no login. Every identity in the matrix already had access, so the flip can only take
it away. The §5b question "which roles gain, which lose, which are untouched" has an unusually
clean answer here, and it is the strongest argument that the change is safe.

### 5.1 Acceptance criteria

1. `storage.buckets.public = false` for `job-files`; `anon_read_job_files` and `job_files_select`
   (E2) are both dropped. ✅ *in the authored migration, proven on a local stack*
2. Every photo grid, lightbox, report and Xactimate download still renders for a logged-in
   employee, web and native. ⚠ **source-complete, NOT verified on a live signed-in session or a
   device.** This is the acceptance criterion that still needs a human.
3. Outbound MMS still sends and still displays in conversation history — including the 4 historical
   bubbles whose `messages.media_urls` hold public URLs. ⚠ **see 5.2 step 4 — still open.**
4. An anonymous fetch of any former public URL returns 400/404. ✅ *proven at the RLS layer; the
   HTTP behaviour follows from the bucket flag.*

### 5.2 Sequence — what is left, in order

1. **Deploy the readers to `dev`.** They work against the still-public bucket (signing ignores the
   `public` flag), so this is safe on its own and is the prerequisite for everything else.
2. **Run the R4 soak.** The instrumentation is written and logs `JOB_FILES_LEGACY_PUBLIC_MMS`, but
   it has never run anywhere, so there is zero soak data. Watch Cloudflare logs for a window. If it
   stays cold, delete the branch in the same change that flips the bucket. If it fires, find the
   client. Do **not** flip and see what breaks: the failure mode is a customer not receiving a
   picture, which nobody reports.
3. **Resolve R5 / E19.** LARGELY ANSWERED by §5.4 — email attaches, MMS already signs from a private
   bucket, and the future client portal needs its own worker-minted path either way. What is left is
   the narrow version: was a document URL ever pasted into an email by hand? One deliberate check.
4. **The 4 historical message bubbles.** Display-only, no object move and no row rewrite — they
   just need to stop building a public URL. `messageUtils.js:182` still recognises the legacy shape
   for retry classification, which is correct and separate. *Deliberately left: it belongs with the
   legacy-branch deletion in step 2's outcome, not before it.*
5. **Owner verification of criterion 2** on a signed-in web session and a device.
6. **Flip the bucket** — apply the migration. Separate owner authorization, low-traffic window,
   criterion 2 re-checked immediately after.

~~3. Batch-sign the photo path — this is the bulk of the phase.~~ **Superseded.** `signedDocUrls`
exists and batches, but the transform half was chasing a function nobody called (E16), and the
largest photo set on any single job is five (§1.3).

### 5.3 The trap that will bite

`<img src>` cannot carry an `Authorization` header. Anyone reaching for the authenticated transform
route (`/render/image/authenticated/…`) will find it works in `curl` and fails in the browser.
**Signed URLs are the only workable form**, which is what `useSignedUrls` produces.

**Corrected 2026-08-19:** this section used to end "signed URLs *with transform params* are the only
workable form", and budgeted for it. Transforms turned out to be moot — but the underlying
constraint it names is real and still binds, so the section stays.

**And one the old plan did not have.** `Lightbox` hands a photo URL to the **native share sheet**
(`shareNative({ url })`) — i.e. to another app. It used to hand over a permanent public URL; it now
hands over one that expires. Strictly better against a leak, strictly worse for a recipient who
opens it tomorrow. Recorded in the Lightbox header. If sharing a durable copy ever matters, share
the **file**, do not lengthen the TTL.

### 5.4 Sending documents to clients — email, text, and the future portal

**Owner, 2026-08-20:** *"we are going to be able to send documents out via email, text, and the
future portal that we're gonna create for our clients."* This is the answer to R5/E19, and it
points the same way the privacy work already does.

**Email is already unaffected, verified in source.** Both send paths fetch the bytes SERVICE-SIDE
and attach them:

- `functions/api/submit-esign.js:396,431` — `attachments: [{ content: pdfB64, … }]`
- `functions/api/send-signed-copy.js:221,272` — `db.downloadStorage(bucket, key)` then
  `attachments: [{ content: toBase64(pdfBytes), … }]`

A service-role read bypasses RLS and ignores the `public` flag entirely, so a private bucket is
invisible to email delivery. **Nothing about emailing documents argues for keeping the bucket
public** — and the reverse: emailing an attachment is why Phase 1 was invisible to customers (E4).

**Text is already solved, and already shipped.** `messaging-transport.js:61` signs a URL
service-side for Twilio to fetch (`db.signStorage('message-attachments', …, 3600)`) — a PRIVATE
bucket, in production since March. Texting a document from a private bucket is not a new capability
to design; it is the pattern already running (E6b).

**The portal is the one that needs design, and it needs it either way.** A client is not an
employee, so `job_files_authenticated_read` — active + internal — refuses them, exactly as it
should. A portal therefore needs its own path, and the shape is already in this codebase twice:

- a Worker that validates the client's portal session and then mints a short-lived signed URL with
  the service-role helper (`signStorage`, E10); or
- the token pattern the e-sign signing page uses, scoped to one document.

**What it must NOT be** is the bucket staying world-readable. A portal serving documents from a
public bucket hands every client a permanent, unauthenticated, guessable-neighbour URL to their own
claim paperwork — which is the exposure this whole initiative exists to close, re-created with a
nicer front door. The private bucket plus service-side signing is the correct substrate for a
portal, not an obstacle to one.

**So R5/E19 resolves in the direction of proceeding**, with one caveat that is now recorded rather
than discovered: if any report or document URL was ever pasted into an email by hand (as opposed to
attached), flipping the bucket breaks it. That is still worth one deliberate check before the flip.

---

## 6. Gates

Every one is a separate owner authorization, each time:

- applying either migration to the shared Supabase (one project sits behind `dev` **and** production
  — `AGENTS.md` §13);
- creating a bucket or changing a bucket's `public` flag;
- moving or deleting any storage object;
- backfilling `storage_bucket` or repointing message rows;
- commit, push, PR, deploy.

Phase 1's object move is the one that feels irreversible. It is not — the paired rollback plus a
reverse `move` restores the prior state — but it is the step where a mistake is visible to staff, so
it wants a low-traffic window and criterion 2 verified immediately after.

---

## 7. Three orphaned objects — and the leak that makes them

> **CLOSED 2026-08-19 — the three objects no longer exist.** Read-only SQL found **zero** objects
> matching `esign` anywhere in `job-files` (the bucket went 94 → 91). The owner decision this
> section was waiting for has evidently been taken and acted on. The section is kept for the
> **leak** below it, which is not closed and is not this initiative's to close.


Objects with **no `sign_requests` row and no `job_documents` row**: invisible everywhere in the
application, and public on the internet.

**The 2026-08-08 draft described these as "real signed customer documents" and told the owner not to
delete them by default. That was wrong.** On 2026-08-09 all three were downloaded and read:

| Object | Signed | Client name on the document | What it is |
|---|---|---|---|
| `1015bf77-…/esign/coc-signed-1774315853640.pdf` | 2026-03-24 01:30Z | **Moroni Salvador** (the owner), job R-2603-006 | test |
| `1015bf77-…/esign/coc-signed-1774317720090.pdf` | 2026-03-24 02:02Z | **Moroni Salvador**, same job, 31 min later, enumerating *every* division | test |
| `bc01c016-…/esign/coc-signed-1775514696027.pdf` | 2026-04-06 | client name literally **`tst`**, no carrier, no claim number, no date of loss, signed "Marcelo Estefsns" | test |

No third-party customer appears on any of them. **They are safe to delete** — still the owner's
call, but on accurate information rather than a false alarm.

A **fourth** orphan from the same deleted job sits outside `esign/` and outside the old §7 table:
`1015bf77-…/xactimate/1782454106458-Final_Draft_Recon.pdf`.

**The leak that matters more than the files (E20).** `public.jobs` has no soft-delete column, so a
job delete is a hard `DELETE`. It cascades away `sign_requests`, `job_documents`, appointments and
invoices — and leaves the storage objects behind, public, with every database record of them gone.

Both jobs here were tests, so nothing real was lost. **The next one might not be.** If a real job is
ever deleted, its signed legal documents vanish from the application entirely and remain publicly
downloadable forever. **That is a separate change from this initiative and it should be its own
task** — deleting a job must delete or reparent its storage objects.

---

## 8. Out of scope

- Renaming `job-files`. Destructive, cosmetic, not worth a migration.
- Retention or deletion policy for signed documents. Different question, different owner decision.
- **Narrowing `job_files_authenticated_delete`** — any authenticated employee can delete any object
  in the bucket. Real, pre-existing, and its own change. Phase 1 declines to *widen* it (R3); it does
  not fix it.
- Fixing the job-deletion storage leak (§7). Named, not scheduled.
- Watermarking or per-document audit logging.

---

## 9. Cold-session dispatch — Phase 1

> Copy from here down. It is self-contained and depends on no prior conversation, model, or tool.

**Objective.** Move every signed e-sign PDF out of the public-read `job-files` bucket into a new
private bucket, reached by short-lived signed URLs, **without losing access from the job
Files/Documents surface** — that access is an explicit owner requirement, not a nice-to-have.

**Authority.** Repository implementation is authorized by this roadmap. Migration apply, bucket
creation, object moves, data backfill, commit, push, PR and deploy are each separately owner-gated
(§6). **Authoring is not applying.**

**Step 0, before any code — run R1's staging spike.** If browser signing does not work on
`qa-staging`, stop and report; the design changes to a worker and this dispatch needs revising.

**Step 0 receipt (2026-08-09): PASSED.** Auth 200 · upload 200 · active-internal sign and signed
GET 200 with exact bytes · public GET 400 · active-internal delete 200; unrelated authenticated and
anon signing failed 400, and unrelated delete failed 400. See R1 for teardown evidence. Phase 1
uses the browser-JWT design; no signing worker fallback is required.

**Required reading, in order.** `AGENTS.md` §13 and §16 · `.claude/rules/database-standard.md`
§§1–3, 5, 5b, 6 · this file §§1, 2, 4 · `functions/api/submit-esign.js` (~:320–450) ·
`src/pages/JobPage.jsx` :710–760 and :910–930 · `src/pages/tech/TechJobDocuments.jsx` :195–400 ·
`src/lib/supabase.js` :44–56 and :160–166 · `functions/lib/supabase.js` :168–195.

**Scope.** Exactly §4.2's owned list. Do not touch `conversations/**`, `thumbUrl()`,
`message-media.js`, `messaging-transport.js`, or the `job-files` bucket flag — Phase 2.

**Acceptance.** §4.1, all eight. **Criterion 2 is the owner's requirement; a change that satisfies 1
and fails 2 must not ship.**

**Verification.**

```bash
npm run build
npm test
npm run validate:lint-ratchet -- origin/main
node scripts/check-migration-hygiene.mjs
```

Use `validate:lint-ratchet`, **not** `npx eslint .` — `no-restricted-syntax` findings are
warning-level, so plain eslint exits 0 while the blocking CI ratchet fails. Run it at the ref CI will
use. **Read the ratchet's *regression* count, not its finding count** — it carries per-file baselines
now, so "24 findings, 0 regressions" is a pass.

**Working in the shared checkout.** Several sessions share this tree.

- Re-verify **branch identity**, not just sync: `git rev-parse --abbrev-ref HEAD`. A `0 0` sync count
  reads identically when you are sitting on someone else's branch that happens to point at the same
  commit.
- `git commit` commits the **index**, not the paths you added. Another session's staged files ride
  along under your message. Use `git commit -F msg -- <paths>`, or read
  `git diff --cached --name-only` immediately before every commit.
- Consider `git worktree add` off `origin/dev` and avoid the shared tree entirely.

**Reviewers.** §4.6.

**Stop conditions — stop and ask if:**

- R1's spike fails (the whole design changes);
- the email path would become a link instead of an attachment (E4 is load-bearing);
- **any policy or grant would name `anon`** — including "just to make signing work" (R2);
- a `job_documents.file_path` shape appears that is neither of E14's two;
- the move would run before the code is deployed (§4.4);
- a signed URL would be written to the database, a log, or a message (criterion 8).

**Do not report done** until an anonymous fetch of a moved PDF returns 400/404 **and** a logged-in
employee has opened one from both Documents surfaces, web and native. The first without the second
is a regression wearing a security fix's clothes.
