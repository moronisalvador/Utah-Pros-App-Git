-- ════════════════════════════════════════════════
-- MIGRATION: 20260725160000_inbound_leads_answered
-- Phase: Missed-call textback — authoritative answered signal
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Adds a plain true/false/unknown "answered" field to each logged call, so
--   the rest of the app can ask "was this call actually picked up?" and get a
--   straight answer instead of guessing.
--
--   Until now the missed-call text-back guessed from how long the call lasted.
--   A call with no duration recorded yet looked identical to a call nobody
--   answered, so someone we had just spoken to could be texted "sorry we missed
--   your call". Guessing wrong here means texting a real person the wrong thing.
--
--   The phone provider already tells us plainly whether the call was answered.
--   This exposes that as its own field. Anything we cannot confirm stays
--   "unknown" (NULL) — and unknown must never be treated as missed.
--
-- ADDITIVE-ONLY:
--   One new generated column on inbound_leads. No column is dropped, renamed or
--   retyped; no policy, grant or existing function body changes; no data is
--   edited.
--
-- APPLY WINDOW (database-standard.md §5):
--   Adding a STORED generated column REWRITES the table under an ACCESS
--   EXCLUSIVE lock. Measured live 2026-07-25 before authoring: 147 rows,
--   1128 kB total relation size, 2 inserts in the preceding 24h — so the
--   rewrite is milliseconds. Size is not the only consideration: inbound_leads
--   takes continuous concurrent writes from the live CallRail voice, text and
--   form webhooks, and any webhook write attempted mid-rewrite BLOCKS until the
--   lock releases. Apply during a low-traffic window anyway; do not apply
--   alongside another strong-lock migration on this table.
--
-- WHY GENERATED RATHER THAN STAMPED AT INGEST:
--   docs/crm-lead-lifecycle.md §8 names "a first-class answered column stamped
--   by the ingest adapter" as the Twilio-era target. A generated column is the
--   same seam for every READER (the worker never touches CallRail's payload
--   shape again — that is the coupling §8 wants gone) while being strictly
--   safer today: CallRail delivers a call in several webhooks, and the first
--   one has no 'answered' key at all. A generated column re-derives itself when
--   a later delivery updates raw_payload; a stamped column silently keeps the
--   first, wrong value unless every writer remembers to re-stamp.
--   Converting to a stamped column later is a contained follow-up: drop the
--   generation expression, keep the column and every reader unchanged.
--
--   String-compared, never a throwing cast — matching the missed-call
--   auto-stage precedent. A malformed value yields unknown, not an exception
--   that would break ingest. (crm_call_is_answered() by contrast does
--   (raw_payload->>'answered')::boolean, which throws on a malformed value.)
--
--   The match set is DELIBERATELY the literal CallRail shape ('true'/'false',
--   case-insensitive) and not the auto-stage migration's defensive superset
--   ('false','f','0'). CallRail always sends the literal strings, and here an
--   unrecognized value must resolve to unknown rather than be coerced toward
--   "unanswered" — a wrong `false` sends a real person a wrong text, whereas a
--   wrong NULL only stays silent. Narrow is the safe direction for this column.
--
-- DELIBERATELY NOT CHANGED:
--   crm_call_is_answered() and its JS twin isCountableLead() still read
--   raw_payload. They are the countable-lead / reporting definition and are
--   documented as twins ("change both or neither"); repointing them here would
--   silently move reported lead counts. This column is consumed ONLY by the
--   missed-call text-back trigger.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   ALTER TABLE public.inbound_leads DROP COLUMN IF EXISTS answered;
--   (Deploy a run-automations.js that does not read `answered` first, or the
--   automation simply sees undefined and — by design — never fires.)
--   Full script: supabase/rollbacks/20260725160000_inbound_leads_answered.rollback.sql
-- ════════════════════════════════════════════════

ALTER TABLE public.inbound_leads
  ADD COLUMN IF NOT EXISTS answered boolean
  GENERATED ALWAYS AS (
    CASE
      WHEN raw_payload ? 'answered' AND lower(raw_payload->>'answered') = 'true'  THEN true
      WHEN raw_payload ? 'answered' AND lower(raw_payload->>'answered') = 'false' THEN false
      ELSE NULL
    END
  ) STORED;

COMMENT ON COLUMN public.inbound_leads.answered IS
  'Provider-agnostic call outcome: true = answered, false = confirmed unanswered, NULL = unknown. Derived from raw_payload.answered by string compare (never a cast). Unknown must never be treated as missed. Consumed by the missed-call text-back trigger; countable-lead reporting still uses crm_call_is_answered().';
