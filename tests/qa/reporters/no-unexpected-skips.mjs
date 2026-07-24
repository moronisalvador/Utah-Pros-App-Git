/**
 * ════════════════════════════════════════════════
 * FILE: no-unexpected-skips.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Makes an empty or partially skipped Playwright run fail. A browser lane is green only when every
 *   discovered test actually finishes successfully.
 *
 * DEPENDS ON:
 *   Packages:  @playwright/test reporter lifecycle
 *   Internal:  none
 *   Data:      reads  → Playwright result metadata
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Intentional future skips require a separate named lane, not a silent exception here.
 * ════════════════════════════════════════════════
 */

export default class NoUnexpectedSkipsReporter {
  constructor() {
    this.total = 0;
    this.skipped = [];
  }

  onBegin(_config, suite) {
    this.total = suite.allTests().length;
  }

  onTestEnd(test, result) {
    if (result.status === 'skipped') this.skipped.push(test.titlePath().join(' > '));
  }

  async onEnd() {
    if (this.total === 0) {
      process.stderr.write('Playwright QA lane refused an empty green run.\n');
      return { status: 'failed' };
    }
    if (this.skipped.length) {
      process.stderr.write(`Playwright QA lane found ${this.skipped.length} unexpected skipped tests.\n`);
      return { status: 'failed' };
    }
    process.stdout.write(`Playwright QA lane: ${this.total} discovered; 0 unexpected skips.\n`);
    return undefined;
  }
}
