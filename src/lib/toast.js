/** Dispatch a toast notification via the global upr:toast event. */
export const toast = (message, type = 'success') =>
  // This module IS the single upr:toast entry point AGENTS.md Rule 2 mandates. The
  // no-restricted-syntax rule exists to route every OTHER caller through here, so the
  // one dispatch it is protecting is definitionally exempt — never "fix" this line.
  // eslint-disable-next-line no-restricted-syntax
  window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type } }));

export const ok = (message) => toast(message, 'success');
export const err = (message) => toast(message, 'error');
