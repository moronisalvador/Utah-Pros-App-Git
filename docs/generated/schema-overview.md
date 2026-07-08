# Database Schema Overview (generated)

> **Generated file — regenerate, don't edit.** Produced by `scripts/db-docs-gen.mjs` from a
> read-only live-schema snapshot (`scripts/db-docs-gen.sql`). This is a drift-verification aid,
> never a second source of truth — the real schema reference is `UPR-Web-Context.md`. If this
> file and `UPR-Web-Context.md` disagree, that disagreement is exactly what this file exists to
> surface; fix the doc, then regenerate. Never hand-edit this file — your edits will be silently
> overwritten the next time someone regenerates it.

Snapshot: 127 public tables. Source: live catalog (read-only introspection).

## Tables

| Table | Columns | RLS enabled | Policies | Has `anon` policy |
|---|---|---|---|---|
| ad_spend | 12 | yes | 1 | ⚠️ yes |
| appointment_crew | 5 | yes | 4 | ⚠️ yes |
| appointment_dependencies | 7 | yes | 4 | ⚠️ yes |
| appointments | 22 | yes | 4 | ⚠️ yes |
| automation_rules | 16 | yes | 5 | ⚠️ yes |
| automation_settings | 9 | yes | 1 | ⚠️ yes |
| billing_2fa_codes | 7 | yes | 0 | no |
| campaign_recipients | 8 | yes | 1 | no |
| campaigns | 19 | yes | 2 | ⚠️ yes |
| checklist_templates | 10 | yes | 1 | no |
| claim_status_history | 5 | yes | 1 | no |
| claims | 22 | yes | 7 | ⚠️ yes |
| contact_addresses | 11 | yes | 4 | ⚠️ yes |
| contact_jobs | 7 | yes | 4 | ⚠️ yes |
| contact_tags | 3 | yes | 1 | no |
| contacts | 41 | yes | 7 | ⚠️ yes |
| conversation_participants | 9 | yes | 3 | ⚠️ yes |
| conversation_reads | 3 | yes | 1 | no |
| conversation_tags | 3 | yes | 1 | no |
| conversations | 17 | yes | 4 | ⚠️ yes |
| crm_automation_runs | 13 | yes | 1 | ⚠️ yes |
| crm_automations | 11 | yes | 1 | ⚠️ yes |
| crm_build_phases | 5 | yes | 1 | ⚠️ yes |
| crm_build_stages | 5 | yes | 1 | ⚠️ yes |
| crm_import_batches | 13 | yes | 1 | ⚠️ yes |
| crm_orgs | 4 | yes | 1 | ⚠️ yes |
| crm_segments | 8 | yes | 1 | ⚠️ yes |
| crm_sequence_enrollments | 12 | yes | 1 | ⚠️ yes |
| crm_sequence_steps | 11 | yes | 1 | ⚠️ yes |
| crm_sequences | 10 | yes | 1 | ⚠️ yes |
| crm_tasks | 14 | yes | 1 | ⚠️ yes |
| crm_tracking_numbers | 6 | yes | 1 | ⚠️ yes |
| dashboard_layouts | 3 | yes | 0 | no |
| demo_sheet_schemas | 10 | yes | 1 | ⚠️ yes |
| device_tokens | 6 | yes | 1 | ⚠️ yes |
| dispatch_board_jobs | 4 | yes | 3 | ⚠️ yes |
| document_requests | 8 | yes | 1 | no |
| document_templates | 8 | yes | 2 | ⚠️ yes |
| email_campaign_exclusions | 4 | yes | 1 | ⚠️ yes |
| email_campaign_recipients | 9 | yes | 1 | ⚠️ yes |
| email_campaigns | 17 | yes | 1 | ⚠️ yes |
| email_inbound_events | 3 | yes | 1 | no |
| email_suppressions | 7 | yes | 1 | ⚠️ yes |
| email_sync_log | 7 | yes | 1 | no |
| employee_page_access | 6 | yes | 2 | ⚠️ yes |
| employees | 21 | yes | 2 | ⚠️ yes |
| equipment_placements | 14 | yes | 1 | ⚠️ yes |
| escalation_log | 9 | yes | 1 | no |
| estimate_line_items | 14 | yes | 1 | no |
| estimates | 33 | yes | 1 | no |
| feature_flags | 9 | yes | 2 | ⚠️ yes |
| form_definition_versions | 9 | yes | 1 | ⚠️ yes |
| form_definitions | 11 | yes | 1 | ⚠️ yes |
| form_submissions | 13 | yes | 1 | ⚠️ yes |
| forms | 18 | yes | 1 | no |
| google_calendar_links | 14 | yes | 0 | no |
| homebuilding_build_projects | 7 | yes | 0 | no |
| homebuilding_chat_messages | 5 | yes | 0 | no |
| homebuilding_chats | 4 | yes | 0 | no |
| homebuilding_estimates | 6 | yes | 0 | no |
| inbound_leads | 29 | yes | 1 | ⚠️ yes |
| insurance_carriers | 7 | yes | 2 | ⚠️ yes |
| integration_config | 3 | yes | 0 | no |
| integration_credentials | 11 | yes | 0 | no |
| invoice_adjustments | 12 | yes | 1 | no |
| invoice_line_items | 22 | yes | 1 | no |
| invoice_status_history | 5 | yes | 1 | no |
| invoices | 51 | yes | 2 | ⚠️ yes |
| job_assignments | 13 | yes | 1 | no |
| job_checklists | 12 | yes | 1 | no |
| job_costs | 16 | yes | 1 | no |
| job_documents | 16 | yes | 8 | ⚠️ yes |
| job_equipment | 12 | yes | 1 | no |
| job_notes | 12 | yes | 5 | ⚠️ yes |
| job_number_sequences | 3 | yes | 3 | ⚠️ yes |
| job_phase_history | 7 | yes | 3 | ⚠️ yes |
| job_phases | 10 | yes | 2 | ⚠️ yes |
| job_schedule_phases | 10 | yes | 4 | ⚠️ yes |
| job_schedules | 10 | yes | 4 | ⚠️ yes |
| job_supplements | 6 | yes | 1 | ⚠️ yes |
| job_tasks | 19 | yes | 4 | ⚠️ yes |
| job_time_entries | 31 | yes | 1 | ⚠️ yes |
| jobs | 78 | yes | 4 | ⚠️ yes |
| lead_attribution | 12 | yes | 1 | ⚠️ yes |
| lead_pipeline_stage | 7 | yes | 1 | ⚠️ yes |
| lead_score_factors | 8 | yes | 1 | ⚠️ yes |
| lead_stage_history | 9 | yes | 1 | ⚠️ yes |
| message_templates | 13 | yes | 2 | ⚠️ yes |
| messages | 26 | yes | 3 | ⚠️ yes |
| moisture_readings | 22 | yes | 1 | ⚠️ yes |
| nav_permissions | 5 | yes | 2 | ⚠️ yes |
| notification_employee_overrides | 7 | yes | 1 | ⚠️ yes |
| notification_prefs | 6 | yes | 1 | ⚠️ yes |
| notification_queue | 18 | yes | 3 | ⚠️ yes |
| notification_role_defaults | 8 | yes | 1 | ⚠️ yes |
| notification_types | 11 | yes | 1 | ⚠️ yes |
| notifications | 13 | yes | 2 | ⚠️ yes |
| on_call_schedule | 4 | yes | 1 | no |
| oop_quotes | 29 | yes | 2 | no |
| payments | 26 | yes | 5 | ⚠️ yes |
| pipeline_stages | 10 | yes | 1 | ⚠️ yes |
| property_meld_melds | 29 | yes | 1 | ⚠️ yes |
| push_subscriptions | 8 | yes | 0 | no |
| qbo_events | 7 | yes | 0 | no |
| referral_sources | 6 | yes | 2 | ⚠️ yes |
| rooms | 12 | yes | 1 | ⚠️ yes |
| schedule_blocks | 13 | yes | 2 | ⚠️ yes |
| schedule_templates | 8 | yes | 4 | ⚠️ yes |
| scheduled_messages | 11 | yes | 3 | ⚠️ yes |
| selection_dispatches | 15 | yes | 1 | no |
| selection_responses | 10 | yes | 1 | no |
| sign_requests | 25 | yes | 4 | ⚠️ yes |
| sms_consent_log | 9 | yes | 3 | ⚠️ yes |
| stripe_events | 7 | yes | 0 | no |
| sub_confirmations | 10 | yes | 1 | no |
| system_events | 8 | yes | 0 | no |
| tech_feedback | 13 | yes | 1 | ⚠️ yes |
| template_dependencies | 7 | yes | 4 | ⚠️ yes |
| template_phases | 15 | yes | 4 | ⚠️ yes |
| template_tasks | 7 | yes | 4 | ⚠️ yes |
| time_entry_change_requests | 10 | yes | 1 | ⚠️ yes |
| time_entry_deletions | 6 | yes | 1 | ⚠️ yes |
| upr_mcp_audit | 8 | yes | 0 | no |
| user_google_accounts | 8 | yes | 0 | no |
| vendor_invoices | 15 | yes | 1 | no |
| vendors | 7 | yes | 1 | no |
| worker_runs | 7 | yes | 3 | ⚠️ yes |

## Tables granting `anon` a policy (review against `database-standard.md` §2 allowlist)

- ad_spend
- appointment_crew
- appointment_dependencies
- appointments
- automation_rules
- automation_settings
- campaigns
- claims
- contact_addresses
- contact_jobs
- contacts
- conversation_participants
- conversations
- crm_automation_runs
- crm_automations
- crm_build_phases
- crm_build_stages
- crm_import_batches
- crm_orgs
- crm_segments
- crm_sequence_enrollments
- crm_sequence_steps
- crm_sequences
- crm_tasks
- crm_tracking_numbers
- demo_sheet_schemas
- device_tokens
- dispatch_board_jobs
- document_templates
- email_campaign_exclusions
- email_campaign_recipients
- email_campaigns
- email_suppressions
- employee_page_access
- employees
- equipment_placements
- feature_flags
- form_definition_versions
- form_definitions
- form_submissions
- inbound_leads
- insurance_carriers
- invoices
- job_documents
- job_notes
- job_number_sequences
- job_phase_history
- job_phases
- job_schedule_phases
- job_schedules
- job_supplements
- job_tasks
- job_time_entries
- jobs
- lead_attribution
- lead_pipeline_stage
- lead_score_factors
- lead_stage_history
- message_templates
- messages
- moisture_readings
- nav_permissions
- notification_employee_overrides
- notification_prefs
- notification_queue
- notification_role_defaults
- notification_types
- notifications
- payments
- pipeline_stages
- property_meld_melds
- referral_sources
- rooms
- schedule_blocks
- schedule_templates
- scheduled_messages
- sign_requests
- sms_consent_log
- tech_feedback
- template_dependencies
- template_phases
- template_tasks
- time_entry_change_requests
- time_entry_deletions
- worker_runs
