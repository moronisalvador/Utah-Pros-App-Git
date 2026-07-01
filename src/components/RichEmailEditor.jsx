/**
 * ════════════════════════════════════════════════
 * FILE: RichEmailEditor.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The text box where someone writes an email campaign's message — with a
 *   small toolbar for bold, italic, underline, bullet/numbered lists, links,
 *   inserting a variable like the recipient's name, and picking an emoji.
 *   It's a normal-looking text editor, not a raw HTML box.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (reusable component, not a page)
 *   Rendered by:  src/pages/crm/CrmCampaigns.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/lib/emailTemplate (EMAIL_VARIABLES)
 *   Data:      none
 *
 * EXPORTS:
 *   default RichEmailEditor({ value, onChange, placeholder })
 *
 * NOTES / GOTCHAS:
 *   - Uses a contentEditable div + document.execCommand, the same technique
 *     Conversations.jsx already uses for its SMS compose box — except this
 *     one keeps HTML (bold/italic/lists) instead of stripping to plain text,
 *     since campaign emails are real HTML.
 *   - Deliberately uncontrolled: `value` only seeds the editor once on mount
 *     (and when switching between campaigns — see the `resetKey` prop) —
 *     re-syncing innerHTML on every keystroke would fight the browser's own
 *     cursor position. `onChange` fires on every input with the current
 *     innerHTML.
 *   - execCommand is deprecated but still broadly supported and is what
 *     every dependency-light rich-text box in the wild still uses for basic
 *     formatting; no new npm dependency needed for bold/italic/lists/links.
 *   - The "Design with AI" button is a disabled placeholder — the feature
 *     isn't built yet (planned to let a future AI worker rewrite body_html
 *     with brand styling), but the button communicates the toolbar has room
 *     for it without wiring anything up yet.
 * ════════════════════════════════════════════════
 */
import { useRef, useState, useEffect, useCallback } from 'react';
import { EMAIL_VARIABLES } from '@/lib/emailTemplate';

const EMOJI = [
  '😀','😃','😄','😁','😊','🙂','😉','😍','🥰','😎',
  '👍','👏','🙌','🤝','💪','✅','⭐','🔥','🎉','🎊',
  '🏠','🔧','🛠️','💧','🌊','🧹','🧰','📞','📧','📅',
  '❤️','💙','💛','🙏','😊','👋','✨','💯','🚀','👌',
];

function ToolbarButton({ label, title, onClick, active, disabled }) {
  return (
    <button
      type="button"
      className={`crm-editor-btn${active ? ' active' : ''}`}
      title={title}
      onMouseDown={(e) => e.preventDefault()} // keep focus/selection in the editor
      onClick={onClick}
      disabled={disabled}
    >
      {label}
    </button>
  );
}

function usePopover() {
  const [open, setOpen] = useState(null); // null | 'variable' | 'emoji' | 'link'
  const toggle = (name) => setOpen(o => (o === name ? null : name));
  const close = () => setOpen(null);
  return { open, toggle, close };
}

export default function RichEmailEditor({ value, onChange, placeholder, resetKey }) {
  const editorRef = useRef(null);
  const { open, toggle, close } = usePopover();
  const [linkUrl, setLinkUrl] = useState('');
  const [activeFormats, setActiveFormats] = useState({});

  // Seed the editor's content once per resetKey change (e.g. switching from
  // "new campaign" to editing an existing one) — never on every keystroke.
  useEffect(() => {
    if (editorRef.current) editorRef.current.innerHTML = value || '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const emitChange = useCallback(() => {
    onChange(editorRef.current?.innerHTML || '');
  }, [onChange]);

  const exec = (command, arg = null) => {
    editorRef.current?.focus();
    document.execCommand(command, false, arg);
    emitChange();
    updateActiveFormats();
  };

  const updateActiveFormats = () => {
    try {
      setActiveFormats({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
      });
    } catch { /* queryCommandState can throw outside a live selection — ignore */ }
  };

  const insertVariable = (key) => {
    editorRef.current?.focus();
    document.execCommand('insertText', false, `{{${key}}}`);
    emitChange();
    close();
  };

  const insertEmoji = (emoji) => {
    editorRef.current?.focus();
    document.execCommand('insertText', false, emoji);
    emitChange();
    close();
  };

  const insertLink = () => {
    if (!linkUrl.trim()) return;
    editorRef.current?.focus();
    document.execCommand('createLink', false, linkUrl.trim());
    emitChange();
    setLinkUrl('');
    close();
  };

  return (
    <div className="crm-rich-editor">
      <div className="crm-editor-toolbar">
        <ToolbarButton label={<strong>B</strong>} title="Bold" active={activeFormats.bold} onClick={() => exec('bold')} />
        <ToolbarButton label={<em>I</em>} title="Italic" active={activeFormats.italic} onClick={() => exec('italic')} />
        <ToolbarButton label={<u>U</u>} title="Underline" active={activeFormats.underline} onClick={() => exec('underline')} />
        <span className="crm-editor-divider" />
        <ToolbarButton label="•⁠—" title="Bullet list" onClick={() => exec('insertUnorderedList')} />
        <ToolbarButton label="1.—" title="Numbered list" onClick={() => exec('insertOrderedList')} />
        <span className="crm-editor-divider" />
        {/* onMouseDown preventDefault on every popover (not just the toolbar buttons that
            open them) — otherwise clicking an item blurs the contentEditable first, which
            can unmount the popover before its own onClick fires. */}
        <div className="crm-editor-popover-wrap">
          <ToolbarButton label="🔗" title="Insert link" onClick={() => toggle('link')} active={open === 'link'} />
          {open === 'link' && (
            <div className="crm-editor-popover" onMouseDown={(e) => e.preventDefault()}>
              <input
                className="crm-integration-input"
                placeholder="https://…"
                value={linkUrl}
                onChange={e => setLinkUrl(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); insertLink(); } }}
                autoFocus
              />
              <button type="button" className="crm-btn crm-btn-primary crm-btn-sm" onClick={insertLink}>Insert</button>
            </div>
          )}
        </div>
        <div className="crm-editor-popover-wrap">
          <ToolbarButton label="{{ }}" title="Insert variable" onClick={() => toggle('variable')} active={open === 'variable'} />
          {open === 'variable' && (
            <div className="crm-editor-popover crm-editor-menu" onMouseDown={(e) => e.preventDefault()}>
              {EMAIL_VARIABLES.map(v => (
                <button key={v.key} type="button" className="crm-editor-menu-item" onClick={() => insertVariable(v.key)}>
                  <code>{`{{${v.key}}}`}</code> <span>{v.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="crm-editor-popover-wrap">
          <ToolbarButton label="🙂" title="Insert emoji" onClick={() => toggle('emoji')} active={open === 'emoji'} />
          {open === 'emoji' && (
            <div className="crm-editor-popover crm-editor-emoji-grid" onMouseDown={(e) => e.preventDefault()}>
              {EMOJI.map((e, i) => (
                <button key={i} type="button" className="crm-editor-emoji-item" onClick={() => insertEmoji(e)}>{e}</button>
              ))}
            </div>
          )}
        </div>
        <div style={{ flex: 1 }} />
        <ToolbarButton label="✨ Design with AI" title="Coming soon" disabled />
      </div>

      <div
        ref={editorRef}
        className="crm-editor-content"
        contentEditable
        role="textbox"
        aria-multiline="true"
        data-placeholder={placeholder}
        onInput={emitChange}
        onKeyUp={updateActiveFormats}
        onMouseUp={updateActiveFormats}
        onFocus={updateActiveFormats}
        onBlur={() => { close(); }}
        suppressContentEditableWarning
      />
    </div>
  );
}
