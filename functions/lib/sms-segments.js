/**
 * ════════════════════════════════════════════════
 * FILE: sms-segments.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Works out how a text message will actually be sent: which alphabet it needs, and
 *   how many separate pieces ("segments") the phone network will break it into. A
 *   plain-English text fits 160 characters in one piece, but a single emoji or curly
 *   quote switches the whole message to a bigger alphabet where only 70 fit. Phones
 *   glue the pieces back together on arrival, so the reader sees one message — but the
 *   count is what carriers bill and what providers cap, so we measure it properly
 *   instead of counting characters and hoping.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none (pure — no I/O, safe in a Worker and in the browser bundle)
 *   Data:      reads/writes → none
 *
 * NOTES / GOTCHAS:
 *   - This is the ONE implementation. `src/components/conversations/messageUtils.js`
 *     re-exports it so the composer and the send path can never disagree.
 *   - GSM extension characters (^ { } \ [ ~ ] | €) cost TWO units each, not one. A
 *     message of 160 curly braces is two segments, not one.
 *   - Counting code points (`[...text].length`) is NOT segment-safe and must not be
 *     used to enforce a provider limit — that was the pre-2026-07-26 bug.
 * ════════════════════════════════════════════════
 */

// GSM 03.38 basic charset (each counts as 1 unit). Includes \n and \r.
const GSM_BASIC = new Set(
  ('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡' +
    'ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà').split('')
);
// GSM extension charset (each counts as 2 units — an escape + the char).
const GSM_EXT = new Set('^{}\\[~]|€'.split(''));

const GSM_SINGLE = 160, GSM_MULTI = 153;
const UCS2_SINGLE = 70, UCS2_MULTI = 67;

/**
 * Count characters and SMS segments for `text`, picking GSM-7 or UCS-2 the same way
 * a carrier would. Returns { encoding, units, chars, segments, remaining }.
 *   - units: billable units (GSM extension chars cost 2; UCS-2 counts code points)
 *   - chars: visible character count (code points)
 *   - segments: how many SMS parts this becomes
 *   - remaining: characters left before the count tips into the next segment
 */
export function computeSmsSegments(text = '') {
  const chars = [...text].length;
  let isGsm = true;
  let gsmUnits = 0;
  for (const ch of text) {
    if (GSM_EXT.has(ch)) gsmUnits += 2;
    else if (GSM_BASIC.has(ch)) gsmUnits += 1;
    else { isGsm = false; break; }
  }

  if (isGsm) {
    const units = gsmUnits;
    const segments = units === 0 ? 0 : units <= GSM_SINGLE ? 1 : Math.ceil(units / GSM_MULTI);
    const cap = segments <= 1 ? GSM_SINGLE : GSM_MULTI * segments;
    return { encoding: 'GSM-7', units, chars, segments, remaining: Math.max(0, cap - units) };
  }

  const units = chars;
  const segments = units === 0 ? 0 : units <= UCS2_SINGLE ? 1 : Math.ceil(units / UCS2_MULTI);
  const cap = segments <= 1 ? UCS2_SINGLE : UCS2_MULTI * segments;
  return { encoding: 'UCS-2', units, chars, segments, remaining: Math.max(0, cap - units) };
}

/**
 * Largest character count that still fits within `maxSegments`, for the encoding the
 * given text forces. Used to tell a composer how much room is actually left rather
 * than quoting a flat character number that is wrong for half of all messages.
 */
export function maxCharsForSegments(maxSegments, { encoding = 'GSM-7' } = {}) {
  if (encoding === 'UCS-2') {
    return maxSegments <= 1 ? UCS2_SINGLE : UCS2_MULTI * maxSegments;
  }
  return maxSegments <= 1 ? GSM_SINGLE : GSM_MULTI * maxSegments;
}
