<!--
  Fill every section. Blank/"N/A" is a signal, not a shortcut — an empty
  "Verification" or "Acceptance criteria" means the work isn't done. Delete
  this comment before submitting.
-->

## What & why
<!-- 1–2 lines: what this changes and the problem it solves. -->

## Scope
- **In:**
- **Deliberately out:** <!-- what you chose NOT to do, and why -->

## Acceptance criteria
<!-- Concrete, checkable "done" conditions — not vibes. This PR is done when: -->
- [ ]
- [ ]

## Tests
<!-- Test-first: the risky logic has a committed test written before the code.
     Name them, and confirm they're green. If none, say explicitly why not. -->
- [ ] Tests added/updated:
- [ ] `npm test` green

## Verification actually run
<!-- What you really ran + the real result. Never claim "done" unverified. -->
- [ ] `npm run build`
- [ ] `npm run lint` (no NEW errors beyond the known baseline)
- [ ] Verified against live data / schema where relevant (via MCP / `information_schema`, not memory)
- Notes:

## Docs
- [ ] `UPR-Web-Context.md` updated if this touched tables / RPCs / components / pages / workers (Rule 9)
- [ ] Other docs updated (if relevant):

## Migrations (if any)
- [ ] Additive-only (new tables/columns); no `ALTER`/`DROP`/rename of a live table without separate review
- [ ] New tables RLS-enabled at creation
- [ ] Applied + verified on `dev` before this PR

## Risk / not done
<!-- Honest call-outs: what's risky, what's deferred, what still needs a human's eyes. -->

## Release path
- [ ] Branch → `dev` (staging), or reviewed `dev → main` PR for production — never a direct `main` push
