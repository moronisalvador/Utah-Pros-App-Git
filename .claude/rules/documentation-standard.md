# Documentation Standard

Linked from `CLAUDE.md` rule 14. When asked to document a file, apply this format exactly and
identically across every file. Consistency is the priority — the labels below are used as search
anchors by humans and AI tools, so do not reword them.

## File header (top of every file)

```
/**
 * ════════════════════════════════════════════════
 * FILE: [filename]
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   [2-4 sentences, zero jargon. Explain it as if the reader has never
 *    written code. What is this file, and what does it do?]
 *
 * WHERE IT LIVES:
 *   Route:        [URL route if a routed page, else "n/a"]
 *   Rendered by:  [best-effort: the file that renders this, if obvious,
 *                  else "n/a" — do not guess]
 *
 * DEPENDS ON:
 *   Packages:  [npm packages imported]
 *   Internal:  [other project files imported]
 *   Data:      reads  → [Supabase tables this READS from]
 *              writes → [Supabase tables this WRITES to]
 *
 * NOTES / GOTCHAS:
 *   - [non-obvious behavior, side effects, DB triggers, anything
 *      that would surprise someone editing this later]
 * ════════════════════════════════════════════════
 */
```

## Field rules

- **WHAT THIS DOES**: plain English only, no technical terms a non-developer
  wouldn't know.
  - Bad:  "Manages state via useState and dispatches async calls on mount."
  - Good: "Keeps track of what's on the screen and loads the job's data
           from the database when the screen opens."
- **DEPENDS ON → Data**: derive reads/writes from the actual Supabase calls
  (`.from('table').select` = read; `.insert` / `.update` / `.delete` = write).
  Never invent a table name. If unsure whether something is a read or write,
  write `UNCERTAIN — verify` rather than guessing. A wrong data-flow note is
  worse than no note.

## Non-component files

For files that are NOT React components (utility modules, API clients,
config, the Encircle reference, etc.): keep FILE, WHAT THIS DOES, DEPENDS ON,
and NOTES — they apply to everything. Drop the component-only fields (Route,
Rendered by) instead of filling them with "n/a", and adapt section names to
fit the file (e.g. `Exports`, `Config`, `API calls`).

## Section markers (inside longer files)

Divide long files into logical sections using this exact marker so each file
has a searchable outline. Keep section names consistent across files.

```
// ─── SECTION: [name] ──────────────
```

Standard section names: `State & hooks`, `Data fetching`, `Event handlers`,
`Helpers`, `Render`.

## Comment syntax (important)

Inside JSX / `return ( ... )` blocks, use `{/* ... */}` — never `//`.
A `//` comment inside JSX breaks rendering. Place `SECTION` markers above
the return statement, outside the markup.

## Inline comments

Only on non-obvious logic. Explain WHY, not what. Never comment
self-explanatory lines (no `// set loading to true`).

## Current adoption

Coverage is partial by design — this only applies to new files and files substantially edited,
not a backfill mandate. Last measured 2026-07-13: **~307/381 in `src/` (81%)**, **~62/105 in
`functions/` (59%)**. Re-measure (don't trust this number — the file that forbids trusting memory must
not itself go stale):
```
echo "src:      $(grep -rl 'FILE:' src --include=*.jsx --include=*.js | wc -l) / $(find src -name '*.jsx' -o -name '*.js' | wc -l)"
echo "functions:$(grep -rl 'FILE:' functions --include=*.js | wc -l) / $(find functions -name '*.js' | wc -l)"
```

## Standards-doc stamps (addendum — UX-Quality F-S1, 2026-07-13)

Every file in `.claude/rules/` and the design-system doc carries a **Last-verified** date; when a session
relies on or changes a standard, it bumps that stamp as part of close-out (`close-out-standard.md`). A
superseded rule is struck in place with a `superseded-by:` pointer, never silently rewritten (preserves
history).

## SQL migration header (addendum — DB-Foundation P7, 2026-07-08)

Every file in `supabase/migrations/` gets this header instead of the JS/JSX one above — it
formalizes the pattern DB-Foundation's Phase F/P1 migrations already established in practice.
This satisfies `.claude/rules/database-standard.md` §6 (rollback script required); it does not
replace that rule, it's the concrete format for meeting it.

```sql
-- ════════════════════════════════════════════════
-- MIGRATION: [filename without .sql]
-- Phase: [initiative + phase, e.g. "DB-Foundation P4", or "n/a" for a standalone migration]
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   [2-4 sentences, zero jargon — what changes, and why, as if the reader
--    has never written SQL.]
--
-- ADDITIVE-ONLY / attribute-only / etc.:
--   [One line stating the blast radius per database-standard.md §3 — e.g.
--    "no table DROP/RENAME/ALTER COLUMN, no data change" — or explain the
--    exception if this is a RED-tier reviewed change.]
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   [The concrete undo — the prior CREATE OR REPLACE body for a function
--    replace, the DROP TABLE/DROP POLICY/RESET for an additive object, or
--    the re-GRANT for a revoke. A migration with no stated undo is a review
--    failure per database-standard.md §6.]
-- ════════════════════════════════════════════════
```

Field rules:

- **WHAT THIS DOES**: same plain-English bar as the JS header — no jargon a non-developer wouldn't
  follow. State the mechanism only if it matters to someone deciding whether this is safe to apply
  (e.g. "this is an ATTRIBUTE change only, no function body changes").
- **ADDITIVE-ONLY line**: always present, even when the answer is simply "yes, additive-only" — it's
  the reviewer's first checkpoint, not something to infer from reading the DDL.
- **ROLLBACK**: concrete and runnable, not "revert the migration." If undoing this migration is
  genuinely destructive or infeasible, say so explicitly rather than omitting the section.
- Deferred/out-of-scope items discovered while building the migration (e.g. an advisor finding that
  turned out to need a separate RED-tier change) get their own `-- ── DEFERRED ── ` block — see
  `20260708_dbf_p1_advisor_quick_wins.sql` for the precedent.
