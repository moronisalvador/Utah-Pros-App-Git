/**
 * Protects the office/tech/CRM messages screen against re-introducing the
 * keyboard and screen-reader defects the close-out gauntlets flagged twice:
 * a conversation row that only a mouse could open, a context menu with no way
 * out, and icon-only controls with no accessible name.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

const page = read('src/pages/Conversations.jsx');
const globalCss = read('src/index.css');

describe('conversations accessibility contract', () => {
  it('lets a keyboard user open a conversation row', () => {
    expect(page).toContain('role="button"');
    expect(page).toContain('tabIndex={0}');
    // Enter and Space both activate; Space must be prevented or the list scrolls.
    expect(page).toMatch(/if \(e\.key === 'Enter' \|\| e\.key === ' '\)/);
    expect(page).toMatch(/e\.preventDefault\(\);\s*\/\/ Space would scroll the list/);
    expect(page).toContain('selectConversation(conv.id)');
  });

  it('does not double-fire when the nested More button is activated by keyboard', () => {
    // The More button stops CLICK propagation, but keydown still bubbles to the
    // row — without this guard Enter on More would also open the conversation.
    expect(page).toContain('if (e.target !== e.currentTarget) return;');
  });

  it('gives the focusable row a visible ring and keeps More reachable', () => {
    expect(globalCss).toContain('.conv-item:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }');
    expect(globalCss).toContain('.conv-item:focus-within .conv-item-action { display: flex; }');
  });

  it('exposes the context menu as a menu and lets Escape dismiss it', () => {
    expect(page).toContain('role="menu"');
    expect(page).toContain('aria-label="Conversation actions"');
    expect(page).toContain('role="menuitem"');
    // Focus enters the menu on open and returns to the trigger on Escape.
    expect(page).toContain(".querySelector('.conv-context-item')?.focus()");
    expect(page).toMatch(/if \(e\.key !== 'Escape'\) return;/);
    expect(page).toContain('contextMenuTriggerRef.current');
    // .conv-item-action is display:none unless hovered/focused, so the restore
    // has to fall back to the row rather than focusing a removed button.
    expect(page).toContain(".closest?.('.conv-item')");
  });

  it('names the composer and declares it multi-line', () => {
    expect(page).toContain('aria-multiline="true"');
    expect(page).toContain("aria-label={isNote ? 'Internal note' : 'Message'}");
    // A data-placeholder rendered through CSS ::before is not an accessible
    // name — the aria-label above is what carries it.
    expect(page).toContain('data-placeholder=');
  });

  it('names the jump-to-latest pill in both count states', () => {
    expect(page).toContain(
      "aria-label={newInThread > 0 ? `Jump to latest messages, ${newInThread} new` : 'Jump to latest messages'}",
    );
  });

  it('names every icon-only list and thread control', () => {
    expect(page).toContain('aria-label="Mark all as read"');
    expect(page).toContain('aria-label="New conversation"');
    expect(page).toContain('aria-label="Search conversations"');
    expect(page).toContain("aria-label={activeConv?.unread_count > 0 ? 'Mark as read' : 'Mark as unread'}");
    expect(page).toContain('aria-label={`More options for ${cleanName(conv.title)}`}');
    // Pre-existing names this file must not lose.
    expect(page).toContain('aria-label="Back"');
    expect(page).toContain('aria-label="Contact info"');
    expect(page).toContain('aria-label="More actions"');
    expect(page).toContain('aria-label="Send"');
    expect(page).toContain('aria-label="Close"');
  });

  it('announces the DND block, which appears while the composer is open', () => {
    expect(page).toMatch(/className="conv-dnd-banner" role="status" aria-live="polite"/);
  });

  it('keeps the New Conversation dialog on the shared Modal', () => {
    // PR #646 migrated it; the old hand-rolled backdrop had no role=dialog,
    // focus trap or Escape and must not come back.
    expect(page).toContain('<Modal');
    expect(page).not.toContain('conv-modal-backdrop');
  });
});
