# CRM Roadmap v3 — Session Dispatch Blocks

Copy-paste launch blocks for every remaining CRM build session, per the Roadmap v3
model in `docs/crm-roadmap.md` (Foundation first, then one parallel wave). Each block
is fully self-contained for a cold session with zero conversation history: settings
header, then the complete prompt. Claude Code web hands each session a harness-assigned
`claude/…` branch — use it as-is (CLAUDE.md); the Branch line below is the illustrative
name for humans tracking PRs.

**Preconditions:** Wave 0 launches after the roadmap-v3 PR (#240) is merged into `dev`.
Wave 1 launches after Session F's PR is merged into `dev`. Owner decisions due at
dispatch: ① CallRail Form Tracking replacement intent (forks Session A's form-fixture
stage); ② Cloudflare Turnstile site key for Session I (or it ships toggle-off);
③ A2P 10DLC carrier approval status gates Session J only.

---

## Wave 0 — Sessions F and A may launch simultaneously (zero overlap)

```
[Session F — Wave 0]
Branch: session-assigned (illustrative: crm/phase-f-foundation), cut from origin/dev
Model: Opus 4.8
Effort: High
Launch after: roadmap-v3 PR merged into dev — nothing else

You are building CRM Phase F — Foundation: all schema, interfaces, and wiring for the
parallel wave; one phase only. Read scope: CLAUDE.md and the Phase F block in
docs/crm-roadmap.md (Roadmap v3 section) — it enumerates every table, column, RPC
REPLACE, stub signature, code extraction, slotification, and wiring item. Work on your
session's assigned branch cut from origin/dev. Order of work: (1) migrations first
(Rule 7), additive-only, org_id + RLS + explicit policy at creation, applied via
Supabase MCP apply_migration — the merge_contacts superseding fix FIRST (test-first:
committed failing integration test in supabase/tests/ proving the live version destroys
the losing contact's lead_attribution / email_campaign_recipients rows and orphans
their inbound_leads on merge; fetch the live function bodies via
pg_get_functiondef first — they are NOT in the repo); (2) the two shared RPC REPLACEs —
move_lead_to_stage (add p_lost_reason DEFAULT NULL + write lead_stage_history) and
get_contact_activity (add email/jobs/tasks arms, additive shape) — each
backward-compatible with a committed test that the shipped Phase-4a caller still
succeeds; (3) all ~31 signature-frozen RPC stubs listed in the block (SECURITY DEFINER,
GRANT EXECUTE TO anon, authenticated, body RAISE EXCEPTION 'not implemented (phase X)');
(4) consentAllows(row) pure predicate in functions/lib with unit tests, then the
automated-send.js sms branch fully implemented (Twilio via functions/lib/twilio.js,
consentAllows + sms_consent_log audit) behind the automation_settings kill-switch
sms_sending_enabled defaulting OFF; (5) normalizePhone shared helper (src/lib +
functions/lib) with tests; ActivityTimeline component extracted from CrmLeads.jsx
behavior-identical; CrmOverview.jsx slotified to render OverdueTasksWidget +
ForecastWidget stub components (separate files); CrmContacts.jsx skeleton rendering
ContactsDirectory / ContactDetail / ImportExportPanel / MergeTool slot stubs (separate
files); (6) wiring: App.jsx routes (conversations, contacts, forms, sequences) via the
CrmStubPage pattern inside the existing page:crm-gated CrmLayout route, CrmLayout nav
entries, crmIcons.jsx icons, index.css reserved section markers for phases 4d/6a/6b/7/
8/9/10/4b; (7) commit .claude/rules/crm-wave-ownership.md exactly as specified by the
roadmap's file-ownership matrix. Do NOT build any feature logic beyond the
sms-branch/consent gate — stubs stay stubs. Close-out: npm run test + npm run build +
npx eslint (changed files) pass; migration-safety-checker + upr-pattern-checker +
consent-path-auditor clean; crm-phase-reviewer (Opus) sign-off; update
UPR-Web-Context.md; set phase 'F' to shipped via set_crm_phase_status and reconcile its
crm_build_stages rows honestly via set_crm_stage_status; push -u and open a PR to dev
using the repo PR template, mark it ready for review.
```

```
[Session A — Wave 0]
Branch: session-assigned (illustrative: crm/phase-1-closeout), cut from origin/dev
Model: Sonnet 5
Effort: Medium
Launch after: roadmap-v3 PR merged into dev — may run simultaneously with Session F

You are closing out CRM Phase 1 — one phase only, no scope creep. Read scope:
CLAUDE.md, plus in docs/crm-roadmap.md the 'Phase 1 — CRM shell + CallRail lead
ingestion' block AND the 'Phase 1 — verification & acceptance' section. Work on your
session's assigned branch cut from origin/dev. Tasks: (1) Test-first form capture —
FIRST check the owner-decision note in the roadmap's Roadmap v3 dispatch section: if
CallRail Form Tracking is being replaced by Phase 10 CRM Forms, close the form-capture
stage via set_crm_stage_status with the disclosure 'superseded by Phase 10 CRM Forms'
in the PR and skip to task (2); otherwise obtain a REAL CallRail form-submission
payload (CallRail API/MCP or a live test submission tagged with the dev tracking
number); commit a failing mapFormPayload unit test in functions/lib/callrail.test.js
against that fixture and a source_type='form' ingestion test in
supabase/tests/crm_phase1_callrail.test.js (null duration/recording, form_data
persisted); then make them pass — if the live payload's field names differ from the
wired isForm/mapFormPayload guesses, fix the mapper, never the committed test. If a
real fixture is unobtainable without the owner, leave that stage open and disclose why
in the PR. (2) Verify every acceptance criterion in the verification section against
live data; fix only what verification reveals broken. (3) The visual check vs the
Stitch handoff is owner-gated — surface it, don't fake it. Close-out: npm run test +
npm run build + npx eslint (changed files) pass; upr-pattern-checker clean;
crm-phase-reviewer sign-off; reconcile crm_build_stages honestly in both directions
via set_crm_stage_status; delete test rows tagged with the dev tracking number; update
UPR-Web-Context.md; set phase '1' to shipped via set_crm_phase_status only if all
non-owner-gated criteria pass; push -u and open a PR to dev using the repo PR
template, mark it ready for review.
```

---

## Wave 1 — Sessions B, C, D, E, G, H, I may all launch simultaneously once Session F is merged into dev (Session J additionally waits on carrier approval)

```
[Session B — Wave 1]
Branch: session-assigned (illustrative: crm/phase-4d-automations), cut from origin/dev
Model: Opus 4.8
Effort: High
Launch after: Session F merged into dev

You are building CRM Phase 4d — fixed automations; one phase only, money/consent-
weighted. Read scope: CLAUDE.md, the Phase 4d block in docs/crm-roadmap.md, and
.claude/rules/crm-wave-ownership.md (your file ownership + the frozen-file list —
binding). Work on your session's assigned branch cut from origin/dev. Foundation
(Phase F) already shipped: automation_settings table, the completed
functions/lib/automated-send.js (sms branch built but dark behind
automation_settings.sms_sending_enabled = OFF), consentAllows(), and your two frozen
automation-settings RPC stubs. Hard constraints: ZERO schema migrations — you may only
CREATE OR REPLACE the bodies of your own frozen stubs, signatures unchanged; never edit
automated-send.js, send-message.js, twilio.js, or email.js (frozen); never call
send-message.js or twilio.js directly and never pass skip_compliance; every send routes
through sendAutomatedMessage(). Build the 4 automations in a new
functions/api/run-automations.js worker (cron; worker_runs row per run): speed-to-lead
and missed-call text-back (SMS — ship dark, individually toggleable, inert until the
sms_sending_enabled kill-switch flips in Phase 4b), no-response follow-up and
job-complete review request (email — live via the gated email path). Per-automation
on/off toggles UI goes in CrmSettings.jsx (you own it this wave); keep styles inside
your reserved index.css section. Test-first (commit failing first): isStale()
no-response trigger predicate; each automation's trigger predicate fires the correct
system_events type; consent gate reused — a suppressed/dnd contact is skipped and the
skip is durable. Close-out: npm run test + npm run build + npx eslint pass;
migration-safety-checker + upr-pattern-checker + consent-path-auditor clean;
crm-phase-reviewer (Opus) sign-off weighted on consent + trigger correctness; delete
test automation rows; update UPR-Web-Context.md; set phase '4d' to shipped via
set_crm_phase_status and reconcile its crm_build_stages; push -u, open a PR to dev via
the template, mark it ready for review.
```

```
[Session C — Wave 1]
Branch: session-assigned (illustrative: crm/phase-6a-contacts), cut from origin/dev
Model: Opus 4.8
Effort: Medium
Launch after: Session F merged into dev

You are building CRM Phase 6a — contacts read & segments; one phase only. Read scope:
CLAUDE.md, the Phase 6a block in docs/crm-roadmap.md, and
.claude/rules/crm-wave-ownership.md (binding). Work on your session's assigned branch
cut from origin/dev. Foundation shipped: the crm_segments table, the CrmContacts.jsx
skeleton with slots, the shared ActivityTimeline component, the superseding
merge_contacts fix, and your frozen stubs. Hard constraints: ZERO schema migrations —
only CREATE OR REPLACE bodies of your own frozen stubs (get_crm_contacts,
upsert_segment, get_segments, delete_segment, get_contact_consent) plus a
backward-compatible body replace of get_duplicate_contacts adding normalized-email
detection to the existing phone detection; you edit ONLY ContactsDirectory.jsx and
ContactDetail.jsx (new files rendered by the F-built CrmContacts.jsx skeleton — do not
edit the skeleton, App.jsx, CrmLayout.jsx, or crmIcons.jsx); styles stay inside your
reserved index.css section. Build: contacts directory (search/pagination) + read-only
detail panel showing tags, a unified do-not-contact badge from get_contact_consent
(dnd ∪ opt_out ∪ email_suppressions), and the contact timeline via get_contact_activity
rendered with the shared ActivityTimeline component; segments CRUD (name + filter
jsonb) reusable by the campaign audience tooling. Verify Foundation's merge_contacts
fix is live (its test green) and note it in the PR. Test-first (commit failing first):
get_contact_consent unified read across all three consent sources; segment filter
round-trip (saved filter's preview count matches a direct query); email-normalized
duplicate detection. Close-out: npm run test + npm run build + npx eslint pass;
migration-safety-checker + upr-pattern-checker clean; crm-phase-reviewer sign-off;
delete TEST-org rows; update UPR-Web-Context.md; set phase '6a' to shipped via
set_crm_phase_status and reconcile its crm_build_stages; push -u, PR to dev via the
template, mark it ready for review.
```

```
[Session D — Wave 1]
Branch: session-assigned (illustrative: crm/phase-6b-data-quality), cut from origin/dev
Model: Opus 4.8
Effort: Medium
Launch after: Session F merged into dev (fallback if slot discipline breaks: launch after Session C merges instead)

You are building CRM Phase 6b — ownership, CSV import, staff roles & audit hardening;
one phase only. Read scope: CLAUDE.md, the Phase 6b block in docs/crm-roadmap.md, and
.claude/rules/crm-wave-ownership.md (binding). Work on your session's assigned branch
cut from origin/dev. Foundation shipped: crm_import_batches, contacts.owner_id +
contacts.lifecycle_status columns, the CrmContacts.jsx skeleton slots for your
components, normalizePhone, and your frozen stubs. Hard constraints: ZERO schema
migrations — only CREATE OR REPLACE function bodies: your own frozen stubs
(import_contacts, set_contact_owner, set_contact_lifecycle) plus the backward-
compatible audit-hardening replaces of the email-campaign RPCs the ownership manifest
assigns you (add system_events writes to set_campaign_exclusions /
upsert_email_campaign / delete_email_campaign; make record_email_campaign_send's
campaign-sent event fire exactly once with a sent/suppressed/failed counts payload) —
signatures unchanged, committed tests that existing callers still succeed. You edit
ONLY ImportExportPanel.jsx + MergeTool.jsx (new slot files), Admin.jsx, DevTools.jsx,
src/lib/featureFlags.js, and CrmLayout.jsx (you are its sole in-wave editor — role
gating only); styles in your reserved index.css section. Build: CSV import wizard
(column mapping, normalizePhone/email dedupe-on-import, crm_import_batches audit row)
+ CSV export; MergeTool surfacing get_duplicate_contacts + merge_contacts in the
contacts skeleton; owner + lifecycle setters in the detail slot; per-screen staff
access via feature:crm_* sub-flags + employeePageAccess/canAccess enforced in
CrmLayout nav + route guards — roles defined per screen BEFORE page:crm opens to staff
(the flag flip itself is the owner's, after this phase merges). Test-first (commit
failing first): import_contacts dedupe correctness (no duplicate contact created;
batch row written); each audit-hardening event fires; campaign-sent event
de-duplicated with counts. Close-out: npm run test + npm run build + npx eslint pass;
migration-safety-checker + upr-pattern-checker + consent-path-auditor clean;
crm-phase-reviewer sign-off weighted on the audit/consent surface; delete TEST-org
import rows; update UPR-Web-Context.md; set phase '6b' to shipped via
set_crm_phase_status and reconcile its crm_build_stages; push -u, PR to dev via the
template, mark it ready for review.
```

```
[Session E — Wave 1]
Branch: session-assigned (illustrative: crm/phase-7-daily-driver), cut from origin/dev
Model: Opus 4.8
Effort: High
Launch after: Session F merged into dev

You are building CRM Phase 7 — daily driver: tasks, timeline completeness, comms in
shell; one phase only. Read scope: CLAUDE.md, the Phase 7 block in docs/crm-roadmap.md,
and .claude/rules/crm-wave-ownership.md (binding). Work on your session's assigned
branch cut from origin/dev. Foundation shipped: crm_tasks + lead_stage_history tables,
inbound_leads.lost_reason, the already-REPLACEd move_lead_to_stage (p_lost_reason
DEFAULT NULL + history write) and get_contact_activity (email/jobs/tasks arms), the
CrmConversations stub route/nav/icon, the OverdueTasksWidget slot in CrmOverview, and
your frozen task stubs. Hard constraints: ZERO schema migrations — only CREATE OR
REPLACE bodies of your own frozen stubs (task CRUD ×4 + get_overdue_tasks); do NOT
touch move_lead_to_stage or get_contact_activity (Foundation owns those REPLACEs); you
edit ONLY CrmTasks.jsx, CrmLeads.jsx, OverdueTasksWidget.jsx, and CrmConversations.jsx;
App.jsx / CrmLayout.jsx / crmIcons.jsx are frozen; styles in your reserved index.css
section. Send paths are call-only: CrmConversations may call the existing
/api/send-message worker for staff two-way SMS but you must not edit
functions/api/send-message.js, functions/lib/twilio.js, or
functions/lib/automated-send.js, and never pass skip_compliance. Build: CrmTasks real
page (title/notes/due/reminder/assignee/contact+lead links, complete/reopen);
OverdueTasksWidget on Overview; CrmLeads win/loss reason prompt on drop into an
is_lost stage (pass p_lost_reason; required client-side) + stage-age badges from
lead_pipeline_stage.updated_at; CrmConversations embedding the existing Conversations
components inside the CRM shell; click-to-call tel: links on lead/contact panels
logging a system_event. Test-first (commit failing first): get_overdue_tasks predicate
using functions/lib/date-mt.js (UTC storage, Mountain-Time day boundary); lost-reason
required-on-lost via the new UI path while Foundation's backward-compat test stays
green. Close-out: npm run test + npm run build + npx eslint pass;
migration-safety-checker + upr-pattern-checker + consent-path-auditor clean;
crm-phase-reviewer sign-off; delete test task rows; update UPR-Web-Context.md; set
phase '7' to shipped via set_crm_phase_status and reconcile its crm_build_stages;
push -u, PR to dev via the template, mark it ready for review.
```

```
[Session G — Wave 1]
Branch: session-assigned (illustrative: crm/phase-8-sequences), cut from origin/dev
Model: Opus 4.8
Effort: High
Launch after: Session F merged into dev

You are building CRM Phase 8 — drip/nurture sequences; one phase only, consent-
critical. Read scope: CLAUDE.md, the Phase 8 block in docs/crm-roadmap.md, and
.claude/rules/crm-wave-ownership.md (binding). Work on your session's assigned branch
cut from origin/dev. Foundation shipped: crm_sequences / crm_sequence_steps /
crm_sequence_enrollments tables, the completed sendAutomatedMessage() (sms dark behind
automation_settings.sms_sending_enabled), the crm_segments table + frozen get_segments
signature, the CrmSequences stub route/nav/icon, and your frozen sequence stubs. Hard
constraints: ZERO schema migrations — only CREATE OR REPLACE bodies of your own frozen
stubs (sequence CRUD/enroll ×4); automated-send.js is import-only and frozen — every
send routes through sendAutomatedMessage(); SMS steps are stored but held while the
kill-switch is OFF (skip with a durable held reason, never bypass); you edit ONLY
CrmSequences.jsx and functions/api/process-sequences.js (new); frozen files untouched;
styles in your reserved index.css section. Build: sequence builder (ordered steps with
channel email|sms, delay_hours, template/body), enroll a crm_segments segment,
pause/stop, per-enrollment status; process-sequences.js cron worker advancing due
enrollments (worker_runs row per run), exiting enrollments on reply or conversion via
system_events. Segments UI ships in Phase 6a, possibly concurrently: build and test
against directly-inserted TEST-org crm_segments rows and the frozen get_segments
signature; the segment-UI-to-enroll E2E check is a disclosed verification-tail stage
that runs once 6a is merged — say so in the PR if 6a hasn't merged yet. Test-first
(commit failing first): enrollment idempotency (UNIQUE sequence+contact); step-advance
math (delay_hours vs next_run_at using functions/lib/date-mt.js); exit-on-reply/
conversion predicates; a suppressed/dnd contact is skipped durably. Close-out: npm run
test + npm run build + npx eslint pass; migration-safety-checker + upr-pattern-checker
+ consent-path-auditor clean; crm-phase-reviewer (Opus) sign-off weighted on the
consent path; delete test sequences/enrollments; update UPR-Web-Context.md; set phase
'8' to shipped via set_crm_phase_status and reconcile its crm_build_stages; push -u,
PR to dev via the template, mark it ready for review.
```

```
[Session H — Wave 1]
Branch: session-assigned (illustrative: crm/phase-9-intelligence), cut from origin/dev
Model: Opus 4.8
Effort: High
Launch after: Session F merged into dev

You are building CRM Phase 9 — intelligence: scoring, forecasting, fixed reports, AI
digest; one phase only, displayed-money-math-weighted. Read scope: CLAUDE.md, the
Phase 9 block in docs/crm-roadmap.md, and .claude/rules/crm-wave-ownership.md
(binding). Work on your session's assigned branch cut from origin/dev. Foundation
shipped: pipeline_stages.win_probability, inbound_leads.lead_score +
lead_score_factors columns, lead_stage_history (accruing from Foundation's
move_lead_to_stage REPLACE onward), the ForecastWidget slot in CrmOverview, and your
frozen stubs. Hard constraints: ZERO schema migrations — only CREATE OR REPLACE bodies
of your own frozen stubs (score_lead, get_conversion_trend, get_estimator_leaderboard,
get_call_volume, get_speed_to_lead, get_estimate_aging, get_pipeline_movement,
get_contact_ltv); you edit ONLY CrmReports.jsx, ForecastWidget.jsx,
src/lib/crmPipeline.js + src/lib/attribution.js (+ their tests), and
functions/api/weekly-crm-digest.js (new); sendGatedEmail is import-only (automated-
send.js frozen); frozen files untouched; styles in your reserved index.css section.
Build: rule-based score_lead (source, speed-to-first-touch, transcript_analysis
sentiment/topics — no ML); the fixed report set with time ranges; stageWeight() in
crmPipeline.js updated to prefer stage.win_probability with the existing positional
ramp as fallback (get_pipeline_stages already returns the column); ForecastWidget
(weighted pipeline forecast) on Overview; weekly-crm-digest.js cron (Claude-summarized
pipeline movement, stale leads, spend anomalies) sent via sendGatedEmail with a
worker_runs row. History-backed reports (pipeline movement, speed-to-lead) render
honestly with a since-date — data accrues only from Foundation onward. AI reply
suggestions ship as a standalone AiReplySuggestions.jsx component you own (draft-only,
human sends): wire it into CrmConversations.jsx ONLY if Phase 7's PR has already
merged into dev (a one-line noted edit); otherwise leave it exported + documented and
flag the wiring as a follow-up in your PR — never edit an unmerged phase's file.
Test-first (commit failing first): score_lead rule math on deterministic fixtures;
stageWeight win_probability preference + positional fallback (update the hand-calc
test); report math with div-by-zero + null-for-zero-spend guards per attribution.js
conventions. Close-out: npm run test + npm run build + npx eslint pass;
migration-safety-checker + upr-pattern-checker + consent-path-auditor (digest send)
clean; crm-phase-reviewer (Opus) sign-off weighted on the money math; update
UPR-Web-Context.md; set phase '9' to shipped via set_crm_phase_status and reconcile
its crm_build_stages; push -u, PR to dev via the template, mark it ready for review.
```

```
[Session I — Wave 1]
Branch: session-assigned (illustrative: crm/phase-10-forms), cut from origin/dev
Model: Opus 4.8
Effort: High
Launch after: Session F merged into dev

You are building CRM Phase 10 — CRM Forms: embeddable lead capture; one phase only,
public-endpoint + consent + XSS weighted. Read scope: CLAUDE.md, the Phase 10 block in
docs/crm-roadmap.md, and .claude/rules/crm-wave-ownership.md (binding). Work on your
session's assigned branch cut from origin/dev. Foundation shipped: form_definitions /
form_definition_versions / form_submissions tables, normalizePhone, the CrmForms stub
route/nav/icon, and your frozen form stubs. Hard constraints: ZERO schema migrations —
only CREATE OR REPLACE bodies of your own frozen stubs (upsert_lead_from_form + form
CRUD); you edit ONLY CrmForms.jsx, functions/f/[public_id].js (new),
functions/api/form-submit.js (new), and public/embed.js (new); frozen files untouched;
styles in your reserved index.css section. Build per the block: schema-driven builder
(structured editor, NOT drag-drop — fields text/email/phone/select/radio/checkbox/
textarea/date/consent, required toggles, theme colors, restricted [text](url) link
markup in labels/descriptions/thank-you, live preview, draft-to-publish versioning
that never mutates a published row, copy-embed-snippet, per-form submissions view);
hosted form page at functions/f/[public_id].js (no SPA) + public/embed.js script-tag
snippet injecting it as an iframe and forwarding the PARENT page's
UTM/gclid/fbclid/referrer/landing URL into hidden fields; form-submit.js with
server-side validation against the published schema version and a spam gate (honeypot
+ minimum-fill-time + per-IP rate limit + Cloudflare Turnstile behind a per-form
toggle so forms work before the site key exists); upsert_lead_from_form is idempotent
on callrail_id = 'form:' || submission_token (the create_manual_lead 'manual:'
precedent), find-or-creates the contact by normalized phone, writes inbound_leads
(source_type='form', source/medium/campaign from UTM), lead attribution via
upsert_lead_attribution + crm_channel_for_source, consent-checkbox true writes an
sms_consent_log opt_in row (IP + consent-text version), fires system_events
crm_lead_created + crm_form_submitted, and logs a worker_runs row. Optional stage if
time allows: thin functions/api/webflow-form-webhook.js adapter feeding the same RPC.
Test-first (commit failing first): the link-markup sanitizer rejects raw HTML and
javascript: URLs; server-side validation rejects missing-required/bad-type;
upsert_lead_from_form idempotency (same token twice = one lead); consent-write
correctness (checked = opt_in row with IP + version, unchecked = no row); spam
predicates. Close-out: npm run test + npm run build + npx eslint pass;
migration-safety-checker + upr-pattern-checker + consent-path-auditor clean;
crm-phase-reviewer (Opus) sign-off weighted on the public endpoint + consent; delete
test forms/submissions; update UPR-Web-Context.md; set phase '10' to shipped via
set_crm_phase_status and reconcile its crm_build_stages; push -u, PR to dev via the
template, mark it ready for review.
```

```
[Session J — Wave 1, externally gated]
Branch: session-assigned (illustrative: crm/phase-4b-text-blasts), cut from origin/dev
Model: Opus 4.8
Effort: High
Launch after: Session F merged into dev AND A2P 10DLC promotional-campaign carrier approval confirmed with Twilio (hard external gate — do not launch on hope)

You are building CRM Phase 4b — text-blast campaigns; one phase only, TCPA-weighted.
Read scope: CLAUDE.md, the Phase 4b block in docs/crm-roadmap.md (plus the Roadmap v3
note that Foundation pre-built the SMS send path), and
.claude/rules/crm-wave-ownership.md (binding). Work on your session's assigned branch
cut from origin/dev. FIRST confirm the A2P 10DLC promotional campaign is registered
and carrier-approved (ask the owner if not verifiable) — if it is not, stop and report;
do not build or test the live send path. Foundation shipped: the complete
automated-send.js sms branch (consentAllows() against sms_consent_log/contacts +
audit logging) behind automation_settings.sms_sending_enabled = OFF. Hard constraints:
ZERO schema migrations — the legacy campaigns/campaign_recipients tables are the
storage (they pre-date the org_id rule; do not alter them — if a column is genuinely
missing, stop and flag it for a separate reviewed change); automated-send.js /
send-message.js / twilio.js are frozen — every campaign send routes through
sendAutomatedMessage('sms', …); you edit ONLY Marketing.jsx and a new
functions/api/send-text-campaign.js worker; styles in your reserved index.css section.
Build: finish Marketing.jsx as the SMS campaign builder (audience segmentation
honoring consentAllows — only opted-in, non-DND contacts are even counted; per-
recipient status; totals), send-text-campaign.js iterating recipients through
sendAutomatedMessage with durable skip reasons in campaign_recipients +
sms_consent_log, worker_runs row per send run; flip
automation_settings.sms_sending_enabled to ON (via the settings RPC) only after
carrier approval is confirmed and the consent tests are green — the flip is part of
this phase's acceptance, called out in the PR. Test-first (commit failing first): a
non-consented/DND contact is excluded from the audience AND skipped durably at send
time even if targeted; send idempotency (re-running a partially-sent campaign never
double-texts a recipient). Close-out: npm run test + npm run build + npx eslint pass;
migration-safety-checker + upr-pattern-checker + consent-path-auditor clean;
crm-phase-reviewer (Opus) sign-off weighted on the consent gate; delete test
campaign/recipient rows (dev tracking number / TEST org); update UPR-Web-Context.md;
set phase '4b' to shipped via set_crm_phase_status and reconcile its crm_build_stages;
push -u, PR to dev via the template, mark it ready for review.
```
