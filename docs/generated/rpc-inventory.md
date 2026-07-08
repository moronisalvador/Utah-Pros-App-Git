# RPC Inventory (generated)

> **Generated file — regenerate, don't edit.** Produced by `scripts/db-docs-gen.mjs` from a
> read-only live-schema snapshot (`scripts/db-docs-gen.sql`). This is a drift-verification aid,
> never a second source of truth — the real schema reference is `UPR-Web-Context.md`. If this
> file and `UPR-Web-Context.md` disagree, that disagreement is exactly what this file exists to
> surface; fix the doc, then regenerate. Never hand-edit this file — your edits will be silently
> overwritten the next time someone regenerates it.

Snapshot: 337 public functions. Source: live catalog (read-only introspection).

## Functions

| Function | `SECURITY DEFINER` | `anon` EXECUTE | `authenticated` EXECUTE |
|---|---|---|---|
| add_adhoc_job_task | yes | ⚠️ yes | yes |
| add_custom_schedule_phase | yes | ⚠️ yes | yes |
| add_homebuilding_chat_message | yes | ⚠️ yes | yes |
| add_related_job | yes | ⚠️ yes | yes |
| admin_clock_out_entry | yes | ⚠️ yes | yes |
| admin_upsert_time_entry | yes | ⚠️ yes | yes |
| apply_midnight_clock_split | yes | no | no |
| apply_schedule_plan | yes | ⚠️ yes | yes |
| approve_time_entries | yes | ⚠️ yes | yes |
| assign_tasks_to_appointment | yes | ⚠️ yes | yes |
| bust_postgrest_cache | yes | ⚠️ yes | yes |
| calc_time_entry_cost | no | ⚠️ yes | yes |
| capture_claim_status_history | yes | no | yes |
| capture_invoice_status_history | yes | no | yes |
| claim_inbound_email | yes | ⚠️ yes | yes |
| claim_qbo_event | yes | ⚠️ yes | yes |
| claim_stripe_event | yes | ⚠️ yes | yes |
| clock_appointment_action | yes | ⚠️ yes | yes |
| clock_finish_entry | yes | ⚠️ yes | yes |
| clock_omw_precheck | yes | ⚠️ yes | yes |
| close_open_clocks_on_appt_delete | yes | ⚠️ yes | yes |
| complete_sign_request | yes | ⚠️ yes | yes |
| convert_estimate_to_invoice | yes | ⚠️ yes | yes |
| create_draft_invoice_for_job | yes | ⚠️ yes | yes |
| create_estimate_for_contact | yes | ⚠️ yes | yes |
| create_estimate_for_job | yes | ⚠️ yes | yes |
| create_homebuilding_chat | yes | ⚠️ yes | yes |
| create_invoice_for_job | yes | ⚠️ yes | yes |
| create_job_with_contact | yes | ⚠️ yes | yes |
| create_manual_lead | yes | ⚠️ yes | yes |
| create_notification | yes | ⚠️ yes | yes |
| create_room | yes | ⚠️ yes | yes |
| create_room_for_claim | yes | ⚠️ yes | yes |
| create_sign_request | yes | ⚠️ yes | yes |
| crm_channel_for_source | yes | ⚠️ yes | yes |
| crm_fixed_automation_conflict | yes | ⚠️ yes | yes |
| dash_division_bucket | no | ⚠️ yes | yes |
| delete_appointment | yes | ⚠️ yes | yes |
| delete_contact_address | yes | ⚠️ yes | yes |
| delete_crm_automation | yes | ⚠️ yes | yes |
| delete_crm_task | yes | ⚠️ yes | yes |
| delete_demo_schema | yes | ⚠️ yes | yes |
| delete_device_token | yes | ⚠️ yes | yes |
| delete_email_campaign | yes | ⚠️ yes | yes |
| delete_employee_notification_override | yes | ⚠️ yes | yes |
| delete_employee_page_access | yes | ⚠️ yes | yes |
| delete_feature_flag | yes | ⚠️ yes | yes |
| delete_homebuilding_build_project | yes | ⚠️ yes | yes |
| delete_homebuilding_chat | yes | ⚠️ yes | yes |
| delete_homebuilding_estimate | yes | ⚠️ yes | yes |
| delete_insurance_carrier | yes | ⚠️ yes | yes |
| delete_oop_quote | yes | ⚠️ yes | yes |
| delete_pipeline_stage | yes | ⚠️ yes | yes |
| delete_push_subscription | yes | ⚠️ yes | yes |
| delete_reading | yes | ⚠️ yes | yes |
| delete_referral_source | yes | ⚠️ yes | yes |
| delete_room | yes | ⚠️ yes | yes |
| delete_segment | yes | ⚠️ yes | yes |
| delete_sequence | yes | ⚠️ yes | yes |
| delete_time_entry | yes | ⚠️ yes | yes |
| demo_sheet_schemas_touch_updated_at | no | ⚠️ yes | yes |
| disconnect_integration | yes | ⚠️ yes | yes |
| duplicate_homebuilding_build_project | yes | ⚠️ yes | yes |
| email_unsubscribe | yes | ⚠️ yes | yes |
| enforce_private_appointment_role | no | ⚠️ yes | yes |
| enqueue_automation_run | yes | ⚠️ yes | yes |
| enroll_in_sequence | yes | ⚠️ yes | yes |
| exec_read_sql | yes | ⚠️ yes | yes |
| finish_appointment | yes | ⚠️ yes | yes |
| generate_claim_number | no | ⚠️ yes | yes |
| generate_estimate_number | yes | ⚠️ yes | yes |
| generate_invoice_number | yes | ⚠️ yes | yes |
| generate_job_number | no | ⚠️ yes | yes |
| generate_oop_quote_number | yes | ⚠️ yes | yes |
| get_active_appointment_geo | yes | ⚠️ yes | yes |
| get_active_demo_schema | yes | ⚠️ yes | yes |
| get_active_drying_jobs | yes | ⚠️ yes | yes |
| get_active_techs | yes | ⚠️ yes | yes |
| get_ad_spend | yes | ⚠️ yes | yes |
| get_all_employees | yes | ⚠️ yes | yes |
| get_all_permissions | yes | ⚠️ yes | yes |
| get_appointment_detail | yes | ⚠️ yes | yes |
| get_appointment_tasks | yes | ⚠️ yes | yes |
| get_appointments_range | yes | ⚠️ yes | yes |
| get_ar_invoices | yes | ⚠️ yes | yes |
| get_ar_jobs | yes | ⚠️ yes | yes |
| get_assigned_tasks | yes | ⚠️ yes | yes |
| get_attribution_by_campaign | yes | ⚠️ yes | yes |
| get_attribution_rollup | yes | ⚠️ yes | yes |
| get_automation_runs | yes | ⚠️ yes | yes |
| get_automation_settings | yes | ⚠️ yes | yes |
| get_avg_ticket | yes | ⚠️ yes | yes |
| get_billing_settings | yes | ⚠️ yes | yes |
| get_call_volume | yes | ⚠️ yes | yes |
| get_campaign_exclusions | yes | ⚠️ yes | yes |
| get_claim_activity | yes | ⚠️ yes | yes |
| get_claim_appointments | yes | ⚠️ yes | yes |
| get_claim_demo_sheets | yes | ⚠️ yes | yes |
| get_claim_detail | yes | ⚠️ yes | yes |
| get_claim_jobs | yes | ⚠️ yes | yes |
| get_claim_rooms | yes | ⚠️ yes | yes |
| get_claims_list | yes | ⚠️ yes | yes |
| get_commissions | yes | ⚠️ yes | yes |
| get_contact_activity | yes | ⚠️ yes | yes |
| get_contact_addresses | yes | ⚠️ yes | yes |
| get_contact_consent | yes | ⚠️ yes | yes |
| get_contact_ltv | yes | ⚠️ yes | yes |
| get_conversion_trend | yes | ⚠️ yes | yes |
| get_crm_automations | yes | ⚠️ yes | yes |
| get_crm_build_progress | yes | ⚠️ yes | yes |
| get_crm_contacts | yes | ⚠️ yes | yes |
| get_crm_revenue_by_division | yes | ⚠️ yes | yes |
| get_crm_tasks | yes | ⚠️ yes | yes |
| get_customer_detail | yes | ⚠️ yes | yes |
| get_customers_list | yes | ⚠️ yes | yes |
| get_dashboard_action_items | yes | ⚠️ yes | yes |
| get_dashboard_layout | yes | ⚠️ yes | yes |
| get_dashboard_stats | yes | no | yes |
| get_demo_schema | yes | ⚠️ yes | yes |
| get_demo_sheet | yes | ⚠️ yes | yes |
| get_demo_sheet_drafts | yes | ⚠️ yes | yes |
| get_dispatch_board | yes | ⚠️ yes | yes |
| get_dispatch_events | yes | ⚠️ yes | yes |
| get_dispatch_panel_jobs | yes | ⚠️ yes | yes |
| get_document_templates | yes | ⚠️ yes | yes |
| get_duplicate_contacts | yes | ⚠️ yes | yes |
| get_effective_notification_prefs | yes | ⚠️ yes | yes |
| get_email_campaigns | yes | ⚠️ yes | yes |
| get_employee_commissions | yes | ⚠️ yes | yes |
| get_employee_notification_overrides | yes | ⚠️ yes | yes |
| get_employee_page_access | yes | ⚠️ yes | yes |
| get_estimate_aging | yes | ⚠️ yes | yes |
| get_estimates | yes | ⚠️ yes | yes |
| get_estimator_leaderboard | yes | ⚠️ yes | yes |
| get_feature_flags | yes | ⚠️ yes | yes |
| get_forms | yes | ⚠️ yes | yes |
| get_google_calendar_status | yes | ⚠️ yes | yes |
| get_google_drive_status | yes | ⚠️ yes | yes |
| get_homebuilding_build_project | yes | ⚠️ yes | yes |
| get_homebuilding_chat_messages | yes | ⚠️ yes | yes |
| get_inbound_leads | yes | ⚠️ yes | yes |
| get_insurance_carriers | yes | ⚠️ yes | yes |
| get_integration_status | yes | ⚠️ yes | yes |
| get_job_contacts | yes | ⚠️ yes | yes |
| get_job_demo_sheets | yes | ⚠️ yes | yes |
| get_job_equipment | yes | ⚠️ yes | yes |
| get_job_financials | yes | ⚠️ yes | yes |
| get_job_hub | yes | ⚠️ yes | yes |
| get_job_labor_summary | yes | ⚠️ yes | yes |
| get_job_readings | yes | ⚠️ yes | yes |
| get_job_rooms | yes | ⚠️ yes | yes |
| get_job_schedule | yes | ⚠️ yes | yes |
| get_job_schedules | yes | ⚠️ yes | yes |
| get_job_task_pool | yes | ⚠️ yes | yes |
| get_job_task_summary | yes | ⚠️ yes | yes |
| get_jobs_closed | yes | ⚠️ yes | yes |
| get_jobs_completed | yes | ⚠️ yes | yes |
| get_managed_credentials_status | yes | no | yes |
| get_message_log | yes | ⚠️ yes | yes |
| get_my_appointments_today | yes | ⚠️ yes | yes |
| get_my_notification_prefs | yes | ⚠️ yes | yes |
| get_my_push_subscriptions | yes | ⚠️ yes | yes |
| get_notification_defaults | yes | ⚠️ yes | yes |
| get_notifications | yes | ⚠️ yes | yes |
| get_oop_quote | yes | ⚠️ yes | yes |
| get_oop_quotes | yes | ⚠️ yes | yes |
| get_open_estimates_summary | yes | ⚠️ yes | yes |
| get_orphan_contacts | yes | ⚠️ yes | yes |
| get_overdue_tasks | yes | ⚠️ yes | yes |
| get_payments_ledger | yes | ⚠️ yes | yes |
| get_payments_received | yes | ⚠️ yes | yes |
| get_payroll_summary | yes | ⚠️ yes | yes |
| get_pipeline_movement | yes | ⚠️ yes | yes |
| get_pipeline_stages | yes | ⚠️ yes | yes |
| get_pipeline_summary | yes | ⚠️ yes | yes |
| get_property_meld_melds | yes | ⚠️ yes | yes |
| get_purgeable_feedback_media | yes | ⚠️ yes | yes |
| get_qbo_connection_status | yes | ⚠️ yes | yes |
| get_qbo_sync_stats | yes | ⚠️ yes | yes |
| get_real_claims_created | yes | ⚠️ yes | yes |
| get_referral_sources | yes | ⚠️ yes | yes |
| get_revenue_by_division | yes | ⚠️ yes | yes |
| get_schedule_template | yes | ⚠️ yes | yes |
| get_schedule_templates | yes | ⚠️ yes | yes |
| get_scheduled_queue | yes | ⚠️ yes | yes |
| get_segments | yes | ⚠️ yes | yes |
| get_sequences | yes | ⚠️ yes | yes |
| get_sign_document_templates | yes | ⚠️ yes | yes |
| get_sign_request_by_token | yes | ⚠️ yes | yes |
| get_speed_to_lead | yes | ⚠️ yes | yes |
| get_stalled_materials | yes | ⚠️ yes | yes |
| get_stalled_materials_for_employee | yes | ⚠️ yes | yes |
| get_table_stats | yes | ⚠️ yes | yes |
| get_tasks_for_appointment | yes | ⚠️ yes | yes |
| get_tech_claims | yes | ⚠️ yes | yes |
| get_tech_dashboard | yes | ⚠️ yes | yes |
| get_tech_feedback | yes | ⚠️ yes | yes |
| get_tech_status_board | yes | ⚠️ yes | yes |
| get_timesheet_entries | yes | ⚠️ yes | yes |
| get_timesheet_entries_admin | yes | ⚠️ yes | yes |
| get_tracking_numbers | yes | ⚠️ yes | yes |
| get_unassigned_tasks | yes | ⚠️ yes | yes |
| get_unread_notification_count | yes | ⚠️ yes | yes |
| get_upr_mcp_audit | yes | ⚠️ yes | yes |
| get_water_loss_report_data | yes | ⚠️ yes | yes |
| get_worker_runs | yes | ⚠️ yes | yes |
| global_search | yes | ⚠️ yes | yes |
| import_contacts | yes | ⚠️ yes | yes |
| insert_job_document | yes | ⚠️ yes | yes |
| insert_reading | yes | ⚠️ yes | yes |
| insert_tech_feedback | yes | ⚠️ yes | yes |
| is_crm_partner | yes | ⚠️ yes | yes |
| is_time_admin | yes | ⚠️ yes | yes |
| link_contact_to_job | yes | ⚠️ yes | yes |
| list_demo_schemas | yes | ⚠️ yes | yes |
| list_homebuilding_build_projects | yes | ⚠️ yes | yes |
| list_homebuilding_chats | yes | ⚠️ yes | yes |
| list_homebuilding_estimates | yes | ⚠️ yes | yes |
| log_phase_change | no | ⚠️ yes | yes |
| log_system_event | yes | ⚠️ yes | yes |
| mark_all_notifications_read | yes | ⚠️ yes | yes |
| mark_feedback_attachments_purged | yes | ⚠️ yes | yes |
| mark_job_real | yes | ⚠️ yes | yes |
| mark_notification_read | yes | ⚠️ yes | yes |
| merge_claims | yes | ⚠️ yes | yes |
| merge_contacts | yes | ⚠️ yes | yes |
| merge_jobs | yes | ⚠️ yes | yes |
| move_lead_to_stage | yes | ⚠️ yes | yes |
| move_photo_to_room | yes | ⚠️ yes | yes |
| mt_date | no | no | yes |
| mt_today | no | no | yes |
| notify_emit | yes | ⚠️ yes | yes |
| notify_google_calendar_sync | yes | ⚠️ yes | yes |
| notify_qbo_customer_sync | yes | ⚠️ yes | yes |
| omni_verify_foundation | yes | ⚠️ yes | yes |
| p9_assert_admin | yes | ⚠️ yes | yes |
| place_equipment | yes | ⚠️ yes | yes |
| preview_email_audience | yes | ⚠️ yes | yes |
| preview_schedule | yes | ⚠️ yes | yes |
| promote_lead_to_contact | yes | ⚠️ yes | yes |
| publish_demo_schema | yes | ⚠️ yes | yes |
| queue_email_campaign | yes | ⚠️ yes | yes |
| recompute_estimate_from_lines | yes | ⚠️ yes | yes |
| recompute_invoice_from_lines | yes | ⚠️ yes | yes |
| record_email_campaign_send | yes | ⚠️ yes | yes |
| record_email_open | yes | ⚠️ yes | yes |
| record_email_suppression | yes | no | no |
| remove_equipment | yes | ⚠️ yes | yes |
| rename_homebuilding_build_project | yes | ⚠️ yes | yes |
| rename_homebuilding_chat | yes | ⚠️ yes | yes |
| rename_homebuilding_estimate | yes | ⚠️ yes | yes |
| review_time_entry_change_request | yes | ⚠️ yes | yes |
| save_dashboard_layout | yes | ⚠️ yes | yes |
| save_demo_sheet | yes | ⚠️ yes | yes |
| save_homebuilding_build_project | yes | ⚠️ yes | yes |
| save_homebuilding_estimate | yes | ⚠️ yes | yes |
| scan_abandoned_clocks | yes | no | no |
| score_lead | yes | ⚠️ yes | yes |
| search_contacts_for_job | yes | ⚠️ yes | yes |
| set_automation_enabled | yes | ⚠️ yes | yes |
| set_automation_setting | yes | ⚠️ yes | yes |
| set_billing_setting | yes | no | yes |
| set_campaign_exclusions | yes | ⚠️ yes | yes |
| set_contact_lifecycle | yes | ⚠️ yes | yes |
| set_contact_owner | yes | ⚠️ yes | yes |
| set_crm_phase_status | yes | ⚠️ yes | yes |
| set_crm_stage_status | yes | ⚠️ yes | yes |
| set_employee_notification_override | yes | ⚠️ yes | yes |
| set_integration_secret | yes | ⚠️ yes | yes |
| set_job_real_job | yes | ⚠️ yes | yes |
| set_lead_caller_name | yes | ⚠️ yes | yes |
| set_lead_details | yes | ⚠️ yes | yes |
| set_lead_transcription | yes | ⚠️ yes | yes |
| set_my_notification_pref | yes | ⚠️ yes | yes |
| set_notification_default | yes | ⚠️ yes | yes |
| set_task_status | yes | ⚠️ yes | yes |
| set_tracking_number_label | yes | ⚠️ yes | yes |
| set_twilio_config | yes | ⚠️ yes | yes |
| submit_time_entry_change_request | yes | ⚠️ yes | yes |
| sync_job_invoiced_from_invoices | yes | ⚠️ yes | yes |
| sync_job_to_claim | yes | ⚠️ yes | yes |
| tech_hours_bucket | yes | ⚠️ yes | yes |
| toggle_appointment_task | yes | ⚠️ yes | yes |
| toggle_job_task | yes | ⚠️ yes | yes |
| trg_appt_calendar_sync | yes | ⚠️ yes | yes |
| trg_appt_crew_calendar_sync | yes | ⚠️ yes | yes |
| trg_appt_crew_notify | yes | ⚠️ yes | yes |
| trg_appt_notify | yes | ⚠️ yes | yes |
| trg_estimate_accepted_notify | yes | ⚠️ yes | yes |
| trg_estimate_real_job | yes | ⚠️ yes | yes |
| trg_invoice_real_job | yes | ⚠️ yes | yes |
| trg_signreq_real_job | yes | ⚠️ yes | yes |
| trg_sync_job_invoiced | yes | ⚠️ yes | yes |
| trigger_auto_job_number | no | ⚠️ yes | yes |
| trigger_claim_events | no | ⚠️ yes | yes |
| trigger_document_events | yes | ⚠️ yes | yes |
| trigger_job_events | no | ⚠️ yes | yes |
| trigger_message_events | yes | ⚠️ yes | yes |
| trigger_note_events | no | ⚠️ yes | yes |
| update_appointment | yes | ⚠️ yes | yes |
| update_appointments_updated_at | no | ⚠️ yes | yes |
| update_contact_addresses_updated_at | no | ⚠️ yes | yes |
| update_employees_updated_at | no | ⚠️ yes | yes |
| update_invoice_paid | no | ⚠️ yes | yes |
| update_job_tasks_updated_at | no | ⚠️ yes | yes |
| update_lead_status | yes | ⚠️ yes | yes |
| update_reading | yes | ⚠️ yes | yes |
| update_room | yes | ⚠️ yes | yes |
| update_sign_requests_updated_at | no | ⚠️ yes | yes |
| update_tech_feedback | yes | ⚠️ yes | yes |
| update_updated_at | no | ⚠️ yes | yes |
| upsert_ad_spend | yes | ⚠️ yes | yes |
| upsert_appointment_task | yes | ⚠️ yes | yes |
| upsert_contact_address | yes | ⚠️ yes | yes |
| upsert_crm_automation | yes | ⚠️ yes | yes |
| upsert_crm_task | yes | ⚠️ yes | yes |
| upsert_demo_schema | yes | ⚠️ yes | yes |
| upsert_device_token | yes | ⚠️ yes | yes |
| upsert_document_template | yes | ⚠️ yes | yes |
| upsert_email_campaign | yes | ⚠️ yes | yes |
| upsert_employee_commission | yes | ⚠️ yes | yes |
| upsert_employee_page_access | yes | ⚠️ yes | yes |
| upsert_feature_flag | yes | ⚠️ yes | yes |
| upsert_form | yes | ⚠️ yes | yes |
| upsert_insurance_carrier | yes | ⚠️ yes | yes |
| upsert_lead_attribution | yes | ⚠️ yes | yes |
| upsert_lead_from_callrail | yes | ⚠️ yes | yes |
| upsert_lead_from_form | yes | ⚠️ yes | yes |
| upsert_oop_quote | yes | ⚠️ yes | yes |
| upsert_permission | yes | ⚠️ yes | yes |
| upsert_pipeline_stage | yes | ⚠️ yes | yes |
| upsert_property_meld_meld | yes | ⚠️ yes | yes |
| upsert_push_subscription | yes | ⚠️ yes | yes |
| upsert_referral_source | yes | ⚠️ yes | yes |
| upsert_segment | yes | ⚠️ yes | yes |
| upsert_sequence | yes | ⚠️ yes | yes |
| upsert_time_entry | yes | ⚠️ yes | yes |

## Functions granting `anon` EXECUTE (review against `database-standard.md` §2 allowlist)

- add_adhoc_job_task
- add_custom_schedule_phase
- add_homebuilding_chat_message
- add_related_job
- admin_clock_out_entry
- admin_upsert_time_entry
- apply_schedule_plan
- approve_time_entries
- assign_tasks_to_appointment
- bust_postgrest_cache
- calc_time_entry_cost
- claim_inbound_email
- claim_qbo_event
- claim_stripe_event
- clock_appointment_action
- clock_finish_entry
- clock_omw_precheck
- close_open_clocks_on_appt_delete
- complete_sign_request
- convert_estimate_to_invoice
- create_draft_invoice_for_job
- create_estimate_for_contact
- create_estimate_for_job
- create_homebuilding_chat
- create_invoice_for_job
- create_job_with_contact
- create_manual_lead
- create_notification
- create_room
- create_room_for_claim
- create_sign_request
- crm_channel_for_source
- crm_fixed_automation_conflict
- dash_division_bucket
- delete_appointment
- delete_contact_address
- delete_crm_automation
- delete_crm_task
- delete_demo_schema
- delete_device_token
- delete_email_campaign
- delete_employee_notification_override
- delete_employee_page_access
- delete_feature_flag
- delete_homebuilding_build_project
- delete_homebuilding_chat
- delete_homebuilding_estimate
- delete_insurance_carrier
- delete_oop_quote
- delete_pipeline_stage
- delete_push_subscription
- delete_reading
- delete_referral_source
- delete_room
- delete_segment
- delete_sequence
- delete_time_entry
- demo_sheet_schemas_touch_updated_at
- disconnect_integration
- duplicate_homebuilding_build_project
- email_unsubscribe
- enforce_private_appointment_role
- enqueue_automation_run
- enroll_in_sequence
- exec_read_sql
- finish_appointment
- generate_claim_number
- generate_estimate_number
- generate_invoice_number
- generate_job_number
- generate_oop_quote_number
- get_active_appointment_geo
- get_active_demo_schema
- get_active_drying_jobs
- get_active_techs
- get_ad_spend
- get_all_employees
- get_all_permissions
- get_appointment_detail
- get_appointment_tasks
- get_appointments_range
- get_ar_invoices
- get_ar_jobs
- get_assigned_tasks
- get_attribution_by_campaign
- get_attribution_rollup
- get_automation_runs
- get_automation_settings
- get_avg_ticket
- get_billing_settings
- get_call_volume
- get_campaign_exclusions
- get_claim_activity
- get_claim_appointments
- get_claim_demo_sheets
- get_claim_detail
- get_claim_jobs
- get_claim_rooms
- get_claims_list
- get_commissions
- get_contact_activity
- get_contact_addresses
- get_contact_consent
- get_contact_ltv
- get_conversion_trend
- get_crm_automations
- get_crm_build_progress
- get_crm_contacts
- get_crm_revenue_by_division
- get_crm_tasks
- get_customer_detail
- get_customers_list
- get_dashboard_action_items
- get_dashboard_layout
- get_demo_schema
- get_demo_sheet
- get_demo_sheet_drafts
- get_dispatch_board
- get_dispatch_events
- get_dispatch_panel_jobs
- get_document_templates
- get_duplicate_contacts
- get_effective_notification_prefs
- get_email_campaigns
- get_employee_commissions
- get_employee_notification_overrides
- get_employee_page_access
- get_estimate_aging
- get_estimates
- get_estimator_leaderboard
- get_feature_flags
- get_forms
- get_google_calendar_status
- get_google_drive_status
- get_homebuilding_build_project
- get_homebuilding_chat_messages
- get_inbound_leads
- get_insurance_carriers
- get_integration_status
- get_job_contacts
- get_job_demo_sheets
- get_job_equipment
- get_job_financials
- get_job_hub
- get_job_labor_summary
- get_job_readings
- get_job_rooms
- get_job_schedule
- get_job_schedules
- get_job_task_pool
- get_job_task_summary
- get_jobs_closed
- get_jobs_completed
- get_message_log
- get_my_appointments_today
- get_my_notification_prefs
- get_my_push_subscriptions
- get_notification_defaults
- get_notifications
- get_oop_quote
- get_oop_quotes
- get_open_estimates_summary
- get_orphan_contacts
- get_overdue_tasks
- get_payments_ledger
- get_payments_received
- get_payroll_summary
- get_pipeline_movement
- get_pipeline_stages
- get_pipeline_summary
- get_property_meld_melds
- get_purgeable_feedback_media
- get_qbo_connection_status
- get_qbo_sync_stats
- get_real_claims_created
- get_referral_sources
- get_revenue_by_division
- get_schedule_template
- get_schedule_templates
- get_scheduled_queue
- get_segments
- get_sequences
- get_sign_document_templates
- get_sign_request_by_token
- get_speed_to_lead
- get_stalled_materials
- get_stalled_materials_for_employee
- get_table_stats
- get_tasks_for_appointment
- get_tech_claims
- get_tech_dashboard
- get_tech_feedback
- get_tech_status_board
- get_timesheet_entries
- get_timesheet_entries_admin
- get_tracking_numbers
- get_unassigned_tasks
- get_unread_notification_count
- get_upr_mcp_audit
- get_water_loss_report_data
- get_worker_runs
- global_search
- import_contacts
- insert_job_document
- insert_reading
- insert_tech_feedback
- is_crm_partner
- is_time_admin
- link_contact_to_job
- list_demo_schemas
- list_homebuilding_build_projects
- list_homebuilding_chats
- list_homebuilding_estimates
- log_phase_change
- log_system_event
- mark_all_notifications_read
- mark_feedback_attachments_purged
- mark_job_real
- mark_notification_read
- merge_claims
- merge_contacts
- merge_jobs
- move_lead_to_stage
- move_photo_to_room
- notify_emit
- notify_google_calendar_sync
- notify_qbo_customer_sync
- omni_verify_foundation
- p9_assert_admin
- place_equipment
- preview_email_audience
- preview_schedule
- promote_lead_to_contact
- publish_demo_schema
- queue_email_campaign
- recompute_estimate_from_lines
- recompute_invoice_from_lines
- record_email_campaign_send
- record_email_open
- remove_equipment
- rename_homebuilding_build_project
- rename_homebuilding_chat
- rename_homebuilding_estimate
- review_time_entry_change_request
- save_dashboard_layout
- save_demo_sheet
- save_homebuilding_build_project
- save_homebuilding_estimate
- score_lead
- search_contacts_for_job
- set_automation_enabled
- set_automation_setting
- set_campaign_exclusions
- set_contact_lifecycle
- set_contact_owner
- set_crm_phase_status
- set_crm_stage_status
- set_employee_notification_override
- set_integration_secret
- set_job_real_job
- set_lead_caller_name
- set_lead_details
- set_lead_transcription
- set_my_notification_pref
- set_notification_default
- set_task_status
- set_tracking_number_label
- set_twilio_config
- submit_time_entry_change_request
- sync_job_invoiced_from_invoices
- sync_job_to_claim
- tech_hours_bucket
- toggle_appointment_task
- toggle_job_task
- trg_appt_calendar_sync
- trg_appt_crew_calendar_sync
- trg_appt_crew_notify
- trg_appt_notify
- trg_estimate_accepted_notify
- trg_estimate_real_job
- trg_invoice_real_job
- trg_signreq_real_job
- trg_sync_job_invoiced
- trigger_auto_job_number
- trigger_claim_events
- trigger_document_events
- trigger_job_events
- trigger_message_events
- trigger_note_events
- update_appointment
- update_appointments_updated_at
- update_contact_addresses_updated_at
- update_employees_updated_at
- update_invoice_paid
- update_job_tasks_updated_at
- update_lead_status
- update_reading
- update_room
- update_sign_requests_updated_at
- update_tech_feedback
- update_updated_at
- upsert_ad_spend
- upsert_appointment_task
- upsert_contact_address
- upsert_crm_automation
- upsert_crm_task
- upsert_demo_schema
- upsert_device_token
- upsert_document_template
- upsert_email_campaign
- upsert_employee_commission
- upsert_employee_page_access
- upsert_feature_flag
- upsert_form
- upsert_insurance_carrier
- upsert_lead_attribution
- upsert_lead_from_callrail
- upsert_lead_from_form
- upsert_oop_quote
- upsert_permission
- upsert_pipeline_stage
- upsert_property_meld_meld
- upsert_push_subscription
- upsert_referral_source
- upsert_segment
- upsert_sequence
- upsert_time_entry
