# Notification Center — Dispatch Blocks (2026-07-03)

Copy-paste session prompts for the phases in `docs/notify-roadmap.md` (the authoritative plan
of record — if any name here drifts from the roadmap's ownership matrix, **the roadmap wins**).

## Preconditions

| Wave | Launch after | Owner pre-decisions due |
|---|---|---|
| Wave 0 — Phase F1 | this plan-of-record is on `dev` | none to start; **mid-phase**: set `VAPID_*` env vars in BOTH Cloudflare env sets + flip `feature:web_push` + confirm a real push on your iPhone home-screen PWA (the stop-the-line gate) |
| Wave 0.5 — Phase F2 | F1 merged into `dev` **and its owner gate passed** | none |
| Wave 1 — Sessions B ∥ C ∥ D (may launch simultaneously) | F2 merged into `dev` | for B: payments hook style (worker-hooks vs trigger), estimate hook style, `create_manual_lead` in/out — B carries defaults if unanswered |

Anytime lane (blocks nothing, enables delivery): fix the 5 employees with NULL email.

---

## Phase F1 — Delivery spike

```
[Phase F1 — Wave 0]
Branch: session-assigned, cut from origin/dev
Model: Opus · high
Launch after: notify plan-of-record merged into dev

You are building Phase F1 (delivery spike) of the Notification Center initiative — one phase
only, no scope creep. Read scope: CLAUDE.md, the "Phase F1" block + ownership matrix in
docs/notify-roadmap.md (binding). Mission: prove Web Push end-to-end on the installed iPhone
PWA and desktop before anything else is built. Hard constraints: this is the ONLY phase allowed
to touch public/sw.js, src/main.jsx, src/lib/registerSW.js; the new sw.js contains push +
notificationclick handlers ONLY — no fetch caching of any kind, ever (the Apr-2026 MIME trap
needed a caching fetch handler; do not re-create it); main.jsx's flag-OFF path must preserve
today's kill-switch behavior (unregister + cache wipe + /reset bounce) verbatim; feature flags
load post-auth so main.jsx reads a localStorage mirror written by AuthContext when flags load
(one-load lag accepted); bump BUILD_ID. Test-first (commit failing first):
functions/lib/webPush.test.js — RFC 8291 Appendix A byte-for-byte (encrypt() must accept
injectable {asKeyPair, salt}; prod defaults generateKey/getRandomValues) + VAPID ES256 JWT via
crypto.subtle.verify round-trip (never byte-compare — ECDSA is randomized) + b64url edges.
Build: (1) functions/lib/webPush.js — VAPID JWT (aud = push-endpoint origin, exp, sub =
mailto:) reusing send-push.js's importP8Key/sign/b64url primitives (store the VAPID private key
PKCS8 — raw EC private import is unsupported in WebCrypto) + aes128gcm encryption; (2) the
push_subscriptions migration — RLS ON with NO anon SELECT policy (endpoint+p256dh+auth are
send-capability secrets; documented deviation from the house USING(true) pattern), own-row
SECURITY DEFINER RPCs upsert_push_subscription/delete_push_subscription + GRANTs, UNIQUE
(endpoint); apply via MCP apply_migration; (3) src/lib/webPushClient.js — subscribe primitives
(permission → pushManager.subscribe(applicationServerKey: VITE_VAPID_PUBLIC_KEY) → upsert RPC);
(4) new public/sw.js + the main.jsx:44-72 rewrite behind feature:web_push (seed the flag,
default OFF) + decide registerSW.js's fate (rewrite as the helper or delete); (5) a minimal
"Enable push on this device" row in a new skeleton NotificationsPanel wired into Settings.jsx
SETTINGS_NAV; (6) one hardcoded feedback.submitted push: an additive fire-and-forget block in
functions/api/feedback-notify.js that web-pushes each admin's subscriptions (503-skip when
VAPID env is missing — the APNs precedent); (7) generate the VAPID keypair and hand the owner
the exact env values (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY pkcs8, VAPID_SUBJECT,
VITE_VAPID_PUBLIC_KEY) for BOTH Cloudflare env sets. OWNER GATE (stop-the-line, in-phase): the
owner sets the env vars, flips feature:web_push, installs the PWA on their iPhone (Share → Add
to Home Screen), enables push in Settings, submits a test feedback, and a real push lands on
the locked iPhone AND on desktop Chrome. If iOS delivery fails, HALT and report — F2 and the
wave must not launch against a dead channel. Close-out: npm run test + npm run build + npx
eslint (no new errors); migration-safety-checker + upr-pattern-checker clean; fill the
pre-labeled F1 sub-header in UPR-Web-Context.md; reconcile the F1 checkboxes in
docs/notify-roadmap.md honestly; delete test rows/subscriptions; commit in small steps, push
-u, open a PR into dev via the template, mark it ready, then stop — the PR is a handoff the
owner merges; do NOT subscribe to, babysit, or wait for review on it.
```

## Phase F2 — Data foundation

```
[Phase F2 — Wave 0.5]
Branch: session-assigned, cut from origin/dev
Model: Opus · high
Launch after: F1 merged into dev AND its owner gate passed (a real iOS push confirmed)

You are building Phase F2 (data foundation) of the Notification Center — one phase only, no
scope creep. Read scope: CLAUDE.md, the "Phase F2" block + ownership matrix + frozen-stub
signatures in docs/notify-roadmap.md (binding). F1 shipped: webPush.js crypto,
push_subscriptions + own-row RPCs, webPushClient.js, the push-only sw.js behind
feature:web_push, a skeleton Settings NotificationsPanel, and a hardcoded feedback push. You own
100% of the remaining schema — the wave after you ships zero schema. Test-first (commit failing
first): supabase/tests/notify_foundation.test.js — old bell call shapes ({} and {p_limit:30})
still succeed after the cutover; targeted rows invisible to other employees while broadcast
(NULL recipient) rows stay visible to all; resolver precedence (role default → employee
override → my-pref, user_customizable lock wins); functions/api/notify.test.js —
injected-fakes dispatcher (audience resolution, prefs filtering, NULL-email skips reported,
VAPID-missing 503-skip, 404/410 subscription prune). Build, riskiest first: (1) the F2
migration in ONE transaction — ALTER TABLE notifications ADD COLUMN recipient_id uuid NULL (+
type_key text) FIRST, then DROP+CREATE (never OR REPLACE — ambiguous-overload trap, see
20260702_feedback_media.sql) get_notifications(p_limit int DEFAULT 30, p_employee_id uuid
DEFAULT NULL), get_unread_notification_count(p_employee_id uuid DEFAULT NULL),
mark_all_notifications_read(p_employee_id uuid DEFAULT NULL) with recipient_id IS NULL OR
recipient_id = p_employee_id semantics, re-GRANT after every CREATE; notification_types catalog
+ seeds (bell on; push per-type on but structurally opt-in; email silent except
estimate.accepted/payment.received for admins; every type enabled=false except
feedback.submitted); notification_role_defaults (+user_customizable), 
notification_employee_overrides, notification_prefs (all RLS + policy at creation);
get_effective_notification_prefs(p_employee_id) FULLY IMPLEMENTED (never a stub — you are its
only owner, forever frozen in-wave); the C/D frozen stubs exactly as signed in the roadmap
(SECURITY DEFINER + GRANT + RAISE 'not implemented'); appointment emission triggers on
appointment_crew INSERT + appointments guarded UPDATE/cancel copying the live 20260630 pattern
(integration_config keys notify_worker_url + notify_webhook_secret, inert-guard when config
missing, IS NOT DISTINCT FROM column guards) — inert until their types are enabled; apply via
MCP, bust_postgrest_cache(), verify the LIVE bell still works before proceeding. (2)
functions/api/notify.js dispatcher — resolve audience → get_effective_notification_prefs per
recipient → per-recipient create_notification rows → webPush.js per subscription → sendEmail
(from 'UPR - Notifications <restoration@utahpros.app>'; skip+report NULL emails) → optional
send-push forward; Bearer auth in feedback-notify's shape + x-webhook-secret acceptance for
trigger calls; rewire feedback-notify's channels through it (replacing F1's hardcoded block).
(3) NotificationBell.jsx passes employee.id to the new RPC shapes + mount the bell in
TechLayout's header; App.jsx route /tech/notifications + TechMore row pointing at a stub
TechNotifications.jsx page (Session C fills it); reserved index.css markers for Sessions C and
D; pre-labeled Session B/C/D sub-headers in UPR-Web-Context.md. Close-out: npm run test + build
+ eslint; migration-safety-checker + upr-pattern-checker clean; visual check of the bell on
desktop + tech shell on the branch preview; fill the F2 sub-header; reconcile the F2 checkboxes;
delete test rows; push -u; PR into dev as a handoff, mark ready, stop — no babysitting.
```

## Session B — Event wiring (Wave 1 — may run simultaneously with C and D)

```
[Session B — Wave 1]
Branch: session-assigned, cut from origin/dev
Model: Opus · medium
Launch after: F2 merged into dev

You are building Session B (event wiring) of the Notification Center — one phase only, no
scope creep. Read scope: CLAUDE.md, the "Session B" block + ownership matrix + event catalog in
docs/notify-roadmap.md (binding). Foundation shipped: the notify dispatcher
(functions/api/notify.js — call it, never edit it), the catalog (types ship enabled=false),
the resolver, appointment triggers (inert), and per-recipient bell. Your job: put one emit hook
at each event origin and flip types on. Hard constraints: ZERO schema migrations; edit ONLY
functions/api/{twilio-webhook,stripe-webhook,qbo-charge,callrail-webhook,form-submit,
submit-esign}.js and functions/lib/{qbo-payment-sync,google-calendar}.js + your tests; every
hook is additive fire-and-forget — a notify failure must NEVER throw into a webhook's business
path (payment webhooks especially); frozen for you: notify.js, webPush.js, sw.js, main.jsx,
App.jsx, NotificationBell, send-push.js, feedback-notify.js, all schema. Test-first (commit
failing first): per-hook injected-fake tests — correct type_key/payload; payment hooks
swallow notify errors; callrail idempotency (upsert re-delivery does not re-fire lead.new);
callrail-backfill NEVER fires; google-calendar dedupe (employee with the email channel off
gets no legacy assigned/rescheduled email; no double email when both paths are on — wire the
prefs check at the emailKind decision in functions/lib/google-calendar.js:513-537, keyed by
the recipient employee; note assigned_notified_at lives per-(appointment,employee) on
google_calendar_links, NOT on appointments). Wiring list: message.inbound in twilio-webhook.js
(:~209, the only sms_inbound writer); payment.received in functions/lib/qbo-payment-sync.js
(the LIB — it serves BOTH qbo-webhook and the qbo-payments-sync cron; hooking only a worker
misses one path) + stripe-webhook.js + qbo-charge.js; lead.new in callrail-webhook.js +
form-submit.js; esign.signed rewired in submit-esign.js; verify the appointment trigger E2E on
the branch preview and enable appointment.assigned/updated/canceled. Decision forks (resolve +
record in the roadmap): payments worker-hooks (default) vs a payments-INSERT trigger — the
trigger also covers InvoiceEditor/ClaimBilling frontend inserts and MCP imports BUT needs a
retroactive-import guard, and any trigger is schema → flag it back as a separate reviewed
migration, do not ship it yourself; estimate.accepted code-site hooks (default; covers all
in-app acceptances) vs an estimates-status trigger (1 of 14 live approved rows was written
out-of-band — say which coverage you chose and why); create_manual_lead in/out of lead.new
(default: out — manual entry means a human already knows); any channel that could be noisy
before the prefs UIs land ships default-silent. Close-out: npm run test + build + eslint (no
new errors); upr-pattern-checker clean; fill your pre-labeled Session B sub-header in
UPR-Web-Context.md; reconcile the Session B checkboxes honestly (disclose which forks you
took); delete test rows; push -u; PR into dev as a handoff, mark ready, stop — no babysitting.
```

## Session C — My-prefs UI (Wave 1)

```
[Session C — Wave 1]
Branch: session-assigned, cut from origin/dev
Model: Opus · medium
Launch after: F2 merged into dev

You are building Session C (my-preferences UI) of the Notification Center — one phase only, no
scope creep. Read scope: CLAUDE.md, the "Session C" block + ownership matrix + frozen-stub
signatures in docs/notify-roadmap.md (binding), .claude/rules/tech-mobile-ux.md,
UPR-Design-System.md. Foundation shipped: the skeleton Settings NotificationsPanel with a
working "Enable push on this device" row (F1), webPushClient.js subscribe primitives (frozen —
consume, never edit), a stub /tech/notifications page + route + TechMore row (F2), your named
frozen stubs (get_my_notification_prefs, set_my_notification_pref, get_my_push_subscriptions),
and the fully-implemented resolver get_effective_notification_prefs (frozen — read via it,
never REPLACE it). Hard constraints: zero schema beyond function-body-only CREATE OR REPLACE of
YOUR three stubs (signatures frozen; migration-safety-checker enforces); edit only your owned
files + your reserved index.css section; get_my_push_subscriptions must NEVER return endpoint/
p256dh/auth (label + created_at + an endpoint hash only); db from useAuth() only; no
alert()/confirm(). Test-first (commit failing first): stub-fill tests — my-pref upsert
round-trip; a user_customizable=false (locked) row rejects the write; subscription listing
leaks no secrets. Build: (1) fill the three stubs (body-only migrations); (2) complete the
Settings NotificationsPanel — the types×channels checkbox matrix for MY role from the resolver
(locked rows rendered disabled with a lock hint), device list with two-click remove (real
unsubscribe via delete_push_subscription + pushManager unsubscribe), the enable-push row; (3)
build /tech/notifications on the same matrix (≥48px targets, tech-visible types only,
snap-first — no blocking flows); (4) iOS-not-installed state: display-mode:standalone check →
InstallBanner-pattern guidance ("Tap Share → Add to Home Screen") before the enable button
(prior art TechLayout.jsx:105-181). Close-out: npm run test + build + eslint; 
migration-safety-checker + upr-pattern-checker clean; visual check at 390px (tech) + desktop
Settings on the branch preview; fill your pre-labeled Session C sub-header in
UPR-Web-Context.md; reconcile the Session C checkboxes honestly; delete test
rows/subscriptions; push -u; PR into dev as a handoff, mark ready, stop — no babysitting.
```

## Session D — Admin defaults UI (Wave 1)

```
[Session D — Wave 1]
Branch: session-assigned, cut from origin/dev
Model: Opus · medium
Launch after: F2 merged into dev

You are building Session D (admin defaults UI) of the Notification Center — one phase only, no
scope creep. Read scope: CLAUDE.md, the "Session D" block + ownership matrix + frozen-stub
signatures in docs/notify-roadmap.md (binding), UPR-Design-System.md. Foundation shipped: the
three-layer prefs tables, conservative seeds, your named frozen stubs
(get_notification_defaults, set_notification_default, get_employee_notification_overrides,
set_employee_notification_override, delete_employee_notification_override), and the
fully-implemented resolver get_effective_notification_prefs (frozen — assert THROUGH it in
tests, never REPLACE or re-implement it). Hard constraints: zero schema beyond
function-body-only CREATE OR REPLACE of YOUR five stubs (signatures frozen); edit only
src/pages/Admin.jsx (new tab) + your new matrix component file(s) + your reserved index.css
section; db from useAuth() only; no alert()/confirm(); destructive actions (clearing an
employee's overrides) use the two-click inline confirm pattern. Test-first (commit failing
first): stub-fill tests — role-default upsert; employee override set/delete round-trip; a
user_customizable lock flip changes what the RESOLVER returns for an affected employee. Build:
(1) fill the five stubs (body-only migrations; set_notification_default's
p_user_customizable NULL = leave unchanged); (2) Admin.jsx "Notifications" tab — role × type ×
channel matrix with auto-save toggles (mirror PermissionsTab, Admin.jsx:761-956); (3)
per-employee overrides view — employee select → per-type rows showing role-default vs override
vs effective with a tri-state toggle + per-row clear + two-click clear-all (mirror
PageAccessTab, Admin.jsx:992-1288); (4) the lock (user_customizable) toggle per role×type with
a hint that locked rows disappear from users' self-service matrix. Admin-only surface: the tab
lives inside Admin.jsx which already sits behind AdminRoute + an in-component role check.
Close-out: npm run test + build + eslint; migration-safety-checker + upr-pattern-checker
clean; visual check of the tab on the branch preview; fill your pre-labeled Session D
sub-header in UPR-Web-Context.md; reconcile the Session D checkboxes honestly; delete test
rows; push -u; PR into dev as a handoff, mark ready, stop — no babysitting.
```
