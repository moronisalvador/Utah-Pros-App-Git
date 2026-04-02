/** Dispatch a toast notification via the global upr:toast event. */
export const toast = (message, type = 'success') =>
  window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type } }));
