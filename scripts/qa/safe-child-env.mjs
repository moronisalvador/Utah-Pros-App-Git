/**
 * ════════════════════════════════════════════════
 * FILE: safe-child-env.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Builds a minimal child-process environment for credential-free QA commands.
 *
 * DEPENDS ON:
 *   Data: reads → explicitly named operating-system variables; writes → none
 *
 * NOTES / GOTCHAS:
 *   - New inherited variables require an explicit reviewed addition here.
 * ════════════════════════════════════════════════
 */

const SAFE_OS_NAMES = [
  'APPDATA', 'CI', 'ComSpec', 'COMSPEC', 'FORCE_COLOR', 'GITHUB_ACTIONS', 'HOME', 'LANG',
  'LC_ALL', 'LOCALAPPDATA', 'NO_COLOR', 'NUMBER_OF_PROCESSORS', 'OS', 'Path', 'PATH',
  'PATHEXT', 'PROCESSOR_ARCHITECTURE', 'RUNNER_OS', 'RUNNER_TEMP', 'SystemRoot',
  'SYSTEMROOT', 'TEMP', 'TERM', 'TMP', 'TMPDIR', 'TZ', 'USERPROFILE', 'WINDIR',
];

export function safeChildEnv(source, extra = {}) {
  const result = {};
  for (const name of SAFE_OS_NAMES) {
    if (typeof source[name] === 'string') result[name] = source[name];
  }
  for (const [name, value] of Object.entries(extra)) {
    if (typeof value === 'string') result[name] = value;
  }
  return result;
}
