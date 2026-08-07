export const meta = {
  name: 'close-out-gauntlet',
  description: 'Run the applicable UPR reviewer agents over changed files in parallel, adversarially verify blocker/major findings, return one verdict',
  whenToUse: 'At close-out for any non-trivial diff, instead of invoking reviewer agents one by one. Pass {files:[...]} (repo-relative changed files); omit to have a scout derive the diff vs origin/dev.',
  phases: [
    { title: 'Map', detail: 'changed files → applicable reviewers' },
    { title: 'Review', detail: 'one agent per applicable reviewer, in parallel' },
    { title: 'Verify', detail: 'adversarial check of blocker/major findings' },
  ],
}

const FINDINGS = {
  type: 'object',
  required: ['verdict', 'findings'],
  properties: {
    verdict: { type: 'string', enum: ['pass', 'changes-requested', 'blocker'] },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'file', 'rule', 'summary', 'fix'],
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          file: { type: 'string' },
          line: { type: 'number' },
          rule: { type: 'string' },
          summary: { type: 'string' },
          fix: { type: 'string' },
        },
      },
    },
  },
}

const VERDICT = {
  type: 'object',
  required: ['confirmed', 'reason'],
  properties: { confirmed: { type: 'boolean' }, reason: { type: 'string' } },
}

// ── Phase: Map ──
phase('Map')
let parsedArgs = args
if (typeof parsedArgs === 'string') {
  try { parsedArgs = JSON.parse(parsedArgs) } catch { parsedArgs = null }
}
let files = Array.isArray(parsedArgs?.files) ? parsedArgs.files : null
if (!files) {
  const scout = await agent(
    'Run `git diff --name-only origin/dev...HEAD` plus `git status --porcelain` in the repo, merge the lists, and return ONLY a JSON array of repo-relative changed file paths (committed and uncommitted, excluding deletions).',
    { label: 'derive-changed-files', phase: 'Map', schema: { type: 'object', required: ['files'], properties: { files: { type: 'array', items: { type: 'string' } } } } },
  )
  files = scout?.files || []
}

const is = (re) => files.some((f) => re.test(f))
const reviewers = []
if (is(/^src\//)) reviewers.push('upr-pattern-checker')
if (is(/^src\/(pages|components)\//)) reviewers.push(
  'design-consistency-checker',
  'page-behavior-checker',
  'interface-accessibility-reviewer',
)
if (is(/^supabase\/(migrations|rollbacks)\//)) reviewers.push('migration-safety-checker', 'anon-grant-auditor')
if (is(/^functions\/(?!.*\.test\.js)/)) reviewers.push('worker-security-reviewer')
if (is(/send-message|automated-send|sms-consent|twilio|process-scheduled|send-text|callrail-outbound|messaging-transport/)) reviewers.push('consent-path-auditor')

if (reviewers.length === 0) {
  log('No reviewer applies to this diff (docs/tooling only).')
  return { verdict: 'pass', reviewers: [], confirmed: [], note: 'no applicable reviewers for these files' }
}
log(`Reviewers: ${reviewers.join(', ')} over ${files.length} file(s)`)

// ── Phase: Review (parallel) + Verify (per-finding, no barrier between items) ──
const fileList = files.join('\n')
const results = await pipeline(
  reviewers,
  (r) => agent(
    `Review ONLY these changed files against your standard, reading them from disk:\n${fileList}\n`
    + 'Report every finding with severity (blocker/major/minor), file, line, the rule violated, a one-sentence summary, and the minimal fix. Verdict: pass if nothing blocker/major.',
    { label: `review:${r}`, phase: 'Review', agentType: r, schema: FINDINGS },
  ),
  (review, r) => {
    const serious = (review?.findings || []).filter((f) => f.severity !== 'minor')
    const minors = (review?.findings || []).filter((f) => f.severity === 'minor')
    return parallel(serious.map((f) => () =>
      agent(
        `Adversarially verify this code-review finding by reading the actual file. Refute it if the cited rule does not apply, the code already handles it, or the location is wrong. Only confirm with concrete evidence.\nFinding from ${r}: ${JSON.stringify(f)}`,
        { label: `verify:${f.file}`, phase: 'Verify', schema: VERDICT },
      ).then((v) => ({ ...f, reviewer: r, verified: v })),
    )).then((checked) => ({ reviewer: r, minors, checked: checked.filter(Boolean) }))
  },
)

const clean = results.filter(Boolean)
const confirmed = clean.flatMap((x) => x.checked.filter((c) => c.verified?.confirmed))
const refuted = clean.flatMap((x) => x.checked.filter((c) => !c.verified?.confirmed))
const minors = clean.flatMap((x) => x.minors.map((m) => ({ ...m, reviewer: x.reviewer })))

const verdict = confirmed.some((f) => f.severity === 'blocker') ? 'blocker'
  : confirmed.length ? 'changes-requested'
  : 'pass'
log(`${verdict}: ${confirmed.length} confirmed, ${refuted.length} refuted, ${minors.length} minor`)
return { verdict, reviewers, confirmed, refuted, minors }
