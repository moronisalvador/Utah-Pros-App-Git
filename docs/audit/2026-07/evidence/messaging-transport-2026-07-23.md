<!--
FILE: docs/audit/2026-07/evidence/messaging-transport-2026-07-23.md
PURPOSE: Sanitized read-only live evidence used to draft the messaging transport foundation.
LAST VERIFIED: 2026-07-23

This is dated evidence, not current project law. It records no secrets, phone numbers, message
content, employee identities, or writable operations.
-->

# Messaging transport live evidence — 2026-07-23

## Scope and safety

The connected Supabase project was queried read-only on 2026-07-23. No migration, DDL, DML,
provider configuration, or message send was performed. The repository worktree is separate from
the shared database; this capture does not authorize applying its draft migration.

## Catalog queries

The capture inspected:

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'messages'
order by ordinal_position;

select policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'messages'
order by policyname;

select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'messages'
order by grantee, privilege_type;

select indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename = 'messages'
order by indexname;
```

Role/capability evidence was captured from `nav_permissions`, `employee_page_access`, and
`feature_flags` without retaining employee-level rows. Repository callers were separately searched
with `rg` for writes to `messages` and reads of the two inbox clients.

## Sanitized results

- `messages` had the legacy `twilio_sid` identity and did not have `provider`,
  `provider_message_id`, `provider_conversation_id`, `client_request_id`, `sender_address`, or
  `recipient_address`.
- `twilio_sid` had a unique index.
- Live policies included anonymous read/write and broad authenticated access; live table grants
  likewise allowed anonymous insert/select and authenticated mutation.
- Repository caller tracing found SMS/MMS row writes in service-role Workers. The two inbox clients
  send through `POST /api/send-message`; no intended browser write to SMS rows was found.
- `conversations` permission was enabled for the active internal staff roles represented by admin,
  office, project manager, supervisor, and field technician. CRM partner was not granted that nav
  capability. Employee overrides and the `page:conversations` force-disable flag remain part of
  the precedence model.

## Decisions supported

- Close browser writes to `messages` while retaining capability-gated authenticated reads.
- Keep provider facts additive and secondary to UPR conversation/contact identity.
- Make attempt and event ledgers service-only with explicit grants and RLS.
- Implement the database capability predicate as active, non-external employee plus the same
  force-disable, employee-override, admin, and role-permission precedence used by the Worker.

## Apply-window recapture

Immediately before any owner-approved apply, recapture:

- `messages` row count, duplicate candidates for both proposed unique indexes, and active lock waits;
- exact columns, indexes, constraints, policies, grants, triggers, and publication membership;
- every migration dependency: `messages`, `conversations`, `contacts`,
  `conversation_participants`, `employees`, `employee_page_access`, `feature_flags`,
  `nav_permissions`, and `sms_consent_log`, including the columns referenced by the backfill,
  capability predicate, consent projection, and foreign keys;
- availability of `gen_random_uuid()`, plus existing FK target types and delete behavior;
- uncovered foreign keys for the two new ledgers and `sms_consent_log.provider_event_id`; the
  migration must provide a leading-column index for each new FK unless an existing unique/index
  already covers it;
- representative authenticated employee, external employee, nonemployee, anonymous, and
  service-role behavior; and
- migration-ledger/provenance state from the reviewed release commit.

Also verify zero duplicate `(provider, provider_message_id)` and `client_request_id` candidates
after applying the proposed Twilio backfill expression in a read-only query. Abort on missing
dependencies, incompatible types, duplicates, unexpected grants/policies, or active lock waits;
never wait through production traffic if the migration's lock timeout is reached.

The dependency-column check is intentionally explicit so a renamed or missing prerequisite aborts
before DDL begins:

```sql
with required(table_name, column_name) as (
  values
    ('messages', 'id'), ('messages', 'conversation_id'), ('messages', 'type'),
    ('messages', 'channel'), ('messages', 'body'), ('messages', 'status'),
    ('messages', 'twilio_sid'), ('messages', 'sender_phone'),
    ('messages', 'sender_contact_id'), ('messages', 'media_urls'),
    ('messages', 'direction'), ('messages', 'created_at'),
    ('messages', 'error_code'), ('messages', 'error_message'),
    ('conversations', 'id'), ('conversations', 'type'), ('conversations', 'title'),
    ('conversations', 'status'), ('conversations', 'status_changed_at'),
    ('conversations', 'created_at'), ('conversations', 'updated_at'),
    ('conversations', 'unread_count'), ('conversations', 'last_message_at'),
    ('conversations', 'last_message_preview'),
    ('contacts', 'id'), ('contacts', 'phone'), ('contacts', 'name'),
    ('contacts', 'opt_in_status'), ('contacts', 'opt_in_source'),
    ('contacts', 'opt_in_at'), ('contacts', 'opt_out_at'),
    ('contacts', 'opt_out_reason'), ('contacts', 'dnd'), ('contacts', 'dnd_at'),
    ('contacts', 'created_at'), ('contacts', 'updated_at'),
    ('conversation_participants', 'conversation_id'),
    ('conversation_participants', 'contact_id'),
    ('conversation_participants', 'phone'), ('conversation_participants', 'role'),
    ('conversation_participants', 'is_active'),
    ('employees', 'id'), ('employees', 'auth_user_id'), ('employees', 'role'),
    ('employees', 'is_active'), ('employees', 'is_external'),
    ('employee_page_access', 'employee_id'), ('employee_page_access', 'nav_key'),
    ('employee_page_access', 'can_view'),
    ('feature_flags', 'key'), ('feature_flags', 'force_disabled'),
    ('nav_permissions', 'role'), ('nav_permissions', 'nav_key'),
    ('nav_permissions', 'can_view'),
    ('sms_consent_log', 'contact_id'), ('sms_consent_log', 'phone'),
    ('sms_consent_log', 'event_type'), ('sms_consent_log', 'source'),
    ('sms_consent_log', 'details')
)
select r.table_name, r.column_name
from required r
left join information_schema.columns c
  on c.table_schema = 'public'
 and c.table_name = r.table_name
 and c.column_name = r.column_name
where c.column_name is null
order by r.table_name, r.column_name;
```

The query must return zero rows. Separately verify
`to_regprocedure('gen_random_uuid()') is not null`.
