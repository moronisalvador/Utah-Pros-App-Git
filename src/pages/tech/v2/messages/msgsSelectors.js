/**
 * ════════════════════════════════════════════════
 * FILE: msgsSelectors.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The pure "brains" of the tech messaging thread — small functions with no React,
 *   no network, and no clock, so they can be tested by hand. They take the pages of
 *   messages the server sent plus the not-yet-confirmed "Sending…" bubbles the user
 *   just typed, and merge them into one clean list in the right order, with no
 *   duplicates and no leftover ghosts. They also group messages under day headers
 *   ("Today", "Yesterday"), compute the cursor for loading older messages, and fold a
 *   single deep-linked conversation into the inbox list. Because these are pure, the
 *   named B1 tests (overlay reconcile, page-merge/cursor, day grouping, unread math,
 *   deep-link miss) all live against THIS file.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (helper module)
 *   Rendered by:  n/a — imported by useThread.js + the messaging UI, tested by
 *                 msgsSelectors.test.js
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none (pure text/array helpers)
 *   Data:      reads/writes → none
 *
 * NOTES / GOTCHAS:
 *   - Server thread pages come back created_at DESC (newest first), 30 per page, page
 *     0 the newest. flattenThreadPages returns them ASCENDING for render.
 *   - An optimistic bubble carries `_clientId` + `_pending`/`_failed`; it is dropped
 *     from the overlay the instant the real row appears (matched by id OR type+body)
 *     so a delivered message never renders beside a permanent "Sending…" ghost — the
 *     legacy reloadActiveMessages heuristic (Conversations.jsx:258-278), reimplemented
 *     against the cache model.
 * ════════════════════════════════════════════════
 */

// ─── SECTION: Thread page flattening + cursor ──────────────

/**
 * Flatten server thread pages (each created_at DESC, newest page first) into one
 * ASCENDING-by-time array for render. pages.flat() is already fully descending
 * (page 0 rows are all newer than page 1's), so a single reverse yields ascending.
 * @param {Array<Array<object>>} pages
 * @returns {object[]} messages oldest→newest
 */
export function flattenThreadPages(pages) {
  if (!Array.isArray(pages)) return [];
  return pages.flat().slice().reverse();
}

/**
 * Cursor for the NEXT (older) page: the created_at of the oldest row in the last
 * fetched page. `undefined` when the last page was short (fewer than pageSize rows),
 * which means there is no more history — React Query stops paginating.
 * @param {object[]} lastPage server rows (created_at DESC)
 * @param {number} pageSize
 * @returns {string|undefined}
 */
export function nextThreadCursor(lastPage, pageSize) {
  if (!Array.isArray(lastPage) || lastPage.length < pageSize) return undefined;
  const oldest = lastPage[lastPage.length - 1];
  return oldest?.created_at || undefined;
}

// ─── SECTION: Optimistic overlay merge ──────────────

const bodyKey = (m) => `${m.type}::${m.body || ''}`;

/**
 * Merge the ascending server list with the pane-local optimistic overlay, dropping any
 * overlay entry the server already has — matched by id OR (type,body). This is the
 * ghost-filter: if a send's POST response AND its realtime INSERT both landed, the real
 * row is in `serverAscending` and its optimistic twin must not render too.
 * @param {object[]} serverAscending oldest→newest server rows
 * @param {object[]} overlay optimistic bubbles (append order = send order)
 * @returns {object[]} render list, oldest→newest, optimistic entries last
 */
export function mergeOverlay(serverAscending, overlay) {
  const server = Array.isArray(serverAscending) ? serverAscending : [];
  if (!overlay || overlay.length === 0) return server.slice();
  const ids = new Set(server.map((m) => m.id));
  const bodies = new Set(server.map(bodyKey));
  const ghostsGone = overlay.filter((o) => !ids.has(o.id) && !bodies.has(bodyKey(o)));
  return [...server, ...ghostsGone];
}

/**
 * Drop reconciled optimistic entries from the overlay once the real row arrives —
 * matched by _clientId (the send we started) OR type+body (a realtime INSERT whose
 * _clientId we never saw). Returns a NEW array (never mutates).
 * @param {object[]} overlay
 * @param {object} realMsg the confirmed server row
 * @param {string} [clientId] the optimistic _clientId if known
 */
export function reconcileOverlay(overlay, realMsg, clientId) {
  if (!Array.isArray(overlay) || overlay.length === 0) return overlay || [];
  const key = realMsg ? bodyKey(realMsg) : null;
  return overlay.filter((o) => {
    if (clientId && o._clientId === clientId) return false;
    if (key && (o._pending || o._failed) && bodyKey(o) === key) return false;
    return true;
  });
}

// ─── SECTION: Server-page mutation (append / patch) ──────────────

/**
 * Insert a confirmed message into the newest page. No-op (returns the same reference)
 * if a row with that id already exists anywhere — dedupe by id. A new newest row is
 * prepended to page 0 (which is created_at DESC). Preserves an `employees` embed from
 * the incoming row.
 * @param {Array<Array<object>>} pages
 * @param {object} msg confirmed server row
 * @returns {Array<Array<object>>}
 */
export function appendMessageToPages(pages, msg) {
  const p = Array.isArray(pages) ? pages : [];
  if (!msg?.id) return p;
  if (p.some((page) => page.some((m) => m.id === msg.id))) return p;
  if (p.length === 0) return [[msg]];
  const next = p.map((page) => page);
  next[0] = [msg, ...p[0]];
  return next;
}

/**
 * Patch a row by id across every page (a delivery-tick UPDATE: queued→sent→delivered→
 * read/failed). Preserves the existing `employees` embed if the update omits it. Returns
 * the same reference when the id is not loaded (nothing to patch — never refetch).
 * @param {Array<Array<object>>} pages
 * @param {object} msg the updated row
 */
export function patchMessageInPages(pages, msg) {
  const p = Array.isArray(pages) ? pages : [];
  if (!msg?.id) return p;
  let found = false;
  const next = p.map((page) =>
    page.map((m) => {
      if (m.id !== msg.id) return m;
      found = true;
      return { ...msg, employees: msg.employees || m.employees };
    }),
  );
  return found ? next : p;
}

/**
 * Flip a confirmed cache row (matched by id) back to a pending "Sending…" state,
 * tagging it with `_clientId` so the send's success can later drop it — this is how a
 * CARRIER-failed real row (delivered→failed via the status webhook) is retried in
 * place, mirroring legacy retryMessage. Returns the same reference if the id is absent.
 * @param {Array<Array<object>>} pages
 * @param {string} clientId retry match key (the row's own id)
 * @param {string} sourceId the failed row's id
 */
export function markPendingByMatch(pages, clientId, sourceId) {
  const p = Array.isArray(pages) ? pages : [];
  let found = false;
  const next = p.map((page) =>
    page.map((m) => {
      if (m.id !== sourceId) return m;
      found = true;
      return { ...m, _clientId: clientId, _pending: true, _failed: false, status: 'pending', error_message: null, error_code: null };
    }),
  );
  return found ? next : p;
}

/**
 * Drop any cache rows tagged with `_clientId` (the temporarily-flipped carrier-retry
 * row) so its confirmed replacement takes its place with no duplicate. A no-op for the
 * common optimistic path (those bubbles live in the overlay, never the cache).
 * @param {Array<Array<object>>} pages
 * @param {string} clientId
 */
export function dropByClientId(pages, clientId) {
  const p = Array.isArray(pages) ? pages : [];
  if (!clientId) return p;
  let dropped = false;
  const next = p.map((page) =>
    page.filter((m) => {
      if (m._clientId === clientId) { dropped = true; return false; }
      return true;
    }),
  );
  return dropped ? next : p;
}

/**
 * Flip a temporarily-flipped carrier-retry cache row (tagged `_clientId`) back to a
 * failed state when its re-send fails. Returns the SAME reference when no row carries
 * that clientId (the ordinary optimistic path — its bubble lives in the overlay), so
 * the caller can skip a needless cache notify.
 */
export function failByClientId(pages, clientId, reason, code) {
  const p = Array.isArray(pages) ? pages : [];
  if (!clientId) return p;
  let found = false;
  const next = p.map((page) =>
    page.map((m) => {
      if (m._clientId !== clientId) return m;
      found = true;
      return { ...m, _pending: false, _failed: true, status: 'failed', error_message: reason, error_code: code || m.error_code };
    }),
  );
  return found ? next : p;
}

// ─── SECTION: Day-divider grouping ──────────────

/** Local YYYY-MM-DD key for a timestamp (day bucketing is local, like a phone's Messages). */
export function dayKeyOf(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Fold an ascending message list into render items with a day header before each new
 * day: { type:'day', key } then { type:'msg', data } for each message. The key is a
 * local YYYY-MM-DD; the component localizes it to Today/Yesterday/weekday/date.
 * @param {object[]} messagesAsc oldest→newest
 * @returns {Array<{type:'day',key:string}|{type:'msg',data:object}>}
 */
export function groupMessagesByDay(messagesAsc) {
  const out = [];
  let cur = null;
  (messagesAsc || []).forEach((msg) => {
    const key = dayKeyOf(msg.created_at);
    if (key !== cur) { cur = key; out.push({ type: 'day', key }); }
    out.push({ type: 'msg', data: msg });
  });
  return out;
}

// ─── SECTION: Inbox list helpers (unread + deep-link merge) ──────────────

/** Unread state for a conversation row → { isUnread, count }. */
export function convoUnread(conv) {
  const count = Number(conv?.unread_count) || 0;
  return { isUnread: count > 0, count };
}

/** Sort key mirroring the server: COALESCE(last_message_at, created_at). */
function convoSortKey(c) {
  return c?.sort_key || c?.last_message_at || c?.created_at || '';
}

/**
 * Fold a single deep-linked conversation (fetched via the RPC's single-row mode on a
 * ?c= cache miss) into the inbox list: replace it in place if already present by id,
 * else insert it keeping the sort_key-DESC ordering. Returns a NEW array.
 * @param {object[]} list current convos
 * @param {object} conv the fetched conversation
 */
export function mergeConvoIntoList(list, conv) {
  const l = Array.isArray(list) ? list : [];
  if (!conv?.id) return l.slice();
  if (l.some((c) => c.id === conv.id)) {
    return l.map((c) => (c.id === conv.id ? { ...c, ...conv } : c));
  }
  const merged = [conv, ...l];
  merged.sort((a, b) => (convoSortKey(b) > convoSortKey(a) ? 1 : convoSortKey(b) < convoSortKey(a) ? -1 : 0));
  return merged;
}

/** Does this convos list already contain the conversation id? (deep-link miss check) */
export function hasConversation(list, convId) {
  if (!convId || !Array.isArray(list)) return false;
  return list.some((c) => c.id === convId);
}
