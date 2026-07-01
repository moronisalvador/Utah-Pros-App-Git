# Scope Sheet rollback runbook (≈60 seconds)

Linked from `CLAUDE.md`. If the Scope Sheet (`TechDemoSheet.jsx` + `demo_sheet_schemas`) starts
misbehaving in production, revert on whichever layer is at fault — they're independent.

Context: there is a **single shared Supabase project for both `dev` and `main`**. Publishing a new
`demo_sheet_schemas` version hits both staging and production frontends immediately, so schema
changes must be sequenced: seed as **DRAFT** (`is_active = false`) → merge + deploy the code that
understands it → only then call the activating RPC (e.g. `publish_demo_schema`).

1. **Schema revert (data — instant, no deploy).** Every published schema version is kept as an
   immutable row in `demo_sheet_schemas`; the previous one is retained with `is_active = false`.
   Reactivate it via the RPC:
   ```sql
   -- v1 — initial port (pre-Scope-Sheet baseline)
   SELECT publish_demo_schema('6b14aefb-4591-47ee-b00f-e12ddb8f956a');
   ```
   New sheets immediately use v1; already-saved sheets keep their own `schema_id` snapshot. The
   current code renders v1 gracefully via the hardcoded-sketch fallback (TechDemoSheet
   `schemaHasJobSections` check), so this is safe even with the new code live. Re-publish the
   newer version to roll forward again.
2. **Code revert (app — needs a deploy).** Revert the offending `dev → main` merge and let
   Cloudflare redeploy: `git revert -m 1 <merge-commit-sha>` on a branch → `dev` → `dev → main` PR.
   (Find the SHA in the PR or `git log origin/main`.)
3. **Shared DB caveat:** a schema revert affects `dev` AND `main` at once (one Supabase project).
4. **Going forward:** make schema changes as **new versions** via the builder ("+ New"), not
   in-place edits — that keeps each change individually revertable by re-publishing the prior row.
