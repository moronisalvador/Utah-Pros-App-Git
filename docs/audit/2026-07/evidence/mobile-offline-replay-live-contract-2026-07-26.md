<!--
FILE: docs/audit/2026-07/evidence/mobile-offline-replay-live-contract-2026-07-26.md

WHAT THIS DOES (plain language):
  Records a value-free live catalog check that evaluated three possible idempotent operations.
  Current production source admits and replays none of them.

DEPENDS ON:
  Internal: offlineDb replay policy; room, moisture-reading, and equipment dispatchers
  Data:     reads → PostgreSQL function and index catalog metadata only
            writes → documentation only

NOTES / GOTCHAS:
  - No business row, employee, job, claim, customer, credential, token, or provider value was read.
  - This evidence proves stable-operation-id deduplication only. It does not authorize replay or
    prove caller authorization inside the existing SECURITY DEFINER functions.
  - No migration, database write, deployment, provider, signing, or device action occurred.
-->

# Mobile offline replay — live server-contract evidence

**Captured:** 2026-07-27 05:53 UTC (2026-07-26 America/Denver)
**Project:** `glsmljpabrwonfiltiqm`
**PostgreSQL:** `17.6`
**Capture mode:** read-only catalog SQL

## 2026-07-27 release decision

The initial production PWA/Capacitor source sets `PRODUCTION_QUEUE_TYPES` to an exact empty list and
has no production enqueue/retry or dispatcher path. The catalog evidence below is retained for a
future design; it does not enable automatic admission or replay. Historical local rows remain
payload-free quarantine/explicit-cleanup data and are never sent.

This narrower decision avoids claiming an atomic cross-tab/localStorage/IndexedDB/server lease that
the current platform cannot prove. It also keeps the separate `SECURITY DEFINER` authorization gap
below from becoming an offline replay capability.

## Catalog finding (not enabled)

The current live catalog supports a narrow stable-operation-ID claim for `room.create`,
`reading.insert`, and `equipment.place`, using the original UUID operation ID:

| RPC | Live signature | Definition MD5 | Stable-ID behavior |
|---|---|---|---|
| `create_room` | `create_room(uuid,text,numeric,numeric,integer,uuid,uuid)` | `4bab0b0851fbe425ce0b2f2c6df18a9a` | `p_client_id uuid`; `ON CONFLICT (client_id) DO UPDATE` |
| `insert_reading` | `insert_reading(uuid,uuid,material_type,text,numeric,numeric,numeric,numeric,numeric,boolean,uuid,uuid,text,uuid,timestamp with time zone)` | `d474d4175f1ca1bb0ef8b9cf08f89b44` | `p_client_id uuid`; `ON CONFLICT (client_id) DO UPDATE` |
| `place_equipment` | `place_equipment(uuid,uuid,equipment_type,text,text,uuid,uuid,text)` | `44f126362d3e2d8b2deb8f44e77d6d47` | `p_client_id uuid`; `ON CONFLICT (client_id) DO UPDATE` |

The corresponding live `rooms`, `moisture_readings`, and `equipment_placements` tables each have
a `uuid` `client_id` column backed by a single-column unique index.

Photo metadata insertion, field-note insertion, task toggling, and equipment removal have no
equivalent stable operation-ID contract. The initial release goes further: none of these operations
or the three catalog-inspected operations is admitted to an automatic queue.

## Separate authorization finding

All three inspected functions are currently `SECURITY DEFINER`, pin `search_path`, and are
executable by `authenticated` and `service_role` (not `anon` or `PUBLIC`). Their live bodies do not
resolve `auth.uid()` or validate employee/job authorization internally before writing.

That is an existing database authorization boundary, not evidence against the deduplication
behavior above. It remains a separate database source/apply decision and is not changed or applied
by this mobile source session.

## Value-free catalog queries

The capture selected only:

- exact function identities, `prosecdef`, ACL text, definition MD5, and
  `pg_get_functiondef(...)`;
- whether each definition references `p_client_id` and contains the client-ID conflict clause;
- the `client_id` column type and unique-index definition for the three target tables; and
- server version and capture timestamp.

No application table rows or configuration values were selected.
