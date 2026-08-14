/**
 * ════════════════════════════════════════════════
 * FILE: sendResult.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Works out what to tell someone after they hit Send, when the message did
 *   not fully reach the customer. A text to several people, or a message
 *   carrying several photos, can partly succeed — some go out, some are
 *   blocked or fail. The send worker always answers "OK" for those, because
 *   the parts that DID go out are real, so without this the person would think
 *   everything sent. This turns the worker's per-part answer into one honest
 *   sentence, and says whether it should be shown as a warning or an error.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none (pure — no React, no db, no toast)
 *   Data:      none
 *
 * EXPORTS:
 *   summarizeSendResult(twilio) → { total, sent, blocked, failed }
 *   partialSendNotice(twilio)   → { message, type } | null
 *
 * NOTES / GOTCHAS:
 *   - Lives in src/lib/ rather than beside either composer ON PURPOSE: the
 *     office inbox (Conversations.jsx) and the field-tech thread (useThread.js)
 *     are copy-paste twins, and this exact reporting was present in one and
 *     missing in the other (PR #644 review). One implementation means the two
 *     surfaces cannot drift again. `msgsSelectors.js` re-exports
 *     summarizeSendResult so its existing importers keep working unchanged.
 *   - AGENTS.md §17 (report real outcomes, never the expected one) applies to
 *     the UI too, which is why a 201 with failed parts must never read as a
 *     clean send.
 * ════════════════════════════════════════════════
 */

/**
 * Summarize the worker's per-recipient/per-part `twilio[]` response so the UI can
 * surface a partial block ("Sent to 3 of 5 — 2 blocked"). Pure over the array shape
 * send-message.js returns: a sent entry carries a `sid`; a consent-blocked one carries
 * `skipped:true`; a transport failure carries `error`/`error_code` with no sid.
 * @param {Array<object>} twilio the response `twilio` array (single-recipient → length 1)
 * @returns {{ total:number, sent:number, blocked:number, failed:number }}
 */
export function summarizeSendResult(twilio) {
  const arr = Array.isArray(twilio) ? twilio : [];
  let sent = 0;
  let blocked = 0;
  let failed = 0;
  arr.forEach((r) => {
    if (!r) return;
    if (r.skipped) blocked += 1;
    else if (r.sid) sent += 1;
    else if (r.error || r.error_code || r.error_message) failed += 1;
    else sent += 1; // defensive: a bare success shape still counts as sent
  });
  return { total: arr.length, sent, blocked, failed };
}

/**
 * The one honest sentence to show after a multi-part send that did not fully land,
 * or null when there is nothing worth saying.
 *
 * Returns null for the ordinary cases — a single-recipient send (a blocked one already
 * returns 403 with its own reason) and a fully successful multi-part send.
 *
 * `type` is `error` when NOTHING reached the customer: an "N of M sent" line where N is
 * zero is a failed send, and it is announced as one (the error toast carries
 * role="alert", so it is not silently missed either).
 *
 * @param {Array<object>} twilio the response `twilio` array
 * @returns {{ message:string, type:'error'|'info' }|null}
 */
export function partialSendNotice(twilio) {
  const arr = Array.isArray(twilio) ? twilio : [];
  const summary = summarizeSendResult(arr);
  if (summary.total <= 1) return null;
  const missed = summary.blocked + summary.failed;
  if (missed === 0) return null;
  // A CallRail multi-photo split tags every entry with its part index; a
  // group/broadcast fan-out never does. Same accounting, different nouns —
  // "3 of 5 recipients" and "3 of 5 photos" are not interchangeable to a reader.
  const isPhotoSplit = arr.length > 0 && arr.every((r) => r && r.part_index != null);
  return {
    message: isPhotoSplit
      ? `${summary.sent} of ${summary.total} photos sent — ${missed} failed`
      : `Sent to ${summary.sent} of ${summary.total} — ${missed} not reached`,
    type: summary.sent === 0 ? 'error' : 'info',
  };
}
