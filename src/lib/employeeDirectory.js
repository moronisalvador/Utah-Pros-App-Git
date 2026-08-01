/**
 * ════════════════════════════════════════════════
 * FILE: employeeDirectory.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Loads the non-sensitive employee roster through selector-safe database
 *   contracts and attaches display names to message rows without asking
 *   PostgREST to embed the protected employees table. Historical internal notes
 *   use a separate Conversations-capability RPC so deactivated authors remain
 *   attributable without appearing in ordinary employee pickers.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  callers pass the authenticated db client
 *   Data:      reads → get_employee_directory, get_message_author_directory
 *
 * NOTES / GOTCHAS:
 *   - The directory RPC is additive and must deploy before callers use it.
 *   - Inactive names are limited server-side to existing time-admin roles.
 *   - The message-author RPC accepts loaded authored-message IDs of every type
 *     and returns only id/full_name/display_name for their authors.
 * ════════════════════════════════════════════════
 */

export async function loadEmployeeDirectory(
  db,
  { includeInactive = false } = {},
) {
  const rows = await db.rpc('get_employee_directory', {
    p_include_inactive: !!includeInactive,
  });
  return Array.isArray(rows) ? rows : [];
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function loadMessageAuthorDirectory(db, messageIds = []) {
  const ids = [...new Set(
    messageIds.filter((messageId) => (
      typeof messageId === 'string' && UUID_PATTERN.test(messageId)
    )),
  )].sort();
  if (ids.length === 0) return [];

  const authorsById = new Map();
  for (let start = 0; start < ids.length; start += 200) {
    const rows = await db.rpc('get_message_author_directory', {
      p_message_ids: ids.slice(start, start + 200),
    });
    if (!Array.isArray(rows)) continue;
    rows.forEach((author) => {
      if (author?.id) authorsById.set(author.id, author);
    });
  }
  return [...authorsById.values()];
}

export function missingMessageAuthorMessageIds(
  messages = [],
  directoryRows = [],
) {
  const known = new Set(
    directoryRows
      .filter((employee) => employee?.id)
      .map((employee) => employee.id),
  );

  return [...new Set(
    messages
      .filter((message) => (
        !message?._pending
        && UUID_PATTERN.test(message.id || '')
        && message.sent_by
        && !known.has(message.sent_by)
      ))
      .map((message) => message.id),
  )].sort();
}

export function employeeDirectoryMap(rows = []) {
  return new Map(
    rows
      .filter((employee) => employee?.id)
      .map((employee) => [employee.id, employee]),
  );
}

export function attachEmployeeDirectory(message, directoryById) {
  if (!message || message.employees || !message.sent_by) return message;
  const employee = directoryById?.get?.(message.sent_by);
  const name = employee?.display_name?.trim?.() || employee?.full_name;
  if (!name) return message;
  return {
    ...message,
    employees: { full_name: name },
  };
}
