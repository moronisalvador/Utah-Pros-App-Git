# Domain: Messaging & Consent

The highest-consequence domain: staff 1:1 SMS/MMS (Conversations + tech-v2 messages pane), the consent/DND gate in front of every send, the provider-neutral messaging transport (CallRail live, Twilio legacy), scheduled messages, email campaigns (CRM), email suppression, the notify pipeline (bell + web push + APNs native push), and five distinct consent evidence stores. Overall health: the live core (messages/conversations/transport/notify/consent gate) is real and actively written in production; around it sits a ring of confirmed dead 2025-era stacks (SMS campaigns, notify-v1 queue, automation_rules, omni leftovers) and a broad band-aid RLS layer (always-true policies, anon residue — including live anonymous access to the email-campaign trio). Headline numbers: 34 tables (28 used / 6 dead), 63 RPCs (57 used / 5 dead / 1 band-aid no-op), 41 policies (9 sound / 14 band-aid / 5 duplicated / 13 dead), 2 triggers (both used), 406 columns (307 used / 84 dead / 14 uncertain / 1 duplicated). Live behaviour note: the live `get_service_sms_consent_status` does NOT return `IMPLIED_CONSENT` (zero hits in fresh fndefs) — the 20260728 opt-out-only migration is authored-not-applied, exactly as `initiative-status.md` records.

## Tables (34)

### automation_rules — DEAD
- Purpose: 2025-era single-action workflow-automation rules (pre-CRM), superseded by `crm_automations` (crm domain).
- Evidence: greps `'automation_rules'`/`"automation_rules"`/`\bautomation_rules\b` across src/functions/scripts/upr-mcp/supabase/tests/tests/.github → 2 hits total: `upr-mcp/src/codeIndex.js:6636` (generated schema index, not a call site) and the stale TODO comment `functions/api/twilio-webhook.js:276`. Zero fndef/view/cron/publication references. Independently CONFIRMED as "verified unwired orphan" by `docs/crm-roadmap.md:1383,1461` and `docs/db-foundation-p4-orphan-report.md`.
- Prod stats: live 4, ins 6, upd 0, del 0, seq 53, idx 0, last_seq 2026-07-13 (catalog sweeps), never idx-scanned. Stats-reset caveat applies; corroborates dormancy.
- Provenance: untracked — predates schema-as-code.
- Columns: 16 total — 16 dead (dead with table): id, name, description, trigger_type, trigger_config, action_type, action_config, priority, is_active, created_by, created_at, updated_at, trigger_event, conditions, target_roles, target_employees.
- Policies: `allow_authenticated_automation_rules` (ALL, authenticated, true/true) — DEAD (on dead table; also always-true); `anon_delete/insert/select/update_automation_rules` (4, rescoped TO authenticated by 20260708_dbf_p3, still USING true) — DEAD ×4. Note the `anon_*` names are historical; roles are now `authenticated`, but table grants still include full anon DML.
- Triggers: none.
- Notes: removal already designated "separate reviewed cleanup, never in-phase DROP" by the CRM manifest. crm_automations (crm domain) is the live successor — cross-domain, not classified here.

### automation_settings — USED
- Purpose: per-org automation kill-switches (`sms_sending_enabled` — the load-bearing SMS master switch — plus speed-to-lead / missed-call-textback / no-response-followup / review-request toggles).
- Evidence: `functions/lib/automated-send.js:186` (reads sms_sending_enabled before any automated send), `functions/api/run-automations.js:499`, `functions/api/process-crm-automations.js:460`, CRM UI via `get_automation_settings` RPC (`src/pages/crm/CrmSettings.jsx:103`, `CrmAutomations.jsx:195`); fndefs: `crm_fixed_automation_conflict`, `get_automation_settings`, `set_automation_setting` (crm).
- Prod stats: live 2, ins 2, upd 15, idx 6,139, last_idx 2026-07-29 — hot.
- Provenance: `20260702_crm_phase0F_wave_schema.sql`.
- Columns: 9 total — 9 used (all flags individually referenced by name in workers; id/org_id/timestamps carried by `select=*` reads at run-automations.js:499).
- Policies: none (RLS on, service_role-only grants — least-privilege posture; app access is RPC-only). Sound.
- Triggers: none.
- Notes: `get_automation_settings` inserts a default row on read (write-on-read definer, granted to all authenticated — see structural problems). The `sms_disabled` held-retry reason string keys off this table's flag.

### campaign_recipients — DEAD
- Purpose: per-recipient rows for the never-built SMS/MMS campaign sender.
- Evidence: greps (same 3 patterns, full scope) → 2 hits: a doc-comment `src/pages/crm/CrmCampaigns.jsx:41` and `upr-mcp/src/codeIndex.js:6165` (index, not a call). No worker (`send-text-campaign.js` does not exist — confirmed by `ls functions/api/`). fndefs: only `merge_contacts` (crm, live) repoints `contact_id` FKs during contact merges — bookkeeping over a table nothing reads or fills. No views/cron/publication/trigger references.
- Prod stats: live 0, ins 0, upd 0, del 0 — never written since stats began. seq 127/idx 150 are sweep noise (last_seq 2026-07-08).
- Provenance: untracked — predates schema-as-code.
- Columns: 8 total — 8 dead (dead with table): id, campaign_id, contact_id, phone, message_id, status, sent_at, error_message.
- Policies: `allow_authenticated_campaign_recipients` (ALL, authenticated, true/true) — DEAD (dead table; always-true). Anon table grants persist.
- Triggers: none.
- Notes: FK → campaigns, contacts, messages. Pairs with `campaigns` below; the email campaign stack (`email_campaigns` family) is the live parallel.

### campaigns — DEAD
- Purpose: SMS/MMS campaign headers for the unbuilt bulk-text feature.
- Evidence: sole reader is `src/pages/Marketing.jsx:17` (`db.select('campaigns', ...)`), a flag-gated placeholder page (`App.jsx:519-521`, `FeatureRoute flag="page:marketing"`) whose own empty-state says "Coming in Phase 4b (blocked on Twilio carrier approval)". Zero writers anywhere (3-pattern grep, full scope; the only other quoted hits are route labels/UI filter keys and `codeIndex.js`). fndefs: only `delete_email_campaign` matches the word via unrelated text. No cron/view/publication.
- Prod stats: live 0, ins 0, upd 0, del 0 — no row has ever existed since stats began; seq 36 last 2026-07-13, idx 0. A reachable SELECT that can only ever render the empty state.
- Provenance: untracked — predates schema-as-code.
- Columns: 19 total — 19 dead (dead with table): id, name, description, campaign_type, status, template_id, message_body, audience_filter, audience_count, scheduled_at, sent_at, total_sent, total_delivered, total_failed, total_replied, total_opted_out, created_by, created_at, updated_at. (Marketing.jsx names 8 of them in its select string; with no writer they can never carry data.)
- Policies: `allow_anon_read_campaigns` (SELECT, TO authenticated, true) — DEAD; `allow_authenticated_campaigns` (ALL, authenticated, true/true) — DEAD. Both on a dead table; anon grants persist.
- Triggers: none.
- Notes: owner decision needed — the 2026-07-28 owner statement "we will not send any bulk marketing text" (sms manifest §13) makes revival unlikely.

### conversation_participants — USED
- Purpose: joins contacts (by phone) into conversations; the recipient resolution source for every outbound send.
- Evidence: `src/pages/Conversations.jsx:380,1185` (insert), `src/components/MergeModal.jsx:159`, `functions/api/send-message.js:525` (recipient lookup), `functions/api/process-scheduled.js:171`; fndefs: `find_or_create_conversation`, `get_tech_conversations`, `get_message_log`, `get_scheduled_queue`, `project_callrail_inbound_event`, `merge_contacts`, `get_contact_activity`, `score_lead`.
- Prod stats: live 12, ins 30, del 16, seq 32,194 (last 2026-07-29) — hot.
- Provenance: untracked legacy — drift-captured in `20260709_sms_f01_drift_capture.sql`.
- Columns: 9 total — 8 used, 1 uncertain: `email` (uncertain — added by omni foundation for the never-wired email lane; no code names `cp.email`; `get_tech_conversations` returns the contact's email, not this column; generic-name greps can't separate it).
- Policies: `allow_authenticated_conversation_participants` (ALL, authenticated, true/true) — BAND-AID (always-true; any authenticated user may insert/delete participants directly; no assignment predicate).
- Triggers: none.
- Notes: clients insert participants directly (Conversations.jsx) while the transport worker also creates them via `find_or_create_conversation` — two writers of the same fact, one race-guarded (advisory lock) and one not.

### conversation_reads — DEAD
- Purpose: per-team-member conversation read tracking (never wired; the live design uses a single shared `conversations.unread_count`).
- Evidence: 3-pattern grep, full scope → 1 hit: `upr-mcp/src/codeIndex.js:6042` (index). Zero fndef/view/cron/trigger/publication references.
- Prod stats: live 0, ins 0, upd 0, del 0; last_seq 2026-03-19 — dormant for months.
- Provenance: untracked — predates schema-as-code.
- Columns: 3 total — 3 dead (dead with table): team_member_id, conversation_id, last_read_at.
- Policies: `allow_authenticated_conversation_reads` (ALL, authenticated, true/true) — DEAD.
- Triggers: none.
- Notes: its intent (per-person read state) is the fix for the shared-unread-counter flaw (structural problem 7); v2 should decide deliberately.

### conversation_tags — DEAD
- Purpose: free-form conversation tagging (omni-inbox idea, never built).
- Evidence: 3-pattern grep, full scope → 1 hit: `upr-mcp/src/codeIndex.js:6055`. Zero fndef/view/cron/trigger/publication references.
- Prod stats: live 0, ins 0, upd 0, del 0; seq 6 (sweeps).
- Provenance: untracked — predates schema-as-code.
- Columns: 3 total — 3 dead (dead with table): conversation_id, tag, created_at.
- Policies: `allow_authenticated_conversation_tags` (ALL, authenticated, true/true) — DEAD.
- Triggers: none.

### conversations — USED
- Purpose: the thread container for SMS/notes; carries status workflow (needs_response/waiting/resolved), shared unread counter, last-message preview.
- Evidence: `src/components/Layout.jsx:129` (unread badge), `src/pages/Conversations.jsx` (list/status writes), realtime subscription `src/lib/realtime.js:67-79` (+ `supabase_realtime` publication), `functions/api/twilio-webhook.js`, `functions/api/send-message.js`; fndefs: `find_or_create_conversation`, `get_tech_conversations`, `increment_conversation_unread`, `project_callrail_inbound_event`, `trigger_message_events`, `get_message_log`, `get_dashboard_stats`, `merge_jobs`, `messaging_can_access_conversations`, `omni_verify_foundation`.
- Prod stats: live 12, ins 38, upd 373, seq 92,871 (last 2026-07-29) — hot.
- Provenance: untracked legacy — drift-captured in `20260709_sms_f01_drift_capture.sql`.
- Columns: 17 total — 14 used, 3 dead:
  - `twilio_group_sid` — dead (zero hits in code + fndefs; group-MMS concept never built).
  - `job_phase_context` — dead (zero hits anywhere).
  - `email_reply_token` — dead-candidate classified dead: its only consumer is `functions/lib/conversation-email.js` (`buildReplyAddress`, line 114), which is exported but imported ONLY by its own test file; no writer found in code or fndefs; `get_tech_conversations` explicitly strips it from output (`to_jsonb(p) - 'email_reply_token'`). Unwired omni email lane.
  - (`assigned_to` is used — `functions/lib/messaging-inbound-notifications.js` routes inbound-text notifications to it; `twilio_number` written at `twilio-webhook.js:321`; `first_response_at` at `send-message.js:360`.)
- Policies: `allow_authenticated_conversations` (ALL, authenticated, true/true) — BAND-AID (always-true; any authenticated user can update any conversation's counters/status directly; contrast with the messages policy).
- Triggers: none on this table.
- Notes: FK job_id → jobs (cross-domain). In the realtime publication AND subscribed (`subscribeToConversations`). Unread counter is global, not per-employee (structural problem 7).

### device_tokens — USED
- Purpose: APNs native-push device registry (iOS Capacitor shell), one row per device token with sandbox/production environment.
- Evidence: `src/lib/pushNotifications.js:509,245,627` via `upsert_my_native_device_token`/`delete_my_native_device_token`; `functions/lib/apns.js:220` (delivery reads + `prune_stale_native_device_token`); imported by `functions/api/notify.js:56` and `functions/api/send-push.js:33`.
- Prod stats: live 3, ins 4, upd 5, last activity 2026-07-29 — live.
- Provenance: untracked — predates schema-as-code (apns_environment/guardrails added by `20260728224000_native_push_delivery_guardrails.sql` era work).
- Columns: 7 total — 7 used (id, employee_id, token, platform, created_at, updated_at, apns_environment — all named in the my-token RPC bodies and apns.js).
- Policies: `Own tokens or admin read` (SELECT, authenticated; ownership OR admin/pm role predicate) — USED (real predicate; sound). Writes are service/RPC-only (grants: service_role only).
- Triggers: none.
- Notes: v1 identity-passed RPC pair (`upsert_device_token`/`delete_device_token`) is dead (below) — this table's live write path is the auth.uid()-derived "my" pair. Max-5-tokens-per-employee cap enforced in the RPC.

### email_campaign_exclusions — USED
- Purpose: per-campaign contact exclusion list for CRM email campaigns.
- Evidence: `src/pages/crm/CrmCampaigns.jsx:177,237` via `get_campaign_exclusions`/`set_campaign_exclusions`; consumed inside `queue_email_campaign` (fndef); db-lane tests `supabase/tests/crm_merge_contacts_safety.test.js:76-114`.
- Prod stats: live 0, ins 5, upd 2, del 3 — low-volume but real.
- Provenance: `20260701_crm_phase4c_email_audience_tool.sql`.
- Columns: 4 total — 4 used.
- Policies: `email_campaign_exclusions_all` (ALL, roles **anon**+authenticated, true/true) — BAND-AID and a live §2-allowlist violation: anon appears in the policy AND holds full table grants → anonymous read/write with the publishable key (structural problem 2).
- Triggers: none.

### email_campaign_recipients — USED
- Purpose: per-recipient send state for email campaigns (pending/sent/suppressed/failed + resend_id).
- Evidence: `functions/api/send-email-campaign.js:96` (reads pending), `record_email_campaign_send`/`queue_email_campaign`/`email_unsubscribe` fndefs write it; tests crm_contact_activity/crm_merge_contacts_safety.
- Prod stats: live 0, ins 79, del 76, last_seq 2026-07-28 — actively cycled.
- Provenance: `20260701_crm_phase4c_email_campaigns.sql`.
- Columns: 9 total — 9 used (resend_id written by `record_email_campaign_send`).
- Policies: `email_campaign_recipients_all` (ALL, roles **anon**+authenticated, true/true) — BAND-AID + live anon exposure (recipient emails are PII).
- Triggers: none.

### email_campaigns — USED
- Purpose: CRM email campaign headers (draft → sending → sent) with audience filter and counters.
- Evidence: `src/pages/crm/CrmCampaigns.jsx:136,228,254` via `get_email_campaigns`/`upsert_email_campaign`/`delete_email_campaign`; `functions/api/send-email-campaign.js:87`; counters maintained by `record_email_campaign_send`.
- Prod stats: live 1, ins 14, upd 24, del 10 — real usage.
- Provenance: `20260701_crm_phase4c_email_campaigns.sql`.
- Columns: 17 total — 16 used, 1 dead: `scheduled_at` (zero hits in code + fndefs — campaign scheduling never built; sends are manual via the worker).
- Policies: `email_campaigns_all` (ALL, roles **anon**+authenticated, true/true) — BAND-AID + live anon exposure.
- Triggers: none.
- Notes: parallel to the dead SMS `campaigns` stack; this is the surviving generation.

### email_inbound_events — USED
- Purpose: idempotency ledger for inbound email-provider events (key `resend:<svix-id>`), claimed once per event.
- Evidence: `functions/api/resend-webhook.js:178` via `claim_inbound_email`; fndef `claim_inbound_email` inserts `message_key` with ON CONFLICT DO NOTHING.
- Prod stats: live 1, ins 5, del 4 — matches a dedup ledger with cleanup.
- Provenance: `20260704_omni_inbox_foundation.sql`.
- Columns: 3 total — 3 used (message_key via the claim RPC; claimed_at default-stamped; id PK).
- Policies: `email_inbound_events_authenticated` (ALL, authenticated, true/true) — BAND-AID (always-true on a service ledger; any authenticated user could insert a future svix key and pre-consume the webhook's dedup — see structural problem 4; anon grants persist too).
- Triggers: none.
- Notes: despite the omni-era name, its only live role is Resend bounce/complaint webhook dedup — the omni inbound-email-into-conversations lane was never wired.

### email_suppressions — USED
- Purpose: the do-not-email list (bounces, complaints, unsubscribes) gating every automated email.
- Evidence: `functions/lib/automated-send.js:124` (send gate), `functions/lib/conversation-email.js:75` (recipient check), written by `resend-webhook.js` (via crm-owned `record_email_suppression` RPC) and `email_unsubscribe` fndef; read by `get_contact_consent`, `preview_email_audience` (crm).
- Prod stats: live 0, ins 9, del 8, idx 1,642 (last_seq 2026-07-27) — actively consulted.
- Provenance: `20260701_crm_phase4c_email_campaigns.sql`.
- Columns: 7 total — 7 used.
- Policies: none (service_role-only grants; RPC/worker access only). Sound least-privilege posture.
- Triggers: none.

### email_sync_log — USED (write-only log; external writer)
- Purpose: per UPR-Web-Context.md:709 "Email sync records (vendor invoice app)" — an external vendor-invoice email sync writes outcome rows here.
- Evidence: NO repo call sites (3-pattern grep across full scope → only `upr-mcp/src/codeIndex.js:6726`; zero fndef/view/cron/trigger references) — yet prod stats prove a live writer: ins 81, live 50, last_seq 2026-07-28. The writer is outside this repository (owner-side app/script). Classified used on the prod-stats evidence, not repo evidence.
- Prod stats: live 50, ins 81, upd 0, del 0, seq 2,017 (last 2026-07-28), last_idx 2026-03-10.
- Provenance: untracked — predates schema-as-code.
- Columns: 7 total — 7 uncertain (id, message_id, vendor, order_number, outcome, synced_at, notes — written by an external app this audit cannot inspect; all code-grep hits are same-name collisions).
- Policies: `allow_authenticated_email_sync_log` (ALL, authenticated, true/true) — BAND-AID (always-true; anon grants persist; the external writer presumably uses service or anon key — unverifiable from the repo).
- Triggers: none.
- Notes: top open question for the owner — see below. `docs/db-foundation-p4-orphan-report.md:125` already flagged `email_sync_log.message_id` as orphan-ish.

### message_notification_outbox — USED
- Purpose: durable at-least-once outbox for inbound-message push notifications (CallRail lane): rows enqueued by the DB projector, claimed and delivered by a worker.
- Evidence: enqueued by fndef `project_callrail_inbound_event`; claimed via `claim_message_notification_outbox` in `functions/lib/message-notification-outbox.js:161` (runner `functions/api/process-message-notification-outbox.js:28`); woken by trigger `message_notification_outbox_dispatch` + pg_cron job 11 `upr_message_notification_outbox` (*/5) → `wake_message_notification_outbox_worker()`; health-read by `functions/api/messaging-setup.js:63-67`.
- Prod stats: live 22, ins 22, upd 44, last_seq 2026-07-29 — live.
- Provenance: `20260723215926_messaging_transport_foundation.sql`.
- Columns: 17 total — 17 used (delivery_state/attempts/next_attempt_at/claimed_at/claim_token/delivered_at/failed_at/last_error all named in the lib; refs written by the projector).
- Policies: none (service_role-only grants). Sound.
- Triggers: `message_notification_outbox_dispatch` (AFTER INSERT, FOR EACH STATEMENT → `trigger_message_notification_outbox_worker`) — USED (best-effort pg_net wake; swallows errors so ingest never rolls back; cron is the safety net).
- Notes: prod shows 22 rows never reaching delivered (delivery_state distribution unknown from stats alone) — worth an ops glance, not a schema problem.

### message_provider_events — USED
- Purpose: raw provider (CallRail) inbound/outbound message event ledger with claim/retry state machine; source of truth the projector turns into `messages` rows; also scanned by the consent gate for pending STOP keywords.
- Evidence: written by `functions/api/callrail-text-webhook.js:203,236-261`; claimed by `claim_callrail_provider_event` in `functions/api/process-callrail-events.js:26`; projected by `project_callrail_inbound_event`/`project_callrail_outbound_event`/`project_callrail_reconcile_outcome` (called from `functions/lib/callrail-message-processor.js:233,274`, `functions/api/reconcile-callrail-messages.js:34`); recovery cron job 12 `upr_callrail_event_recovery` (*/5) → `wake_callrail_event_recovery_worker` (fn owned by another domain’s assignment but operating on this table); health-read by messaging-setup.js; read by `get_service_sms_consent_status` (pending-STOP scan).
- Prod stats: live 57, ins 62, upd 275, last 2026-07-29 — ACTIVE in production (the "activation owner-gated" note in initiative-status refers to provider binding/flag steps, but inbound CallRail texting is demonstrably flowing).
- Provenance: `20260723215926_messaging_transport_foundation.sql`.
- Columns: 37 total — 36 used, 1 dead: `resolved_by` (written only by the dead `resolve_provider_event` scalpel; sole other references are its contract test `tests/qa/unit/provider-event-resolution.test.js:57`). `resolved_at` stays used (recovery worker/wake fn filters on it).
- Policies: none (service_role-only grants). Sound.
- Triggers: none.
- Notes: consent-critical — the gate greps THIS table's raw `content` for stop/stopall/unsubscribe/cancel/end/quit before allowing a send (fail-closed pending-STOP window).

### message_send_attempts — USED
- Purpose: idempotent per-recipient send-attempt ledger for the provider-neutral transport (client_request_id + request_fingerprint dedup, state machine prepared→submitting→accepted/failed, reconcile_after).
- Evidence: `functions/lib/messaging-attempts.js` (create/materialize), `functions/api/send-message.js:304-325,807` (`claim_message_recipient_attempt`), `functions/api/recover-message-send-attempts.js:53,64` (`materialize_message_send_attempt`), `functions/api/reconcile-callrail-messages.js:64,88`; health-read by messaging-setup.js.
- Prod stats: live 37, ins 38, upd 66, last 2026-07-28 — staff sends through the transport are live.
- Provenance: `20260723215926_messaging_transport_foundation.sql`.
- Columns: 31 total — 30 used, 1 dead: `channel_fallback_reason` (only reference is the db-lane source-contract test `supabase/tests/messaging_transport_foundation.test.js:58`; no code path ever writes it — it models the fallback the no-fallback rule forbids; reserved-by-design, currently dead).
- Policies: none (service_role-only grants). Sound.
- Triggers: none.
- Notes: the idempotency-key discipline (Rule 15) lives here — keys are client-supplied/content-derived (client_request_id, request_fingerprint), verified in messaging-attempts.js.

### message_templates — USED
- Purpose: canned SMS templates for the composer (office + tech shells) and automated sequence bodies.
- Evidence: `src/pages/Conversations.jsx:1194`, `src/pages/tech/v2/messages/useTemplates.js:42`, `src/pages/DevTools.jsx:1164`, `functions/api/process-sequences.js:192`, `functions/lib/automated-send.js:605`; fndef `get_scheduled_queue` joins it.
- Prod stats: live 10, ins 10, seq 67 last 2026-07-24.
- Provenance: untracked — predates schema-as-code.
- Columns: 13 total — 9 used, 1 uncertain, 3 dead:
  - `rcs_content_sid` — dead (zero hits; RCS lane never built).
  - `fallback_body` — dead (zero hits).
  - `usage_count` — dead (zero hits; usage tracking never wired).
  - `created_by` — uncertain (generic name; carried by Conversations' unfiltered select; no named reader/writer).
- Policies: `allow_anon_read_templates` (SELECT, TO authenticated, true) — DUPLICATED (fully subsumed by the ALL policy on the same table/role); `allow_authenticated_message_templates` (ALL, authenticated, true/true) — BAND-AID (always-true; any authenticated user can edit templates; template CRUD UI is DevTools-only but the DB doesn't enforce it).
- Triggers: none.

### messages — USED
- Purpose: every message row — sms in/out, MMS, internal notes; the core artifact of the domain.
- Evidence: realtime `src/lib/realtime.js:33-56` + publication; `src/components/DeliverabilityHealth.jsx:200`; workers `send-message.js`, `twilio-webhook.js`, `twilio-status.js`, `process-scheduled.js`, `automated-send.js`, callrail projectors (fndefs); UI reads via embeds and `get_tech_conversations`/thread hooks.
- Prod stats: live 62, ins 183, upd 29, del 104, last 2026-07-29 — hot. (dels include DevTools test-row cleanup.)
- Provenance: untracked legacy — drift-captured in `20260709_sms_f01_drift_capture.sql` (+ f02 added num_segments/price; transport migration added provider columns).
- Columns: 34 total — 24 used, 1 uncertain, 1 duplicated, 8 dead:
  - Dead (all zero code+fndef hits; the omni email-into-messages lane was never wired; `email_to`'s 4 grep hits are locals in generate-water-loss-report.js, unrelated): `rcs_content_sid`, `email_message_id`, `in_reply_to`, `email_references`, `email_from`, `email_to`, `email_html`, `sender_email`.
  - Uncertain: `subject` (generic name; would belong to the unwired email lane; no message-context writer found — kept uncertain rather than dead because grep noise is high).
  - Duplicated: `twilio_sid` (UNIQUE, legacy provider id) — same fact as `provider_message_id` (transport-neutral generation); both written today on their respective paths (`send-message.js:280` vs callrail projector). Deliberate — contract-frozen (§9.2).
  - Used: id, conversation_id, type, body, channel, status, sent_by, sender_phone (twilio-webhook.js:339), sender_contact_id, media_urls, read_at + clicked_at (twilio-status.js:125 — RCS read/click receipts), error_code, error_message, created_at, direction, num_segments + price (twilio-status.js per §9.2), provider, provider_message_id, provider_conversation_id, client_request_id, sender_address, recipient_address.
- Policies: `messages_authenticated_select` (SELECT, authenticated, `messaging_can_access_conversations()`) — USED (real predicate; combined with authenticated having ONLY the SELECT grant, this is the one table where the worker-sole-writer rule is actually enforced at the database layer — the model posture the rest of the domain should copy).
- Triggers: `trg_message_events` (AFTER INSERT FOR EACH ROW → `trigger_message_events`) — USED (writes message.inbound/outbound system_events with job context; SECURITY DEFINER, pinned path).
- Notes: `sender_phone` vs `sender_address` is a second legacy/neutral pair (kept used/used with this note rather than duplicated — different writers, both read).

### native_push_delivery_claims — USED
- Purpose: exactly-once claim ledger for APNs deliveries (delivery_key dedup, 90-day retention, self-pruning).
- Evidence: `functions/lib/apns.js:175,158` via `claim_native_push_delivery`/`release_native_push_delivery_claim`; guardrail tests `supabase/tests/native_push_delivery_guardrails_isolated.sql`.
- Prod stats: live 2, ins 2, last 2026-07-29 — live.
- Provenance: `20260728224000_native_push_delivery_guardrails.sql`.
- Columns: 4 total — 4 used.
- Policies: `native_push_delivery_claims_service_role` (ALL, service_role, true/true) — USED (explicit service-only boundary; sound).
- Triggers: none.

### notification_employee_overrides — USED
- Purpose: admin per-employee notification channel overrides (between role defaults and personal prefs).
- Evidence: `src/components/admin/NotificationDefaultsTab.jsx:339,357,379,298` via set/delete/get RPCs; consumed by `get_effective_notification_prefs`.
- Prod stats: live 1, ins 8, del 7, idx 1,781 (last 2026-07-29).
- Provenance: `20260703_notify_f2_foundation.sql`.
- Columns: 7 total — 7 used (updated_by written by `set_employee_notification_override`).
- Policies: `notification_employee_overrides_all` (ALL, authenticated, true/true) — BAND-AID (always-true: the admin-only check lives in the RPCs, but direct PostgREST writes by any authenticated user pass; anon grants persist).
- Triggers: none.

### notification_prefs — USED
- Purpose: personal per-employee notification channel preferences.
- Evidence: `src/components/settings/NotificationPrefsMatrix.jsx:88,114` via `get_my_notification_prefs`/`set_my_notification_pref` (ownership-checked); consumed by `get_effective_notification_prefs` (notify.js:203, google-calendar.js:77).
- Prod stats: live 35, ins 46, upd 13, seq 1,384 (last 2026-07-29).
- Provenance: `20260703_notify_f2_foundation.sql`.
- Columns: 6 total — 6 used.
- Policies: `notification_prefs_all` (ALL, authenticated, USING false CHECK false) — BAND-AID (deliberate deny-all left after the ownership-boundary hardening; a no-op relative to RLS default-deny, kept as a posture marker; grants are service-only anyway).
- Triggers: none.

### notification_queue — DEAD
- Purpose: the notify-v1 delivery queue (event_id/rule_id/attempts/next_retry_at machinery), superseded by `notifications` + notify worker + `message_notification_outbox`.
- Evidence: 3-pattern grep, full scope → 1 hit: `upr-mcp/src/codeIndex.js:6175`. fndefs: only `merge_jobs` (jobs domain) repoints job_id FKs on merge — bookkeeping over an empty table. No views/cron/trigger/publication. `docs/notify-roadmap.md:43` and the web-context changelog both record it as left-untouched legacy.
- Prod stats: live 0, ins 0, upd 0, del 0; seq 339 (sweeps), last 2026-07-21.
- Provenance: untracked — predates schema-as-code.
- Columns: 18 total — 18 dead (dead with table): id, event_id, rule_id, recipient_id, channel, title, body, entity_type, entity_id, job_id, status, sent_at, read_at, error, attempts, max_attempts, next_retry_at, created_at.
- Policies: `anon_insert_notification_queue` (INSERT, TO authenticated, true) — DEAD; `anon_select_notification_queue` (SELECT, TO authenticated, true) — DEAD; `anon_update_notification_queue` (UPDATE, TO authenticated, true) — DEAD. (Renamed-rescoped anon relics on a dead table; anon table grants persist.)
- Triggers: none.

### notification_reads — USED
- Purpose: per-employee read receipts for broadcast notifications (recipient_id IS NULL rows) — the 20260726 recipient-boundary fix.
- Evidence: fndefs `get_notifications` (LEFT JOIN receipt), `mark_notification_read` (INSERT on broadcast), `mark_all_notifications_read`, `get_unread_notification_count` — all reached from `src/components/NotificationBell.jsx:154,300,324,125`.
- Prod stats: live 0, ins 0 — no broadcast has been marked read since apply, but idx 1,426 with last_idx 2026-07-29 proves the join runs constantly. Used.
- Provenance: `20260726260000_notification_read_recipient_boundary.sql`.
- Columns: 3 total — 3 used.
- Policies: `notification_reads_no_direct_access` (ALL, authenticated, false/false) — BAND-AID (deliberate deny-all documentation marker; no grants exist for authenticated at all, so it is a no-op by construction).
- Triggers: none.

### notification_role_defaults — USED
- Purpose: admin-set per-role notification channel defaults with user_customizable locks.
- Evidence: `NotificationDefaultsTab.jsx:156,176` via `set_notification_default` (admin-checked); consumed by `get_notification_defaults`, `get_effective_notification_prefs`, `set_my_notification_pref` (lock check); tech settings honors locks (`src/components/tech/settings/NotificationsSection.jsx:51`).
- Prod stats: live 27, ins 43, upd 20, seq 1,834 (last 2026-07-29).
- Provenance: `20260703_notify_f2_foundation.sql`.
- Columns: 8 total — 7 used, 1 uncertain: `updated_by` (`set_notification_default` does not write it; no code names it for this table; possibly always NULL — generic-name noise prevents a firm dead call).
- Policies: none (service-role-only grants; RPC-only access). Sound.
- Triggers: none.

### notification_types — USED
- Purpose: the notification type catalog (type_key, labels, per-channel defaults, kill-switch `enabled`).
- Evidence: `functions/api/notify.js:486` (per-send type lookup), `notify_emit` fndef (enabled gate before pg_net), defaults RPCs, admin tab; db-lane test notify_d_admin_defaults.
- Prod stats: live 15, ins 29, upd 13, seq 2,945 (last 2026-07-29).
- Provenance: `20260703_notify_f2_foundation.sql`.
- Columns: 11 total — 9 used, 2 uncertain: `audience` (only comment-level mentions in notify.js — the role-audience fallback there is a hard-coded JS map, not this column; carried by `select=*`), `description` (generic; no named reader).
- Policies: none (service-role-only grants). Sound.
- Triggers: none.

### notifications — USED
- Purpose: the in-app notification feed (bell), broadcast (recipient_id NULL) or targeted.
- Evidence: written by `create_notification` (notify.js:211) and `request_account_deletion` fndef; read via `get_notifications`/`get_unread_notification_count` from NotificationBell; realtime INSERT subscription `realtime.js:90-102` + publication.
- Prod stats: live 1,316, ins 1,327, idx 61,009 (last 2026-07-29) — the busiest table in the domain.
- Provenance: `20260624_notifications.sql`.
- Columns: 13 total — 13 used.
- Policies: `notifications_select` (SELECT, authenticated, active-internal-employee AND (broadcast OR mine) predicate) — USED (sound recipient boundary; matches the RPC logic); `notifications_delete_testrows` (DELETE, authenticated, USING false) — BAND-AID (originally `type = '__f2test__'` cleanup policy from notify F2, deliberately neutered to false by the 20260726 boundary migration; now a tombstone that permits nothing).
- Triggers: none.
- Notes: grants: authenticated SELECT only + service_role full — the same enforced sole-writer posture as `messages`. Good.

### push_subscriptions — USED
- Purpose: web-push (VAPID) subscription registry per employee/browser.
- Evidence: `src/lib/webPushClient.js:469,184` via `upsert_push_subscription`/`delete_push_subscription` (auth.uid-scoped); delivery + pruning in `functions/api/notify.js:270,286`; devices list `src/components/settings/PushDevicesList.jsx:80`.
- Prod stats: live 4, ins 8, del 4, idx 1,290 (last 2026-07-29).
- Provenance: `20260703_notify_f1_push_subscriptions.sql`.
- Columns: 8 total — 8 used (user_agent written via RPC param, surfaced as device label by `get_my_push_subscriptions`).
- Policies: none (RLS on, no policies — but table grants still include FULL anon+authenticated DML; with no policy every direct request is default-denied, so the grants are inert residue; access is RPC-only in practice).
- Triggers: none.

### scheduled_messages — USED
- Purpose: schedule-a-text queue (pending → claimed → sent/failed/cancelled) consumed by the process-scheduled worker.
- Evidence: `src/pages/Conversations.jsx:1040` (insert), `src/pages/DevTools.jsx:1395,1410` (queue view/cancel via `get_scheduled_queue`), `functions/api/process-scheduled.js:114,146,271` + `claim_scheduled_message` (:158). The worker is driven by an external cron hitting `/api/process-scheduled` with a cron secret (no pg_cron entry; UPR-Web-Context:3564 documents the external-cron mechanism — live-config assumption, stated as such).
- Prod stats: live 1, ins 4, upd 4, del 3 — light real usage.
- Provenance: untracked legacy — drift-captured in `20260709_sms_f01_drift_capture.sql` (claimed_at added by f02-era work).
- Columns: 12 total — 12 used.
- Policies: `allow_anon_insert_scheduled_messages` (INSERT, TO authenticated, check true) — DUPLICATED (subsumed by the ALL policy, same role); `allow_anon_read_scheduled_messages` (SELECT, TO authenticated, true) — DUPLICATED (same); `allow_authenticated_scheduled_messages` (ALL, authenticated, true/true) — BAND-AID (always-true; any authenticated user can cancel/alter anyone's scheduled sends directly; anon grants persist).
- Triggers: none.
- Notes: at-least-once semantics — `claim_scheduled_message` guarantees one winner per 10-minute claim window; terminal-status write promptness is the worker's obligation (§9.4).

### service_sms_consent_attestations — USED
- Purpose: append-only audit of every staff prior-consent attestation event (who attested what, when, from which IP).
- Evidence: written by `attest_prior_sms_consent` fndef (INSERT with all fields) from `functions/api/attest-sms-consent.js:197`; UI `src/components/conversations/SmsConsentAttestationModal.jsx`.
- Prod stats: live 2, ins 4 — real (write-only audit).
- Provenance: `20260724014423_attest_prior_sms_consent.sql`.
- Columns: 12 total — 12 used (write-only audit; every field named in the RPC INSERT).
- Policies: `service_sms_consent_attestations_service_role_insert` (INSERT, service_role) — USED; `service_sms_consent_attestations_service_role_select` (SELECT, service_role) — USED. Grants service_role INSERT,SELECT only — the tightest posture in the domain; correct for evidence.
- Triggers: none.

### service_sms_consents — USED
- Purpose: current-state projection of verified prior service-SMS consent per contact (the thing `get_service_sms_consent_status` reads to return SERVICE_CONSENT).
- Evidence: upserted by `attest_prior_sms_consent`; read by `get_service_sms_consent_status` fndef (`consent_scope='service_related_customer_project_messages' AND attestation_version='prior_sms_consent_v1'`); db-lane test work_authorization_sms_consent.test.js:104.
- Prod stats: live 2, ins 3, upd 1, last 2026-07-28.
- Provenance: `20260724014423_attest_prior_sms_consent.sql`.
- Columns: 12 total — 12 used.
- Policies: `service_sms_consents_service_role_manage` (ALL, service_role, true/true) — USED (service-only boundary).
- Triggers: none.

### sms_consent_log — USED
- Purpose: the append-oriented TCPA consent/DND event ledger (opt-in/out, dnd on/off, STOP/START, attestation events) with actor and source.
- Evidence: written by `src/pages/Conversations.jsx:864` (dnd toggle audit), `src/pages/tech/v2/messages/useConvoMutations.js:87`, `functions/api/process-scheduled.js:203,219`, twilio-webhook (STOP/START), callrail projector (`project_callrail_inbound_event` fndef, with provider_event_id), `attest_prior_sms_consent`, `complete_sign_request_with_work_authorization_sms_consent`, `upsert_lead_from_form` fndefs.
- Prod stats: live 166, ins 183, del 15, last idx 2026-07-26. (del 15 = test cleanup — DevTools lists it in its cleanup array, see problem 3.)
- Provenance: untracked legacy — drift-captured in `20260709_sms_f01_drift_capture.sql` (provider_event_id added by transport work).
- Columns: 10 total — 10 used.
- Policies: `allow_anon_insert_consent_log` (INSERT, TO authenticated, check true) — DUPLICATED (subsumed by ALL); `allow_anon_read_consent_log` (SELECT, TO authenticated, true) — DUPLICATED; `allow_authenticated_consent_log` (ALL, authenticated, true/true) — BAND-AID (always-true INCLUDING UPDATE and DELETE on the compliance evidence ledger — any authenticated browser session can rewrite consent history; structural problem 3; anon grants persist).
- Triggers: none.
- Notes: client inserts are by design (§12: consent writes land here with actor/IP) — it is the UPDATE/DELETE surface that contradicts an evidence ledger.

### work_authorization_sms_consents — USED
- Purpose: immutable evidence rows tying service-SMS consent to a signed work authorization (sign request, disclosure version + sha256, signed file, IP).
- Evidence: written inside `complete_sign_request_with_work_authorization_sms_consent` (called by `functions/api/submit-esign.js` — `WORK_AUTH_SMS_COMPLETION_RPC`, :37); read by `get_service_sms_consent_status` (work-auth consent branch); db-lane tests work_authorization_sms_consent.test.js.
- Prod stats: live 2, ins 2, last 2026-07-28 — live.
- Provenance: `20260727005212_upr_work_authorization_sms_consent.sql`.
- Columns: 12 total — 11 used, 1 uncertain: `consent_source` (default-valued; the INSERT does not name it and no reader filters on it; only db-lane test references).
- Policies: `work_authorization_sms_consents_service_role_insert` (INSERT, service_role) — USED; `work_authorization_sms_consents_service_role_select` (SELECT, service_role) — USED.
- Triggers: none.

## RPCs (63)

Security column: `definer`/`invoker` + effective EXECUTE grants from acl (all definer functions here pin search_path — verified in fndefs).

| function(args) | class | security | callers / evidence | notes |
|---|---|---|---|---|
| attest_prior_sms_consent(contact,actor,method,date,note,ip) | used | invoker; service_role-only grant; internal `current_user='service_role'` + admin/office actor check | functions/api/attest-sms-consent.js:197 | Model consent write: advisory phone lock, duplicate-contact lock, DND/opt-out/pending-STOP re-checks, projection + audit in one txn |
| claim_callrail_provider_event(event,now,stale) | used | invoker; service-only; internal role check | functions/api/process-callrail-events.js:26 | Claim state machine incl. stale re-claim |
| claim_inbound_email(key) | used | DEFINER; granted to **authenticated**; NO caller check | functions/api/resend-webhook.js:178 | FLAG: any logged-in user can pre-consume a `resend:<svix-id>` dedup key and silently drop a real bounce/complaint event (problem 4) |
| claim_message_notification_outbox(limit,now,stale,token) | used | invoker; service-only; internal role check | functions/lib/message-notification-outbox.js:161 (worker process-message-notification-outbox.js) | SKIP LOCKED batch claim; sound |
| claim_message_recipient_attempt(attempt) | used | invoker; service-only; internal role check | functions/api/send-message.js:807 | Transport per-recipient claim |
| claim_native_push_delivery(key,employee,token,fingerprint) | used | invoker; service-only; internal role check | functions/lib/apns.js:175 | Exactly-once APNs claim + 90-day self-prune |
| claim_scheduled_message(id) | used | DEFINER; granted to **authenticated**; NO caller check | functions/api/process-scheduled.js:158; db-lane sms_f_core_rpcs.test | FLAG: any logged-in user can claim pending scheduled sends (suppress/steal the worker's claim window). Signature frozen by sms manifest §9.4 |
| complete_sign_request_with_work_authorization_sms_consent(10 args) | used | invoker; service-only; internal role check | functions/api/submit-esign.js:37 (raw /rpc fetch) | Wraps `complete_sign_request` and adds work-auth consent evidence + sms_consent_log in same txn; pinned disclosure sha256 |
| create_notification(10 args) | used | DEFINER; service-only grant | functions/api/notify.js:211; fndef apply_midnight_clock_split | Bare INSERT…RETURNING; safe because grant is service-only |
| crm_fixed_automation_conflict(org,event) | used | DEFINER; authenticated grant; no caller check (read-only boolean) | inside live crm fns set_automation_enabled/upsert_crm_automation; mirrored in process-crm-automations.js:56 | DB-internal helper; benign |
| delete_device_token(token) | dead | DEFINER; service-only grant | Zero code callers. Trail: greps `'delete_device_token'`/`"…"`/`\b…\b` across src/functions/scripts/upr-mcp/tests/.github + ios/ → only supabase/tests/mobile_personal_ownership_boundary_*.sql (db-lane, test-only); no fndef/cron/trigger refs | v1 token-passed generation superseded by delete_my_native_device_token |
| delete_email_campaign(id) | used | DEFINER; authenticated; NO role check | src/pages/crm/CrmCampaigns.jsx:254 | Draft/failed-only guard exists but any authenticated role may call (problem 5) |
| delete_employee_notification_override(emp,type,channel) | used | DEFINER; authenticated; `is_active_internal_admin()` check | NotificationDefaultsTab.jsx:357,379 | Sound |
| delete_my_native_device_token(token) | used | DEFINER; authenticated; auth.uid ownership check | src/lib/pushNotifications.js:245,627 | Sound |
| delete_push_subscription(endpoint) | used | DEFINER; authenticated; auth.uid scoping | src/lib/webPushClient.js:184 | Sound |
| email_unsubscribe(email,recipient,org) | used | DEFINER; **authenticated** grant; NO caller check | functions/api/email-unsubscribe.js:65 (public unsubscribe worker, service client) | FLAG: any logged-in user can suppress any address; the worker is the intended sole caller |
| find_or_create_conversation(contact) | used | invoker; service-only; internal role check | functions/api/message-conversations.js:158, functions/api/send-esign.js:180 | Advisory-locked; returns get_tech_conversations row shape |
| get_automation_settings(org) | used | DEFINER; authenticated; NO caller check; WRITES on read (inserts default row) | CrmSettings.jsx:103, CrmAutomations.jsx:195 | Write-on-read definer open to all staff |
| get_campaign_exclusions(campaign) | used | DEFINER; authenticated; no check | CrmCampaigns.jsx:177 | Read-only; low risk |
| get_contact_consent(contact) | used | DEFINER; authenticated; no check | src/components/crm/ContactDetail.jsx:56 | Merges dnd/opt-out/email-suppression into one view — read-side consent aggregation |
| get_effective_notification_prefs(emp) | used | DEFINER; authenticated; ownership check (`is_current_native_push_preferences_employee`) | notify.js:203, google-calendar.js:77, my-prefs RPC | Sound; the layered defaults→override→pref resolver |
| get_email_campaigns(org) | used | DEFINER; authenticated; no role check | CrmCampaigns.jsx:136 | Read-only |
| get_employee_notification_overrides(emp) | used | DEFINER; authenticated; NO caller check | NotificationDefaultsTab.jsx:298 | Exposes any employee's pref matrix to any staff; low sensitivity |
| get_message_author_directory(ids[]) | used | DEFINER; authenticated; `messaging_can_access_conversations()` check | src/lib/employeeDirectory.js:49 | Sound; note-author resolution, capped at 200 ids |
| get_message_log(limit,offset,dir,status) | used | DEFINER; **authenticated**; NO caller check | src/pages/DevTools.jsx:1251 (DevRoute-gated UI only) | FLAG: bypasses messaging_can_access_conversations — full message bodies+phones readable by ANY authenticated session (problem 5) |
| get_my_notification_prefs(emp) | used | DEFINER; authenticated; ownership check | NotificationPrefsMatrix.jsx:88 | Sound |
| get_my_push_subscriptions(emp) | used | DEFINER; authenticated; NO caller check (SQL fn, param-trusted) | PushDevicesList.jsx:80 | Any staff can enumerate another's devices (hash+UA only — low sensitivity) |
| get_notification_defaults() | used | DEFINER; authenticated; no check | NotificationDefaultsTab.jsx:113 | Read-only config matrix |
| get_notifications(limit,emp) | used | DEFINER; authenticated; service-role branch + auth.uid actor + recipient-mismatch guard | NotificationBell.jsx:154 | Sound (20260726 boundary) |
| get_scheduled_queue(limit) | used | DEFINER; **authenticated**; NO caller check | DevTools.jsx:1395 | Same exposure class as get_message_log |
| get_service_sms_consent_status(contact,phone) | used | invoker; service-only; internal `current_user` check | send-message.js:110, automated-send.js:507, process-scheduled.js:193, attest-sms-consent.js:132 | THE consent gate. Fail-closed: phone-mismatch, advisory lock, cross-contact DND, explicit opt_out_at, raw pending-STOP scan of message_provider_events, then GLOBAL_OPT_IN / SERVICE_CONSENT (attestation or work-auth) / NO_CONSENT. Live body has NO `IMPLIED_CONSENT` (migration authored-not-applied) |
| get_tech_conversations(6 args) | used | DEFINER; **authenticated**; NO caller check | tech-v2 useTechConversations.js:108, TechMessagesV2.jsx:95; wrapped by find_or_create_conversation | FLAG: entire conversation list + participant contact PII to any authenticated session, bypassing the messages-policy gate; does strip email_reply_token |
| get_unread_notification_count(emp) | used | DEFINER; authenticated; actor + mismatch guard | NotificationBell.jsx:125 | Sound |
| increment_conversation_unread(conv,by) | used | DEFINER; **authenticated**; NO caller check | functions/api/twilio-webhook.js:354; db-lane test | Frozen contract (§9.4). FLAG: unauthenticated-role no, but any staff session can bump any counter |
| mark_all_notifications_read(emp) | used | DEFINER; authenticated; actor + mismatch guard | NotificationBell.jsx:324 | Sound; broadcast reads via notification_reads |
| mark_notification_read(id) | used | DEFINER; authenticated; actor + recipient guard | NotificationBell.jsx:300 | Sound |
| materialize_message_send_attempt(attempt) | used | invoker; service-only | functions/api/recover-message-send-attempts.js:64; called by project_callrail_outbound/reconcile fndefs | Recovery projection |
| notify_emit(type_key,body) | used | DEFINER; service-only grant (+ trigger context) | fndefs: trg_appt_notify, trg_appt_crew_notify, trg_estimate_accepted_notify, scan_abandoned_clocks, submit/review_time_entry_change_request | Gate on notification_types.enabled then pg_net POST to notify worker (url+secret from integration_config). The DB→worker bridge |
| notify_qbo_customer_sync() | band-aid | DEFINER; trigger fn | Fired by trg_qbo_customer_sync on contacts (live table) | Deliberate no-op stub: body is `RETURN NEW` with a comment ("Phase B: no-op… restore to re-enable auto-sync"). Runs on every contact insert doing nothing — kept so the trigger seam survives |
| omni_verify_foundation() | dead | DEFINER; granted to **authenticated** | Trail: greps (3 patterns, full scope) → only supabase/tests/omni_messages_check_widen.test.js:42-63 (db-lane, test-only); no code/cron/trigger callers | Self-test that INSERTs/DELETEs live conversations/messages rows — and any authenticated user may execute it. Dead + dangerous grant |
| project_callrail_inbound_event(event,consent_only) | used | invoker; service-only | functions/lib/callrail-message-processor.js:274 | 15KB projector: contact match, conversation find/create, messages insert, consent-log STOP projection, outbox enqueue |
| project_callrail_outbound_event(event,attempt) | used | invoker; service-only | callrail-message-processor.js:233 | Outbound projection + attempt reconcile |
| project_callrail_reconcile_outcome(13 args) | used | invoker; service-only | functions/api/reconcile-callrail-messages.js:34 | Attempt↔provider-event reconciliation |
| prune_stale_native_device_token(5 args) | used | invoker; service-only | functions/lib/apns.js:328 | Compare-and-delete of invalidated APNs tokens |
| queue_email_campaign(campaign) | used | DEFINER; **authenticated**; NO role check | functions/api/send-email-campaign.js:93 | FLAG: any staff role can build the audience + flip a campaign to sending (problem 5) |
| rearm_callrail_provider_event(event,expect_error,now) | dead | invoker; service-only; internal role check | Trail: greps (3 patterns, full scope) → only tests/qa/unit/rearm-callrail-event.test.js (source-contract test reading migration text); zero code/cron/trigger/fndef callers | Operator scalpel: manual service-role recovery of a failed provider event. Authored 2026-07 with tests; never wired to any caller |
| record_email_campaign_send(recipient,status,resend_id,error) | used | DEFINER; authenticated; NO role check | send-email-campaign.js:130 | Also maintains campaign counters; intended sole caller is the worker |
| release_native_push_delivery_claim(key) | used | invoker; service-only | apns.js:158 | — |
| resolve_provider_event(event,by,now) | dead | invoker; service-only; internal role check | Trail: greps (3 patterns, full scope) → only tests/qa/unit/provider-event-resolution.test.js (contract test); zero live callers | Operator scalpel (mark failed event resolved); writes the otherwise-dead resolved_by column |
| set_campaign_exclusions(campaign,ids[]) | used | DEFINER; authenticated; NO role check | CrmCampaigns.jsx:237 | Draft-only guard; no role guard |
| set_employee_notification_override(5 args) | used | DEFINER; authenticated; admin check | NotificationDefaultsTab.jsx:339 | Sound |
| set_my_notification_pref(4 args) | used | DEFINER; authenticated; ownership check + role-default lock enforcement | NotificationPrefsMatrix.jsx:114 | Sound |
| set_notification_default(5 args) | used | DEFINER; authenticated; admin check | NotificationDefaultsTab.jsx:156,176 | Sound |
| trg_appt_crew_notify() | used | DEFINER; trigger fn | Trigger trg_appointment_crew_notify AFTER INSERT ON appointment_crew (live scheduling table) | Emits appointment.assigned via notify_emit |
| trg_appt_notify() | used | DEFINER; trigger fn | Trigger trg_appointment_notify ON appointments | Emits appointment.updated/canceled |
| trg_estimate_accepted_notify() | used | DEFINER; trigger fn | Trigger on estimates | Emits estimate.accepted |
| trigger_message_events() | used | DEFINER; trigger fn | Trigger trg_message_events AFTER INSERT ON messages | Logs message.inbound/outbound to system_events with job context |
| trigger_message_notification_outbox_worker() | used | DEFINER; no grants beyond postgres (trigger context only) | Trigger message_notification_outbox_dispatch | Best-effort wake; exceptions swallowed so ingest never rolls back |
| upsert_device_token(emp,token,platform) | dead | DEFINER; service-only grant | Trail: greps (3 patterns, full scope + ios/) → only supabase/tests/mobile_personal_ownership_boundary_*.sql (test-only); zero code/fndef/cron callers | v1 identity-passed generation superseded by upsert_my_native_device_token |
| upsert_email_campaign(8 args) | used | DEFINER; authenticated; NO role check | CrmCampaigns.jsx:228 | Draft-only edit guard; no role guard |
| upsert_my_native_device_token(token,env) | used | DEFINER; authenticated; auth.uid + active-internal-role check + cross-owner guard + 5-token cap | src/lib/pushNotifications.js:509 | The model "my"-scoped definer |
| upsert_push_subscription(endpoint,p256dh,auth,ua) | used | DEFINER; authenticated; auth.uid scoping | src/lib/webPushClient.js:469 | Sound |
| wake_message_notification_outbox_worker() | used | DEFINER; no app grants (cron/trigger context) | pg_cron job 11 `upr_message_notification_outbox` (*/5) + trigger_message_notification_outbox_worker | URL allowlist pinned to the two prod/dev endpoints; secret from integration_config |

## Structural problems (ranked, worst first)

1. **Consent truth is fragmented across five stores with duplicated normalization logic — severity 5.** A single send decision consults: `contacts.opt_in_status/opt_out_at/dnd` (crm-owned columns), `sms_consent_log` (event ledger), `service_sms_consents` (attestation projection), `work_authorization_sms_consents` (e-sign evidence), and a live regex scan of RAW `message_provider_events.content` for pending STOP keywords — all inside `get_service_sms_consent_status`, with the 10-digit phone normalization re-implemented in at least three functions (gate, attest, work-auth wrapper). It currently works because everything funnels through one RPC, but every new consent source adds another branch to a 6.7KB function, and phone-keyed identity lives nowhere as a first-class object. v2 should model one consent-state projection per normalized phone (sources feeding it as events), keeping the append-only evidence tables as inputs.
2. **Anonymous read/write on the email-campaign trio — severity 5.** `email_campaigns`, `email_campaign_recipients`, `email_campaign_exclusions` each have an ALL policy whose roles include **anon** with USING(true)/CHECK(true), AND full anon table grants — so the browser publishable key can read (and write) campaign content and recipient contact emails without login. This is outside the database-standard §2 allowlist; the P3 anon-closure covered these names only in a db-lane test file (`supabase/tests/db_foundation_p3_anon_closure.sql`), and the fresh parity-verified catalog shows the anon roles still live. Closure is a one-migration policy recreate.
3. **The TCPA evidence ledger is client-mutable — severity 5.** `sms_consent_log` carries an always-true ALL policy for authenticated (plus full grants incl. anon residue): any logged-in session can UPDATE or DELETE consent history. DevTools even bulk-deletes from it (`src/pages/DevTools.jsx:1533`), and prod stats show 15 deletes. Client INSERT is by design (§12); mutation is not. An evidence table should be insert-only for the app roles, with service-role-only correction paths — the posture `service_sms_consent_attestations` (INSERT,SELECT for service only) already demonstrates.
4. **Queue/ledger claim RPCs granted to `authenticated` without caller checks — severity 4.** `claim_scheduled_message` (any staff can claim pending scheduled sends → the worker's claim then fails and the row can strand/skip) and `claim_inbound_email` (any staff can pre-insert a `resend:<svix-id>` key → a real bounce/complaint webhook is treated as already-seen and the suppression is silently dropped). Both are SECURITY DEFINER with the F-core-frozen signatures; freezing the signature does not require freezing the grant — regrant to service_role only.
5. **Authenticated-executable SECURITY DEFINER surface bypasses the UI's authorization story — severity 4.** `get_message_log` and `get_scheduled_queue` (full message bodies + customer phones to ANY authenticated session, bypassing `messaging_can_access_conversations()` — their only UI is DevRoute-gated, but the grant is the real boundary), `get_tech_conversations` (all conversations + contact PII, no check), the email-campaign write RPCs (`upsert/queue/delete_email_campaign`, `set_campaign_exclusions`, `record_email_campaign_send` — no role predicate, so any field tech can queue a company email blast at the DB layer), `email_unsubscribe` (any staff can suppress any address), `get_automation_settings` (write-on-read), `increment_conversation_unread`, `omni_verify_foundation` (dead, yet lets any staff INSERT/DELETE live messages rows). This is the domain-local slice of the live audit's "342 authenticated-executable SECURITY DEFINER" finding.
6. **Always-true RLS + direct-table write paths contradict the worker-sole-writer rule everywhere except `messages` — severity 4.** `messages` got the correct posture (authenticated=SELECT-only grant + predicate policy); but `conversations`, `conversation_participants`, `scheduled_messages`, `message_templates`, `notification_employee_overrides`, `email_inbound_events`, `email_sync_log` all sit behind ALL/true policies with full grants, so admin-gated RPC checks (notification overrides) and worker-owned state (conversation counters/status, participant rows) are equally writable by any authenticated session via raw PostgREST. Anon GRANT residue additionally persists on ~12 tables where policies were rescoped to authenticated but grants were never revoked (inert where no anon policy exists, but §2-noncompliant and one policy away from exposure).
7. **The unread/read model is a shared mutable counter, not per-person state — severity 3.** `conversations.unread_count` is one global integer per thread (incremented by webhook, zeroed by whichever staffer opens the thread; `get_tech_conversations` sums it across ALL conversations for everyone's badge), while the table built for per-person read state (`conversation_reads`) was never wired and is dead. Notifications solved this correctly in 20260726 with `notification_reads`; conversations never got the equivalent.
8. **Dead parallel stacks awaiting a RED-tier cleanup — severity 3.** Six dead tables (`automation_rules`, `campaigns`, `campaign_recipients`, `notification_queue`, `conversation_reads`, `conversation_tags` — 67 columns), the messages email-lane columns + unwired `conversation-email.js`/`email_reply_token`, the v1 device-token RPC pair, `omni_verify_foundation`, and the never-called operator scalpels (`rearm_callrail_provider_event`, `resolve_provider_event` + its `resolved_by` column). None are load-bearing; all removals are destructive changes requiring the separate reviewed `-- destructive-approved:` path.
9. **Two provider generations coexist inside `messages` — severity 2.** `twilio_sid` vs `provider_message_id`, `sender_phone` vs `sender_address`, Twilio-only `num_segments/price` beside provider-neutral attempt records. Deliberate — contract-frozen (§9.2, messaging-transport addendum §11) — but v2 should pick the neutral names and view-map the legacy ones.

## Open questions for the owner

1. **email_sync_log** — what writes it today (UPR-Web-Context calls it the "vendor invoice app" — 81 inserts, most recent 2026-07-28)? Is that integration still wanted, and should its table live inside the app schema in v2 or move with its owner?
2. **SMS/MMS campaigns** — Marketing.jsx still promises "Coming in Phase 4b (blocked on Twilio carrier approval)", but on 2026-07-28 you said "we will not send any bulk marketing text." May `campaigns`/`campaign_recipients` (0 rows ever) and the Marketing SMS tab be retired in v2?
3. **Legacy rows worth keeping?** `automation_rules` has 4 rows and `email_sync_log` 50 — is any of that history worth migrating, or is drop-with-backup acceptable when the RED-tier cleanup runs?
4. **Operator scalpels** — `rearm_callrail_provider_event`/`resolve_provider_event` have no callers and are designed for manual service-role use. Keep them as your documented ops tools (and note that in a runbook), or fold them into the admin messaging-setup surface?
5. **Shared unread counter** — is "one unread count for the whole office" the product behavior you want for conversations, or should v2 model per-employee read state (what the dead `conversation_reads` was for, and what notifications already do)?
6. **Conversation email lane** — `conversation-email.js`, `email_reply_token`, and 8 email columns on `messages` are built but unwired. Is email-in-conversations still a future you want v2 to model, or delete?
7. **Message log / scheduled queue visibility** — DevTools is the only UI for `get_message_log`/`get_scheduled_queue`, but the DB grants let ANY logged-in employee call them. Should these be admin-only server-side (recommended), or is company-wide message visibility intended?
8. **Anonymous email-campaign access** (problem 2) — presumably unintended; confirm priority for the closure migration since it exposes recipient emails to the un-logged-in web.

## Search appendix

- **Method:** a node scanner (`scan.mjs`) walked src/, functions/, scripts/, upr-mcp/, supabase/tests/, tests/, .github/workflows (1,062 files; extensions js/jsx/mjs/cjs/sql/toml/yml/yaml) and, per object name, recorded word-boundary (`\bN\b`), quoted (`'N'`/`"N"`), rpc-call (`rpc('N'` / `/rpc/N`), and embed (`N(`/`N!inner`) matches with file:line samples; the same names were matched against all `pg_get_functiondef` bodies (399 fns, attributed per enclosing function), views.json, triggers.json, prod-cron.json, publications.json; migration provenance came from `create table` regex over supabase/migrations (257 files). Spot verifications used targeted Grep/Read on: Marketing.jsx, App.jsx routes, realtime.js, resend-webhook.js, messaging-setup.js, messaging-inbound-notifications.js, submit-esign.js, twilio-status.js, Conversations.jsx (dnd/consent writes), notify.js, apns.js import graph, ios/ (zero device-token refs — the Capacitor shell wraps the same SPA).
- **Column method:** all 406 columns scanned by word-boundary across code + fndefs. Distinctive zero-hit columns were declared dead; generic-named columns on used tables were only classified from positive context (named select strings, RPC bodies) and otherwise left **uncertain** (14 such). Column hits are table-blind, so every non-used call was context-checked (e.g. messages.read_at was confirmed via twilio-status.js:125, not the notifications read_at hits).
- **Known residual uncertainties (stated honestly):** (a) `email_sync_log` columns — external writer, unverifiable from this repo; (b) `notification_types.audience`/`description`, `notification_role_defaults.updated_by`, `message_templates.created_by`, `messages.subject`, `conversation_participants.email`, `work_authorization_sms_consents.consent_source` — generic names, no positive evidence either way; (c) the process-scheduled trigger mechanism is an EXTERNAL cron (documented in UPR-Web-Context:3564, not in pg_cron) — live-config assumption; (d) prod-stats counters are since-last-reset and were used only as corroboration, never as sole proof; (e) `page:marketing` / `page:crm` feature-flag enablement is live config not provable from the repo — flag-gated readers were treated as reachable.
- **Cross-domain interactions noted, not classified:** contacts (dnd/opt_in_status/opt_out_at consent columns + merge_contacts), employees (recipients/actors), jobs (conversations.job_id, notifications.job_id), sign_requests (work-auth wrapper), system_events (trigger_message_events, campaign events), integration_config (worker URLs/secrets read by notify_emit/wake fns), crm_orgs (org resolution in email-campaign RPCs), sequences/crm_automations (consumers of the frozen `{ok,skipped,reason}` contract), `wake_callrail_event_recovery_worker` and `record_email_suppression` (fns operating on my tables but assigned elsewhere), storage bucket `message-attachments` (MMS media).
- **Contract-frozen band-aids honored:** the `{ok,skipped,reason}` vocabulary, `/api/send-message` shape, messages insert column-shape, `claim_scheduled_message`/`increment_conversation_unread` signatures — classification never proposes reshaping these; grant changes (problem 4) do not touch signatures.

---

## Amendment — non-app-code blind-spot sweep (2026-07-29)

Every dead claim above was re-checked against the four surfaces application-code search cannot see: (1) repo-root and `docs/` runbooks **executed** against production, (2) recent data-repair migrations that are writes rather than DDL, (3) `UPR-Web-Context.md` annotations naming external consumers this repository cannot inspect, (4) doc-designated computation contracts whose callers are unobservable because `track_functions` is off in production.

**Result: 11 reclassified, 97 survived as dead.**

### Reclassified — no longer dead

- **rpc `rearm_callrail_provider_event(p_event_id uuid, p_expect_error_code text, p_now timestamp with time zone)`** → dormant contract — doc-designated ops mechanism with a live open incident *(surface 4)*
  - docs/handoff/apply-window-and-followups-prompt.md:90-97 — 'rearm_callrail_provider_event() and resolve_provider_event() are live and proven, but only a service-role caller can invoke them — there is no button. Meanwhile 6 CALLRAIL_OUTBOUND_UNMATCHED events are stuck (created 2026-07-27 00:06-00:19Z, 6-7 attempts each, retrying and failing). The ops-health alert escalates to critical after 3 unresolved days.' Repeated as a live open item in docs/handoff/production-promotion-and-followups-prompt.md:104-107, docs/handoff/pr-525-integration-prompt.md:253-256, docs/handoff/mobile-security-remaining-applies-prompt.md:175-177 — all four prescribe building a thin worker that CALLS this RPC. production-promotion-and-followups-prompt.md:125 additionally issues a direct operator instruction about performing the operation ('Do not re-arm the two remaining failed outbound MMS. Owner confirmed 2026-07-27 they are test...'), which only makes sense if re-arming is a live operator action. This is the designated recovery mechanism for a production condition that is happening right now.
- **rpc `resolve_provider_event(p_event_id uuid, p_resolved_by uuid, p_now timestamp with time zone)`** → dormant contract — doc-designated ops mechanism with a live open incident *(surface 4)*
  - Same four handoff docs as its sibling: docs/handoff/apply-window-and-followups-prompt.md:90-97 ('live and proven', paired with the 6 stuck CALLRAIL_OUTBOUND_UNMATCHED events and the critical-after-3-days ops-health alert), docs/handoff/production-promotion-and-followups-prompt.md:104-107, docs/handoff/pr-525-integration-prompt.md:253-256, docs/handoff/mobile-security-remaining-applies-prompt.md:175-177. All name it as the Mark-resolved half of the recommended admin ops surface. Its own migration supabase/migrations/20260726240000_provider_event_resolution.sql:39 carries a 'WHY resolved_by IS NULLABLE AND UNCONSTRAINED' design rationale block — authored deliberately as an operator scalpel, not abandoned.
- **column `message_provider_events.resolved_by`** → dormant contract — written only by resolve_provider_event, which is itself a live-designated ops mechanism *(surface 4)*
  - supabase/migrations/20260726240000_provider_event_resolution.sql:56 adds the column and :86-88 defines resolve_provider_event(p_event_id, p_resolved_by, p_now) as its sole writer. Because that RPC reclassifies to dormant-contract on the four handoff docs (docs/handoff/apply-window-and-followups-prompt.md:90-97 etc.), this column is the acknowledgement field that mechanism writes. Dropping it removes the ability to record WHO acknowledged a stuck provider event — the exact gap the pending ops surface is meant to close.
- **rpc `upsert_device_token(p_employee_id uuid, p_token text, p_platform text)`** → uncertain — external consumer (installed iOS / Capgo OTA bundles predating 2026-07-28) *(surface 3)*
  - git log -S over src/ shows src/lib/pushNotifications.js called this RPC from 2026-04-16 (bd2b5a66 'feat(ios): push-notifications plumbing') until 2026-07-28 (1c490f41 'fix(ios): bind push environment and Face ID login') — ONE DAY before this map, when it was switched to upsert_my_native_device_token. capacitor.config.json sets CapacitorUpdater with autoUpdate:false / directUpdate:false and .github/workflows/capgo-deploy.yml is workflow_dispatch-only, so installed devices do NOT auto-refresh their JS bundle. docs/mobile/data-contracts.md:509 states the risk outright: 'callers must deploy and old cached/native bundles must be retired or explicitly accepted between those windows.' docs/integrations.md:303-306 (Mobile push R0 checkpoint, 2026-07-25) describes it in the present tense as the live native post-login path and an open MOB-SEC-014 boundary; docs/mobile/data-contracts.md:493 lists it among the browser-visible contracts the authored-not-applied S1h hardening PRESERVES. HEAD has no caller; devices in the field may.
- **rpc `delete_device_token(p_token text)`** → uncertain — external consumer (installed iOS / Capgo OTA bundles predating 2026-07-28) *(surface 3)*
  - Same bundle-pinning story as upsert_device_token: pushNotifications.js carried the v1 pair until 1c490f41 (2026-07-28), Capgo OTA is manual-dispatch with autoUpdate:false, and docs/mobile/data-contracts.md:509 explicitly warns that old cached/native bundles must be retired or explicitly accepted. docs/mobile/data-contracts.md:494 lists 'delete_device_token(text) | own token only; foreign ownership raises 42501' among the nine contracts authored-not-applied S1h preserves — i.e. an active initiative is hardening it, not retiring it. Note docs/notify-roadmap.md:41 already recorded 'delete has zero callers' back in the notify wave, so its dormancy is older than upsert's; the external-bundle risk still applies to logout/uninstall cleanup on old builds.
- **table `notification_queue`** → uncertain — named in an executed production runbook + swept by a live function *(surface 1)*
  - UPR-QBO-ENCIRCLE-RECONCILIATION-GUIDE.md:186 — the owner's actively-executed reconciliation runbook (§9 'The reconciliation loop (run this for every client)', §8 'Writes: use Supabase execute_sql (raw SQL)', §10 lists deletions already performed) prescribes a production delete-ordering procedure and names notification_queue as one of the NO ACTION FK children that BLOCK a job delete: 'system_events, payments, conversations, document_requests, notification_queue, sub_confirmations, vendor_invoices are NO ACTION and block a job delete.' An operator following that recipe must clear notification_queue rows for the job. Independently, the live merge_jobs function body executes 'UPDATE notification_queue SET job_id = p_keep_id WHERE job_id = p_merge_id' (fresh catalog fndefs-q3-06.sql:464) — job merges are a live production action.
- **column `notification_queue.job_id`** → uncertain — the specific column both live surfaces touch *(surface 1)*
  - This is the column the runbook procedure is about: catalog/fks.json shows notification_queue_job_id_fkey FOREIGN KEY (job_id) REFERENCES jobs(id) with no ON DELETE clause (NO ACTION), which is precisely why UPR-QBO-ENCIRCLE-RECONCILIATION-GUIDE.md:186 lists the table as a job-delete blocker. It is also the column live merge_jobs writes (catalog fndefs-q3-06.sql:464, 'UPDATE notification_queue SET job_id = p_keep_id'), and it carries a dedicated index idx_notification_queue_job (catalog/indexes.json). Read/write-reachable by production paths even though the table has 0 rows.
- **table `campaign_recipients`** → uncertain — write-reachable by the live merge_contacts function *(surface 2)*
  - supabase/migrations/20260702_crm_phase0F_merge_contacts_safety.sql:145-146 — '-- 12. campaign_recipients.contact_id (legacy SMS campaign recipients) / UPDATE campaign_recipients SET contact_id = p_keep_id WHERE contact_id = p_merge_id;' — a real DML statement inside the live merge_contacts RPC (confirmed present in the fresh live catalog at fndefs-q3-06.sql:329, so it is what production runs today, not just repo source). Contact merges are a live, owner-executed action: src/components/MergeModal.jsx drives them, and UPR-QBO-ENCIRCLE-RECONCILIATION-GUIDE.md §9 step 6 ('Dedupe / clean test data') and §10 ('A2Z Southgate merge' applied) record them being run against production. catalog/fks.json also shows campaign_recipients_contact_id_fkey → contacts(id) with NO ACTION, so the table can block a contact delete today — the reason that UPDATE exists at all.
- **column `campaign_recipients.contact_id`** → uncertain — directly UPDATEd by live merge_contacts *(surface 2)*
  - supabase/migrations/20260702_crm_phase0F_merge_contacts_safety.sql:146 / live catalog fndefs-q3-06.sql:329 — 'UPDATE campaign_recipients SET contact_id = p_keep_id WHERE contact_id = p_merge_id'. It is also FK-constrained to contacts(id) with NO ACTION (catalog/fks.json) and indexed (idx_campaign_recipients_contact, catalog/indexes.json), so it participates in live contact-delete/merge semantics regardless of row count.
- **column `conversations.email_reply_token`** → write-only — populated by a live column DEFAULT on every conversation insert *(surface 2)*
  - supabase/migrations/20260709_sms_f01_drift_capture.sql:79 captures the live column definition with a generating DEFAULT: "email_reply_token text DEFAULT (replace((gen_random_uuid())::text,'-','') || replace((gen_random_uuid())::text,'-',''))", and :87 creates the partial UNIQUE index conversations_email_reply_token_key (confirmed live in catalog/indexes.json). Conversations are inserted constantly in production (mapper: ins 38, last activity 2026-07-29), so this column receives a fresh unique value on every insert — it is write-alive, not unwritten. Nothing reads it (get_tech_conversations strips it at supabase/migrations/20260709_tech_msgs_v2_fm_conversation_rpcs.sql:140), so the honest classification is write-only, not dead.
- **column `message_send_attempts.channel_fallback_reason`** → dormant contract — reserved provenance field of an open initiative *(surface 4)*
  - docs/messaging-transport-roadmap.md:216-218 designates it as shipped attempt-level provenance: 'partial attempt-level RCS provenance: requested_channel, actual_channel, and channel_fallback_reason. It does not enable RCS and does not yet add message-level typed addresses... Those remain a later reviewed additive extension; see docs/messaging-rcs-readiness.md.' The messaging-transport initiative is OPEN in .claude/rules/initiative-status.md ('Built, activation owner-gated'), and supabase/migrations/20260723215926_messaging_transport_foundation.sql:195 attaches a COMMENT ON COLUMN explaining its reserved purpose. Reserved-by-design for a documented, owner-gated phase — not an accident.

### Kill-notes — dependencies a future DROP must carry (Phase P5)

- **omni_verify_foundation()**
  - EXECUTED by the LIVE CI db lane — exact save_estimate_lines precedent. supabase/tests/omni_messages_check_widen.test.js:42,55,63 calls db.rpc('omni_verify_foundation') for real (not a source-read); vitest.config.js:47 includes 'supabase/tests/**/*.test.js' in the db lane; .github/workflows/ci.yml:142-167 runs `npm run test:db:branch` against the seeded qa-staging branch, which .claude/rules/initiative-status.md records as SEEDED 2026-07-29, parity-verified, CI db lane LIVE. Dropping this RPC reddens CI immediately. Its removal must be paired with rewriting or deleting that test. Note the function itself INSERTs and DELETEs live conversations/messages rows and is granted to `authenticated` — the grant is a separate (and worse) problem than the deadness.
- **campaign_recipients (table)**
  - Live `merge_contacts` executes `UPDATE campaign_recipients SET contact_id = ...` (supabase/migrations/20260702_crm_phase0F_merge_contacts_safety.sql:146; confirmed in the fresh live catalog at fndefs-q3-06.sql:329). Dropping the table makes every contact merge throw at runtime (relation does not exist) — MergeModal.jsx and the owner's reconciliation merges both break. The DROP migration MUST re-CREATE OR REPLACE merge_contacts with that statement removed, in the same change. Secondary: campaign_recipients holds NO ACTION FKs onto the LIVE tables contacts(id) and messages(id) (catalog/fks.json), so it can block row deletes on both today.
- **notification_queue (table)**
  - Live `merge_jobs` executes `UPDATE notification_queue SET job_id = p_keep_id WHERE job_id = p_merge_id` (live catalog fndefs-q3-06.sql:464). Dropping the table breaks every job merge at runtime. WARNING: `merge_jobs` has NO migration source in supabase/migrations — it is an untracked live-only function, so a P5 author reading only the repo will not see this dependency; the replacement body must be captured from the live catalog first. Also: UPR-QBO-ENCIRCLE-RECONCILIATION-GUIDE.md:186 documents notification_queue as a NO ACTION job-delete blocker in an executed production procedure — that line must be corrected in the same change or the runbook becomes wrong.
- **automation_rules (table)**
  - Inbound FK from a table that is itself only conditionally droppable: `notification_queue_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES automation_rules(id)` (catalog/fks.json). automation_rules cannot be dropped until notification_queue is dropped (or that FK/column removed) — and notification_queue has its own merge_jobs blocker above. Ordering: fix merge_jobs → drop notification_queue → drop automation_rules. Also carries 3 indexes (automation_rules_pkey, idx_automation_rules_active, idx_automation_rules_trigger) and an FK to employees(id).
- **campaigns (table)**
  - Inbound FK `campaign_recipients_campaign_id_fkey → campaigns(id) ON DELETE CASCADE` — campaign_recipients must be dropped first (and it has its own merge_contacts blocker). Outbound FK `campaigns_template_id_fkey → message_templates(id)` points at a LIVE table, so campaigns rows can block message_templates row deletes today (0 rows, so inert in practice). Note the reachable reader src/pages/Marketing.jsx:17 does `db.select('campaigns', ...)`: dropping the table turns that flag-gated page from an empty state into a hard 404/500 unless the page is removed in the same change.
- **upsert_device_token / delete_device_token**
  - Hash-pinned by an authored-not-applied migration and by tests. supabase/migrations/20260727022920_mobile_personal_ownership_boundary.sql:224-245 embeds both signatures with exact source md5s and ACL arrays in a preflight registry; supabase/tests/mobile_personal_ownership_boundary_{preflight,isolated,post_apply}.sql and tests/qa/unit/mobile-personal-ownership-boundary.test.js assert against them. tests/qa/unit/* runs in the credential-free lane that `npm test` and CI DO run. Dropping these functions invalidates the S1h preflight (docs/mobile/data-contracts.md:479 — 'authored, not applied'), so P5 must either land after S1h is resolved or retire S1h's device-token clauses explicitly.
- **rearm_callrail_provider_event / resolve_provider_event / message_provider_events.resolved_by**
  - tests/qa/unit/rearm-callrail-event.test.js and tests/qa/unit/provider-event-resolution.test.js run in the credential-free CI lane. Verified mechanism: both use readFileSync on their migration files (supabase/migrations/20260726230000_*.sql and 20260726240000_*.sql) and assert on the TEXT. So dropping the database objects alone does NOT redden CI — but DELETING OR EDITING those migration files does (both tests also guard with existsSync). P5 must update these two tests in the same change. Additionally, dropping resolved_by requires dropping the partial index added alongside it in 20260726240000_provider_event_resolution.sql.
- **message_send_attempts.channel_fallback_reason**
  - supabase/tests/messaging_transport_foundation.test.js:58 asserts `expect(activeSql).toContain('channel_fallback_reason text')`. Verified mechanism: that file is a source-contract test (readFileSync of the migration at line 9), so dropping the column does not by itself fail it — EDITING supabase/migrations/20260723215926_messaging_transport_foundation.sql does. That test runs in the LIVE CI db lane (vitest.config.js:47 + ci.yml db-lane job), so any migration-source edit must update it in the same change.
- **conversations.email_reply_token**
  - Backed by the live partial UNIQUE index conversations_email_reply_token_key (catalog/indexes.json) AND a generating column DEFAULT (supabase/migrations/20260709_sms_f01_drift_capture.sql:79) — a DROP COLUMN must account for both, and the drift-capture migration (a schema-as-code baseline) becomes untrue. The live get_tech_conversations body names the column literally as `to_jsonb(p) - 'email_reply_token'` (supabase/migrations/20260709_tech_msgs_v2_fm_conversation_rpcs.sql:140); jsonb key-subtraction is safe on a missing key so this will not break, but the RPC body becomes misleading and should be cleaned in the same change.
- **messages email-lane columns (email_message_id, in_reply_to, email_references, email_from, email_to, email_html, sender_email) + messages.rcs_content_sid**
  - Enumerated in ACTIVE LAW: .claude/rules/sms-experience-wave-ownership.md:194-195 lists them inside the F-core-FROZEN `messages` insert column-shape (§9.2), a file loaded unconditionally every session. Dropping them requires amending that manifest in the same commit or every future session reads a false contract. messages.email_message_id additionally carries the live partial UNIQUE index messages_email_message_id_key (catalog/indexes.json) which must be dropped with it. These columns are also the committed Phase-I schema of the omni-inbox initiative, which .claude/rules/initiative-status.md still lists as OPEN/unbuilt (docs/omni-inbox-dispatch.md:47-48, docs/omni-inbox-roadmap.md:104) — retire the initiative row before or with the drop.
- **the 13 dead policies**
  - No independent blocker — each drops implicitly with its table, so they need no separate DDL. One paired-artifact note: supabase/migrations/20260708_dbf_p3_anon_policy_closure.sql:60-62+ CREATEs the four anon_*_automation_rules policies, and its paired rollback in supabase/rollbacks/ re-creates them; once automation_rules is dropped that rollback is unrunnable. Mark it superseded rather than leaving a rollback that will fail if anyone reaches for it.

### Sweep coverage notes

SWEEP COVERAGE: all 6 tables, 5 RPCs, 84 columns and 13 policies re-checked against the four surfaces. Scope: 480 tracked *.md (git ls-files, which excludes the 15 stale copies under .claude/worktrees/ that pollute a naive filesystem grep — worth knowing, they gave false hits on resolved_by/email_reply_token/rcs_content_sid that do not exist in HEAD), all supabase/migrations/*.sql, supabase/tests/**, tests/qa/**, .github/workflows/**, plus the fresh catalog artifacts (fndefs-q*.sql, fks.json, indexes.json, views.json). docs/archive/ and docs/schema-v2/ excluded as history/self.

RESULT: 11 of 84+ claims moved off dead (~12%), vs billing's ~47%. That gap is real, not under-searching: this domain has no runbook-driven data-entry surface. Billing's reclassifications came from the QBO/Encircle reconciliation guide prescribing INSERTs into invoices; messaging objects appear in that guide exactly ONCE (notification_queue as an FK delete-blocker) and nowhere else in any repo-root runbook. I grepped every root *.md and docs/**/*.md for INSERT/UPDATE/DELETE/SELECT statements naming these objects: one hit total, docs/notify-roadmap.md:43, and it is prose about policies, not a prescribed write.

SURFACE-BY-SURFACE YIELD:
- Surface 1 (executed runbooks): 1 hit — UPR-QBO-ENCIRCLE-RECONCILIATION-GUIDE.md:186 (notification_queue). docs/messaging-provider-cutover-runbook.md, docs/database/staging-branch-runbook.md, docs/testing-and-deployment.md and EMAIL-DELIVERABILITY.md contain ZERO references to any object on this list — checked explicitly.
- Surface 2 (recent DML migrations): 2 hits — merge_contacts→campaign_recipients and the email_reply_token DEFAULT. No 2026-06+ data-repair migration writes any other object here. Notably the dorothy_killian repair precedent has no messaging analogue.
- Surface 3 (external consumers): 1 finding, but the most consequential one — the two v1 device-token RPCs. This is a DIFFERENT external-consumer shape than billing's Netlify vendor app: not a partner system, but the app's own installed native binaries. Because Capgo OTA is autoUpdate:false + workflow_dispatch-only, HEAD is NOT proof of what devices call. Any future sweep of a mobile-touching domain should apply this same test. UPR-Web-Context.md carries no 'also used by <external app>' annotation for any object on this list (the one such annotation in this domain, email_sync_log:709 'vendor invoice app', is on a table the mapper already classified USED).
- Surface 4 (doc-designated mechanisms): 3 findings — the two provider-event scalpels (strongest evidence in the whole sweep: four separate live handoff docs, a named live incident with timestamps, and a direct operator instruction) and channel_fallback_reason.

TWO THINGS THE SYNTHESIZER SHOULD NOT OVER-READ:
1. I deliberately did NOT reclassify the messages email-lane columns, message_templates.{rcs_content_sid,fallback_body,usage_count}, or conversations.{twilio_group_sid,job_phase_context} despite each having a roadmap that specifies them (omni-inbox Phase I, docs/messaging-rcs-readiness.md). Surface 4 requires a business process that DEMONSTRABLY STILL HAPPENS; email-into-conversations and RCS demonstrably do not (docs/messaging-rcs-readiness.md:25 — 'repository design only; RCS disabled and unconfigured'). Calling those dormant contracts would be inventing a surface. They stay dead — but they carry real paired-artifact obligations, captured in kill_notes.
2. Test-mechanism correction to the mapper: three of the tests it cited as evidence are readFileSync source-contract tests, not executions — messaging_transport_foundation.test.js, rearm-callrail-event.test.js, provider-event-resolution.test.js. Dropping those OBJECTS does not redden CI; editing or deleting their MIGRATION FILES does. Only omni_messages_check_widen.test.js actually executes its RPC against the database. Getting this distinction wrong in P5 either creates phantom blockers or misses the one real one.

P5 ORDERING CONSTRAINT (derived from catalog/fks.json): automation_rules ← notification_queue.rule_id, and campaigns ← campaign_recipients.campaign_id. Combined with the two merge-function blockers, the only safe drop order for the dead cluster is: (a) repair merge_contacts + merge_jobs first — capturing merge_jobs' body from the LIVE catalog, since it has no migration source — then (b) campaign_recipients, notification_queue, (c) campaigns, automation_rules, (d) conversation_reads, conversation_tags (both cascade-only, genuinely free). Also: catalog/views.json contains ZERO references to any object on this list, so unlike billing's rv_payments/rv_invoices situation, no view rebuild is required here."
