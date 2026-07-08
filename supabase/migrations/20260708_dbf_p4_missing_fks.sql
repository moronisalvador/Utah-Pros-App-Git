-- ═════════════════════════════════════════════════════════════════════════════
-- 20260708_dbf_p4_missing_fks.sql
-- DB-Foundation Phase P4 — data integrity: missing foreign keys  [item ④]
--   docs/db-foundation-roadmap.md → Phase P4 block · docs/db-foundation-p4-orphan-report.md §4
--
-- WHAT THIS DOES (plain language):
--   `notifications` rows can point at a job, but that link was never enforced by
--   the database — a notification could reference a job id that does not exist.
--   Its sibling table `notification_queue` already enforces the same link. This
--   adds the missing foreign key so every notification's job reference is real.
--   It is added in the fast, non-blocking way: create the constraint NOT VALID
--   (checks only NEW/edited rows, takes a brief lock), then VALIDATE it (scans the
--   existing rows once without blocking writes). There are ZERO orphan rows today,
--   so the VALIDATE passes immediately.
--
--   The schema is otherwise densely FK-covered; this is the only genuine missing
--   relational FK. Polymorphic entity_id columns, external-system ids, and the
--   time_entry_deletions audit log (which points at already-deleted rows by
--   design) are intentionally left without an FK — see the report §4.
--
-- CONTESTED-TABLE DISCLOSURE (ownership manifest §8): this FK lives ON `notifications`
--   (uncontested) and only REFERENCES `jobs` — it does not alter `jobs`'s own schema.
--   `jobs` is on the Schedule-Desktop deferred-hardening list, but that wave is
--   UNSTARTED (no open PR) and a referencing FK cannot collide with its writes; noted
--   for parity with the RED migration's disclosure.
--
-- APPLY-WINDOW (database-standard.md §5): YELLOW / additive. Serialize vs any P3
--   apply window (both strong-lock hot tables). Applied 2026-07-08 in a discrete
--   window; P3 not yet applied live.
--
-- ROLLBACK:
--   ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_job_id_fkey;
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_job_id_fkey
  FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE SET NULL
  NOT VALID;

ALTER TABLE public.notifications
  VALIDATE CONSTRAINT notifications_job_id_fkey;
