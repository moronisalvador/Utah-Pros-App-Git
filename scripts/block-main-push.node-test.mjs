// ════════════════════════════════════════════════
// FILE: scripts/block-main-push.node-test.mjs
// ════════════════════════════════════════════════
//
// WHAT THIS DOES (plain language):
//   Proves the "never push main" guard actually refuses a push at the
//   production branch, by feeding it real request payloads and checking it
//   says no. It also proves the guard stays out of the way of ordinary work
//   — a guard that blocks the normal flow gets switched off, and a switched
//   off guard protects nothing. So roughly half these cases assert ALLOW.
//
// DEPENDS ON:
//   Internal: .claude/hooks/block-main-push.sh (the canonical guard body)
//   Data:     reads  → nothing
//             writes → nothing
//
// NOTES / GOTCHAS:
//   - Exit 2 means BLOCK. Exit 0 means allow. Exit 1 is non-blocking in both
//     Claude Code and Codex, so exit 1 from this guard would be a defect: a
//     crash must never read as permission. Cases assert the exact code.
//   - CURRENT_BRANCH is what the guard derives from `git rev-parse`. The
//     bare-push and `HEAD` cases depend on it, so they are exercised on a
//     stub `git` placed ahead of the real one on PATH rather than by
//     switching the real repository's branch.
//   - Parses with node, NOT jq: jq is absent from the owner's machine and
//     from most CI images.
// ════════════════════════════════════════════════

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const REPO = path.resolve(import.meta.dirname, '..')
const GUARD = path.join(REPO, '.claude', 'hooks', 'block-main-push.sh')

const hasBash = spawnSync('bash', ['-c', 'exit 0']).status === 0

// A stub `git` that answers `rev-parse --abbrev-ref HEAD` with a branch we
// choose. Placed first on PATH so the guard's branch lookup is deterministic
// and never depends on which branch the real repository happens to be on.
function stubGitDir(branch) {
  const dir = mkdtempSync(path.join(tmpdir(), 'upr-git-stub-'))
  const f = path.join(dir, 'git')
  writeFileSync(f, `#!/usr/bin/env bash\necho "${branch}"\n`)
  chmodSync(f, 0o755)
  return dir
}

function run(payload, branch = 'dev') {
  const res = spawnSync('bash', [GUARD], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, PATH: `${stubGitDir(branch)}${path.delimiter}${process.env.PATH}` },
  })
  return { code: res.status, stderr: res.stderr || '' }
}

const sh = (command) => ({ tool_name: 'Bash', tool_input: { command } })

const BLOCK = 2
const ALLOW = 0

// [label, payload, expected exit code, current branch]
const CASES = [
  // ── the plain violation ──
  ['git push origin main', sh('git push origin main'), BLOCK, 'dev'],
  ['git push origin master', sh('git push origin master'), BLOCK, 'dev'],
  ['force push to main', sh('git push --force origin main'), BLOCK, 'dev'],
  ['-u origin main', sh('git push -u origin main'), BLOCK, 'dev'],

  // ── refspec forms: the destination is NOT a literal in the command ──
  ['dev:main writes main', sh('git push origin dev:main'), BLOCK, 'dev'],
  ['HEAD:main writes main', sh('git push origin HEAD:main'), BLOCK, 'dev'],
  ['+dev:main (force refspec)', sh('git push origin +dev:main'), BLOCK, 'dev'],
  ['fully-qualified refs/heads/main', sh('git push origin refs/heads/main'), BLOCK, 'dev'],
  ['`:main` DELETES main', sh('git push origin :main'), BLOCK, 'dev'],
  ['--delete origin main', sh('git push --delete origin main'), BLOCK, 'dev'],

  // ── sweeping forms that carry main along ──
  ['--all pushes main too', sh('git push --all origin'), BLOCK, 'dev'],
  ['--mirror pushes main too', sh('git push --mirror origin'), BLOCK, 'dev'],

  // ── branch-dependent forms ──
  ['bare push while ON main', sh('git push'), BLOCK, 'main'],
  ['bare push while on dev is the SANCTIONED flow', sh('git push'), ALLOW, 'dev'],
  ['`origin HEAD` while ON main', sh('git push origin HEAD'), BLOCK, 'main'],
  ['`origin HEAD` while on dev', sh('git push origin HEAD'), ALLOW, 'dev'],

  // ── hidden inside a compound command ──
  ['after &&', sh('npm test && git push origin main'), BLOCK, 'dev'],
  ['after ;', sh('echo hi; git push origin main'), BLOCK, 'dev'],
  ['with a -C path', sh('git -C /repo push origin main'), BLOCK, 'dev'],
  ['nested in bash -c', sh('bash -c "git push origin main"'), BLOCK, 'dev'],
  ['behind an env assignment', sh('FOO=1 git push origin main'), BLOCK, 'dev'],

  // ── must NOT block ordinary work (false positives disable the guard) ──
  ['pushing dev is the routine flow', sh('git push origin dev'), ALLOW, 'dev'],
  ['pushing a feature branch', sh('git push -u origin crm/phase-9'), ALLOW, 'dev'],
  ['main:experimental does not write main', sh('git push origin main:experimental'), ALLOW, 'dev'],
  ['git log that merely says push', sh('git log --grep push -5'), ALLOW, 'main'],
  ['echo mentioning a push', sh('echo "remember: never git push origin main"'), ALLOW, 'dev'],
  ['git status', sh('git status --short --branch'), ALLOW, 'main'],
  ['unrelated command', sh('npm run build'), ALLOW, 'main'],
  ['a pushd call', sh('pushd /tmp && ls'), ALLOW, 'dev'],

  // ── fail-closed / fail-open boundary ──
  ['empty payload is not a push, so allow', '', ALLOW, 'dev'],
  ['malformed JSON mentioning push is refused', '{not json, push', BLOCK, 'dev'],
  ['malformed JSON with no push is allowed', '{not json at all', ALLOW, 'dev'],
  ['non-Bash payload with no command', { tool_name: 'Read', tool_input: {} }, ALLOW, 'dev'],
]

for (const [label, payload, expected, branch] of CASES) {
  test(`${expected === BLOCK ? 'BLOCKS' : 'allows'}: ${label}`, { skip: !hasBash && 'bash not on PATH' }, () => {
    const { code, stderr } = run(payload, branch)
    assert.notEqual(code, 1, `exit 1 is NON-blocking in both tools — a guard must never return it. stderr: ${stderr}`)
    assert.equal(code, expected, `expected exit ${expected}, got ${code}. stderr: ${stderr}`)
    if (expected === BLOCK) assert.match(stderr, /BLOCKED —/, 'a block must say why on stderr')
  })
}
