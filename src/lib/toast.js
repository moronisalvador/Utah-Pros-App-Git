/** Dispatch a toast notification via the global upr:toast event. */
export const toast = (message, type = 'success') =>
  window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type } }));

export const ok = (message) => toast(message, 'success');
export const err = (message) => toast(message, 'error');
