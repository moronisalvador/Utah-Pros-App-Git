# job-files Privacy — Roadmap & Cold-Session Dispatch

**Authored:** 2026-08-08 · **Status:** PLANNED — nothing authored, nothing applied, nothing moved
**Initiative row:** `.claude/rules/initiative-status.md`
**Supersedes the informal scoping in task #14.** Every number here was read off the live database
or the real source on 2026-08-08, not remembered.

---

## 0. The problem, in one paragraph

`job-files` is the only public Supabase bucket this project has. `storage.buckets.public = true`,
so `GET /storage/v1/object/public/job-files/<path>` answers **anyone**, with no login, no token and
no RLS evaluation. Behind that URL sit **29 signed customer authorizations carrying claim and
policy numbers**, 34 scope sheets, 4 Xactimate files, reports, and every job photo. Holding the
path is the entire access control. This initiative closes that without breaking picture messaging
and without taking signed documents away from the people who need them.

**Owner requirement, stated 2026-08-08 and binding on every phase:** *signed documents must stay
accessible from the job Files / Documents surface.* A design that makes the PDFs safe by making
them hard to reach has failed, not succeeded.

---

## 1. Evidence ledger

Read live or from source on 2026-08-08. Re-verify anything marked UNKNOWN before acting on it.

| # | Claim | State | Evidence |
|---|---|---|---|
| E1 | `job-files` is public; the other two buckets are not | **HAVE** | `storage.buckets.public` — `job-files` true; `contractor-compliance-private` false; `message-attachments` false |
| E2 | Two always-true SELECT policies sit on top of the flag | **HAVE** | `anon_read_job_files` (role `anon`) and `job_files_select` (**roles NULL — no role restriction at all**), both `USING (bucket_id = 'job-files')`. For a public bucket the `/object/public/` route bypasses RLS anyway, so the flag is the real gate and these are belt-and-braces |
| E3 | Bucket contents | **HAVE** | 104 objects / 60 MB. `esign/` 29 (1047 kB) · `demo-sheets/` 34 · `xactimate/` 4 (5152 kB) · `reports/` 3 · per-job folders + loose images |
| E4 | **The signed-PDF email ATTACHES the file; it does not link to the bucket** | **HAVE** | `functions/api/submit-esign.js:408` and `:443` — `attachments: [{ content: pdfB64, filename, contentType }]`. **This is the finding that makes Phase 1 cheap: making e-sign PDFs private breaks nothing for customers.** |
| E5 | The anonymous signing page never reads the bucket | **HAVE** | `grep job-files src/pages/SignPage.jsx` → no matches. An anon page could not mint a signed URL, so this had to be checked |
| E6 | MMS media must stay publicly fetchable | **HAVE** | `functions/lib/message-media.js:142` builds/validates `/storage/v1/object/public/job-files/conversations/<conversationId>/`. Twilio fetches outbound MMS media over plain HTTP |
| E7 | MMS is a *tiny* slice of the bucket | **HAVE** | 4 objects / 907 kB under `conversations/`, versus 100 objects / ~59 MB everything else |
| E8 | 4 message rows embed a public job-files URL | **HAVE** | `SELECT count(*) FROM messages WHERE media_urls::text ILIKE '%public/job-files%' OR body ILIKE '%public/job-files%'` → 4. Exactly matches E7 |
| E9 | The browser can mint its own signed URL — no worker needed | **HAVE** | `src/lib/supabase.js:51` sends `Authorization: Bearer <user JWT>`; `db.baseUrl` and `db.apiKey` are already exposed (`:161`) and `JobPage.jsx:891/:898` already call the Storage API directly. `POST /storage/v1/object/sign/{bucket}/{path}` authorizes via RLS SELECT, so an `authenticated` policy on the new bucket is sufficient |
| E10 | A service-role signing helper already exists for workers | **HAVE** | `signStorage(bucket, path, expiresIn = 600, { download })` — `functions/lib/supabase.js:175` |
| E11 | A private-bucket precedent already exists | **HAVE** | `contractor-compliance-private`, `functions/lib/contractor-compliance.js:27` |
| E12 | Every reader of a signed PDF | **HAVE** | `JobPage.jsx` :703,704,709,710,712,716,781,782 · `TechJobDocuments.jsx` :347,353,360 · write side `submit-esign.js:369`. **Three files total** |
| E13 | Both Documents surfaces inline the public URL | **HAVE** | `TechJobDocuments.jsx:198` `pdfUrl()` · `JobPage.jsx:736` `pdfUrl` and `:902` `getFileUrl(doc)` |
| E14 | `job_documents.file_path` has **two shapes** | **HAVE** | 92 rows: **20 carry a `job-files/` prefix, 72 do not**; 23 are e-sign. `JobPage.jsx:902` already strips it, and `stripBucketPrefix` exists in `src/lib/mediaCompress.js`. Any new helper that ignores this breaks 20 rows |
| E15 | The native PDF path is Quick Look, not a share sheet | **HAVE** | `TechJobDocuments.jsx:360` → `previewNativeDoc({ url })` → `NativeDocPreview.present({ url })` (`src/lib/nativeDocPreview.js:42`). The plugin fetches the URL immediately, so a short TTL is fine. **No URL is handed to another app**, so no expiry-after-sharing problem |
| E16 | `thumbUrl()` uses the **public** image-transform route | **HAVE** | `src/hooks/usePhotoUpload.js:60` → `/storage/v1/render/image/public/{BUCKET}/{path}`. `perf-budget.md` §2 already designates this "the db-foundation P8 signed-URL swap seam" |
| E17 | 11 files bypass that seam and inline a public URL | **HAVE** | 15 occurrences across `src` + `functions`; the seam exists and leaks |
| E18 | Whether the 4 legacy MMS URLs are still *rendered* to staff, or only historical | **UNKNOWN** | `resolveMessageMedia` (`message-media.js:157`) has a `legacy.storagePath` branch at `:188` suggesting a migration path already exists. **Phase 2 must read that function before moving anything** |
| E19 | Whether any external system (Google Drive import, Encircle, a report) stores a public job-files URL | **UNKNOWN** | `GoogleDriveButton.jsx` writes into the bucket; nothing proves an outside system holds a URL. Cheap to check, expensive to get wrong |

---

## 2. What the challenge pass changed

Three things. The first inverted a whole phase.

### 2.1 Phase 2 was framed wrong-ended

The original scoping said "consolidate the 11 inlined URL builders and migrate the rest of the
bucket." That silently assumed the sensitive content was the thing to move. **E7 says the opposite:
MMS is 4 objects out of 104.** Moving 4 objects and flipping the bucket is far less work — and less
risk — than migrating 100.

### 2.2 …and the obvious fix for that has its own cost

Moving the 4 MMS objects orphans the 4 message rows in E8. Two real options:

| | Move | Cost |
|---|---|---|
| **A (recommended)** | 4 MMS objects → new public bucket; flip `job-files` private | Must repoint 4 `messages` rows, or rely on the `legacy.storagePath` branch (E18) |
| B (rejected) | 100 sensitive objects → private bucket; `job-files` stays public | No message rows touched, but 25× the data movement and it leaves the **bucket named `job-files` holding only MMS** — a permanently misleading name, and a bucket rename is destructive |

**Recommendation: A.** The 4 URLs are internal pointers used to re-display media to staff; Twilio
already fetched and delivered those messages, so the customer's copy is unaffected. A is rejected
only if E18 shows the legacy branch cannot resolve a moved object — check first.

### 2.3 The expensive part of Phase 2 is photos, not URL consolidation

`<img src>` cannot send an `Authorization` header, so Supabase's *authenticated* transform route is
unusable for a photo grid. Private thumbnails must be **signed URLs with transform options**, minted
per image. Use the **batch** sign endpoint (`POST /storage/v1/object/sign/{bucket}` with
`{ expiresIn, paths: [...] }`) or a grid of 50 photos becomes 50 round-trips. This — not E17's
consolidation — is Phase 2's real engineering, and it is why Phase 2 is a separate initiative rather
than a bigger Phase 1.

---

## 3. Artifact tier

**Tier 2, expressed the way this repository actually does it:** this roadmap (carrying both the
phase contracts and the cold-session dispatch blocks) plus one row in
`.claude/rules/initiative-status.md`.

No separate dispatch file and no separate ownership manifest. The two phases are **serialized, not
concurrent** — there is no second lane to coordinate with — so a standalone manifest would be
maintenance cost buying nothing. The lease that *is* real (Phase 1 touches `JobPage.jsx`, a shared
hotspot) is stated in §4.2 and mirrored in the initiative row, which is the file other sessions
actually read.

---

## 4. Phase 1 — signed documents to a private bucket

**Outcome:** a signed customer authorization is no longer fetchable by anyone holding its path, and
is still one tap away in job Files/Documents for any logged-in employee.

### 4.1 Acceptance criteria

1. An anonymous `GET` of a signed PDF's public URL returns **400/404**, not the file.
2. A logged-in employee opens a signed PDF from **JobPage → Files** and from **TechJobDocuments**,
   web and native, and it renders. *(This is the owner requirement — it is criterion 2 for a reason.)*
3. Native Quick Look still opens the PDF in-app (`previewNativeDoc`), not Safari.
4. `submit-esign.js` writes new PDFs to the private bucket; the customer email is unchanged and
   still carries the PDF as an **attachment**.
5. Deleting a signed document from JobPage still removes the object *and* the `job_documents` row.
6. All 29 existing `esign/` objects are moved, and **zero** remain publicly fetchable.
7. Both `job_documents.file_path` shapes (E14) resolve.

### 4.2 Owned files and objects

- New bucket `job-documents-private` (`public: false`), its `storage.objects` policies, and one
  additive `job_documents.storage_bucket` column
- `supabase/migrations/<ts>_job_documents_private_bucket.sql` + paired rollback
- New `src/lib/storageUrl.js` — the single signed-URL helper
- `functions/api/submit-esign.js` — upload target only
- `src/pages/JobPage.jsx` (**shared hotspot — stage by explicit path, re-read before editing**)
- `src/pages/tech/TechJobDocuments.jsx`
- `tests/qa/unit/job-documents-private-bucket.test.js`

**Frozen / forbidden:** the customer email body and its attachment (E4 is what makes this safe —
do not "improve" it into a link); `conversations/**`; `thumbUrl()` and the photo path (Phase 2);
`message-media.js`; the `job-files` bucket flag (Phase 2 owns that).

### 4.3 Design

**Bucket.** `job-documents-private`, `public: false`, 50 MB limit to match. Keys are preserved
byte-for-byte on move — `{jobId}/esign/{file}.pdf` — so `sign_requests.signed_file_path` and
`job_documents.file_path` need **no data migration**. Only the bucket changes.

**Policies** — least privilege per `database-standard.md` §1, and note this is a *narrowing*, so
`anon` appears nowhere:

```sql
-- SELECT for authenticated is what lets the BROWSER mint its own signed URL (E9).
CREATE POLICY job_documents_private_authenticated_read ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'job-documents-private');
-- INSERT/DELETE mirror the job-files posture the app already relies on.
```

**Column.** `ALTER TABLE public.job_documents ADD COLUMN IF NOT EXISTS storage_bucket text;`
Additive, nullable — `NULL` means `job-files`, so all 92 existing rows keep working untouched and
the frontend contract does not move (`database-standard.md` §3). Backfill only the 23 e-sign rows.

**The helper** — `src/lib/storageUrl.js`, the one place a document URL is built:

```js
// Mints a short-lived signed URL. Authorizes via the caller's own JWT against the
// storage.objects SELECT policy — no service-role key reaches the browser.
export async function signedDocUrl(db, path, { bucket = 'job-documents-private', expiresIn = 600 } = {}) {
  const key = stripBucketPrefix(path);            // E14: 20 of 92 rows carry a `job-files/` prefix
  const res = await fetch(`${db.baseUrl}/storage/v1/object/sign/${bucket}/${key}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${db.apiKey}`, apikey: db.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn }),
  });
  if (!res.ok) throw new Error(`sign ${bucket}/${key}: ${res.status}`);
  const { signedURL, signedUrl } = await res.json();
  return new URL(signedURL || signedUrl, db.baseUrl).href;
}
```

**Reader changes.** `pdfUrl()` in both Documents surfaces becomes async. The `<a href>` at
`TechJobDocuments.jsx:353` cannot hold a promise, so that link becomes a click handler that mints
then opens — which the native branch at `:357` already does, so the two paths converge rather than
diverge. Keep the `<a>` element for semantics and keyboard access.

**Migration of the 29 objects** is a separate owner-authorized operation, not part of the migration
file: `POST /storage/v1/object/move` per object with the service-role key, keys preserved. Run
**after** the code is deployed, so nothing is looking for a file that has already moved.

⚠️ **Delete the three orphaned test PDFs first** (task #15) — they are in the 29 and there is no
reason to move rubbish into the new bucket.

### 4.4 Deploy order — this one is inverted

1. Migration (bucket + policies + column). Inert: nothing reads it yet.
2. Deploy the code. It reads `storage_bucket`, which is NULL everywhere, so every document still
   resolves from `job-files`. Still inert.
3. Move the objects and backfill `storage_bucket` for the 23 e-sign rows, in one window.
4. Verify criterion 1 and criterion 2 **on production**, in that order.

Steps 1–2 are safely reversible. Step 3 is the live one.

**Step 3 must be per-object, not two bulk passes.** `storage_bucket` is what switches the reader, so
"move all 29, then backfill all 23" leaves every un-moved file 404ing the moment the backfill lands
if the move stops halfway — a half-finished run would break exactly the surface the owner requires
to keep working. Instead, for each object: `move` → confirm 200 → `UPDATE job_documents SET
storage_bucket = 'job-documents-private' WHERE file_path = <that path>`. Every intermediate state is
then consistent, and an interrupted run is resumable rather than broken.

**The set is 23 + 6, not 29.** Measured, not inferred:

| | count |
|---|---|
| `esign/` storage objects | 29 |
| `sign_requests.signed_file_path` values | 23 |
| `job_documents` rows for `esign/` | 23 |
| signed requests with **no** `job_documents` row | **0** — those two are exactly 1:1 |
| storage objects with **no** `sign_request` | **6 — orphans** |

So drive the move loop from `sign_requests.signed_file_path` (23 objects, each with exactly one
`job_documents` row to update — strip `job-files/` before matching, per E14). The other 6 are
**deletion candidates, not migration candidates** — see §7. Moving them would carry rubbish into
the clean bucket and inflate the verification set.

### 4.5 Tests

- `tests/qa/unit/job-documents-private-bucket.test.js` — migration is additive-only; the new bucket
  is created with `public: false`; **no policy or grant names `anon`**; the rollback exists; the
  `storage_bucket` column is nullable with no default
- `signedDocUrl` unit tests — strips a `job-files/` prefix (E14) **and** a bare key; throws on
  non-OK; never embeds a key in a query string
- `submit-esign.test.js` — uploads to the private bucket; **the email still carries an attachment**
  (a regression here is the one that reaches customers)
- A source-contract test asserting neither Documents surface still contains
  `storage/v1/object/public/job-files`

### 4.6 Reviewers

`migration-safety-checker` + `anon-grant-auditor` (bucket, policies, column) ·
`worker-security-reviewer` (`submit-esign.js`) · `page-behavior-checker` (both Documents surfaces —
an async URL introduces a loading state where there wasn't one).

---

## 5. Phase 2 — flip `job-files` private

**Do not start Phase 2 until Phase 1 has been live long enough to trust.** Phase 1 closes the
liability; Phase 2 closes the rest.

### 5.1 Acceptance criteria

1. `storage.buckets.public = false` for `job-files`; `anon_read_job_files` and `job_files_select`
   (E2) are both dropped.
2. Every photo grid, lightbox, report and Xactimate download still renders for a logged-in employee,
   web and native.
3. Outbound MMS still sends and still displays in conversation history.
4. An anonymous fetch of any former public URL returns 400/404.

### 5.2 Sequence

1. **Resolve E18 first.** Read `resolveMessageMedia` (`message-media.js:157`) and its
   `legacy.storagePath` branch at `:188`. If it cannot resolve a moved object, Option A needs the
   4-row repoint; decide before moving anything.
2. **Resolve E19.** Confirm no external system holds a public job-files URL.
3. Create the public `message-media-public` bucket; move the 4 `conversations/` objects; update
   `message-media.js`'s prefix; repoint the 4 `messages` rows if step 1 says so.
4. **Batch-sign the photo path.** Extend `src/lib/storageUrl.js` with a plural `signedDocUrls(paths)`
   over `POST /storage/v1/object/sign/{bucket}` and rewrite `thumbUrl()` (E16) to mint signed URLs
   with transform options. This is the bulk of the phase — see §2.3.
5. Consolidate the 11 inlining files (E17) onto the helper.
6. Flip the bucket and drop the two policies.

### 5.3 The trap that will bite

`<img src>` cannot carry an `Authorization` header. Anyone reaching for the authenticated transform
route (`/render/image/authenticated/...`) will find it works in `curl` and fails in the browser.
Signed URLs with transform params are the only workable form. Budget for the async URL minting a
photo grid now needs, and check it against `perf-budget.md` §3 before building.

---

## 6. Gates

Every one of these is a separate owner authorization, each time:

- applying either migration to the shared Supabase (one project sits behind `dev` **and**
  production — `AGENTS.md` §13);
- creating a bucket or changing a bucket's `public` flag;
- moving or deleting any storage object;
- backfilling `storage_bucket` or repointing message rows;
- commit, push, PR, deploy.

Phase 1's object move is the irreversible-feeling one. It is not actually irreversible — the paired
rollback and a reverse `move` restore the prior state — but it is the step where a mistake is
visible to staff, so it wants a low-traffic window and criterion 2 verified immediately after.

---

## 7. Six orphaned objects — three of them are real customer documents

Found while measuring the move set. These have **no `sign_requests` row and no `job_documents`
row**, so they are invisible everywhere in the application — and public on the internet.

| Object | Created | Whose |
|---|---|---|
| `18d4a913-…/esign/cat3_removal-signed-1786206905317.pdf` | 2026-08-08 | agent test (job W-2607-003) |
| `18d4a913-…/esign/cat3_removal-signed-1786153809984.pdf` | 2026-08-08 | agent test |
| `18d4a913-…/esign/other-signed-1786145190967.pdf` | 2026-08-07 | agent test |
| `bc01c016-…/esign/coc-signed-1775514696027.pdf` | **2026-04-06** | **real signed Certificate of Completion** |
| `1015bf77-…/esign/coc-signed-1774317720090.pdf` | **2026-03-24** | **real signed Certificate of Completion** |
| `1015bf77-…/esign/coc-signed-1774315853640.pdf` | **2026-03-24** | **real signed Certificate of Completion** |

The bottom three are the ones that matter. Their **jobs no longer exist** — `SELECT job_number FROM
jobs WHERE id = <folder uuid>` returns nothing for both `bc01c016` and `1015bf77` — so a signed
customer document outlived the job it belonged to, kept no database record, and has been anonymously
downloadable for four months. A job deletion evidently does not clean up its storage objects.

**Two decisions the owner owns, neither taken:**

1. **Delete, or preserve?** A signed Certificate of Completion is a record of a customer attesting
   the work was finished. If UPR wants to keep it, it needs a job to hang from; if not, it should be
   deleted rather than left public. Do not decide this by default.
2. **Close the leak that made them.** Deleting a job should delete or reparent its storage objects.
   That is a separate change from this initiative, and it is why these six exist at all.

Until that is decided, they are excluded from the Phase 1 move set. The three agent test files are
unambiguous rubbish and can go immediately (task #15).

---

## 8. Out of scope

- Renaming `job-files`. Destructive, cosmetic, and not worth a migration.
- Retention or deletion policy for signed documents. Different question, different owner decision.
- The always-true `job_files_authenticated_delete` policy — any authenticated employee can delete
  any object in the bucket. Real, pre-existing, and its own change.
- Watermarking or per-document audit logging.

---

## 9. Cold-session dispatch — Phase 1

> Copy from here down; it is self-contained and depends on no prior conversation.

**Objective.** Move the 29 signed e-sign PDFs out of the public-read `job-files` bucket into a new
private bucket, reached by short-lived signed URLs, **without losing access from the job
Files/Documents surface** — that access is an explicit owner requirement, not a nice-to-have.

**Authority.** Repository implementation is authorized by this roadmap. Migration apply, bucket
creation, object moves, data backfill, commit, push, PR and deploy are each separately owner-gated
(§6). Authoring is not applying.

**Required reading, in order.** `AGENTS.md` §13 and §16 · `.claude/rules/database-standard.md`
§§1–3, 5, 5b, 6 · this file §§1, 2, 4 · `functions/api/submit-esign.js` (the upload and email
block, ~:320–450) · `src/pages/JobPage.jsx` :700–740 and :890–905 ·
`src/pages/tech/TechJobDocuments.jsx` :190–370 · `src/lib/supabase.js` :40–60 and :155–200 ·
`functions/lib/supabase.js` :168–195.

**Scope.** Exactly the owned list in §4.2. Do not touch `conversations/**`, `thumbUrl()`,
`message-media.js`, or the `job-files` bucket flag — those are Phase 2.

**Acceptance.** §4.1, all seven. Criterion 2 is the owner's requirement; a change that satisfies 1
and fails 2 must not ship.

**Verification.**

```bash
npm run build
npm test
npm run validate:lint-ratchet -- origin/main
node scripts/check-migration-hygiene.mjs
```

Use `validate:lint-ratchet`, **not** `npx eslint .` — `no-restricted-syntax` findings are
warning-level, so plain eslint exits 0 while the blocking CI ratchet fails. Run it at the ref CI
will use.

**Reviewers.** §4.6.

**Stop conditions.** Stop and ask if: the email path would become a link instead of an attachment
(E4 is load-bearing); any policy or grant would name `anon`; a `job_documents` row shape appears
that is neither of E14's two; or the move would run before the code is deployed (§4.4).

**Do not report done** until an anonymous fetch of a moved PDF returns 400/404 **and** a logged-in
employee has opened one from both Documents surfaces. The first without the second is a regression
wearing a security fix's clothes.
