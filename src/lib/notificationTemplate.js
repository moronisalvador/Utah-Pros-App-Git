/**
 * ════════════════════════════════════════════════
 * FILE: notificationTemplate.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Inserts one server-approved notification variable token at a text field's
 *   current selection while enforcing the surface's configured length limit.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - This is only an editor helper. The Worker repeats the event allowlist,
 *     grammar, route, privacy, and length validation before preview or save.
 * ════════════════════════════════════════════════
 */

const VARIABLE_KEY = /^[a-z][a-z0-9_]*$/;

function selectionIndex(value, fallback, max) {
  return Number.isInteger(value)
    ? Math.min(Math.max(value, 0), max)
    : fallback;
}

export function insertNotificationTemplateVariable({
  template,
  variableKey,
  allowedVariableKeys,
  selectionStart,
  selectionEnd,
  maxLength,
}) {
  const source = typeof template === 'string' ? template : '';
  const allowed = new Set(Array.isArray(allowedVariableKeys) ? allowedVariableKeys : []);
  if (!VARIABLE_KEY.test(variableKey || '') || !allowed.has(variableKey)) {
    return { ok: false, error: 'Variable is not allowed for this event' };
  }

  const start = selectionIndex(selectionStart, source.length, source.length);
  const end = selectionIndex(selectionEnd, start, source.length);
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  const token = `{{${variableKey}}}`;
  const value = `${source.slice(0, from)}${token}${source.slice(to)}`;
  if (!Number.isInteger(maxLength) || value.length > maxLength) {
    return { ok: false, error: 'Presentation copy is too long' };
  }

  return {
    ok: true,
    value,
    caret: from + token.length,
  };
}
