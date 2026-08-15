/**
 * ════════════════════════════════════════════════
 * FILE: tech-edit-appointment-crew-sync.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Keeps the mobile appointment editor's crew-save checks in the normal
 *   credential-free quality lane. It confirms mobile edits use the same
 *   all-or-nothing appointment and crew command as the web editors, and locks
 *   the native crew picker's pointer-only haptics and accessible state motion.
 *
 * DEPENDS ON:
 *   Packages:  Vitest through the imported test
 *   Internal:  src/pages/tech/TechEditAppointment.crewSync.test.js,
 *              src/pages/tech/TechEditAppointment.jsx,
 *              src/pages/tech/TechEditAppointment.css
 *   Data:      reads  → none
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This wrapper imports the colocated source test; it does not duplicate it.
 * ════════════════════════════════════════════════
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import '../../../src/pages/tech/TechEditAppointment.crewSync.test';

const techEditor = readFileSync(
  resolve('src/pages/tech/TechEditAppointment.jsx'),
  'utf8',
);
const styles = readFileSync(
  resolve('src/pages/tech/TechEditAppointment.css'),
  'utf8',
);

describe('TechEditAppointment native crew controls', () => {
  it('fires selection feedback only from pointer activation', () => {
    expect(techEditor).toContain(
      "import { selection } from '@/lib/nativeHaptics';",
    );
    expect(techEditor.match(/onPointerUp=\{selection\}/g)?.length).toBe(2);
    expect(techEditor).not.toMatch(/onClick=\{[^}]*selection/);
    expect(techEditor).not.toContain('onKeyDown={selection}');
    expect(techEditor).not.toContain('onKeyUp={selection}');
  });

  it('exposes disclosure and selected-state semantics', () => {
    expect(techEditor).toContain('aria-expanded={showCrew}');
    expect(techEditor).toContain('aria-controls="tech-appointment-crew-options"');
    expect(techEditor).toContain('aria-pressed={isSelected}');
  });

  it('uses motion tokens and collapses crew motion when reduced motion is requested', () => {
    expect(techEditor).toContain("import './TechEditAppointment.css';");
    expect(styles).toContain('.tech-appointment-crew-control__chevron');
    expect(styles).toContain(
      'transition: transform var(--motion-duration-fast) var(--motion-ease-standard);',
    );
    expect(styles).toMatch(
      /\.tech-appointment-crew-option\[aria-pressed="true"\]\s+\.tech-appointment-crew-option__checkmark/,
    );
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.tech-appointment-crew-option__checkmark \{\s*transition: none;/,
    );
    expect(techEditor).toMatch(
      /className="tech-appointment-crew-control__chevron"[\s\S]*?style=\{\{ transform: showCrew \? 'rotate\(180deg\)' : 'none' \}\}/,
    );
  });
});
