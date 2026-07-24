# Database Schema Overview (generated)

> **Generated file — regenerate, don't edit.** Produced by `scripts/db-docs-gen.mjs` from a
> read-only live-schema snapshot (`scripts/db-docs-gen.sql`). This is a drift-verification aid,
> never a second source of truth — the real schema reference is `UPR-Web-Context.md`. If this
> file and `UPR-Web-Context.md` disagree, that disagreement is exactly what this file exists to
> surface; fix the doc, then regenerate. Never hand-edit this file — your edits will be silently
> overwritten the next time someone regenerates it.

Snapshot: 135 public tables. Source: live catalog (read-only introspection). Captured: 2026-07-24T04:04:20.854338.

## Tables

| Table | Columns | RLS enabled | Policies | Has `anon` policy |
|---|---|---|---|---|
| account_deletion_requests | 7 | yes | 3 | no |
| ad_spend | 12 | yes | 1 | no |
| appointment_crew | 5 | yes | 4 | no |
| appointment_dependencies | 7 | yes | 4 | no |
| appointment_status_history | 14 | yes | 1 | no |
| appointments | 22 | yes | 4 | ⚠️ yes |
| automation_rules | 16 | yes | 5 | no |
| automation_settings | 9 | yes | 1 | ⚠️ yes |
| billing_2fa_codes | 7 | yes | 0 | no |
| campaign_recipients | 8 | yes | 1 | no |
| campaigns | 19 | yes | 2 | no |
| checklist_templates | 10 | yes | 1 | no |
| claim_status_history | 5 | yes | 1 | no |
| claims | 23 | yes | 7 | ⚠️ yes |
| contact_addresses | 11 | yes | 4 | no |
| contact_jobs | 7 | yes | 4 | no |
| contact_tags | 3 | yes | 1 | no |
| contacts | 41 | yes | 7 | ⚠️ yes |
| conversation_participants | 9 | yes | 3 | ⚠️ yes |
| conversation_reads | 3 | yes | 1 | no |
| conversation_tags | 3 | yes | 1 | no |
| conversations | 17 | yes | 4 | ⚠️ yes |
| crm_automation_runs | 13 | yes | 1 | ⚠️ yes |
| crm_automations | 11 | yes | 1 | ⚠️ yes |
| crm_build_phases | 5 | yes | 1 | no |
| crm_build_stages | 5 | yes | 1 | no |
| crm_import_batches | 13 | yes | 1 | no |
| crm_orgs | 4 | yes | 1 | no |
| crm_segments | 8 | yes | 1 | no |
| crm_sequence_enrollments | 12 | yes | 1 | no |
| crm_sequence_steps | 11 | yes | 1 | no |
| crm_sequences | 10 | yes | 1 | no |
| crm_tasks | 14 | yes | 1 | no |
| crm_tracking_numbers | 6 | yes | 1 | no |
| dashboard_layouts | 3 | yes | 0 | no |
| demo_sheet_schemas | 10 | yes | 1 | no |
| device_tokens | 6 | yes | 1 | no |
| dispatch_board_jobs | 4 | yes | 3 | no |
| document_requests | 8 | yes | 1 | no |
| document_templates | 8 | yes | 2 | no |
| email_campaign_exclusions | 4 | yes | 1 | ⚠️ yes |
| email_campaign_recipients | 9 | yes | 1 | ⚠️ yes |
| email_campaigns | 17 | yes | 1 | ⚠️ yes |
| email_inbound_events | 3 | yes | 1 | no |
| email_suppressions | 7 | yes | 1 | ⚠️ yes |
| email_sync_log | 7 | yes | 1 | no |
| employee_page_access | 6 | yes | 2 | ⚠️ yes |
| employees | 21 | yes | 2 | ⚠️ yes |
| equipment_placements | 14 | yes | 1 | no |
| escalation_log | 9 | yes | 1 | no |
| estimate_line_items | 14 | yes | 1 | no |
| estimates | 33 | yes | 1 | no |
| feature_flags | 9 | yes | 2 | ⚠️ yes |
| form_definition_versions | 9 | yes | 1 | no |
| form_definitions | 11 | yes | 1 | no |
| form_submissions | 13 | yes | 1 | no |
| forms | 18 | yes | 1 | no |
| google_calendar_links | 14 | yes | 0 | no |
| homebuilding_build_projects | 7 | yes | 0 | no |
| homebuilding_chat_messages | 5 | yes | 0 | no |
| homebuilding_chats | 4 | yes | 0 | no |
| homebuilding_estimates | 6 | yes | 0 | no |
| inbound_leads | 30 | yes | 1 | no |
| insurance_carriers | 7 | yes | 2 | no |
| integration_config | 3 | yes | 0 | no |
| integration_credentials | 11 | yes | 0 | no |
| invoice_adjustments | 12 | yes | 1 | no |
| invoice_line_items | 22 | yes | 1 | no |
| invoice_status_history | 5 | yes | 1 | no |
| invoices | 51 | yes | 2 | no |
| job_assignments | 13 | yes | 1 | no |
| job_checklists | 12 | yes | 1 | no |
| job_costs | 16 | yes | 1 | no |
| job_documents | 16 | yes | 8 | no |
| job_equipment | 12 | yes | 1 | no |
| job_notes | 12 | yes | 5 | no |
| job_number_sequences | 3 | yes | 3 | no |
| job_phase_history | 7 | yes | 3 | ⚠️ yes |
| job_phases | 10 | yes | 2 | no |
| job_real_flag_history | 10 | yes | 1 | no |
| job_schedule_phases | 10 | yes | 4 | no |
| job_schedules | 10 | yes | 4 | no |
| job_supplements | 6 | yes | 1 | no |
| job_tasks | 19 | yes | 4 | no |
| job_time_entries | 31 | yes | 1 | no |
| jobs | 81 | yes | 4 | ⚠️ yes |
| lead_attribution | 12 | yes | 1 | no |
| lead_pipeline_stage | 7 | yes | 1 | no |
| lead_score_factors | 8 | yes | 1 | no |
| lead_stage_history | 9 | yes | 1 | no |
| message_notification_outbox | 17 | yes | 0 | no |
| message_provider_events | 35 | yes | 0 | no |
| message_send_attempts | 31 | yes | 0 | no |
| message_templates | 13 | yes | 2 | no |
| messages | 34 | yes | 1 | no |
| moisture_readings | 22 | yes | 1 | no |
| nav_permissions | 5 | yes | 2 | ⚠️ yes |
| notification_employee_overrides | 7 | yes | 1 | no |
| notification_prefs | 6 | yes | 1 | no |
| notification_queue | 18 | yes | 3 | no |
| notification_role_defaults | 8 | yes | 1 | no |
| notification_types | 11 | yes | 1 | no |
| notifications | 13 | yes | 2 | no |
| on_call_schedule | 4 | yes | 1 | no |
| oop_quotes | 29 | yes | 2 | no |
| payments | 26 | yes | 5 | no |
| pipeline_stages | 11 | yes | 1 | no |
| property_meld_melds | 29 | yes | 1 | no |
| push_subscriptions | 8 | yes | 0 | no |
| qbo_events | 7 | yes | 0 | no |
| referral_sources | 6 | yes | 2 | no |
| rooms | 12 | yes | 1 | no |
| schedule_blocks | 13 | yes | 2 | no |
| schedule_templates | 8 | yes | 4 | no |
| scheduled_messages | 12 | yes | 3 | no |
| selection_dispatches | 15 | yes | 1 | no |
| selection_responses | 10 | yes | 1 | no |
| service_sms_consent_attestations | 12 | yes | 2 | no |
| service_sms_consents | 12 | yes | 1 | no |
| sign_requests | 25 | yes | 4 | no |
| sms_consent_log | 10 | yes | 3 | no |
| stripe_events | 7 | yes | 0 | no |
| sub_confirmations | 10 | yes | 1 | no |
| system_events | 8 | yes | 0 | no |
| tech_feedback | 13 | yes | 1 | no |
| template_dependencies | 7 | yes | 4 | no |
| template_phases | 15 | yes | 4 | no |
| template_tasks | 7 | yes | 4 | no |
| time_entry_change_requests | 10 | yes | 1 | no |
| time_entry_deletions | 6 | yes | 1 | no |
| upr_mcp_audit | 8 | yes | 0 | no |
| user_google_accounts | 8 | yes | 0 | no |
| vendor_invoices | 15 | yes | 1 | no |
| vendors | 7 | yes | 1 | no |
| worker_runs | 9 | yes | 3 | no |

## Tables granting `anon` a policy (review against `database-standard.md` §2 allowlist)

- appointments
- automation_settings
- claims
- contacts
- conversation_participants
- conversations
- crm_automation_runs
- crm_automations
- email_campaign_exclusions
- email_campaign_recipients
- email_campaigns
- email_suppressions
- employee_page_access
- employees
- feature_flags
- job_phase_history
- jobs
- nav_permissions
