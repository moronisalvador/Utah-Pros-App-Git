/**
 * ════════════════════════════════════════════════
 * FILE: AutoGrowTextarea.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A text box that starts one line tall and grows downward as you type, and lets
 *   you press Enter to add new lines. Used for the description on each invoice /
 *   estimate line so a full scope of work can be written out and stays readable.
 *
 * WHERE IT LIVES:
 *   Rendered by:  src/pages/InvoiceEditor.jsx, src/pages/EstimateEditor.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  none
 *   Data:      reads → none · writes → none (pure controlled input)
 *
 * NOTES / GOTCHAS:
 *   - Controlled like an <input>: pass value + onChange + onBlur exactly as before,
 *     so the editors' save-on-blur / silent-save flow is unchanged.
 *   - Height is recomputed on input AND whenever `value` changes from outside (e.g.
 *     after a reload), so it fits content without an inner scrollbar.
 *   - Enter inserts a newline (default textarea behavior) — intended, for scope text.
 * ════════════════════════════════════════════════
 */

import { useRef, useEffect, useCallback } from 'react';

export default function AutoGrowTextarea({ value, onChange, onBlur, placeholder, style, minRows = 1 }) {
  const ref = useRef(null);

  const fit = useCallback((el) => {
    if (!el) return;
    el.style.height = 'auto';                 // shrink first so deletions reduce height
    // With box-sizing:border-box the height includes the border but scrollHeight does
    // not — add it back so a single line matches sibling inputs exactly (no 2px clip).
    const cs = window.getComputedStyle(el);
    const border = cs.boxSizing === 'border-box'
      ? (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0)
      : 0;
    el.style.height = `${el.scrollHeight + border}px`; // then grow to fit content
  }, []);

  // Re-fit when the value changes from outside (initial load, reload after save).
  useEffect(() => { fit(ref.current); }, [value, fit]);

  return (
    <textarea
      ref={ref}
      value={value ?? ''}
      rows={minRows}
      placeholder={placeholder}
      onChange={(e) => { onChange?.(e); fit(e.target); }}
      onBlur={onBlur}
      style={{ resize: 'none', overflow: 'hidden', ...style }}
    />
  );
}
