# Settings Overhaul — Session Dispatch Blocks

Copy-paste launch blocks for every settings-overhaul session, per the plan of record in
`docs/settings-overhaul-roadmap.md`. Each block is fully self-contained for a cold session
with zero conversation history. Claude Code web hands each session a harness-assigned
`claude/…` branch — use it as-is; the Branch line is the illustrative name for humans.

**How work lands (CLAUDE.md Rule 4):** these sessions are the branch+PR exception — each
cuts a branch and its close-out opens a **PR into `dev` as a ready-to-merge handoff, then
stops**. The owner merges; sessions do NOT click-merge, subscribe to, babysit, or wait for
review. Phase 0 already shipped direct to dev (commit `82ca87d`, 2026-07-04).

**Preconditions:** Wave 0 (Session F) launches now — no hard gate (tech-v2 S/D/C merged;
Schedule Session B anchors are re-pointed BY Session F, owner-approved). Wave 1 (Sessions
A/B/C/D/E/G) launches after F's PR merges into `dev`; all six may run simultaneously —
**merge order is a preference (B→A→C→rest), never a gate; throttle to review bandwidth**.
Session H (P7-lite) launches only after BOTH B (P2) and C (P3) merge. If artifact names
drift, `.claude/rules/settings-overhaul-wave-ownership.md` (committed by F) + the roadmap
phase block are authoritative over anything written here.

---

## Wave 0 — Session F (launch immediately)

```
[Session F — Wave 0]
Branch: session-assigned (illustrative: settings/phase-f-foundation), cut from origin/dev
Model: Opus 4.8 (or the strongest available)
Effort: High
Launch after: nothing — launch now

You are building the Settings Overhaul Phase F — Foundation: ALL structural work,
behavior-identical; one phase only, no scope creep and NO visual polish (polish belongs to
the wave). Read scope: CLAUDE.md; docs/settings-overhaul-roadmap.md — the Phase F block,
gate matrix (GC3-GC8), target IA/route map, and ownership matrix (you commit it as
.claude/rules/settings-overhaul-wave-ownership.md); UPR-Design-System.md (Two-Column
settings pattern + .settings-hub css). Work on your session's assigned branch cut from
origin/dev. Follow the roadmap's 9-step build order EXACTLY, committing after every
numbered step (each independently revertable): (1) additive migration — pg_get_functiondef
drift-capture of the live demo_sheet_schemas RPC family into supabase/migrations/ + new
delete_demo_schema that RAISES on active/ever-published/sheet-referenced versions
(test-first: committed refusal test), GRANT EXECUTE, apply via Supabase MCP only after the
consuming code is committed; (2) shared modules with render tests — components/settings/
{SettingsSection,SettingsPageHeader,LookupTable}.jsx, components/TabLoading.jsx (exported;
update CLAUDE.md's pointer; leave DevTools' local copy alone), the templates module under
src/pages/settings/templates/, src/lib/navKeys.js (NAV_KEYS+PAGE_ACCESS_KEYS+ROLES from
Admin.jsx's duplicate registries), src/lib/owner.js isMoroni() using moroni@utah-pros.com
(replaces 6 hardcoded copies — NOT moroni.s@, that is a test account); (3) dissolve
src/pages/Settings.jsx into src/pages/settings/{Carriers,Referrals,Templates,Commissions,
MyAccount,Notifications}.jsx — Notifications is a verbatim NotificationsPanel move,
MyAccount carries the ?gdrive= toast logic, the /settings/templates/:docType editor needs
its OWN get_document_templates fetch on mount + a router-level unsaved-changes guard (the
in-component confirmBack only covered the breadcrumb); (4) split src/pages/Admin.jsx into
src/pages/settings/{Team,Roles,PageAccess,NotificationDefaults}.jsx (EmployeeModal travels
with Team; drop the redundant in-component admin guard, AdminRoute remains); (5) git-mv
content-identical: PaymentSettings.jsx→settings/Payments.jsx, admin/AdminIntegrations.jsx→
settings/Integrations.jsx, AdminFeedback.jsx→settings/FeedbackInbox.jsx,
AdminDemoSheetBuilder.jsx→settings/ScopeSheets.jsx; (6) SettingsHome (grouped tappable
index + client-side search + ?gdrive= forwarder to /settings/my-account) + SettingsLayout
v2 (grouped rail >=1024px, home/back pattern below; fix the stale '1280' comments — the
real breakpoint is 1024); (7) App.jsx /settings/* tree + the 5 PERMANENT redirects
(/admin→/settings/team, /admin/integrations→/settings/integrations,
/admin/demo-sheet-builder→/settings/scope-sheets, /tech-feedback→/settings/feedback,
/payments/settings→/settings/payments) + unwrap /help from the hub; navItems.jsx
restructure (grouped settings slice; NAV_ITEMS System section → ONE Settings entry with
any-visible-child visibility + hideForRoles:['crm_partner']; keep the roadmap OVERFLOW
entry; pre-add ALL new icons here); migrate Sidebar/TopNav/OverflowDrawer to
isItemVisible(); implement gate line items GC3-GC8 exactly as the roadmap's gate matrix
states — GC8 (Personal group visible to every employee) is owner-approved 2026-07-04, no
other effective-access change is authorized; (8) pre-commit the merge magnets: seven empty
reserved css markers '/* ─── SETTINGS OVERHAUL RESERVED — P<n> (Session <X>) ─── */'
appended BELOW every existing initiative marker at the bottom of src/index.css, pre-labeled
per-session sub-headers in UPR-Web-Context.md, pre-labeled checklist blocks appended to
docs/settings-overhaul-roadmap.md; (9) commit
.claude/rules/settings-overhaul-wave-ownership.md from the roadmap's ownership matrix
(frozen list verbatim) AND re-point Schedule Session B's anchors in
docs/schedule-dispatch.md + docs/schedule-roadmap.md (its navItems.jsx:77/:117 deletions →
the grouped slice; its Admin.jsx:979 row → src/lib/navKeys.js) — owner-approved — plus the
retired-URL doc sweep (QBO-BILLING-STATUS.md, UPR-Web-Context.md). Hard constraints: every
move is behavior-identical (no restyling, no logic changes beyond the named gate items);
App.jsx tech-route region and /crm/* region untouched (tech-v2 M2 + CRM treat them as
stable seams); never edit inside another initiative's index.css marker; sanctioned fallback
if verification budget runs low — ship sub-routes as thin tab-prop wrappers around the
untouched monoliths and transfer the physical splits to P3/P4 in the manifest, disclosed in
the PR as a non-failing outcome. Close-out: named test-first targets green
(delete_demo_schema refusal; all 5 redirects; SettingsHome any-visible-child incl. an
override-only supervisor fixture; templates-editor mount fetch); npm run test + npm run
build + npx eslint (changed files) pass; migration-safety-checker + upr-pattern-checker +
settings-phase-reviewer (Opus) clean; visual check at desktop/1024-1279/mobile widths;
update UPR-Web-Context.md (your sub-header); reconcile the roadmap's Phase F checklist
honestly in both directions; push -u and open a PR into dev using the repo PR template,
mark it ready to merge, then STOP — the owner merges; do not subscribe to or babysit it.
```

---

## Wave 1 — Sessions A/B/C/D/E/G launch simultaneously after F merges

```
[Session B — Wave 1 · P2 Integrations]  (recommended first merge)
Branch: session-assigned (illustrative: settings/p2-integrations), cut from origin/dev
Model: Opus 4.8 · Effort: Medium
Launch after: Session F's PR merged into dev

You are building Settings Overhaul P2 — Integrations; one phase only. Read scope:
CLAUDE.md; docs/settings-overhaul-roadmap.md P2 block; .claude/rules/
settings-overhaul-wave-ownership.md (binding — edit ONLY your owned files);
BILLING-CONTEXT.md for the QBO connection surface. You own exclusively:
src/pages/settings/Integrations.jsx, functions/api/quickbooks-callback.js (and
quickbooks-connect.js only if the 302 target lives there), and your reserved index.css
section '/* ─── SETTINGS OVERHAUL RESERVED — P2 ─── */'. Zero migrations. Build: (1)
rebuild the QuickBooks connect/reconnect/sync-status/backfill card from DevTools'
Integrations tab (read it; do NOT edit DevTools.jsx — Session H deletes that tab later)
as a sibling card beside the GitHub card, behavior-identical against the same RPCs
(get_integration_status, get_qbo_sync_stats) and workers (/api/quickbooks-connect,
/api/qbo-sync-customer), including the ?qbo=connected|error|badstate return handling; (2)
retarget the worker's 302 from /dev-tools?qbo= to /settings/integrations?qbo= — the worker
edit and the page that consumes it MUST land in this same PR (atomic round-trip); (3)
retire the 'API Keys' framing (page title 'Integrations'), and either de-CRM the crm-*
classes or consciously keep them — one decision applied to the whole page, stated in the
PR; (4) design-system pass per UPR-Design-System.md (header, cards, tokens, empty states,
two-click disconnect stays). Test-first named targets: the ?qbo= return-param handler; the
worker redirect target. Close-out: npm run test + build + eslint (changed files);
upr-pattern-checker + settings-phase-reviewer clean; visual check desktop+mobile; update
UPR-Web-Context.md (your sub-header) + your roadmap checklist block only; push -u, open a
ready-to-merge PR into dev, then STOP (owner merges — no babysitting).
```

```
[Session A — Wave 1 · P1 Payments]
Branch: session-assigned (illustrative: settings/p1-payments), cut from origin/dev
Model: Opus 4.8 · Effort: High (real-money surface)
Launch after: Session F's PR merged into dev

You are building Settings Overhaul P1 — Payments & Billing settings; one phase only. Read
scope: CLAUDE.md; docs/settings-overhaul-roadmap.md P1 block; the ownership manifest
(binding); BILLING-CONTEXT.md. You own exclusively: src/pages/settings/Payments.jsx, new
src/lib/useBillingSettings.js, src/pages/Collections.jsx (ONLY the payment-settings gear
link retarget to /settings/payments), and your reserved index.css §P1 marker. Zero
migrations; zero worker edits. Hard constraints: the in-component canEditBilling block is
the page's ONLY access barrier — preserve it verbatim; never call /api/qbo-invoice; the
email-2FA payout-destination flow's semantics are untouchable. Build riskiest-first: (1)
useBillingSettings hook wrapping get_billing_settings/set_billing_setting with
REVERT-ON-ERROR (today the page writes state optimistically before the RPC and never
reverts — test-first: committed failing test that a failed save restores the prior value);
(2) two-click inline confirm on the 'Pay out now' Stripe instant-payout button (today ONE
click moves real money — arm/confirm with onBlur disarm per the design system's two-click
pattern); (3) rebuild the four sections on design-system classes/tokens (kill the inline px
soup and hardcoded hex), proper page header, 44px touch targets, @media(max-width:768px)
pass — behavior-identical otherwise; (4) retarget the Collections gear link. Close-out:
npm run test + build + eslint (changed files); upr-pattern-checker +
settings-phase-reviewer (weight the money paths) clean; visual check desktop+mobile;
UPR-Web-Context.md sub-header + your roadmap checklist block; push -u, ready-to-merge PR
into dev, STOP.
```

```
[Session C — Wave 1 · P3 Team & Access]
Branch: session-assigned (illustrative: settings/p3-team-access), cut from origin/dev
Model: Opus 4.8 · Effort: Medium
Launch after: Session F's PR merged into dev

You are building Settings Overhaul P3 — Team & Access polish; one phase only. Read scope:
CLAUDE.md; docs/settings-overhaul-roadmap.md P3 block; the ownership manifest (binding).
You own exclusively: src/pages/settings/{Team,Roles,PageAccess,NotificationDefaults}.jsx
and your reserved index.css §P3 marker. You CONSUME src/lib/navKeys.js in these pages only
— rewiring any other file to it is an F-owner follow-up, forbidden here. Zero migrations.
Gates are AdminRoute on all four routes — do not change any gate. Build: (1) employee
hard-delete: replace the confirmation MODAL with the inline two-click pattern (CLAUDE.md
Rule 2 — test-first on the armed/disarm behavior); (2) EmployeeModal unsaved-changes guard
(overlay-click/✕ silently discards edits today); (3) PageAccess: replace the inline-styled
fixed grid ('1fr 80px 120px 100px 40px' — crushes phones) with classes + a mobile pass;
proper toggles (admin-toggle pattern), 44px targets; (4) absorb the employee auth-link
audit + invite capability (currently DevTools' Employees tab — read it, do NOT edit
DevTools.jsx; Session H deletes that tab after you merge) into Team, behavior-identical
against get_all_employees + /api/admin-users; (5) design-system pass on all four pages
(headers, cards, tokens, empty states, toasts). Close-out: npm run test + build + eslint;
upr-pattern-checker + settings-phase-reviewer clean; visual check desktop+mobile;
UPR-Web-Context.md sub-header + roadmap checklist block; push -u, ready-to-merge PR into
dev, STOP.
```

```
[Session D — Wave 1 · P4 Workspace + Personal polish]
Branch: session-assigned (illustrative: settings/p4-workspace), cut from origin/dev
Model: Sonnet 5 · Effort: Medium
Launch after: Session F's PR merged into dev

You are building Settings Overhaul P4 — polish of the Workspace + Personal sub-pages; one
phase only. Read scope: CLAUDE.md; docs/settings-overhaul-roadmap.md P4 block; the
ownership manifest (binding); UPR-Design-System.md. You own exclusively:
src/pages/settings/{Carriers,Referrals,Templates,Commissions,MyAccount}.jsx (+ the
templates module pages under src/pages/settings/templates/),
functions/api/google-drive-callback.js, and your reserved index.css §P4 marker. Zero
migrations. Do NOT edit the shared LookupTable/SettingsSection primitives (frozen — flag
needs to the F owner). Build: (1) google-drive-callback.js: retarget the 302 from
/settings?gdrive= to /settings/my-account?gdrive= (F's SettingsHome forwarder stays as a
permanent shim for old links) — worker + any page tweak in this same PR; (2) templates
editor at /settings/templates/:docType: verify its own mount fetch + router-level dirty
guard work end-to-end; add an inline confirm on Reset-to-defaults (today it wipes drafts
silently); (3) hex→token sweep across all five pages (the audit lists the exact drift:
badge/banner hexes, px font soup); (4) Commissions grid mobile reflow (fixed 5-column
inline grid today); consistent empty states (Commissions has a bare 'No employees.' div);
(5) keep every save/dirty behavior otherwise identical. Close-out: npm run test + build +
eslint; upr-pattern-checker + settings-phase-reviewer clean; visual check desktop+mobile;
UPR-Web-Context.md sub-header + roadmap checklist block; push -u, ready-to-merge PR into
dev, STOP.
```

```
[Session E — Wave 1 · P5 Feedback Inbox]
Branch: session-assigned (illustrative: settings/p5-feedback-inbox), cut from origin/dev
Model: Sonnet 5 · Effort: Medium
Launch after: Session F's PR merged into dev

You are building Settings Overhaul P5 — Feedback Inbox; one phase only. Read scope:
CLAUDE.md; docs/settings-overhaul-roadmap.md P5 block; the ownership manifest (binding).
You own exclusively: src/pages/settings/FeedbackInbox.jsx, functions/api/feedback-notify.js
+ functions/api/feedback-notify.test.js, and your reserved index.css §P5 marker. Zero
migrations. Build: (1) feedback-notify.js: stop minting the retired '/tech-feedback' URL —
write '/settings/feedback' into the push payload route and the p_link of
create_notification (historical notifications rows keep working via F's permanent
redirect); update the committed test to assert the NEW route (this is the route change the
phase exists for, not greening a test); (2) move the component-local <style> block from
FeedbackInbox.jsx into your index.css §P5 section (CLAUDE.md: all styles in index.css);
(3) page title/label 'Feedback Inbox' (it receives desktop + tech submissions); (4) badge
hex maps (TYPE_BADGE/STATUS_BADGE) → tokens; keep the two-click purge, per-row drafts, and
lightbox exactly as-is (recently rebuilt — polish, don't rework). Close-out: npm run test +
build + eslint; upr-pattern-checker + settings-phase-reviewer clean; visual check
desktop+mobile; UPR-Web-Context.md sub-header + roadmap checklist block; push -u,
ready-to-merge PR into dev, STOP.
```

```
[Session G — Wave 1 · P6 Scope Sheets]
Branch: session-assigned (illustrative: settings/p6-scope-sheets), cut from origin/dev
Model: Opus 4.8 · Effort: Medium (publish blast radius is production-wide)
Launch after: Session F's PR merged into dev

You are building Settings Overhaul P6 — Scope Sheet Builder safety + polish; one phase
only. Read scope: CLAUDE.md; docs/settings-overhaul-roadmap.md P6 block; the ownership
manifest (binding); .claude/rules/scope-sheet-rollback.md (the runbook your changes must
protect). You own exclusively: src/pages/settings/ScopeSheets.jsx, new
src/lib/demoSchemaUtils.js, and your reserved index.css §P6 marker. Zero migrations (F
already shipped delete_demo_schema). Build riskiest-first: (1) replace the raw
db.delete('demo_sheet_schemas',…) with the delete_demo_schema RPC and surface its refusal
('published versions cannot be deleted — publish a different version instead') in the UI;
(2) window.confirm ×3 (delete version, remove job section, remove section) → inline
two-click with onBlur disarm (Rule 2; test-first on one of them); give single-click field
removal an arm state; (3) unsaved-changes guard on version-switch and Back (both silently
discard edits today); keep the publish confirm flow's semantics (draft→publish sequencing
per the rollback runbook) byte-identical; (4) extract the pure schema utilities
(move/removeAt/replaceAt/emptySection/emptyField/walkFields/validateSchemaShape/summarize)
into src/lib/demoSchemaUtils.js with unit tests — from THIS page's internals only; if
TechDemoSheet/DemoSheetRenderer turn out to need it, STOP and flag (tech surface, out of
scope); (5) tokens for the inline status hexes; a 'best on desktop' notice under 768px
(the two-column editor is a deliberate desktop power tool — do not attempt a phone layout).
Close-out: npm run test + build + eslint; upr-pattern-checker + settings-phase-reviewer
clean; visual check desktop; UPR-Web-Context.md sub-header + roadmap checklist block;
push -u, ready-to-merge PR into dev, STOP.
```

---

## Post-wave — Session H (serial)

```
[Session H — P7-lite · DevTools dedup]
Branch: session-assigned (illustrative: settings/p7-devtools-dedup), cut from origin/dev
Model: Sonnet 5 · Effort: Medium
Launch after: BOTH Session B's (P2) and Session C's (P3) PRs merged into dev

You are building Settings Overhaul P7-lite; one micro-phase only, strictly scoped. Read
scope: CLAUDE.md; docs/settings-overhaul-roadmap.md P7-lite block; the ownership manifest.
You own exclusively src/pages/DevTools.jsx. Delete exactly two tabs and nothing else: (1)
the Integrations tab (QBO connect/sync — now lives at /settings/integrations via P2)
including its ?qbo= return-param handling (the worker no longer redirects here) and its
TABS entry; (2) the Employees tab (auth-link audit + invite — now lives at /settings/team
via P3) and its TABS entry. Leave every other tab, all shared helpers, and the file's
structure untouched — the full DevTools split/polish is anytime-lane work, not yours.
Verify /settings/integrations and /settings/team really cover both capabilities before
deleting (read those pages; if either capability is missing there, STOP and flag instead
of deleting). Close-out: npm run test + build + eslint (changed files);
upr-pattern-checker clean; UPR-Web-Context.md sub-header + roadmap checklist block;
push -u, ready-to-merge PR into dev, STOP.
```

---

## Anytime lane (no wave slot; launch whenever)
- DevTools full split/polish (src/pages/devtools/**, URL-synced tabs via searchParams,
  shared TabLoading adoption) — owner-only surface, zero initiative dependency.
- Help.jsx per-guide split (preserve the `#guide/section` hash contract verbatim —
  HelpLink consumers depend on it).
- Owner data fix: 5/20 employees have NULL email (blocks their email notification channel).
