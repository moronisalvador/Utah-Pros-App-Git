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

## Current adoption (as of this audit)

Coverage is partial by design — this only applies to new files and files substantially edited,
not a backfill mandate. Last measured: ~105/191 files in `src/` (55%), ~15/58 in `functions/` (26%)
have the header. Re-measure with `grep -rl "FILE:" src --include=*.jsx --include=*.js | wc -l`.
