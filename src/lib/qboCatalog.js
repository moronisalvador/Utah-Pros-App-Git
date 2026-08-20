/**
 * ════════════════════════════════════════════════
 * FILE: qboCatalog.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Loads the read-only QuickBooks item/class catalog with a short bounded retry
 *   for temporary provider failures. It never saves or mutates an invoice.
 *
 * WHERE IT LIVES:
 *   Used by: src/pages/InvoiceEditor.jsx
 *
 * DEPENDS ON:
 *   Internal: a caller-supplied read-only query function
 *   Data:     reads QuickBooks Item and Class catalogs · writes none
 *
 * NOTES / GOTCHAS:
 *   - Only transport timeouts/failures, throttling, and server failures retry.
 *     Authorization, validation, and QBO-not-connected responses return
 *     immediately so the UI can give useful guidance.
 *   - The retry count is bounded; the editor supplies a human-triggered retry
 *     after the automatic attempts are exhausted.
 * ════════════════════════════════════════════════
 */

const ITEM_QUERY = 'SELECT Id, Name, Type FROM Item WHERE Active = true MAXRESULTS 200';
const CLASS_QUERY = 'SELECT Id, Name FROM Class WHERE Active = true MAXRESULTS 200';

export const isTransientQboCatalogError = (error) => {
  const status = Number(error?.status);
  return error instanceof TypeError || status === 408 || status === 429 || status >= 500;
};

const defaultWait = (delayMs, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    const error = new Error('QuickBooks catalog request aborted');
    error.name = 'AbortError';
    reject(error);
    return;
  }

  let timer;
  const onAbort = () => {
    clearTimeout(timer);
    const error = new Error('QuickBooks catalog request aborted');
    error.name = 'AbortError';
    reject(error);
  };
  timer = setTimeout(() => {
    signal?.removeEventListener('abort', onAbort);
    resolve();
  }, delayMs);
  signal?.addEventListener('abort', onAbort, { once: true });
});

export async function loadQboCatalog(runQuery, {
  attempts = 3,
  wait = defaultWait,
  signal,
} = {}) {
  let attempt = 0;
  while (attempt < attempts) {
    attempt += 1;
    try {
      const [itemsResponse, classesResponse] = await Promise.all([
        runQuery(ITEM_QUERY, signal),
        runQuery(CLASS_QUERY, signal),
      ]);
      return {
        items: (itemsResponse.Item || [])
          .filter((item) => item.Type !== 'Category')
          .map((item) => ({ id: String(item.Id), name: item.Name })),
        classes: (classesResponse.Class || [])
          .map((qboClass) => ({ id: String(qboClass.Id), name: qboClass.Name })),
      };
    } catch (error) {
      if (signal?.aborted || !isTransientQboCatalogError(error) || attempt >= attempts) throw error;
      await wait(250 * (2 ** (attempt - 1)), signal);
    }
  }

  throw new Error('QuickBooks catalog retry exhausted');
}
