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

  it('implements the keyboard model that role="menu" promises', () => {
    // Roles without arrow-key support are worse than no roles at all: they
    // advertise a model the widget does not honour. If the roles above stay,
    // these must stay with them.
    expect(page).toMatch(/e\.key === 'ArrowDown' \|\| e\.key === 'ArrowUp'/);
    expect(page).toMatch(/e\.key === 'Home' \|\| e\.key === 'End'/);
    expect(page).toContain("onKeyDown={onContextMenuKeyDown}");
    // Written over the rendered items, not hardcoded to today's single action,
    // so a second menu item inherits the behaviour instead of breaking it.
    expect(page).toContain(".querySelectorAll('.conv-context-item')");
    expect(page).toMatch(/items\[\(current \+ step \+ items\.length\) % items\.length\]\.focus\(\)/);
    // Menu items are entered by programmatic focus, never by tabbing in from
    // the end of the document where they render.
    expect(page).toMatch(/role="menuitem" tabIndex=\{-1\}/);
  });

  it('never drops focus to <body> when the menu closes', () => {
    // Escape was handled; activating an item and tabbing out were not, and
    // activation is the common path.
    expect(page).toContain('const restoreContextMenuFocus = useCallback(');
    expect(page).toMatch(/markAsRead\(contextMenu\.convId\); restoreContextMenuFocus\(\)/);
    expect(page).toMatch(/markAsUnread\(contextMenu\.convId\); restoreContextMenuFocus\(\)/);
    expect(page).toMatch(/e\.key === 'Tab'\) \{[\s\S]{0,400}?restoreContextMenuFocus\(\)/);
  });

  it('tells a screen reader the More button owns a popup, and its state', () => {
    expect(page).toContain('aria-haspopup="menu"');
    expect(page).toContain('aria-expanded={contextMenu?.convId === conv.id}');
  });

  it('gives the focused menu item a visible ring', () => {
    // The menu moves focus onto an item on open; without this the focus is
    // invisible, which makes the whole keyboard path unusable in practice.
    expect(globalCss).toContain('.conv-context-item:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }');
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

  it('moves focus when the mobile panel swap hides the control that was activated', () => {
    // At <=768px the panels swap with display:none/flex, so without this the
    // focused row (going in) or Back button (coming out) is hidden underneath
    // the user and focus falls to <body>, silently.
    expect(page).toMatch(/useEffect\(\(\) => \{[\s\S]*?mobileViewSettledRef/);
    expect(page).toMatch(/\}, \[mobileView\]\);/);
    // Forward: the TITLE, not Back — "Back" does not say which thread opened.
    expect(page).toContain('threadTitleRef');
    expect(page).toMatch(/className="conv-thread-title"[^>]*tabIndex=\{-1\}/);
    // Return: the row we came from is still the aria-current one.
    expect(page).toContain(".conv-item[aria-current=\"true\"]");
  });

  it('no-ops on desktop via visibility, not a duplicated breakpoint', () => {
    // A matchMedia('(max-width: 768px)') here could drift from the stylesheet.
    // offsetParent is null while an element's panel is display:none, so the
    // breakpoint stays in exactly one place.
    expect(page).toContain('offsetParent === null');
    expect(page).not.toMatch(/matchMedia\(\s*['"`]\(max-width: ?768px\)/);
  });

  it('skips the swap-focus on first mount so page load is not hijacked', () => {
    expect(page).toMatch(/if \(!mobileViewSettledRef\.current\) \{ mobileViewSettledRef\.current = true; return; \}/);
  });

  it('shows where focus landed after the swap', () => {
    // Focus moved without a visible ring is the gap that made the context-menu
    // focus move unusable rather than merely incomplete.
    expect(globalCss).toMatch(/\.conv-thread-title:focus-visible \{[^}]*outline:/);
  });

  it('gives the row More button a real touch target on phones', () => {
    // It is the ONLY route to Mark as read/unread on a phone (the row's own tap
    // opens the thread), and 28px is below every touch floor we hold.
    const mobileBlock = globalCss.slice(globalCss.indexOf('@media (max-width: 768px)'));
    expect(mobileBlock).toMatch(/\.conv-item-action \{[^}]*width: 44px;[^}]*height: 44px;/);
  });
});
