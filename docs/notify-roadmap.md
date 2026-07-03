# Notification Center — Roadmap & Dispatch Model of Record (2026-07-03)

Produced by a `/masterplan` planning session (docs only — zero feature code) and adversarially
reviewed by a 7-agent challenge pass (5 refute-first verifications, a B/C/D disjointness proof,
a counter-ordering skeptic that won a binding Foundation split). Every HAVE/PARTIAL verdict
comes from live code/DB reads, not docs. Companion dispatch blocks: `docs/notify-dispatch.md`.

**The initiative:** a real notification system — **Web Push to the installed PWA (iPhone) and
desktop browsers**, an **email channel**, and the existing in-app bell, all governed by a
**per-user preferences matrix** (which event types, via push/email/both) with **role-scoped
catalogs** (techs customize some, admins more) and **admin-managed system-wide defaults**
(per-role, lockable per type). Event catalog modeled on Housecall Pro's core (client message
received, appointment assigned to you) plus admin events (estimate accepted, payment received,
new lead, e-sign signed, feedback, timesheet/clock events).

**Owner decisions on record (2026-07-03):** everyone gets a self-service prefs page ·
channels = push/email/both as checkboxes (bell always-on) · techs some customization, admins
more · admins set system-wide defaults + control what techs receive · devices = iPhone PWA +
desktop (Web Push; native APNs stays separate and dormant, unbroken) · the email channel here
**supersedes** the feedback-era "email declined" (that decision was feedback-specific) ·
internal employee mail is transactional via Resend `sendEmail` — the CRM marketing-consent gate
is customer-only and does not apply; the prefs system itself is the internal gate (disclosed).

---

## Status reconciliation (live DB + code, 2026-07-03)

Fresh initiative — nothing in-flight to finish first. What exists today:

| Piece | Live status | Notes |
|---|---|---|
| In-app bell (`notifications` + 5 RPCs + realtime toast) | live, GLOBAL | No recipient column; `mark_all_notifications_read` clears for everyone; realtime INSERT-only; bell mounted only in office `Layout` — techs have no bell |
| `create_notification` callers | 5 | submit-esign, feedback-notify, 2× time-entry RPCs, midnight-clock-split |
| Native push (APNs) | wired, dormant | `device_tokens` = **0 rows** live; `APNS_*` env unset (send-push 503s); `platform` hardcoded `'ios'` |
| Web Push | **none** | Zero VAPID/pushManager/web-push code anywhere; no `push_subscriptions` table |
| Service worker | **kill-switch** | `public/sw.js` self-destructs; `src/main.jsx:44-72` unregisters every SW + wipes caches + `/reset`-bounces on every load |
| Employee email sends | exist, ungated | `google-calendar.js:531-534` emails assigned employees today (see finding 5); `billing-2fa` |
| Notification preferences | **none** | Zero matches for any prefs/notification-settings pattern — greenfield |

**Schema-drift disclosures (live objects absent from `supabase/migrations/`):**
`device_tokens` + `upsert_device_token`/`delete_device_token` (delete has zero callers);
orphan **`notification_queue`** (recipient_id/channel/attempts/next_retry_at shape, 0 rows,
anon-open INSERT/UPDATE policies) — left untouched per the `automation_rules` orphan precedent;
`google_calendar_links.assigned_notified_at` + `time_sig` columns. None may be ALTERed in-wave.

## Severity findings

1. **P2 — stale SW docs (FIXED in the plan-commit).** `UPR-Web-Context.md` described the killed
   CacheFirst `upr-v1` SW as live and claimed "main.jsx already registers" — following it would
   rebuild the exact blank-page trap. Corrected to kill-switch reality alongside this roadmap.
2. **P2 — schema drift** (list above). Exposure: repo-only reads miss live objects;
   `notification_queue`'s anon-open writes are a minor abuse surface. Interim: none. Fix:
   disclosed here + in UPR-Web-Context; new tables properly versioned; orphans untouched.
3. **P3 — `mark_all_notifications_read` is global** — one user's "mark all read" clears the
   bell for everyone. Fix: F2's per-recipient cutover.
4. **P3 — world-readable `device_tokens`** (`USING (true)` SELECT despite the policy name "Own
   tokens or admin read"). APNs tokens = low risk; but Web Push `endpoint+p256dh+auth` are
   **send-capability secrets**, so `push_subscriptions` must NOT copy the house permissive-RLS
   pattern: RLS on, **no anon SELECT policy**, own-row SECURITY DEFINER RPCs, service-role
   reads only. Documented deviation.
5. **P3 — double-email hazard.** The legacy google-calendar employee email ("assigned"/
   "rescheduled") fires from the calendar-sync worker, gated by per-(appointment,employee)
   `google_calendar_links.assigned_notified_at`/`time_sig` — NOT by any employee preference,
   and only when Google sync succeeds (1 connected account live → path is active). A new
   `appointment.assigned` email channel must dedupe at the `emailKind` decision
   (`google-calendar.js:513-537`), per-recipient. Session B owns this seam.

## Gap-audit appendix (evidence-based; HAVE only from code/schema)

| # | Capability | Verdict | Evidence |
|---|---|---|---|
| A1 | In-app bell + realtime toast | HAVE (global-only) | `20260624_notifications.sql`; `NotificationBell.jsx`; `realtime.js:90-107` |
| A2 | Per-recipient targeting / read state | MISSING | No recipient column (challenge-CONFIRMED); only the orphan queue has one |
| A3 | Bell for techs | MISSING | `NotificationBell` imported only by Sidebar/TopNav (office Layout) |
| B1 | Web Push (SW, VAPID, subscriptions, encryption) | MISSING | grep-verified zero code; no deps |
| B2 | SW re-enable path | BLOCKED by kill-switch | `main.jsx:44-72` unregisters all SWs every load — must be rewritten, not just sw.js |
| B3 | Push-only SW safety vs the MIME trap | SAFE (challenge-MODIFIED) | Trap required a caching fetch handler; push-only SW has none; InstallBanner/installability don't need a SW (Chromium ≥117); `Clear-Site-Data:"cache"` doesn't unregister SWs; WKWebView has no SW |
| B4 | Web Push crypto feasibility in Workers | PROVEN (challenge-executed) | RFC 8291 Appendix A ran byte-for-byte in Node 22 WebCrypto (vitest's runtime); all ops in Workers WebCrypto; no npm dep. Constraints: EC private keys can't `importKey('raw')` → store VAPID private key PKCS8 (send-push's `importP8Key` transfers verbatim); `encrypt()` needs injectable `{asKeyPair, salt}` for vector tests; VAPID JWT tested by verify-round-trip |
| C1 | Notification preferences (any layer) | MISSING | grep zero matches |
| C2 | Role-default + per-employee-override prior art | HAVE (pattern) | `PermissionsTab` (`upsert_permission`) + `PageAccessTab` (`employee_page_access`, 3 RPCs, `canAccess` 4-layer resolver) |
| D1 | Email channel plumbing | HAVE | `functions/lib/email.js` `sendEmail` (Resend, `restoration@utahpros.app`); NOTIFY_FROM precedent in google-calendar.js:55 |
| D2 | Employee email coverage | PARTIAL | **5/20 employees have NULL email** — sends skip + report; owner data fix in anytime lane |
| E1 | Event origins traced (per type) | HAVE (map) | See catalog table below — every emit hook has a file:line origin, challenge-corrected |
| E2 | DB→worker trigger mechanism | HAVE (live prior art) | pg_net 0.19.5 installed; `trg_appointment(_crew)_calendar_sync` enabled; pattern = `integration_config` URL + `x-webhook-secret` + inert-guard + `IS NOT DISTINCT FROM` guards |
| F1 | iOS install guidance prior art | HAVE | `TechLayout.jsx` InstallBanner (:105-181): beforeinstallprompt + iOS "Share → Add to Home Screen"; field_tech-only today |
| F2 | PWA installability | HAVE | manifest standalone + apple meta tags; icons SVG-only (PNG fallback advisable) |

## Event catalog (v1 — seeded by F2; adding a type later = 1 catalog row + 1 emit hook)

| Key | Origin (emit hook) | Audience | Default channels (seed) |
|---|---|---|---|
| `message.inbound` | `twilio-webhook.js:209` (only `sms_inbound` writer — challenge-CONFIRMED) | conversation.assigned_to, else office roles | bell+push on, email off |
| `appointment.assigned` | DB trigger on `appointment_crew` INSERT (covers all 7 frontend write sites) | the crewed employee | bell+push on; email = the deduped legacy send (finding 5) |
| `appointment.updated` / `.canceled` | DB trigger on `appointments` (guarded UPDATE / cancel) | crew of that appointment | bell+push on, email off |
| `estimate.accepted` | decision fork: `convert_estimate_to_invoice` code sites vs `estimates UPDATE OF status` trigger (1/14 live approved rows bypassed convert — out-of-band write) | admins | bell+push+email on (admin-curated) |
| `payment.received` | **`functions/lib/qbo-payment-sync.js`** (the LIB — imported by BOTH qbo-webhook and the cron; challenge-MODIFIED) + `stripe-webhook.js:142` + `qbo-charge.js:85`; frontend inserts (InvoiceEditor:415, ClaimBilling:103) + MCP imports bypass workers → decision fork (worker hooks vs payments-INSERT trigger w/ retroactive-import guard) | admins | bell+push+email on (admin-curated) |
| `lead.new` | `callrail-webhook.js` (idempotent per lead; hook NOT in the RPC — `callrail-backfill.js` shares it and must never fire) + `form-submit.js`; explicit decision on `create_manual_lead` (CrmLeads.jsx:436) | admins | bell+push on |
| `esign.signed` | `submit-esign.js` (rewire existing bell call) | admins | bell+push on |
| `feedback.submitted` | `feedback-notify.js` (rewired by F2 as the reference event) | admins minus submitter | bell+push on |
| `timesheet.change_requested` / `clock.abandoned` | existing SQL RPC bell calls (additive: dispatcher path later; bell keeps working regardless) | admins | bell on |
| `timesheet.change_reviewed` | existing SQL RPC bell call | the requesting employee | bell on |

**Seed conservatism (noise guardrail, challenge-amended):** bell on everywhere it is today;
**push is structurally opt-in** (no `push_subscriptions` row = nothing to deliver to);
**email default-silent** except the admin-curated rows above. Session B decision fork: any
pushed/emailed channel that could be noisy before C/D land ships default-silent.

## Design

- **Three-layer prefs (collision-proofed by the challenge pass):**
  `notification_role_defaults` (role × type × channel + `user_customizable` lock — Session D
  writes) → `notification_employee_overrides` (admin per-employee — Session D writes) →
  `notification_prefs` (self-service — Session C writes). Precedence lives ONLY in
  **`get_effective_notification_prefs(p_employee_id)` — fully implemented by F2, never a stub,
  frozen in-wave** (the challenge's #1 predicted wave collision was two sessions body-filling
  this resolver).
- **Per-recipient bell:** `notifications.recipient_id uuid NULL` additive (NULL = broadcast →
  every existing row and caller keeps today's behavior; per-user read state free; realtime
  unchanged). Bell RPCs gain `p_employee_id uuid DEFAULT NULL` via **DROP+CREATE** (OR REPLACE
  would mint ambiguous overloads — the `20260702_feedback_media.sql` trap). Challenge-CONFIRMED
  execution details: ALTER TABLE ADD COLUMN **before** the RPC DROP+CREATEs in one transaction;
  re-GRANT after each; PostgREST auto-reloads via ddl_watch; NotificationBell's call shapes
  ({}, {p_limit}) resolve fine against defaulted params.
- **Dispatcher `functions/api/notify.js`:** POST an event → resolve audience → effective prefs
  per recipient → per-recipient `notifications` rows (bell + realtime toast) → Web Push via
  `functions/lib/webPush.js` per subscription (404/410 prunes) → email via `sendEmail`
  (NULL-email skips reported) → optional APNs forward to `send-push` (unchanged, dormant).
  Missing VAPID env → 503-skip push (the APNs precedent — code/tests never block on the owner
  action). Bearer auth (feedback-notify shape); DB triggers call it with the
  `integration_config` URL + `x-webhook-secret` pattern (live 20260630 prior art).
- **Web Push crypto `functions/lib/webPush.js`:** VAPID ES256 JWT (aud = endpoint origin,
  exp, sub = mailto) + RFC 8291 aes128gcm. VAPID private key stored **PKCS8** so
  `send-push.js`'s `importP8Key`/sign/b64url transfer verbatim; `encrypt()` takes injectable
  `{asKeyPair, salt}` (prod defaults: generateKey/getRandomValues) so the RFC 8291 Appendix A
  vector is assertable byte-for-byte; JWT correctness via `crypto.subtle.verify` round-trip.
- **Service worker:** new `public/sw.js` = **push + notificationclick handlers ONLY — no fetch
  caching, ever** (the MIME trap cannot re-form without a caching fetch handler).
  `main.jsx:44-72` rewritten: flag ON → register (web only); flag OFF → today's kill-switch
  behavior **verbatim** (unregister + cache wipe + /reset bounce). Because feature flags load
  post-auth, main.jsx reads a **localStorage mirror written by AuthContext** when flags load
  (one-page-load propagation lag accepted, both directions). BUILD_ID bump ships with it.
  `registerSW.js` (dead code) is rewritten as the registration helper or deleted — F1 decides.
- **Kill-switches:** `feature:web_push` flag (+ its `force_disabled` column) gates SW
  registration + subscribe UI; push channel dies with the flag; bell/email unaffected.

## Options on record

- **Reuse orphan `notification_queue`:** REJECTED — unversioned, anon-open writes, `channel`
  default `'in_app'`, overlapping-but-different shape; precedent is leaving orphans untouched.
  Caveat under which reuse wins: none (leaving it costs nothing).
- **Extend `device_tokens` for web:** REJECTED — web push needs endpoint+p256dh+auth (different
  shape) and secret-safe RLS (finding 4); device_tokens is unversioned drift we won't compound.
  Caveat: a future unifying view if APNs-native and web ever merge.
- **Per-recipient rows vs recipient-array on one row:** CHOSEN rows (fan-out-on-write) —
  per-user read state free, realtime unchanged, broadcast = NULL recipient.
- **Digests / quiet hours / batching:** out of v1; the catalog+prefs schema doesn't preclude
  them.

---

## Phase F1 — Delivery spike (SW re-enable + Web Push crypto + one real push)

> **Branch:** harness-assigned, cut from `origin/dev`. **Prerequisite:** this plan-of-record
> merged into `dev`. Model: **Opus · high** (two incident-capable surfaces: reversing the SW
> kill-switch on the platform it once blanked, and net-new browser crypto).
> **Read scope:** this block + ownership matrix below + `CLAUDE.md` + the SW/crypto facts above.
> **Close-out checklist:**
> - [x] Test-first, now green: `functions/lib/webPush.test.js` — RFC 8291 Appendix A
>       byte-for-byte (injectable `{asKeyPair, salt}`); VAPID JWT via `crypto.subtle.verify`
>       round-trip + header/claims decode; b64url edges. (10 tests; committed failing first.)
>       Own-row RPCs: `supabase/tests/notify_f1_push_subscriptions.test.js` locks the anon
>       boundary (table not anon-SELECTable; RPCs not anon-EXECUTable). *The authenticated
>       own-row happy path needs a real user JWT the vitest harness lacks — it's exercised by the
>       browser subscribe flow + the owner gate; disclosed in the test header.*
> - [x] Acceptance: new push-only `sw.js` (push + notificationclick, zero fetch caching);
>       `main.jsx` SW block rewrite with localStorage flag mirror (flag OFF path = today's
>       kill-switch verbatim); BUILD_ID bumped (`2026-07-03-web-push-f1`); `registerSW.js`
>       rewritten as the registration + mirror helper; `push_subscriptions` migration applied via
>       MCP (RLS on, **no anon SELECT/policy**, own-row RPCs, GRANTs, UNIQUE endpoint);
>       `src/lib/webPushClient.js` subscribe primitives; SETTINGS_NAV "Notifications" entry +
>       skeleton NotificationsPanel with ONE working "Enable push on this device" row;
>       one hardcoded `feedback.submitted` push (called from feedback-notify, additive,
>       fire-and-forget) behind `feature:web_push`; VAPID keypair generated and handed to the
>       owner (PKCS8 private; public also as `VITE_VAPID_PUBLIC_KEY`).
> - [x] `npm run test` (430 passed / 77 skipped) + `npm run build` + `npx eslint` (zero new
>       errors — 5 errors / 2 warnings, identical to base) pass; `migration-safety-checker` +
>       `upr-pattern-checker` clean (both PASS, no violations).
> - [x] **OWNER GATE (stop-the-line) — PASSED 2026-07-03.** VAPID stored in **Supabase**
>       (`integration_credentials` private + `integration_config` public/subject). Owner installed
>       the PWA, enabled push, and **a real push landed on the owner's device** — delivery
>       confirmed. F2 and the wave are cleared to launch. *(The tech-side enable-push toggle now
>       also lives in the shipped `/tech/settings` hub — see the F2 amendment below.)*
> - [x] `UPR-Web-Context.md` — filled the pre-labeled **F1** sub-header.
> - [x] Reconciled this doc's checkboxes. No test rows/subscriptions were created (the
>       `feature_flags` row is a config seed, not test data); nothing to delete. Pushed; PR into
>       `dev` as a handoff (owner merges; no babysitting).

Scope: owns `public/sw.js`, `src/main.jsx` (SW block), `src/lib/registerSW.js`,
`functions/lib/webPush.js` (+test), `src/lib/webPushClient.js`, the `push_subscriptions`
migration, `src/pages/Settings.jsx` (SETTINGS_NAV entry + skeleton panel), one additive
fire-and-forget block in `functions/api/feedback-notify.js`, `feature:web_push` flag seed.

## Phase F2 — Data foundation (catalog + prefs + per-recipient bell + dispatcher)

> **Branch:** harness-assigned, cut from `origin/dev`. **Prerequisite:** **F1 merged AND its
> owner gate passed** (a real iOS push confirmed). Model: **Opus · high** (live bell-RPC
> DROP+CREATE cutover on the shared Supabase).
> **Read scope:** this block + ownership matrix + `CLAUDE.md` + the RPC-cutover facts above.
> **Close-out checklist:**
> - [x] Test-first, now green: `supabase/tests/notify_foundation.test.js` — OLD bell call
>       shapes ({}, {p_limit}) still succeed post-cutover (no overload ambiguity); recipient
>       targeting (targeted row invisible to others, broadcast visible to all); resolver
>       precedence table (role default → employee override → my-pref → lock);
>       `functions/api/notify.test.js` — injected-fakes dispatcher (audience resolution,
>       prefs filtering, NULL-email skip reported, VAPID-missing 503-skip, subscription prune).
>       *(The integration suite self-skips without creds like the other CRM suites; its
>       assertions — bell cutover, targeting, and the full 5-stage resolver precedence —
>       were verified live against the shared Supabase via MCP this session.)*
> - [x] Acceptance: migration applied + verified live via MCP (ALTER-first ordering,
>       re-GRANTs, `bust_postgrest_cache()`); live bell verified working (old code, new RPCs);
>       catalog + conservative seeds live (12 types, only feedback.submitted enabled);
>       `get_effective_notification_prefs` FULLY implemented; dispatcher delivers
>       `feedback.submitted` through the resolver (feedback-notify rewired, replacing F1's
>       hardcoded call); appointment triggers created inert (20260630 pattern:
>       `integration_config` `notify_worker_url` + `notify_webhook_secret` seeded this session,
>       inert-guard, `IS NOT DISTINCT FROM` column guards); named frozen stubs for C + D;
>       NotificationBell passes employee id + mounts in TechLayout; reserved index.css markers
>       (C, D); UPR-Web-Context pre-labeled Session B/C/D sub-headers. *(APNs `send-push` forward
>       was deemed optional and omitted — native push stays separate/dormant, Web Push is the
>       real F2 push channel.)*
>
> **⚠️ AMENDMENT (2026-07-03) — tech notifications surface is the shipped `/tech/settings` hub.**
> After F2 was planned, a tech **Settings hub** shipped separately (P1): `/tech/settings` route +
> a "Settings" row in `TechMore.jsx` + `src/components/tech/settings/NotificationsSection.jsx`
> (already does device enable/disable push, reusing `webPushClient`) + a System/Light/Dark theme.
> Therefore **F2 does NOT create a `/tech/notifications` route, a TechMore row, or a stub
> `TechNotifications.jsx`** — those would duplicate the hub. F2 still mounts `NotificationBell`
> in `TechLayout` and owns everything else unchanged. **Session C** fills the per-type prefs
> matrix into the existing `NotificationsSection.jsx` (see amended Session C scope). If a running
> F2 session already created the route/row/stub, it removes them.
> - [x] `npm run test` (487 passed / 85 skipped) + `npm run build` (435 modules) + `npx eslint`
>       (no new errors) pass; `migration-safety-checker` + `upr-pattern-checker` clean.
> - [~] Visual: bell on desktop + tech shell — **deferred to the Cloudflare branch preview** the
>       PR generates: this session's environment has no Supabase creds (only `.env.example`), so
>       the authenticated app can't render locally. Build passes; the change is two floating
>       fixed-position elements (office bell unchanged at 36px; tech bell top-right, 46px).
> - [x] `UPR-Web-Context.md` — filled the pre-labeled **F2** sub-header (and refreshed the older
>       In-App Notifications section to the per-recipient reality).
> - [x] Reconcile checkboxes; delete test rows (sentinels cascade-cleaned; only the 1 pre-existing
>       broadcast notification remains); push; PR into `dev` as a handoff.

Scope: owns the F2 migration (catalog + 3 prefs tables + recipient_id + bell cutover + stubs +
triggers), `functions/api/notify.js`, `src/components/NotificationBell.jsx`,
`src/components/TechLayout.jsx` (bell mount only), index.css markers, doc sub-headers.
**Per the amendment above, F2 no longer owns `src/App.jsx` (route), the `TechMore.jsx` row, or a
stub `TechNotifications.jsx` — the `/tech/settings` hub supersedes them.**

### Frozen stub signatures (contracts — body-only fills in-wave; `migration-safety-checker` enforces)

**Session C fills:** `get_my_notification_prefs(p_employee_id uuid) → SETOF json`,
`set_my_notification_pref(p_employee_id uuid, p_type_key text, p_channel text, p_enabled boolean) → notification_prefs`,
`get_my_push_subscriptions(p_employee_id uuid) → SETOF json` (secrets NEVER returned — endpoint
hash/label only). *(`upsert_push_subscription`/`delete_push_subscription` ship real in F1.)*

**Session D fills:** `get_notification_defaults() → SETOF json`,
`set_notification_default(p_role text, p_type_key text, p_channel text, p_enabled boolean, p_user_customizable boolean DEFAULT NULL) → notification_role_defaults`,
`get_employee_notification_overrides(p_employee_id uuid) → SETOF json`,
`set_employee_notification_override(p_employee_id uuid, p_type_key text, p_channel text, p_enabled boolean, p_actor_id uuid DEFAULT NULL) → notification_employee_overrides`,
`delete_employee_notification_override(p_employee_id uuid, p_type_key text, p_channel text) → void`.

**Nobody REPLACEs:** `get_effective_notification_prefs` (F2-owned, fully implemented).

## Session B — Event wiring

> **Branch:** harness-assigned, cut from `origin/dev`. **Prerequisite:** F2 merged. Model:
> **Opus · medium**. **Read scope:** this block + ownership matrix + `CLAUDE.md`.
> **Close-out checklist:**
> - [x] Test-first, now green: hook tests per event (injected fakes): emit fires with correct
>       type/payload; **payment-webhook hooks are fire-and-forget (a notify failure never
>       throws into the payment path)**; callrail idempotency (re-delivery/upsert does not
>       re-fire); backfill never fires; google-calendar dedupe (prefs-off employee gets no
>       legacy email; no double email when both paths on). Files: `twilio-webhook.test.js`,
>       `lead-notify.test.js`, `qbo-payment-sync.test.js`, `submit-esign.test.js`,
>       `google-calendar.test.js`.
> - [x] Acceptance: hooks live in twilio-webhook (`message.inbound`),
>       `functions/lib/qbo-payment-sync.js` + stripe-webhook + qbo-charge (`payment.received`),
>       callrail-webhook + form-submit (`lead.new`), submit-esign rewired; **the four code-hook
>       types flipped `enabled=true` with their F2 seeds** (`message.inbound`, `payment.received`,
>       `lead.new`, `esign.signed` — via MCP; effective-prefs resolution confirmed live for an admin).
> - [~] **appointment.assigned/updated/canceled: NOT enabled here — deferred to the `dev → main`
>       release.** Their triggers (created live by F2) POST to
>       `notify_worker_url = https://utahpros.app/api/notify` (**prod**), where `notify.js` is not
>       yet deployed (it's on `dev`, not `main`) — enabling now would fire prod triggers into a 404
>       and can't be E2E-verified without a live preview, which a headless pre-merge session cannot
>       do. **Activation runbook** (owner, at the prod release, after confirming `/api/notify` is
>       live on prod + a real crew-add lands a notification on the branch preview): run
>       `UPDATE public.notification_types SET enabled=true WHERE type_key IN ('appointment.assigned','appointment.updated','appointment.canceled');`
> - [x] Decision forks resolved AND recorded (full write-up in `UPR-Web-Context.md` → Session B):
>       **payments = worker-hooks** (chosen; a payments-INSERT trigger would also cover frontend/MCP
>       inserts but needs a retroactive-import guard and IS schema — flagged as a possible future
>       reviewed migration, not shipped; coverage gap = manual frontend / MCP-import payments don't
>       notify, accepted); **estimate.accepted = not wired by B** (its origins are outside B's 8-file
>       ownership and a trigger is schema; direction = code-site hooks as a follow-up; type stays
>       disabled); **`create_manual_lead` = OUT** of `lead.new`; **noisy channels default-silent** —
>       kept F2's seeds (push opt-in; email only on curated `payment.received`).
> - [x] `npm run test` (527 passed / 85 skipped; the 1 pre-existing `techQuery.test.js` failure —
>       missing `@tanstack/react-query` in this env — is on the base, unrelated) + `build` + eslint
>       (zero new errors) pass; **zero schema migrations**; frozen files untouched;
>       `upr-pattern-checker` clean (PASS — advisory-only: doc-header guideline on 4 pre-existing
>       files; sync-await vs waitUntil, safe since every helper swallows its own errors).
> - [x] `UPR-Web-Context.md` — **Session B** sub-header filled. Checkboxes reconciled. No test rows
>       created (the 4 type-enable flips are the persistent deliverable, not test data; appointment.*
>       left disabled). Pushed; PR into `dev` as a handoff.

Scope: owns `functions/api/{twilio-webhook,stripe-webhook,qbo-charge,callrail-webhook,form-submit,submit-esign}.js`,
`functions/lib/{qbo-payment-sync,google-calendar}.js` (additive hooks + the `emailKind`
dedupe seam only), hook tests. No schema, no UI, no CSS.

**Type-enable state after Session B** (shared prod DB — one Supabase for dev+main):
`feedback.submitted` (F1/F2), `message.inbound`, `payment.received`, `lead.new`, `esign.signed`
= **enabled**; `appointment.assigned|updated|canceled` = **disabled** (activation runbook above);
`estimate.accepted`, `timesheet.change_requested|change_reviewed`, `clock.abandoned` = **disabled**
(no B hook — later phases / follow-ups).

## Session C — My-prefs UI (desktop + tech)

> **Branch:** harness-assigned, cut from `origin/dev`. **Prerequisite:** F2 merged. Model:
> **Opus · medium**. **Read scope:** this block + ownership matrix + `CLAUDE.md` +
> `.claude/rules/tech-mobile-ux.md` + `UPR-Design-System.md`.
> **Close-out checklist:**
> - [x] Test-first, now green: stub-fill migration tests (my-pref upsert round-trip; locked
>       row rejected; `get_my_push_subscriptions` never returns p256dh/auth/endpoint secrets).
>       `supabase/tests/notify_c_my_prefs.test.js` (integration — self-skips without creds like
>       the other notify suites; committed failing first, then verified live via MCP: round-trip,
>       lock rejection P0001, hash-only shape).
> - [x] Acceptance: NotificationsPanel complete (types×channels from the resolver via
>       `get_my_notification_prefs`, locked rows disabled with a 🔒 hint, device list + two-click
>       remove w/ real unsubscribe for the current device, "Enable push on this device"); the tech
>       prefs matrix (≥48px targets, same shared `NotificationPrefsMatrix`, tech-visible categories
>       only) rendered **inside the shipped `/tech/settings` hub's `NotificationsSection.jsx`** (no
>       new `/tech/notifications` page); iOS-not-installed state shows the standalone-check
>       "Share → Add to Home Screen" guidance; desktop permission flow via the existing enable row.
> - [x] `npm run test` (518 pass / 88 skip) + `build` (clean) + eslint (no new errors — the 3
>       pre-existing `LookupTable` react-hooks errors in Settings.jsx are untouched) pass; **zero
>       schema beyond its own body-only stub fills**; frozen files untouched (sw.js, main.jsx,
>       webPushClient.js, App.jsx…); `migration-safety-checker` + `upr-pattern-checker` clean.
> - [~] Visual: tech page at 390px + Settings panel — **deferred to the Cloudflare branch preview**
>       the PR generates (this environment has no Supabase creds, so the authenticated app can't
>       render locally — same as F2). Build passes; new UI is checkbox-grid + device-list markup
>       styled with tokens in the Session C css marker.
> - [x] `UPR-Web-Context.md` — filled the **Session C** sub-header only; wrote its index.css
>       reserved section only. Reconciled these checkboxes; deleted all test rows/subscriptions
>       (sentinel types cascade-cleaned; 0 leftover verified via MCP); push; PR into `dev` as a
>       handoff.

Scope: owns `src/components/tech/settings/NotificationsSection.jsx` (fills the tech prefs matrix
into the shipped `/tech/settings` hub — the enable-push row already exists there from P1) and the
office `Settings.jsx` NotificationsPanel content, its C-stub body fills, its index.css section.
*(Amended 2026-07-03: replaces the retired `TechNotifications.jsx` standalone page.)*

## Session D — Admin defaults UI

> **Branch:** harness-assigned, cut from `origin/dev`. **Prerequisite:** F2 merged. Model:
> **Opus · medium**. **Read scope:** this block + ownership matrix + `CLAUDE.md` +
> `UPR-Design-System.md`.
> **Close-out checklist:**
> - [ ] Test-first, now green: stub-fill tests (role-default upsert; per-employee override +
>       delete; lock flips propagate through `get_effective_notification_prefs` — asserted via
>       the F2 resolver, not re-implemented).
> - [ ] Acceptance: Admin.jsx "Notifications" tab — role × type × channel matrix
>       (PermissionsTab pattern, auto-save toggles), per-employee tri-state overrides
>       (PageAccessTab pattern: default/override/effective + clear), `user_customizable` lock
>       per role×type; admin-only (AdminRoute precedent — in-component role check).
> - [ ] `npm run test` + `build` + eslint pass; **zero schema beyond its own body-only stub
>       fills**; frozen files untouched; `upr-pattern-checker` clean.
> - [ ] Visual: Admin tab on the branch preview.
> - [ ] `UPR-Web-Context.md` — **Session D** sub-header only; its index.css reserved section
>       only. Reconcile; delete test rows; push; PR into `dev` as a handoff.

Scope: owns `src/pages/Admin.jsx` (new tab), new admin matrix component file(s), its D-stub
body fills, its index.css section.

---

## Dependency graph

```
plan-of-record (this doc) merged into dev
        │
        ▼
   Phase F1 ── OWNER GATE: real push on owner's iPhone PWA + desktop (stop-the-line)
        │
        ▼
   Phase F2 ── hard artifact edges ──► Session B ─┐
        │                                          ├─ one parallel wave (disjointness proven)
        ├──────────────────────────► Session C ───┤
        └──────────────────────────► Session D ───┘

anytime lane (owner actions — hard gates, degrade-graceful; no wave slot):
  · VAPID_* env vars (both CF env sets) + feature:web_push flip  → INSIDE F1's gate
  · fix 5 employees with NULL email                              → email channel coverage
  · APNS_* enrollment + native device tokens                     → unrelated, unchanged
```

Edge types: F1→F2 **hard + owner-gated** (F2 consumes F1's table/lib; the counter-ordering
adjudication forbids the two incident-capable subsystems sharing a PR). F2→{B,C,D} hard
artifact edges. B↔C, B↔D, C↔D **independent** (proven — see ownership). Merge order within the
wave is a preference, never a gate; throttle freely.

## Dispatch model

- **Wave 0** = F1 alone → owner gate → **Wave 0.5** = F2 alone → **Wave 1** = B ∥ C ∥ D.
- Sessions work on harness-assigned branches, open a **PR into `dev` as a handoff, then stop**
  (owner merges; no click-merge, no subscribing, no babysitting). Copy-paste prompts:
  `docs/notify-dispatch.md`.
- **No feature flag debate:** `feature:web_push` gates the push channel; prefs/bell surfaces
  ship ungated (internal, all-employees-by-design); production exposure stays gated by the
  reviewed `dev → main` PR.
- **Progress tracking:** non-CRM initiative → THIS doc's phase checklists (feedback-media
  precedent; the CRM tracker is not used).

## Ownership matrix & frozen list (authoritative for the wave)

| Session | Owns exclusively (edit only these) | New files it creates |
|---|---|---|
| F1 | `public/sw.js`, `src/main.jsx` (SW block), `src/lib/registerSW.js`, `src/pages/Settings.jsx` (NAV entry + skeleton panel), `functions/api/feedback-notify.js` (one additive block), `feature:web_push` seed, push_subscriptions migration | `functions/lib/webPush.js` (+test), `src/lib/webPushClient.js` |
| F2 | F2 migration (catalog/prefs/recipient_id/cutover/stubs/triggers), `functions/api/notify.js` (+test), `NotificationBell.jsx`, `TechLayout.jsx` (bell mount), css markers, doc sub-headers · *(amended: NO App.jsx route / TechMore row / stub page — superseded by the shipped `/tech/settings` hub)* | `functions/api/notify.js` |
| B | `functions/api/{twilio-webhook,stripe-webhook,qbo-charge,callrail-webhook,form-submit,submit-esign}.js`, `functions/lib/{qbo-payment-sync,google-calendar}.js` (hooks + emailKind seam) | hook tests |
| C | `src/components/tech/settings/NotificationsSection.jsx` (fill the prefs matrix into the shipped hub), office `NotificationsPanel` component(s), C-stub body fills, its css section | panel component file(s) |
| D | `src/pages/Admin.jsx` (new tab), admin matrix component(s), D-stub body fills, its css section | matrix component file(s) |

**Frozen in-wave (nobody edits after F2 ships):** `public/sw.js`, `src/main.jsx`,
`src/lib/registerSW.js`, `src/App.jsx`, `src/contexts/AuthContext.jsx`,
`functions/api/notify.js`, `functions/lib/webPush.js`, `src/lib/webPushClient.js`,
`get_effective_notification_prefs` (and every F1/F2 schema object), `functions/api/send-push.js`
+ `functions/api/feedback-notify.js` (call-only), `src/components/NotificationBell.jsx`.
Shared-table writes are DATA only. **Zero schema migrations in-wave** beyond each session's
own body-only stub fills; a wave session needing a column stops and flags it.

## What resisted maximum parallelism (honest record)

① F1→F2 serial — F2 consumes F1's table+lib, and the challenge adjudication requires the SW
re-enable and the live bell-RPC cutover in separate PRs (each independently incident-capable).
② The mid-F1 owner gate is a deliberate stop-the-line: the plan's highest-uncertainty element
(iOS PWA delivery) is validated before the edifice is built on it. ③ `UPR-Web-Context.md`
co-edited by B/C/D — mitigated by F2's pre-labeled sub-headers. ④ Out-of-band DB writes (bulk
payment imports; 1 rogue approved estimate) make two hooks decision forks instead of clean
single-point hooks. ⑤ `get_effective_notification_prefs` had two colorable owners (C and D) —
resolved by F2 shipping it fully implemented and frozen. ⑥ Legacy google-calendar employee
email couples `appointment.assigned` email to Session B's dedupe seam — accepted (single
owner). ⑦ Push delivery, email coverage (5 NULL emails), and APNs remain owner-gated external
actions — all built degrade-graceful so nothing in-wave waits on them.
